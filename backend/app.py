"""
NeuroTriage-Home backend — hackathon starter.

Endpoints (auth: see auth.py -- Authorization: Bearer <supabase access token>):
  POST /api/checkin/face/preview -> [any logged-in user] transient landmark tracking, nothing persisted
  POST /api/checkin/face       -> [patient] analyze a short burst, store facial asymmetry metrics
  POST /api/checkin/wellness/plan -> [any logged-in user] adaptive sleep, symptoms, and mood questions
  POST /api/checkin/voice      -> [patient] receive ElevenLabs agent output (transcript + latency), return voice metrics
  POST /api/checkin/submit     -> [patient] combine face + voice metrics for a check-in, score risk, log to dashboard
  GET  /api/dashboard/:patient -> [clinician] get trend history + latest risk for a patient
  GET  /api/audit-log          -> [clinician] clinician access log
  GET  /api/patients           -> [clinician] list patients, for the dashboard's patient picker
  POST /api/profile            -> [public] create a profile row right after signup (pre-confirmation)

Run:
  pip install -r requirements.txt
  python app.py
  (serves on http://localhost:5001)

NOTE ON PRIVACY / HIPAA-principles boundary:
  - Raw frames/audio are processed in-memory and discarded. Nothing in
    this file writes raw image or audio bytes to disk, to Supabase, or
    anywhere else.
  - Only numeric derived metrics and structured wellbeing responses
    ever get stored, in the Supabase check_ins table (see
    ../database/patient_history.py). The raw patient_id is stored
    there too (needed to look up a patient's own trend), but only the
    HASHED version ever leaves via telemetry payloads / FHIR
    observations (see anomaly_scoring.py's _hash_patient_id) — images
    and landmark coordinates never enter patient history at all.
  - SUPABASE_URL and SUPABASE_KEY are required by the authenticated app.
    The history modules retain an in-memory fallback for isolated tests, but
    normal API requests verify users against Supabase Auth first.
    See ../database/.env.example and ../database/db.py.
"""

import os
import sys
import math
from flask import Flask, request, jsonify, g
from flask_cors import CORS

# database/ is a sibling of backend/, not a package under it — add it
# to sys.path so `import db` / `import patient_history` etc. resolve,
# the same way this directory is implicitly on sys.path for the
# cv_analysis/anomaly_scoring imports below.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "database"))

from cv_analysis import score_from_base64_image, score_from_base64_images
from wellness import evaluate_wellness
from anomaly_scoring import (
    CheckInMetrics,
    compute_risk_score,
    build_telemetry_payload,
    build_fhir_shaped_observation,
)
from audit_log import audit_log
from db import get_client, is_configured as database_is_configured
from auth import require_auth, require_role
import patient_history

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024
CORS(app)  # loosen for local dev; tighten origin before any real deploy

# Temporary per-checkin cache so the /face and /voice steps can be
# combined before final scoring, without writing raw data to disk or
# to Supabase until both halves of a check-in are in.
PENDING_CHECKINS = {}


def _validated_vital_signs(value):
    """Validate browser-derived estimates before storing numeric results."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("vital_signs must be an object")

    def number(name, minimum, maximum):
        item = value.get(name)
        if isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item):
            raise ValueError(f"{name} must be a finite number")
        if not minimum <= item <= maximum:
            raise ValueError(f"{name} is outside the supported camera-estimate range")
        return round(float(item), 1)

    method = value.get("method")
    if method not in {"camera_rppg_pos_v1", "camera_rppg_pos_v2"}:
        raise ValueError("Unsupported camera vital-sign method")

    return {
        "heart_rate_bpm": number("heart_rate_bpm", 35, 220),
        "breathing_rate_bpm": number("breathing_rate_bpm", 4, 60),
        "duration_seconds": number("duration_seconds", 20, 90),
        "sample_count": int(number("sample_count", 160, 3000)),
        "method": method,
    }


@app.route("/api/checkin/face/preview", methods=["POST"])
@require_auth
def preview_face():
    """Transient tracking only: frames and landmarks never enter patient history."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not data.get("image_b64"):
        return jsonify({"error": "image_b64 required"}), 400
    try:
        result = score_from_base64_image(data["image_b64"])
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(result)


