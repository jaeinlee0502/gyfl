import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { subjects, type Subject } from './data'
import { suggestQuestionTitle } from './question-titles'
import { hasPrivateUseCharacters, normalizeKnownEquationText } from './pdf-text'
import {
  MAX_PDF_BYTES, MAX_PDF_PAGES, ebsExamListUrl,
  type ExamImportMetadata, type ExamPdfAnalysis, type ImportQuestionDraft, type ImportPassageDraft,
  type PdfRegion, type RenderedPdfImage,
} from './import-types'

export interface PdfTextRun {
  text: string
  left: number
  top: number
  right: number
  bottom: number
}
export interface PdfTextPage { page: number; runs: PdfTextRun[] }

export interface ExamPdfDocument {
  pageCount: number
  analyze(): Promise<ExamPdfAnalysis>
  renderQuestion(regions: PdfRegion[]): Promise<RenderedPdfImage>
  renderPage(page: number): Promise<RenderedPdfImage>
  regionText(regions: PdfRegion[]): Promise<string>
  destroy(): Promise<void>
}

const clamp = (n: number, low = 0, high = 1) => Math.min(high, Math.max(low, n))
const compact = (value: string) => value.normalize('NFKC').replace(/\s+/g, '')

export function inferExamMetadata(header: string): Partial<ExamImportMetadata> {
  const text = compact(header)
  const metadata: Partial<ExamImportMetadata> = {}
  const year = /\b(20\d{2})(?:학년도|년)/.exec(text)?.[1]
  const month = /(?:^|[^\d])(3|6|9|10)월/.exec(text)?.[1]
  const grade = /고(?:등학교)?([12])(?:학년)?/.exec(text)?.[1] ?? /(?:^|[^\d])([12])학년/.exec(text)?.[1]
  if (year && Number(year) >= 2025) metadata.year = Number(year)
  if (month) metadata.month = Number(month) as ExamImportMetadata['month']
  if (grade) {
    metadata.grade = Number(grade) as 1 | 2
    metadata.sourceUrl = ebsExamListUrl(metadata.grade)
    metadata.explanationUrl = metadata.sourceUrl
  }
  const names: [Subject, RegExp][] = [
    ['한국사', /한국사(?:영역)?/], ['국어', /국어(?:영역)?/],
    ['수학', /수학(?:영역)?/], ['영어', /영어(?:영역)?/],
    ['통합사회', /통합사회|사회탐구|사회영역|탐구영역\(?사회\)?/],
    ['통합과학', /통합과학|과학탐구|과학영역|탐구영역\(?과학\)?/],
  ]
  const detected = names.filter(([, pattern]) => pattern.test(text))
  if (detected.length === 1) metadata.subject = detected[0]![0]
  return metadata
}

