import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import CheckInFlow from './CheckInFlow.jsx'
import ClinicianDashboard from './ClinicianDashboard.jsx'

function App() {
  const [view, setView] = useState('patient')

  return (
    <>
      <nav
        aria-label="App views"
        style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 24 }}
      >
        <button
          type="button"
          aria-pressed={view === 'patient'}
          onClick={() => setView('patient')}
          style={{ fontWeight: view === 'patient' ? 'bold' : 'normal' }}
        >
          Patient check-in
        </button>
        <button
          type="button"
          aria-pressed={view === 'clinician'}
          onClick={() => setView('clinician')}
          style={{ fontWeight: view === 'clinician' ? 'bold' : 'normal' }}
        >
          Clinician dashboard
        </button>
      </nav>
      <main>
        {view === 'patient' ? <CheckInFlow /> : <ClinicianDashboard />}
      </main>
    </>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
