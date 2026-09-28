-- Daily attendance marks and recurring kindergarten pickup schedules.
-- Kindergarten A/B class capacity is six students including one-time makeup sessions.

create table if not exists public.olli_schedule_attendance (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  session_date date not null,
  time_slot smallint not null check (time_slot between 1 and 7),
  class_group text not null default 'A' check (class_group in ('A', 'B')),
  session_kind text not null check (session_kind in ('regular', 'makeup')),
  marked_by_account_id uuid references public.olli_accounts(id) on delete set null,
  marked_at timestamptz not null default now(),
  unique (academy_id, student_id, session_date, time_slot, class_group, session_kind)
);

create table if not exists public.olli_schedule_pickups (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 6),
  class_time smallint not null check (class_time in (4, 5)),
  pickup_label text not null check (char_length(btrim(pickup_label)) between 1 and 80),
  pickup_time time not null,
  effective_from date not null default current_date,
  effective_to date,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  created_by_account_id uuid references public.olli_accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create index if not exists olli_schedule_attendance_week_idx
  on public.olli_schedule_attendance (academy_id, session_date, time_slot);
create index if not exists olli_schedule_pickups_week_idx
  on public.olli_schedule_pickups (academy_id, weekday, class_time, effective_from, effective_to)
  where status = 'active';
create index if not exists olli_schedule_pickups_student_idx
  on public.olli_schedule_pickups (academy_id, student_id, effective_from desc);

alter table public.olli_schedule_attendance enable row level security;
alter table public.olli_schedule_pickups enable row level security;
revoke all on table public.olli_schedule_attendance from public, anon, authenticated;
revoke all on table public.olli_schedule_pickups from public, anon, authenticated;

create or replace function private.olli_schedule_capacity(p_academy_id uuid, p_division text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(p_division, 'elementary') = 'kinder' then 6
    else coalesce(
      (select s.elementary_capacity from public.olli_schedule_settings s where s.academy_id = p_academy_id),
      5
    )
  end;
$$;

create or replace function public.olli_schedule_toggle_attendance(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_session_date date,
  p_time_slot integer,
  p_class_group text,
  p_session_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_division text;
  v_class_group text := upper(coalesce(nullif(btrim(p_class_group), ''), 'A'));
  v_mark_id uuid;
  v_marked_at timestamptz;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '출석을 변경할 권한이 없습니다.');
  end if;
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if p_session_date is null or p_session_date > current_date or p_time_slot not between 1 and 7
     or p_session_kind not in ('regular', 'makeup') then
    return jsonb_build_object('ok', false, 'message', '출석 날짜와 수업 정보를 확인해 주세요.');
  end if;
  select s.division into v_division from public.students s
  where s.id = p_student_id and s.academy_id = p_academy_id and s.status = 'active';
  if v_division is null then return jsonb_build_object('ok', false, 'message', '학생을 찾을 수 없습니다.'); end if;
  if v_division <> 'kinder' then v_class_group := 'A'; end if;
  if v_class_group not in ('A', 'B') then return jsonb_build_object('ok', false, 'message', '수업 반을 확인해 주세요.'); end if;

  if p_session_kind = 'regular' and not exists (
    select 1 from public.olli_schedule_enrollments e
    where e.academy_id = p_academy_id and e.student_id = p_student_id
      and e.weekday = extract(isodow from p_session_date)::integer
      and e.time_slot = p_time_slot and e.class_group = v_class_group and e.status = 'active'
      and e.effective_from <= p_session_date and (e.effective_to is null or e.effective_to >= p_session_date)
  ) then return jsonb_build_object('ok', false, 'message', '해당 날짜의 정규 수업을 찾을 수 없습니다.'); end if;
  if p_session_kind = 'makeup' and not exists (
    select 1 from public.olli_schedule_one_time_sessions o
    where o.academy_id = p_academy_id and o.student_id = p_student_id
      and o.session_date = p_session_date and o.time_slot = p_time_slot
      and o.class_group = v_class_group and o.status <> 'cancelled'
  ) then return jsonb_build_object('ok', false, 'message', '해당 날짜의 보강 수업을 찾을 수 없습니다.'); end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':attendance:' || p_student_id::text || ':' || p_session_date::text || ':' || p_time_slot::text || ':' || v_class_group || ':' || p_session_kind,
    0
  ));
  select a.id into v_mark_id from public.olli_schedule_attendance a
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
$$;

