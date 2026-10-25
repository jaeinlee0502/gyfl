/** Fail before bundling if an admin key is accidentally supplied to the browser. */
export function validatePublicConfig(env) {
  const url = env.VITE_SUPABASE_URL?.trim()
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url && !key) return
  if (!url || !key) throw new Error('Set both VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, or leave both empty.')
  let parsed
  try { parsed = new URL(url) } catch { throw new Error('VITE_SUPABASE_URL must be a valid HTTPS project URL.') }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) {
    throw new Error('VITE_SUPABASE_URL must be a project origin without credentials, paths or query parameters.')
  }
  const local = ['localhost', '127.0.0.1'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    throw new Error('Use HTTPS for Supabase, or HTTP only for a local development backend.')
  }
  if (key.startsWith('sb_publishable_') && key.length > 20) return
  // Legacy anon JWTs remain supported. These checks classify a public key;
  // they do not authenticate a user or grant authorization.
  try {
    const parts = key.split('.')
    if (parts.length === 3 && JSON.parse(Buffer.from(parts[1], 'base64url').toString()).role === 'anon') return
  } catch { /* rejected below */ }
  throw new Error('Only a Supabase publishable key or legacy anon key may be used in the frontend. Never use an admin/secret key.')
}
