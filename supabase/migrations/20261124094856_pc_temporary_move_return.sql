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
  v_prior_absent boolean;
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
      and (o.note=v_note or o.note in (
        replace(left(v_note,-1),'temporary-move-v1:','temporary-move-v2:') || ':blank]',
        replace(left(v_note,-1),'temporary-move-v1:','temporary-move-v2:') || ':keep]'))
      and o.status<>'cancelled' limit 1;
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
  -- A pre-existing absence belongs to the user, not this temporary move.
  select exists(select 1 from private.olli_schedule_attendance_session_overrides a
    where a.academy_id=p_academy_id and a.student_id=p_student_id
      and a.session_date=p_source_date and a.time_slot=v_source.time_slot
      and a.class_group=v_source_group and a.session_kind='regular' and a.status='absent')
    into v_prior_absent;
  v_note := replace(left(v_note,-1),'temporary-move-v1:','temporary-move-v2:')
    || case when v_prior_absent then ':keep]' else ':blank]' end;
  if not v_prior_absent then
    v_absence := public.olli_schedule_set_attendance_session_status_v2(
      p_session_token,p_academy_id,p_student_id,p_source_date,'regular',
      v_source.time_slot,v_source_group,'absent');
    if not coalesce((v_absence->>'ok')::boolean,false) then
      raise exception using message=coalesce(v_absence->>'message','결석 저장에 실패했습니다.');
    end if;
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

