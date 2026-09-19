import React, { useEffect, useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts'
import { Activity, ShieldAlert, ListChecks, Clock } from 'lucide-react'
import { Card, RiskBadge, riskHex } from './components/ui.jsx'

/**
 * Clinician trend dashboard.
 *
 * Every load of this component calls GET /api/dashboard/:patient_id,
 * which logs a mock audit entry server-side (see backend/audit_log.py).
 * GET /api/audit-log surfaces that trail live in the demo.
 */

const PATIENT_ID = 'demo-patient-001'

function StatTile({ icon: Icon, label, value, accent }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full"
          style={{ backgroundColor: `${accent}1a` }}
        >
          <Icon size={16} style={{ color: accent }} />
        </div>
        <div>
          <p className="text-xs text-white/40">{label}</p>
          <p className="tabular text-lg font-semibold text-white">{value}</p>
        </div>
      </div>
    </Card>
  )
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="glass rounded-xl px-3 py-2 text-xs shadow-xl">
      <p className="text-white/40">{new Date(d.timestamp * 1000).toLocaleString()}</p>
      <p className="tabular mt-1 font-semibold text-white">
        risk score {d.risk_score.toFixed(3)}
      </p>
      <p className="mt-0.5 capitalize" style={{ color: riskHex(d.risk_level) }}>
        {d.risk_level} risk
      </p>
    </div>
  )
}

export default function ClinicianDashboard() {
  const [history, setHistory] = useState([])
  const [auditEntries, setAuditEntries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch(`/api/dashboard/${PATIENT_ID}?clinician_id=demo-clinician`).then((r) => r.json()),
      fetch('/api/audit-log').then((r) => r.json()),
    ])
      .then(([dashboardData, audit]) => {
        setHistory(dashboardData.history || [])
        setAuditEntries(audit)
      })
      .finally(() => setLoading(false))
  }, [])

  const chartData = history.map((h) => ({
    timestamp: h.timestamp,
    label: new Date(h.timestamp * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    risk_score: h.risk.risk_score,
    risk_level: h.risk.risk_level,
  }))

  const latest = history[history.length - 1]

  return (
    <div>
      <div className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-white">Clinician Dashboard</h1>
          <p className="mt-2 text-base text-white/50">
            Patient <span className="tabular text-white/70">{PATIENT_ID}</span>
          </p>
        </div>
        {latest && <RiskBadge level={latest.risk.risk_level} />}
      </div>

      {loading ? (
        <Card className="p-10 text-center text-sm text-white/40">Loading patient trend…</Card>
      ) : history.length === 0 ? (
        <Card className="p-10 text-center text-sm text-white/40">No check-ins yet.</Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatTile icon={ListChecks} label="Check-ins" value={history.length} accent="#ffffff" />
            <StatTile
              icon={Activity}
              label="Latest score"
              value={latest.risk.risk_score.toFixed(3)}
              accent={riskHex(latest.risk.risk_level)}
            />
            <StatTile
              icon={ShieldAlert}
              label="Active flags"
              value={latest.risk.flags.length}
              accent="#fab219"
            />
            <StatTile
              icon={Clock}
              label="Last check-in"
              value={new Date(latest.timestamp * 1000).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
              accent="#a78bfa"
            />
          </div>

          <Card className="mb-6 p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Risk score trend</h2>
              <div className="flex items-center gap-4 text-xs text-white/40">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: riskHex('low') }} />
                  Low
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: riskHex('moderate') }} />
                  Moderate
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: riskHex('high') }} />
                  High
                </span>
              </div>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                  <CartesianGrid stroke="#232323" vertical={false} />
                  <XAxis
                    dataKey="label"
                    stroke="#666"
                    tick={{ fill: '#666', fontSize: 12 }}
                    tickLine={false}
                    axisLine={{ stroke: '#333' }}
                  />
                  <YAxis
                    domain={[0, 1]}
                    stroke="#666"
                    tick={{ fill: '#666', fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    width={34}
                  />
                  <ReferenceLine y={0.3} stroke="#fab219" strokeDasharray="4 4" strokeOpacity={0.5} />
                  <ReferenceLine y={0.6} stroke="#d03b3b" strokeDasharray="4 4" strokeOpacity={0.5} />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#ffffff', strokeOpacity: 0.2, strokeWidth: 1 }} />
                  <Line
                    type="monotone"
                    dataKey="risk_score"
                    stroke="#ffffff"
                    strokeWidth={2}
                    dot={(props) => {
                      const { cx, cy, payload, index } = props
                      return (
                        <circle
                          key={`dot-${index}`}
                          cx={cx}
                          cy={cy}
                          r={4}
                          fill={riskHex(payload.risk_level)}
                          stroke="#000000"
                          strokeWidth={2}
                        />
                      )
                    }}
                    activeDot={{ r: 6, strokeWidth: 2, stroke: '#000000' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="mb-6 overflow-hidden">
            <div className="border-b border-white/10 px-6 py-4">
              <h2 className="text-sm font-semibold text-white">Check-in history</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-white/30">
                    <th className="px-6 py-3 font-medium">Timestamp</th>
                    <th className="px-6 py-3 font-medium">Facial asymmetry</th>
                    <th className="px-6 py-3 font-medium">Voice jitter</th>
                    <th className="px-6 py-3 font-medium">Latency (ms)</th>
                    <th className="px-6 py-3 font-medium">Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {history
                    .slice()
                    .reverse()
                    .map((h, i) => (
                      <tr key={i} className="border-b border-white/5 text-white/70 last:border-0">
                        <td className="tabular px-6 py-3 text-white/40">
                          {new Date(h.timestamp * 1000).toLocaleString()}
                        </td>
                        <td className="tabular px-6 py-3">{h.metrics.facial_asymmetry_score ?? '—'}</td>
                        <td className="tabular px-6 py-3">{h.metrics.voice_jitter ?? '—'}</td>
                        <td className="tabular px-6 py-3">{h.metrics.response_latency_ms ?? '—'}</td>
                        <td className="px-6 py-3">
                          <RiskBadge level={h.risk.risk_level} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <Card className="p-6">
        <h2 className="mb-4 text-sm font-semibold text-white">Clinician access log</h2>
        {auditEntries.length === 0 ? (
          <p className="text-sm text-white/40">No access recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {auditEntries
              .slice()
              .reverse()
              .map((e, i) => (
                <li
                  key={i}
                  className="tabular flex items-center gap-2 text-xs text-white/40"
                >
                  <span className="text-white/25">
                    {new Date(e.timestamp * 1000).toLocaleString()}
                  </span>
                  <span className="text-white/50">{e.clinician_id}</span>
                  <span>{e.action}</span>
                  {e.target_patient_hash && (
                    <span className="text-white/25">({e.target_patient_hash})</span>
                  )}
                </li>
              ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
