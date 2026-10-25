<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowDown, ArrowRight, ArrowUpRight, Bookmark, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, GraduationCap, LayoutGrid, Library, ListFilter, LogIn, Menu, Search, ShieldCheck, SlidersHorizontal, Sparkles, UserRound, X } from 'lucide-vue-next'
import { subjects, type Subject } from './data'
import { useQuestionLibrary } from './questions'
import SchoolEntrance from './components/SchoolEntrance.vue'
import AccountDialog from './components/AccountDialog.vue'
import AdminDialog from './components/AdminDialog.vue'
import { initializeAccount, useAccount } from './account'
import { useBookmarks } from './bookmarks'

const rightsNotice = '문항 원문의 저작권은 각 출제·제공기관 및 해당 권리자에게 있으며, 본 사이트는 출처 정보와 학습용 메타데이터를 함께 제공합니다.'

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
const authOpen = ref(false)
const accountMode = ref<'signin' | 'password'>('signin')
const adminOpen = ref(false)
const importConfirm = ref(false)
const answers = ref<string[]>([])
const { user, authReady, authBusy, isAdmin, isSchoolMember, accessReady, recoveryMode, recoveryLinkError, authNotice, refreshSchoolAccess, signOut } = useAccount()
const { questionItems, loading: questionsLoading, error: questionsError, loadQuestions, clearQuestions } = useQuestionLibrary()
const canEnter = computed(() => Boolean(authReady.value && accessReady.value && user.value && (isSchoolMember.value || isAdmin.value)))
const { saved, guestToImport, loading: savedLoading, loadFailed, disabled: savesDisabled, pending: pendingSaves, importing, message: storageMessage, toggleSaved, importGuestSaved, reloadSaved } = useBookmarks()
const accountError = ref('')
function checkAccessOnFocus() { if (user.value) void refreshSchoolAccess() }
onMounted(() => { void initializeAccount(); window.addEventListener('focus', checkAccessOnFocus) })
onBeforeUnmount(() => { window.removeEventListener('focus', checkAccessOnFocus); clearQuestions() })
watch([() => user.value?.id, canEnter], ([, allowed]) => {
  answers.value = []; sidebarOpen.value = false
  if (allowed) void loadQuestions()
  else { clearQuestions(); adminOpen.value = false; helpOpen.value = false; importConfirm.value = false }
}, { immediate: true, flush: 'sync' })
watch(recoveryMode, active => { if (active) authOpen.value = true }, { immediate: true })
watch(recoveryLinkError, active => { if (active) authOpen.value = true }, { immediate: true })
watch(isAdmin, allowed => { if (!allowed) adminOpen.value = false })
watch(() => user.value?.id, id => { importConfirm.value = false; accountError.value = ''; if (!id) accountMode.value = 'signin' })
async function logout() {
  try { await signOut(); adminOpen.value = false } catch (error) { accountError.value = error instanceof Error ? error.message : '로그아웃하지 못했어요. 다시 시도해 주세요.' }
}
async function confirmImport() { await importGuestSaved(); importConfirm.value = false }
const current = computed(() => subjects.find(s => s.name === subject.value)!)
const filtered = computed(() => questionItems.value.filter(q =>
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
function toggleAnswer(id: string) { answers.value = answers.value.includes(id) ? answers.value.filter(v => v !== id) : [...answers.value, id] }
</script>

<template>
  <SchoolEntrance v-if="!canEnter" @signin="accountMode = 'signin'; authOpen = true" @password="accountMode = 'password'; authOpen = true" />
  <div v-else class="app-shell">
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
      <header class="topbar"><div class="breadcrumb"><button class="mobile-menu icon-button" aria-label="과목 메뉴 열기" @click="sidebarOpen = true"><Menu :size="20" /></button><span>문제서재</span><ChevronRight :size="13" /><strong>문제 탐색</strong></div><div class="topbar-right"><span class="public-access-note"><span class="status-dot"></span> 고양외고 교직원 전용 서재</span><div class="account-actions"><template v-if="user"><span class="account-name" :title="user.email"><UserRound :size="17" />{{ user.user_metadata?.display_name || '선생님' }}</span><button v-if="isAdmin" class="header-admin" @click="adminOpen = true"><ShieldCheck :size="17" /> 계정 관리</button><button class="header-password" :disabled="authBusy" @click="accountMode = 'password'; authOpen = true">비밀번호 변경</button><button class="header-logout" :disabled="authBusy" @click="logout">로그아웃</button></template><button v-else class="header-login" :disabled="!authReady" @click="authOpen = true"><LogIn :size="17" />{{ authReady ? '로그인' : '확인 중…' }}</button></div><button class="icon-button" aria-label="이용 안내" @click="helpOpen = true"><CircleHelp :size="19" /></button></div></header>
      <p class="creator-credit">제작자 고양외고 이재인</p>
      <main>
        <section class="hero">
          <div class="hero-copy"><span class="eyebrow"><span></span> 수업의 시작을 가볍게</span><h1>찾던 문제를,<br><span>필요한 순간에.</span></h1><p>흩어져 있는 모의고사 문제를 한곳에.<br>과목과 키워드로 찾고, 다음 수업의 아이디어를 발견하세요.</p><div class="hero-meta"><span><Check :size="13" /> 2022 개정 교육과정</span><span><Check :size="13" /> 고1 · 고2</span></div></div>
          <div class="hero-art" aria-hidden="true"><span class="art-orbit orbit-one"></span><span class="art-orbit orbit-two"></span><div class="floating-tag tag-history"># 현대사</div><div class="paper paper-back"></div><div class="paper paper-front"><div class="paper-top"><span>QUESTION ARCHIVE</span><BookOpen :size="14" /></div><div class="paper-line line-short"></div><div class="paper-line"></div><div class="paper-line"></div><div class="paper-chart"><i></i><i></i><i></i><i></i><i></i></div><div class="paper-options"><b>①</b><b>②</b><b class="circled">③</b><b>④</b><b>⑤</b></div></div><div class="floating-tag tag-discovery"><Sparkles :size="14" /> 수업의 발견</div><div class="art-spark spark-one">✳</div><div class="art-spark spark-two">+</div></div>
        </section>

        <section class="explore" aria-labelledby="explore-heading">
          <div class="section-heading"><div><span class="section-kicker">EXPLORE THE ARCHIVE</span><h2 id="explore-heading">오늘은 어떤 문제를 찾으세요?</h2></div><span class="curriculum-chip"><span></span> 2022 개정</span></div>
          <div class="subject-tabs" role="group" aria-label="과목 선택"><button v-for="(s,i) in subjects" :key="s.name" :class="{ selected: subject === s.name }" :aria-pressed="subject === s.name" @click="selectSubject(s.name)"><span>{{ ['가','𝑥','A','史','世','⚛'][i] }}</span>{{ s.name }}</button></div>
          <div class="filter-panel">
            <div class="search-row"><label class="search-box"><Search :size="19" /><input v-model="query" placeholder="키워드나 문제 내용으로 검색해 보세요" aria-label="문제 검색"><button v-if="query" class="icon-button" aria-label="검색어 지우기" @click="query = ''"><X :size="15" /></button><span v-else class="search-hint"># 키워드 검색</span></label><button class="filter-reset" :disabled="!activeFilters" @click="reset"><SlidersHorizontal :size="17" /> 필터 초기화</button></div>
            <div class="select-row"><span class="filter-label"><ListFilter :size="15" /> 상세 조건</span><label><span class="sr-only">학년</span><select v-model="grade"><option value="all">전체 학년</option><option value="1">고1</option><option value="2">고2</option></select><ChevronDown :size="13" /></label><label><span class="sr-only">시행 연도</span><select v-model="year"><option value="all">전체 연도</option><option value="2026">2026년</option><option value="2025">2025년</option></select><ChevronDown :size="13" /></label><label><span class="sr-only">시행월</span><select v-model="month"><option value="all">전체 시행월</option><option value="3">3월</option><option value="6">6월</option><option value="9">9월</option><option value="10">10월</option></select><ChevronDown :size="13" /></label><span class="filter-separator"></span><button class="saved-filter" :class="{ enabled: savedOnly }" :aria-pressed="savedOnly" @click="savedOnly = !savedOnly"><Bookmark :size="14" /> 저장한 문제만</button></div>
            <div class="tags-row"><span class="filter-label">추천 키워드</span><div class="tags"><button :class="{ 'tag-active': !tag }" :aria-pressed="!tag" @click="tag = ''">전체</button><button v-for="t in current.tags" :key="t" :class="{ 'tag-active': tag === t }" :aria-pressed="tag === t" @click="tag = tag === t ? '' : t"><span>#</span> {{ t }}</button></div></div>
          </div>
        </section>

        <section class="results" aria-labelledby="results-heading">
          <div class="results-top"><div><h2 id="results-heading">{{ subject }} <span v-if="tag" class="result-tag">#{{ tag }}</span><span class="result-count">{{ filtered.length }}</span></h2><p>{{ current.description }}</p></div><label class="sort-select"><span class="sr-only">정렬</span><select v-model="sort"><option value="newest">최신순</option><option value="oldest">오래된순</option></select><ArrowDown :size="13" /></label></div>
          <div class="library-notice"><ShieldCheck :size="18" /><span>우리 학교 교직원 전용 자료입니다. 문제와 태그를 확인하고 정답·해설은 EBS 공식 페이지에서 볼 수 있어요.</span></div>
          <p v-if="questionsLoading" class="storage-message" role="status">문제를 불러오고 있어요…</p>
          <p v-if="questionsError" class="storage-message" role="alert">{{ questionsError }} <button @click="loadQuestions">문제 다시 불러오기</button></p>
          <div class="bookmark-account-note"><span>{{ savedLoading ? '계정에 저장한 문제를 불러오고 있어요…' : '문제를 저장하면 내 계정에 보관돼요. 로그인한 다른 기기에서도 이어서 볼 수 있어요.' }}</span><button v-if="guestToImport.length && !importConfirm" :disabled="savesDisabled || pendingSaves.length > 0" @click="importConfirm = true">이 브라우저의 저장 문제 가져오기 ({{ guestToImport.length }})</button></div>
          <div v-if="user && importConfirm" class="bookmark-import-confirm"><p>이 브라우저에 저장된 {{ guestToImport.length }}개 문제를 <strong>{{ user.email }}</strong> 계정에 추가할까요? 공용 컴퓨터라면 본인이 저장한 문제인지 확인해 주세요.</p><div><button :disabled="importing" @click="importConfirm = false">취소</button><button :disabled="savesDisabled || pendingSaves.length > 0" @click="confirmImport">{{ importing ? '가져오는 중…' : '내 계정에 추가' }}</button></div></div>
          <p v-if="storageMessage" class="storage-message" role="status">{{ storageMessage }} <button v-if="loadFailed" @click="reloadSaved">다시 불러오기</button></p>
          <p v-if="accountError || authNotice" class="storage-message" role="alert">{{ accountError || authNotice }}</p>
          <div class="question-list" aria-live="polite">
            <article v-for="q in filtered" :key="q.id" class="question-card">
              <div class="question-card-header"><div class="question-origin"><span class="grade-badge">고{{ q.grade }}</span><span>{{ q.year }}년 {{ q.month }}월 · {{ q.kind === 'exam' ? '전국연합학력평가' : '예시 문항' }}</span><span class="origin-dot">·</span><span>{{ q.subject }}</span></div><button class="bookmark-button" :class="{ bookmarked: saved.includes(q.id) }" :disabled="savesDisabled || pendingSaves.includes(q.id)" :aria-busy="pendingSaves.includes(q.id)" :title="user ? '내 계정에 저장' : '이 브라우저에 저장'" :aria-label="saved.includes(q.id) ? '저장 취소: ' + q.title : '문제 저장: ' + q.title" :aria-pressed="saved.includes(q.id)" @click="toggleSaved(q.id)"><Bookmark :size="19" :fill="saved.includes(q.id) ? 'currentColor' : 'none'" /></button></div>
              <div v-if="q.kind === 'exam'" class="question-body exam-question-body"><h3 class="exam-question-title">{{ String(q.number).padStart(2, '0') }}. {{ q.title }}</h3><img v-if="q.imageUrl" class="exam-question-image" :src="q.imageUrl" :width="q.width" :height="q.height" :alt="`${q.year}년 고${q.grade} ${q.month}월 ${q.subject} ${q.number}번 문제 원문`" loading="lazy" decoding="async"><p v-else class="storage-message">이미지를 불러오지 못했어요. <button @click="loadQuestions">다시 불러오기</button></p><p class="exam-source">{{ q.points }}점 · 원본 {{ q.sourcePage }}쪽</p></div>
              <div v-else class="question-body"><div class="question-title"><span class="question-number">{{ String(q.number).padStart(2, '0') }}</span><h3>{{ q.prompt }}</h3><span class="points">예시</span></div><div class="passage" :class="{ 'english-passage': q.subject === '영어', 'math-passage': q.subject === '수학' }">{{ q.passage }}</div><ol class="choices"><li v-for="(choice,index) in q.choices" :key="choice" :class="{ 'correct-choice': answers.includes(q.id) && index + 1 === q.answer }"><span>{{ ['①','②','③','④','⑤'][index] }}</span>{{ choice }}<Check v-if="answers.includes(q.id) && index + 1 === q.answer" :size="14" /></li></ol><div v-if="answers.includes(q.id)" :id="`answer-${q.id}`" class="answer-panel"><strong>정답 {{ ['①','②','③','④','⑤'][q.answer - 1] }}</strong><p>{{ q.explanation }}</p></div></div>
              <div class="question-footer"><div class="question-tags"><button v-for="t in q.tags" :key="t" @click="tag = t">#{{ t }}</button></div><a v-if="q.kind === 'exam' && q.explanationUrl" class="answer-button external-explanation" :href="q.explanationUrl" target="_blank" rel="noopener noreferrer">정답·해설 EBS에서 보기 <ArrowUpRight :size="15" /></a><button v-else-if="q.kind === 'demo'" class="answer-button" :aria-expanded="answers.includes(q.id)" :aria-controls="`answer-${q.id}`" @click="toggleAnswer(q.id)">{{ answers.includes(q.id) ? '정답·해설 접기' : '정답·해설 보기' }}<ChevronDown :size="15" :class="{ rotated: answers.includes(q.id) }" /></button></div>
            </article>
            <div v-if="!filtered.length && !questionsLoading && !questionsError" class="empty-state"><Search :size="30" /><h3>{{ savedOnly && savedLoading ? '저장한 문제를 불러오고 있어요' : savedOnly && loadFailed ? '저장 목록을 불러오지 못했어요' : '조건에 맞는 문제가 없어요' }}</h3><p>다른 키워드를 선택하거나 검색 조건을 줄여 보세요.<br>아직 등록되지 않은 과목은 자료를 준비하고 있어요.</p><button @click="reset">검색 조건 초기화 <ArrowRight :size="15" /></button></div>
          </div>
          <div v-if="filtered.length" class="end-of-results"><span></span><BookOpen :size="16" /><p>지금까지 {{ filtered.length }}개의 문제를 살펴봤어요</p><span></span></div>
        </section>
        <footer class="main-footer"><div><Library :size="16" /><strong>문제서재</strong><span>선생님의 다음 수업을 함께 준비합니다.</span></div><button @click="helpOpen = true">자료 및 분류 안내 <ArrowUpRight :size="13" /></button></footer>
        <p class="rights-notice">{{ rightsNotice }}</p>
      </main>
    </div>
    <AdminDialog v-if="adminOpen && isAdmin && canEnter" @close="adminOpen = false" />
    <div v-if="helpOpen" class="modal-backdrop" @click.self="helpOpen = false" @keydown.esc="helpOpen = false"><section class="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" tabindex="-1"><button class="modal-close icon-button" aria-label="안내 닫기" autofocus @click="helpOpen = false"><X :size="21" /></button><span class="eyebrow">ABOUT THE ARCHIVE</span><h2 id="help-title">함께 만들어 가는 문제서재</h2><p>고양외고 교직원만 이용하는 학교 서재입니다. 회원가입 후 관리자 승인을 받아야 입장할 수 있습니다. 과목과 키워드로 필요한 문항을 찾아 수업 준비에 활용하세요.</p><h3>자료 수록 기준</h3><p>2022 개정 교육과정은 2025년 고1부터 적용되어, 2026년 기준 고1·고2가 적용 대상입니다. 학년과 시행 연도, 과목별 출제 범위를 확인해 문항을 분류합니다.</p><h3>태그는 함께 다듬어요</h3><p>제가 역사 전공이다 보니 다른 과목은 AI를 통해 임의로 태그를 넣었습니다. 선생님들께서 실제로 쓰시기 좋은 태그(#)를 알려주시면 추가하도록 하겠습니다.</p><h3>저장한 문제와 계정</h3><p>문항 오른쪽의 책갈피를 누르면 문제를 저장할 수 있습니다. 내 계정에 저장되어 다른 기기에서도 이어서 볼 수 있으며, ‘저장한 문제만’으로 모아 볼 수 있습니다. 이전에 이 브라우저에 저장한 목록은 본인 계정으로 가져올 수 있습니다. 공용 컴퓨터에서는 사용 후 로그아웃해 주세요.</p><h3>계정 찾기</h3><p>이메일을 로그인 아이디로 사용하며 별도의 인증 메일은 보내지 않습니다. 아이디나 비밀번호를 잊으셨다면 제작자에게 가입할 때 사용한 이름과 기억나는 아이디 정보를 알려주세요. 관리자가 본인 확인 후 임시 비밀번호를 발급해 드립니다. 임시 비밀번호로 로그인한 뒤 상단의 ‘비밀번호 변경’에서 새 비밀번호를 정해 주세요.</p><a href="https://www.ebsi.co.kr/ebs/xip/xipa/retrieveSCVMainInfo.ebs?irecord=202609022&targetCd=D200&cookieGradeVal=high2" target="_blank" rel="noopener noreferrer">EBS 공식 자료 페이지 <ArrowUpRight :size="15" /></a><p class="rights-notice">{{ rightsNotice }}</p><button class="modal-confirm" @click="helpOpen = false">확인했어요</button></section></div>
  </div>
  <AccountDialog v-if="authOpen" :mode="accountMode" @close="authOpen = false" />
</template>
