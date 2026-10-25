import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), range: vi.fn(), storageFrom: vi.fn(), download: vi.fn(),
}))
vi.mock('./lib/supabase', () => ({
  supabase: { rpc: mocks.rpc, from: mocks.from, storage: { from: mocks.storageFrom } },
}))
import { useQuestionLibrary } from './questions'

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
  const builder = { select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: mocks.range }
  mocks.from.mockReturnValue(builder)
  mocks.range.mockResolvedValue({ data: [exam()], error: null })
  mocks.storageFrom.mockReturnValue({ download: mocks.download })
  mocks.download.mockResolvedValue({ data: new Blob(['image'], { type: 'image/webp' }), error: null })
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn().mockReturnValue('blob:private-question')
    static revokeObjectURL = vi.fn()
  })
})

describe('학교 전용 문항 불러오기', () => {
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
})