const concepts: Partial<Record<Subject, Record<string, RegExp>>> = {
  한국사: {
    '선사·고대': /구석기|신석기|청동기|고조선|고구려|백제|신라|발해|삼국/, '중세': /고려|왕건|광종|무신\s*정변|공민왕/,
    '근세': /조선|세종|훈민정음|서원|사림|임진왜란|영조|정조|대동법|실학/, '근대': /개항|강화도\s*조약|갑신정변|갑오개혁|대한\s*제국|독립\s*협회/,
    '일제강점기': /일제|식민\s*통치|3[·.]?\s*1\s*운동|임시\s*정부|의열단|민족\s*말살|광복군/,
    '현대사': /6[·.]?\s*25|남침|유엔군|제헌\s*국회|민주화|민주\s*항쟁|유신\s*헌법|대통령\s*직선/,
    '정치사': /국왕|왕권|정부|정치|국회|전쟁|개혁|정변|항쟁|법률|헌법/,
    '경제사': /경제|상업|공인|화폐|세금|조세|대동법|공물|토지|농업/,
    '사회사': /신분|노비|양반|농민|백성|사회|민중|여성/,
    '문화사': /문화|교육|불교|유교|훈민정음|서원|학교|학문|과학\s*기술|미술|도자기/,
  },
  국어: { '현대시': /화자|시적|시어|백석|나희덕|현대시/, '고전시가': /시조|가사|향가|고려\s*가요|윤선도|제\s*\d\s*수|하노라/, '현대소설': /서술자|인물의\s*심리|소설|이문구/, '고전소설': /고전\s*소설|작자\s*미상|(?:^|\s)(?:천자|태자|소자)(?=[\s은는이가을를의께와과도에]|$)/, '고전산문': /고전\s*산문|홍석주|전간대/, '독서': /독서|윗글의\s*내용|공리주의|효용\s*이론|광합성|형사법|민사법|법규|경제학/, '인문·예술': /공리주의|철학|예술|도덕/, '사회·문화': /경제학|사회|법규|형사|민사|효용/, '과학·기술': /광합성|세포|과학|이산화\s*탄소/, '문법': /음운|형태소|품사|문장\s*성분|높임|용언|대명사|의미\s*자질|사이시옷/, '화법': /(?:^|\s)(?:발표|토론|토의|회의|대화)(?=[\s은는이가을를의에할하]|$)/, '작문': /초고|고쳐\s*쓰기|작문|글쓰기/, '매체': /매체|인터넷|누리\s*소통망/ },
  수학: { '다항식': /다항식|나머지정리|인수분해/, '방정식과 부등식': /방정식|부등식|두\s*근/, '경우의 수': /경우의\s*수|순열|조합/, '행렬': /행렬/, '도형의 방정식': /원의\s*방정식|직선의\s*방정식|좌표평면/, '집합과 명제': /집합|명제/, '함수': /함수/, '지수와 로그': /지수|로그/, '삼각함수': /삼각함수/, '삼각비': /삼각비|\b(?:sin|cos|tan)\b/i, '제곱근': /제곱근|무리수|근호|√/, '일차함수': /일차\s*함수/, '닮음': /닮음|닮은/, '원주각': /원주각/, '순환소수': /순환\s*소수/, '분산': /분산|편차|표준\s*편차/, '피타고라스 정리': /피타고라스/, '수열': /수열|등차|등비/, '미분': /미분|도함수|미분계수/, '적분': /적분/, '확률과 통계': /확률|통계|분산|표준편차|도수분포/ },
  영어: { '주제·제목': /주제로|제목으로/, '요지·주장': /요지로|주장하는/, '목적·심경': /목적으로|심경|분위기/, '빈칸 추론': /빈칸/, '글의 순서': /순서로|순서에\s*맞게|배열한/, '문장 삽입': /들어가기에|주어진\s*문장/, '어법': /어법상/, '어휘': /낱말의\s*쓰임|문맥상|의미\s*하는/, '내용 일치': /내용과\s*일치|내용으로\s*적절하지/, '요약': /요약/, '무관한 문장': /전체\s*흐름과\s*관계|흐름과\s*관계|무관한\s*문장/, '지칭 추론': /가리키는\s*대상|지칭/, '듣기': /대화를\s*듣고|말을\s*듣고/ },
  통합사회: { '인권': /인권|기본권/, '헌법': /헌법|입헌/, '사회정의': /정의|분배|불평등/, '시장경제': /시장|수요|공급|경제/, '금융': /금융|예금|주식|채권|환율/, '지리': /지도|지형|지역|인구|독도|태양광|아이슬란드|페루|지리\s*정보/, '기후와 환경': /기후|환경|강수|온난화|자연재해/, '문화': /문화/, '사회문화': /사회화|사회\s*집단/, '세계사': /세계사|문명/, '세계화': /세계화|국제\s*교역/, '평화': /평화|분쟁|통일/, '지속가능발전': /지속\s*가능/, '윤리': /윤리|도덕|사상가|행복|쾌락|칸트|롤스|아리스토텔레스|에피쿠로스|레오폴드|유교|불교|도가/, '정치': /민주|정부\s*형태|정치|의회|대통령/, '법': /재판|형사|민사|법원|소송/, '경제': /경제|환율|수요|공급|물가|통화|재정/ },
  통합과학: { '물리': /힘|속도|가속도|운동량|전류|자기장|부력|저항|전압|비열|열평형|자유\s*낙하|열[이가은는을]?\s*이동/, '화학': /원소|화학|분자|원자|이온|기체|흡열|발열|상태\s*변화/, '생명과학': /생명|세포|유전|효소|광합성|기공|신경|염색체|혈액|감수\s*분열/, '지구과학': /지구|지층|대기|천체|판의\s*운동|해륙풍|월식|은하|태양계|해수|암석|지질|달의\s*위상/, '물질의 규칙성': /주기율|주기적/, '역학 시스템': /역학|중력|운동/, '지구 시스템': /수권|기권|지권/, '생명 시스템': /생명|세포/, '화학 변화': /산화|환원|산과\s*염기/, '생태계': /생태계|먹이\s*사슬/, '에너지': /에너지|발전|전력|비열|열평형|열[이가은는을]?\s*이동/, '과학과 미래 사회': /인공지능|빅데이터|미래\s*사회/ },
}

