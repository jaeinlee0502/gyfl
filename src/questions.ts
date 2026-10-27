import { ref } from 'vue'
import { subjects, type ExamPassage, type Question, type Subject } from './data'
import { supabase } from './lib/supabase'
import { normalizeQuestionTags, QuestionTagsConflictError } from './tag-editing'

interface ExamRecord {
  id: string; subject: string; grade: number; year: number; month: number;
  number: number; title: string; tags: string[]; image_path: string;
  width: number; height: number; points: number; source_url: string;
  explanation_url: string; source_page: number; curriculum_status: string; search_text: string;
  passage_id?: string | null; instruction?: string; response_type?: string;
}

interface PassageRecord {
  id: string; title: string; search_text: string;
  images: Array<{ path: string; width: number; height: number; page: number }>;
}

function validPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 600
    && /^[A-Za-z0-9][A-Za-z0-9/_\-.]*$/.test(value)
    && !value.split('/').some(part => part === '..' || part === '.' || !part)
}

function validSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 10000
}

function validPassage(passage: PassageRecord) {
  return typeof passage.id === 'string' && passage.id.length > 0 && passage.id.length <= 200
    && typeof passage.title === 'string' && passage.title.trim().length > 0 && passage.title.length <= 200
    && typeof passage.search_text === 'string' && passage.search_text.length <= 30000
    && Array.isArray(passage.images) && passage.images.length > 0 && passage.images.length <= 12
    && new Set(passage.images.map(image => image?.path)).size === passage.images.length
    && passage.images.every(image => image && validPath(image.path) && validSize(image.width) && validSize(image.height)
      && Number.isInteger(image.page) && image.page >= 1 && image.page <= 40)
}

function officialLink(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'www.ebsi.co.kr' ? url.href : ''
  } catch { return '' }
}

function validRecord(q: ExamRecord) {
  return subjects.some(s => s.name === q.subject) && [1, 2].includes(q.grade)
    && [3, 6, 9, 10].includes(q.month) && Array.isArray(q.tags)
    && q.tags.every(t => typeof t === 'string') && validPath(q.image_path)
    && validSize(q.width) && validSize(q.height)
    && (q.passage_id == null || (typeof q.passage_id === 'string' && q.passage_id.length > 0 && q.passage_id.length <= 200))
    && (q.instruction === undefined || (typeof q.instruction === 'string' && q.instruction.length <= 2000))
    && (q.response_type === undefined || q.response_type === 'multiple_choice' || q.response_type === 'short_answer')
}

