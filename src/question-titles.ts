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
    .replace(/[━─═]{3,}/g, ' ').replace(/^\s*\d+\s*[.)]\s*/, '')
    .replace(/\[\s*\d+(?:\.\d+)?\s*점\s*\]/g, '').trim()
}
function finish(value: string) { return readable(value).slice(0, 100).trim() }

function topicContext(input: QuestionTitleInput) {
  // Statements in <보기> can also be distractors. Use the source material,
  // rather than treating a statement to be judged as an established fact.
  const source = (value: string) => stem(value).split(/[<〈＜]\s*보\s*기\s*[>〉＞]\s*(?=[ㄱ-ㅎ][.．)])/u, 1)[0]!
  return `${source(input.passageText ?? '')} ${source(input.text)}`.trim()
}

function extractedKeywords(text: string) {
  // An extractive fallback keeps unfamiliar compound terms from the PDF.
  // It neither invents a topic nor substitutes a hidden person/institution.
  const generic = new Set(['다음', '자료', '그림', '보기', '설명', '내용', '문항', '조건', '개념', '핵심개념',
    '정치', '경제', '사회', '문화', '역사', '한국사', '통합사회', '통합과학', '과학', '물리', '화학', '생명과학', '지구과학',
    '제도', '정책', '특징', '과정', '활동', '모습', '변화', '관계', '기능', '역할', '원리', '법칙', '구조', '환경', '기후',
    '국가', '지역', '인간', '사람', '학생', '선생님', '시대', '시기', '이해', '비교', '선택', '주장', '판단'])
  const nounEnding = /(?:주의|발자국|배출권|거래제|조합|경제|재생|실험|기후|재해|제도|정책|조약|협약|운동|혁명|문화|문명|권리|차별|불평등|분포|인구|산업|농업|무역|환율|물가|금융|비용|세금|토기|유물|유적|석기|봉기|전쟁|개혁|신분|유산|에너지|분열|염색체|반응|회로|전류|전압|저항|압력|부피|밀도|염분|암석|지층|세포|생태계|효소|호흡|반사|굴절|망원경|위성|온도|속도|가속도|운동량|충격량|분자|원자|이온|산화|환원|용액|전기|자기장)$/u
  const words = readable(text).match(/[가-힣]{2,24}/gu) ?? []
  const counts = new Map<string, number>()
  for (const token of words) {
    const word = nounEnding.test(token) ? token : token.replace(/(?:으로부터|에서는|으로는|에서|으로|에게|에는|의|은|는|을|를|이|가|와|과)$/u, '')
    if (word.length < 2 || generic.has(word) || !nounEnding.test(word)) continue
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([word]) => word).slice(0, 3).join('·')
}

function tagged(input: QuestionTitleInput, fallback: string) {
  const keywords = extractedKeywords(topicContext(input))
  if (keywords) return keywords
  const tags = [...new Set((input.tags ?? []).map(readable).filter(tag => tag && !/[?？]/.test(tag)))]
  return tags.length ? tags.slice(0, 2).join('·') : fallback
}

