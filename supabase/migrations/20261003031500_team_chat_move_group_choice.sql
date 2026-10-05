-- Persist A/B class-move target selection as a non-executable Team Chat action.
-- Selecting A/B atomically converts choose_move_group to move_class and then reuses
-- the existing confirmation/execution path.

alter table public.olli_team_chat_actions
  drop constraint if exists olli_team_chat_actions_type_check;

alter table public.olli_team_chat_actions
  add constraint olli_team_chat_actions_type_check
  check (action_type = any (array[
    'add_class_once'::text,'cancel_class_once'::text,
    'add_pickup'::text,'update_pickup_arrival'::text,'update_pickup_dropoff'::text,
    'cancel_pickup'::text,'cancel_pickup_dropoff'::text,
    'choose_makeup_group'::text,'add_makeup'::text,'update_makeup'::text,'cancel_makeup'::text,
    'choose_trial_group'::text,'add_trial'::text,'update_trial'::text,'cancel_trial'::text,
    'choose_waitlist_group'::text,'add_waitlist'::text,'update_waitlist'::text,'cancel_waitlist'::text,
    'choose_move_group'::text,'move_class'::text,'cancel_move'::text,'mark_absent'::text,
    'add_timetable_memo'::text,'delete_timetable_memo'::text,
    'set_class_layout'::text,'set_class_teacher'::text,'set_teacher_override'::text,
    'set_session_order'::text,'set_normal_class_day'::text,'set_attendance_status'::text
  ]));

