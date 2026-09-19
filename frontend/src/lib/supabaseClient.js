import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const missingConfig = !supabaseUrl || !supabaseAnonKey
  || supabaseUrl.includes('your-project')
  || supabaseAnonKey.includes('your-anon-public-key')

export const supabaseDemoMode = import.meta.env.DEV && missingConfig
export let supabase = null
export let supabaseConfigError = null

if (missingConfig && !supabaseDemoMode) {
  supabaseConfigError = 'Supabase frontend configuration is missing.'
} else if (!missingConfig) {
  try {
    supabase = createClient(supabaseUrl, supabaseAnonKey)
  } catch {
    supabaseConfigError = 'Supabase frontend configuration is invalid.'
  }
}
