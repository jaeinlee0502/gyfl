<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  src?: string; path?: string; alt: string; width?: number; height?: number; passage?: boolean
  buttonLabel: string
  loadImage?: (path: string) => Promise<string>
}>()
const emit = defineEmits<{ image: [url: string] }>()
const container = ref<HTMLElement | null>(null)
const url = ref(props.src || '')
const error = ref('')
const loading = ref(false)
let observer: IntersectionObserver | undefined
let alive = true
let version = 0
const placeholderStyle = computed(() => props.width && props.height ? { aspectRatio: `${props.width} / ${props.height}` } : {})
async function load() {
  if (loading.value || url.value) return
  const ticket = ++version
  loading.value = true; error.value = ''
  try {
    if (!props.path || !props.loadImage) throw new Error('이미지 정보를 확인하지 못했어요. 문제 목록을 다시 불러와 주세요.')
    const result = await props.loadImage(props.path)
    if (alive && ticket === version) url.value = result
  } catch (cause) {
    if (alive && ticket === version) error.value = cause instanceof Error ? cause.message : '이미지를 불러오지 못했어요.'
  } finally { if (alive && ticket === version) loading.value = false }
}
function observe() {
  observer?.disconnect()
  if (url.value || !container.value) return
  if (typeof IntersectionObserver === 'undefined') { void load(); return }
  observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) { observer?.disconnect(); void load() }
  }, { rootMargin: '600px 0px' })
  observer.observe(container.value)
}
watch(() => [props.src, props.path], async () => {
  ++version
  url.value = props.src || ''; loading.value = false; error.value = ''
  await nextTick()
  if (alive) observe()
})
onMounted(observe)
onBeforeUnmount(() => { alive = false; ++version; observer?.disconnect() })
</script>

<template>
  <div ref="container" class="private-question-image">
    <button v-if="url" type="button" class="exam-image-button" :class="{ 'passage-image-button': passage }" :aria-label="buttonLabel" @click="emit('image', url)"><img :class="passage ? 'shared-passage-image' : 'exam-question-image'" :src="url" :width="width" :height="height" :alt="alt" loading="lazy" decoding="async"></button>
    <div v-else class="private-image-placeholder" :style="placeholderStyle" :aria-busy="loading">
      <template v-if="error"><p role="alert">{{ error }}</p><button type="button" class="private-image-retry" :disabled="loading" @click="load">이미지 다시 불러오기</button></template>
      <p v-else role="status">문제 이미지를 준비하고 있어요…</p>
    </div>
  </div>
</template>
