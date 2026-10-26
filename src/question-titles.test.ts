import { describe, expect, it } from 'vitest'
import { suggestQuestionTitle } from './question-titles'

describe('문항의 개념과 주제를 담는 제목 추천', () => {
  it('원문 수식을 제목으로 복사하지 않고 제곱근 계산 개념을 표시한다', () => {
    expect(suggestQuestionTitle({ subject: '수학', number: 1, text: '1. √8 × √2 + √5 의 값은? [2점] ① √7 ② √9' }))
      .toBe('제곱근의 곱셈과 덧셈')
  })

  it('정규화하지 못한 사설 글리프를 임의의 수학 개념으로 해석하지 않는다', () => {
    const title = suggestQuestionTitle({ subject: '수학', number: 7, text: '\ue05c 7. \ue048 \ue06d 의 값은? � □' })
    expect(title).toBe('수학 개념과 조건의 이해')
    expect(title).not.toMatch(/[\uE000-\uF8FF�□]/)
  })

  it('기울기·절편, 단답형 부등식과 도형 조건을 직접 드러낸다', () => {
    expect(suggestQuestionTitle({ subject: '수학', number: 5, text: '일차함수의 그래프에서 기울기와 절편의 곱은?' })).toBe('일차함수의 기울기와 절편')
    expect(suggestQuestionTitle({ subject: '수학', number: 23, text: '일차부등식을 만족시키는 자연수의 최솟값을 구하시오.' })).toBe('일차부등식과 자연수 조건')
    expect(suggestQuestionTitle({ subject: '수학', number: 19, text: '삼각형의 외심과 다른 삼각형의 내심을 이용하여 선분의 길이를 구하시오.' })).toBe('삼각형의 외심과 내심')
  })

  it('답안 선택지의 개념과 정답을 제목으로 사용하지 않는다', () => {
    const title = suggestQuestionTitle({ subject: '수학', number: 3, text: '이차방정식의 두 근을 구하시오. ① √4 ② 2 ③ 3' })
    expect(title).toBe('이차방정식의 근')
    expect(title).not.toMatch(/√|정답|①|②|③/)
  })

  it('드러나지 않은 풀이 방법을 도형 제목에 단정하지 않는다', () => {
    const title = suggestQuestionTitle({ subject: '수학', number: 12, text: '원 O와 삼각형 ABC가 만난다. 두 삼각형의 넓이의 관계를 구하시오.' })
    expect(title).toBe('원과 삼각형의 넓이 관계')
    expect(title).not.toContain('닮음')
    expect(title).not.toContain('피타고라스')
  })

  it('읽을 수 있는 조건만 있어도 단원과 개념을 묶는다', () => {
    expect(suggestQuestionTitle({ subject: '수학', number: 13, text: '원기둥 모양의 통 안에 구 모양의 물체를 넣었다.' })).toBe('원기둥과 구의 부피')
    expect(suggestQuestionTitle({ subject: '수학', number: 14, text: '자료의 편차를 나타낸 표에서 분산을 구하시오.' })).toBe('편차와 분산의 관계')
    expect(suggestQuestionTitle({ subject: '수학', number: 8, text: '삼각형의 무게중심을 지나고 한 변과 평행한 선분의 길이는?' })).toBe('삼각형의 무게중심과 선분의 길이')
  })

  it('개념을 확인할 수 없으면 검수자가 고른 태그를 활용한다', () => {
    expect(suggestQuestionTitle({ subject: '수학', number: 2, text: '값을 구하시오.', tags: ['행렬', '행렬'] })).toBe('행렬의 핵심 개념')
  })

  it('국어는 공통 지문의 주제와 문항의 평가 요소를 함께 쓴다', () => {
    const title = suggestQuestionTitle({ subject: '국어', number: 18,
      text: '18. (가)와 (나)의 공통점으로 가장 적절한 것은?',
      passageText: '(가)는 공리주의를, (나)는 효용 이론을 설명한다.' })
    expect(title).toBe('공리주의와 효용 이론의 공통점 비교')
    expect(title).not.toContain('가장 적절한')
  })

  it('작품과 작가는 지문의 출처 표기에서 읽고 서술 방식을 붙인다', () => {
    const title = suggestQuestionTitle({ subject: '국어', number: 22,
      text: '윗글의 서술 방식으로 적절하지 않은 것은?',
      passageText: '한 인물의 이야기가 전개된다. - 김가람, ｢ 먼 길 ｣ -' })
    expect(title).toBe('김가람 「먼 길」의 서술 방식')
  })

  it('소설의 설명 문항은 서술 방식으로 제안하되 시에 같은 방식을 적용하지 않는다', () => {
    const input = { subject: '국어' as const, number: 22, text: '윗글에 대한 설명으로 적절한 것은?',
      passageText: '한 작품의 일부이다. - 김가람, 「먼 길」 -' }
    expect(suggestQuestionTitle({ ...input, tags: ['현대소설'] })).toBe('김가람 「먼 길」의 서술 방식')
    expect(suggestQuestionTitle({ ...input, tags: ['현대시'] })).not.toContain('서술 방식')
  })

  it('주제와 평가 요소의 조사를 중복하지 않고 글쓰기 방식을 표시한다', () => {
    expect(suggestQuestionTitle({ subject: '국어', number: 8, text: '초고에 활용된 글쓰기 방식은?',
      passageText: '메모를 통해 지난 경험과 정서를 표현한 글이다.' }))
      .toBe('메모를 통한 경험과 정서의 표현 · 글쓰기 방식')
    expect(suggestQuestionTitle({ subject: '국어', number: 38, text: '문맥상 낱말의 의미로 적절한 것은?',
      passageText: '형사 소송과 민사 소송의 입증에 관한 글이다.' }))
      .toBe('형사·민사 소송과 입증 · 어휘의 의미')
  })

  it('두 작품의 지문은 두 제목을 보존하고 개별 문항의 기능을 구별한다', () => {
    const passageText = '(가) 시의 일부 - 이보람, 「이른 봄」 - (나) 시의 일부 - 박서윤, 「저녁」 -'
    const title = suggestQuestionTitle({ subject: '국어', number: 27, text: '(가)와 (나)의 표현상 공통점은?', passageText })
    expect(title).toBe('이보람 「이른 봄」·박서윤 「저녁」의 표현 방식 비교')
    expect(suggestQuestionTitle({ subject: '국어', number: 28, text: '시상의 흐름을 고려하여 이해한 것은?', passageText })).toContain('시상 전개')
  })

  it('문법 문제는 질문 전체 대신 학습 개념으로 짧게 쓴다', () => {
    expect(suggestQuestionTitle({ subject: '국어', number: 11, text: '윗글에서 알 수 있는 내용은?', passageText: '본용언과 보조 용 언을 구별하는 기준을 설명한다.' })).toBe('본용언과 보조 용언')
    expect(suggestQuestionTitle({ subject: '국어', number: 15, text: '<보기>의 사이시옷 표기 조건을 탐구한 내용으로 적절하지 않은 것은?' })).toBe('사이시옷의 표기 조건')
  })

  it('지문의 내용이 없는 경우 선택지에 등장한 작품을 출처로 오인하지 않는다', () => {
    const title = suggestQuestionTitle({ subject: '국어', number: 4, text: '설명 방식으로 적절한 것은? ① - 거짓작가, 「다른 작품」 -', tags: ['독서'] })
    expect(title).not.toContain('거짓작가')
    expect(title).not.toContain('다른 작품')
  })

  it('국어 과학 지문은 과목을 바꾸지 않고 과학 소재와 기능을 설명한다', () => {
    expect(suggestQuestionTitle({ subject: '국어', number: 30, text: '원인을 추론한 내용으로 적절한 것은?', passageText: 'C3 식물과 C4 식물의 광합성 과정을 비교한다.' })).toBe('C3·C4 식물의 광합성 · 원인 추론')
  })

  it('영어 공통 풀이 안내도 문항 유형 제목에 반영한다', () => {
    expect(suggestQuestionTitle({ subject: '영어', number: 32, text: '32. A passage about everyday life.', instruction: '다음 빈칸에 들어갈 말로 가장 적절한 것은?' })).toBe('문맥을 활용한 빈칸 추론')
    expect(suggestQuestionTitle({ subject: '영어', number: 43, text: '다음 글을 순서에 맞게 배열한 것은?' })).toBe('문단의 연결과 글의 순서')
  })

  it('사회·과학·한국사에서도 명시된 개념을 제목으로 사용한다', () => {
    expect(suggestQuestionTitle({ subject: '통합사회', number: 2, text: '원·달러 환율 변동의 영향을 파악하시오.' })).toBe('환율 변동과 경제생활')
    expect(suggestQuestionTitle({ subject: '통합과학', number: 9, text: '전압과 전류를 측정한 전기 회로를 나타낸 것이다.' })).toBe('전기 회로와 전압·전류의 관계')
    expect(suggestQuestionTitle({ subject: '한국사', number: 7, text: '서원에서 이루어진 교육과 사림의 활동을 설명하시오.' })).toBe('서원의 교육 기능과 사림의 활동')
  })

  it('알 수 없는 과목과 아주 긴 태그에도 제목 길이와 문자 품질을 지킨다', () => {
    expect(suggestQuestionTitle({ number: 1, text: '�□\ue034' })).toBe('문항의 핵심 개념과 조건')
    const title = suggestQuestionTitle({ number: 1, text: '', tags: ['매우긴개념'.repeat(100), '\ue034'] })
    expect(title.length).toBeLessThanOrEqual(100)
    expect(title).not.toMatch(/[\uE000-\uF8FF�□]/)
  })
})
