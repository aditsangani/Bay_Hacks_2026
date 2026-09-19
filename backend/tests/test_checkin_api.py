"""Integration checks for transient tracking, separate wellbeing history, and auth.

Persistence goes through database/patient_history.py (Supabase) instead of an
in-memory PATIENT_HISTORY dict, and every route now requires a Supabase Auth
bearer token (see backend/auth.py) -- both are patched here with in-memory
fakes rather than hitting real services. Fake bearer tokens are the string
"<user_id>:<role>", e.g. "test-patient:patient" / "test-clinician:clinician",
consumed by FakeAuthClient below.
"""

import copy
import unittest
from unittest.mock import patch

import app as api
import auth as api_auth
import audit_log as audit_module


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
AUTH_HEADERS = {
    "patient": {"Authorization": "Bearer test-patient:patient"},
    "clinician": {"Authorization": "Bearer test-clinician:clinician"},
}
VITALS = {
    "heart_rate_bpm": 72,
    "breathing_rate_bpm": 15,
    "duration_seconds": 25,
    "sample_count": 375,
    "method": "camera_rppg_pos_v2",
}


class FakePatientHistory:
    """In-memory stand-in for database/patient_history.py's module functions."""

    def __init__(self):
        self.rows = {}

    def append(self, patient_id, metrics, risk, face_analysis=None, wellness=None, vital_signs=None):
        entry = {
            "metrics": dict(metrics),
            "risk": dict(risk),
            "face_analysis": dict(face_analysis or {}),
            "wellness": wellness,
            "vital_signs": vital_signs,
            "timestamp": 0.0,
        }
        self.rows.setdefault(patient_id, []).append(entry)

    def history_for(self, patient_id):
        return list(self.rows.get(patient_id, []))

    def latest_metrics_for(self, patient_id):
        rows = self.rows.get(patient_id)
        if not rows:
            return None
        return {"facial_asymmetry_score": rows[-1]["metrics"].get("facial_asymmetry_score")}


class _FakeProfilesTable:
    """Stand-in for .table("profiles").select(...).eq("id", ...).execute(),
    the only query shape auth.require_auth actually performs. Role comes
    from whatever FakeAuthClient.get_user() last decoded from the token."""

    def __init__(self, role_by_user_id):
        self._role_by_user_id = role_by_user_id
        self._id = None

    def select(self, *a, **k):
        return self

    def eq(self, column, value):
        if column == "id":
            self._id = value
        return self

    def limit(self, n):
        return self

    def execute(self):
        role = self._role_by_user_id.get(self._id)
        data = [{"role": role, "display_name": self._id}] if role else []
        return type("Result", (), {"data": data})()


class FakeAuthClient:
    """Stand-in for the Supabase client's .auth.get_user() + .table('profiles')
    lookup used by auth.require_auth/require_role."""

    def __init__(self):
        self.auth = self
        self._role_by_user_id = {}

    def get_user(self, token):
        if not token or ":" not in token:
            raise ValueError("malformed fake token")
        user_id, _, role = token.partition(":")
        self._role_by_user_id[user_id] = role
        return type("Resp", (), {"user": type("U", (), {"id": user_id})()})()

    def table(self, name):
        assert name == "profiles"
        return _FakeProfilesTable(self._role_by_user_id)


