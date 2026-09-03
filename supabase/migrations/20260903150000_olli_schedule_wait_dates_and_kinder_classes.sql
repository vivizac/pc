-- Waitlist rows must not appear before the date they were requested.
-- Kindergarten runs two selectable groups (A/B) in each time slot.

alter table public.olli_schedule_enrollments
  add column if not exists class_group text not null default 'A';
alter table public.olli_schedule_waitlist
  add column if not exists target_class_group text not null default 'A';
alter table public.olli_schedule_one_time_sessions
  add column if not exists class_group text not null default 'A';
alter table public.olli_schedule_changes
  add column if not exists target_class_group text not null default 'A';

alter table public.olli_schedule_enrollments
  drop constraint if exists olli_schedule_enrollments_class_group_check;
alter table public.olli_schedule_enrollments
  add constraint olli_schedule_enrollments_class_group_check check (class_group in ('A', 'B')) not valid;
alter table public.olli_schedule_enrollments
  validate constraint olli_schedule_enrollments_class_group_check;

alter table public.olli_schedule_waitlist
  drop constraint if exists olli_schedule_waitlist_target_class_group_check;
alter table public.olli_schedule_waitlist
  add constraint olli_schedule_waitlist_target_class_group_check check (target_class_group in ('A', 'B')) not valid;
alter table public.olli_schedule_waitlist
  validate constraint olli_schedule_waitlist_target_class_group_check;

alter table public.olli_schedule_one_time_sessions
  drop constraint if exists olli_schedule_one_time_sessions_class_group_check;
alter table public.olli_schedule_one_time_sessions
  add constraint olli_schedule_one_time_sessions_class_group_check check (class_group in ('A', 'B')) not valid;
alter table public.olli_schedule_one_time_sessions
  validate constraint olli_schedule_one_time_sessions_class_group_check;

alter table public.olli_schedule_changes
  drop constraint if exists olli_schedule_changes_target_class_group_check;
alter table public.olli_schedule_changes
  add constraint olli_schedule_changes_target_class_group_check check (target_class_group in ('A', 'B')) not valid;
alter table public.olli_schedule_changes
  validate constraint olli_schedule_changes_target_class_group_check;

