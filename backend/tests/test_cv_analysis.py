"""Geometry and capture-quality regression tests without a physical camera."""

import base64
from pathlib import Path
import struct
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cv_analysis as analysis


def face_points(delta=0):
    points = np.full((478, 2), 0.5, dtype=float)
    points[analysis.FOREHEAD] = [0.5, 0.25]
    points[analysis.CHIN] = [0.5, 0.75]
    points[analysis.CHEEKS[0]] = [0.25, 0.5]
    points[analysis.CHEEKS[1]] = [0.75, 0.5]
    for (left, right), y in zip(analysis.LEFT_RIGHT_PAIRS, [0.65, 0.35, 0.45, 0.63]):
        points[left] = [0.35, y]
        points[right] = [0.65, y]
    points[analysis.LEFT_RIGHT_PAIRS[0][1], 1] += delta
    return points


def landmarks(points):
    return SimpleNamespace(landmark=[SimpleNamespace(x=x, y=y) for x, y in points])


def rotate_pixels(points, angle):
    radians = np.deg2rad(angle)
    rotation = np.array([[np.cos(radians), -np.sin(radians)],
                         [np.sin(radians), np.cos(radians)]])
    pixels = (points - 0.5) * [640, 480]
    return (pixels @ rotation.T) / [640, 480] + 0.5


def encoded_image(extension=".png"):
    ok, data = cv2.imencode(extension, np.zeros((480, 640, 3), dtype=np.uint8))
    assert ok
    return base64.b64encode(data).decode("ascii")


class GeometryTests(unittest.TestCase):
    def score(self, points, width=640, height=480):
        return analysis._analyze_landmarks(landmarks(points), width, height)

    def test_symmetric_face_has_zero_score_and_normalized_indexed_points(self):
        result = self.score(face_points())
        self.assertTrue(result["quality"]["acceptable"])
        self.assertEqual(result["asymmetry_score"], 0)
        self.assertEqual(result["method"], "pose_corrected_v2")
        self.assertEqual(result["sample_count"], 1)
        self.assertEqual(len(result["landmarks"]), 478)
        self.assertEqual(result["landmarks"][analysis.FOREHEAD], {"x": 0.5, "y": 0.25})

    def test_known_displacement_is_normalized_by_forehead_chin_height(self):
        result = self.score(face_points(delta=0.02))
        self.assertEqual(result["pair_deltas"], [0.04, 0, 0, 0])
        self.assertEqual(result["asymmetry_score"], 0.01)

    def test_roll_does_not_create_or_hide_asymmetry(self):
        for delta in [0, 0.02]:
            reference = self.score(face_points(delta))
            for degrees in [-20, -10, 10, 20]:
                with self.subTest(delta=delta, degrees=degrees):
                    rotated = self.score(rotate_pixels(face_points(delta), degrees))
                    self.assertTrue(rotated["quality"]["acceptable"])
                    self.assertEqual(rotated["asymmetry_score"], reference["asymmetry_score"])
                    self.assertEqual(rotated["pair_deltas"], reference["pair_deltas"])

    def test_image_resolution_face_scale_and_translation_do_not_change_score(self):
        points = face_points(0.02)
        reference = self.score(points)["asymmetry_score"]
        self.assertEqual(self.score(points, 1280, 960)["asymmetry_score"], reference)
        transformed = (points - 0.5) * 0.8 + [0.54, 0.47]
        self.assertEqual(self.score(transformed)["asymmetry_score"], reference)

    def test_poor_positioning_has_no_metric(self):
        cropped = face_points()
        cropped[analysis.CHIN, 1] = 0.995
        turned = face_points()
        turned[analysis.NOSE_TIP, 0] = 0.65
        for name, points in {
            "cropped": cropped,
            "too small": (face_points() - 0.5) * 0.2 + 0.5,
            "tilted": rotate_pixels(face_points(), 35),
            "turned": turned,
            "degenerate": np.full((478, 2), 0.5),
        }.items():
            with self.subTest(name=name):
                result = self.score(points)
                self.assertFalse(result["quality"]["acceptable"])
                self.assertIsNone(result["asymmetry_score"])
                self.assertEqual(result["pair_deltas"], [])
                self.assertEqual(result["sample_count"], 0)

    def test_malformed_nonfinite_landmarks_have_no_metric(self):
        bad = face_points()
        bad[1, 0] = float("nan")
        for points in [bad, face_points()[:10]]:
            result = self.score(points)
            self.assertFalse(result["quality"]["acceptable"])
            self.assertIsNone(result["asymmetry_score"])
            self.assertEqual(result["landmarks"], [])


