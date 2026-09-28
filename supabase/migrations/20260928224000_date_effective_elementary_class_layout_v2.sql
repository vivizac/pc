begin;

-- Date-effective elementary A/B class layout v2.
-- Transitional and backward-compatible: legacy class_splits remains in read responses,
-- while class_split_periods is the canonical date-aware contract.

alter table public.olli_schedule_class_splits
  add column if not exists effective_from date,
  add column if not exists effective_to date;

update public.olli_schedule_class_splits
set effective_from = (created_at at time zone 'Asia/Seoul')::date
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

create or replace function private.olli_schedule_weekday_on_or_after(
  p_effective_date date,
  p_weekday integer
)
returns date
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_effective_date is null or p_weekday not between 1 and 7 then null
    else p_effective_date + ((p_weekday - extract(isodow from p_effective_date)::integer + 7) % 7)
  end;
$$;

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
  select p_session_date is not null and exists (
    select 1
    from public.olli_schedule_class_splits s
    where s.academy_id = p_academy_id
      and s.weekday = p_weekday
      and s.time_slot = p_time_slot
      and s.effective_from <= p_session_date
      and (s.effective_to is null or s.effective_to >= p_session_date)
  );
$$;

create or replace function private.olli_schedule_group_is_enabled(
  p_academy_id uuid,
  p_division text,
  p_weekday integer,
  p_time_slot integer,
  p_target_date date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(p_division, 'elementary') = 'kinder' then true
    when p_target_date is null then false
    else private.olli_schedule_class_split_at(
      p_academy_id, p_weekday, p_time_slot, p_target_date
    )
  end;
$$;

-- Temporary compatibility overload. New server and clients must use the 5-argument contract.
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
  select private.olli_schedule_group_is_enabled(
    p_academy_id, p_division, p_weekday, p_time_slot, current_date
  );
$$;

create or replace function private.olli_schedule_validate_class_split_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.olli_schedule_class_splits s
    where s.academy_id = new.academy_id
      and s.weekday = new.weekday
      and s.time_slot = new.time_slot
      and s.effective_from <= coalesce(new.effective_to, date '9999-12-31')
      and coalesce(s.effective_to, date '9999-12-31') >= new.effective_from
      and (tg_op <> 'UPDATE' or s.ctid <> old.ctid)
  ) then
    raise exception using errcode = '23514', message = 'CLASS_LAYOUT_CONFLICT';
  end if;
  return new;
end;
$$;

drop trigger if exists olli_schedule_class_split_period_guard on public.olli_schedule_class_splits;
create trigger olli_schedule_class_split_period_guard
before insert or update on public.olli_schedule_class_splits
for each row execute function private.olli_schedule_validate_class_split_period();


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
  v_account_id uuid;
  v_next_split date;
  v_previous_from date;
  v_previous_to date;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '클래스를 분리할 권한이 없습니다.');
  end if;
  if p_effective_date is null then
    return jsonb_build_object('ok', false, 'code', 'TARGET_DATE_REQUIRED', 'message', '분반 적용일을 확인해 주세요.');
  end if;
  if p_weekday not between 1 and 6 or p_time_slot not between 1 and 6 then
    return jsonb_build_object('ok', false, 'message', '분리할 요일과 시간을 확인해 주세요.');
  end if;
  if extract(isodow from p_effective_date)::integer <> p_weekday then
    return jsonb_build_object('ok', false, 'code', 'DATE_WEEKDAY_MISMATCH', 'message', '분반 적용일과 요일이 일치하지 않습니다.');
  end if;
  if p_effective_date < current_date then
    return jsonb_build_object('ok', false, 'message', '지난 날짜의 반 구성을 변경할 수 없습니다.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':class-layout:' || p_weekday::text || ':' || p_time_slot::text, 0
  ));

  if private.olli_schedule_class_split_at(p_academy_id, p_weekday, p_time_slot, p_effective_date) then
    return jsonb_build_object('ok', true, 'result', 'unchanged', 'weekday', p_weekday, 'time_slot', p_time_slot, 'effective_date', p_effective_date);
  end if;

  select min(s.effective_from)
    into v_next_split
  from public.olli_schedule_class_splits s
  where s.academy_id = p_academy_id
    and s.weekday = p_weekday
    and s.time_slot = p_time_slot
    and s.effective_from > p_effective_date;

  select s.effective_from, s.effective_to
    into v_previous_from, v_previous_to
  from public.olli_schedule_class_splits s
  where s.academy_id = p_academy_id
    and s.weekday = p_weekday
    and s.time_slot = p_time_slot
    and s.effective_to = p_effective_date - 1
  order by s.effective_from desc
  limit 1
  for update;

  if v_previous_from is not null then
    update public.olli_schedule_class_splits
       set effective_to = case when v_next_split is null then null else v_next_split - 1 end
     where academy_id = p_academy_id
       and weekday = p_weekday
       and time_slot = p_time_slot
       and effective_from = v_previous_from;
  else
    v_account_id := public.olli_account_id_from_session(p_session_token);
    insert into public.olli_schedule_class_splits (
      academy_id, weekday, time_slot, effective_from, effective_to, created_by_account_id
    ) values (
      p_academy_id, p_weekday, p_time_slot, p_effective_date,
      case when v_next_split is null then null else v_next_split - 1 end,
      v_account_id
    );
  end if;

  return jsonb_build_object('ok', true, 'result', 'split', 'weekday', p_weekday, 'time_slot', p_time_slot, 'effective_date', p_effective_date);
exception
  when check_violation then
    return jsonb_build_object('ok', false, 'code', 'CLASS_LAYOUT_CONFLICT', 'message', '반 구성 기간이 다른 변경과 충돌했습니다. 다시 시도해 주세요.');
end;
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
  v_period_from date;
  v_period_to date;
  v_regular integer := 0;
  v_one_time integer := 0;
  v_waitlist integer := 0;
  v_changes integer := 0;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '클래스를 통합할 권한이 없습니다.');
  end if;
  if p_effective_date is null then
    return jsonb_build_object('ok', false, 'code', 'TARGET_DATE_REQUIRED', 'message', '합반 적용일을 확인해 주세요.');
  end if;
  if p_weekday not between 1 and 6 or p_time_slot not between 1 and 6 then
    return jsonb_build_object('ok', false, 'message', '통합할 요일과 시간을 확인해 주세요.');
  end if;
  if extract(isodow from p_effective_date)::integer <> p_weekday then
    return jsonb_build_object('ok', false, 'code', 'DATE_WEEKDAY_MISMATCH', 'message', '합반 적용일과 요일이 일치하지 않습니다.');
  end if;
  if p_effective_date < current_date then
    return jsonb_build_object('ok', false, 'message', '지난 날짜의 반 구성을 변경할 수 없습니다.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':class-layout:' || p_weekday::text || ':' || p_time_slot::text, 0
  ));

  select s.effective_from, s.effective_to
    into v_period_from, v_period_to
  from public.olli_schedule_class_splits s
  where s.academy_id = p_academy_id
    and s.weekday = p_weekday
    and s.time_slot = p_time_slot
    and s.effective_from <= p_effective_date
    and (s.effective_to is null or s.effective_to >= p_effective_date)
  order by s.effective_from desc
  limit 1
  for update;

  if v_period_from is null then
    return jsonb_build_object('ok', true, 'result', 'unchanged', 'weekday', p_weekday, 'time_slot', p_time_slot, 'effective_date', p_effective_date);
  end if;

  select count(*) into v_regular
  from public.olli_schedule_enrollments e
  where e.academy_id = p_academy_id
    and e.weekday = p_weekday
    and e.time_slot = p_time_slot
    and e.class_group = 'B'
    and e.status = 'active'
    and (e.effective_to is null or e.effective_to >= p_effective_date)
    and private.olli_schedule_weekday_on_or_after(greatest(e.effective_from, p_effective_date), p_weekday)
        <= least(coalesce(e.effective_to, date '9999-12-31'), coalesce(v_period_to, date '9999-12-31'));

  select count(*) into v_one_time
  from public.olli_schedule_one_time_sessions o
  where o.academy_id = p_academy_id
    and extract(isodow from o.session_date)::integer = p_weekday
    and o.time_slot = p_time_slot
    and o.class_group = 'B'
    and o.status <> 'cancelled'
    and o.session_date >= p_effective_date
    and (v_period_to is null or o.session_date <= v_period_to);

  select count(*) into v_waitlist
  from public.olli_schedule_waitlist w
  where w.academy_id = p_academy_id
    and w.target_weekday = p_weekday
    and w.target_time_slot = p_time_slot
    and w.target_class_group = 'B'
    and w.status in ('waiting','offered')
    and (
      w.desired_effective_date is null
      or (
        w.desired_effective_date >= p_effective_date
        and (v_period_to is null or w.desired_effective_date <= v_period_to)
      )
    );

  select count(*) into v_changes
  from public.olli_schedule_changes c
  join public.olli_schedule_enrollments e on e.id = c.target_enrollment_id
  where c.academy_id = p_academy_id
    and c.status = 'scheduled'
    and coalesce(c.target_class_group, e.class_group, 'A') = 'B'
    and e.weekday = p_weekday
    and e.time_slot = p_time_slot
    and c.effective_date >= p_effective_date
    and (v_period_to is null or private.olli_schedule_weekday_on_or_after(c.effective_date, p_weekday) <= v_period_to);

  if v_regular + v_one_time + v_waitlist + v_changes > 0 then
    return jsonb_build_object(
      'ok', false,
      'code', 'MERGE_BLOCKED_B_USAGE',
      'message', '합반 적용일 이후 B반 일정이 있어 통합할 수 없습니다. 앞으로의 B반 일정을 먼저 정리해 주세요.',
      'conflicts', jsonb_build_object(
        'regular', v_regular,
        'one_time', v_one_time,
        'waitlist', v_waitlist,
        'scheduled_change', v_changes
      )
    );
  end if;

  if p_effective_date = v_period_from then
    delete from public.olli_schedule_class_splits
    where academy_id = p_academy_id
      and weekday = p_weekday
      and time_slot = p_time_slot
      and effective_from = v_period_from;
  else
    update public.olli_schedule_class_splits
       set effective_to = p_effective_date - 1
     where academy_id = p_academy_id
       and weekday = p_weekday
       and time_slot = p_time_slot
       and effective_from = v_period_from;
  end if;

  return jsonb_build_object('ok', true, 'result', 'merged', 'weekday', p_weekday, 'time_slot', p_time_slot, 'effective_date', p_effective_date);
end;
$$;

