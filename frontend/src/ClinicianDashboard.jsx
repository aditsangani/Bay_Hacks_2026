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
import { Activity, ShieldAlert, ListChecks, Clock, HeartPulse, Wind, AlertTriangle, CalendarClock, Siren } from 'lucide-react'
import { Card, RiskBadge, riskHex } from './components/ui.jsx'
import { useTheme } from './hooks/useTheme.js'
import { useAuth } from './context/AuthContext.jsx'
import PatientSelector from './components/PatientSelector.jsx'
import WellnessSummary from './components/WellnessSummary.jsx'

/**
 * Clinician trend dashboard, reachable via the Clinician tab in the
 * top nav (see App.jsx). The clinician picks which patient to view
 * (see /api/patients); loading a patient's history calls
 * GET /api/dashboard/:patient_id, which logs an audit entry
 * server-side (see database/audit_log.py). GET /api/audit-log
 * surfaces that trail live in the demo.
 */

const TRIAGE_STYLES = {
  1: { label: 'Tier 1 · Stable', color: '#0ca30c', Icon: CalendarClock },
  2: { label: 'Tier 2 · Elevated Trend', color: '#fab219', Icon: AlertTriangle },
  3: { label: 'Tier 3 · Acute Alert', color: '#d03b3b', Icon: Siren },
}

function TriageBadge({ triage }) {
  const style = TRIAGE_STYLES[triage?.tier] || TRIAGE_STYLES[1]
  const Icon = style.Icon
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold ring-1"
      style={{ color: style.color, borderColor: `${style.color}4d`, backgroundColor: `${style.color}12` }}
    >
      <Icon size={14} />
      {style.label}
    </span>
  )
}

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
          <p className="text-xs text-black/40 dark:text-white/40">{label}</p>
          <p className="tabular text-lg font-semibold text-black dark:text-white">{value}</p>
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
      <p className="text-black/40 dark:text-white/40">{new Date(d.timestamp * 1000).toLocaleString()}</p>
      <p className="tabular mt-1 font-semibold text-black dark:text-white">
        risk score {d.risk_score.toFixed(3)}
      </p>
      <p className="mt-0.5 capitalize" style={{ color: riskHex(d.risk_level) }}>
        {d.risk_level} risk
      </p>
    </div>
  )
}

