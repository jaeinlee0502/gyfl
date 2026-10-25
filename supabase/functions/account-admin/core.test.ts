// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminError, createAdminHandler, type AdminDependencies } from './core';

const actorId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const profile = { user_id: targetId, email: 'teacher@example.test', display_name: '김선생', created_at: '2026-10-25T00:00:00Z' };
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
    siteUrl: 'https://jaeinlee0502.github.io/gyfl/',
    verifyUser: vi.fn().mockResolvedValue({ id: actorId }),
    isAdmin: vi.fn().mockResolvedValue(true),
    searchProfiles: vi.fn().mockResolvedValue([profile]),
    getProfile: vi.fn().mockResolvedValue(profile),
    reserveReset: vi.fn().mockResolvedValue('reservation-id'),
    sendReset: vi.fn().mockResolvedValue(undefined),
    recordResetResult: vi.fn().mockResolvedValue(undefined),
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

  it('일반 사용자가 계정 ID를 알아도 재설정 메일을 보낼 수 없다', async () => {
    vi.mocked(dependencies.isAdmin).mockResolvedValue(false);
    const response = await createAdminHandler(dependencies)(request({ action: 'reset-password', userId: targetId }));
    expect(response.status).toBe(403);
    expect(dependencies.getProfile).not.toHaveBeenCalled();
    expect(dependencies.sendReset).not.toHaveBeenCalled();
  });

  it('검증된 관리자에게만 검색 결과를 돌려준다', async () => {
    const response = await createAdminHandler(dependencies)(request({ action: 'search', query: '  김선생  ', field: 'name' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ users: [profile] });
    expect(dependencies.searchProfiles).toHaveBeenCalledWith('김선생', 'name');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('짧은 검색어와 잘못된 검색 필드를 거절한다', async () => {
    const handler = createAdminHandler(dependencies);
    expect((await handler(request({ action: 'search', query: 'a', field: 'email' }))).status).toBe(400);
    expect((await handler(request({ action: 'search', query: 'teacher', field: 'role' }))).status).toBe(400);
    expect(dependencies.searchProfiles).not.toHaveBeenCalled();
  });

  it('클라이언트의 이메일·비밀번호·redirect를 무시하고 저장된 이메일과 서버 redirect만 사용한다', async () => {
    const response = await createAdminHandler(dependencies)(request({ action: 'reset-password', userId: targetId, email: 'attacker@example.test', password: 'known-password', redirectTo: 'https://attacker.example.test/' }));
    expect(response.status).toBe(200);
    expect(dependencies.reserveReset).toHaveBeenCalledWith(actorId, targetId);
    expect(dependencies.sendReset).toHaveBeenCalledWith(profile.email, dependencies.siteUrl);
    expect(dependencies.recordResetResult).toHaveBeenCalledWith('reservation-id', 'sent');
    expect(JSON.stringify(await response.json())).not.toContain('known-password');
  });

  it('계정이 없으면 메일을 보내지 않는다', async () => {
    vi.mocked(dependencies.getProfile).mockResolvedValue(null);
    const response = await createAdminHandler(dependencies)(request({ action: 'reset-password', userId: targetId }));
    expect(response.status).toBe(404);
    expect(dependencies.sendReset).not.toHaveBeenCalled();
  });

  it('재전송 대기 시간에는 메일을 보내지 않는다', async () => {
    vi.mocked(dependencies.reserveReset).mockRejectedValue(new AdminError(429, 'RESET_COOLDOWN', '잠시 후 다시 시도해 주세요.'));
    const response = await createAdminHandler(dependencies)(request({ action: 'reset-password', userId: targetId }));
    expect(response.status).toBe(429);
    expect(dependencies.sendReset).not.toHaveBeenCalled();
    expect((await response.json()).code).toBe('RESET_COOLDOWN');
  });

  it('메일 발송 실패를 감사 기록에 남기고 성공으로 응답하지 않는다', async () => {
    vi.mocked(dependencies.sendReset).mockRejectedValue(new Error('provider details and internal token'));
    const response = await createAdminHandler(dependencies)(request({ action: 'reset-password', userId: targetId }));
    expect(response.status).toBe(502);
    expect(dependencies.recordResetResult).toHaveBeenCalledWith('reservation-id', 'failed');
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
    expect(dependencies.sendReset).not.toHaveBeenCalled();
  });

  it('GET 요청도 서버 인증과 관리자 검증 후 거절한다', async () => {
    const response = await createAdminHandler(dependencies)(request(null, { method: 'GET' }));
    expect(response.status).toBe(405);
    expect(dependencies.verifyUser).toHaveBeenCalledOnce();
    expect(dependencies.isAdmin).toHaveBeenCalledOnce();
  });
});