// Exam text and images live in RLS-protected Supabase tables/private storage.
// Blob URLs keep the image requests authenticated and are revoked on exit.
export function useQuestionLibrary() {
  const questionItems = ref<Question[]>([])
  const loading = ref(false)
  const error = ref('')
  let version = 0
  let imageUrls: string[] = []
  const imageTargets = new Map<string, Set<{ imageUrl?: string }>>()
  const imageCache = new Map<string, Promise<string>>()
  const imageQueue: Array<{ path: string; ticket: number; promise: Promise<string>; resolve: (url: string) => void; reject: (reason: Error) => void }> = []
  let activeImages = 0
  let imageController = new AbortController()

  function release(urls: string[]) { for (const url of urls) URL.revokeObjectURL(url) }
  function clearQuestions() {
    ++version
    imageController.abort()
    imageController = new AbortController()
    for (const task of imageQueue.splice(0)) task.reject(new Error('문제 목록이 바뀌었어요.'))
    imageCache.clear()
    imageTargets.clear()
    release(imageUrls)
    imageUrls = []
    questionItems.value = []
    loading.value = false
    error.value = ''
  }

  function pumpImages() {
    while (activeImages < 4 && imageQueue.length) {
      const task = imageQueue.shift()!
      if (task.ticket !== version || !supabase) { task.reject(new Error('문제 목록이 바뀌었어요.')); continue }
      activeImages++
      void (async () => {
        try {
          const { data, error: imageError } = await supabase!.storage.from('school-questions')
            .download(task.path, { cacheNonce: crypto.randomUUID() }, { cache: 'no-store', signal: imageController.signal })
          if (task.ticket !== version) throw new Error('문제 목록이 바뀌었어요.')
          if (imageError || !data) throw new Error('이미지를 불러오지 못했어요. 다시 시도해 주세요.')
          const url = URL.createObjectURL(data)
          imageUrls.push(url)
          for (const target of imageTargets.get(task.path) ?? []) target.imageUrl = url
          task.resolve(url)
        } catch (cause) {
          if (imageCache.get(task.path) === task.promise) imageCache.delete(task.path)
          task.reject(cause instanceof Error ? cause : new Error('이미지를 불러오지 못했어요.'))
        } finally { activeImages--; pumpImages() }
      })()
    }
  }

  function loadImage(path: string): Promise<string> {
    if (!validPath(path) || !imageTargets.has(path)) return Promise.reject(new Error('이미지 경로를 확인하지 못했어요. 문제 목록을 다시 불러와 주세요.'))
    const cached = imageCache.get(path)
    if (cached) return cached
    let resolve!: (url: string) => void
    let reject!: (reason: Error) => void
    const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no })
    imageCache.set(path, promise)
    imageQueue.push({ path, ticket: version, promise, resolve, reject })
    pumpImages()
    return promise
  }

  async function loadQuestions(subject: Subject = '한국사') {
    clearQuestions()
    const current = version
    const client = supabase
    if (!client) { error.value = '서재 연결을 준비 중이에요. 관리자에게 문의해 주세요.'; return }
    loading.value = true
    try {
      // Recheck server-side access on every load, including browser retries.
      const access = await client.rpc('has_school_access')
      if (current !== version) return
      if (access.error || access.data !== true) throw new Error('access')
      const records: ExamRecord[] = []
      const pageSize = 200
      for (let offset = 0; ; offset += pageSize) {
        const { data, error: queryError } = await client.from('exam_questions')
          .select('id,subject,grade,year,month,number,title,tags,image_path,width,height,points,source_url,explanation_url,source_page,curriculum_status,search_text,passage_id,instruction,response_type')
          .eq('subject', subject)
          .order('year', { ascending: false }).order('month', { ascending: false })
          .order('id', { ascending: true }).range(offset, offset + pageSize - 1)
        if (current !== version) return
        if (queryError) throw queryError
        records.push(...(data ?? []) as ExamRecord[])
        if (!data || data.length < pageSize) break
      }
      if (!records.every(q => validRecord(q) && q.subject === subject)) throw new Error('invalid exam record')
      const stale = Symbol('stale question library')
      const passageIds = [...new Set(records.flatMap(record => record.passage_id ? [record.passage_id] : []))]
      const passageRecords: PassageRecord[] = []
      for (let offset = 0; offset < passageIds.length; offset += 100) {
        const ids = passageIds.slice(offset, offset + 100)
        const { data, error: passageError } = await client.from('exam_passages')
          .select('id,title,search_text,images').in('id', ids)
        if (current !== version) throw stale
        if (passageError || !Array.isArray(data) || data.some(passage => !ids.includes(passage.id))) throw new Error('missing common passage')
        passageRecords.push(...data as PassageRecord[])
      }
      if (passageRecords.length !== passageIds.length || new Set(passageRecords.map(passage => passage.id)).size !== passageIds.length
        || !passageRecords.every(validPassage)) throw new Error('invalid common passage')
      const passages = new Map<string, ExamPassage>()
      for (const passage of passageRecords) {
        const images = passage.images.map(image => ({ imageUrl: '', imagePath: image.path, width: image.width, height: image.height, page: image.page }))
        passages.set(passage.id, { id: passage.id, title: passage.title, text: passage.search_text, images })
      }
      const items: Question[] = records.map(q => {
        const sharedPassage = q.passage_id ? passages.get(q.passage_id) : undefined
        return {
          id: q.id, subject: q.subject as Subject, grade: q.grade as 1 | 2,
          year: q.year, month: q.month as Question['month'], number: q.number,
          title: q.title, tags: q.tags, prompt: q.title,
          passage: [q.search_text, q.instruction].filter(Boolean).join(' '), choices: [],
          answer: 0, explanation: '', kind: 'exam' as const,
          curriculum: q.curriculum_status === 'verified_2022' ? '2022' as const : 'unverified' as const,
          imageUrl: '', imagePath: q.image_path, width: q.width, height: q.height, points: q.points,
          sourceUrl: officialLink(q.source_url), explanationUrl: officialLink(q.explanation_url),
          sourcePage: q.source_page,
          instruction: q.instruction ?? '', responseType: q.response_type === 'short_answer' ? 'short_answer' as const : 'multiple_choice' as const,
          sharedPassage,
        }
      })
      if (current !== version) return
      questionItems.value = items
      const register = (path: string, target: { imageUrl?: string }) => {
        if (!imageTargets.has(path)) imageTargets.set(path, new Set())
        imageTargets.get(path)!.add(target)
      }
      for (const question of questionItems.value) {
        register(question.imagePath!, question)
        for (const image of question.sharedPassage?.images ?? []) register(image.imagePath!, image)
      }
    } catch {
      if (current === version) {
        questionItems.value = []
        error.value = '문제를 불러오지 못했어요. 이용 승인을 확인하거나 잠시 후 다시 불러와 주세요.'
      }
    } finally {
      if (current === version) loading.value = false
    }
  }

  function applyTags(id: string, tags: unknown) {
    if (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string')) throw new Error('태그 응답을 확인하지 못했어요. 다시 불러와 주세요.')
    const clean = normalizeQuestionTags(tags)
    const question = questionItems.value.find(question => question.id === id)
    if (!question) throw new Error('문제를 찾지 못했어요. 다시 불러와 주세요.')
    question.tags = clean
    questionItems.value = [...questionItems.value]
    return clean
  }

  async function updateQuestionTags(id: string, expectedTags: string[], tags: string[]) {
    const current = version
    const client = supabase
    if (!client || !questionItems.value.some(question => question.id === id && question.kind === 'exam')) {
      throw new Error('문제를 다시 불러온 뒤 태그를 수정해 주세요.')
    }
    const cleaned = normalizeQuestionTags(tags)
    const result = await client.rpc('update_exam_question_tags', { p_question_id: id, p_expected_tags: [...expectedTags], p_tags: cleaned })
    if (current !== version) throw new Error('로그인 상태나 문제 목록이 바뀌었어요. 다시 시도해 주세요.')
    if (result.error) {
      if (result.error.message?.includes('QUESTION_TAGS_CONFLICT')) throw new QuestionTagsConflictError()
      if (result.error.message?.includes('SCHOOL_ACCESS_REQUIRED')) throw new Error('학교 이용 승인을 받은 계정으로 다시 로그인해 주세요.')
      if (result.error.message?.includes('INVALID_QUESTION_TAGS')) throw new Error('태그 개수와 길이를 확인해 주세요. 최대 20개, 각각 60자까지 입력할 수 있어요.')
      if (result.error.message?.includes('QUESTION_NOT_FOUND')) throw new Error('문제가 삭제되었거나 더 이상 표시되지 않아요. 문제 목록을 다시 불러와 주세요.')
      throw new Error('태그를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.')
    }
    if (result.data?.id !== id) throw new Error('태그 저장 결과를 확인하지 못했어요. 최신 태그를 다시 불러와 주세요.')
    return applyTags(id, result.data.tags)
  }

  async function loadQuestionTags(id: string) {
    const current = version
    if (!supabase) throw new Error('학교 서재 연결을 확인해 주세요.')
    const result = await supabase.from('exam_questions').select('id,tags').eq('id', id).maybeSingle()
    if (current !== version) throw new Error('로그인 상태나 문제 목록이 바뀌었어요. 다시 시도해 주세요.')
    if (result.error || result.data?.id !== id) throw new Error('최신 태그를 불러오지 못했어요. 학교 이용 승인과 문제 목록을 확인해 주세요.')
    return applyTags(id, result.data.tags)
  }

  return { questionItems, loading, error, loadQuestions, clearQuestions, loadImage, updateQuestionTags, loadQuestionTags }
}