create index if not exists olli_schedule_waitlist_week_visibility_idx
  on public.olli_schedule_waitlist (academy_id, status, requested_at);

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
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '시간표를 볼 권한이 없습니다.');
  end if;
  v_week_end := v_week_start + 5;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.weekday, x.time_slot, x.student_name), '[]'::jsonb)
  into v_enrollments
  from (
    select e.id, e.student_id, s.name as student_name, s.division,
           e.weekday, e.time_slot, e.class_group, e.effective_from, e.effective_to, e.source
    from public.olli_schedule_enrollments e
    join public.students s on s.id = e.student_id
    where e.academy_id = p_academy_id
      and e.status = 'active'
      and e.effective_from <= v_week_end
      and (e.effective_to is null or e.effective_to >= v_week_start)
      and s.status = 'active'
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.target_weekday, x.target_time_slot, x.requested_at), '[]'::jsonb)
  into v_waitlist
  from (
    select w.id, w.student_id, s.name as student_name, s.division,
           w.target_weekday, w.target_time_slot, w.target_class_group, w.request_type,
           w.source_enrollment_id, w.desired_effective_date, w.status, w.requested_at
    from public.olli_schedule_waitlist w
    join public.students s on s.id = w.student_id
    where w.academy_id = p_academy_id
      and w.status in ('waiting','offered')
      and (w.requested_at at time zone 'Asia/Seoul')::date <= v_week_end
      and s.status = 'active'
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.session_date, x.time_slot, x.student_name), '[]'::jsonb)
  into v_one_time
  from (
    select o.id, o.student_id, s.name as student_name, s.division,
           o.session_date, o.time_slot, o.class_group, o.session_type, o.status, o.note
    from public.olli_schedule_one_time_sessions o
    join public.students s on s.id = o.student_id
    where o.academy_id = p_academy_id
      and o.session_date between v_week_start and v_week_end
      and o.status <> 'cancelled'
      and s.status = 'active'
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.effective_date, x.student_name), '[]'::jsonb)
  into v_changes
  from (
    select c.id, c.student_id, s.name as student_name, s.division,
           c.change_type, c.source_enrollment_id, c.target_enrollment_id,
           c.target_class_group, c.effective_date, c.status, c.waitlist_id
    from public.olli_schedule_changes c
    join public.students s on s.id = c.student_id
    where c.academy_id = p_academy_id
      and c.status in ('scheduled','applied')
      and c.effective_date >= v_week_start - 35
      and c.effective_date <= v_week_end + 365
  ) x;

  return jsonb_build_object(
    'ok', true,
    'week_start', v_week_start,
    'week_end', v_week_end,
    'elementary_capacity', coalesce((select st.elementary_capacity from public.olli_schedule_settings st where st.academy_id = p_academy_id), 5),
    'waitlist_capacity', coalesce((select st.waitlist_capacity from public.olli_schedule_settings st where st.academy_id = p_academy_id), 1),
    'enrollments', v_enrollments,
    'waitlist', v_waitlist,
    'one_time_sessions', v_one_time,
    'changes', v_changes
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
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '시간표를 변경할 권한이 없습니다.');
  end if;
  if p_target_weekday not between 1 and 6 or p_target_time_slot not between 1 and 7 then
    return jsonb_build_object('ok', false, 'message', '요일 또는 시간을 확인해 주세요.');
  end if;
  if p_change_type not in ('move','add') then
    return jsonb_build_object('ok', false, 'message', '수업 변경 유형을 확인해 주세요.');
  end if;
  if v_effective < current_date then
    return jsonb_build_object('ok', false, 'message', '지난 날짜로는 변경할 수 없습니다.');
  end if;

  select s.division into v_division from public.students s
  where s.id = p_student_id and s.academy_id = p_academy_id and s.status = 'active';
  if v_division is null then
    return jsonb_build_object('ok', false, 'message', '학생을 찾을 수 없습니다.');
  end if;
  if v_division <> 'kinder' then
    v_target_class_group := 'A';
  elsif v_target_class_group not in ('A', 'B') then
    return jsonb_build_object('ok', false, 'message', '유치부 반을 A반 또는 B반으로 선택해 주세요.');
  end if;

  if p_change_type = 'move' then
    select * into v_source from public.olli_schedule_enrollments e
    where e.id = p_source_enrollment_id and e.academy_id = p_academy_id
      and e.student_id = p_student_id and e.status = 'active';
    if not found then
      return jsonb_build_object('ok', false, 'message', '이동할 기존 수업을 선택해 주세요.');
    end if;
    if v_source.weekday = p_target_weekday and v_source.time_slot = p_target_time_slot
       and coalesce(v_source.class_group, 'A') = v_target_class_group then
      return jsonb_build_object('ok', true, 'result', 'unchanged', 'message', '현재 수업과 같은 시간입니다.');
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':' || p_target_weekday::text || ':' || p_target_time_slot::text || ':' || v_target_class_group,
    0
  ));
  if exists (
    select 1 from public.olli_schedule_enrollments e
    where e.academy_id = p_academy_id and e.student_id = p_student_id
      and e.weekday = p_target_weekday and e.time_slot = p_target_time_slot
      and e.status = 'active' and e.effective_from <= v_effective
      and (e.effective_to is null or e.effective_to >= v_effective)
  ) then
    return jsonb_build_object('ok', false, 'message', '이미 같은 요일과 시간에 등록되어 있습니다.');
  end if;

  v_capacity := private.olli_schedule_capacity(p_academy_id, v_division);
  select count(*) into v_occupancy from public.olli_schedule_enrollments e
  join public.students s on s.id = e.student_id
  where e.academy_id = p_academy_id and s.division = v_division
    and e.weekday = p_target_weekday and e.time_slot = p_target_time_slot
    and e.class_group = v_target_class_group and e.status = 'active'
    and e.effective_from <= v_effective and (e.effective_to is null or e.effective_to >= v_effective);

  if v_occupancy >= v_capacity then
    if not coalesce(p_allow_wait, true) or v_division <> 'elementary' then
      return jsonb_build_object('ok', false, 'message', '선택한 시간의 정원이 가득 찼습니다.', 'full', true);
    end if;
    if exists (
      select 1 from public.olli_schedule_waitlist w
      where w.academy_id = p_academy_id and w.target_weekday = p_target_weekday
        and w.target_time_slot = p_target_time_slot and w.target_class_group = v_target_class_group
        and w.status in ('waiting','offered')
    ) then
      return jsonb_build_object('ok', false, 'message', '이 시간에는 이미 대기 학생이 있습니다.', 'waitlist_full', true);
    end if;
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
    if v_effective <= v_source.effective_from then
      update public.olli_schedule_enrollments set status = 'cancelled', updated_at = now() where id = v_source.id;
    else
      update public.olli_schedule_enrollments set effective_to = v_effective - 1, updated_at = now() where id = v_source.id;
    end if;
  end if;

  insert into public.olli_schedule_enrollments (
    academy_id, student_id, weekday, time_slot, class_group, effective_from, source
  ) values (
    p_academy_id, p_student_id, p_target_weekday, p_target_time_slot, v_target_class_group, v_effective,
    case when p_change_type = 'move' then 'move' else 'add' end
  ) returning id into v_target_id;
  insert into public.olli_schedule_changes (
    academy_id, student_id, change_type, source_enrollment_id,
    target_enrollment_id, target_class_group, effective_date, status
  ) values (
    p_academy_id, p_student_id, p_change_type,
    case when p_change_type = 'move' then p_source_enrollment_id else null end,
    v_target_id, v_target_class_group, v_effective,
    case when v_effective <= current_date then 'applied' else 'scheduled' end
  ) returning id into v_change_id;
  if v_effective <= current_date then
    perform private.olli_schedule_sync_student(p_student_id, current_date);
  end if;
  return jsonb_build_object('ok', true, 'result', case when v_effective <= current_date then 'applied' else 'scheduled' end, 'change_id', v_change_id, 'target_enrollment_id', v_target_id);
