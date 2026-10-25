import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const publicKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// Both values are public project settings. Server/admin keys never belong here.
export const supabase = url && publicKey
  ? createClient(url.trim(), publicKey.trim(), {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'gyfl-auth-v1',
      },
    })
  : null

export function accountRedirectUrl() {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href
}
