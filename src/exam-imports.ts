import { getCurrentScope, onScopeDispose } from 'vue'
import { useAccount } from './account'
import { supabase } from './lib/supabase'
import { subjects } from './data'
import {
  MAX_PDF_BYTES, MAX_PDF_PAGES, passageImageKey,
  type ExamImportMetadata, type ExamImportRecord, type ImportPassageDraft, type ImportQuestionDraft,
  type PdfRegion, type RenderedPdfImage,
} from './import-types'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const maxImageBytes = 10 * 1024 * 1024
const interrupted = '관리자 계정이나 로그인 상태가 바뀌어 작업을 중단했어요. 다시 로그인해 주세요.'

function checkId(id: string) {
  if (!uuid.test(id)) throw new Error('자료를 다시 선택해 주세요.')
}

function sourcePath(id: string) { return `imports/${id}/source.pdf` }
function questionPath(id: string, clientId: string) { return `imports/${id.toLowerCase()}/questions/${clientId.toLowerCase()}.webp` }
function passagePath(id: string, clientId: string, index: number) { return `imports/${id.toLowerCase()}/passages/${clientId.toLowerCase()}/${index}.webp` }

function friendlyError(code: string) {
  switch (code) {
    case 'UNAUTHENTICATED': case 'ADMIN_REQUIRED': return '관리자 로그인 상태를 확인해 주세요.'
    case 'IMPORT_NOT_FOUND': return '자료를 찾지 못했어요. 목록을 다시 불러와 주세요.'
    case 'IMPORT_PUBLISHED': return '이미 등록된 자료예요. 목록을 다시 불러와 주세요.'
    case 'IMPORT_DELETING': return '자료를 삭제하는 중이에요. 잠시 후 삭제를 다시 시도해 주세요.'
    case 'IMPORT_CONFLICT': return '같은 시험의 문항이 이미 등록되어 있어요. 문항 번호와 기존 자료를 확인해 주세요.'
    case 'IMPORT_NOT_READY': return 'PDF 업로드와 모든 문항의 검토를 완료한 뒤 등록해 주세요.'
    case 'INVALID_METADATA': return '시험의 과목·학년·연월과 EBS 링크를 확인해 주세요.'
    case 'INVALID_QUESTIONS': case 'INVALID_DRAFT': return '문항 번호·제목·태그·문제 영역을 확인해 주세요.'
    case 'INVALID_PASSAGES': return '공통 지문의 영역과 연결된 문항을 확인해 주세요.'
    case 'REQUEST_TOO_LARGE': return '검수 내용이 너무 커요. 문항 수나 검색용 텍스트를 줄여서 저장해 주세요.'
    case 'INVALID_IMPORT': case 'INVALID_BODY': return '자료 정보를 확인하고 다시 시도해 주세요.'
    case 'STORAGE_DELETE_FAILED': return '파일을 모두 삭제하지 못했어요. 잠시 후 삭제를 다시 시도해 주세요.'
    default: return '자료 관리 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'
  }
}

function officialUrl(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'www.ebsi.co.kr' } catch { return false }
}

function validRegions(regions: PdfRegion[], maximum: number, minimum = 0) {
  return Array.isArray(regions) && regions.length > 0 && regions.length <= maximum && regions.every(region =>
    Number.isInteger(region.page) && region.page >= 1 && region.page <= MAX_PDF_PAGES
    && [region.left, region.top, region.right, region.bottom].every(Number.isFinite)
    && region.left >= 0 && region.top >= 0 && region.right <= 1 && region.bottom <= 1
    && region.left < region.right && region.top < region.bottom
    && region.right - region.left + 1e-9 >= minimum && region.bottom - region.top + 1e-9 >= minimum)
}

function validImage(image: RenderedPdfImage | undefined): image is RenderedPdfImage {
  return Boolean(image && image.blob.type === 'image/webp' && image.blob.size > 0 && image.blob.size <= maxImageBytes
    && Number.isInteger(image.width) && image.width >= 1 && image.width <= 10000
    && Number.isInteger(image.height) && image.height >= 1 && image.height <= 10000)
}