-- Legacy overloads remain non-public during the transition.
create or replace function public.olli_schedule_split_class(
  p_session_token text, p_academy_id uuid, p_weekday integer, p_time_slot integer
)
returns jsonb language sql security definer set search_path = ''
as $$
  select public.olli_schedule_split_class(p_session_token, p_academy_id, p_weekday, p_time_slot, current_date);
$$;

create or replace function public.olli_schedule_merge_class(
  p_session_token text, p_academy_id uuid, p_weekday integer, p_time_slot integer
)
returns jsonb language sql security definer set search_path = ''
as $$
  select public.olli_schedule_merge_class(p_session_token, p_academy_id, p_weekday, p_time_slot, current_date);
$$;


CREATE OR REPLACE FUNCTION public.olli_schedule_week(p_session_token text, p_academy_id uuid, p_week_start date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_week_start date := coalesce(p_week_start, current_date - (extract(isodow from current_date)::integer - 1));
  v_week_end date;
  v_enrollments jsonb;
  v_waitlist jsonb;
  v_one_time jsonb;
  v_changes jsonb;
  v_attendance jsonb;
  v_pickups jsonb;
  v_class_splits jsonb;
  v_class_split_periods jsonb;
  v_cell_memos jsonb;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '시간표를 볼 권한이 없습니다.');
  end if;
  v_week_end := v_week_start + 5;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.weekday, x.time_slot, x.student_name), '[]'::jsonb)
  into v_enrollments
  from (
    select e.id, e.student_id, s.name as student_name, s.division,
           e.weekday, e.time_slot, e.class_group, e.session_order,
           e.effective_from, e.effective_to, e.source,
           ct.teacher_member_id, coalesce(ct.teacher_name, '') as teacher_name
    from public.olli_schedule_enrollments e
    join public.students s on s.id = e.student_id
    left join public.olli_schedule_class_teachers ct
      on ct.academy_id = e.academy_id
     and ct.division = s.division
     and ct.weekday = e.weekday
     and ct.time_slot = e.time_slot
     and ct.class_group = coalesce(nullif(upper(trim(e.class_group)), ''), 'A')
    where e.academy_id = p_academy_id and e.status = 'active'
      and e.effective_from <= v_week_end
      and (e.effective_to is null or e.effective_to >= v_week_start)
      and s.status = 'active'
      and coalesce(s.is_deleted, false) = false
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.target_weekday, x.target_time_slot, x.requested_at), '[]'::jsonb)
  into v_waitlist
  from (
    select w.id, w.student_id,
           coalesce(s.name, w.guest_name) as student_name,
           coalesce(s.division, w.guest_division) as division,
           (w.student_id is null) as is_guest,
           w.target_weekday, w.target_time_slot, w.target_class_group, w.request_type,
           w.source_enrollment_id, w.desired_effective_date, w.status, w.requested_at
    from public.olli_schedule_waitlist w
    left join public.students s on s.id = w.student_id
    where w.academy_id = p_academy_id and w.status in ('waiting','offered')
      and (w.requested_at at time zone 'Asia/Seoul')::date <= v_week_end
      and (
        w.student_id is null
        or (s.status = 'active' and coalesce(s.is_deleted, false) = false)
      )
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.session_date, x.time_slot, x.student_name), '[]'::jsonb)
  into v_one_time
  from (
    select o.id, o.student_id,
           coalesce(s.name, o.guest_name) as student_name,
           coalesce(s.division, o.guest_division) as division,
           (o.student_id is null) as is_guest,
           o.session_date, o.time_slot, o.class_group, o.session_type, o.status, o.note,
           ct.teacher_member_id, coalesce(ct.teacher_name, '') as teacher_name
    from public.olli_schedule_one_time_sessions o
    left join public.students s on s.id = o.student_id
    left join public.olli_schedule_class_teachers ct
      on ct.academy_id = o.academy_id
     and ct.division = coalesce(s.division, o.guest_division)
     and ct.weekday = extract(isodow from o.session_date)::integer
     and ct.time_slot = o.time_slot
     and ct.class_group = coalesce(nullif(upper(trim(o.class_group)), ''), 'A')
    where o.academy_id = p_academy_id
      and o.session_date between v_week_start and v_week_end
      and o.status <> 'cancelled'
      and (
        o.student_id is null
        or (s.status = 'active' and coalesce(s.is_deleted, false) = false)
      )
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.effective_date, x.student_name), '[]'::jsonb)
  into v_changes
  from (
    select c.id, c.student_id, s.name as student_name, s.division,
           c.change_type, c.source_enrollment_id, c.target_enrollment_id,
           c.target_class_group, c.effective_date, c.status, c.waitlist_id
    from public.olli_schedule_changes c
    join public.students s on s.id = c.student_id
    where c.academy_id = p_academy_id and c.status in ('scheduled','applied')
      and c.effective_date >= v_week_start - 35
      and c.effective_date <= v_week_end + 365
      and s.status = 'active'
      and coalesce(s.is_deleted, false) = false
  ) x;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.session_date, a.time_slot, a.student_id), '[]'::jsonb)
  into v_attendance
  from (
    select atn.id, atn.student_id, atn.session_date, atn.time_slot, atn.class_group, atn.session_kind, atn.marked_at
    from public.olli_schedule_attendance atn
    join public.students s on s.id = atn.student_id
    where atn.academy_id = p_academy_id
      and atn.session_date between v_week_start and v_week_end
      and s.status = 'active'
      and coalesce(s.is_deleted, false) = false
  ) a;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.weekday, x.class_time, x.pickup_time, x.student_name), '[]'::jsonb)
  into v_pickups
  from (
    select p.id, p.student_id, s.name as student_name, p.weekday, p.class_time,
           p.pickup_label, p.pickup_time, p.effective_from, p.effective_to
    from public.olli_schedule_pickups p
    join public.students s on s.id = p.student_id
    where p.academy_id = p_academy_id and p.status = 'active'
      and p.effective_from <= v_week_end
      and (p.effective_to is null or p.effective_to >= v_week_start)
      and s.status = 'active'
      and coalesce(s.is_deleted, false) = false
  ) x;

  select coalesce(
    jsonb_agg(jsonb_build_object('weekday', s.weekday, 'time_slot', s.time_slot) order by s.weekday, s.time_slot),
    '[]'::jsonb
  )
  into v_class_splits
  from public.olli_schedule_class_splits s
  where s.academy_id = p_academy_id
    and s.effective_from <= v_week_start
    and (s.effective_to is null or s.effective_to >= v_week_start);

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'weekday', s.weekday,
      'time_slot', s.time_slot,
      'effective_from', s.effective_from,
      'effective_to', s.effective_to
    ) order by s.weekday, s.time_slot, s.effective_from),
    '[]'::jsonb
  )
  into v_class_split_periods
  from public.olli_schedule_class_splits s
  where s.academy_id = p_academy_id
    and s.effective_from <= v_week_end
    and (s.effective_to is null or s.effective_to >= v_week_start);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', m.id,
        'division', m.division,
        'session_date', m.session_date,
        'time_slot', m.time_slot,
        'note', m.note,
        'updated_at', m.updated_at
      )
      order by m.session_date, m.time_slot, m.division
    ),
    '[]'::jsonb
  )
  into v_cell_memos
  from public.olli_schedule_cell_memos m
  where m.academy_id = p_academy_id
    and m.session_date between v_week_start and v_week_end;

  return jsonb_build_object(
    'ok', true,
    'week_start', v_week_start,
    'week_end', v_week_end,
    'elementary_capacity', coalesce((select st.elementary_capacity from public.olli_schedule_settings st where st.academy_id = p_academy_id), 5),
    'kinder_capacity', 5,
    'waitlist_capacity', coalesce((select st.waitlist_capacity from public.olli_schedule_settings st where st.academy_id = p_academy_id), 1),
    'enrollments', v_enrollments,
    'waitlist', v_waitlist,
    'one_time_sessions', v_one_time,
    'changes', v_changes,
    'attendance', v_attendance,
    'pickups', v_pickups,
    'class_layout_version', 2,
    'class_splits', v_class_splits,
    'class_split_periods', v_class_split_periods,
    'cell_memos', v_cell_memos
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.olli_schedule_availability_horizon(p_session_token text, p_academy_id uuid, p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_start date := coalesce(p_start_date, current_date);
  v_end date := coalesce(p_end_date, coalesce(p_start_date, current_date) + 365);
  v_enrollments jsonb;
  v_one_time jsonb;
  v_class_splits jsonb;
  v_class_split_periods jsonb;
  v_kinder_merges jsonb;
  v_class_teachers jsonb;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '시간표를 볼 권한이 없습니다.');
  end if;

  if v_end < v_start or v_end > v_start + 370 then
    return jsonb_build_object('ok', false, 'message', '시간표 조회 범위를 확인해 주세요.');
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.weekday, x.time_slot, x.student_name), '[]'::jsonb)
  into v_enrollments
  from (
    select
      e.id,
      e.student_id,
      s.name as student_name,
      s.division,
      e.weekday,
      e.time_slot,
      coalesce(nullif(upper(trim(e.class_group)), ''), 'A') as class_group,
      e.session_order,
      e.effective_from,
      e.effective_to,
      e.source
    from public.olli_schedule_enrollments e
    join public.students s on s.id = e.student_id
    where e.academy_id = p_academy_id
      and e.status = 'active'
      and e.effective_from <= v_end
      and (e.effective_to is null or e.effective_to >= v_start)
      and s.status = 'active'
      and coalesce(s.is_deleted, false) = false
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.session_date, x.time_slot, x.student_name), '[]'::jsonb)
  into v_one_time
  from (
    select
      o.id,
      o.student_id,
      coalesce(s.name, o.guest_name) as student_name,
      coalesce(s.division, o.guest_division) as division,
      (o.student_id is null) as is_guest,
      o.session_date,
      o.time_slot,
      coalesce(nullif(upper(trim(o.class_group)), ''), 'A') as class_group,
      o.session_type,
      o.status
    from public.olli_schedule_one_time_sessions o
    left join public.students s on s.id = o.student_id
    where o.academy_id = p_academy_id
      and o.session_date between v_start and v_end
      and o.status <> 'cancelled'
      and (
        o.student_id is null
        or (s.status = 'active' and coalesce(s.is_deleted, false) = false)
      )
  ) x;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('weekday', s.weekday, 'time_slot', s.time_slot)
      order by s.weekday, s.time_slot
    ),
    '[]'::jsonb
  )
  into v_class_splits
  from public.olli_schedule_class_splits s
  where s.academy_id = p_academy_id
    and s.effective_from <= v_start
    and (s.effective_to is null or s.effective_to >= v_start);

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'weekday', s.weekday,
      'time_slot', s.time_slot,
      'effective_from', s.effective_from,
      'effective_to', s.effective_to
    ) order by s.weekday, s.time_slot, s.effective_from),
    '[]'::jsonb
  )
  into v_class_split_periods
  from public.olli_schedule_class_splits s
  where s.academy_id = p_academy_id
    and s.effective_from <= v_end
    and (s.effective_to is null or s.effective_to >= v_start);

  select coalesce(
    jsonb_agg(
      jsonb_build_object('weekday', m.weekday, 'time_slot', m.time_slot)
      order by m.weekday, m.time_slot
    ),
    '[]'::jsonb
  )
  into v_kinder_merges
  from public.olli_schedule_kinder_class_merges m
  where m.academy_id = p_academy_id;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.division, x.weekday, x.time_slot, x.class_group), '[]'::jsonb)
  into v_class_teachers
  from (
    select
      ct.division,
      ct.weekday,
      ct.time_slot,
      coalesce(nullif(upper(trim(ct.class_group)), ''), 'A') as class_group,
      ct.teacher_member_id,
      coalesce(ct.teacher_name, '') as teacher_name
    from public.olli_schedule_class_teachers ct
    where ct.academy_id = p_academy_id
  ) x;

  return jsonb_build_object(
    'ok', true,
    'start_date', v_start,
    'end_date', v_end,
    'elementary_capacity',
      coalesce((select st.elementary_capacity from public.olli_schedule_settings st where st.academy_id = p_academy_id), 5),
    'kinder_capacity', 5,
    'enrollments', v_enrollments,
    'one_time_sessions', v_one_time,
    'class_layout_version', 2,
    'class_splits', v_class_splits,
    'class_split_periods', v_class_split_periods,
    'kinder_class_merges', v_kinder_merges,
    'class_teachers', v_class_teachers
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.olli_schedule_add_guest_entry(p_session_token text, p_academy_id uuid, p_guest_name text, p_division text, p_entry_type text, p_session_date date, p_time_slot integer, p_class_group text DEFAULT 'A'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_name text := left(btrim(coalesce(p_guest_name, '')), 60);
  v_division text := lower(btrim(coalesce(p_division, '')));
  v_entry_type text := lower(btrim(coalesce(p_entry_type, '')));
  v_class_group text := upper(coalesce(nullif(btrim(p_class_group), ''), 'A'));
  v_weekday integer;
  v_capacity integer;
  v_occupancy integer;
  v_id uuid;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null or not exists (
    select 1 from public.academy_members m
    where m.academy_id = p_academy_id
      and m.account_id = v_account_id
      and m.status = 'active'
      and m.role in ('owner','manager','teacher')
  ) then
    return jsonb_build_object('ok', false, 'message', '시간표를 변경할 권한이 없습니다.');
  end if;

  if v_name = '' then
    return jsonb_build_object('ok', false, 'message', '학생 이름을 입력해 주세요.');
  end if;
  if v_division not in ('elementary','kinder') then
    return jsonb_build_object('ok', false, 'message', '초등부 또는 유치부를 확인해 주세요.');
  end if;
  if v_entry_type not in ('wait','trial') then
    return jsonb_build_object('ok', false, 'message', '등록 유형을 확인해 주세요.');
  end if;
  if p_session_date is null or p_session_date < current_date then
    return jsonb_build_object('ok', false, 'message', '등록 날짜를 확인해 주세요.');
  end if;

  v_weekday := extract(isodow from p_session_date)::integer;
  if v_weekday not between 1 and 6 then
    return jsonb_build_object('ok', false, 'message', '일요일에는 등록할 수 없습니다.');
  end if;
  if private.olli_schedule_is_closed_day(p_academy_id, p_session_date) then
    return jsonb_build_object('ok', false, 'message', '공휴일에는 등록할 수 없습니다. 정상수업으로 전환한 뒤 다시 시도해 주세요.');
  end if;

  if (v_division = 'elementary' and v_weekday = 6 and p_time_slot not in (10,11,12))
     or (v_division = 'elementary' and v_weekday <> 6 and p_time_slot not between 1 and 6)
     or (v_division = 'kinder' and p_time_slot not in (4,5)) then
    return jsonb_build_object('ok', false, 'message', '선택한 날짜의 수업 시간을 확인해 주세요.');
  end if;

  if not private.olli_schedule_group_is_enabled(p_academy_id, v_division, v_weekday, p_time_slot, p_session_date) then
    v_class_group := 'A';
  elsif v_class_group not in ('A','B') then
    return jsonb_build_object('ok', false, 'message', '수업 반을 A반 또는 B반으로 선택해 주세요.');
  end if;

  perform set_config('olli.actor_account_id', v_account_id::text, true);

  if v_entry_type = 'wait' then
    perform set_config('olli.schedule_action', 'guest_wait_add', true);
    perform pg_advisory_xact_lock(hashtextextended(
      p_academy_id::text || ':wait:' || v_division || ':' || v_weekday::text || ':' || p_time_slot::text,
      0
    ));

    if exists (
      select 1 from public.olli_schedule_waitlist w
      where w.academy_id = p_academy_id
        and w.target_weekday = v_weekday
        and w.target_time_slot = p_time_slot
        and w.status in ('waiting','offered')
    ) then
      return jsonb_build_object('ok', false, 'message', '이 시간에는 이미 대기 학생이 있습니다.', 'waitlist_full', true);
    end if;

    insert into public.olli_schedule_waitlist (
      academy_id, student_id, guest_name, guest_division,
      target_weekday, target_time_slot, target_class_group,
      request_type, source_enrollment_id, desired_effective_date
    ) values (
      p_academy_id, null, v_name, v_division,
      v_weekday, p_time_slot, v_class_group,
      'add', null, p_session_date
    ) returning id into v_id;

    return jsonb_build_object('ok', true, 'result', 'waitlisted', 'waitlist_id', v_id, 'guest', true);
  end if;

  perform set_config('olli.schedule_action', 'trial_add', true);
  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':trial:' || v_division || ':' || p_session_date::text || ':' || p_time_slot::text || ':' || v_class_group,
    0
  ));

  if exists (
    select 1 from public.olli_schedule_one_time_sessions o
    where o.academy_id = p_academy_id
      and o.student_id is null
      and o.session_type = 'trial'
      and lower(btrim(o.guest_name)) = lower(v_name)
      and o.session_date = p_session_date
      and o.time_slot = p_time_slot
      and o.class_group = v_class_group
      and o.status <> 'cancelled'
  ) then
    return jsonb_build_object('ok', false, 'message', '같은 이름의 체험수업이 이미 등록되어 있습니다.');
  end if;

  v_capacity := private.olli_schedule_capacity(p_academy_id, v_division);
  select
    (select count(*)
       from public.olli_schedule_enrollments e
       join public.students s on s.id = e.student_id
      where e.academy_id = p_academy_id
        and s.division = v_division
        and e.weekday = v_weekday
        and e.time_slot = p_time_slot
        and e.class_group = v_class_group
        and e.status = 'active'
        and e.effective_from <= p_session_date
        and (e.effective_to is null or e.effective_to >= p_session_date))
    +
    (select count(*)
       from public.olli_schedule_one_time_sessions o
       left join public.students s on s.id = o.student_id
      where o.academy_id = p_academy_id
        and coalesce(s.division, o.guest_division) = v_division
        and o.session_date = p_session_date
        and o.time_slot = p_time_slot
        and o.class_group = v_class_group
        and o.status <> 'cancelled')
  into v_occupancy;

  if v_occupancy >= v_capacity then
    return jsonb_build_object('ok', false, 'message', '선택한 날짜와 시간의 정원이 가득 찼습니다.', 'full', true);
  end if;

  insert into public.olli_schedule_one_time_sessions (
    academy_id, student_id, guest_name, guest_division,
    session_date, time_slot, class_group, session_type, note
  ) values (
    p_academy_id, null, v_name, v_division,
    p_session_date, p_time_slot, v_class_group, 'trial', ''
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'result', 'scheduled', 'one_time_session_id', v_id, 'guest', true, 'session_type', 'trial');
end;
$function$;


