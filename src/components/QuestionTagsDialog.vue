<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { X } from 'lucide-vue-next'
import type { Question } from '../data'
import { parseQuestionTags, QuestionTagsConflictError } from '../tag-editing'

const props = defineProps<{
  question: Question
  suggestedTags: string[]
  saveTags: (id: string, expected: string[], tags: string[]) => Promise<string[]>
  loadTags: (id: string) => Promise<string[]>
}>()
const emit = defineEmits<{ close: []; saved: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const baseline = ref([...props.question.tags])
const text = ref(baseline.value.join(', '))
const busy = ref(false)
const error = ref('')
const conflict = ref(false)
let alive = true
let previousOverflow = ''
const parsed = computed(() => {
  try { return { tags: parseQuestionTags(text.value), error: '' } }
  catch (cause) { return { tags: [] as string[], error: cause instanceof Error ? cause.message : '태그를 확인해 주세요.' } }
})
const unchanged = computed(() => JSON.stringify(parsed.value.tags) === JSON.stringify(baseline.value))
function close() { if (!busy.value) emit('close') }
function backdrop(event: MouseEvent) { if (event.target === dialog.value) close() }
function toggle(tag: string) {
  if (busy.value || parsed.value.error) return
  const tags = parsed.value.tags
  text.value = (tags.includes(tag) ? tags.filter(value => value !== tag) : [...tags, tag]).join(', ')
}
async function save() {
  if (busy.value || parsed.value.error || unchanged.value || conflict.value) return
  busy.value = true; error.value = ''
  try {
    await props.saveTags(props.question.id, [...baseline.value], [...parsed.value.tags])
    if (alive) emit('saved')
  } catch (cause) {
    if (alive) {
      error.value = cause instanceof Error ? cause.message : '태그를 저장하지 못했어요.'
      conflict.value = cause instanceof QuestionTagsConflictError
    }
  } finally { if (alive) busy.value = false }
}
async function reload() {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    const tags = await props.loadTags(props.question.id)
    if (!alive) return
    baseline.value = [...tags]; text.value = tags.join(', '); conflict.value = false
  } catch (cause) { if (alive) error.value = cause instanceof Error ? cause.message : '최신 태그를 불러오지 못했어요.' }
  finally { if (alive) busy.value = false }
}
onMounted(() => {
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  dialog.value?.showModal()
})
onBeforeUnmount(() => {
  alive = false
  if (dialog.value?.open) dialog.value.close()
  document.body.style.overflow = previousOverflow
})
</script>

<template>
  <dialog ref="dialog" class="question-tags-dialog" aria-labelledby="question-tags-heading" @cancel.prevent="close" @click="backdrop">
    <form class="question-tags-panel" @submit.prevent="save">
      <header><h2 id="question-tags-heading">문제 태그 편집</h2><button type="button" class="icon-button" aria-label="태그 편집 닫기" :disabled="busy" @click="close"><X :size="22" /></button></header>
      <p class="tag-question-info">{{ question.year }}년 고{{ question.grade }} {{ question.month }}월 {{ question.subject }} {{ question.number }}번 · {{ question.title }}</p>
      <p>저장한 태그는 모든 선생님에게 공유되며 문제 검색에 반영됩니다.</p>
      <label class="question-tag-input">태그<textarea v-model="text" rows="3" maxlength="1600" autofocus :disabled="busy" :aria-invalid="Boolean(parsed.error)" aria-describedby="question-tags-hint" placeholder="예: 현대사, 정치사, 6월 민주 항쟁"></textarea></label>
      <p id="question-tags-hint" class="tag-editor-hint">쉼표·#·줄바꿈으로 구분해 주세요. 최대 20개, 태그마다 60자까지 입력할 수 있어요. 모두 비우면 태그를 지웁니다.</p>
      <div class="question-tag-presets" aria-label="태그 선택"><button v-for="tag in suggestedTags" :key="tag" type="button" :class="{ selected: parsed.tags.includes(tag) }" :aria-pressed="parsed.tags.includes(tag)" :disabled="busy || !!parsed.error || (!parsed.tags.includes(tag) && parsed.tags.length >= 20)" @click="toggle(tag)">#{{ tag }}</button></div>
      <p v-if="parsed.error || error" class="tag-editor-error" role="alert">{{ parsed.error || error }}</p>
      <div v-if="conflict" class="tag-editor-conflict"><p>입력한 내용은 아직 저장되지 않았어요. 최신 태그를 불러오면 편집 내용이 최신 값으로 바뀝니다.</p><button type="button" :disabled="busy" @click="reload">최신 태그 불러오기</button></div>
      <footer><button type="button" class="tag-editor-cancel" :disabled="busy" @click="close">취소</button><button type="submit" class="tag-editor-save" :disabled="busy || !!parsed.error || unchanged || conflict">{{ busy ? '처리 중…' : '태그 저장' }}</button></footer>
    </form>
  </dialog>
</template>