class CheckInApiTests(unittest.TestCase):
    def setUp(self):
        api.PENDING_CHECKINS.clear()
        self.fake_history = FakePatientHistory()
        for name in ("append", "history_for", "latest_metrics_for"):
            patcher = patch.object(api.patient_history, name, getattr(self.fake_history, name))
            patcher.start()
            self.addCleanup(patcher.stop)
        audit_patcher = patch.object(api.audit_log, "log", lambda *a, **k: None)
        audit_patcher.start()
        self.addCleanup(audit_patcher.stop)

        self.fake_auth_client = FakeAuthClient()
        auth_patcher = patch.object(api_auth, "get_client", lambda: self.fake_auth_client)
        auth_patcher.start()
        self.addCleanup(auth_patcher.stop)

        self.client = api.app.test_client()

    def capture(self, result=None, vital_signs=None):
        with patch.object(api, "score_from_base64_images", return_value=result or FACE):
            return self.client.post(
                "/api/checkin/face",
                json={
                    "images_b64": ["frame"] * 3,
                    **({"vital_signs": vital_signs} if vital_signs is not None else {}),
                },
                headers=AUTH_HEADERS["patient"],
            )

    def voice(self):
        return self.client.post(
            "/api/checkin/voice",
            json={"voice_jitter": 0.01, "response_latency_ms": 1000},
            headers=AUTH_HEADERS["patient"],
        )

    def submit(self, wellness=None):
        body = {"wellness": wellness} if wellness is not None else {}
        return self.client.post("/api/checkin/submit", json=body, headers=AUTH_HEADERS["patient"])

    # --- Auth ---

    def test_missing_auth_header_returns_401(self):
        response = self.client.post("/api/checkin/face", json={"images_b64": ["frame"] * 3})
        self.assertEqual(response.status_code, 401)

    def test_clinician_token_cannot_use_patient_route(self):
        response = self.client.post(
            "/api/checkin/voice",
            json={"voice_jitter": 0.01, "response_latency_ms": 1000},
            headers=AUTH_HEADERS["clinician"],
        )
        self.assertEqual(response.status_code, 403)

    def test_patient_token_cannot_use_clinician_routes(self):
        self.assertEqual(
            self.client.get("/api/dashboard/test-patient", headers=AUTH_HEADERS["patient"]).status_code, 403
        )
        self.assertEqual(
            self.client.get("/api/audit-log", headers=AUTH_HEADERS["patient"]).status_code, 403
        )

    def test_client_supplied_patient_id_is_ignored(self):
        with patch.object(api, "score_from_base64_images", return_value=FACE):
            self.client.post(
                "/api/checkin/face",
                json={"patient_id": "someone-else", "images_b64": ["frame"] * 3},
                headers=AUTH_HEADERS["patient"],
            )
        self.assertIn("test-patient", api.PENDING_CHECKINS)
        self.assertNotIn("someone-else", api.PENDING_CHECKINS)

    # --- Existing behavior, now authenticated ---

    def test_preview_never_creates_pending_or_history(self):
        with patch.object(api, "score_from_base64_image", return_value=FACE):
            response = self.client.post(
                "/api/checkin/face/preview", json={"image_b64": "frame"}, headers=AUTH_HEADERS["patient"]
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json["landmarks"]), 468)
        self.assertEqual(api.PENDING_CHECKINS, {})
        self.assertEqual(self.fake_history.rows, {})

    def test_capture_excludes_image_and_landmarks_from_cache(self):
        self.assertEqual(self.capture().status_code, 200)
        self.assertEqual(set(api.PENDING_CHECKINS["test-patient"]["face"]), {
            "asymmetry_score", "pair_deltas", "sample_count", "method", "vital_signs",
        })

    def test_camera_vitals_are_validated_and_stored_separately(self):
        response = self.capture(vital_signs=VITALS)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["vital_signs"]["heart_rate_bpm"], 72)
        self.assertNotIn("confidence", response.json["vital_signs"])
        self.assertEqual(api.PENDING_CHECKINS["test-patient"]["face"]["vital_signs"]["breathing_rate_bpm"], 15)
        invalid = self.capture(vital_signs={**VITALS, "heart_rate_bpm": 900})
        self.assertEqual(invalid.status_code, 400)
        self.assertNotIn("face", api.PENDING_CHECKINS["test-patient"])

    def test_bad_retake_invalidates_old_capture(self):
        self.capture()
        rejected = copy.deepcopy(FACE)
        rejected.update(asymmetry_score=None, quality={"acceptable": False, "message": "Look forward"})
        self.assertEqual(self.capture(rejected).status_code, 422)
        self.assertNotIn("face", api.PENDING_CHECKINS["test-patient"])
        self.voice()
        response = self.submit()
        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.fake_history.rows)

    def test_malformed_image_has_readable_error(self):
        response = self.client.post(
            "/api/checkin/face/preview", json={"image_b64": "not an image"}, headers=AUTH_HEADERS["patient"]
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.json)

    def test_wellness_plan_is_transient_and_rejects_non_object(self):
        response = self.client.post(
            "/api/checkin/wellness/plan", json={"answers": ANSWERS}, headers=AUTH_HEADERS["patient"]
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json["complete"])
        self.assertFalse(self.fake_history.rows)
        self.assertFalse(api.PENDING_CHECKINS)
        invalid = self.client.post(
            "/api/checkin/wellness/plan", json={"answers": []}, headers=AUTH_HEADERS["patient"]
        )
        self.assertEqual(invalid.status_code, 400)

    def test_wellness_validation_preserves_capture_for_retry(self):
        self.capture()
        self.voice()
        response = self.submit(wellness={**ANSWERS, "hours_sleep": 25})
        self.assertEqual(response.status_code, 400)
        self.assertIn("face", api.PENDING_CHECKINS["test-patient"])
        self.assertFalse(self.fake_history.rows)

    def test_urgent_answers_cannot_finish_normal_checkin(self):
        self.capture()
        self.voice()
        response = self.submit(wellness={**ANSWERS, "sudden_neurological_symptoms": 1})
        self.assertIn(response.status_code, (400, 422))
        self.assertFalse(self.fake_history.rows)

    def test_completed_wellness_survives_dashboard_without_affecting_risk(self):
        self.capture(vital_signs=VITALS)
        self.voice()
        response = self.submit(wellness=ANSWERS)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["risk"]["risk_score"], 0.0)
        self.assertEqual(response.json["wellness"]["answers"]["hours_sleep"], 8)
        self.assertNotIn("wellness", response.json["telemetry_payload"])
        self.assertNotIn("patient_id", response.json["telemetry_payload"])
        self.assertNotIn("heart_rate_bpm", response.json["telemetry_payload"])
        self.assertEqual(response.json["vital_signs"]["heart_rate_bpm"], 72)
        self.assertFalse(api.PENDING_CHECKINS)
        history = self.client.get(
            "/api/dashboard/test-patient", headers=AUTH_HEADERS["clinician"]
        ).json["history"]
        self.assertEqual(history[0]["wellness"]["answers"], ANSWERS)
        self.assertEqual(history[0]["face_analysis"]["sample_count"], 3)
        self.assertEqual(history[0]["vital_signs"]["breathing_rate_bpm"], 15)
        self.assertNotIn("landmarks", history[0])

    def test_older_client_can_submit_without_wellness(self):
        self.capture()
        self.voice()
        response = self.submit()
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json["wellness"])


