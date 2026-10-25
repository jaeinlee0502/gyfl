<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowDown, ArrowRight, ArrowUpRight, Bookmark, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, GraduationCap, LayoutGrid, Library, ListFilter, Menu, Search, SlidersHorizontal, Sparkles, X } from 'lucide-vue-next'
import { questions, subjects, type Subject } from './data'

const subject = ref<Subject>('한국사')
const tag = ref('')
const query = ref('')
const grade = ref('all')
const year = ref('all')
const month = ref('all')
const sort = ref('newest')
const savedOnly = ref(false)
const sidebarOpen = ref(false)
const helpOpen = ref(false)
const answers = ref<string[]>([])
const storageKey = 'gyfl-bookmarks-v1'
function readSaved(): string[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]'); return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && questions.some(q => q.id === id)) : [] } catch { return [] }
}
const saved = ref<string[]>(readSaved())
const storageMessage = ref('')
const current = computed(() => subjects.find(s => s.name === subject.value)!)
const filtered = computed(() => questions.filter(q =>
  q.subject === subject.value && (!tag.value || q.tags.includes(tag.value)) &&
  (grade.value === 'all' || q.grade === Number(grade.value)) &&
  (year.value === 'all' || q.year === Number(year.value)) &&
  (month.value === 'all' || q.month === Number(month.value)) &&
  (!savedOnly.value || saved.value.includes(q.id)) &&
  (!query.value.trim() || [q.title, q.prompt, q.passage, ...q.tags].join(' ').toLowerCase().includes(query.value.trim().replace(/^#/, '').toLowerCase()))
).sort((a,b) => sort.value === 'oldest' ? a.year * 100 + a.month - (b.year * 100 + b.month) : b.year * 100 + b.month - (a.year * 100 + a.month)))
const activeFilters = computed(() => tag.value || query.value || grade.value !== 'all' || year.value !== 'all' || month.value !== 'all' || savedOnly.value)
function reset() { tag.value = ''; query.value = ''; grade.value = 'all'; year.value = 'all'; month.value = 'all'; savedOnly.value = false }
function selectSubject(name: Subject) { subject.value = name; tag.value = ''; sidebarOpen.value = false }
function toggleSaved(id: string) {
  saved.value = saved.value.includes(id) ? saved.value.filter(v => v !== id) : [...saved.value, id]
  try { localStorage.setItem(storageKey, JSON.stringify(saved.value)); storageMessage.value = '' } catch { storageMessage.value = '브라우저 저장 공간을 사용할 수 없어 이번 화면에서만 보관됩니다.' }
}
function toggleAnswer(id: string) { answers.value = answers.value.includes(id) ? answers.value.filter(v => v !== id) : [...answers.value, id] }
</script>

<template>
  <div class="app-shell">
    <div v-if="sidebarOpen" class="sidebar-backdrop" @click="sidebarOpen = false"></div>
    <aside class="sidebar" :class="{ open: sidebarOpen }" aria-label="과목 탐색" tabindex="0">
      <a class="brand" href="#" @click.prevent="reset(); subject = '한국사'"><span class="brand-icon"><Library :size="22" :stroke-width="1.8" /></span><span>문제서재<span class="brand-dot">.</span></span></a>
      <div class="workspace-label">TEACHER'S WORKSPACE</div>
      <div class="nav-label">나의 서재</div>
      <button class="nav-item" :class="{ 'nav-selected': !savedOnly }" @click="savedOnly = false"><LayoutGrid :size="18" /> 전체 문제 탐색 <span class="new-dot"></span></button>
      <button class="nav-item" :class="{ 'nav-selected': savedOnly }" @click="savedOnly = !savedOnly; sidebarOpen = false"><Bookmark :size="18" /> 저장한 문제 <span class="nav-count">{{ saved.length }}</span></button>
      <div class="nav-label subjects-label">과목별 탐색 <span>6</span></div>
      <button v-for="(s,i) in subjects" :key="s.name" class="subject-nav" :class="{ active: subject === s.name }" @click="selectSubject(s.name)"><span class="subject-symbol" :class="`symbol-${i}`">{{ ['가','𝑥','A','史','世','⚛'][i] }}</span><span>{{ s.name }}</span><ChevronRight v-if="subject === s.name" :size="15" /></button>
      <div class="sidebar-note"><span class="note-icon"><GraduationCap :size="21" /></span><strong>새로운 교육과정, 같은 열정</strong><p>2022 개정 교육과정을 위한<br>선생님의 수업 준비 공간입니다.</p><span class="curriculum-label">2022 개정 교육과정</span></div>
      <button class="help-button" @click="helpOpen = true"><CircleHelp :size="17" /> 서재 이용 안내 <ArrowUpRight :size="14" /></button>
      <div class="sidebar-footer">좋은 수업은, 좋은 질문에서.</div>
    </aside>

    <div class="main-shell">
      <header class="topbar"><div class="breadcrumb"><button class="mobile-menu icon-button" aria-label="과목 메뉴 열기" @click="sidebarOpen = true"><Menu :size="20" /></button><span>문제서재</span><ChevronRight :size="13" /><strong>문제 탐색</strong></div><div class="topbar-right"><span class="status-dot"></span> 선생님을 위한 열린 문제은행 <button class="icon-button" aria-label="이용 안내" @click="helpOpen = true"><CircleHelp :size="19" /></button></div></header>
      <main>
        <section class="hero">
          <div class="hero-copy"><span class="eyebrow"><span></span> 수업의 시작을 가볍게</span><h1>찾던 문제를,<br><span>필요한 순간에.</span></h1><p>흩어져 있는 모의고사 문제를 한곳에.<br>과목과 키워드로 찾고, 다음 수업의 아이디어를 발견하세요.</p><div class="hero-meta"><span><Check :size="13" /> 2022 개정 교육과정</span><span><Check :size="13" /> 고1 · 고2</span><span><Check :size="13" /> 로그인 없이 자유롭게</span></div></div>
          <div class="hero-art" aria-hidden="true"><span class="art-orbit orbit-one"></span><span class="art-orbit orbit-two"></span><div class="floating-tag tag-history"># 현대사</div><div class="paper paper-back"></div><div class="paper paper-front"><div class="paper-top"><span>QUESTION ARCHIVE</span><BookOpen :size="14" /></div><div class="paper-line line-short"></div><div class="paper-line"></div><div class="paper-line"></div><div class="paper-chart"><i></i><i></i><i></i><i></i><i></i></div><div class="paper-options"><b>①</b><b>②</b><b class="circled">③</b><b>④</b><b>⑤</b></div></div><div class="floating-tag tag-discovery"><Sparkles :size="14" /> 수업의 발견</div><div class="art-spark spark-one">✳</div><div class="art-spark spark-two">+</div></div>
        </section>

        <section class="explore" aria-labelledby="explore-heading">
          <div class="section-heading"><div><span class="section-kicker">EXPLORE THE ARCHIVE</span><h2 id="explore-heading">오늘은 어떤 문제를 찾으세요?</h2></div><span class="curriculum-chip"><span></span> 2022 개정</span></div>
          <div class="subject-tabs" role="group" aria-label="과목 선택"><button v-for="(s,i) in subjects" :key="s.name" :class="{ selected: subject === s.name }" :aria-pressed="subject === s.name" @click="selectSubject(s.name)"><span>{{ ['가','𝑥','A','史','世','⚛'][i] }}</span>{{ s.name }}</button></div>
          <div class="filter-panel">
            <div class="search-row"><label class="search-box"><Search :size="19" /><input v-model="query" placeholder="키워드나 문제 내용으로 검색해 보세요" aria-label="문제 검색"><button v-if="query" class="icon-button" aria-label="검색어 지우기" @click="query = ''"><X :size="15" /></button><span v-else class="search-hint"># 키워드 검색</span></label><button class="filter-reset" :disabled="!activeFilters" @click="reset"><SlidersHorizontal :size="17" /> 필터 초기화</button></div>
            <div class="select-row"><span class="filter-label"><ListFilter :size="15" /> 상세 조건</span><label><span class="sr-only">학년</span><select v-model="grade"><option value="all">전체 학년</option><option value="1">고1</option><option value="2">고2</option></select><ChevronDown :size="13" /></label><label><span class="sr-only">시행 연도</span><select v-model="year"><option value="all">전체 연도</option><option value="2026">2026년</option><option value="2025">2025년</option></select><ChevronDown :size="13" /></label><label><span class="sr-only">시행월</span><select v-model="month"><option value="all">전체 시행월</option><option value="3">3월</option><option value="6">6월</option><option value="9">9월</option></select><ChevronDown :size="13" /></label><span class="filter-separator"></span><button class="saved-filter" :class="{ enabled: savedOnly }" :aria-pressed="savedOnly" @click="savedOnly = !savedOnly"><Bookmark :size="14" /> 저장한 문제만</button></div>
            <div class="tags-row"><span class="filter-label">추천 키워드</span><div class="tags"><button :class="{ 'tag-active': !tag }" :aria-pressed="!tag" @click="tag = ''">전체</button><button v-for="t in current.tags" :key="t" :class="{ 'tag-active': tag === t }" :aria-pressed="tag === t" @click="tag = tag === t ? '' : t"><span>#</span> {{ t }}</button></div></div>
          </div>
        </section>

        <section class="results" aria-labelledby="results-heading">
          <div class="results-top"><div><h2 id="results-heading">{{ subject }} <span v-if="tag" class="result-tag">#{{ tag }}</span><span class="result-count">{{ filtered.length }}</span></h2><p>{{ current.description }}</p></div><label class="sort-select"><span class="sr-only">정렬</span><select v-model="sort"><option value="newest">최신순</option><option value="oldest">오래된순</option></select><ArrowDown :size="13" /></label></div>
          <div class="demo-notice"><span class="demo-pill">미리보기</span><span>아래는 검색 기능을 체험하기 위한 <strong>자체 제작 예시 문제</strong>입니다. 실제 모의고사 원문은 아직 수록되지 않았습니다.</span></div>
          <p v-if="storageMessage" class="storage-message" role="status">{{ storageMessage }}</p>
          <div class="question-list" aria-live="polite">
            <article v-for="q in filtered" :key="q.id" class="question-card">
              <div class="question-card-header"><div class="question-origin"><span class="grade-badge">고{{ q.grade }}</span><span>{{ q.year }}년 {{ q.month }}월 · 예시 문항</span><span class="origin-dot">·</span><span>{{ q.subject }}</span></div><button class="bookmark-button" :class="{ bookmarked: saved.includes(q.id) }" :aria-label="saved.includes(q.id) ? '저장 취소: ' + q.title : '문제 저장: ' + q.title" :aria-pressed="saved.includes(q.id)" @click="toggleSaved(q.id)"><Bookmark :size="19" :fill="saved.includes(q.id) ? 'currentColor' : 'none'" /></button></div>
              <div class="question-body"><div class="question-title"><span class="question-number">{{ String(q.number).padStart(2, '0') }}</span><h3>{{ q.prompt }}</h3><span class="points">예시</span></div><div class="passage" :class="{ 'english-passage': q.subject === '영어', 'math-passage': q.subject === '수학' }">{{ q.passage }}</div><ol class="choices"><li v-for="(choice,index) in q.choices" :key="choice" :class="{ 'correct-choice': answers.includes(q.id) && index + 1 === q.answer }"><span>{{ ['①','②','③','④','⑤'][index] }}</span>{{ choice }}<Check v-if="answers.includes(q.id) && index + 1 === q.answer" :size="14" /></li></ol><div v-if="answers.includes(q.id)" :id="`answer-${q.id}`" class="answer-panel"><strong>정답 {{ ['①','②','③','④','⑤'][q.answer - 1] }}</strong><p>{{ q.explanation }}</p></div></div>
              <div class="question-footer"><div class="question-tags"><button v-for="t in q.tags" :key="t" @click="tag = t">#{{ t }}</button></div><button class="answer-button" :aria-expanded="answers.includes(q.id)" :aria-controls="`answer-${q.id}`" @click="toggleAnswer(q.id)">{{ answers.includes(q.id) ? '정답·해설 접기' : '정답·해설 보기' }}<ChevronDown :size="15" :class="{ rotated: answers.includes(q.id) }" /></button></div>
            </article>
            <div v-if="!filtered.length" class="empty-state"><Search :size="30" /><h3>조건에 맞는 예시 문제가 없어요</h3><p>다른 키워드를 선택하거나 검색 조건을 줄여 보세요.<br>현재는 화면 검토를 위한 소량의 예시만 제공됩니다.</p><button @click="reset">검색 조건 초기화 <ArrowRight :size="15" /></button></div>
          </div>
          <div v-if="filtered.length" class="end-of-results"><span></span><BookOpen :size="16" /><p>지금까지 {{ filtered.length }}개의 예시 문제를 살펴봤어요</p><span></span></div>
        </section>
        <footer class="main-footer"><div><Library :size="16" /><strong>문제서재</strong><span>선생님의 다음 수업을 함께 준비합니다.</span></div><button @click="helpOpen = true">자료 및 분류 안내 <ArrowUpRight :size="13" /></button></footer>
      </main>
    </div>
    <div v-if="helpOpen" class="modal-backdrop" @click.self="helpOpen = false" @keydown.esc="helpOpen = false"><section class="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" tabindex="-1"><button class="modal-close icon-button" aria-label="안내 닫기" autofocus @click="helpOpen = false"><X :size="21" /></button><span class="eyebrow">ABOUT THE ARCHIVE</span><h2 id="help-title">함께 만들어 가는 문제서재</h2><p>로그인 없이 과목과 키워드로 문제를 찾아보는 첫 번째 프로토타입입니다. 현재 표시된 문제는 모두 자체 제작 예시이며 EBS 기출문제가 아닙니다. 연도·시행월도 필터 시연용 정보입니다.</p><h3>자료 수록 기준</h3><p>2022 개정 적용 대상은 고1은 2025년부터, 고2는 2026년부터입니다. 실제 수록 시 시험별 교육과정·출제 범위를 확인하고, 원본 출처와 문항 이미지의 이용·재배포 조건을 검토해야 합니다.</p><h3>태그는 함께 다듬어요</h3><p>사회·과학은 통합사회·통합과학을 기본으로 분야와 개념을 함께 제안했습니다. 태그는 교사 검토 전 초안이며, 실제 출제 여부나 해당 학년의 학습 범위를 보증하지 않습니다.</p><h3>저장한 문제</h3><p>북마크는 이 브라우저에만 저장됩니다. 기기 간 동기화는 없으며 브라우저 데이터 삭제 시 사라집니다.</p><a href="https://www.ebsi.co.kr/ebs/xip/xipa/retrieveSCVMainInfo.ebs?irecord=202609022&targetCd=D200&cookieGradeVal=high2" target="_blank" rel="noopener noreferrer">제공해 주신 EBS 자료 페이지 <ArrowUpRight :size="15" /></a><button class="modal-confirm" @click="helpOpen = false">확인했어요</button></section></div>
  </div>
</template>