CREATE OR REPLACE FUNCTION public.olli_schedule_add_one_time(p_session_token text, p_academy_id uuid, p_student_id uuid, p_session_date date, p_time_slot integer, p_note text, p_class_group text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_division text;
  v_class_group text := upper(coalesce(nullif(btrim(p_class_group), ''), 'A'));
  v_capacity integer;
  v_weekday integer;
  v_occupancy integer;
  v_id uuid;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '보강을 등록할 권한이 없습니다.');
  end if;

  if p_session_date is null or p_session_date < current_date then
    return jsonb_build_object('ok', false, 'message', '보강 날짜를 확인해 주세요.');
  end if;

  v_weekday := extract(isodow from p_session_date)::integer;
  if v_weekday not between 1 and 6 then
    return jsonb_build_object('ok', false, 'message', '일요일에는 보강을 등록할 수 없습니다.');
  end if;

  select s.division into v_division
  from public.students s
  where s.id = p_student_id
    and s.academy_id = p_academy_id
    and s.status = 'active';

  if v_division is null then
    return jsonb_build_object('ok', false, 'message', '학생을 찾을 수 없습니다.');
  end if;

  if (v_division = 'elementary' and v_weekday = 6 and p_time_slot not in (10, 11, 12))
     or (v_division = 'elementary' and v_weekday <> 6 and p_time_slot not between 1 and 6)
     or (v_division = 'kinder' and p_time_slot not in (4, 5)) then
    return jsonb_build_object('ok', false, 'message', '선택한 날짜의 수업 시간을 확인해 주세요.');
  end if;

  if not private.olli_schedule_group_is_enabled(p_academy_id, v_division, v_weekday, p_time_slot, p_session_date) then
    v_class_group := 'A';
  elsif v_class_group not in ('A', 'B') then
    return jsonb_build_object('ok', false, 'message', '수업 반을 A반 또는 B반으로 선택해 주세요.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':makeup-student:' || p_student_id::text || ':' || p_session_date::text || ':' || p_time_slot::text,
    0
  ));

  select o.id into v_id
  from public.olli_schedule_one_time_sessions o
  where o.academy_id = p_academy_id
    and o.student_id = p_student_id
    and o.session_date = p_session_date
    and o.time_slot = p_time_slot
    and o.status <> 'cancelled'
  limit 1;

  if v_id is not null then
    return jsonb_build_object('ok', true, 'result', 'scheduled', 'one_time_session_id', v_id, 'unchanged', true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':' || p_session_date::text || ':' || p_time_slot::text || ':' || v_class_group,
    0
  ));

  v_capacity := private.olli_schedule_capacity(p_academy_id, v_division);

  select
    (select count(*)
       from public.olli_schedule_enrollments e
       join public.students s on s.id = e.student_id
      where e.academy_id = p_academy_id
        and s.division = v_division
        and e.weekday = v_weekday
        and e.time_slot = p_time_slot
        and e.class_group = v_class_group
        and e.status = 'active'
        and e.effective_from <= p_session_date
        and (e.effective_to is null or e.effective_to >= p_session_date)
        and not exists (
          select 1
          from private.olli_schedule_attendance_session_overrides a
          where a.academy_id = p_academy_id
            and a.student_id = e.student_id
            and a.session_date = p_session_date
            and a.time_slot = p_time_slot
            and upper(coalesce(nullif(btrim(a.class_group), ''), 'A')) = v_class_group
            and a.session_kind = 'regular'
            and a.status = 'absent'
        ))
    +
    (select count(*)
       from public.olli_schedule_one_time_sessions o
       left join public.students s on s.id = o.student_id
      where o.academy_id = p_academy_id
        and coalesce(s.division, o.guest_division) = v_division
        and o.session_date = p_session_date
        and o.time_slot = p_time_slot
        and o.class_group = v_class_group
        and o.status <> 'cancelled')
  into v_occupancy;

  if v_occupancy >= v_capacity then
    return jsonb_build_object('ok', false, 'message', '선택한 날짜와 시간의 정원이 가득 찼습니다.', 'full', true);
  end if;

  begin
    insert into public.olli_schedule_one_time_sessions as ots (
      academy_id, student_id, session_date, time_slot, class_group, note
    ) values (
      p_academy_id, p_student_id, p_session_date, p_time_slot, v_class_group, left(coalesce(p_note, ''), 500)
    ) returning ots.id into v_id;
  exception
    when unique_violation then
      select o.id into v_id
      from public.olli_schedule_one_time_sessions o
      where o.academy_id = p_academy_id
        and o.student_id = p_student_id
        and o.session_date = p_session_date
        and o.time_slot = p_time_slot
        and o.status <> 'cancelled'
      limit 1;
      if v_id is not null then
        return jsonb_build_object('ok', true, 'result', 'scheduled', 'one_time_session_id', v_id, 'unchanged', true);
      end if;
      raise;
  end;

  return jsonb_build_object('ok', true, 'result', 'scheduled', 'one_time_session_id', v_id, 'unchanged', false);