create or replace function public.olli_schedule_save_pickup(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_weekday integer,
  p_class_time integer,
  p_pickup_label text,
  p_pickup_time time,
  p_effective_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_effective date := coalesce(p_effective_date, current_date);
  v_id uuid;
  v_count integer;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '픽업 시간표를 변경할 권한이 없습니다.');
  end if;
  if p_weekday not between 1 and 6 or p_class_time not in (4, 5) or p_pickup_time is null
     or char_length(btrim(coalesce(p_pickup_label, ''))) not between 1 and 80 or v_effective < current_date then
    return jsonb_build_object('ok', false, 'message', '픽업 요일, 장소와 시간을 확인해 주세요.');
  end if;
  if not exists (
    select 1 from public.students s
    where s.id = p_student_id and s.academy_id = p_academy_id and s.status = 'active' and s.division = 'kinder'
  ) then return jsonb_build_object('ok', false, 'message', '유치부 학생을 찾을 수 없습니다.'); end if;
  v_account_id := public.olli_account_id_from_session(p_session_token);
  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':pickup:' || p_weekday::text || ':' || p_class_time::text,
    0
  ));
  if exists (
    select 1 from public.olli_schedule_pickups p
    where p.academy_id = p_academy_id and p.student_id = p_student_id
      and p.weekday = p_weekday and p.class_time = p_class_time and p.status = 'active'
      and p.effective_from <= v_effective and (p.effective_to is null or p.effective_to >= v_effective)
  ) then return jsonb_build_object('ok', false, 'message', '이 학생은 이미 같은 수업의 픽업 명단에 있습니다.'); end if;
  select count(*) into v_count from public.olli_schedule_pickups p
  where p.academy_id = p_academy_id and p.weekday = p_weekday and p.class_time = p_class_time
    and p.status = 'active' and p.effective_from <= v_effective
    and (p.effective_to is null or p.effective_to >= v_effective);
  if v_count >= 6 then return jsonb_build_object('ok', false, 'message', '이 픽업 시간은 최대 6명까지 등록할 수 있습니다.', 'full', true); end if;
  insert into public.olli_schedule_pickups (
    academy_id, student_id, weekday, class_time, pickup_label, pickup_time, effective_from, created_by_account_id
  ) values (
    p_academy_id, p_student_id, p_weekday, p_class_time, btrim(p_pickup_label), p_pickup_time, v_effective, v_account_id
  ) returning id into v_id;
  return jsonb_build_object('ok', true, 'result', 'saved', 'pickup_id', v_id);
end;
$$;

create or replace function public.olli_schedule_remove_pickup(
  p_session_token text,
  p_academy_id uuid,
  p_pickup_id uuid,
  p_effective_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_effective date := coalesce(p_effective_date, current_date);
  v_pickup public.olli_schedule_pickups%rowtype;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '픽업 시간표를 변경할 권한이 없습니다.');
  end if;
  if v_effective < current_date then return jsonb_build_object('ok', false, 'message', '지난 날짜부터 삭제할 수 없습니다.'); end if;
  select * into v_pickup from public.olli_schedule_pickups p
  where p.id = p_pickup_id and p.academy_id = p_academy_id and p.status = 'active' for update;
  if not found then return jsonb_build_object('ok', false, 'message', '픽업 일정을 찾을 수 없습니다.'); end if;
  if v_effective <= v_pickup.effective_from then
    update public.olli_schedule_pickups set status = 'cancelled', updated_at = now() where id = v_pickup.id;
  else
    update public.olli_schedule_pickups set effective_to = v_effective - 1, updated_at = now() where id = v_pickup.id;
  end if;
  return jsonb_build_object('ok', true, 'result', case when v_effective <= current_date then 'removed' else 'scheduled' end);
end;
$$;