create or replace function public.olli_team_chat_send_move_group_choice(
  p_session_token text,
  p_academy_id uuid,
  p_body text,
  p_action_payload jsonb,
  p_client_message_id uuid default null,
  p_reply_to_message_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_payload jsonb := coalesce(p_action_payload,'{}'::jsonb);
  v_base_payload jsonb;
  v_result jsonb;
  v_action_id uuid;
  v_action public.olli_team_chat_actions%rowtype;
begin
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception '수업 이동 반 선택 정보 형식이 올바르지 않습니다.';
  end if;
  if lower(btrim(coalesce(v_payload->>'intent',''))) <> 'choose_move_group'
     or lower(btrim(coalesce(v_payload->>'targetIntent',''))) <> 'move_class' then
    raise exception '수업 이동 반 선택 작업 종류가 올바르지 않습니다.';
  end if;
  if nullif(btrim(v_payload->>'studentId'),'') is null
     or nullif(btrim(v_payload->>'sourceEnrollmentId'),'') is null
     or nullif(btrim(v_payload->>'sourceWeekday'),'') is null
     or nullif(btrim(v_payload->>'targetWeekday'),'') is null
     or nullif(btrim(v_payload->>'targetTimeSlot'),'') is null then
    raise exception '수업 이동 반 선택에 필요한 정보가 없습니다.';
  end if;
  if jsonb_typeof(v_payload->'allowedClassGroups') <> 'array'
     or jsonb_array_length(v_payload->'allowedClassGroups') < 2 then
    raise exception '선택 가능한 이동 반 정보를 확인하지 못했습니다.';
  end if;

  v_base_payload := jsonb_set(v_payload,'{intent}',to_jsonb('move_class'::text),true);

  v_result := public.olli_team_chat_send_action(
    p_session_token,
    p_academy_id,
    p_body,
    'move_class',
    v_base_payload,
    p_client_message_id,
    p_reply_to_message_id
  );

  if coalesce((v_result->>'ok')::boolean,false) is not true then
    raise exception '%',coalesce(nullif(v_result->>'message',''),'수업 이동 반 선택 카드를 저장하지 못했습니다.');
  end if;

  v_action_id := nullif(v_result#>>'{message,action,id}','')::uuid;
  if v_action_id is null then
    raise exception '수업 이동 반 선택 작업 식별값을 확인하지 못했습니다.';
  end if;

  update public.olli_team_chat_actions
  set action_type='choose_move_group',
      action_payload=v_payload,
      revision=revision+1,
      updated_at=now()
  where id=v_action_id
    and academy_id=p_academy_id
    and status='pending'
  returning * into v_action;

  if v_action.id is null then
    raise exception '수업 이동 반 선택 작업을 저장하지 못했습니다.';
  end if;

  v_result := jsonb_set(v_result,'{message,action,action_type}',to_jsonb(v_action.action_type),true);
  v_result := jsonb_set(v_result,'{message,action,revision}',to_jsonb(v_action.revision),true);
  v_result := jsonb_set(v_result,'{message,action,updated_at}',to_jsonb(v_action.updated_at),true);

  return v_result;
end;
$function$;

create or replace function public.olli_team_chat_action_select_move_group(
  p_session_token text,
  p_academy_id uuid,
  p_action_id uuid,
  p_class_group text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_account_id uuid;
  v_member_id uuid;
  v_action public.olli_team_chat_actions%rowtype;
  v_payload jsonb;
  v_group text := upper(btrim(coalesce(p_class_group,'')));
  v_next_payload jsonb;
  v_name text;
  v_source_weekday integer;
  v_source_time integer;
  v_target_weekday integer;
  v_target_time integer;
  v_body text;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;
  if p_academy_id is null or p_action_id is null then
    raise exception '수업 이동 반 선택 작업 정보를 확인해 주세요.';
  end if;
  if v_group not in ('A','B') then
    raise exception 'A반 또는 B반을 선택해 주세요.';
  end if;

  select m.id into v_member_id
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id
    and m.account_id=v_account_id
    and m.status='active'
    and a.status='active'
    and a.deleted_at is null
  order by case m.role
    when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end,
    m.created_at
  limit 1;

  if v_member_id is null then
    raise exception '현재 계정은 이 학원의 팀톡을 사용할 수 없습니다.';
  end if;

  select a.* into v_action
  from public.olli_team_chat_actions a
  where a.id=p_action_id
    and a.academy_id=p_academy_id
  for update;

  if v_action.id is null then
    raise exception '수업 이동 반 선택 작업을 찾지 못했습니다.';
  end if;

  if v_action.status <> 'pending' then
    return jsonb_build_object(
      'ok',false,
      'message','이미 처리된 작업입니다.',
      'action',jsonb_build_object(
        'id',v_action.id,'action_type',v_action.action_type,'status',v_action.status,
        'revision',v_action.revision,'updated_at',v_action.updated_at
      )
    );
  end if;

  if v_action.action_type='move_class'
     and upper(btrim(coalesce(v_action.action_payload->>'targetClassGroup','')))=v_group then
    return jsonb_build_object(
      'ok',true,
      'changed',false,
      'action',jsonb_build_object(
        'id',v_action.id,'action_type',v_action.action_type,'status',v_action.status,
        'revision',v_action.revision,'updated_at',v_action.updated_at
      )
    );
  end if;

  if v_action.action_type <> 'choose_move_group' then
    raise exception '현재 작업은 수업 이동 반 선택 상태가 아닙니다.';
  end if;

  v_payload := v_action.action_payload;
  if lower(btrim(coalesce(v_payload->>'targetIntent',''))) <> 'move_class' then
    raise exception '수업 이동 반 선택 대상 작업이 올바르지 않습니다.';
  end if;
  if jsonb_typeof(v_payload->'allowedClassGroups') <> 'array'
     or not exists (
       select 1
       from jsonb_array_elements_text(v_payload->'allowedClassGroups') as item(value)
       where upper(btrim(item.value))=v_group
     ) then
    raise exception '선택할 수 없는 이동 반입니다.';
  end if;

  v_name := coalesce(nullif(btrim(v_payload->>'studentName'),''),'학생');
  v_source_weekday := nullif(btrim(v_payload->>'sourceWeekday'),'')::integer;
  v_source_time := nullif(btrim(v_payload->>'sourceTimeSlot'),'')::integer;
  v_target_weekday := nullif(btrim(v_payload->>'targetWeekday'),'')::integer;
  v_target_time := nullif(btrim(v_payload->>'targetTimeSlot'),'')::integer;

  if v_source_weekday is null or v_source_time is null
     or v_target_weekday is null or v_target_time is null then
    raise exception '수업 이동 요일과 시간을 확인하지 못했습니다.';
  end if;

  v_next_payload := (v_payload - 'allowedClassGroups' - 'targetIntent')
    || jsonb_build_object(
      'intent','move_class',
      'targetClassGroup',v_group
    );

  update public.olli_team_chat_actions
  set action_type='move_class',
      action_payload=v_next_payload,
      revision=revision+1,
      updated_at=now()
  where id=v_action.id
  returning * into v_action;

  v_body := v_name
    || ' · '
    || case v_source_weekday
         when 1 then '월요일' when 2 then '화요일' when 3 then '수요일'
         when 4 then '목요일' when 5 then '금요일' when 6 then '토요일' else ''
       end
    || ' ' || v_source_time || '시 → '
    || case v_target_weekday
         when 1 then '월요일' when 2 then '화요일' when 3 then '수요일'
         when 4 then '목요일' when 5 then '금요일' when 6 then '토요일' else ''
       end
    || ' ' || v_target_time || '시 ' || v_group || '반'
    || E'\n정규수업 시간을 변경할까요?';

  update public.olli_team_chat_messages
  set body=v_body
  where academy_id=p_academy_id
    and id=v_action.message_id
    and deleted_at is null;

  return jsonb_build_object(
    'ok',true,
    'changed',true,
    'action',jsonb_build_object(
      'id',v_action.id,'action_type',v_action.action_type,'status',v_action.status,
      'revision',v_action.revision,'updated_at',v_action.updated_at
    ),
    'message_body',v_body
  );
end;
$function$;

revoke execute on function public.olli_team_chat_send_move_group_choice(text,uuid,text,jsonb,uuid,bigint) from public;
revoke execute on function public.olli_team_chat_action_select_move_group(text,uuid,uuid,text) from public;

grant execute on function public.olli_team_chat_send_move_group_choice(text,uuid,text,jsonb,uuid,bigint) to anon, authenticated;
grant execute on function public.olli_team_chat_action_select_move_group(text,uuid,uuid,text) to anon, authenticated;
