-- School-only library. Membership is granted only by the trusted admin server.
-- Existing administrators retain access; existing ordinary accounts await approval.

create table public.school_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  approved_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null
);

create table public.school_membership_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null,
  target_user_id uuid not null,
  action text not null check (action in ('approved', 'revoked')),
  created_at timestamptz not null default now()
);
create index school_membership_audit_time on public.school_membership_audit(created_at desc);

alter table public.school_members enable row level security;
alter table public.school_membership_audit enable row level security;
revoke all on public.school_members, public.school_membership_audit from public, anon, authenticated;
grant select on public.school_members to authenticated;
grant all on public.school_members, public.school_membership_audit to service_role;

create policy "Read own school membership" on public.school_members
  for select to authenticated using ((select auth.uid()) = user_id);

create function public.has_school_access()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    exists (select 1 from public.account_admins where user_id = (select auth.uid()))
    or exists (select 1 from public.school_members where user_id = (select auth.uid()))
  );
$$;
revoke all on function public.has_school_access() from public, anon, authenticated;
grant execute on function public.has_school_access() to authenticated, service_role;

create function public.set_school_membership(p_actor_user_id uuid, p_target_user_id uuid, p_approved boolean)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if p_approved is null then raise exception 'INVALID_ACTION'; end if;
  -- Serialize changes for the same target; approval and its audit commit together.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('membership:' || p_target_user_id::text, 0));
  if not exists (select 1 from public.account_admins where user_id = p_actor_user_id) then
    raise exception 'NOT_ADMIN';
  end if;
  if p_actor_user_id = p_target_user_id or exists (select 1 from public.account_admins where user_id = p_target_user_id) then
    raise exception 'PROTECTED_ACCOUNT';
  end if;
  if not exists (select 1 from public.profiles where user_id = p_target_user_id) then
    raise exception 'ACCOUNT_NOT_FOUND';
  end if;
  if p_approved then
    insert into public.school_members(user_id, approved_by)
      values(p_target_user_id, p_actor_user_id)
      on conflict(user_id) do nothing;
  else
    delete from public.school_members where user_id = p_target_user_id;
  end if;
  insert into public.school_membership_audit(actor_user_id, target_user_id, action)
    values(p_actor_user_id, p_target_user_id, case when p_approved then 'approved' else 'revoked' end);
  return p_approved;
end;
$$;
revoke all on function public.set_school_membership(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_school_membership(uuid, uuid, boolean) to service_role;

create function public.list_school_accounts()
returns table(user_id uuid, email text, display_name text, created_at timestamptz, approved boolean, is_admin boolean)
language sql stable security definer set search_path = ''
as $$
  select p.user_id, p.email, p.display_name, p.created_at,
    (m.user_id is not null or a.user_id is not null) as approved,
    (a.user_id is not null) as is_admin
  from public.profiles p
  left join public.school_members m on m.user_id = p.user_id
  left join public.account_admins a on a.user_id = p.user_id
  order by (m.user_id is not null or a.user_id is not null) asc, p.created_at desc
  limit 200;
$$;
revoke all on function public.list_school_accounts() from public, anon, authenticated;
grant execute on function public.list_school_accounts() to service_role;

create table public.exam_questions (
  id text primary key check (char_length(id) between 1 and 160),
  subject text not null check (subject in ('국어', '수학', '영어', '한국사', '통합사회', '통합과학')),
  grade integer not null check (grade in (1, 2)),
  year integer not null check (year between 2025 and 2100),
  month integer not null check (month in (3, 6, 9, 10)),
  number integer not null check (number between 1 and 100),
  title text not null,
  tags text[] not null default '{}',
  search_text text not null default '',
  image_path text not null,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  points integer not null check (points between 1 and 10),
  source_url text not null check (source_url like 'https://%'),
  explanation_url text not null check (explanation_url like 'https://%'),
  source_page integer not null check (source_page > 0),
  curriculum_status text not null default 'not_certified',
  created_at timestamptz not null default now(),
  unique(subject, grade, year, month, number)
);
alter table public.exam_questions enable row level security;
revoke all on public.exam_questions from public, anon, authenticated;
grant select on public.exam_questions to authenticated;
grant all on public.exam_questions to service_role;
create policy "Approved school users read exam questions" on public.exam_questions
  for select to authenticated using ((select public.has_school_access()));

-- Bookmarks follow the same approval boundary as the library.
drop policy "Read own bookmarks" on public.bookmarks;
drop policy "Insert own bookmarks" on public.bookmarks;
drop policy "Update own bookmarks" on public.bookmarks;
drop policy "Delete own bookmarks" on public.bookmarks;
create policy "Read own bookmarks" on public.bookmarks for select to authenticated
  using ((select auth.uid()) = user_id and (select public.has_school_access()));
create policy "Insert own bookmarks" on public.bookmarks for insert to authenticated
  with check ((select auth.uid()) = user_id and (select public.has_school_access()));
create policy "Update own bookmarks" on public.bookmarks for update to authenticated
  using ((select auth.uid()) = user_id and (select public.has_school_access()))
  with check ((select auth.uid()) = user_id and (select public.has_school_access()));
create policy "Delete own bookmarks" on public.bookmarks for delete to authenticated
  using ((select auth.uid()) = user_id and (select public.has_school_access()));

-- Uploaded question images never live in the public repository or public bucket.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('school-questions', 'school-questions', false, 10485760, array['image/webp', 'image/png', 'image/jpeg'])
on conflict(id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "Approved school users read question images" on storage.objects
  for select to authenticated
  using (bucket_id = 'school-questions' and (select public.has_school_access()));

comment on table public.school_members is 'Explicit school-teacher approval. Membership must never be derived from user-editable metadata.';
comment on table public.exam_questions is 'School-only question metadata. Original question images belong in the private school-questions storage bucket.';