end;
$function$;


CREATE OR REPLACE FUNCTION public.olli_schedule_add_waitlist(p_session_token text, p_academy_id uuid, p_student_id uuid, p_target_weekday integer, p_target_time_slot integer, p_effective_date date, p_target_class_group text DEFAULT 'A'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_effective_date date := p_effective_date;
  v_target_date date;
  v_division text;
  v_class_group text := upper(coalesce(nullif(btrim(p_target_class_group), ''), 'A'));
  v_waitlist_id uuid;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '대기를 등록할 권한이 없습니다.');
  end if;
  if v_effective_date is null then
    return jsonb_build_object('ok', false, 'code', 'TARGET_DATE_REQUIRED', 'message', '대기 적용일을 확인해 주세요.');
  end if;
  if p_target_weekday not between 1 and 6 or v_effective_date < current_date then
    return jsonb_build_object('ok', false, 'message', '대기 등록 날짜와 요일을 확인해 주세요.');
  end if;

  select s.division into v_division
  from public.students s
  where s.id = p_student_id
    and s.academy_id = p_academy_id
    and s.status = 'active';
  if v_division is null then
    return jsonb_build_object('ok', false, 'message', '학생을 찾을 수 없습니다.');
  end if;
  if (v_division = 'elementary' and p_target_weekday = 6 and p_target_time_slot not in (10, 11, 12))
     or (v_division = 'elementary' and p_target_weekday <> 6 and p_target_time_slot not between 1 and 6)
     or (v_division = 'kinder' and p_target_time_slot not in (4, 5)) then
    return jsonb_build_object('ok', false, 'message', '선택한 요일의 수업 시간을 확인해 주세요.');
  end if;
  v_target_date := private.olli_schedule_weekday_on_or_after(v_effective_date, p_target_weekday);
  if not private.olli_schedule_group_is_enabled(p_academy_id, v_division, p_target_weekday, p_target_time_slot, v_target_date) then
    v_class_group := 'A';
  elsif v_class_group not in ('A', 'B') then
    return jsonb_build_object('ok', false, 'message', '수업 반을 A반 또는 B반으로 선택해 주세요.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':wait:' || v_division || ':' || p_target_weekday::text || ':' || p_target_time_slot::text || ':' || v_class_group,
    0
  ));
  if exists (
    select 1
    from public.olli_schedule_enrollments e
    where e.academy_id = p_academy_id
      and e.student_id = p_student_id
      and e.weekday = p_target_weekday
      and e.time_slot = p_target_time_slot
      and e.status = 'active'
      and e.effective_from <= v_target_date
      and (e.effective_to is null or e.effective_to >= v_target_date)
  ) then
    return jsonb_build_object('ok', false, 'message', '이미 같은 요일과 시간에 등록된 학생입니다.');
  end if;
  if exists (
    select 1
    from public.olli_schedule_waitlist w
    join public.students s on s.id = w.student_id
    where w.academy_id = p_academy_id
      and s.division = v_division
      and w.target_weekday = p_target_weekday
      and w.target_time_slot = p_target_time_slot
      and w.target_class_group = v_class_group
      and w.status in ('waiting', 'offered')
  ) then
    return jsonb_build_object('ok', false, 'message', '이 반에는 이미 대기 학생이 있습니다.', 'waitlist_full', true);
  end if;

  insert into public.olli_schedule_waitlist (
    academy_id, student_id, target_weekday, target_time_slot, target_class_group,
    request_type, source_enrollment_id, desired_effective_date
  ) values (
    p_academy_id, p_student_id, p_target_weekday, p_target_time_slot, v_class_group,
    'add', null, v_target_date
  ) returning id into v_waitlist_id;
  return jsonb_build_object('ok', true, 'result', 'waitlisted', 'waitlist_id', v_waitlist_id);
end;
$function$;


