"""Tests for GET /api/patients (clinician-only) and POST /api/profile (public,
used right after signup before the account has an active session)."""

import unittest
from unittest.mock import patch

import app as api
import auth as api_auth

AUTH_HEADERS = {
    "patient": {"Authorization": "Bearer test-patient:patient"},
    "clinician": {"Authorization": "Bearer test-clinician:clinician"},
}


class FakeProfilesTable:
    """Covers the three query shapes actually used against this table:
    role-lookup-by-id (auth.require_auth), role='patient' listing
    (list_patients), and insert (create_profile)."""

    def __init__(self, client):
        self._client = client
        self._eq_filters = {}
        self._insert_row = None

    def select(self, *a, **k):
        return self

    def eq(self, column, value):
        self._eq_filters[column] = value
        return self

    def limit(self, n):
        return self

    def order(self, *a, **k):
        return self

    def insert(self, row):
        self._insert_row = row
        return self

    def execute(self):
        c = self._client
        if self._insert_row is not None:
            row = self._insert_row
            if row["id"] in c.existing_profile_ids:
                raise RuntimeError("duplicate key value violates unique constraint")
            c.existing_profile_ids.add(row["id"])
            c.insert_calls.append(row)
            return type("R", (), {"data": [row]})()
        if "id" in self._eq_filters:
            role = c.role_by_user_id.get(self._eq_filters["id"])
            data = [{"role": role, "display_name": self._eq_filters["id"]}] if role else []
            return type("R", (), {"data": data})()
        if self._eq_filters.get("role") == "patient":
            return type("R", (), {"data": list(c.patients)})()
        return type("R", (), {"data": []})()


class FakeAuthClient:
    def __init__(self, auth_user_ids=None, existing_profile_ids=None, patients=None):
        self.auth = self
        self.admin = self
        self.role_by_user_id = {}
        self.auth_user_ids = set(auth_user_ids or [])
        self.existing_profile_ids = set(existing_profile_ids or [])
        self.patients = patients or []
        self.insert_calls = []
        self.created_emails = set()
        self.deleted_user_ids = []

    def get_user(self, token):
        if not token or ":" not in token:
            raise ValueError("malformed fake token")
        user_id, _, role = token.partition(":")
        self.role_by_user_id[user_id] = role
        return type("Resp", (), {"user": type("U", (), {"id": user_id})()})()

    def create_user(self, attrs):
        if attrs["email"] in self.created_emails:
            raise ValueError("already registered")
        self.created_emails.add(attrs["email"])
        self.auth_user_ids.add("created-user")
        return type("Resp", (), {"user": type("U", (), {"id": "created-user"})()})()

    def delete_user(self, user_id):
        self.deleted_user_ids.append(user_id)

    def get_user_by_id(self, user_id):
        if user_id not in self.auth_user_ids:
            raise ValueError("no such Supabase Auth user")
        return type("Resp", (), {})()

    def table(self, name):
        assert name == "profiles"
        return FakeProfilesTable(self)


class PatientsEndpointTests(unittest.TestCase):
    def setUp(self):
        self.fake_client = FakeAuthClient(
            patients=[{"id": "p1", "display_name": "Alice"}, {"id": "p2", "display_name": "Bob"}],
        )
        # app.py and auth.py each did their own `from db import get_client`,
        # so both module-level bindings need patching independently.
        for module in (api_auth, api):
            patcher = patch.object(module, "get_client", lambda: self.fake_client)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.client = api.app.test_client()

    def test_clinician_can_list_patients(self):
        response = self.client.get("/api/patients", headers=AUTH_HEADERS["clinician"])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json), 2)

    def test_patient_cannot_list_patients(self):
        response = self.client.get("/api/patients", headers=AUTH_HEADERS["patient"])
        self.assertEqual(response.status_code, 403)

    def test_no_token_cannot_list_patients(self):
        response = self.client.get("/api/patients")
        self.assertEqual(response.status_code, 401)

    def test_local_demo_clinician_gets_demo_patient(self):
        with patch.object(api_auth, "DEMO_AUTH_ENABLED", True):
            response = self.client.get(
                "/api/patients",
                headers={"Authorization": "Bearer demo-clinician-token"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, [{"patient_id": "demo-patient-001", "display_name": "Demo Patient"}])


class ProfileEndpointTests(unittest.TestCase):
    def setUp(self):
        self.fake_client = FakeAuthClient(auth_user_ids={"new-user"})
        for module in (api_auth, api):
            patcher = patch.object(module, "get_client", lambda: self.fake_client)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.client = api.app.test_client()

    def test_creates_profile_for_a_real_new_user(self):
        response = self.client.post("/api/profile", json={
            "user_id": "new-user", "role": "patient", "display_name": "New Patient",
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.fake_client.insert_calls[0]["role"], "patient")

    def test_unknown_user_id_returns_404(self):
        response = self.client.post("/api/profile", json={
            "user_id": "ghost", "role": "patient", "display_name": "Nobody",
        })
        self.assertEqual(response.status_code, 404)

    def test_duplicate_profile_returns_409(self):
        first = self.client.post("/api/profile", json={
            "user_id": "new-user", "role": "patient", "display_name": "New Patient",
        })
        self.assertEqual(first.status_code, 201)
        second = self.client.post("/api/profile", json={
            "user_id": "new-user", "role": "patient", "display_name": "New Patient",
        })
        self.assertEqual(second.status_code, 409)

    def test_invalid_role_returns_400(self):
        response = self.client.post("/api/profile", json={
            "user_id": "new-user", "role": "admin", "display_name": "New Patient",
        })
        self.assertEqual(response.status_code, 400)


class SignupEndpointTests(unittest.TestCase):
    BODY = {"email": "new@example.com", "password": "secret1", "role": "patient", "display_name": "New"}

    def setUp(self):
        self.fake_client = FakeAuthClient()
        for module in (api_auth, api):
            patcher = patch.object(module, "get_client", lambda: self.fake_client)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.client = api.app.test_client()

    def enabled(self):
        return patch.object(api, "AUTO_CONFIRM_SIGNUP", True)

    def test_disabled_by_default(self):
        self.assertEqual(self.client.post("/api/signup", json=self.BODY).status_code, 404)

    def test_creates_confirmed_user_and_profile(self):
        with self.enabled():
            response = self.client.post("/api/signup", json=self.BODY)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.fake_client.insert_calls[0]["role"], "patient")

    def test_duplicate_email_returns_409(self):
        with self.enabled():
            self.client.post("/api/signup", json=self.BODY)
            response = self.client.post("/api/signup", json=self.BODY)
        self.assertEqual(response.status_code, 409)

    def test_short_password_or_bad_role_returns_400(self):
        with self.enabled():
            short = self.client.post("/api/signup", json={**self.BODY, "password": "abc"})
            role = self.client.post("/api/signup", json={**self.BODY, "role": "admin"})
        self.assertEqual(short.status_code, 400)
        self.assertEqual(role.status_code, 400)

    def test_profile_failure_rolls_back_the_auth_user(self):
        self.fake_client.existing_profile_ids.add("created-user")
        with self.enabled():
            response = self.client.post("/api/signup", json=self.BODY)
        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.fake_client.deleted_user_ids, ["created-user"])


if __name__ == "__main__":
    unittest.main()
