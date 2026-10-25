// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminError, createAdminHandler, type AdminDependencies } from './core';

const actorId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const profile = { user_id: targetId, email: 'teacher@example.test', display_name: '김선생', created_at: '2026-10-25T00:00:00Z', approved: false, is_admin: false };
let dependencies: AdminDependencies;

function request(body: unknown, extra: { token?: string | null; origin?: string; method?: string } = {}) {
  const headers = new Headers({ 'content-type': 'application/json', origin: extra.origin || 'https://jaeinlee0502.github.io' });
  if (extra.token !== null) headers.set('authorization', `Bearer ${extra.token || 'verified-token'}`);
  const method = extra.method || 'POST';
  return new Request('https://project.supabase.co/functions/v1/account-admin', { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined });
}

beforeEach(() => {
  dependencies = {
    allowedOrigins: ['https://jaeinlee0502.github.io'],
    verifyUser: vi.fn().mockResolvedValue({ id: actorId }),
    isAdmin: vi.fn().mockImplementation(async (id: string) => id === actorId),
    searchProfiles: vi.fn().mockResolvedValue([profile]),
    listMembers: vi.fn().mockResolvedValue([profile]),
    getProfile: vi.fn().mockResolvedValue(profile),
    setMembership: vi.fn().mockResolvedValue(undefined),
    reserveAction: vi.fn().mockResolvedValue('reservation-id'),
    updatePassword: vi.fn().mockResolvedValue(undefined),
    deleteAccount: vi.fn().mockResolvedValue(undefined),
    recordActionResult: vi.fn().mockResolvedValue(undefined),
  };
});

