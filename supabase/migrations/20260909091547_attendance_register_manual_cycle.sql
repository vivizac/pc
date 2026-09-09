create table if not exists public.olli_schedule_attendance_register_overrides (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  session_date date not null,
  status text not null check (status in ('present','absent','makeup','blank')),
  updated_by_account_id uuid references public.olli_accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, student_id, session_date)
);

create index if not exists olli_schedule_attendance_register_overrides_month_idx
  on public.olli_schedule_attendance_register_overrides (academy_id, session_date, student_id);

alter table public.olli_schedule_attendance_register_overrides enable row level security;
revoke all on table public.olli_schedule_attendance_register_overrides from anon, authenticated;

create or replace function public.olli_schedule_set_attendance_register_status(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_session_date date,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_account_id uuid;
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_weekday integer;
  v_time_slot integer;
  v_class_group text;
  v_found boolean := false;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '출석부를 변경할 권한이 없습니다.');
  end if;

  if p_student_id is null or p_session_date is null or v_status not in ('present','absent','makeup','blank') then
    return jsonb_build_object('ok', false, 'message', '출석부 변경 값을 확인해 주세요.');
  end if;

  if not exists (
    select 1 from public.students s
    where s.id = p_student_id and s.academy_id = p_academy_id and s.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'message', '학생을 찾을 수 없습니다.');
  end if;

  v_account_id := public.olli_account_id_from_session(p_session_token);
  v_weekday := extract(isodow from p_session_date)::integer;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':attendance-register:' || p_student_id::text || ':' || p_session_date::text,
    0
  ));

  delete from public.olli_schedule_attendance a
  where a.academy_id = p_academy_id
    and a.student_id = p_student_id
    and a.session_date = p_session_date;

  if p_session_date <= current_date and v_status = 'present' then
    select e.time_slot, e.class_group into v_time_slot, v_class_group
    from public.olli_schedule_enrollments e
    where e.academy_id = p_academy_id
      and e.student_id = p_student_id
      and e.weekday = v_weekday
      and e.status = 'active'
      and e.effective_from <= p_session_date
      and (e.effective_to is null or e.effective_to >= p_session_date)
    order by coalesce(e.session_order, 99), e.time_slot, e.class_group
    limit 1;
    v_found := found;

    if v_found then
      perform private.olli_schedule_apply_attendance_state(
        p_academy_id, p_student_id, p_session_date, v_time_slot,
        coalesce(nullif(v_class_group,''),'A'), 'regular', true, v_account_id
      );
    end if;
  elsif p_session_date <= current_date and v_status = 'makeup' then
    select o.time_slot, o.class_group into v_time_slot, v_class_group
    from public.olli_schedule_one_time_sessions o
    where o.academy_id = p_academy_id
      and o.student_id = p_student_id
      and o.session_date = p_session_date
      and o.status <> 'cancelled'
    order by o.created_at, o.time_slot, o.id
    limit 1;
    v_found := found;

    if v_found then
      perform private.olli_schedule_apply_attendance_state(
        p_academy_id, p_student_id, p_session_date, v_time_slot,
        coalesce(nullif(v_class_group,''),'A'), 'makeup', true, v_account_id
      );
    end if;
  end if;

  insert into public.olli_schedule_attendance_register_overrides (
    academy_id, student_id, session_date, status, updated_by_account_id, updated_at
  ) values (
    p_academy_id, p_student_id, p_session_date, v_status, v_account_id, now()
  )
  on conflict (academy_id, student_id, session_date)
  do update set
    status = excluded.status,
    updated_by_account_id = excluded.updated_by_account_id,
    updated_at = now();

  return jsonb_build_object('ok', true, 'status', v_status, 'session_date', p_session_date);
end;
$function$;

grant execute on function public.olli_schedule_set_attendance_register_status(text,uuid,uuid,date,text) to anon, authenticated;

create or replace function public.olli_schedule_attendance_month(p_session_token text, p_academy_id uuid, p_month date)
returns jsonb
language plpgsql
security definer
set search_path to ''
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
    jsonb_agg(to_jsonb(x) order by x.session_date, x.student_id, x.time_slot, x.session_kind),
    '[]'::jsonb
  ) into v_rows
  from (
    select a.student_id, a.session_date, a.time_slot, a.class_group, a.session_kind,
      a.marked_at, true as attended, null::text as register_status
    from public.olli_schedule_attendance a
    where a.academy_id = p_academy_id
      and a.session_date between v_start and v_end

    union all

    select distinct e.student_id, d.session_date, e.time_slot, e.class_group,
      'regular_expected'::text as session_kind, null::timestamptz as marked_at,
      false as attended, null::text as register_status
    from public.olli_schedule_enrollments e
    join public.students s
      on s.id = e.student_id and s.academy_id = e.academy_id and s.status = 'active'
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

    select o.student_id, o.session_date, 0::integer as time_slot, 'A'::text as class_group,
      'register_override'::text as session_kind, o.updated_at as marked_at,
      (o.status in ('present','makeup')) as attended, o.status as register_status
    from public.olli_schedule_attendance_register_overrides o
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

grant execute on function public.olli_schedule_attendance_month(text,uuid,date) to anon, authenticated;
