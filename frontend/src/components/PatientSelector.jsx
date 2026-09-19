import React from 'react'
import { Card } from './ui.jsx'

export default function PatientSelector({ patients, selectedPatientId, onChange }) {
  if (patients.length === 0) {
    return (
      <Card className="mb-6 p-5 text-sm text-black/40 dark:text-white/40">
        No patients have signed up yet.
      </Card>
    )
  }

  return (
    <Card className="mb-6 p-4">
      <label className="mb-2 block text-xs font-medium text-black/40 dark:text-white/40">
        Viewing patient
      </label>
      <select
        value={selectedPatientId ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-black/15 bg-transparent px-3 py-2 text-sm text-black outline-none focus:border-black/40 dark:border-white/15 dark:text-white dark:focus:border-white/40"
      >
        {patients.map((p) => (
          <option key={p.patient_id} value={p.patient_id} className="bg-white text-black dark:bg-black dark:text-white">
            {p.display_name}
          </option>
        ))}
      </select>
    </Card>
  )
}