function validatePublish(metadata: ExamImportMetadata, questions: ImportQuestionDraft[], images: ReadonlyMap<string, RenderedPdfImage>,
  passages: ImportPassageDraft[], passageImages: ReadonlyMap<string, RenderedPdfImage>) {
  if (!subjects.some(subject => subject.name === metadata.subject) || ![1, 2].includes(metadata.grade)
    || !Number.isInteger(metadata.year) || metadata.year < 2025 || metadata.year > 2100
    || ![3, 6, 9, 10].includes(metadata.month) || !officialUrl(metadata.sourceUrl) || !officialUrl(metadata.explanationUrl)) {
    throw new Error(friendlyError('INVALID_METADATA'))
  }
  if (questions.length === 0 || questions.length > 100 || questions.some(question => !question.reviewed)) {
    throw new Error('등록할 모든 문항의 이미지와 태그를 검토한 뒤 확인해 주세요.')
  }
  const excluded = metadata.excludedNumbers === undefined ? [] : metadata.excludedNumbers
  if (!Array.isArray(excluded) || excluded.length > 100 || new Set(excluded).size !== excluded.length
    || excluded.some(number => !Number.isInteger(number) || number < 1 || number > 100)
    || questions.some(question => excluded.includes(question.number))) {
    throw new Error('제외한 문항 번호와 등록할 문항이 겹치지 않는지 확인해 주세요.')
  }
  if (!Array.isArray(passages) || passages.length > 100) throw new Error(friendlyError('INVALID_PASSAGES'))
  const passageIds = new Set<string>()
  for (const passage of passages) {
    if (!uuid.test(passage.clientId) || passageIds.has(passage.clientId.toLowerCase())
      || typeof passage.title !== 'string' || !passage.title.trim() || passage.title.length > 200
      || typeof passage.searchText !== 'string' || passage.searchText.length > 30000
      || !validRegions(passage.regions, 12, .01)) throw new Error(friendlyError('INVALID_PASSAGES'))
    passageIds.add(passage.clientId.toLowerCase())
    if (!passage.reviewed) throw new Error('공통 지문도 이미지와 연결 문항을 검토한 뒤 확인해 주세요.')
    if (!questions.some(question => question.passageClientId?.toLowerCase() === passage.clientId.toLowerCase())) {
      throw new Error('연결된 문항이 없는 공통 지문을 확인하거나 제외해 주세요.')
    }
    for (let index = 0; index < passage.regions.length; index++) {
      if (!validImage(passageImages.get(passageImageKey(passage.clientId, index)))) {
        throw new Error('공통 지문 미리보기를 다시 생성하고 모든 영역의 이미지가 있는지 확인해 주세요.')
      }
    }
  }
  const ids = new Set<string>(), numbers = new Set<number>()
  for (const question of questions) {
    if (!uuid.test(question.clientId) || ids.has(question.clientId.toLowerCase()) || !Number.isInteger(question.number)
      || question.number < 1 || question.number > 100 || numbers.has(question.number)
      || !question.title.trim() || question.title.length > 200
      || !Array.isArray(question.tags) || question.tags.length === 0 || question.tags.length > 20
      || question.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 60)
      || !Number.isInteger(question.points) || question.points < 1 || question.points > 10
      || typeof question.searchText !== 'string' || question.searchText.length > 30000
      || !validRegions(question.regions, 16)
      || (question.instruction !== undefined && (typeof question.instruction !== 'string' || question.instruction.length > 2000))
      || (question.responseType !== undefined && !['multiple_choice', 'short_answer'].includes(question.responseType))
      || (question.passageClientId !== undefined && (!uuid.test(question.passageClientId)
        || !passageIds.has(question.passageClientId.toLowerCase())))) {
      throw new Error(friendlyError('INVALID_QUESTIONS'))
    }
    ids.add(question.clientId.toLowerCase()); numbers.add(question.number)
    const image = images.get(question.clientId)
    if (!validImage(image)) {
      throw new Error('문항 미리보기를 다시 생성하고 이미지가 올바른지 확인해 주세요.')
    }
  }
}

async function pdfHeader(file: File) {
  const prefix = file.slice(0, 5)
  if (typeof prefix.arrayBuffer === 'function') return new Uint8Array(await prefix.arrayBuffer())
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(new Error('PDF 파일을 읽지 못했어요. 파일을 다시 선택해 주세요.'))
    reader.readAsArrayBuffer(prefix)
  })
}

