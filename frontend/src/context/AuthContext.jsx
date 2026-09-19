import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase, supabaseDemoMode } from '../lib/supabaseClient.js'

const AuthContext = createContext(null)
const DEMO_IDENTITIES = {
  patient: {
    access_token: 'demo-patient-token',
    user: { id: 'demo-patient-001', email: 'patient@demo.local' },
    displayName: 'Demo Patient',
  },
  clinician: {
    access_token: 'demo-clinician-token',
    user: { id: 'demo-clinician-001', email: 'clinician@demo.local' },
    displayName: 'Demo Clinician',
  },
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => supabaseDemoMode ? DEMO_IDENTITIES.patient : null)
  const [role, setRole] = useState(() => supabaseDemoMode ? 'patient' : null)
  const [displayName, setDisplayName] = useState(() => supabaseDemoMode ? DEMO_IDENTITIES.patient.displayName : null)
  const [loading, setLoading] = useState(!supabaseDemoMode)

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setRole(null)
      setDisplayName(null)
      return
    }
    const { data } = await supabase
      .from('profiles')
      .select('role, display_name')
      .eq('id', userId)
      .single()
    setRole(data?.role ?? null)
    setDisplayName(data?.display_name ?? null)
  }, [])

  useEffect(() => {
    if (supabaseDemoMode) return undefined
    let mounted = true

    supabase.auth.getSession().then(async ({ data: { session: initialSession } }) => {
      if (!mounted) return
      setSession(initialSession)
      await loadProfile(initialSession?.user?.id)
      if (mounted) setLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (!mounted) return
      setSession(nextSession)
      await loadProfile(nextSession?.user?.id)
      setLoading(false)
    })

    return () => {
      mounted = false
      subscription.subscription.unsubscribe()
    }
  }, [loadProfile])

  // Email confirmation is required (the standard flow), so signUp()
  // normally returns no active session -- the profile can't be
  // inserted client-side yet (RLS's auth.uid() has nothing to check
  // against), so it's saved via the backend instead, which is allowed
  // to write it ahead of confirmation using the service_role key.
  const signUp = async (email, password, role, displayName) => {
    if (supabaseDemoMode) return { error: new Error('Account creation is disabled in local demo mode.') }
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) return { error }

    const profileRes = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: data.user.id, role, display_name: displayName }),
    })
    if (!profileRes.ok) {
      const body = await profileRes.json().catch(() => ({}))
      return { error: new Error(body.error || 'Could not save your profile') }
    }

    return { error: null, needsConfirmation: !data.session }
  }

  const signIn = async (email, password) => {
    if (supabaseDemoMode) return { error: new Error('Use the patient and clinician tabs in local demo mode.') }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  const signOut = async () => {
    if (supabaseDemoMode) return
    await supabase.auth.signOut()
  }

  const switchDemoRole = (nextRole) => {
    if (!supabaseDemoMode || !DEMO_IDENTITIES[nextRole]) return
    const identity = DEMO_IDENTITIES[nextRole]
    setSession(identity)
    setRole(nextRole)
    setDisplayName(identity.displayName)
  }

  const getAccessToken = () => session?.access_token ?? null

  const value = {
    session,
    user: session?.user ?? null,
    role,
    displayName,
    loading,
    signUp,
    signIn,
    signOut,
    getAccessToken,
    demoMode: supabaseDemoMode,
    switchDemoRole,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
