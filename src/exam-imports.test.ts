import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { passageImageKey, type ExamImportMetadata, type ExamImportRecord, type ImportPassageDraft, type ImportQuestionDraft, type RenderedPdfImage } from './import-types'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), storageFrom: vi.fn(), upload: vi.fn(), download: vi.fn() }))
vi.mock('./lib/supabase', () => ({
  supabase: { functions: { invoke: mocks.invoke }, storage: { from: mocks.storageFrom } },
}))
vi.mock('./account', () => ({ useAccount: () => account }))
import { useExamImports } from './exam-imports'

const importId = '11111111-1111-4111-8111-111111111111'
const firstId = '22222222-2222-4222-8222-222222222222'
const secondId = '33333333-3333-4333-8333-333333333333'
const passageId = '44444444-4444-4444-8444-444444444444'
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
function passage(): ImportPassageDraft {
  return { clientId: passageId, title: '공통 지문 1~2번', searchText: '두 문항에서 공유하는 지문', reviewed: true,
    regions: [{ page: 1, left: .1, top: .1, right: .5, bottom: .8 },
      { page: 1, left: .52, top: .1, right: .92, bottom: .4 }] }
}
function linkedQuestion(): ImportQuestionDraft {
  return { ...question(), passageClientId: passageId, instruction: '다음 글을 읽고 물음에 답하시오.', responseType: 'multiple_choice' }
}
function passageImages() {
  return new Map([[passageImageKey(passageId, 0), image()], [passageImageKey(passageId, 1), image()]])
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
        : ['delete-draft', 'delete-import'].includes(body.action) ? { message: '등록했어요.' } : { import: record },
    error: null,
  }))
  mocks.storageFrom.mockReturnValue({ upload: mocks.upload, download: mocks.download })
  mocks.upload.mockResolvedValue({ data: {}, error: null })
  mocks.download.mockResolvedValue({ data: new Blob(['%PDF-1.7'], { type: 'application/pdf' }), error: null })
})

