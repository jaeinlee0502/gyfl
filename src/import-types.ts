import type { Subject } from './data'

export const MAX_PDF_BYTES = 20 * 1024 * 1024
export const MAX_PDF_PAGES = 40

export interface ExamImportMetadata {
  subject: Subject
  grade: 1 | 2
  year: number
  month: 3 | 6 | 9 | 10
  sourceUrl: string
  explanationUrl: string
  excludedNumbers?: number[]
}

// Fractions of the displayed page, measured from its upper-left corner.
export interface PdfRegion {
  page: number
  left: number
  top: number
  right: number
  bottom: number
}

export interface ImportQuestionDraft {
  clientId: string
  number: number
  title: string
  tags: string[]
  points: number
  searchText: string
  regions: PdfRegion[]
  reviewed: boolean
  aiReviewNote?: string
  width?: number
  height?: number
  passageClientId?: string
  instruction?: string
  responseType?: 'multiple_choice' | 'short_answer'
}

export interface ImportPassageDraft {
  clientId: string
  title: string
  searchText: string
  regions: PdfRegion[]
  reviewed: boolean
  imageSizes?: Array<{ width: number; height: number }>
}

export function passageImageKey(clientId: string, index: number) { return `${clientId}:${index}` }

export interface ExamPdfAnalysis {
  metadata: Partial<ExamImportMetadata>
  pageCount: number
  questions: ImportQuestionDraft[]
  warnings: string[]
  passages?: ImportPassageDraft[]
}

export interface RenderedPdfImage {
  blob: Blob
  width: number
  height: number
}

export interface AiTitleQuestion {
  clientId: string
  number: number
  text: string
  passageText: string
  instruction: string
  tags: string[]
}
export interface AiTitleSuggestion { clientId: string; title: string }
export interface AiMetadataSuggestion extends AiTitleSuggestion { tags: string[]; reviewNote: string }

export interface ExamImportRecord {
  id: string
  file_name: string
  sha256: string
  page_count: number
  source_path: string
  status: 'draft' | 'published'
  metadata: Partial<ExamImportMetadata>
  questions: ImportQuestionDraft[]
  created_at: string
  published_at: string | null
  deleting_at?: string | null
  passages?: ImportPassageDraft[]
}

export function ebsExamListUrl(grade: 1 | 2) {
  return `https://www.ebsi.co.kr/ebs/xip/xipc/previousPaperList.ebs?targetCd=D${grade}00`
}
