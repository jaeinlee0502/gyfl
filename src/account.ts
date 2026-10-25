import { ref } from 'vue'
import type { User } from '@supabase/supabase-js'
import { accountRedirectUrl, supabase } from './lib/supabase'

export interface AccountSummary {
  user_id: string
  email: string
  display_name: string
  created_at: string
  approved: boolean
  is_admin: boolean
}

const user = ref<User | null>(null)
const authReady = ref(!supabase)
const authBusy = ref(false)
const isAdmin = ref(false)
const isSchoolMember = ref(false)
const accessReady = ref(!supabase)
const schoolAccessError = ref('')
const recoveryMode = ref(false)
const recoveryLinkError = ref(false)
const authNotice = ref('')
const callbackParams = new URLSearchParams(window.location.hash.slice(1))
const recoveryCallback = callbackParams.get('type') === 'recovery'
const callbackHasError = callbackParams.has('error') || callbackParams.has('error_code')
let initialized = false
let identityVersion = 0
let accessVersion = 0

function requireClient() {
  if (!supabase) throw new Error('학교 서재 연결을 준비 중이에요. 관리자에게 문의해 주세요.')
  return supabase
}

function explainAuthError(error: { code?: string; status?: number }) {
  if (error.status === 429 || error.code?.includes('rate_limit')) return '요청이 잠시 많아요. 잠시 후 다시 시도해 주세요.'
  switch (error.code) {
    case 'invalid_credentials': return '이메일 또는 비밀번호를 확인해 주세요.'
    case 'email_not_confirmed': return '가입 확인 메일을 먼저 확인해 주세요.'
    case 'email_address_not_authorized': return '가입·복구 메일 발송 설정을 준비 중이에요. 사이트 관리자에게 문의해 주세요.'
    case 'email_address_invalid': return '이메일 주소를 다시 확인해 주세요.'
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
  ++accessVersion
  isAdmin.value = false
  isSchoolMember.value = false
  accessReady.value = !next || !supabase
  schoolAccessError.value = ''
  user.value = next
  authReady.value = true
  if (!next || !supabase) return
  // Never await another Supabase operation inside onAuthStateChange's lock.
  window.setTimeout(() => {
    if (version === identityVersion) void refreshSchoolAccess()
  }, 0)
}

async function refreshSchoolAccess() {
  const id = user.value?.id
  const identity = identityVersion
  const access = ++accessVersion
  // Keep an already verified session visible during a routine recheck. Identity
  // changes clear access synchronously in acceptIdentity before changing user.
  if (!accessReady.value || !isSchoolMember.value) {
    accessReady.value = false
    isSchoolMember.value = false
    isAdmin.value = false
  }
  schoolAccessError.value = ''
  if (!id || !supabase) {
    accessReady.value = true
    return
  }
  try {
    const [administrator, membership] = await Promise.all([
      supabase.from('account_admins').select('user_id').eq('user_id', id).maybeSingle(),
      supabase.from('school_members').select('user_id').eq('user_id', id).maybeSingle(),
    ])
    if (administrator.error || membership.error) throw new Error('membership lookup failed')
    if (identity !== identityVersion || access !== accessVersion || user.value?.id !== id) return
    isAdmin.value = Boolean(administrator.data)
    isSchoolMember.value = Boolean(administrator.data || membership.data)
  } catch {
    if (identity !== identityVersion || access !== accessVersion || user.value?.id !== id) return
    isAdmin.value = false
    isSchoolMember.value = false
    schoolAccessError.value = '학교 서재 이용 권한을 확인하지 못했어요. 다시 확인해 주세요.'
  } finally {
    if (identity === identityVersion && access === accessVersion && user.value?.id === id) accessReady.value = true
  }
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
    else if (session) {
      user.value = session.user
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') window.setTimeout(() => { void refreshSchoolAccess() }, 0)
    }
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
        ? '이전 로그인 링크가 만료되었거나 유효하지 않아요. 비밀번호를 잊으셨다면 관리자에게 문의해 주세요.'
        : '로그인 상태를 확인하지 못했어요. 다시 로그인해 주세요.'
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
    if (code === 'RESET_COOLDOWN' || code === 'RESET_RATE_LIMIT') throw new Error('계정 지원 요청을 잠시 쉬어 주세요. 같은 계정은 1분 뒤 다시 시도할 수 있어요.')
    if (code === 'ADMIN_REQUIRED' || code === 'UNAUTHENTICATED') throw new Error('관리자 권한 또는 로그인 상태를 확인해 주세요.')
    if (code === 'ACCOUNT_NOT_FOUND') throw new Error('계정을 찾지 못했어요. 다시 검색해 주세요.')
    if (code === 'PROTECTED_ACCOUNT') throw new Error('관리자 계정의 이용 권한이나 계정은 이 화면에서 변경할 수 없어요.')
    if (code === 'MEMBERSHIP_UPDATE_FAILED') throw new Error('서재 이용 권한을 변경하지 못했어요. 잠시 후 다시 시도해 주세요.')
    if (code === 'CONFIRMATION_MISMATCH') throw new Error('삭제할 계정의 이메일 아이디를 정확히 입력해 주세요.')
    if (code === 'PASSWORD_RESET_FAILED') throw new Error('비밀번호를 초기화하지 못했어요. 잠시 후 다시 시도해 주세요.')
    if (code === 'ACCOUNT_DELETE_FAILED') throw new Error('계정을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.')
    throw new Error('관리자 서비스에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.')
  }
  return data as T
}

async function searchUsers(query: string, field: 'email' | 'name') {
  const data = await adminRequest<{ users: AccountSummary[] }>({ action: 'search', query: query.trim(), field })
  return data.users
}

async function listMembers() {
  const data = await adminRequest<{ users: AccountSummary[] }>({ action: 'list-members' })
  return data.users
}

async function approveMember(userId: string) {
  const data = await adminRequest<{ message: string; approved: boolean }>({ action: 'approve-member', userId })
  return data.message
}

async function revokeMember(userId: string) {
  const data = await adminRequest<{ message: string; approved: boolean }>({ action: 'revoke-member', userId })
  return data.message
}

async function resetUserPassword(userId: string) {
  return adminRequest<{ message: string; temporaryPassword: string }>({ action: 'reset-password', userId })
}

async function deleteUserAccount(userId: string, confirmEmail: string) {
  const data = await adminRequest<{ message: string }>({ action: 'delete-account', userId, confirmEmail })
  return data.message
}

export function useAccount() {
  return {
    configured: Boolean(supabase), user, authReady, authBusy, isAdmin, isSchoolMember, accessReady, schoolAccessError, recoveryMode, recoveryLinkError, authNotice,
    signIn, signUp, updatePassword, signOut,
    refreshSchoolAccess, listMembers, approveMember, revokeMember,
    clearRecovery: () => { recoveryMode.value = false; recoveryLinkError.value = false; authNotice.value = '' }, searchUsers, resetUserPassword, deleteUserAccount,
  }
}