export function suggestQuestionTags(subject: Subject | undefined, text: string): string[] {
  if (!subject) return []
  const allowed = new Set(subjects.find(s => s.name === subject)?.tags ?? [])
  let tags = Object.entries(concepts[subject] ?? {}).filter(([tag, pattern]) => allowed.has(tag) && pattern.test(text)).map(([tag]) => tag)
  // A classical speaker is not evidence that a poem is modern. These remain
  // editable suggestions; never infer curriculum certification from keywords.
  if (subject === '국어') {
    if (tags.includes('고전소설')) tags = tags.filter(tag => tag !== '현대소설')
    if (tags.includes('고전시가') || tags.includes('고전산문')) tags = tags.filter(tag => tag !== '현대시')
    if (tags.some(tag => ['현대시', '고전시가', '현대소설', '고전소설', '고전산문'].includes(tag))) {
      tags = tags.filter(tag => !['독서', '인문·예술', '사회·문화', '과학·기술', '화법', '작문', '매체'].includes(tag))
    }
  }
  return tags.slice(0, 20)
}

function textInside(page: PdfTextPage, region: PdfRegion) {
  return page.runs.filter(run => run.left < region.right && run.right > region.left
    && run.top < region.bottom && run.bottom > region.top)
    .sort((a, b) => Math.abs(a.top - b.top) < .003 ? a.left - b.left : a.top - b.top)
    .map(run => run.text).join(' ').replace(/\s+/g, ' ').trim()
}

export function validatePdfRegions(regions: PdfRegion[], pageCount: number) {
  if (!Array.isArray(regions) || !regions.length || regions.length > 12) throw new Error('문항 영역은 1개 이상 12개 이하로 선택해 주세요.')
  for (const r of regions) {
    if (!Number.isInteger(r.page) || r.page < 1 || r.page > pageCount
      || ![r.left, r.top, r.right, r.bottom].every(Number.isFinite)
      || r.left < 0 || r.top < 0 || r.right > 1 || r.bottom > 1
      || r.right - r.left < .01 || r.bottom - r.top < .01) throw new Error('문항 영역이 페이지 범위를 벗어났어요. 선택 영역을 다시 확인해 주세요.')
  }
}

interface Anchor { page: number; number: number; x: number; y: number; column: 0 | 1 }
interface Position { page: number; column: 0 | 1; y: number }
interface TextLine extends Position { text: string; left: number; bottom: number }
interface RangeMarker extends Position { first: number; last: number; kind: 'passage' | 'instruction'; text: string }

function readingOrder(position: Position) { return (position.page - 1) * 2 + position.column + position.y }

