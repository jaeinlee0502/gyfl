import { effectScope, type EffectScope } from 'vue'
import type { User } from '@supabase/supabase-js'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ from: vi.fn(), read: vi.fn(), upsert: vi.fn(), remove: vi.fn() }))

vi.mock('./lib/supabase', () => ({ supabase: { from: db.from } }))
vi.mock('./account', async () => {
  const { ref } = await import('vue')
  const state = {
    user: ref<User | null>(null), authReady: ref(true), accessReady: ref(true),
    isSchoolMember: ref(true), isAdmin: ref(false),
  }
  return { useAccount: () => state }
})

import { useAccount } from './account'
import { useBookmarks } from './bookmarks'

const identity = useAccount()
const first = 'demo-history-1'
const second = 'demo-history-2'
const scopes: EffectScope[] = []
function account(id: string) { return { id, email: `${id}@example.test` } as User }
function createStore() {
  const scope = effectScope()
  scopes.push(scope)
  return scope.run(useBookmarks)!
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  localStorage.clear()
  identity.user.value = null
  identity.authReady.value = true
  identity.accessReady.value = true
  identity.isSchoolMember.value = true
  identity.isAdmin.value = false
  vi.clearAllMocks()
  db.read.mockResolvedValue({ data: [], error: null })
  db.upsert.mockResolvedValue({ error: null })
  db.remove.mockResolvedValue({ error: null })
  db.from.mockImplementation(() => ({
    select: () => ({ eq: (_column: string, id: string) => db.read(id) }),
    upsert: db.upsert,
    delete: () => ({ eq: (_column: string, id: string) => ({ eq: (_questionColumn: string, questionId: string) => db.remove(id, questionId) }) }),
  }))
})

afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop())
})

