import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { supabaseConfigError } from './lib/supabaseClient.js'
import './index.css'

function ConfigurationRequired() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <section role="alert" className="w-full max-w-lg rounded-3xl border border-amber-500/30 bg-amber-500/10 p-8 text-black dark:text-white">
        <h1 className="text-2xl font-semibold">Supabase setup required</h1>
        <p className="mt-3 text-sm leading-relaxed text-black/65 dark:text-white/65">
          {supabaseConfigError} Copy <code>frontend/.env.example</code> to <code>frontend/.env</code>,
          add the project URL and anon/public key, then restart <code>npm run dev</code>.
        </p>
        <p className="mt-3 text-xs leading-relaxed text-black/50 dark:text-white/50">
          Never place the backend service-role key in the frontend file.
        </p>
      </section>
    </main>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {supabaseConfigError ? (
      <ConfigurationRequired />
    ) : (
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    )}
  </React.StrictMode>
)
