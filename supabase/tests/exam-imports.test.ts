// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const pending = '11111111-1111-4111-8111-111111111111';
const member = '22222222-2222-4222-8222-222222222222';
const admin = '33333333-3333-4333-8333-333333333333';
const importId = '44444444-4444-4444-8444-444444444444';
const questionId = '55555555-5555-4555-8555-555555555555';
const questionId2 = '66666666-6666-4666-8666-666666666666';
const sourcePath = `imports/${importId}/source.pdf`;
const imagePath = `imports/${importId}/questions/${questionId}.webp`;
const imagePath2 = `imports/${importId}/questions/${questionId2}.webp`;
const metadata = {
  subject: '한국사', grade: 2, year: 2026, month: 6,
  sourceUrl: 'https://www.ebsi.co.kr/ebs/exam',
  explanationUrl: 'https://www.ebsi.co.kr/ebs/exam',
};
const question = () => ({
  clientId: questionId, number: 1, title: '검증용 문항', tags: ['현대사', '정치사'],
  points: 3, searchText: '자동 추출한 검증용 문항 내용', reviewed: true,
  width: 900, height: 1000,
  regions: [{ page: 1, left: 0.08, top: 0.1, right: 0.49, bottom: 0.65 }],
});
let db: PGlite;

async function asUser(id: string, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec(`set role ${role}`);
}
async function setDraft(questions: unknown[], info: unknown = metadata) {
  await db.exec('reset role');
  await db.query('update public.exam_imports set metadata=$1::jsonb,questions=$2::jsonb where id=$3',
    [JSON.stringify(info), JSON.stringify(questions), importId]);
}
async function publish(actor = admin) {
  await asUser('', 'service_role');
  return db.query<{ count: number }>('select public.publish_exam_import($1,$2) as count', [actor, importId]);
}
async function assertStillDraft() {
  await db.exec('reset role');
  expect((await db.query('select status from public.exam_imports where id=$1', [importId])).rows).toEqual([{ status: 'draft' }]);
  expect((await db.query('select id from public.exam_questions where import_id=$1', [importId])).rows).toEqual([]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema storage;
    grant usage on schema auth, public, storage to anon, authenticated, service_role;
    create table auth.users (
      id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}',
      created_at timestamptz not null default now()
    );
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table storage.buckets (
      id text primary key, name text not null, public boolean not null default false,
      file_size_limit bigint, allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
      name text not null, metadata jsonb default '{}', unique(bucket_id,name)
    );
    alter table storage.objects enable row level security;
    grant select on storage.objects to anon;
    grant select, insert, update, delete on storage.objects to authenticated;
    grant all on storage.objects, storage.buckets to service_role;
  `);
  for (const migration of ['202610250001_accounts_and_bookmarks.sql', '202610250002_school_library.sql', '202610250003_exam_imports.sql']) {
    await db.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
  }
}, 20000);

beforeEach(async () => {
  await db.exec('reset role');
  await db.exec('truncate public.exam_questions, public.exam_imports, storage.objects, auth.users cascade');
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values
    ($1,'pending@example.test','{"role":"admin","approved":true}'),
    ($2,'member@example.test','{}'),($3,'admin@example.test','{}')`, [pending, member, admin]);
  await db.query('insert into public.account_admins(user_id) values($1)', [admin]);
  await db.query('insert into public.school_members(user_id,approved_by) values($1,$2)', [member, admin]);
  await db.query(`insert into public.exam_imports(id,created_by,file_name,sha256,page_count,source_path,metadata,questions)
    values($1,$2,'검증용.pdf',$3,2,$4,$5::jsonb,$6::jsonb)`,
  [importId, admin, 'a'.repeat(64), sourcePath, JSON.stringify(metadata), JSON.stringify([question()])]);
  await db.query(`insert into public.exam_questions(id,subject,grade,year,month,number,title,tags,image_path,width,height,points,source_url,explanation_url,source_page)
    values('existing-question','한국사',1,2025,3,1,'기존 수록 문항',array['근세'],'existing/question.webp',900,1000,3,'https://www.ebsi.co.kr/','https://www.ebsi.co.kr/',1)`);
  await db.query(`insert into storage.objects(bucket_id,name,metadata) values
    ('exam-imports',$1,'{"mimetype":"application/pdf","size":100}'),
    ('school-questions',$2,'{"mimetype":"image/webp","size":64}'),
    ('school-questions','existing/question.webp','{"mimetype":"image/webp","size":64}')`, [sourcePath, imagePath]);
});

