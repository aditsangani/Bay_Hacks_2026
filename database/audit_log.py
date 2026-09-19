"""
Clinician audit log for access to patient records, persisted in Supabase
(table: audit_log) when configured, with a process-local development fallback.

This is intentionally NOT a tamper-proof/append-only-enforced log
(that's a whole infrastructure project) — it's a real Postgres table
with no update/delete calls anywhere in this codebase, which is enough
to demo the "Audit Logging" slide: timestamped clinician sign-ins and
record accesses that now actually survive a server restart. Say in
your pitch that a production version would enforce true immutability
(e.g. a write-once log table or a service like AWS QLDB).
"""

from datetime import datetime, timezone
from threading import Lock

from db import get_client, is_configured

TABLE = "audit_log"
_LOCAL_ENTRIES = []
_LOCAL_LOCK = Lock()


class SupabaseAuditLog:
    def log(self, clinician_id: str, action: str, target_patient_hash: str = None):
        row = {
            "clinician_id": clinician_id,
            "action": action,
            "target_patient_hash": target_patient_hash,
        }
        if not is_configured():
            row["created_at"] = datetime.now(timezone.utc).isoformat()
            with _LOCAL_LOCK:
                _LOCAL_ENTRIES.append(row)
            return
        get_client().table(TABLE).insert(row).execute()

    def all_entries(self):
        if not is_configured():
            with _LOCAL_LOCK:
                rows = [dict(row) for row in reversed(_LOCAL_ENTRIES)]
            return [
                {
                    "timestamp": _to_epoch(row["created_at"]),
                    "clinician_id": row["clinician_id"],
                    "action": row["action"],
                    "target_patient_hash": row.get("target_patient_hash"),
                }
                for row in rows
            ]

        result = (
            get_client()
            .table(TABLE)
            .select("*")
            .order("created_at", desc=True)
            .execute()
        )
        return [
            {
                "timestamp": _to_epoch(row["created_at"]),
                "clinician_id": row["clinician_id"],
                "action": row["action"],
                "target_patient_hash": row.get("target_patient_hash"),
            }
            for row in result.data
        ]


def _to_epoch(iso_ts: str) -> float:
    return datetime.fromisoformat(iso_ts.replace("Z", "+00:00")).timestamp()


# Single shared instance for the demo backend
audit_log = SupabaseAuditLog()
