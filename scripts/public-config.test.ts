import { describe, expect, it } from 'vitest'
import { validatePublicConfig } from './public-config.mjs'

describe('공개 배포 설정', () => {
  const url = 'https://project.example.test'
  it('프로젝트 연결 전에는 비로그인 탐색용 빌드를 허용한다', () => {
    expect(() => validatePublicConfig({})).not.toThrow()
  })
  it('브라우저 공개키를 허용한다', () => {
    expect(() => validatePublicConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public_test_key' })).not.toThrow()
  })
  it('서버 비밀키와 부분 설정은 빌드 전에 거절한다', () => {
    expect(() => validatePublicConfig({ VITE_SUPABASE_URL: url })).toThrow()
    expect(() => validatePublicConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_do_not_bundle' })).toThrow()
    const payload = btoa(JSON.stringify({ role: 'service_role' }))
    expect(() => validatePublicConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: `header.${payload}.signature` })).toThrow()
  })
})
