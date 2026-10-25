<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Mail, Search, ShieldCheck, X } from 'lucide-vue-next'
import { useAccount, type AccountSummary } from '../account'

const emit = defineEmits<{ close: [] }>()
const { configured, user, authReady, isAdmin, searchUsers, sendAdminReset } = useAccount()
const dialog = ref<HTMLDialogElement | null>(null)
const field = ref<'email' | 'name'>('email')
const query = ref('')
const results = ref<AccountSummary[]>([])
const pending = ref(false)
const searched = ref(false)
const error = ref('')
const notice = ref('')
const selected = ref<AccountSummary | null>(null)
const confirmButton = ref<HTMLButtonElement | null>(null)
const allowed = computed(() => configured && authReady.value && !!user.value && isAdmin.value)
function close() { emit('close') }
function backdrop(event: MouseEvent) {
  if (event.target !== dialog.value) return
  const rect = dialog.value?.getBoundingClientRect()
  if (rect && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) close()
}
function readableDate(date: string) {
  const parsed = new Date(date)
  return Number.isNaN(parsed.getTime()) ? '가입일 정보 없음' : parsed.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })
}
async function selectAccount(account: AccountSummary) {
  selected.value = account
  error.value = ''
  notice.value = ''
  await nextTick()
  confirmButton.value?.focus()
}
async function search() {
  if (!allowed.value || pending.value) return
  selected.value = null
  error.value = ''
  notice.value = ''
  const value = query.value.trim()
  if (value.length < 2) { error.value = '검색어를 두 글자 이상 입력해 주세요.'; return }
  pending.value = true
  try {
    results.value = await searchUsers(value, field.value)
    searched.value = true
  } catch (cause) {
    results.value = []
    searched.value = false
    error.value = cause instanceof Error ? cause.message : '계정을 찾지 못했어요. 잠시 후 다시 시도해 주세요.'
  } finally { pending.value = false }
}
async function confirmReset() {
  if (!allowed.value || pending.value || !selected.value) return
  error.value = ''
  notice.value = ''
  pending.value = true
  try {
    notice.value = await sendAdminReset(selected.value.user_id)
    selected.value = null
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.' }
  finally { pending.value = false }
}
onMounted(() => { dialog.value?.showModal() })
onBeforeUnmount(() => { if (dialog.value?.open) dialog.value.close() })
</script>

<template>
  <dialog ref="dialog" class="account-dialog admin-dialog" aria-labelledby="admin-title" aria-describedby="admin-description" @cancel.prevent="close" @click="backdrop">
    <div class="account-dialog-content">
      <button class="account-close" aria-label="관리자 창 닫기" @click="close"><X :size="22" /></button>
      <span class="account-emblem"><ShieldCheck :size="25" /></span>
      <span class="account-eyebrow">ACCOUNT SUPPORT</span>
      <h2 id="admin-title">선생님 계정 지원</h2>
      <p id="admin-description" class="account-description">이름이나 이메일로 계정을 찾아, 가입된 이메일로 비밀번호 재설정 안내를 보내세요.</p>
      <div v-if="!allowed" class="account-error" role="alert">이 화면은 계정 지원 권한이 있는 관리자만 이용할 수 있어요.</div>
      <template v-else>
        <p class="account-footnote admin-privacy-note">이메일 아이디 안내 전에는 요청자가 본인인지 확인해 주세요. 비밀번호는 조회할 수 없으며, 새 비밀번호는 선생님이 메일의 링크에서 직접 정해요.</p>
        <form class="admin-search-form" :aria-busy="pending" @submit.prevent="search">
          <label class="account-field" for="admin-search-field"><span>검색 기준</span><select id="admin-search-field" v-model="field" :disabled="pending"><option value="email">이메일</option><option value="name">이름 또는 별명</option></select></label>
          <label class="account-field admin-query" for="admin-search-query"><span>검색어</span><input id="admin-search-query" v-model="query" name="query" minlength="2" maxlength="120" required :placeholder="field === 'email' ? '가입 이메일의 일부를 입력해 주세요' : '선생님 이름 또는 별명을 입력해 주세요'" :disabled="pending" autocomplete="off"></label>
          <button type="submit" class="account-primary admin-search-button" :disabled="pending"><Search :size="18" />{{ pending ? '처리 중…' : '계정 찾기' }}</button>
        </form>
        <div v-if="error" class="account-error" role="alert">{{ error }}</div>
        <div v-if="notice" class="account-notice" role="status">{{ notice }}</div>

        <section v-if="selected" class="admin-confirmation" aria-labelledby="reset-confirm-title">
          <h3 id="reset-confirm-title">이 이메일로 재설정 안내를 보낼까요?</h3>
          <p><strong>{{ selected.display_name || '이름 미등록' }}</strong><br><span>{{ selected.email }}</span></p>
          <p class="account-footnote">선생님이 메일에서 직접 새 비밀번호를 정할 수 있어요. 현재 비밀번호가 즉시 변경되지는 않아요.</p>
          <div class="admin-confirm-actions"><button class="account-secondary" :disabled="pending" @click="selected = null">취소</button><button ref="confirmButton" class="account-primary" :disabled="pending" @click="confirmReset"><Mail :size="17" />{{ pending ? '보내는 중…' : '재설정 메일 보내기' }}</button></div>
        </section>

        <div class="admin-results" aria-live="polite" :aria-busy="pending">
          <template v-if="searched">
            <p class="admin-result-count">검색 결과 <strong>{{ results.length }}</strong>명<span v-if="results.length >= 20"> · 최대 20명까지 표시해요. 검색어를 더 자세히 입력해 주세요.</span></p>
            <ul v-if="results.length" class="admin-user-list">
              <li v-for="account in results" :key="account.user_id" class="admin-user-card"><div class="admin-user-details"><strong>{{ account.display_name || '이름 미등록' }}</strong><span>{{ account.email }}</span><small>가입일 {{ readableDate(account.created_at) }}</small></div><button class="account-secondary" :disabled="pending" @click="selectAccount(account)">비밀번호 재설정</button></li>
            </ul>
            <p v-else class="admin-empty">일치하는 계정이 없어요. 이름이나 이메일을 다시 확인해 주세요.</p>
          </template>
          <p v-else-if="!pending" class="admin-empty">도움이 필요한 선생님의 계정을 검색해 주세요.</p>
        </div>
      </template>
    </div>
  </dialog>
</template>
