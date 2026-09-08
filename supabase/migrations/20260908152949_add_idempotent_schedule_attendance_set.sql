-- 다중 기기에서 출석 토글이 서로 뒤집히지 않도록 원하는 최종 상태를 명시하는 서버 쓰기 경로를 추가한다.
create or replace function public.olli_schedule_set_attendance(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_session_date date,
  p_time_slot integer,
  p_class_group text default 'A',
  p_session_kind text default 'regular',
  p_attended boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_division text;
  v_weekday integer;
  v_class_group text := upper(coalesce(nullif(btrim(p_class_group), ''), 'A'));
  v_mark_id uuid;
  v_marked_at timestamptz;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '출석을 변경할 권한이 없습니다.');
  end if;
  if p_attended is null or p_session_date is null or p_session_date > current_date or p_session_kind not in ('regular', 'makeup') then
    return jsonb_build_object('ok', false, 'message', '출석 날짜와 수업 정보를 확인해 주세요.');
  end if;
  v_account_id := public.olli_account_id_from_session(p_session_token);
  v_weekday := extract(isodow from p_session_date)::integer;
  select s.division into v_division
  from public.students s
  where s.id = p_student_id and s.academy_id = p_academy_id and s.status = 'active';
  if v_division is null then
    return jsonb_build_object('ok', false, 'message', '학생을 찾을 수 없습니다.');
  end if;
  if (v_division = 'elementary' and v_weekday = 6 and p_time_slot not in (10,11,12))
     or (v_division = 'elementary' and v_weekday <> 6 and p_time_slot not between 1 and 6)
     or (v_division = 'kinder' and p_time_slot not in (4,5)) then
    return jsonb_build_object('ok', false, 'message', '출석 날짜와 수업 시간을 확인해 주세요.');
  end if;
  if not private.olli_schedule_group_is_enabled(p_academy_id, v_division, v_weekday, p_time_slot) then
    v_class_group := 'A';
  end if;
  if v_class_group not in ('A','B') then
    return jsonb_build_object('ok', false, 'message', '수업 반을 확인해 주세요.');
  end if;
  if p_session_kind = 'regular' and not exists (
    select 1 from public.olli_schedule_enrollments e
    where e.academy_id=p_academy_id and e.student_id=p_student_id
      and e.weekday=v_weekday and e.time_slot=p_time_slot and e.class_group=v_class_group
      and e.status='active' and e.effective_from<=p_session_date
      and (e.effective_to is null or e.effective_to>=p_session_date)
  ) then
    return jsonb_build_object('ok', false, 'message', '해당 날짜의 정규 수업을 찾을 수 없습니다.');
  end if;
  if p_session_kind = 'makeup' and not exists (
    select 1 from public.olli_schedule_one_time_sessions o
    where o.academy_id=p_academy_id and o.student_id=p_student_id
      and o.session_date=p_session_date and o.time_slot=p_time_slot
      and o.class_group=v_class_group and o.status<>'cancelled'
  ) then
    return jsonb_build_object('ok', false, 'message', '해당 날짜의 보강 수업을 찾을 수 없습니다.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':attendance:' || p_student_id::text || ':' || p_session_date::text || ':' || p_time_slot::text || ':' || v_class_group || ':' || p_session_kind,
    0
  ));
  select a.id, a.marked_at into v_mark_id, v_marked_at
  from public.olli_schedule_attendance a
  where a.academy_id=p_academy_id and a.student_id=p_student_id
    and a.session_date=p_session_date and a.time_slot=p_time_slot
    and a.class_group=v_class_group and a.session_kind=p_session_kind
  for update;
  if p_attended then
    if v_mark_id is not null then
      return jsonb_build_object('ok',true,'attended',true,'unchanged',true,'marked_at',v_marked_at);
    end if;
    insert into public.olli_schedule_attendance(
      academy_id,student_id,session_date,time_slot,class_group,session_kind,marked_by_account_id
    ) values (
      p_academy_id,p_student_id,p_session_date,p_time_slot,v_class_group,p_session_kind,v_account_id
    ) returning marked_at into v_marked_at;
    return jsonb_build_object('ok',true,'attended',true,'unchanged',false,'marked_at',v_marked_at);
  end if;
  if v_mark_id is null then
    return jsonb_build_object('ok',true,'attended',false,'unchanged',true);
  end if;
  delete from public.olli_schedule_attendance where id=v_mark_id;
  return jsonb_build_object('ok',true,'attended',false,'unchanged',false);
