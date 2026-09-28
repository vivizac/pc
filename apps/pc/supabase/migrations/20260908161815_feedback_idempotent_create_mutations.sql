alter table public.feedbacks
  add column if not exists client_mutation_id text;

alter table public.fail_feedbacks
  add column if not exists client_mutation_id text;

alter table public.summary_feedbacks
  add column if not exists client_mutation_id text;

create unique index if not exists feedbacks_academy_client_mutation_uidx
  on public.feedbacks (academy_id, client_mutation_id);

create unique index if not exists fail_feedbacks_academy_client_mutation_uidx
  on public.fail_feedbacks (academy_id, client_mutation_id);

create unique index if not exists summary_feedbacks_academy_client_mutation_uidx
  on public.summary_feedbacks (academy_id, client_mutation_id);

create or replace function public.olli_feedback_insert_idempotent(p_payload jsonb)
returns setof public.feedbacks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_mutation_id text := btrim(coalesce(p_payload->>'client_mutation_id', ''));
  v_academy_id uuid := nullif(p_payload->>'academy_id', '')::uuid;
  v_student_id uuid := nullif(p_payload->>'student_id', '')::uuid;
  v_row public.feedbacks%rowtype;
begin
  if v_mutation_id = '' or v_academy_id is null or v_student_id is null then
    raise exception 'FEEDBACK_IDEMPOTENCY_INPUT_MISSING' using errcode = '22023';
  end if;

  insert into public.feedbacks (
    academy_id,
    student_id,
    student_name,
    content,
    feedback_type,
    future_direction,
    year,
    date,
    lesson_date,
    member_id,
    client_mutation_id
  ) values (
    v_academy_id,
    v_student_id,
    coalesce(p_payload->>'student_name', ''),
    p_payload->>'content',
    nullif(p_payload->>'feedback_type', ''),
    nullif(p_payload->>'future_direction', ''),
    nullif(p_payload->>'year', '')::integer,
    nullif(p_payload->>'date', ''),
    nullif(p_payload->>'lesson_date', '')::date,
    nullif(p_payload->>'member_id', '')::uuid,
    v_mutation_id
  )
  on conflict (academy_id, client_mutation_id) do nothing
  returning * into v_row;

  if found then
    return next v_row;
    return;
  end if;

  select * into v_row
  from public.feedbacks f
  where f.academy_id = v_academy_id
    and f.client_mutation_id = v_mutation_id
  limit 1;

  if not found then
    raise exception 'FEEDBACK_IDEMPOTENCY_LOOKUP_FAILED' using errcode = 'P0001';
  end if;

  if v_row.student_id is distinct from v_student_id
     or coalesce(v_row.content, '') is distinct from coalesce(p_payload->>'content', '')
     or coalesce(v_row.feedback_type, '') is distinct from coalesce(p_payload->>'feedback_type', '') then
    raise exception 'FEEDBACK_IDEMPOTENCY_MISMATCH' using errcode = 'P0001';
  end if;

  return next v_row;
end;
$$;

create or replace function public.olli_growth_feedback_insert_idempotent(p_payload jsonb)
returns setof public.fail_feedbacks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_mutation_id text := btrim(coalesce(p_payload->>'client_mutation_id', ''));
  v_academy_id uuid := nullif(p_payload->>'academy_id', '')::uuid;
  v_student_id uuid := nullif(p_payload->>'student_id', '')::uuid;
  v_row public.fail_feedbacks%rowtype;
