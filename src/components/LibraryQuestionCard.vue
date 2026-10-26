<script setup lang="ts">
import { ArrowUpRight, Bookmark, Check, ChevronDown } from 'lucide-vue-next'
import type { Question } from '../data'

defineProps<{ question: Question; saved: boolean; disabled: boolean; pending: boolean; answerOpen: boolean; related?: boolean }>()
const emit = defineEmits<{
  save: [id: string]; answer: [id: string]; tag: [tag: string]; image: [question: Question]
}>()
</script>

<template>
  <article class="question-card" :class="{ 'related-question-card': related }">
    <div class="question-card-header">
      <div class="question-origin"><span class="grade-badge">고{{ question.grade }}</span><span>{{ question.year }}년 {{ question.month }}월 · {{ question.kind === 'exam' ? '전국연합학력평가' : '예시 문항' }}</span><span class="origin-dot">·</span><span>{{ question.subject }}</span><span v-if="related" class="related-question-label">같은 지문의 문항</span></div>
      <button class="bookmark-button" :class="{ bookmarked: saved }" :disabled="disabled || pending" :aria-busy="pending" title="내 계정에 저장" :aria-label="saved ? '저장 취소: ' + question.title : '문제 저장: ' + question.title" :aria-pressed="saved" @click="emit('save', question.id)"><Bookmark :size="19" :fill="saved ? 'currentColor' : 'none'" /></button>
    </div>
    <div v-if="question.kind === 'exam'" class="question-body exam-question-body">
      <h3 class="exam-question-title">{{ String(question.number).padStart(2, '0') }}. {{ question.title }}</h3>
      <p v-if="question.instruction" class="question-instruction">{{ question.instruction }}</p>
      <button v-if="question.imageUrl" type="button" class="exam-image-button" :aria-label="`${question.number}번 문제 크게 보기`" @click="emit('image', question)"><img class="exam-question-image" :src="question.imageUrl" :width="question.width" :height="question.height" :alt="`${question.year}년 고${question.grade} ${question.month}월 ${question.subject} ${question.number}번 문제 원문`" loading="lazy" decoding="async"></button>
      <p v-else class="storage-message">이미지를 불러오지 못했어요. 문제 다시 불러오기를 이용해 주세요.</p>
      <p v-if="question.imageUrl" class="image-zoom-hint">문제 이미지를 누르면 크게 볼 수 있어요.</p>
      <p class="exam-source"><span v-if="question.responseType === 'short_answer'" class="response-type">단답형 · </span>{{ question.points }}점 · 원본 {{ question.sourcePage }}쪽</p>
    </div>
    <div v-else class="question-body">
      <div class="question-title"><span class="question-number">{{ String(question.number).padStart(2, '0') }}</span><h3>{{ question.prompt }}</h3><span class="points">예시</span></div>
      <div class="passage" :class="{ 'english-passage': question.subject === '영어', 'math-passage': question.subject === '수학' }">{{ question.passage }}</div>
      <ol class="choices"><li v-for="(choice,index) in question.choices" :key="choice" :class="{ 'correct-choice': answerOpen && index + 1 === question.answer }"><span>{{ ['①','②','③','④','⑤'][index] }}</span>{{ choice }}<Check v-if="answerOpen && index + 1 === question.answer" :size="14" /></li></ol>
      <div v-if="answerOpen" :id="`answer-${question.id}`" class="answer-panel"><strong>정답 {{ ['①','②','③','④','⑤'][question.answer - 1] }}</strong><p>{{ question.explanation }}</p></div>
    </div>
    <div class="question-footer">
      <div class="question-tags"><button v-for="tag in question.tags" :key="tag" @click="emit('tag', tag)">#{{ tag }}</button></div>
      <a v-if="question.kind === 'exam' && question.explanationUrl" class="answer-button external-explanation" :href="question.explanationUrl" target="_blank" rel="noopener noreferrer">정답·해설 EBS에서 보기 <ArrowUpRight :size="15" /></a>
      <button v-else-if="question.kind === 'demo'" class="answer-button" :aria-expanded="answerOpen" :aria-controls="`answer-${question.id}`" @click="emit('answer', question.id)">{{ answerOpen ? '정답·해설 접기' : '정답·해설 보기' }}<ChevronDown :size="15" :class="{ rotated: answerOpen }" /></button>
    </div>
  </article>
</template>