CREATE OR REPLACE FUNCTION public.olli_schedule_change(p_session_token text, p_academy_id uuid, p_student_id uuid, p_source_enrollment_id uuid, p_target_weekday integer, p_target_time_slot integer, p_effective_date date, p_change_type text, p_allow_wait boolean, p_target_class_group text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_effective date := p_effective_date;
  v_target_date date;
  v_division text;
  v_class_group text := upper(coalesce(nullif(btrim(p_target_class_group), ''), 'A'));
  v_capacity integer;
  v_occupancy integer;
  v_target_id uuid;
  v_change_id uuid;
  v_wait_id uuid;
  v_source public.olli_schedule_enrollments%rowtype;
  v_target_order smallint;
  v_existing_count integer;
  v_existing_id uuid;
  v_existing_order smallint;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '시간표를 변경할 권한이 없습니다.');
  end if;
  if v_effective is null then
    return jsonb_build_object('ok', false, 'code', 'TARGET_DATE_REQUIRED', 'message', '수업 변경 적용일을 확인해 주세요.');
  end if;
  if p_target_weekday not between 1 and 6 or p_change_type not in ('move','add') or v_effective < current_date then
    return jsonb_build_object('ok', false, 'message', '수업 변경 값을 확인해 주세요.');
  end if;

  select s.division into v_division
  from public.students s
  where s.id = p_student_id and s.academy_id = p_academy_id and s.status = 'active';
  if v_division is null then
    return jsonb_build_object('ok', false, 'message', '학생을 찾을 수 없습니다.');
  end if;
  if (v_division = 'elementary' and p_target_weekday = 6 and p_target_time_slot not in (10,11,12))
     or (v_division = 'elementary' and p_target_weekday <> 6 and p_target_time_slot not between 1 and 6)
     or (v_division = 'kinder' and p_target_time_slot not in (4,5)) then
    return jsonb_build_object('ok', false, 'message', '선택한 요일의 수업 시간을 확인해 주세요.');
  end if;
  v_target_date := private.olli_schedule_weekday_on_or_after(v_effective, p_target_weekday);
  if not private.olli_schedule_group_is_enabled(p_academy_id, v_division, p_target_weekday, p_target_time_slot, v_target_date) then
    v_class_group := 'A';
  elsif v_class_group not in ('A','B') then
    return jsonb_build_object('ok', false, 'message', '수업 반을 A반 또는 B반으로 선택해 주세요.');
  end if;

  if p_change_type = 'move' then
    select * into v_source
    from public.olli_schedule_enrollments e
    where e.id = p_source_enrollment_id
      and e.academy_id = p_academy_id
      and e.student_id = p_student_id
      and e.status = 'active';
    if not found then
      return jsonb_build_object('ok', false, 'message', '이동할 기존 수업을 선택해 주세요.');
    end if;
    if v_source.weekday = p_target_weekday
       and v_source.time_slot = p_target_time_slot
       and coalesce(v_source.class_group,'A') = v_class_group then
      return jsonb_build_object('ok', true, 'result', 'unchanged', 'message', '현재 수업과 같은 시간입니다.');
    end if;
    v_target_order := v_source.session_order;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':' || p_target_weekday::text || ':' || p_target_time_slot::text || ':' || v_class_group,
    0
  ));

  if exists (
    select 1 from public.olli_schedule_enrollments e
    where e.academy_id = p_academy_id
      and e.student_id = p_student_id
      and e.weekday = p_target_weekday
      and e.time_slot = p_target_time_slot
      and e.status = 'active'
      and e.effective_from <= v_target_date
      and (e.effective_to is null or e.effective_to >= v_target_date)
      and (p_change_type <> 'move' or e.id <> p_source_enrollment_id)
  ) then
    return jsonb_build_object('ok', false, 'message', '이미 같은 요일과 시간에 등록되어 있습니다.');
  end if;

  v_capacity := private.olli_schedule_capacity(p_academy_id, v_division);
  select
    (select count(*)
       from public.olli_schedule_enrollments e
       join public.students s on s.id=e.student_id
      where e.academy_id=p_academy_id and s.division=v_division
        and e.weekday=p_target_weekday and e.time_slot=p_target_time_slot
        and e.class_group=v_class_group and e.status='active'
        and e.effective_from<=v_target_date and (e.effective_to is null or e.effective_to>=v_target_date)
        and (p_change_type<>'move' or e.id<>p_source_enrollment_id))
    +
    (select count(*)
       from public.olli_schedule_one_time_sessions o
       left join public.students s on s.id=o.student_id
      where o.academy_id=p_academy_id
        and coalesce(s.division, o.guest_division)=v_division
        and o.session_date=v_target_date and o.time_slot=p_target_time_slot
        and o.class_group=v_class_group and o.status<>'cancelled')
  into v_occupancy;

  if v_occupancy >= v_capacity then
    if not coalesce(p_allow_wait,true) then
      return jsonb_build_object('ok',false,'message','선택한 시간의 정원이 가득 찼습니다.','full',true);
    end if;
    if exists (
      select 1 from public.olli_schedule_waitlist w
      where w.academy_id=p_academy_id
        and w.target_weekday=p_target_weekday
        and w.target_time_slot=p_target_time_slot
        and w.target_class_group=v_class_group
        and w.status in('waiting','offered')
    ) then
      return jsonb_build_object('ok',false,'message','이 시간에는 이미 대기 학생이 있습니다.','waitlist_full',true);
    end if;
    insert into public.olli_schedule_waitlist(
      academy_id,student_id,target_weekday,target_time_slot,target_class_group,
      request_type,source_enrollment_id,desired_effective_date
    ) values (
      p_academy_id,p_student_id,p_target_weekday,p_target_time_slot,v_class_group,
      p_change_type,case when p_change_type='move' then p_source_enrollment_id else null end,v_target_date
    ) returning id into v_wait_id;
    return jsonb_build_object('ok',true,'result','waitlisted','waitlist_id',v_wait_id);
  end if;

  if p_change_type = 'add' then
    select count(*) into v_existing_count
    from public.olli_schedule_enrollments e
    where e.academy_id = p_academy_id
      and e.student_id = p_student_id
      and e.status = 'active'
      and e.effective_from <= v_target_date
      and (e.effective_to is null or e.effective_to >= v_target_date);

    if v_existing_count = 0 then
      v_target_order := 1;
    elsif v_existing_count = 1 then
      select e.id, e.session_order into v_existing_id, v_existing_order
      from public.olli_schedule_enrollments e
      where e.academy_id = p_academy_id
        and e.student_id = p_student_id
        and e.status = 'active'
        and e.effective_from <= v_effective
        and (e.effective_to is null or e.effective_to >= v_effective)
      limit 1;
      if v_existing_order is null or v_existing_order not in (1,2) then
        v_existing_order := 1;
        update public.olli_schedule_enrollments set session_order = 1, updated_at = now() where id = v_existing_id;
      end if;
      v_target_order := (3 - v_existing_order)::smallint;
    else
      v_target_order := null;
    end if;
  end if;

  if p_change_type = 'move' then
    if v_effective <= v_source.effective_from then
      update public.olli_schedule_enrollments set status='cancelled', updated_at=now() where id=v_source.id;
    else
      update public.olli_schedule_enrollments set effective_to=v_effective - 1, updated_at=now() where id=v_source.id;
    end if;
  end if;

  insert into public.olli_schedule_enrollments(
    academy_id,student_id,weekday,time_slot,class_group,session_order,effective_from,source
  ) values (
    p_academy_id,p_student_id,p_target_weekday,p_target_time_slot,v_class_group,v_target_order,v_effective,
    case when p_change_type='move' then 'move' else 'add' end
  ) returning id into v_target_id;

  insert into public.olli_schedule_changes(
    academy_id,student_id,change_type,source_enrollment_id,target_enrollment_id,
    target_class_group,effective_date,status
  ) values (
    p_academy_id,p_student_id,p_change_type,
    case when p_change_type='move' then p_source_enrollment_id else null end,
    v_target_id,v_class_group,v_effective,
    case when v_effective<=current_date then 'applied' else 'scheduled' end
  ) returning id into v_change_id;

  if v_effective <= current_date then
    perform private.olli_schedule_sync_student(p_student_id,current_date);
  end if;
  return jsonb_build_object(
    'ok',true,
    'result',case when v_effective<=current_date then 'applied' else 'scheduled' end,
    'change_id',v_change_id,
    'target_enrollment_id',v_target_id
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.olli_schedule_resolve_waitlist(p_session_token text, p_academy_id uuid, p_waitlist_id uuid, p_action text, p_effective_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_wait public.olli_schedule_waitlist%rowtype;
  v_source public.olli_schedule_enrollments%rowtype;
  v_division text;
  v_class_group text;
  v_capacity integer;
  v_occupancy integer;
  v_effective date := p_effective_date;
  v_target_date date;
  v_target_id uuid;
  v_change_id uuid;
  v_target_order smallint;
  v_existing_count integer;
  v_existing_id uuid;
  v_existing_order smallint;
begin
  if not private.olli_schedule_can_access(p_session_token,p_academy_id) then
    return jsonb_build_object('ok',false,'message','대기 명단을 변경할 권한이 없습니다.');
  end if;
  select * into v_wait
  from public.olli_schedule_waitlist w
  where w.id=p_waitlist_id and w.academy_id=p_academy_id and w.status in('waiting','offered')
  for update;
  if not found then return jsonb_build_object('ok',false,'message','대기 정보를 찾을 수 없습니다.'); end if;
  if p_action='cancel' then
    update public.olli_schedule_waitlist set status='cancelled',resolved_at=now(),updated_at=now() where id=v_wait.id;
    return jsonb_build_object('ok',true,'result','cancelled');
  end if;
  if p_action<>'accept' then return jsonb_build_object('ok',false,'message','대기 처리 방법을 확인해 주세요.'); end if;
  if v_effective is null then return jsonb_build_object('ok',false,'code','TARGET_DATE_REQUIRED','message','대기 입장 적용일을 확인해 주세요.'); end if;
  if v_effective<current_date then return jsonb_build_object('ok',false,'message','지난 날짜로는 입장시킬 수 없습니다.'); end if;

  select s.division into v_division
  from public.students s
  where s.id=v_wait.student_id and s.academy_id=p_academy_id and s.status='active';
  if v_division is null then return jsonb_build_object('ok',false,'message','학생을 찾을 수 없습니다.'); end if;
  v_target_date := private.olli_schedule_weekday_on_or_after(v_effective, v_wait.target_weekday);
  v_class_group := case
    when private.olli_schedule_group_is_enabled(p_academy_id,v_division,v_wait.target_weekday,v_wait.target_time_slot,v_target_date)
      then coalesce(v_wait.target_class_group,'A')
    else 'A'
  end;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text||':'||v_wait.target_weekday::text||':'||v_wait.target_time_slot::text||':'||v_class_group,0
  ));
  v_capacity := private.olli_schedule_capacity(p_academy_id,v_division);
  select count(*) into v_occupancy
  from public.olli_schedule_enrollments e
  join public.students s on s.id=e.student_id
  where e.academy_id=p_academy_id and s.division=v_division
    and e.weekday=v_wait.target_weekday and e.time_slot=v_wait.target_time_slot
    and e.class_group=v_class_group and e.status='active'
    and e.effective_from<=v_target_date and(e.effective_to is null or e.effective_to>=v_target_date);
  if v_occupancy>=v_capacity then
    return jsonb_build_object('ok',false,'message','아직 입장 가능한 자리가 없습니다.','full',true);
  end if;

  if v_wait.request_type='move' then
    select * into v_source
    from public.olli_schedule_enrollments e
    where e.id=v_wait.source_enrollment_id and e.academy_id=p_academy_id
      and e.student_id=v_wait.student_id and e.status='active';
    if not found then return jsonb_build_object('ok',false,'message','기존 수업 정보를 찾을 수 없습니다.'); end if;
    v_target_order := v_source.session_order;
    if v_effective<=v_source.effective_from then
      update public.olli_schedule_enrollments set status='cancelled',updated_at=now() where id=v_source.id;
    else
      update public.olli_schedule_enrollments set effective_to=v_effective-1,updated_at=now() where id=v_source.id;
    end if;
  else
    select count(*) into v_existing_count
    from public.olli_schedule_enrollments e
    where e.academy_id=p_academy_id and e.student_id=v_wait.student_id and e.status='active'
      and e.effective_from<=v_target_date and(e.effective_to is null or e.effective_to>=v_target_date);
    if v_existing_count=0 then
      v_target_order:=1;
    elsif v_existing_count=1 then
      select e.id,e.session_order into v_existing_id,v_existing_order
      from public.olli_schedule_enrollments e
      where e.academy_id=p_academy_id and e.student_id=v_wait.student_id and e.status='active'
        and e.effective_from<=v_target_date and(e.effective_to is null or e.effective_to>=v_target_date)
      limit 1;
      if v_existing_order is null or v_existing_order not in(1,2) then
        v_existing_order:=1;
        update public.olli_schedule_enrollments set session_order=1,updated_at=now() where id=v_existing_id;
      end if;
      v_target_order:=(3-v_existing_order)::smallint;
    else
      v_target_order:=null;
    end if;
  end if;

  insert into public.olli_schedule_enrollments(
    academy_id,student_id,weekday,time_slot,class_group,session_order,effective_from,source
  ) values (
    p_academy_id,v_wait.student_id,v_wait.target_weekday,v_wait.target_time_slot,v_class_group,v_target_order,v_effective,'waitlist'
  ) returning id into v_target_id;

  insert into public.olli_schedule_changes(
    academy_id,student_id,change_type,source_enrollment_id,target_enrollment_id,
    target_class_group,effective_date,status,waitlist_id
  ) values (
    p_academy_id,v_wait.student_id,v_wait.request_type,
    case when v_wait.request_type='move' then v_wait.source_enrollment_id else null end,
    v_target_id,v_class_group,v_effective,
    case when v_effective<=current_date then'applied'else'scheduled'end,v_wait.id
  ) returning id into v_change_id;

  update public.olli_schedule_waitlist set status='accepted',resolved_at=now(),updated_at=now() where id=v_wait.id;
  if v_effective<=current_date then perform private.olli_schedule_sync_student(v_wait.student_id,current_date); end if;
  return jsonb_build_object('ok',true,'result','accepted','change_id',v_change_id);
end;
$function$;


