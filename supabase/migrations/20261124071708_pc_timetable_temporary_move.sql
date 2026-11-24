-- Atomic one-week PC timetable move. Reuse the current makeup and attendance
-- RPCs; do not modify regular enrollments, attendance colors, or table schemas.
-- The reserved, versioned note identifies a makeup created by this operation.
create or replace function public.olli_schedule_temporary_move_v1(
  p_session_token text, p_academy_id uuid, p_student_id uuid,
  p_source_enrollment_id uuid, p_source_date date, p_source_time integer,
  p_source_group text, p_target_date date, p_target_time integer, p_target_group text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_source public.olli_schedule_enrollments%rowtype;
  v_existing public.olli_schedule_one_time_sessions%rowtype;
  v_division text;
  v_source_group text;
  v_target_group text := upper(coalesce(nullif(btrim(p_target_group),''),'A'));
  v_note text;
  v_absence jsonb;
  v_makeup jsonb;
  v_today date := current_date;
begin
  if not private.olli_schedule_can_access(p_session_token,p_academy_id) then
    return jsonb_build_object('ok',false,'message','시간표를 변경할 권한이 없습니다.');
  end if;
  if p_source_date is null or p_target_date is null
     or p_source_date < date_trunc('week',v_today)::date
     or p_target_date < v_today
     or date_trunc('week',p_source_date) <> date_trunc('week',p_target_date)
     or extract(isodow from p_target_date) not between 1 and 6
     or coalesce(p_target_time,0) not between 1 and 12
     or v_target_group not in ('A','B') then
    return jsonb_build_object('ok',false,'message','일시변경은 같은 주의 오늘 이후 수업으로만 할 수 있습니다.');
  end if;
  if private.olli_schedule_is_closed_day(p_academy_id,p_source_date)
     or private.olli_schedule_is_closed_day(p_academy_id,p_target_date) then
    return jsonb_build_object('ok',false,'message','휴강일에는 일시변경할 수 없습니다.');
  end if;
  select s.division into v_division from public.students s
    where s.id=p_student_id and s.academy_id=p_academy_id
      and s.status='active' and not coalesce(s.is_deleted,false);
  if v_division is null then
    return jsonb_build_object('ok',false,'message','재원생을 찾을 수 없습니다.');
  end if;
  select * into v_source from public.olli_schedule_enrollments e
    where e.id=p_source_enrollment_id and e.academy_id=p_academy_id
      and e.student_id=p_student_id and e.status='active'
      and e.weekday=extract(isodow from p_source_date)::integer
      and e.effective_from<=p_source_date
      and (e.effective_to is null or e.effective_to>=p_source_date)
    for update;
  if not found then
    return jsonb_build_object('ok',false,'message','원래 정규수업이 변경되었습니다. 새로고침해 주세요.');
  end if;
  v_source_group := upper(coalesce(nullif(btrim(v_source.class_group),''),'A'));
  if v_source.time_slot is distinct from p_source_time
     or v_source_group is distinct from p_source_group then
    return jsonb_build_object('ok',false,'message','원래 수업 시간 또는 반이 변경되었습니다.');
  end if;
  if not private.olli_schedule_slot_is_valid(p_academy_id,v_division,
       extract(isodow from p_target_date)::integer,p_target_time) then
    return jsonb_build_object('ok',false,'message','변경할 수업 시간을 확인해 주세요.');
  end if;
  if not private.olli_schedule_group_is_enabled(p_academy_id,v_division,
       extract(isodow from p_target_date)::integer,p_target_time,p_target_date) then
    v_target_group := 'A';
  end if;
  if p_source_date=p_target_date and v_source.time_slot=p_target_time
     and v_source_group=v_target_group then
    return jsonb_build_object('ok',false,'message','현재 수업과 같은 시간입니다.');
  end if;
  -- Serialize against the existing exact-slot attendance status RPC.
  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':attendance-session-v2:' || p_student_id::text || ':' ||
    p_source_date::text || ':regular:' || v_source.time_slot::text || ':' || v_source_group,0));
  if exists (select 1 from public.olli_schedule_attendance a
    where a.academy_id=p_academy_id and a.student_id=p_student_id
      and a.session_date=p_source_date and a.time_slot=v_source.time_slot
      and coalesce(nullif(a.class_group,''),'A')=v_source_group and a.session_kind='regular')
    or exists (select 1 from private.olli_schedule_attendance_session_overrides a
      where a.academy_id=p_academy_id and a.student_id=p_student_id
        and a.session_date=p_source_date and a.time_slot=v_source.time_slot
        and a.class_group=v_source_group and a.session_kind='regular' and a.status='present') then
    return jsonb_build_object('ok',false,'message','출석 처리된 정규수업은 일시변경할 수 없습니다.');
  end if;
  v_note := '일시변경 [olli:temporary-move-v1:' || p_source_enrollment_id::text || ':' ||
    to_char(p_source_date,'YYYY-MM-DD') || ']';
  select * into v_existing from public.olli_schedule_one_time_sessions o
    where o.academy_id=p_academy_id and o.student_id=p_student_id
      and o.note=v_note and o.status<>'cancelled' limit 1;
  if found then
    if v_existing.session_date=p_target_date and v_existing.time_slot=p_target_time
       and v_existing.class_group=v_target_group then
      return jsonb_build_object('ok',true,'result','scheduled',
        'one_time_session_id',v_existing.id,'unchanged',true);
    end if;
    return jsonb_build_object('ok',false,'message','이 정규수업의 일시변경이 이미 등록되어 있습니다.');
  end if;
  if exists (select 1 from public.olli_schedule_enrollments e
    where e.academy_id=p_academy_id and e.student_id=p_student_id and e.id<>v_source.id
      and e.status='active' and e.weekday=extract(isodow from p_target_date)::integer
      and e.time_slot=p_target_time and e.effective_from<=p_target_date
      and (e.effective_to is null or e.effective_to>=p_target_date)) then
    return jsonb_build_object('ok',false,'message','해당 시간에 이미 정규수업이 등록되어 있습니다.');
  end if;
  -- First apply the existing absence RPC so its freed seat counts at the
  -- destination when changing A/B groups. Any subsequent error rolls it back.
  v_absence := public.olli_schedule_set_attendance_session_status_v2(
    p_session_token,p_academy_id,p_student_id,p_source_date,'regular',
    v_source.time_slot,v_source_group,'absent');
  if not coalesce((v_absence->>'ok')::boolean,false) then
    raise exception using message=coalesce(v_absence->>'message','결석 저장에 실패했습니다.');
  end if;
  v_makeup := public.olli_schedule_execute(p_session_token,p_academy_id,'add_one_time',
    jsonb_build_object('student_id',p_student_id,'session_date',p_target_date,
      'time_slot',p_target_time,'class_group',v_target_group,'note',v_note));
  if not coalesce((v_makeup->>'ok')::boolean,false) then
    raise exception using message=coalesce(v_makeup->>'message','일시변경 등록에 실패했습니다.');
  end if;
  -- Existing makeup/trial at the destination must not be relabeled or reused.
  if coalesce((v_makeup->>'unchanged')::boolean,false) then
    raise exception '해당 시간에 이미 보강 또는 체험수업이 등록되어 있습니다.';
  end if;
  return v_makeup || jsonb_build_object('temporary_move',true,'source_date',p_source_date);
end;
$function$;

revoke all on function public.olli_schedule_temporary_move_v1(text,uuid,uuid,uuid,date,integer,text,date,integer,text) from public;
grant execute on function public.olli_schedule_temporary_move_v1(text,uuid,uuid,uuid,date,integer,text,date,integer,text) to anon, authenticated, service_role;
