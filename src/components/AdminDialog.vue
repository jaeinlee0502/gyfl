<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Check, Copy, Eye, EyeOff, KeyRound, RefreshCw, Search, ShieldCheck, Trash2, X } from 'lucide-vue-next'
import { useAccount, type AccountSummary } from '../account'

const emit = defineEmits<{ close: [] }>()
const { configured, user, authReady, isAdmin, searchUsers, resetUserPassword, deleteUserAccount, listMembers, approveMember, revokeMember } = useAccount()
const dialog = ref<HTMLDialogElement | null>(null)
const field = ref<'email' | 'name'>('email')
const query = ref('')
const results = ref<AccountSummary[]>([])
const pending = ref(false)
const listLoading = ref(false)
const listLoaded = ref(false)
const searched = ref(false)
const error = ref('')
const notice = ref('')
const selected = ref<AccountSummary | null>(null)
const action = ref<'reset' | 'delete' | 'revoke'>('reset')
const confirmEmail = ref('')
const confirmControl = ref<HTMLElement | null>(null)
const temporary = ref<{ name: string; email: string; password: string } | null>(null)
const revealed = ref(false)
const copied = ref(false)
const copyError = ref('')
const allowed = computed(() => configured && authReady.value && !!user.value && isAdmin.value)
const canDelete = computed(() => !!selected.value && confirmEmail.value === selected.value.email)
let alive = true
let listVersion = 0
function protectedAccount(account: AccountSummary) { return account.user_id === user.value?.id || account.is_admin }
function invalidateList() { listVersion++; listLoading.value = false }
function clearTemporary() { temporary.value = null; revealed.value = false; copied.value = false; copyError.value = '' }
function close() { alive = false; invalidateList(); clearTemporary(); emit('close') }
function backdrop(event: MouseEvent) {
  if (event.target !== dialog.value) return
  const rect = dialog.value?.getBoundingClientRect()
  if (rect && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) close()
}
function readableDate(date: string) {
  const parsed = new Date(date)
  return Number.isNaN(parsed.getTime()) ? '가입일 정보 없음' : parsed.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })
}
async function selectAccount(account: AccountSummary, nextAction: 'reset' | 'delete' | 'revoke') {
  if (!allowed.value || pending.value || protectedAccount(account)) return
  clearTemporary()
  selected.value = account
  action.value = nextAction
  confirmEmail.value = ''
  error.value = ''
  notice.value = ''
  await nextTick()
  confirmControl.value?.focus()
}
async function loadMembers() {
  if (!allowed.value || pending.value || listLoading.value) return
  const version = ++listVersion
  listLoading.value = true
  clearTemporary()
  selected.value = null
  error.value = ''
  notice.value = ''
  try {
    const accounts = await listMembers()
    if (!alive || !allowed.value || version !== listVersion) return
    results.value = accounts
    searched.value = false
    listLoaded.value = true
    query.value = ''
  } catch (cause) {
    if (alive && allowed.value && version === listVersion) error.value = cause instanceof Error ? cause.message : '학교 이용 신청을 불러오지 못했어요. 목록을 다시 불러와 주세요.'
  } finally { if (version === listVersion) listLoading.value = false }
}
async function search() {
  if (!allowed.value || pending.value) return
  clearTemporary()
  selected.value = null
  confirmEmail.value = ''
  error.value = ''
  notice.value = ''
  const value = query.value.trim()
  if (value.length < 2) { error.value = '검색어를 두 글자 이상 입력해 주세요.'; return }
  invalidateList()
  pending.value = true
  try {
    const accounts = await searchUsers(value, field.value)
    if (!alive || !allowed.value) return
    results.value = accounts
    searched.value = true
    listLoaded.value = true
  } catch (cause) {
    if (!alive || !allowed.value) return
    results.value = []
    searched.value = false
    error.value = cause instanceof Error ? cause.message : '계정을 찾지 못했어요. 잠시 후 다시 시도해 주세요.'
  } finally { pending.value = false }
}
async function approve(account: AccountSummary) {
  if (!allowed.value || pending.value || account.approved || protectedAccount(account)) return
  invalidateList()
  clearTemporary()
  selected.value = null
  error.value = ''
  notice.value = ''
  pending.value = true
  try {
    const message = await approveMember(account.user_id)
    if (!alive || !allowed.value) return
    results.value = results.value.map(result => result.user_id === account.user_id ? { ...result, approved: true } : result)
    notice.value = message
  } catch (cause) {
    if (alive && allowed.value) error.value = cause instanceof Error ? cause.message : '이용을 승인하지 못했어요. 다시 시도해 주세요.'
  } finally { pending.value = false }
}
async function confirmReset() {
  if (!allowed.value || pending.value || !selected.value || action.value !== 'reset') return
  clearTemporary()
  error.value = ''
  notice.value = ''
  pending.value = true
  const target = selected.value
  try {
    const result = await resetUserPassword(target.user_id)
    if (!alive || !allowed.value) return
    temporary.value = { name: target.display_name || '이름 미등록', email: target.email, password: result.temporaryPassword }
    notice.value = result.message
    selected.value = null
  } catch (cause) {
    if (alive) error.value = cause instanceof Error ? cause.message : '비밀번호를 초기화하지 못했어요. 잠시 후 다시 시도해 주세요.'
  } finally { pending.value = false }
}
async function confirmDelete() {
  if (!allowed.value || pending.value || !selected.value || action.value !== 'delete' || !canDelete.value) return
  error.value = ''
  notice.value = ''
  pending.value = true
  const target = selected.value
  try {
    const message = await deleteUserAccount(target.user_id, confirmEmail.value)
    if (!alive || !allowed.value) return
    results.value = results.value.filter(account => account.user_id !== target.user_id)
    selected.value = null
    confirmEmail.value = ''
    notice.value = message
  } catch (cause) {
    if (alive) error.value = cause instanceof Error ? cause.message : '계정을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.'
  } finally { pending.value = false }
}
async function confirmRevoke() {
  if (!allowed.value || pending.value || !selected.value || action.value !== 'revoke' || protectedAccount(selected.value)) return
  invalidateList()
  error.value = ''
  notice.value = ''
  pending.value = true
  const target = selected.value
  try {
    const message = await revokeMember(target.user_id)
    if (!alive || !allowed.value) return
    results.value = results.value.map(account => account.user_id === target.user_id ? { ...account, approved: false } : account)
    selected.value = null
    notice.value = message
  } catch (cause) {
    if (alive && allowed.value) error.value = cause instanceof Error ? cause.message : '이용 승인을 취소하지 못했어요. 다시 시도해 주세요.'
  } finally { pending.value = false }
}
async function copyTemporary() {
  if (!temporary.value) return
  copied.value = false
  copyError.value = ''
  const password = temporary.value.password
  try {
    await navigator.clipboard.writeText(password)
    if (alive && temporary.value?.password === password) copied.value = true
  } catch { if (alive) copyError.value = '복사하지 못했어요. 표시 버튼을 누른 뒤 직접 복사해 주세요.' }
}
watch(allowed, value => {
  if (!value) { invalidateList(); clearTemporary(); selected.value = null; results.value = []; listLoaded.value = false; notice.value = ''; error.value = '' }
  else void loadMembers()
})
onMounted(() => { dialog.value?.showModal(); if (allowed.value) void loadMembers() })
onBeforeUnmount(() => { alive = false; invalidateList(); clearTemporary(); if (dialog.value?.open) dialog.value.close() })
</script>

