-- Common passages stay private until every linked question and image is reviewed.
alter table public.exam_imports add column passages jsonb not null default '[]'
  check (jsonb_typeof(passages)='array' and jsonb_array_length(passages)<=100);

create table public.exam_passages (
  id text primary key,
  import_id uuid not null references public.exam_imports(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 1 and 200),
  search_text text not null default '' check (char_length(search_text)<=30000),
  images jsonb not null check (jsonb_typeof(images)='array' and jsonb_array_length(images) between 1 and 12),
  unique(id,import_id)
);
create index exam_passages_import on public.exam_passages(import_id);
alter table public.exam_passages enable row level security;
revoke all on public.exam_passages from public,anon,authenticated;
grant select on public.exam_passages to authenticated;
grant all on public.exam_passages to service_role;
create policy "Approved school users read published passages" on public.exam_passages for select to authenticated
  using ((select public.has_school_access()));

alter table public.exam_questions
  add column passage_id text,
  add column instruction text not null default '' check(char_length(instruction)<=2000),
  add column response_type text not null default 'multiple_choice'
    check(response_type in ('multiple_choice','short_answer')),
  add constraint exam_questions_passage_import_fk foreign key(passage_id,import_id)
    references public.exam_passages(id,import_id) on delete restrict,
  add constraint exam_questions_passage_requires_import check(passage_id is null or import_id is not null);
create index exam_questions_passage on public.exam_questions(passage_id) where passage_id is not null;

drop policy "Approved school users read question images" on storage.objects;
create policy "Approved school users read question images" on storage.objects for select to authenticated
  using (bucket_id='school-questions' and (select public.has_school_access())
    and (exists(select 1 from public.exam_questions q where q.image_path=name)
      or exists(select 1 from public.exam_passages p, jsonb_array_elements(p.images) part where part->>'path'=name)));

create policy "Administrators upload passage draft images" on storage.objects for insert to authenticated
  with check (bucket_id='school-questions'
    and exists(select 1 from public.account_admins where user_id=(select auth.uid()))
    and exists(select 1 from public.exam_imports i where i.status='draft' and i.deleting_at is null
      and name ~ ('^imports/'||i.id::text||'/passages/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/(0|[1-9]|1[01])[.]webp$')));
create policy "Administrators revise passage draft images" on storage.objects for update to authenticated
  using (bucket_id='school-questions'
    and exists(select 1 from public.account_admins where user_id=(select auth.uid()))
    and exists(select 1 from public.exam_imports i where i.status='draft' and i.deleting_at is null
      and name ~ ('^imports/'||i.id::text||'/passages/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/(0|[1-9]|1[01])[.]webp$')))
  with check (bucket_id='school-questions'
    and exists(select 1 from public.account_admins where user_id=(select auth.uid()))
    and exists(select 1 from public.exam_imports i where i.status='draft' and i.deleting_at is null
      and name ~ ('^imports/'||i.id::text||'/passages/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/(0|[1-9]|1[01])[.]webp$')));
create policy "Administrators delete passage draft images" on storage.objects for delete to authenticated
  using (bucket_id='school-questions'
    and exists(select 1 from public.account_admins where user_id=(select auth.uid()))
    and exists(select 1 from public.exam_imports i where i.status='draft' and i.deleting_at is null
      and name ~ ('^imports/'||i.id::text||'/passages/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/(0|[1-9]|1[01])[.]webp$')));

