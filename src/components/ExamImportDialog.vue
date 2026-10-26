<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowReactive, shallowRef, watch } from 'vue'
import { Check, FileUp, Plus, RefreshCw, Save, Scissors, Trash2, X } from 'lucide-vue-next'
import { useAccount } from '../account'
import { subjects, type Subject } from '../data'
import { useExamImports } from '../exam-imports'
import { openExamPdf } from '../pdf-import'
import { suggestQuestionTitle } from '../question-titles'
import { MAX_PDF_BYTES, MAX_PDF_PAGES, ebsExamListUrl, passageImageKey, type ExamImportMetadata, type ExamImportRecord, type ImportPassageDraft, type ImportQuestionDraft, type PdfRegion, type RenderedPdfImage } from '../import-types'

const emit = defineEmits<{ close: []; published: [payload: { count: number; subject: Subject }] }>()
const { configured, user, authReady, isAdmin } = useAccount()
const { listImports, createImport, getImport, downloadPdf, saveDraft, publishImport, deleteDraft } = useExamImports()
const allowed = computed(() => configured && authReady.value && Boolean(user.value) && isAdmin.value)
const dialog = ref<HTMLDialogElement | null>(null)
const chosenFile = ref<File | null>(null)
const activeRecord = ref<ExamImportRecord | null>(null)
const records = ref<ExamImportRecord[]>([])
const listLoading = ref(false)
const listError = ref('')
const busy = ref(false)
const publishing = ref(false)
const progress = ref('')
const error = ref('')
const notice = ref('')
const warnings = ref<string[]>([])
const dirty = ref(false)
const confirmClose = ref(false)
const deleteTarget = ref<ExamImportRecord | null>(null)
const metadata = reactive<Partial<ExamImportMetadata>>({ sourceUrl: '', explanationUrl: '' })
const questions = ref<ImportQuestionDraft[]>([])
const passages = ref<ImportPassageDraft[]>([])
type TitleCandidate = { questionId: string; previous: string; title: string; signature: string; selected: boolean }
const titleSuggestions = reactive<Record<string, TitleCandidate>>({})
const titleCandidates = ref<TitleCandidate[] | null>(null)
type PdfDocument = Awaited<ReturnType<typeof openExamPdf>>
const document = shallowRef<PdfDocument | null>(null)
const previews = shallowReactive(new Map<string, { image: RenderedPdfImage; url: string }>())
const passagePreviews = shallowReactive(new Map<string, { image: RenderedPdfImage; url: string }>())
const editingId = ref('')
const editingKind = ref<'question' | 'passage'>('question')
const editorElement = ref<HTMLElement | null>(null)
const editingRegions = ref<PdfRegion[]>([])
const editingIndex = ref(0)
const pagePreview = shallowRef<{ url: string; page: number } | null>(null)
const dragStart = ref<{ x: number; y: number } | null>(null)
let alive = true
let version = 0
let listVersion = 0
let pageVersion = 0

function officialUrl(value: unknown) {
  try { const url = new URL(String(value)); return url.protocol === 'https:' && url.hostname === 'www.ebsi.co.kr' } catch { return false }
}
const completeMetadata = computed<ExamImportMetadata | null>(() => {
  if (!subjects.some(s => s.name === metadata.subject) || ![1, 2].includes(Number(metadata.grade))
    || !Number.isInteger(metadata.year) || Number(metadata.year) < 2025 || Number(metadata.year) > 2100
    || ![3, 6, 9, 10].includes(Number(metadata.month)) || !officialUrl(metadata.sourceUrl) || !officialUrl(metadata.explanationUrl)) return null
  return { subject: metadata.subject!, grade: metadata.grade!, year: metadata.year!, month: metadata.month!, sourceUrl: metadata.sourceUrl!.trim(), explanationUrl: metadata.explanationUrl!.trim(), ...(metadata.excludedNumbers?.length ? { excludedNumbers: [...metadata.excludedNumbers] } : {}) }
})
const selectedSubject = computed(() => subjects.find(s => s.name === metadata.subject))
const reviewedCount = computed(() => questions.value.filter(q => q.reviewed).length)
const reviewedPassageCount = computed(() => passages.value.filter(p => p.reviewed).length)
const passageMap = computed(() => new Map(passages.value.map(p => [p.clientId, p])))
const selectedTitleCount = computed(() => titleCandidates.value?.filter(candidate => candidate.selected && currentTitleCandidate(candidate)).length ?? 0)
const passagesValid = computed(() => passages.value.length <= 100
  && new Set(passages.value.map(p => p.clientId)).size === passages.value.length
  && passages.value.every(p => p.title.trim().length > 0 && p.title.length <= 200
    && p.regions.length > 0 && p.regions.length <= 12 && p.regions.every(validRegion)
    && p.regions.every((_, index) => passagePreviews.has(passageImageKey(p.clientId, index)))
    && questions.value.some(q => q.passageClientId === p.clientId)))
const excludedNumbersText = computed(() => {
  const numbers = [...new Set(metadata.excludedNumbers ?? [])].sort((a, b) => a - b)
  if (!numbers.length) return ''
  const consecutive = numbers.every((n, index) => index === 0 || n === numbers[index - 1]! + 1)
  return consecutive && numbers.length > 1 ? `${numbers[0]}~${numbers.at(-1)}번` : numbers.map(n => `${n}번`).join(', ')
})
const editingLabel = computed(() => editingKind.value === 'passage'
  ? passages.value.find(p => p.clientId === editingId.value)?.title || '공통 지문'
  : `${questions.value.find(q => q.clientId === editingId.value)?.number ?? ''}번 문항`)
const questionsValid = computed(() => questions.value.length > 0 && questions.value.length <= 100
  && new Set(questions.value.map(q => q.number)).size === questions.value.length
  && questions.value.every(q => Number.isInteger(q.number) && q.number >= 1 && q.number <= 100 && q.title.trim().length > 0
    && q.title.length <= 200 && q.tags.length > 0 && q.tags.length <= 20
    && q.tags.every(tag => tag.trim().length > 0 && tag.length <= 60)
    && Number.isInteger(q.points) && q.points >= 1 && q.points <= 10
    && (!q.passageClientId || passageMap.value.has(q.passageClientId))
    && (!q.instruction || q.instruction.length <= 2000)
    && (!q.responseType || ['multiple_choice', 'short_answer'].includes(q.responseType))
    && !metadata.excludedNumbers?.includes(q.number)
    && q.regions.length > 0 && q.regions.every(validRegion) && previews.has(q.clientId)))
