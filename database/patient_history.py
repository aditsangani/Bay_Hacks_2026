"""
Patient check-in history, persisted in Supabase (table: check_ins).

Replaces the old in-memory PATIENT_HISTORY dict in app.py — history now
survives server restarts. Still demo-scale: no auth beyond the backend
holding the service_role key, and patient_id is stored as given by the
client (the raw ID never leaves this layer — see anomaly_scoring.py's
_hash_patient_id for what actually goes out in telemetry payloads).
"""

from datetime import datetime

from db import get_client

TABLE = "check_ins"
EMBEDDED_VITALS_KEY = "_camera_vital_signs"
_LOCAL_ROWS = {}


def is_configured() -> bool:
    from db import is_configured as database_is_configured
    return database_is_configured()


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
        "face_method": (face_analysis or {}).get("method"),
        "face_sample_count": (face_analysis or {}).get("sample_count"),
        "wellness": wellness,
        "vital_signs": vital_signs,
    }
    if not is_configured():
        _LOCAL_ROWS.setdefault(patient_id, []).append({**row, "created_at": datetime.utcnow().isoformat() + "+00:00"})
        return
    try:
        get_client().table(TABLE).insert(row).execute()
    except Exception as exc:
        if vital_signs and "column check_ins.estimated_heart_rate_bpm does not exist" in str(exc):
            row.pop("vital_signs", None)
            row["wellness"] = {**(wellness or {}), EMBEDDED_VITALS_KEY: vital_signs}
            get_client().table(TABLE).insert(row).execute()
        else:
            raise


def history_for(patient_id: str):
    if not is_configured():
        return [_to_history_entry(row) for row in _LOCAL_ROWS.get(patient_id, [])]
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
        rows = _LOCAL_ROWS.get(patient_id, [])
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
    vital_signs = row.get("vital_signs") or (wellness or {}).get(EMBEDDED_VITALS_KEY)
    if isinstance(wellness, dict):
        wellness = {key: value for key, value in wellness.items() if key != EMBEDDED_VITALS_KEY}
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
