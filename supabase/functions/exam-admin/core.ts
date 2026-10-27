import type { TitleRequest, TitleSuggestion } from './ai-titles.ts';

export interface ImportMetadata {
  subject?: string; grade?: number; year?: number; month?: number;
  sourceUrl?: string; explanationUrl?: string;
  excludedNumbers?: number[];
}
export interface Region { page: number; left: number; top: number; right: number; bottom: number }
export interface ImportQuestion {
  clientId: string; number: number; title: string; tags: string[]; points: number;
  searchText: string; regions: Region[]; reviewed: boolean; width?: number; height?: number;
  passageClientId?: string; instruction?: string; responseType?: 'multiple_choice' | 'short_answer';
}
export interface ImportPassage {
  clientId: string; title: string; searchText: string; regions: Region[]; reviewed: boolean;
  imageSizes?: { width: number; height: number }[];
}
export interface ImportRecord {
  id: string; file_name: string; sha256: string; page_count: number; source_path: string;
  status: 'draft' | 'published'; metadata: ImportMetadata; questions: ImportQuestion[];
  created_at: string; published_at: string | null; deleting_at?: string | null;
  passages?: ImportPassage[];
}
export interface ImportDependencies {
  allowedOrigins: readonly string[];
  verifyUser(token: string): Promise<{ id: string } | null>;
  isAdmin(userId: string): Promise<boolean>;
  listImports(): Promise<ImportRecord[]>;
  createImport(actorId: string, input: { fileName: string; sha256: string; pageCount: number }): Promise<ImportRecord>;
  getImport(id: string): Promise<ImportRecord | null>;
  saveDraft(actorId: string, id: string, metadata: ImportMetadata, questions: ImportQuestion[], passages: ImportPassage[]): Promise<ImportRecord>;
  publish(actorId: string, id: string): Promise<number>;
  deleteImport(actorId: string, id: string, allowPublished: boolean): Promise<void>;
  suggestTitles(input: TitleRequest): Promise<TitleSuggestion[]>;
}
export class ImportError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const subjects = ['국어','수학','영어','한국사','통합사회','통합과학'];
const maxBody = 512 * 1024;
function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function integer(value: unknown, min: number, max: number): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max; }
function invalid(code: string, message: string): never { throw new ImportError(400, code, message); }