const canPublish = computed(() => allowed.value && !busy.value && !editingId.value && Boolean(activeRecord.value && completeMetadata.value)
  && questionsValid.value && passagesValid.value && reviewedCount.value === questions.value.length && reviewedPassageCount.value === passages.value.length)
const editedRegion = computed(() => editingRegions.value[editingIndex.value])
const regionStyle = computed(() => {
  const r = editedRegion.value
  return r ? { left: `${r.left * 100}%`, top: `${r.top * 100}%`, width: `${(r.right - r.left) * 100}%`, height: `${(r.bottom - r.top) * 100}%` } : {}
})

function current(ticket: number) { return alive && allowed.value && ticket === version }
function friendly(cause: unknown) { return cause instanceof Error ? cause.message : '처리하지 못했어요. 잠시 후 다시 시도해 주세요.' }
function validRegion(region: PdfRegion) {
  return Number.isInteger(region.page) && region.page >= 1 && region.page <= (document.value?.pageCount ?? MAX_PDF_PAGES)
    && [region.left, region.top, region.right, region.bottom].every(Number.isFinite)
    && region.left >= 0 && region.top >= 0 && region.right <= 1 && region.bottom <= 1
    && region.right - region.left >= .01 && region.bottom - region.top >= .01
}
function clearPagePreview() {
  ++pageVersion
  if (pagePreview.value) URL.revokeObjectURL(pagePreview.value.url)
  pagePreview.value = null
  dragStart.value = null
}
function clearPreviews() {
  for (const preview of previews.values()) URL.revokeObjectURL(preview.url)
  previews.clear()
  for (const preview of passagePreviews.values()) URL.revokeObjectURL(preview.url)
  passagePreviews.clear()
  clearPagePreview()
}
function destroyDocument() {
  const old = document.value
  document.value = null
  if (old) void Promise.resolve(old.destroy()).catch(() => {})
}
function closeNow() {
  if (publishing.value) return
  alive = false
  ++version
  ++listVersion
  clearPreviews()
  destroyDocument()
  emit('close')
}
function requestClose() {
  if (publishing.value) return
  if (dirty.value && !busy.value) {
    confirmClose.value = true
    void nextTick(() => dialog.value?.querySelector<HTMLButtonElement>('[aria-labelledby="import-close-title"] button')?.focus())
    return
  }
  closeNow()
}
function markChanged(question?: ImportQuestionDraft) {
  dirty.value = true
  notice.value = ''
  if (question) { question.reviewed = false; delete titleSuggestions[question.clientId] }
}
function titleInput(question: ImportQuestionDraft) {
  return { subject: metadata.subject, number: question.number, text: question.searchText,
    passageText: question.passageClientId ? passageMap.value.get(question.passageClientId)?.searchText : undefined,
    instruction: question.instruction, tags: [...question.tags] }
}
function titleSignature(question: ImportQuestionDraft) { return JSON.stringify([question.title, titleInput(question)]) }
function currentTitleCandidate(candidate: TitleCandidate) {
  const question = questions.value.find(question => question.clientId === candidate.questionId)
  return Boolean(question && titleSignature(question) === candidate.signature)
}
async function titleCandidate(question: ImportQuestionDraft): Promise<TitleCandidate | null> {
  const signature = titleSignature(question)
  const input = titleInput(question)
  if (/[\uE000-\uF8FF\uFFFD]/u.test(input.text) && document.value && question.regions.length) {
    input.text = await document.value.regionText(question.regions)
  }
  if (titleSignature(question) !== signature) return null
  const title = suggestQuestionTitle(input).trim().slice(0, 200)
  if (!title || title === question.title) return null
  return { questionId: question.clientId, previous: question.title, title, signature,
    selected: !question.title.trim() || /[\uE000-\uF8FF\uFFFD\u25A1\u25A0]/u.test(question.title) }
}
async function recommendTitle(question: ImportQuestionDraft) {
  if (!allowed.value || busy.value) return
  const ticket = version
  busy.value = true; error.value = ''; progress.value = '제목에 쓸 문제 내용을 확인하고 있어요…'
  try {
    const candidate = await titleCandidate(question)
    if (!current(ticket)) return
    if (candidate) titleSuggestions[question.clientId] = candidate
    else { delete titleSuggestions[question.clientId]; notice.value = '현재 제목과 추천 제목이 같아요. 제목은 직접 수정할 수도 있어요.' }
  } catch (cause) { if (current(ticket)) error.value = friendly(cause) }
  finally { if (current(ticket)) { busy.value = false; progress.value = '' } }
}
function applyTitle(candidate: TitleCandidate) {
  if (!allowed.value || busy.value || !currentTitleCandidate(candidate)) return false
  const question = questions.value.find(question => question.clientId === candidate.questionId)!
  question.title = candidate.title
  markChanged(question)
  return true
}
async function recommendAllTitles() {
  if (!allowed.value || busy.value || !questions.value.length) return
  const ticket = version
  busy.value = true; error.value = ''
  try {
    const candidates: TitleCandidate[] = []
    for (const [index, question] of questions.value.entries()) {
      progress.value = `제목을 추천하고 있어요 (${index + 1}/${questions.value.length})`
      const candidate = await titleCandidate(question)
      if (!current(ticket)) return
      if (candidate) candidates.push(candidate)
    }
    titleCandidates.value = candidates
    if (!candidates.length) notice.value = '현재 제목과 추천 제목이 모두 같아요. 제목은 직접 수정할 수도 있어요.'
  } catch (cause) { if (current(ticket)) error.value = friendly(cause) }
  finally { if (current(ticket)) { busy.value = false; progress.value = '' } }
}
function selectTitleCandidates(selected: boolean) {
  for (const candidate of titleCandidates.value ?? []) candidate.selected = selected && currentTitleCandidate(candidate)
}
function applySelectedTitles() {
  if (!allowed.value || busy.value) return
  let count = 0
  for (const candidate of titleCandidates.value ?? []) if (candidate.selected && applyTitle(candidate)) count++
  titleCandidates.value = null
  if (count) notice.value = `${count}개 제목을 바꿨어요. 변경한 문항을 다시 확인하고 초안을 저장해 주세요.`
}
function clearTitleSuggestions() {
  for (const id of Object.keys(titleSuggestions)) delete titleSuggestions[id]
  titleCandidates.value = null
}
function passageChanged(passage: ImportPassageDraft) {
  markChanged()
  passage.reviewed = false
  for (const question of questions.value) if (question.passageClientId === passage.clientId) question.reviewed = false
}
function linkedNumbers(passage: ImportPassageDraft) {
  return questions.value.filter(q => q.passageClientId === passage.clientId).map(q => q.number).sort((a, b) => a - b)
}
function linkPassage(question: ImportQuestionDraft, event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value) question.passageClientId = value
  else delete question.passageClientId
  markChanged(question)
}
function jumpToPassage(clientId?: string) {
  if (!clientId) return
  dialog.value?.querySelector<HTMLElement>(`[data-passage="${clientId}"]`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
}
function metadataChanged() {
  markChanged()
  for (const question of questions.value) question.reviewed = false
  for (const passage of passages.value) passage.reviewed = false
}
watch(() => metadata.grade, (grade, old) => {
  if (grade !== 1 && grade !== 2) return
  const previous = old === 1 || old === 2 ? ebsExamListUrl(old) : ''
  if (!metadata.sourceUrl || metadata.sourceUrl === previous) metadata.sourceUrl = ebsExamListUrl(grade)
  if (!metadata.explanationUrl || metadata.explanationUrl === previous) metadata.explanationUrl = ebsExamListUrl(grade)
})
function setMetadata(value: Partial<ExamImportMetadata>) {
  metadata.subject = value.subject
  metadata.grade = value.grade
  metadata.year = value.year
  metadata.month = value.month
  metadata.sourceUrl = value.sourceUrl || (value.grade ? ebsExamListUrl(value.grade) : '')
  metadata.explanationUrl = value.explanationUrl || (value.grade ? ebsExamListUrl(value.grade) : '')
  metadata.excludedNumbers = value.excludedNumbers ? [...value.excludedNumbers] : undefined
}
async function loadRecords() {
  if (!allowed.value || listLoading.value) return
  const ticket = ++listVersion
  listLoading.value = true
  listError.value = ''
  try {
    const result = await listImports()
    if (alive && allowed.value && ticket === listVersion) records.value = result
  } catch (cause) { if (alive && allowed.value && ticket === listVersion) listError.value = friendly(cause) }
  finally { if (ticket === listVersion) listLoading.value = false }
}
function chooseFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0] ?? null
  chosenFile.value = null
  error.value = ''
  if (!file) return
  if (!file.name.toLowerCase().endsWith('.pdf') || file.size > MAX_PDF_BYTES) {
    error.value = '20MB 이하의 PDF 문제지 파일을 선택해 주세요.'
    return
  }
  chosenFile.value = file
}
function resetEditor() {
  clearTitleSuggestions()
  clearPreviews()
  destroyDocument()
  questions.value = []
  passages.value = []
  activeRecord.value = null
  editingId.value = ''
  warnings.value = []
  dirty.value = false
  confirmClose.value = false
  deleteTarget.value = null
  error.value = ''
  notice.value = ''
}
function replacePreview(question: ImportQuestionDraft, image: RenderedPdfImage) {
  const old = previews.get(question.clientId)
  if (old) URL.revokeObjectURL(old.url)
  previews.set(question.clientId, { image, url: URL.createObjectURL(image.blob) })
  question.width = image.width
  question.height = image.height
}
function replacePassagePreviews(passage: ImportPassageDraft, images: RenderedPdfImage[]) {
  for (const [key, preview] of passagePreviews) if (key.startsWith(`${passage.clientId}:`)) {
    URL.revokeObjectURL(preview.url)
    passagePreviews.delete(key)
  }
  passage.imageSizes = images.map(image => ({ width: image.width, height: image.height }))
  images.forEach((image, index) => passagePreviews.set(passageImageKey(passage.clientId, index), { image, url: URL.createObjectURL(image.blob) }))
}
async function renderAll(ticket: number) {
  for (const [index, passage] of passages.value.entries()) {
    if (!current(ticket) || !document.value) return
    progress.value = `공통 지문을 준비하고 있어요 (${index + 1}/${passages.value.length})`
    const images: RenderedPdfImage[] = []
    for (const region of passage.regions) {
      images.push(await document.value.renderQuestion([region]))
      if (!current(ticket)) return
    }
    replacePassagePreviews(passage, images)
  }
  for (const [index, question] of questions.value.entries()) {
    if (!current(ticket) || !document.value) return
    progress.value = `문항 이미지를 준비하고 있어요 (${index + 1}/${questions.value.length})`
    const image = await document.value.renderQuestion(question.regions)
    if (!current(ticket)) return
    replacePreview(question, image)
  }
}
async function beginUpload() {
  if (!allowed.value || busy.value || dirty.value || !chosenFile.value) return
  const file = chosenFile.value
  const ticket = ++version
  busy.value = true
  resetEditor()
  try {
    progress.value = 'PDF 표지와 머리말을 읽고 있어요…'
    const pdf = await openExamPdf(file)
    if (!current(ticket)) { await pdf.destroy(); return }
    document.value = pdf
    const analysis = await pdf.analyze()
    if (!current(ticket)) return
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    if (!current(ticket)) return
    const sha256 = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('')
    progress.value = '원본 PDF를 관리자 전용 저장소에 올리고 있어요…'
    const record = await createImport(file, sha256, analysis.pageCount)
    if (!current(ticket)) return
    activeRecord.value = record
    setMetadata(analysis.metadata)
    warnings.value = analysis.warnings
    questions.value = analysis.questions.map(q => ({ ...q, reviewed: false, regions: q.regions.map(r => ({ ...r })) }))
    passages.value = (analysis.passages ?? []).map(p => ({ ...p, reviewed: false, regions: p.regions.map(r => ({ ...r })) }))
    dirty.value = true
    await renderAll(ticket)
    if (!current(ticket)) return
    notice.value = '자동으로 찾은 시험 정보와 문항 영역을 확인해 주세요. 수정한 내용은 초안 저장으로 보관할 수 있어요.'
    await loadRecords()
  } catch (cause) { if (current(ticket)) error.value = friendly(cause) }
  finally { if (current(ticket)) { busy.value = false; progress.value = '' } }
}
async function resume(record: ExamImportRecord) {
  if (!allowed.value || busy.value || dirty.value || record.status !== 'draft') return
  const ticket = ++version
  busy.value = true
  resetEditor()
  try {
    progress.value = '저장한 원본 PDF와 초안을 불러오고 있어요…'
    const latest = await getImport(record.id)
    if (!current(ticket)) return
    if (latest.status !== 'draft') throw new Error('이미 등록된 자료예요. 목록을 새로 불러와 주세요.')
    const blob = await downloadPdf(latest)
    if (!current(ticket)) return
    const pdf = await openExamPdf(new File([blob], latest.file_name, { type: 'application/pdf' }))
    if (!current(ticket)) { await pdf.destroy(); return }
    document.value = pdf
    activeRecord.value = latest
    if (latest.questions.length) {
      setMetadata(latest.metadata)
      questions.value = latest.questions.map(q => ({ ...q, regions: q.regions.map(r => ({ ...r })) }))
      passages.value = (latest.passages ?? []).map(p => ({ ...p, regions: p.regions.map(r => ({ ...r })) }))
    } else {
      const analysis = await pdf.analyze()
      if (!current(ticket)) return
      setMetadata({ ...analysis.metadata, ...latest.metadata })
      questions.value = analysis.questions
      passages.value = analysis.passages ?? []
      warnings.value = analysis.warnings
      dirty.value = true
    }
    await renderAll(ticket)
  } catch (cause) { if (current(ticket)) error.value = friendly(cause) }
  finally { if (current(ticket)) { busy.value = false; progress.value = '' } }
}
async function save() {
  if (!allowed.value || busy.value || editingId.value || !activeRecord.value) return
  const ticket = version
  busy.value = true
  error.value = ''; notice.value = ''; progress.value = '검수 초안을 저장하고 있어요…'
  try {
    const partial = Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined && value !== '')) as Partial<ExamImportMetadata>
    const record = await saveDraft(activeRecord.value.id, partial, questions.value, passages.value)
    if (!current(ticket)) return
    activeRecord.value = record
    dirty.value = false
    notice.value = '초안을 저장했어요. 나중에 이어서 검수할 수 있어요.'
    await loadRecords()
  } catch (cause) { if (current(ticket)) error.value = friendly(cause) }
  finally { if (current(ticket)) { busy.value = false; progress.value = '' } }
}
async function publish() {
  if (!canPublish.value || !activeRecord.value || !completeMetadata.value) return
  const ticket = version
  const info = { ...completeMetadata.value }
  busy.value = true; publishing.value = true
  error.value = ''; notice.value = ''; progress.value = '확인한 문제를 서재에 등록하고 있어요…'
  try {
    const images = new Map([...previews].map(([key, value]) => [key, value.image]))
    const sharedImages = new Map([...passagePreviews].map(([key, value]) => [key, value.image]))
    const result = await publishImport(activeRecord.value.id, info, questions.value, images, passages.value, sharedImages)
    if (!current(ticket)) return
    dirty.value = false
    emit('published', { count: result.count, subject: info.subject })
    publishing.value = false
    closeNow()
  } catch (cause) { if (current(ticket)) error.value = friendly(cause) }
  finally { if (current(ticket)) { publishing.value = false; busy.value = false; progress.value = '' } }
}
async function removeDraft() {
  if (!allowed.value || busy.value || !deleteTarget.value) return
  const ticket = version
  const target = deleteTarget.value
  busy.value = true; error.value = ''; progress.value = '미등록 초안을 삭제하고 있어요…'
  try {
    const message = await deleteDraft(target.id)
    if (!current(ticket)) return
    if (activeRecord.value?.id === target.id) resetEditor()
    deleteTarget.value = null
    notice.value = message
    await loadRecords()
  } catch (cause) { if (current(ticket)) error.value = friendly(cause) }
  finally { if (current(ticket)) { busy.value = false; progress.value = '' } }
}
function setTags(question: ImportQuestionDraft, event: Event) {
  const value = (event.target as HTMLInputElement).value
  question.tags = [...new Set(value.split(/[,，#\n]+/).map(t => t.trim()).filter(Boolean))].slice(0, 20)
  markChanged(question)
}
function toggleTag(question: ImportQuestionDraft, tag: string) {
  if (!question.tags.includes(tag) && question.tags.length >= 20) return
  question.tags = question.tags.includes(tag) ? question.tags.filter(t => t !== tag) : [...question.tags, tag]
  markChanged(question)
}
async function addQuestion() {
  if (!document.value || busy.value || questions.value.length >= 100) return
  const question: ImportQuestionDraft = { clientId: crypto.randomUUID(), number: Math.min(100, Math.max(0, ...questions.value.map(q => q.number)) + 1), title: '', tags: [], points: 2, searchText: '', regions: [{ page: 1, left: .06, top: .06, right: .94, bottom: .92 }], reviewed: false, responseType: 'multiple_choice' }
  questions.value.push(question)
  markChanged(question)
  await editRegions(question)
}
function removeQuestion(question: ImportQuestionDraft) {
  if (busy.value) return
  const preview = previews.get(question.clientId)
  if (preview) URL.revokeObjectURL(preview.url)
  previews.delete(question.clientId)
  questions.value = questions.value.filter(q => q.clientId !== question.clientId)
  if (editingKind.value === 'question' && editingId.value === question.clientId) { editingId.value = ''; clearPagePreview() }
  markChanged()
}
async function addPassage() {
  if (!document.value || busy.value || passages.value.length >= 100) return
  const passage: ImportPassageDraft = { clientId: crypto.randomUUID(), title: '', searchText: '', regions: [{ page: 1, left: .06, top: .06, right: .48, bottom: .6 }], reviewed: false }
  passages.value.push(passage)
  passageChanged(passage)
  await editPassage(passage)
}
function removePassage(passage: ImportPassageDraft) {
  if (busy.value) return
  for (const question of questions.value) if (question.passageClientId === passage.clientId) {
    delete question.passageClientId
    markChanged(question)
  }
  for (const [key, preview] of passagePreviews) if (key.startsWith(`${passage.clientId}:`)) {
    URL.revokeObjectURL(preview.url)
    passagePreviews.delete(key)
  }
  passages.value = passages.value.filter(p => p.clientId !== passage.clientId)
  if (editingKind.value === 'passage' && editingId.value === passage.clientId) { editingId.value = ''; clearPagePreview() }
  markChanged()
}
async function editRegions(question: ImportQuestionDraft) {
  if (busy.value) return
  editingKind.value = 'question'
  editingId.value = question.clientId
  editingRegions.value = question.regions.map(r => ({ ...r }))
  editingIndex.value = 0
  await showRegion(0)
  await revealEditor()
}
async function editPassage(passage: ImportPassageDraft) {
  if (busy.value) return
  editingKind.value = 'passage'
  editingId.value = passage.clientId
  editingRegions.value = passage.regions.map(r => ({ ...r }))
  editingIndex.value = 0
  await showRegion(0)
  await revealEditor()
}
async function revealEditor() {
  await nextTick()
  if (alive && allowed.value) editorElement.value?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
}
async function finishRegionEdit() {
  const id = editingId.value, kind = editingKind.value
  editingId.value = ''
  clearPagePreview()
  await nextTick()
  if (alive && allowed.value) dialog.value?.querySelector<HTMLElement>(`[data-${kind}="${id}"]`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
}
async function showRegion(index: number) {
  editingIndex.value = index
  clearPagePreview()
  const pdf = document.value
  const region = editingRegions.value[index]
  if (!pdf || !region || region.page < 1 || region.page > pdf.pageCount) return
  const ticket = pageVersion
  try {
    const image = await pdf.renderPage(region.page)
    if (!alive || !allowed.value || ticket !== pageVersion) return
    pagePreview.value = { url: URL.createObjectURL(image.blob), page: region.page }
  } catch (cause) { if (alive && ticket === pageVersion) error.value = friendly(cause) }
}
function coordinate(region: PdfRegion, key: 'left' | 'top' | 'right' | 'bottom', event: Event) {
  region[key] = Math.max(0, Math.min(1, Number((event.target as HTMLInputElement).value) / 100))
}
function addRegion() {
  if (editingRegions.value.length >= 12) return
  editingRegions.value.push({ page: editedRegion.value?.page ?? 1, left: .06, top: .06, right: .94, bottom: .45 })
  void showRegion(editingRegions.value.length - 1)
}
function removeRegion(index: number) {
  if (editingRegions.value.length <= 1) return
  editingRegions.value.splice(index, 1)
  void showRegion(Math.min(editingIndex.value, editingRegions.value.length - 1))
}
function moveRegion(offset: number) {
  const from = editingIndex.value, to = from + offset
  if (to < 0 || to >= editingRegions.value.length) return
  const region = editingRegions.value.splice(from, 1)[0]!
  editingRegions.value.splice(to, 0, region)
  void showRegion(to)
}
function point(event: PointerEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }
}
function startSelection(event: PointerEvent) {
  if (!editedRegion.value || !pagePreview.value || (event.pointerType === 'mouse' && event.button !== 0)) return
  event.preventDefault()
  dragStart.value = point(event)
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
}
function moveSelection(event: PointerEvent) {
  if (!dragStart.value || !editedRegion.value) return
  const end = point(event), start = dragStart.value
  editedRegion.value.left = Math.min(start.x, end.x); editedRegion.value.right = Math.max(start.x, end.x)
  editedRegion.value.top = Math.min(start.y, end.y); editedRegion.value.bottom = Math.max(start.y, end.y)
}
function endSelection(event: PointerEvent) { moveSelection(event); dragStart.value = null }
async function applyRegions() {
  if (!document.value || busy.value) return
  const question = editingKind.value === 'question' ? questions.value.find(q => q.clientId === editingId.value) : undefined
  const passage = editingKind.value === 'passage' ? passages.value.find(p => p.clientId === editingId.value) : undefined
  if (!question && !passage) return
  if (!editingRegions.value.every(validRegion)) { error.value = '페이지와 영역의 시작·끝 위치를 확인해 주세요. 너비와 높이가 있는 영역이어야 해요.'; return }
  const ticket = version
  busy.value = true; error.value = ''; progress.value = '문항 미리보기를 갱신하고 있어요…'
  try {
    const regions = editingRegions.value.map(r => ({ ...r }))
    const images: RenderedPdfImage[] = []
    if (passage) {
      for (const region of regions) {
        images.push(await document.value.renderQuestion([region]))
        if (!current(ticket)) return
      }
    } else {
      images.push(await document.value.renderQuestion(regions))
      if (!current(ticket)) return
    }
    const text = await document.value.regionText(regions)
    if (!current(ticket)) return
    if (passage) {
      passage.regions = regions
      passage.searchText = text
      replacePassagePreviews(passage, images)
      passageChanged(passage)
    } else if (question) {
      question.regions = regions
      question.searchText = text
      replacePreview(question, images[0]!)
      markChanged(question)
    }
    await finishRegionEdit()
  } catch (cause) { if (current(ticket)) error.value = friendly(cause) }
  finally { if (current(ticket)) { busy.value = false; progress.value = '' } }
}
function readableDate(value: string) { return new Date(value).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) }
watch(allowed, value => { if (!value) { publishing.value = false; closeNow() } })
onMounted(() => { dialog.value?.showModal(); if (allowed.value) void loadRecords() })
onBeforeUnmount(() => { alive = false; ++version; ++listVersion; clearPreviews(); destroyDocument(); if (dialog.value?.open) dialog.value.close() })
</script>

<template>
  <dialog ref="dialog" class="exam-import-dialog" aria-labelledby="exam-import-title" @cancel.prevent="requestClose">
    <header class="import-dialog-heading">
      <div><span class="account-eyebrow">SCHOOL EXAM LIBRARY</span><h2 id="exam-import-title">PDF 문제 등록</h2><p>문제지를 올리고 시험 정보·공통 지문·문항·태그를 확인한 뒤 등록하세요.</p></div>
      <button class="import-icon-button" aria-label="문제 등록 창 닫기" :disabled="publishing" @click="requestClose"><X :size="24" /></button>
    </header>
    <div v-if="!allowed" class="import-message is-error" role="alert">관리자만 PDF 문제를 등록할 수 있어요.</div>
    <div v-else class="import-dialog-content">
      <section class="import-upload" aria-labelledby="import-upload-title">
        <h3 id="import-upload-title">1. 문제지 PDF 선택</h3>
        <p>문제지만 올려도 분류할 수 있어요. 해설지는 필수가 아니며 정답·해설은 EBS 링크로 연결합니다. 최대 20MB·40쪽까지 읽을 수 있어요.</p>
        <p class="import-small">원본과 검수 초안은 관리자만 볼 수 있어요. 자동 태그는 키워드 추천이므로 등록 전 확인해 주세요.</p>
        <div class="import-file-row"><label class="import-file-field"><span class="sr-only">문제지 PDF 파일</span><input type="file" accept="application/pdf,.pdf" :disabled="busy || dirty" @change="chooseFile"></label><button class="import-primary" :disabled="busy || dirty || !chosenFile" @click="beginUpload"><FileUp :size="19" /> PDF 분석·업로드</button></div>
        <p v-if="dirty" class="import-small">수정 중인 초안을 저장한 뒤 다른 파일을 선택할 수 있어요.</p>
      </section>
      <p v-if="progress" class="import-message" role="status">{{ progress }}</p><p v-if="error" class="import-message is-error" role="alert">{{ error }}</p><p v-if="notice" class="import-message is-success" role="status">{{ notice }}</p>
      <section v-if="confirmClose" class="import-confirm" aria-labelledby="import-close-title"><h3 id="import-close-title">저장하지 않은 수정 내용이 있어요</h3><p>창을 닫으면 마지막으로 저장한 초안에서 다시 시작합니다.</p><div class="import-actions"><button class="import-secondary" @click="confirmClose = false">계속 검수하기</button><button class="import-danger" @click="closeNow">저장하지 않고 닫기</button></div></section>
      <section v-if="deleteTarget" class="import-confirm" aria-labelledby="import-delete-title"><h3 id="import-delete-title">이 미등록 초안을 삭제할까요?</h3><p>{{ deleteTarget.file_name }}의 원본 PDF와 초안을 삭제합니다.</p><div class="import-actions"><button class="import-secondary" :disabled="busy" @click="deleteTarget = null">취소</button><button class="import-danger" :disabled="busy" @click="removeDraft">초안 삭제하기</button></div></section>
      <details class="import-draft-list" :open="!activeRecord">
        <summary>저장된 업로드 · {{ records.length }}개</summary><div class="import-list-heading"><p>미등록 초안은 이어서 검수할 수 있어요.</p><button class="import-secondary" :disabled="busy || listLoading" @click="loadRecords"><RefreshCw :size="17" /> 목록 새로고침</button></div>
        <p v-if="listLoading" role="status">목록을 불러오고 있어요…</p><p v-if="listError" class="import-message is-error" role="alert">{{ listError }}</p>
        <ul v-if="records.length" class="import-records"><li v-for="record in records" :key="record.id"><div><strong>{{ record.file_name }}</strong><span>{{ readableDate(record.created_at) }} · {{ record.page_count }}쪽 · {{ record.status === 'published' ? '등록 완료' : '검수 초안' }}</span></div><div v-if="record.status === 'draft'" class="import-actions"><button class="import-secondary" :disabled="busy || dirty" @click="resume(record)">이어서 검수</button><button class="import-text-danger" :disabled="busy || dirty" @click="deleteTarget = record"><Trash2 :size="17" /> 초안 삭제</button></div></li></ul><p v-else-if="!listLoading" class="import-small">저장된 업로드가 아직 없어요.</p>
      </details>
      <template v-if="activeRecord && document">
        <section class="import-metadata" aria-labelledby="import-metadata-title">
          <h3 id="import-metadata-title">2. 시험 정보 확인</h3><p class="import-small">{{ activeRecord.file_name }} · {{ document.pageCount }}쪽. 자동으로 찾지 못한 정보는 직접 선택해 주세요.</p>
          <div class="import-metadata-grid">
            <label>과목<select v-model="metadata.subject" :disabled="busy" @change="metadataChanged"><option :value="undefined">과목 선택</option><option v-for="s in subjects" :key="s.name" :value="s.name">{{ s.name }}</option></select></label>
            <label>학년<select v-model.number="metadata.grade" :disabled="busy" @change="metadataChanged"><option :value="undefined">학년 선택</option><option :value="1">고1</option><option :value="2">고2</option></select></label>
            <label>시행 연도<input v-model.number="metadata.year" type="number" min="2025" max="2100" placeholder="예: 2025" :disabled="busy" @input="metadataChanged"></label>
            <label>시행월<select v-model.number="metadata.month" :disabled="busy" @change="metadataChanged"><option :value="undefined">시행월 선택</option><option v-for="m in [3,6,9,10]" :key="m" :value="m">{{ m }}월</option></select></label>
            <label class="import-wide-field">자료 출처 링크<input v-model="metadata.sourceUrl" type="url" placeholder="https://www.ebsi.co.kr/…" :disabled="busy" @input="metadataChanged"></label>
            <label class="import-wide-field">정답·해설 링크<input v-model="metadata.explanationUrl" type="url" placeholder="https://www.ebsi.co.kr/…" :disabled="busy" @input="metadataChanged"></label>
          </div>
          <p class="import-small">EBS 공식 링크를 입력해 주세요. 회차별 링크를 모르면 학년별 기출문제 목록으로 연결할 수 있어요.</p>
          <p v-if="excludedNumbersText" class="import-message import-excluded-note">{{ metadata.subject === '영어' ? '듣기 ' : '' }}{{ excludedNumbersText }} 제외 · 등록 대상 {{ questions.length }}문항. 원래 문항 번호를 유지합니다.</p>
          <div v-if="warnings.length" class="import-warnings"><strong>검수할 때 확인해 주세요</strong><ul><li v-for="warning in warnings" :key="warning">{{ warning }}</li></ul></div>
        </section>
        <section class="import-passage-review" aria-labelledby="import-passage-title">
          <div class="import-section-heading"><div><h3 id="import-passage-title">3. 공통 지문 연결</h3><p>확인 {{ reviewedPassageCount }}/{{ passages.length }}개 · 여러 문항이 공유하는 지문은 한 번만 지정해 주세요.</p></div><button class="import-secondary" :disabled="busy || passages.length >= 100" @click="addPassage"><Plus :size="18" /> 공통 지문 직접 추가</button></div>
          <p class="import-small">공통 지문은 연결된 문항과 함께 보입니다. 영어의 빈칸·순서·삽입처럼 안내만 같은 문항은 묶지 않고, 각 문항의 ‘풀이 안내’에 넣어 주세요.</p>
          <p v-if="!passages.length" class="import-small">공통 지문이 없는 시험은 바로 문항 검수로 진행하면 돼요.</p>
          <article v-for="passage in passages" :key="passage.clientId" class="import-passage-card" :data-passage="passage.clientId">
            <label class="import-tags-field">공통 지문 제목<input v-model="passage.title" maxlength="200" placeholder="예: 22~25번 · 이문구 「암소」" :disabled="busy" @input="passageChanged(passage)"></label>
            <p class="import-passage-linked">연결 문항: {{ linkedNumbers(passage).length ? linkedNumbers(passage).map(n => `${n}번`).join(', ') : '아직 없어요. 아래 문항에서 이 지문을 선택해 주세요.' }}</p>
            <div class="import-passage-previews"><figure v-for="(region,index) in passage.regions" :key="index"><img v-if="passagePreviews.get(passageImageKey(passage.clientId,index))" class="import-question-preview import-passage-preview" :src="passagePreviews.get(passageImageKey(passage.clientId,index))!.url" :alt="`${passage.title || '공통 지문'} ${index + 1}번째 영역`"><figcaption class="import-small">영역 {{ index + 1 }} · PDF {{ region.page }}쪽</figcaption></figure></div>
            <div class="import-question-toolbar"><button class="import-secondary" :disabled="busy" @click="editPassage(passage)"><Scissors :size="17" /> 지문 영역 조정</button><button class="import-text-danger" :disabled="busy" @click="removePassage(passage)"><Trash2 :size="17" /> 공통 지문 삭제</button></div>
            <details class="import-search-text"><summary>검색용 지문 내용 수정</summary><label><span class="sr-only">{{ passage.title || '공통 지문' }} 검색용 내용</span><textarea v-model="passage.searchText" rows="4" maxlength="30000" :disabled="busy" @input="passageChanged(passage)"></textarea></label></details>
            <label class="import-reviewed import-passage-reviewed"><input v-model="passage.reviewed" type="checkbox" :disabled="busy || !passage.regions.length || !passage.regions.every((_,index) => passagePreviews.has(passageImageKey(passage.clientId,index)))" @change="dirty = true"><span><Check :size="19" /> 지문 전체와 이어지는 순서를 확인했어요</span></label>
          </article>
        </section>
        <section class="import-question-review" aria-labelledby="import-review-title">
          <div class="import-section-heading"><div><h3 id="import-review-title">4. 문항·태그 검수</h3><p>확인 {{ reviewedCount }}/{{ questions.length }}문항 · 문항별 그림·보기·선택지와 공통 지문 연결을 확인해 주세요.</p></div><div class="import-actions"><button class="import-secondary" :disabled="busy || !questions.length" @click="recommendAllTitles">제목 일괄 추천</button><button class="import-secondary" :disabled="busy || questions.length >= 100" @click="addQuestion"><Plus :size="18" /> 문항 직접 추가</button></div></div>
          <p class="import-small">추천 태그는 문제 내용의 키워드로 제안한 초안입니다. 추가·수정한 뒤 문항별 확인을 눌러 주세요. 단답형 문항은 선택지가 없어도 정상입니다.</p>
          <p class="import-small">제목은 문제의 개념·주제·출제 내용을 짧게 요약해 추천합니다. 직접 쓴 제목은 자동으로 바꾸지 않으며, 추천 내용을 확인한 뒤 적용할 수 있어요.</p>
          <section v-if="titleCandidates" class="import-title-bulk" aria-labelledby="import-title-bulk-heading">
            <h4 id="import-title-bulk-heading">추천 제목 확인</h4><p class="import-small">깨진 문자가 있거나 빈 제목만 먼저 선택했어요. 바꿀 제목을 직접 선택해 주세요. 적용하면 변경한 문항의 검수 확인이 해제됩니다.</p>
            <div class="import-actions"><button class="import-secondary" :disabled="busy" @click="selectTitleCandidates(true)">모두 선택</button><button class="import-secondary" :disabled="busy" @click="selectTitleCandidates(false)">모두 해제</button></div>
            <ul class="import-title-candidate-list"><li v-for="candidate in titleCandidates" :key="candidate.questionId" class="import-title-candidate">
              <label><input v-model="candidate.selected" type="checkbox" :disabled="busy || !currentTitleCandidate(candidate)"><span>{{ questions.find(question => question.clientId === candidate.questionId)?.number }}번 제목 바꾸기</span></label>
              <p class="import-title-previous">현재: {{ candidate.previous || '제목 없음' }}</p><p class="import-title-proposed">추천: {{ candidate.title }}</p><p v-if="!currentTitleCandidate(candidate)" class="import-small">문항 내용이나 제목이 바뀌었어요. 다시 추천해 주세요.</p>
            </li></ul>
            <p v-if="!titleCandidates.length" class="import-small">현재 제목과 추천 제목이 모두 같아요.</p>
            <div class="import-actions"><button class="import-secondary" :disabled="busy" @click="titleCandidates = null">제목 추천 닫기</button><button class="import-primary" :disabled="busy || !selectedTitleCount" @click="applySelectedTitles">선택한 제목 {{ selectedTitleCount }}개 적용</button></div>
          </section>
          <p v-if="!questions.length" class="import-message">문항 경계를 자동으로 찾지 못했어요. ‘문항 직접 추가’에서 페이지와 영역을 지정할 수 있어요.</p>
          <article v-for="question in questions" :key="question.clientId" class="import-question-card" :data-question="question.clientId">
            <div class="import-question-fields"><label>문항 번호<input v-model.number="question.number" type="number" min="1" max="100" :disabled="busy" @input="markChanged(question)"></label><label class="import-question-title-field">제목<input v-model="question.title" maxlength="200" placeholder="문제의 주제나 개념을 입력해 주세요" :disabled="busy" @input="markChanged(question)"></label><label>배점<input v-model.number="question.points" type="number" min="1" max="10" :disabled="busy" @input="markChanged(question)"></label></div>
            <div class="import-title-tools"><button class="import-secondary" :disabled="busy" @click="recommendTitle(question)">제목 추천</button><div v-if="titleSuggestions[question.clientId]" class="import-title-suggestion"><p><strong>추천 제목</strong> {{ titleSuggestions[question.clientId]!.title }}</p><p v-if="!currentTitleCandidate(titleSuggestions[question.clientId]!)" class="import-small">문항 내용이 바뀌었어요. 다시 추천해 주세요.</p><div class="import-actions"><button class="import-secondary" :disabled="busy" @click="delete titleSuggestions[question.clientId]">추천 닫기</button><button class="import-primary" :disabled="busy || !currentTitleCandidate(titleSuggestions[question.clientId]!)" @click="applyTitle(titleSuggestions[question.clientId]!)">추천 제목 적용</button></div></div></div>
            <div class="import-question-connections">
              <label>응답 형식<select :value="question.responseType || 'multiple_choice'" :disabled="busy" @change="question.responseType = ($event.target as HTMLSelectElement).value as 'multiple_choice' | 'short_answer'; markChanged(question)"><option value="multiple_choice">선택형</option><option value="short_answer">단답형</option></select></label>
              <label>연결할 공통 지문<select class="import-passage-select" :value="question.passageClientId || ''" :disabled="busy" @change="linkPassage(question,$event)"><option value="">공통 지문 없음</option><option v-for="passage in passages" :key="passage.clientId" :value="passage.clientId">{{ passage.title || '제목 없는 공통 지문' }}</option></select></label>
            </div>
            <p v-if="question.passageClientId && passageMap.has(question.passageClientId)" class="import-linked-passage"><span>공통 지문: {{ passageMap.get(question.passageClientId)!.title || '제목 없음' }}</span><button class="import-secondary" :disabled="busy" @click="jumpToPassage(question.passageClientId)">연결된 지문 보기</button></p>
            <p v-if="question.instruction" class="import-question-instruction">{{ question.instruction }}</p>
            <img v-if="previews.get(question.clientId)" class="import-question-preview" :src="previews.get(question.clientId)!.url" :alt="`${question.number}번 문항 검수 이미지`"><p v-else class="import-small">문항 영역을 지정하고 미리보기를 갱신해 주세요.</p>
            <div class="import-question-toolbar"><button class="import-secondary" :disabled="busy" @click="editRegions(question)"><Scissors :size="17" /> 영역 조정</button><button class="import-text-danger" :disabled="busy" @click="removeQuestion(question)"><Trash2 :size="17" /> 문항 제외</button></div>
            <label class="import-tags-field">풀이 안내 <span class="import-small">여러 번호가 공유하는 풀이 지시가 있으면 여기에 적어 주세요.</span><textarea v-model="question.instruction" class="import-instruction-field" rows="2" maxlength="2000" :disabled="busy" @input="markChanged(question)"></textarea></label>
            <label class="import-tags-field">태그<input :value="question.tags.join(', ')" maxlength="800" placeholder="예: 현대사, 정치사, 6·25 전쟁" :disabled="busy" @change="setTags(question, $event)"></label>
            <div v-if="selectedSubject" class="import-suggested-tags"><button v-for="tag in selectedSubject.tags" :key="tag" :class="{ selected: question.tags.includes(tag) }" :aria-pressed="question.tags.includes(tag)" :disabled="busy" @click="toggleTag(question, tag)">#{{ tag }}</button></div>
            <details class="import-search-text"><summary>검색용 문제 내용 수정</summary><label><span class="sr-only">{{ question.number }}번 검색용 문제 내용</span><textarea v-model="question.searchText" rows="4" maxlength="30000" :disabled="busy" @input="markChanged(question)"></textarea></label></details>
            <label class="import-reviewed"><input v-model="question.reviewed" type="checkbox" :disabled="busy || !previews.has(question.clientId)" @change="dirty = true"><span><Check :size="19" /> {{ question.number }}번 이미지·태그·공통 지문 연결을 확인했어요</span></label>
          </article>
        </section>
        <section v-if="editingId" ref="editorElement" class="import-region-editor" :aria-label="`${editingLabel} 영역 조정`">
          <div class="import-section-heading"><h4>{{ editingLabel }}에 포함할 영역</h4><button class="import-secondary" :disabled="busy || editingRegions.length >= 12" @click="addRegion"><Plus :size="16" /> {{ editingKind === 'passage' ? '이어지는 지문 영역 추가' : '문항 영역 추가' }}</button></div>
          <p class="import-small">페이지 위에서 드래그하거나 위치(%)를 입력하세요. {{ editingKind === 'passage' ? '지문은 아래 순서대로 보여줍니다. 왼쪽 단·오른쪽 단·다음 쪽의 순서를 확인해 주세요.' : '문항만 지정하세요. 여러 문제의 공통 지문은 위의 공통 지문 연결에서 따로 지정합니다.' }}</p>
          <div class="import-region-tabs"><button v-for="(region,index) in editingRegions" :key="index" :class="{ selected: editingIndex === index }" :disabled="busy" @click="showRegion(index)">영역 {{ index + 1 }} · {{ region.page }}쪽</button></div>
          <div class="import-actions"><button class="import-secondary" :disabled="busy || editingIndex === 0" @click="moveRegion(-1)">영역 앞으로 이동</button><button class="import-secondary" :disabled="busy || editingIndex === editingRegions.length - 1" @click="moveRegion(1)">영역 뒤로 이동</button></div>
          <div v-if="editedRegion" class="import-region-fields"><label>페이지<select v-model.number="editedRegion.page" :disabled="busy" @change="showRegion(editingIndex)"><option v-for="n in document.pageCount" :key="n" :value="n">{{ n }}쪽</option></select></label><label v-for="item in ([['left','왼쪽'],['top','위쪽'],['right','오른쪽'],['bottom','아래쪽']] as const)" :key="item[0]">{{ item[1] }} (%)<input type="number" min="0" max="100" step="0.1" :value="Math.round(editedRegion[item[0]] * 1000) / 10" :disabled="busy" @input="coordinate(editedRegion,item[0],$event)"></label><button class="import-text-danger" :disabled="busy || editingRegions.length === 1" @click="removeRegion(editingIndex)">이 영역 삭제</button></div>
          <div v-if="pagePreview" class="import-page-selector" @pointerdown="startSelection" @pointermove="moveSelection" @pointerup="endSelection" @pointercancel="dragStart = null"><img :src="pagePreview.url" :alt="`${pagePreview.page}쪽 원본 페이지, 드래그하여 영역 선택`" draggable="false"><span class="import-crop-overlay" :style="regionStyle"></span></div><p v-else class="import-small" role="status">원본 페이지를 준비하고 있어요…</p>
          <div class="import-actions"><button class="import-secondary" :disabled="busy" @click="finishRegionEdit">영역 수정 취소</button><button class="import-primary" :disabled="busy" @click="applyRegions">영역 적용·미리보기 갱신</button></div>
        </section>
        <footer class="import-publish-bar"><div><strong>확인 {{ reviewedCount }}/{{ questions.length }}문항 · 공통 지문 {{ reviewedPassageCount }}/{{ passages.length }}개</strong><p>{{ editingId ? '영역 수정을 적용하거나 취소한 뒤 저장·등록해 주세요.' : !completeMetadata ? '시험 정보와 EBS 링크를 모두 확인해 주세요.' : !passagesValid ? '공통 지문의 제목·영역·연결 문항을 확인해 주세요. 연결하지 않은 지문은 삭제하거나 문항에 연결해 주세요.' : reviewedPassageCount !== passages.length ? '공통 지문 전체와 이어지는 순서 확인을 마쳐 주세요.' : !questionsValid ? '문항 번호·제목·태그·영역·지문 연결을 확인해 주세요.' : reviewedCount !== questions.length ? '모든 문항의 이미지와 태그 확인을 마치면 등록할 수 있어요.' : '확인한 문항을 학교 서재에 등록할 수 있어요.' }}</p></div><div class="import-actions"><button class="import-secondary" :disabled="busy || !!editingId" @click="save"><Save :size="18" /> 초안 저장</button><button class="import-primary" :disabled="!canPublish" @click="publish">{{ publishing ? '등록 중…' : '확인한 문제 등록' }}</button></div></footer>
      </template>
    </div>
  </dialog>
</template>