function columnLines(page: PdfTextPage, column: 0 | 1): TextLine[] {
  const runs = page.runs.filter(run => (run.left < .5 ? 0 : 1) === column)
    .sort((a, b) => a.top - b.top || a.left - b.left)
  const lines: Array<TextLine & { runs: PdfTextRun[] }> = []
  for (const run of runs) {
    const previous = lines[lines.length - 1]
    if (previous && Math.abs(previous.y - run.top) < .004) {
      previous.runs.push(run)
      previous.bottom = Math.max(previous.bottom, run.bottom)
      previous.left = Math.min(previous.left, run.left)
    } else lines.push({ page: page.page, column, y: run.top, left: run.left, bottom: run.bottom, text: '', runs: [run] })
  }
  return lines.map(line => ({ ...line, text: line.runs.sort((a, b) => a.left - b.left).map(run => run.text).join(' ') }))
}

function pageContentTop(page: PdfTextPage) {
  const headers = page.runs.filter(run => run.top < .14 && /(?:국어|수학|영어|탐구)\s*영역/.test(run.text))
  return headers.length ? Math.min(.16, Math.max(...headers.map(run => run.bottom)) + .015) : .065
}

/** Infer a listening exclusion only from an explicit instruction in this PDF. */
function listeningNumbers(pages: PdfTextPage[], subject: Subject | undefined, warnings: string[]) {
  if (subject !== '영어') return []
  const opening = compact(pages.slice(0, 2).flatMap(page => page.runs.map(run => run.text)).join(' '))
  const stated = /(\d{1,2})번부터(\d{1,2})번까지는?듣고답(?:하는|할)/.exec(opening)
  if (stated) {
    const first = Number(stated[1]), last = Number(stated[2])
    if (first >= 1 && last >= first && last <= 100) return Array.from({ length: last - first + 1 }, (_, index) => first + index)
  }
  // The end-of-listening notice is also an explicit boundary. Do not assume
  // every English file contains exactly seventeen listening questions.
  const ended = /이제듣기문제가끝났습니다[.。]?(\d{1,2})번부터/.exec(opening)
  if (ended && Number(ended[1]) > 1 && Number(ended[1]) <= 100) return Array.from({ length: Number(ended[1]) - 1 }, (_, index) => index + 1)
  if (/대화를듣고|말을듣고/.test(opening)) warnings.push('듣기 문항이 보이지만 제외할 번호 범위를 확정하지 못했어요. 듣기 문항을 직접 제외해 주세요.')
  return []
}

