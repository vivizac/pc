-- Date-effective elementary A/B class layout.
alter table public.olli_schedule_class_splits
  add column if not exists effective_from date,
  add column if not exists effective_to date;

update public.olli_schedule_class_splits
set effective_from = date '2000-01-01'
where effective_from is null;

alter table public.olli_schedule_class_splits
  alter column effective_from set not null;

alter table public.olli_schedule_class_splits
  drop constraint if exists olli_schedule_class_splits_pkey;

alter table public.olli_schedule_class_splits
  add constraint olli_schedule_class_splits_pkey
  primary key (academy_id, weekday, time_slot, effective_from);

alter table public.olli_schedule_class_splits
  drop constraint if exists olli_schedule_class_splits_effective_range_check;

alter table public.olli_schedule_class_splits
  add constraint olli_schedule_class_splits_effective_range_check
  check (effective_to is null or effective_to >= effective_from);

create index if not exists olli_schedule_class_splits_lookup_idx
  on public.olli_schedule_class_splits (academy_id, weekday, time_slot, effective_from, effective_to);

create or replace function private.olli_schedule_class_split_at(
  p_academy_id uuid,
  p_weekday integer,
  p_time_slot integer,
  p_session_date date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.olli_schedule_class_splits s
    where s.academy_id = p_academy_id
      and s.weekday = p_weekday
      and s.time_slot = p_time_slot
      and s.effective_from <= coalesce(p_session_date, current_date)
      and (s.effective_to is null or s.effective_to >= coalesce(p_session_date, current_date))
  );
$$;

create or replace function private.olli_schedule_group_is_enabled(
  p_academy_id uuid,
  p_division text,
  p_weekday integer,
  p_time_slot integer
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_division, 'elementary') = 'kinder'
    or private.olli_schedule_class_split_at(p_academy_id, p_weekday, p_time_slot, current_date);
$$;

create or replace function public.olli_schedule_class_splits_range(
  p_session_token text,
  p_academy_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start date := coalesce(p_start_date, current_date);
  v_end date := coalesce(p_end_date, coalesce(p_start_date, current_date));
  v_splits jsonb;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '시간표를 볼 권한이 없습니다.');
  end if;
  if v_end < v_start then
    return jsonb_build_object('ok', false, 'message', '조회 날짜 범위를 확인해 주세요.');
  end if;
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'weekday', s.weekday,
      'time_slot', s.time_slot,
      'effective_from', s.effective_from,
      'effective_to', s.effective_to
    ) order by s.weekday, s.time_slot, s.effective_from),
    '[]'::jsonb
  )
  into v_splits
  from public.olli_schedule_class_splits s
  where s.academy_id = p_academy_id
    and s.effective_from <= v_end
    and (s.effective_to is null or s.effective_to >= v_start);
  return jsonb_build_object('ok', true, 'splits', v_splits);
end;
$$;

create or replace function public.olli_schedule_split_class(
  p_session_token text,
  p_academy_id uuid,
  p_weekday integer,
  p_time_slot integer,
  p_effective_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_effective date := coalesce(p_effective_date, current_date);
  v_account_id uuid;
  v_next_split date;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '클래스를 분리할 권한이 없습니다.');
  end if;
  if p_weekday not between 1 and 6 or p_time_slot not between 1 and 6 then
    return jsonb_build_object('ok', false, 'message', '분리할 요일과 시간을 확인해 주세요.');
  end if;
  if v_effective < current_date then
    return jsonb_build_object('ok', false, 'message', '지난 날짜의 반 구성을 변경할 수 없습니다.');
  end if;
  if private.olli_schedule_class_split_at(p_academy_id, p_weekday, p_time_slot, v_effective) then
    return jsonb_build_object('ok', true, 'result', 'unchanged', 'weekday', p_weekday, 'time_slot', p_time_slot, 'effective_date', v_effective);
  end if;
  select min(s.effective_from)
  into v_next_split
  from public.olli_schedule_class_splits s
  where s.academy_id = p_academy_id
    and s.weekday = p_weekday
    and s.time_slot = p_time_slot
    and s.effective_from > v_effective;
  v_account_id := public.olli_account_id_from_session(p_session_token);
  insert into public.olli_schedule_class_splits (
    academy_id, weekday, time_slot, effective_from, effective_to, created_by_account_id
  ) values (
    p_academy_id, p_weekday, p_time_slot, v_effective,
    case when v_next_split is null then null else v_next_split - 1 end,
    v_account_id
  )
  on conflict (academy_id, weekday, time_slot, effective_from)
  do update set effective_to = excluded.effective_to;
  return jsonb_build_object('ok', true, 'result', 'split', 'weekday', p_weekday, 'time_slot', p_time_slot, 'effective_date', v_effective);
