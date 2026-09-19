import React from 'react'
import { Routes, Route } from 'react-router-dom'
import NavBar from './components/NavBar.jsx'
import CheckInFlow from './CheckInFlow.jsx'
import ClinicianDashboard from './ClinicianDashboard.jsx'

export default function App() {
  return (
    <div className="min-h-screen">
      <NavBar />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <Routes>
          <Route path="/" element={<CheckInFlow />} />
          <Route path="/dashboard" element={<ClinicianDashboard />} />
        </Routes>
      </main>
    </div>
  )
}
