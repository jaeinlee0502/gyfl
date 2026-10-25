import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import AccountDialog from './AccountDialog.vue'
import AdminDialog from './AdminDialog.vue'

function createAccount() {
  return {
    configured: true,
    user: ref<{ id: string; email: string } | null>(null),
    authReady: ref(true), authBusy: ref(false), isAdmin: ref(false), recoveryMode: ref(false),
    signIn: vi.fn().mockResolvedValue(undefined),
    signUp: vi.fn().mockResolvedValue({ needsEmailConfirmation: true }),
    requestPasswordReset: vi.fn().mockResolvedValue(undefined),
    updatePassword: vi.fn().mockResolvedValue(undefined), clearRecovery: vi.fn(),
    searchUsers: vi.fn().mockResolvedValue([]),
    sendAdminReset: vi.fn().mockResolvedValue('재설정 메일을 보냈어요.'),
  }
}
let account = createAccount()
vi.mock('../account', () => ({ useAccount: () => account }))

beforeEach(() => {
  account = createAccount()
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
})

describe('계정 창', () => {
  it('미연결 상태를 설명하고 가짜 로그인 요청을 하지 않는다', async () => {
    account.configured = false
    const wrapper = mount(AccountDialog)
    expect(wrapper.get('[role="status"]').text()).toContain('계정 기능을 준비 중')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await wrapper.get('form').trigger('submit')
    expect(account.signIn).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('회원가입 비밀번호 확인이 다르면 서버에 보내지 않는다', async () => {
    const wrapper = mount(AccountDialog)
    await wrapper.findAll('.account-tabs button')[1]!.trigger('click')
    await wrapper.get('#account-name').setValue('역사 선생님')
    await wrapper.get('#account-email').setValue('teacher@example.com')
    await wrapper.get('#account-password').setValue('password-example-1')
    await wrapper.get('#account-confirmation').setValue('password-example-2')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toContain('일치하지 않아요')
    expect(account.signUp).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('이메일 확인이 필요한 가입은 로그인 완료로 표시하지 않는다', async () => {
    const wrapper = mount(AccountDialog)
    await wrapper.findAll('.account-tabs button')[1]!.trigger('click')
    await wrapper.get('#account-name').setValue('역사 선생님')
    await wrapper.get('#account-email').setValue('teacher@example.com')
    await wrapper.get('#account-password').setValue('password-example-1')
    await wrapper.get('#account-confirmation').setValue('password-example-1')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(account.signUp).toHaveBeenCalledWith('teacher@example.com', 'password-example-1', '역사 선생님')
    expect(wrapper.get('[role="status"]').text()).toContain('이메일의 확인 링크')
    expect(wrapper.emitted('close')).toBeUndefined()
    expect((wrapper.get('#account-password').element as HTMLInputElement).value).toBe('')
    wrapper.unmount()
  })
  it('복구 세션에서 새 비밀번호를 정한 뒤에만 복구 상태를 해제한다', async () => {
    account.recoveryMode.value = true
    const wrapper = mount(AccountDialog)
    expect(wrapper.get('h2').text()).toBe('새 비밀번호 설정')
    await wrapper.get('#account-password').setValue('new-password-example')
    await wrapper.get('#account-confirmation').setValue('new-password-example')
    expect(account.clearRecovery).not.toHaveBeenCalled()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(account.updatePassword).toHaveBeenCalledWith('new-password-example')
    expect(account.clearRecovery).toHaveBeenCalledOnce()
    expect(wrapper.get('h2').text()).toBe('비밀번호를 변경했어요')
    wrapper.unmount()
  })
})

describe('관리자 계정 지원 창', () => {
  it('일반 계정에는 검색 도구를 보여주지 않는다', () => {
    account.user.value = { id: 'teacher-1', email: 'teacher@example.com' }
    const wrapper = mount(AdminDialog)
    expect(wrapper.get('[role="alert"]').text()).toContain('관리자만')
    expect(wrapper.find('form').exists()).toBe(false)
    expect(account.searchUsers).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('계정을 고른 뒤 한 번 더 확인해야 재설정 메일을 보낸다', async () => {
    account.user.value = { id: 'admin-1', email: 'admin@example.com' }
    account.isAdmin.value = true
    account.searchUsers.mockResolvedValue([{ user_id: 'teacher-1', email: 'teacher@example.com', display_name: '역사 선생님', created_at: '2026-10-25T00:00:00Z' }])
    const wrapper = mount(AdminDialog)
    await wrapper.get('#admin-search-query').setValue('teacher')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(account.searchUsers).toHaveBeenCalledWith('teacher', 'email')
    await wrapper.get('.admin-user-card button').trigger('click')
    expect(wrapper.get('.admin-confirmation').text()).toContain('teacher@example.com')
    expect(account.sendAdminReset).not.toHaveBeenCalled()
    await wrapper.get('.admin-confirm-actions .account-primary').trigger('click')
    await flushPromises()
    expect(account.sendAdminReset).toHaveBeenCalledWith('teacher-1')
    expect(wrapper.get('[role="status"]').text()).toContain('재설정 메일을 보냈어요')
    expect(wrapper.find('.admin-confirmation').exists()).toBe(false)
    wrapper.unmount()
  })
})
