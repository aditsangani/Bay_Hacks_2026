import React from 'react'
import { NavLink } from 'react-router-dom'
import { Waves, Stethoscope, User, Sun, Moon, LogOut } from 'lucide-react'
import { useTheme } from '../hooks/useTheme.js'
import { useAuth } from '../context/AuthContext.jsx'

export default function NavBar() {
  const { theme, toggle } = useTheme()
  const { session, role, displayName, signOut, demoMode, switchDemoRole } = useAuth()

  const linkClass = ({ isActive }) =>
    `flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
      isActive
        ? 'bg-black text-white dark:bg-white dark:text-black'
        : 'text-black/60 hover:text-black dark:text-white/60 dark:hover:text-white'
    }`

  return (
    <header className="sticky top-0 z-20 bg-white/60 backdrop-blur-xl dark:bg-black/60">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black text-white dark:bg-white dark:text-black">
            <Waves size={16} strokeWidth={2.5} />
          </div>
          <span className="text-sm font-semibold tracking-tight text-black dark:text-white">
            NeuroTriage Home
          </span>
        </div>
        <div className="flex items-center gap-2">
          {session && (
            <nav className="flex items-center gap-1 rounded-full border border-black/10 bg-black/[0.02] p-1 dark:border-white/10 dark:bg-white/[0.03]">
              {(role === 'patient' || demoMode) && (
                <NavLink to="/" end className={linkClass} onClick={() => switchDemoRole('patient')}>
                  <User size={14} />
                  Check-In
                </NavLink>
              )}
              {(role === 'clinician' || demoMode) && (
                <NavLink to="/dashboard" className={linkClass} onClick={() => switchDemoRole('clinician')}>
                  <Stethoscope size={14} />
                  Clinician
                </NavLink>
              )}
            </nav>
          )}
          {session ? (
            <>
              {displayName && (
                <span className="hidden text-sm text-black/50 sm:inline dark:text-white/50">{displayName}</span>
              )}
              {!demoMode && (
                <button
                  type="button"
                  onClick={signOut}
                  aria-label="Log out"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-black/[0.02] text-black/70 transition-colors hover:text-black dark:border-white/10 dark:bg-white/[0.03] dark:text-white/70 dark:hover:text-white"
                >
                  <LogOut size={15} />
                </button>
              )}
            </>
          ) : (
            <NavLink to="/login" className={linkClass}>
              Log in
            </NavLink>
          )}
          <button
            type="button"
            onClick={toggle}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-black/[0.02] text-black/70 transition-colors hover:text-black dark:border-white/10 dark:bg-white/[0.03] dark:text-white/70 dark:hover:text-white"
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </div>
    </header>
  )
}
