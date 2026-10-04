-- Allow the existing structured student disambiguation card to continue pickup updates.
-- No schedule mutation is added here; this only persists the selected canonical student name.

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
  if v_target not in ('add_makeup','add_trial','add_waitlist','update_pickup') then
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


revoke execute on function public.olli_team_chat_send_structured_student_choice(text,uuid,text,jsonb,uuid,bigint) from public;
grant execute on function public.olli_team_chat_send_structured_student_choice(text,uuid,text,jsonb,uuid,bigint) to anon, authenticated;
