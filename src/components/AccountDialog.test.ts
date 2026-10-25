import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import AccountDialog from './AccountDialog.vue'

function createAccount() {
  return {
    configured: true,
    user: ref<{ id: string; email: string } | null>(null),
    authReady: ref(true), authBusy: ref(false), isAdmin: ref(false), recoveryMode: ref(false),
    recoveryLinkError: ref(false), authNotice: ref(''),
    signIn: vi.fn().mockResolvedValue(undefined),
    signUp: vi.fn().mockResolvedValue({ needsEmailConfirmation: false }),
    requestPasswordReset: vi.fn(),
    updatePassword: vi.fn().mockResolvedValue(undefined), clearRecovery: vi.fn(),
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

  it('이메일 형식 아이디로 로그인하고 성공 후 창을 닫는다', async () => {
    const wrapper = mount(AccountDialog)
    expect(wrapper.get('#account-email').attributes('type')).toBe('email')
    await wrapper.get('#account-email').setValue('teacher@example.com')
    await wrapper.get('#account-password').setValue('password-example-1')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(account.signIn).toHaveBeenCalledExactlyOnceWith('teacher@example.com', 'password-example-1')
    expect(wrapper.emitted('close')).toHaveLength(1)
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

  it('메일 확인 없는 가입 성공을 처리하고 메일 발송을 요청하지 않는다', async () => {
    const wrapper = mount(AccountDialog)
    await wrapper.findAll('.account-tabs button')[1]!.trigger('click')
    await wrapper.get('#account-name').setValue('역사 선생님')
    await wrapper.get('#account-email').setValue('teacher@example.com')
    await wrapper.get('#account-password').setValue('password-example-1')
    await wrapper.get('#account-confirmation').setValue('password-example-1')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(account.signUp).toHaveBeenCalledWith('teacher@example.com', 'password-example-1', '역사 선생님')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(account.requestPasswordReset).not.toHaveBeenCalled()
    expect((wrapper.get('#account-password').element as HTMLInputElement).value).toBe('')
    wrapper.unmount()
  })

  it('가입 서버 설정이 미완료이면 메일을 보냈다고 표시하지 않는다', async () => {
    account.signUp.mockResolvedValue({ needsEmailConfirmation: true })
    const wrapper = mount(AccountDialog)
    await wrapper.findAll('.account-tabs button')[1]!.trigger('click')
    await wrapper.get('#account-name').setValue('역사 선생님')
    await wrapper.get('#account-email').setValue('teacher@example.com')
    await wrapper.get('#account-password').setValue('password-example-1')
    await wrapper.get('#account-confirmation').setValue('password-example-1')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('가입 설정이 아직 완료되지 않았어요')
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.text()).not.toContain('메일을 보냈어요')
    wrapper.unmount()
  })

  it('찾기 화면은 관리자 문의만 안내하고 메일 발송 폼을 만들지 않는다', async () => {
    const wrapper = mount(AccountDialog)
    await wrapper.get('.account-form-footer button').trigger('click')
    expect(wrapper.get('h2').text()).toBe('아이디 · 비밀번호 찾기')
    expect(wrapper.text()).toContain('관리자에게 이름과 아이디')
    expect(wrapper.text()).toContain('임시 비밀번호')
    expect(wrapper.find('form').exists()).toBe(false)
    expect(account.requestPasswordReset).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('로그인한 교사는 비밀번호 변경 모드에서 새 비밀번호를 정할 수 있다', async () => {
    account.user.value = { id: 'teacher-1', email: 'teacher@example.com' }
    const wrapper = mount(AccountDialog, { props: { mode: 'password' } })
    expect(wrapper.get('h2').text()).toBe('새 비밀번호 설정')
    expect(wrapper.get('.account-recovery-email').text()).toContain('teacher@example.com')
    expect(wrapper.find('.account-tabs').exists()).toBe(false)
    await wrapper.get('#account-password').setValue('new-password-example')
    await wrapper.get('#account-confirmation').setValue('new-password-example')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(account.updatePassword).toHaveBeenCalledWith('new-password-example')
    expect(wrapper.get('h2').text()).toBe('비밀번호를 변경했어요')
    wrapper.unmount()
  })

  it('이전 복구 세션에서도 변경 성공 후에만 복구 상태를 해제한다', async () => {
    account.user.value = { id: 'teacher-1', email: 'teacher@example.com' }
    account.recoveryMode.value = true
    const wrapper = mount(AccountDialog)
    await wrapper.get('#account-password').setValue('new-password-example')
    await wrapper.get('#account-confirmation').setValue('new-password-example')
    expect(account.clearRecovery).not.toHaveBeenCalled()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(account.updatePassword).toHaveBeenCalledWith('new-password-example')
    expect(account.clearRecovery).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
})
