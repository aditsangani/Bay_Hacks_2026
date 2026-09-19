import React from 'react'
import { NavLink } from 'react-router-dom'
import { Waves, Stethoscope, User } from 'lucide-react'

export default function NavBar() {
  const linkClass = ({ isActive }) =>
    `flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
      isActive ? 'bg-white text-black' : 'text-white/60 hover:text-white'
    }`

  return (
    <header className="sticky top-0 z-20 bg-black/60 backdrop-blur-xl">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black">
            <Waves size={16} strokeWidth={2.5} />
          </div>
          <span className="text-sm font-semibold tracking-tight text-white">
            NeuroTriage Home
          </span>
        </div>
        <nav className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
          <NavLink to="/" end className={linkClass}>
            <User size={14} />
            Check-In
          </NavLink>
          <NavLink to="/dashboard" className={linkClass}>
            <Stethoscope size={14} />
            Clinician
          </NavLink>
        </nav>
      </div>
    </header>
  )
}
