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
const passageId = '77777777-7777-4777-8777-777777777777';
const otherId = '88888888-8888-4888-8888-888888888888';
const sourcePath = `imports/${importId}/source.pdf`;
const imagePath = `imports/${importId}/questions/${questionId}.webp`;
const imagePath2 = `imports/${importId}/questions/${questionId2}.webp`;
const passagePath = `imports/${importId}/passages/${passageId}/0.webp`;
const passagePath2 = `imports/${importId}/passages/${passageId}/1.webp`;
const publishedPassageId = `import-${importId}-${passageId}`;
const metadata = {
  subject: '국어', grade: 1, year: 2025, month: 6,
  sourceUrl: 'https://www.ebsi.co.kr/ebs/exam',
  explanationUrl: 'https://www.ebsi.co.kr/ebs/exam',
};
const region = (page = 1) => ({ page, left: .08, top: .1, right: .49, bottom: .65 });
const question = () => ({
  clientId: questionId, number: 1, title: '공통 지문 연결 검증용 문항', tags: ['독서'],
  points: 3, searchText: '검증용 질문과 선택지', reviewed: true,
  width: 900, height: 1000, regions: [region()], passageClientId: passageId,
  instruction: '다음 글을 읽고 물음에 답하시오.', responseType: 'multiple_choice',
});
const passage = () => ({
  clientId: passageId, title: '검증용 공통 지문', searchText: '두 문항이 함께 읽는 검증용 본문',
  reviewed: true, regions: [region(), region(2)],
  imageSizes: [{ width: 900, height: 1200 }, { width: 900, height: 1000 }],
});
let db: PGlite;

async function asUser(id: string, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec(`set role ${role}`);
}
async function setDraft(questions: unknown[] = [question()], passages: unknown[] = [passage()], info: unknown = metadata) {
  await db.exec('reset role');
  await db.query('update public.exam_imports set metadata=$1::jsonb,questions=$2::jsonb,passages=$3::jsonb where id=$4',
    [JSON.stringify(info), JSON.stringify(questions), JSON.stringify(passages), importId]);
}
async function publish() {
  await asUser('', 'service_role');
  return db.query<{ count: number }>('select public.publish_exam_import($1,$2) as count', [admin, importId]);
}
async function assertUnpublished() {
  await db.exec('reset role');
  expect((await db.query('select status from public.exam_imports where id=$1', [importId])).rows).toEqual([{ status: 'draft' }]);
  expect((await db.query('select id from public.exam_questions where import_id=$1', [importId])).rows).toEqual([]);
  expect((await db.query('select id from public.exam_passages where import_id=$1', [importId])).rows).toEqual([]);
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
  for (const name of [
    '202610250001_accounts_and_bookmarks.sql', '202610250002_school_library.sql',
    '202610250003_exam_imports.sql', '202610260001_shared_passages.sql',
  ]) await db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
}, 20000);

