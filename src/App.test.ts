import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import type { Question } from './data'
import App from './App.vue'

const teacher = { id: 'teacher-1', email: 'teacher@example.test', user_metadata: { display_name: '역사 선생님' } } as unknown as User
function createAccount() {
  return {
    configured: true, user: ref<User | null>(teacher), authReady: ref(true), authBusy: ref(false),
    isAdmin: ref(false), isSchoolMember: ref(true), accessReady: ref(true), schoolAccessError: ref(''),
    recoveryMode: ref(false), recoveryLinkError: ref(false), authNotice: ref(''),
    refreshSchoolAccess: vi.fn().mockResolvedValue(undefined), signOut: vi.fn().mockResolvedValue(undefined),
  }
}
const exam = (id: string, number: number, title: string, tags: string[], overrides: Partial<Question> = {}): Question => ({
  id, subject: '한국사', grade: 1, year: 2025, month: 3, number, title, tags, prompt: title,
  passage: '검색을 위한 문제 내용', choices: [], answer: 0, explanation: '', kind: 'exam', curriculum: 'unverified',
  imageUrl: `blob:question-${number}`, width: 900, height: 1200, points: 3, sourcePage: 1,
  explanationUrl: 'https://www.ebsi.co.kr/ebs/xip/xipa/retrieveSCVMainInfo.ebs?irecord=202503261',
  ...overrides,
})
const records = [
  exam('exam-1', 1, '선사 시대의 생활', ['선사·고대', '신석기']),
  exam('exam-20', 20, '현대 사회와 전쟁', ['현대사', '정치사']),
  exam('exam-21', 21, '민주주의의 변화', ['현대사', '정치사'], { grade: 2, year: 2026, month: 9 }),
]
function createLibrary() {
  const questionItems = ref<Question[]>([])
  return {
    questionItems, loading: ref(false), error: ref(''),
    loadQuestions: vi.fn(async () => { questionItems.value = [...records] }),
    clearQuestions: vi.fn(() => { questionItems.value = [] }),
  }
}
function createBookmarks() {
  const saved = ref<string[]>([])
  return {
    saved, guestToImport: ref<string[]>([]), loading: ref(false), loadFailed: ref(false), disabled: ref(false),
    pending: ref<string[]>([]), importing: ref(false), message: ref(''),
    toggleSaved: vi.fn((id: string) => { saved.value = saved.value.includes(id) ? saved.value.filter(x => x !== id) : [...saved.value, id] }),
    importGuestSaved: vi.fn(), reloadSaved: vi.fn(),
  }
}
let account = createAccount()
let library = createLibrary()
let bookmarks = createBookmarks()
vi.mock('./account', () => ({ useAccount: () => account, initializeAccount: vi.fn() }))
vi.mock('./questions', () => ({ useQuestionLibrary: () => library }))
vi.mock('./bookmarks', () => ({ useBookmarks: () => bookmarks }))

beforeEach(() => {
  localStorage.clear()
  account = createAccount(); library = createLibrary(); bookmarks = createBookmarks()
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
})

