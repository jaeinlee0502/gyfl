export interface AccountProfile {
  user_id: string;
  email: string;
  display_name: string;
  created_at: string;
}

export interface AdminDependencies {
  allowedOrigins: readonly string[];
  siteUrl: string;
  verifyUser(token: string): Promise<{ id: string } | null>;
  isAdmin(userId: string): Promise<boolean>;
  searchProfiles(query: string, field: 'email' | 'name'): Promise<AccountProfile[]>;
  getProfile(userId: string): Promise<AccountProfile | null>;
  reserveReset(actorId: string, targetId: string): Promise<string>;
  sendReset(email: string, redirectTo: string): Promise<void>;
  recordResetResult(reservationId: string, status: 'sent' | 'failed'): Promise<void>;
}

export class AdminError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createAdminHandler(deps: AdminDependencies) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    const headers = new Headers({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Vary': 'Origin',
    });
    if (origin && deps.allowedOrigins.includes(origin)) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
      headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    }
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });

    // CORS controls browser access; authentication and the database role check
    // below remain mandatory, even for requests without an Origin header.
    if (origin && !deps.allowedOrigins.includes(origin)) {
      return reply(403, { error: '허용되지 않은 요청입니다.', code: 'ORIGIN_DENIED' });
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    try {
      const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '');
      if (!bearer || bearer[1].length > 8192) throw new AdminError(401, 'UNAUTHENTICATED', '다시 로그인해 주세요.');
      // Never trust a decoded-but-unverified JWT or a client-supplied admin flag.
      const user = await deps.verifyUser(bearer[1]);
      if (!user) throw new AdminError(401, 'UNAUTHENTICATED', '다시 로그인해 주세요.');
      if (!await deps.isAdmin(user.id)) throw new AdminError(403, 'ADMIN_REQUIRED', '관리자만 사용할 수 있습니다.');
      if (request.method !== 'POST') throw new AdminError(405, 'METHOD_NOT_ALLOWED', '지원하지 않는 요청 방식입니다.');

      if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
        throw new AdminError(415, 'INVALID_CONTENT_TYPE', '잘못된 요청 형식입니다.');
      }
      if (Number(request.headers.get('content-length') || 0) > 4096) throw new AdminError(413, 'REQUEST_TOO_LARGE', '요청 내용이 너무 큽니다.');
      const text = await request.text();
      if (text.length > 4096) throw new AdminError(413, 'REQUEST_TOO_LARGE', '요청 내용이 너무 큽니다.');
      let input: Record<string, unknown>;
      try {
        const value: unknown = JSON.parse(text);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
        input = value as Record<string, unknown>;
      } catch {
        throw new AdminError(400, 'INVALID_BODY', '잘못된 요청 내용입니다.');
      }

      if (input.action === 'search') {
        if (typeof input.query !== 'string' || !['email', 'name'].includes(String(input.field))) {
          throw new AdminError(400, 'INVALID_SEARCH', '이메일 또는 이름으로 검색해 주세요.');
        }
        const query = input.query.trim();
        if (query.length < 2 || query.length > 120) throw new AdminError(400, 'INVALID_SEARCH', '검색어를 2자 이상 120자 이하로 입력해 주세요.');
        return reply(200, { users: await deps.searchProfiles(query, input.field as 'email' | 'name') });
      }

      if (input.action === 'reset-password') {
        if (typeof input.userId !== 'string' || !uuid.test(input.userId)) {
          throw new AdminError(400, 'INVALID_ACCOUNT', '계정을 다시 선택해 주세요.');
        }
        const target = await deps.getProfile(input.userId);
        if (!target || !target.email) throw new AdminError(404, 'ACCOUNT_NOT_FOUND', '계정을 찾을 수 없습니다.');
        // The browser supplies only the account ID. Email and redirect URL
        // always come from trusted server data/configuration.
        const reservation = await deps.reserveReset(user.id, target.user_id);
        try {
          await deps.sendReset(target.email, deps.siteUrl);
        } catch {
          await deps.recordResetResult(reservation, 'failed');
          throw new AdminError(502, 'RECOVERY_SEND_FAILED', '재설정 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
        }
        await deps.recordResetResult(reservation, 'sent');
        return reply(200, { message: '등록된 이메일로 비밀번호 재설정 안내를 보냈습니다.' });
      }
      throw new AdminError(400, 'INVALID_ACTION', '지원하지 않는 작업입니다.');
    } catch (error) {
      if (error instanceof AdminError) return reply(error.status, { error: error.message, code: error.code });
      return reply(503, { error: '계정 관리 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.', code: 'SERVICE_UNAVAILABLE' });
    }
  };
}