create or replace function public.olli_schedule_week(
  p_session_token text,
  p_academy_id uuid,
  p_week_start date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_week_start date := coalesce(p_week_start, current_date - (extract(isodow from current_date)::integer - 1));
  v_week_end date;
  v_enrollments jsonb;
  v_waitlist jsonb;
  v_one_time jsonb;
  v_changes jsonb;
  v_attendance jsonb;
  v_pickups jsonb;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '시간표를 볼 권한이 없습니다.');
  end if;
  v_week_end := v_week_start + 5;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.weekday, x.time_slot, x.student_name), '[]'::jsonb) into v_enrollments from (
    select e.id, e.student_id, s.name as student_name, s.division,
           e.weekday, e.time_slot, e.class_group, e.effective_from, e.effective_to, e.source
    from public.olli_schedule_enrollments e join public.students s on s.id = e.student_id
    where e.academy_id = p_academy_id and e.status = 'active'
      and e.effective_from <= v_week_end and (e.effective_to is null or e.effective_to >= v_week_start)
      and s.status = 'active'
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.target_weekday, x.target_time_slot, x.requested_at), '[]'::jsonb) into v_waitlist from (
    select w.id, w.student_id, s.name as student_name, s.division,
           w.target_weekday, w.target_time_slot, w.target_class_group, w.request_type,
           w.source_enrollment_id, w.desired_effective_date, w.status, w.requested_at
    from public.olli_schedule_waitlist w join public.students s on s.id = w.student_id
    where w.academy_id = p_academy_id and w.status in ('waiting','offered')
      and (w.requested_at at time zone 'Asia/Seoul')::date <= v_week_end and s.status = 'active'
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.session_date, x.time_slot, x.student_name), '[]'::jsonb) into v_one_time from (
    select o.id, o.student_id, s.name as student_name, s.division,
           o.session_date, o.time_slot, o.class_group, o.session_type, o.status, o.note
    from public.olli_schedule_one_time_sessions o join public.students s on s.id = o.student_id
    where o.academy_id = p_academy_id and o.session_date between v_week_start and v_week_end
      and o.status <> 'cancelled' and s.status = 'active'
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.effective_date, x.student_name), '[]'::jsonb) into v_changes from (
    select c.id, c.student_id, s.name as student_name, s.division,
           c.change_type, c.source_enrollment_id, c.target_enrollment_id,
           c.target_class_group, c.effective_date, c.status, c.waitlist_id
    from public.olli_schedule_changes c join public.students s on s.id = c.student_id
    where c.academy_id = p_academy_id and c.status in ('scheduled','applied')
      and c.effective_date >= v_week_start - 35 and c.effective_date <= v_week_end + 365
  ) x;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.session_date, a.time_slot, a.student_id), '[]'::jsonb)
  into v_attendance from (
    select id, student_id, session_date, time_slot, class_group, session_kind, marked_at
    from public.olli_schedule_attendance
    where academy_id = p_academy_id and session_date between v_week_start and v_week_end
  ) a;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.weekday, x.class_time, x.pickup_time, x.student_name), '[]'::jsonb)
  into v_pickups from (
    select p.id, p.student_id, s.name as student_name, p.weekday, p.class_time,
           p.pickup_label, p.pickup_time, p.effective_from, p.effective_to
    from public.olli_schedule_pickups p join public.students s on s.id = p.student_id
    where p.academy_id = p_academy_id and p.status = 'active'
      and p.effective_from <= v_week_end and (p.effective_to is null or p.effective_to >= v_week_start)
      and s.status = 'active'
  ) x;
  return jsonb_build_object(
    'ok', true, 'week_start', v_week_start, 'week_end', v_week_end,
    'elementary_capacity', coalesce((select st.elementary_capacity from public.olli_schedule_settings st where st.academy_id = p_academy_id), 5),
    'kinder_capacity', 6,
    'waitlist_capacity', coalesce((select st.waitlist_capacity from public.olli_schedule_settings st where st.academy_id = p_academy_id), 1),
    'enrollments', v_enrollments, 'waitlist', v_waitlist, 'one_time_sessions', v_one_time,
    'changes', v_changes, 'attendance', v_attendance, 'pickups', v_pickups
  );
end;
$$;

