create or replace function public.olli_schedule_update_one_time_date(
  p_session_token text,
  p_academy_id uuid,
  p_one_time_session_id uuid,
  p_session_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
  if not private.olli_schedule_group_is_enabled(p_academy_id, v_division, v_weekday, v_item.time_slot) then
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

revoke all on function public.olli_schedule_update_one_time_date(text, uuid, uuid, date) from public;
grant execute on function public.olli_schedule_update_one_time_date(text, uuid, uuid, date) to anon, authenticated;
