export interface AccountProfile {
  user_id: string;
  email: string;
  display_name: string;
  created_at: string;
}

export interface AdminDependencies {
  allowedOrigins: readonly string[];
  verifyUser(token: string): Promise<{ id: string } | null>;
  isAdmin(userId: string): Promise<boolean>;
  searchProfiles(query: string, field: 'email' | 'name'): Promise<AccountProfile[]>;
  getProfile(userId: string): Promise<AccountProfile | null>;
  reserveAction(actorId: string, targetId: string, action: 'password_reset' | 'account_delete'): Promise<string>;
  updatePassword(userId: string, password: string): Promise<void>;
  deleteAccount(userId: string): Promise<void>;
  recordActionResult(reservationId: string, status: 'succeeded' | 'failed'): Promise<void>;
}

export class AdminError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function generateTemporaryPassword() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  // Fixed character-class prefix plus 192 random bits; no modulo bias.
  return 'Aa1!' + Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

async function recordOutcome(deps: AdminDependencies, reservation: string, status: 'succeeded' | 'failed') {
  try {
    await deps.recordActionResult(reservation, status);
    return true;
  } catch {
    // The pre-operation reservation is already durable. A failed final status
    // update must not hide a successful password change and lose its one-time
    // password response. No password or provider error is logged here.
    return false;
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

      if (input.action === 'reset-password' || input.action === 'delete-account') {
        if (typeof input.userId !== 'string' || !uuid.test(input.userId)) {
          throw new AdminError(400, 'INVALID_ACCOUNT', '계정을 다시 선택해 주세요.');
        }
        const target = await deps.getProfile(input.userId);
        if (!target || !target.email) throw new AdminError(404, 'ACCOUNT_NOT_FOUND', '계정을 찾을 수 없습니다.');
        if (target.user_id === user.id || await deps.isAdmin(target.user_id)) {
          throw new AdminError(403, 'PROTECTED_ACCOUNT', '관리자 계정은 이 화면에서 초기화하거나 삭제할 수 없습니다.');
        }
        if (input.action === 'delete-account' && (typeof input.confirmEmail !== 'string'
          || input.confirmEmail.trim().toLowerCase() !== target.email.toLowerCase())) {
          throw new AdminError(400, 'CONFIRMATION_MISMATCH', '삭제할 계정의 이메일을 정확히 입력해 주세요.');
        }
        const action = input.action === 'reset-password' ? 'password_reset' : 'account_delete';
        const reservation = await deps.reserveAction(user.id, target.user_id, action);
        if (action === 'password_reset') {
          // Server-generated, high-entropy and returned only in this response.
          // Never write the temporary password to logs, profiles or audit data.
          const temporaryPassword = generateTemporaryPassword();
          try {
            await deps.updatePassword(target.user_id, temporaryPassword);
          } catch {
            await recordOutcome(deps, reservation, 'failed');
            throw new AdminError(502, 'PASSWORD_RESET_FAILED', '비밀번호를 초기화하지 못했습니다. 잠시 후 다시 시도해 주세요.');
          }
          const auditRecorded = await recordOutcome(deps, reservation, 'succeeded');
          return reply(200, { message: '임시 비밀번호를 발급했습니다. 선생님께 안전하게 전달해 주세요.', temporaryPassword, ...(!auditRecorded && { auditPending: true }) });
        }
        try {
          await deps.deleteAccount(target.user_id);
        } catch {
          await recordOutcome(deps, reservation, 'failed');
          throw new AdminError(502, 'ACCOUNT_DELETE_FAILED', '계정을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        }
        const auditRecorded = await recordOutcome(deps, reservation, 'succeeded');
        return reply(200, { message: '계정과 저장한 문제를 삭제했습니다.', ...(!auditRecorded && { auditPending: true }) });
      }
      throw new AdminError(400, 'INVALID_ACTION', '지원하지 않는 작업입니다.');
    } catch (error) {
      if (error instanceof AdminError) return reply(error.status, { error: error.message, code: error.code });
      return reply(503, { error: '계정 관리 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.', code: 'SERVICE_UNAVAILABLE' });
    }
  };
}
