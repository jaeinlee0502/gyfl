// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createImportHandler,ImportError,type ImportDependencies,type ImportRecord} from './core';
const actor='11111111-1111-4111-8111-111111111111';
const id='22222222-2222-4222-8222-222222222222';
const clientId='33333333-3333-4333-8333-333333333333';
const record: ImportRecord={id,file_name:'문제지.pdf',sha256:'a'.repeat(64),page_count:4,source_path:`imports/${id}/source.pdf`,status:'draft',metadata:{},questions:[],created_at:'2026-10-25',published_at:null};
const question=()=>({clientId,number:1,title:'검수 문항',tags:['현대사'],points:3,searchText:'원문',regions:[{page:1,left:.1,top:.1,right:.5,bottom:.8}],reviewed:false});
let deps: ImportDependencies;
beforeEach(()=>{
 deps={allowedOrigins:['https://jaeinlee0502.github.io'],verifyUser:vi.fn().mockResolvedValue({id:actor}),isAdmin:vi.fn().mockResolvedValue(true),listImports:vi.fn().mockResolvedValue([record]),createImport:vi.fn().mockResolvedValue(record),getImport:vi.fn().mockResolvedValue(record),saveDraft:vi.fn().mockResolvedValue(record),publish:vi.fn().mockResolvedValue(1),deleteImport:vi.fn().mockResolvedValue(undefined),suggestTitles:vi.fn().mockResolvedValue([]),suggestMetadata:vi.fn().mockResolvedValue([])};
});
async function call(body: unknown,options: {method?:string;token?:string|null;origin?:string;contentType?:string;raw?:string;length?:string}={}) {
 const headers=new Headers({'authorization':'Bearer '+(options.token??'valid'),'content-type':options.contentType??'application/json'});
 if(options.token===null)headers.delete('authorization');
 if(options.origin)headers.set('origin',options.origin);
 if(options.length)headers.set('content-length',options.length);
 const method=options.method??'POST';
 const request=new Request('https://example.test/functions/v1/exam-admin',{method,headers,...(!['GET','OPTIONS'].includes(method)&&{body:options.raw??JSON.stringify(body)})});
 const response=await createImportHandler(deps)(request);
 return{response,data:response.status===204?null:await response.json()};
}
describe('관리자 PDF 검수 등록 API',()=>{
 it('실제 토큰과 관리자 조회를 통과해야 초안을 열 수 있다',async()=>{
  expect((await call({action:'list-imports'},{token:null})).response.status).toBe(401);
  vi.mocked(deps.verifyUser).mockResolvedValueOnce(null);
  expect((await call({action:'list-imports'})).response.status).toBe(401);
  vi.mocked(deps.isAdmin).mockResolvedValueOnce(false);
  expect((await call({action:'list-imports'})).response.status).toBe(403);
  expect(deps.listImports).not.toHaveBeenCalled();
 });
 it('허용 origin만 CORS를 제공하며 일반 브라우저 밖에서도 인증을 요구한다',async()=>{
  const denied=await call({action:'list-imports'},{origin:'https://evil.example'});
  expect(denied.response.status).toBe(403);expect(deps.verifyUser).not.toHaveBeenCalled();
  const preflight=await call({}, {method:'OPTIONS',token:null,origin:'https://jaeinlee0502.github.io'});
  expect(preflight.response.status).toBe(204);expect(preflight.response.headers.get('access-control-allow-origin')).toBe('https://jaeinlee0502.github.io');
  expect((await call({action:'list-imports'})).response.status).toBe(200);
 });
 it('요청 방식·내용 형식·잘못된 JSON을 거절한다',async()=>{
  expect((await call({}, {method:'GET'})).response.status).toBe(405);
  expect((await call({}, {contentType:'text/plain'})).response.status).toBe(415);
  expect((await call({}, {raw:'{broken'})).response.status).toBe(400);
  expect((await call([])).response.status).toBe(400);
 });
 it('Content-Length와 실제 UTF-8 바이트를 모두 제한한다',async()=>{
  expect((await call({action:'list-imports'}, {length:String(512*1024+1)})).response.status).toBe(413);
  expect((await call({action:'list-imports',text:'한'.repeat(180000)})).response.status).toBe(413);
  expect(deps.listImports).not.toHaveBeenCalled();
 });
 it('초안 목록과 개별 기록을 관리자에게만 반환하고 응답 캐시를 막는다',async()=>{
  const listed=await call({action:'list-imports'});
  expect(listed.data.imports).toHaveLength(1);expect(listed.response.headers.get('cache-control')).toBe('no-store');
  const selected=await call({action:'get-import',id});expect(selected.data.import.id).toBe(id);
 });
 it('확인한 파일명·해시·쪽수로 PDF 초안을 만든다',async()=>{
  const result=await call({action:'create-import',fileName:' 한국사.pdf ',sha256:'A'.repeat(64),pageCount:4});
  expect(result.response.status).toBe(201);
  expect(deps.createImport).toHaveBeenCalledWith(actor,{fileName:'한국사.pdf',sha256:'a'.repeat(64),pageCount:4});
 });
 it('PDF가 아닌 이름·잘못된 해시·쪽수 범위를 거절한다',async()=>{
  const base={action:'create-import',fileName:'exam.pdf',sha256:'a'.repeat(64),pageCount:4};
  for(const invalid of [{fileName:'exam.exe'},{sha256:'not-a-hash'},{pageCount:0},{pageCount:41},{pageCount:1.5}])expect((await call({...base,...invalid})).response.status).toBe(400);
  expect(deps.createImport).not.toHaveBeenCalled();
 });
 it('식별자를 확인하고 없는 초안을 404로 안내한다',async()=>{
  expect((await call({action:'get-import',id:'other/object'})).response.status).toBe(400);
  vi.mocked(deps.getImport).mockResolvedValueOnce(null);
  expect((await call({action:'get-import',id})).response.status).toBe(404);
 });
 it('정보가 일부만 인식된 초안과 아직 검수하지 않은 문항을 저장할 수 있다',async()=>{
  const draft={...question(),tags:[' 현대사 ','현대사']};
  expect((await call({action:'save-draft',id,metadata:{subject:'한국사',sourceUrl:''},questions:[draft]})).response.status).toBe(200);
  expect(deps.saveDraft).toHaveBeenCalledWith(actor,id,{subject:'한국사',sourceUrl:''},[{...question(),tags:['현대사']}],[]);
 });
 it('임의 외부 출처·계정 정보가 들어간 링크·잘못된 학년과 시행월은 저장하지 않는다',async()=>{
  for(const metadata of [{sourceUrl:'http://www.ebsi.co.kr/'},{sourceUrl:'https://www.ebsi.co.kr.evil.example/'},{sourceUrl:'https://user:password@www.ebsi.co.kr/'},{grade:3},{month:4},{year:2024},{subject:'admin'}]){
   expect((await call({action:'save-draft',id,metadata,questions:[question()]})).response.status).toBe(400);
  }
  expect(deps.saveDraft).not.toHaveBeenCalled();
 });
 it('문항 번호 중복과 페이지 밖의 추출 영역을 저장하지 않는다',async()=>{
  expect((await call({action:'save-draft',id,metadata:{},questions:[question(),{...question(),clientId:'44444444-4444-4444-8444-444444444444'}]})).response.status).toBe(400);
  for(const regions of [[{page:5,left:.1,top:.1,right:.5,bottom:.8}],[{page:1,left:.5,top:.1,right:.1,bottom:.8}],[{page:1,left:-1,top:.1,right:.5,bottom:.8}]])expect((await call({action:'save-draft',id,metadata:{},questions:[{...question(),regions}]})).response.status).toBe(400);
  expect(deps.saveDraft).not.toHaveBeenCalled();
 });
 it('공통 지문과 문항 연결·단답형·공통 지시를 함께 저장한다',async()=>{
  const passageId='44444444-4444-4444-8444-444444444444';
  const passage={clientId:passageId,title:' 공통 지문 ',searchText:'지문 내용',reviewed:false,
   regions:[{page:1,left:.1,top:.1,right:.5,bottom:.5}],imageSizes:[{width:800,height:900}]};
  const linked={...question(),passageClientId:passageId,instruction:' 다음 글을 읽으시오. ',responseType:'short_answer'};
  const result=await call({action:'save-draft',id,metadata:{subject:'영어',excludedNumbers:[1,2,3]},questions:[linked],passages:[passage]});
  expect(result.response.status).toBe(200);
  expect(deps.saveDraft).toHaveBeenCalledWith(actor,id,{subject:'영어',excludedNumbers:[1,2,3]},
   [{...linked,instruction:'다음 글을 읽으시오.'}],[{...passage,title:'공통 지문'}]);
 });
 it('없는 지문 연결·잘못된 지문 영역·이미지 크기·중복 식별자를 저장하지 않는다',async()=>{
  const passage={clientId:'44444444-4444-4444-8444-444444444444',title:'지문',searchText:'본문',reviewed:false,regions:[{page:1,left:.1,top:.1,right:.5,bottom:.5}]};
  const base={action:'save-draft',id,metadata:{},questions:[{...question(),passageClientId:passage.clientId}],passages:[passage]};
  for(const update of [{passages:[]},{passages:[passage,passage]},{passages:[{...passage,regions:[]}]},
   {passages:[{...passage,regions:[{page:5,left:.1,top:.1,right:.5,bottom:.5}]}]},
   {passages:[{...passage,imageSizes:[]}]},{passages:[{...passage,imageSizes:[{width:0,height:100}]}]}]) {
   expect((await call({...base,...update})).response.status).toBe(400);
  }
  expect(deps.saveDraft).not.toHaveBeenCalled();
 });
 it('제외 문항 번호·응답 형식·공통 지시의 범위를 검증한다',async()=>{
  for(const metadata of [{excludedNumbers:[1,1]},{excludedNumbers:[0]},{excludedNumbers:[101]},{excludedNumbers:['1']}])
   expect((await call({action:'save-draft',id,metadata,questions:[question()]})).response.status).toBe(400);
  for(const invalid of [{responseType:'essay'},{instruction:'가'.repeat(2001)},{passageClientId:''}])
   expect((await call({action:'save-draft',id,metadata:{},questions:[{...question(),...invalid}]})).response.status).toBe(400);
  expect(deps.saveDraft).not.toHaveBeenCalled();
 });
 it('완료 문항 수를 반환하고 서버의 중복·미검수 오류를 유지한다',async()=>{
  const published=await call({action:'publish',id});expect(published.data.count).toBe(1);expect(deps.publish).toHaveBeenCalledWith(actor,id);
  vi.mocked(deps.publish).mockRejectedValueOnce(new ImportError(409,'IMPORT_CONFLICT','중복 문항'));
  const conflict=await call({action:'publish',id});expect(conflict.response.status).toBe(409);expect(conflict.data.code).toBe('IMPORT_CONFLICT');
  vi.mocked(deps.publish).mockRejectedValueOnce(new ImportError(409,'IMPORT_NOT_READY','검수 필요'));
  expect((await call({action:'publish',id})).data.code).toBe('IMPORT_NOT_READY');
 });
 it('AI 제목 추천도 관리자와 미등록 초안만 사용하며 본문과 선택 해설을 전달한다',async()=>{
  const q={clientId,number:2,text:'기후와 생활 모습을 비교하시오.',passageText:'',instruction:'',tags:['지리']};
  vi.mocked(deps.suggestTitles).mockResolvedValue([{clientId,title:'기후와 지역별 생활 모습 비교'}]);
  const result=await call({action:'suggest-titles',id,subject:'통합사회',questions:[q],explanationText:'2번 해설'});
  expect(result.response.status).toBe(200);
  expect(deps.suggestTitles).toHaveBeenCalledExactlyOnceWith({subject:'통합사회',questions:[q],explanationText:'2번 해설'});
  vi.mocked(deps.isAdmin).mockResolvedValueOnce(false);
  expect((await call({action:'suggest-titles',id,subject:'통합사회',questions:[q]})).response.status).toBe(403);
  vi.mocked(deps.getImport).mockResolvedValueOnce({...record,status:'published'});
  expect((await call({action:'suggest-titles',id,subject:'통합사회',questions:[q]})).data.code).toBe('IMPORT_PUBLISHED');
  expect(deps.suggestTitles).toHaveBeenCalledTimes(1);
 });
 it('AI 요청의 문항 수·식별자·길이와 해설 크기를 제한한다',async()=>{
  const q={clientId,number:2,text:'문제',passageText:'',instruction:'',tags:[]};
  const base={action:'suggest-titles',id,subject:'통합사회',questions:[q]};
  for(const invalid of [{questions:[]},{questions:Array(11).fill(q)},{questions:[q,q]},
   {questions:[{...q,text:'가'.repeat(8001)}]},{explanationText:'가'.repeat(60001)},{subject:'관리자'}])
    expect((await call({...base,...invalid})).data.code).toBe('INVALID_TITLE_REQUEST');
  expect(deps.suggestTitles).not.toHaveBeenCalled();
  vi.mocked(deps.suggestTitles).mockRejectedValueOnce(new ImportError(429,'AI_RATE_LIMITED','요청 제한'));
  expect((await call(base)).data.code).toBe('AI_RATE_LIMITED');
 });
 it('제목·태그 분류도 같은 관리자·초안·요청 제한을 적용한다',async()=>{
  const q={clientId,number:3,text:'1987년 6월 민주 항쟁',passageText:'',instruction:'',tags:[]};
  const suggestions=[{clientId,title:'민주화 운동과 직선제 개헌',tags:['현대사','정치사'],reviewNote:'1987년 민주화 운동 자료'}];
  vi.mocked(deps.suggestMetadata).mockResolvedValue(suggestions);
  const result=await call({action:'suggest-metadata',id,subject:'한국사',questions:[q]});
  expect(result.data.suggestions).toEqual(suggestions);
  expect(deps.suggestMetadata).toHaveBeenCalledExactlyOnceWith({subject:'한국사',questions:[q],explanationText:''});
  vi.mocked(deps.isAdmin).mockResolvedValueOnce(false);
  expect((await call({action:'suggest-metadata',id,subject:'한국사',questions:[q]})).response.status).toBe(403);
  vi.mocked(deps.getImport).mockResolvedValueOnce({...record,status:'published'});
  expect((await call({action:'suggest-metadata',id,subject:'한국사',questions:[q]})).data.code).toBe('IMPORT_PUBLISHED');
  expect((await call({action:'suggest-metadata',id,subject:'한국사',questions:Array(11).fill(q)})).response.status).toBe(400);
  expect(deps.suggestMetadata).toHaveBeenCalledTimes(1);
 });
 it('AI 분류 검수 안내를 초안에 보존하고 길이와 형식을 검사한다',async()=>{
  const q={...question(),aiReviewNote:'시대 태그 확인이 필요해요.'};
  expect((await call({action:'save-draft',id,metadata:{},questions:[q]})).response.status).toBe(200);
  expect(deps.saveDraft).toHaveBeenCalledWith(actor,id,{},[q],[]);
  for(const aiReviewNote of [1,'가'.repeat(601)]) expect((await call({action:'save-draft',id,metadata:{},questions:[{...q,aiReviewNote}]})).response.status).toBe(400);
 });
 it('등록한 자료를 초안으로 수정하거나 삭제할 수 없다',async()=>{
  vi.mocked(deps.getImport).mockResolvedValue({...record,status:'published'});
  expect((await call({action:'save-draft',id,metadata:{},questions:[]})).response.status).toBe(409);
  expect((await call({action:'delete-draft',id})).response.status).toBe(409);
  expect(deps.saveDraft).not.toHaveBeenCalled();expect(deps.deleteImport).not.toHaveBeenCalled();
 });
 it('등록 완료 자료도 관리자 전용 삭제 요청으로 삭제하고 기존 초안 삭제 요청은 구분한다',async()=>{
  vi.mocked(deps.getImport).mockResolvedValue({...record,status:'published'});
  expect((await call({action:'delete-import',id})).response.status).toBe(200);
  expect(deps.deleteImport).toHaveBeenCalledExactlyOnceWith(actor,id,true);
  vi.mocked(deps.isAdmin).mockResolvedValueOnce(false);
  expect((await call({action:'delete-import',id})).response.status).toBe(403);
  expect(deps.deleteImport).toHaveBeenCalledTimes(1);
  vi.mocked(deps.getImport).mockResolvedValue(record);
  expect((await call({action:'delete-draft',id})).response.status).toBe(200);
  expect(deps.deleteImport).toHaveBeenLastCalledWith(actor,id,false);
 });
 it('파일 삭제가 실패한 초안의 재시도를 허용하고 서버 내부 오류는 노출하지 않는다',async()=>{
  vi.mocked(deps.getImport).mockResolvedValue({...record,deleting_at:'2026-10-25'});
  expect((await call({action:'delete-draft',id})).response.status).toBe(200);
  vi.mocked(deps.deleteImport).mockRejectedValueOnce(new ImportError(502,'STORAGE_DELETE_FAILED','삭제 재시도'));
  expect((await call({action:'delete-draft',id})).data.code).toBe('STORAGE_DELETE_FAILED');
  vi.mocked(deps.listImports).mockRejectedValueOnce(new Error('private server details'));
  const result=await call({action:'list-imports'});expect(result.response.status).toBe(503);expect(JSON.stringify(result.data)).not.toContain('private server details');
 });
});