afterAll(async () => { await db?.close(); });

describe('관리자 PDF 수록의 실제 PostgreSQL 권한과 원자적 등록', () => {
  it('비로그인·일반 교사는 초안·원본 PDF·미등록 문항 이미지를 볼 수 없다', async () => {
    for (const [id, role] of [['', 'anon'], [pending, 'authenticated'], [member, 'authenticated']]) {
      await asUser(id!, role!);
      const imports = db.query('select id from public.exam_imports');
      if (role === 'anon') await expect(imports).rejects.toThrow(/permission denied/);
      else expect((await imports).rows).toEqual([]);
      const objects = (await db.query<{ name: string }>('select name from storage.objects')).rows.map(row => row.name);
      expect(objects).not.toContain(sourcePath);
      expect(objects).not.toContain(imagePath);
      expect(objects).toEqual(id === member ? ['existing/question.webp'] : []);
    }
    await asUser(admin);
    expect((await db.query('select id from public.exam_imports')).rows).toEqual([{ id: importId }]);
    expect((await db.query('select name from storage.objects')).rows).toHaveLength(3);
  });

  it('클라이언트는 관리자여도 초안 테이블이나 등록 RPC를 직접 수정할 수 없다', async () => {
    for (const id of [pending, member, admin]) {
      await asUser(id);
      await expect(db.query("update public.exam_imports set status='published' where id=$1", [importId])).rejects.toThrow(/permission denied/);
      await expect(db.query('select public.publish_exam_import($1,$2)', [admin, importId])).rejects.toThrow(/permission denied/);
      await expect(db.query('select public.save_exam_import_draft($1,$2,$3::jsonb,$4::jsonb)',
        [admin, importId, JSON.stringify(metadata), JSON.stringify([question()])])).rejects.toThrow(/permission denied/);
      await expect(db.query('select public.begin_delete_exam_import($1,$2)', [admin, importId])).rejects.toThrow(/permission denied/);
    }
  });

  it('저장소 업로드는 관리자·해당 초안의 정해진 경로만 허용한다', async () => {
    await db.exec('reset role');
    await db.query('delete from storage.objects where name in ($1,$2)', [sourcePath, imagePath]);
    for (const id of [pending, member]) {
      await asUser(id);
      await expect(db.query("insert into storage.objects(bucket_id,name) values('exam-imports',$1)", [sourcePath])).rejects.toThrow(/row-level security/);
      await expect(db.query("insert into storage.objects(bucket_id,name) values('school-questions',$1)", [imagePath])).rejects.toThrow(/row-level security/);
    }
    await asUser(admin);
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('exam-imports',$1,'{\"mimetype\":\"application/pdf\",\"size\":100}')", [sourcePath]);
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('school-questions',$1,'{\"mimetype\":\"image/webp\",\"size\":64}')", [imagePath]);
    await db.query("update storage.objects set metadata=metadata||'{\"size\":65}'::jsonb where name=$1", [imagePath]);
    await expect(db.query("insert into storage.objects(bucket_id,name) values('exam-imports','arbitrary.pdf')")).rejects.toThrow(/row-level security/);
    await expect(db.query("insert into storage.objects(bucket_id,name) values('school-questions','existing/overwrite.webp')")).rejects.toThrow(/row-level security/);
  });

  it('관리자 검수 후 등록한 문항과 이미지만 승인 교사에게 공개하며 재시도는 중복 생성하지 않는다', async () => {
    expect((await publish()).rows).toEqual([{ count: 1 }]);
    expect((await publish()).rows).toEqual([{ count: 1 }]);
    await db.exec('reset role');
    expect((await db.query('select status from public.exam_imports where id=$1', [importId])).rows).toEqual([{ status: 'published' }]);
    expect((await db.query('select image_path,curriculum_status,source_page,tags from public.exam_questions where import_id=$1', [importId])).rows)
      .toEqual([{ image_path: imagePath, curriculum_status: 'admin_reviewed_not_certified', source_page: 1, tags: ['현대사', '정치사'] }]);
    await asUser(member);
    expect((await db.query('select id from public.exam_questions')).rows).toHaveLength(2);
    expect((await db.query('select name from storage.objects')).rows.map(row => row.name).sort()).toEqual(['existing/question.webp', imagePath].sort());
    await asUser(admin);
    await expect(db.query("insert into storage.objects(bucket_id,name) values('school-questions',$1)", [imagePath2])).rejects.toThrow(/row-level security/);
  });

  it('서버 호출이어도 일반 사용자를 행위자로 넣어 등록할 수 없다', async () => {
    await expect(publish(member)).rejects.toThrow(/NOT_ADMIN|ADMIN_REQUIRED/);
    await assertStillDraft();
  });

  it('서버의 초안 저장은 미검수 상태를 보존하고 등록이 끝난 원문은 수정·삭제로 되돌리지 않는다', async () => {
    await asUser('', 'service_role');
    const edited = { ...question(), reviewed: false, title: '검수 중인 제목' };
    const saved = await db.query<{ draft: { questions: unknown[]; status: string } }>(
      'select to_jsonb(public.save_exam_import_draft($1,$2,$3::jsonb,$4::jsonb)) as draft',
      [admin, importId, JSON.stringify(metadata), JSON.stringify([edited])]);
    expect(saved.rows[0]?.draft).toMatchObject({ status: 'draft', questions: [edited] });
    await setDraft([question()]);
    await publish();
    await expect(db.query('select public.save_exam_import_draft($1,$2,$3::jsonb,$4::jsonb)',
      [admin, importId, JSON.stringify(metadata), JSON.stringify([edited])])).rejects.toThrow(/IMPORT_PUBLISHED/);
    await expect(db.query('select public.begin_delete_exam_import($1,$2)', [admin, importId])).rejects.toThrow(/IMPORT_PUBLISHED/);
  });

  it('시험 정보가 일부만 인식되고 이미지가 아직 없는 초안도 저장하되 등록은 막는다', async () => {
    await asUser('', 'service_role');
    const { width, height, ...draft } = question();
    const edited = { ...draft, reviewed: false, tags: [] };
    const info = { subject: '한국사', sourceUrl: '' };
    const saved = await db.query<{ draft: { metadata: unknown; questions: unknown[] } }>(
      'select to_jsonb(public.save_exam_import_draft($1,$2,$3::jsonb,$4::jsonb)) as draft',
      [admin, importId, JSON.stringify(info), JSON.stringify([edited])]);
    expect(saved.rows[0]?.draft).toMatchObject({ metadata: info, questions: [edited] });
    await expect(publish()).rejects.toThrow(/IMPORT_NOT_READY/);
    await assertStillDraft();
  });

  it('원본 PDF나 문항 이미지가 없거나 파일 종류가 틀리면 등록을 원자적으로 거절한다', async () => {
    for (const path of [sourcePath, imagePath]) {
      await db.exec('reset role');
      await db.query('delete from storage.objects where name=$1', [path]);
      await expect(publish()).rejects.toThrow(/IMPORT_NOT_READY|MISSING|INVALID/);
      await assertStillDraft();
      await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3::jsonb)',
        [path === sourcePath ? 'exam-imports' : 'school-questions', path, JSON.stringify({ mimetype: path === sourcePath ? 'application/pdf' : 'image/webp', size: 64 })]);
    }
    await db.query("update storage.objects set metadata='{\"mimetype\":\"text/html\",\"size\":64}' where name=$1", [imagePath]);
    await expect(publish()).rejects.toThrow(/IMPORT_NOT_READY|INVALID/);
    await assertStillDraft();
  });

  it('미검수·빈 태그·잘못된 영역은 서버의 등록 검증에서도 거절한다', async () => {
    const invalid = [
      { ...question(), reviewed: false },
      { ...question(), tags: [] },
      { ...question(), regions: [{ page: 3, left: 0, top: 0, right: 1, bottom: 1 }] },
      { ...question(), regions: [{ page: 1, left: 0.8, top: 0, right: 0.4, bottom: 1 }] },
      { ...question(), width: 10001 },
    ];
    for (const draft of invalid) {
      await setDraft([draft]);
      await expect(publish()).rejects.toThrow(/IMPORT_NOT_READY|INVALID/);
      await assertStillDraft();
    }
  });

  it('기존 시험과 중복되면 새 문항을 일부만 등록하거나 기존 문항을 덮어쓰지 않는다', async () => {
    await db.exec('reset role');
    const second = { ...question(), clientId: questionId2, number: 2 };
    await setDraft([question(), second]);
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('school-questions',$1,'{\"mimetype\":\"image/webp\",\"size\":64}')", [imagePath2]);
    await db.query(`insert into public.exam_questions(id,subject,grade,year,month,number,title,image_path,width,height,points,source_url,explanation_url,source_page)
      values('duplicate-existing','한국사',2,2026,6,2,'기존 보존 문항','existing/other.webp',900,1000,3,'https://www.ebsi.co.kr/','https://www.ebsi.co.kr/',1)`);
    await expect(publish()).rejects.toThrow(/IMPORT_CONFLICT/);
    await assertStillDraft();
    expect((await db.query("select title from public.exam_questions where id='duplicate-existing'")).rows).toEqual([{ title: '기존 보존 문항' }]);
  });

  it('삭제를 시작하면 저장·등록과 새 업로드를 막아 삭제 중인 파일을 다시 게시하지 않는다', async () => {
    await asUser('', 'service_role');
    const result = await db.query<{ paths: { source_path: string; image_paths: string[] } }>('select public.begin_delete_exam_import($1,$2) as paths', [admin, importId]);
    expect(result.rows[0]?.paths.source_path).toBe(sourcePath);
    expect(result.rows[0]?.paths.image_paths).toContain(imagePath);
    await expect(db.query('select public.save_exam_import_draft($1,$2,$3::jsonb,$4::jsonb)',
      [admin, importId, JSON.stringify(metadata), JSON.stringify([question()])])).rejects.toThrow(/IMPORT_DELETING/);
    await expect(publish()).rejects.toThrow(/IMPORT_DELETING/);
    await asUser(admin);
    await expect(db.query("insert into storage.objects(bucket_id,name) values('school-questions',$1)", [imagePath2])).rejects.toThrow(/row-level security/);
  });

  it('저장소 정리가 실패하면 초안을 유지하고 파일 정리 완료 후에만 삭제를 마무리한다', async () => {
    await asUser('', 'service_role');
    await db.query('select public.begin_delete_exam_import($1,$2)', [admin, importId]);
    await expect(db.query('select public.finish_delete_exam_import($1,$2)', [admin, importId])).rejects.toThrow(/STORAGE_DELETE_FAILED/);
    expect((await db.query('select id from public.exam_imports where id=$1', [importId])).rows).toEqual([{ id: importId }]);
    // Storage API retries may begin deletion again without reopening the draft.
    await db.query('select public.begin_delete_exam_import($1,$2)', [admin, importId]);
    await db.query('delete from storage.objects where name in ($1,$2)', [sourcePath, imagePath]);
    await db.query('select public.finish_delete_exam_import($1,$2)', [admin, importId]);
    expect((await db.query('select id from public.exam_imports where id=$1', [importId])).rows).toEqual([]);
    expect((await db.query("select name from storage.objects where name='existing/question.webp'")).rows).toHaveLength(1);
  });

  it('원본 PDF 버킷은 비공개이며 PDF 형식과 20MiB 한도를 설정한다', async () => {
    expect((await db.query("select public,file_size_limit,allowed_mime_types from storage.buckets where id='exam-imports'")).rows)
      .toEqual([{ public: false, file_size_limit: 20 * 1024 * 1024, allowed_mime_types: ['application/pdf'] }]);
  });
});
