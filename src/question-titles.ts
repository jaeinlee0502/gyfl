import type { Subject } from './data'

export interface QuestionTitleInput {
  subject?: Subject
  number: number
  text: string
  passageText?: string
  instruction?: string
  tags?: string[]
}

// These are editable, local topic suggestions. No answer is inferred and no
// document is sent to an external model. Never copy damaged PDF glyphs into a title.
const damaged = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}\uFFFD\u25A1\u25A0]/gu
function readable(value: string | undefined) {
  return (value ?? '').normalize('NFKC').replace(damaged, ' ')
    .replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
}
function compact(value: string) { return value.replace(/\s+/g, '') }
function stem(value: string) {
  // Distractors can deliberately mention another topic or a false conclusion.
  return readable(value.split(/[①②③④⑤]/u, 1)[0])
    .replace(/^\s*\d+\s*[.)]\s*/, '').replace(/\[\s*\d+\s*점\s*\]/g, '').trim()
}
function finish(value: string) { return readable(value).slice(0, 100).trim() }
function tagged(input: QuestionTitleInput, fallback: string) {
  const tags = [...new Set((input.tags ?? []).map(readable).filter(tag => tag && !/[?？]/.test(tag)))]
  return tags.length ? `${tags.slice(0, 2).join('·')}의 핵심 개념` : fallback
}

function mathTitle(input: QuestionTitleInput) {
  const text = stem(input.text), key = compact(text)
  // The PDF reader supplies only font-verified math symbol conversions. An
  // unknown private glyph is not evidence of a root, fraction, or exponent.
  if (/제곱근|근호|√/.test(key) && !/방정식|함수|삼각형|사각형|원기둥|직육면체/.test(key)) {
    if (/[×⋅·*]/.test(text) && /[+＋]/.test(text)) return '제곱근의 곱셈과 덧셈'
    if (/[×⋅·*]/.test(text)) return '제곱근의 곱셈'
    if (/[+＋−-]/.test(text)) return '제곱근의 덧셈과 뺄셈'
    return '제곱근의 성질과 계산'
  }
  if (/도수분포다각형/.test(key)) return '도수분포다각형의 자료 해석'
  if (/도수분포표|히스토그램/.test(key)) return '도수분포와 통계 자료의 해석'
  if (/편차/.test(key) && /분산/.test(key)) return '편차와 분산의 관계'
  if (/분산|표준편차/.test(key)) return '자료의 산포도와 분산'
  if (/확률/.test(key)) return /주사위/.test(key) ? '주사위의 눈의 수와 확률' : '사건의 경우의 수와 확률'
  if (/순열|조합|경우의수/.test(key)) return '순열·조합과 경우의 수'
  if (/행렬/.test(key)) return '행렬의 성질과 연산'
  if (/연립방정식/.test(key)) return '연립방정식의 해'
  if (/이차방정식/.test(key)) return '이차방정식의 근'
  if (/일차방정식/.test(key)) return '일차방정식의 해와 활용'
  if (/일차부등식/.test(key)) return /자연수/.test(key) ? '일차부등식과 자연수 조건' : '일차부등식의 해'
  if (/이차부등식/.test(key)) return '이차부등식의 해'
  if (/부등식/.test(key)) return '부등식의 해와 조건'
  if (/인수분해|공통인인수|공통인수/.test(key)) return /자연수/.test(key) ? '다항식의 인수와 자연수 조건' : '다항식의 인수분해'
  if (/이차함수/.test(key)) return /넓이/.test(key) ? '이차함수의 그래프와 도형의 넓이' : '이차함수의 그래프와 꼭짓점'
  if (/일차함수/.test(key)) {
    if (/기울기/.test(key) && /절편/.test(key)) return '일차함수의 기울기와 절편'
    if (/사다리꼴/.test(key)) return '일차함수의 그래프와 사다리꼴의 조건'
    return '일차함수의 그래프와 좌표'
  }
  if (/반비례/.test(key)) return '반비례 그래프와 좌표의 관계'
  if (/원기둥/.test(key) && /구모양|구의부피/.test(key)) return '원기둥과 구의 부피'
  if (/직육면체/.test(key) && /겉넓이/.test(key)) return /자연수/.test(key) ? '직육면체의 겉넓이와 자연수 조건' : '직육면체의 겉넓이와 식의 계산'
  if (/정육면체/.test(key)) return /겉넓이/.test(key) ? '정육면체의 겉넓이' : '정육면체의 부피와 개수'
  if (/무게중심/.test(key)) return '삼각형의 무게중심과 선분의 길이'
  if (/외심/.test(key) && /내심/.test(key)) return '삼각형의 외심과 내심'
  if (/내심/.test(key)) return /넓이/.test(key) ? '삼각형의 내심과 넓이' : '삼각형의 내심과 각의 관계'
  if (/외심|외접원/.test(key)) return /이등분선/.test(key) ? '삼각형의 외접원과 각의 이등분선' : '삼각형의 외심과 외접원'
  if (/원주각|중심각/.test(key)) return '원의 원주각과 중심각의 관계'
  if (/삼각비|\b(?:sin|cos|tan)\b/i.test(text)) return '직각삼각형의 삼각비'
  if (/피타고라스/.test(key)) return '피타고라스 정리와 선분의 길이'
  if (/평행사변형/.test(key)) {
    if (/이등분선/.test(key)) return '평행사변형과 각의 이등분선'
    if (/대각선/.test(key)) return '평행사변형의 대각선과 선분의 길이'
    return '평행사변형의 성질과 넓이'
  }
  if (/직각삼각형/.test(key)) return '직각삼각형의 각과 선분의 길이'
  if (/삼각형/.test(key) && /(?:^|같이|와|과|는|이)원[A-Z가-힣]/.test(key)) return /넓이/.test(key) ? '원과 삼각형의 넓이 관계' : '원과 삼각형의 선분 관계'
  if (/삼각형/.test(key)) return /넓이/.test(key) ? '삼각형의 넓이와 선분의 관계' : '삼각형의 각과 선분의 관계'
  if (/닮음|닮은/.test(key)) return '도형의 닮음과 길이의 비'
  if (/순환소수/.test(key) || /분수/.test(key) && /소수점|소수로나타/.test(key)) return '분수의 소수 표현과 자릿수'
  if (/카드/.test(key) && /가장큰|최댓값/.test(key)) return '수 카드의 연산과 최댓값'
  if (/달리기|이동거리|속력/.test(key)) return '이동 거리 조건을 활용한 식 세우기'
  if (/로그|지수함수/.test(key)) return '지수와 로그의 성질'
  if (/수열/.test(key)) return '수열의 규칙과 항의 관계'
  if (/미분|도함수/.test(key)) return '도함수와 함수의 변화'
  if (/적분/.test(key)) return '적분과 넓이의 관계'
  return tagged(input, '수학 개념과 조건의 이해')
}