CREATE OR REPLACE FUNCTION public.olli_schedule_set_attendance(p_session_token text, p_academy_id uuid, p_student_id uuid, p_session_date date, p_time_slot integer, p_class_group text DEFAULT 'A'::text, p_session_kind text DEFAULT 'regular'::text, p_attended boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_division text;
  v_weekday integer;
  v_class_group text := upper(coalesce(nullif(btrim(p_class_group), ''), 'A'));
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '출석을 변경할 권한이 없습니다.');
  end if;
  if p_attended is null or p_session_date is null or p_session_date > current_date or p_session_kind not in ('regular', 'makeup') then
    return jsonb_build_object('ok', false, 'message', '출석 날짜와 수업 정보를 확인해 주세요.');
  end if;

  v_account_id := public.olli_account_id_from_session(p_session_token);
  v_weekday := extract(isodow from p_session_date)::integer;

  select s.division into v_division
  from public.students s
  where s.id = p_student_id
    and s.academy_id = p_academy_id
    and s.status = 'active';
  if v_division is null then
    return jsonb_build_object('ok', false, 'message', '학생을 찾을 수 없습니다.');
  end if;

  if (v_division = 'elementary' and v_weekday = 6 and p_time_slot not in (10, 11, 12))
     or (v_division = 'elementary' and v_weekday <> 6 and p_time_slot not between 1 and 6)
     or (v_division = 'kinder' and p_time_slot not in (4, 5)) then
    return jsonb_build_object('ok', false, 'message', '출석 날짜와 수업 시간을 확인해 주세요.');
  end if;

  if not private.olli_schedule_group_is_enabled(p_academy_id, v_division, v_weekday, p_time_slot, p_session_date) then
    v_class_group := 'A';
  end if;
  if v_class_group not in ('A', 'B') then
    return jsonb_build_object('ok', false, 'message', '수업 반을 확인해 주세요.');
  end if;

  if p_session_kind = 'regular' and not exists (
    select 1
    from public.olli_schedule_enrollments e
    where e.academy_id = p_academy_id
      and e.student_id = p_student_id
      and e.weekday = v_weekday
      and e.time_slot = p_time_slot
      and e.class_group = v_class_group
      and e.status = 'active'
      and e.effective_from <= p_session_date
      and (e.effective_to is null or e.effective_to >= p_session_date)
  ) then
    return jsonb_build_object('ok', false, 'message', '해당 날짜의 정규 수업을 찾을 수 없습니다.');
  end if;

  if p_session_kind = 'makeup' and not exists (
    select 1
    from public.olli_schedule_one_time_sessions o
    where o.academy_id = p_academy_id
      and o.student_id = p_student_id
      and o.session_date = p_session_date
      and o.time_slot = p_time_slot
      and o.class_group = v_class_group
      and o.status <> 'cancelled'
  ) then
    return jsonb_build_object('ok', false, 'message', '해당 날짜의 보강 수업을 찾을 수 없습니다.');
  end if;

  return private.olli_schedule_apply_attendance_state(
    p_academy_id,
    p_student_id,
    p_session_date,
    p_time_slot,
    v_class_group,
    p_session_kind,
    p_attended,
    v_account_id
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.olli_schedule_toggle_attendance(p_session_token text, p_academy_id uuid, p_student_id uuid, p_session_date date, p_time_slot integer, p_class_group text, p_session_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_division text;
  v_weekday integer;
  v_class_group text := upper(coalesce(nullif(btrim(p_class_group), ''), 'A'));
  v_mark_id uuid;
  v_marked_at timestamptz;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '출석을 변경할 권한이 없습니다.');
  end if;
  if p_session_date is null or p_session_date > current_date or p_session_kind not in ('regular', 'makeup') then
    return jsonb_build_object('ok', false, 'message', '출석 날짜와 수업 정보를 확인해 주세요.');
  end if;
  v_account_id := public.olli_account_id_from_session(p_session_token);
  v_weekday := extract(isodow from p_session_date)::integer;
  select s.division into v_division
  from public.students s
  where s.id = p_student_id and s.academy_id = p_academy_id and s.status = 'active';
  if v_division is null then
    return jsonb_build_object('ok', false, 'message', '학생을 찾을 수 없습니다.');
  end if;
  if (v_division = 'elementary' and v_weekday = 6 and p_time_slot not in (10, 11, 12))
     or (v_division = 'elementary' and v_weekday <> 6 and p_time_slot not between 1 and 6)
     or (v_division = 'kinder' and p_time_slot not in (4, 5)) then
    return jsonb_build_object('ok', false, 'message', '출석 날짜와 수업 시간을 확인해 주세요.');
  end if;
  if not private.olli_schedule_group_is_enabled(p_academy_id, v_division, v_weekday, p_time_slot, p_session_date) then
    v_class_group := 'A';
  end if;
  if v_class_group not in ('A', 'B') then
    return jsonb_build_object('ok', false, 'message', '수업 반을 확인해 주세요.');
  end if;
  if p_session_kind = 'regular' and not exists (
    select 1 from public.olli_schedule_enrollments e
    where e.academy_id = p_academy_id and e.student_id = p_student_id
      and e.weekday = v_weekday and e.time_slot = p_time_slot and e.class_group = v_class_group and e.status = 'active'
      and e.effective_from <= p_session_date and (e.effective_to is null or e.effective_to >= p_session_date)
  ) then
    return jsonb_build_object('ok', false, 'message', '해당 날짜의 정규 수업을 찾을 수 없습니다.');
  end if;
  if p_session_kind = 'makeup' and not exists (
    select 1 from public.olli_schedule_one_time_sessions o
    where o.academy_id = p_academy_id and o.student_id = p_student_id
      and o.session_date = p_session_date and o.time_slot = p_time_slot
      and o.class_group = v_class_group and o.status <> 'cancelled'
  ) then
    return jsonb_build_object('ok', false, 'message', '해당 날짜의 보강 수업을 찾을 수 없습니다.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':attendance:' || p_student_id::text || ':' || p_session_date::text || ':' || p_time_slot::text || ':' || v_class_group || ':' || p_session_kind,
    0
  ));
  select a.id into v_mark_id
  from public.olli_schedule_attendance a
  where a.academy_id = p_academy_id and a.student_id = p_student_id
    and a.session_date = p_session_date and a.time_slot = p_time_slot
    and a.class_group = v_class_group and a.session_kind = p_session_kind;
  if v_mark_id is not null then
    delete from public.olli_schedule_attendance where id = v_mark_id;
    return jsonb_build_object('ok', true, 'attended', false);
  end if;
  insert into public.olli_schedule_attendance (
    academy_id, student_id, session_date, time_slot, class_group, session_kind, marked_by_account_id
  ) values (
    p_academy_id, p_student_id, p_session_date, p_time_slot, v_class_group, p_session_kind, v_account_id
  ) returning marked_at into v_marked_at;
  return jsonb_build_object('ok', true, 'attended', true, 'marked_at', v_marked_at);
end;
$function$;