<template>
  <dialog ref="dialog" class="account-dialog admin-dialog" aria-labelledby="admin-title" aria-describedby="admin-description" @cancel.prevent="close" @click="backdrop">
    <div class="account-dialog-content">
      <button class="account-close" aria-label="관리자 창 닫기" @click="close"><X :size="22" /></button>
      <span class="account-emblem"><ShieldCheck :size="25" /></span>
      <span class="account-eyebrow">SCHOOL LIBRARY ADMIN</span>
      <h2 id="admin-title">학교 이용 승인 · 계정 관리</h2>
      <p id="admin-description" class="account-description">가입한 선생님이 우리 학교 교직원인지 확인하고 이용을 승인해 주세요. 비밀번호 초기화와 계정 삭제도 할 수 있어요.</p>
      <div v-if="!allowed" class="account-error" role="alert">이 화면은 계정 관리 권한이 있는 관리자만 이용할 수 있어요.</div>
      <template v-else>
        <p class="account-footnote admin-privacy-note">우리 학교 교직원임을 직접 확인한 계정만 승인해 주세요. 가입만으로는 문제를 볼 수 없어요. 비밀번호 초기화 전에는 본인 여부를 확인하고, 발급한 임시 비밀번호를 직접 전달해 주세요.</p>
        <div class="admin-members-heading"><div><h3>학교 이용 신청</h3><p>승인 대기 계정부터 표시해요.</p></div><button type="button" class="account-secondary admin-refresh" :disabled="pending || listLoading" @click="loadMembers"><RefreshCw :size="17" />{{ listLoading ? '목록 불러오는 중…' : '전체 목록 새로고침' }}</button></div>
        <form class="admin-search-form" :aria-busy="pending" @submit.prevent="search">
          <label class="account-field" for="admin-search-field"><span>검색 기준</span><select id="admin-search-field" v-model="field" :disabled="pending"><option value="email">이메일 아이디</option><option value="name">이름 또는 별명</option></select></label>
          <label class="account-field admin-query" for="admin-search-query"><span>검색어</span><input id="admin-search-query" v-model="query" name="query" minlength="2" maxlength="120" required :placeholder="field === 'email' ? '아이디의 일부를 입력해 주세요' : '선생님 이름 또는 별명을 입력해 주세요'" :disabled="pending" autocomplete="off"></label>
          <button type="submit" class="account-primary admin-search-button" :disabled="pending"><Search :size="18" />{{ pending ? '처리 중…' : '계정 찾기' }}</button>
        </form>
        <div v-if="error" class="account-error" role="alert">{{ error }}</div>
        <div v-if="notice" class="account-notice" role="status">{{ notice }}</div>

        <section v-if="temporary" class="admin-temporary" aria-labelledby="temporary-title">
          <h3 id="temporary-title">임시 비밀번호를 전달해 주세요</h3>
          <p><strong>{{ temporary.name }}</strong><br>{{ temporary.email }}</p>
          <p id="temporary-warning" class="account-footnote">이 창을 닫으면 다시 표시되지 않아요. 선생님에게 직접 전달해 주세요.</p>
          <label class="account-field" for="temporary-password"><span>임시 비밀번호</span><input id="temporary-password" :type="revealed ? 'text' : 'password'" :value="temporary.password" readonly autocomplete="off" spellcheck="false" aria-describedby="temporary-warning"></label>
          <div class="admin-temporary-actions"><button class="account-secondary" :aria-pressed="revealed" @click="revealed = !revealed"><EyeOff v-if="revealed" :size="17" /><Eye v-else :size="17" />{{ revealed ? '숨기기' : '표시' }}</button><button class="account-secondary" @click="copyTemporary"><Copy :size="17" />{{ copied ? '복사했어요' : '복사' }}</button><button class="account-text-button" @click="clearTemporary">전달 완료 · 화면에서 지우기</button></div>
          <p v-if="copyError" class="account-error" role="alert">{{ copyError }}</p>
          <p class="account-footnote">선생님에게 로그인 후 <strong>비밀번호 변경</strong>에서 새 비밀번호를 정하도록 안내해 주세요.</p>
        </section>

        <section v-if="selected" class="admin-confirmation" :class="{ 'admin-delete-confirmation': action === 'delete' }" aria-labelledby="admin-confirm-title">
          <h3 id="admin-confirm-title">{{ action === 'delete' ? '이 계정을 삭제할까요?' : action === 'revoke' ? '학교 이용 승인을 취소할까요?' : '이 계정의 비밀번호를 초기화할까요?' }}</h3>
          <p><strong>{{ selected.display_name || '이름 미등록' }}</strong><br><span>{{ selected.email }}</span></p>
          <template v-if="action === 'delete'">
            <p class="account-footnote">계정과 저장한 문제가 삭제되며 되돌릴 수 없어요. 삭제할 계정의 이메일 아이디를 정확히 입력해 주세요.</p>
            <label class="account-field" for="admin-delete-email"><span>삭제 확인용 이메일 아이디</span><input id="admin-delete-email" ref="confirmControl" v-model="confirmEmail" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" :placeholder="selected.email" :disabled="pending"></label>
          </template>
          <p v-else-if="action === 'revoke'" class="account-footnote">다시 승인할 때까지 이 계정의 서재 이용을 제한해요. 계정과 저장한 문제 목록은 유지돼요.</p>
          <p v-else class="account-footnote">현재 비밀번호가 새 임시 비밀번호로 바뀌어요. 메일은 보내지 않으며, 표시된 임시 비밀번호를 선생님에게 직접 전달해야 해요.</p>
          <div class="admin-confirm-actions"><button class="account-secondary" :disabled="pending" @click="selected = null; confirmEmail = ''">취소</button><button v-if="action === 'delete'" class="account-danger" :disabled="pending || !canDelete" @click="confirmDelete"><Trash2 :size="17" />{{ pending ? '삭제 중…' : '계정 삭제하기' }}</button><button v-else-if="action === 'revoke'" ref="confirmControl" class="account-danger" :disabled="pending" @click="confirmRevoke">{{ pending ? '승인 취소 중…' : '이용 승인 취소하기' }}</button><button v-else ref="confirmControl" class="account-primary" :disabled="pending" @click="confirmReset"><KeyRound :size="17" />{{ pending ? '초기화 중…' : '임시 비밀번호로 초기화' }}</button></div>
        </section>

        <div class="admin-results" aria-live="polite" :aria-busy="pending || listLoading">
          <p v-if="listLoading" class="admin-empty" role="status">학교 이용 신청을 불러오고 있어요.</p>
          <template v-else-if="listLoaded">
            <p class="admin-result-count">{{ searched ? '검색 결과' : '등록된 계정' }} <strong>{{ results.length }}</strong>명<span v-if="results.length >= (searched ? 20 : 200)"> · 최대 {{ searched ? 20 : 200 }}명까지 표시해요. 검색어로 계정을 찾아 주세요.</span></p>
            <ul v-if="results.length" class="admin-user-list">
              <li v-for="account in results" :key="account.user_id" class="admin-user-card" :data-account="account.user_id"><div class="admin-user-details"><strong>{{ account.display_name || '이름 미등록' }}<span class="admin-membership-badge" :class="account.is_admin ? 'is-admin' : account.approved ? 'is-approved' : 'is-pending'">{{ account.is_admin ? '관리자' : account.approved ? '이용 승인' : '승인 대기' }}</span></strong><span>{{ account.email }}</span><small>가입일 {{ readableDate(account.created_at) }}</small></div><div class="admin-user-actions"><button v-if="!account.approved && !protectedAccount(account)" class="account-primary admin-approve-button" :disabled="pending" :aria-label="`${account.display_name || account.email} 학교 이용 승인`" @click="approve(account)"><Check :size="17" />이용 승인</button><button v-else-if="account.approved && !protectedAccount(account)" class="account-text-button admin-revoke-button" :disabled="pending" :aria-label="`${account.display_name || account.email} 이용 승인 취소`" @click="selectAccount(account, 'revoke')">승인 취소</button><button class="account-secondary" :disabled="pending || protectedAccount(account)" @click="selectAccount(account, 'reset')">비밀번호 초기화</button><button class="account-danger-outline" :disabled="pending || protectedAccount(account)" @click="selectAccount(account, 'delete')">계정 삭제</button></div></li>
            </ul>
            <p v-else class="admin-empty">{{ searched ? '일치하는 계정이 없어요. 이름이나 아이디를 다시 확인해 주세요.' : '학교 이용 신청이 아직 없어요. 가입한 선생님이 있으면 목록을 새로 불러와 주세요.' }}</p>
          </template>
          <p v-else-if="!pending" class="admin-empty">전체 목록을 새로 불러오거나 이름·아이디로 계정을 검색해 주세요.</p>
        </div>
      </template>
    </div>
  </dialog>
</template>