@app.route("/api/checkin/wellness/plan", methods=["POST"])
@require_auth
def wellness_plan():
    """Choose follow-ups without persisting unfinished questionnaire answers."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not isinstance(data.get("answers"), dict):
        return jsonify({"error": "answers must be an object"}), 400
    try:
        return jsonify(evaluate_wellness(data["answers"]))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400


@app.route("/api/checkin/face", methods=["POST"])
@require_role("patient")
def checkin_face():
    """
    Accept one legacy image_b64 or 3–5 images_b64 for a median capture.
    Only derived measurements enter the pending cache, never landmarks/images.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "JSON object required"}), 400
    # patient_id is always the authenticated caller -- any patient_id the
    # client sends in the body is ignored, not merged in, so there is
    # exactly one source of truth for whose data this is.
    patient_id = g.user_id
    image_b64 = data.get("image_b64")

    # A failed retake must not silently reuse an earlier accepted capture.
    PENDING_CHECKINS.get(patient_id, {}).pop("face", None)
    try:
        vital_signs = _validated_vital_signs(data.get("vital_signs"))
        if "images_b64" in data:
            result = score_from_base64_images(data["images_b64"])
        else:
            result = score_from_base64_image(image_b64)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    if not result["quality"]["acceptable"] or result["asymmetry_score"] is None:
        return jsonify({**result, "error": result["quality"]["message"]}), 422
    PENDING_CHECKINS.setdefault(patient_id, {})["face"] = {
        key: result[key]
        for key in ("asymmetry_score", "pair_deltas", "sample_count", "method")
    }
    PENDING_CHECKINS[patient_id]["face"]["vital_signs"] = vital_signs
    result["vital_signs"] = vital_signs
    return jsonify(result)


@app.route("/api/checkin/voice", methods=["POST"])
@require_role("patient")
def checkin_voice():
    """
    Body from your ElevenLabs Conversational AI agent (adapt field
    names to whatever their webhook/post-call payload actually sends —
    check ElevenLabs' Conversational AI docs for the exact schema).

    Expected fields for this MVP:
      response_latency_ms: float   # time between prompt end and patient response start
      voice_jitter: float          # if you run Parselmouth on the audio server-side;
                                    # otherwise stub this with a placeholder value for
                                    # the demo and say so explicitly
      transcript: str              # optional, for phoneme_slur / fluency scoring later
    """
    data = request.get_json(force=True)
    patient_id = g.user_id

    voice_metrics = {
        "response_latency_ms": data.get("response_latency_ms"),
        "voice_jitter": data.get("voice_jitter"),
        # transcript is NOT persisted past this request — only derived
        # numeric metrics get stored, per the de-identification boundary.
    }

    PENDING_CHECKINS.setdefault(patient_id, {})["voice"] = voice_metrics
    return jsonify(voice_metrics)