begin
  if v_mutation_id = '' or v_academy_id is null or v_student_id is null then
    raise exception 'FEEDBACK_IDEMPOTENCY_INPUT_MISSING' using errcode = '22023';
  end if;

  insert into public.fail_feedbacks (
    academy_id,
    student_id,
    student_name,
    content,
    feedback_type,
    year,
    date,
    client_mutation_id
  ) values (
    v_academy_id,
    v_student_id,
    coalesce(p_payload->>'student_name', ''),
    p_payload->>'content',
    coalesce(nullif(p_payload->>'feedback_type', ''), 'fail'),
    nullif(p_payload->>'year', '')::integer,
    nullif(p_payload->>'date', ''),
    v_mutation_id
  )
  on conflict (academy_id, client_mutation_id) do nothing
  returning * into v_row;

  if found then
    return next v_row;
    return;
  end if;

  select * into v_row
  from public.fail_feedbacks f
  where f.academy_id = v_academy_id
    and f.client_mutation_id = v_mutation_id
  limit 1;

  if not found then
    raise exception 'FEEDBACK_IDEMPOTENCY_LOOKUP_FAILED' using errcode = 'P0001';
  end if;

  if v_row.student_id is distinct from v_student_id
     or coalesce(v_row.content, '') is distinct from coalesce(p_payload->>'content', '')
     or coalesce(v_row.feedback_type, '') is distinct from coalesce(nullif(p_payload->>'feedback_type', ''), 'fail') then
    raise exception 'FEEDBACK_IDEMPOTENCY_MISMATCH' using errcode = 'P0001';
  end if;

  return next v_row;
end;
$$;

create or replace function public.olli_summary_feedback_insert_idempotent(p_payload jsonb)
returns setof public.summary_feedbacks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_mutation_id text := btrim(coalesce(p_payload->>'client_mutation_id', ''));
  v_academy_id uuid := nullif(p_payload->>'academy_id', '')::uuid;
  v_student_id uuid := nullif(p_payload->>'student_id', '')::uuid;
  v_row public.summary_feedbacks%rowtype;
begin
  if v_mutation_id = '' or v_academy_id is null or v_student_id is null then
    raise exception 'FEEDBACK_IDEMPOTENCY_INPUT_MISSING' using errcode = '22023';
  end if;

  insert into public.summary_feedbacks (
    academy_id,
    student_id,
    student_name,
    content,
    feedback_type,
    date,
    period_months,
    created_by,
    year,
    summary_months,
    client_mutation_id
  ) values (
    v_academy_id,
    v_student_id,
    nullif(p_payload->>'student_name', ''),
    p_payload->>'content',
    nullif(p_payload->>'feedback_type', ''),
    nullif(p_payload->>'date', ''),
    nullif(p_payload->>'period_months', '')::integer,
    nullif(p_payload->>'created_by', '')::uuid,
    nullif(p_payload->>'year', '')::integer,
    nullif(p_payload->>'summary_months', '')::integer,
    v_mutation_id
  )
  on conflict (academy_id, client_mutation_id) do nothing
  returning * into v_row;

  if found then
    return next v_row;
    return;
  end if;

  select * into v_row
  from public.summary_feedbacks f
  where f.academy_id = v_academy_id
    and f.client_mutation_id = v_mutation_id
  limit 1;

  if not found then
    raise exception 'FEEDBACK_IDEMPOTENCY_LOOKUP_FAILED' using errcode = 'P0001';
  end if;

  if v_row.student_id is distinct from v_student_id
     or coalesce(v_row.content, '') is distinct from coalesce(p_payload->>'content', '')
     or coalesce(v_row.feedback_type, '') is distinct from coalesce(p_payload->>'feedback_type', '') then
    raise exception 'FEEDBACK_IDEMPOTENCY_MISMATCH' using errcode = 'P0001';
  end if;

  return next v_row;
end;
$$;

revoke all on function public.olli_feedback_insert_idempotent(jsonb) from public;
revoke all on function public.olli_growth_feedback_insert_idempotent(jsonb) from public;
revoke all on function public.olli_summary_feedback_insert_idempotent(jsonb) from public;

grant execute on function public.olli_feedback_insert_idempotent(jsonb) to anon, authenticated;
grant execute on function public.olli_growth_feedback_insert_idempotent(jsonb) to anon, authenticated;
grant execute on function public.olli_summary_feedback_insert_idempotent(jsonb) to anon, authenticated;
