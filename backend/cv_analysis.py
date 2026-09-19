"""
Facial symmetry analysis using MediaPipe Face Mesh.

Scoped for the hackathon: we ONLY compute a unilateral droop/asymmetry
score from facial landmarks. We deliberately do NOT attempt hand tremor
detection here — that was cut from the build to keep the demo reliable
(see conversation notes: tremor via webcam is noisy and hard to validate
in 24 hours).

Privacy note: this module is designed to run on a single frame (or a
short burst of frames) that the caller discards immediately after
extracting landmarks. Nothing in this file writes raw image data to
disk. Keep it that way — only the returned numeric metrics should ever
be persisted.
"""

import cv2
import mediapipe as mp
import numpy as np

mp_face_mesh = mp.solutions.face_mesh

# Landmark indices (MediaPipe Face Mesh, 468-point model) for a small set
# of left/right mirrored points useful for a coarse symmetry score.
# These are mouth corners, eyebrow points, and eye corners.
LEFT_RIGHT_PAIRS = [
    (61, 291),   # mouth corners (left, right)
    (105, 334),  # eyebrow
    (33, 263),   # eye outer corners
    (78, 308),   # inner mouth corners
]

NOSE_TIP = 1  # used as the vertical midline reference


def _landmarks_to_array(landmarks, image_w, image_h):
    return np.array(
        [(lm.x * image_w, lm.y * image_h) for lm in landmarks.landmark]
    )


def compute_facial_asymmetry_score(frame_bgr):
    """
    Takes a single BGR frame (numpy array, as read by cv2), returns a dict:
      {
        "asymmetry_score": float,   # 0 = perfectly symmetric, higher = more droop
        "landmarks_detected": bool,
        "pair_deltas": [float, ...] # per-pair vertical offset, for debugging/demo
      }

    This is intentionally simple: for each left/right landmark pair, we
    compare vertical (y) displacement relative to the nose-tip midline.
    A real clinical-grade system would use a validated dysarthria/facial
    palsy grading scale (e.g., House-Brackmann) — for the hackathon we
    are explicit in the demo that this is a coarse proxy, not a
    diagnostic score.
    """
    h, w, _ = frame_bgr.shape
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)

    with mp_face_mesh.FaceMesh(
        static_image_mode=True,
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.5,
    ) as face_mesh:
        results = face_mesh.process(rgb)

        if not results.multi_face_landmarks:
            return {
                "asymmetry_score": None,
                "landmarks_detected": False,
                "pair_deltas": [],
            }

        pts = _landmarks_to_array(results.multi_face_landmarks[0], w, h)
        nose_y = pts[NOSE_TIP][1]

        pair_deltas = []
        for left_idx, right_idx in LEFT_RIGHT_PAIRS:
            left_y = pts[left_idx][1]
            right_y = pts[right_idx][1]
            # Vertical displacement of each side relative to the nose
            # midline; a large difference between the two sides suggests
            # asymmetric droop.
            delta = abs((left_y - nose_y) - (right_y - nose_y))
            pair_deltas.append(float(delta))

        # Normalize by face height (nose-to-chin-ish proxy: use bbox height)
        face_height = pts[:, 1].max() - pts[:, 1].min()
        normalized_deltas = [d / face_height for d in pair_deltas]
        asymmetry_score = float(np.mean(normalized_deltas))

        return {
            "asymmetry_score": round(asymmetry_score, 5),
            "landmarks_detected": True,
            "pair_deltas": [round(d, 5) for d in normalized_deltas],
        }


def score_from_base64_image(b64_string):
    """
    Convenience wrapper: decode a base64 JPEG/PNG string (as sent from
    the browser via canvas.toDataURL()) and run compute_facial_asymmetry_score.
    Frame is discarded after processing — never written to disk.
    """
    import base64

    header_stripped = b64_string.split(",")[-1]
    img_bytes = base64.b64decode(header_stripped)
    np_arr = np.frombuffer(img_bytes, np.uint8)
    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

    if frame is None:
        return {"asymmetry_score": None, "landmarks_detected": False, "pair_deltas": []}

    result = compute_facial_asymmetry_score(frame)
    # explicitly drop the frame reference; nothing here persists it
    del frame
    return result
