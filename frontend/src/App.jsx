import React from 'react'
import { Routes, Route } from 'react-router-dom'
import NavBar from './components/NavBar.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import CheckInFlow from './CheckInFlow.jsx'
import ClinicianDashboard from './ClinicianDashboard.jsx'
import Login from './Login.jsx'
import Signup from './Signup.jsx'

export default function App() {
  return (
    <div className="min-h-screen">
      <NavBar />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route
            path="/"
            element={
              <ProtectedRoute role="patient">
                <CheckInFlow />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute role="clinician">
                <ClinicianDashboard />
              </ProtectedRoute>
            }
          />
        </Routes>
      </main>
    </div>
  )
}
