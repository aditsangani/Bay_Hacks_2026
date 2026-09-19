"""
NeuroTriage-Home backend — hackathon starter.

Endpoints:
  POST /api/checkin/face       -> analyze one webcam frame, return facial asymmetry metrics
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
    this file writes raw image or audio bytes to disk or to the
    in-memory "database" below.
  - Only numeric derived metrics + a hashed patient ID ever get stored
    in PATIENT_HISTORY.
  - In-memory dict "DB" below is for demo purposes only — swap for a
    real DB before this goes anywhere near real patients.
"""

from flask import Flask, request, jsonify
from flask_cors import CORS

from cv_analysis import score_from_base64_image
from anomaly_scoring import (
    CheckInMetrics,
    compute_risk_score,
    build_telemetry_payload,
    build_fhir_shaped_observation,
)
from audit_log import audit_log

app = Flask(__name__)
CORS(app)  # loosen for local dev; tighten origin before any real deploy

# --- In-memory "DB" (demo only) ---
# Keyed by raw patient_id for convenience server-side; only the HASHED
# version of this ever leaves via telemetry payloads / FHIR observations.
PATIENT_HISTORY = {}
# Temporary per-checkin cache so the /face and /voice steps can be
# combined before final scoring, without writing raw data to disk.
PENDING_CHECKINS = {}


@app.route("/api/checkin/face", methods=["POST"])
def checkin_face():
    """
    Body: { "patient_id": str, "image_b64": str }
    image_b64 is a data URL from the browser's canvas.toDataURL().
    We process it in-memory and immediately discard the frame.
    """
    data = request.get_json(force=True)
    patient_id = data.get("patient_id")
    image_b64 = data.get("image_b64")

    if not patient_id or not image_b64:
        return jsonify({"error": "patient_id and image_b64 required"}), 400

    result = score_from_base64_image(image_b64)

    PENDING_CHECKINS.setdefault(patient_id, {})["face"] = result
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
    data = request.get_json(force=True)
    patient_id = data.get("patient_id")

    if not patient_id or patient_id not in PENDING_CHECKINS:
        return jsonify({"error": "no pending face/voice data for this patient_id"}), 400

    pending = PENDING_CHECKINS.pop(patient_id)
    face = pending.get("face", {})
    voice = pending.get("voice", {})

    metrics = CheckInMetrics(
        patient_id=patient_id,
        facial_asymmetry_score=face.get("asymmetry_score"),
        voice_jitter=voice.get("voice_jitter"),
        response_latency_ms=voice.get("response_latency_ms"),
    )

    history = PATIENT_HISTORY.get(patient_id, [])
    baseline = history[-1]["metrics"] if history else None

    risk = compute_risk_score(metrics, baseline)
    telemetry = build_telemetry_payload(metrics, risk)
    fhir_observation = build_fhir_shaped_observation(telemetry)

    history.append({
        "metrics": {
            "facial_asymmetry_score": metrics.facial_asymmetry_score,
            "voice_jitter": metrics.voice_jitter,
            "response_latency_ms": metrics.response_latency_ms,
        },
        "risk": risk,
        "timestamp": telemetry["timestamp"],
    })
    PATIENT_HISTORY[patient_id] = history

    return jsonify({
        "risk": risk,
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

    history = PATIENT_HISTORY.get(patient_id, [])
    return jsonify({"patient_id": patient_id, "history": history})


@app.route("/api/audit-log", methods=["GET"])
def get_audit_log():
    return jsonify(audit_log.all_entries())


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    app.run(debug=True, port=5001)
