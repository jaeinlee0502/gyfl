import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { passageImageKey, type ExamImportRecord, type ExamPdfAnalysis, type ImportPassageDraft, type ImportQuestionDraft } from '../import-types'
import ExamImportDialog from './ExamImportDialog.vue'

const question = (): ImportQuestionDraft => ({
  clientId: '22222222-2222-4222-8222-222222222222', number: 1, title: '신석기 시대의 생활',
  tags: ['선사·고대'], points: 2, searchText: '빗살무늬 토기', reviewed: false,
  regions: [{ page: 1, left: .1, top: .1, right: .49, bottom: .8 }],
})
const passage = (): ImportPassageDraft => ({
  clientId: '33333333-3333-4333-8333-333333333333', title: '1~3번 공통 지문', searchText: '공통 지문 내용', reviewed: false,
  regions: [{ page: 1, left: .1, top: .1, right: .49, bottom: .8 }, { page: 1, left: .51, top: .1, right: .9, bottom: .6 }],
})
const metadata = { subject: '한국사' as const, grade: 1 as const, year: 2025, month: 3 as const,
  sourceUrl: 'https://www.ebsi.co.kr/ebs/exam', explanationUrl: 'https://www.ebsi.co.kr/ebs/exam' }
const record = (): ExamImportRecord => ({
  id: '11111111-1111-4111-8111-111111111111', file_name: 'history.pdf', sha256: 'a'.repeat(64),
  page_count: 1, source_path: 'imports/11111111-1111-4111-8111-111111111111/source.pdf',
  status: 'draft', metadata: { ...metadata }, questions: [question()], created_at: '2026-10-25T00:00:00Z', published_at: null,
})
function createAccount() {
  return { configured: true, user: ref<{ id: string } | null>({ id: 'admin-1' }), authReady: ref(true), isAdmin: ref(true) }
}
function createApi() {
  return {
    listImports: vi.fn().mockResolvedValue([]), createImport: vi.fn().mockResolvedValue(record()),
    getImport: vi.fn().mockResolvedValue(record()), downloadPdf: vi.fn().mockResolvedValue(new Blob(['%PDF-test'], { type: 'application/pdf' })),
    saveDraft: vi.fn().mockResolvedValue(record()), publishImport: vi.fn().mockResolvedValue({ message: '등록했습니다.', count: 1 }),
    deleteDraft: vi.fn().mockResolvedValue('초안을 삭제했어요.'), deleteImport: vi.fn().mockResolvedValue('등록 자료를 삭제했어요.'), cancelPending: vi.fn(),
  }
}
function createPdf() {
  const image = { blob: new Blob(['image'], { type: 'image/webp' }), width: 640, height: 800 }
  return {
    pageCount: 1,
    analyze: vi.fn().mockResolvedValue({ metadata: { ...metadata }, pageCount: 1, questions: [question()], warnings: [] } satisfies ExamPdfAnalysis),
    renderQuestion: vi.fn().mockResolvedValue(image), renderPage: vi.fn().mockResolvedValue(image),
    regionText: vi.fn().mockResolvedValue('수정한 영역의 검색용 문제 내용'), destroy: vi.fn().mockResolvedValue(undefined),
  }
}
let account = createAccount()
let api = createApi()
let pdf = createPdf()
const openPdf = vi.hoisted(() => vi.fn())
const titleRecommendation = vi.hoisted(() => vi.fn())
vi.mock('../account', () => ({ useAccount: () => account }))
vi.mock('../exam-imports', () => ({ useExamImports: () => api }))
vi.mock('../pdf-import', () => ({ openExamPdf: openPdf }))
vi.mock('../question-titles', () => ({ suggestQuestionTitle: titleRecommendation }))

beforeEach(() => {
  vi.unstubAllGlobals()
  account = createAccount(); api = createApi(); pdf = createPdf()
  openPdf.mockReset().mockResolvedValue(pdf)
  titleRecommendation.mockReset().mockReturnValue('새로 추천한 주제 제목')
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn().mockReturnValue('blob:question-preview') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  vi.stubGlobal('crypto', { randomUUID: () => question().clientId, subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer) } })
})

type Wrapper = ReturnType<typeof mount<typeof ExamImportDialog>>
function button(wrapper: Wrapper, label: string) {
  const match = wrapper.findAll('button').find(candidate => candidate.text().includes(label))
  if (!match) throw new Error(`Button not found: ${label}`)
  return match
}
async function choosePdf(wrapper: Wrapper) {
  const file = new File(['%PDF-test'], 'history.pdf', { type: 'application/pdf' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1, 2, 3]).buffer })
  Object.defineProperty(wrapper.get('input[type="file"]').element, 'files', { configurable: true, value: [file] })
  await wrapper.get('input[type="file"]').trigger('change')
  await button(wrapper, 'PDF 분석·업로드').trigger('click')
  await flushPromises()
  return file
}

