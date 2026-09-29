-- Keep PC and mobile half-hour timetable slots valid at the server boundary.
create or replace function private.olli_schedule_timetable_mode(p_academy_id uuid)
returns text
language sql
stable
set search_path=''
as $$
  select coalesce((
    select case when a.kinder_timetable_mode='half_hour' then 'half_hour' else 'hourly' end
    from public.academies a
    where a.id=p_academy_id
  ), 'hourly');
$$;

create or replace function private.olli_schedule_slot_is_valid(
  p_academy_id uuid,
  p_division text,
  p_weekday integer,
  p_time_slot integer
)
returns boolean
language sql
stable
set search_path=''
as $$
  select case
    when p_weekday not between 1 and 6 then false
    when lower(coalesce(p_division,''))='elementary' and p_weekday=6
      then p_time_slot in (10,11,12)
    when lower(coalesce(p_division,''))='elementary'
      and private.olli_schedule_timetable_mode(p_academy_id)='half_hour'
      then p_time_slot in (1,2,3,4,5,6,7,8,9,10,11)
    when lower(coalesce(p_division,''))='elementary'
      then p_time_slot between 1 and 6
    when lower(coalesce(p_division,''))='kinder'
      and private.olli_schedule_timetable_mode(p_academy_id)='half_hour'
      then p_time_slot in (4,5,7,8,9)
    when lower(coalesce(p_division,''))='kinder'
      then p_time_slot in (4,5)
    else false
  end;
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
set search_path=''
as $$
  select case
    when private.olli_schedule_timetable_mode(p_academy_id)='half_hour' then false
    when coalesce(p_division,'elementary')='kinder' then true
    when p_target_date is null then false
    else private.olli_schedule_class_split_at(
      p_academy_id,p_weekday,p_time_slot,p_target_date
    )
  end;
$$;

revoke all on function private.olli_schedule_timetable_mode(uuid) from public,anon,authenticated;
revoke all on function private.olli_schedule_slot_is_valid(uuid,text,integer,integer) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.olli_schedule_change(p_session_token text, p_academy_id uuid, p_student_id uuid, p_source_enrollment_id uuid, p_target_weekday integer, p_target_time_slot integer, p_effective_date date, p_change_type text, p_allow_wait boolean, p_target_class_group text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$;
declare
  v_effective date := coalesce(p_effective_date, current_date);
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
  if p_target_weekday not between 1 and 6 or p_change_type not in ('move','add') or v_effective < current_date then
    return jsonb_build_object('ok', false, 'message', '수업 변경 값을 확인해 주세요.');
  end if;

  select s.division into v_division
  from public.students s
  where s.id = p_student_id and s.academy_id = p_academy_id and s.status = 'active';
  if v_division is null then
    return jsonb_build_object('ok', false, 'message', '학생을 찾을 수 없습니다.');
  end if;
  if not private.olli_schedule_slot_is_valid(p_academy_id, v_division, p_target_weekday, p_target_time_slot) then
    return jsonb_build_object('ok', false, 'message', '선택한 요일의 수업 시간을 확인해 주세요.');
  end if;
  if not private.olli_schedule_group_is_enabled(p_academy_id, v_division, p_target_weekday, p_target_time_slot, private.olli_schedule_first_occurrence_on_or_after(v_effective, p_target_weekday)) then
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
      and e.effective_from <= v_effective
      and (e.effective_to is null or e.effective_to >= v_effective)
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
        and (private.olli_schedule_timetable_mode(p_academy_id)='half_hour' or e.class_group=v_class_group)
        and e.status='active'
        and e.effective_from<=v_effective and (e.effective_to is null or e.effective_to>=v_effective)
        and (p_change_type<>'move' or e.id<>p_source_enrollment_id))
    +
    (select count(*)
       from public.olli_schedule_one_time_sessions o
       left join public.students s on s.id=o.student_id
      where o.academy_id=p_academy_id
        and coalesce(s.division, o.guest_division)=v_division
        and o.session_date=v_effective and o.time_slot=p_target_time_slot
        and (private.olli_schedule_timetable_mode(p_academy_id)='half_hour' or o.class_group=v_class_group)
        and o.status<>'cancelled')
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
      p_change_type,case when p_change_type='move' then p_source_enrollment_id else null end,v_effective
    ) returning id into v_wait_id;
    return jsonb_build_object('ok',true,'result','waitlisted','waitlist_id',v_wait_id);
  end if;

  if p_change_type = 'add' then
    select count(*) into v_existing_count
    from public.olli_schedule_enrollments e
    where e.academy_id = p_academy_id
      and e.student_id = p_student_id
      and e.status = 'active'
      and e.effective_from <= v_effective
      and (e.effective_to is null or e.effective_to >= v_effective);

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


CREATE OR REPLACE FUNCTION public.olli_schedule_set_student_weekly_schedule(p_session_token text, p_academy_id uuid, p_student_id uuid, p_pairs jsonb, p_effective_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$;
declare
  v_date date := coalesce(p_effective_date, current_date);
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
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '학생 시간표를 변경할 권한이 없습니다.');
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
    where not private.olli_schedule_slot_is_valid(
      p_academy_id,
      v_division,
      coalesce((x->>'weekday')::integer, 0),
      coalesce((x->>'time_slot')::integer, 0)
    )
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
      if private.olli_schedule_timetable_mode(p_academy_id) = 'half_hour' then
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
           private.olli_schedule_first_occurrence_on_or_after(v_date, (v_pair->>'weekday')::integer)
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


CREATE OR REPLACE FUNCTION public.olli_schedule_set_class_teacher(p_session_token text, p_academy_id uuid, p_division text, p_weekday integer, p_time_slot integer, p_class_group text, p_teacher_member_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$;
declare
  v_division text := lower(trim(coalesce(p_division, '')));
  v_group text := upper(trim(coalesce(p_class_group, 'A')));
  v_teacher_name text;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '담임을 변경할 권한이 없습니다.');
  end if;

  if v_division not in ('elementary','kinder')
     or v_group not in ('A','B')
     or not private.olli_schedule_slot_is_valid(p_academy_id, v_division, p_weekday, p_time_slot) then
    return jsonb_build_object('ok', false, 'message', '담임을 지정할 수업 정보를 확인해 주세요.');
  end if;
  if private.olli_schedule_timetable_mode(p_academy_id) = 'half_hour' then
    v_group := 'A';
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

