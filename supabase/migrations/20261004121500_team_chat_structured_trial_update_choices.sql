-- Extend reusable structured target/date/time choice cards to trial updates.
-- These functions only persist draft selections. Actual trial mutation remains behind
-- the existing pending confirmation action and olli_schedule_update_one_time_session.

create or replace function public.olli_team_chat_send_structured_target_choice(
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
     or lower(btrim(coalesce(v_payload->>'field',''))) <> 'target_choice'
     or jsonb_typeof(v_payload->'choices') <> 'array'
     or jsonb_array_length(v_payload->'choices') < 2 then
    raise exception '대상 선택 정보 형식이 올바르지 않습니다.';
  end if;

  v_target:=lower(btrim(coalesce(v_payload->>'targetIntent','')));
  if v_target not in ('update_makeup','update_trial','update_pickup','cancel_pickup','cancel_waitlist') then
    raise exception '대상 선택 작업이 올바르지 않습니다.';
  end if;

  if v_target in ('update_makeup','update_trial')
     and btrim(coalesce(v_payload->>'choiceKey','')) not in ('oneTimeSessionId','targetClassGroup') then
    raise exception '보강·체험 변경 대상 선택 종류가 올바르지 않습니다.';
  end if;

  v_draft:=v_payload->'draft';
  if jsonb_typeof(v_draft) <> 'object'
     or lower(btrim(coalesce(v_draft->>'action',''))) <> v_target
     or nullif(btrim(v_draft->>'studentName'),'') is null then
    raise exception '대상 선택 draft 정보가 올바르지 않습니다.';
  end if;

  v_base_payload:=v_draft || jsonb_build_object('intent',v_target);
  v_result:=public.olli_team_chat_send_action(
    p_session_token,p_academy_id,p_body,v_target,v_base_payload,
    p_client_message_id,p_reply_to_message_id
  );
  if coalesce((v_result->>'ok')::boolean,false) is not true then
    raise exception '%',coalesce(nullif(v_result->>'message',''),'대상 선택 카드를 저장하지 못했습니다.');
  end if;

  v_action_id:=nullif(v_result#>>'{message,action,id}','')::uuid;
  if v_action_id is null then raise exception '대상 선택 작업 식별값을 확인하지 못했습니다.'; end if;

  update public.olli_team_chat_actions
  set action_type='choose_structured_target',
      action_payload=v_payload,
      revision=revision+1,
      updated_at=now()
  where id=v_action_id and academy_id=p_academy_id and status='pending'
  returning * into v_action;

  if v_action.id is null then raise exception '대상 선택 작업을 저장하지 못했습니다.'; end if;

  v_result:=jsonb_set(v_result,'{message,action,action_type}',to_jsonb(v_action.action_type),true);
  v_result:=jsonb_set(v_result,'{message,action,revision}',to_jsonb(v_action.revision),true);
  v_result:=jsonb_set(v_result,'{message,action,updated_at}',to_jsonb(v_action.updated_at),true);
  return v_result;
end;
$function$;

create or replace function public.olli_team_chat_get_structured_target_choice(
  p_session_token text,
  p_academy_id uuid,
  p_action_id uuid
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
  where a.id=p_action_id and a.academy_id=p_academy_id
  limit 1;

  if v_action.id is null then raise exception '대상 선택 작업을 찾지 못했습니다.'; end if;
  if v_action.action_type <> 'choose_structured_target' then
    raise exception '현재 작업은 대상 선택 상태가 아닙니다.';
  end if;

  v_payload:=v_action.action_payload;
  if jsonb_typeof(v_payload) <> 'object'
     or lower(btrim(coalesce(v_payload->>'field',''))) <> 'target_choice'
     or jsonb_typeof(v_payload->'choices') <> 'array' then
    raise exception '대상 선택 상태가 올바르지 않습니다.';
  end if;

  return jsonb_build_object(
    'ok',true,
    'targetIntent',v_payload->>'targetIntent',
    'choices',v_payload->'choices',
    'action',jsonb_build_object(
      'id',v_action.id,
      'action_type',v_action.action_type,
      'status',v_action.status,
      'revision',v_action.revision,
      'updated_at',v_action.updated_at,
      'resolved_at',v_action.resolved_at
    )
  );
end;
$function$;

create or replace function public.olli_team_chat_action_select_structured_target(
  p_session_token text,
  p_academy_id uuid,
  p_action_id uuid,
  p_choice_id text
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
  v_target text;
  v_key text;
  v_choice_id text:=btrim(coalesce(p_choice_id,''));
  v_label text;
  v_body text;
begin
  v_account_id:=public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;
  if p_academy_id is null or p_action_id is null or v_choice_id='' then
    raise exception '대상 선택 작업 정보를 확인해 주세요.';
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
  where a.id=p_action_id and a.academy_id=p_academy_id
  for update;

  if v_action.id is null then raise exception '대상 선택 작업을 찾지 못했습니다.'; end if;

  v_payload:=v_action.action_payload;
  v_draft:=v_payload->'draft';
  v_target:=lower(btrim(coalesce(v_payload->>'targetIntent','')));

  v_key:=btrim(coalesce(v_payload->>'choiceKey',''));
  if v_target in ('update_makeup','update_trial') then
    if v_key not in ('oneTimeSessionId','targetClassGroup') then
      raise exception '보강·체험 변경 대상 선택 종류가 올바르지 않습니다.';
    end if;
  elsif v_target in ('update_pickup','cancel_pickup') then
    if v_key='' then v_key:='pickupId'; end if;
    if v_key<>'pickupId' then raise exception '픽업 선택 종류가 올바르지 않습니다.'; end if;
  elsif v_target='cancel_waitlist' then
    if v_key='' then v_key:='waitlistId'; end if;
    if v_key<>'waitlistId' then raise exception '대기 선택 종류가 올바르지 않습니다.'; end if;
  else
    raise exception '대상 선택 작업 종류가 올바르지 않습니다.';
  end if;

  if v_action.status='completed'
     and v_action.action_type='choose_structured_target'
     and btrim(coalesce(v_draft->>v_key,''))=v_choice_id then
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
      'ok',false,'message','이미 처리된 대상 선택입니다.',
      'action',jsonb_build_object(
        'id',v_action.id,'action_type',v_action.action_type,'status',v_action.status,
        'revision',v_action.revision,'updated_at',v_action.updated_at,'resolved_at',v_action.resolved_at
      )
    );
  end if;

  if v_action.action_type <> 'choose_structured_target'
     or jsonb_typeof(v_payload) <> 'object'
     or lower(btrim(coalesce(v_payload->>'field',''))) <> 'target_choice'
     or jsonb_typeof(v_draft) <> 'object'
     or jsonb_typeof(v_payload->'choices') <> 'array' then
    raise exception '현재 작업은 대상 선택 상태가 아닙니다.';
  end if;

  select item.value into v_choice
  from jsonb_array_elements(v_payload->'choices') as item(value)
  where btrim(coalesce(item.value->>'id',''))=v_choice_id
  limit 1;

  if v_choice is null then raise exception '선택할 수 없는 대상입니다.'; end if;

  v_label:=btrim(coalesce(v_choice->>'label',''));
  if v_label='' then raise exception '선택 대상 표시 정보를 확인하지 못했습니다.'; end if;

  v_draft:=jsonb_set(v_draft,array[v_key],to_jsonb(v_choice_id),true);
  v_payload:=jsonb_set(v_payload,'{draft}',v_draft,true);
  v_body:=v_label||E'\n일정을 선택했어요.';

  update public.olli_team_chat_messages
  set body=v_body
  where academy_id=p_academy_id and id=v_action.message_id and deleted_at is null;

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
    'draft',v_draft,
    'message_body',v_body,
    'action',jsonb_build_object(
      'id',v_action.id,
      'action_type',v_action.action_type,
      'status',v_action.status,
      'revision',v_action.revision,
      'updated_at',v_action.updated_at,
      'resolved_at',v_action.resolved_at
    )
  );
end;
$function$;

revoke execute on function public.olli_team_chat_send_structured_target_choice(text,uuid,text,jsonb,uuid,bigint) from public;
revoke execute on function public.olli_team_chat_get_structured_target_choice(text,uuid,uuid) from public;
revoke execute on function public.olli_team_chat_action_select_structured_target(text,uuid,uuid,text) from public;

grant execute on function public.olli_team_chat_send_structured_target_choice(text,uuid,text,jsonb,uuid,bigint) to anon, authenticated;
grant execute on function public.olli_team_chat_get_structured_target_choice(text,uuid,uuid) to anon, authenticated;
grant execute on function public.olli_team_chat_action_select_structured_target(text,uuid,uuid,text) to anon, authenticated;


create or replace function public.olli_team_chat_send_structured_date_choice(
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
     or lower(btrim(coalesce(v_payload->>'field',''))) not in ('date','target_date') then
    raise exception '날짜 선택 정보 형식이 올바르지 않습니다.';
  end if;

  v_target := lower(btrim(coalesce(v_payload->>'targetIntent','')));
  if (lower(btrim(coalesce(v_payload->>'field','')))='date'
      and v_target not in ('add_makeup','add_trial','add_waitlist'))
     or (lower(btrim(coalesce(v_payload->>'field','')))='target_date'
      and v_target not in ('update_makeup','update_trial')) then
    raise exception '날짜 선택 대상 작업이 올바르지 않습니다.';
  end if;

  v_draft := v_payload->'draft';
  if jsonb_typeof(v_draft) <> 'object'
     or lower(btrim(coalesce(v_draft->>'action',''))) <> v_target
     or nullif(btrim(v_draft->>'studentName'),'') is null then
    raise exception '날짜 선택 draft 정보가 올바르지 않습니다.';
  end if;

  v_base_payload := v_draft || jsonb_build_object('intent',v_target);

  v_result := public.olli_team_chat_send_action(
    p_session_token,
    p_academy_id,
    p_body,
    v_target,
    v_base_payload,
    p_client_message_id,
    p_reply_to_message_id
  );

  if coalesce((v_result->>'ok')::boolean,false) is not true then
    raise exception '%',coalesce(nullif(v_result->>'message',''),'날짜 선택 카드를 저장하지 못했습니다.');
  end if;

  v_action_id := nullif(v_result#>>'{message,action,id}','')::uuid;
  if v_action_id is null then
    raise exception '날짜 선택 작업 식별값을 확인하지 못했습니다.';
  end if;

  update public.olli_team_chat_actions
  set action_type='choose_structured_date',
      action_payload=v_payload,
      revision=revision+1,
      updated_at=now()
  where id=v_action_id
    and academy_id=p_academy_id
    and status='pending'
  returning * into v_action;

  if v_action.id is null then
    raise exception '날짜 선택 작업을 저장하지 못했습니다.';
  end if;

  v_result := jsonb_set(v_result,'{message,action,action_type}',to_jsonb(v_action.action_type),true);
  v_result := jsonb_set(v_result,'{message,action,revision}',to_jsonb(v_action.revision),true);
  v_result := jsonb_set(v_result,'{message,action,updated_at}',to_jsonb(v_action.updated_at),true);

  return v_result;
end;
$function$;

create or replace function public.olli_team_chat_action_select_structured_date(
  p_session_token text,
  p_academy_id uuid,
  p_action_id uuid,
  p_date_expression text
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
  v_target text;
  v_date_expression text := btrim(coalesce(p_date_expression,''));
  v_name text;
  v_body text;
  v_field text;
  v_key text;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;
  if p_academy_id is null or p_action_id is null then
    raise exception '날짜 선택 작업 정보를 확인해 주세요.';
  end if;
  if char_length(v_date_expression) < 2 or char_length(v_date_expression) > 40
     or v_date_expression !~ '^(오늘|내일|[0-9]{1,2}월[[:space:]]*[0-9]{1,2}일)$' then
    raise exception '선택한 날짜 형식이 올바르지 않습니다.';
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
    raise exception '날짜 선택 작업을 찾지 못했습니다.';
  end if;

  v_payload := v_action.action_payload;
  v_draft := v_payload->'draft';
  v_field:=lower(btrim(coalesce(v_payload->>'field','')));
  v_key:=case when v_field='target_date' then 'targetDateExpression' else 'dateExpression' end;

  if v_action.status='completed'
     and v_action.action_type='choose_structured_date'
     and btrim(coalesce(v_draft->>v_key,''))=v_date_expression then
    return jsonb_build_object(
      'ok',true,
      'changed',false,
      'draft',v_draft,
      'action',jsonb_build_object(
        'id',v_action.id,'action_type',v_action.action_type,'status',v_action.status,
        'revision',v_action.revision,'updated_at',v_action.updated_at,'resolved_at',v_action.resolved_at
      )
    );
  end if;

  if v_action.status <> 'pending' then
    return jsonb_build_object(
      'ok',false,
      'message','이미 처리된 날짜 선택입니다.',
      'action',jsonb_build_object(
        'id',v_action.id,'action_type',v_action.action_type,'status',v_action.status,
        'revision',v_action.revision,'updated_at',v_action.updated_at,'resolved_at',v_action.resolved_at
      )
    );
  end if;

  if v_action.action_type <> 'choose_structured_date'
     or jsonb_typeof(v_payload) <> 'object'
     or lower(btrim(coalesce(v_payload->>'type',''))) <> 'structured_write_draft'
     or lower(btrim(coalesce(v_payload->>'field',''))) not in ('date','target_date')
     or jsonb_typeof(v_draft) <> 'object' then
    raise exception '현재 작업은 날짜 선택 상태가 아닙니다.';
  end if;

  v_target := lower(btrim(coalesce(v_payload->>'targetIntent','')));
  if ((v_field='date' and v_target not in ('add_makeup','add_trial','add_waitlist'))
      or (v_field='target_date' and v_target not in ('update_makeup','update_trial')))
     or lower(btrim(coalesce(v_draft->>'action',''))) <> v_target then
    raise exception '날짜 선택 대상 작업이 올바르지 않습니다.';
  end if;

  v_draft := jsonb_set(v_draft,array[v_key],to_jsonb(v_date_expression),true);
  v_payload := jsonb_set(v_payload,'{draft}',v_draft,true);
  v_name := coalesce(nullif(btrim(v_draft->>'studentName'),''),'학생');
  v_body := v_name || ' · ' || v_date_expression
    || case when v_field='target_date' then E'\n변경 날짜를 선택했어요.' else E'\n날짜를 선택했어요.' end;

  update public.olli_team_chat_messages
  set body=v_body
  where academy_id=p_academy_id
    and id=v_action.message_id
    and deleted_at is null;

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
    'draft',v_draft,
    'message_body',v_body,
    'action',jsonb_build_object(
      'id',v_action.id,'action_type',v_action.action_type,'status',v_action.status,
      'revision',v_action.revision,'updated_at',v_action.updated_at,'resolved_at',v_action.resolved_at
    )
  );
end;
$function$;

revoke execute on function public.olli_team_chat_send_structured_date_choice(text,uuid,text,jsonb,uuid,bigint) from public;
revoke execute on function public.olli_team_chat_action_select_structured_date(text,uuid,uuid,text) from public;
grant execute on function public.olli_team_chat_send_structured_date_choice(text,uuid,text,jsonb,uuid,bigint) to anon, authenticated;
grant execute on function public.olli_team_chat_action_select_structured_date(text,uuid,uuid,text) to anon, authenticated;


create or replace function public.olli_team_chat_send_structured_time_choice(
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
     or lower(btrim(coalesce(v_payload->>'field',''))) not in ('time','target_time')
     or jsonb_typeof(v_payload->'choices') <> 'array'
     or jsonb_array_length(v_payload->'choices') < 1 then
    raise exception '시간 선택 정보 형식이 올바르지 않습니다.';
  end if;

  v_target := lower(btrim(coalesce(v_payload->>'targetIntent','')));
  if (lower(btrim(coalesce(v_payload->>'field','')))='time'
      and v_target not in ('add_makeup','add_trial','add_waitlist'))
     or (lower(btrim(coalesce(v_payload->>'field','')))='target_time'
      and v_target not in ('update_makeup','update_trial')) then
    raise exception '시간 선택 대상 작업이 올바르지 않습니다.';
  end if;

  v_draft := v_payload->'draft';
  if jsonb_typeof(v_draft) <> 'object'
     or lower(btrim(coalesce(v_draft->>'action',''))) <> v_target
     or nullif(btrim(v_draft->>'studentName'),'') is null
     or nullif(btrim(v_draft->>'division'),'') is null
     or (
       lower(btrim(coalesce(v_payload->>'field','')))='time'
       and nullif(btrim(v_draft->>'dateExpression'),'') is null
     )
     or (
       lower(btrim(coalesce(v_payload->>'field','')))='target_time'
       and nullif(btrim(v_draft->>'targetDateExpression'),'') is null
     ) then
    raise exception '시간 선택 draft 정보가 올바르지 않습니다.';
  end if;

  v_base_payload := v_draft || jsonb_build_object('intent',v_target);

  v_result := public.olli_team_chat_send_action(
    p_session_token,p_academy_id,p_body,v_target,v_base_payload,
    p_client_message_id,p_reply_to_message_id
  );
  if coalesce((v_result->>'ok')::boolean,false) is not true then
    raise exception '%',coalesce(nullif(v_result->>'message',''),'시간 선택 카드를 저장하지 못했습니다.');
  end if;

  v_action_id := nullif(v_result#>>'{message,action,id}','')::uuid;
  if v_action_id is null then raise exception '시간 선택 작업 식별값을 확인하지 못했습니다.'; end if;

  update public.olli_team_chat_actions
  set action_type='choose_structured_time',action_payload=v_payload,revision=revision+1,updated_at=now()
  where id=v_action_id and academy_id=p_academy_id and status='pending'
  returning * into v_action;
  if v_action.id is null then raise exception '시간 선택 작업을 저장하지 못했습니다.'; end if;

  v_result := jsonb_set(v_result,'{message,action,action_type}',to_jsonb(v_action.action_type),true);
  v_result := jsonb_set(v_result,'{message,action,revision}',to_jsonb(v_action.revision),true);
  v_result := jsonb_set(v_result,'{message,action,updated_at}',to_jsonb(v_action.updated_at),true);
  return v_result;
end;
$function$;

create or replace function public.olli_team_chat_get_structured_time_choice(
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
  v_account_id := public.olli_account_id_from_session(p_session_token);
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
  if v_action.id is null then raise exception '시간 선택 작업을 찾지 못했습니다.'; end if;
  if v_action.action_type <> 'choose_structured_time' then raise exception '현재 작업은 시간 선택 상태가 아닙니다.'; end if;

  v_payload:=v_action.action_payload;
  if jsonb_typeof(v_payload) <> 'object'
     or lower(btrim(coalesce(v_payload->>'field',''))) not in ('time','target_time')
     or jsonb_typeof(v_payload->'choices') <> 'array' then
    raise exception '시간 선택 상태가 올바르지 않습니다.';
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

create or replace function public.olli_team_chat_action_select_structured_time(
  p_session_token text,p_academy_id uuid,p_action_id uuid,p_time_slot integer
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
  v_label text;
  v_name text;
  v_date_expression text;
  v_body text;
  v_field text;
  v_key text;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;
  if p_academy_id is null or p_action_id is null or coalesce(p_time_slot,0)<=0 then
    raise exception '시간 선택 작업 정보를 확인해 주세요.';
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
  if v_action.id is null then raise exception '시간 선택 작업을 찾지 못했습니다.'; end if;

  v_payload:=v_action.action_payload;
  v_draft:=v_payload->'draft';
  v_field:=lower(btrim(coalesce(v_payload->>'field','')));
  v_key:=case when v_field='target_time' then 'targetTimeSlot' else 'timeSlot' end;

  if v_action.status='completed'
     and v_action.action_type='choose_structured_time'
     and coalesce((v_draft->>v_key)::integer,0)=p_time_slot then
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
      'ok',false,'message','이미 처리된 시간 선택입니다.',
      'action',jsonb_build_object(
        'id',v_action.id,'action_type',v_action.action_type,'status',v_action.status,
        'revision',v_action.revision,'updated_at',v_action.updated_at,'resolved_at',v_action.resolved_at
      )
    );
  end if;

  if v_action.action_type <> 'choose_structured_time'
     or jsonb_typeof(v_payload) <> 'object'
     or lower(btrim(coalesce(v_payload->>'field',''))) not in ('time','target_time')
     or jsonb_typeof(v_draft) <> 'object'
     or jsonb_typeof(v_payload->'choices') <> 'array' then
    raise exception '현재 작업은 시간 선택 상태가 아닙니다.';
  end if;

  select item.value into v_choice
  from jsonb_array_elements(v_payload->'choices') as item(value)
  where coalesce((item.value->>'timeSlot')::integer,0)=p_time_slot
    and coalesce((item.value->>'selectable')::boolean,false)=true
  limit 1;
  if v_choice is null then raise exception '선택할 수 없는 수업 시간입니다.'; end if;

  v_draft:=jsonb_set(v_draft,array[v_key],to_jsonb(p_time_slot),true);
  if v_field='target_time' then
    v_draft:=jsonb_set(v_draft,'{targetTimeStored}','true'::jsonb,true);
    v_draft:=jsonb_set(v_draft,'{targetMinute}','0'::jsonb,true);
  end if;
  v_payload:=jsonb_set(v_payload,'{draft}',v_draft,true);
  v_label:=coalesce(nullif(btrim(v_choice->>'label'),''),p_time_slot::text||'시');
  v_name:=coalesce(nullif(btrim(v_draft->>'studentName'),''),'학생');
  v_date_expression:=coalesce(
    nullif(btrim(v_draft->>case when v_field='target_time' then 'targetDateExpression' else 'dateExpression' end),''),
    '선택 날짜'
  );
  v_body:=v_name||' · '||v_date_expression||' · '||v_label
    || case when v_field='target_time' then E'\n변경 시간을 선택했어요.' else E'\n시간을 선택했어요.' end;

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

revoke execute on function public.olli_team_chat_send_structured_time_choice(text,uuid,text,jsonb,uuid,bigint) from public;
revoke execute on function public.olli_team_chat_get_structured_time_choice(text,uuid,uuid) from public;
revoke execute on function public.olli_team_chat_action_select_structured_time(text,uuid,uuid,integer) from public;
grant execute on function public.olli_team_chat_send_structured_time_choice(text,uuid,text,jsonb,uuid,bigint) to anon, authenticated;
grant execute on function public.olli_team_chat_get_structured_time_choice(text,uuid,uuid) to anon, authenticated;
grant execute on function public.olli_team_chat_action_select_structured_time(text,uuid,uuid,integer) to anon, authenticated;


