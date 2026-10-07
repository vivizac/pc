-- Fast path for single makeup/trial cancellation reasons.
-- The cancellation target was already resolved before the reason prompt.
-- This RPC only persists the selected reason and creates the pending confirmation card.
-- No student lookup, schedule lookup, source-message validation, or Agent/OpenAI call occurs here.

create or replace function public.olli_team_chat_action_select_reason_prepare_cancel(
  p_session_token text,
  p_academy_id uuid,
  p_action_id uuid,
  p_reason text,
  p_confirmation_body text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_account_id uuid;
  v_member_id uuid;
  v_reason_action public.olli_team_chat_actions%rowtype;
  v_reason_payload jsonb;
  v_pending jsonb;
  v_target text;
  v_command jsonb;
  v_reason text := btrim(coalesce(p_reason,''));
  v_confirmation_body text := btrim(coalesce(p_confirmation_body,''));
  v_confirmation_message public.olli_team_chat_messages%rowtype;
  v_confirmation_action public.olli_team_chat_actions%rowtype;
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
  if char_length(v_confirmation_body)<1 or char_length(v_confirmation_body)>5000 then
    raise exception '취소 확인 메시지 내용을 확인해 주세요.';
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

  select a.* into v_reason_action
  from public.olli_team_chat_actions a
  where a.id=p_action_id
    and a.academy_id=p_academy_id
  for update;

  if v_reason_action.id is null then
    raise exception '사유 선택 작업을 찾지 못했습니다.';
  end if;
  if v_reason_action.status<>'pending' then
    return jsonb_build_object(
      'ok',false,
      'message','이미 처리된 사유 선택입니다.',
      'reason_action',jsonb_build_object(
        'id',v_reason_action.id,
        'action_type',v_reason_action.action_type,
        'status',v_reason_action.status,
        'revision',v_reason_action.revision,
        'updated_at',v_reason_action.updated_at,
        'resolved_at',v_reason_action.resolved_at
      )
    );
  end if;

  v_reason_payload:=v_reason_action.action_payload;
  v_pending:=v_reason_payload->'pending';
  v_target:=lower(btrim(coalesce(v_reason_payload->>'targetIntent','')));

  if v_reason_action.action_type<>'choose_reason'
     or jsonb_typeof(v_reason_payload)<>'object'
     or lower(btrim(coalesce(v_reason_payload->>'intent','')))<>'choose_reason'
     or v_target not in ('cancel_makeup','cancel_trial')
     or jsonb_typeof(v_pending)<>'object' then
    raise exception '현재 작업은 보강·체험 취소 사유 선택 상태가 아닙니다.';
  end if;

  if lower(btrim(coalesce(v_pending->>'intent','')))='batch_write'
     or v_pending ? '__batchAgent' then
    raise exception '복합 취소 작업은 빠른 사유 경로를 사용할 수 없습니다.';
  end if;

  if v_target='cancel_makeup'
     and jsonb_typeof(v_pending#>'{__structuredMakeupCancel,structuredCommand}')='object' then
    v_command:=v_pending#>'{__structuredMakeupCancel,structuredCommand}';
  elsif v_target='cancel_trial'
     and jsonb_typeof(v_pending#>'{__structuredTrialCancel,structuredCommand}')='object' then
    v_command:=v_pending#>'{__structuredTrialCancel,structuredCommand}';
  else
    v_command:=v_pending;
  end if;

  if jsonb_typeof(v_command)<>'object'
     or lower(btrim(coalesce(v_command->>'intent',v_command->>'action','')))<>v_target then
    raise exception '확정된 취소 작업 정보를 확인하지 못했습니다.';
  end if;

  v_command:=v_command
    - '__structuredMakeupCancel'
    - '__structuredTrialCancel'
    - '__makeupCancelAgent'
    - '__trialCancelAgent'
    - '__batchAgent';
  v_command:=jsonb_set(v_command,'{intent}',to_jsonb(v_target),true);
  v_command:=jsonb_set(v_command,'{reason}',to_jsonb(v_reason),true);

  if nullif(btrim(coalesce(v_command->>'oneTimeSessionId',v_command->>'one_time_session_id','')),'') is null
     or nullif(btrim(coalesce(v_command->>'sessionDate',v_command->>'session_date','')),'') is null
     or coalesce(nullif(v_command->>'timeSlot','')::integer,nullif(v_command->>'time_slot','')::integer,0)<=0 then
    raise exception '앞 단계에서 확정된 취소 일정 정보를 확인하지 못했습니다.';
  end if;

  v_reason_payload:=jsonb_set(v_reason_payload,'{selectedReason}',to_jsonb(v_reason),true);

  update public.olli_team_chat_actions
  set action_payload=v_reason_payload,
      status='completed',
      resolved_by_member_id=v_member_id,
      resolved_at=now(),
      updated_at=now(),
      revision=revision+1,
      error_text=null
  where id=v_reason_action.id
  returning * into v_reason_action;

  insert into public.olli_team_chat_messages(
    academy_id,sender_member_id,sender_name_snapshot,message_type,body,
    reply_to_message_id,client_message_id
  )
  values(
    p_academy_id,null,'올리','ai',v_confirmation_body,
    v_reason_action.message_id,extensions.gen_random_uuid()
  )
  returning * into v_confirmation_message;

  insert into public.olli_team_chat_actions(
    academy_id,message_id,action_type,action_payload,requested_by_member_id
  )
  values(
    p_academy_id,v_confirmation_message.id,v_target,v_command,v_member_id
  )
  returning * into v_confirmation_action;

  return jsonb_build_object(
    'ok',true,
    'selected_reason',v_reason,
    'reason_action',jsonb_build_object(
      'id',v_reason_action.id,
      'message_id',v_reason_action.message_id,
      'action_type',v_reason_action.action_type,
      'status',v_reason_action.status,
      'revision',v_reason_action.revision,
      'updated_at',v_reason_action.updated_at,
      'resolved_at',v_reason_action.resolved_at,
      'display_label',v_reason,
      'selected_reason',v_reason
    ),
    'confirmation_message',jsonb_build_object(
      'id',v_confirmation_message.id,
      'academy_id',v_confirmation_message.academy_id,
      'sender_member_id',v_confirmation_message.sender_member_id,
      'sender_name',v_confirmation_message.sender_name_snapshot,
      'message_type',v_confirmation_message.message_type,
      'body',v_confirmation_message.body,
      'reply_to_message_id',v_confirmation_message.reply_to_message_id,
      'client_message_id',v_confirmation_message.client_message_id,
      'created_at',v_confirmation_message.created_at,
      'action',jsonb_build_object(
        'id',v_confirmation_action.id,
        'action_type',v_confirmation_action.action_type,
        'status',v_confirmation_action.status,
        'revision',v_confirmation_action.revision,
        'created_at',v_confirmation_action.created_at,
        'updated_at',v_confirmation_action.updated_at,
        'resolved_at',v_confirmation_action.resolved_at,
        'error',v_confirmation_action.error_text
      )
    )
  );
end;
$function$;

revoke execute on function public.olli_team_chat_action_select_reason_prepare_cancel(text,uuid,uuid,text,text) from public;
grant execute on function public.olli_team_chat_action_select_reason_prepare_cancel(text,uuid,uuid,text,text) to anon, authenticated;
