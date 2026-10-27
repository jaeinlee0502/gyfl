// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const pending = '11111111-1111-4111-8111-111111111111';
const member = '22222222-2222-4222-8222-222222222222';
const admin = '33333333-3333-4333-8333-333333333333';
let db: PGlite;

async function asUser(userId: string, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec(`set role ${role}`);
}

beforeAll(async () => {
  db = new PGlite();
  // Supabase supplies these schemas/roles/tables. Use the real migration and
  // PostgreSQL policies, with only the platform structures supplied as fixtures.
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema storage;
    grant usage on schema auth, public, storage to anon, authenticated, service_role;
    create table auth.users (
      id uuid primary key, email text,
      raw_user_meta_data jsonb not null default '{}',
      created_at timestamptz not null default now()
    );
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table storage.buckets (
      id text primary key, name text not null, public boolean not null default false,
      file_size_limit bigint, allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text references storage.buckets(id), name text not null
    );
    alter table storage.objects enable row level security;
    grant select on storage.objects to anon;
    grant select, insert, update, delete on storage.objects to authenticated;
    grant all on storage.objects, storage.buckets to service_role;
  `);
  for (const file of ['202610250001_accounts_and_bookmarks.sql', '202610250002_school_library.sql', '202610270001_shared_question_tags.sql']) {
    await db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
}, 20000);

beforeEach(async () => {
  await db.exec('reset role');
  await db.exec('truncate public.school_membership_audit, public.account_admin_audit, public.exam_questions, storage.objects, auth.users cascade');
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values
    ($1,'pending@example.test','{"display_name":"대기 교사","role":"admin","approved":true}'),
    ($2,'member@example.test','{"display_name":"학교 교사"}'),
    ($3,'owner@example.test','{"display_name":"운영자"}')`, [pending, member, admin]);
  await db.query('insert into public.account_admins(user_id) values ($1)', [admin]);
  await db.query('insert into public.school_members(user_id,approved_by) values ($1,$2)', [member, admin]);
  await db.exec(`
    insert into public.exam_questions(id,subject,grade,year,month,number,title,tags,image_path,width,height,points,source_url,explanation_url,source_page)
    values('school-test-1','한국사',1,2025,3,1,'검증용 문항',array['현대사'],'test/question-01.webp',900,1000,3,'https://www.ebsi.co.kr/','https://www.ebsi.co.kr/',1);
    insert into storage.buckets(id,name) values('other-private','other-private') on conflict do nothing;
    insert into storage.objects(bucket_id,name) values
      ('school-questions','test/question-01.webp'),('other-private','secret.webp');
  `);
});

afterAll(async () => { await db?.close(); });

describe('교직원 공유 태그의 실제 PostgreSQL 권한과 충돌 처리', () => {
  const update = (tags: unknown, expected: unknown = ['현대사'], id = 'school-test-1') =>
    db.query<{ result: { id: string; tags: string[] } }>('select public.update_exam_question_tags($1,$2,$3) as result', [id, expected, tags]);

  it('승인된 일반 교사가 태그만 변경하고 다른 승인 계정도 같은 태그를 읽는다', async () => {
    await asUser(member);
    expect((await update([' 현대사 ', '정치사', '현대사', '6월  민주 항쟁'])).rows[0]!.result.tags)
      .toEqual(['현대사', '정치사', '6월 민주 항쟁']);
    await asUser(admin);
    expect((await db.query('select title,tags from public.exam_questions')).rows).toEqual([{ title: '검증용 문항', tags: ['현대사', '정치사', '6월 민주 항쟁'] }]);
    await db.exec('reset role');
    expect((await db.query('select actor_user_id,old_tags,new_tags from public.exam_question_tag_audit')).rows)
      .toEqual([{ actor_user_id: member, old_tags: ['현대사'], new_tags: ['현대사', '정치사', '6월 민주 항쟁'] }]);
  });

  it('비로그인·승인 대기·승인 취소 계정은 공유 태그를 변경하지 못한다', async () => {
    await asUser('', 'anon');
    await expect(update(['정치사'])).rejects.toThrow(/permission denied/);
    await asUser(pending);
    await expect(update(['정치사'])).rejects.toThrow('SCHOOL_ACCESS_REQUIRED');
    await db.exec('reset role');
    await db.query('delete from public.school_members where user_id=$1', [member]);
    await asUser(member);
    await expect(update(['정치사'])).rejects.toThrow('SCHOOL_ACCESS_REQUIRED');
  });

  it('잘못된 태그·과도한 개수·null을 거절하고 아무것도 변경하지 않는다', async () => {
    await asUser(member);
    for (const tags of [null, [''], ['\t\n '], [null], ['가'.repeat(61)], Array(21).fill('현대사'), [['현대사']]]) {
      await expect(update(tags)).rejects.toThrow('INVALID_QUESTION_TAGS');
    }
    expect((await db.query('select tags from public.exam_questions')).rows).toEqual([{ tags: ['현대사'] }]);
  });

  it('다른 선생님의 변경을 감지하고 오래된 편집으로 덮어쓰지 않는다', async () => {
    await asUser(member);
    await update(['현대사', '정치사']);
    await asUser(admin);
    await expect(update(['문화사'])).rejects.toThrow('QUESTION_TAGS_CONFLICT');
    expect((await db.query('select tags from public.exam_questions')).rows).toEqual([{ tags: ['현대사', '정치사'] }]);
    await db.exec('reset role');
    expect((await db.query('select count(*)::int as count from public.exam_question_tag_audit')).rows).toEqual([{ count: 1 }]);
  });

  it('빈 목록으로 태그를 지울 수 있고 변경이 없는 저장은 이력을 늘리지 않는다', async () => {
    await asUser(member);
    await update(['현대사']);
    await db.exec('reset role');
    expect((await db.query('select count(*)::int as count from public.exam_question_tag_audit')).rows).toEqual([{ count: 0 }]);
    await asUser(member);
    expect((await update([])).rows[0]!.result.tags).toEqual([]);
    await expect(update([], [], 'not-a-question')).rejects.toThrow('QUESTION_NOT_FOUND');
  });

  it('태그 RPC가 생겨도 제목·원문·변경 이력에 대한 직접 쓰기는 허용하지 않는다', async () => {
    await asUser(member);
    for (const sql of ["update public.exam_questions set title='임의 수정'", 'select * from public.exam_question_tag_audit', "insert into public.exam_question_tag_audit(question_id,old_tags,new_tags) values('school-test-1','{}','{}')"]) {
      await expect(db.query(sql)).rejects.toThrow(/permission denied/);
    }
  });
});

