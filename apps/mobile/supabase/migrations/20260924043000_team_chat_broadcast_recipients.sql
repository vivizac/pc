-- Team Chat notification recipients:
-- explicit member_ids => only those members
-- empty/null member_ids => every active academy member except the sender

create or replace function public.olli_team_chat_set_mentions(
  p_session_token text,
  p_academy_id uuid,
  p_message_id bigint,
  p_member_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_sender_member_id uuid;
  v_inserted integer := 0;
  v_target_ids uuid[] := coalesce(p_member_ids, array[]::uuid[]);
  v_broadcast boolean := coalesce(cardinality(coalesce(p_member_ids, array[]::uuid[])), 0) = 0;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;

  select m.id
  into v_sender_member_id
  from public.academy_members m
  where m.academy_id = p_academy_id
    and m.account_id = v_account_id
    and m.status = 'active'
  order by m.created_at
  limit 1;

  if v_sender_member_id is null then
    raise exception '현재 계정은 이 학원의 올리톡을 사용할 수 없습니다.';
  end if;

  if not exists (
    select 1
    from public.olli_team_chat_messages msg
    where msg.academy_id = p_academy_id
      and msg.id = p_message_id
      and msg.sender_member_id = v_sender_member_id
      and msg.deleted_at is null
  ) then
    raise exception '현재 계정이 보낸 메시지만 알림 대상을 지정할 수 있습니다.';
  end if;

  insert into public.olli_team_chat_mentions (academy_id, message_id, member_id)
  select p_academy_id, p_message_id, m.id
  from public.academy_members m
  where m.academy_id = p_academy_id
    and m.status = 'active'
    and m.account_id is not null
    and m.id <> v_sender_member_id
    and (v_broadcast or m.id = any(v_target_ids))
  on conflict (message_id, member_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted > 0 then
    perform private.olli_realtime_send_signal(p_academy_id, 'chat', p_message_id);
  end if;

  return jsonb_build_object(
    'ok', true,
    'mentioned_count', v_inserted,
    'recipient_count', v_inserted,
    'broadcast', v_broadcast
  );
end;
$function$;

revoke all on function public.olli_team_chat_set_mentions(text, uuid, bigint, uuid[]) from public;
grant execute on function public.olli_team_chat_set_mentions(text, uuid, bigint, uuid[]) to anon, authenticated, service_role;

comment on function public.olli_team_chat_set_mentions(text, uuid, bigint, uuid[])
is 'Registers Team Chat notification recipients. Empty member_ids broadcasts to all active academy members except sender.';
