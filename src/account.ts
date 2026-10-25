import { ref } from 'vue'
import type { User } from '@supabase/supabase-js'
import { accountRedirectUrl, supabase } from './lib/supabase'

export interface AccountSummary {
  user_id: string
  email: string
  display_name: string
  created_at: string
}

const user = ref<User | null>(null)
const authReady = ref(!supabase)
const authBusy = ref(false)
const isAdmin = ref(false)
const recoveryMode = ref(false)
const recoveryLinkError = ref(false)
const authNotice = ref('')
const callbackParams = new URLSearchParams(window.location.hash.slice(1))
const recoveryCallback = callbackParams.get('type') === 'recovery'
const callbackHasError = callbackParams.has('error') || callbackParams.has('error_code')
let initialized = false
let identityVersion = 0

function requireClient() {
  if (!supabase) throw new Error('계정 기능을 준비 중이에요. 문제 탐색은 계속 이용할 수 있어요.')
  return supabase
}

function explainAuthError(error: { code?: string; status?: number }) {
  if (error.status === 429 || error.code?.includes('rate_limit')) return '요청이 잠시 많아요. 잠시 후 다시 시도해 주세요.'
  switch (error.code) {
    case 'invalid_credentials': return '이메일 또는 비밀번호를 확인해 주세요.'
    case 'email_not_confirmed': return '가입 확인 메일을 먼저 확인해 주세요.'
    case 'user_already_exists': return '이미 가입된 이메일이에요. 로그인 또는 비밀번호 찾기를 이용해 주세요.'
    case 'weak_password': return '비밀번호는 10자 이상으로, 더 안전하게 정해 주세요.'
    case 'same_password': return '기존과 다른 비밀번호를 입력해 주세요.'
    case 'otp_expired': return '메일 링크가 만료되었어요. 비밀번호 찾기를 다시 요청해 주세요.'
    default: return '계정 서비스에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'
  }
}

async function authOperation<T>(operation: () => Promise<T>): Promise<T> {
  if (authBusy.value) throw new Error('진행 중인 요청이 끝날 때까지 기다려 주세요.')
  authBusy.value = true
  try { return await operation() } finally { authBusy.value = false }
}

function acceptIdentity(next: User | null) {
  const version = ++identityVersion
  user.value = next
  isAdmin.value = false
  authReady.value = true
  if (!next || !supabase) return
  // Never await another Supabase operation inside onAuthStateChange's lock.
  window.setTimeout(() => {
    void supabase!.from('account_admins').select('user_id').eq('user_id', next.id).maybeSingle()
      .then(({ data, error }) => {
        if (version === identityVersion && !error) isAdmin.value = Boolean(data)
      })
  }, 0)
}

export async function initializeAccount() {
  if (initialized || !supabase) return
  initialized = true
  const client = supabase
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') recoveryMode.value = true
    if (event === 'SIGNED_OUT') recoveryMode.value = false
    // A token refresh shouldn't discard the current user's visible saved list.
    if (user.value?.id !== session?.user.id || !authReady.value) acceptIdentity(session?.user ?? null)
    else if (session) user.value = session.user
  })
  const version = identityVersion
  try {
    const { error: initializationError } = await client.auth.initialize()
    if (initializationError) throw initializationError
    const { data, error } = await client.auth.getSession()
    if (error) throw error
    if (version === identityVersion && !authReady.value) acceptIdentity(data.session?.user ?? null)
    if (recoveryCallback && data.session) recoveryMode.value = true
  } catch {
    // INITIAL_SESSION may arrive before this catch. Callback failures must
    // still be shown even when that event already updated the identity.
    if (callbackHasError || version === identityVersion) {
      if (version === identityVersion && !authReady.value) acceptIdentity(null)
      recoveryLinkError.value = callbackHasError
      authNotice.value = callbackHasError
        ? '메일 링크가 만료되었거나 유효하지 않아요. 재설정 메일을 다시 요청해 주세요.'
        : '로그인 상태를 확인하지 못했어요. 문제 탐색은 계속 이용할 수 있어요.'
      if (callbackHasError) history.replaceState(history.state, '', window.location.pathname + window.location.search)
    }
  }
}

async function signIn(email: string, password: string) {
  return authOperation(async () => {
    const { data, error } = await requireClient().auth.signInWithPassword({ email: email.trim(), password })
    if (error) throw new Error(explainAuthError(error))
    acceptIdentity(data.user)
    authNotice.value = ''
  })
}

async function signUp(email: string, password: string, displayName: string) {
  return authOperation(async () => {
    const { data, error } = await requireClient().auth.signUp({
      email: email.trim(), password,
      options: { data: { display_name: displayName.trim() }, emailRedirectTo: accountRedirectUrl() },
    })
    if (error) throw new Error(explainAuthError(error))
    if (data.session) acceptIdentity(data.session.user)
    return { needsEmailConfirmation: !data.session }
  })
}

async function requestPasswordReset(email: string) {
  return authOperation(async () => {
    const { error } = await requireClient().auth.resetPasswordForEmail(email.trim(), { redirectTo: accountRedirectUrl() })
    if (error) throw new Error(explainAuthError(error))
    recoveryLinkError.value = false
    authNotice.value = ''
  })
}

async function updatePassword(password: string) {
  return authOperation(async () => {
    const { error } = await requireClient().auth.updateUser({ password })
    if (error) throw new Error(explainAuthError(error))
    recoveryMode.value = false
  })
}

async function signOut() {
  return authOperation(async () => {
    const { error } = await requireClient().auth.signOut({ scope: 'local' })
    if (error) throw new Error(explainAuthError(error))
    acceptIdentity(null)
    recoveryMode.value = false
  })
}

async function adminRequest<T>(body: Record<string, string>): Promise<T> {
  if (!user.value || !isAdmin.value) throw new Error('관리자 권한을 확인해 주세요.')
  const { data, error } = await requireClient().functions.invoke('account-admin', { body })
  if (error) {
    let code = ''
    if (error.context instanceof Response) {
      const response = await error.context.json().catch(() => null)
      code = response?.code ?? ''
    }
    if (code === 'RESET_COOLDOWN' || code === 'RESET_RATE_LIMIT') throw new Error('재설정 요청을 잠시 쉬어 주세요. 같은 계정은 1분 뒤 다시 보낼 수 있어요.')
    if (code === 'ADMIN_REQUIRED' || code === 'UNAUTHENTICATED') throw new Error('관리자 권한 또는 로그인 상태를 확인해 주세요.')
    if (code === 'ACCOUNT_NOT_FOUND') throw new Error('계정을 찾지 못했어요. 다시 검색해 주세요.')
    if (code === 'RECOVERY_SEND_FAILED') throw new Error('재설정 메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.')
    throw new Error('관리자 서비스에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.')
  }
  return data as T
}

async function searchUsers(query: string, field: 'email' | 'name') {
  const data = await adminRequest<{ users: AccountSummary[] }>({ action: 'search', query: query.trim(), field })
  return data.users
}

async function sendAdminReset(userId: string) {
  const data = await adminRequest<{ message: string }>({ action: 'reset-password', userId })
  return data.message
}

export function useAccount() {
  return {
    configured: Boolean(supabase), user, authReady, authBusy, isAdmin, recoveryMode, recoveryLinkError, authNotice,
    signIn, signUp, requestPasswordReset, updatePassword, signOut,
    clearRecovery: () => { recoveryMode.value = false }, searchUsers, sendAdminReset,
  }
}
