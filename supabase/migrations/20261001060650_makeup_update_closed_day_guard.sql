-- Keep final one-time session changes aligned with closed-day availability rules.
-- Function definition only; no schedule rows are modified.

CREATE OR REPLACE FUNCTION public.olli_schedule_update_one_time_session(p_session_token text, p_academy_id uuid, p_one_time_session_id uuid, p_session_date date DEFAULT NULL::date, p_time_slot integer DEFAULT NULL::integer, p_class_group text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_item public.olli_schedule_one_time_sessions%rowtype;
  v_division text;
  v_target_date date;
  v_target_time integer;
  v_target_group text;
  v_capacity integer;
  v_weekday integer;
  v_group_enabled boolean;
  v_occupancy integer;
  v_account_id uuid;
  v_type_label text;
  v_identity_key text;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '보강·체험 수업을 변경할 권한이 없습니다.');
  end if;

  if p_one_time_session_id is null then
    return jsonb_build_object('ok', false, 'message', '변경할 보강·체험 수업을 확인해 주세요.');
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

  v_target_date := coalesce(p_session_date, v_item.session_date);
  v_target_time := coalesce(p_time_slot, v_item.time_slot);
  v_target_group := upper(coalesce(nullif(btrim(p_class_group), ''), nullif(btrim(v_item.class_group), ''), 'A'));
  v_type_label := case when v_item.session_type = 'trial' then '체험' else '보강' end;

  if v_target_date is null or v_target_date < current_date then
    return jsonb_build_object('ok', false, 'message', '변경할 날짜를 확인해 주세요.');
  end if;

  if private.olli_schedule_is_closed_day(p_academy_id, v_target_date) then
    return jsonb_build_object(
      'ok', false,
      'message', '공휴일에는 보강·체험 수업을 변경할 수 없습니다. 정상수업으로 전환한 뒤 다시 시도해 주세요.'
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
    return jsonb_build_object('ok', false, 'message', '출결 정보가 있는 보강은 날짜·시간·반을 변경할 수 없습니다.');
  end if;

  v_weekday := extract(isodow from v_target_date)::integer;
  if v_weekday not between 1 and 6 then
    return jsonb_build_object('ok', false, 'message', '일요일에는 보강·체험 수업을 등록할 수 없습니다.');
  end if;

  if v_item.student_id is not null then
    select s.division into v_division
    from public.students s
    where s.id = v_item.student_id
      and s.academy_id = p_academy_id
      and s.status = 'active'
      and coalesce(s.is_deleted, false) = false;
  else
    v_division := nullif(btrim(v_item.guest_division), '');
  end if;

  if v_division is null then
    return jsonb_build_object('ok', false, 'message', '수업 구분 정보를 찾을 수 없습니다.');
  end if;

  if not private.olli_schedule_slot_is_valid(
    p_academy_id,
    v_division,
    v_weekday,
    v_target_time
  ) then
    return jsonb_build_object('ok', false, 'message', '선택한 날짜와 수업 시간을 확인해 주세요.');
  end if;

  v_group_enabled := private.olli_schedule_group_is_enabled(
    p_academy_id,
    v_division,
    v_weekday,
    v_target_time,
    v_target_date
  );
  if not v_group_enabled then
    v_target_group := 'A';
  elsif v_target_group not in ('A', 'B') then
    return jsonb_build_object('ok', false, 'message', '수업 반을 A반 또는 B반으로 선택해 주세요.');
  end if;

  if v_target_date = v_item.session_date
     and v_target_time = v_item.time_slot
     and v_target_group = upper(coalesce(nullif(btrim(v_item.class_group), ''), 'A')) then
    return jsonb_build_object(
      'ok', true,
      'result', 'unchanged',
      'session_type', v_item.session_type,
      'one_time_session_id', v_item.id,
      'session_date', v_item.session_date,
      'time_slot', v_item.time_slot,
      'class_group', upper(coalesce(nullif(btrim(v_item.class_group), ''), 'A')),
      'unchanged', true
    );
  end if;

  v_identity_key := case
    when v_item.student_id is not null then 'student:' || v_item.student_id::text
    else 'guest:' || lower(btrim(v_item.guest_name))
  end;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':one-time-update:' || v_item.id::text,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':' || v_item.session_type || ':' || v_identity_key || ':' ||
    v_target_date::text || ':' || v_target_time::text || ':' || v_target_group,
    0
  ));

  if v_item.student_id is not null then
    if exists (
      select 1
      from public.olli_schedule_one_time_sessions o
      where o.academy_id = p_academy_id
        and o.student_id = v_item.student_id
        and o.session_date = v_target_date
        and o.time_slot = v_target_time
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
        and o.session_date = v_target_date
        and o.time_slot = v_target_time
        and upper(coalesce(nullif(btrim(o.class_group), ''), 'A')) = v_target_group
        and o.status <> 'cancelled'
        and o.id <> v_item.id
    ) then
      return jsonb_build_object('ok', false, 'message', '같은 날짜와 시간에 이미 등록된 체험수업이 있습니다.');
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':' || v_target_date::text || ':' || v_target_time::text || ':' || v_target_group,
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
        and e.time_slot = v_target_time
        and (not v_group_enabled or upper(coalesce(nullif(btrim(e.class_group), ''), 'A')) = v_target_group)
        and e.status = 'active'
        and e.effective_from <= v_target_date
        and (e.effective_to is null or e.effective_to >= v_target_date)
        and (
          v_item.session_type = 'trial'
          or not exists (
            select 1
            from private.olli_schedule_attendance_session_overrides a
            where a.academy_id = p_academy_id
              and a.student_id = e.student_id
              and a.session_date = v_target_date
              and a.time_slot = v_target_time
              and (not v_group_enabled or upper(coalesce(nullif(btrim(a.class_group), ''), 'A')) = v_target_group)
              and a.session_kind = 'regular'
              and a.status = 'absent'
          )
        ))
    +
    (select count(*)
       from public.olli_schedule_one_time_sessions o
       left join public.students s on s.id = o.student_id
      where o.academy_id = p_academy_id
        and coalesce(s.division, o.guest_division) = v_division
        and o.session_date = v_target_date
        and o.time_slot = v_target_time
        and (not v_group_enabled or upper(coalesce(nullif(btrim(o.class_group), ''), 'A')) = v_target_group)
        and o.status <> 'cancelled'
        and o.id <> v_item.id)
  into v_occupancy;

  if v_capacity is not null and v_occupancy >= v_capacity then
    return jsonb_build_object('ok', false, 'message', '선택한 날짜와 시간의 정원이 가득 찼습니다.', 'full', true);
  end if;

  v_account_id := public.olli_account_id_from_session(p_session_token);
  perform set_config('olli.actor_account_id', coalesce(v_account_id::text, ''), true);
  perform set_config('olli.schedule_effective_date', v_target_date::text, true);
  perform set_config(
    'olli.schedule_action',
    case when v_item.session_type = 'trial' then 'trial_session_change' else 'makeup_session_change' end,
    true
  );

  update public.olli_schedule_one_time_sessions
  set session_date = v_target_date,
      time_slot = v_target_time,
      class_group = v_target_group,
      updated_at = now()
  where id = v_item.id
    and academy_id = p_academy_id;

  return jsonb_build_object(
    'ok', true,
    'result', 'updated',
    'session_type', v_item.session_type,
    'one_time_session_id', v_item.id,
    'old_session_date', v_item.session_date,
    'old_time_slot', v_item.time_slot,
    'old_class_group', upper(coalesce(nullif(btrim(v_item.class_group), ''), 'A')),
    'session_date', v_target_date,
    'time_slot', v_target_time,
    'class_group', v_target_group,
    'unchanged', false
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'message', '같은 날짜와 시간에 이미 등록된 수업이 있습니다.');
end;
$function$

