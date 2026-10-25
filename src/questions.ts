import { ref } from 'vue'
import { subjects, type Question, type Subject } from './data'
import { supabase } from './lib/supabase'

interface ExamRecord {
  id: string; subject: string; grade: number; year: number; month: number;
  number: number; title: string; tags: string[]; image_path: string;
  width: number; height: number; points: number; source_url: string;
  explanation_url: string; source_page: number; curriculum_status: string; search_text: string;
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
    && q.tags.every(t => typeof t === 'string') && typeof q.image_path === 'string'
    && !q.image_path.startsWith('/') && !q.image_path.split('/').includes('..')
    && q.width > 0 && q.height > 0
}

// Exam text and images live in RLS-protected Supabase tables/private storage.
// Blob URLs keep the image requests authenticated and are revoked on exit.
export function useQuestionLibrary() {
  const questionItems = ref<Question[]>([])
  const loading = ref(false)
  const error = ref('')
  let version = 0
  let imageUrls: string[] = []

  function release(urls: string[]) { for (const url of urls) URL.revokeObjectURL(url) }
  function clearQuestions() {
    ++version
    release(imageUrls)
    imageUrls = []
    questionItems.value = []
    loading.value = false
    error.value = ''
  }

  async function loadQuestions() {
    clearQuestions()
    const current = version
    const client = supabase
    if (!client) { error.value = '서재 연결을 준비 중이에요. 관리자에게 문의해 주세요.'; return }
    loading.value = true
    const allocated: string[] = []
    try {
      // Recheck server-side access on every load, including browser retries.
      const access = await client.rpc('has_school_access')
      if (current !== version) return
      if (access.error || access.data !== true) throw new Error('access')
      const records: ExamRecord[] = []
      const pageSize = 200
      for (let offset = 0; ; offset += pageSize) {
        const { data, error: queryError } = await client.from('exam_questions')
          .select('id,subject,grade,year,month,number,title,tags,image_path,width,height,points,source_url,explanation_url,source_page,curriculum_status,search_text')
          .order('year', { ascending: false }).order('month', { ascending: false })
          .order('id', { ascending: true }).range(offset, offset + pageSize - 1)
        if (current !== version) return
        if (queryError) throw queryError
        records.push(...(data ?? []) as ExamRecord[])
        if (!data || data.length < pageSize) break
      }
      if (!records.every(validRecord)) throw new Error('invalid exam record')
      const items: Question[] = []
      // Limit parallel image requests while preserving exam order.
      for (let offset = 0; offset < records.length; offset += 4) {
        const results = await Promise.allSettled(records.slice(offset, offset + 4).map(async q => {
          const { data, error: imageError } = await client.storage.from('school-questions')
            .download(q.image_path, { cacheNonce: crypto.randomUUID() }, { cache: 'no-store' })
          if (current !== version) return null
          if (imageError || !data) throw imageError ?? new Error('missing image')
          const url = URL.createObjectURL(data)
          allocated.push(url)
          return {
            id: q.id, subject: q.subject as Subject, grade: q.grade as 1 | 2,
            year: q.year, month: q.month as Question['month'], number: q.number,
            title: q.title, tags: q.tags, prompt: q.title, passage: q.search_text ?? '', choices: [],
            answer: 0, explanation: '', kind: 'exam' as const,
            curriculum: q.curriculum_status === 'verified_2022' ? '2022' as const : 'unverified' as const,
            imageUrl: url, width: q.width, height: q.height, points: q.points,
            sourceUrl: officialLink(q.source_url), explanationUrl: officialLink(q.explanation_url),
            sourcePage: q.source_page,
          }
        }))
        if (current !== version) { release(allocated); return }
        if (results.some(r => r.status === 'rejected')) throw new Error('image download failed')
        for (const result of results) if (result.status === 'fulfilled' && result.value) items.push(result.value)
      }
      imageUrls = allocated
      questionItems.value = items
    } catch {
      release(allocated)
      if (current === version) {
        questionItems.value = []
        error.value = '문제를 불러오지 못했어요. 이용 승인을 확인하거나 잠시 후 다시 불러와 주세요.'
      }
    } finally {
      if (current === version) loading.value = false
    }
  }

  return { questionItems, loading, error, loadQuestions, clearQuestions }
}
