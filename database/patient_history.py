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


def append(patient_id: str, metrics: dict, risk: dict):
    row = {
        "patient_id": patient_id,
        "facial_asymmetry_score": metrics.get("facial_asymmetry_score"),
        "voice_jitter": metrics.get("voice_jitter"),
        "response_latency_ms": metrics.get("response_latency_ms"),
        "risk_score": risk.get("risk_score"),
        "risk_level": risk.get("risk_level"),
        "flags": risk.get("flags", []),
    }
    get_client().table(TABLE).insert(row).execute()


def history_for(patient_id: str):
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
        },
        "timestamp": _to_epoch(row["created_at"]),
    }


def _to_epoch(iso_ts: str) -> float:
    return datetime.fromisoformat(iso_ts.replace("Z", "+00:00")).timestamp()
