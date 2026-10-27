-- Approved teachers edit shared tags through a narrow RPC. Other question
-- columns and administrator operations retain their existing permissions.
create table public.exam_question_tag_audit (
  id uuid primary key default gen_random_uuid(),
  question_id text not null references public.exam_questions(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  old_tags text[] not null,
  new_tags text[] not null,
  created_at timestamptz not null default now()
);
create index exam_question_tag_audit_question on public.exam_question_tag_audit(question_id, created_at desc);
alter table public.exam_question_tag_audit enable row level security;
revoke all on public.exam_question_tag_audit from public, anon, authenticated;
grant all on public.exam_question_tag_audit to service_role;

create function public.update_exam_question_tags(p_question_id text, p_expected_tags text[], p_tags text[])
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  previous_tags text[];
  cleaned_tags text[] := '{}';
  tag text;
begin
  if actor is null then raise exception 'SCHOOL_ACCESS_REQUIRED'; end if;
  -- Use the same membership lock as approval/revocation operations.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('membership:' || actor::text, 0));
  if not public.has_school_access() then raise exception 'SCHOOL_ACCESS_REQUIRED'; end if;
  if p_question_id is null or char_length(p_question_id) not between 1 and 160 then raise exception 'QUESTION_NOT_FOUND'; end if;
  if p_tags is null or coalesce(array_ndims(p_tags), 1) <> 1 or cardinality(p_tags) > 20 then
    raise exception 'INVALID_QUESTION_TAGS';
  end if;
  foreach tag in array p_tags loop
    tag := trim(regexp_replace(tag, '[[:space:]]+', ' ', 'g'));
    if tag is null or char_length(tag) not between 1 and 60 then raise exception 'INVALID_QUESTION_TAGS'; end if;
    if not tag = any(cleaned_tags) then cleaned_tags := array_append(cleaned_tags, tag); end if;
  end loop;
  select q.tags into previous_tags from public.exam_questions q where q.id = p_question_id for update;
  if not found then raise exception 'QUESTION_NOT_FOUND'; end if;
  if previous_tags is distinct from p_expected_tags then raise exception 'QUESTION_TAGS_CONFLICT'; end if;
  if previous_tags is distinct from cleaned_tags then
    update public.exam_questions set tags = cleaned_tags where id = p_question_id;
    insert into public.exam_question_tag_audit(question_id, actor_user_id, old_tags, new_tags)
      values(p_question_id, actor, previous_tags, cleaned_tags);
  end if;
  return jsonb_build_object('id', p_question_id, 'tags', cleaned_tags);
end;
$$;
revoke all on function public.update_exam_question_tags(text, text[], text[]) from public, anon, authenticated;
grant execute on function public.update_exam_question_tags(text, text[], text[]) to authenticated, service_role;
notify pgrst, 'reload schema';