async function getJSON(url, token) {
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Request to ${url} failed (${res.status})`)
  }
  return res.json()
}

export default function ClinicianDashboard() {
  const { theme } = useTheme()
  const { getAccessToken } = useAuth()

  const [patients, setPatients] = useState([])
  const [patientsLoading, setPatientsLoading] = useState(true)
  const [selectedPatientId, setSelectedPatientId] = useState(null)

  const [history, setHistory] = useState([])
  const [auditEntries, setAuditEntries] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [loadError, setLoadError] = useState(null)

  // Patient list + audit log: fetched once on mount.
  useEffect(() => {
    let cancelled = false
    const token = getAccessToken()
    setLoadError(null)
    Promise.all([
      getJSON('/api/patients', token),
      getJSON('/api/audit-log', token),
    ])
      .then(([list, entries]) => {
        if (cancelled) return
        setPatients(list)
        setSelectedPatientId(list[0]?.patient_id ?? null)
        setAuditEntries(entries)
      })
      .catch((requestError) => {
        if (cancelled) return
        setPatients([])
        setSelectedPatientId(null)
        setAuditEntries([])
        setLoadError(requestError.message || 'Could not load the clinician dashboard.')
      })
      .finally(() => {
        if (!cancelled) setPatientsLoading(false)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Patient history: re-fetched whenever the selected patient changes.
  useEffect(() => {
    if (!selectedPatientId) return
    let cancelled = false
    setHistoryLoading(true)
    setLoadError(null)
    getJSON(`/api/dashboard/${selectedPatientId}`, getAccessToken())
      .then((data) => {
        if (!cancelled) setHistory(data.history || [])
      })
      .catch((requestError) => {
        if (cancelled) return
        setHistory([])
        setLoadError(requestError.message || 'Could not load this patient history.')
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPatientId])

  const chartData = history.map((h) => ({
    timestamp: h.timestamp,
    label: new Date(h.timestamp * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    risk_score: h.risk.risk_score,
    risk_level: h.risk.risk_level,
    triage: h.risk.triage,
  }))

  const latest = history[history.length - 1]
  const selectedPatient = patients.find((p) => p.patient_id === selectedPatientId)

  const chartInk = theme === 'dark' ? '#ffffff' : '#000000'
  const chartMuted = theme === 'dark' ? '#666666' : '#999999'
  const chartGrid = theme === 'dark' ? '#232323' : '#e5e5e5'
  const chartAxisLine = theme === 'dark' ? '#333333' : '#dddddd'
  const chartDotStroke = theme === 'dark' ? '#000000' : '#ffffff'

  const loading = patientsLoading || historyLoading

  return (
    <div>
      <div className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-black dark:text-white">Clinician Dashboard</h1>
          <p className="mt-2 text-base text-black/50 dark:text-white/50">
            {selectedPatient ? (
              <>
                Patient <span className="text-black/70 dark:text-white/70">{selectedPatient.display_name}</span>
              </>
            ) : (
              'Select a patient to view their trend.'
            )}
          </p>
        </div>
        {latest && (
          <div className="flex flex-col items-end gap-2">
            <TriageBadge triage={latest.risk.triage} />
            <RiskBadge level={latest.risk.risk_level} />
          </div>
        )}
      </div>

      {loadError && (
        <div role="alert" className="mb-6 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          {loadError}
        </div>
      )}

      {!patientsLoading && <PatientSelector patients={patients} selectedPatientId={selectedPatientId} onChange={setSelectedPatientId} />}

      {loading ? (
        <Card className="p-10 text-center text-sm text-black/40 dark:text-white/40">Loading patient trend…</Card>
      ) : !selectedPatientId ? null : history.length === 0 ? (
        <Card className="p-10 text-center text-sm text-black/40 dark:text-white/40">No check-ins yet.</Card>
      ) : (
        <>
          {latest.risk.triage && (
            <Card
              className="mb-6 border-l-4 p-5"
              style={{ borderLeftColor: TRIAGE_STYLES[latest.risk.triage.tier]?.color || TRIAGE_STYLES[1].color }}
            >
              <div className="flex items-start gap-3">
                <ShieldAlert
                  size={20}
                  style={{ color: TRIAGE_STYLES[latest.risk.triage.tier]?.color || TRIAGE_STYLES[1].color }}
                />
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-sm font-semibold text-black dark:text-white">Escalation pathway</h2>
                    <TriageBadge triage={latest.risk.triage} />
                  </div>
                  <p className="mt-2 text-sm text-black/60 dark:text-white/60">{latest.risk.triage.reason}</p>
                  <p className="mt-1 text-sm font-medium text-black dark:text-white">{latest.risk.triage.action}</p>
                </div>
              </div>
            </Card>
          )}

          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile icon={ListChecks} label="Check-ins" value={history.length} accent="#8b5cf6" />
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
              accent="#38bdf8"
            />
            <StatTile
              icon={HeartPulse}
              label="Est. pulse"
              value={latest.vital_signs ? `${latest.vital_signs.heart_rate_bpm} BPM` : '—'}
              accent="#fb7185"
            />
            <StatTile
              icon={Wind}
              label="Est. breathing"
              value={latest.vital_signs ? `${latest.vital_signs.breathing_rate_bpm} / min` : '—'}
              accent="#22d3ee"
            />
          </div>

          {latest.wellness && (
            <div className="mb-6">
              <WellnessSummary wellness={latest.wellness} />
            </div>
          )}

          <Card className="mb-6 p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-black dark:text-white">Risk score trend</h2>
              <div className="flex items-center gap-4 text-xs text-black/40 dark:text-white/40">
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
                <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={chartGrid} vertical={false} />
                  <XAxis
                    dataKey="label"
                    stroke={chartMuted}
                    tick={{ fill: chartMuted, fontSize: 12 }}
                    tickLine={false}
                    axisLine={{ stroke: chartAxisLine }}
                  />
                  <YAxis
                    domain={[0, 1]}
                    stroke={chartMuted}
                    tick={{ fill: chartMuted, fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    tickFormatter={(v) => v.toFixed(2)}
                  />
                  <ReferenceLine y={0.3} stroke="#fab219" strokeDasharray="4 4" strokeOpacity={0.5} />
                  <ReferenceLine y={0.6} stroke="#d03b3b" strokeDasharray="4 4" strokeOpacity={0.5} />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: chartInk, strokeOpacity: 0.2, strokeWidth: 1 }} />
                  <Line
                    type="monotone"
                    dataKey="risk_score"
                    stroke={chartInk}
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
                          stroke={chartDotStroke}
                          strokeWidth={2}
                        />
                      )
                    }}
                    activeDot={{ r: 6, strokeWidth: 2, stroke: chartDotStroke }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="mb-6 overflow-hidden">
            <div className="border-b border-black/10 px-6 py-4 dark:border-white/10">
              <h2 className="text-sm font-semibold text-black dark:text-white">Check-in history</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-black/10 text-xs uppercase tracking-wide text-black/30 dark:border-white/10 dark:text-white/30">
                    <th className="px-6 py-3 font-medium">Timestamp</th>
                    <th className="px-6 py-3 font-medium">Facial asymmetry</th>
                    <th className="px-6 py-3 font-medium">Camera estimates</th>
                    <th className="px-6 py-3 font-medium">Sleep & wellbeing</th>
                    <th className="px-6 py-3 font-medium">Voice jitter</th>
                    <th className="px-6 py-3 font-medium">Latency (ms)</th>
                    <th className="px-6 py-3 font-medium">Triage</th>
                    <th className="px-6 py-3 font-medium">Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {history
                    .slice()
                    .reverse()
                    .map((h, i) => (
                      <tr key={i} className="border-b border-black/5 text-black/70 last:border-0 dark:border-white/5 dark:text-white/70">
                        <td className="tabular px-6 py-3 text-black/40 dark:text-white/40">
                          {new Date(h.timestamp * 1000).toLocaleString()}
                        </td>
                        <td className="tabular px-6 py-3">
                          {h.metrics.facial_asymmetry_score ?? '—'}
                          <span className="mt-1 block text-xs text-black/40 dark:text-white/40">
                            {h.face_analysis?.method === 'pose_corrected_v2'
                              ? `Tilt-adjusted · ${h.face_analysis.sample_count} frames`
                              : 'Original method'}
                          </span>
                        </td>
                        <td className="tabular px-6 py-3">
                          {h.vital_signs ? (
                            <>
                              <span className="block">{h.vital_signs.heart_rate_bpm} BPM</span>
                              <span className="block">{h.vital_signs.breathing_rate_bpm} breaths/min</span>
                            </>
                          ) : <span className="text-black/40 dark:text-white/40">Not collected</span>}
                        </td>
                        <td className="px-6 py-3">
                          {h.wellness ? (
                            <details className="min-w-56">
                              <summary className="cursor-pointer text-black/70 dark:text-white/70">
                                {h.wellness.answers.hours_sleep === null
                                  ? 'Sleep not shared'
                                  : `${h.wellness.answers.hours_sleep} hours sleep`}
                                {' · View responses'}
                              </summary>
                              <div className="mt-3"><WellnessSummary wellness={h.wellness} /></div>
                            </details>
                          ) : <span className="text-black/40 dark:text-white/40">Not collected</span>}
                        </td>
                        <td className="tabular px-6 py-3">{h.metrics.voice_jitter ?? '—'}</td>
                        <td className="tabular px-6 py-3">{h.metrics.response_latency_ms ?? '—'}</td>
                        <td className="px-6 py-3">
                          <TriageBadge triage={h.risk.triage} />
                        </td>
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
        <h2 className="mb-4 text-sm font-semibold text-black dark:text-white">Clinician access log</h2>
        {auditEntries.length === 0 ? (
          <p className="text-sm text-black/40 dark:text-white/40">No access recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {auditEntries
              .slice()
              .reverse()
              .map((e, i) => (
                <li
                  key={i}
                  className="tabular flex items-center gap-2 text-xs text-black/40 dark:text-white/40"
                >
                  <span className="text-black/25 dark:text-white/25">
                    {new Date(e.timestamp * 1000).toLocaleString()}
                  </span>
                  <span className="text-black/50 dark:text-white/50">{e.clinician_id}</span>
                  <span>{e.action}</span>
                  {e.target_patient_hash && (
                    <span className="text-black/25 dark:text-white/25">({e.target_patient_hash})</span>
                  )}
                </li>
              ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