-- Undo only the precise original session named by the persisted marker.
-- Both writes are atomic, and a separate / subsequently edited absence is kept.
create or replace function public.olli_schedule_cancel_temporary_move_v1(
  p_session_token text, p_academy_id uuid, p_one_time_session_id uuid,
  p_return_date date, p_return_time integer, p_return_group text
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_move public.olli_schedule_one_time_sessions%rowtype;
  v_source public.olli_schedule_enrollments%rowtype;
  v_override private.olli_schedule_attendance_session_overrides%rowtype;
  v_parts text[];
  v_source_id uuid;
  v_source_date date;
  v_source_group text;
  v_target_group text;
  v_clear boolean := false;
  v_status jsonb;
  v_cancel jsonb;
begin
  if not private.olli_schedule_can_access(p_session_token,p_academy_id) then
    return jsonb_build_object('ok',false,'message','일시변경을 취소할 권한이 없습니다.');
  end if;
  select * into v_move from public.olli_schedule_one_time_sessions
    where id=p_one_time_session_id and academy_id=p_academy_id and session_type='makeup';
  if not found then
    return jsonb_build_object('ok',false,'message','일시변경 수업을 찾을 수 없습니다.');
  end if;
  v_parts := regexp_match(v_move.note,
    '^일시변경 \[olli:temporary-move-v([12]):([0-9a-fA-F-]{36}):([0-9]{4}-[0-9]{2}-[0-9]{2})(:(blank|keep))?\]$');
  if v_parts is null or (v_parts[1]='1' and v_parts[5] is not null)
     or (v_parts[1]='2' and v_parts[5] is null) then
    return jsonb_build_object('ok',false,'message','일시변경으로 등록된 수업만 취소할 수 있습니다.');
  end if;
  v_source_id := v_parts[2]::uuid;
  v_source_date := v_parts[3]::date;
  if p_return_date is distinct from v_source_date
     or v_source_date < current_date
     or v_move.session_date < current_date
     or date_trunc('week',v_source_date) <> date_trunc('week',v_move.session_date) then
    return jsonb_build_object('ok',false,'message','원래 수업의 오늘 이후 날짜로 이동해 주세요.');
  end if;
  -- Same lock ordering as the creator: source enrollment then attendance.
  select * into v_source from public.olli_schedule_enrollments
    where id=v_source_id and academy_id=p_academy_id and student_id=v_move.student_id
      and status='active' and weekday=extract(isodow from v_source_date)::integer
      and effective_from<=v_source_date and (effective_to is null or effective_to>=v_source_date)
    for update;
  if not found then
    return jsonb_build_object('ok',false,'message','원래 정규수업이 변경되었습니다. 새로고침해 주세요.');
  end if;
  v_source_group := upper(coalesce(nullif(btrim(v_source.class_group),''),'A'));
  if v_source.time_slot is distinct from p_return_time or v_source_group is distinct from p_return_group then
    return jsonb_build_object('ok',false,'message','원래 수업 시간과 반으로 이동해 주세요.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':attendance-session-v2:' || v_move.student_id::text || ':' ||
    v_source_date::text || ':regular:' || v_source.time_slot::text || ':' || v_source_group,0));
  v_target_group := upper(coalesce(nullif(btrim(v_move.class_group),''),'A'));
  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':attendance-session-v2:' || v_move.student_id::text || ':' ||
    v_move.session_date::text || ':makeup:' || v_move.time_slot::text || ':' || v_target_group,0));
  -- Revalidate after the locks; never cancel a stale/moved card.
  perform 1 from public.olli_schedule_one_time_sessions o
    where o.id=v_move.id and o.academy_id=p_academy_id and o.student_id=v_move.student_id
      and o.note=v_move.note and o.session_date=v_move.session_date
      and o.time_slot=v_move.time_slot and o.class_group is not distinct from v_move.class_group
      and o.status=v_move.status for update;
  if not found then
    return jsonb_build_object('ok',false,'message','일시변경 일정이 변경되었습니다. 새로고침해 주세요.');
  end if;
  if v_move.status='cancelled' then
    return jsonb_build_object('ok',true,'result','cancelled','unchanged',true);
  end if;
  if v_move.status<>'scheduled'
     or exists(select 1 from public.olli_schedule_attendance a
        where a.academy_id=p_academy_id and a.student_id=v_move.student_id
          and a.session_date=v_move.session_date and a.time_slot=v_move.time_slot
          and coalesce(nullif(a.class_group,''),'A')=v_target_group and a.session_kind='makeup')
     or exists(select 1 from private.olli_schedule_attendance_session_overrides a
        where a.academy_id=p_academy_id and a.student_id=v_move.student_id
          and a.session_date=v_move.session_date and a.time_slot=v_move.time_slot
          and a.class_group=v_target_group and a.session_kind='makeup' and a.status='makeup') then
    return jsonb_build_object('ok',false,'message','이미 출석 처리된 일시변경은 자동 취소할 수 없습니다.');
  end if;
  select * into v_override from private.olli_schedule_attendance_session_overrides a
    where a.academy_id=p_academy_id and a.student_id=v_move.student_id
      and a.session_date=v_source_date and a.time_slot=v_source.time_slot
      and a.class_group=v_source_group and a.session_kind='regular'
    for update;
  if found then
    -- v1: clear only a provably new override written in the creation transaction.
    -- v2: explicit provenance also covers an existing blank override.
    v_clear := v_override.status='absent' and v_override.updated_at=v_move.created_at
      and ((v_parts[1]='1' and v_override.created_at=v_override.updated_at)
        or (v_parts[1]='2' and v_parts[5]='blank'));
  end if;
  if v_clear and exists(select 1 from public.olli_schedule_attendance a
       where a.academy_id=p_academy_id and a.student_id=v_move.student_id
         and a.session_date=v_source_date and a.time_slot=v_source.time_slot
         and coalesce(nullif(a.class_group,''),'A')=v_source_group and a.session_kind='regular') then
    v_clear := false;
  end if;
  v_cancel := public.olli_schedule_execute(p_session_token,p_academy_id,'cancel_one_time',
    jsonb_build_object('one_time_session_id',v_move.id));
  if not coalesce((v_cancel->>'ok')::boolean,false) then
    raise exception using message=coalesce(v_cancel->>'message','일시변경 취소에 실패했습니다.');
  end if;
  if v_clear then
    v_status := public.olli_schedule_set_attendance_session_status_v2(
      p_session_token,p_academy_id,v_move.student_id,v_source_date,'regular',
      v_source.time_slot,v_source_group,'blank');
    if not coalesce((v_status->>'ok')::boolean,false) then
      raise exception using message=coalesce(v_status->>'message','원래 수업 복원에 실패했습니다.');
    end if;
  end if;
  return jsonb_build_object('ok',true,'result','cancelled','source_date',v_source_date,
    'target_date',v_move.session_date,'absence_cleared',v_clear,
    'absence_preserved',not v_clear and coalesce(v_override.status='absent',false));
end;
$function$;
revoke all on function public.olli_schedule_cancel_temporary_move_v1(text,uuid,uuid,date,integer,text) from public;
grant execute on function public.olli_schedule_cancel_temporary_move_v1(text,uuid,uuid,date,integer,text) to anon,authenticated,service_role;
