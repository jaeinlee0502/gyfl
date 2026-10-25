import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import AdminDialog from './AdminDialog.vue'

const temporaryPassword = 'Temporary-test-password-42'
const teachers = [
  { user_id: 'teacher-1', email: 'history@example.com', display_name: '역사 선생님', created_at: '2026-10-25T00:00:00Z' },
  { user_id: 'teacher-2', email: 'science@example.com', display_name: '과학 선생님', created_at: '2026-10-24T00:00:00Z' },
]
function createAccount() {
  return {
    configured: true,
    user: ref<{ id: string; email: string } | null>({ id: 'admin-1', email: 'admin@example.com' }),
    authReady: ref(true), isAdmin: ref(true),
    searchUsers: vi.fn().mockResolvedValue(teachers),
    resetUserPassword: vi.fn().mockResolvedValue({ message: '비밀번호를 초기화했어요.', temporaryPassword }),
    deleteUserAccount: vi.fn().mockResolvedValue('계정을 삭제했어요.'),
    sendAdminReset: vi.fn(),
  }
}
let account = createAccount()
vi.mock('../account', () => ({ useAccount: () => account }))

beforeEach(() => {
  account = createAccount()
  localStorage.clear()
  sessionStorage.clear()
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
})
async function search(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('#admin-search-query').setValue('example')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}