CREATE OR REPLACE FUNCTION public.olli_schedule_set_student_weekly_schedule(p_session_token text, p_academy_id uuid, p_student_id uuid, p_pairs jsonb, p_effective_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_date date := p_effective_date;
  v_division text;
  v_pair jsonb;
  v_current public.olli_schedule_enrollments%rowtype;
  v_existing public.olli_schedule_enrollments%rowtype;
  v_result jsonb;
  v_group text;
  v_requested_group text;
  v_rows jsonb;
  v_message text;
  v_pair_count integer;
  v_distinct_count integer;
  v_target_date date;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '학생 시간표를 변경할 권한이 없습니다.');
  end if;
  if v_date is null then
    return jsonb_build_object('ok', false, 'code', 'TARGET_DATE_REQUIRED', 'message', '시간표 적용일을 확인해 주세요.');
  end if;
  if v_date < current_date then
    return jsonb_build_object('ok', false, 'message', '지난 날짜부터 시간표를 변경할 수 없습니다.');
  end if;
  if p_pairs is null or jsonb_typeof(p_pairs) <> 'array' then
    return jsonb_build_object('ok', false, 'message', '시간표 형식을 확인해 주세요.');
  end if;

  select s.division
    into v_division
  from public.students s
  where s.id = p_student_id
    and s.academy_id = p_academy_id
    and s.status = 'active'
    and coalesce(s.is_deleted, false) = false;

  if v_division is null then
    return jsonb_build_object('ok', false, 'message', '재원 중인 학생을 찾을 수 없습니다.');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_pairs) x
    where coalesce((x->>'weekday')::integer, 0) not between 1 and 6
       or coalesce((x->>'time_slot')::integer, 0) <= 0
       or (
         v_division = 'elementary'
         and (
           (coalesce((x->>'weekday')::integer, 0) = 6 and coalesce((x->>'time_slot')::integer, 0) not in (10,11,12))
           or (coalesce((x->>'weekday')::integer, 0) <> 6 and coalesce((x->>'time_slot')::integer, 0) not between 1 and 6)
         )
       )
       or (v_division = 'kinder' and coalesce((x->>'time_slot')::integer, 0) not in (4,5))
  ) then
    return jsonb_build_object('ok', false, 'message', '시간표 페이지에서 사용하는 요일과 시간만 선택할 수 있습니다.');
  end if;

  select count(*), count(distinct ((x->>'weekday')::integer, (x->>'time_slot')::integer))
    into v_pair_count, v_distinct_count
  from jsonb_array_elements(p_pairs) x;

  if v_pair_count <> v_distinct_count then
    return jsonb_build_object('ok', false, 'message', '같은 요일과 같은 시간을 중복해서 등록할 수 없습니다.');
  end if;

  if exists (
    select 1
    from public.olli_schedule_changes c
    where c.academy_id = p_academy_id
      and c.student_id = p_student_id
      and c.status = 'scheduled'
      and c.effective_date >= v_date
  ) then
    return jsonb_build_object('ok', false, 'message', '예약된 시간표 변경이 있습니다. 시간표 페이지에서 예약 내용을 먼저 확인해 주세요.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':student-weekly-schedule:' || p_student_id::text || ':' || v_date::text,
    0
  ));
  perform set_config('olli.schedule_action', 'student_profile_schedule', true);

  begin
    -- 목표 목록에서 빠진 현재 정규 수업만 종료합니다. 같은 요일+시간은 기존 행을 보존합니다.
    for v_current in
      select e.*
      from public.olli_schedule_enrollments e
      where e.academy_id = p_academy_id
        and e.student_id = p_student_id
        and e.status = 'active'
        and e.effective_from <= v_date
        and (e.effective_to is null or e.effective_to >= v_date)
      order by e.weekday, e.time_slot, e.class_group
    loop
      if not exists (
        select 1
        from jsonb_array_elements(p_pairs) x
        where (x->>'weekday')::integer = v_current.weekday
          and (x->>'time_slot')::integer = v_current.time_slot
      ) then
        v_result := public.olli_schedule_remove_enrollment(
          p_session_token,
          p_academy_id,
          p_student_id,
          v_current.id,
          v_date
        );
        if coalesce((v_result->>'ok')::boolean, false) = false then
          raise exception '%', coalesce(v_result->>'message', '기존 수업을 변경하지 못했습니다.');
        end if;
      end if;
    end loop;

    -- 새 목표 목록을 추가하고, 같은 시간의 반만 달라진 경우에는 이동으로 처리합니다.
    for v_pair in
      select value
      from jsonb_array_elements(p_pairs)
      order by (value->>'weekday')::integer, (value->>'time_slot')::integer
    loop
      v_requested_group := upper(coalesce(nullif(btrim(v_pair->>'class_group'), ''), ''));
      v_target_date := private.olli_schedule_weekday_on_or_after(v_date, (v_pair->>'weekday')::integer);
      if v_requested_group = 'B' and not private.olli_schedule_group_is_enabled(
        p_academy_id, v_division, (v_pair->>'weekday')::integer, (v_pair->>'time_slot')::integer, v_target_date
      ) then
        v_requested_group := 'A';
      end if;

      select e.*
        into v_existing
      from public.olli_schedule_enrollments e
      where e.academy_id = p_academy_id
        and e.student_id = p_student_id
        and e.status = 'active'
        and e.weekday = (v_pair->>'weekday')::integer
        and e.time_slot = (v_pair->>'time_slot')::integer
        and e.effective_from <= v_date
        and (e.effective_to is null or e.effective_to >= v_date)
      order by e.created_at
      limit 1;

      if found then
        if v_requested_group in ('A','B')
           and v_requested_group <> coalesce(v_existing.class_group, 'A') then
          v_result := public.olli_schedule_change(
            p_session_token,
            p_academy_id,
            p_student_id,
            v_existing.id,
            (v_pair->>'weekday')::integer,
            (v_pair->>'time_slot')::integer,
            v_date,
            'move',
            false,
            v_requested_group
          );
          if coalesce((v_result->>'ok')::boolean, false) = false then
            raise exception '%', coalesce(v_result->>'message', '수업 반을 변경하지 못했습니다.');
          end if;
        end if;
        continue;
      end if;

      v_group := case when v_requested_group in ('A','B') then v_requested_group else 'A' end;
      v_result := public.olli_schedule_change(
        p_session_token,
        p_academy_id,
        p_student_id,
        null,
        (v_pair->>'weekday')::integer,
        (v_pair->>'time_slot')::integer,
        v_date,
        'add',
        false,
        v_group
      );

      -- 반을 지정하지 않은 새 일정은 A반이 가득 찼고 분반이 켜져 있으면 B반을 한 번 시도합니다.
      if coalesce((v_result->>'ok')::boolean, false) = false
         and coalesce((v_result->>'full')::boolean, false) = true
         and v_requested_group = ''
         and private.olli_schedule_group_is_enabled(
           p_academy_id,
           v_division,
           (v_pair->>'weekday')::integer,
           (v_pair->>'time_slot')::integer,
           v_target_date
         ) then
        v_result := public.olli_schedule_change(
          p_session_token,
          p_academy_id,
          p_student_id,
          null,
          (v_pair->>'weekday')::integer,
          (v_pair->>'time_slot')::integer,
          v_date,
          'add',
          false,
          'B'
        );
      end if;

      if coalesce((v_result->>'ok')::boolean, false) = false then
        raise exception '%', coalesce(v_result->>'message', '새 수업을 등록하지 못했습니다.');
      end if;
    end loop;

    perform private.olli_schedule_sync_student(p_student_id, v_date);
  exception when others then
    v_message := sqlerrm;
    return jsonb_build_object('ok', false, 'message', v_message);
  end;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'weekday', e.weekday,
        'time_slot', e.time_slot,
        'class_group', coalesce(e.class_group, 'A'),
        'session_order', e.session_order,
        'effective_from', e.effective_from,
        'effective_to', e.effective_to
      )
      order by coalesce(e.session_order, 99), e.weekday, e.time_slot, e.class_group
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.olli_schedule_enrollments e
  where e.academy_id = p_academy_id
    and e.student_id = p_student_id
    and e.status = 'active'
    and e.effective_from <= v_date
    and (e.effective_to is null or e.effective_to >= v_date);

  return jsonb_build_object(
    'ok', true,
    'result', 'applied',
    'effective_date', v_date,
    'enrollments', v_rows
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.olli_schedule_update_one_time_date(p_session_token text, p_academy_id uuid, p_one_time_session_id uuid, p_session_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_item public.olli_schedule_one_time_sessions%rowtype;
  v_division text;
  v_class_group text;
  v_capacity integer;
  v_weekday integer;
  v_occupancy integer;
  v_account_id uuid;
  v_type_label text;
  v_identity_key text;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '1회 수업 날짜를 변경할 권한이 없습니다.');
  end if;

  if p_one_time_session_id is null or p_session_date is null or p_session_date < current_date then
    return jsonb_build_object('ok', false, 'message', '변경할 날짜를 확인해 주세요.');
  end if;

  select o.* into v_item
  from public.olli_schedule_one_time_sessions o
  where o.id = p_one_time_session_id
    and o.academy_id = p_academy_id
  for update;

  if not found
     or v_item.session_type not in ('makeup', 'trial')
     or v_item.status = 'cancelled'
     or (v_item.session_type = 'makeup' and v_item.student_id is null)
     or (v_item.session_type = 'trial' and v_item.student_id is null and nullif(btrim(v_item.guest_name), '') is null) then
    return jsonb_build_object('ok', false, 'message', '변경할 보강·체험 수업을 찾을 수 없습니다.');
  end if;

  v_type_label := case when v_item.session_type = 'trial' then '체험' else '보강' end;

  if p_session_date = v_item.session_date then
    return jsonb_build_object(
      'ok', true,
      'result', 'unchanged',
      'one_time_session_id', v_item.id,
      'session_date', v_item.session_date,
      'unchanged', true
    );
  end if;

  if v_item.session_type = 'makeup' and (
    exists (
      select 1
      from public.olli_schedule_attendance a
      where a.academy_id = p_academy_id
        and a.student_id = v_item.student_id
        and a.session_date = v_item.session_date
        and a.time_slot = v_item.time_slot
        and upper(coalesce(nullif(btrim(a.class_group), ''), 'A')) = upper(coalesce(nullif(btrim(v_item.class_group), ''), 'A'))
        and a.session_kind = 'makeup'
    )
    or exists (
      select 1
      from private.olli_schedule_attendance_session_overrides a
      where a.academy_id = p_academy_id
        and a.student_id = v_item.student_id
        and a.session_date = v_item.session_date
        and a.time_slot = v_item.time_slot
        and upper(coalesce(nullif(btrim(a.class_group), ''), 'A')) = upper(coalesce(nullif(btrim(v_item.class_group), ''), 'A'))
        and a.session_kind = 'makeup'
    )
  ) then
    return jsonb_build_object('ok', false, 'message', '출결 정보가 있는 보강은 날짜를 변경할 수 없습니다.');
  end if;

  v_weekday := extract(isodow from p_session_date)::integer;
  if v_weekday not between 1 and 6 then
    return jsonb_build_object('ok', false, 'message', '일요일에는 보강·체험 수업을 등록할 수 없습니다.');
  end if;

  if v_item.student_id is not null then
    select s.division into v_division
    from public.students s
    where s.id = v_item.student_id
      and s.academy_id = p_academy_id
      and s.status = 'active';
  else
    v_division := nullif(btrim(v_item.guest_division), '');
  end if;

  if v_division is null then
    return jsonb_build_object('ok', false, 'message', '수업 구분 정보를 찾을 수 없습니다.');
  end if;

  if (v_division = 'elementary' and v_weekday = 6 and v_item.time_slot not in (10, 11, 12))
     or (v_division = 'elementary' and v_weekday <> 6 and v_item.time_slot not between 1 and 6)
     or (v_division = 'kinder' and v_item.time_slot not in (4, 5)) then
    return jsonb_build_object('ok', false, 'message', '선택한 날짜에는 현재 ' || v_type_label || ' 시간으로 수업할 수 없습니다.');
  end if;

  v_class_group := upper(coalesce(nullif(btrim(v_item.class_group), ''), 'A'));
  if not private.olli_schedule_group_is_enabled(p_academy_id, v_division, v_weekday, v_item.time_slot, p_session_date) then
    v_class_group := 'A';
  elsif v_class_group not in ('A', 'B') then
    return jsonb_build_object('ok', false, 'message', '수업 반 정보를 확인해 주세요.');
  end if;

  v_identity_key := case
    when v_item.student_id is not null then 'student:' || v_item.student_id::text
    else 'guest:' || lower(btrim(v_item.guest_name))
  end;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':' || v_item.session_type || ':' || v_identity_key || ':' || p_session_date::text || ':' || v_item.time_slot::text,
    0
  ));

  if v_item.student_id is not null then
    if exists (
      select 1
      from public.olli_schedule_one_time_sessions o
      where o.academy_id = p_academy_id
        and o.student_id = v_item.student_id
        and o.session_date = p_session_date
        and o.time_slot = v_item.time_slot
        and o.status <> 'cancelled'
        and o.id <> v_item.id
    ) then
      return jsonb_build_object('ok', false, 'message', '같은 날짜와 시간에 이미 등록된 수업이 있습니다.');
    end if;
  else
    if exists (
      select 1
      from public.olli_schedule_one_time_sessions o
      where o.academy_id = p_academy_id
        and o.student_id is null
        and o.session_type = 'trial'
        and lower(btrim(o.guest_name)) = lower(btrim(v_item.guest_name))
        and o.session_date = p_session_date
        and o.time_slot = v_item.time_slot
        and upper(coalesce(nullif(btrim(o.class_group), ''), 'A')) = v_class_group
        and o.status <> 'cancelled'
        and o.id <> v_item.id
    ) then
      return jsonb_build_object('ok', false, 'message', '같은 날짜와 시간에 이미 등록된 체험수업이 있습니다.');
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':' || p_session_date::text || ':' || v_item.time_slot::text || ':' || v_class_group,
    0
  ));

  v_capacity := private.olli_schedule_capacity(p_academy_id, v_division);

  select
    (select count(*)
       from public.olli_schedule_enrollments e
       join public.students s on s.id = e.student_id
      where e.academy_id = p_academy_id
        and s.division = v_division
        and e.weekday = v_weekday
        and e.time_slot = v_item.time_slot
        and e.class_group = v_class_group
        and e.status = 'active'
        and e.effective_from <= p_session_date
        and (e.effective_to is null or e.effective_to >= p_session_date)
        and not exists (
          select 1
          from private.olli_schedule_attendance_session_overrides a
          where a.academy_id = p_academy_id
            and a.student_id = e.student_id
            and a.session_date = p_session_date
            and a.time_slot = v_item.time_slot
            and upper(coalesce(nullif(btrim(a.class_group), ''), 'A')) = v_class_group
            and a.session_kind = 'regular'
            and a.status = 'absent'
        ))
    +
    (select count(*)
       from public.olli_schedule_one_time_sessions o
       left join public.students s on s.id = o.student_id
      where o.academy_id = p_academy_id
        and coalesce(s.division, o.guest_division) = v_division
        and o.session_date = p_session_date
        and o.time_slot = v_item.time_slot
        and o.class_group = v_class_group
        and o.status <> 'cancelled'
        and o.id <> v_item.id)
  into v_occupancy;

  if v_capacity is not null and v_occupancy >= v_capacity then
    return jsonb_build_object('ok', false, 'message', '선택한 날짜와 시간의 정원이 가득 찼습니다.', 'full', true);
  end if;

  v_account_id := public.olli_account_id_from_session(p_session_token);
  perform set_config('olli.actor_account_id', v_account_id::text, true);
  perform set_config(
    'olli.schedule_action',
    case when v_item.session_type = 'trial' then 'trial_date_change' else 'makeup_date_change' end,
    true
  );

  update public.olli_schedule_one_time_sessions
  set session_date = p_session_date,
      class_group = v_class_group,
      updated_at = now()
  where id = v_item.id
    and academy_id = p_academy_id;

  return jsonb_build_object(
    'ok', true,
    'result', 'updated',
    'session_type', v_item.session_type,
    'one_time_session_id', v_item.id,
    'old_session_date', v_item.session_date,
    'session_date', p_session_date,
    'unchanged', false
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'message', '같은 날짜와 시간에 이미 등록된 수업이 있습니다.');
end;
$function$;