describe('관리자 PDF 업로드와 검수', () => {
  it.each(['guest', 'teacher'] as const)('권한 없는 %s에게 업로드·초안 기능을 열지 않는다', async role => {
    if (role === 'guest') account.user.value = null
    else account.isAdmin.value = false
    const wrapper = mount(ExamImportDialog)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('관리자만')
    expect(wrapper.find('input[type="file"]').exists()).toBe(false)
    expect(api.listImports).not.toHaveBeenCalled()
    expect(api.createImport).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('PDF를 읽고 업로드한 뒤 문항을 확인해야 서재에 등록할 수 있다', async () => {
    const wrapper = mount(ExamImportDialog)
    const file = await choosePdf(wrapper)
    expect(openPdf).toHaveBeenCalledExactlyOnceWith(file)
    expect(api.createImport).toHaveBeenCalledWith(file, '00'.repeat(32), 1)
    expect(wrapper.findAll('.import-question-card')).toHaveLength(1)
    expect(wrapper.get('.import-question-preview').attributes('src')).toBe('blob:question-preview')
    expect((wrapper.get('.import-metadata-grid select').element as HTMLSelectElement).value).toBe('한국사')
    const publish = wrapper.get('.import-publish-bar .import-primary')
    expect(publish.attributes('disabled')).toBeDefined()
    await publish.trigger('click')
    expect(api.publishImport).not.toHaveBeenCalled()
    await wrapper.get('.import-reviewed input').setValue(true)
    expect(publish.attributes('disabled')).toBeUndefined()
    await publish.trigger('click')
    await flushPromises()
    expect(api.publishImport).toHaveBeenCalledWith(record().id, metadata,
      expect.arrayContaining([expect.objectContaining({ reviewed: true, number: 1 })]), expect.any(Map), [], expect.any(Map))
    expect(wrapper.emitted('published')).toEqual([[{ count: 1, subject: '한국사' }]])
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:question-preview')
    wrapper.unmount()
  })

  it('시험 정보나 문항 영역을 수정하면 다시 검토해야 한다', async () => {
    const wrapper = mount(ExamImportDialog)
    await choosePdf(wrapper)
    const reviewed = wrapper.get('.import-reviewed input')
    await reviewed.setValue(true)
    await wrapper.get('.import-metadata-grid input[type="number"]').setValue('2026')
    expect((reviewed.element as HTMLInputElement).checked).toBe(false)
    await reviewed.setValue(true)
    await button(wrapper, '영역 조정').trigger('click')
    await flushPromises()
    expect(wrapper.get('.import-publish-bar .import-primary').attributes('disabled')).toBeDefined()
    expect(button(wrapper, '초안 저장').attributes('disabled')).toBeDefined()
    await wrapper.get('.import-region-fields input[type="number"]').setValue('12')
    await button(wrapper, '영역 적용·미리보기 갱신').trigger('click')
    await flushPromises()
    expect(pdf.renderQuestion).toHaveBeenLastCalledWith([expect.objectContaining({ left: .12 })])
    expect(pdf.regionText).toHaveBeenLastCalledWith([expect.objectContaining({ left: .12 })])
    expect((reviewed.element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.get('.import-publish-bar .import-primary').attributes('disabled')).toBeDefined()
    await reviewed.setValue(true)
    await wrapper.get('.import-publish-bar .import-primary').trigger('click')
    await flushPromises()
    expect(api.publishImport).toHaveBeenCalledWith(record().id, { ...metadata, year: 2026 },
      expect.arrayContaining([expect.objectContaining({ searchText: '수정한 영역의 검색용 문제 내용', reviewed: true })]), expect.any(Map), [], expect.any(Map))
    wrapper.unmount()
  })

  it('시험 정보를 다 찾지 못해도 초안을 저장하고 등록은 막는다', async () => {
    pdf.analyze.mockResolvedValueOnce({ metadata: { ...metadata, year: undefined }, pageCount: 1, questions: [question()], warnings: [] })
    const wrapper = mount(ExamImportDialog)
    await choosePdf(wrapper)
    expect(wrapper.get('.import-publish-bar .import-primary').attributes('disabled')).toBeDefined()
    await button(wrapper, '초안 저장').trigger('click')
    await flushPromises()
    const { year: _year, ...partial } = metadata
    expect(api.saveDraft).toHaveBeenCalledWith(record().id, partial, expect.any(Array), [])
    expect(wrapper.text()).toContain('초안을 저장했어요')
    expect(api.publishImport).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('저장한 초안을 이어서 검수하고 다시 업로드하지 않는다', async () => {
    api.listImports.mockResolvedValue([record()])
    const wrapper = mount(ExamImportDialog)
    await flushPromises()
    await button(wrapper, '이어서 검수').trigger('click')
    await flushPromises()
    expect(api.getImport).toHaveBeenCalledWith(record().id)
    expect(api.downloadPdf).toHaveBeenCalledWith(record())
    expect(api.createImport).not.toHaveBeenCalled()
    expect(pdf.analyze).not.toHaveBeenCalled()
    expect(wrapper.findAll('.import-question-card')).toHaveLength(1)
    expect((wrapper.get('.import-reviewed input').element as HTMLInputElement).checked).toBe(false)
    wrapper.unmount()
  })

  it('문항이 없는 영어 초안은 원본 PDF를 다시 분석해 독해를 표시하고 재업로드하지 않는다', async () => {
    const saved = { ...record(), questions: [], metadata: {} }
    const info = { ...metadata, subject: '영어' as const, month: 6 as const,
      excludedNumbers: Array.from({ length: 17 }, (_, i) => i + 1) }
    api.listImports.mockResolvedValueOnce([saved]); api.getImport.mockResolvedValueOnce(saved)
    pdf.analyze.mockResolvedValueOnce({ metadata: info, pageCount: 1,
      questions: Array.from({ length: 28 }, (_, i) => ({ ...question(), number: i + 18,
        clientId: `22222222-2222-4222-8222-${String(i).padStart(12, '0')}` })), warnings: [] })
    const wrapper = mount(ExamImportDialog)
    await flushPromises()
    await button(wrapper, '이어서 검수').trigger('click')
    await flushPromises()
    expect(pdf.analyze).toHaveBeenCalledOnce()
    expect(api.createImport).not.toHaveBeenCalled()
    expect(wrapper.findAll('.import-question-card')).toHaveLength(28)
    expect(wrapper.get('.import-excluded-note').text()).toContain('듣기 1~17번 제외 · 등록 대상 28문항')
    await button(wrapper, '전체 검수 확인').trigger('click')
    expect(wrapper.get('.import-publish-bar .import-primary').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('문항을 찾지 못한 PDF는 상단에서 안내하고 등록을 허용하지 않는다', async () => {
    pdf.analyze.mockResolvedValueOnce({ metadata, pageCount: 1, questions: [], warnings: [] })
    const wrapper = mount(ExamImportDialog)
    await choosePdf(wrapper)
    expect(wrapper.get('[role="alert"]').text()).toContain('등록할 문항이 없어요')
    expect(wrapper.find('.import-message.is-success').exists()).toBe(false)
    expect(wrapper.get('.import-publish-bar .import-primary').attributes('disabled')).toBeDefined()
    expect(button(wrapper, '문항 직접 추가').attributes('disabled')).toBeUndefined()
    expect(button(wrapper, '초안 저장').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('업로드 실패는 오류로 알리고 등록을 실행하지 않는다', async () => {
    api.createImport.mockRejectedValueOnce(new Error('PDF 업로드 연결 실패'))
    const wrapper = mount(ExamImportDialog)
    await choosePdf(wrapper)
    expect(wrapper.get('[role="alert"]').text()).toContain('PDF 업로드 연결 실패')
    expect(wrapper.find('.import-question-card').exists()).toBe(false)
    expect(api.publishImport).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('닫은 후 늦게 도착한 PDF 분석은 업로드를 시작하지 않는다', async () => {
    let finish!: (value: ReturnType<typeof createPdf>) => void
    openPdf.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const wrapper = mount(ExamImportDialog)
    await choosePdf(wrapper)
    await wrapper.get('[aria-label="문제 등록 창 닫기"]').trigger('click')
    finish(pdf)
    await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(pdf.destroy).toHaveBeenCalledOnce()
    expect(api.createImport).not.toHaveBeenCalled()
    expect(wrapper.find('.import-question-card').exists()).toBe(false)
    wrapper.unmount()
  })

  it('공통 지문은 영역별로 한 번씩 렌더링하고 지문과 문항을 모두 확인한 뒤 등록한다', async () => {
    const shared = passage()
    pdf.analyze.mockResolvedValueOnce({ metadata, pageCount: 1, passages: [shared], questions: [{ ...question(), passageClientId: shared.clientId }], warnings: [] })
    const wrapper = mount(ExamImportDialog)
    await choosePdf(wrapper)
    expect(wrapper.findAll('.import-passage-card')).toHaveLength(1)
    expect(wrapper.findAll('.import-passage-preview')).toHaveLength(2)
    expect(wrapper.get('.import-passage-linked').text()).toContain('1번')
    expect(pdf.renderQuestion.mock.calls.map(call => call[0])).toEqual([[shared.regions[0]], [shared.regions[1]], question().regions])
    const publish = wrapper.get('.import-publish-bar .import-primary')
    await wrapper.get('.import-question-card .import-reviewed input').setValue(true)
    expect(publish.attributes('disabled')).toBeDefined()
    await wrapper.get('.import-passage-reviewed input').setValue(true)
    expect(publish.attributes('disabled')).toBeUndefined()
    await publish.trigger('click')
    await flushPromises()
    const args = api.publishImport.mock.calls[0]!
    expect(args[4]).toEqual([expect.objectContaining({ clientId: shared.clientId, reviewed: true, imageSizes: [{ width: 640, height: 800 }, { width: 640, height: 800 }] })])
    expect([...args[5].keys()]).toEqual([passageImageKey(shared.clientId, 0), passageImageKey(shared.clientId, 1)])
    wrapper.unmount()
  })

  it('지문 수정은 지문과 연결 문항의 확인을 해제하며 연결 없는 지문은 등록을 막는다', async () => {
    const shared = passage()
    pdf.analyze.mockResolvedValueOnce({ metadata, pageCount: 1, passages: [shared], questions: [{ ...question(), passageClientId: shared.clientId }], warnings: [] })
    const wrapper = mount(ExamImportDialog)
    await choosePdf(wrapper)
    const reviewed = wrapper.get('.import-question-card .import-reviewed input')
    const passageReviewed = wrapper.get('.import-passage-reviewed input')
    await reviewed.setValue(true)
    await passageReviewed.setValue(true)
    await wrapper.get('.import-passage-card input[maxlength="200"]').setValue('수정한 공통 지문')
    expect((reviewed.element as HTMLInputElement).checked).toBe(false)
    expect((passageReviewed.element as HTMLInputElement).checked).toBe(false)
    await reviewed.setValue(true)
    await passageReviewed.setValue(true)
    await wrapper.get('.import-passage-select').setValue('')
    expect((reviewed.element as HTMLInputElement).checked).toBe(false)
    await reviewed.setValue(true)
    expect(wrapper.get('.import-publish-bar .import-primary').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.import-publish-bar').text()).toContain('연결하지 않은 지문')
    await button(wrapper, '공통 지문 삭제').trigger('click')
    expect(wrapper.find('.import-passage-card').exists()).toBe(false)
    expect(wrapper.get('.import-publish-bar .import-primary').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('지문 영역을 수정하고 순서를 바꾸면 검색 본문과 각 영역 이미지를 함께 갱신한다', async () => {
    const shared = passage()
    pdf.analyze.mockResolvedValueOnce({ metadata, pageCount: 1, passages: [shared], questions: [{ ...question(), passageClientId: shared.clientId }], warnings: [] })
    const wrapper = mount(ExamImportDialog)
    await choosePdf(wrapper)
    await wrapper.get('.import-question-card .import-reviewed input').setValue(true)
    await wrapper.get('.import-passage-reviewed input').setValue(true)
    await button(wrapper, '지문 영역 조정').trigger('click')
    await flushPromises()
    await button(wrapper, '영역 뒤로 이동').trigger('click')
    await flushPromises()
    await button(wrapper, '영역 적용·미리보기 갱신').trigger('click')
    await flushPromises()
    expect(pdf.regionText).toHaveBeenLastCalledWith([shared.regions[1], shared.regions[0]])
    expect((wrapper.get('.import-question-card .import-reviewed input').element as HTMLInputElement).checked).toBe(false)
    expect((wrapper.get('.import-passage-reviewed input').element as HTMLInputElement).checked).toBe(false)
    await button(wrapper, '초안 저장').trigger('click')
    await flushPromises()
    expect(api.saveDraft).toHaveBeenCalledWith(record().id, metadata, expect.any(Array), [expect.objectContaining({ searchText: '수정한 영역의 검색용 문제 내용', regions: [shared.regions[1], shared.regions[0]] })])
    wrapper.unmount()
  })

  it('영어 듣기 제외 범위와 원본 문항 번호를 표시하고 초안에도 보관한다', async () => {
    const info = { ...metadata, subject: '영어' as const, excludedNumbers: Array.from({ length: 17 }, (_, index) => index + 1) }
    pdf.analyze.mockResolvedValueOnce({ metadata: info, pageCount: 1, questions: [{ ...question(), number: 18, tags: ['목적·심경'] }], warnings: [] })
    const wrapper = mount(ExamImportDialog)
    await choosePdf(wrapper)
    expect(wrapper.get('.import-excluded-note').text()).toContain('듣기 1~17번 제외')
    expect(wrapper.get('.import-excluded-note').text()).toContain('등록 대상 1문항')
    expect((wrapper.get('.import-question-fields input').element as HTMLInputElement).value).toBe('18')
    await button(wrapper, '초안 저장').trigger('click')
    await flushPromises()
    expect(api.saveDraft).toHaveBeenCalledWith(record().id, info, expect.arrayContaining([expect.objectContaining({ number: 18 })]), [])
    wrapper.unmount()
  })

  it('단답형과 공통 풀이 안내를 수정하면 재검수를 요구하고 등록 내용에 보관한다', async () => {
    const wrapper = mount(ExamImportDialog)
    await choosePdf(wrapper)
    const reviewed = wrapper.get('.import-question-card .import-reviewed input')
    await reviewed.setValue(true)
    await wrapper.get('.import-question-connections select').setValue('short_answer')
    expect((reviewed.element as HTMLInputElement).checked).toBe(false)
    await reviewed.setValue(true)
    await wrapper.get('.import-instruction-field').setValue('주어진 조건에 맞는 값을 구하시오.')
    expect((reviewed.element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.get('.import-question-instruction').text()).toContain('주어진 조건')
    await reviewed.setValue(true)
    await wrapper.get('.import-publish-bar .import-primary').trigger('click')
    await flushPromises()
    expect(api.publishImport).toHaveBeenCalledWith(record().id, metadata,
      expect.arrayContaining([expect.objectContaining({ responseType: 'short_answer', instruction: '주어진 조건에 맞는 값을 구하시오.', reviewed: true })]), expect.any(Map), [], expect.any(Map))
    wrapper.unmount()
  })

  it('저장한 지문과 연결 문항을 다시 분석하지 않고 이어서 검수한다', async () => {
    const shared = passage()
    const saved = { ...record(), passages: [shared], questions: [{ ...question(), passageClientId: shared.clientId, instruction: '공통 풀이 안내', responseType: 'multiple_choice' as const }] }
    api.listImports.mockResolvedValueOnce([saved])
    api.getImport.mockResolvedValueOnce(saved)
    const wrapper = mount(ExamImportDialog)
    await flushPromises()
    await button(wrapper, '이어서 검수').trigger('click')
    await flushPromises()
    expect(pdf.analyze).not.toHaveBeenCalled()
    expect(wrapper.findAll('.import-passage-preview')).toHaveLength(2)
    expect(wrapper.get('.import-passage-select').element).toHaveProperty('value', shared.clientId)
    expect(wrapper.get('.import-question-instruction').text()).toContain('공통 풀이 안내')
    wrapper.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3)
  })

  it('자동 인식하지 못한 공통 지문도 직접 추가하고 영역 적용 후 문항에 연결한다', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => passage().clientId, subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer) } })
    const wrapper = mount(ExamImportDialog)
    await choosePdf(wrapper)
    await button(wrapper, '공통 지문 직접 추가').trigger('click')
    await flushPromises()
    expect(wrapper.find('.import-region-editor').exists()).toBe(true)
    expect(wrapper.get('.import-publish-bar .import-primary').attributes('disabled')).toBeDefined()
    await wrapper.get('.import-passage-card input[maxlength="200"]').setValue('직접 지정한 지문')
    await button(wrapper, '영역 적용·미리보기 갱신').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.import-passage-preview')).toHaveLength(1)
    await wrapper.get('.import-passage-select').setValue(passage().clientId)
    expect(wrapper.get('.import-passage-linked').text()).toContain('1번')
    await wrapper.get('.import-passage-reviewed input').setValue(true)
    await wrapper.get('.import-question-card .import-reviewed input').setValue(true)
    expect(wrapper.get('.import-publish-bar .import-primary').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('제목 추천은 공통 지문을 참고하되 적용 전 직접 쓴 제목과 검수 상태를 바꾸지 않는다', async () => {
    const shared = { ...passage(), reviewed: true }
    const first = { ...question(), title: '선생님이 정한 제목', passageClientId: shared.clientId, instruction: '서술 방식을 비교하시오.', reviewed: true }
    const second = { ...question(), clientId: '44444444-4444-4444-8444-444444444444', number: 2, reviewed: true }
    pdf.analyze.mockResolvedValueOnce({ metadata, pageCount: 1, passages: [shared], questions: [first, second], warnings: [] })
    const wrapper = mount(ExamImportDialog)
    await choosePdf(wrapper)
    await wrapper.get('.import-passage-reviewed input').setValue(true)
    for (const checkbox of wrapper.findAll('.import-question-card .import-reviewed input')) await checkbox.setValue(true)
    const card = wrapper.findAll('.import-question-card')[0]!
    const title = card.get('.import-question-title-field input')
    await card.get('.import-title-tools button').trigger('click')
    await flushPromises()
    expect(titleRecommendation).toHaveBeenCalledWith({ subject: '한국사', number: 1, text: first.searchText,
      passageText: shared.searchText, instruction: first.instruction, tags: first.tags })
    expect(title.element).toHaveProperty('value', '선생님이 정한 제목')
    expect(card.get('.import-reviewed input').element).toHaveProperty('checked', true)
    const rendered = pdf.renderQuestion.mock.calls.length
    await card.findAll('button').find(button => button.text() === '추천 제목 적용')!.trigger('click')
    expect(title.element).toHaveProperty('value', '새로 추천한 주제 제목')
    expect(card.get('.import-reviewed input').element).toHaveProperty('checked', false)
    expect(wrapper.findAll('.import-question-card')[1]!.get('.import-reviewed input').element).toHaveProperty('checked', true)
    expect(wrapper.get('.import-passage-reviewed input').element).toHaveProperty('checked', true)
    expect(pdf.renderQuestion.mock.calls).toHaveLength(rendered)
    await button(wrapper, '초안 저장').trigger('click')
    await flushPromises()
    expect(api.saveDraft).toHaveBeenCalledWith(record().id, metadata, [
      expect.objectContaining({ title: '새로 추천한 주제 제목', tags: first.tags, regions: first.regions, passageClientId: shared.clientId, reviewed: false }),
      expect.objectContaining({ title: second.title, reviewed: true }),
    ], [expect.objectContaining({ clientId: shared.clientId, reviewed: true })])
    wrapper.unmount()
  })

  it('일괄 추천은 깨진 제목만 기본 선택하고 직접 쓴 제목은 명시적으로 선택할 때 바꾼다', async () => {
    const first = { ...question(), title: '\ue001 1. \ue002의 값은?', reviewed: true }
    const second = { ...question(), clientId: '44444444-4444-4444-8444-444444444444', number: 2, title: '선생님이 직접 쓴 제목', reviewed: true }
    titleRecommendation.mockImplementation(({ number }: { number: number }) => `개념 ${number}의 이해`)
    pdf.analyze.mockResolvedValueOnce({ metadata, pageCount: 1, questions: [first, second], warnings: [] })
    const wrapper = mount(ExamImportDialog)
    await choosePdf(wrapper)
    for (const checkbox of wrapper.findAll('.import-question-card .import-reviewed input')) await checkbox.setValue(true)
    await button(wrapper, '제목 일괄 추천').trigger('click')
    await flushPromises()
    const choices = wrapper.findAll('.import-title-candidate input')
    expect(choices[0]!.element).toHaveProperty('checked', true)
    expect(choices[1]!.element).toHaveProperty('checked', false)
    expect(wrapper.get('.import-title-bulk').text()).toContain('선생님이 직접 쓴 제목')
    await button(wrapper, '선택한 제목 1개 적용').trigger('click')
    expect(wrapper.findAll('.import-question-title-field input')[0]!.element).toHaveProperty('value', '개념 1의 이해')
    expect(wrapper.findAll('.import-question-title-field input')[1]!.element).toHaveProperty('value', '선생님이 직접 쓴 제목')
    expect(wrapper.findAll('.import-question-card .import-reviewed input')[1]!.element).toHaveProperty('checked', true)
    await button(wrapper, '제목 일괄 추천').trigger('click')
    await flushPromises()
    await button(wrapper, '모두 선택').trigger('click')
    await button(wrapper, '선택한 제목 1개 적용').trigger('click')
    expect(wrapper.findAll('.import-question-title-field input')[1]!.element).toHaveProperty('value', '개념 2의 이해')
    expect(wrapper.findAll('.import-question-card .import-reviewed input')[1]!.element).toHaveProperty('checked', false)
    wrapper.unmount()
  })

  it('추천 후 문항이나 제목을 수정하면 오래된 추천으로 덮어쓰지 않는다', async () => {
    const wrapper = mount(ExamImportDialog)
    await choosePdf(wrapper)
    await button(wrapper, '제목 일괄 추천').trigger('click')
    await flushPromises()
    await button(wrapper, '모두 선택').trigger('click')
    await wrapper.get('.import-instruction-field').setValue('새로 수정한 조건')
    expect(wrapper.get('.import-title-candidate input').attributes('disabled')).toBeDefined()
    expect(button(wrapper, '선택한 제목 0개 적용').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.import-title-candidate').text()).toContain('다시 추천해 주세요')
    await button(wrapper, '제목 추천 닫기').trigger('click')
    await wrapper.get('.import-title-tools button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.import-title-suggestion').exists()).toBe(true)
    await wrapper.get('.import-question-title-field input').setValue('직접 고친 최종 제목')
    expect(wrapper.find('.import-title-suggestion').exists()).toBe(false)
    expect(wrapper.get('.import-question-title-field input').element).toHaveProperty('value', '직접 고친 최종 제목')
    wrapper.unmount()
  })

  it('저장된 초안을 열 때에는 제목을 자동 추천하거나 변경하지 않는다', async () => {
    const saved = { ...record(), questions: [{ ...question(), title: '저장해 둔 수업용 제목', reviewed: true }] }
    api.listImports.mockResolvedValueOnce([saved])
    api.getImport.mockResolvedValueOnce(saved)
    const wrapper = mount(ExamImportDialog)
    await flushPromises()
    await button(wrapper, '이어서 검수').trigger('click')
    await flushPromises()
    expect(titleRecommendation).not.toHaveBeenCalled()
    expect(wrapper.get('.import-question-title-field input').element).toHaveProperty('value', '저장해 둔 수업용 제목')
    expect(wrapper.get('.import-question-card .import-reviewed input').element).toHaveProperty('checked', true)
    wrapper.unmount()
  })

  it('깨진 수식이 있는 기존 초안은 원본 영역을 제목 추천에만 다시 읽고 검색 본문은 보존한다', async () => {
    const oldText = '1. \ue001\ue002\ue003의 값은?'
    const saved = { ...record(), metadata: { ...metadata, subject: '수학' as const }, questions: [{ ...question(), title: oldText, searchText: oldText }] }
    api.listImports.mockResolvedValueOnce([saved]); api.getImport.mockResolvedValueOnce(saved)
    pdf.regionText.mockResolvedValueOnce('√6 × √(1/2) + √3의 값은?')
    titleRecommendation.mockReturnValueOnce('제곱근의 곱셈과 덧셈')
    const wrapper = mount(ExamImportDialog)
    await flushPromises()
    await button(wrapper, '이어서 검수').trigger('click')
    await flushPromises()
    await wrapper.get('.import-title-tools button').trigger('click')
    await flushPromises()
    expect(pdf.regionText).toHaveBeenCalledWith(question().regions)
    expect(titleRecommendation).toHaveBeenCalledWith(expect.objectContaining({ subject: '수학', text: '√6 × √(1/2) + √3의 값은?' }))
    await button(wrapper, '추천 제목 적용').trigger('click')
    await button(wrapper, '초안 저장').trigger('click')
    await flushPromises()
    expect(api.saveDraft).toHaveBeenCalledWith(record().id, saved.metadata,
      [expect.objectContaining({ title: '제곱근의 곱셈과 덧셈', searchText: oldText, regions: question().regions })], [])
    wrapper.unmount()
  })

  it('맨 아래에서 문항과 공통 지문 전체 확인·해제를 초안에 저장한다', async () => {
    const shared = passage()
    const second = { ...question(), clientId: '44444444-4444-4444-8444-444444444444', number: 2 }
    pdf.analyze.mockResolvedValueOnce({ metadata, pageCount: 1, passages: [shared],
      questions: [question(), second].map(item => ({ ...item, passageClientId: shared.clientId })), warnings: [] })
    const wrapper = mount(ExamImportDialog)
    await choosePdf(wrapper)
    const all = wrapper.get('.import-publish-bar .import-review-all')
    expect(all.text()).toContain('전체 검수 확인')
    expect(all.attributes('aria-pressed')).toBe('false')
    await all.trigger('click')
    expect(all.text()).toContain('전체 확인 해제')
    expect(all.attributes('aria-pressed')).toBe('true')
    for (const checkbox of wrapper.findAll('.import-reviewed input')) expect(checkbox.element).toHaveProperty('checked', true)
    expect(wrapper.get('.import-publish-bar .import-primary').attributes('disabled')).toBeUndefined()
    await button(wrapper, '초안 저장').trigger('click')
    await flushPromises()
    expect(api.saveDraft).toHaveBeenLastCalledWith(record().id, metadata,
      [expect.objectContaining({ number: 1, reviewed: true }), expect.objectContaining({ number: 2, reviewed: true })],
      [expect.objectContaining({ clientId: shared.clientId, reviewed: true })])
    await all.trigger('click')
    for (const checkbox of wrapper.findAll('.import-reviewed input')) expect(checkbox.element).toHaveProperty('checked', false)
    expect(wrapper.get('.import-publish-bar .import-primary').attributes('disabled')).toBeDefined()
    await button(wrapper, '초안 저장').trigger('click')
    await flushPromises()
    expect(api.saveDraft).toHaveBeenLastCalledWith(record().id, metadata,
      [expect.objectContaining({ reviewed: false }), expect.objectContaining({ reviewed: false })],
      [expect.objectContaining({ reviewed: false })])
    expect(api.publishImport).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('전체 확인 뒤 수정한 문항만 재검수하고 영역 편집 중에는 전체 확인을 막는다', async () => {
    const second = { ...question(), clientId: '44444444-4444-4444-8444-444444444444', number: 2 }
    pdf.analyze.mockResolvedValueOnce({ metadata, pageCount: 1, questions: [question(), second], warnings: [] })
    const wrapper = mount(ExamImportDialog)
    await choosePdf(wrapper)
    const all = wrapper.get('.import-review-all')
    await all.trigger('click')
    await wrapper.findAll('.import-question-title-field input')[0]!.setValue('수정한 제목')
    const checks = wrapper.findAll('.import-question-card .import-reviewed input')
    expect(checks[0]!.element).toHaveProperty('checked', false)
    expect(checks[1]!.element).toHaveProperty('checked', true)
    expect(all.attributes('aria-pressed')).toBe('false')
    await wrapper.findAll('.import-question-card')[0]!.findAll('button').find(item => item.text() === '영역 조정')!.trigger('click')
    await flushPromises()
    expect(all.attributes('disabled')).toBeDefined()
    await all.trigger('click')
    expect(checks[0]!.element).toHaveProperty('checked', false)
    expect(wrapper.get('.import-publish-bar .import-primary').attributes('disabled')).toBeDefined()
    await button(wrapper, '영역 수정 취소').trigger('click')
    await all.trigger('click')
    expect(checks[0]!.element).toHaveProperty('checked', true)
    expect(checks[1]!.element).toHaveProperty('checked', true)
    wrapper.unmount()
  })

  it('일괄 확인해도 제목이 없는 문항은 등록할 수 없다', async () => {
    pdf.analyze.mockResolvedValueOnce({ metadata, pageCount: 1, questions: [{ ...question(), title: '' }], warnings: [] })
    const wrapper = mount(ExamImportDialog)
    await choosePdf(wrapper)
    await wrapper.get('.import-review-all').trigger('click')
    expect(wrapper.get('.import-question-card .import-reviewed input').element).toHaveProperty('checked', true)
    const publish = wrapper.get('.import-publish-bar .import-primary')
    expect(publish.attributes('disabled')).toBeDefined()
    await publish.trigger('click')
    expect(api.publishImport).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('원본에서 제목을 읽는 동안 권한이 사라지면 추천을 적용하거나 저장하지 않는다', async () => {
    let finish!: (value: string) => void
    pdf.regionText.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    pdf.analyze.mockResolvedValueOnce({ metadata, pageCount: 1, questions: [{ ...question(), searchText: '\ue001' }], warnings: [] })
    const wrapper = mount(ExamImportDialog)
    await choosePdf(wrapper)
    await wrapper.get('.import-title-tools button').trigger('click')
    account.isAdmin.value = false
    await flushPromises()
    finish('제곱근의 값을 구하시오.')
    await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.find('.import-title-suggestion').exists()).toBe(false)
    expect(api.saveDraft).not.toHaveBeenCalled()
    expect(api.publishImport).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('등록 조건과 등록 완료 자료 삭제', () => {
  it('태그를 인식하지 못한 수학 30문항도 전체 확인 후 등록한다', async () => {
    const info = { ...metadata, subject: '수학' as const }
    const items = Array.from({ length: 30 }, (_, i) => ({ ...question(),
      clientId: `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`, number: i + 1,
      tags: [], searchText: '수식의 값은?', responseType: i >= 21 ? 'short_answer' as const : 'multiple_choice' as const }))
    pdf.analyze.mockResolvedValueOnce({ metadata: info, pageCount: 1, questions: items, warnings: [] })
    const wrapper = mount(ExamImportDialog)
    await choosePdf(wrapper)
    await button(wrapper, '전체 검수 확인').trigger('click')
    expect(wrapper.get('.import-publish-bar').text()).toContain('확인 30/30문항')
    expect(wrapper.get('.import-publish-bar .import-primary').attributes('disabled')).toBeUndefined()
    await wrapper.get('.import-publish-bar .import-primary').trigger('click')
    await flushPromises()
    expect(api.publishImport.mock.calls[0]![2]).toHaveLength(30)
    expect(api.publishImport.mock.calls[0]![2].every((q: ImportQuestionDraft) => !q.tags.length && q.reviewed)).toBe(true)
    wrapper.unmount()
  })

  it('확인을 모두 마쳐도 잘못된 배점은 문항 번호와 수정할 내용을 알린다', async () => {
    pdf.analyze.mockResolvedValueOnce({ metadata, pageCount: 1, questions: [{ ...question(), number: 7, points: 0 }], warnings: [] })
    const wrapper = mount(ExamImportDialog)
    await choosePdf(wrapper)
    await button(wrapper, '전체 검수 확인').trigger('click')
    expect(wrapper.get('.import-publish-bar .import-primary').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.import-publish-bar').text()).toContain('7번: 배점은 1~10')
    expect(wrapper.get('.import-question-card').text()).toContain('7번: 배점은 1~10')
    wrapper.unmount()
  })

  it('등록 완료 자료 삭제는 영향 안내와 취소를 제공하고 확인한 뒤에만 실행한다', async () => {
    const published = { ...record(), status: 'published' as const }
    api.listImports.mockResolvedValueOnce([published]).mockResolvedValueOnce([])
    const wrapper = mount(ExamImportDialog)
    await flushPromises()
    expect(wrapper.text()).toContain('등록 완료')
    expect(wrapper.findAll('button').some(b => b.text() === '이어서 검수')).toBe(false)
    await button(wrapper, '등록 자료 삭제').trigger('click')
    expect(wrapper.get('.import-confirm').text()).toContain('사용자들의 해당 문항 저장 기록')
    expect(api.deleteImport).not.toHaveBeenCalled()
    await wrapper.get('.import-confirm .import-secondary').trigger('click')
    expect(wrapper.find('.import-confirm').exists()).toBe(false)
    await button(wrapper, '등록 자료 삭제').trigger('click')
    await button(wrapper, '등록 자료 삭제하기').trigger('click')
    await flushPromises()
    expect(api.deleteImport).toHaveBeenCalledExactlyOnceWith(published.id)
    expect(api.deleteDraft).not.toHaveBeenCalled()
    expect(wrapper.find('.import-records').exists()).toBe(false)
    expect(wrapper.emitted('changed')).toHaveLength(1)
    wrapper.unmount()
  })

  it('등록 자료 삭제 실패는 목록을 갱신하고 삭제 재시도를 제공한다', async () => {
    const published = { ...record(), status: 'published' as const }
    api.listImports.mockResolvedValueOnce([published]).mockResolvedValueOnce([{ ...published, deleting_at: '2026-10-26' }]).mockResolvedValueOnce([])
    api.deleteImport.mockRejectedValueOnce(new Error('파일을 모두 삭제하지 못했어요. 삭제를 다시 시도해 주세요.'))
    const wrapper = mount(ExamImportDialog)
    await flushPromises()
    await button(wrapper, '등록 자료 삭제').trigger('click')
    await button(wrapper, '등록 자료 삭제하기').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('다시 시도')
    expect(button(wrapper, '삭제 재시도').exists()).toBe(true)
    expect(wrapper.emitted('changed')).toHaveLength(1)
    await button(wrapper, '등록 자료 삭제하기').trigger('click')
    await flushPromises()
    expect(api.deleteImport).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.import-records').exists()).toBe(false)
    wrapper.unmount()
  })
})
