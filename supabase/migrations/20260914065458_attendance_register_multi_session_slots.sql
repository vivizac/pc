create table if not exists private.olli_schedule_attendance_session_overrides (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  session_date date not null,
  time_slot smallint not null check (time_slot between 1 and 12),
  class_group text not null default 'A' check (class_group in ('A','B')),
  session_kind text not null check (session_kind in ('regular','makeup')),
  status text not null check (status in ('present','absent','makeup','blank')),
  updated_by_account_id uuid references public.olli_accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, student_id, session_date, time_slot, class_group, session_kind)
);

revoke all on private.olli_schedule_attendance_session_overrides from public, anon, authenticated;

create index if not exists olli_schedule_attendance_session_overrides_month_idx
  on private.olli_schedule_attendance_session_overrides (academy_id, session_date, student_id);

create or replace function public.olli_schedule_set_attendance_session_slot_status(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_session_date date,
  p_session_kind text,
  p_time_slot integer,
  p_class_group text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_kind text := lower(btrim(coalesce(p_session_kind, '')));
  v_group text := upper(btrim(coalesce(p_class_group, 'A')));
  v_weekday integer;
  v_exists boolean := false;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '출석부를 변경할 권한이 없습니다.');
  end if;

  if p_student_id is null or p_session_date is null or v_kind not in ('regular','makeup') then
    return jsonb_build_object('ok', false, 'message', '출석 수업 유형을 확인해 주세요.');
  end if;

  if p_time_slot is null or p_time_slot < 1 or p_time_slot > 12 or v_group not in ('A','B') then
    return jsonb_build_object('ok', false, 'message', '출석 수업 시간을 확인해 주세요.');
  end if;

  if (v_kind = 'regular' and v_status not in ('present','absent','blank'))
     or (v_kind = 'makeup' and v_status not in ('makeup','blank')) then
    return jsonb_build_object('ok', false, 'message', '출석부 변경 값을 확인해 주세요.');
  end if;

  if not exists (
    select 1
    from public.students s
    where s.id = p_student_id
      and s.academy_id = p_academy_id
      and s.status = 'active'
      and coalesce(s.is_deleted, false) = false
  ) then
    return jsonb_build_object('ok', false, 'message', '학생을 찾을 수 없습니다.');
  end if;

  v_account_id := public.olli_account_id_from_session(p_session_token);
  v_weekday := extract(isodow from p_session_date)::integer;

  if v_kind = 'regular' then
    select exists (
      select 1
      from public.olli_schedule_enrollments e
      where e.academy_id = p_academy_id
        and e.student_id = p_student_id
        and e.weekday = v_weekday
        and e.time_slot = p_time_slot
        and coalesce(nullif(e.class_group, ''), 'A') = v_group
        and e.status = 'active'
        and e.effective_from <= p_session_date
        and (e.effective_to is null or e.effective_to >= p_session_date)
    ) into v_exists;
  else
    select exists (
      select 1
      from public.olli_schedule_one_time_sessions o
      where o.academy_id = p_academy_id
        and o.student_id = p_student_id
        and o.session_date = p_session_date
        and o.time_slot = p_time_slot
        and coalesce(nullif(o.class_group, ''), 'A') = v_group
        and o.status <> 'cancelled'
    ) into v_exists;
  end if;

  if not v_exists then
    return jsonb_build_object('ok', false, 'message', '해당 날짜와 시간의 수업을 찾을 수 없습니다.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':attendance-session-slot:' || p_student_id::text || ':' || p_session_date::text || ':' || v_kind || ':' || p_time_slot::text || ':' || v_group,
    0
  ));

  if p_session_date <= current_date then
    if (v_kind = 'regular' and v_status = 'present') or (v_kind = 'makeup' and v_status = 'makeup') then
      perform private.olli_schedule_apply_attendance_state(
        p_academy_id, p_student_id, p_session_date,
        p_time_slot, v_group, v_kind, true, v_account_id
      );
    else
      perform private.olli_schedule_apply_attendance_state(
        p_academy_id, p_student_id, p_session_date,
        p_time_slot, v_group, v_kind, false, v_account_id
      );
    end if;
  end if;

  insert into private.olli_schedule_attendance_session_overrides (
    academy_id, student_id, session_date, time_slot, class_group,
    session_kind, status, updated_by_account_id, updated_at
  ) values (
    p_academy_id, p_student_id, p_session_date, p_time_slot, v_group,
    v_kind, v_status, v_account_id, now()
  )
  on conflict (academy_id, student_id, session_date, time_slot, class_group, session_kind)
  do update set
    status = excluded.status,
    updated_by_account_id = excluded.updated_by_account_id,
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'status', v_status,
    'session_kind', v_kind,
    'session_date', p_session_date,
    'time_slot', p_time_slot,
    'class_group', v_group
  );
end;
$function$;

revoke execute on function public.olli_schedule_set_attendance_session_slot_status(text, uuid, uuid, date, text, integer, text, text) from public;
grant execute on function public.olli_schedule_set_attendance_session_slot_status(text, uuid, uuid, date, text, integer, text, text) to anon, authenticated;

