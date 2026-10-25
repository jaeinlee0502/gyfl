<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Maximize, Minus, Plus, X } from 'lucide-vue-next'

const props = defineProps<{ src: string; alt: string; width?: number; height?: number }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const viewport = ref<HTMLElement | null>(null)
const naturalWidth = ref(props.width ?? 0)
const naturalHeight = ref(props.height ?? 0)
const availableWidth = ref(window.innerWidth)
const availableHeight = ref(window.innerHeight - 100)
const selectedScale = ref<number | null>(null)
let observer: ResizeObserver | undefined
let previousOverflow = ''
let alive = true

const fittedScale = computed(() => naturalWidth.value > 0 && naturalHeight.value > 0
  ? Math.min(1, Math.max(1, availableWidth.value - 32) / naturalWidth.value,
    Math.max(1, availableHeight.value - 32) / naturalHeight.value)
  : 1)
const scale = computed(() => selectedScale.value ?? fittedScale.value)
const percentage = computed(() => Math.round(scale.value * 100))
const imageStyle = computed(() => naturalWidth.value > 0 && naturalHeight.value > 0
  ? { width: `${naturalWidth.value * scale.value}px`, height: `${naturalHeight.value * scale.value}px` }
  : { maxWidth: '100%', maxHeight: '100%' })

function measure() {
  if (!viewport.value) return
  availableWidth.value = viewport.value.clientWidth
  availableHeight.value = viewport.value.clientHeight
}
function loaded(event: Event) {
  const image = event.target as HTMLImageElement
  if (image.naturalWidth > 0 && image.naturalHeight > 0) {
    naturalWidth.value = image.naturalWidth
    naturalHeight.value = image.naturalHeight
  }
  measure()
}
async function changeScale(value: number) {
  const element = viewport.value
  const oldWidth = element?.scrollWidth ?? 0
  const oldHeight = element?.scrollHeight ?? 0
  selectedScale.value = Math.min(4, Math.max(.05, value))
  await nextTick()
  if (!alive || !element) return
  element.scrollLeft += (element.scrollWidth - oldWidth) / 2
  element.scrollTop += (element.scrollHeight - oldHeight) / 2
}
async function fit() {
  selectedScale.value = null
  measure()
  await nextTick()
  if (alive && viewport.value) { viewport.value.scrollLeft = 0; viewport.value.scrollTop = 0 }
}
function close() { emit('close') }
function backdrop(event: MouseEvent) { if (event.target === dialog.value) close() }

watch(() => props.src, () => {
  naturalWidth.value = props.width ?? 0
  naturalHeight.value = props.height ?? 0
  void fit()
})
onMounted(async () => {
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  dialog.value?.showModal()
  await nextTick()
  if (!alive) return
  measure()
  if (typeof ResizeObserver !== 'undefined' && viewport.value) {
    observer = new ResizeObserver(measure)
    observer.observe(viewport.value)
  }
  window.addEventListener('resize', measure)
})
onBeforeUnmount(() => {
  alive = false
  observer?.disconnect()
  window.removeEventListener('resize', measure)
  if (dialog.value?.open) dialog.value.close()
  document.body.style.overflow = previousOverflow
})
</script>

<template>
  <dialog ref="dialog" class="question-image-dialog" aria-labelledby="question-image-heading" @cancel.prevent="close" @click="backdrop">
    <section class="question-image-panel">
      <header class="question-image-toolbar">
        <h2 id="question-image-heading">{{ alt }}</h2>
        <div class="question-image-controls" aria-label="문제 이미지 크기 조절">
          <button type="button" aria-label="문제 이미지 축소" :disabled="scale <= .05" @click="changeScale(scale / 1.25)"><Minus :size="21" /></button>
          <span class="question-image-percentage" role="status" aria-live="polite">{{ percentage }}%</span>
          <button type="button" aria-label="문제 이미지 확대" :disabled="scale >= 4" @click="changeScale(scale * 1.25)"><Plus :size="21" /></button>
          <button type="button" class="question-image-fit" @click="fit"><Maximize :size="19" /><span>화면에 맞추기</span></button>
          <button type="button" class="question-image-close" aria-label="문제 크게 보기 닫기" autofocus @click="close"><X :size="24" /></button>
        </div>
      </header>
      <div ref="viewport" class="question-image-viewport" tabindex="0" aria-label="문제 이미지, 확대 후 스크롤하여 이동">
        <div class="question-image-stage"><img class="question-image-full" :src="src" :alt="alt" :style="imageStyle" draggable="false" @load="loaded"></div>
      </div>
      <p class="question-image-hint">확대·축소 버튼으로 크기를 조절하고, 스크롤하거나 손가락으로 밀어서 이동하세요.</p>
    </section>
  </dialog>
</template>
