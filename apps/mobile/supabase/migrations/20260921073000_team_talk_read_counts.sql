create or replace function public.olli_team_chat_mark_read(
  p_session_token text,
  p_academy_id uuid,
  p_up_to_message_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_member_id uuid;
  v_target_message_id bigint;
  v_previous_message_id bigint;
  v_mentions_updated integer := 0;
  v_state_changed boolean := false;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;

  select m.id into v_member_id
  from public.academy_members m
  join public.academies a on a.id = m.academy_id
  where m.academy_id = p_academy_id and m.account_id = v_account_id and m.status = 'active'
    and a.status = 'active' and a.deleted_at is null
  order by m.created_at limit 1;

  if v_member_id is null then raise exception '현재 계정은 이 학원의 팀톡을 사용할 수 없습니다.'; end if;

  if p_up_to_message_id is null then
    select max(msg.id) into v_target_message_id
    from public.olli_team_chat_messages msg
    where msg.academy_id = p_academy_id and msg.deleted_at is null;
  else
    select msg.id into v_target_message_id
    from public.olli_team_chat_messages msg
    where msg.academy_id = p_academy_id and msg.id = p_up_to_message_id and msg.deleted_at is null;
  end if;

  if v_target_message_id is null then
    return jsonb_build_object('ok', true, 'last_read_message_id', null, 'marked_mentions_read', 0);
  end if;

  select s.last_read_message_id into v_previous_message_id
  from public.olli_team_chat_member_state s
  where s.academy_id = p_academy_id and s.member_id = v_member_id;

  if coalesce(v_previous_message_id, 0) < v_target_message_id then
    insert into public.olli_team_chat_member_state (academy_id, member_id, last_read_message_id, last_read_at, updated_at)
    values (p_academy_id, v_member_id, v_target_message_id, now(), now())
    on conflict (academy_id, member_id)
    do update set last_read_message_id = excluded.last_read_message_id, last_read_at = excluded.last_read_at, updated_at = excluded.updated_at
    where coalesce(public.olli_team_chat_member_state.last_read_message_id, 0) < excluded.last_read_message_id;
    v_state_changed := true;
  end if;

  update public.olli_team_chat_mentions
  set read_at = now()
  where academy_id = p_academy_id and member_id = v_member_id and read_at is null and message_id <= v_target_message_id;
  get diagnostics v_mentions_updated = row_count;

  if v_state_changed or v_mentions_updated > 0 then
    perform private.olli_realtime_send_signal(p_academy_id, 'chat', v_target_message_id);
  end if;

  return jsonb_build_object('ok', true, 'last_read_message_id', v_target_message_id, 'marked_mentions_read', v_mentions_updated);
end;
$function$;

revoke all on function public.olli_team_chat_mark_read(text, uuid, bigint) from public;
grant execute on function public.olli_team_chat_mark_read(text, uuid, bigint) to anon, authenticated, service_role;

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
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;
  if p_academy_id is null then raise exception '학원 ID가 없습니다.'; end if;

  select m.* into v_member
  from public.academy_members m
  join public.academies a on a.id = m.academy_id
  where m.academy_id = p_academy_id and m.account_id = v_account_id and m.status = 'active'
    and a.status = 'active' and a.deleted_at is null
  order by case m.role when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end, m.created_at
  limit 1;

  if v_member.id is null then raise exception '현재 계정은 이 학원의 팀톡을 사용할 수 없습니다.'; end if;

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
        'created_at', x.created_at,
        'unread_count',
          case
            when exists (
              select 1 from public.olli_team_chat_mentions mt
              where mt.academy_id = x.academy_id and mt.message_id = x.id
            )
            then (
              select count(*)::integer
              from public.olli_team_chat_mentions mt
              where mt.academy_id = x.academy_id and mt.message_id = x.id and mt.read_at is null
            )
            else (
              select count(*)::integer
              from public.academy_members am
              left join public.olli_team_chat_member_state st
                on st.academy_id = am.academy_id and st.member_id = am.id
              where am.academy_id = x.academy_id
                and am.status = 'active'
                and am.account_id is not null
                and (x.sender_member_id is null or am.id <> x.sender_member_id)
                and coalesce(st.last_read_message_id, 0) < x.id
            )
          end
      )
      order by x.id asc
    ),
    '[]'::jsonb
  ) into v_messages
  from (
    select msg.*
    from public.olli_team_chat_messages msg
    where msg.academy_id = p_academy_id and msg.deleted_at is null
      and (p_before_message_id is null or msg.id < p_before_message_id)
    order by msg.id desc
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

revoke all on function public.olli_team_chat_list(text, uuid, bigint, integer) from public;
grant execute on function public.olli_team_chat_list(text, uuid, bigint, integer) to anon, authenticated, service_role;