export function analyzePdfText(pages: PdfTextPage[]): ExamPdfAnalysis {
  const header = pages.slice(0, 2).flatMap(page => page.runs.filter(run => run.top < .19).map(run => run.text)).join(' ')
  const metadata = inferExamMetadata(header)
  const warnings = ['자동 추출한 문항 영역과 태그는 초안입니다. 등록 전에 문제·보기·선택지가 모두 보이는지 확인해 주세요.']
  if (!metadata.subject || !metadata.grade || !metadata.year || !metadata.month) warnings.push('머리말에서 일부 시험 정보를 확인하지 못했어요. 과목·학년·연월을 직접 확인해 주세요.')
  const candidates: Anchor[] = []
  for (const page of pages) for (const run of page.runs) {
    const match = /^\s*(\d{1,2})\s*\.\s*(?:\D|$)/.exec(run.text)
    if (!match || run.top < .06 || run.top > .91) continue
    const column = run.left <= .22 ? 0 : run.left >= .44 && run.left <= .64 ? 1 : null
    if (column !== null) candidates.push({ page: page.page, number: Number(match[1]), x: run.left, y: run.top, column })
  }
  // Question numbers align; ignore numbered lists indented inside a passage.
  const columns = ([0, 1] as const).map(column => {
    const subset = candidates.filter(a => a.column === column)
    const centers = subset.map(anchor => ({ x: anchor.x, n: subset.filter(other => Math.abs(other.x - anchor.x) < .009).length }))
      .sort((a, b) => b.n - a.n || a.x - b.x)
    return centers[0]?.x
  })
  const aligned = candidates.filter(a => columns[a.column] !== undefined && Math.abs(a.x - columns[a.column]!) < .009)
    .sort((a, b) => a.page - b.page || a.column - b.column || a.y - b.y)
  // A sequential chain avoids treating an internal numbered list as questions.
  const starts = aligned.map((a, i) => ({ a, i })).filter(({ a }) => a.number === 1)
  let anchors: Anchor[] = []
  for (const { i } of starts) {
    const chain: Anchor[] = []; let expected = 1
    for (const candidate of aligned.slice(i)) if (candidate.number === expected) { chain.push(candidate); expected++ }
    if (chain.length > anchors.length) anchors = chain
  }
  if (!anchors.length && aligned.length) {
    const seen = new Set<number>()
    anchors = aligned.filter(a => a.number > 0 && !seen.has(a.number) && !!seen.add(a.number))
    warnings.push('1번부터 이어지는 문항 번호를 확인하지 못했어요. 문항 번호와 누락을 확인해 주세요.')
  }
  if (anchors.length > 100) throw new Error('한 번에 최대 100문항까지 등록할 수 있어요.')
  const leftEdge = clamp((columns[0] ?? .1) - .006, .02, .2)
  const split = columns[1] ?? .51
  const lines = pages.flatMap(page => ([0, 1] as const).flatMap(column => columnLines(page, column)))
  const markers: RangeMarker[] = []
  for (const line of lines) {
    const range = /^\s*\[\s*(\d{1,2})\s*[~～∼–-]\s*(\d{1,2})\s*\]/.exec(line.text)
    if (!range || line.y < .06 || line.y > .91) continue
    const first = Number(range[1]), last = Number(range[2])
    if (first >= last || !anchors.some(anchor => anchor.number === first) || !anchors.some(anchor => anchor.number === last)) continue
    // English headings may share a task instruction while each numbered item
    // has its own passage. A number range alone is not a shared-passage signal.
    const instructionOnly = metadata.subject === '영어'
      && /빈칸에\s*들어갈|이어질\s*글의\s*순서|주어진\s*문장이\s*들어가|글의\s*흐름으로\s*보아/.test(line.text)
    markers.push({ page: line.page, column: line.column, y: line.y, first, last, kind: instructionOnly ? 'instruction' : 'passage', text: line.text })
  }
  markers.sort((a, b) => readingOrder(a) - readingOrder(b))
  const bounds = (column: 0 | 1) => ({
    left: column === 0 ? leftEdge : clamp(split - .006),
    right: column === 0 && columns[1] !== undefined ? split - .017 : 1 - leftEdge,
  })
  function between(start: Position, end: Position): PdfRegion[] {
    const regions: PdfRegion[] = []
    const startSlot = (start.page - 1) * 2 + start.column, endSlot = (end.page - 1) * 2 + end.column
    for (let slot = startSlot; slot <= endSlot; slot++) {
      const pageNumber = Math.floor(slot / 2) + 1, column = (slot % 2) as 0 | 1
      const page = pages.find(page => page.page === pageNumber)
      if (!page) continue
      const top = slot === startSlot ? Math.max(.01, start.y - .008) : pageContentTop(page)
      const bottom = slot === endSlot ? Math.min(.913, end.y - .010) : .913
      if (bottom - top >= .01) regions.push({ page: pageNumber, ...bounds(column), top, bottom })
    }
    return regions
  }
  const excludedNumbers = listeningNumbers(pages, metadata.subject, warnings)
  const excluded = new Set(excludedNumbers)
  if (excluded.size) {
    metadata.excludedNumbers = excludedNumbers
    warnings.push(`영어 듣기 ${excludedNumbers[0]}~${excludedNumbers[excludedNumbers.length - 1]}번은 제외했어요. 독해 문항은 원래 번호를 유지합니다.`)
  }
  const passages: ImportPassageDraft[] = []
  const passageByNumber = new Map<number, ImportPassageDraft>()
  const instructionByNumber = new Map<number, string>()
  for (const marker of markers) {
    const first = anchors.find(anchor => anchor.number === marker.first)
    if (!first || readingOrder(first) <= readingOrder(marker)) continue
    if (Array.from({ length: marker.last - marker.first + 1 }, (_, index) => marker.first + index).every(number => excluded.has(number))) continue
    const regions = between(marker, first)
    if (!regions.length || regions.length > 12) {
      warnings.push(`${marker.first}~${marker.last}번 공통 영역은 자동 연결하지 못했어요. 지문 영역을 직접 지정해 주세요.`)
      continue
    }
    const text = regions.map(region => textInside(pages.find(page => page.page === region.page)!, region)).join('\n')
    if (marker.kind === 'instruction') {
      const instruction = text.replace(/^\s*\[\s*\d+\s*[~～∼–-]\s*\d+\s*\]\s*/, '').slice(0, 1000)
      for (let number = marker.first; number <= marker.last; number++) instructionByNumber.set(number, instruction)
    } else {
      const passage: ImportPassageDraft = { clientId: crypto.randomUUID(), title: `${marker.first}~${marker.last}번 공통 지문`, searchText: text.slice(0, 30000), regions, reviewed: false }
      passages.push(passage)
      for (let number = marker.first; number <= marker.last; number++) if (!excluded.has(number)) passageByNumber.set(number, passage)
    }
  }
  const shortAnswerStart = metadata.subject === '수학'
    ? lines.filter(line => /단\s*답\s*형/.test(line.text)).sort((a, b) => readingOrder(a) - readingOrder(b))[0] : undefined
  const questions: ImportQuestionDraft[] = anchors.map(anchor => {
    const page = pages.find(p => p.page === anchor.page)!
    const next = anchors.find(a => a.page === anchor.page && a.column === anchor.column && a.y > anchor.y + .005)
    const nextMarker = markers.find(marker => marker.page === anchor.page && marker.column === anchor.column && marker.y > anchor.y + .005)
    let bottom = Math.min(next ? next.y - .008 : .913, nextMarker ? nextMarker.y - .010 : .913)
    const footer = page.runs.find(run => run.top > anchor.y + .03 && run.top < bottom
      && (anchor.column === 0 ? run.left < .5 : run.left >= .5) && /확인\s*사항|답안지의\s*해당란|이\s*문제지에\s*관한/.test(run.text))
    if (footer) bottom = footer.top - .012
    const region: PdfRegion = {
      page: anchor.page, ...bounds(anchor.column),
      top: clamp(anchor.y - .008),
      bottom: Math.max(bottom, anchor.y + .025),
    }
    const text = textInside(page, region)
    const instruction = instructionByNumber.get(anchor.number) ?? ''
    const passage = passageByNumber.get(anchor.number)
    const responseType = shortAnswerStart && readingOrder(anchor) > readingOrder(shortAnswerStart) ? 'short_answer' as const : 'multiple_choice' as const
    // Common-passage text informs suggestions, but is stored once separately.
    const tagText = `${instruction}\n${passage?.searchText ?? ''}\n${text}`
    const tags = suggestQuestionTags(metadata.subject, tagText)
    const title = suggestQuestionTitle({ subject: metadata.subject, number: anchor.number, text, passageText: passage?.searchText, instruction, tags })
    return {
      clientId: crypto.randomUUID(), number: anchor.number, title,
      tags, points: Number(/\[\s*([1-9])\s*점\s*\]/.exec(text)?.[1] ?? 2),
      searchText: text.slice(0, 20000), regions: [region], reviewed: false,
      responseType, ...(passage ? { passageClientId: passage.clientId } : {}), ...(instruction ? { instruction } : {}),
    }
  }).filter(question => !excluded.has(question.number))
  if (!questions.length) warnings.push('자동으로 문항 번호를 찾지 못했어요. 스캔 PDF이거나 다른 편집 형식일 수 있습니다. 페이지에서 문항 영역을 직접 추가해 주세요.')
  if (passages.length) {
    warnings.push(`공통 지문 ${passages.length}개를 문항에 연결했어요. 여러 단·쪽의 읽기 순서와 지문 끝을 검수해 주세요.`)
  } else if (metadata.subject && metadata.subject !== '한국사') {
    warnings.push('긴 지문이나 다음 단·쪽으로 이어지는 내용은 문항 영역에 추가해 주세요.')
  }
  warnings.push('추천 태그는 문제의 단어를 기준으로 제안하며 AI 분류가 아닙니다. 필요한 태그를 직접 수정할 수 있어요.')
  return { metadata, pageCount: pages.length, questions, passages, warnings }
}

