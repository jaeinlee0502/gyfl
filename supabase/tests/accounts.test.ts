// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const admin = '33333333-3333-4333-8333-333333333333';
let db: PGlite;

async function asUser(userId: string, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec(`set role ${role}`);
}

beforeAll(async () => {
  db = new PGlite();
  // The Supabase platform normally supplies these roles and auth schema.
  // These local fixtures exercise the actual migration and PostgreSQL RLS;
  // they do not imitate live Supabase Auth or email delivery.
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    grant usage on schema auth, public to anon, authenticated, service_role;
    create table auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb not null default '{}',
      created_at timestamptz not null default now()
    );
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  const sql = readFileSync(new URL('../migrations/202610250001_accounts_and_bookmarks.sql', import.meta.url), 'utf8');
  await db.exec(sql);
}, 20000);

beforeEach(async () => {
  await db.exec('reset role');
  await db.exec('truncate public.account_admin_audit, public.account_admins, public.bookmarks, public.profiles, auth.users cascade');
  await db.query(`insert into auth.users (id,email,raw_user_meta_data) values
    ($1,'teacher-a@example.test','{"display_name":"교사 A","role":"admin"}'),
    ($2,'teacher-b@example.test','{"display_name":"교사 B"}'),
    ($3,'owner@example.test','{"display_name":"운영자"}')`, [userA, userB, admin]);
  await db.query('insert into public.account_admins (user_id) values ($1)', [admin]);
});

afterAll(async () => { await db?.close(); });