CREATE OR REPLACE FUNCTION public.olli_schedule_execute(p_session_token text, p_academy_id uuid, p_action text, p_params jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_result jsonb;
  v_action text := lower(btrim(coalesce(p_action,'')));
  v_params jsonb := coalesce(p_params,'{}'::jsonb);
  v_semantic_action text;
  v_action_date date;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null or not exists (
    select 1 from public.academy_members m
    where m.academy_id=p_academy_id and m.account_id=v_account_id
      and m.status='active' and m.role in('owner','manager','teacher')
  ) then
    return jsonb_build_object('ok',false,'message','시간표를 변경할 권한이 없습니다.');
  end if;

  v_semantic_action := case v_action
    when 'change' then case when v_params->>'change_type'='move' then'move'else'add'end
    when 'add_waitlist' then 'wait_add'
    when 'resolve_waitlist' then case when v_params->>'action'='accept' then'wait_accept'else'wait_cancel'end
    when 'add_one_time' then 'makeup_add'
    when 'cancel_one_time' then 'makeup_cancel'
    when 'cancel_change' then 'scheduled_cancel'
    when 'remove_enrollment' then 'remove'
    when 'toggle_attendance' then 'attendance_toggle'
    when 'set_attendance' then 'attendance_set'
    when 'save_pickup' then 'pickup_add'
    when 'update_pickup' then case when v_params->>'mode'='schedule' then 'pickup_schedule' else 'pickup_edit' end
    when 'remove_pickup' then 'pickup_remove'
    when 'split_class' then 'class_split'
    when 'merge_class' then 'class_merge'
    when 'set_session_order' then 'session_order'
    when 'save_cell_memo' then 'memo_save'
    else null
  end;
  if v_semantic_action is null then
    return jsonb_build_object('ok',false,'message','지원하지 않는 시간표 변경입니다.');
  end if;

  v_action_date := case v_action
    when 'save_cell_memo' then nullif(v_params->>'session_date','')::date
    when 'add_one_time' then nullif(v_params->>'session_date','')::date
    when 'toggle_attendance' then nullif(v_params->>'session_date','')::date
    when 'set_attendance' then nullif(v_params->>'session_date','')::date
    when 'save_pickup' then nullif(v_params->>'effective_date','')::date
    when 'change' then nullif(v_params->>'effective_date','')::date
    when 'add_waitlist' then nullif(v_params->>'effective_date','')::date
    else null
  end;
  if v_action_date is not null
     and v_action in ('save_cell_memo','add_one_time','toggle_attendance','set_attendance','save_pickup','change','add_waitlist')
     and private.olli_schedule_is_closed_day(p_academy_id, v_action_date) then
    return jsonb_build_object('ok', false, 'message', '공휴일에는 해당 시간표 작업을 할 수 없습니다. 정상수업으로 전환한 뒤 다시 시도해 주세요.');
  end if;

  perform set_config('olli.actor_account_id',v_account_id::text,true);
  perform set_config('olli.schedule_action',v_semantic_action,true);

  if v_action='merge_class' then
    return public.olli_schedule_merge_class(p_session_token,p_academy_id,(v_params->>'weekday')::integer,(v_params->>'time_slot')::integer,nullif(v_params->>'effective_date','')::date);
  elsif v_action='split_class' then
    return public.olli_schedule_split_class(p_session_token,p_academy_id,(v_params->>'weekday')::integer,(v_params->>'time_slot')::integer,nullif(v_params->>'effective_date','')::date);
  elsif v_action='set_session_order' then
    v_result := public.olli_schedule_set_session_order(
      p_session_token,p_academy_id,
      nullif(v_params->>'student_id','')::uuid,
      nullif(v_params->>'enrollment_id','')::uuid,
      (v_params->>'session_order')::integer,
      nullif(v_params->>'effective_date','')::date
    );
  elsif v_action='save_cell_memo' then
    v_result := public.olli_schedule_save_cell_memo(
      p_session_token,p_academy_id,
      v_params->>'division',
      nullif(v_params->>'session_date','')::date,
      (v_params->>'time_slot')::integer,
      coalesce(v_params->>'note','')
    );
  elsif v_action='change' then
    v_result := public.olli_schedule_change(
      p_session_token,p_academy_id,nullif(v_params->>'student_id','')::uuid,
      nullif(v_params->>'source_enrollment_id','')::uuid,
      (v_params->>'target_weekday')::integer,(v_params->>'target_time_slot')::integer,
      nullif(v_params->>'effective_date','')::date,v_params->>'change_type',
      coalesce((v_params->>'allow_wait')::boolean,true),
      coalesce(nullif(v_params->>'target_class_group',''),'A')
    );
  elsif v_action='add_waitlist' then
    v_result := public.olli_schedule_add_waitlist(
      p_session_token,p_academy_id,nullif(v_params->>'student_id','')::uuid,
      (v_params->>'target_weekday')::integer,(v_params->>'target_time_slot')::integer,
      nullif(v_params->>'effective_date','')::date,
      coalesce(nullif(v_params->>'target_class_group',''),'A')
    );
  elsif v_action='resolve_waitlist' then
    v_result := public.olli_schedule_resolve_waitlist(
      p_session_token,p_academy_id,nullif(v_params->>'waitlist_id','')::uuid,
      v_params->>'action',nullif(v_params->>'effective_date','')::date
    );
  elsif v_action='add_one_time' then
    v_result := public.olli_schedule_add_one_time(
      p_session_token,p_academy_id,nullif(v_params->>'student_id','')::uuid,
      nullif(v_params->>'session_date','')::date,(v_params->>'time_slot')::integer,
      coalesce(v_params->>'note',''),coalesce(nullif(v_params->>'class_group',''),'A')
    );
  elsif v_action='cancel_one_time' then
    v_result := public.olli_schedule_cancel_one_time(p_session_token,p_academy_id,nullif(v_params->>'one_time_session_id','')::uuid);
  elsif v_action='cancel_change' then
    v_result := public.olli_schedule_cancel_change(p_session_token,p_academy_id,nullif(v_params->>'change_id','')::uuid);
  elsif v_action='remove_enrollment' then
    v_result := public.olli_schedule_remove_enrollment(
      p_session_token,p_academy_id,nullif(v_params->>'student_id','')::uuid,
      nullif(v_params->>'enrollment_id','')::uuid,nullif(v_params->>'effective_date','')::date
    );
  elsif v_action='toggle_attendance' then
    v_result := public.olli_schedule_toggle_attendance(
      p_session_token,p_academy_id,nullif(v_params->>'student_id','')::uuid,
      nullif(v_params->>'session_date','')::date,(v_params->>'time_slot')::integer,
      coalesce(nullif(v_params->>'class_group',''),'A'),v_params->>'session_kind'
    );
  elsif v_action='set_attendance' then
    v_result := public.olli_schedule_set_attendance(
      p_session_token,p_academy_id,nullif(v_params->>'student_id','')::uuid,
      nullif(v_params->>'session_date','')::date,(v_params->>'time_slot')::integer,
      coalesce(nullif(v_params->>'class_group',''),'A'),
      coalesce(nullif(v_params->>'session_kind',''),'regular'),
      coalesce((v_params->>'attended')::boolean,false)
    );
  elsif v_action='save_pickup' then
    v_result := public.olli_schedule_save_pickup(
      p_session_token,p_academy_id,nullif(v_params->>'student_id','')::uuid,
      (v_params->>'weekday')::integer,(v_params->>'class_time')::integer,
      v_params->>'pickup_label',nullif(v_params->>'pickup_time','')::time,
      nullif(v_params->>'effective_date','')::date
    );
  elsif v_action='update_pickup' then
    v_result := public.olli_schedule_update_pickup(
      p_session_token,p_academy_id,nullif(v_params->>'pickup_id','')::uuid,
      nullif(v_params->>'pickup_time','')::time,
      nullif(v_params->>'effective_date','')::date,
      coalesce(v_params->>'mode','edit')
    );
  else
    v_result := public.olli_schedule_remove_pickup(
      p_session_token,p_academy_id,nullif(v_params->>'pickup_id','')::uuid,
      nullif(v_params->>'effective_date','')::date
    );
  end if;
  return v_result;
exception
  when invalid_text_representation or invalid_datetime_format or numeric_value_out_of_range then
    return jsonb_build_object('ok',false,'message','시간표 변경 값을 확인해 주세요.');
end;
$function$;


revoke all on function public.olli_schedule_split_class(text, uuid, integer, integer, date) from public, anon, authenticated;
revoke all on function public.olli_schedule_merge_class(text, uuid, integer, integer, date) from public, anon, authenticated;
revoke all on function public.olli_schedule_split_class(text, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.olli_schedule_merge_class(text, uuid, integer, integer) from public, anon, authenticated;
commit;
