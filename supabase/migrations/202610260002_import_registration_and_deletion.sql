-- Tags are optional: equation-only questions may not have a keyword suggestion.
create or replace function public.validate_exam_import_base(p_import public.exam_imports, p_complete boolean)
returns void language plpgsql set search_path=''
as $$
declare m jsonb := p_import.metadata; q jsonb; r jsonb; t jsonb; key text;
begin
  if jsonb_typeof(m) is distinct from 'object' or jsonb_typeof(p_import.questions) is distinct from 'array'
    or jsonb_array_length(p_import.questions)>100 then raise exception 'INVALID_DRAFT'; end if;
  if p_complete and jsonb_array_length(p_import.questions)=0 then raise exception 'IMPORT_NOT_READY'; end if;
  if m ? 'subject' and (jsonb_typeof(m->'subject') is distinct from 'string'
    or m->>'subject' not in ('국어','수학','영어','한국사','통합사회','통합과학')) then raise exception 'INVALID_METADATA'; end if;
  if m ? 'grade' and (coalesce(m->>'grade','') !~ '^[12]$') then raise exception 'INVALID_METADATA'; end if;
  if m ? 'year' then
    if coalesce(m->>'year','') !~ '^[0-9]{4}$' then raise exception 'INVALID_METADATA'; end if;
    if (m->>'year')::int not between 2025 and 2100 then raise exception 'INVALID_METADATA'; end if;
  end if;
  if m ? 'month' and coalesce(m->>'month','') not in ('3','6','9','10') then raise exception 'INVALID_METADATA'; end if;
  foreach key in array array['sourceUrl','explanationUrl'] loop
    if m ? key and (jsonb_typeof(m->key) is distinct from 'string' or char_length(m->>key)>2000
      or ((m->>key)<>'' and (m->>key) !~ '^https://www[.]ebsi[.]co[.]kr(/|$)')) then raise exception 'INVALID_METADATA'; end if;
  end loop;
  if p_complete and (not(m ?& array['subject','grade','year','month','sourceUrl','explanationUrl'])
    or coalesce(m->>'sourceUrl','')='' or coalesce(m->>'explanationUrl','')='') then raise exception 'IMPORT_NOT_READY'; end if;
  for q in select value from jsonb_array_elements(p_import.questions) loop
    if jsonb_typeof(q) is distinct from 'object'
      or coalesce(q->>'clientId','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      or coalesce(q->>'number','') !~ '^[0-9]{1,3}$'
      or jsonb_typeof(q->'title') is distinct from 'string' or char_length(q->>'title')>200
      or jsonb_typeof(q->'tags') is distinct from 'array' or jsonb_array_length(q->'tags')>20
      or coalesce(q->>'points','') !~ '^[0-9]{1,2}$'
      or jsonb_typeof(q->'searchText') is distinct from 'string' or char_length(q->>'searchText')>30000
      or jsonb_typeof(q->'reviewed') is distinct from 'boolean'
      or jsonb_typeof(q->'regions') is distinct from 'array' or jsonb_array_length(q->'regions')>16 then raise exception 'INVALID_DRAFT'; end if;
    if (q->>'number')::int not between 1 and 100 or (q->>'points')::int not between 1 and 10 then raise exception 'INVALID_DRAFT'; end if;
    foreach key in array array['width','height'] loop
      if q ? key then
        if coalesce(q->>key,'') !~ '^[0-9]{1,5}$' then raise exception 'INVALID_DRAFT'; end if;
        if (q->>key)::int not between 1 and 10000 then raise exception 'INVALID_DRAFT'; end if;
      end if;
    end loop;
    if p_complete and (q->>'reviewed'<>'true' or char_length(trim(q->>'title'))=0
      or jsonb_array_length(q->'regions')=0
      or not(q ?& array['width','height'])) then raise exception 'IMPORT_NOT_READY'; end if;
    for t in select value from jsonb_array_elements(q->'tags') loop
      if jsonb_typeof(t) is distinct from 'string' or char_length(trim(t #>> '{}')) not between 1 and 60 then raise exception 'INVALID_DRAFT'; end if;
    end loop;
    for r in select value from jsonb_array_elements(q->'regions') loop
      if jsonb_typeof(r) is distinct from 'object' or coalesce(r->>'page','') !~ '^[0-9]{1,2}$'
        or jsonb_typeof(r->'left') is distinct from 'number' or jsonb_typeof(r->'right') is distinct from 'number'
        or jsonb_typeof(r->'top') is distinct from 'number' or jsonb_typeof(r->'bottom') is distinct from 'number' then raise exception 'INVALID_DRAFT'; end if;
      if (r->>'page')::int not between 1 and p_import.page_count
        or (r->>'left')::numeric<0 or (r->>'top')::numeric<0 or (r->>'right')::numeric>1 or (r->>'bottom')::numeric>1
        or (r->>'left')::numeric >= (r->>'right')::numeric or (r->>'top')::numeric >= (r->>'bottom')::numeric then raise exception 'INVALID_DRAFT'; end if;
    end loop;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_import.questions) x group by x->>'clientId' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(p_import.questions) x group by (x->>'number')::int having count(*)>1) then raise exception 'INVALID_DRAFT'; end if;
end;
$$;
revoke all on function public.validate_exam_import_base(public.exam_imports,boolean) from public,anon,authenticated;
grant execute on function public.validate_exam_import_base(public.exam_imports,boolean) to service_role;

-- Freeze deletion and remove library references in one transaction before deleting
-- Storage objects. A failed Storage request leaves a visible, retryable import.
create function public.begin_delete_exam_import(p_actor_user_id uuid,p_import_id uuid,p_allow_published boolean)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare i public.exam_imports; paths jsonb;
begin
  if not exists(select 1 from public.account_admins where user_id=p_actor_user_id) then raise exception 'NOT_ADMIN'; end if;
  select * into i from public.exam_imports where id=p_import_id for update;
  if not found then raise exception 'IMPORT_NOT_FOUND'; end if;
  if i.status='published' and p_allow_published is distinct from true then raise exception 'IMPORT_PUBLISHED'; end if;
  update public.exam_imports set deleting_at=coalesce(deleting_at,now()) where id=i.id;
  select coalesce(jsonb_agg(name order by name),'[]') into paths from storage.objects
    where bucket_id='school-questions' and (name like ('imports/'||i.id::text||'/questions/%') or name like ('imports/'||i.id::text||'/passages/%'));
  delete from public.bookmarks b using public.exam_questions q where b.question_id=q.id and q.import_id=i.id;
  delete from public.exam_questions where import_id=i.id;
  delete from public.exam_passages where import_id=i.id;
  return jsonb_build_object('source_path',i.source_path,'image_paths',paths);
end;
$$;
revoke all on function public.begin_delete_exam_import(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.begin_delete_exam_import(uuid,uuid,boolean) to service_role;

-- Older clients and failed-upload cleanup retain draft-only semantics, including
-- when another administrator publishes between their initial read and this lock.
create or replace function public.begin_delete_exam_import(p_actor_user_id uuid,p_import_id uuid)
returns jsonb language sql security definer set search_path=''
as $$ select public.begin_delete_exam_import(p_actor_user_id,p_import_id,false) $$;
revoke all on function public.begin_delete_exam_import(uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_delete_exam_import(uuid,uuid) to service_role;

create or replace function public.finish_delete_exam_import(p_actor_user_id uuid,p_import_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare i public.exam_imports;
begin
  if not exists(select 1 from public.account_admins where user_id=p_actor_user_id) then raise exception 'NOT_ADMIN'; end if;
  select * into i from public.exam_imports where id=p_import_id for update;
  if not found then raise exception 'IMPORT_NOT_FOUND'; end if;
  if i.deleting_at is null then raise exception 'IMPORT_NOT_READY'; end if;
  if exists(select 1 from storage.objects where bucket_id='exam-imports' and name=i.source_path)
    or exists(select 1 from storage.objects where bucket_id='school-questions'
      and (name like ('imports/'||i.id::text||'/questions/%') or name like ('imports/'||i.id::text||'/passages/%'))) then raise exception 'STORAGE_DELETE_FAILED'; end if;
  delete from public.exam_imports where id=i.id;
end;
$$;
revoke all on function public.finish_delete_exam_import(uuid,uuid) from public,anon,authenticated;
grant execute on function public.finish_delete_exam_import(uuid,uuid) to service_role;