describe('관리자 계정 지원 서버 권한', () => {
  it('로그인 정보가 없으면 계정 조회를 수행하지 않는다', async () => {
    const response = await createAdminHandler(dependencies)(request({ action: 'search', query: 'teacher', field: 'email' }, { token: null }));
    expect(response.status).toBe(401);
    expect(dependencies.verifyUser).not.toHaveBeenCalled();
    expect(dependencies.searchProfiles).not.toHaveBeenCalled();
  });

  it('서버에서 검증되지 않은 토큰을 거절한다', async () => {
    vi.mocked(dependencies.verifyUser).mockResolvedValue(null);
    const response = await createAdminHandler(dependencies)(request({ action: 'search', query: 'teacher', field: 'email' }, { token: 'forged-token' }));
    expect(response.status).toBe(401);
    expect(dependencies.verifyUser).toHaveBeenCalledWith('forged-token');
    expect(dependencies.isAdmin).not.toHaveBeenCalled();
  });

  it('일반 사용자가 관리자 플래그를 보내도 계정 검색을 거절한다', async () => {
    vi.mocked(dependencies.isAdmin).mockResolvedValue(false);
    const response = await createAdminHandler(dependencies)(request({ action: 'search', query: 'teacher', field: 'email', isAdmin: true }));
    expect(response.status).toBe(403);
    expect(dependencies.isAdmin).toHaveBeenCalledWith(actorId);
    expect(dependencies.searchProfiles).not.toHaveBeenCalled();
  });

  it('일반 사용자가 계정 ID를 알아도 비밀번호를 초기화할 수 없다', async () => {
    vi.mocked(dependencies.isAdmin).mockResolvedValue(false);
    const response = await createAdminHandler(dependencies)(request({ action: 'reset-password', userId: targetId }));
    expect(response.status).toBe(403);
    expect(dependencies.getProfile).not.toHaveBeenCalled();
    expect(dependencies.updatePassword).not.toHaveBeenCalled();
  });

  it('검증된 관리자에게만 검색 결과를 돌려준다', async () => {
    const response = await createAdminHandler(dependencies)(request({ action: 'search', query: '  김선생  ', field: 'name' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ users: [profile] });
    expect(dependencies.searchProfiles).toHaveBeenCalledWith('김선생', 'name');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('관리자는 검색어 없이 승인 대기 계정 목록을 조회한다', async () => {
    const response = await createAdminHandler(dependencies)(request({ action: 'list-members' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ users: [profile] });
    expect(dependencies.listMembers).toHaveBeenCalledOnce();
    expect(dependencies.searchProfiles).not.toHaveBeenCalled();
  });

  it('일반 계정은 대기 목록을 읽거나 자기를 승인할 수 없다', async () => {
    vi.mocked(dependencies.isAdmin).mockResolvedValue(false);
    const handler = createAdminHandler(dependencies);
    for (const body of [{ action: 'list-members' }, { action: 'approve-member', userId: actorId, approved: true }]) {
      expect((await handler(request(body))).status).toBe(403);
    }
    expect(dependencies.listMembers).not.toHaveBeenCalled();
    expect(dependencies.setMembership).not.toHaveBeenCalled();
  });

  it('승인과 승인 해제는 검증한 관리자와 대상 계정으로만 수행한다', async () => {
    const handler = createAdminHandler(dependencies);
    const approved = await handler(request({ action: 'approve-member', userId: targetId, actorId: 'forged' }));
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({ approved: true });
    expect(dependencies.setMembership).toHaveBeenCalledWith(actorId, targetId, true);
    const revoked = await handler(request({ action: 'revoke-member', userId: targetId }));
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({ approved: false });
    expect(dependencies.setMembership).toHaveBeenCalledWith(actorId, targetId, false);
    expect(dependencies.reserveAction).not.toHaveBeenCalled();
    expect(dependencies.updatePassword).not.toHaveBeenCalled();
    expect(dependencies.deleteAccount).not.toHaveBeenCalled();
  });

  it('승인 대상은 올바른 UUID와 실제 계정이어야 한다', async () => {
    const handler = createAdminHandler(dependencies);
    expect((await handler(request({ action: 'approve-member', userId: 'invalid' }))).status).toBe(400);
    vi.mocked(dependencies.getProfile).mockResolvedValue(null);
    expect((await handler(request({ action: 'approve-member', userId: targetId }))).status).toBe(404);
    expect(dependencies.setMembership).not.toHaveBeenCalled();
  });

  it('자기 계정과 다른 관리자의 승인 상태는 바꾸지 못한다', async () => {
    const handler = createAdminHandler(dependencies);
    vi.mocked(dependencies.getProfile).mockResolvedValue({ ...profile, user_id: actorId, is_admin: true, approved: true });
    for (const action of ['approve-member', 'revoke-member']) {
      expect((await handler(request({ action, userId: actorId }))).status).toBe(403);
    }
    vi.mocked(dependencies.getProfile).mockResolvedValue({ ...profile, is_admin: true, approved: true });
    vi.mocked(dependencies.isAdmin).mockResolvedValue(true);
    expect((await handler(request({ action: 'revoke-member', userId: targetId }))).status).toBe(403);
    expect(dependencies.setMembership).not.toHaveBeenCalled();
  });

  it('승인 저장 실패를 성공으로 응답하거나 내부 오류를 노출하지 않는다', async () => {
    vi.mocked(dependencies.setMembership).mockRejectedValue(new Error('private server detail'));
    const response = await createAdminHandler(dependencies)(request({ action: 'approve-member', userId: targetId }));
    expect(response.status).toBe(502);
    const data = await response.json();
    expect(data.code).toBe('MEMBERSHIP_UPDATE_FAILED');
    expect(JSON.stringify(data)).not.toContain('private server detail');
  });

  it('짧은 검색어와 잘못된 검색 필드를 거절한다', async () => {
    const handler = createAdminHandler(dependencies);
    expect((await handler(request({ action: 'search', query: 'a', field: 'email' }))).status).toBe(400);
    expect((await handler(request({ action: 'search', query: 'teacher', field: 'role' }))).status).toBe(400);
    expect(dependencies.searchProfiles).not.toHaveBeenCalled();
  });

  it('클라이언트가 보낸 비밀번호 대신 서버에서 생성한 임시 비밀번호를 사용한다', async () => {
    const response = await createAdminHandler(dependencies)(request({ action: 'reset-password', userId: targetId, email: 'attacker@example.test', password: 'known-password', redirectTo: 'https://attacker.example.test/' }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.temporaryPassword).toMatch(/^Aa1![0-9a-f]{48}$/);
    expect(dependencies.reserveAction).toHaveBeenCalledWith(actorId, targetId, 'password_reset');
    expect(dependencies.updatePassword).toHaveBeenCalledWith(targetId, data.temporaryPassword);
    expect(dependencies.recordActionResult).toHaveBeenCalledWith('reservation-id', 'succeeded');
    expect(JSON.stringify(data)).not.toContain('known-password');
    // Passwords are passed only to Auth and the immediate HTTPS response.
    expect(JSON.stringify(vi.mocked(dependencies.recordActionResult).mock.calls)).not.toContain(data.temporaryPassword);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('작업은 성공했지만 최종 감사 상태 갱신이 실패해도 임시 비밀번호를 잃지 않는다', async () => {
    vi.mocked(dependencies.recordActionResult).mockRejectedValue(new Error('audit unavailable'));
    const response = await createAdminHandler(dependencies)(request({ action: 'reset-password', userId: targetId }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.temporaryPassword).toMatch(/^Aa1![0-9a-f]{48}$/);
    expect(data.auditPending).toBe(true);
    expect(dependencies.updatePassword).toHaveBeenCalledWith(targetId, data.temporaryPassword);
  });

  it('임시 비밀번호는 초기화 요청마다 다르게 생성한다', async () => {
    const handler = createAdminHandler(dependencies);
    const first = await (await handler(request({ action: 'reset-password', userId: targetId }))).json();
    const second = await (await handler(request({ action: 'reset-password', userId: targetId }))).json();
    expect(first.temporaryPassword).not.toEqual(second.temporaryPassword);
  });

  it('자기 계정과 다른 관리자 계정은 초기화하거나 삭제할 수 없다', async () => {
    const handler = createAdminHandler(dependencies);
    vi.mocked(dependencies.getProfile).mockResolvedValue({ ...profile, user_id: actorId });
    for (const action of ['reset-password', 'delete-account']) {
      expect((await handler(request({ action, userId: actorId, confirmEmail: profile.email }))).status).toBe(403);
    }
    vi.mocked(dependencies.getProfile).mockResolvedValue(profile);
    vi.mocked(dependencies.isAdmin).mockResolvedValue(true);
    expect((await handler(request({ action: 'reset-password', userId: targetId }))).status).toBe(403);
    expect((await handler(request({ action: 'delete-account', userId: targetId, confirmEmail: profile.email }))).status).toBe(403);
    expect(dependencies.reserveAction).not.toHaveBeenCalled();
    expect(dependencies.updatePassword).not.toHaveBeenCalled();
    expect(dependencies.deleteAccount).not.toHaveBeenCalled();
  });

  it('계정 삭제는 저장된 대상 이메일과 확인 입력이 일치해야 수행한다', async () => {
    const handler = createAdminHandler(dependencies);
    expect((await handler(request({ action: 'delete-account', userId: targetId }))).status).toBe(400);
    expect((await handler(request({ action: 'delete-account', userId: targetId, confirmEmail: 'other@example.test' }))).status).toBe(400);
    expect(dependencies.reserveAction).not.toHaveBeenCalled();
    expect(dependencies.deleteAccount).not.toHaveBeenCalled();
    const response = await handler(request({ action: 'delete-account', userId: targetId, confirmEmail: ' TEACHER@example.test ' }));
    expect(response.status).toBe(200);
    expect(dependencies.reserveAction).toHaveBeenCalledWith(actorId, targetId, 'account_delete');
    expect(dependencies.deleteAccount).toHaveBeenCalledWith(targetId);
    expect(dependencies.recordActionResult).toHaveBeenCalledWith('reservation-id', 'succeeded');
    expect((await response.json()).message).toContain('삭제');
  });

  it('일반 사용자는 확인 이메일을 알아도 삭제할 수 없다', async () => {
    vi.mocked(dependencies.isAdmin).mockResolvedValue(false);
    const response = await createAdminHandler(dependencies)(request({ action: 'delete-account', userId: targetId, confirmEmail: profile.email }));
    expect(response.status).toBe(403);
    expect(dependencies.deleteAccount).not.toHaveBeenCalled();
  });

  it('삭제 실패를 감사 기록에 남기고 성공으로 응답하지 않는다', async () => {
    vi.mocked(dependencies.deleteAccount).mockRejectedValue(new Error('private provider error'));
    const response = await createAdminHandler(dependencies)(request({ action: 'delete-account', userId: targetId, confirmEmail: profile.email }));
    expect(response.status).toBe(502);
    expect(dependencies.recordActionResult).toHaveBeenCalledWith('reservation-id', 'failed');
    expect(JSON.stringify(await response.json())).not.toContain('private provider error');
  });

  it('계정이 없으면 비밀번호를 바꾸지 않는다', async () => {
    vi.mocked(dependencies.getProfile).mockResolvedValue(null);
    const response = await createAdminHandler(dependencies)(request({ action: 'reset-password', userId: targetId }));
    expect(response.status).toBe(404);
    expect(dependencies.updatePassword).not.toHaveBeenCalled();
  });

  it('대기 시간에는 비밀번호를 바꾸지 않는다', async () => {
    vi.mocked(dependencies.reserveAction).mockRejectedValue(new AdminError(429, 'RESET_COOLDOWN', '잠시 후 다시 시도해 주세요.'));
    const response = await createAdminHandler(dependencies)(request({ action: 'reset-password', userId: targetId }));
    expect(response.status).toBe(429);
    expect(dependencies.updatePassword).not.toHaveBeenCalled();
    expect((await response.json()).code).toBe('RESET_COOLDOWN');
  });

  it('비밀번호 초기화 실패를 감사 기록에 남기고 성공으로 응답하지 않는다', async () => {
    vi.mocked(dependencies.updatePassword).mockRejectedValue(new Error('provider details and internal token'));
    const response = await createAdminHandler(dependencies)(request({ action: 'reset-password', userId: targetId }));
    expect(response.status).toBe(502);
    expect(dependencies.recordActionResult).toHaveBeenCalledWith('reservation-id', 'failed');
    expect(JSON.stringify(await response.json())).not.toContain('internal token');
  });

  it('잘못된 Origin에는 CORS 접근을 허용하지 않는다', async () => {
    const response = await createAdminHandler(dependencies)(request({ action: 'search', query: 'teacher', field: 'email' }, { origin: 'https://attacker.example.test' }));
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(dependencies.searchProfiles).not.toHaveBeenCalled();
  });

  it('허용된 Origin의 preflight만 인증 없이 통과시킨다', async () => {
    const response = await createAdminHandler(dependencies)(request(null, { method: 'OPTIONS', token: null }));
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://jaeinlee0502.github.io');
    expect(dependencies.verifyUser).not.toHaveBeenCalled();
  });

  it('잘못된 JSON과 지원하지 않는 작업을 거절한다', async () => {
    const handler = createAdminHandler(dependencies);
    expect((await handler(request(['bad']))).status).toBe(400);
    expect((await handler(request({ action: 'set-admin', userId: targetId }))).status).toBe(400);
    expect(dependencies.updatePassword).not.toHaveBeenCalled();
  });

  it('GET 요청도 서버 인증과 관리자 검증 후 거절한다', async () => {
    const response = await createAdminHandler(dependencies)(request(null, { method: 'GET' }));
    expect(response.status).toBe(405);
    expect(dependencies.verifyUser).toHaveBeenCalledOnce();
    expect(dependencies.isAdmin).toHaveBeenCalledOnce();
  });
});