describe('계정별 북마크', () => {
  it('학교 이용이 승인된 계정끼리 저장 목록을 분리하고 로그아웃하면 숨긴다', async () => {
    localStorage.setItem('gyfl-bookmarks-v1', JSON.stringify([first]))
    const store = createStore()
    expect(store.saved.value).toEqual([])
    expect(store.guestToImport.value).toEqual([])
    expect(store.disabled.value).toBe(true)
    expect(db.read).not.toHaveBeenCalled()
    db.read.mockImplementation((id: string) => Promise.resolve({ data: [{ question_id: id === 'teacher-a' ? second : first }], error: null }))
    identity.user.value = account('teacher-a')
    expect(store.saved.value).toEqual([])
    await flushPromises()
    expect(store.saved.value).toEqual([second])
    expect(db.upsert).not.toHaveBeenCalled()
    identity.user.value = account('teacher-b')
    expect(store.saved.value).toEqual([])
    await flushPromises()
    expect(store.saved.value).toEqual([first])
    identity.user.value = null
    expect(store.saved.value).toEqual([])
    expect(store.guestToImport.value).toEqual([])
    expect(store.disabled.value).toBe(true)
  })

  it('비로그인과 승인 대기 계정은 조회·저장·가져오기를 하지 않고 승인 후 불러온다', async () => {
    localStorage.setItem('gyfl-bookmarks-v1', JSON.stringify([first]))
    identity.isSchoolMember.value = false
    const store = createStore()
    await store.toggleSaved(first)
    await store.importGuestSaved()
    expect(db.from).not.toHaveBeenCalled()
    identity.user.value = account('pending-teacher')
    await flushPromises()
    await store.reloadSaved()
    await store.toggleSaved(second)
    await store.importGuestSaved()
    expect(store.saved.value).toEqual([])
    expect(store.guestToImport.value).toEqual([])
    expect(store.disabled.value).toBe(true)
    expect(db.from).not.toHaveBeenCalled()
    expect(localStorage.getItem('gyfl-bookmarks-v1')).toBe(JSON.stringify([first]))

    db.read.mockResolvedValue({ data: [{ question_id: second }], error: null })
    identity.isSchoolMember.value = true
    await flushPromises()
    expect(db.read).toHaveBeenCalledExactlyOnceWith('pending-teacher')
    expect(store.saved.value).toEqual([second])
    expect(store.guestToImport.value).toEqual([first])
    expect(store.disabled.value).toBe(false)
  })

  it('관리자는 학교 회원 행이 없어도 권한 확인이 완료되면 계정 저장을 이용한다', async () => {
    identity.isSchoolMember.value = false
    identity.user.value = account('school-admin')
    identity.isAdmin.value = true
    identity.accessReady.value = false
    const store = createStore()
    expect(db.read).not.toHaveBeenCalled()
    expect(store.disabled.value).toBe(true)
    identity.accessReady.value = true
    await flushPromises()
    expect(db.read).toHaveBeenCalledExactlyOnceWith('school-admin')
    await store.toggleSaved(first)
    expect(store.saved.value).toEqual([first])
  })

  it('승인이 철회되면 즉시 목록과 대기 상태를 지우고 늦은 조회 응답을 무시한다', async () => {
    identity.user.value = account('teacher-a')
    db.read.mockResolvedValueOnce({ data: [{ question_id: first }], error: null })
    const store = createStore()
    await flushPromises()
    expect(store.saved.value).toEqual([first])
    const pendingRead = deferred<{ data: { question_id: string }[]; error: null }>()
    db.read.mockReturnValueOnce(pendingRead.promise)
    const reload = store.reloadSaved()
    identity.isSchoolMember.value = false
    expect(store.saved.value).toEqual([])
    expect(store.loading.value).toBe(false)
    expect(store.pending.value).toEqual([])
    expect(store.disabled.value).toBe(true)
    pendingRead.resolve({ data: [{ question_id: second }], error: null })
    await reload
    await store.toggleSaved(second)
    await store.importGuestSaved()
    expect(store.saved.value).toEqual([])
    expect(db.upsert).not.toHaveBeenCalled()
  })

  it('저장 중 권한 확인이 다시 시작되면 늦은 저장 응답이 목록을 되살리지 않는다', async () => {
    identity.user.value = account('teacher-a')
    const store = createStore()
    await flushPromises()
    const pendingWrite = deferred<{ error: null }>()
    db.upsert.mockReturnValueOnce(pendingWrite.promise)
    const saving = store.toggleSaved(first)
    expect(store.pending.value).toEqual([first])
    identity.accessReady.value = false
    expect(store.pending.value).toEqual([])
    expect(store.disabled.value).toBe(true)
    pendingWrite.resolve({ error: null })
    await saving
    expect(store.saved.value).toEqual([])
    expect(store.pending.value).toEqual([])
  })

  it('다른 계정으로 전환한 뒤 도착한 이전 계정의 조회 결과를 무시한다', async () => {
    const previous = deferred<{ data: { question_id: string }[]; error: null }>()
    db.read.mockImplementation((id: string) => id === 'teacher-a' ? previous.promise : Promise.resolve({ data: [{ question_id: second }], error: null }))
    const store = createStore()
    identity.user.value = account('teacher-a')
    expect(store.loading.value).toBe(true)
    identity.user.value = account('teacher-b')
    await flushPromises()
    expect(store.saved.value).toEqual([second])
    previous.resolve({ data: [{ question_id: first }], error: null })
    await flushPromises()
    expect(store.saved.value).toEqual([second])
    expect(store.loading.value).toBe(false)
  })

  it('클라우드 저장이 실패하면 저장 표시를 바꾸지 않고 오류를 알린다', async () => {
    const store = createStore()
    identity.user.value = account('teacher-a')
    await flushPromises()
    db.upsert.mockResolvedValue({ error: { message: 'network unavailable' } })
    await store.toggleSaved(first)
    expect(store.saved.value).toEqual([])
    expect(store.pending.value).toEqual([])
    expect(store.message.value).toContain('계정에 저장하지 못했어요')
    expect(localStorage.getItem('gyfl-bookmarks-v1')).toBeNull()
  })

  it('사용자가 가져오기를 선택해야만 게스트 북마크를 현재 계정에 추가한다', async () => {
    localStorage.setItem('gyfl-bookmarks-v1', JSON.stringify([first, second]))
    db.read.mockResolvedValue({ data: [{ question_id: second }], error: null })
    const store = createStore()
    identity.user.value = account('teacher-a')
    await flushPromises()
    expect(store.saved.value).toEqual([second])
    expect(store.guestToImport.value).toEqual([first])
    expect(db.upsert).not.toHaveBeenCalled()
    await store.importGuestSaved()
    expect(db.upsert).toHaveBeenCalledExactlyOnceWith([{ user_id: 'teacher-a', question_id: first }], { onConflict: 'user_id,question_id', ignoreDuplicates: true })
    expect(store.saved.value).toEqual([second, first])
    expect(JSON.parse(localStorage.getItem('gyfl-bookmarks-v1')!)).toEqual([first, second])
  })

  it('조회 실패 중에는 쓰기를 막고 다시 불러오기에 성공하면 저장할 수 있다', async () => {
    db.read.mockResolvedValueOnce({ data: null, error: { message: 'read failed' } })
    const store = createStore()
    identity.user.value = account('teacher-a')
    await flushPromises()
    expect(store.loadFailed.value).toBe(true)
    expect(store.disabled.value).toBe(true)
    await store.toggleSaved(first)
    expect(db.upsert).not.toHaveBeenCalled()
    await store.reloadSaved()
    expect(store.loadFailed.value).toBe(false)
    expect(store.disabled.value).toBe(false)
    await store.toggleSaved(first)
    expect(store.saved.value).toEqual([first])
  })

  it('이전 계정의 늦은 저장 응답이 현재 계정의 목록을 바꾸지 않는다', async () => {
    const pendingWrite = deferred<{ error: null }>()
    db.upsert.mockReturnValue(pendingWrite.promise)
    db.read.mockImplementation((id: string) => Promise.resolve({ data: id === 'teacher-b' ? [{ question_id: second }] : [], error: null }))
    const store = createStore()
    identity.user.value = account('teacher-a')
    await flushPromises()
    const saving = store.toggleSaved(first)
    identity.user.value = account('teacher-b')
    await flushPromises()
    pendingWrite.resolve({ error: null })
    await saving
    expect(store.saved.value).toEqual([second])
    expect(store.pending.value).toEqual([])
  })

  it('이전 계정의 가져오기가 끝나도 새 계정의 가져오기 상태나 목록은 바꾸지 않는다', async () => {
    localStorage.setItem('gyfl-bookmarks-v1', JSON.stringify([first]))
    const previous = deferred<{ error: null }>()
    const current = deferred<{ error: null }>()
    db.upsert.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise)
    const store = createStore()
    identity.user.value = account('teacher-a')
    await flushPromises()
    const firstImport = store.importGuestSaved()
    identity.user.value = account('teacher-b')
    await flushPromises()
    const nextImport = store.importGuestSaved()
    previous.resolve({ error: null })
    await firstImport
    expect(store.importing.value).toBe(true)
    expect(store.saved.value).toEqual([])
    current.resolve({ error: null })
    await nextImport
    expect(store.importing.value).toBe(false)
    expect(store.saved.value).toEqual([first])
  })
})
