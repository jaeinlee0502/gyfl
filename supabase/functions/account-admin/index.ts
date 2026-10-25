import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { AdminError, createAdminHandler, type AccountProfile } from './core.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const siteUrl = new URL(Deno.env.get('APP_SITE_URL') || 'https://jaeinlee0502.github.io/gyfl/');
const localHosts = ['localhost', '127.0.0.1'];
if (siteUrl.protocol !== 'https:' && !(siteUrl.protocol === 'http:' && localHosts.includes(siteUrl.hostname))) {
  throw new Error('APP_SITE_URL must use HTTPS (HTTP is allowed only for localhost development).');
}
siteUrl.search = '';
siteUrl.hash = '';
const configuredOrigins = (Deno.env.get('APP_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean);
const allowedOrigins = [siteUrl.origin, ...configuredOrigins.map(value => {
  const parsed = new URL(value);
  if (parsed.origin !== value || (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && localHosts.includes(parsed.hostname)))) {
    throw new Error('APP_ALLOWED_ORIGINS requires exact HTTPS origins, or HTTP localhost origins.');
  }
  return parsed.origin;
})];

if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase server environment is not configured.');
const server = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function withMembership(profiles: Omit<AccountProfile, 'approved' | 'is_admin'>[]): Promise<AccountProfile[]> {
  if (profiles.length === 0) return [];
  const ids = profiles.map(profile => profile.user_id);
  const [members, admins] = await Promise.all([
    server.from('school_members').select('user_id').in('user_id', ids),
    server.from('account_admins').select('user_id').in('user_id', ids),
  ]);
  if (members.error) throw members.error;
  if (admins.error) throw admins.error;
  const memberIds = new Set(members.data.map(row => row.user_id));
  const adminIds = new Set(admins.data.map(row => row.user_id));
  return profiles.map(profile => ({
    ...profile,
    approved: memberIds.has(profile.user_id) || adminIds.has(profile.user_id),
    is_admin: adminIds.has(profile.user_id),
  }));
}

const handler = createAdminHandler({
  allowedOrigins,
  async verifyUser(token) {
    const { data, error } = await server.auth.getUser(token);
    return error ? null : data.user;
  },
  async isAdmin(userId) {
    const { data, error } = await server.from('account_admins').select('user_id').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return !!data;
  },
  async searchProfiles(query, field) {
    const escaped = query.replace(/[\\%_]/g, value => `\\${value}`);
    const { data, error } = await server.from('profiles')
      .select('user_id,email,display_name,created_at')
      .ilike(field === 'email' ? 'email' : 'display_name', `%${escaped}%`)
      .order('created_at', { ascending: false }).limit(20);
    if (error) throw error;
    return withMembership(data);
  },
  async listMembers() {
    const { data, error } = await server.rpc('list_school_accounts');
    if (error) throw error;
    return data;
  },
  async getProfile(userId) {
    const { data, error } = await server.from('profiles').select('user_id,email,display_name,created_at').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data ? (await withMembership([data]))[0] ?? null : null;
  },
  async setMembership(actorId, targetId, approved) {
    const { error } = await server.rpc('set_school_membership', {
      p_actor_user_id: actorId, p_target_user_id: targetId, p_approved: approved,
    });
    if (error) {
      if (error.message.includes('NOT_ADMIN')) throw new AdminError(403, 'ADMIN_REQUIRED', '관리자만 사용할 수 있습니다.');
      if (error.message.includes('PROTECTED_ACCOUNT')) throw new AdminError(403, 'PROTECTED_ACCOUNT', '관리자 계정의 이용 권한은 이 화면에서 변경할 수 없습니다.');
      if (error.message.includes('ACCOUNT_NOT_FOUND')) throw new AdminError(404, 'ACCOUNT_NOT_FOUND', '계정을 찾을 수 없습니다.');
      throw error;
    }
  },
  async reserveAction(actorId, targetId, action) {
    const { data, error } = await server.rpc('reserve_admin_account_action', { p_actor_user_id: actorId, p_target_user_id: targetId, p_action: action });
    if (error) {
      if (error.message.includes('RESET_COOLDOWN')) throw new AdminError(429, 'RESET_COOLDOWN', '이 계정에 방금 작업을 수행했습니다. 1분 뒤 다시 시도해 주세요.');
      if (error.message.includes('RESET_RATE_LIMIT')) throw new AdminError(429, 'RESET_RATE_LIMIT', '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
      if (error.message.includes('NOT_ADMIN')) throw new AdminError(403, 'ADMIN_REQUIRED', '관리자만 사용할 수 있습니다.');
      if (error.message.includes('PROTECTED_ACCOUNT')) throw new AdminError(403, 'PROTECTED_ACCOUNT', '관리자 계정은 이 화면에서 초기화하거나 삭제할 수 없습니다.');
      if (error.message.includes('ACCOUNT_NOT_FOUND')) throw new AdminError(404, 'ACCOUNT_NOT_FOUND', '계정을 찾을 수 없습니다.');
      throw error;
    }
    if (typeof data !== 'string') throw new Error('Invalid reset reservation.');
    return data;
  },
  async updatePassword(userId, password) {
    const { error } = await server.auth.admin.updateUserById(userId, { password });
    if (error) throw error;
  },
  async deleteAccount(userId) {
    const { error } = await server.auth.admin.deleteUser(userId);
    if (error) throw error;
  },
  async recordActionResult(id, status) {
    const { error } = await server.from('account_admin_audit').update({ status }).eq('id', id);
    if (error) throw error;
  },
});

Deno.serve(handler);