export function useExamImports() {
  const account = useAccount()
  let generation = 0
  let disposed = false
  function capture() {
    if (disposed || !supabase || !account.configured || !account.authReady.value || !account.user.value || !account.isAdmin.value) {
      throw new Error('관리자 계정으로 로그인한 뒤 자료를 관리해 주세요.')
    }
    return { client: supabase, userId: account.user.value.id, generation }
  }
  type Identity = ReturnType<typeof capture>
  function current(identity: Identity) {
    if (disposed || generation !== identity.generation || !account.authReady.value || !account.isAdmin.value
      || account.user.value?.id !== identity.userId) throw new Error(interrupted)
  }
  function cancelPending() { generation++ }
  if (getCurrentScope()) onScopeDispose(() => { disposed = true; cancelPending() })

  async function request<T>(identity: Identity, body: Record<string, unknown>): Promise<T> {
    current(identity)
    let result
    try { result = await identity.client.functions.invoke('exam-admin', { body }) }
    catch { current(identity); throw new Error(friendlyError('SERVICE_UNAVAILABLE')) }
    current(identity)
    if (result.error) {
      let code = ''
      if (result.error.context instanceof Response) {
        const body = await result.error.context.json().catch(() => null)
        current(identity)
        code = body?.code ?? ''
      }
      throw new Error(friendlyError(code))
    }
    return result.data as T
  }

  async function listImports() {
    const identity = capture()
    return (await request<{ imports: ExamImportRecord[] }>(identity, { action: 'list-imports' })).imports
  }

  async function getImport(id: string) {
    const identity = capture(); checkId(id)
    return (await request<{ import: ExamImportRecord }>(identity, { action: 'get-import', id })).import
  }

  async function createImport(file: File, sha256: string, pageCount: number) {
    const identity = capture()
    if (!/\.pdf$/i.test(file.name) || file.name.length > 200 || file.size < 5 || file.size > MAX_PDF_BYTES) {
      throw new Error('20MB 이하의 PDF 파일을 선택해 주세요.')
    }
    if (!/^[a-f0-9]{64}$/i.test(sha256) || !Number.isInteger(pageCount) || pageCount < 1 || pageCount > MAX_PDF_PAGES) {
      throw new Error('PDF 정보를 확인하지 못했어요. 40쪽 이하의 파일을 다시 분석해 주세요.')
    }
    const header = await pdfHeader(file)
    current(identity)
    if (String.fromCharCode(...header) !== '%PDF-') throw new Error('올바른 PDF 파일인지 확인해 주세요.')
    const { import: record } = await request<{ import: ExamImportRecord }>(identity, {
      action: 'create-import', fileName: file.name, sha256: sha256.toLowerCase(), pageCount,
    })
    checkId(record.id)
    try {
      if (record.source_path !== sourcePath(record.id) || record.status !== 'draft') throw new Error('Unexpected import source')
      current(identity)
      const { error } = await identity.client.storage.from('exam-imports').upload(record.source_path, file, {
        contentType: 'application/pdf', upsert: false, cacheControl: '0',
      })
      current(identity)
      if (error) throw error
      return record
    } catch {
      current(identity)
      // Only clean this newly created draft; never touch any older import.
      try { await request(identity, { action: 'delete-draft', id: record.id }) } catch { /* Draft remains retryable if cleanup is unavailable. */ }
      current(identity)
      throw new Error('PDF를 업로드하지 못했어요. 연결을 확인하고 파일을 다시 선택해 주세요.')
    }
  }

  async function downloadPdf(record: ExamImportRecord) {
    const identity = capture(); checkId(record.id)
    if (record.source_path !== sourcePath(record.id)) throw new Error('자료의 PDF 경로를 확인하지 못했어요. 목록을 다시 불러와 주세요.')
    let result
    try {
      result = await identity.client.storage.from('exam-imports').download(record.source_path, { cacheNonce: crypto.randomUUID() }, { cache: 'no-store' })
    } catch { current(identity); throw new Error('PDF를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.') }
    current(identity)
    if (result.error || !result.data) throw new Error('PDF를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
    return result.data
  }

  async function saveDraft(id: string, metadata: Partial<ExamImportMetadata>, questions: ImportQuestionDraft[], passages: ImportPassageDraft[] = []) {
    const identity = capture(); checkId(id)
    return (await request<{ import: ExamImportRecord }>(identity, { action: 'save-draft', id, metadata, questions, passages })).import
  }

  async function publishImport(id: string, metadata: ExamImportMetadata, questions: ImportQuestionDraft[], images: ReadonlyMap<string, RenderedPdfImage>,
    passages: ImportPassageDraft[] = [], passageImages: ReadonlyMap<string, RenderedPdfImage> = new Map()) {
    const identity = capture(); checkId(id)
    validatePublish(metadata, questions, images, passages, passageImages)
    const prepared = questions.map(question => ({
      ...question, width: images.get(question.clientId)!.width, height: images.get(question.clientId)!.height,
    }))
    const preparedPassages = passages.map(passage => ({
      ...passage, imageSizes: passage.regions.map((_, index) => {
        const image = passageImages.get(passageImageKey(passage.clientId, index))!
        return { width: image.width, height: image.height }
      }),
    }))
    await request(identity, { action: 'save-draft', id, metadata, questions: prepared, passages: preparedPassages })
    for (const question of prepared) {
      current(identity)
      const { error } = await identity.client.storage.from('school-questions').upload(
        questionPath(id, question.clientId), images.get(question.clientId)!.blob,
        { contentType: 'image/webp', upsert: true, cacheControl: '0' },
      ).catch(() => ({ error: true }))
      current(identity)
      if (error) throw new Error('문항 이미지를 모두 업로드하지 못했어요. 검수 자료는 보관되어 있으니 등록을 다시 시도해 주세요.')
    }
    for (const passage of preparedPassages) {
      for (let index = 0; index < passage.regions.length; index++) {
        current(identity)
        const { error } = await identity.client.storage.from('school-questions').upload(
          passagePath(id, passage.clientId, index), passageImages.get(passageImageKey(passage.clientId, index))!.blob,
          { contentType: 'image/webp', upsert: true, cacheControl: '0' },
        ).catch(() => ({ error: true }))
        current(identity)
        if (error) throw new Error('공통 지문 이미지를 모두 업로드하지 못했어요. 검수 자료는 보관되어 있으니 등록을 다시 시도해 주세요.')
      }
    }
    return request<{ message: string; count: number }>(identity, { action: 'publish', id })
  }

  async function deleteDraft(id: string) {
    const identity = capture(); checkId(id)
    return (await request<{ message: string }>(identity, { action: 'delete-draft', id })).message
  }

  return { listImports, createImport, getImport, downloadPdf, saveDraft, publishImport, deleteDraft, cancelPending }
}