create or replace function public.olli_schedule_change(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_source_enrollment_id uuid,
  p_target_weekday integer,
  p_target_time_slot integer,
  p_effective_date date,
  p_change_type text,
  p_allow_wait boolean,
  p_target_class_group text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_effective date := coalesce(p_effective_date, current_date);
  v_division text;
  v_target_class_group text := upper(coalesce(nullif(btrim(p_target_class_group), ''), 'A'));
  v_capacity integer;
  v_occupancy integer;
  v_target_id uuid;
  v_change_id uuid;
  v_wait_id uuid;
  v_source public.olli_schedule_enrollments%rowtype;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then return jsonb_build_object('ok', false, 'message', '시간표를 변경할 권한이 없습니다.'); end if;
  if p_target_weekday not between 1 and 6 or p_target_time_slot not between 1 and 7 then return jsonb_build_object('ok', false, 'message', '요일 또는 시간을 확인해 주세요.'); end if;
  if p_change_type not in ('move','add') then return jsonb_build_object('ok', false, 'message', '수업 변경 유형을 확인해 주세요.'); end if;
  if v_effective < current_date then return jsonb_build_object('ok', false, 'message', '지난 날짜로는 변경할 수 없습니다.'); end if;
  select s.division into v_division from public.students s
  where s.id = p_student_id and s.academy_id = p_academy_id and s.status = 'active';
  if v_division is null then return jsonb_build_object('ok', false, 'message', '학생을 찾을 수 없습니다.'); end if;
  if v_division <> 'kinder' then v_target_class_group := 'A';
  elsif v_target_class_group not in ('A', 'B') then return jsonb_build_object('ok', false, 'message', '유치부 반을 A반 또는 B반으로 선택해 주세요.'); end if;
  if p_change_type = 'move' then
    select * into v_source from public.olli_schedule_enrollments e
    where e.id = p_source_enrollment_id and e.academy_id = p_academy_id and e.student_id = p_student_id and e.status = 'active';
    if not found then return jsonb_build_object('ok', false, 'message', '이동할 기존 수업을 선택해 주세요.'); end if;
    if v_source.weekday = p_target_weekday and v_source.time_slot = p_target_time_slot and coalesce(v_source.class_group, 'A') = v_target_class_group then
      return jsonb_build_object('ok', true, 'result', 'unchanged', 'message', '현재 수업과 같은 시간입니다.');
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_academy_id::text || ':' || p_target_weekday::text || ':' || p_target_time_slot::text || ':' || v_target_class_group, 0));
  if exists (
    select 1 from public.olli_schedule_enrollments e
    where e.academy_id = p_academy_id and e.student_id = p_student_id and e.weekday = p_target_weekday
      and e.time_slot = p_target_time_slot and e.status = 'active' and e.effective_from <= v_effective
      and (e.effective_to is null or e.effective_to >= v_effective)
  ) then return jsonb_build_object('ok', false, 'message', '이미 같은 요일과 시간에 등록되어 있습니다.'); end if;
  v_capacity := private.olli_schedule_capacity(p_academy_id, v_division);
  select
    (select count(*) from public.olli_schedule_enrollments e join public.students s on s.id = e.student_id
     where e.academy_id = p_academy_id and s.division = v_division and e.weekday = p_target_weekday
       and e.time_slot = p_target_time_slot and e.class_group = v_target_class_group and e.status = 'active'
       and e.effective_from <= v_effective and (e.effective_to is null or e.effective_to >= v_effective))
    +
    (select count(*) from public.olli_schedule_one_time_sessions o join public.students s on s.id = o.student_id
     where o.academy_id = p_academy_id and s.division = v_division and o.session_date = v_effective
       and o.time_slot = p_target_time_slot and o.class_group = v_target_class_group and o.status <> 'cancelled')
  into v_occupancy;
  if v_occupancy >= v_capacity then
    if not coalesce(p_allow_wait, true) or v_division <> 'elementary' then
      return jsonb_build_object('ok', false, 'message', '선택한 시간의 정원이 가득 찼습니다.', 'full', true);
    end if;
    if exists (
      select 1 from public.olli_schedule_waitlist w where w.academy_id = p_academy_id
        and w.target_weekday = p_target_weekday and w.target_time_slot = p_target_time_slot
        and w.target_class_group = v_target_class_group and w.status in ('waiting','offered')
    ) then return jsonb_build_object('ok', false, 'message', '이 시간에는 이미 대기 학생이 있습니다.', 'waitlist_full', true); end if;
    insert into public.olli_schedule_waitlist (
      academy_id, student_id, target_weekday, target_time_slot, target_class_group,
      request_type, source_enrollment_id, desired_effective_date
    ) values (
      p_academy_id, p_student_id, p_target_weekday, p_target_time_slot, v_target_class_group,
      p_change_type, case when p_change_type = 'move' then p_source_enrollment_id else null end, v_effective
    ) returning id into v_wait_id;
    return jsonb_build_object('ok', true, 'result', 'waitlisted', 'waitlist_id', v_wait_id);
  end if;
  if p_change_type = 'move' then
    if v_effective <= v_source.effective_from then update public.olli_schedule_enrollments set status = 'cancelled', updated_at = now() where id = v_source.id;
    else update public.olli_schedule_enrollments set effective_to = v_effective - 1, updated_at = now() where id = v_source.id; end if;
  end if;
  insert into public.olli_schedule_enrollments (academy_id, student_id, weekday, time_slot, class_group, effective_from, source)
  values (p_academy_id, p_student_id, p_target_weekday, p_target_time_slot, v_target_class_group, v_effective, case when p_change_type = 'move' then 'move' else 'add' end)
  returning id into v_target_id;
  insert into public.olli_schedule_changes (
    academy_id, student_id, change_type, source_enrollment_id, target_enrollment_id, target_class_group, effective_date, status
  ) values (
    p_academy_id, p_student_id, p_change_type, case when p_change_type = 'move' then p_source_enrollment_id else null end,
    v_target_id, v_target_class_group, v_effective, case when v_effective <= current_date then 'applied' else 'scheduled' end
  ) returning id into v_change_id;
  if v_effective <= current_date then perform private.olli_schedule_sync_student(p_student_id, current_date); end if;
  return jsonb_build_object('ok', true, 'result', case when v_effective <= current_date then 'applied' else 'scheduled' end, 'change_id', v_change_id, 'target_enrollment_id', v_target_id);
