-- Admin-only PDF drafts. Only a reviewed import can enter the school library.
create table public.exam_imports (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  file_name text not null check (char_length(file_name) between 1 and 200),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  page_count integer not null check (page_count between 1 and 40),
  source_path text not null unique,
  status text not null default 'draft' check (status in ('draft','published')),
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  questions jsonb not null default '[]' check (jsonb_typeof(questions) = 'array'),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  deleting_at timestamptz,
  check (source_path = 'imports/' || id::text || '/source.pdf')
);
create index exam_imports_created on public.exam_imports(created_at desc);
alter table public.exam_imports enable row level security;
revoke all on public.exam_imports from public, anon, authenticated;
grant select on public.exam_imports to authenticated;
grant all on public.exam_imports to service_role;
create policy "Administrators read exam import drafts" on public.exam_imports for select to authenticated
  using (exists(select 1 from public.account_admins where user_id = (select auth.uid())));

alter table public.exam_questions add column import_id uuid references public.exam_imports(id) on delete restrict;
create index exam_questions_import on public.exam_questions(import_id) where import_id is not null;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('exam-imports','exam-imports',false,20971520,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy "Administrators read draft PDFs" on storage.objects for select to authenticated
  using (bucket_id='exam-imports'
    and exists(select 1 from public.account_admins where user_id=(select auth.uid()))
    and exists(select 1 from public.exam_imports i where i.source_path=name and i.status='draft' and i.deleting_at is null));
create policy "Administrators upload draft PDFs" on storage.objects for insert to authenticated
  with check (bucket_id='exam-imports'
    and exists(select 1 from public.account_admins where user_id=(select auth.uid()))
    and exists(select 1 from public.exam_imports i where i.source_path=name and i.status='draft' and i.deleting_at is null));
create policy "Administrators revise draft PDFs" on storage.objects for update to authenticated
  using (bucket_id='exam-imports'
    and exists(select 1 from public.account_admins where user_id=(select auth.uid()))
    and exists(select 1 from public.exam_imports i where i.source_path=name and i.status='draft' and i.deleting_at is null))
  with check (bucket_id='exam-imports'
    and exists(select 1 from public.account_admins where user_id=(select auth.uid()))
    and exists(select 1 from public.exam_imports i where i.source_path=name and i.status='draft' and i.deleting_at is null));
create policy "Administrators delete draft PDFs" on storage.objects for delete to authenticated
  using (bucket_id='exam-imports'
    and exists(select 1 from public.account_admins where user_id=(select auth.uid()))
    and exists(select 1 from public.exam_imports i where i.source_path=name and i.status='draft' and i.deleting_at is null));

-- A school's members cannot list or download an unregistered draft image.
drop policy "Approved school users read question images" on storage.objects;
create policy "Approved school users read question images" on storage.objects for select to authenticated
  using (bucket_id='school-questions' and (select public.has_school_access())
    and exists(select 1 from public.exam_questions q where q.image_path=name));
create policy "Administrators read question draft images" on storage.objects for select to authenticated
  using (bucket_id='school-questions' and exists(select 1 from public.account_admins where user_id=(select auth.uid())));
create policy "Administrators upload question draft images" on storage.objects for insert to authenticated
  with check (bucket_id='school-questions'
    and exists(select 1 from public.account_admins where user_id=(select auth.uid()))
    and exists(select 1 from public.exam_imports i where i.status='draft' and i.deleting_at is null
      and name ~ ('^imports/' || i.id::text || '/questions/[a-fA-F0-9-]{36}[.]webp$')));
create policy "Administrators revise question draft images" on storage.objects for update to authenticated
  using (bucket_id='school-questions'
    and exists(select 1 from public.account_admins where user_id=(select auth.uid()))
    and exists(select 1 from public.exam_imports i where i.status='draft' and i.deleting_at is null
      and name ~ ('^imports/' || i.id::text || '/questions/[a-fA-F0-9-]{36}[.]webp$')))
  with check (bucket_id='school-questions'
    and exists(select 1 from public.account_admins where user_id=(select auth.uid()))
    and exists(select 1 from public.exam_imports i where i.status='draft' and i.deleting_at is null
      and name ~ ('^imports/' || i.id::text || '/questions/[a-fA-F0-9-]{36}[.]webp$')));
create policy "Administrators delete question draft images" on storage.objects for delete to authenticated
  using (bucket_id='school-questions'
    and exists(select 1 from public.account_admins where user_id=(select auth.uid()))
    and exists(select 1 from public.exam_imports i where i.status='draft' and i.deleting_at is null
      and name ~ ('^imports/' || i.id::text || '/questions/[a-fA-F0-9-]{36}[.]webp$')));

-- Validation is repeated inside the database, not entrusted to the web form.
create function public.validate_exam_import(p_import public.exam_imports, p_complete boolean)
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
      or jsonb_array_length(q->'tags')=0 or jsonb_array_length(q->'regions')=0
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
revoke all on function public.validate_exam_import(public.exam_imports,boolean) from public,anon,authenticated;
grant execute on function public.validate_exam_import(public.exam_imports,boolean) to service_role;

create function public.save_exam_import_draft(p_actor_user_id uuid,p_import_id uuid,p_metadata jsonb,p_questions jsonb)
returns public.exam_imports language plpgsql security definer set search_path=''
as $$
declare i public.exam_imports;
begin
  if not exists(select 1 from public.account_admins where user_id=p_actor_user_id) then raise exception 'NOT_ADMIN'; end if;
  select * into i from public.exam_imports where id=p_import_id for update;
  if not found then raise exception 'IMPORT_NOT_FOUND'; end if;
  if i.status<>'draft' then raise exception 'IMPORT_PUBLISHED'; end if;
  if i.deleting_at is not null then raise exception 'IMPORT_DELETING'; end if;
  i.metadata:=p_metadata; i.questions:=p_questions;
  perform public.validate_exam_import(i,false);
  update public.exam_imports set metadata=p_metadata,questions=p_questions where id=i.id returning * into i;
  return i;
end;
$$;
revoke all on function public.save_exam_import_draft(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_exam_import_draft(uuid,uuid,jsonb,jsonb) to service_role;

create function public.publish_exam_import(p_actor_user_id uuid,p_import_id uuid)
returns integer language plpgsql security definer set search_path=''
as $$
declare i public.exam_imports; q jsonb; image text; n integer;
begin
  if not exists(select 1 from public.account_admins where user_id=p_actor_user_id) then raise exception 'NOT_ADMIN'; end if;
  select * into i from public.exam_imports where id=p_import_id for update;
  if not found then raise exception 'IMPORT_NOT_FOUND'; end if;
  if i.deleting_at is not null then raise exception 'IMPORT_DELETING'; end if;
  if i.status='published' then return (select count(*)::int from public.exam_questions where import_id=i.id); end if;
  perform public.validate_exam_import(i,true);
  if not exists(select 1 from storage.objects where bucket_id='exam-imports' and name=i.source_path
    and metadata->>'mimetype'='application/pdf') then raise exception 'IMPORT_NOT_READY'; end if;
  for q in select value from jsonb_array_elements(i.questions) loop
    image:='imports/'||i.id::text||'/questions/'||(q->>'clientId')||'.webp';
    if not exists(select 1 from storage.objects where bucket_id='school-questions' and name=image
      and metadata->>'mimetype'='image/webp') then raise exception 'IMPORT_NOT_READY'; end if;
  end loop;
  begin
    insert into public.exam_questions(id,subject,grade,year,month,number,title,tags,search_text,image_path,width,height,points,source_url,explanation_url,source_page,curriculum_status,import_id)
    select 'import-'||i.id::text||'-'||(entry.value->>'clientId'),i.metadata->>'subject',(i.metadata->>'grade')::int,(i.metadata->>'year')::int,(i.metadata->>'month')::int,
      (entry.value->>'number')::int,trim(entry.value->>'title'),array(select trim(value) from jsonb_array_elements_text(entry.value->'tags')),
      entry.value->>'searchText','imports/'||i.id::text||'/questions/'||(entry.value->>'clientId')||'.webp',(entry.value->>'width')::int,(entry.value->>'height')::int,
      (entry.value->>'points')::int,i.metadata->>'sourceUrl',i.metadata->>'explanationUrl',(entry.value->'regions'->0->>'page')::int,'admin_reviewed_not_certified',i.id
    from jsonb_array_elements(i.questions) as entry(value);
  exception when unique_violation then raise exception 'IMPORT_CONFLICT'; end;
  get diagnostics n=row_count;
  update public.exam_imports set status='published',published_at=now() where id=i.id;
  return n;
end;
$$;
revoke all on function public.publish_exam_import(uuid,uuid) from public,anon,authenticated;
grant execute on function public.publish_exam_import(uuid,uuid) to service_role;

create function public.begin_delete_exam_import(p_actor_user_id uuid,p_import_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare i public.exam_imports; paths jsonb;
begin
  if not exists(select 1 from public.account_admins where user_id=p_actor_user_id) then raise exception 'NOT_ADMIN'; end if;
  select * into i from public.exam_imports where id=p_import_id for update;
  if not found then raise exception 'IMPORT_NOT_FOUND'; end if;
  if i.status<>'draft' then raise exception 'IMPORT_PUBLISHED'; end if;
  update public.exam_imports set deleting_at=coalesce(deleting_at,now()) where id=i.id;
  select coalesce(jsonb_agg(name),'[]') into paths from storage.objects
    where bucket_id='school-questions' and name like ('imports/'||i.id::text||'/questions/%');
  return jsonb_build_object('source_path',i.source_path,'image_paths',paths);
end;
$$;
revoke all on function public.begin_delete_exam_import(uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_delete_exam_import(uuid,uuid) to service_role;

create function public.finish_delete_exam_import(p_actor_user_id uuid,p_import_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare i public.exam_imports;
begin
  if not exists(select 1 from public.account_admins where user_id=p_actor_user_id) then raise exception 'NOT_ADMIN'; end if;
  select * into i from public.exam_imports where id=p_import_id for update;
  if not found then raise exception 'IMPORT_NOT_FOUND'; end if;
  if i.status<>'draft' or i.deleting_at is null then raise exception 'IMPORT_PUBLISHED'; end if;
  if exists(select 1 from storage.objects where bucket_id='exam-imports' and name=i.source_path)
    or exists(select 1 from storage.objects where bucket_id='school-questions' and name like ('imports/'||i.id::text||'/questions/%')) then raise exception 'STORAGE_DELETE_FAILED'; end if;
  delete from public.exam_imports where id=i.id;
end;
$$;
revoke all on function public.finish_delete_exam_import(uuid,uuid) from public,anon,authenticated;
grant execute on function public.finish_delete_exam_import(uuid,uuid) to service_role;