end;
$$;

create or replace function public.olli_schedule_resolve_waitlist(
  p_session_token text,
  p_academy_id uuid,
  p_waitlist_id uuid,
  p_action text,
  p_effective_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wait public.olli_schedule_waitlist%rowtype;
  v_source public.olli_schedule_enrollments%rowtype;
  v_division text;
  v_class_group text;
  v_capacity integer;
  v_occupancy integer;
  v_effective date := coalesce(p_effective_date, current_date);
  v_target_id uuid;
  v_change_id uuid;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '대기 명단을 변경할 권한이 없습니다.');
  end if;
  select * into v_wait from public.olli_schedule_waitlist w
  where w.id = p_waitlist_id and w.academy_id = p_academy_id and w.status in ('waiting','offered') for update;
  if not found then return jsonb_build_object('ok', false, 'message', '대기 정보를 찾을 수 없습니다.'); end if;
  if p_action = 'cancel' then
    update public.olli_schedule_waitlist set status = 'cancelled', resolved_at = now(), updated_at = now() where id = v_wait.id;
    return jsonb_build_object('ok', true, 'result', 'cancelled');
  end if;
  if p_action <> 'accept' then return jsonb_build_object('ok', false, 'message', '대기 처리 방법을 확인해 주세요.'); end if;
  if v_effective < current_date then return jsonb_build_object('ok', false, 'message', '지난 날짜로는 입장시킬 수 없습니다.'); end if;

  select s.division into v_division from public.students s
  where s.id = v_wait.student_id and s.academy_id = p_academy_id and s.status = 'active';
  if v_division is null then return jsonb_build_object('ok', false, 'message', '학생을 찾을 수 없습니다.'); end if;
  v_class_group := case when v_division = 'kinder' then coalesce(v_wait.target_class_group, 'A') else 'A' end;
  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':' || v_wait.target_weekday::text || ':' || v_wait.target_time_slot::text || ':' || v_class_group,
    0
  ));
  v_capacity := private.olli_schedule_capacity(p_academy_id, v_division);
  select count(*) into v_occupancy from public.olli_schedule_enrollments e
  join public.students s on s.id = e.student_id
  where e.academy_id = p_academy_id and s.division = v_division
    and e.weekday = v_wait.target_weekday and e.time_slot = v_wait.target_time_slot
    and e.class_group = v_class_group and e.status = 'active'
    and e.effective_from <= v_effective and (e.effective_to is null or e.effective_to >= v_effective);
  if v_occupancy >= v_capacity then return jsonb_build_object('ok', false, 'message', '아직 입장 가능한 자리가 없습니다.', 'full', true); end if;

  if v_wait.request_type = 'move' then
    select * into v_source from public.olli_schedule_enrollments e
    where e.id = v_wait.source_enrollment_id and e.academy_id = p_academy_id and e.student_id = v_wait.student_id and e.status = 'active';
    if not found then return jsonb_build_object('ok', false, 'message', '기존 수업 정보를 찾을 수 없습니다.'); end if;
    if v_effective <= v_source.effective_from then
      update public.olli_schedule_enrollments set status = 'cancelled', updated_at = now() where id = v_source.id;
    else
      update public.olli_schedule_enrollments set effective_to = v_effective - 1, updated_at = now() where id = v_source.id;
    end if;
  end if;
  insert into public.olli_schedule_enrollments (academy_id, student_id, weekday, time_slot, class_group, effective_from, source)
  values (p_academy_id, v_wait.student_id, v_wait.target_weekday, v_wait.target_time_slot, v_class_group, v_effective, 'waitlist')
  returning id into v_target_id;
  insert into public.olli_schedule_changes (
    academy_id, student_id, change_type, source_enrollment_id, target_enrollment_id,
    target_class_group, effective_date, status, waitlist_id
  ) values (
    p_academy_id, v_wait.student_id, v_wait.request_type,
    case when v_wait.request_type = 'move' then v_wait.source_enrollment_id else null end,
    v_target_id, v_class_group, v_effective,
    case when v_effective <= current_date then 'applied' else 'scheduled' end, v_wait.id
  ) returning id into v_change_id;
  update public.olli_schedule_waitlist set status = 'accepted', resolved_at = now(), updated_at = now() where id = v_wait.id;
  if v_effective <= current_date then perform private.olli_schedule_sync_student(v_wait.student_id, current_date); end if;
  return jsonb_build_object('ok', true, 'result', 'accepted', 'change_id', v_change_id);
