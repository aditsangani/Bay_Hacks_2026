"""Integration checks for transient tracking and separate wellbeing history."""

import copy
import unittest
from unittest.mock import patch

import app as api


FACE = {
    "asymmetry_score": 0.01,
    "landmarks_detected": True,
    "landmarks": [{"x": 0.5, "y": 0.5}] * 468,
    "pair_deltas": [0.01] * 4,
    "quality": {"acceptable": True, "message": "Ready"},
    "sample_count": 3,
    "method": "pose_corrected_v2",
}
ANSWERS = {
    "hours_sleep": 8,
    "usual_sleep_hours": 8,
    "sleep_quality": 5,
    "mood": 5,
    "fatigue": 0,
    "pain": 0,
    "concentration": 0,
    "sudden_neurological_symptoms": 0,
}


class CheckInApiTests(unittest.TestCase):
    def setUp(self):
        api.PENDING_CHECKINS.clear()
        api.PATIENT_HISTORY.clear()
        self.client = api.app.test_client()

    def capture(self, result=None):
        with patch.object(api, "score_from_base64_images", return_value=result or FACE):
            return self.client.post("/api/checkin/face", json={
                "patient_id": "test-patient", "images_b64": ["frame"] * 3,
            })

    def voice(self):
        return self.client.post("/api/checkin/voice", json={
            "patient_id": "test-patient", "voice_jitter": 0.01, "response_latency_ms": 1000,
        })

    def test_preview_never_creates_pending_or_history(self):
        with patch.object(api, "score_from_base64_image", return_value=FACE):
            response = self.client.post("/api/checkin/face/preview", json={"image_b64": "frame"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json["landmarks"]), 468)
        self.assertEqual(api.PENDING_CHECKINS, {})
        self.assertEqual(api.PATIENT_HISTORY, {})

    def test_capture_excludes_image_and_landmarks_from_cache(self):
        self.assertEqual(self.capture().status_code, 200)
        self.assertEqual(set(api.PENDING_CHECKINS["test-patient"]["face"]), {
            "asymmetry_score", "pair_deltas", "sample_count", "method",
        })

    def test_bad_retake_invalidates_old_capture(self):
        self.capture()
        rejected = copy.deepcopy(FACE)
        rejected.update(asymmetry_score=None, quality={"acceptable": False, "message": "Look forward"})
        self.assertEqual(self.capture(rejected).status_code, 422)
        self.assertNotIn("face", api.PENDING_CHECKINS["test-patient"])
        self.voice()
        response = self.client.post("/api/checkin/submit", json={"patient_id": "test-patient"})
        self.assertEqual(response.status_code, 400)
        self.assertFalse(api.PATIENT_HISTORY)

    def test_malformed_image_has_readable_error(self):
        response = self.client.post("/api/checkin/face/preview", json={"image_b64": "not an image"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.json)

    def test_wellness_plan_is_transient_and_rejects_non_object(self):
        response = self.client.post("/api/checkin/wellness/plan", json={"answers": ANSWERS})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json["complete"])
        self.assertFalse(api.PATIENT_HISTORY)
        self.assertFalse(api.PENDING_CHECKINS)
        invalid = self.client.post("/api/checkin/wellness/plan", json={"answers": []})
        self.assertEqual(invalid.status_code, 400)

    def test_wellness_validation_preserves_capture_for_retry(self):
        self.capture()
        self.voice()
        response = self.client.post("/api/checkin/submit", json={
            "patient_id": "test-patient", "wellness": {**ANSWERS, "hours_sleep": 25},
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn("face", api.PENDING_CHECKINS["test-patient"])
        self.assertFalse(api.PATIENT_HISTORY)

    def test_urgent_answers_cannot_finish_normal_checkin(self):
        self.capture()
        self.voice()
        response = self.client.post("/api/checkin/submit", json={
            "patient_id": "test-patient", "wellness": {**ANSWERS, "sudden_neurological_symptoms": 1},
        })
        self.assertIn(response.status_code, (400, 422))
        self.assertFalse(api.PATIENT_HISTORY)

    def test_completed_wellness_survives_dashboard_without_affecting_risk(self):
        self.capture()
        self.voice()
        response = self.client.post("/api/checkin/submit", json={
            "patient_id": "test-patient", "wellness": ANSWERS,
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["risk"]["risk_score"], 0.0)
        self.assertEqual(response.json["wellness"]["answers"]["hours_sleep"], 8)
        self.assertNotIn("wellness", response.json["telemetry_payload"])
        self.assertNotIn("patient_id", response.json["telemetry_payload"])
        self.assertFalse(api.PENDING_CHECKINS)
        history = self.client.get("/api/dashboard/test-patient").json["history"]
        self.assertEqual(history[0]["wellness"]["answers"], ANSWERS)
        self.assertEqual(history[0]["face_analysis"]["sample_count"], 3)
        self.assertNotIn("landmarks", history[0])

    def test_older_client_can_submit_without_wellness(self):
        self.capture()
        self.voice()
        response = self.client.post("/api/checkin/submit", json={"patient_id": "test-patient"})
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json["wellness"])


if __name__ == "__main__":
    unittest.main()
