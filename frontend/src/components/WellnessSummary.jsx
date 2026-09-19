import React from 'react'
import { Card } from './ui.jsx'

export default function WellnessSummary({ wellness }) {
  if (!wellness) return null
  const answers = wellness.answers || {}
  const items = [
    ['Sleep', answers.hours_sleep == null ? 'Not shared' : `${answers.hours_sleep} hours`],
    ['Usual sleep', answers.usual_sleep_hours == null ? 'Not shared' : `${answers.usual_sleep_hours} hours`],
    ['Mood', answers.mood == null ? 'Not shared' : `${answers.mood}/5`],
    ['Fatigue', answers.fatigue === 1 ? 'Reported' : answers.fatigue === 0 ? 'Not reported' : 'Not shared'],
    ['Pain', answers.pain === 1 ? 'Reported' : answers.pain === 0 ? 'Not reported' : 'Not shared'],
  ]
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-black dark:text-white">Wellbeing context</h3>
        <span className="text-xs text-black/40 dark:text-white/40">Context only</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {items.map(([label, value]) => (
          <div key={label}>
            <p className="text-xs text-black/40 dark:text-white/40">{label}</p>
            <p className="mt-1 text-sm font-medium text-black dark:text-white">{value}</p>
          </div>
        ))}
      </div>
      {wellness.summary && <p className="mt-4 text-xs text-black/50 dark:text-white/50">{wellness.summary}</p>}
    </Card>
  )
}
