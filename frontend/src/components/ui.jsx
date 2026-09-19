import React from 'react'

export function Card({ children, className = '' }) {
  return (
    <div className={`glass rounded-3xl shadow-2xl shadow-black/40 ${className}`}>
      {children}
    </div>
  )
}

export function Button({ children, variant = 'primary', className = '', ...props }) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-full px-6 py-3.5 text-sm font-semibold tracking-tight transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40'
  const variants = {
    primary: 'bg-white text-black hover:bg-white/85 active:bg-white/70',
    ghost: 'bg-white/[0.04] text-white hover:bg-white/10 border border-white/15',
    subtle: 'bg-transparent text-white/50 hover:text-white',
  }
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  )
}

const statusStyles = {
  low: { dot: 'bg-risk-good', text: 'text-risk-good', ring: 'ring-risk-good/30', label: 'Low' },
  moderate: {
    dot: 'bg-risk-warning',
    text: 'text-risk-warning',
    ring: 'ring-risk-warning/30',
    label: 'Moderate',
  },
  high: {
    dot: 'bg-risk-critical',
    text: 'text-risk-critical',
    ring: 'ring-risk-critical/30',
    label: 'High',
  },
}

export function RiskBadge({ level, className = '' }) {
  const s = statusStyles[level] || statusStyles.low
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold ring-1 ${s.ring} bg-white/[0.03] ${s.text} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label} risk
    </span>
  )
}

export function riskColor(level) {
  return (statusStyles[level] || statusStyles.low).text
}

export function riskHex(level) {
  const hex = { low: '#0ca30c', moderate: '#fab219', high: '#d03b3b' }
  return hex[level] || hex.low
}

export function ProgressSteps({ steps, current }) {
  const idx = steps.findIndex((s) => s.key === current)
  return (
    <div className="flex items-center">
      {steps.map((step, i) => {
        const done = i < idx
        const active = i === idx
        return (
          <React.Fragment key={step.key}>
            <div className="flex flex-col items-center gap-2">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold transition-colors
                ${
                  done
                    ? 'border-white bg-white text-black'
                    : active
                    ? 'border-white text-white'
                    : 'border-white/15 text-white/30'
                }`}
              >
                {done ? '✓' : i + 1}
              </div>
              <span
                className={`text-xs font-medium ${
                  active ? 'text-white' : 'text-white/30'
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`mx-2 mb-5 h-px flex-1 ${
                  done ? 'bg-white' : 'bg-white/10'
                }`}
              />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}
