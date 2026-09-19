"""
NeuroTriage-Home backend — hackathon starter.

Endpoints:
  POST /api/checkin/face/preview -> transient landmark tracking, nothing persisted
  POST /api/checkin/face       -> analyze a short burst, store facial asymmetry metrics
  POST /api/checkin/wellness/plan -> adaptive sleep, symptoms, and mood questions
  POST /api/checkin/voice      -> receive ElevenLabs agent output (transcript + latency), return voice metrics
  POST /api/checkin/submit     -> combine face + voice metrics for a check-in, score risk, log to dashboard
  GET  /api/dashboard/:patient -> get trend history + latest risk for a patient (clinician view)
  GET  /api/audit-log          -> mock clinician access log

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
  - SUPABASE_URL and SUPABASE_KEY enable durable storage. Without them,
    local development uses process-memory history that clears on restart.
    See ../database/.env.example and ../database/db.py.
"""

import os
import sys
import math
from flask import Flask, request, jsonify
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
from db import is_configured as database_is_configured
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
def checkin_face():
    """
    Accept one legacy image_b64 or 3–5 images_b64 for a median capture.
    Only derived measurements enter the pending cache, never landmarks/images.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "JSON object required"}), 400
    patient_id = data.get("patient_id")
    image_b64 = data.get("image_b64")

    if not isinstance(patient_id, str) or not patient_id.strip():
        return jsonify({"error": "patient_id required"}), 400
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
def checkin_voice():
    """
    Body from your ElevenLabs Conversational AI agent (adapt field
    names to whatever their webhook/post-call payload actually sends —
    check ElevenLabs' Conversational AI docs for the exact schema).

    Expected fields for this MVP:
      patient_id: str
      response_latency_ms: float   # time between prompt end and patient response start
      voice_jitter: float          # if you run Parselmouth on the audio server-side;
                                    # otherwise stub this with a placeholder value for
                                    # the demo and say so explicitly
      transcript: str              # optional, for phoneme_slur / fluency scoring later
    """
    data = request.get_json(force=True)
    patient_id = data.get("patient_id")

    if not patient_id:
        return jsonify({"error": "patient_id required"}), 400

    voice_metrics = {
        "response_latency_ms": data.get("response_latency_ms"),
        "voice_jitter": data.get("voice_jitter"),
        # transcript is NOT persisted past this request — only derived
        # numeric metrics get stored, per the de-identification boundary.
    }

    PENDING_CHECKINS.setdefault(patient_id, {})["voice"] = voice_metrics
    return jsonify(voice_metrics)


@app.route("/api/checkin/submit", methods=["POST"])
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
    patient_id = data.get("patient_id")

    if not isinstance(patient_id, str) or patient_id not in PENDING_CHECKINS:
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
        baseline = patient_history.latest_metrics_for(patient_id)
    except Exception:
        app.logger.exception("Could not read patient history")
        return jsonify({
            "error": "Patient-history storage is unavailable. Check the Supabase settings and rerun database/schema.sql, then try again."
        }), 503

    risk = compute_risk_score(metrics, baseline)
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
def dashboard(patient_id):
    """
    Clinician-facing trend view. In a real build this route would sit
    behind auth; for the demo, call audit_log.log(...) here to show
    the mock audit trail working.
    """
    clinician_id = request.args.get("clinician_id", "demo-clinician")
    audit_log.log(clinician_id, "view_patient_record", target_patient_hash=patient_id)

    history = patient_history.history_for(patient_id)
    return jsonify({"patient_id": patient_id, "history": history})


@app.route("/api/audit-log", methods=["GET"])
def get_audit_log():
    return jsonify(audit_log.all_entries())


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "storage": "supabase" if database_is_configured() else "memory"})


if __name__ == "__main__":
    app.run(debug=True, port=5001)
