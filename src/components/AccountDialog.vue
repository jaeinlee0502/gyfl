<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowLeft, BookOpen, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail, X } from 'lucide-vue-next'
import { useAccount } from '../account'

const emit = defineEmits<{ close: [] }>()
const {
  configured, user, authReady, authBusy, recoveryMode, recoveryLinkError, authNotice,
  signIn, signUp, requestPasswordReset, updatePassword, clearRecovery,
} = useAccount()
type View = 'signin' | 'signup' | 'forgot' | 'password' | 'complete'
const view = ref<View>(recoveryMode.value ? 'password' : recoveryLinkError?.value ? 'forgot' : 'signin')
const dialog = ref<HTMLDialogElement | null>(null)
const email = ref('')
const displayName = ref('')
const password = ref('')
const confirmation = ref('')
const showPassword = ref(false)
const pending = ref(false)
const error = ref('')
const notice = ref('')
const unavailable = computed(() => !configured || !authReady.value || authBusy.value || pending.value)
const title = computed(() => ({ signin: '나의 문제서재에 로그인', signup: '선생님의 서재 만들기', forgot: '비밀번호를 잊으셨나요?', password: '새 비밀번호 설정', complete: '비밀번호를 변경했어요' })[view.value])
const subtitle = computed(() => ({
  signin: '문제 탐색은 누구나 자유롭게. 로그인하면 저장한 문제를 다른 기기에서도 볼 수 있어요.',
  signup: '이메일을 아이디로 사용해요. 수업에 필요한 문제를 나만의 서재에 모아보세요.',
  forgot: '가입한 이메일로 비밀번호를 다시 정할 수 있는 링크를 보내드려요.',
  password: '다른 곳에서 사용하지 않은 새 비밀번호를 정해 주세요.',
  complete: '이제 새 비밀번호로 로그인할 수 있어요.',
})[view.value])

function changeView(next: View) {
  view.value = next
  error.value = ''
  notice.value = ''
  password.value = ''
  confirmation.value = ''
  showPassword.value = false
}

function close() { emit('close') }
function backdrop(event: MouseEvent) {
  if (event.target !== dialog.value) return
  const rect = dialog.value?.getBoundingClientRect()
  if (rect && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) close()
}