-- Keep the original metadata/question checks, then check the added relationships.
alter function public.validate_exam_import(public.exam_imports,boolean) rename to validate_exam_import_base;
create function public.validate_exam_import(p_import public.exam_imports,p_complete boolean)
returns void language plpgsql set search_path=''
as $$
declare p jsonb; q jsonb; r jsonb; size jsonb; n jsonb; part_count integer;
begin
  perform public.validate_exam_import_base(p_import,p_complete);
  if jsonb_typeof(p_import.passages) is distinct from 'array' or jsonb_array_length(p_import.passages)>100 then raise exception 'INVALID_PASSAGES'; end if;
  if p_import.metadata ? 'excludedNumbers' then
    if jsonb_typeof(p_import.metadata->'excludedNumbers') is distinct from 'array'
      or jsonb_array_length(p_import.metadata->'excludedNumbers')>100 then raise exception 'INVALID_METADATA'; end if;
    for n in select value from jsonb_array_elements(p_import.metadata->'excludedNumbers') loop
      if jsonb_typeof(n) is distinct from 'number' or (n #>> '{}') !~ '^[0-9]{1,3}$' then raise exception 'INVALID_METADATA'; end if;
      if (n #>> '{}')::integer not between 1 and 100 then raise exception 'INVALID_METADATA'; end if;
    end loop;
    if exists(select 1 from jsonb_array_elements(p_import.metadata->'excludedNumbers') x group by x having count(*)>1) then raise exception 'INVALID_METADATA'; end if;
    if p_complete and exists(select 1 from jsonb_array_elements(p_import.questions) item,
      jsonb_array_elements(p_import.metadata->'excludedNumbers') excluded
      where (item->>'number')::integer=(excluded #>> '{}')::integer) then raise exception 'INVALID_METADATA'; end if;
  end if;
  if exists(select 1 from jsonb_array_elements(p_import.questions) x group by lower(x->>'clientId') having count(*)>1) then raise exception 'INVALID_DRAFT'; end if;
  for p in select value from jsonb_array_elements(p_import.passages) loop
    if jsonb_typeof(p) is distinct from 'object'
      or coalesce(p->>'clientId','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      or jsonb_typeof(p->'title') is distinct from 'string' or char_length(p->>'title')>200
      or jsonb_typeof(p->'searchText') is distinct from 'string' or char_length(p->>'searchText')>30000
      or jsonb_typeof(p->'reviewed') is distinct from 'boolean'
      or jsonb_typeof(p->'regions') is distinct from 'array'
      or jsonb_array_length(p->'regions') not between 1 and 12 then raise exception 'INVALID_PASSAGES'; end if;
    part_count:=jsonb_array_length(p->'regions');
    for r in select value from jsonb_array_elements(p->'regions') loop
      if jsonb_typeof(r) is distinct from 'object' or coalesce(r->>'page','') !~ '^[0-9]{1,2}$'
        or jsonb_typeof(r->'left') is distinct from 'number' or jsonb_typeof(r->'top') is distinct from 'number'
        or jsonb_typeof(r->'right') is distinct from 'number' or jsonb_typeof(r->'bottom') is distinct from 'number' then raise exception 'INVALID_PASSAGES'; end if;
      if (r->>'page')::integer not between 1 and p_import.page_count
        or (r->>'left')::numeric<0 or (r->>'top')::numeric<0 or (r->>'right')::numeric>1 or (r->>'bottom')::numeric>1
        or (r->>'right')::numeric-(r->>'left')::numeric<.01 or (r->>'bottom')::numeric-(r->>'top')::numeric<.01 then raise exception 'INVALID_PASSAGES'; end if;
    end loop;
    if p ? 'imageSizes' then
      if jsonb_typeof(p->'imageSizes') is distinct from 'array' or jsonb_array_length(p->'imageSizes')<>part_count then raise exception 'INVALID_PASSAGES'; end if;
      for size in select value from jsonb_array_elements(p->'imageSizes') loop
        if jsonb_typeof(size) is distinct from 'object' or jsonb_typeof(size->'width') is distinct from 'number'
          or jsonb_typeof(size->'height') is distinct from 'number'
          or coalesce(size->>'width','') !~ '^[0-9]{1,5}$' or coalesce(size->>'height','') !~ '^[0-9]{1,5}$' then raise exception 'INVALID_PASSAGES'; end if;
        if (size->>'width')::integer not between 1 and 10000 or (size->>'height')::integer not between 1 and 10000 then raise exception 'INVALID_PASSAGES'; end if;
      end loop;
    end if;
    if p_complete then
      if p->>'reviewed'<>'true' or char_length(trim(p->>'title'))=0 or not(p ? 'imageSizes') then raise exception 'IMPORT_NOT_READY'; end if;
      if not exists(select 1 from jsonb_array_elements(p_import.questions) item where lower(item->>'passageClientId')=lower(p->>'clientId')) then raise exception 'INVALID_PASSAGES'; end if;
    end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_import.passages) x group by lower(x->>'clientId') having count(*)>1) then raise exception 'INVALID_PASSAGES'; end if;
  for q in select value from jsonb_array_elements(p_import.questions) loop
    if q ? 'passageClientId' then
      if jsonb_typeof(q->'passageClientId') is distinct from 'string'
        or coalesce(q->>'passageClientId','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
        or not exists(select 1 from jsonb_array_elements(p_import.passages) part where lower(part->>'clientId')=lower(q->>'passageClientId')) then raise exception 'INVALID_PASSAGES'; end if;
    end if;
    if q ? 'instruction' and (jsonb_typeof(q->'instruction') is distinct from 'string' or char_length(q->>'instruction')>2000) then raise exception 'INVALID_DRAFT'; end if;
    if q ? 'responseType' and (jsonb_typeof(q->'responseType') is distinct from 'string'
      or q->>'responseType' not in ('multiple_choice','short_answer')) then raise exception 'INVALID_DRAFT'; end if;
  end loop;
end;
$$;
revoke all on function public.validate_exam_import(public.exam_imports,boolean) from public,anon,authenticated;
grant execute on function public.validate_exam_import(public.exam_imports,boolean) to service_role;

create function public.save_exam_import_draft(p_actor_user_id uuid,p_import_id uuid,p_metadata jsonb,p_questions jsonb,p_passages jsonb)
returns public.exam_imports language plpgsql security definer set search_path=''
as $$
declare i public.exam_imports;
begin
  if not exists(select 1 from public.account_admins where user_id=p_actor_user_id) then raise exception 'NOT_ADMIN'; end if;
  select * into i from public.exam_imports where id=p_import_id for update;
  if not found then raise exception 'IMPORT_NOT_FOUND'; end if;
  if i.status<>'draft' then raise exception 'IMPORT_PUBLISHED'; end if;
  if i.deleting_at is not null then raise exception 'IMPORT_DELETING'; end if;
  i.metadata:=p_metadata; i.questions:=p_questions; i.passages:=p_passages;
  perform public.validate_exam_import(i,false);
  update public.exam_imports set metadata=p_metadata,questions=p_questions,passages=p_passages where id=i.id returning * into i;
  return i;
end;
$$;
revoke all on function public.save_exam_import_draft(uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_exam_import_draft(uuid,uuid,jsonb,jsonb,jsonb) to service_role;

-- Older clients can still save their original, passage-free drafts.
create or replace function public.save_exam_import_draft(p_actor_user_id uuid,p_import_id uuid,p_metadata jsonb,p_questions jsonb)
returns public.exam_imports language sql security definer set search_path=''
as $$ select public.save_exam_import_draft(p_actor_user_id,p_import_id,p_metadata,p_questions,'[]'::jsonb) $$;
revoke all on function public.save_exam_import_draft(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_exam_import_draft(uuid,uuid,jsonb,jsonb) to service_role;

create or replace function public.publish_exam_import(p_actor_user_id uuid,p_import_id uuid)
returns integer language plpgsql security definer set search_path=''
as $$
declare i public.exam_imports; q jsonb; p jsonb; image text; n integer;
begin
  if not exists(select 1 from public.account_admins where user_id=p_actor_user_id) then raise exception 'NOT_ADMIN'; end if;
  select * into i from public.exam_imports where id=p_import_id for update;
  if not found then raise exception 'IMPORT_NOT_FOUND'; end if;
  if i.deleting_at is not null then raise exception 'IMPORT_DELETING'; end if;
  if i.status='published' then return (select count(*)::integer from public.exam_questions where import_id=i.id); end if;
  perform public.validate_exam_import(i,true);
  if not exists(select 1 from storage.objects where bucket_id='exam-imports' and name=i.source_path
    and metadata->>'mimetype'='application/pdf') then raise exception 'IMPORT_NOT_READY'; end if;
  for q in select value from jsonb_array_elements(i.questions) loop
    image:='imports/'||i.id::text||'/questions/'||lower(q->>'clientId')||'.webp';
    if not exists(select 1 from storage.objects where bucket_id='school-questions' and name=image
      and metadata->>'mimetype'='image/webp') then raise exception 'IMPORT_NOT_READY'; end if;
  end loop;
  for p in select value from jsonb_array_elements(i.passages) loop
    -- The index comes from the saved order, never from a caller-provided path.
    for n in 0..jsonb_array_length(p->'regions')-1 loop
      image:='imports/'||i.id::text||'/passages/'||lower(p->>'clientId')||'/'||n::text||'.webp';
      if not exists(select 1 from storage.objects where bucket_id='school-questions' and name=image
        and metadata->>'mimetype'='image/webp') then raise exception 'IMPORT_NOT_READY'; end if;
    end loop;
  end loop;
  begin
    insert into public.exam_passages(id,import_id,title,search_text,images)
    select 'import-'||i.id::text||'-'||lower(entry.value->>'clientId'),i.id,trim(entry.value->>'title'),entry.value->>'searchText',
      (select jsonb_agg(jsonb_build_object('path','imports/'||i.id::text||'/passages/'||lower(entry.value->>'clientId')||'/'||(r.ordinality-1)::text||'.webp',
        'width',(entry.value->'imageSizes'->(r.ordinality-1)::integer->>'width')::integer,
        'height',(entry.value->'imageSizes'->(r.ordinality-1)::integer->>'height')::integer,'page',(r.value->>'page')::integer) order by r.ordinality)
       from jsonb_array_elements(entry.value->'regions') with ordinality as r(value,ordinality))
    from jsonb_array_elements(i.passages) as entry(value);
    insert into public.exam_questions(id,subject,grade,year,month,number,title,tags,search_text,image_path,width,height,points,source_url,explanation_url,source_page,curriculum_status,import_id,passage_id,instruction,response_type)
    select 'import-'||i.id::text||'-'||lower(entry.value->>'clientId'),i.metadata->>'subject',(i.metadata->>'grade')::integer,(i.metadata->>'year')::integer,(i.metadata->>'month')::integer,
      (entry.value->>'number')::integer,trim(entry.value->>'title'),array(select trim(value) from jsonb_array_elements_text(entry.value->'tags')),
      entry.value->>'searchText','imports/'||i.id::text||'/questions/'||lower(entry.value->>'clientId')||'.webp',(entry.value->>'width')::integer,(entry.value->>'height')::integer,
      (entry.value->>'points')::integer,i.metadata->>'sourceUrl',i.metadata->>'explanationUrl',(entry.value->'regions'->0->>'page')::integer,'admin_reviewed_not_certified',i.id,
      case when entry.value ? 'passageClientId' then 'import-'||i.id::text||'-'||lower(entry.value->>'passageClientId') else null end,
      coalesce(entry.value->>'instruction',''),coalesce(entry.value->>'responseType','multiple_choice')
    from jsonb_array_elements(i.questions) as entry(value);
    get diagnostics n=row_count;
  exception when unique_violation then raise exception 'IMPORT_CONFLICT'; end;
  update public.exam_imports set status='published',published_at=now() where id=i.id;
  return n;
end;
$$;
revoke all on function public.publish_exam_import(uuid,uuid) from public,anon,authenticated;
grant execute on function public.publish_exam_import(uuid,uuid) to service_role;

create or replace function public.begin_delete_exam_import(p_actor_user_id uuid,p_import_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare i public.exam_imports; paths jsonb;
begin
  if not exists(select 1 from public.account_admins where user_id=p_actor_user_id) then raise exception 'NOT_ADMIN'; end if;
  select * into i from public.exam_imports where id=p_import_id for update;
  if not found then raise exception 'IMPORT_NOT_FOUND'; end if;
  if i.status<>'draft' then raise exception 'IMPORT_PUBLISHED'; end if;
  update public.exam_imports set deleting_at=coalesce(deleting_at,now()) where id=i.id;
  select coalesce(jsonb_agg(name order by name),'[]') into paths from storage.objects
    where bucket_id='school-questions' and (name like ('imports/'||i.id::text||'/questions/%') or name like ('imports/'||i.id::text||'/passages/%'));
  return jsonb_build_object('source_path',i.source_path,'image_paths',paths);
end;
$$;
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
  if i.status<>'draft' or i.deleting_at is null then raise exception 'IMPORT_PUBLISHED'; end if;
  if exists(select 1 from storage.objects where bucket_id='exam-imports' and name=i.source_path)
    or exists(select 1 from storage.objects where bucket_id='school-questions'
      and (name like ('imports/'||i.id::text||'/questions/%') or name like ('imports/'||i.id::text||'/passages/%'))) then raise exception 'STORAGE_DELETE_FAILED'; end if;
  delete from public.exam_imports where id=i.id;
end;
$$;
revoke all on function public.finish_delete_exam_import(uuid,uuid) from public,anon,authenticated;
grant execute on function public.finish_delete_exam_import(uuid,uuid) to service_role;