end;
$$;

create or replace function public.olli_schedule_execute(
  p_session_token text,
  p_academy_id uuid,
  p_action text,
  p_params jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_result jsonb;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_params jsonb := coalesce(p_params, '{}'::jsonb);
  v_semantic_action text;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null or not exists (
    select 1 from public.academy_members m where m.academy_id = p_academy_id and m.account_id = v_account_id
      and m.status = 'active' and m.role in ('owner','manager','teacher')
  ) then return jsonb_build_object('ok', false, 'message', '시간표를 변경할 권한이 없습니다.'); end if;
  v_semantic_action := case v_action
    when 'change' then case when v_params->>'change_type' = 'move' then 'move' else 'add' end
    when 'resolve_waitlist' then case when v_params->>'action' = 'accept' then 'wait_accept' else 'wait_cancel' end
    when 'add_one_time' then 'makeup_add'
    when 'cancel_one_time' then 'makeup_cancel'
    when 'cancel_change' then 'scheduled_cancel'
    when 'remove_enrollment' then 'remove'
    when 'toggle_attendance' then 'attendance_toggle'
    when 'save_pickup' then 'pickup_add'
    when 'remove_pickup' then 'pickup_remove'
    else null
  end;
  if v_semantic_action is null then return jsonb_build_object('ok', false, 'message', '지원하지 않는 시간표 변경입니다.'); end if;
  perform set_config('olli.actor_account_id', v_account_id::text, true);
  perform set_config('olli.schedule_action', v_semantic_action, true);
  if v_action = 'change' then
    v_result := public.olli_schedule_change(
      p_session_token, p_academy_id, nullif(v_params->>'student_id', '')::uuid,
      nullif(v_params->>'source_enrollment_id', '')::uuid, (v_params->>'target_weekday')::integer,
      (v_params->>'target_time_slot')::integer, nullif(v_params->>'effective_date', '')::date,
      v_params->>'change_type', coalesce((v_params->>'allow_wait')::boolean, true), coalesce(nullif(v_params->>'target_class_group', ''), 'A')
    );
  elsif v_action = 'resolve_waitlist' then
    v_result := public.olli_schedule_resolve_waitlist(p_session_token, p_academy_id, nullif(v_params->>'waitlist_id', '')::uuid, v_params->>'action', coalesce(nullif(v_params->>'effective_date', '')::date, current_date));
  elsif v_action = 'add_one_time' then
    v_result := public.olli_schedule_add_one_time(
      p_session_token, p_academy_id, nullif(v_params->>'student_id', '')::uuid,
      nullif(v_params->>'session_date', '')::date, (v_params->>'time_slot')::integer,
      coalesce(v_params->>'note', ''), coalesce(nullif(v_params->>'class_group', ''), 'A')
    );
  elsif v_action = 'cancel_one_time' then
    v_result := public.olli_schedule_cancel_one_time(p_session_token, p_academy_id, nullif(v_params->>'one_time_session_id', '')::uuid);
  elsif v_action = 'cancel_change' then
    v_result := public.olli_schedule_cancel_change(p_session_token, p_academy_id, nullif(v_params->>'change_id', '')::uuid);
  elsif v_action = 'remove_enrollment' then
    v_result := public.olli_schedule_remove_enrollment(p_session_token, p_academy_id, nullif(v_params->>'student_id', '')::uuid, nullif(v_params->>'enrollment_id', '')::uuid, nullif(v_params->>'effective_date', '')::date);
  elsif v_action = 'toggle_attendance' then
    v_result := public.olli_schedule_toggle_attendance(
      p_session_token, p_academy_id, nullif(v_params->>'student_id', '')::uuid,
      nullif(v_params->>'session_date', '')::date, (v_params->>'time_slot')::integer,
      coalesce(nullif(v_params->>'class_group', ''), 'A'), v_params->>'session_kind'
    );
  elsif v_action = 'save_pickup' then
    v_result := public.olli_schedule_save_pickup(
      p_session_token, p_academy_id, nullif(v_params->>'student_id', '')::uuid,
      (v_params->>'weekday')::integer, (v_params->>'class_time')::integer,
      v_params->>'pickup_label', nullif(v_params->>'pickup_time', '')::time, nullif(v_params->>'effective_date', '')::date
    );
  else
    v_result := public.olli_schedule_remove_pickup(
      p_session_token, p_academy_id, nullif(v_params->>'pickup_id', '')::uuid, nullif(v_params->>'effective_date', '')::date
    );
  end if;
  return v_result;
exception when invalid_text_representation or invalid_datetime_format or numeric_value_out_of_range then
  return jsonb_build_object('ok', false, 'message', '시간표 변경 값을 확인해 주세요.');
end;
$$;

revoke all on function public.olli_schedule_toggle_attendance(text, uuid, uuid, date, integer, text, text) from public, anon, authenticated;
revoke all on function public.olli_schedule_save_pickup(text, uuid, uuid, integer, integer, text, time, date) from public, anon, authenticated;
revoke all on function public.olli_schedule_remove_pickup(text, uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.olli_schedule_change(text, uuid, uuid, uuid, integer, integer, date, text, boolean, text) from public, anon, authenticated;
revoke all on function public.olli_schedule_change(text, uuid, uuid, uuid, integer, integer, date, text, boolean) from public, anon, authenticated;
revoke all on function public.olli_schedule_add_one_time(text, uuid, uuid, date, integer, text, text) from public, anon, authenticated;
revoke all on function public.olli_schedule_add_one_time(text, uuid, uuid, date, integer, text) from public, anon, authenticated;
revoke all on function public.olli_schedule_remove_enrollment(text, uuid, uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.olli_schedule_cancel_one_time(text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.olli_schedule_cancel_change(text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.olli_schedule_resolve_waitlist(text, uuid, uuid, text, date) from public, anon, authenticated;
revoke all on function public.olli_schedule_execute(text, uuid, text, jsonb) from public;
grant execute on function public.olli_schedule_execute(text, uuid, text, jsonb) to anon, authenticated;
