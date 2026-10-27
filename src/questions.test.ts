import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), range: vi.fn(), passageIn: vi.fn(), storageFrom: vi.fn(), download: vi.fn(), maybeSingle: vi.fn(),
}))
vi.mock('./lib/supabase', () => ({
  supabase: { rpc: mocks.rpc, from: mocks.from, storage: { from: mocks.storageFrom } },
}))
import { useQuestionLibrary } from './questions'
import { QuestionTagsConflictError } from './tag-editing'

const exam = (number = 1) => ({
  id: `exam-history-${number}`, subject: '한국사', grade: 1, year: 2025, month: 3,
  number, title: '시대 구분', tags: ['현대사'], image_path: `2025/03/history/${number}.webp`,
  width: 1000, height: 1400, points: 3,
  source_url: 'https://www.ebsi.co.kr/ebs/exam', explanation_url: 'https://www.ebsi.co.kr/ebs/exam',
  source_page: 1, curriculum_status: 'source_scope_recorded', search_text: '검색할 문제 원문',
})

beforeEach(() => {
  vi.resetAllMocks()
  mocks.rpc.mockResolvedValue({ data: true, error: null })
  const builder = { select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: mocks.range, eq: vi.fn().mockReturnThis(), maybeSingle: mocks.maybeSingle }
  const passageBuilder = { select: vi.fn().mockReturnThis(), in: mocks.passageIn }
  mocks.from.mockImplementation(table => table === 'exam_passages' ? passageBuilder : builder)
  mocks.passageIn.mockResolvedValue({ data: [], error: null })
  mocks.range.mockResolvedValue({ data: [exam()], error: null })
  mocks.storageFrom.mockReturnValue({ download: mocks.download })
  mocks.download.mockResolvedValue({ data: new Blob(['image'], { type: 'image/webp' }), error: null })
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn().mockReturnValue('blob:private-question')
    static revokeObjectURL = vi.fn()
  })
})

