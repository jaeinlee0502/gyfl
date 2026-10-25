<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowLeft, BookOpen, CheckCircle2, Eye, EyeOff, LockKeyhole, UserRound, X } from 'lucide-vue-next'
import { useAccount } from '../account'

const props = withDefaults(defineProps<{ mode?: 'signin' | 'password' }>(), { mode: 'signin' })
const emit = defineEmits<{ close: [] }>()
const {
  configured, user, authReady, authBusy, recoveryMode, recoveryLinkError, authNotice,
  signIn, signUp, updatePassword, clearRecovery,
} = useAccount()
type View = 'signin' | 'signup' | 'forgot' | 'password' | 'complete'
const view = ref<View>(props.mode === 'password' || recoveryMode.value ? 'password' : recoveryLinkError?.value ? 'forgot' : 'signin')
const dialog = ref<HTMLDialogElement | null>(null)
const email = ref('')
const displayName = ref('')
const password = ref('')
const confirmation = ref('')
const showPassword = ref(false)
const pending = ref(false)
const error = ref('')
const notice = ref('')
const unavailable = computed(() => !configured || !authReady.value || authBusy.value || pending.value || (view.value === 'password' && !user.value))
const title = computed(() => ({ signin: '나의 문제서재에 로그인', signup: '선생님의 서재 만들기', forgot: '아이디 · 비밀번호 찾기', password: '새 비밀번호 설정', complete: '비밀번호를 변경했어요' })[view.value])
const subtitle = computed(() => ({
  signin: '고양외고 교직원 전용 서재입니다. 로그인 후 승인된 계정으로 입장할 수 있어요.',
  signup: '이메일을 로그인 아이디로 사용해요. 회원가입 후 관리자 승인을 받으면 서재에 입장할 수 있어요.',
  forgot: '관리자에게 이름과 아이디를 알려주고 계정 확인이나 비밀번호 초기화를 요청해 주세요.',
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
        error.value = '가입 설정이 아직 완료되지 않았어요. 관리자에게 문의해 주세요.'
      } else close()
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
watch(() => props.mode, value => changeView(value === 'password' ? 'password' : 'signin'))
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

      <div v-if="!configured" class="account-notice" role="status">계정 기능을 준비 중이에요. 학교 서재 연결은 관리자에게 문의해 주세요.</div>
      <div v-if="authNotice" class="account-error" role="alert">{{ authNotice }}</div>
      <div v-if="notice" class="account-notice" role="status">{{ notice }}</div>
      <div v-if="error" id="account-error" class="account-error" role="alert">{{ error }}</div>

      <template v-if="view === 'complete'">
        <button class="account-primary" @click="close">서재로 돌아가기</button>
      </template>
      <template v-else-if="view === 'forgot'">
        <div class="account-support-guidance">
          <p>관리자는 본인 확인 후 임시 비밀번호를 직접 전달할 수 있어요.</p>
          <p>아이디도 기억나지 않으면 가입할 때 사용한 이름 또는 별명을 함께 알려 주세요.</p>
          <p>임시 비밀번호로 로그인한 뒤, 상단 계정 메뉴의 <strong>비밀번호 변경</strong>에서 새 비밀번호를 정해 주세요.</p>
        </div>
        <button class="account-text-button" @click="changeView('signin')"><ArrowLeft :size="15" /> 로그인으로 돌아가기</button>
      </template>
      <template v-else>
        <div v-if="view === 'signin' || view === 'signup'" class="account-tabs" aria-label="계정 이용 방법">
          <button :class="{ active: view === 'signin' }" :aria-pressed="view === 'signin'" :disabled="pending" @click="changeView('signin')">로그인</button>
          <button :class="{ active: view === 'signup' }" :aria-pressed="view === 'signup'" :disabled="pending" @click="changeView('signup')">회원가입</button>
        </div>
        <form class="account-form" :aria-busy="pending" :aria-describedby="error ? 'account-error' : undefined" @submit.prevent="submit">
          <label v-if="view === 'signup'" class="account-field" for="account-name"><span>이름</span><input id="account-name" v-model="displayName" name="displayName" autocomplete="name" minlength="2" maxlength="50" required placeholder="교직원 확인을 위한 이름을 입력해 주세요" :disabled="pending"></label>
          <label v-if="view !== 'password'" class="account-field" for="account-email"><span>이메일 아이디</span><input id="account-email" v-model="email" name="email" type="email" :autocomplete="view === 'signin' ? 'username' : 'email'" inputmode="email" maxlength="254" required placeholder="teacher@example.com" :disabled="pending" autocapitalize="none" spellcheck="false"></label>
          <p v-else-if="user?.email" class="account-recovery-email"><UserRound :size="17" />{{ user.email }}</p>
          <label class="account-field" for="account-password"><span>{{ view === 'password' ? '새 비밀번호' : '비밀번호' }}</span><span class="account-password-input"><input id="account-password" v-model="password" name="password" :type="showPassword ? 'text' : 'password'" :autocomplete="view === 'signin' ? 'current-password' : 'new-password'" :minlength="view === 'signin' ? undefined : 10" maxlength="128" required :placeholder="view === 'signin' ? '비밀번호를 입력해 주세요' : '10자 이상 입력해 주세요'" :disabled="pending"><button type="button" class="account-password-toggle" :aria-label="showPassword ? '비밀번호 숨기기' : '비밀번호 표시'" :aria-pressed="showPassword" @click="showPassword = !showPassword"><EyeOff v-if="showPassword" :size="19" /><Eye v-else :size="19" /></button></span></label>
          <label v-if="view === 'signup' || view === 'password'" class="account-field" for="account-confirmation"><span>비밀번호 확인</span><input id="account-confirmation" v-model="confirmation" name="passwordConfirmation" :type="showPassword ? 'text' : 'password'" autocomplete="new-password" minlength="10" maxlength="128" required placeholder="같은 비밀번호를 한 번 더 입력해 주세요" :disabled="pending"></label>
          <button class="account-primary" type="submit" :disabled="unavailable">{{ pending || authBusy ? '처리 중이에요…' : !authReady && configured ? '계정 확인 중…' : view === 'signin' ? '로그인' : view === 'signup' ? '가입하고 승인 요청하기'  : '비밀번호 변경하기' }}</button>
        </form>
        <div class="account-form-footer">
          <button v-if="view === 'signin'" class="account-text-button" :disabled="pending" @click="changeView('forgot')">이메일 아이디 · 비밀번호를 잊으셨나요?</button>
          <p v-if="view === 'signup'" class="account-footnote">이메일은 로그인 아이디로만 사용하며, 인증 메일을 보내지 않아요.</p>
        </div>
      </template>
    </div>
  </dialog>
</template>
