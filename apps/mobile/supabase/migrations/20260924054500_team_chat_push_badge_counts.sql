-- Include each Team Chat recipient's current unread count in push targets
-- so the installed home-screen app icon can show the same badge count as Work.

create or replace function public.olli_team_chat_push_targets(
  p_session_token text,
  p_academy_id uuid,
  p_message_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_sender_member_id uuid;
  v_sender_name text;
  v_body text;
  v_targets jsonb;
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

  select msg.sender_name_snapshot, msg.body
  into v_sender_name, v_body
  from public.olli_team_chat_messages msg
  where msg.academy_id = p_academy_id
    and msg.id = p_message_id
    and msg.sender_member_id = v_sender_member_id
    and msg.deleted_at is null
  limit 1;

  if v_body is null then
    raise exception '현재 계정이 보낸 메시지만 푸시 알림을 전송할 수 있습니다.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'subscription_id', s.id,
        'member_id', mt.member_id,
        'endpoint', s.endpoint,
        'p256dh', s.p256dh,
        'auth', s.auth,
        'unread_count', (
          select count(*)::integer
          from public.olli_team_chat_mentions unread_mt
          where unread_mt.academy_id = mt.academy_id
            and unread_mt.member_id = mt.member_id
            and unread_mt.read_at is null
        )
      )
      order by mt.member_id, s.id
    ),
    '[]'::jsonb
  )
  into v_targets
  from public.olli_team_chat_mentions mt
  join public.academy_members target
    on target.id = mt.member_id
   and target.academy_id = mt.academy_id
   and target.status = 'active'
  join public.olli_team_chat_push_subscriptions s
    on s.academy_id = mt.academy_id
   and s.member_id = mt.member_id
   and s.disabled_at is null
  where mt.academy_id = p_academy_id
    and mt.message_id = p_message_id
    and mt.read_at is null
    and not exists (
      select 1
      from public.olli_team_chat_push_deliveries d
      where d.message_id = p_message_id
        and d.subscription_id = s.id
    );

  return jsonb_build_object(
    'ok', true,
    'sender_name', v_sender_name,
    'body', v_body,
    'message_id', p_message_id,
    'targets', v_targets
  );
end;
$function$;

revoke all on function public.olli_team_chat_push_targets(text, uuid, bigint) from public;
grant execute on function public.olli_team_chat_push_targets(text, uuid, bigint) to service_role;

comment on function public.olli_team_chat_push_targets(text, uuid, bigint)
is 'Returns unread Team Chat push recipients and each recipient current unread badge count.';