describe('학교 승인과 문항 원문 접근의 실제 PostgreSQL RLS', () => {
  it('비로그인 사용자는 문항과 회원 정보를 조회하지 못하고 이미지 목록도 볼 수 없다', async () => {
    await asUser('', 'anon');
    for (const table of ['exam_questions', 'school_members']) {
      await expect(db.query(`select * from public.${table}`)).rejects.toThrow(/permission denied/);
    }
    await expect(db.query('select public.has_school_access()')).rejects.toThrow(/permission denied/);
    expect((await db.query('select * from storage.objects')).rows).toEqual([]);
  });

  it('가입만 한 계정의 메타데이터에 승인을 넣어도 원문·이미지·저장 기능은 열리지 않는다', async () => {
    await asUser(pending);
    expect((await db.query('select public.has_school_access() as allowed')).rows).toEqual([{ allowed: false }]);
    expect((await db.query('select * from public.exam_questions')).rows).toEqual([]);
    expect((await db.query('select * from storage.objects')).rows).toEqual([]);
    await expect(db.query('insert into public.bookmarks(user_id,question_id) values($1,$2)', [pending, 'school-test-1'])).rejects.toThrow(/row-level security/);
  });

  it('승인 교사는 문항과 해당 전용 버킷 이미지 및 본인 회원 정보만 읽는다', async () => {
    await db.query('insert into public.school_members(user_id,approved_by) values($1,$2)', [pending, admin]);
    await asUser(member);
    expect((await db.query('select public.has_school_access() as allowed')).rows).toEqual([{ allowed: true }]);
    expect((await db.query('select id from public.exam_questions')).rows).toEqual([{ id: 'school-test-1' }]);
    expect((await db.query('select bucket_id,name from storage.objects')).rows).toEqual([{ bucket_id: 'school-questions', name: 'test/question-01.webp' }]);
    expect((await db.query('select user_id from public.school_members')).rows).toEqual([{ user_id: member }]);
    await db.query('insert into public.bookmarks(user_id,question_id) values($1,$2)', [member, 'school-test-1']);
    expect((await db.query('select question_id from public.bookmarks')).rows).toEqual([{ question_id: 'school-test-1' }]);
  });

  it('학교 회원 행이 없는 기존 관리자도 원문에 접근한다', async () => {
    await asUser(admin);
    expect((await db.query('select * from public.school_members')).rows).toEqual([]);
    expect((await db.query('select public.has_school_access() as allowed')).rows).toEqual([{ allowed: true }]);
    expect((await db.query('select id from public.exam_questions')).rows).toHaveLength(1);
    expect((await db.query('select * from storage.objects')).rows).toHaveLength(1);
  });

  it('일반 계정과 관리자도 클라이언트 권한으로 승인이나 문항을 수정할 수 없다', async () => {
    for (const id of [pending, member, admin]) {
      await asUser(id);
      await expect(db.query('insert into public.school_members(user_id) values($1)', [pending])).rejects.toThrow(/permission denied/);
      await expect(db.query('select public.set_school_membership($1,$2,true)', [admin, pending])).rejects.toThrow(/permission denied/);
      await expect(db.query('select public.list_school_accounts()')).rejects.toThrow(/permission denied/);
      await expect(db.query('select * from public.school_membership_audit')).rejects.toThrow(/permission denied/);
      await expect(db.query("update public.exam_questions set title='tampered'")).rejects.toThrow(/permission denied/);
      await expect(db.query("insert into storage.objects(bucket_id,name) values('school-questions','tampered.webp')")).rejects.toThrow(/row-level security/);
    }
  });

  it('승인 해제는 같은 로그인 세션에서도 문항·이미지·기존 저장 목록을 즉시 가린다', async () => {
    await asUser(member);
    await db.query('insert into public.bookmarks(user_id,question_id) values($1,$2)', [member, 'school-test-1']);
    await asUser('', 'service_role');
    await db.query('select public.set_school_membership($1,$2,false)', [admin, member]);
    await asUser(member);
    expect((await db.query('select public.has_school_access() as allowed')).rows).toEqual([{ allowed: false }]);
    for (const table of ['exam_questions', 'bookmarks']) expect((await db.query(`select * from public.${table}`)).rows).toEqual([]);
    expect((await db.query('select * from storage.objects')).rows).toEqual([]);
    await expect(db.query('insert into public.bookmarks(user_id,question_id) values($1,$2)', [member, 'school-test-2'])).rejects.toThrow(/row-level security/);
    await db.exec('reset role');
    expect((await db.query('select * from public.bookmarks')).rows).toHaveLength(1);
  });

  it('서버 RPC도 일반 행위자의 승인 요청과 관리자 계정 권한 변경을 거절한다', async () => {
    await asUser('', 'service_role');
    await expect(db.query('select public.set_school_membership($1,$2,true)', [pending, pending])).rejects.toThrow(/NOT_ADMIN/);
    await expect(db.query('select public.set_school_membership($1,$2,false)', [admin, admin])).rejects.toThrow(/PROTECTED_ACCOUNT/);
    await expect(db.query('select public.set_school_membership($1,$2,null)', [admin, pending])).rejects.toThrow(/INVALID_ACTION/);
    expect((await db.query('select * from public.school_membership_audit')).rows).toEqual([]);
  });

  it('승인과 해제는 원자적으로 별도 감사 기록을 남기며 기존 초기화 쿨다운에 섞이지 않는다', async () => {
    await asUser('', 'service_role');
    await db.query('select public.set_school_membership($1,$2,true)', [admin, pending]);
    expect((await db.query('select approved_by from public.school_members where user_id=$1', [pending])).rows).toEqual([{ approved_by: admin }]);
    await db.query("select public.reserve_admin_account_action($1,$2,'password_reset')", [admin, pending]);
    await db.query('select public.set_school_membership($1,$2,false)', [admin, pending]);
    expect((await db.query('select action from public.school_membership_audit order by created_at,id')).rows.map((r) => r.action).sort()).toEqual(['approved','revoked']);
    expect((await db.query('select action from public.account_admin_audit')).rows).toEqual([{ action: 'password_reset' }]);
  });

  it('서버 목록은 승인 대기를 먼저 반환하고 관리자 승인 상태도 정확하다', async () => {
    await asUser('', 'service_role');
    const { rows } = await db.query<{ user_id: string; approved: boolean; is_admin: boolean }>('select * from public.list_school_accounts()');
    expect(rows[0]).toMatchObject({ user_id: pending, approved: false, is_admin: false });
    expect(rows.find(row => row.user_id === member)).toMatchObject({ approved: true, is_admin: false });
    expect(rows.find(row => row.user_id === admin)).toMatchObject({ approved: true, is_admin: true });
  });

  it('계정 삭제 시 학교 승인 행을 제거하고 승인 감사 기록은 보존한다', async () => {
    await asUser('', 'service_role');
    await db.query('select public.set_school_membership($1,$2,true)', [admin, pending]);
    await db.exec('reset role');
    await db.query('delete from auth.users where id=$1', [pending]);
    expect((await db.query('select * from public.school_members where user_id=$1', [pending])).rows).toEqual([]);
    expect((await db.query('select target_user_id from public.school_membership_audit')).rows).toEqual([{ target_user_id: pending }]);
  });

  it('문항 버킷은 공개 상태가 아니다', async () => {
    expect((await db.query("select public from storage.buckets where id='school-questions'")).rows).toEqual([{ public: false }]);
  });
});
