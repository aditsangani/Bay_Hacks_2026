import React, { useEffect, useState } from 'react'

/**
 * Minimal clinician trend dashboard, accessible through the view toggle
 * in main.jsx. Switching to this view loads the latest check-in history.
 *
 * Every load of this component calls GET /api/dashboard/:patient_id,
 * which logs a mock audit entry server-side (see backend/audit_log.py).
 * Pull GET /api/audit-log to show that trail live in your demo.
 */

const PATIENT_ID = 'demo-patient-001'

export default function ClinicianDashboard() {
  const [history, setHistory] = useState([])
  const [auditEntries, setAuditEntries] = useState([])

  useEffect(() => {
    fetch(`/api/dashboard/${PATIENT_ID}?clinician_id=demo-clinician`)
      .then((r) => r.json())
      .then((d) => setHistory(d.history || []))

    fetch('/api/audit-log')
      .then((r) => r.json())
      .then(setAuditEntries)
  }, [])

  return (
    <div style={{ maxWidth: 700, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <h2>Clinician Dashboard — {PATIENT_ID}</h2>

      <h3>Risk trend</h3>
      {history.length === 0 && <p>No check-ins yet.</p>}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={cellStyle}>Timestamp</th>
            <th style={cellStyle}>Facial asymmetry</th>
            <th style={cellStyle}>Voice jitter</th>
            <th style={cellStyle}>Latency (ms)</th>
            <th style={cellStyle}>Risk level</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h, i) => (
            <tr key={i}>
              <td style={cellStyle}>{new Date(h.timestamp * 1000).toLocaleString()}</td>
              <td style={cellStyle}>{h.metrics.facial_asymmetry_score}</td>
              <td style={cellStyle}>{h.metrics.voice_jitter}</td>
              <td style={cellStyle}>{h.metrics.response_latency_ms}</td>
              <td style={cellStyle}>{h.risk.risk_level}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ marginTop: 32 }}>Mock audit log (clinician access)</h3>
      <ul>
        {auditEntries.map((e, i) => (
          <li key={i} style={{ fontSize: 13 }}>
            {new Date(e.timestamp * 1000).toLocaleString()} — {e.clinician_id} —{' '}
            {e.action} {e.target_patient_hash ? `(${e.target_patient_hash})` : ''}
          </li>
        ))}
      </ul>
    </div>
  )
}

const cellStyle = { border: '1px solid #ddd', padding: 6, textAlign: 'left', fontSize: 13 }