describe('관리자 계정 관리', () => {
  it.each(['guest', 'teacher'] as const)('권한 없는 %s에게 계정 도구를 제공하지 않는다', (identity) => {
    if (identity === 'guest') account.user.value = null
    else account.isAdmin.value = false
    const wrapper = mount(AdminDialog)
    expect(wrapper.get('[role="alert"]').text()).toContain('관리자만')
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.find('.admin-user-list').exists()).toBe(false)
    expect(account.searchUsers).not.toHaveBeenCalled()
    expect(account.resetUserPassword).not.toHaveBeenCalled()
    expect(account.deleteUserAccount).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('두 글자 미만 검색어는 보내지 않는다', async () => {
    const wrapper = mount(AdminDialog)
    await wrapper.get('#admin-search-query').setValue('김')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toContain('두 글자 이상')
    expect(account.searchUsers).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('선택한 이름 검색 기준과 정리한 검색어를 전달하고 계정을 표시한다', async () => {
    const wrapper = mount(AdminDialog)
    await wrapper.get('#admin-search-field').setValue('name')
    await wrapper.get('#admin-search-query').setValue('  선생님  ')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(account.searchUsers).toHaveBeenCalledWith('선생님', 'name')
    expect(wrapper.findAll('.admin-user-card')).toHaveLength(2)
    expect(wrapper.get('.admin-result-count').text()).toContain('2명')
    expect(wrapper.findAll('.admin-user-card')[1]!.text()).toContain('science@example.com')
    wrapper.unmount()
  })

  it('대상 확인 후에만 직접 초기화하며 서버 응답의 임시 비밀번호를 표시한다', async () => {
    const wrapper = mount(AdminDialog)
    await search(wrapper)
    expect(wrapper.find('#temporary-password').exists()).toBe(false)
    await wrapper.findAll('.admin-user-card .account-secondary')[1]!.trigger('click')
    expect(wrapper.get('.admin-confirmation').text()).toContain('science@example.com')
    expect(account.resetUserPassword).not.toHaveBeenCalled()
    await wrapper.get('.admin-confirm-actions .account-primary').trigger('click')
    await flushPromises()
    expect(account.resetUserPassword).toHaveBeenCalledExactlyOnceWith('teacher-2')
    expect(account.sendAdminReset).not.toHaveBeenCalled()
    const secret = wrapper.get('#temporary-password')
    expect(secret.attributes('type')).toBe('password')
    expect((secret.element as HTMLInputElement).value).toBe(temporaryPassword)
    expect(wrapper.get('#temporary-warning').text()).toContain('이 창을 닫으면 다시 표시되지 않아요')
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    await wrapper.get('.admin-temporary-actions .account-secondary').trigger('click')
    expect(secret.attributes('type')).toBe('text')
    await search(wrapper)
    expect(wrapper.find('#temporary-password').exists()).toBe(false)
    wrapper.unmount()
  })

  it('관리자가 직접 요청했을 때만 임시 비밀번호를 복사하고 닫으면 지운다', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const wrapper = mount(AdminDialog)
    await search(wrapper)
    await wrapper.get('.admin-user-card .account-secondary').trigger('click')
    await wrapper.get('.admin-confirm-actions .account-primary').trigger('click')
    await flushPromises()
    expect(writeText).not.toHaveBeenCalled()
    await wrapper.findAll('.admin-temporary-actions .account-secondary')[1]!.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledExactlyOnceWith(temporaryPassword)
    await wrapper.get('.account-close').trigger('click')
    expect(wrapper.find('#temporary-password').exists()).toBe(false)
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('삭제는 대상 아이디를 정확히 입력하고 확인해야 요청한다', async () => {
    const wrapper = mount(AdminDialog)
    await search(wrapper)
    await wrapper.findAll('.admin-user-card .account-danger-outline')[1]!.trigger('click')
    expect(account.deleteUserAccount).not.toHaveBeenCalled()
    const confirm = wrapper.get('.admin-confirm-actions .account-danger')
    expect(confirm.attributes('disabled')).toBeDefined()
    await wrapper.get('#admin-delete-email').setValue('history@example.com')
    expect(confirm.attributes('disabled')).toBeDefined()
    await wrapper.get('#admin-delete-email').setValue('science@example.com ')
    expect(confirm.attributes('disabled')).toBeDefined()
    await wrapper.get('#admin-delete-email').setValue('science@example.com')
    expect(confirm.attributes('disabled')).toBeUndefined()
    await confirm.trigger('click')
    await flushPromises()
    expect(account.deleteUserAccount).toHaveBeenCalledExactlyOnceWith('teacher-2', 'science@example.com')
    expect(wrapper.findAll('.admin-user-card')).toHaveLength(1)
    expect(wrapper.find('.admin-confirmation').exists()).toBe(false)
    expect(wrapper.get('[role="status"]').text()).toContain('계정을 삭제했어요')
    wrapper.unmount()
  })

  it('초기화 실패를 성공으로 표시하지 않고 오류와 선택 대상을 유지한다', async () => {
    account.resetUserPassword.mockRejectedValueOnce(new Error('초기화 요청이 많아요. 잠시 후 다시 시도해 주세요.'))
    const wrapper = mount(AdminDialog)
    await search(wrapper)
    await wrapper.get('.admin-user-card .account-secondary').trigger('click')
    await wrapper.get('.admin-confirm-actions .account-primary').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('초기화 요청이 많아요')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.find('#temporary-password').exists()).toBe(false)
    expect(wrapper.get('.admin-confirmation').text()).toContain('history@example.com')
    wrapper.unmount()
  })

  it('삭제 실패를 표시하고 계정과 확인 입력을 유지한다', async () => {
    account.deleteUserAccount.mockRejectedValueOnce(new Error('관리자 계정은 삭제할 수 없어요.'))
    const wrapper = mount(AdminDialog)
    await search(wrapper)
    await wrapper.get('.admin-user-card .account-danger-outline').trigger('click')
    await wrapper.get('#admin-delete-email').setValue('history@example.com')
    await wrapper.get('.admin-confirm-actions .account-danger').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('삭제할 수 없어요')
    expect(wrapper.findAll('.admin-user-card')).toHaveLength(2)
    expect(wrapper.get('.admin-confirmation').text()).toContain('history@example.com')
    expect((wrapper.get('#admin-delete-email').element as HTMLInputElement).value).toBe('history@example.com')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
