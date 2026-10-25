import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { ExamImportMetadata, ExamImportRecord, ImportQuestionDraft, RenderedPdfImage } from './import-types'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), storageFrom: vi.fn(), upload: vi.fn(), download: vi.fn() }))
vi.mock('./lib/supabase', () => ({
  supabase: { functions: { invoke: mocks.invoke }, storage: { from: mocks.storageFrom } },
}))
vi.mock('./account', () => ({ useAccount: () => account }))
import { useExamImports } from './exam-imports'

const importId = '11111111-1111-4111-8111-111111111111'
const firstId = '22222222-2222-4222-8222-222222222222'
const secondId = '33333333-3333-4333-8333-333333333333'
const metadata: ExamImportMetadata = {
  subject: '한국사', grade: 1, year: 2025, month: 3,
  sourceUrl: 'https://www.ebsi.co.kr/ebs/exam', explanationUrl: 'https://www.ebsi.co.kr/ebs/exam',
}
const record: ExamImportRecord = {
  id: importId, file_name: 'history.pdf', sha256: 'a'.repeat(64), page_count: 4,
  source_path: `imports/${importId}/source.pdf`, status: 'draft', metadata,
  questions: [], created_at: '2026-10-25T00:00:00Z', published_at: null,
}
function question(clientId = firstId, number = 1): ImportQuestionDraft {
  return { clientId, number, title: '역사 문항', tags: ['현대사'], points: 3, searchText: '문항 내용',
    regions: [{ page: 1, left: .1, top: .1, right: .5, bottom: .8 }], reviewed: true }
}
function image(): RenderedPdfImage {
  return { blob: new Blob(['image'], { type: 'image/webp' }), width: 1000, height: 1200 }
}
function createAccount() {
  return { configured: true, authReady: ref(true), user: ref<{ id: string } | null>({ id: 'admin-one' }), isAdmin: ref(true) }
}
let account = createAccount()

beforeEach(() => {
  vi.resetAllMocks()
  account = createAccount()
  mocks.invoke.mockImplementation(async (_name: string, { body }: { body: { action: string } }) => ({
    data: body.action === 'list-imports' ? { imports: [record] }
      : body.action === 'publish' ? { message: '등록했어요.', count: 2 }
        : body.action === 'delete-draft' ? { message: '등록했어요.' } : { import: record },
    error: null,
  }))
  mocks.storageFrom.mockReturnValue({ upload: mocks.upload, download: mocks.download })
  mocks.upload.mockResolvedValue({ data: {}, error: null })
  mocks.download.mockResolvedValue({ data: new Blob(['%PDF-1.7'], { type: 'application/pdf' }), error: null })
})