create or replace function private.olli_schedule_clear_register_override_on_attendance_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_academy_id uuid;
  v_student_id uuid;
  v_session_date date;
  v_time_slot integer;
  v_class_group text;
  v_session_kind text;
begin
  if tg_op = 'DELETE' then
    v_academy_id := old.academy_id;
    v_student_id := old.student_id;
    v_session_date := old.session_date;
    v_time_slot := old.time_slot;
    v_class_group := old.class_group;
    v_session_kind := old.session_kind;
  else
    v_academy_id := new.academy_id;
    v_student_id := new.student_id;
    v_session_date := new.session_date;
    v_time_slot := new.time_slot;
    v_class_group := new.class_group;
    v_session_kind := new.session_kind;
  end if;

  if v_session_kind in ('regular','makeup') then
    delete from private.olli_schedule_attendance_session_overrides o
    where o.academy_id = v_academy_id
      and o.student_id = v_student_id
      and o.session_date = v_session_date
      and o.time_slot = v_time_slot
      and o.class_group = v_class_group
      and o.session_kind = v_session_kind;

    delete from public.olli_schedule_attendance_register_overrides o
    where o.academy_id = v_academy_id
      and o.student_id = v_student_id
      and o.session_date = v_session_date
      and o.session_kind = v_session_kind;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

create or replace function public.olli_schedule_attendance_month(
  p_session_token text,
  p_academy_id uuid,
  p_month date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_start date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_end date;
  v_rows jsonb;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '출석부를 볼 권한이 없습니다.');
  end if;

  v_end := (v_start + interval '1 month - 1 day')::date;

  select coalesce(
    jsonb_agg(to_jsonb(x) order by x.session_date, x.student_id, x.time_slot, x.session_kind, x.register_session_kind),
    '[]'::jsonb
  )
  into v_rows
  from (
    select
      a.student_id,
      a.session_date,
      a.time_slot,
      a.class_group,
      a.session_kind,
      null::text as register_session_kind,
      a.marked_at,
      true as attended,
      null::text as register_status
    from public.olli_schedule_attendance a
    where a.academy_id = p_academy_id
      and a.session_date between v_start and v_end

    union all

    select distinct
      e.student_id,
      d.session_date,
      e.time_slot,
      e.class_group,
      'regular_expected'::text as session_kind,
      null::text as register_session_kind,
      null::timestamptz as marked_at,
      false as attended,
      null::text as register_status
    from public.olli_schedule_enrollments e
    join public.students s
      on s.id = e.student_id
     and s.academy_id = e.academy_id
     and s.status = 'active'
     and coalesce(s.is_deleted, false) = false
    cross join lateral (
      select gs::date as session_date
      from generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') gs
    ) d
    where e.academy_id = p_academy_id
      and e.status = 'active'
      and e.effective_from <= d.session_date
      and (e.effective_to is null or e.effective_to >= d.session_date)
      and e.weekday = extract(isodow from d.session_date)::integer

    union all

    select
      o.student_id,
      o.session_date,
      o.time_slot,
      coalesce(nullif(o.class_group, ''), 'A') as class_group,
      'makeup_expected'::text as session_kind,
      null::text as register_session_kind,
      null::timestamptz as marked_at,
      false as attended,
      null::text as register_status
    from public.olli_schedule_one_time_sessions o
    join public.students s
      on s.id = o.student_id
     and s.academy_id = o.academy_id
     and s.status = 'active'
     and coalesce(s.is_deleted, false) = false
    where o.academy_id = p_academy_id
      and o.session_date between v_start and v_end
      and o.status <> 'cancelled'

    union all

    select
      o.student_id,
      o.session_date,
      0::integer as time_slot,
      'A'::text as class_group,
      'register_override'::text as session_kind,
      o.session_kind as register_session_kind,
      o.updated_at as marked_at,
      (o.status in ('present','makeup')) as attended,
      o.status as register_status
    from public.olli_schedule_attendance_register_overrides o
    where o.academy_id = p_academy_id
      and o.session_date between v_start and v_end

    union all

    select
      o.student_id,
      o.session_date,
      o.time_slot::integer,
      o.class_group,
      'register_override'::text as session_kind,
      o.session_kind as register_session_kind,
      o.updated_at as marked_at,
      (o.status in ('present','makeup')) as attended,
      o.status as register_status
    from private.olli_schedule_attendance_session_overrides o
    where o.academy_id = p_academy_id
      and o.session_date between v_start and v_end
  ) x;

  return jsonb_build_object(
    'ok', true,
    'month_start', v_start,
    'month_end', v_end,
    'attendance', v_rows
  );
end;
$function$;

comment on function public.olli_schedule_set_attendance_session_slot_status(text, uuid, uuid, date, text, integer, text, text)
is 'Sets one exact timetable attendance session status so consecutive same-day classes can be checked independently.';