export function isGenericQuestionTitle(title: string) {
  return /의\s*핵심\s*개념(?:과\s*조건)?$/u.test(title.trim())
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
  const key = compact(topicContext(input))
  const rules: Array<[RegExp, string]> = input.subject === '통합과학' ? [
    [/천체망원경/, '천체 망원경과 천체 관측'],
    [/빛.*(?:빨간색.*초록색.*파란색|삼원색)|빨간색.*초록색.*파란색.*빛/, /보름달/.test(key) ? '빛의 색과 보름달 관측' : '빛의 색과 합성'],
    [/동물계|식물계|원핵생물계|생물분류/, '생물의 분류와 세포의 특징'],
    [/부력/, /기화/.test(key) ? '기화에 따른 부피 변화와 부력' : '물체의 부피와 부력'],
    [/잎.*표피|기공|공변세포/, '잎의 표피와 기체의 출입'],
    [/화성암.*퇴적암|퇴적암.*화성암/, '화성암과 퇴적암의 특징'],
    [/화성암|퇴적암|변성암/, '암석의 생성 과정과 특징'],
    [/홍채|수정체|시각신경/, '눈의 구조와 시각 정보의 전달'],
    [/해수|염분/, '해수의 염분과 밀도'],
    [/정자.*수정란|수정란.*정자/, '정자 형성과 수정란의 세포 분열'],
    [/열.*이동|이동.*열/, '열의 이동과 온도 변화'],
    [/해륙풍|해풍|육풍/, '해륙풍과 공기의 이동'], [/월식/, '태양·지구·달의 위치와 월식'],
    [/광합성/, '광합성과 물질의 출입'], [/원자|이온/, '원자와 이온의 구조'],
    [/전기회로|전류|전압|저항/, '전기 회로와 전압·전류의 관계'],
    [/비열|열평형/, '비열과 열평형'], [/감수분열/, '감수 분열과 염색체'],
    [/혈액순환/, '혈액 순환과 기관의 역할'], [/기체.*압력|압력.*기체/, '기체의 압력과 부피'],
    [/화학반응|질량보존/, '화학 반응과 질량 관계'], [/은하/, '우리은하와 태양계'],
    [/산화|환원/, '산화·환원과 물질의 변화'], [/산성|염기성|중화반응/, '산·염기와 중화 반응'],
    [/전반사|굴절|볼록렌즈/, '빛의 굴절과 렌즈'], [/기압|대기압/, '기압과 공기의 운동'],
    [/중력|자유낙하/, '중력과 낙하 운동'], [/운동량|충격량/, '운동량과 충격량'],
    [/속도|가속도/, '속도와 가속도의 변화'], [/생태계|먹이사슬/, '생태계의 구성과 상호 작용'],
    [/유전|염색체/, '유전 정보와 염색체'], [/지층|화석/, '지층과 지질 시대'],
    [/지구온난화|온실기체|온실가스/, '온실 효과와 지구 온난화'],
    [/에너지/, '에너지의 전환과 보존'],
  ] : input.subject === '통합사회' ? [
    [/플랜테이션/, /공간적관점/.test(key) ? '공간적 관점에서 본 플랜테이션 농업' : '플랜테이션 농업과 지역의 특징'],
    [/(?:기온|기후).*(?:생활모습|주민생활)|(?:생활모습|주민생활).*(?:기온|기후)/, '기후와 지역별 생활 모습 비교'],
    [/카르스트|할롱베이/, /쓰레기|보존|오염/.test(key) ? '카르스트 지형과 자연환경 보존' : '카르스트 지형의 특징'],
    [/화산지형|주상절리|용암동굴/, '화산 지형과 주민 생활'],
    [/디지털탄소발자국/, '디지털 탄소 발자국과 생태 시민'],
    [/미세플라스틱/, '미세플라스틱 오염과 사회적 대응'],
    [/온실가스|지구온난화|기후난민/, /기후난민/.test(key) ? '지구 온난화와 기후 난민의 인권' : '온실가스 배출과 지구 온난화'],
    [/사막화.*오존층|오존층.*사막화/, '사막화·오존층 파괴와 국제 협력'],
    [/태풍|홍수|자연재해/, '태풍·홍수와 자연재해 대책'],
    [/전통가옥|흙벽돌집|기후.*(?:의복|가옥)/, '기후에 적응한 전통 가옥과 의복'],
    [/마추픽추|고산기후/, '고산 지역의 기후와 관광'],
    [/문화변동/, '문화 변동의 양상과 사례'],
    [/문화상대주의|보편윤리/, '문화 상대주의와 보편 윤리'],
    [/네네츠족|북극문화권/, '북극 문화권의 생활과 문화 이해'],
    [/문화권/, /타코|토르티야/.test(key) ? '음식·언어·종교로 살펴보는 문화권' : '문화권의 분포와 특징'],
    [/부다가야|마하보디/, '종교 성지와 문화 경관'],
    [/쯔놈|분짜/, '문자·음식·의복에 나타난 지역 문화'],
    [/갯벌|해안절벽/, '갯벌과 해안 지형의 특징'],
    [/하천복원|생물종다양성/, '하천 복원과 생태계 보전'],
    [/택리지|주거환경/, '주거 환경과 행복 실현의 조건'],
    [/동물실험/, '동물 실험의 윤리적 쟁점'],
    [/너자신을알라|반성하지않는삶/, '자기 성찰과 행복한 삶'],
    [/행복한왕자/, '「행복한 왕자」와 나눔의 의미'],
    [/행복.*(?:덕|이성|쾌락)|(?:덕|이성|쾌락).*행복/, /인\(仁\)|품성/.test(key) ? '덕과 인의 실천을 통한 행복' : '덕·이성·쾌락과 행복의 의미'],
    [/도덕법칙|의무의식/, '도덕 법칙과 의무 의식'],
    [/정의의원칙|공정한기회|사회적약자/, '정의의 원칙과 기회의 공정성'],
    [/생명공동체|생태공동체/, '인간과 자연의 관계 및 생태 공동체'],
    [/레오폴드|대지윤리/, '대지 윤리와 생태 공동체'], [/칸트/, '칸트의 도덕과 자율'],
    [/롤스/, '롤스의 정의 원칙'], [/통일/, '통일과 평화의 과제'],
    [/독도/, '독도와 영토의 이해'], [/지리정보|GIS/i, '지리 정보를 활용한 입지 선정'],
    [/인구/, '인구 구조와 인구 문제'], [/환율/, '환율 변동과 경제생활'],
    [/재판|소송/, '민사·형사 재판의 이해'], [/공급/, '시장 공급의 변화'],
    [/물가|실업|재정정책|통화정책/, '경기·물가 안정과 경제 정책'],
    [/민주/, '민주정치와 시민 참여'], [/문화/, '문화의 특징과 이해'],
  ] : input.subject === '한국사' ? [
    [/빗살무늬토기/, /정착|움집/.test(key) ? '빗살무늬 토기와 정착 생활' : '빗살무늬 토기와 생활 모습'],
    [/뗀석기|주먹도끼/, '뗀석기와 선사 시대의 생활'],
    [/전지.*시지|수조권/, '전지·시지 지급과 토지 제도'],
    [/무신.*(?:농민|천민)|(?:농민|천민).*무신/, '무신 집권과 농민·천민의 봉기'],
    [/왕건/, '왕건의 건국과 통치 제도'],
    [/집현전|의정부서사제/, '집현전과 유교 정치의 운영'],
    [/왜군|의병/, '왜군의 침입과 의병 활동'],
    [/서원철폐|호포제/, '서원 철폐와 통치 체제 정비'],
    [/친원세력|원의간섭/, '친원 세력 숙청과 왕권 회복'],
    [/풍속화|판소리|탈춤|서민문화/, '풍속화·판소리와 서민 문화'],
    [/서리|향리|서얼|신분/, '신분 질서와 사회 계층'],
    [/국청사|교종.*선종/, '교종·선종 통합과 불교의 변화'],
    [/삼정의문란|환곡.*폐단/, '삼정의 문란과 농민 봉기'],
    [/방납|공물.*(?:쌀|동전)/, '방납의 폐단과 공물 징수 방식'],
    [/사대교린|조공무역/, '사대교린과 대외 교류'],
    [/일연/, '일연의 역사서 편찬과 불교 문화'],
    [/강감찬|귀주.*거란/, '강감찬의 활약과 거란과의 관계'],
    [/수원화성|화성성역의궤/, '수원 화성의 건설과 도시 기능'],
    [/광개토왕|관산성/, '삼국의 대외 관계와 전쟁'],
    [/훈민정음/, '세종의 훈민정음 창제와 문화'], [/서원/, '서원의 교육 기능과 사림의 활동'],
    [/대동법/, '대동법과 조세 제도의 변화'], [/고조선/, '고조선의 성립과 사회'],
    [/고구려계승/, '고구려 계승 의식과 국가의 정체성'],
    [/갑신정변/, '갑신정변과 개화 정책'], [/동학|농민운동/, '동학 농민 운동과 사회 개혁'],
    [/개항|강화도조약/, '개항과 근대 사회의 변화'], [/독립협회/, '독립 협회와 자주권 수호'],
    [/임시정부|3[·.]?1운동/, '독립운동과 대한민국 임시 정부'],
    [/일제|식민통치/, '일제의 식민 통치와 사회 변화'],
    [/냉전|6[·.]?25|한국전쟁/, '한국 전쟁과 냉전 체제'], [/제헌국회/, '제헌 국회와 정부 수립'],
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
