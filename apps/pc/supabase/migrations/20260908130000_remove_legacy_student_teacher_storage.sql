-- 학생별 담임 저장 미러를 제거하고 시간표 반 담임을 유일한 원본으로 사용합니다.
-- 유지되는 현재 원본:
--   public.academy_members              : 현재 승인된 선생님 계정 목록
--   public.olli_schedule_class_teachers : 요일/시간/반의 현재 담임
-- 학생정보는 위 시간표 원본을 읽기만 하며 students에는 담임을 복사 저장하지 않습니다.

-- 1) 학생 수업 요일/시간 mirror 동기화는 유지하되, 담임 mirror 동기화 호출은 제거합니다.
create or replace function private.olli_schedule_sync_student(
  p_student_id uuid,
  p_reference_date date default current_date
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_days text;
  v_times text;
begin
  select string_agg(x.day_label, ' · ' order by x.weekday)
  into v_days
  from (
    select distinct e.weekday,
      case e.weekday
        when 1 then '월' when 2 then '화' when 3 then '수'
        when 4 then '목' when 5 then '금' when 6 then '토'
      end as day_label
    from public.olli_schedule_enrollments e
    where e.student_id = p_student_id
      and e.status = 'active'
      and e.effective_from <= p_reference_date
      and (e.effective_to is null or e.effective_to >= p_reference_date)
  ) x;

  select string_agg(
    case e.weekday
      when 1 then '월' when 2 then '화' when 3 then '수'
      when 4 then '목' when 5 then '금' when 6 then '토'
    end || ' ' || e.time_slot::text || '시',
    ' · ' order by e.weekday, e.time_slot
  )
  into v_times
  from public.olli_schedule_enrollments e
  where e.student_id = p_student_id
    and e.status = 'active'
    and e.effective_from <= p_reference_date
    and (e.effective_to is null or e.effective_to >= p_reference_date);

  update public.students
  set lesson_day = coalesce(v_days, ''),
      lesson_time = coalesce(v_times, ''),
      updated_at = now()
  where id = p_student_id;
end;
$function$;

-- 2) 시간표 반 담임 변경은 class_teachers만 변경합니다.
create or replace function public.olli_schedule_set_class_teacher(
  p_session_token text,
  p_academy_id uuid,
  p_division text,
  p_weekday integer,
  p_time_slot integer,
  p_class_group text,
  p_teacher_member_id uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_division text := lower(trim(coalesce(p_division, '')));
  v_group text := upper(trim(coalesce(p_class_group, 'A')));
  v_teacher_name text;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '담임을 변경할 권한이 없습니다.');
  end if;

  if v_division not in ('elementary','kinder') or p_weekday not between 1 and 6 or p_time_slot not between 1 and 12 or v_group not in ('A','B') then
    return jsonb_build_object('ok', false, 'message', '담임을 지정할 수업 정보를 확인해 주세요.');
  end if;

  if p_teacher_member_id is null then
    delete from public.olli_schedule_class_teachers ct
    where ct.academy_id = p_academy_id
      and ct.division = v_division
      and ct.weekday = p_weekday
      and ct.time_slot = p_time_slot
      and ct.class_group = v_group;
  else
    select trim(m.display_name)
      into v_teacher_name
    from public.academy_members m
    where m.id = p_teacher_member_id
      and m.academy_id = p_academy_id
      and m.status = 'active'
      and m.role in ('owner','manager','teacher')
      and nullif(trim(coalesce(m.display_name, '')), '') is not null;

    if v_teacher_name is null then
      return jsonb_build_object('ok', false, 'message', '선택한 선생님을 찾을 수 없습니다.');
    end if;

    insert into public.olli_schedule_class_teachers (
      academy_id, division, weekday, time_slot, class_group,
      teacher_member_id, teacher_name, updated_at
    ) values (
      p_academy_id, v_division, p_weekday, p_time_slot, v_group,
      p_teacher_member_id, v_teacher_name, now()
    )
    on conflict (academy_id, division, weekday, time_slot, class_group)
    do update set teacher_member_id = excluded.teacher_member_id,
                  teacher_name = excluded.teacher_name,
                  updated_at = now();
  end if;

  return jsonb_build_object(
    'ok', true,
    'division', v_division,
    'weekday', p_weekday,
    'time_slot', p_time_slot,
    'class_group', v_group,
    'teacher_member_id', p_teacher_member_id,
    'teacher_name', coalesce(v_teacher_name, '')
  );
end;
$function$;

-- 3) 1/2회차 변경도 enrollment 순서만 변경합니다. 학생 담임 mirror는 갱신하지 않습니다.
create or replace function public.olli_schedule_set_session_order(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_enrollment_id uuid,
  p_session_order integer,
  p_effective_date date default null::date
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_date date := coalesce(p_effective_date, current_date);
  v_count integer;
  v_selected_exists boolean;
  v_orders jsonb;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '수업 회차를 변경할 권한이 없습니다.');
  end if;
  if p_session_order not in (1, 2) then
    return jsonb_build_object('ok', false, 'message', '수업 회차를 1회차 또는 2회차로 선택해 주세요.');
  end if;
  if p_student_id is null or p_enrollment_id is null then
    return jsonb_build_object('ok', false, 'message', '변경할 수업 정보를 확인해 주세요.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':session-order:' || p_student_id::text || ':' || v_date::text,
    0
  ));

  select count(*), bool_or(e.id = p_enrollment_id)
    into v_count, v_selected_exists
  from public.olli_schedule_enrollments e
  where e.academy_id = p_academy_id
    and e.student_id = p_student_id
    and e.status = 'active'
    and e.effective_from <= v_date
    and (e.effective_to is null or e.effective_to >= v_date);

  if v_count <> 2 then
    return jsonb_build_object('ok', false, 'message', '주 2회 정규수업인 학생만 회차를 변경할 수 있습니다.');
  end if;
  if not coalesce(v_selected_exists, false) then
    return jsonb_build_object('ok', false, 'message', '선택한 정규수업을 찾을 수 없습니다.');
  end if;

  update public.olli_schedule_enrollments e
     set session_order = case
       when e.id = p_enrollment_id then p_session_order::smallint
       else (3 - p_session_order)::smallint
     end,
         updated_at = now()
   where e.academy_id = p_academy_id
     and e.student_id = p_student_id
     and e.status = 'active'
     and e.effective_from <= v_date
     and (e.effective_to is null or e.effective_to >= v_date);

  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', e.id, 'session_order', e.session_order)
      order by e.session_order, e.weekday, e.time_slot, e.class_group
    ),
    '[]'::jsonb
  )
  into v_orders
  from public.olli_schedule_enrollments e
  where e.academy_id = p_academy_id
    and e.student_id = p_student_id
    and e.status = 'active'
    and e.effective_from <= v_date
    and (e.effective_to is null or e.effective_to >= v_date);

  return jsonb_build_object('ok', true, 'session_orders', v_orders);
end;
$function$;

-- 4) 학생 row에 담임을 강제로 복사하던 legacy guard 제거
drop trigger if exists olli_students_timetable_teacher_guard on public.students;
drop function if exists private.olli_students_apply_timetable_teacher();
drop function if exists private.olli_schedule_sync_student_teacher(uuid, date, boolean);

-- 5) 학생별 담임 mirror 저장 컬럼 제거
alter table public.students
  drop column if exists teacher,
  drop column if exists homeroom_teacher;
