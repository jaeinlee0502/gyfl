import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import AdminDialog from './AdminDialog.vue'

const teachers = [
  { user_id: 'teacher-1', email: 'history@example.com', display_name: '역사 선생님', created_at: '2026-10-25T00:00:00Z' },
  { user_id: 'teacher-2', email: 'science@example.com', display_name: '과학 선생님', created_at: '2026-10-24T00:00:00Z' },
]

function createAccount() {
  return {
    configured: true,
    user: ref<{ id: string; email: string } | null>({ id: 'admin-1', email: 'admin@example.com' }),
    authReady: ref(true),
    isAdmin: ref(true),
    searchUsers: vi.fn().mockResolvedValue(teachers),
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

describe('관리자 계정 지원', () => {
  it.each(['guest', 'teacher'] as const)('권한 없는 %s에게 계정 검색과 재설정 도구를 제공하지 않는다', (identity) => {
    if (identity === 'guest') account.user.value = null
    else account.isAdmin.value = false
    const wrapper = mount(AdminDialog)
    expect(wrapper.get('[role="alert"]').text()).toContain('관리자만')
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.find('.admin-user-list').exists()).toBe(false)
    expect(account.searchUsers).not.toHaveBeenCalled()
    expect(account.sendAdminReset).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('두 글자 미만인 검색어는 서버에 보내지 않는다', async () => {
    const wrapper = mount(AdminDialog)
    await wrapper.get('#admin-search-query').setValue('김')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toContain('두 글자 이상')
    expect(account.searchUsers).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('선택한 이름 검색 기준과 정리한 검색어를 전달하고 계정 정보를 표시한다', async () => {
    const wrapper = mount(AdminDialog)
    await wrapper.get('#admin-search-field').setValue('name')
    await wrapper.get('#admin-search-query').setValue('  선생님  ')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(account.searchUsers).toHaveBeenCalledWith('선생님', 'name')
    expect(wrapper.findAll('.admin-user-card')).toHaveLength(2)
    expect(wrapper.get('.admin-result-count').text()).toContain('2명')
    expect(wrapper.findAll('.admin-user-card')[1]!.text()).toContain('science@example.com')
    expect(account.sendAdminReset).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('대상 선택만으로 보내지 않고 명시적으로 확인한 대상에게만 메일을 요청한다', async () => {
    const wrapper = mount(AdminDialog)
    await wrapper.get('#admin-search-query').setValue('example')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await wrapper.findAll('.admin-user-card button')[1]!.trigger('click')
    expect(wrapper.get('.admin-confirmation').text()).toContain('science@example.com')
    expect(account.sendAdminReset).not.toHaveBeenCalled()
    await wrapper.get('.admin-confirm-actions .account-secondary').trigger('click')
    expect(wrapper.find('.admin-confirmation').exists()).toBe(false)
    expect(account.sendAdminReset).not.toHaveBeenCalled()
    await wrapper.findAll('.admin-user-card button')[1]!.trigger('click')
    await wrapper.get('.admin-confirm-actions .account-primary').trigger('click')
    await flushPromises()
    expect(account.sendAdminReset).toHaveBeenCalledExactlyOnceWith('teacher-2')
    expect(wrapper.get('[role="status"]').text()).toBe('재설정 메일을 보냈어요.')
    expect(wrapper.find('.admin-confirmation').exists()).toBe(false)
    wrapper.unmount()
  })

  it('재설정 실패를 성공으로 표시하지 않고 오류와 선택 대상을 유지한다', async () => {
    account.sendAdminReset.mockRejectedValueOnce(new Error('메일 요청이 많아요. 잠시 후 다시 시도해 주세요.'))
    const wrapper = mount(AdminDialog)
    await wrapper.get('#admin-search-query').setValue('history')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await wrapper.get('.admin-user-card button').trigger('click')
    await wrapper.get('.admin-confirm-actions .account-primary').trigger('click')
    await flushPromises()
    expect(account.sendAdminReset).toHaveBeenCalledExactlyOnceWith('teacher-1')
    expect(wrapper.get('[role="alert"]').text()).toContain('메일 요청이 많아요')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.get('.admin-confirmation').text()).toContain('history@example.com')
    expect(wrapper.get('.admin-confirm-actions .account-primary').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })
})
