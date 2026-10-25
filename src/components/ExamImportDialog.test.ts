import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExamImportRecord, ExamPdfAnalysis, ImportQuestionDraft } from '../import-types'
import ExamImportDialog from './ExamImportDialog.vue'

const question = (): ImportQuestionDraft => ({
  clientId: '22222222-2222-4222-8222-222222222222', number: 1, title: '신석기 시대의 생활',
  tags: ['선사·고대'], points: 2, searchText: '빗살무늬 토기', reviewed: false,
  regions: [{ page: 1, left: .1, top: .1, right: .49, bottom: .8 }],
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
    deleteDraft: vi.fn().mockResolvedValue('초안을 삭제했어요.'), cancelPending: vi.fn(),
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
vi.mock('../account', () => ({ useAccount: () => account }))
vi.mock('../exam-imports', () => ({ useExamImports: () => api }))
vi.mock('../pdf-import', () => ({ openExamPdf: openPdf }))

beforeEach(() => {
  vi.unstubAllGlobals()
  account = createAccount(); api = createApi(); pdf = createPdf()
  openPdf.mockReset().mockResolvedValue(pdf)
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
      expect.arrayContaining([expect.objectContaining({ reviewed: true, number: 1 })]), expect.any(Map))
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
      expect.arrayContaining([expect.objectContaining({ searchText: '수정한 영역의 검색용 문제 내용', reviewed: true })]), expect.any(Map))
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
    expect(api.saveDraft).toHaveBeenCalledWith(record().id, partial, expect.any(Array))
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
})
