"""
Mock immutable audit log for clinician access to patient records.

This is intentionally NOT a real tamper-proof log (that's a whole
infrastructure project). It's an in-memory append-only list that's
enough to demo the "Audit Logging" slide: timestamped clinician
sign-ins and record accesses. Say in your pitch that a production
version would use an actual append-only store (e.g. a write-once log
table or a service like AWS QLDB) — you don't need to build that part.
"""

import time
from dataclasses import dataclass, field
from typing import List


@dataclass
class AuditEntry:
    timestamp: float
    clinician_id: str
    action: str          # e.g. "sign_in", "view_patient_record", "view_alert"
    target_patient_hash: str = None


class MockAuditLog:
    def __init__(self):
        self._entries: List[AuditEntry] = []

    def log(self, clinician_id: str, action: str, target_patient_hash: str = None):
        entry = AuditEntry(
            timestamp=time.time(),
            clinician_id=clinician_id,
            action=action,
            target_patient_hash=target_patient_hash,
        )
        self._entries.append(entry)
        return entry

    def all_entries(self):
        # Return in reverse-chron order for a dashboard view
        return [
            {
                "timestamp": e.timestamp,
                "clinician_id": e.clinician_id,
                "action": e.action,
                "target_patient_hash": e.target_patient_hash,
            }
            for e in reversed(self._entries)
        ]


# Single shared instance for the demo backend
audit_log = MockAuditLog()
