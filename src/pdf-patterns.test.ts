import { describe, expect, it } from 'vitest'
import { analyzePdfText, inferExamMetadata, suggestQuestionTags, verticalContentBounds, type PdfTextPage, type PdfTextRun } from './pdf-import'

const run = (text: string, left: number, top: number, right = left + .36): PdfTextRun => ({ text, left, top, right, bottom: top + .012 })
const header = (subject: string) => [run('2025학년도 3월 고1 전국연합학력평가', .1, .035), run(`${subject} 영역`, .4, .1)]
const item = (number: number, left: number, top: number, text = '알맞은 것을 고르시오.') => run(`${number}. ${text}`, left, top)

describe('과목별 PDF 구조 분석', () => {
  it.each([['탐구 영역(사회)', '통합사회'], ['탐구 영역 (과학)', '통합과학']])('실제 탐구 표제 %s를 사이트 과목에 연결한다', (source, expected) => {
    expect(inferExamMetadata(`2025학년도 3월 고1 ${source}`)).toMatchObject({ subject: expected, grade: 1, year: 2025, month: 3 })
  })

  it.each([
    '1 2025학년도 6월 고1 사회탐구 영역 (통합사회)',
    '1 2025 학 년 도 6월 고1 사회탐구 영역 (통합사회)',
    '1 2 0 2 5 학년도 6월 고1 사회탐구 영역 (통합사회)',
    '１ ２０２５학년도 ６월 고１ 사회탐구 영역 (통합사회)',
  ])('페이지 번호와 연도가 인접하거나 글자가 나뉜 표지도 읽는다 (%s)', text => {
    expect(inferExamMetadata(text)).toMatchObject({ year: 2025, month: 6, grade: 1, subject: '통합사회' })
  })

  it('연도가 없거나 더 긴 숫자의 일부이면 연도를 추측하지 않는다', () => {
    expect(inferExamMetadata('6월 고1 사회탐구 영역 (통합사회)').year).toBeUndefined()
    expect(inferExamMetadata('12025학년도 6월 고1 사회탐구 영역 (통합사회)').year).toBeUndefined()
  })

  it('문제 본문이 먼저 추출돼도 상단의 시험 연도를 우선한다', () => {
    const analysis = analyzePdfText([{ page: 1, runs: [
      item(1, .104, .186, '2018년의 사회 현상을 살펴보자.'),
      run('1', .108, .081, .12),
      run('2025학년도 6월 고1 전국연합학력평가 문제지', .27, .088),
      run('사회탐구 영역 (통합사회)', .283, .122),
    ] }])
    expect(analysis.metadata).toMatchObject({ year: 2025, month: 6, grade: 1, subject: '통합사회' })
    expect(analysis.questions).toHaveLength(1)
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

  it('오른쪽 단이 페이지 중앙보다 왼쪽에서 시작해도 문항과 공통 지문을 구별한다', () => {
    const analysis = analyzePdfText([{ page: 1, runs: [...header('국어'),
      run('[1~3] 다음 글을 읽고 물음에 답하시오.', .08, .16), run('함께 읽는 본문', .1, .3),
      item(1, .08, .7), item(2, .486, .2), item(3, .486, .5)] }])
    expect(analysis.questions.map(q => q.number)).toEqual([1, 2, 3])
    expect(analysis.passages).toHaveLength(1)
    expect(analysis.passages![0]!.regions[0]!.right).toBeLessThan(.48)
    expect(analysis.questions[1]!.regions[0]!.left).toBeCloseTo(.48)
    expect(analysis.questions[1]!.searchText).not.toContain('함께 읽는 본문')
    expect(analysis.questions.every(q => q.passageClientId === analysis.passages![0]!.clientId)).toBe(true)
  })

  it('중앙 왼쪽의 오른쪽 단에서 시작하는 11~12번 지문에 앞 문항과 다른 단을 섞지 않는다', () => {
    const analysis = analyzePdfText([
      { page: 4, runs: [...header('국어'), item(9, .08, .15, '앞 문항 내용'),
        run('앞 문항 선택지', .1, .6), item(10, .486, .15, '푸드테크 문항'),
        run('[11~12] 다음 글을 읽고 물음에 답하시오.', .486, .46), run('음운 변동 지문', .5, .55)] },
      { page: 5, runs: [run('국어 영역', .4, .1), item(11, .08, .125, '지문의 음운 변동을 적용하시오.'),
        item(12, .08, .55), item(13, .486, .125)] },
    ])
    expect(analysis.questions.map(q => q.number)).toEqual([9, 10, 11, 12, 13])
    expect(analysis.passages).toHaveLength(1)
    const shared = analysis.passages![0]!
    expect(shared.regions).toHaveLength(1)
    expect(shared.regions[0]).toMatchObject({ page: 4 })
    expect(shared.regions[0]!.left).toBeCloseTo(.48)
    expect(shared.searchText).toContain('음운 변동 지문')
    expect(shared.searchText).not.toMatch(/앞 문항|푸드테크|지문의 음운/)
    expect(analysis.questions.find(q => q.number === 10)!.regions[0]!.bottom).toBeLessThan(.46)
    expect(analysis.questions.filter(q => q.passageClientId === shared.clientId).map(q => q.number)).toEqual([11, 12])
  })

  it('이동한 오른쪽 단의 분리된 문항 번호와 이어지는 지문도 인식한다', () => {
    const analysis = analyzePdfText([
      { page: 1, runs: [...header('국어'), run('[34~37] 다음 글을 읽고 물음에 답하시오.', .08, .16),
        run('앞부분', .1, .3), run('뒷부분', .5, .2), run('34', .486, .7, .51), run('. 내용을 이해한 것은?', .513, .702)] },
      { page: 2, runs: [item(35, .08, .2), item(36, .08, .5), item(37, .486, .2)] },
    ])
    expect(analysis.questions.map(q => q.number)).toEqual([34, 35, 36, 37])
    expect(analysis.passages).toHaveLength(1)
    expect(analysis.passages![0]!.regions.map(r => r.left > .47)).toEqual([false, true])
    expect(analysis.passages![0]!.searchText).toContain('뒷부분')
    expect(analysis.passages![0]!.searchText).not.toContain('34 . 내용을')
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

  it('듣기 15번의 번호와 마침표가 나뉘어 있어도 독해 18~45번과 공통 지문을 인식한다', () => {
    const pages: PdfTextPage[] = Array.from({ length: 5 }, (_, index) => ({ page: index + 1,
      runs: index === 0 ? [...header('영어'), run('1번부터 17번까지는 듣고 답하는 문제입니다.', .12, .14)] : [] }))
    for (let number = 1; number <= 45; number++) {
      const slot = number - 1, page = pages[Math.floor(slot / 10)]!
      const left = slot % 10 < 5 ? .104 : .511, top = .22 + (slot % 5) * .13
      if (number === 15) page.runs.push(run('15', left, top, left + .018), run('. 듣고 알맞은 말을 고르시오.', left + .018, top + .0019))
      else page.runs.push(item(number, left, top))
    }
    pages[4]!.runs.push(run('[41~42] 다음 글을 읽고, 물음에 답하시오.', .104, .16))
    const analysis = analyzePdfText(pages)
    expect(analysis.questions.map(q => q.number)).toEqual(Array.from({ length: 28 }, (_, index) => index + 18))
    expect(analysis.metadata.excludedNumbers).toEqual(Array.from({ length: 17 }, (_, index) => index + 1))
    expect(analysis.passages).toHaveLength(1)
    expect(analysis.questions.filter(q => q.passageClientId).map(q => q.number)).toEqual([41, 42])
    expect(analysis.warnings.some(warning => warning.includes('누락된 문항'))).toBe(false)
  })

  it('중간 독해 번호를 읽지 못해도 뒤 문항은 유지하고 누락된 번호를 안내한다', () => {
    const analysis = analyzePdfText([{ page: 1, runs: [...header('영어'),
      item(18, .104, .2), item(19, .104, .4), item(21, .511, .2), item(22, .511, .5)] }])
    expect(analysis.questions.map(q => q.number)).toEqual([18, 19, 21, 22])
    expect(analysis.warnings).toContain('20번 문항 번호를 자동으로 찾지 못했어요. 뒤의 문항은 유지했으니 원본에서 누락된 문항을 확인하고 직접 추가해 주세요.')
  })

  it('듣기 번호 하나를 읽지 못해도 뒤의 독해를 버리지 않는다', () => {
    const analysis = analyzePdfText([{ page: 1, runs: [...header('영어'),
      run('1번부터 5번까지는 듣고 답하는 문제입니다.', .12, .14),
      item(1, .104, .2), item(2, .104, .4), item(4, .511, .2), item(5, .511, .4), item(6, .511, .6)] }])
    expect(analysis.questions.map(q => q.number)).toEqual([6])
    expect(analysis.warnings.some(warning => warning.includes('누락된 문항'))).toBe(false)
  })

  it('문항 안에 반복된 번호나 소수·연도를 새 문항으로 오인하지 않는다', () => {
    const analysis = analyzePdfText([{ page: 1, runs: [...header('영어'),
      item(1, .104, .2), item(2, .104, .4), item(3, .511, .2),
      item(1, .511, .3), item(2, .511, .4), run('17.8 percent', .511, .5),
      run('2025. 안내문', .511, .6), item(4, .511, .7)] }])
    expect(analysis.questions.map(q => q.number)).toEqual([1, 2, 3, 4])
    expect(analysis.questions[2]!.regions[0]!.bottom).toBeCloseTo(.692)
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
