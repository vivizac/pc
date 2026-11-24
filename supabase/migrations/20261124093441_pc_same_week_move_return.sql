-- Restore an original enrollment when a same-week applied move returns to its source.
CREATE OR REPLACE FUNCTION public.olli_schedule_change(p_session_token text, p_academy_id uuid, p_student_id uuid, p_source_enrollment_id uuid, p_target_weekday integer, p_target_time_slot integer, p_effective_date date, p_change_type text, p_allow_wait boolean, p_target_class_group text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_effective date := coalesce(p_effective_date, current_date);
  v_target_session_date date;
  v_division text;
  v_class_group text := upper(coalesce(nullif(btrim(p_target_class_group), ''), 'A'));
  v_capacity integer;
  v_occupancy integer;
  v_target_id uuid;
  v_change_id uuid;
  v_wait_id uuid;
  v_source public.olli_schedule_enrollments%rowtype;
  v_source_last_date date;
  v_target_order smallint;
  v_existing_count integer;
  v_existing_id uuid;
  v_existing_order smallint;
  v_return_week date := date_trunc('week',current_date)::date;
  v_return_cursor uuid;
  v_return_change public.olli_schedule_changes%rowtype;
  v_return_original public.olli_schedule_enrollments%rowtype;
  v_return_changes uuid[] := array[]::uuid[];
  v_return_targets uuid[] := array[]::uuid[];
  v_return_found boolean := false;
  v_return_count integer;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '시간표를 변경할 권한이 없습니다.');
  end if;
  if p_target_weekday not between 1 and 6 or p_change_type not in ('move','add') or v_effective < current_date then
    return jsonb_build_object('ok', false, 'message', '수업 변경 값을 확인해 주세요.');
  end if;
  -- Only same-week recurring moves apply now; adds/future-week moves are unchanged.
  if p_change_type = 'move'
     and v_effective < (date_trunc('week', current_date)::date + 7) then
    v_effective := current_date;
  end if;
  -- Check one-time capacity on the destination weekday, never on an unrelated day.
  v_target_session_date := private.olli_schedule_first_occurrence_on_or_after(
    v_effective, p_target_weekday
  );

  select s.division into v_division
  from public.students s
  where s.id = p_student_id and s.academy_id = p_academy_id and s.status = 'active'
    and coalesce(s.is_deleted, false) = false;
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
      and s.status = 'active'
      and coalesce(s.is_deleted, false) = false
        and e.weekday=p_target_weekday and e.time_slot=p_target_time_slot
        and (private.olli_schedule_timetable_mode(p_academy_id)='half_hour' or e.class_group=v_class_group)
        and e.status='active'
        and e.effective_from<=v_target_session_date and (e.effective_to is null or e.effective_to>=v_target_session_date)
        and (p_change_type<>'move' or e.id<>p_source_enrollment_id))
    +
    (select count(*)
       from public.olli_schedule_one_time_sessions o
       left join public.students s on s.id=o.student_id
      where o.academy_id=p_academy_id
        and coalesce(s.division, o.guest_division)=v_division
        and (o.student_id is null or (s.status = 'active' and coalesce(s.is_deleted, false) = false))
        and o.session_date=v_target_session_date and o.time_slot=p_target_time_slot
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
        and w.target_division=v_division
        and w.target_weekday=p_target_weekday
        and w.target_time_slot=p_target_time_slot
        and w.target_class_group=v_class_group
        and w.status in('waiting','offered')
    ) then
      return jsonb_build_object('ok',false,'message','이 시간에는 이미 대기 학생이 있습니다.','waitlist_full',true);
    end if;
    insert into public.olli_schedule_waitlist(
      academy_id,student_id,target_division,target_weekday,target_time_slot,target_class_group,
      request_type,source_enrollment_id,desired_effective_date
    ) values (
      p_academy_id,p_student_id,v_division,p_target_weekday,p_target_time_slot,v_class_group,
      p_change_type,case when p_change_type='move' then p_source_enrollment_id else null end,v_effective
    ) returning id into v_wait_id;
    return jsonb_build_object('ok',true,'result','waitlisted','waitlist_id',v_wait_id);
  end if;

  -- A same-week return is an undo, not another forward move. Walk only the
  -- exact enrollment lineage, never another enrollment of a twice-weekly student.
  if p_change_type='move' and v_effective=current_date then
    select * into v_source from public.olli_schedule_enrollments e
      where e.id=p_source_enrollment_id and e.academy_id=p_academy_id
        and e.student_id=p_student_id and e.status='active' for update;
    if not found then
      return jsonb_build_object('ok',false,'message','이동할 수업이 변경되었습니다. 시간표를 새로고침해 주세요.');
    end if;
    v_return_cursor := v_source.id;
    loop
      select count(*) into v_return_count from public.olli_schedule_changes c
        where c.academy_id=p_academy_id and c.student_id=p_student_id
          and c.change_type='move' and c.status='applied'
          and c.target_enrollment_id=v_return_cursor
          and c.effective_date between v_return_week and current_date;
      exit when v_return_count=0;
      if v_return_count<>1 then
        return jsonb_build_object('ok',false,'message','연결된 수업 이동 기록을 확인해 주세요.');
      end if;
      select * into v_return_change from public.olli_schedule_changes c
        where c.academy_id=p_academy_id and c.student_id=p_student_id
          and c.change_type='move' and c.status='applied'
          and c.target_enrollment_id=v_return_cursor
          and c.effective_date between v_return_week and current_date
        for update;
      if not found or v_return_change.id=any(v_return_changes) then
        return jsonb_build_object('ok',false,'message','수업 이동 기록이 변경되었습니다.');
      end if;
      select * into v_return_original from public.olli_schedule_enrollments e
        where e.id=v_return_change.source_enrollment_id and e.academy_id=p_academy_id
          and e.student_id=p_student_id for update;
      if not found then
        return jsonb_build_object('ok',false,'message','원래 수업을 확인할 수 없습니다.');
      end if;
      v_return_changes := array_append(v_return_changes,v_return_change.id);
      v_return_targets := array_append(v_return_targets,v_return_cursor);
      if v_return_original.weekday=p_target_weekday
         and v_return_original.time_slot=p_target_time_slot
         and (private.olli_schedule_timetable_mode(p_academy_id)='half_hour'
           or not private.olli_schedule_group_is_enabled(p_academy_id,v_division,p_target_weekday,p_target_time_slot,v_target_session_date)
           or coalesce(v_return_original.class_group,'A')=v_class_group) then
        v_return_found := true;
        exit;
      end if;
      v_return_cursor := v_return_original.id;
    end loop;

    if v_return_found then
      if v_source.effective_from>current_date
         or (v_source.effective_to is not null and v_source.effective_to<current_date) then
        return jsonb_build_object('ok',false,'message','이동할 수업의 적용 기간이 변경되었습니다.');
      end if;
      -- Do not undo history that already has attendance, or invalidate a
      -- later scheduled change / independently active enrollment.
      if exists(select 1 from public.olli_schedule_attendance a
          where a.academy_id=p_academy_id and a.student_id=p_student_id
            and a.session_kind='regular' and a.session_date between v_return_week and v_return_week+6)
         or exists(select 1 from public.olli_schedule_attendance_register_overrides a
          where a.academy_id=p_academy_id and a.student_id=p_student_id
            and a.session_kind='regular' and a.session_date between v_return_week and v_return_week+6) then
        return jsonb_build_object('ok',false,'message','이번 주 출석 기록이 있어 기존 수업 이동을 자동 취소할 수 없습니다.');
      end if;
      if exists(select 1 from public.olli_schedule_changes c
          where c.academy_id=p_academy_id and c.student_id=p_student_id
            and c.status in ('applied','scheduled') and not(c.id=any(v_return_changes))
            and (c.source_enrollment_id=any(v_return_targets)
              or c.source_enrollment_id=v_return_original.id
              or c.target_enrollment_id=any(v_return_targets))) then
        return jsonb_build_object('ok',false,'message','연결된 다른 이동 예약을 먼저 확인해 주세요.');
      end if;
      if v_source.effective_to is not null then
        return jsonb_build_object('ok',false,'message','이후 예약이 연결된 수업은 자동 취소할 수 없습니다.');
      end if;
      update public.olli_schedule_enrollments set status='cancelled',updated_at=now()
        where academy_id=p_academy_id and student_id=p_student_id and id=any(v_return_targets);
      update public.olli_schedule_enrollments set status='active',effective_to=v_source.effective_to,updated_at=now()
        where id=v_return_original.id and academy_id=p_academy_id and student_id=p_student_id;
      update public.olli_schedule_changes set status='cancelled',cancelled_at=now(),updated_at=now()
        where academy_id=p_academy_id and student_id=p_student_id and id=any(v_return_changes);
      perform private.olli_schedule_sync_student(p_student_id,current_date);
      return jsonb_build_object('ok',true,'result','cancelled',
        'change_id',v_return_change.id,'target_enrollment_id',v_return_original.id,
        'effective_date',v_effective);
    end if;
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
    -- A future move releases the whole target week, not only the dates
    -- after the target lesson. Same-week moves still preserve prior days.
    v_source_last_date := case
      when v_effective >= (date_trunc('week', current_date)::date + 7)
        then date_trunc('week', v_effective)::date - 1
      else v_effective - 1
    end;
    if v_source_last_date < v_source.effective_from then
      update public.olli_schedule_enrollments set status='cancelled', updated_at=now() where id=v_source.id;
    else
      update public.olli_schedule_enrollments set effective_to=v_source_last_date, updated_at=now() where id=v_source.id;
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
    'target_enrollment_id',v_target_id,
    'effective_date',v_effective
  );
end;
$function$
;