end;
$$;
revoke all on function public.olli_schedule_set_attendance(text,uuid,uuid,date,integer,text,text,boolean) from public, anon, authenticated;
grant execute on function public.olli_schedule_set_attendance(text,uuid,uuid,date,integer,text,text,boolean) to service_role;

-- 기존 단일 execute RPC에 set_attendance action을 추가한다. toggle_attendance는 구버전 호환용으로 유지한다.
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
  v_action text := lower(btrim(coalesce(p_action,'')));
  v_params jsonb := coalesce(p_params,'{}'::jsonb);
  v_semantic_action text;
  v_action_date date;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null or not exists (
    select 1 from public.academy_members m
    where m.academy_id=p_academy_id and m.account_id=v_account_id
      and m.status='active' and m.role in('owner','manager','teacher')
  ) then
    return jsonb_build_object('ok',false,'message','시간표를 변경할 권한이 없습니다.');
  end if;

  v_semantic_action := case v_action
    when 'change' then case when v_params->>'change_type'='move' then'move'else'add'end
    when 'add_waitlist' then 'wait_add'
    when 'resolve_waitlist' then case when v_params->>'action'='accept' then'wait_accept'else'wait_cancel'end
    when 'add_one_time' then 'makeup_add'
    when 'cancel_one_time' then 'makeup_cancel'
    when 'cancel_change' then 'scheduled_cancel'
    when 'remove_enrollment' then 'remove'
    when 'toggle_attendance' then 'attendance_toggle'
    when 'set_attendance' then 'attendance_set'
    when 'save_pickup' then 'pickup_add'
    when 'update_pickup' then case when v_params->>'mode'='schedule' then 'pickup_schedule' else 'pickup_edit' end
    when 'remove_pickup' then 'pickup_remove'
    when 'split_class' then 'class_split'
    when 'merge_class' then 'class_merge'
    when 'set_session_order' then 'session_order'
    when 'save_cell_memo' then 'memo_save'
    else null
  end;
  if v_semantic_action is null then
    return jsonb_build_object('ok',false,'message','지원하지 않는 시간표 변경입니다.');
  end if;

  v_action_date := case v_action
    when 'save_cell_memo' then nullif(v_params->>'session_date','')::date
    when 'add_one_time' then nullif(v_params->>'session_date','')::date
    when 'toggle_attendance' then nullif(v_params->>'session_date','')::date
    when 'set_attendance' then nullif(v_params->>'session_date','')::date
    when 'save_pickup' then nullif(v_params->>'effective_date','')::date
    when 'change' then nullif(v_params->>'effective_date','')::date
    when 'add_waitlist' then nullif(v_params->>'effective_date','')::date
    else null
  end;
  if v_action_date is not null
     and v_action in ('save_cell_memo','add_one_time','toggle_attendance','set_attendance','save_pickup','change','add_waitlist')
     and private.olli_schedule_is_closed_day(p_academy_id,v_action_date) then
    return jsonb_build_object('ok',false,'message','공휴일에는 해당 시간표 작업을 할 수 없습니다. 정상수업으로 전환한 뒤 다시 시도해 주세요.');
  end if;

  perform set_config('olli.actor_account_id',v_account_id::text,true);
  perform set_config('olli.schedule_action',v_semantic_action,true);

  if v_action='merge_class' then
    return public.olli_schedule_merge_class(p_session_token,p_academy_id,(v_params->>'weekday')::integer,(v_params->>'time_slot')::integer);
  elsif v_action='split_class' then
    return public.olli_schedule_split_class(p_session_token,p_academy_id,(v_params->>'weekday')::integer,(v_params->>'time_slot')::integer);
  elsif v_action='set_session_order' then
    v_result := public.olli_schedule_set_session_order(p_session_token,p_academy_id,
      nullif(v_params->>'student_id','')::uuid,nullif(v_params->>'enrollment_id','')::uuid,
      (v_params->>'session_order')::integer,nullif(v_params->>'effective_date','')::date);
  elsif v_action='save_cell_memo' then
    v_result := public.olli_schedule_save_cell_memo(p_session_token,p_academy_id,
      v_params->>'division',nullif(v_params->>'session_date','')::date,
      (v_params->>'time_slot')::integer,coalesce(v_params->>'note',''));
  elsif v_action='change' then
    v_result := public.olli_schedule_change(p_session_token,p_academy_id,nullif(v_params->>'student_id','')::uuid,
      nullif(v_params->>'source_enrollment_id','')::uuid,(v_params->>'target_weekday')::integer,
      (v_params->>'target_time_slot')::integer,nullif(v_params->>'effective_date','')::date,
      v_params->>'change_type',coalesce((v_params->>'allow_wait')::boolean,true),
      coalesce(nullif(v_params->>'target_class_group',''),'A'));
  elsif v_action='add_waitlist' then
    v_result := public.olli_schedule_add_waitlist(p_session_token,p_academy_id,nullif(v_params->>'student_id','')::uuid,
      (v_params->>'target_weekday')::integer,(v_params->>'target_time_slot')::integer,
      nullif(v_params->>'effective_date','')::date,coalesce(nullif(v_params->>'target_class_group',''),'A'));
  elsif v_action='resolve_waitlist' then
    v_result := public.olli_schedule_resolve_waitlist(p_session_token,p_academy_id,
      nullif(v_params->>'waitlist_id','')::uuid,v_params->>'action',
      coalesce(nullif(v_params->>'effective_date','')::date,current_date));
  elsif v_action='add_one_time' then
    v_result := public.olli_schedule_add_one_time(p_session_token,p_academy_id,nullif(v_params->>'student_id','')::uuid,
      nullif(v_params->>'session_date','')::date,(v_params->>'time_slot')::integer,
      coalesce(v_params->>'note',''),coalesce(nullif(v_params->>'class_group',''),'A'));
  elsif v_action='cancel_one_time' then
    v_result := public.olli_schedule_cancel_one_time(p_session_token,p_academy_id,nullif(v_params->>'one_time_session_id','')::uuid);
  elsif v_action='cancel_change' then
    v_result := public.olli_schedule_cancel_change(p_session_token,p_academy_id,nullif(v_params->>'change_id','')::uuid);
  elsif v_action='remove_enrollment' then
    v_result := public.olli_schedule_remove_enrollment(p_session_token,p_academy_id,nullif(v_params->>'student_id','')::uuid,
      nullif(v_params->>'enrollment_id','')::uuid,nullif(v_params->>'effective_date','')::date);
  elsif v_action='toggle_attendance' then
    v_result := public.olli_schedule_toggle_attendance(p_session_token,p_academy_id,nullif(v_params->>'student_id','')::uuid,
      nullif(v_params->>'session_date','')::date,(v_params->>'time_slot')::integer,
      coalesce(nullif(v_params->>'class_group',''),'A'),v_params->>'session_kind');
  elsif v_action='set_attendance' then
    v_result := public.olli_schedule_set_attendance(p_session_token,p_academy_id,nullif(v_params->>'student_id','')::uuid,
      nullif(v_params->>'session_date','')::date,(v_params->>'time_slot')::integer,
      coalesce(nullif(v_params->>'class_group',''),'A'),coalesce(nullif(v_params->>'session_kind',''),'regular'),
      coalesce((v_params->>'attended')::boolean,false));
  elsif v_action='save_pickup' then
    v_result := public.olli_schedule_save_pickup(p_session_token,p_academy_id,nullif(v_params->>'student_id','')::uuid,
      (v_params->>'weekday')::integer,(v_params->>'class_time')::integer,v_params->>'pickup_label',
      nullif(v_params->>'pickup_time','')::time,nullif(v_params->>'effective_date','')::date);
  elsif v_action='update_pickup' then
    v_result := public.olli_schedule_update_pickup(p_session_token,p_academy_id,nullif(v_params->>'pickup_id','')::uuid,
      nullif(v_params->>'pickup_time','')::time,nullif(v_params->>'effective_date','')::date,
      coalesce(v_params->>'mode','edit'));
  else
    v_result := public.olli_schedule_remove_pickup(p_session_token,p_academy_id,nullif(v_params->>'pickup_id','')::uuid,
      nullif(v_params->>'effective_date','')::date);
  end if;
  return v_result;
exception
  when invalid_text_representation or invalid_datetime_format or numeric_value_out_of_range then
    return jsonb_build_object('ok',false,'message','시간표 변경 값을 확인해 주세요.');
end;
$$;
revoke all on function public.olli_schedule_execute(text,uuid,text,jsonb) from public;
grant execute on function public.olli_schedule_execute(text,uuid,text,jsonb) to anon, authenticated, service_role;
