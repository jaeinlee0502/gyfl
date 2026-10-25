-- Run through Supabase migrations / SQL Editor as the project owner.
-- No service credentials belong in the web application or in this migration.

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now()
);

create table public.bookmarks (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id text not null check (char_length(question_id) between 1 and 160),
  created_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

create table public.account_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.account_admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null,
  target_user_id uuid not null,
  action text not null check (action in ('password_reset', 'account_delete')),
  status text not null check (status in ('pending', 'succeeded', 'failed')),
  created_at timestamptz not null default now()
);
create index account_admin_audit_actor_time on public.account_admin_audit (actor_user_id, created_at desc);
create index account_admin_audit_target_time on public.account_admin_audit (target_user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.bookmarks enable row level security;
alter table public.account_admins enable row level security;
alter table public.account_admin_audit enable row level security;

-- Explicit grants avoid relying on a project's default public-schema grants.
revoke all on public.profiles, public.bookmarks, public.account_admins, public.account_admin_audit from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select, insert, update, delete on public.bookmarks to authenticated;
grant select on public.account_admins to authenticated;
grant all on public.profiles, public.bookmarks, public.account_admins, public.account_admin_audit to service_role;

create policy "Read own profile" on public.profiles for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Change own display name" on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Read own bookmarks" on public.bookmarks for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Insert own bookmarks" on public.bookmarks for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Update own bookmarks" on public.bookmarks for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Delete own bookmarks" on public.bookmarks for delete to authenticated
  using ((select auth.uid()) = user_id);
create policy "Check own administrator membership" on public.account_admins for select to authenticated
  using ((select auth.uid()) = user_id);
-- There is deliberately no client policy/grant for writing administrator roles
-- or reading/writing administrator audit events.

create function public.handle_account_profile()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.profiles (user_id, email, display_name, created_at)
    values (
      new.id,
      coalesce(new.email, ''),
      left(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 80),
      coalesce(new.created_at, now())
    )
    on conflict (user_id) do nothing;
  else
    -- Email changes must be completed through Supabase Auth, never by editing
    -- the profile. Other clients' display-name changes are preserved here.
    update public.profiles set email = coalesce(new.email, '') where user_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.handle_account_profile() from public, anon, authenticated;

create trigger on_account_created after insert on auth.users
  for each row execute function public.handle_account_profile();
create trigger on_account_email_updated after update of email on auth.users
  for each row execute function public.handle_account_profile();

-- Include accounts that existed before this migration was applied.
insert into public.profiles (user_id, email, display_name, created_at)
select id, coalesce(email, ''), left(trim(coalesce(raw_user_meta_data ->> 'display_name', '')), 80), coalesce(created_at, now())
from auth.users on conflict (user_id) do nothing;

create function public.reserve_admin_account_action(p_actor_user_id uuid, p_target_user_id uuid, p_action text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  reservation_id uuid;
begin
  if p_action is null or p_action not in ('password_reset', 'account_delete') then
    raise exception 'INVALID_ACTION';
  end if;
  -- Serialize reservations for this actor and target so parallel requests
  -- cannot bypass the per-actor limit or the per-account cooldown.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reset:actor:' || p_actor_user_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reset:target:' || p_target_user_id::text, 0));

  if not exists (select 1 from public.account_admins where user_id = p_actor_user_id) then
    raise exception 'NOT_ADMIN';
  end if;
  if p_actor_user_id = p_target_user_id or exists (select 1 from public.account_admins where user_id = p_target_user_id) then
    raise exception 'PROTECTED_ACCOUNT';
  end if;
  if not exists (select 1 from public.profiles where user_id = p_target_user_id) then
    raise exception 'ACCOUNT_NOT_FOUND';
  end if;
  if (select count(*) from public.account_admin_audit
      where actor_user_id = p_actor_user_id and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'RESET_RATE_LIMIT';
  end if;
  if exists (select 1 from public.account_admin_audit
      where target_user_id = p_target_user_id and created_at > now() - interval '60 seconds') then
    raise exception 'RESET_COOLDOWN';
  end if;

  insert into public.account_admin_audit (actor_user_id, target_user_id, action, status)
  values (p_actor_user_id, p_target_user_id, p_action, 'pending')
  returning id into reservation_id;
  return reservation_id;
end;
$$;
revoke all on function public.reserve_admin_account_action(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_admin_account_action(uuid, uuid, text) to service_role;

comment on table public.account_admins is 'Set roles only through a trusted project-owner SQL session. Never derive roles from user metadata.';
comment on table public.account_admin_audit is 'Server-only account-support audit. No passwords or recovery tokens are stored.';