describe('학교 전용 문항 불러오기', () => {
  it('태그 충돌 뒤 최신 태그만 다시 읽고 이미지를 재요청하지 않는다', async () => {
    const library = useQuestionLibrary()
    await library.loadQuestions()
    mocks.maybeSingle.mockResolvedValueOnce({ data: { id: exam().id, tags: ['현대사', '경제사'] }, error: null })
    expect(await library.loadQuestionTags(exam().id)).toEqual(['현대사', '경제사'])
    expect(library.questionItems.value[0]!.tags).toEqual(['현대사', '경제사'])
    expect(mocks.download).toHaveBeenCalledOnce()
    library.clearQuestions()
  })
  it('공유 태그 저장 결과를 반영하면서 기존 문제 이미지는 유지한다', async () => {
    const library = useQuestionLibrary()
    await library.loadQuestions()
    mocks.rpc.mockResolvedValueOnce({ data: { id: exam().id, tags: ['현대사', '수업 분류'] }, error: null })
    expect(await library.updateQuestionTags(exam().id, ['현대사'], ['현대사', ' 수업  분류 '])).toEqual(['현대사', '수업 분류'])
    expect(mocks.rpc).toHaveBeenLastCalledWith('update_exam_question_tags', { p_question_id: exam().id, p_expected_tags: ['현대사'], p_tags: ['현대사', '수업 분류'] })
    expect(library.questionItems.value[0]).toMatchObject({ tags: ['현대사', '수업 분류'], imageUrl: 'blob:private-question' })
    expect(mocks.download).toHaveBeenCalledOnce()
    library.clearQuestions()
  })

  it('동시 수정 충돌이나 승인 취소는 기존 태그를 바꾸지 않고 안내한다', async () => {
    const library = useQuestionLibrary()
    await library.loadQuestions()
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'QUESTION_TAGS_CONFLICT' } })
    await expect(library.updateQuestionTags(exam().id, ['현대사'], ['정치사'])).rejects.toBeInstanceOf(QuestionTagsConflictError)
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'SCHOOL_ACCESS_REQUIRED' } })
    await expect(library.updateQuestionTags(exam().id, ['현대사'], ['정치사'])).rejects.toThrow('학교 이용 승인')
    expect(library.questionItems.value[0]!.tags).toEqual(['현대사'])
    library.clearQuestions()
  })

  it('계정 변경이나 다시 불러오기 후 늦게 온 저장 결과를 적용하지 않는다', async () => {
    const library = useQuestionLibrary()
    await library.loadQuestions()
    let finish!: (result: unknown) => void
    mocks.rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = library.updateQuestionTags(exam().id, ['현대사'], ['정치사'])
    library.clearQuestions()
    finish({ data: { id: exam().id, tags: ['정치사'] }, error: null })
    await expect(pending).rejects.toThrow('로그인 상태나 문제 목록')
    expect(library.questionItems.value).toEqual([])
  })

  it('태그 개수·길이를 확인한 뒤에만 저장 요청을 보낸다', async () => {
    const library = useQuestionLibrary()
    await library.loadQuestions()
    mocks.rpc.mockClear()
    await expect(library.updateQuestionTags(exam().id, ['현대사'], Array(21).fill('태그'))).rejects.toThrow('20개')
    await expect(library.updateQuestionTags(exam().id, ['현대사'], ['가'.repeat(61)])).rejects.toThrow('60자')
    expect(mocks.rpc).not.toHaveBeenCalled()
    library.clearQuestions()
  })
  it('서버의 이용 승인 확인이 실패하면 문제나 파일을 요청하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null })
    const library = useQuestionLibrary()
    await library.loadQuestions()
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.download).not.toHaveBeenCalled()
    expect(library.questionItems.value).toEqual([])
    expect(library.error.value).toBeTruthy()
  })

  it('비공개 저장소에서 인증 다운로드하고 EBS 링크와 원문 검색 정보를 연결한다', async () => {
    const library = useQuestionLibrary()
    await library.loadQuestions()
    expect(mocks.storageFrom).toHaveBeenCalledWith('school-questions')
    expect(mocks.download).toHaveBeenCalledWith('2025/03/history/1.webp', { cacheNonce: expect.any(String) }, { cache: 'no-store' })
    expect(library.questionItems.value[0]).toMatchObject({
      kind: 'exam', imageUrl: 'blob:private-question', curriculum: 'unverified',
      passage: '검색할 문제 원문', explanationUrl: 'https://www.ebsi.co.kr/ebs/exam',
      answer: 0, explanation: '',
    })
    library.clearQuestions()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-question')
    expect(library.questionItems.value).toEqual([])
  })

  it('로그아웃 뒤 늦게 도착한 이미지로 문항을 다시 표시하지 않는다', async () => {
    let finish!: (result: unknown) => void
    mocks.download.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const library = useQuestionLibrary()
    const pending = library.loadQuestions()
    await vi.waitFor(() => expect(mocks.download).toHaveBeenCalled())
    library.clearQuestions()
    finish({ data: new Blob(['image']), error: null })
    await pending
    expect(library.questionItems.value).toEqual([])
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(library.error.value).toBe('')
  })

  it('일부 이미지 실패 시 불완전한 문항 목록을 표시하지 않고 할당한 URL을 해제한다', async () => {
    mocks.range.mockResolvedValue({ data: [exam(1), exam(2)], error: null })
    mocks.download.mockResolvedValueOnce({ data: new Blob(['image']), error: null })
      .mockResolvedValueOnce({ data: null, error: new Error('denied') })
    const library = useQuestionLibrary()
    await library.loadQuestions()
    expect(library.questionItems.value).toEqual([])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-question')
    expect(library.error.value).toBeTruthy()
  })

  it('잘못된 외부 링크는 버튼에 전달하지 않는다', async () => {
    mocks.range.mockResolvedValue({ data: [{ ...exam(), explanation_url: 'javascript:alert(1)' }], error: null })
    const library = useQuestionLibrary()
    await library.loadQuestions()
    expect(library.questionItems.value[0]?.explanationUrl).toBe('')
    library.clearQuestions()
  })

  it('공통 지문 이미지는 한 번만 인증 다운로드하고 연결 문항들이 함께 참조한다', async () => {
    const shared = {
      id: 'shared-passage-1', title: '통계의 활용', search_text: '숫자와 언어의 한계',
      images: [{ path: 'imports/exam/passages/passage/0.webp', width: 900, height: 1600, page: 8 }],
    }
    mocks.range.mockResolvedValue({ data: [
      { ...exam(41), passage_id: shared.id, instruction: '다음 글을 읽고 답하시오.', response_type: 'multiple_choice' },
      { ...exam(42), passage_id: shared.id, response_type: 'short_answer' },
    ], error: null })
    mocks.passageIn.mockResolvedValue({ data: [shared], error: null })
    let next = 0
    vi.mocked(URL.createObjectURL).mockImplementation(() => `blob:private-${++next}`)
    const library = useQuestionLibrary()
    await library.loadQuestions()
    expect(mocks.passageIn).toHaveBeenCalledWith('id', [shared.id])
    expect(mocks.download.mock.calls.map(call => call[0])).toEqual([
      shared.images[0]!.path, '2025/03/history/41.webp', '2025/03/history/42.webp',
    ])
    expect(library.questionItems.value[0]!.sharedPassage).toBe(library.questionItems.value[1]!.sharedPassage)
    expect(library.questionItems.value[0]).toMatchObject({
      passage: '검색할 문제 원문 다음 글을 읽고 답하시오. 숫자와 언어의 한계',
      instruction: '다음 글을 읽고 답하시오.', responseType: 'multiple_choice',
      sharedPassage: { title: shared.title, images: [{ imageUrl: 'blob:private-1', page: 8 }] },
    })
    expect(library.questionItems.value[1]!.responseType).toBe('short_answer')
    library.clearQuestions()
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3)
  })

  it('필수 공통 지문이 없거나 잘못된 경로이면 불완전한 문제를 표시하지 않는다', async () => {
    mocks.range.mockResolvedValue({ data: [{ ...exam(), passage_id: 'missing-passage' }], error: null })
    const library = useQuestionLibrary()
    await library.loadQuestions()
    expect(library.error.value).toBeTruthy()
    expect(mocks.download).not.toHaveBeenCalled()
    mocks.passageIn.mockResolvedValue({ data: [{ id: 'missing-passage', title: '공통 지문', search_text: '',
      images: [{ path: '../draft.webp', width: 900, height: 1000, page: 1 }] }], error: null })
    await library.loadQuestions()
    expect(library.questionItems.value).toEqual([])
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('공통 지문 일부를 불러온 뒤 로그아웃하면 할당한 URL도 회수한다', async () => {
    mocks.range.mockResolvedValue({ data: [{ ...exam(), passage_id: 'passage-1' }], error: null })
    mocks.passageIn.mockResolvedValue({ data: [{ id: 'passage-1', title: '두 쪽 지문', search_text: '공통 지문', images: [
      { path: 'imports/exam/passages/passage/0.webp', width: 900, height: 1000, page: 1 },
      { path: 'imports/exam/passages/passage/1.webp', width: 900, height: 1000, page: 2 },
    ] }], error: null })
    let finish!: (result: unknown) => void
    mocks.download.mockResolvedValueOnce({ data: new Blob(['part-one']), error: null })
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const library = useQuestionLibrary()
    const pending = library.loadQuestions()
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledOnce())
    library.clearQuestions()
    finish({ data: new Blob(['late-part-two']), error: null })
    await pending
    expect(library.questionItems.value).toEqual([])
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-question')
    expect(library.error.value).toBe('')
  })
})
