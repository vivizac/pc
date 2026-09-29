alter table public.olli_team_chat_messages
  drop constraint if exists olli_team_chat_messages_message_type_check;

alter table public.olli_team_chat_messages
  add constraint olli_team_chat_messages_message_type_check
  check (message_type = any (array['text'::text, 'system'::text, 'ai'::text]));

create or replace function public.olli_team_chat_send_ai(
  p_session_token text,
  p_academy_id uuid,
  p_body text,
  p_client_message_id uuid default null,
  p_reply_to_message_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
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
    raise exception '올리 응답 내용이 없습니다.';
  end if;

  if char_length(v_body) > 5000 then
    raise exception '올리 응답은 5000자 이내여야 합니다.';
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
    null,
    '올리',
    'ai',
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