end;
$$;

create or replace function public.olli_schedule_add_one_time(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_session_date date,
  p_time_slot integer,
  p_note text,
  p_class_group text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_division text;
  v_class_group text := upper(coalesce(nullif(btrim(p_class_group), ''), 'A'));
  v_capacity integer;
  v_weekday integer;
  v_occupancy integer;
  v_id uuid;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then return jsonb_build_object('ok', false, 'message', '보강을 등록할 권한이 없습니다.'); end if;
  if p_session_date is null or p_session_date < current_date or p_time_slot not between 1 and 7 then return jsonb_build_object('ok', false, 'message', '보강 날짜와 시간을 확인해 주세요.'); end if;
  v_weekday := extract(isodow from p_session_date)::integer;
  if v_weekday not between 1 and 6 then return jsonb_build_object('ok', false, 'message', '일요일에는 보강을 등록할 수 없습니다.'); end if;
  select s.division into v_division from public.students s where s.id = p_student_id and s.academy_id = p_academy_id and s.status = 'active';
  if v_division is null then return jsonb_build_object('ok', false, 'message', '학생을 찾을 수 없습니다.'); end if;
  if v_division <> 'kinder' then
    v_class_group := 'A';
  elsif v_class_group not in ('A', 'B') then
    return jsonb_build_object('ok', false, 'message', '유치부 반을 A반 또는 B반으로 선택해 주세요.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_academy_id::text || ':' || p_session_date::text || ':' || p_time_slot::text || ':' || v_class_group, 0));
  v_capacity := private.olli_schedule_capacity(p_academy_id, v_division);
  select
    (select count(*) from public.olli_schedule_enrollments e join public.students s on s.id = e.student_id
     where e.academy_id = p_academy_id and s.division = v_division and e.weekday = v_weekday and e.time_slot = p_time_slot
       and e.class_group = v_class_group and e.status = 'active' and e.effective_from <= p_session_date and (e.effective_to is null or e.effective_to >= p_session_date))
    +
    (select count(*) from public.olli_schedule_one_time_sessions o join public.students s on s.id = o.student_id
     where o.academy_id = p_academy_id and s.division = v_division and o.session_date = p_session_date and o.time_slot = p_time_slot
       and o.class_group = v_class_group and o.status <> 'cancelled') into v_occupancy;
  if v_occupancy >= v_capacity then return jsonb_build_object('ok', false, 'message', '선택한 날짜와 시간의 정원이 가득 찼습니다.', 'full', true); end if;
  if exists (select 1 from public.olli_schedule_one_time_sessions o where o.academy_id = p_academy_id and o.student_id = p_student_id and o.session_date = p_session_date and o.time_slot = p_time_slot and o.status <> 'cancelled') then
    return jsonb_build_object('ok', false, 'message', '이미 같은 날짜와 시간에 보강이 등록되어 있습니다.');
  end if;
  insert into public.olli_schedule_one_time_sessions (academy_id, student_id, session_date, time_slot, class_group, note)
  values (p_academy_id, p_student_id, p_session_date, p_time_slot, v_class_group, left(coalesce(p_note, ''), 500)) returning id into v_id;
  return jsonb_build_object('ok', true, 'result', 'scheduled', 'one_time_session_id', v_id);
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
    select 1 from public.academy_members m
    where m.academy_id = p_academy_id and m.account_id = v_account_id
      and m.status = 'active' and m.role in ('owner','manager','teacher')
  ) then return jsonb_build_object('ok', false, 'message', '시간표를 변경할 권한이 없습니다.'); end if;
  v_semantic_action := case v_action
    when 'change' then case when v_params->>'change_type' = 'move' then 'move' else 'add' end
    when 'resolve_waitlist' then case when v_params->>'action' = 'accept' then 'wait_accept' else 'wait_cancel' end
    when 'add_one_time' then 'makeup_add'
    when 'cancel_one_time' then 'makeup_cancel'
    when 'cancel_change' then 'scheduled_cancel'
    when 'remove_enrollment' then 'remove'
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
      v_params->>'change_type', coalesce((v_params->>'allow_wait')::boolean, true),
      coalesce(nullif(v_params->>'target_class_group', ''), 'A')
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
  else
    v_result := public.olli_schedule_remove_enrollment(p_session_token, p_academy_id, nullif(v_params->>'student_id', '')::uuid, nullif(v_params->>'enrollment_id', '')::uuid, nullif(v_params->>'effective_date', '')::date);
  end if;
  return v_result;
exception when invalid_text_representation or numeric_value_out_of_range then
  return jsonb_build_object('ok', false, 'message', '시간표 변경 값을 확인해 주세요.');
end;
$$;
