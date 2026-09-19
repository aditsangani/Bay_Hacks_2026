"""
Patient check-in history, persisted in Supabase (table: check_ins) when
configured, with a process-local fallback for zero-config development.

Replaces the old in-memory PATIENT_HISTORY dict in app.py — history now
survives server restarts. Still demo-scale: no auth beyond the backend
holding the service_role key, and patient_id is stored as given by the
client (the raw ID never leaves this layer — see anomaly_scoring.py's
_hash_patient_id for what actually goes out in telemetry payloads).
"""

from datetime import datetime, timezone
from threading import Lock

from db import get_client, is_configured

TABLE = "check_ins"
EMBEDDED_VITALS_KEY = "_camera_vital_signs"
_LOCAL_ROWS = {}
_LOCAL_LOCK = Lock()
_OPTIONAL_COLUMNS = {
    "triage_tier",
    "triage_label",
    "triage_action",
    "triage_reason",
    "vital_signs",
}


def _missing_optional_column(exc: Exception) -> str | None:
    message = str(exc).lower()
    if "does not exist" not in message and "schema cache" not in message:
        return None
    for column in _OPTIONAL_COLUMNS:
        if column in message:
            return column
    # Compatibility with the short-lived per-column camera schema.
    if "estimated_heart_rate_bpm" in message or "estimated_breathing_rate_bpm" in message:
        return "vital_signs"
    return None


def _embed_vital_signs(wellness: dict | None, vital_signs: dict | None) -> dict | None:
    if not vital_signs:
        return wellness
    payload = dict(wellness or {})
    payload[EMBEDDED_VITALS_KEY] = dict(vital_signs)
    return payload


def append(
    patient_id: str,
    metrics: dict,
    risk: dict,
    face_analysis: dict = None,
    wellness: dict = None,
    vital_signs: dict = None,
):
    row = {
        "patient_id": patient_id,
        "facial_asymmetry_score": metrics.get("facial_asymmetry_score"),
        "voice_jitter": metrics.get("voice_jitter"),
        "response_latency_ms": metrics.get("response_latency_ms"),
        "risk_score": risk.get("risk_score"),
        "risk_level": risk.get("risk_level"),
        "flags": risk.get("flags", []),
        "triage_tier": risk.get("triage", {}).get("tier"),
        "triage_label": risk.get("triage", {}).get("label"),
        "triage_action": risk.get("triage", {}).get("action"),
        "triage_reason": risk.get("triage", {}).get("reason"),
        "face_method": (face_analysis or {}).get("method"),
        "face_sample_count": (face_analysis or {}).get("sample_count"),
        "wellness": wellness,
        "vital_signs": vital_signs,
    }
    if not is_configured():
        row["created_at"] = datetime.now(timezone.utc).isoformat()
        with _LOCAL_LOCK:
            _LOCAL_ROWS.setdefault(patient_id, []).append(row)
        return

    # Older team databases may not have every newly introduced optional
    # column yet. Retry only for an explicitly reported missing optional
    # column; authentication, network, and other database errors still fail.
    candidate = dict(row)
    for _ in range(len(_OPTIONAL_COLUMNS) + 1):
        try:
            get_client().table(TABLE).insert(candidate).execute()
            return
        except Exception as exc:
            missing = _missing_optional_column(exc)
            if not missing or missing not in candidate:
                raise
            if missing == "vital_signs":
                candidate["wellness"] = _embed_vital_signs(wellness, vital_signs)
            candidate.pop(missing)
    raise RuntimeError("Could not find a compatible check_ins schema")


def history_for(patient_id: str):
    if not is_configured():
        with _LOCAL_LOCK:
            rows = [dict(row) for row in _LOCAL_ROWS.get(patient_id, [])]
        return [_to_history_entry(row) for row in rows]
    result = (
        get_client()
        .table(TABLE)
        .select("*")
        .eq("patient_id", patient_id)
        .order("created_at", desc=False)
        .execute()
    )
    return [_to_history_entry(row) for row in result.data]


def latest_metrics_for(patient_id: str):
    """Most recent check-in's facial asymmetry score, used as the
    baseline comparison in compute_risk_score. None on a first-ever
    check-in."""
    if not is_configured():
        with _LOCAL_LOCK:
            rows = list(_LOCAL_ROWS.get(patient_id, []))
        return {"facial_asymmetry_score": rows[-1]["facial_asymmetry_score"]} if rows else None
    result = (
        get_client()
        .table(TABLE)
        .select("facial_asymmetry_score")
        .eq("patient_id", patient_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not result.data:
        return None
    return {"facial_asymmetry_score": result.data[0]["facial_asymmetry_score"]}


def _to_history_entry(row: dict) -> dict:
    wellness = row.get("wellness")
    vital_signs = row.get("vital_signs") or ((wellness or {}).get(EMBEDDED_VITALS_KEY) if isinstance(wellness, dict) else None)
    if isinstance(wellness, dict):
        wellness = {key: value for key, value in wellness.items() if key != EMBEDDED_VITALS_KEY} or None
    return {
        "metrics": {
            "facial_asymmetry_score": row["facial_asymmetry_score"],
            "voice_jitter": row["voice_jitter"],
            "response_latency_ms": row["response_latency_ms"],
        },
        "risk": {
            "risk_score": row["risk_score"],
            "risk_level": row["risk_level"],
            "flags": row.get("flags") or [],
            "triage": {
                "tier": row.get("triage_tier") or 1,
                "label": row.get("triage_label") or "Stable",
                "color": {1: "green", 2: "amber", 3: "red"}.get(row.get("triage_tier") or 1, "green"),
                "action": row.get("triage_action") or "Schedule standard next morning check-in.",
                "reason": row.get("triage_reason") or "Metrics are within normal variance for routine monitoring.",
            },
        },
        "face_analysis": {
            "method": row.get("face_method"),
            "sample_count": row.get("face_sample_count"),
        },
        "wellness": wellness,
        "vital_signs": vital_signs,
        "timestamp": _to_epoch(row["created_at"]),
    }


def _to_epoch(iso_ts: str) -> float:
    return datetime.fromisoformat(iso_ts.replace("Z", "+00:00")).timestamp()
