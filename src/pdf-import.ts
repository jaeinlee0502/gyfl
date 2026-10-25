import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { subjects, type Subject } from './data'
import {
  MAX_PDF_BYTES, MAX_PDF_PAGES, ebsExamListUrl,
  type ExamImportMetadata, type ExamPdfAnalysis, type ImportQuestionDraft,
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
    ['통합사회', /통합사회|사회탐구|사회영역/],
    ['통합과학', /통합과학|과학탐구|과학영역/],
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
  국어: { '현대시': /화자|시적|시어/, '고전시가': /시조|가사|향가|고려\s*가요/, '현대소설': /서술자|인물의\s*심리|소설/, '독서': /독서|윗글의\s*내용/, '문법': /음운|형태소|품사|문장\s*성분|높임/, '화법': /발표|토론|토의|대화/, '작문': /초고|고쳐\s*쓰기|작문/, '매체': /매체|인터넷|누리\s*소통망/ },
  수학: { '다항식': /다항식|나머지정리|인수분해/, '방정식과 부등식': /방정식|부등식|두\s*근/, '경우의 수': /경우의\s*수|순열|조합/, '행렬': /행렬/, '도형의 방정식': /원의\s*방정식|직선의\s*방정식|좌표평면/, '집합과 명제': /집합|명제/, '함수': /함수/, '지수와 로그': /지수|로그/, '삼각함수': /삼각함수|sin|cos|tan/, '수열': /수열|등차|등비/, '미분': /미분|도함수|미분계수/, '적분': /적분/, '확률과 통계': /확률|통계|분산|표준편차/ },
  영어: { '주제·제목': /주제로|제목으로/, '요지·주장': /요지로|주장하는/, '목적·심경': /목적으로|심경|분위기/, '빈칸 추론': /빈칸/, '글의 순서': /순서로/, '문장 삽입': /들어가기에|주어진\s*문장/, '어법': /어법상/, '어휘': /낱말의\s*쓰임|문맥상|의미하는/, '내용 일치': /내용과\s*일치|내용으로\s*적절하지/, '요약': /요약/, '듣기': /대화를\s*듣고|말을\s*듣고/ },
  통합사회: { '인권': /인권|기본권/, '헌법': /헌법|입헌/, '사회정의': /정의|분배|불평등/, '시장경제': /시장|수요|공급|경제/, '금융': /금융|예금|주식|채권/, '지리': /지도|지형|지역|인구/, '기후와 환경': /기후|환경|강수|온난화/, '문화': /문화/, '사회문화': /사회화|사회\s*집단/, '세계사': /세계사|문명/, '세계화': /세계화|국제\s*교역/, '평화': /평화|분쟁/, '지속가능발전': /지속\s*가능/ },
  통합과학: { '물리': /힘|속도|가속도|운동량|전류|자기장/, '화학': /원소|화학|분자|원자|이온/, '생명과학': /생명|세포|유전|효소/, '지구과학': /지구|지층|대기|천체|판의\s*운동/, '물질의 규칙성': /주기율|주기적/, '역학 시스템': /역학|중력|운동/, '지구 시스템': /수권|기권|지권/, '생명 시스템': /생명|세포/, '화학 변화': /산화|환원|산과\s*염기/, '생태계': /생태계|먹이\s*사슬/, '에너지': /에너지|발전|전력/, '과학과 미래 사회': /인공지능|빅데이터|미래\s*사회/ },
}

export function suggestQuestionTags(subject: Subject | undefined, text: string): string[] {
  if (!subject) return []
  const allowed = new Set(subjects.find(s => s.name === subject)?.tags ?? [])
  return Object.entries(concepts[subject] ?? {}).filter(([tag, pattern]) => allowed.has(tag) && pattern.test(text)).map(([tag]) => tag)
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
  const questions: ImportQuestionDraft[] = anchors.map(anchor => {
    const page = pages.find(p => p.page === anchor.page)!
    const next = anchors.find(a => a.page === anchor.page && a.column === anchor.column && a.y > anchor.y + .005)
    let bottom = next ? next.y - .008 : .908
    const footer = page.runs.find(run => run.top > anchor.y + .03 && run.top < bottom
      && (anchor.column === 0 ? run.left < .5 : run.left >= .5) && /확인\s*사항|답안지의\s*해당란|이\s*문제지에\s*관한/.test(run.text))
    if (footer) bottom = footer.top - .012
    const region: PdfRegion = {
      page: anchor.page, left: anchor.column === 0 ? leftEdge : clamp(split - .006),
      top: clamp(anchor.y - .008), right: anchor.column === 0 && columns[1] !== undefined ? split - .017 : 1 - leftEdge,
      bottom: Math.max(bottom, anchor.y + .025),
    }
    const text = textInside(page, region)
    const firstLine = page.runs.filter(run => run.top >= anchor.y - .005 && run.top < anchor.y + .025 && run.left >= region.left && run.left < region.right)
      .sort((a, b) => Math.abs(a.top - b.top) < .003 ? a.left - b.left : a.top - b.top).map(run => run.text).join(' ')
    const title = firstLine.replace(/^\s*\d+\s*\.\s*/, '').replace(/\[\s*\d\s*점\s*\]/g, '').trim().slice(0, 160)
    return {
      clientId: crypto.randomUUID(), number: anchor.number, title: title || `${metadata.subject ?? '모의고사'} ${anchor.number}번`,
      tags: suggestQuestionTags(metadata.subject, text), points: Number(/\[\s*([1-9])\s*점\s*\]/.exec(text)?.[1] ?? 2),
      searchText: text.slice(0, 20000), regions: [region], reviewed: false,
    }
  })
  if (!questions.length) warnings.push('자동으로 문항 번호를 찾지 못했어요. 스캔 PDF이거나 다른 편집 형식일 수 있습니다. 페이지에서 문항 영역을 직접 추가해 주세요.')
  if (pages.some(page => page.runs.some(run => /\[\s*\d+\s*[~～∼–-]\s*\d+\s*\]/.test(run.text)))) {
    warnings.push('여러 문항이 함께 사용하는 지문이 있을 수 있어요. 필요한 공통 지문을 각 문항의 추가 영역으로 포함해 주세요.')
  } else if (metadata.subject && metadata.subject !== '한국사') {
    warnings.push('긴 지문이나 다음 단·쪽으로 이어지는 내용은 문항 영역에 추가해 주세요.')
  }
  warnings.push('추천 태그는 문제의 단어를 기준으로 제안하며 AI 분류가 아닙니다. 필요한 태그를 직접 수정할 수 있어요.')
  return { metadata, pageCount: pages.length, questions, warnings }
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
    data: bytes, stopAtErrors: true,
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
      const runs: PdfTextRun[] = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        const transform = pdfjs.Util.transform(viewport.transform, item.transform)
        const h = Math.max(1, Math.hypot(transform[2]!, transform[3]!))
        const x = transform[4]!, baseline = transform[5]!
        runs.push({ text: item.str, left: clamp(x / viewport.width), top: clamp((baseline - h * .9) / viewport.height), right: clamp((x + item.width) / viewport.width), bottom: clamp((baseline + h * .2) / viewport.height) })
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
        for (const region of regions) tiles.push(await renderRegion(region, 2))
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
