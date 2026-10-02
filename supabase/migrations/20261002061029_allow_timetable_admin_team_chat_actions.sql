-- Follow-up for the already-applied timetable admin Agent migration.
-- The executor and action constraint already support timetable admin types;
-- this only lets olli_team_chat_send_action persist those pending confirmation cards.

CREATE OR REPLACE FUNCTION public.olli_team_chat_send_action(
  p_session_token text,
  p_academy_id uuid,
  p_body text,
  p_action_type text,
  p_action_payload jsonb,
  p_client_message_id uuid DEFAULT NULL::uuid,
  p_reply_to_message_id bigint DEFAULT NULL::bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_message public.olli_team_chat_messages%rowtype;
  v_action public.olli_team_chat_actions%rowtype;
  v_body text := btrim(coalesce(p_body,''));
  v_action_type text := lower(btrim(coalesce(p_action_type,'')));
  v_payload jsonb := coalesce(p_action_payload,'{}'::jsonb);
  v_client_message_id uuid := coalesce(p_client_message_id, extensions.gen_random_uuid());
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;
  if p_academy_id is null then raise exception '학원 ID가 없습니다.'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 5000 then raise exception '확인 메시지 내용을 확인해 주세요.'; end if;
  if jsonb_typeof(v_payload) <> 'object' or octet_length(v_payload::text) > 12000 then raise exception '작업 정보 형식이 올바르지 않습니다.'; end if;
  if v_action_type not in (
    'add_class_once','cancel_class_once','add_pickup',
    'update_pickup_arrival','update_pickup_dropoff','cancel_pickup','cancel_pickup_dropoff',
    'add_makeup','update_makeup','cancel_makeup',
    'add_trial','update_trial','cancel_trial',
    'add_waitlist','update_waitlist','cancel_waitlist',
    'move_class','cancel_move','mark_absent',
    'add_timetable_memo','delete_timetable_memo',
    'set_class_layout','set_class_teacher','set_teacher_override','set_session_order','set_normal_class_day'
  ) then raise exception '지원하지 않는 작업입니다.'; end if;
  if lower(coalesce(v_payload->>'intent','')) <> v_action_type then raise exception '작업 종류가 일치하지 않습니다.'; end if;

  select m.* into v_member
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id and m.account_id=v_account_id and m.status='active'
    and a.status='active' and a.deleted_at is null
  order by case m.role when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end, m.created_at
  limit 1;
  if v_member.id is null then raise exception '현재 계정은 이 학원의 팀톡을 사용할 수 없습니다.'; end if;

  if p_reply_to_message_id is not null and not exists (
    select 1 from public.olli_team_chat_messages r
    where r.academy_id=p_academy_id and r.id=p_reply_to_message_id and r.deleted_at is null
  ) then raise exception '답장할 메시지를 찾지 못했습니다.'; end if;

  insert into public.olli_team_chat_messages(
    academy_id,sender_member_id,sender_name_snapshot,message_type,body,reply_to_message_id,client_message_id
  )
  values(p_academy_id,null,'올리','ai',v_body,p_reply_to_message_id,v_client_message_id)
  on conflict (academy_id,client_message_id) do nothing
  returning * into v_message;

  if v_message.id is null then
    select m.* into v_message
    from public.olli_team_chat_messages m
    where m.academy_id=p_academy_id and m.client_message_id=v_client_message_id
    limit 1;
  end if;

  insert into public.olli_team_chat_actions(academy_id,message_id,action_type,action_payload,requested_by_member_id)
  values(p_academy_id,v_message.id,v_action_type,v_payload,v_member.id)
  on conflict (academy_id,message_id) do nothing
  returning * into v_action;

  if v_action.id is null then
    select a.* into v_action
    from public.olli_team_chat_actions a
    where a.academy_id=p_academy_id and a.message_id=v_message.id
    limit 1;
    if v_action.id is null then raise exception '작업 카드를 저장하지 못했습니다.'; end if;
    if v_action.action_type <> v_action_type or v_action.action_payload <> v_payload then
      raise exception '같은 요청 키가 다른 작업에 이미 사용되었습니다.';
    end if;
  end if;

  return jsonb_build_object(
    'ok',true,
    'message',jsonb_build_object(
      'id',v_message.id,'academy_id',v_message.academy_id,
      'sender_member_id',v_message.sender_member_id,'sender_name',v_message.sender_name_snapshot,
      'message_type',v_message.message_type,'body',v_message.body,
      'reply_to_message_id',v_message.reply_to_message_id,'client_message_id',v_message.client_message_id,
      'created_at',v_message.created_at,
      'action',jsonb_build_object(
        'id',v_action.id,'action_type',v_action.action_type,'status',v_action.status,
        'revision',v_action.revision,'created_at',v_action.created_at,'updated_at',v_action.updated_at,
        'resolved_at',v_action.resolved_at,'error',v_action.error_text
      )
    )
  );
end;
$function$;

revoke execute on function public.olli_team_chat_send_action(text,uuid,text,text,jsonb,uuid,bigint) from public;
grant execute on function public.olli_team_chat_send_action(text,uuid,text,text,jsonb,uuid,bigint) to anon, authenticated;