describe('학교 서재 입장과 문제 탐색', () => {
  it('로그인하지 않은 방문자에게 문제·메뉴·검색을 표시하거나 요청하지 않는다', async () => {
    account.user.value = null
    library.questionItems.value = [...records]
    const wrapper = mount(App)
    expect(wrapper.find('.school-entrance').exists()).toBe(true)
    expect(wrapper.text()).toContain('로그인하고 입장하기')
    expect(wrapper.find('.sidebar').exists()).toBe(false)
    expect(wrapper.find('.question-card').exists()).toBe(false)
    expect(wrapper.find('[aria-label="문제 검색"]').exists()).toBe(false)
    expect(library.loadQuestions).not.toHaveBeenCalled()
    expect(library.questionItems.value).toEqual([])
    await wrapper.get('.entrance-primary').trigger('click')
    expect(wrapper.find('.account-dialog').exists()).toBe(true)
    wrapper.unmount()
  })

  it('로그인 후에도 승인 전이거나 권한 확인 중이면 서재를 열지 않는다', async () => {
    account.isSchoolMember.value = false
    account.accessReady.value = false
    const wrapper = mount(App)
    expect(wrapper.text()).toContain('이용 권한을 확인하고 있어요')
    expect(library.loadQuestions).not.toHaveBeenCalled()
    account.accessReady.value = true
    await flushPromises()
    expect(wrapper.text()).toContain('관리자 승인을 기다리고 있어요')
    await wrapper.get('.entrance-primary').trigger('click')
    expect(account.refreshSchoolAccess).toHaveBeenCalledOnce()
    account.isSchoolMember.value = true
    await flushPromises()
    expect(wrapper.findAll('.question-card')).toHaveLength(3)
    wrapper.unmount()
  })

  it('승인된 계정만 문제 이미지와 공식 EBS 해설 링크를 본다', async () => {
    const wrapper = mount(App)
    await flushPromises()
    expect(library.loadQuestions).toHaveBeenCalledOnce()
    expect(wrapper.findAll('.exam-question-image')).toHaveLength(3)
    expect(wrapper.findAll('.external-explanation')).toHaveLength(3)
    expect(wrapper.get('.external-explanation').attributes('href')).toContain('www.ebsi.co.kr')
    expect(wrapper.find('.answer-panel').exists()).toBe(false)
    expect(wrapper.find('.choices').exists()).toBe(false)
    await wrapper.findAll('.tags button').find(b => b.text().includes('현대사'))!.trigger('click')
    expect(wrapper.findAll('.question-card')).toHaveLength(2)
    await wrapper.get('.select-row select').setValue('1')
    expect(wrapper.findAll('.question-card')).toHaveLength(1)
    expect(wrapper.get('.question-card').text()).toContain('현대 사회와 전쟁')
    await wrapper.get('.filter-reset').trigger('click')
    expect(wrapper.findAll('.question-card')).toHaveLength(3)
    wrapper.unmount()
  })

  it('과목·내용 검색·계정별 저장 필터를 적용한다', async () => {
    const wrapper = mount(App)
    await flushPromises()
    await wrapper.get('[aria-label="문제 검색"]').setValue('#신석기')
    expect(wrapper.findAll('.question-card')).toHaveLength(1)
    await wrapper.get('.bookmark-button').trigger('click')
    expect(bookmarks.toggleSaved).toHaveBeenCalledWith('exam-1')
    await wrapper.get('.filter-reset').trigger('click')
    await wrapper.get('.saved-filter').trigger('click')
    expect(wrapper.findAll('.question-card')).toHaveLength(1)
    await wrapper.get('.filter-reset').trigger('click')
    await wrapper.findAll('.subject-tabs button').find(b => b.text().includes('통합과학'))!.trigger('click')
    expect(wrapper.findAll('.question-card')).toHaveLength(0)
    expect(wrapper.get('.empty-state').text()).toContain('자료를 준비하고 있어요')
    wrapper.unmount()
  })

  it('승인 철회나 로그아웃 시 문항·모달·이미지 메모리를 지운다', async () => {
    const wrapper = mount(App)
    await flushPromises()
    expect(wrapper.findAll('.question-card')).toHaveLength(3)
    account.isSchoolMember.value = false
    await flushPromises()
    expect(wrapper.find('.question-card').exists()).toBe(false)
    expect(wrapper.find('.sidebar').exists()).toBe(false)
    expect(library.questionItems.value).toEqual([])
    expect(library.clearQuestions).toHaveBeenCalled()
    account.user.value = null
    await flushPromises()
    expect(wrapper.text()).toContain('로그인하고 입장하기')
    wrapper.unmount()
  })

  it('권한 조회 실패 및 문제 로드 실패에서 재시도할 수 있다', async () => {
    account.isSchoolMember.value = false
    account.schoolAccessError.value = '권한 확인 연결 실패'
    const wrapper = mount(App)
    expect(wrapper.text()).toContain('권한 확인 연결 실패')
    account.isSchoolMember.value = true
    await flushPromises()
    library.error.value = '문제 연결 실패'
    library.questionItems.value = []
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('문제 연결 실패')
    await wrapper.get('[role="alert"] button').trigger('click')
    expect(library.loadQuestions).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })
})