beforeEach(async () => {
  await db.exec('reset role');
  await db.exec('truncate public.exam_questions, public.exam_passages, public.exam_imports, storage.objects, auth.users cascade');
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values
    ($1,'pending@example.test','{"role":"admin"}'),($2,'member@example.test','{}'),($3,'admin@example.test','{}')`,
  [pending, member, admin]);
  await db.query('insert into public.account_admins(user_id) values($1)', [admin]);
  await db.query('insert into public.school_members(user_id,approved_by) values($1,$2)', [member, admin]);
  await db.query(`insert into public.exam_imports(id,created_by,file_name,sha256,page_count,source_path,metadata,questions,passages)
    values($1,$2,'공통 지문 검증용.pdf',$3,2,$4,$5::jsonb,$6::jsonb,$7::jsonb)`,
  [importId, admin, 'a'.repeat(64), sourcePath, JSON.stringify(metadata), JSON.stringify([question()]), JSON.stringify([passage()])]);
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('exam-imports',$1,'{\"mimetype\":\"application/pdf\",\"size\":100}')", [sourcePath]);
  for (const path of [imagePath, imagePath2, passagePath, passagePath2]) {
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('school-questions',$1,'{\"mimetype\":\"image/webp\",\"size\":64}')", [path]);
  }
});

afterAll(async () => { await db?.close(); });

describe('공통 지문의 PostgreSQL 검수·권한·등록', () => {
  it('초안 지문 이미지는 승인 교사에게도 숨기고 관리자의 지정된 경로만 수정할 수 있다', async () => {
    for (const [id, role] of [['', 'anon'], [pending, 'authenticated'], [member, 'authenticated']]) {
      await asUser(id!, role!);
      expect((await db.query('select name from storage.objects')).rows).toEqual([]);
    }
    await asUser(admin);
    expect((await db.query('select name from storage.objects where name=$1', [passagePath])).rows).toEqual([{ name: passagePath }]);
    await db.query("update storage.objects set metadata=metadata||'{\"size\":65}' where name=$1", [passagePath]);
    await db.query("insert into storage.objects(bucket_id,name) values('school-questions',$1)", [`imports/${importId}/passages/${otherId}/0.webp`]);
    for (const path of [
      `imports/${otherId}/passages/${passageId}/0.webp`,
      `imports/${importId}/passages/${passageId}/12.webp`,
      `imports/${importId}/passages/${passageId}/0.png`,
      `imports/${importId}/passages/../../arbitrary.webp`,
    ]) await expect(db.query("insert into storage.objects(bucket_id,name) values('school-questions',$1)", [path])).rejects.toThrow(/row-level security/);
  });

  it('검수된 공통 지문을 한 번 등록하고 여러 문항에서 참조하며 재등록은 멱등적이다', async () => {
    const second = { ...question(), clientId: questionId2, number: 2, responseType: 'short_answer', instruction: '값을 구하시오.' };
    await setDraft([question(), second]);
    expect((await publish()).rows).toEqual([{ count: 2 }]);
    expect((await publish()).rows).toEqual([{ count: 2 }]);
    await db.exec('reset role');
    const passages = (await db.query<{ id: string; images: Array<{ path: string; width: number; height: number; page: number }> }>(
      'select id,images from public.exam_passages where import_id=$1', [importId])).rows;
    expect(passages).toEqual([{ id: publishedPassageId, images: [
      { path: passagePath, width: 900, height: 1200, page: 1 },
      { path: passagePath2, width: 900, height: 1000, page: 2 },
    ] }]);
    expect((await db.query('select number,passage_id,instruction,response_type from public.exam_questions where import_id=$1 order by number', [importId])).rows)
      .toEqual([
        { number: 1, passage_id: publishedPassageId, instruction: question().instruction, response_type: 'multiple_choice' },
        { number: 2, passage_id: publishedPassageId, instruction: '값을 구하시오.', response_type: 'short_answer' },
      ]);
    await asUser(pending);
    expect((await db.query('select id from public.exam_passages')).rows).toEqual([]);
    expect((await db.query('select name from storage.objects')).rows).toEqual([]);
    await asUser(member);
    expect((await db.query('select id from public.exam_passages')).rows).toEqual([{ id: publishedPassageId }]);
    const readable = (await db.query<{ name: string }>('select name from storage.objects')).rows.map(x => x.name);
    expect(readable).toEqual(expect.arrayContaining([imagePath, imagePath2, passagePath, passagePath2]));
    expect(readable).not.toContain(sourcePath);
    await db.exec('reset role');
    await db.query('delete from public.school_members where user_id=$1', [member]);
    await asUser(member);
    expect((await db.query('select id from public.exam_passages')).rows).toEqual([]);
    expect((await db.query('select name from storage.objects')).rows).toEqual([]);
  });

  it('지문 미검수·누락된 이미지·잘못된 크기를 모두 등록 전에 거절한다', async () => {
    for (const edited of [
      { ...passage(), reviewed: false },
      { ...passage(), imageSizes: [{ width: 900, height: 1200 }] },
      { ...passage(), imageSizes: [{ width: 0, height: 1200 }, { width: 900, height: 1000 }] },
    ]) {
      await setDraft([question()], [edited]);
      await expect(publish()).rejects.toThrow(/IMPORT_NOT_READY|INVALID/);
      await assertUnpublished();
    }
    await setDraft();
    await db.query('delete from storage.objects where name=$1', [passagePath2]);
    await expect(publish()).rejects.toThrow(/IMPORT_NOT_READY|INVALID/);
    await assertUnpublished();
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('school-questions',$1,'{\"mimetype\":\"text/html\"}')", [passagePath2]);
    await expect(publish()).rejects.toThrow(/IMPORT_NOT_READY|INVALID/);
    await assertUnpublished();
  });

  it('현재 초안에 없는 지문 참조와 중복 지문 ID를 서버 RPC에서도 거절한다', async () => {
    for (const [qs, passages] of [
      [[{ ...question(), passageClientId: otherId }], [passage()]],
      [[question()], []],
      [[question()], [passage(), passage()]],
      [[question()], [{ ...passage(), regions: [region(3)] }]],
    ] as [unknown[], unknown[]][]) {
      await setDraft(qs, passages);
      await expect(publish()).rejects.toThrow(/IMPORT_NOT_READY|INVALID/);
      await assertUnpublished();
    }
  });

  it('제외한 번호는 등록할 수 없고 잘못된 응답 유형이나 과도한 안내문도 거절한다', async () => {
    for (const [q, info] of [
      [question(), { ...metadata, excludedNumbers: [1] }],
      [{ ...question(), number: '01' }, { ...metadata, excludedNumbers: [1] }],
      [{ ...question(), responseType: 'arbitrary' }, metadata],
      [{ ...question(), instruction: '가'.repeat(2001) }, metadata],
    ]) {
      await setDraft([q], [passage()], info);
      await expect(publish()).rejects.toThrow(/IMPORT_NOT_READY|INVALID/);
      await assertUnpublished();
    }
    await setDraft([question()], [passage()], { ...metadata, excludedNumbers: [3, 4] });
    expect((await publish()).rows).toEqual([{ count: 1 }]);
  });

  it('다른 업로드의 문항이 기존 지문을 참조하지 못하도록 외래키도 적용한다', async () => {
    await publish();
    await db.exec('reset role');
    await db.query(`insert into public.exam_imports(id,created_by,file_name,sha256,page_count,source_path)
      values($1,$2,'다른 자료.pdf',$3,2,$4)`, [otherId, admin, 'b'.repeat(64), `imports/${otherId}/source.pdf`]);
    await expect(db.query(`insert into public.exam_questions(
      id,subject,grade,year,month,number,title,image_path,width,height,points,source_url,explanation_url,source_page,import_id,passage_id)
      values('cross-import','국어',1,2025,9,1,'잘못된 연결','other.webp',900,1000,3,'https://www.ebsi.co.kr/','https://www.ebsi.co.kr/',1,$1,$2)`,
    [otherId, publishedPassageId])).rejects.toThrow(/foreign key/);
  });

  it('기존 시험과 충돌하면 새 지문과 문항을 함께 롤백한다', async () => {
    await db.query(`insert into public.exam_questions(id,subject,grade,year,month,number,title,image_path,width,height,points,source_url,explanation_url,source_page)
      values('existing-question','국어',1,2025,6,1,'기존 문항 보존','existing.webp',900,1000,3,'https://www.ebsi.co.kr/','https://www.ebsi.co.kr/',1)`);
    await setDraft([question(), { ...question(), clientId: questionId2, number: 2 }]);
    await expect(publish()).rejects.toThrow(/IMPORT_CONFLICT/);
    await assertUnpublished();
    expect((await db.query("select title from public.exam_questions where id='existing-question'")).rows).toEqual([{ title: '기존 문항 보존' }]);
  });

  it('지문 없는 기존 초안을 네 인자 저장 RPC와 기본 응답 유형으로 계속 등록한다', async () => {
    const { passageClientId, instruction, responseType, ...legacy } = question();
    await setDraft([legacy], []);
    await asUser('', 'service_role');
    await db.query('select public.save_exam_import_draft($1,$2,$3::jsonb,$4::jsonb)',
      [admin, importId, JSON.stringify(metadata), JSON.stringify([legacy])]);
    expect((await publish()).rows).toEqual([{ count: 1 }]);
    await db.exec('reset role');
    expect((await db.query('select passage_id,instruction,response_type from public.exam_questions where import_id=$1', [importId])).rows)
      .toEqual([{ passage_id: null, instruction: '', response_type: 'multiple_choice' }]);
  });

  it('확장 저장 RPC는 미검수 지문과 문항의 연결을 함께 보존하고 잘못된 새 초안은 덮어쓰지 않는다', async () => {
    const draftPassage = { ...passage(), reviewed: false };
    const draftQuestion = { ...question(), reviewed: false };
    await asUser('', 'service_role');
    const saved = await db.query<{ draft: { passages: unknown[]; questions: unknown[]; metadata: unknown } }>(
      'select to_jsonb(public.save_exam_import_draft($1,$2,$3::jsonb,$4::jsonb,$5::jsonb)) as draft',
      [admin, importId, JSON.stringify({ subject: '국어' }), JSON.stringify([draftQuestion]), JSON.stringify([draftPassage])]);
    expect(saved.rows[0]?.draft).toMatchObject({
      metadata: { subject: '국어' }, passages: [draftPassage], questions: [draftQuestion],
    });
    await expect(db.query('select public.save_exam_import_draft($1,$2,$3::jsonb,$4::jsonb,$5::jsonb)',
      [admin, importId, JSON.stringify(metadata), JSON.stringify([question()]), JSON.stringify([{ ...passage(), regions: [region(3)] }])]))
      .rejects.toThrow(/INVALID/);
    await db.exec('reset role');
    expect((await db.query<{ passages: unknown[] }>('select passages from public.exam_imports where id=$1', [importId])).rows[0]?.passages)
      .toEqual([draftPassage]);
  });

  it('관리자 클라이언트도 지문 쓰기·확장 저장 RPC를 직접 호출하지 못한다', async () => {
    for (const id of [pending, member, admin]) {
      await asUser(id);
      await expect(db.query("insert into public.exam_passages(id,import_id,title,search_text,images) values('arbitrary',$1,'제목','본문','[]')", [importId])).rejects.toThrow(/permission denied/);
      await expect(db.query('select public.save_exam_import_draft($1,$2,$3::jsonb,$4::jsonb,$5::jsonb)',
        [admin, importId, JSON.stringify(metadata), JSON.stringify([question()]), JSON.stringify([passage()])])).rejects.toThrow(/permission denied/);
    }
  });

  it('초안 삭제는 지문 조각을 포함해 동결하고 다른 업로드 파일을 건드리지 않는다', async () => {
    const outside = `imports/${otherId}/passages/${passageId}/0.webp`;
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('school-questions',$1,'{\"mimetype\":\"image/webp\"}')", [outside]);
    await asUser('', 'service_role');
    const result = await db.query<{ paths: { source_path: string; image_paths: string[] } }>(
      'select public.begin_delete_exam_import($1,$2) as paths', [admin, importId]);
    const paths = result.rows[0]!.paths;
    expect(paths.source_path).toBe(sourcePath);
    expect(paths.image_paths.sort()).toEqual([imagePath, imagePath2, passagePath, passagePath2].sort());
    expect(paths.image_paths).not.toContain(outside);
    await asUser(admin);
    await expect(db.query("insert into storage.objects(bucket_id,name) values('school-questions',$1)", [`imports/${importId}/passages/${otherId}/0.webp`])).rejects.toThrow(/row-level security/);
    await asUser('', 'service_role');
    await expect(publish()).rejects.toThrow(/IMPORT_DELETING/);
    await expect(db.query('select public.finish_delete_exam_import($1,$2)', [admin, importId])).rejects.toThrow(/STORAGE_DELETE_FAILED/);
    await db.query('delete from storage.objects where name=any($1::text[])', [[sourcePath, ...paths.image_paths]]);
    await db.query('select public.finish_delete_exam_import($1,$2)', [admin, importId]);
    expect((await db.query('select id from public.exam_imports where id=$1', [importId])).rows).toEqual([]);
    expect((await db.query('select name from storage.objects')).rows).toEqual([{ name: outside }]);
  });
});
