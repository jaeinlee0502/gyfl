import { computed, ref, watch } from 'vue'
import { useAccount } from './account'
import { questions } from './data'
import { supabase } from './lib/supabase'

const storageKey = 'gyfl-bookmarks-v1'
function readGuestSaved(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]')
    return Array.isArray(value)
      ? [...new Set(value.filter((id): id is string => typeof id === 'string' && questions.some(q => q.id === id)))]
      : []
  } catch { return [] }
}

export function useBookmarks() {
  const { user, authReady } = useAccount()
  const guestSaved = ref<string[]>(readGuestSaved())
  const remoteSaved = ref<string[]>([])
  const loading = ref(false)
  const loadFailed = ref(false)
  const message = ref('')
  const pending = ref<string[]>([])
  const importing = ref(false)
  let version = 0
  const saved = computed(() => user.value ? remoteSaved.value : guestSaved.value)
  const guestToImport = computed(() => guestSaved.value.filter(id => !remoteSaved.value.includes(id)))
  const disabled = computed(() => !authReady.value || loading.value || loadFailed.value || importing.value)

  async function load() {
    const currentVersion = ++version
    const id = user.value?.id
    remoteSaved.value = []
    pending.value = []
    importing.value = false
    message.value = ''
    loadFailed.value = false
    loading.value = Boolean(id)
    if (!id || !supabase) { loading.value = false; return }
    try {
      const { data, error } = await supabase.from('bookmarks').select('question_id').eq('user_id', id)
      if (currentVersion !== version) return
      if (error) throw error
      remoteSaved.value = (data ?? []).map(row => row.question_id as string)
    } catch {
      if (currentVersion !== version) return
      loadFailed.value = true
      message.value = '저장한 문제를 불러오지 못했어요. 다시 불러오기를 눌러 주세요.'
    } finally {
      if (currentVersion === version) loading.value = false
    }
  }
  watch(() => user.value?.id, () => { void load() }, { immediate: true, flush: 'sync' })

  async function toggleSaved(questionId: string) {
    if (disabled.value || pending.value.includes(questionId)) return
    message.value = ''
    if (!user.value) {
      guestSaved.value = guestSaved.value.includes(questionId)
        ? guestSaved.value.filter(id => id !== questionId) : [...guestSaved.value, questionId]
      try { localStorage.setItem(storageKey, JSON.stringify(guestSaved.value)) }
      catch { message.value = '브라우저 저장 공간을 사용할 수 없어 이번 화면에서만 보관됩니다.' }
      return
    }
    if (!supabase) return
    const id = user.value.id
    const currentVersion = version
    const wasSaved = remoteSaved.value.includes(questionId)
    pending.value = [...pending.value, questionId]
    try {
      const { error } = wasSaved
        ? await supabase.from('bookmarks').delete().eq('user_id', id).eq('question_id', questionId)
        : await supabase.from('bookmarks').upsert({ user_id: id, question_id: questionId }, { onConflict: 'user_id,question_id', ignoreDuplicates: true })
      if (currentVersion !== version) return
      if (error) throw error
      remoteSaved.value = wasSaved ? remoteSaved.value.filter(q => q !== questionId) : [...remoteSaved.value, questionId]
    } catch {
      if (currentVersion === version) message.value = '계정에 저장하지 못했어요. 연결을 확인한 뒤 다시 눌러 주세요.'
    } finally {
      if (currentVersion === version) pending.value = pending.value.filter(q => q !== questionId)
    }
  }

  async function importGuestSaved() {
    if (!user.value || !supabase || disabled.value || pending.value.length || !guestToImport.value.length) return
    const id = user.value.id
    const currentVersion = version
    const ids = [...guestToImport.value]
    importing.value = true
    try {
      const { error } = await supabase.from('bookmarks').upsert(ids.map(question_id => ({ user_id: id, question_id })), { onConflict: 'user_id,question_id', ignoreDuplicates: true })
      if (currentVersion !== version) return
      if (error) throw error
      remoteSaved.value = [...new Set([...remoteSaved.value, ...ids])]
      message.value = '이 브라우저에 저장된 문제를 계정에 추가했어요.'
    } catch {
      if (currentVersion === version) message.value = '가져오지 못했어요. 잠시 후 다시 시도해 주세요.'
    } finally {
      if (currentVersion === version) importing.value = false
    }
  }

  return { saved, guestToImport, loading, loadFailed, disabled, pending, importing, message, toggleSaved, importGuestSaved, reloadSaved: load }
}