function koreanSkill(question: string) {
  const text = compact(question)
  const rules: Array<[RegExp, string]> = [
    [/서사전개|서사.*과정/, '서사 전개'], [/서술|서술자/, '서술 방식'],
    [/시상의흐름|시상.*전개/, '시상 전개'], [/표현상공통|표현.*공통/, '표현 방식 비교'],
    [/설명방식/, '설명 방식'], [/사전적의미|문맥상|바꿔쓰기|낱말.*의미/, '어휘의 의미'],
    [/원인.*추론|이유.*추론/, '원인 추론'], [/의미.*추론/, '의미 추론'],
    [/자료.*활용|활용방안/, '자료 활용'], [/고쳐쓰기|추가할내용|보완/, '내용 보완'],
    [/글쓰기계획/, '글쓰기 계획'], [/글쓰기방식/, '글쓰기 방식'], [/구상.*반영|초고.*반영/, '내용 구성'],
    [/말하기|발표.*설명/, '말하기 전략'], [/공통점/, '공통점 비교'], [/차이점/, '차이점 비교'],
    [/감상/, '작품 감상'], [/화자.*정서|화자.*태도/, '화자의 정서와 태도'],
    [/인물.*심리|인물.*생각|생각.*이해/, '인물의 생각과 태도'],
    [/보기.*이해|바탕.*이해/, '사례 적용'], [/이해|내용|알수있는|답할수있는/, '내용 이해'],
  ]
  return rules.find(([pattern]) => pattern.test(text))?.[1] ?? '핵심 내용 이해'
}