@app.route("/api/checkin/submit", methods=["POST"])
@require_role("patient")
def submit_checkin():
    """
    Call this after both /face and /voice have run for a patient in
    this session. Combines the two, scores risk, stores only the
    derived metrics + hashed telemetry, and clears the pending cache
    (so raw-ish intermediate data doesn't linger).
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "JSON object required"}), 400
    patient_id = g.user_id

    if patient_id not in PENDING_CHECKINS:
        return jsonify({"error": "no pending face/voice data for this patient_id"}), 400

    pending = PENDING_CHECKINS[patient_id]
    face = pending.get("face", {})
    voice = pending.get("voice", {})
    if face.get("asymmetry_score") is None or "voice" not in pending:
        return jsonify({"error": "Complete a valid face capture and voice step first"}), 400
    wellness = None
    if "wellness" in data:
        try:
            wellness = evaluate_wellness(data["wellness"], require_complete=True)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        if wellness["urgent"]:
            return jsonify({"error": "Seek urgent help for sudden new symptoms; do not wait for this check-in."}), 422

    metrics = CheckInMetrics(
        patient_id=patient_id,
        facial_asymmetry_score=face.get("asymmetry_score"),
        voice_jitter=voice.get("voice_jitter"),
        response_latency_ms=voice.get("response_latency_ms"),
    )

    try:
        prior_history = patient_history.history_for(patient_id)
        baseline = patient_history.latest_metrics_for(patient_id)
    except Exception:
        app.logger.exception("Could not read patient history")
        return jsonify({
            "error": "Patient-history storage is unavailable. Check the Supabase settings and rerun database/schema.sql, then try again."
        }), 503

    risk = compute_risk_score(metrics, baseline, prior_history)
    telemetry = build_telemetry_payload(metrics, risk)
    fhir_observation = build_fhir_shaped_observation(telemetry)

    vital_signs = face.get("vital_signs")
    face_analysis = {"method": face["method"], "sample_count": face["sample_count"]}
    try:
        patient_history.append(
            patient_id,
            metrics={
                "facial_asymmetry_score": metrics.facial_asymmetry_score,
                "voice_jitter": metrics.voice_jitter,
                "response_latency_ms": metrics.response_latency_ms,
            },
            risk=risk,
            face_analysis=face_analysis,
            wellness=wellness,
            vital_signs=vital_signs,
        )
    except Exception:
        app.logger.exception("Could not save patient history")
        return jsonify({
            "error": "The check-in could not be saved. Check the Supabase settings and rerun database/schema.sql, then try again."
        }), 503
    PENDING_CHECKINS.pop(patient_id, None)

    return jsonify({
        "risk": risk,
        "wellness": wellness,
        "face_analysis": face_analysis,
        "vital_signs": vital_signs,
        "telemetry_payload": telemetry,       # what actually gets transmitted (de-identified)
        "fhir_shaped_observation": fhir_observation,  # for your architecture slide/demo
    })


@app.route("/api/dashboard/<patient_id>", methods=["GET"])
@require_role("clinician")
def dashboard(patient_id):
    """Clinician-facing trend view for a patient the clinician picks (see /api/patients)."""
    audit_log.log(g.user_id, "view_patient_record", target_patient_hash=patient_id)

    history = patient_history.history_for(patient_id)
    return jsonify({"patient_id": patient_id, "history": history})


@app.route("/api/audit-log", methods=["GET"])
@require_role("clinician")
def get_audit_log():
    return jsonify(audit_log.all_entries())


@app.route("/api/patients", methods=["GET"])
@require_role("clinician")
def list_patients():
    """Backs the clinician dashboard's patient picker."""
    if getattr(g, "demo_mode", False):
        return jsonify([{"patient_id": "demo-patient-001", "display_name": "Demo Patient"}])
    result = (
        get_client()
        .table("profiles")
        .select("id, display_name")
        .eq("role", "patient")
        .order("display_name")
        .execute()
    )
    return jsonify([{"patient_id": r["id"], "display_name": r["display_name"]} for r in result.data])


@app.route("/api/profile", methods=["POST"])
def create_profile():
    """
    Called by the frontend immediately after supabase.auth.signUp()
    succeeds, BEFORE the account has an active session -- email
    confirmation is required (standard flow), so there's no session yet
    for a client-side RLS-gated insert to work against. Uses the
    service_role client to bypass RLS, which is safe because this only
    ever creates a brand-new profile row (the primary key blocks
    overwriting an existing one) and verifies the user_id is a real,
    just-created Supabase Auth user before inserting.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "JSON object required"}), 400
    user_id = data.get("user_id")
    role = data.get("role")
    display_name = data.get("display_name")
    if not isinstance(user_id, str) or not user_id.strip():
        return jsonify({"error": "user_id required"}), 400
    if role not in ("patient", "clinician"):
        return jsonify({"error": "role must be 'patient' or 'clinician'"}), 400
    if not isinstance(display_name, str) or not display_name.strip():
        return jsonify({"error": "display_name required"}), 400

    try:
        get_client().auth.admin.get_user_by_id(user_id)
    except Exception:
        return jsonify({"error": "No such Supabase Auth user"}), 404

    try:
        get_client().table("profiles").insert({
            "id": user_id, "role": role, "display_name": display_name.strip(),
        }).execute()
    except Exception:
        return jsonify({"error": "Profile already exists for this account"}), 409

    return jsonify({"id": user_id, "role": role, "display_name": display_name.strip()}), 201


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "storage": "supabase" if database_is_configured() else "memory"})


if __name__ == "__main__":
    debug_enabled = os.environ.get("FLASK_DEBUG", "").lower() in {"1", "true", "yes"}
    app.run(
        host=os.environ.get("FLASK_HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "5001")),
        debug=debug_enabled,
        use_reloader=debug_enabled,
    )