/** Keep every non-white pixel (including thin diagram lines), plus padding. */
export function verticalContentBounds(pixels: Uint8ClampedArray, width: number, height: number, padding = 16) {
  let first = height, last = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      if (pixels[offset + 3]! > 0 && Math.min(pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!) < 245) {
        first = Math.min(first, y); last = y; break
      }
    }
  }
  return last < first ? { top: 0, bottom: height } : { top: Math.max(0, first - padding), bottom: Math.min(height, last + padding + 1) }
}

function trimBlankRows(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d')
  if (!context) return canvas
  const data = context.getImageData(0, 0, canvas.width, canvas.height)
  const { top, bottom } = verticalContentBounds(data.data, canvas.width, canvas.height)
  if (top > 0 || bottom < canvas.height) {
    canvas.height = bottom - top
    context.putImageData(data, 0, -top)
  }
  return canvas
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (!blob || blob.type !== 'image/webp') reject(new Error('문제 이미지를 만들지 못했어요. 최신 브라우저에서 다시 시도해 주세요.'))
    else resolve(blob)
  }, 'image/webp', .96))
}

export async function openExamPdf(file: File): Promise<ExamPdfDocument> {
  if (!file.size || file.size > MAX_PDF_BYTES) throw new Error('PDF 파일은 20MB 이하로 올려 주세요.')
  if (!/\.pdf$/i.test(file.name)) throw new Error('문제지 PDF 파일을 선택해 주세요.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!new TextDecoder().decode(bytes.slice(0, 1024)).includes('%PDF-')) throw new Error('올바른 PDF 파일인지 확인해 주세요.')
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const task = pdfjs.getDocument({
    data: bytes, stopAtErrors: true, fontExtraProperties: true,
    cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
    wasmUrl: `${import.meta.env.BASE_URL}pdfjs/wasm/`,
  })
  let document: PDFDocumentProxy
  try {
    document = await task.promise
    if (document.numPages > MAX_PDF_PAGES) throw new Error('PDF는 한 번에 40쪽 이하로 올려 주세요.')
  } catch (cause) {
    await task.destroy()
    if (cause instanceof Error && /40쪽/.test(cause.message)) throw cause
    throw new Error('PDF를 열지 못했어요. 암호가 없고 손상되지 않은 문제지인지 확인해 주세요.')
  }
  let destroyed = false
  let textPages: PdfTextPage[] | null = null
  function ensureOpen() { if (destroyed) throw new Error('PDF 검수가 종료되었어요. 파일을 다시 선택해 주세요.') }
  async function readText() {
    ensureOpen()
    if (textPages) return textPages
    const pages: PdfTextPage[] = []
    for (let number = 1; number <= document.numPages; number++) {
      ensureOpen()
      const page = await document.getPage(number)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      // Font names become available when the page's operators load. Only do
      // this extra work on pages with private-use glyphs; failures retain the
      // original text, and images always render from the original PDF.
      if (content.items.some(item => 'str' in item && hasPrivateUseCharacters(item.str))) {
        try { await page.getOperatorList() } catch { ensureOpen() }
      }
      const runs: PdfTextRun[] = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        let text = item.str
        if (hasPrivateUseCharacters(text) && page.commonObjs.has(item.fontName)) {
          const font = page.commonObjs.get(item.fontName) as { name?: unknown } | undefined
          text = normalizeKnownEquationText(text, font?.name)
        }
        const transform = pdfjs.Util.transform(viewport.transform, item.transform)
        const h = Math.max(1, Math.hypot(transform[2]!, transform[3]!))
        const x = transform[4]!, baseline = transform[5]!
        runs.push({ text, left: clamp(x / viewport.width), top: clamp((baseline - h * .9) / viewport.height), right: clamp((x + item.width) / viewport.width), bottom: clamp((baseline + h * .2) / viewport.height) })
      }
      pages.push({ page: number, runs })
    }
    ensureOpen()
    textPages = pages
    return pages
  }
  async function renderRegion(region: PdfRegion, scale: number): Promise<HTMLCanvasElement> {
    ensureOpen()
    validatePdfRegions([region], document.numPages)
    const page = await document.getPage(region.page)
    const viewport = page.getViewport({ scale })
    const canvas = window.document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil((region.right - region.left) * viewport.width))
    canvas.height = Math.max(1, Math.ceil((region.bottom - region.top) * viewport.height))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('이미지 미리보기를 지원하는 브라우저에서 다시 시도해 주세요.')
    try {
      await page.render({ canvas, canvasContext: context, viewport, transform: [1, 0, 0, 1, -region.left * viewport.width, -region.top * viewport.height], background: '#ffffff', annotationMode: pdfjs.AnnotationMode.DISABLE }).promise
      ensureOpen()
      return canvas
    } catch (cause) { canvas.width = 0; canvas.height = 0; throw cause }
  }
  return {
    pageCount: document.numPages,
    async analyze() { return analyzePdfText(await readText()) },
    async regionText(regions) {
      validatePdfRegions(regions, document.numPages)
      const pages = await readText()
      return regions.map(r => textInside(pages[r.page - 1]!, r)).join('\n').slice(0, 20000)
    },
    async renderPage(page) {
      const canvas = await renderRegion({ page, left: 0, top: 0, right: 1, bottom: 1 }, 1.15)
      try { return { blob: await canvasBlob(canvas), width: canvas.width, height: canvas.height } }
      finally { canvas.width = 0; canvas.height = 0 }
    },
    async renderQuestion(regions) {
      validatePdfRegions(regions, document.numPages)
      const tiles: HTMLCanvasElement[] = []
      const output = window.document.createElement('canvas')
      try {
        for (const region of regions) tiles.push(trimBlankRows(await renderRegion(region, 2)))
        const width = Math.max(...tiles.map(tile => tile.width))
        const heights = tiles.map(tile => Math.ceil(tile.height * width / tile.width))
        const height = heights.reduce((sum, h) => sum + h, 0) + 16 * (tiles.length - 1)
        if (width > 4000 || height > 10000) throw new Error('문항 영역이 너무 길어요. 필요한 지문과 문제만 선택해 주세요.')
        output.width = width; output.height = height
        const context = output.getContext('2d')
        if (!context) throw new Error('이미지 미리보기를 만들지 못했어요.')
        context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height)
        let y = 0
        for (let i = 0; i < tiles.length; i++) { context.drawImage(tiles[i]!, 0, y, width, heights[i]!); y += heights[i]! + 16 }
        return { blob: await canvasBlob(output), width, height }
      } finally {
        for (const tile of tiles) { tile.width = 0; tile.height = 0 }
        output.width = 0; output.height = 0
      }
    },
    async destroy() { if (!destroyed) { destroyed = true; textPages = null; await task.destroy() } },
  }
}
