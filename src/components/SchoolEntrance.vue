<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowRight, BookOpen, CheckCircle2, Library, LockKeyhole, RefreshCw, ShieldCheck } from 'lucide-vue-next'
import { useAccount } from '../account'

const emit = defineEmits<{ signin: []; password: [] }>()
const { configured, user, authReady, authBusy, accessReady, schoolAccessError, authNotice, refreshSchoolAccess, signOut } = useAccount()
const error = ref('')
const checking = computed(() => !authReady.value || Boolean(user.value && !accessReady.value))
async function retry() {
  error.value = ''
  await refreshSchoolAccess()
}
async function logout() {
  error.value = ''
  try { await signOut() } catch (cause) { error.value = cause instanceof Error ? cause.message : '로그아웃하지 못했어요. 다시 시도해 주세요.' }
}
</script>

<template>
  <main class="school-entrance" aria-labelledby="entrance-title">
    <a class="brand entrance-brand" href="#" @click.prevent><span class="brand-icon"><Library :size="25" :stroke-width="1.8" /></span><span>문제서재<span class="brand-dot">.</span></span></a>
    <section class="entrance-card">
      <span class="entrance-emblem"><ShieldCheck v-if="user" :size="31" /><LockKeyhole v-else :size="31" /></span>
      <p class="entrance-eyebrow">GOYANG FOREIGN LANGUAGE HIGH SCHOOL</p>
      <template v-if="!configured">
        <h1 id="entrance-title">학교 서재를 준비하고 있어요</h1>
        <p class="entrance-description">서재 연결 설정이 필요합니다.<br>사이트 관리자에게 문의해 주세요.</p>
      </template>
      <template v-else-if="checking">
        <h1 id="entrance-title">서재 이용 권한을 확인하고 있어요</h1>
        <p class="entrance-description" role="status">잠시만 기다려 주세요.</p>
      </template>
      <template v-else-if="user">
        <h1 id="entrance-title">{{ schoolAccessError ? '이용 권한을 다시 확인해 주세요' : '관리자 승인을 기다리고 있어요' }}</h1>
        <p class="entrance-description">{{ schoolAccessError || '고양외고 교직원 확인 후 관리자가 서재 이용을 승인합니다. 승인 후 아래 버튼을 눌러 주세요.' }}</p>
        <p class="entrance-account">{{ user.email }}</p>
        <button class="entrance-primary" :disabled="authBusy" @click="retry"><RefreshCw :size="19" /> 승인 상태 다시 확인</button>
        <div class="entrance-secondary"><button :disabled="authBusy" @click="emit('password')">비밀번호 변경</button><button :disabled="authBusy" @click="logout">로그아웃</button></div>
      </template>
      <template v-else>
        <h1 id="entrance-title">우리 학교 선생님들의<br><span>수업 준비 공간</span></h1>
        <p class="entrance-description">고양외고 교직원 전용 문제서재입니다.<br>로그인하고 수업에 필요한 문제를 찾아보세요.</p>
        <button class="entrance-primary" @click="emit('signin')">로그인하고 입장하기 <ArrowRight :size="20" /></button>
        <p class="entrance-signup">처음 이용하시나요? 로그인 창에서 회원가입 후<br>관리자 승인을 받으면 입장할 수 있어요.</p>
      </template>
      <p v-if="error || authNotice" class="account-error" role="alert">{{ error || authNotice }}</p>
      <div class="entrance-features"><span><BookOpen :size="18" /> 과목·키워드별 문제 찾기</span><span><CheckCircle2 :size="18" /> 내 계정에 문제 저장</span></div>
    </section>
    <p class="entrance-credit">제작자 고양외고 이재인</p>
  </main>
</template>
