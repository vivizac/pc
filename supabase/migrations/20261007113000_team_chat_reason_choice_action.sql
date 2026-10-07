-- Treat cancellation/absence reasons as persisted Team Chat choices rather than user chat messages.
-- The selected reason is stored on the choice action, while the original Olli prompt remains unchanged.
-- This keeps reason selection on the same deterministic action path as A/B, date, and time choices.

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
    'choose_structured_student'::text,'choose_structured_target'::text,'choose_structured_division'::text,
    'choose_structured_date'::text,'choose_structured_time'::text,'choose_reason'::text,
    'add_timetable_memo'::text,'delete_timetable_memo'::text,
    'set_class_layout'::text,'set_class_teacher'::text,'set_teacher_override'::text,
    'set_session_order'::text,'set_normal_class_day'::text,'set_attendance_status'::text
  ]));

create or replace function public.olli_team_chat_send_reason_choice(
  p_session_token text,
  p_academy_id uuid,
  p_body text,
  p_pending jsonb,
  p_client_message_id uuid default null,
  p_reply_to_message_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_pending jsonb := coalesce(p_pending,'{}'::jsonb);
  v_target text;
  v_base_payload jsonb;
  v_reason_payload jsonb;
  v_result jsonb;
  v_action_id uuid;
  v_action public.olli_team_chat_actions%rowtype;
begin
  if jsonb_typeof(v_pending) <> 'object' or octet_length(v_pending::text) > 10000 then
    raise exception '사유 선택 작업 정보 형식이 올바르지 않습니다.';
  end if;

  v_target:=lower(btrim(coalesce(v_pending->>'intent','')));
  if v_target='batch_write' then
    if jsonb_typeof(v_pending#>'{__batchAgent,commands}') <> 'array' then
      raise exception '복합명령 사유 선택 정보를 확인하지 못했습니다.';
    end if;
    select lower(btrim(coalesce(item.value->>'intent','')))
    into v_target
    from jsonb_array_elements(v_pending#>'{__batchAgent,commands}') as item(value)
    where lower(btrim(coalesce(item.value->>'intent',''))) in ('cancel_makeup','cancel_trial','mark_absent')
      and nullif(btrim(coalesce(item.value->>'reason','')),'') is null
    limit 1;
  end if;
  if v_target not in ('cancel_makeup','cancel_trial','mark_absent') then
    raise exception '사유 선택 대상 작업이 올바르지 않습니다.';
  end if;

  v_base_payload:=jsonb_build_object('intent',v_target);
  v_result:=public.olli_team_chat_send_action(
    p_session_token,
    p_academy_id,
    p_body,
    v_target,
    v_base_payload,
    p_client_message_id,
    p_reply_to_message_id
  );

  if coalesce((v_result->>'ok')::boolean,false) is not true then
    raise exception '%',coalesce(nullif(v_result->>'message',''),'사유 선택 카드를 저장하지 못했습니다.');
  end if;

  v_action_id:=nullif(v_result#>>'{message,action,id}','')::uuid;
  if v_action_id is null then
    raise exception '사유 선택 작업 식별값을 확인하지 못했습니다.';
  end if;

  v_reason_payload:=jsonb_build_object(
    'intent','choose_reason',
    'targetIntent',v_target,
    'pending',v_pending
  );

  update public.olli_team_chat_actions
  set action_type='choose_reason',
      action_payload=v_reason_payload,
      revision=revision+1,
      updated_at=now()
  where id=v_action_id
    and academy_id=p_academy_id
    and status='pending'
  returning * into v_action;

  if v_action.id is null then
    select a.* into v_action
    from public.olli_team_chat_actions a
    where a.id=v_action_id and a.academy_id=p_academy_id
    limit 1;
  end if;

  if v_action.id is null
     or v_action.action_type <> 'choose_reason'
     or v_action.action_payload <> v_reason_payload then
    raise exception '사유 선택 작업을 저장하지 못했습니다.';
  end if;

  v_result:=jsonb_set(v_result,'{message,action,action_type}',to_jsonb(v_action.action_type),true);
  v_result:=jsonb_set(v_result,'{message,action,revision}',to_jsonb(v_action.revision),true);
  v_result:=jsonb_set(v_result,'{message,action,updated_at}',to_jsonb(v_action.updated_at),true);
  return v_result;
end;
$function$;

create or replace function public.olli_team_chat_action_select_reason(
  p_session_token text,
  p_academy_id uuid,
  p_action_id uuid,
  p_reason text
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
  v_pending jsonb;
  v_target text;
  v_reason text := btrim(coalesce(p_reason,''));
begin
  v_account_id:=public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;
  if p_academy_id is null or p_action_id is null then
    raise exception '사유 선택 작업 정보를 확인해 주세요.';
  end if;
  if char_length(v_reason)<1 or char_length(v_reason)>300 then
    raise exception '사유는 1자 이상 300자 이내로 입력해 주세요.';
  end if;

  select m.id into v_member_id
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id
    and m.account_id=v_account_id
    and m.status='active'
    and a.status='active'
    and a.deleted_at is null
  order by case m.role when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end,m.created_at
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
    raise exception '사유 선택 작업을 찾지 못했습니다.';
  end if;

  v_payload:=v_action.action_payload;
  v_pending:=v_payload->'pending';
  v_target:=lower(btrim(coalesce(v_payload->>'targetIntent','')));

  if v_action.action_type <> 'choose_reason'
     or jsonb_typeof(v_payload) <> 'object'
     or lower(btrim(coalesce(v_payload->>'intent',''))) <> 'choose_reason'
     or v_target not in ('cancel_makeup','cancel_trial','mark_absent')
     or jsonb_typeof(v_pending) <> 'object' then
    raise exception '현재 작업은 사유 선택 상태가 아닙니다.';
  end if;

  if lower(btrim(coalesce(v_pending->>'intent','')))='batch_write' then
    if jsonb_typeof(v_pending#>'{__batchAgent,commands}') <> 'array'
       or not exists (
         select 1
         from jsonb_array_elements(v_pending#>'{__batchAgent,commands}') as item(value)
         where lower(btrim(coalesce(item.value->>'intent','')))=v_target
       ) then
      raise exception '복합명령 사유 선택 상태가 올바르지 않습니다.';
    end if;
  elsif lower(btrim(coalesce(v_pending->>'intent',''))) <> v_target then
    raise exception '사유 선택 대상 작업이 일치하지 않습니다.';
  end if;

  if v_action.status='completed'
     and btrim(coalesce(v_payload->>'selectedReason',''))=v_reason then
    return jsonb_build_object(
      'ok',true,
      'changed',false,
      'selected_reason',v_reason,
      'pending',v_pending,
      'action',jsonb_build_object(
        'id',v_action.id,
        'message_id',v_action.message_id,
        'action_type',v_action.action_type,
        'status',v_action.status,
        'revision',v_action.revision,
        'updated_at',v_action.updated_at,
        'resolved_at',v_action.resolved_at
      )
    );
  end if;

  if v_action.status <> 'pending' then
    return jsonb_build_object(
      'ok',false,
      'message','이미 처리된 사유 선택입니다.',
      'action',jsonb_build_object(
        'id',v_action.id,
        'message_id',v_action.message_id,
        'action_type',v_action.action_type,
        'status',v_action.status,
        'revision',v_action.revision,
        'updated_at',v_action.updated_at,
        'resolved_at',v_action.resolved_at
      )
    );
  end if;

  v_payload:=jsonb_set(v_payload,'{selectedReason}',to_jsonb(v_reason),true);

  update public.olli_team_chat_actions
  set action_payload=v_payload,
      status='completed',
      resolved_by_member_id=v_member_id,
      resolved_at=now(),
      updated_at=now(),
      revision=revision+1,
      error_text=null
  where id=v_action.id
  returning * into v_action;

  return jsonb_build_object(
    'ok',true,
    'changed',true,
    'selected_reason',v_reason,
    'pending',v_pending,
    'action',jsonb_build_object(
      'id',v_action.id,
      'message_id',v_action.message_id,
      'action_type',v_action.action_type,
      'status',v_action.status,
      'revision',v_action.revision,
      'updated_at',v_action.updated_at,
      'resolved_at',v_action.resolved_at
    )
  );
end;
$function$;

create or replace function private.olli_team_chat_action_display_label(
  p_action_type text,
  p_status text,
  p_action_payload jsonb
)
returns text
language plpgsql
immutable
set search_path to ''
as $function$
declare
  v_type text := lower(btrim(coalesce(p_action_type,'')));
  v_status text := lower(btrim(coalesce(p_status,'')));
  v_payload jsonb := case
    when jsonb_typeof(p_action_payload)='object' then p_action_payload
    else '{}'::jsonb
  end;
  v_draft jsonb;
  v_field text;
  v_key text;
  v_value text;
  v_label text;
begin
  v_draft := case
    when jsonb_typeof(v_payload->'draft')='object' then v_payload->'draft'
    else '{}'::jsonb
  end;

  if v_status='cancelled' then return '취소됨'; end if;
  if v_status='failed' then return '처리 실패'; end if;
  if v_status<>'completed' then return ''; end if;

  if v_type='choose_reason' then
    v_value:=btrim(coalesce(v_payload->>'selectedReason',''));
    if v_value<>'' then return v_value; end if;
    return '사유 선택';
  end if;

  if v_type in ('choose_makeup_group','choose_trial_group','choose_waitlist_group','choose_move_group') then
    v_value := upper(btrim(coalesce(
      v_payload->>'selectedClassGroup',
      v_payload->>'classGroup',
      v_payload->>'targetClassGroup',
      ''
    )));
    if v_value in ('A','B') then return v_value||'반 선택'; end if;
    return '반 선택';
  end if;

  if v_type='choose_structured_date' then
    v_field := lower(btrim(coalesce(v_payload->>'field','')));
    v_key := case when v_field='target_date' then 'targetDateExpression' else 'dateExpression' end;
    v_value := btrim(coalesce(v_draft->>v_key,''));
    if v_value<>'' then return v_value||' 선택'; end if;
    return case when v_field='target_date' then '변경 날짜 선택' else '날짜 선택' end;
  end if;

  if v_type='choose_structured_time' then
    v_field := lower(btrim(coalesce(v_payload->>'field','')));
    v_key := case when v_field='target_time' then 'targetTimeSlot' else 'timeSlot' end;
    v_value := btrim(coalesce(v_draft->>v_key,''));
    v_label := '';

    if v_value<>'' and jsonb_typeof(v_payload->'choices')='array' then
      select coalesce(
        nullif(btrim(item.value->>'label'),''),
        case
          when nullif(btrim(item.value->>'timeSlot'),'') is not null
            then btrim(item.value->>'timeSlot')||'시'
          else null
        end
      )
      into v_label
      from jsonb_array_elements(v_payload->'choices') as item(value)
      where btrim(coalesce(item.value->>'timeSlot',''))=v_value
      limit 1;
    end if;

    if nullif(btrim(coalesce(v_label,'')),'') is not null then
      return btrim(v_label)||' 선택';
    end if;
    if v_value<>'' then return v_value||'시 선택'; end if;
    return case when v_field='target_time' then '변경 시간 선택' else '시간 선택' end;
  end if;

  if v_type='choose_structured_student' then
    v_value := btrim(coalesce(v_draft->>'studentName',''));
    if v_value<>'' then return v_value||' 선택'; end if;
    return '학생 선택';
  end if;

  if v_type='choose_structured_division' then
    v_value := lower(btrim(coalesce(v_draft->>'division','')));
    if v_value='kinder' then return '유치부 선택'; end if;
    if v_value='elementary' then return '초등부 선택'; end if;
    return '수업 구분 선택';
  end if;

  if v_type='choose_structured_target' then
    v_key := btrim(coalesce(v_payload->>'choiceKey',''));
    if v_key='' then
      v_key := case lower(btrim(coalesce(v_payload->>'targetIntent','')))
        when 'update_pickup' then 'pickupId'
        when 'cancel_pickup' then 'pickupId'
        when 'cancel_waitlist' then 'waitlistId'
        else ''
      end;
    end if;

    if v_key<>'' then
      v_value := btrim(coalesce(v_draft->>v_key,''));
    end if;
    v_label := '';

    if coalesce(v_value,'')<>'' and jsonb_typeof(v_payload->'choices')='array' then
      select nullif(btrim(item.value->>'label'),'')
      into v_label
      from jsonb_array_elements(v_payload->'choices') as item(value)
      where btrim(coalesce(item.value->>'id',''))=v_value
      limit 1;
    end if;

    if nullif(btrim(coalesce(v_label,'')),'') is not null then
      return btrim(v_label)||' 선택';
    end if;
    return '일정 선택';
  end if;

  if v_type in (
    'add_class_once','add_pickup','add_makeup','add_trial','add_waitlist','add_timetable_memo'
  ) then
    return '등록 완료';
  end if;

  if v_type in ('delete_timetable_memo','cancel_pickup','cancel_pickup_dropoff') then
    return '삭제 완료';
  end if;

  if v_type in ('cancel_class_once','cancel_makeup','cancel_trial','cancel_waitlist','cancel_move') then
    return '취소 완료';
  end if;

  if v_type='mark_absent' then
    return '결석 처리 완료';
  end if;

  if v_type in (
    'update_pickup_arrival','update_pickup_dropoff','update_makeup','update_trial','update_waitlist',
    'move_class','set_class_layout','set_class_teacher','set_teacher_override','set_session_order',
    'set_normal_class_day','set_attendance_status'
  ) then
    return '변경 완료';
  end if;

  return '완료';
end;
$function$;

revoke execute on function public.olli_team_chat_send_reason_choice(text,uuid,text,jsonb,uuid,bigint) from public;
revoke execute on function public.olli_team_chat_action_select_reason(text,uuid,uuid,text) from public;
revoke execute on function private.olli_team_chat_action_display_label(text,text,jsonb) from public, anon, authenticated;

grant execute on function public.olli_team_chat_send_reason_choice(text,uuid,text,jsonb,uuid,bigint) to anon, authenticated;
grant execute on function public.olli_team_chat_action_select_reason(text,uuid,uuid,text) to anon, authenticated;