function literaryWorks(context: string) {
  const works: string[] = []
  // Match bibliographic labels, rather than guessing a work from an author's
  // name or a quotation inside an answer choice.
  const pattern = /(?:^|[-—–])\s*([가-힣]{2,8}(?:\s*미상)?)\s*[,，]\s*[｢「『]([^｣」』]{1,60})[｣」』]/gu
  for (const match of context.matchAll(pattern)) {
    const author = readable(match[1]), work = readable(match[2]).replace(/\s*\([^)]*\)\s*/g, '').trim()
    if (author && work) works.push(`${author} 「${work}」`)
  }
  return [...new Set(works)].slice(0, 2)
}

function withSkill(topic: string, skill: string) {
  // A separator keeps titles readable when a topic or skill already contains
  // a possessive phrase ("식물의 광합성", "인물의 생각과 태도").
  return topic.includes('의 ') || skill.includes('의 ') ? `${topic} · ${skill}` : `${topic}의 ${skill}`
}

function koreanTitle(input: QuestionTitleInput) {
  const question = stem(input.text), context = readable(input.passageText) || question
  const key = compact(context), instruction = stem(input.instruction ?? '')
  const narrativeDescription = (input.tags ?? []).some(tag => tag === '현대소설' || tag === '고전소설')
    && /윗글에대한설명/.test(compact(question))
  const skill = narrativeDescription ? '서술 방식' : koreanSkill(`${instruction} ${question}`)
  const works = literaryWorks(context)
  if (works.length) return withSkill(works.join('·'), skill)
  const topics: Array<[RegExp, string]> = [
    [/본용언.*보조용언|보조용언.*본용언/, '본용언과 보조 용언'],
    [/의미자질/, '단어의 의미 자질과 의미 관계'], [/재귀대명사/, '재귀 대명사의 쓰임'],
    [/사이시옷/, '사이시옷의 표기 조건'], [/음운.*변동|음운변동/, '음운 변동의 원리'],
    [/높임/, '높임 표현'], [/문장성분/, '문장 성분과 문장 구조'], [/품사/, '품사의 분류와 쓰임'],
    [/공리주의.*효용|효용.*공리주의/, '공리주의와 효용 이론'], [/공리주의/, '공리주의의 행복 원리'],
    [/효용이론|한계효용/, '효용 이론과 합리적 선택'],
    [/광합성/, /C3/.test(key) && /C4/.test(key) ? 'C3·C4 식물의 광합성' : '식물의 광합성 과정'],
    [/형사.*민사|민사.*형사/, '형사·민사 소송과 입증'],
    [/종이비행기/, '종이비행기 발표'], [/또래상담|상담부/, '또래 상담과 글쓰기'],
    [/메모/, '메모를 통한 경험과 정서의 표현'],
    [/기후변화/, '기후 변화의 원인과 영향'], [/인공지능/, '인공지능의 원리와 활용'],
    [/민주주의/, '민주주의와 시민의 역할'], [/시장경제/, '시장 경제의 원리'],
    [/세포/, '세포의 구조와 기능'], [/정보.*매체|매체.*정보/, '매체의 정보 전달'],
  ]
  const topic = topics.find(([pattern]) => pattern.test(key))?.[1]
  if (topic) {
    // Grammar titles already express the concept being tested; attach a skill
    // only when the task explicitly calls for application or comparison.
    if (['본용언과 보조 용언', '단어의 의미 자질과 의미 관계', '재귀 대명사의 쓰임', '사이시옷의 표기 조건', '음운 변동의 원리', '높임 표현', '문장 성분과 문장 구조', '품사의 분류와 쓰임'].includes(topic)) return topic
    return withSkill(topic, skill)
  }
  const tags = input.tags ?? []
  if (tags.some(tag => ['현대시', '고전시가'].includes(tag))) return `시의 ${skill}`
  if (tags.some(tag => ['현대소설', '고전소설', '고전산문'].includes(tag))) return `문학 작품의 ${skill}`
  if (tags.includes('화법')) return `의사소통과 ${skill}`
  if (tags.includes('작문')) return `글쓰기의 ${skill}`
  if (tags.includes('문법')) return '국어 문법의 개념과 쓰임'
  return tagged(input, '국어 지문의 핵심 내용과 표현')
}

