import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { UserPlus, AlertTriangle, Loader2, MailCheck, User, Stethoscope } from 'lucide-react'
import { Card, Button } from './components/ui.jsx'
import { useAuth } from './context/AuthContext.jsx'

export default function Signup() {
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState('patient')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmationSent, setConfirmationSent] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const { error: signUpError, needsConfirmation } = await signUp(email, password, role, displayName)
    setSubmitting(false)
    if (signUpError) {
      setError(signUpError.message)
      return
    }
    if (needsConfirmation) {
      setConfirmationSent(true)
    } else {
      // Confirmation is off: the user is already logged in. ProtectedRoute
      // sends clinicians on to /dashboard.
      navigate('/')
    }
  }

  if (confirmationSent) {
    return (
      <div className="mx-auto max-w-sm">
        <Card className="p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-black/5 ring-1 ring-black/10 dark:bg-white/10 dark:ring-white/15">
            <MailCheck className="text-black dark:text-white" size={22} />
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-black dark:text-white">Check your email</h2>
          <p className="mt-3 text-sm leading-relaxed text-black/50 dark:text-white/50">
            We sent a confirmation link to <span className="font-medium">{email}</span>. Click it, then come back
            and log in.
          </p>
          <Link to="/login">
            <Button variant="ghost" className="mt-6 w-full">
              Go to log in
            </Button>
          </Link>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-sm">
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-black dark:text-white">Sign up</h1>
        <p className="mt-2 text-base text-black/50 dark:text-white/50">
          Create your NeuroTriage Home account.
        </p>
      </div>

      {error && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <Card className="p-8">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-black/50 dark:text-white/50">I am a</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRole('patient')}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                  role === 'patient'
                    ? 'border-black bg-black text-white dark:border-white dark:bg-white dark:text-black'
                    : 'border-black/15 text-black/60 hover:bg-black/[0.03] dark:border-white/15 dark:text-white/60 dark:hover:bg-white/[0.05]'
                }`}
              >
                <User size={15} />
                Patient
              </button>
              <button
                type="button"
                onClick={() => setRole('clinician')}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                  role === 'clinician'
                    ? 'border-black bg-black text-white dark:border-white dark:bg-white dark:text-black'
                    : 'border-black/15 text-black/60 hover:bg-black/[0.03] dark:border-white/15 dark:text-white/60 dark:hover:bg-white/[0.05]'
                }`}
              >
                <Stethoscope size={15} />
                Clinician
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-black/50 dark:text-white/50">Name</label>
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-xl border border-black/15 bg-transparent px-3 py-2.5 text-sm text-black outline-none focus:border-black/40 dark:border-white/15 dark:text-white dark:focus:border-white/40"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-black/50 dark:text-white/50">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-black/15 bg-transparent px-3 py-2.5 text-sm text-black outline-none focus:border-black/40 dark:border-white/15 dark:text-white dark:focus:border-white/40"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-black/50 dark:text-white/50">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-black/15 bg-transparent px-3 py-2.5 text-sm text-black outline-none focus:border-black/40 dark:border-white/15 dark:text-white dark:focus:border-white/40"
            />
          </div>
          <Button type="submit" disabled={submitting} className="mt-2 w-full">
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
            Sign up
          </Button>
        </form>
      </Card>

      <p className="mt-6 text-center text-sm text-black/50 dark:text-white/50">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-black underline dark:text-white">
          Log in
        </Link>
      </p>
    </div>
  )
}
