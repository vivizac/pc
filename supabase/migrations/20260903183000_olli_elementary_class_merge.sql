-- Allow a split elementary slot to be safely returned to one class.

create or replace function public.olli_schedule_merge_class(
  p_session_token text,
  p_academy_id uuid,
  p_weekday integer,
  p_time_slot integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '클래스를 통합할 권한이 없습니다.');
  end if;
  if p_weekday not between 1 and 6 or p_time_slot not between 1 and 6 then
    return jsonb_build_object('ok', false, 'message', '통합할 요일과 시간을 확인해 주세요.');
  end if;
  if exists (
    select 1 from public.olli_schedule_enrollments e
    where e.academy_id = p_academy_id and e.weekday = p_weekday and e.time_slot = p_time_slot
      and e.class_group = 'B' and e.status = 'active'
  ) or exists (
    select 1 from public.olli_schedule_one_time_sessions o
    where o.academy_id = p_academy_id and extract(isodow from o.session_date)::integer = p_weekday
      and o.time_slot = p_time_slot and o.class_group = 'B' and o.status <> 'cancelled'
  ) or exists (
    select 1 from public.olli_schedule_waitlist w
    where w.academy_id = p_academy_id and w.target_weekday = p_weekday and w.target_time_slot = p_time_slot
      and w.target_class_group = 'B' and w.status in ('waiting', 'offered')
  ) then
    return jsonb_build_object('ok', false, 'message', 'B반에 등록·보강·대기 학생이 있어 통합할 수 없습니다. 먼저 A반으로 이동하거나 대기를 정리해 주세요.');
  end if;
  delete from public.olli_schedule_class_splits
  where academy_id = p_academy_id and weekday = p_weekday and time_slot = p_time_slot;
  return jsonb_build_object('ok', true, 'result', 'merged', 'weekday', p_weekday, 'time_slot', p_time_slot);
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
  if v_account_id is null or not exists (select 1 from public.academy_members m where m.academy_id = p_academy_id and m.account_id = v_account_id and m.status = 'active' and m.role in ('owner','manager','teacher')) then return jsonb_build_object('ok', false, 'message', '시간표를 변경할 권한이 없습니다.'); end if;
  v_semantic_action := case v_action
    when 'change' then case when v_params->>'change_type' = 'move' then 'move' else 'add' end
    when 'resolve_waitlist' then case when v_params->>'action' = 'accept' then 'wait_accept' else 'wait_cancel' end
    when 'add_one_time' then 'makeup_add' when 'cancel_one_time' then 'makeup_cancel' when 'cancel_change' then 'scheduled_cancel' when 'remove_enrollment' then 'remove' when 'toggle_attendance' then 'attendance_toggle' when 'save_pickup' then 'pickup_add' when 'remove_pickup' then 'pickup_remove' when 'split_class' then 'class_split' when 'merge_class' then 'class_merge' else null end;
  if v_semantic_action is null then return jsonb_build_object('ok', false, 'message', '지원하지 않는 시간표 변경입니다.'); end if;
  perform set_config('olli.actor_account_id', v_account_id::text, true); perform set_config('olli.schedule_action', v_semantic_action, true);
  if v_action = 'merge_class' then
    return public.olli_schedule_merge_class(p_session_token, p_academy_id, (v_params->>'weekday')::integer, (v_params->>'time_slot')::integer);
  end if;
  if v_action = 'split_class' then
    return public.olli_schedule_split_class(p_session_token, p_academy_id, (v_params->>'weekday')::integer, (v_params->>'time_slot')::integer);
  end if;
  if v_action = 'change' then v_result := public.olli_schedule_change(p_session_token,p_academy_id,nullif(v_params->>'student_id','')::uuid,nullif(v_params->>'source_enrollment_id','')::uuid,(v_params->>'target_weekday')::integer,(v_params->>'target_time_slot')::integer,nullif(v_params->>'effective_date','')::date,v_params->>'change_type',coalesce((v_params->>'allow_wait')::boolean,true),coalesce(nullif(v_params->>'target_class_group',''),'A'));
  elsif v_action = 'resolve_waitlist' then v_result := public.olli_schedule_resolve_waitlist(p_session_token,p_academy_id,nullif(v_params->>'waitlist_id','')::uuid,v_params->>'action',coalesce(nullif(v_params->>'effective_date','')::date,current_date));
  elsif v_action = 'add_one_time' then v_result := public.olli_schedule_add_one_time(p_session_token,p_academy_id,nullif(v_params->>'student_id','')::uuid,nullif(v_params->>'session_date','')::date,(v_params->>'time_slot')::integer,coalesce(v_params->>'note',''),coalesce(nullif(v_params->>'class_group',''),'A'));
  elsif v_action = 'cancel_one_time' then v_result := public.olli_schedule_cancel_one_time(p_session_token,p_academy_id,nullif(v_params->>'one_time_session_id','')::uuid);
  elsif v_action = 'cancel_change' then v_result := public.olli_schedule_cancel_change(p_session_token,p_academy_id,nullif(v_params->>'change_id','')::uuid);
  elsif v_action = 'remove_enrollment' then v_result := public.olli_schedule_remove_enrollment(p_session_token,p_academy_id,nullif(v_params->>'student_id','')::uuid,nullif(v_params->>'enrollment_id','')::uuid,nullif(v_params->>'effective_date','')::date);
  elsif v_action = 'toggle_attendance' then v_result := public.olli_schedule_toggle_attendance(p_session_token,p_academy_id,nullif(v_params->>'student_id','')::uuid,nullif(v_params->>'session_date','')::date,(v_params->>'time_slot')::integer,coalesce(nullif(v_params->>'class_group',''),'A'),v_params->>'session_kind');
  elsif v_action = 'save_pickup' then v_result := public.olli_schedule_save_pickup(p_session_token,p_academy_id,nullif(v_params->>'student_id','')::uuid,(v_params->>'weekday')::integer,(v_params->>'class_time')::integer,v_params->>'pickup_label',nullif(v_params->>'pickup_time','')::time,nullif(v_params->>'effective_date','')::date);
  else v_result := public.olli_schedule_remove_pickup(p_session_token,p_academy_id,nullif(v_params->>'pickup_id','')::uuid,nullif(v_params->>'effective_date','')::date); end if;
  return v_result;
exception when invalid_text_representation or invalid_datetime_format or numeric_value_out_of_range then return jsonb_build_object('ok', false, 'message', '시간표 변경 값을 확인해 주세요.');
end;
$$;

revoke all on function public.olli_schedule_merge_class(text, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.olli_schedule_execute(text, uuid, text, jsonb) from public;
grant execute on function public.olli_schedule_execute(text, uuid, text, jsonb) to anon, authenticated;