function englishTitle(input: QuestionTitleInput) {
  const key = compact(`${input.instruction ?? ''} ${stem(input.text)}`)
  const rules: Array<[RegExp, string]> = [
    [/가리키는대상|지칭/, '문맥 속 지칭 대상 추론'], [/어법상/, '문맥에 맞는 어법 판단'],
    [/의미하는|의미하는바/, '함축 표현의 의미 추론'], [/낱말의쓰임|문맥상/, '문맥에 맞는 어휘 판단'],
    [/주어진문장|들어가기에/, '글의 흐름과 문장 삽입'], [/전체흐름과관계|무관한문장/, '글의 흐름과 무관한 문장'],
    [/순서|배열/, '문단의 연결과 글의 순서'], [/요약/, '글의 핵심 내용 요약'],
    [/빈칸/, '문맥을 활용한 빈칸 추론'], [/심경|분위기/, '인물의 심경과 분위기'],
    [/목적/, '글의 목적 파악'], [/주장/, '필자의 주장 파악'], [/요지/, '글의 요지 파악'],
    [/주제|제목/, '글의 주제와 제목'], [/일치|내용으로적절하지/, '세부 내용의 일치 여부'],
  ]
  return rules.find(([pattern]) => pattern.test(key))?.[1] ?? tagged(input, '영어 지문의 내용과 문맥 이해')
}

function otherTitle(input: QuestionTitleInput) {
  const key = compact(`${input.passageText ?? ''} ${stem(input.text)}`)
  const rules: Array<[RegExp, string]> = input.subject === '통합과학' ? [
    [/해륙풍|해풍|육풍/, '해륙풍과 공기의 이동'], [/월식/, '태양·지구·달의 위치와 월식'],
    [/광합성/, '광합성과 물질의 출입'], [/원자|이온/, '원자와 이온의 구조'],
    [/전기회로|전류|전압|저항/, '전기 회로와 전압·전류의 관계'],
    [/비열|열평형/, '비열과 열평형'], [/감수분열/, '감수 분열과 염색체'],
    [/혈액순환/, '혈액 순환과 기관의 역할'], [/기체.*압력|압력.*기체/, '기체의 압력과 부피'],
    [/화학반응|질량보존/, '화학 반응과 질량 관계'], [/은하/, '우리은하와 태양계'],
    [/에너지/, '에너지의 전환과 보존'],
  ] : input.subject === '통합사회' ? [
    [/레오폴드|대지윤리/, '대지 윤리와 생태 공동체'], [/칸트/, '칸트의 도덕과 자율'],
    [/롤스/, '롤스의 정의 원칙'], [/통일/, '통일과 평화의 과제'],
    [/독도/, '독도와 영토의 이해'], [/지리정보|GIS/i, '지리 정보를 활용한 입지 선정'],
    [/인구/, '인구 구조와 인구 문제'], [/환율/, '환율 변동과 경제생활'],
    [/재판|소송/, '민사·형사 재판의 이해'], [/공급/, '시장 공급의 변화'],
    [/물가|실업|재정정책|통화정책/, '경기·물가 안정과 경제 정책'],
    [/민주/, '민주정치와 시민 참여'],
  ] : input.subject === '한국사' ? [
    [/훈민정음/, '세종의 훈민정음 창제와 문화'], [/서원/, '서원의 교육 기능과 사림의 활동'],
    [/대동법/, '대동법과 조세 제도의 변화'], [/고조선/, '고조선의 성립과 사회'],
    [/삼국|고구려|백제|신라/, '삼국의 정치와 문화'], [/고려/, '고려의 정치와 사회'],
    [/민주화|민주항쟁/, '민주화 운동과 정치의 변화'], [/대한제국/, '대한 제국의 개혁과 근대화'],
  ] : []
  return rules.find(([pattern]) => pattern.test(key))?.[1] ?? tagged(input, `${input.subject ?? '문항'}의 핵심 개념과 조건`)
}

export function suggestQuestionTitle(input: QuestionTitleInput): string {
  const title = input.subject === '수학' ? mathTitle(input)
    : input.subject === '국어' ? koreanTitle(input)
      : input.subject === '영어' ? englishTitle(input) : otherTitle(input)
  return finish(title) || '문항의 핵심 개념과 조건'
}