function metadata(value: unknown): ImportMetadata {
  if (!object(value)) invalid('INVALID_METADATA','시험 정보를 확인해 주세요.');
  const result: ImportMetadata = {};
  if ('subject' in value) {
    if (typeof value.subject !== 'string' || !subjects.includes(value.subject)) invalid('INVALID_METADATA','과목을 확인해 주세요.');
    result.subject = value.subject;
  }
  for (const [key,min,max] of [['grade',1,2],['year',2025,2100],['month',3,10]] as const) {
    if (key in value) {
      if (!integer(value[key],min,max) || (key === 'month' && ![3,6,9,10].includes(value[key] as number))) invalid('INVALID_METADATA','학년과 시험 연월을 확인해 주세요.');
      result[key] = value[key] as number;
    }
  }
  for (const key of ['sourceUrl','explanationUrl'] as const) {
    if (key in value) {
      if (typeof value[key] !== 'string' || value[key].length > 2000) invalid('INVALID_METADATA','EBS 출처 링크를 확인해 주세요.');
      const text = value[key].trim();
      if (!text) { result[key] = ''; continue; }
      let url: URL;
      try { url = new URL(text); } catch { invalid('INVALID_METADATA','EBS 출처 링크를 확인해 주세요.'); }
      if (url.protocol !== 'https:' || url.hostname !== 'www.ebsi.co.kr' || url.username || url.password || url.port) invalid('INVALID_METADATA','https://www.ebsi.co.kr/ 주소를 입력해 주세요.');
      result[key] = url.href;
    }
  }
  if ('excludedNumbers' in value) {
    if (!Array.isArray(value.excludedNumbers) || value.excludedNumbers.length > 100
      || value.excludedNumbers.some(number => !integer(number,1,100))
      || new Set(value.excludedNumbers).size !== value.excludedNumbers.length) invalid('INVALID_METADATA','제외할 문항 번호를 확인해 주세요.');
    result.excludedNumbers = [...value.excludedNumbers] as number[];
  }
  return result;
}
function regions(value: unknown, pageCount: number, limit: number, minimum = 0): Region[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > limit) invalid('INVALID_QUESTIONS','추출 영역 개수를 확인해 주세요.');
  return value.map(region => {
    if (!object(region) || !integer(region.page,1,pageCount)
      || !['left','top','right','bottom'].every(k => typeof region[k] === 'number' && Number.isFinite(region[k]) && (region[k] as number) >= 0 && (region[k] as number) <= 1)
      || (region.left as number) >= (region.right as number) || (region.top as number) >= (region.bottom as number)) invalid('INVALID_QUESTIONS','추출 영역이 페이지 범위를 벗어났어요.');
    return { page: region.page, left: region.left as number, top: region.top as number, right: region.right as number, bottom: region.bottom as number };
  });
}
function passages(value: unknown, pageCount: number): ImportPassage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) invalid('INVALID_PASSAGES','공통 지문은 최대 100개까지 저장할 수 있어요.');
  const ids = new Set<string>();
  return value.map(item => {
    if (!object(item) || typeof item.clientId !== 'string' || !uuid.test(item.clientId)
      || typeof item.title !== 'string' || item.title.length > 200
      || typeof item.searchText !== 'string' || item.searchText.length > 30000
      || typeof item.reviewed !== 'boolean') invalid('INVALID_PASSAGES','공통 지문 제목·본문·검수 상태를 확인해 주세요.');
    const clientId = item.clientId.toLowerCase();
    if (ids.has(clientId)) invalid('INVALID_PASSAGES','공통 지문 식별자가 중복돼요.');
    ids.add(clientId);
    const result: ImportPassage = { clientId, title: item.title.trim(), searchText: item.searchText, reviewed: item.reviewed, regions: regions(item.regions,pageCount,12,1) };
    if (result.regions.some(region => region.right-region.left < .01-1e-9 || region.bottom-region.top < .01-1e-9)) invalid('INVALID_PASSAGES','공통 지문 영역의 너비와 높이는 각각 페이지의 1% 이상이어야 해요.');
    if ('imageSizes' in item) {
      if (!Array.isArray(item.imageSizes) || item.imageSizes.length !== result.regions.length
        || item.imageSizes.some(size => !object(size) || !integer(size.width,1,10000) || !integer(size.height,1,10000))) invalid('INVALID_PASSAGES','공통 지문 이미지 크기를 확인해 주세요.');
      result.imageSizes = item.imageSizes.map(size => ({ width: size.width as number, height: size.height as number }));
    }
    return result;
  });
}
function questions(value: unknown, pageCount: number): ImportQuestion[] {
  if (!Array.isArray(value) || value.length > 100) invalid('INVALID_QUESTIONS','문항은 최대 100개까지 등록할 수 있어요.');
  const ids = new Set<string>(), numbers = new Set<number>();
  return value.map(item => {
    if (!object(item) || typeof item.clientId !== 'string' || !uuid.test(item.clientId)
      || !integer(item.number,1,100) || typeof item.title !== 'string' || item.title.length > 200
      || !Array.isArray(item.tags) || item.tags.length > 20 || !integer(item.points,1,10)
      || typeof item.searchText !== 'string' || item.searchText.length > 30000
      || typeof item.reviewed !== 'boolean' || !Array.isArray(item.regions) || item.regions.length > 16) invalid('INVALID_QUESTIONS','문항 번호·제목·태그·배점·추출 영역을 확인해 주세요.');
    if (ids.has(item.clientId.toLowerCase()) || numbers.has(item.number)) invalid('INVALID_QUESTIONS','문항 번호나 문항 식별자가 중복돼요.');
    ids.add(item.clientId.toLowerCase()); numbers.add(item.number);
    const tags = item.tags.map(tag => {
      if (typeof tag !== 'string' || tag.trim().length < 1 || tag.trim().length > 60) invalid('INVALID_QUESTIONS','태그는 1자 이상 60자 이하로 입력해 주세요.');
      return tag.trim();
    });
    const result: ImportQuestion = { clientId: item.clientId.toLowerCase(), number: item.number, title: item.title.trim(), tags: [...new Set(tags)], points: item.points, searchText: item.searchText, regions: regions(item.regions,pageCount,16), reviewed: item.reviewed };
    if ('passageClientId' in item) {
      if (typeof item.passageClientId !== 'string' || !uuid.test(item.passageClientId)) invalid('INVALID_PASSAGES','연결할 공통 지문을 확인해 주세요.');
      result.passageClientId = item.passageClientId.toLowerCase();
    }
    if ('instruction' in item) {
      if (typeof item.instruction !== 'string' || item.instruction.length > 2000) invalid('INVALID_QUESTIONS','공통 문제 지시를 확인해 주세요.');
      result.instruction = item.instruction.trim();
    }
    if ('responseType' in item) {
      if (!['multiple_choice','short_answer'].includes(item.responseType as string)) invalid('INVALID_QUESTIONS','선택형·단답형 구분을 확인해 주세요.');
      result.responseType = item.responseType as ImportQuestion['responseType'];
    }
    for (const key of ['width','height'] as const) if (key in item) {
      if (!integer(item[key],1,10000)) invalid('INVALID_QUESTIONS','문항 이미지 크기를 확인해 주세요.');
      result[key] = item[key] as number;
    }
    return result;
  });
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('content-length') || 0) > maxBody) throw new ImportError(413,'REQUEST_TOO_LARGE','검수 내용이 너무 커요. 문항 수와 추출 텍스트를 줄여 주세요.');
  const reader = request.body?.getReader();
  if (!reader) invalid('INVALID_BODY','요청 내용을 확인해 주세요.');
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const part = await reader.read(); if (part.done) break;
    length += part.value.byteLength;
    if (length > maxBody) { await reader.cancel(); throw new ImportError(413,'REQUEST_TOO_LARGE','검수 내용이 너무 커요.'); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  try { const body: unknown = JSON.parse(new TextDecoder().decode(bytes)); if (object(body)) return body; } catch { /* handled below */ }
  invalid('INVALID_BODY','요청 내용을 확인해 주세요.');
}
export function createImportHandler(deps: ImportDependencies) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    const headers = new Headers({ 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'Vary':'Origin' });
    if (origin && deps.allowedOrigins.includes(origin)) {
      headers.set('Access-Control-Allow-Origin',origin);
      headers.set('Access-Control-Allow-Headers','authorization, x-client-info, apikey, content-type');
      headers.set('Access-Control-Allow-Methods','POST, OPTIONS');
    }
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body),{status,headers});
    if (origin && !deps.allowedOrigins.includes(origin)) return reply(403,{code:'ORIGIN_DENIED',error:'허용되지 않은 요청입니다.'});
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers});
    try {
      const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '');
      if (!token || token[1].length > 8192) throw new ImportError(401,'UNAUTHENTICATED','다시 로그인해 주세요.');
      const actor = await deps.verifyUser(token[1]);
      if (!actor) throw new ImportError(401,'UNAUTHENTICATED','다시 로그인해 주세요.');
      if (!await deps.isAdmin(actor.id)) throw new ImportError(403,'ADMIN_REQUIRED','관리자만 자료를 등록할 수 있어요.');
      if (request.method !== 'POST') throw new ImportError(405,'METHOD_NOT_ALLOWED','지원하지 않는 요청 방식입니다.');
      if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new ImportError(415,'INVALID_CONTENT_TYPE','요청 형식을 확인해 주세요.');
      const input = await readBody(request);
      if (input.action === 'list-imports') return reply(200,{imports:await deps.listImports()});
      if (input.action === 'create-import') {
        if (typeof input.fileName !== 'string' || !input.fileName.trim() || input.fileName.length > 200 || !/\.pdf$/i.test(input.fileName.trim())
          || typeof input.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(input.sha256) || !integer(input.pageCount,1,40)) invalid('INVALID_IMPORT','20MB 이하, 40쪽 이하의 PDF 문제지를 선택해 주세요.');
        return reply(201,{import:await deps.createImport(actor.id,{fileName:input.fileName.trim(),sha256:input.sha256.toLowerCase(),pageCount:input.pageCount})});
      }
      if (typeof input.id !== 'string' || !uuid.test(input.id)) invalid('INVALID_IMPORT','자료를 다시 선택해 주세요.');
      const record = await deps.getImport(input.id);
      if (!record) throw new ImportError(404,'IMPORT_NOT_FOUND','등록 자료를 찾지 못했어요.');
      if (input.action === 'get-import') return reply(200,{import:record});
      if (input.action === 'suggest-titles') {
        if (record.status !== 'draft') throw new ImportError(409,'IMPORT_PUBLISHED','미등록 초안에서 제목을 추천할 수 있어요.');
        if (record.deleting_at) throw new ImportError(409,'IMPORT_DELETING','삭제 중인 자료예요.');
        if (typeof input.subject !== 'string' || !subjects.includes(input.subject)
          || !Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > 10
          || (input.explanationText !== undefined && (typeof input.explanationText !== 'string' || input.explanationText.length > 60000))) invalid('INVALID_TITLE_REQUEST','제목을 추천할 문항과 해설 내용을 확인해 주세요.');
        const ids = new Set<string>();
        const titles: TitleRequest = { subject: input.subject, explanationText: input.explanationText as string || '', questions: input.questions.map(item => {
          if (!object(item) || typeof item.clientId !== 'string' || !uuid.test(item.clientId) || ids.has(item.clientId.toLowerCase())
            || !integer(item.number,1,100) || typeof item.text !== 'string' || item.text.length > 8000
            || typeof item.passageText !== 'string' || item.passageText.length > 12000
            || typeof item.instruction !== 'string' || item.instruction.length > 2000
            || !Array.isArray(item.tags) || item.tags.length > 20 || item.tags.some(tag=>typeof tag!=='string'||tag.length>60)) invalid('INVALID_TITLE_REQUEST','제목을 추천할 문항 내용을 확인해 주세요.');
          ids.add(item.clientId.toLowerCase());
          return { clientId: item.clientId, number: item.number, text: item.text, passageText: item.passageText,
            instruction: item.instruction, tags: item.tags as string[] };
        }) };
        return reply(200,{titles:await deps.suggestTitles(titles)});
      }
      if (input.action === 'save-draft') {
        if (record.status === 'published') throw new ImportError(409,'IMPORT_PUBLISHED','이미 등록한 자료는 검수 초안으로 수정할 수 없어요.');
        const savedPassages = passages(input.passages,record.page_count);
        const savedQuestions = questions(input.questions,record.page_count);
        const passageIds = new Set(savedPassages.map(passage=>passage.clientId));
        if (savedQuestions.some(question=>question.passageClientId && !passageIds.has(question.passageClientId))) invalid('INVALID_PASSAGES','현재 초안에 있는 공통 지문만 연결할 수 있어요.');
        return reply(200,{import:await deps.saveDraft(actor.id,record.id,metadata(input.metadata),savedQuestions,savedPassages)});
      }
      if (input.action === 'publish') {
        const count = await deps.publish(actor.id,record.id);
        return reply(200,{message:`${count}문항을 학교 서재에 등록했습니다.`,count});
      }
      if (input.action === 'delete-draft' || input.action === 'delete-import') {
        const allowPublished = input.action === 'delete-import';
        if (!allowPublished && record.status === 'published') throw new ImportError(409,'IMPORT_PUBLISHED','이미 등록된 자료예요. 목록을 새로 불러온 뒤 등록 자료 삭제를 이용해 주세요.');
        await deps.deleteImport(actor.id,record.id,allowPublished);
        return reply(200,{message:record.status === 'published'
          ? '등록 자료와 연결된 문항·지문·저장 기록을 삭제했어요. 수정한 PDF를 다시 올릴 수 있어요.'
          : '검수 초안과 업로드한 파일을 삭제했습니다.'});
      }
      invalid('INVALID_ACTION','지원하지 않는 작업입니다.');
    } catch (error) {
      if (error instanceof ImportError) return reply(error.status,{code:error.code,error:error.message});
      return reply(503,{code:'SERVICE_UNAVAILABLE',error:'자료 등록 서비스에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'});
    }
  };
}