async function submit() {
  if (unavailable.value) return
  error.value = ''
  notice.value = ''
  if ((view.value === 'signup' || view.value === 'password') && password.value.length < 10) {
    error.value = '비밀번호를 10자 이상 입력해 주세요.'
    return
  }
  if ((view.value === 'signup' || view.value === 'password') && password.value !== confirmation.value) {
    error.value = '비밀번호와 확인 입력이 일치하지 않아요.'
    return
  }
  pending.value = true
  try {
    if (view.value === 'signin') {
      await signIn(email.value.trim(), password.value)
      close()
    } else if (view.value === 'signup') {
      const result = await signUp(email.value.trim(), password.value, displayName.value.trim())
      password.value = ''
      confirmation.value = ''
      if (result.needsEmailConfirmation) {
        changeView('signin')
        notice.value = '가입 확인 메일을 보냈어요. 이메일의 확인 링크를 누른 뒤 로그인해 주세요.'
      } else close()
    } else if (view.value === 'forgot') {
      await requestPasswordReset(email.value.trim())
      notice.value = '가입된 이메일이라면 재설정 안내를 보내드렸어요. 스팸 메일함도 확인해 주세요.'
    } else if (view.value === 'password') {
      await updatePassword(password.value)
      clearRecovery()
      changeView('complete')
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '잠시 후 다시 시도해 주세요.'
  } finally { pending.value = false }
}

watch(recoveryMode, value => { if (value) changeView('password') })
onMounted(() => { dialog.value?.showModal() })
onBeforeUnmount(() => { if (dialog.value?.open) dialog.value.close() })
</script>

<template>
  <dialog ref="dialog" class="account-dialog" aria-labelledby="account-title" aria-describedby="account-description" @cancel.prevent="close" @click="backdrop">
    <div class="account-dialog-content">
      <button class="account-close" aria-label="계정 창 닫기" @click="close"><X :size="22" /></button>
      <span class="account-emblem"><CheckCircle2 v-if="view === 'complete'" :size="25" /><LockKeyhole v-else-if="view === 'forgot' || view === 'password'" :size="25" /><BookOpen v-else :size="25" /></span>
      <span class="account-eyebrow">MY QUESTION LIBRARY</span>
      <h2 id="account-title">{{ title }}</h2>
      <p id="account-description" class="account-description">{{ subtitle }}</p>

      <div v-if="!configured" class="account-notice" role="status">계정 기능을 준비 중이에요. 문제 탐색은 계속 이용할 수 있어요.</div>
      <div v-if="authNotice" class="account-error" role="alert">{{ authNotice }}</div>
      <div v-if="notice" class="account-notice" role="status">{{ notice }}</div>
      <div v-if="error" id="account-error" class="account-error" role="alert">{{ error }}</div>

      <template v-if="view === 'complete'">
        <button class="account-primary" @click="close">서재로 돌아가기</button>
      </template>
      <template v-else>
        <div v-if="view === 'signin' || view === 'signup'" class="account-tabs" aria-label="계정 이용 방법">
          <button :class="{ active: view === 'signin' }" :aria-pressed="view === 'signin'" :disabled="pending" @click="changeView('signin')">로그인</button>
          <button :class="{ active: view === 'signup' }" :aria-pressed="view === 'signup'" :disabled="pending" @click="changeView('signup')">회원가입</button>
        </div>
        <form class="account-form" :aria-busy="pending" :aria-describedby="error ? 'account-error' : undefined" @submit.prevent="submit">
          <label v-if="view === 'signup'" class="account-field" for="account-name"><span>이름 또는 별명</span><input id="account-name" v-model="displayName" name="displayName" autocomplete="nickname" minlength="2" maxlength="50" required placeholder="예: 김역사 선생님" :disabled="pending"></label>
          <label v-if="view !== 'password'" class="account-field" for="account-email"><span>이메일 아이디</span><input id="account-email" v-model="email" name="email" type="email" :autocomplete="view === 'signin' ? 'username' : 'email'" inputmode="email" maxlength="254" required placeholder="teacher@example.com" :disabled="pending" autocapitalize="none" spellcheck="false"></label>
          <p v-else-if="user?.email" class="account-recovery-email"><Mail :size="17" />{{ user.email }}</p>
          <label v-if="view !== 'forgot'" class="account-field" for="account-password"><span>{{ view === 'password' ? '새 비밀번호' : '비밀번호' }}</span><span class="account-password-input"><input id="account-password" v-model="password" name="password" :type="showPassword ? 'text' : 'password'" :autocomplete="view === 'signin' ? 'current-password' : 'new-password'" :minlength="view === 'signin' ? undefined : 10" maxlength="128" required :placeholder="view === 'signin' ? '비밀번호를 입력해 주세요' : '10자 이상 입력해 주세요'" :disabled="pending"><button type="button" class="account-password-toggle" :aria-label="showPassword ? '비밀번호 숨기기' : '비밀번호 표시'" :aria-pressed="showPassword" @click="showPassword = !showPassword"><EyeOff v-if="showPassword" :size="19" /><Eye v-else :size="19" /></button></span></label>
          <label v-if="view === 'signup' || view === 'password'" class="account-field" for="account-confirmation"><span>비밀번호 확인</span><input id="account-confirmation" v-model="confirmation" name="passwordConfirmation" :type="showPassword ? 'text' : 'password'" autocomplete="new-password" minlength="10" maxlength="128" required placeholder="같은 비밀번호를 한 번 더 입력해 주세요" :disabled="pending"></label>
          <button class="account-primary" type="submit" :disabled="unavailable">{{ pending || authBusy ? '처리 중이에요…' : !authReady && configured ? '계정 확인 중…' : view === 'signin' ? '로그인' : view === 'signup' ? '서재 만들기' : view === 'forgot' ? '재설정 메일 받기' : '비밀번호 변경하기' }}</button>
        </form>
        <div class="account-form-footer">
          <button v-if="view === 'signin'" class="account-text-button" :disabled="pending" @click="changeView('forgot')">이메일 아이디 · 비밀번호를 잊으셨나요?</button>
          <button v-if="view === 'forgot'" class="account-text-button" :disabled="pending" @click="changeView('signin')"><ArrowLeft :size="15" /> 로그인으로 돌아가기</button>
          <p v-if="view === 'forgot'" class="account-footnote">이메일 아이디가 기억나지 않으면 사이트 관리자에게 이름과 함께 문의해 주세요. 본인 확인 후 가입 이메일을 안내받을 수 있어요.</p>
          <p v-if="view === 'signup'" class="account-footnote">이메일 확인이 필요할 수 있어요. 안내 메일을 받을 수 있는 주소를 사용해 주세요.</p>
        </div>
      </template>
    </div>
  </dialog>
</template>
