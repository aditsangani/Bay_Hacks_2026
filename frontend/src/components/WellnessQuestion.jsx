import React from 'react'

export default function WellnessQuestion({ question, value, onChange, onSkip }) {
  const skipped = value === null

  return (
    <div className="rounded-2xl border border-black/10 bg-black/[0.015] p-4 dark:border-white/10 dark:bg-white/[0.02]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-black dark:text-white">{question.label}</p>
        {question.allow_skip && (
          <button
            type="button"
            onClick={onSkip}
            className={`shrink-0 text-xs font-medium transition-colors ${
              skipped
                ? 'text-black dark:text-white'
                : 'text-black/40 hover:text-black dark:text-white/40 dark:hover:text-white'
            }`}
          >
            {skipped ? 'Skipped' : 'Skip'}
          </button>
        )}
      </div>

      {question.type === 'choice' ? (
        <div className="flex flex-wrap gap-2">
          {question.options.map((opt) => (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                value === opt.value
                  ? 'bg-black text-white dark:bg-white dark:text-black'
                  : 'bg-black/[0.04] text-black/70 hover:bg-black/[0.08] dark:bg-white/[0.05] dark:text-white/70 dark:hover:bg-white/10'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      ) : (
        <input
          type="number"
          min={question.min}
          max={question.max}
          step={question.step}
          value={value ?? ''}
          onChange={(e) => {
            const raw = e.target.value
            onChange(raw === '' ? null : Number(raw))
          }}
          placeholder="—"
          className="w-28 rounded-xl border border-black/15 bg-transparent px-3 py-2 text-sm text-black outline-none focus:border-black/40 dark:border-white/15 dark:text-white dark:focus:border-white/40"
        />
      )}
    </div>
  )
}