class CaptureTests(unittest.TestCase):
    def test_no_face_and_multiple_faces_are_rejected(self):
        for faces in [None, [], [landmarks(face_points()), landmarks(face_points())]]:
            with self.subTest(face_count=len(faces or [])):
                mesh = MagicMock()
                mesh.process.return_value = SimpleNamespace(multi_face_landmarks=faces)
                with patch.object(analysis, "_face_mesh") as factory:
                    factory.return_value.__enter__.return_value = mesh
                    result = analysis.compute_facial_asymmetry_score(
                        np.zeros((480, 640, 3), dtype=np.uint8)
                    )
                self.assertFalse(result["quality"]["acceptable"])
                self.assertIsNone(result["asymmetry_score"])
                self.assertEqual(result["landmarks"], [])

    def test_detector_checks_for_two_faces(self):
        with patch.object(analysis.mp_face_mesh, "FaceMesh") as factory:
            analysis._face_mesh()
        self.assertEqual(factory.call_args.kwargs["max_num_faces"], 2)

    def test_burst_uses_median_and_last_landmarks(self):
        mesh = MagicMock()
        mesh.process.side_effect = [
            SimpleNamespace(multi_face_landmarks=[landmarks(face_points(delta))])
            for delta in [0.02, 0.04, 0.24]
        ]
        with patch.object(analysis, "_face_mesh") as factory:
            factory.return_value.__enter__.return_value = mesh
            result = analysis.score_from_base64_images([encoded_image()] * 3)
        self.assertEqual(result["asymmetry_score"], 0.02)
        self.assertEqual(result["pair_deltas"], [0.08, 0, 0, 0])
        self.assertEqual(result["sample_count"], 3)
        self.assertEqual(result["landmarks"][291]["y"], 0.89)

    def test_burst_rejects_any_failed_frame(self):
        mesh = MagicMock()
        mesh.process.side_effect = [
            SimpleNamespace(multi_face_landmarks=[landmarks(face_points())]),
            SimpleNamespace(multi_face_landmarks=[]),
        ]
        with patch.object(analysis, "_face_mesh") as factory:
            factory.return_value.__enter__.return_value = mesh
            result = analysis.score_from_base64_images([encoded_image()] * 3)
        self.assertIsNone(result["asymmetry_score"])
        self.assertFalse(result["quality"]["acceptable"])
        self.assertIn("Frame 2 of 3", result["quality"]["message"])
        self.assertEqual(result["sample_count"], 0)

    def test_burst_requires_three_to_five_frames(self):
        for payload in [None, "image", {}, [], ["a"] * 2, ["a"] * 6]:
            with self.subTest(payload=payload):
                with self.assertRaises(ValueError):
                    analysis.score_from_base64_images(payload)


class DecodeTests(unittest.TestCase):
    def test_png_jpeg_and_data_urls_decode(self):
        for extension, mime in [(".png", "png"), (".jpg", "jpeg")]:
            encoded = encoded_image(extension)
            for value in [encoded, f"data:image/{mime};base64,{encoded}"]:
                with self.subTest(extension=extension):
                    frame = analysis._decode_image(value)
                    self.assertEqual(frame.shape, (480, 640, 3))

    def test_invalid_or_oversized_input_raises_value_error(self):
        for value in [None, 42, {}, "", "!!!", "é", "aGVsbG8=",
                      "data:text/plain;base64,aGVsbG8=", "A" * (analysis.MAX_ENCODED_LENGTH + 33)]:
            with self.subTest(description=str(value)[:30]):
                with self.assertRaises(ValueError):
                    analysis.score_from_base64_image(value)

    def test_oversized_dimensions_rejected_before_decompression(self):
        header = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
        header += struct.pack(">II", 64000, 64000) + b"\x00" * 9
        with patch.object(analysis.cv2, "imdecode") as decoder:
            with self.assertRaisesRegex(ValueError, "1920"):
                analysis._decode_image(base64.b64encode(header).decode("ascii"))
        decoder.assert_not_called()

    def test_truncated_png_and_jpeg_are_rejected(self):
        for data in [b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff", b"\xff\xd8\xff\xc0\x00\x01"]:
            with self.assertRaises(ValueError):
                analysis._decode_image(base64.b64encode(data).decode("ascii"))


if __name__ == "__main__":
    unittest.main()
