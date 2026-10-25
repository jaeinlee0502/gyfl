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
  width?: number
  height?: number
}

export interface ExamPdfAnalysis {
  metadata: Partial<ExamImportMetadata>
  pageCount: number
  questions: ImportQuestionDraft[]
  warnings: string[]
}

export interface RenderedPdfImage {
  blob: Blob
  width: number
  height: number
}

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
}

export function ebsExamListUrl(grade: 1 | 2) {
  return `https://www.ebsi.co.kr/ebs/xip/xipc/previousPaperList.ebs?targetCd=D${grade}00`
}
