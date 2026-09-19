"""
Auth/authorization helpers for Flask routes, backed by Supabase Auth.

Verifies the bearer token via a network round-trip to Supabase
(Client.auth.get_user) rather than decoding the JWT locally, so no new
dependency (PyJWT) or extra secret (the project's JWT signing secret)
is needed -- supabase>=2.10.0 is already a dependency (see db.py). This
costs one extra HTTP round-trip per authenticated request, an
acceptable trade at hackathon scale; swap to local JWT verification
first if this ever needs to scale.
"""

import os
from functools import wraps
from pathlib import Path

from dotenv import load_dotenv
from flask import request, jsonify, g

from db import get_client

load_dotenv(Path(__file__).resolve().parent / ".env")

DEMO_AUTH_ENABLED = os.environ.get("ALLOW_DEMO_AUTH", "").lower() in {"1", "true", "yes"}
DEMO_IDENTITIES = {
    "demo-patient-token": ("demo-patient-001", "patient", "Demo Patient"),
    "demo-clinician-token": ("demo-clinician-001", "clinician", "Demo Clinician"),
}


def _extract_bearer_token():
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    return header[len("Bearer "):].strip() or None


def require_auth(fn):
    """
    Verifies the Authorization: Bearer <token> header against Supabase
    and looks up the caller's role. On success, attaches to flask.g:
      g.user_id       -> str, the Supabase auth.users.id (uuid string)
      g.role          -> str, 'patient' | 'clinician'
      g.display_name  -> str
    On failure, returns 401/403 with {"error": "..."} and does not call fn.
    """
    @wraps(fn)
    def wrapper(*args, **kwargs):
        token = _extract_bearer_token()
        if not token:
            return jsonify({"error": "Missing or malformed Authorization header"}), 401
        if DEMO_AUTH_ENABLED and token in DEMO_IDENTITIES:
            g.user_id, g.role, g.display_name = DEMO_IDENTITIES[token]
            g.demo_mode = True
            return fn(*args, **kwargs)
        try:
            auth_response = get_client().auth.get_user(token)
        except Exception:
            return jsonify({"error": "Invalid or expired token"}), 401
        user = getattr(auth_response, "user", None)
        if user is None:
            return jsonify({"error": "Invalid or expired token"}), 401

        profile = (
            get_client()
            .table("profiles")
            .select("role, display_name")
            .eq("id", user.id)
            .limit(1)
            .execute()
        )
        if not profile.data:
            return jsonify({"error": "No profile found for this account"}), 403

        g.user_id = user.id
        g.role = profile.data[0]["role"]
        g.display_name = profile.data[0]["display_name"]
        g.demo_mode = False
        return fn(*args, **kwargs)
    return wrapper


def require_role(role):
    """Stacks on require_auth, additionally requiring g.role == role."""
    def decorator(fn):
        @wraps(fn)
        @require_auth
        def wrapper(*args, **kwargs):
            if g.role != role:
                return jsonify({"error": f"Requires role '{role}'"}), 403
            return fn(*args, **kwargs)
        return wrapper
    return decorator
