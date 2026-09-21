-- Team Talk action-card cross-device sync.
-- Cancelling a pending card now creates one system message so the existing
-- chat realtime domain causes both PC and phone to refresh the action status.

create or replace function public.olli_team_chat_action_cancel(
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
  v_result_message_id bigint;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;

  select m.id into v_member_id
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id
    and m.account_id=v_account_id
    and m.status='active'
    and a.status='active'
    and a.deleted_at is null
  order by case m.role when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end, m.created_at
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
    raise exception '작업 요청을 찾지 못했습니다.';
  end if;

  if v_action.status='pending' then
    insert into public.olli_team_chat_messages(
      academy_id,sender_member_id,sender_name_snapshot,message_type,body,client_message_id
    )
    values(
      p_academy_id,null,'올리','system','작업 요청을 취소했어요.',extensions.gen_random_uuid()
    )
    returning id into v_result_message_id;

    update public.olli_team_chat_actions
    set status='cancelled',
        resolved_by_member_id=v_member_id,
        result_message_id=v_result_message_id,
        resolved_at=now(),
        updated_at=now(),
        error_text=null,
        revision=revision+1
    where id=v_action.id
    returning * into v_action;

    return jsonb_build_object(
      'ok',true,'changed',true,
      'action',jsonb_build_object(
        'id',v_action.id,'action_type',v_action.action_type,'status',v_action.status,
        'revision',v_action.revision,'updated_at',v_action.updated_at,
        'resolved_at',v_action.resolved_at,'error',v_action.error_text,
        'result_message_id',v_action.result_message_id
      ),
      'result_message_id',v_result_message_id
    );
  end if;

  if v_action.status='cancelled' then
    return jsonb_build_object(
      'ok',true,'changed',false,
      'action',jsonb_build_object(
        'id',v_action.id,'action_type',v_action.action_type,'status',v_action.status,
        'revision',v_action.revision,'updated_at',v_action.updated_at,
        'resolved_at',v_action.resolved_at,'error',v_action.error_text,
        'result_message_id',v_action.result_message_id
      ),
      'result_message_id',v_action.result_message_id
    );
  end if;

  return jsonb_build_object(
    'ok',false,
    'message','이미 처리된 작업은 취소할 수 없습니다.',
    'action',jsonb_build_object(
      'id',v_action.id,'action_type',v_action.action_type,'status',v_action.status,
      'revision',v_action.revision,'updated_at',v_action.updated_at,
      'resolved_at',v_action.resolved_at,'error',v_action.error_text,
      'result_message_id',v_action.result_message_id
    )
  );
end;
$function$;

revoke execute on function public.olli_team_chat_action_cancel(text,uuid,uuid) from public;
grant execute on function public.olli_team_chat_action_cancel(text,uuid,uuid) to anon, authenticated;
