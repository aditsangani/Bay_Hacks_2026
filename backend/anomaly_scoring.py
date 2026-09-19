"""
Combines facial asymmetry + speech/fluency metrics into a single
clinician-facing risk score, plus a FHIR-shaped (but not real-FHIR)
telemetry payload.

Design choices made explicit here (say these out loud in your demo):
  - Thresholds below are placeholders for demo purposes, clearly
    labeled as "clinician-configurable" rather than hardcoded medical
    fact. Do NOT present this as a validated clinical scoring system.
  - We do not cite FAST (acute stroke triage) criteria — this is a
    longitudinal trend-monitoring tool, not an acute assessment. See
    conversation notes.
  - Payloads are de-identified at the telemetry layer: only a hashed
    patient UUID, a timestamp, and numeric scores are ever sent to the
    "clinician alert" endpoint. The real patient-identity mapping
    lives in a separate, access-controlled table your auth layer
    would gate.
"""

import hashlib
import time
from dataclasses import dataclass, asdict
from typing import Optional


# --- Thresholds (clinician-configurable, NOT hardcoded medical fact) ---
FACIAL_ASYMMETRY_THRESHOLD = 0.015     # tune against baseline check-ins
SPEECH_JITTER_THRESHOLD = 0.02         # placeholder; real value from Parselmouth calibration
RESPONSE_LATENCY_THRESHOLD_MS = 2500   # slower-than-baseline response
TREND_WINDOW_DAYS = 5                  # how many check-ins to compare against baseline


@dataclass
class CheckInMetrics:
    patient_id: str  # raw ID — never sent past this layer un-hashed
    facial_asymmetry_score: Optional[float]
    voice_jitter: Optional[float]
    response_latency_ms: Optional[float]
    phoneme_slur_score: Optional[float] = None  # optional, if you get to it


def _hash_patient_id(patient_id: str) -> str:
    """
    De-identification boundary: anything downstream of this function
    (telemetry, alert payloads, logs) only ever sees this hash, never
    the raw patient_id. The raw ID <-> hash mapping lives in a separate
    access-controlled identity table, not in this payload.
    """
    return hashlib.sha256(patient_id.encode("utf-8")).hexdigest()[:16]


def compute_risk_score(metrics: CheckInMetrics, baseline: Optional[dict] = None) -> dict:
    """
    Simple weighted demo score using absolute thresholds. The baseline
    parameter is retained for callers, but is not used by this formula.
    Sleep and wellbeing answers do not modify this score.

    Returns a risk breakdown dict, not just a single number — showing
    your work here is what "sound data-to-insight pipeline" scores on
    in the judging rubric.
    """
    flags = []
    weighted_score = 0.0

    if metrics.facial_asymmetry_score is not None:
        if metrics.facial_asymmetry_score > FACIAL_ASYMMETRY_THRESHOLD:
            flags.append("facial_asymmetry_above_threshold")
            weighted_score += 0.45

    if metrics.voice_jitter is not None:
        if metrics.voice_jitter > SPEECH_JITTER_THRESHOLD:
            flags.append("voice_jitter_above_threshold")
            weighted_score += 0.35

    if metrics.response_latency_ms is not None:
        if metrics.response_latency_ms > RESPONSE_LATENCY_THRESHOLD_MS:
            flags.append("response_latency_elevated")
            weighted_score += 0.20

    risk_level = "low"
    if weighted_score >= 0.6:
        risk_level = "high"
    elif weighted_score >= 0.3:
        risk_level = "moderate"

    return {
        "risk_score": round(weighted_score, 3),
        "risk_level": risk_level,
        "flags": flags,
    }


def build_telemetry_payload(metrics: CheckInMetrics, risk: dict) -> dict:
    """
    This is the payload that would actually leave the device / hit the
    clinician-facing alert endpoint. Deliberately minimal — matches
    the "Safe Harbor de-identification" slide: timestamp, hashed
    patient UUID, numeric scores only. No name, no raw video/audio,
    no free-text.
    """
    return {
        "patient_hash": _hash_patient_id(metrics.patient_id),
        "timestamp": time.time(),
        "facial_asymmetry_score": metrics.facial_asymmetry_score,
        "voice_jitter": metrics.voice_jitter,
        "response_latency_ms": metrics.response_latency_ms,
        "risk_score": risk["risk_score"],
        "risk_level": risk["risk_level"],
        "flags": risk["flags"],
    }


def build_fhir_shaped_observation(telemetry_payload: dict) -> dict:
    """
    NOT a real FHIR resource — we are not validating against the FHIR
    spec in a 24-hour build. This is a JSON shape with FHIR-style field
    names so the architecture story ("designed for FHIR-compatible EHR
    integration") is honest and demonstrable, without burning hours on
    a real FHIR client. Say exactly that in your pitch.
    """
    return {
        "resourceType": "Observation",
        "status": "final",
        "code": {
            "text": "NeuroTriage-Home composite neuromuscular risk score"
        },
        "subject": {"reference": f"Patient/{telemetry_payload['patient_hash']}"},
        "effectiveDateTime": telemetry_payload["timestamp"],
        "valueQuantity": {
            "value": telemetry_payload["risk_score"],
            "unit": "composite-risk-index",
        },
        "component": [
            {"code": {"text": "facial_asymmetry_score"},
             "valueQuantity": {"value": telemetry_payload["facial_asymmetry_score"]}},
            {"code": {"text": "voice_jitter"},
             "valueQuantity": {"value": telemetry_payload["voice_jitter"]}},
            {"code": {"text": "response_latency_ms"},
             "valueQuantity": {"value": telemetry_payload["response_latency_ms"]}},
        ],
        "interpretation": [{"text": telemetry_payload["risk_level"]}],
        "note": [{"text": f"flags: {', '.join(telemetry_payload['flags']) or 'none'}"}],
    }
