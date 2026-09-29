create or replace function public.olli_team_chat_send(
  p_session_token text,
  p_academy_id uuid,
  p_body text,
  p_client_message_id uuid default null,
  p_reply_to_message_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_message public.olli_team_chat_messages%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  v_client_message_id uuid := coalesce(p_client_message_id, extensions.gen_random_uuid());
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);

  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;

  if p_academy_id is null then
    raise exception '학원 ID가 없습니다.';
  end if;

  if char_length(v_body) < 1 then
    raise exception '메시지를 입력해 주세요.';
  end if;

  if char_length(v_body) > 5000 then
    raise exception '메시지는 5000자 이내로 입력해 주세요.';
  end if;

  select m.*
  into v_member
  from public.academy_members m
  join public.academies a on a.id = m.academy_id
  where m.academy_id = p_academy_id
    and m.account_id = v_account_id
    and m.status = 'active'
    and a.status = 'active'
    and a.deleted_at is null
  order by
    case m.role
      when 'owner' then 1
      when 'manager' then 2
      when 'teacher' then 3
      else 4
    end,
    m.created_at
  limit 1;

  if v_member.id is null then
    raise exception '현재 계정은 이 학원의 올리톡을 사용할 수 없습니다.';
  end if;

  if p_reply_to_message_id is not null and not exists (
    select 1
    from public.olli_team_chat_messages r
    where r.academy_id = p_academy_id
      and r.id = p_reply_to_message_id
      and r.deleted_at is null
  ) then
    raise exception '답장할 메시지를 찾지 못했습니다.';
  end if;

  insert into public.olli_team_chat_messages (
    academy_id,
    sender_member_id,
    sender_name_snapshot,
    message_type,
    body,
    reply_to_message_id,
    client_message_id
  )
  values (
    p_academy_id,
    v_member.id,
    v_member.display_name,
    'text',
    v_body,
    p_reply_to_message_id,
    v_client_message_id
  )
  on conflict (academy_id, client_message_id) do nothing
  returning * into v_message;

  if v_message.id is null then
    select m.*
    into v_message
    from public.olli_team_chat_messages m
    where m.academy_id = p_academy_id
      and m.client_message_id = v_client_message_id
    limit 1;
  end if;

  return jsonb_build_object(
    'ok', true,
    'message', jsonb_build_object(
      'id', v_message.id,
      'academy_id', v_message.academy_id,
      'sender_member_id', v_message.sender_member_id,
      'sender_name', v_message.sender_name_snapshot,
      'message_type', v_message.message_type,
      'body', v_message.body,
      'reply_to_message_id', v_message.reply_to_message_id,
      'client_message_id', v_message.client_message_id,
      'created_at', v_message.created_at
    )
  );
end;
$function$;

create or replace function public.olli_team_chat_list(
  p_session_token text,
  p_academy_id uuid,
  p_before_message_id bigint default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_messages jsonb;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);

  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;

  if p_academy_id is null then
    raise exception '학원 ID가 없습니다.';
  end if;

  select m.*
  into v_member
  from public.academy_members m
  join public.academies a on a.id = m.academy_id
  where m.academy_id = p_academy_id
    and m.account_id = v_account_id
    and m.status = 'active'
    and a.status = 'active'
    and a.deleted_at is null
  order by
    case m.role
      when 'owner' then 1
      when 'manager' then 2
      when 'teacher' then 3
      else 4
    end,
    m.created_at
  limit 1;

  if v_member.id is null then
    raise exception '현재 계정은 이 학원의 올리톡을 사용할 수 없습니다.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', x.id,
        'academy_id', x.academy_id,
        'sender_member_id', x.sender_member_id,
        'sender_name', x.sender_name_snapshot,
        'message_type', x.message_type,
        'body', x.body,
        'reply_to_message_id', x.reply_to_message_id,
        'client_message_id', x.client_message_id,
        'created_at', x.created_at
      )
      order by x.id asc
    ),
    '[]'::jsonb
  )
  into v_messages
  from (
    select m.*
    from public.olli_team_chat_messages m
    where m.academy_id = p_academy_id
      and m.deleted_at is null
      and (p_before_message_id is null or m.id < p_before_message_id)
    order by m.id desc
    limit v_limit
  ) x;

  return jsonb_build_object(
    'ok', true,
    'academy_id', p_academy_id,
    'current_member_id', v_member.id,
    'current_member_name', v_member.display_name,
    'messages', v_messages
  );
end;
$function$;

revoke all on function public.olli_team_chat_send(text, uuid, text, uuid, bigint) from public;
revoke all on function public.olli_team_chat_list(text, uuid, bigint, integer) from public;

grant execute on function public.olli_team_chat_send(text, uuid, text, uuid, bigint) to anon, authenticated, service_role;
grant execute on function public.olli_team_chat_list(text, uuid, bigint, integer) to anon, authenticated, service_role;

comment on function public.olli_team_chat_send(text, uuid, text, uuid, bigint)
  is 'Session-aware team chat send API. Validates active account membership and derives sender identity server-side.';

comment on function public.olli_team_chat_list(text, uuid, bigint, integer)
  is 'Session-aware team chat list API. Returns only messages for the active account membership academy.';