describe('실제 PostgreSQL 마이그레이션과 계정 RLS', () => {
  it('가입 트리거가 프로필을 만들고 본인 프로필만 읽을 수 있다', async () => {
    await asUser(userA);
    const { rows } = await db.query<{ user_id: string; email: string; display_name: string }>('select user_id,email,display_name from public.profiles');
    expect(rows).toEqual([{ user_id: userA, email: 'teacher-a@example.test', display_name: '교사 A' }]);
  });

  it('자기 북마크를 저장·upsert·조회·삭제할 수 있다', async () => {
    await asUser(userA);
    await db.query('insert into public.bookmarks(user_id,question_id) values ($1,$2)', [userA, 'demo-history-1']);
    await db.query(`insert into public.bookmarks(user_id,question_id) values ($1,$2)
      on conflict(user_id,question_id) do update set question_id=excluded.question_id`, [userA, 'demo-history-1']);
    expect((await db.query('select question_id from public.bookmarks')).rows).toEqual([{ question_id: 'demo-history-1' }]);
    await db.query('delete from public.bookmarks where question_id=$1', ['demo-history-1']);
    expect((await db.query('select * from public.bookmarks')).rows).toHaveLength(0);
  });

  it('다른 계정의 북마크는 보이지 않고 삭제할 수 없다', async () => {
    await asUser(userA);
    await db.query('insert into public.bookmarks(user_id,question_id) values ($1,$2)', [userA, 'demo-history-1']);
    await asUser(userB);
    expect((await db.query('select * from public.bookmarks')).rows).toHaveLength(0);
    await db.query('delete from public.bookmarks where user_id=$1', [userA]);
    await asUser(userA);
    expect((await db.query('select * from public.bookmarks')).rows).toHaveLength(1);
  });

  it('다른 계정 ID를 넣어 저장하거나 소유자를 바꾸면 RLS가 거절한다', async () => {
    await asUser(userA);
    await expect(db.query('insert into public.bookmarks(user_id,question_id) values ($1,$2)', [userB, 'demo-history-1'])).rejects.toThrow(/row-level security/);
    await db.query('insert into public.bookmarks(user_id,question_id) values ($1,$2)', [userA, 'demo-history-1']);
    await expect(db.query('update public.bookmarks set user_id=$1', [userB])).rejects.toThrow(/row-level security/);
  });

  it('표시 이름만 수정할 수 있고 이메일·사용자 ID는 바꿀 수 없다', async () => {
    await asUser(userA);
    await db.query('update public.profiles set display_name=$1 where user_id=$2', ['새 이름', userA]);
    expect((await db.query('select display_name from public.profiles')).rows).toEqual([{ display_name: '새 이름' }]);
    await expect(db.query('update public.profiles set email=$1', ['attacker@example.test'])).rejects.toThrow(/permission denied/);
    await expect(db.query('update public.profiles set user_id=$1', [userB])).rejects.toThrow(/permission denied/);
  });

  it('사용자 메타데이터에 admin을 넣어도 승격되지 않고 역할을 직접 추가할 수도 없다', async () => {
    await asUser(userA);
    expect((await db.query('select * from public.account_admins')).rows).toHaveLength(0);
    await expect(db.query('insert into public.account_admins(user_id) values ($1)', [userA])).rejects.toThrow(/permission denied/);
    await asUser(admin);
    expect((await db.query('select user_id from public.account_admins')).rows).toEqual([{ user_id: admin }]);
  });

  it('비로그인 사용자는 프로필·저장 목록·관리자 정보를 조회할 수 없다', async () => {
    await asUser('', 'anon');
    for (const table of ['profiles', 'bookmarks', 'account_admins']) {
      await expect(db.query(`select * from public.${table}`)).rejects.toThrow(/permission denied/);
    }
  });

  it('관리자로 로그인해도 클라이언트에서 감사 기록과 서버 전용 RPC에 접근할 수 없다', async () => {
    await asUser(admin);
    await expect(db.query('select * from public.account_admin_audit')).rejects.toThrow(/permission denied/);
    await expect(db.query('select public.reserve_admin_password_reset($1,$2)', [admin, userA])).rejects.toThrow(/permission denied/);
  });

  it('Auth 이메일 변경이 프로필에 반영되고 사용자가 정한 이름은 유지된다', async () => {
    await asUser(userA);
    await db.query('update public.profiles set display_name=$1', ['새 이름']);
    await db.exec('reset role');
    await db.query('update auth.users set email=$1 where id=$2', ['new-address@example.test', userA]);
    expect((await db.query('select email,display_name from public.profiles where user_id=$1', [userA])).rows).toEqual([{ email: 'new-address@example.test', display_name: '새 이름' }]);
  });

  it('서버 예약도 실제 관리자 권한을 다시 검사한다', async () => {
    await asUser('', 'service_role');
    await expect(db.query('select public.reserve_admin_password_reset($1,$2)', [userA, userB])).rejects.toThrow(/NOT_ADMIN/);
    expect((await db.query('select * from public.account_admin_audit')).rows).toHaveLength(0);
  });

  it('서버 예약을 감사 기록에 남기고 같은 계정에 60초 내 재요청을 거절한다', async () => {
    await asUser('', 'service_role');
    const { rows } = await db.query<{ reservation: string }>('select public.reserve_admin_password_reset($1,$2) as reservation', [admin, userA]);
    expect(rows[0]?.reservation).toMatch(/^[0-9a-f-]{36}$/);
    expect((await db.query('select actor_user_id,target_user_id,action,status from public.account_admin_audit')).rows).toEqual([{ actor_user_id: admin, target_user_id: userA, action: 'password_reset', status: 'pending' }]);
    await expect(db.query('select public.reserve_admin_password_reset($1,$2)', [admin, userA])).rejects.toThrow(/RESET_COOLDOWN/);
  });

  it('관리자별 10분에 5건 발송 제한을 적용한다', async () => {
    const { rows: targets } = await db.query<{ id: string }>(`insert into auth.users(id,email)
      select gen_random_uuid(), 'test-' || n::text || '@example.test' from generate_series(1,6) as n returning id`);
    await asUser('', 'service_role');
    for (const target of targets.slice(0,5)) {
      await db.query('select public.reserve_admin_password_reset($1,$2)', [admin, target.id]);
    }
    await expect(db.query('select public.reserve_admin_password_reset($1,$2)', [admin, targets[5]!.id])).rejects.toThrow(/RESET_RATE_LIMIT/);
    expect((await db.query('select * from public.account_admin_audit')).rows).toHaveLength(5);
  });
});
