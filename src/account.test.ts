import type { User } from '@supabase/supabase-js'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const backend = vi.hoisted(() => ({
  from: vi.fn(), maybeSingle: vi.fn(), eq: vi.fn(), select: vi.fn(), invoke: vi.fn(),
  getSession: vi.fn(), onAuthStateChange: vi.fn(), signOut: vi.fn(),
  initialize: vi.fn(),
  callback: undefined as undefined | ((event: string, session: { user: User } | null) => void),
}))

vi.mock('./lib/supabase', () => ({
  accountRedirectUrl: () => 'https://example.test/gyfl/',
  supabase: {
    from: backend.from,
    functions: { invoke: backend.invoke },
    auth: {
      getSession: backend.getSession,
      initialize: backend.initialize,
      onAuthStateChange: backend.onAuthStateChange,
      signOut: backend.signOut,
    },
  },
}))

const adminLikeUser = { id: 'teacher-a', email: 'teacher@example.test', user_metadata: { role: 'admin', is_admin: true } } as unknown as User

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.clearAllMocks()
  backend.callback = undefined
  backend.getSession.mockResolvedValue({ data: { session: { user: adminLikeUser } }, error: null })
  backend.initialize.mockResolvedValue({ error: null })
  backend.maybeSingle.mockResolvedValue({ data: null, error: null })
  backend.eq.mockReturnValue({ maybeSingle: backend.maybeSingle })
  backend.select.mockReturnValue({ eq: backend.eq })
  backend.from.mockReturnValue({ select: backend.select })
  backend.signOut.mockResolvedValue({ error: null })
  backend.onAuthStateChange.mockImplementation((callback: typeof backend.callback) => {
    backend.callback = callback
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
})

afterEach(() => { vi.useRealTimers() })

describe('관리자 권한과 인증 상태', () => {
  it('사용자 메타데이터가 admin이어도 관리자 테이블에서 확인되지 않으면 권한을 주지 않는다', async () => {
    const { initializeAccount, useAccount } = await import('./account')
    const state = useAccount()
    await initializeAccount()
    await vi.runAllTimersAsync()
    expect(state.user.value?.id).toBe('teacher-a')
    expect(backend.from).toHaveBeenCalledWith('account_admins')
    expect(backend.eq).toHaveBeenCalledWith('user_id', 'teacher-a')
    expect(state.isAdmin.value).toBe(false)
    await expect(state.searchUsers('teacher', 'email')).rejects.toThrow('관리자 권한')
    expect(backend.invoke).not.toHaveBeenCalled()
  })

  it('로그아웃 후 도착한 관리자 조회 결과로 권한이 되살아나지 않는다', async () => {
    let resolve!: (value: { data: { user_id: string }; error: null }) => void
    backend.maybeSingle.mockReturnValue(new Promise(done => { resolve = done }))
    const { initializeAccount, useAccount } = await import('./account')
    const state = useAccount()
    await initializeAccount()
    await vi.runAllTimersAsync()
    await state.signOut()
    resolve({ data: { user_id: 'teacher-a' }, error: null })
    await flushPromises()
    expect(state.user.value).toBeNull()
    expect(state.isAdmin.value).toBe(false)
    expect(backend.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('복구 링크 이벤트로 비밀번호 변경 모드를 열고 로그아웃하면 복구 상태도 지운다', async () => {
    backend.getSession.mockResolvedValue({ data: { session: null }, error: null })
    const { initializeAccount, useAccount } = await import('./account')
    const state = useAccount()
    await initializeAccount()
    backend.callback!('PASSWORD_RECOVERY', { user: adminLikeUser })
    expect(state.recoveryMode.value).toBe(true)
    await state.signOut()
    expect(state.recoveryMode.value).toBe(false)
    expect(state.user.value).toBeNull()
  })

  it('만료된 복구 링크의 초기화 오류를 알리고 콜백 오류를 주소에서 지운다', async () => {
    history.replaceState(null, '', '/gyfl/#error=access_denied&error_code=otp_expired')
    backend.initialize.mockResolvedValue({ error: { code: 'otp_expired' } })
    const { initializeAccount, useAccount } = await import('./account')
    const state = useAccount()
    await initializeAccount()
    expect(state.recoveryLinkError.value).toBe(true)
    expect(state.authNotice.value).toContain('만료')
    expect(state.recoveryMode.value).toBe(false)
    expect(location.hash).toBe('')
    expect(backend.getSession).not.toHaveBeenCalled()
  })
})
