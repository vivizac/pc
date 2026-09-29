begin;

create index if not exists olli_team_material_push_deliveries_academy_idx
  on public.olli_team_material_push_deliveries (academy_id);

create index if not exists olli_team_material_push_deliveries_member_idx
  on public.olli_team_material_push_deliveries (member_id);

create index if not exists olli_team_material_push_deliveries_subscription_idx
  on public.olli_team_material_push_deliveries (subscription_id);

create or replace function public.olli_mobile_work_notification_summary(
  p_session_token text,
  p_academy_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_mention_unread integer := 0;
  v_latest_message_id bigint;
  v_latest_sender text;
  v_latest_body text;
  v_material_unread integer := 0;
  v_latest_material_event_id bigint;
  v_latest_material_item text;
  v_latest_material_requester text;
  v_last_read_material_event_id bigint := 0;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
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
    case m.role when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end,
    m.created_at
  limit 1;

  if v_member.id is null then
    raise exception '현재 계정은 이 학원의 Work 알림을 사용할 수 없습니다.';
  end if;

  select count(*)::integer, max(mt.message_id)
    into v_mention_unread, v_latest_message_id
  from public.olli_team_chat_mentions mt
  where mt.academy_id = p_academy_id
    and mt.member_id = v_member.id
    and mt.read_at is null;

  if v_latest_message_id is not null then
    select msg.sender_name_snapshot, msg.body
      into v_latest_sender, v_latest_body
    from public.olli_team_chat_messages msg
    where msg.academy_id = p_academy_id
      and msg.id = v_latest_message_id
      and msg.deleted_at is null
    limit 1;
  end if;

  if v_member.role in ('owner','manager') then
    select coalesce(s.last_read_material_event_id, 0)
      into v_last_read_material_event_id
    from public.olli_team_chat_member_state s
    where s.academy_id = p_academy_id
      and s.member_id = v_member.id;

    v_last_read_material_event_id := coalesce(v_last_read_material_event_id, 0);

    select count(*)::integer, max(e.id)
      into v_material_unread, v_latest_material_event_id
    from public.olli_team_material_request_events e
    where e.academy_id = p_academy_id
      and e.event_type = 'created'
      and e.id > v_last_read_material_event_id;

    if v_latest_material_event_id is not null then
      select r.item_name, r.requested_by_name_snapshot
        into v_latest_material_item, v_latest_material_requester
      from public.olli_team_material_request_events e
      join public.olli_team_material_requests r
        on r.id = e.request_id
       and r.academy_id = e.academy_id
      where e.academy_id = p_academy_id
        and e.id = v_latest_material_event_id
      limit 1;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'member_id', v_member.id,
    'current_role', v_member.role,
    'mention_unread_count', coalesce(v_mention_unread, 0),
    'material_unread_count', coalesce(v_material_unread, 0),
    'unread_count', coalesce(v_mention_unread, 0) + coalesce(v_material_unread, 0),
    'latest_message_id', v_latest_message_id,
    'latest_sender_name', v_latest_sender,
    'latest_body', v_latest_body,
    'latest_material_event_id', v_latest_material_event_id,
    'latest_material_item', v_latest_material_item,
    'latest_material_requester', v_latest_material_requester
  );
end;
$function$;

create or replace function public.olli_mobile_work_mark_material_read(
  p_session_token text,
  p_academy_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_latest_event_id bigint;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
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
    case m.role when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end,
    m.created_at
  limit 1;

  if v_member.id is null then
    raise exception '현재 계정은 이 학원의 Work 알림을 사용할 수 없습니다.';
  end if;

  if v_member.role not in ('owner','manager') then
    return jsonb_build_object('ok', true, 'marked_read', false, 'latest_material_event_id', null);
  end if;

  select max(e.id)
    into v_latest_event_id
  from public.olli_team_material_request_events e
  where e.academy_id = p_academy_id
    and e.event_type = 'created';

  insert into public.olli_team_chat_member_state (
    academy_id,
    member_id,
    last_read_material_event_id,
    last_read_material_at,
    updated_at
  )
  values (
    p_academy_id,
    v_member.id,
    v_latest_event_id,
    now(),
    now()
  )
  on conflict (academy_id, member_id)
  do update set
    last_read_material_event_id = greatest(
      coalesce(public.olli_team_chat_member_state.last_read_material_event_id, 0),
      coalesce(excluded.last_read_material_event_id, 0)
    ),
    last_read_material_at = now(),
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'marked_read', true,
    'latest_material_event_id', v_latest_event_id
  );
end;
$function$;

create or replace function public.olli_team_material_push_targets(
  p_session_token text,
  p_academy_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_sender_member_id uuid;
  v_request public.olli_team_material_requests%rowtype;
  v_event_id bigint;
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
    raise exception '현재 계정은 이 학원의 재료주문 알림을 사용할 수 없습니다.';
  end if;

  select r.*
    into v_request
  from public.olli_team_material_requests r
  where r.id = p_request_id
    and r.academy_id = p_academy_id
    and r.requested_by_member_id = v_sender_member_id
    and r.deleted_at is null
  limit 1;

  if v_request.id is null then
    raise exception '현재 계정이 등록한 재료주문만 알림을 전송할 수 있습니다.';
  end if;

  select max(e.id)
    into v_event_id
  from public.olli_team_material_request_events e
  where e.academy_id = p_academy_id
    and e.request_id = p_request_id
    and e.event_type = 'created';

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'subscription_id', s.id,
        'member_id', target.id,
        'endpoint', s.endpoint,
        'p256dh', s.p256dh,
        'auth', s.auth,
        'unread_count',
          (
            select count(*)::integer
            from public.olli_team_chat_mentions mt
            where mt.academy_id = p_academy_id
              and mt.member_id = target.id
              and mt.read_at is null
          )
          +
          (
            select count(*)::integer
            from public.olli_team_material_request_events unread_e
            left join public.olli_team_chat_member_state st
              on st.academy_id = p_academy_id
             and st.member_id = target.id
            where unread_e.academy_id = p_academy_id
              and unread_e.event_type = 'created'
              and unread_e.id > coalesce(st.last_read_material_event_id, 0)
          )
      )
      order by target.id, s.id
    ),
    '[]'::jsonb
  )
    into v_targets
  from public.academy_members target
  join public.olli_team_chat_push_subscriptions s
    on s.academy_id = target.academy_id
   and s.member_id = target.id
   and s.disabled_at is null
  where target.academy_id = p_academy_id
    and target.status = 'active'
    and target.role in ('owner','manager')
    and not exists (
      select 1
      from public.olli_team_material_push_deliveries d
      where d.request_id = p_request_id
        and d.subscription_id = s.id
    );

  return jsonb_build_object(
    'ok', true,
    'request_id', v_request.id,
    'event_id', v_event_id,
    'item_name', v_request.item_name,
    'quantity_text', v_request.quantity_text,
    'requester_name', v_request.requested_by_name_snapshot,
    'targets', v_targets
  );
end;
$function$;

revoke all on function public.olli_team_material_push_targets(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.olli_team_material_push_targets(text, uuid, uuid) to service_role;

commit;
