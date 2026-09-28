-- Roll back the temporary date-effective elementary class layout experiment.
drop function if exists public.olli_schedule_class_splits_range(text, uuid, date, date);
drop function if exists public.olli_schedule_split_class(text, uuid, integer, integer, date);
drop function if exists public.olli_schedule_merge_class(text, uuid, integer, integer, date);
drop function if exists private.olli_schedule_class_split_at(uuid, integer, integer, date);

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
    or exists (
      select 1
      from public.olli_schedule_class_splits s
      where s.academy_id = p_academy_id
        and s.weekday = p_weekday
        and s.time_slot = p_time_slot
    );
$$;

create or replace function public.olli_schedule_split_class(
  p_session_token text,
  p_academy_id uuid,
  p_weekday integer,
  p_time_slot integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '클래스를 분리할 권한이 없습니다.');
  end if;
  if p_weekday not between 1 and 6 or p_time_slot not between 1 and 6 then
    return jsonb_build_object('ok', false, 'message', '분리할 요일과 시간을 확인해 주세요.');
  end if;
  v_account_id := public.olli_account_id_from_session(p_session_token);
  insert into public.olli_schedule_class_splits (
    academy_id, weekday, time_slot, created_by_account_id
  ) values (
    p_academy_id, p_weekday, p_time_slot, v_account_id
  ) on conflict (academy_id, weekday, time_slot) do nothing;
  return jsonb_build_object('ok', true, 'result', 'split', 'weekday', p_weekday, 'time_slot', p_time_slot);
end;
$$;

create or replace function public.olli_schedule_merge_class(
  p_session_token text,
  p_academy_id uuid,
  p_weekday integer,
  p_time_slot integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '클래스를 통합할 권한이 없습니다.');
  end if;
  if p_weekday not between 1 and 6 or p_time_slot not between 1 and 6 then
    return jsonb_build_object('ok', false, 'message', '통합할 요일과 시간을 확인해 주세요.');
  end if;
  if exists (
    select 1 from public.olli_schedule_enrollments e
    where e.academy_id = p_academy_id and e.weekday = p_weekday and e.time_slot = p_time_slot
      and e.class_group = 'B' and e.status = 'active'
  ) or exists (
    select 1 from public.olli_schedule_one_time_sessions o
    where o.academy_id = p_academy_id and extract(isodow from o.session_date)::integer = p_weekday
      and o.time_slot = p_time_slot and o.class_group = 'B' and o.status <> 'cancelled'
  ) or exists (
    select 1 from public.olli_schedule_waitlist w
    where w.academy_id = p_academy_id and w.target_weekday = p_weekday and w.target_time_slot = p_time_slot
      and w.target_class_group = 'B' and w.status in ('waiting', 'offered')
  ) then
    return jsonb_build_object('ok', false, 'message', 'B반에 등록·보강·대기 학생이 있어 통합할 수 없습니다. 먼저 A반으로 이동하거나 대기를 정리해 주세요.');
  end if;
  delete from public.olli_schedule_class_splits
  where academy_id = p_academy_id and weekday = p_weekday and time_slot = p_time_slot;
  return jsonb_build_object('ok', true, 'result', 'merged', 'weekday', p_weekday, 'time_slot', p_time_slot);
end;
$$;

revoke all on function public.olli_schedule_split_class(text, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.olli_schedule_merge_class(text, uuid, integer, integer) from public, anon, authenticated;

alter table public.olli_schedule_class_splits drop constraint if exists olli_schedule_class_splits_pkey;
alter table public.olli_schedule_class_splits drop constraint if exists olli_schedule_class_splits_effective_range_check;
drop index if exists public.olli_schedule_class_splits_lookup_idx;
alter table public.olli_schedule_class_splits drop column if exists effective_from, drop column if exists effective_to;
alter table public.olli_schedule_class_splits
  add constraint olli_schedule_class_splits_pkey primary key (academy_id, weekday, time_slot);
