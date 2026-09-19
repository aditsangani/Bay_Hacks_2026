"""Transient facial landmarks and a pose-corrected symmetry measurement.

For mirrored feature pair (L, R), let v be the unit vector from forehead
landmark 10 to chin landmark 152, and H be that vector's original length.
The pair's displacement is abs(dot(L - R, v)) / H. The frame score is the
mean of four pair displacements; a burst uses the median frame score.
Using face-local coordinates removes image roll and makes the measurement
invariant to uniform image scaling and translation. It does not correct
perspective, expression, or all head movement. Positioning checks reject
poor captures; they are heuristics, not clinical head-pose estimates.

This unvalidated demo measurement is not a diagnosis. Landmarks and images
are processed only in memory and must not be persisted by callers.
"""

import base64
import binascii
import math
import struct

import cv2
import mediapipe as mp
import numpy as np

mp_face_mesh = mp.solutions.face_mesh

LEFT_RIGHT_PAIRS = [(61, 291), (105, 334), (33, 263), (78, 308)]
FOREHEAD = 10
CHIN = 152
NOSE_TIP = 1
CHEEKS = (234, 454)
METHOD = "pose_corrected_v2"
MAX_IMAGE_BYTES = 2 * 1024 * 1024
MAX_IMAGE_DIMENSION = 1920
MAX_IMAGE_PIXELS = 1920 * 1080
MAX_ENCODED_LENGTH = 4 * ((MAX_IMAGE_BYTES + 2) // 3)


def _result(message, *, points=None, detected=False, score=None, deltas=None):
    acceptable = score is not None
    return {
        "asymmetry_score": round(float(score), 5) if acceptable else None,
        "landmarks_detected": detected,
        "pair_deltas": [round(float(d), 5) for d in deltas] if deltas is not None else [],
        "landmarks": points if points is not None else [],
        "quality": {"acceptable": acceptable, "message": message},
        "sample_count": 1 if acceptable else 0,
        "method": METHOD,
    }


def _validate_dimensions(width, height):
    if (
        width <= 0
        or height <= 0
        or max(width, height) > MAX_IMAGE_DIMENSION
        or width * height > MAX_IMAGE_PIXELS
    ):
        raise ValueError("Use a camera image no larger than 1920 × 1080 pixels.")


def _encoded_image_dimensions(data):
    """Read PNG/JPEG dimensions before allocating a decompressed image."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        if len(data) < 33 or data[8:16] != b"\x00\x00\x00\rIHDR":
            raise ValueError("Invalid PNG camera image.")
        return struct.unpack(">II", data[16:24])

    if not data.startswith(b"\xff\xd8"):
        raise ValueError("Camera images must be JPEG or PNG.")

    # JPEG segment lengths include their own two length bytes. SOF markers
    # describe dimensions; SOS starts compressed data and must follow SOF.
    sof_markers = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                   0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
    offset = 2
    while offset < len(data):
        if data[offset] != 0xFF:
            break
        while offset < len(data) and data[offset] == 0xFF:
            offset += 1
        if offset >= len(data):
            break
        marker = data[offset]
        offset += 1
        if marker in (0xD9, 0xDA):
            break
        if marker == 0x01 or 0xD0 <= marker <= 0xD7:
            continue
        if offset + 2 > len(data):
            break
        segment_length = int.from_bytes(data[offset:offset + 2], "big")
        if segment_length < 2 or offset + segment_length > len(data):
            break
        if marker in sof_markers:
            if segment_length < 8:
                break
            height, width = struct.unpack(">HH", data[offset + 3:offset + 7])
            return width, height
        offset += segment_length
    raise ValueError("Invalid JPEG camera image.")


def _decode_image(b64_string):
    if not isinstance(b64_string, str) or not b64_string:
        raise ValueError("Provide a base64 camera image.")
    if len(b64_string) > MAX_ENCODED_LENGTH + 32:
        raise ValueError("Camera image exceeds the 2 MiB limit.")
    if b64_string.startswith("data:"):
        header, separator, b64_string = b64_string.partition(",")
        if not separator or header not in ("data:image/jpeg;base64", "data:image/png;base64"):
            raise ValueError("Camera images must be base64 JPEG or PNG data URLs.")
    try:
        data = base64.b64decode(b64_string, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Invalid base64 camera image.") from exc
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise ValueError("Camera image is empty or exceeds the 2 MiB limit.")
    _validate_dimensions(*_encoded_image_dimensions(data))
    try:
        frame = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    except cv2.error as exc:
        raise ValueError("Unable to decode the camera image.") from exc
    if frame is None:
        raise ValueError("Unable to decode the camera image.")
    _validate_dimensions(frame.shape[1], frame.shape[0])
    return frame


def _analyze_landmarks(face_landmarks, image_w, image_h):
    try:
        normalized = np.asarray([(lm.x, lm.y) for lm in face_landmarks.landmark], dtype=float)
    except (AttributeError, TypeError, ValueError):
        return _result("Face tracking was unclear. Hold still and try again.")
    if normalized.shape not in ((468, 2), (478, 2)) or not np.isfinite(normalized).all():
        return _result("Face tracking was unclear. Hold still and try again.")
    points = [{"x": round(float(x), 6), "y": round(float(y), 6)} for x, y in normalized]
    pts = normalized * [image_w, image_h]

    def reject(message):
        return _result(message, points=points, detected=True)

    axis = pts[CHIN] - pts[FOREHEAD]
    face_height = float(np.linalg.norm(axis))
    if face_height < 1:
        return reject("Face tracking was unclear. Face the camera and try again.")
    vertical = axis / face_height
    horizontal = np.array([vertical[1], -vertical[0]])
    left_cheek, right_cheek = pts[list(CHEEKS)] @ horizontal
    face_width = abs(float(right_cheek - left_cheek))
    if face_width < 1:
        return reject("Face tracking was unclear. Face the camera and try again.")

    if (normalized[:468] < 0.02).any() or (normalized[:468] > 0.98).any():
        return reject("Move back slightly and keep your whole face inside the camera view.")
    if face_height < image_h * 0.25 or face_width < image_w * 0.18:
        return reject("Move a little closer so your face is easier to track.")
    roll_degrees = abs(math.degrees(math.atan2(float(vertical[0]), float(vertical[1]))))
    if roll_degrees > 25:
        return reject("Keep your head upright and look straight at the camera.")

    # A nose displaced toward one cheek is a coarse positioning cue only.
    # This avoids making a symmetry measurement from an obvious side view.
    nose_horizontal = float(pts[NOSE_TIP] @ horizontal)
    yaw_cue = abs(2 * nose_horizontal - left_cheek - right_cheek) / face_width
    if yaw_cue > 0.35:
        return reject("Turn toward the camera so both sides of your face are visible.")

    deltas = [abs(float((pts[left] - pts[right]) @ vertical)) / face_height
              for left, right in LEFT_RIGHT_PAIRS]
    return _result(
        "Face is in view. Keep a relaxed expression and hold still.",
        points=points, detected=True, score=float(np.mean(deltas)), deltas=deltas,
    )


def _face_mesh():
    return mp_face_mesh.FaceMesh(
        static_image_mode=True,
        max_num_faces=2,
        refine_landmarks=True,
        min_detection_confidence=0.5,
    )


def _score_frame(frame_bgr, face_mesh):
    if not isinstance(frame_bgr, np.ndarray) or frame_bgr.ndim != 3 or frame_bgr.shape[2] != 3:
        raise ValueError("Provide a three-channel camera image.")
    if frame_bgr.dtype != np.uint8:
        raise ValueError("Camera pixels must be unsigned 8-bit values.")
    height, width = frame_bgr.shape[:2]
    _validate_dimensions(width, height)
    results = face_mesh.process(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))
    faces = results.multi_face_landmarks or []
    if not faces:
        return _result("No face found. Face the camera and check your lighting.")
    if len(faces) != 1:
        return _result("Keep only one person in the camera view.")
    return _analyze_landmarks(faces[0], width, height)


def compute_facial_asymmetry_score(frame_bgr):
    """Measure one BGR image; return preview landmarks and positioning guidance."""
    with _face_mesh() as face_mesh:
        return _score_frame(frame_bgr, face_mesh)


def score_from_base64_image(b64_string):
    """Decode one bounded JPEG/PNG preview frame. Invalid images raise ValueError."""
    return compute_facial_asymmetry_score(_decode_image(b64_string))


def score_from_base64_images(images_b64):
    """Use 3–5 acceptable frames and a median to reduce one-frame jitter.

    Any failed positioning check rejects the entire burst. A failed frame is
    never converted to a zero (apparently symmetric) measurement. Images and
    preview landmarks remain transient, including when a burst is rejected.
    """
    if not isinstance(images_b64, list) or not 3 <= len(images_b64) <= 5:
        raise ValueError("Capture between 3 and 5 camera images.")
    samples = []
    with _face_mesh() as face_mesh:
        for index, encoded_image in enumerate(images_b64):
            sample = _score_frame(_decode_image(encoded_image), face_mesh)
            if not sample["quality"]["acceptable"]:
                sample["quality"]["message"] = (
                    f"Frame {index + 1} of {len(images_b64)}: " + sample["quality"]["message"]
                )
                return sample
            samples.append(sample)
    result = samples[-1].copy()
    result["asymmetry_score"] = round(float(np.median([s["asymmetry_score"] for s in samples])), 5)
    result["pair_deltas"] = [round(float(value), 5)
                             for value in np.median([s["pair_deltas"] for s in samples], axis=0)]
    result["sample_count"] = len(samples)
    return result