describe('관리자 PDF 업로드와 검수 자료 등록', () => {
  it('AI 제목 요청은 관리자 API에 본문과 선택 해설만 전달하고 한도 오류를 안내한다', async () => {
    const imports = useExamImports()
    const items = [{ clientId: firstId, number: 1, text: '본문', passageText: '공통 지문', instruction: '', tags: [] }]
    mocks.invoke.mockResolvedValueOnce({ data: { titles: [{ clientId: firstId, title: '본문의 구체적인 개념' }] }, error: null })
    expect(await imports.suggestTitles(importId, '국어', items, '1번 해설')).toEqual([{ clientId: firstId, title: '본문의 구체적인 개념' }])
    expect(mocks.invoke).toHaveBeenCalledWith('exam-admin', { body: { action: 'suggest-titles', id: importId, subject: '국어', questions: items, explanationText: '1번 해설' } })
    mocks.invoke.mockResolvedValueOnce({ data: null, error: { context: new Response(JSON.stringify({ code: 'AI_RATE_LIMITED' }), { status: 429 }) } })
    await expect(imports.suggestTitles(importId, '국어', items)).rejects.toThrow('OpenAI API의 요청량 제한')
    mocks.invoke.mockResolvedValueOnce({ data: null, error: { context: new Response(JSON.stringify({ code: 'AI_QUOTA_EXCEEDED' }), { status: 429 }) } })
    await expect(imports.suggestTitles(importId, '국어', items)).rejects.toThrow('사용 가능 크레딧 또는 사용 한도가 부족')
    expect(mocks.upload).not.toHaveBeenCalled()
  })

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

  it('공통 지문 초안과 듣기 제외 번호를 문항 연결 정보와 함께 저장한다', async () => {
    const info = { ...metadata, subject: '영어' as const, excludedNumbers: Array.from({ length: 17 }, (_, index) => index + 1) }
    const questions = [{ ...linkedQuestion(), number: 18, reviewed: false }]
    const passages = [{ ...passage(), reviewed: false }]
    await useExamImports().saveDraft(importId, info, questions, passages)
    expect(mocks.invoke).toHaveBeenCalledWith('exam-admin', { body: {
      action: 'save-draft', id: importId, metadata: info, questions, passages,
    } })
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('공통 지문의 각 영역을 별도 이미지로 올린 뒤에만 등록을 요청한다', async () => {
    const questions = [linkedQuestion(), { ...question(secondId, 2), passageClientId: passageId, responseType: 'short_answer' as const }]
    const passages = [passage()]
    const images = passageImages()
    await useExamImports().publishImport(importId, metadata, questions,
      new Map([[firstId, image()], [secondId, image()]]), passages, images)
    expect(mocks.upload).toHaveBeenCalledTimes(4)
    for (const index of [0, 1]) {
      expect(mocks.upload).toHaveBeenNthCalledWith(index + 3,
        `imports/${importId}/passages/${passageId}/${index}.webp`, images.get(passageImageKey(passageId, index))!.blob,
        { contentType: 'image/webp', upsert: true, cacheControl: '0' })
    }
    const saved = mocks.invoke.mock.calls[0]![1].body
    expect(saved.questions).toMatchObject([
      { passageClientId: passageId, instruction: '다음 글을 읽고 물음에 답하시오.', responseType: 'multiple_choice' },
      { passageClientId: passageId, responseType: 'short_answer' },
    ])
    expect(saved.passages).toMatchObject([{ clientId: passageId, reviewed: true,
      imageSizes: [{ width: 1000, height: 1200 }, { width: 1000, height: 1200 }] }])
    expect(passages[0]!.imageSizes).toBeUndefined()
    expect(mocks.invoke.mock.calls.map(call => call[1].body.action)).toEqual(['save-draft', 'publish'])
    expect(mocks.invoke.mock.invocationCallOrder[1]).toBeGreaterThan(mocks.upload.mock.invocationCallOrder[3]!)
  })

  it('지문 검수나 일부 이미지가 빠지면 서버 저장과 업로드를 시작하지 않는다', async () => {
    const imports = useExamImports()
    const images = new Map([[firstId, image()]])
    await expect(imports.publishImport(importId, metadata, [linkedQuestion()], images,
      [{ ...passage(), reviewed: false }], passageImages())).rejects.toThrow('공통 지문도')
    await expect(imports.publishImport(importId, metadata, [linkedQuestion()], images,
      [passage()], new Map([[passageImageKey(passageId, 0), image()]]))).rejects.toThrow('모든 영역')
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('다른 자료의 지문 참조와 연결 문항 없는 지문은 등록할 수 없다', async () => {
    const imports = useExamImports()
    const images = new Map([[firstId, image()]])
    await expect(imports.publishImport(importId, metadata, [linkedQuestion()], images)).rejects.toThrow('문항 번호')
    await expect(imports.publishImport(importId, metadata, [question()], images,
      [passage()], passageImages())).rejects.toThrow('연결된 문항이 없는')
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('너비나 높이가 너무 작은 공통 지문 영역은 저장·업로드 전에 확인을 요청한다', async () => {
    const tiny = passage()
    tiny.regions = [{ page: 1, left: .1, top: .1, right: .105, bottom: .8 }]
    await expect(useExamImports().publishImport(importId, metadata, [linkedQuestion()], new Map([[firstId, image()]]),
      [tiny], new Map([[passageImageKey(passageId, 0), image()]]))).rejects.toThrow('공통 지문의 영역')
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('제외 번호와 남길 문항이 겹치거나 제외 범위가 잘못되면 등록하지 않는다', async () => {
    const imports = useExamImports()
    for (const excludedNumbers of [[1], [18, 18], [0], [101], [1.5]]) {
      await expect(imports.publishImport(importId, { ...metadata, excludedNumbers }, [question()], new Map([[firstId, image()]])))
        .rejects.toThrow('제외한 문항 번호')
    }
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('잘못된 응답 형식이나 지나치게 긴 공통 지시는 등록하지 않는다', async () => {
    const imports = useExamImports()
    await expect(imports.publishImport(importId, metadata, [{ ...question(), responseType: 'essay' as never }],
      new Map([[firstId, image()]]))).rejects.toThrow('문항 번호')
    await expect(imports.publishImport(importId, metadata, [{ ...question(), instruction: 'a'.repeat(2001) }],
      new Map([[firstId, image()]]))).rejects.toThrow('문항 번호')
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('지문 이미지 업로드가 실패해도 초안을 삭제하지 않고 등록 요청을 멈춘다', async () => {
    mocks.upload.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: new Error('failure') })
    await expect(useExamImports().publishImport(importId, metadata, [linkedQuestion()], new Map([[firstId, image()]]),
      [passage()], passageImages())).rejects.toThrow('공통 지문 이미지를 모두 업로드하지 못했어요')
    expect(mocks.upload).toHaveBeenCalledTimes(2)
    expect(mocks.invoke.mock.calls.map(call => call[1].body.action)).toEqual(['save-draft'])
  })

  it('지문 이미지를 올리는 중 관리자 권한이 사라지면 다음 영역과 등록을 멈춘다', async () => {
    let finish!: (value: { error: null }) => void
    mocks.upload.mockResolvedValueOnce({ error: null }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = useExamImports().publishImport(importId, metadata, [linkedQuestion()], new Map([[firstId, image()]]),
      [passage()], passageImages())
    const failure = expect(pending).rejects.toThrow('로그인 상태가 바뀌어')
    await vi.waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(2))
    account.isAdmin.value = false
    finish({ error: null })
    await failure
    expect(mocks.upload).toHaveBeenCalledTimes(2)
    expect(mocks.invoke.mock.calls.map(call => call[1].body.action)).toEqual(['save-draft'])
  })
})

it('태그 없는 수학 문항도 이미지 업로드 후 등록하고 등록 완료 삭제는 별도 작업으로 요청한다', async () => {
  const imports = useExamImports()
  await imports.publishImport(importId, { ...metadata, subject: '수학' }, [{ ...question(), tags: [] }], new Map([[firstId, image()]]))
  expect(mocks.upload).toHaveBeenCalledOnce()
  expect(mocks.invoke.mock.calls.at(-1)![1].body.action).toBe('publish')
  expect(await imports.deleteImport(importId)).toBe('등록했어요.')
  expect(mocks.invoke.mock.calls.at(-1)![1].body).toEqual({ action: 'delete-import', id: importId })
})
