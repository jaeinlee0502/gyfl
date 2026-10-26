import { describe, expect, it } from 'vitest'
import { analyzePdfText, inferExamMetadata, suggestQuestionTags, verticalContentBounds, type PdfTextPage, type PdfTextRun } from './pdf-import'

const run = (text: string, left: number, top: number, right = left + .36): PdfTextRun => ({ text, left, top, right, bottom: top + .012 })
const header = (subject: string) => [run('2025학년도 3월 고1 전국연합학력평가', .1, .035), run(`${subject} 영역`, .4, .1)]
const item = (number: number, left: number, top: number, text = '알맞은 것을 고르시오.') => run(`${number}. ${text}`, left, top)

describe('과목별 PDF 구조 분석', () => {
  it.each([['탐구 영역(사회)', '통합사회'], ['탐구 영역 (과학)', '통합과학']])('실제 탐구 표제 %s를 사이트 과목에 연결한다', (source, expected) => {
    expect(inferExamMetadata(`2025학년도 3월 고1 ${source}`)).toMatchObject({ subject: expected, grade: 1, year: 2025, month: 3 })
  })

  it('여러 단·쪽에 이어진 공통 지문을 한번만 보관하고 각 문항에 연결한다', () => {
    const pages: PdfTextPage[] = [
      { page: 1, runs: [...header('국어'), item(1, .104, .2), item(2, .104, .5), item(3, .511, .2), run('[4 ~ 5] 다음 글을 읽고 물음에 답하시오.', .511, .5), run('공통 지문 앞부분', .525, .6)] },
      { page: 2, runs: [run('국어 영역', .4, .1), run('공통 지문 뒷부분', .12, .18), item(4, .104, .4), item(5, .511, .4)] },
    ]
    const analysis = analyzePdfText(pages)
    expect(analysis.questions.map(q => q.number)).toEqual([1, 2, 3, 4, 5])
    expect(analysis.passages).toHaveLength(1)
    const passage = analysis.passages![0]!
    expect(passage.regions.map(region => [region.page, region.left > .5])).toEqual([[1, true], [2, false]])
    expect(passage.searchText).toContain('앞부분')
    expect(passage.searchText).toContain('뒷부분')
    expect(passage.searchText).not.toContain('4. 알맞은')
    expect(analysis.questions.filter(q => q.passageClientId === passage.clientId).map(q => q.number)).toEqual([4, 5])
    expect(analysis.questions[3]!.searchText).not.toContain('공통 지문')
    expect(passage.reviewed).toBe(false)
  })

  it('영어 공통 지시를 각 문항에 상속하며 서로 다른 지문을 묶지 않는다', () => {
    const analysis = analyzePdfText([
      { page: 1, runs: [...header('영어'), item(31, .104, .2), item(32, .104, .5), item(33, .511, .2), item(34, .511, .5), run('[31 ~ 34] 다음 빈칸에 들어갈 말로 가장 적절한 것을 고르시오.', .104, .16)] },
    ])
    expect(analysis.passages).toEqual([])
    expect(analysis.questions.map(q => q.number)).toEqual([31, 32, 33, 34])
    for (const question of analysis.questions) {
      expect(question.instruction).toContain('다음 빈칸에 들어갈 말')
      expect(question.tags).toContain('빈칸 추론')
      expect(question.passageClientId).toBeUndefined()
    }
  })

  it('다음 범위의 지시·지문을 앞 문항에 섞지 않는다', () => {
    const analysis = analyzePdfText([
      { page: 1, runs: [...header('영어'), item(35, .104, .2, '다음 글에서 전체 흐름과 관계 없는 문장은?'), run('[36 ~ 37] 주어진 글 다음에 이어질 글의 순서로 가장 적절한 것', .104, .4), run('을 고르시오.', .104, .416), item(36, .104, .46), item(37, .511, .2), run('[41 ~ 42] 다음 글을 읽고, 물음에 답하시오.', .511, .5), run('Statistics passage', .525, .55), item(41, .511, .7), item(42, .511, .8)] },
    ])
    const q35 = analysis.questions.find(q => q.number === 35)!
    const q37 = analysis.questions.find(q => q.number === 37)!
    expect(q35.regions[0]!.bottom).toBeLessThan(.4)
    expect(q35.searchText).not.toContain('이어질 글')
    expect(q35.tags).not.toContain('글의 순서')
    expect(q35.tags).toContain('무관한 문장')
    expect(q37.regions[0]!.bottom).toBeLessThan(.5)
    expect(q37.searchText).not.toContain('Statistics')
    expect(q37.instruction).toContain('글의 순서')
    expect(analysis.passages).toHaveLength(1)
    expect(analysis.questions.filter(q => q.passageClientId).map(q => q.number)).toEqual([41, 42])
  })

  it('영어 원문이 명시한 듣기 번호만 제외하고 남는 문항 번호를 유지한다', () => {
    const pages: PdfTextPage[] = Array.from({ length: 5 }, (_, index) => ({ page: index + 1, runs: index === 0 ? [...header('영어'), run('1번부터', .12, .14), run('17번까지는 듣고 답하는 문제입니다.', .2, .14)] : [] }))
    for (let number = 1; number <= 45; number++) {
      const slot = number - 1, page = pages[Math.floor(slot / 10)]!
      page.runs.push(item(number, slot % 10 < 5 ? .104 : .511, .2 + (slot % 5) * .13))
    }
    const analysis = analyzePdfText(pages)
    expect(analysis.metadata.excludedNumbers).toEqual(Array.from({ length: 17 }, (_, index) => index + 1))
    expect(analysis.questions.map(q => q.number)).toEqual(Array.from({ length: 28 }, (_, index) => index + 18))
    expect(analysis.warnings.some(warning => warning.includes('1~17번은 제외'))).toBe(true)
  })

  it('명시된 듣기 범위가 1~5이면 17번까지 임의로 제외하지 않는다', () => {
    const analysis = analyzePdfText([{ page: 1, runs: [...header('영어'), run('1번부터 5번까지는 듣고 답하는 문제입니다.', .12, .14), ...Array.from({ length: 6 }, (_, index) => item(index + 1, .104, .2 + index * .1))] }])
    expect(analysis.metadata.excludedNumbers).toEqual([1, 2, 3, 4, 5])
    expect(analysis.questions.map(q => q.number)).toEqual([6])
  })

  it('범위가 없는 영어 파일의 번호를 추측해서 삭제하지 않는다', () => {
    const analysis = analyzePdfText([{ page: 1, runs: [...header('영어'), item(1, .104, .2, '대화를 듣고 답하시오.'), item(2, .104, .5)] }])
    expect(analysis.questions.map(q => q.number)).toEqual([1, 2])
    expect(analysis.metadata.excludedNumbers).toBeUndefined()
    expect(analysis.warnings.some(warning => warning.includes('범위를 확정하지 못했어요'))).toBe(true)
  })

  it('수학 단답형 표제 이후만 단답형으로 표시하며 선택지 유무를 억지로 보정하지 않는다', () => {
    const analysis = analyzePdfText([{ page: 1, runs: [...header('수학'), item(1, .104, .2), item(2, .511, .2), run('단 답 형', .55, .5), item(3, .511, .55, '값을 구하시오. [3점]')] }])
    expect(analysis.questions.map(q => q.responseType)).toEqual(['multiple_choice', 'multiple_choice', 'short_answer'])
    expect(analysis.questions[2]!.points).toBe(3)
  })

  it('고전소설과 중학교 삼각비를 단순 단어 때문에 다른 영역으로 추천하지 않는다', () => {
    const classical = suggestQuestionTags('국어', '작자 미상 고전소설에서 서술자와 태자의 심리를 이해한다.')
    expect(classical).toContain('고전소설')
    expect(classical).not.toContain('현대소설')
    const middleSchool = suggestQuestionTags('수학', '직각삼각형에서 cos 값을 구한다.')
    expect(middleSchool).toContain('삼각비')
    expect(middleSchool).not.toContain('삼각함수')
  })

  it('일반 단어의 부분 문자열이나 문학 속 소재를 장르로 오인하지 않는다', () => {
    const law = suggestQuestionTags('국어', '민사법과 형사법. 안전하게 운전하도록 할 의무에 대한 소송이다.')
    expect(law).toContain('독서')
    expect(law).not.toContain('고전소설')
    const economics = suggestQuestionTags('국어', '공리주의와 경제학의 효용 이론. 효용을 극대화하는 선택.')
    expect(economics).toContain('독서')
    expect(economics).not.toContain('화법')
    const fiction = suggestQuestionTags('국어', '이문구의 소설에서 인물이 물자의 효용에 현혹된다. 윗글의 내용을 이해한다.')
    expect(fiction).toContain('현대소설')
    expect(fiction).not.toContain('독서')
  })

  it('줄 바꿈으로 떨어진 영어 함축 의미와 배열 지시도 분류한다', () => {
    expect(suggestQuestionTags('영어', '밑줄 친 표현이 의미 하는 바로 가장 적절한 것은?')).toContain('어휘')
    expect(suggestQuestionTags('영어', '주어진 글 (A)에 이어질 내용을 순서에 맞게 배열한 것으로 가장 적절한 것은?')).toContain('글의 순서')
  })
})

describe('문항 이미지의 바깥 빈 여백', () => {
  function white(width: number, height: number) { return new Uint8ClampedArray(width * height * 4).fill(255) }
  it('가는 도형 선 한 픽셀도 내용으로 보존하고 안전 여백을 둔다', () => {
    const pixels = white(10, 100)
    pixels[(20 * 10 + 5) * 4] = 0
    pixels[(80 * 10 + 9) * 4] = 0
    expect(verticalContentBounds(pixels, 10, 100, 4)).toEqual({ top: 16, bottom: 85 })
  })
  it('아예 빈 영역은 임의의 내용 크기로 바꾸지 않는다', () => {
    expect(verticalContentBounds(white(10, 100), 10, 100)).toEqual({ top: 0, bottom: 100 })
  })
  it('투명한 검은 픽셀은 내용으로 보지 않는다', () => {
    const pixels = white(10, 100)
    pixels.fill(0, 0, 4)
    expect(verticalContentBounds(pixels, 10, 100)).toEqual({ top: 0, bottom: 100 })
  })
})
