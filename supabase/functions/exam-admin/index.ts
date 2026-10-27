import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { ImportError, createImportHandler, type ImportRecord } from './core.ts';
import { generateAiTitles, generateAiMetadata, titleServiceConfiguration, TitleServiceError } from './ai-titles.ts';

const url = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !serviceKey) throw new Error('Supabase server configuration is missing.');
const server = createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const localHosts = ['localhost','127.0.0.1'];
const site = new URL(Deno.env.get('APP_SITE_URL') || 'https://jaeinlee0502.github.io/gyfl/');
function validOrigin(value: string) {
  const parsed = new URL(value);
  if (parsed.origin !== value || (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && localHosts.includes(parsed.hostname)))) throw new Error('Exact HTTPS origins are required.');
  return parsed.origin;
}
const allowedOrigins = [validOrigin(site.origin),...(Deno.env.get('APP_ALLOWED_ORIGINS') || '').split(',').map(value=>value.trim()).filter(Boolean).map(validOrigin)];
const fields = 'id,file_name,sha256,page_count,source_path,status,metadata,questions,passages,created_at,published_at,deleting_at';

function databaseError(error: { message: string }): never {
  const failures: [string,number,string][] = [
    ['NOT_ADMIN',403,'관리자 권한을 다시 확인해 주세요.'],
    ['IMPORT_NOT_FOUND',404,'등록 자료를 찾지 못했어요.'],
    ['IMPORT_PUBLISHED',409,'이미 등록한 자료는 수정하거나 삭제할 수 없어요.'],
    ['IMPORT_DELETING',409,'파일 삭제가 진행 중이에요. 삭제를 다시 시도해 주세요.'],
    ['IMPORT_CONFLICT',409,'같은 시험의 문항 번호가 이미 등록되어 있어요. 기존 자료를 확인해 주세요.'],
    ['IMPORT_NOT_READY',409,'시험 정보와 문항별 검수 확인, 이미지 업로드를 모두 완료해 주세요.'],
    ['INVALID_METADATA',400,'과목·학년·시험 연월과 EBS 출처 링크를 확인해 주세요.'],
    ['INVALID_DRAFT',400,'문항 번호·태그·추출 영역·이미지 크기를 확인해 주세요.'],
    ['INVALID_PASSAGES',400,'공통 지문 영역·문항 연결·이미지 크기를 확인해 주세요.'],
    ['STORAGE_DELETE_FAILED',502,'파일을 삭제하지 못했어요. 검수 초안 삭제를 다시 시도해 주세요.'],
  ];
  for (const [code,status,message] of failures) if (error.message.includes(code)) throw new ImportError(status,code==='NOT_ADMIN'?'ADMIN_REQUIRED':code,message);
  throw error;
}
function record(data: unknown): ImportRecord {
  const value = Array.isArray(data) ? data[0] : data;
  if (!value || typeof value !== 'object' || !('id' in value)) throw new Error('Unexpected import response.');
  return value as ImportRecord;
}

const handler = createImportHandler({
  allowedOrigins,
  async suggestMetadata(input) {
    try {
      return await generateAiMetadata(input,titleServiceConfiguration(name=>Deno.env.get(name)));
    } catch (cause) {
      if (cause instanceof TitleServiceError) throw new ImportError(cause.status,cause.code,'AI 제목·태그 추천을 완료하지 못했어요.');
      throw cause;
    }
  },
  async suggestTitles(input) {
    try {
      return await generateAiTitles(input,titleServiceConfiguration(name=>Deno.env.get(name)));
    } catch (cause) {
      if (cause instanceof TitleServiceError) throw new ImportError(cause.status,cause.code,'AI 제목 추천을 완료하지 못했어요.');
      throw cause;
    }
  },
  async verifyUser(token) {
    const {data,error} = await server.auth.getUser(token);
    return error ? null : data.user;
  },
  async isAdmin(id) {
    const {data,error} = await server.from('account_admins').select('user_id').eq('user_id',id).maybeSingle();
    if (error) throw error;
    return Boolean(data);
  },
  async listImports() {
    const {data,error} = await server.from('exam_imports').select(fields).order('created_at',{ascending:false}).limit(50);
    if (error) throw error;
    return data as ImportRecord[];
  },
  async createImport(actorId,input) {
    const id = crypto.randomUUID();
    const {data,error} = await server.from('exam_imports').insert({
      id,created_by:actorId,file_name:input.fileName,sha256:input.sha256,page_count:input.pageCount,
      source_path:`imports/${id}/source.pdf`,
    }).select(fields).single();
    if (error) databaseError(error);
    return record(data);
  },
  async getImport(id) {
    const {data,error} = await server.from('exam_imports').select(fields).eq('id',id).maybeSingle();
    if (error) throw error;
    return data as ImportRecord | null;
  },
  async saveDraft(actorId,id,metadata,questions,passages) {
    const {data,error} = await server.rpc('save_exam_import_draft',{
      p_actor_user_id:actorId,p_import_id:id,p_metadata:metadata,p_questions:questions,p_passages:passages,
    });
    if (error) databaseError(error);
    return record(data);
  },
  async publish(actorId,id) {
    const {data,error} = await server.rpc('publish_exam_import',{p_actor_user_id:actorId,p_import_id:id});
    if (error) databaseError(error);
    if (typeof data !== 'number' || !Number.isInteger(data) || data<1 || data>100) throw new Error('Unexpected publish count.');
    return data;
  },
  async deleteImport(actorId,id,allowPublished) {
    const {data,error} = await server.rpc('begin_delete_exam_import',{
      p_actor_user_id:actorId,p_import_id:id,p_allow_published:allowPublished,
    });
    if (error) databaseError(error);
    const prefixes = [`imports/${id}/questions/`,`imports/${id}/passages/`];
    if (!data || data.source_path !== `imports/${id}/source.pdf` || !Array.isArray(data.image_paths)
      || !data.image_paths.every((path: unknown)=>typeof path==='string' && prefixes.some(prefix=>path.startsWith(prefix)) && path.endsWith('.webp') && !path.split('/').includes('..'))) throw new Error('Unexpected import deletion scope.');
    try {
      for (let offset=0;offset<data.image_paths.length;offset+=100) {
        const removed = await server.storage.from('school-questions').remove(data.image_paths.slice(offset,offset+100));
        if (removed.error) throw removed.error;
      }
      const raw = await server.storage.from('exam-imports').remove([data.source_path]);
      if (raw.error) throw raw.error;
    } catch {
      // The durable deletion marker keeps the import frozen; retry is safe.
      throw new ImportError(502,'STORAGE_DELETE_FAILED','파일을 삭제하지 못했어요. 자료 삭제를 다시 시도해 주세요.');
    }
    const finished = await server.rpc('finish_delete_exam_import',{p_actor_user_id:actorId,p_import_id:id});
    if (finished.error) databaseError(finished.error);
  },
});
Deno.serve(handler);
