-- Persist student disambiguation choices for structured routine-write drafts.
-- This updates only the draft's canonical stored student name/division.

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
    'choose_structured_student'::text,'choose_structured_date'::text,'choose_structured_time'::text,
    'add_timetable_memo'::text,'delete_timetable_memo'::text,
    'set_class_layout'::text,'set_class_teacher'::text,'set_teacher_override'::text,
    'set_session_order'::text,'set_normal_class_day'::text,'set_attendance_status'::text
  ]));

create or replace function public.olli_team_chat_send_structured_student_choice(
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
  v_draft jsonb;
  v_target text;
  v_base_payload jsonb;
  v_result jsonb;
  v_action_id uuid;
  v_action public.olli_team_chat_actions%rowtype;
begin
  if jsonb_typeof(v_payload) <> 'object'
     or lower(btrim(coalesce(v_payload->>'type',''))) <> 'structured_write_draft'
     or lower(btrim(coalesce(v_payload->>'field',''))) <> 'student_choice'
     or jsonb_typeof(v_payload->'choices') <> 'array'
     or jsonb_array_length(v_payload->'choices') < 2 then
    raise exception '학생 선택 정보 형식이 올바르지 않습니다.';
  end if;

  v_target:=lower(btrim(coalesce(v_payload->>'targetIntent','')));
  if v_target not in ('add_makeup','add_trial','add_waitlist') then
    raise exception '학생 선택 대상 작업이 올바르지 않습니다.';
  end if;

  v_draft:=v_payload->'draft';
  if jsonb_typeof(v_draft) <> 'object'
     or lower(btrim(coalesce(v_draft->>'action',''))) <> v_target
     or nullif(btrim(v_draft->>'studentName'),'') is null then
    raise exception '학생 선택 draft 정보가 올바르지 않습니다.';
  end if;

  v_base_payload:=v_draft || jsonb_build_object('intent',v_target);
  v_result:=public.olli_team_chat_send_action(
    p_session_token,p_academy_id,p_body,v_target,v_base_payload,
    p_client_message_id,p_reply_to_message_id
  );
  if coalesce((v_result->>'ok')::boolean,false) is not true then
    raise exception '%',coalesce(nullif(v_result->>'message',''),'학생 선택 카드를 저장하지 못했습니다.');
  end if;

  v_action_id:=nullif(v_result#>>'{message,action,id}','')::uuid;
  if v_action_id is null then raise exception '학생 선택 작업 식별값을 확인하지 못했습니다.'; end if;

  update public.olli_team_chat_actions
  set action_type='choose_structured_student',action_payload=v_payload,revision=revision+1,updated_at=now()
  where id=v_action_id and academy_id=p_academy_id and status='pending'
  returning * into v_action;
  if v_action.id is null then raise exception '학생 선택 작업을 저장하지 못했습니다.'; end if;

  v_result:=jsonb_set(v_result,'{message,action,action_type}',to_jsonb(v_action.action_type),true);
  v_result:=jsonb_set(v_result,'{message,action,revision}',to_jsonb(v_action.revision),true);
  v_result:=jsonb_set(v_result,'{message,action,updated_at}',to_jsonb(v_action.updated_at),true);
  return v_result;
end;
$function$;

create or replace function public.olli_team_chat_get_structured_student_choice(
  p_session_token text,p_academy_id uuid,p_action_id uuid
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
begin
  v_account_id:=public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;

  select m.id into v_member_id
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id and m.account_id=v_account_id
    and m.status='active' and a.status='active' and a.deleted_at is null
  order by case m.role when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end,m.created_at
  limit 1;
  if v_member_id is null then raise exception '현재 계정은 이 학원의 팀톡을 사용할 수 없습니다.'; end if;

  select a.* into v_action
  from public.olli_team_chat_actions a
  where a.id=p_action_id and a.academy_id=p_academy_id
  limit 1;
  if v_action.id is null then raise exception '학생 선택 작업을 찾지 못했습니다.'; end if;
  if v_action.action_type <> 'choose_structured_student' then raise exception '현재 작업은 학생 선택 상태가 아닙니다.'; end if;

  v_payload:=v_action.action_payload;
  if jsonb_typeof(v_payload) <> 'object'
     or lower(btrim(coalesce(v_payload->>'field',''))) <> 'student_choice'
     or jsonb_typeof(v_payload->'choices') <> 'array' then
    raise exception '학생 선택 상태가 올바르지 않습니다.';
  end if;

  return jsonb_build_object(
    'ok',true,'targetIntent',v_payload->>'targetIntent','choices',v_payload->'choices',
    'action',jsonb_build_object(
      'id',v_action.id,'action_type',v_action.action_type,'status',v_action.status,
      'revision',v_action.revision,'updated_at',v_action.updated_at,'resolved_at',v_action.resolved_at
    )
  );
end;
$function$;

create or replace function public.olli_team_chat_action_select_structured_student(
  p_session_token text,p_academy_id uuid,p_action_id uuid,p_student_name text
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
  v_draft jsonb;
  v_choice jsonb;
  v_name text:=btrim(coalesce(p_student_name,''));
  v_division text;
  v_body text;
begin
  v_account_id:=public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;
  if p_academy_id is null or p_action_id is null or v_name='' then
    raise exception '학생 선택 작업 정보를 확인해 주세요.';
  end if;

  select m.id into v_member_id
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id and m.account_id=v_account_id
    and m.status='active' and a.status='active' and a.deleted_at is null
  order by case m.role when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end,m.created_at
  limit 1;
  if v_member_id is null then raise exception '현재 계정은 이 학원의 팀톡을 사용할 수 없습니다.'; end if;

  select a.* into v_action
  from public.olli_team_chat_actions a
  where a.id=p_action_id and a.academy_id=p_academy_id
  for update;
  if v_action.id is null then raise exception '학생 선택 작업을 찾지 못했습니다.'; end if;

  v_payload:=v_action.action_payload;
  v_draft:=v_payload->'draft';

  if v_action.status='completed'
     and v_action.action_type='choose_structured_student'
     and btrim(coalesce(v_draft->>'studentName',''))=v_name then
    return jsonb_build_object(
      'ok',true,'changed',false,'draft',v_draft,
      'action',jsonb_build_object(
        'id',v_action.id,'action_type',v_action.action_type,'status',v_action.status,
        'revision',v_action.revision,'updated_at',v_action.updated_at,'resolved_at',v_action.resolved_at
      )
    );
  end if;

  if v_action.status <> 'pending' then
    return jsonb_build_object(
      'ok',false,'message','이미 처리된 학생 선택입니다.',
      'action',jsonb_build_object(
        'id',v_action.id,'action_type',v_action.action_type,'status',v_action.status,
        'revision',v_action.revision,'updated_at',v_action.updated_at,'resolved_at',v_action.resolved_at
      )
    );
  end if;

  if v_action.action_type <> 'choose_structured_student'
     or jsonb_typeof(v_payload) <> 'object'
     or lower(btrim(coalesce(v_payload->>'field',''))) <> 'student_choice'
     or jsonb_typeof(v_draft) <> 'object'
     or jsonb_typeof(v_payload->'choices') <> 'array' then
    raise exception '현재 작업은 학생 선택 상태가 아닙니다.';
  end if;

  select item.value into v_choice
  from jsonb_array_elements(v_payload->'choices') as item(value)
  where btrim(coalesce(item.value->>'studentName',''))=v_name
  limit 1;
  if v_choice is null then raise exception '선택할 수 없는 학생입니다.'; end if;

  v_division:=lower(btrim(coalesce(v_choice->>'division','')));
  v_draft:=jsonb_set(v_draft,'{studentName}',to_jsonb(v_name),true);
  if v_division in ('kinder','elementary') then
    v_draft:=jsonb_set(v_draft,'{division}',to_jsonb(v_division),true);
  end if;
  v_payload:=jsonb_set(v_payload,'{draft}',v_draft,true);
  v_body:=v_name||E'\n학생을 선택했어요.';

  update public.olli_team_chat_messages
  set body=v_body
  where academy_id=p_academy_id and id=v_action.message_id and deleted_at is null;

  update public.olli_team_chat_actions
  set action_payload=v_payload,status='completed',resolved_by_member_id=v_member_id,
      resolved_at=now(),updated_at=now(),revision=revision+1,error_text=null
  where id=v_action.id
  returning * into v_action;

  return jsonb_build_object(
    'ok',true,'changed',true,'draft',v_draft,'message_body',v_body,
    'action',jsonb_build_object(
      'id',v_action.id,'action_type',v_action.action_type,'status',v_action.status,
      'revision',v_action.revision,'updated_at',v_action.updated_at,'resolved_at',v_action.resolved_at
    )
  );
end;
$function$;

revoke execute on function public.olli_team_chat_send_structured_student_choice(text,uuid,text,jsonb,uuid,bigint) from public;
revoke execute on function public.olli_team_chat_get_structured_student_choice(text,uuid,uuid) from public;
revoke execute on function public.olli_team_chat_action_select_structured_student(text,uuid,uuid,text) from public;
grant execute on function public.olli_team_chat_send_structured_student_choice(text,uuid,text,jsonb,uuid,bigint) to anon, authenticated;
grant execute on function public.olli_team_chat_get_structured_student_choice(text,uuid,uuid) to anon, authenticated;
grant execute on function public.olli_team_chat_action_select_structured_student(text,uuid,uuid,text) to anon, authenticated;