end;
$$;

create or replace function public.olli_schedule_split_class(
  p_session_token text,
  p_academy_id uuid,
  p_weekday integer,
  p_time_slot integer
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.olli_schedule_split_class(p_session_token, p_academy_id, p_weekday, p_time_slot, current_date);
$$;

create or replace function public.olli_schedule_merge_class(
  p_session_token text,
  p_academy_id uuid,
  p_weekday integer,
  p_time_slot integer,
  p_effective_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_effective date := coalesce(p_effective_date, current_date);
  v_next_split date;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '클래스를 통합할 권한이 없습니다.');
  end if;
  if p_weekday not between 1 and 6 or p_time_slot not between 1 and 6 then
    return jsonb_build_object('ok', false, 'message', '통합할 요일과 시간을 확인해 주세요.');
  end if;
  if v_effective < current_date then
    return jsonb_build_object('ok', false, 'message', '지난 날짜의 반 구성을 변경할 수 없습니다.');
  end if;
  if not private.olli_schedule_class_split_at(p_academy_id, p_weekday, p_time_slot, v_effective) then
    return jsonb_build_object('ok', true, 'result', 'unchanged', 'weekday', p_weekday, 'time_slot', p_time_slot, 'effective_date', v_effective);
  end if;

  select min(s.effective_from)
  into v_next_split
  from public.olli_schedule_class_splits s
  where s.academy_id = p_academy_id
    and s.weekday = p_weekday
    and s.time_slot = p_time_slot
    and s.effective_from > v_effective;

  if exists (
    select 1 from public.olli_schedule_enrollments e
    where e.academy_id = p_academy_id
      and e.weekday = p_weekday
      and e.time_slot = p_time_slot
      and e.class_group = 'B'
      and e.status = 'active'
      and (e.effective_to is null or e.effective_to >= v_effective)
      and (v_next_split is null or e.effective_from < v_next_split)
  ) or exists (
    select 1 from public.olli_schedule_one_time_sessions o
    where o.academy_id = p_academy_id
      and extract(isodow from o.session_date)::integer = p_weekday
      and o.time_slot = p_time_slot
      and o.class_group = 'B'
      and o.status <> 'cancelled'
      and o.session_date >= v_effective
      and (v_next_split is null or o.session_date < v_next_split)
  ) or exists (
    select 1 from public.olli_schedule_waitlist w
    where w.academy_id = p_academy_id
      and w.target_weekday = p_weekday
      and w.target_time_slot = p_time_slot
      and w.target_class_group = 'B'
      and w.status in ('waiting', 'offered')
      and (
        w.desired_effective_date is null
        or (
          w.desired_effective_date >= v_effective
          and (v_next_split is null or w.desired_effective_date < v_next_split)
        )
      )
  ) then
    return jsonb_build_object('ok', false, 'message', '합반 적용일 이후 B반에 등록·보강·대기 학생이 있어 통합할 수 없습니다. 앞으로의 B반 일정을 먼저 정리해 주세요.');
  end if;

  delete from public.olli_schedule_class_splits s
  where s.academy_id = p_academy_id
    and s.weekday = p_weekday
    and s.time_slot = p_time_slot
    and s.effective_from = v_effective;

  update public.olli_schedule_class_splits s
  set effective_to = v_effective - 1
  where s.academy_id = p_academy_id
    and s.weekday = p_weekday
    and s.time_slot = p_time_slot
    and s.effective_from < v_effective
    and (s.effective_to is null or s.effective_to >= v_effective);

  return jsonb_build_object('ok', true, 'result', 'merged', 'weekday', p_weekday, 'time_slot', p_time_slot, 'effective_date', v_effective);
end;
$$;

create or replace function public.olli_schedule_merge_class(
  p_session_token text,
  p_academy_id uuid,
  p_weekday integer,
  p_time_slot integer
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.olli_schedule_merge_class(p_session_token, p_academy_id, p_weekday, p_time_slot, current_date);
$$;

revoke all on function public.olli_schedule_class_splits_range(text, uuid, date, date) from public, anon, authenticated;
revoke all on function public.olli_schedule_split_class(text, uuid, integer, integer, date) from public, anon, authenticated;
revoke all on function public.olli_schedule_merge_class(text, uuid, integer, integer, date) from public, anon, authenticated;
revoke all on function public.olli_schedule_split_class(text, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.olli_schedule_merge_class(text, uuid, integer, integer) from public, anon, authenticated;