class LocalPersistenceTests(unittest.TestCase):
    def setUp(self):
        api.PENDING_CHECKINS.clear()
        api.patient_history._LOCAL_ROWS.clear()
        audit_module._LOCAL_ENTRIES.clear()
        self.history_mode = patch.object(api.patient_history, "is_configured", return_value=False)
        self.audit_mode = patch.object(audit_module, "is_configured", return_value=False)
        self.history_mode.start()
        self.audit_mode.start()
        self.addCleanup(self.history_mode.stop)
        self.addCleanup(self.audit_mode.stop)
        self.addCleanup(api.patient_history._LOCAL_ROWS.clear)
        self.addCleanup(audit_module._LOCAL_ENTRIES.clear)
        self.addCleanup(api.PENDING_CHECKINS.clear)

        # "Local mode" (no Supabase configured) only applies to check_ins/
        # audit_log storage -- login itself always requires real Supabase
        # Auth, so route-level requests here still need a (faked) token.
        self.fake_auth_client = FakeAuthClient()
        auth_patcher = patch.object(api_auth, "get_client", lambda: self.fake_auth_client)
        auth_patcher.start()
        self.addCleanup(auth_patcher.stop)

    def test_checkins_and_audit_log_work_without_supabase_credentials(self):
        api.patient_history.append(
            "local-patient",
            metrics={"facial_asymmetry_score": 0.02, "voice_jitter": 0.01, "response_latency_ms": 900},
            risk={"risk_score": 0.1, "risk_level": "low", "flags": []},
            face_analysis={"method": "pose_corrected_v2", "sample_count": 3},
            wellness=None,
            vital_signs=VITALS,
        )
        history = api.patient_history.history_for("local-patient")
        self.assertEqual(history[0]["vital_signs"]["heart_rate_bpm"], 72)
        self.assertEqual(api.patient_history.latest_metrics_for("local-patient")["facial_asymmetry_score"], 0.02)

        audit_module.audit_log.log("local-clinician", "view_patient_record", "local-patient")
        self.assertEqual(audit_module.audit_log.all_entries()[0]["clinician_id"], "local-clinician")

    def test_full_submit_finishes_in_local_mode(self):
        client = api.app.test_client()
        headers = {"Authorization": "Bearer local-patient:patient"}
        with patch.object(api, "score_from_base64_images", return_value=FACE):
            face = client.post("/api/checkin/face", json={
                "images_b64": ["frame"] * 3, "vital_signs": VITALS,
            }, headers=headers)
        self.assertEqual(face.status_code, 200)
        self.assertEqual(client.post("/api/checkin/voice", json={
            "voice_jitter": 0.01, "response_latency_ms": 900,
        }, headers=headers).status_code, 200)
        submitted = client.post("/api/checkin/submit", json={
            "wellness": ANSWERS,
        }, headers=headers)
        self.assertEqual(submitted.status_code, 200)
        self.assertEqual(submitted.json["vital_signs"]["method"], "camera_rppg_pos_v2")

    def test_old_supabase_schema_embeds_vitals_and_retries_insert(self):
        class FakeInsertTable:
            def __init__(self):
                self.rows = []
                self.pending = None

            def insert(self, row):
                self.pending = dict(row)
                self.rows.append(self.pending)
                return self

            def execute(self):
                for column in ("triage_tier", "triage_label", "triage_action", "triage_reason", "vital_signs"):
                    if column in self.pending:
                        raise RuntimeError(f"column check_ins.{column} does not exist")
                return None

        table = FakeInsertTable()
        client = type("FakeClient", (), {"table": lambda self, name: table})()
        with patch.object(api.patient_history, "is_configured", return_value=True), \
             patch.object(api.patient_history, "get_client", return_value=client):
            api.patient_history.append(
                "legacy-patient",
                metrics={"facial_asymmetry_score": 0.02, "voice_jitter": 0.01, "response_latency_ms": 900},
                risk={"risk_score": 0.1, "risk_level": "low", "flags": []},
                face_analysis={"method": "pose_corrected_v2", "sample_count": 3},
                wellness={"answers": ANSWERS},
                vital_signs=VITALS,
            )

        stored_row = table.rows[-1]
        self.assertEqual(len(table.rows), 6)
        self.assertNotIn("vital_signs", stored_row)
        self.assertEqual(stored_row["wellness"][api.patient_history.EMBEDDED_VITALS_KEY]["heart_rate_bpm"], 72)
        stored = {**stored_row, "created_at": "2026-09-19T12:00:00+00:00"}
        restored = api.patient_history._to_history_entry(stored)
        self.assertEqual(restored["vital_signs"]["breathing_rate_bpm"], 15)
        self.assertNotIn(api.patient_history.EMBEDDED_VITALS_KEY, restored["wellness"])


if __name__ == "__main__":
    unittest.main()
