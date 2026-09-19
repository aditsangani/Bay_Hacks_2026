import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

const HOME_FOR_ROLE = {
  patient: '/',
  clinician: '/dashboard',
}

export default function ProtectedRoute({ role, children }) {
  const { session, role: currentRole, loading } = useAuth()

  if (loading) return null

  if (!session) return <Navigate to="/login" replace />

  if (currentRole !== role) {
    return <Navigate to={HOME_FOR_ROLE[currentRole] ?? '/login'} replace />
  }

  return children
}
