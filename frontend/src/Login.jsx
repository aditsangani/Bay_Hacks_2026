import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { LogIn, AlertTriangle, Loader2 } from 'lucide-react'
import { Card, Button } from './components/ui.jsx'
import { useAuth } from './context/AuthContext.jsx'

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const { error: signInError } = await signIn(email, password)
    setSubmitting(false)
    if (signInError) {
      setError(signInError.message)
      return
    }
    // AuthContext's onAuthStateChange hasn't necessarily populated `role`
    // yet at this exact tick; ProtectedRoute will redirect correctly
    // regardless once it does, so a plain "/" landing is a safe default.
    navigate('/')
  }

  return (
    <div className="mx-auto max-w-sm">
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-black dark:text-white">Log in</h1>
        <p className="mt-2 text-base text-black/50 dark:text-white/50">
          Welcome back to NeuroTriage Home.
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
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-black/15 bg-transparent px-3 py-2.5 text-sm text-black outline-none focus:border-black/40 dark:border-white/15 dark:text-white dark:focus:border-white/40"
            />
          </div>
          <Button type="submit" disabled={submitting} className="mt-2 w-full">
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
            Log in
          </Button>
        </form>
      </Card>

      <p className="mt-6 text-center text-sm text-black/50 dark:text-white/50">
        No account yet?{' '}
        <Link to="/signup" className="font-medium text-black underline dark:text-white">
          Sign up
        </Link>
      </p>
    </div>
  )
}