describe('관리자 PDF 업로드와 검수 자료 등록', () => {
  it('비로그인 또는 일반 계정은 서버나 저장소를 호출하지 않는다', async () => {
    const imports = useExamImports()
    account.user.value = null
    await expect(imports.listImports()).rejects.toThrow('관리자 계정')
    account.user.value = { id: 'teacher' }; account.isAdmin.value = false
    await expect(imports.getImport(importId)).rejects.toThrow('관리자 계정')
    await expect(imports.publishImport(importId, metadata, [question()], new Map([[firstId, image()]]))).rejects.toThrow('관리자 계정')
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(mocks.storageFrom).not.toHaveBeenCalled()
  })

  it('자료 목록·단건·초안 저장·삭제를 관리자 API로 요청한다', async () => {
    const imports = useExamImports()
    expect(await imports.listImports()).toEqual([record])
    expect(await imports.getImport(importId)).toEqual(record)
    const unreviewed = { ...question(), reviewed: false }
    expect(await imports.saveDraft(importId, { subject: '한국사' }, [unreviewed])).toEqual(record)
    expect(await imports.deleteDraft(importId)).toBe('등록했어요.')
    expect(mocks.invoke.mock.calls.map(call => call[1].body.action)).toEqual(['list-imports', 'get-import', 'save-draft', 'delete-draft'])
    expect(mocks.invoke.mock.calls.every(call => call[0] === 'exam-admin')).toBe(true)
  })

  it('PDF 헤더 확인 후 새 자료의 비공개 경로에 원본을 업로드한다', async () => {
    const file = new File(['%PDF-1.7\nexample'], 'history.pdf', { type: 'application/pdf' })
    const result = await useExamImports().createImport(file, 'A'.repeat(64), 4)
    expect(result).toEqual(record)
    expect(mocks.invoke).toHaveBeenCalledWith('exam-admin', { body: {
      action: 'create-import', fileName: 'history.pdf', sha256: 'a'.repeat(64), pageCount: 4,
    } })
    expect(mocks.storageFrom).toHaveBeenCalledWith('exam-imports')
    expect(mocks.upload).toHaveBeenCalledWith(record.source_path, file,
      { contentType: 'application/pdf', upsert: false, cacheControl: '0' })
  })

  it('PDF 확장자만 바꾼 파일과 범위 밖 PDF는 서버에 보내지 않는다', async () => {
    const imports = useExamImports()
    await expect(imports.createImport(new File(['image data'], 'image.pdf'), 'a'.repeat(64), 1)).rejects.toThrow('올바른 PDF')
    await expect(imports.createImport(new File(['%PDF-1.7'], 'history.pdf'), 'invalid', 1)).rejects.toThrow('PDF 정보를')
    await expect(imports.createImport(new File(['%PDF-1.7'], 'history.pdf'), 'a'.repeat(64), 41)).rejects.toThrow('40쪽')
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('원본 업로드 실패 시 이번에 생성한 초안만 삭제하도록 요청한다', async () => {
    mocks.upload.mockResolvedValue({ error: new Error('private provider details') })
    await expect(useExamImports().createImport(new File(['%PDF-1.7'], 'history.pdf'), 'a'.repeat(64), 4)).rejects.toThrow('PDF를 업로드하지 못했어요')
    expect(mocks.invoke.mock.calls.map(call => call[1].body.action)).toEqual(['create-import', 'delete-draft'])
    expect(mocks.invoke.mock.calls[1]![1].body.id).toBe(importId)
  })

  it('원본 PDF를 인증 다운로드하고 매번 새 캐시 값을 사용한다', async () => {
    const imports = useExamImports()
    expect((await imports.downloadPdf(record)).type).toBe('application/pdf')
    await imports.downloadPdf(record)
    expect(mocks.download).toHaveBeenCalledWith(record.source_path, { cacheNonce: expect.any(String) }, { cache: 'no-store' })
    expect(mocks.download.mock.calls[0]![1].cacheNonce).not.toBe(mocks.download.mock.calls[1]![1].cacheNonce)
    await expect(imports.downloadPdf({ ...record, source_path: 'other/private.pdf' })).rejects.toThrow('PDF 경로')
    expect(mocks.download).toHaveBeenCalledTimes(2)
  })

  it('확인하지 않은 문항이나 미리보기가 없으면 등록을 시작하지 않는다', async () => {
    const imports = useExamImports()
    await expect(imports.publishImport(importId, metadata, [{ ...question(), reviewed: false }], new Map([[firstId, image()]]))).rejects.toThrow('모든 문항')
    await expect(imports.publishImport(importId, metadata, [question()], new Map())).rejects.toThrow('미리보기를 다시 생성')
    await expect(imports.publishImport(importId, { ...metadata, explanationUrl: 'javascript:alert(1)' }, [question()], new Map([[firstId, image()]]))).rejects.toThrow('EBS 링크')
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('검수한 문항을 저장하고 모든 이미지를 업로드한 뒤에만 등록한다', async () => {
    const questions = [question(), question(secondId, 2)]
    const images = new Map([[firstId, image()], [secondId, image()]])
    const result = await useExamImports().publishImport(importId, metadata, questions, images)
    expect(result).toEqual({ message: '등록했어요.', count: 2 })
    expect(mocks.invoke.mock.calls.map(call => call[1].body.action)).toEqual(['save-draft', 'publish'])
    expect(mocks.invoke.mock.calls[0]![1].body.questions[0]).toMatchObject({ width: 1000, height: 1200, reviewed: true })
    expect(mocks.upload).toHaveBeenNthCalledWith(1, `imports/${importId}/questions/${firstId}.webp`, images.get(firstId)!.blob,
      { contentType: 'image/webp', upsert: true, cacheControl: '0' })
    expect(mocks.upload).toHaveBeenNthCalledWith(2, `imports/${importId}/questions/${secondId}.webp`, images.get(secondId)!.blob,
      { contentType: 'image/webp', upsert: true, cacheControl: '0' })
    expect(questions[0]?.width).toBeUndefined()
  })

  it('이미지 일부 업로드가 실패하면 등록하지 않고 초안을 유지한다', async () => {
    mocks.upload.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: new Error('failure') })
    await expect(useExamImports().publishImport(importId, metadata, [question(), question(secondId, 2)],
      new Map([[firstId, image()], [secondId, image()]]))).rejects.toThrow('검수 자료는 보관')
    expect(mocks.invoke.mock.calls.map(call => call[1].body.action)).toEqual(['save-draft'])
  })

  it('업로드 중 계정이 바뀌면 다음 이미지와 등록 요청을 보내지 않는다', async () => {
    let finish!: (value: { error: null }) => void
    mocks.upload.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const pending = useExamImports().publishImport(importId, metadata, [question(), question(secondId, 2)],
      new Map([[firstId, image()], [secondId, image()]]))
    const failure = expect(pending).rejects.toThrow('로그인 상태가 바뀌어')
    await vi.waitFor(() => expect(mocks.upload).toHaveBeenCalledOnce())
    account.user.value = { id: 'another-admin' }
    finish({ error: null })
    await failure
    expect(mocks.upload).toHaveBeenCalledOnce()
    expect(mocks.invoke.mock.calls.map(call => call[1].body.action)).toEqual(['save-draft'])
  })

  it('취소한 비동기 작업의 응답을 처리하거나 등록을 계속하지 않는다', async () => {
    let finish!: (value: unknown) => void
    mocks.invoke.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const imports = useExamImports()
    const pending = imports.getImport(importId)
    const failure = expect(pending).rejects.toThrow('작업을 중단')
    imports.cancelPending()
    finish({ data: { import: record }, error: null })
    await failure
  })

  it('중복 문항 오류는 구체적인 안내로 바꾸고 서버 원문은 노출하지 않는다', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({
      code: 'IMPORT_CONFLICT', error: 'internal provider content that must not be displayed',
    })) } })
    await expect(useExamImports().publishImport(importId, metadata, [question()], new Map([[firstId, image()]])))
      .rejects.toThrow('이미 등록되어 있어요')
  })
})
