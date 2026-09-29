CREATE OR REPLACE FUNCTION public.olli_mobile_work_notification_summary(p_session_token text, p_academy_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_chat_unread integer := 0;
  v_latest_message_id bigint;
  v_latest_sender text;
  v_latest_body text;
  v_material_unread integer := 0;
  v_latest_material_event_id bigint;
  v_latest_material_item text;
  v_latest_material_requester text;
  v_last_read_message_id bigint := 0;
  v_last_read_material_event_id bigint := 0;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;

  select m.* into v_member
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id
    and m.account_id=v_account_id
    and m.status='active'
    and a.status='active'
    and a.deleted_at is null
  order by case m.role when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end,m.created_at
  limit 1;

  if v_member.id is null then
    raise exception '현재 계정은 이 학원의 Work 알림을 사용할 수 없습니다.';
  end if;

  select coalesce(s.last_read_message_id,0),coalesce(s.last_read_material_event_id,0)
    into v_last_read_message_id,v_last_read_material_event_id
  from public.olli_team_chat_member_state s
  where s.academy_id=p_academy_id and s.member_id=v_member.id;

  v_last_read_message_id:=coalesce(v_last_read_message_id,0);
  v_last_read_material_event_id:=coalesce(v_last_read_material_event_id,0);

  select count(*)::integer,max(msg.id)
    into v_chat_unread,v_latest_message_id
  from public.olli_team_chat_messages msg
  where msg.academy_id=p_academy_id
    and msg.deleted_at is null
    and msg.id>v_last_read_message_id
    and msg.sender_member_id is distinct from v_member.id
    and msg.material_event_id is null
    and (
      msg.audience='all'
      or (msg.audience='management' and v_member.role in ('owner','manager'))
    )
    and (
      (
        exists(select 1 from public.olli_team_chat_mentions any_mt
               where any_mt.academy_id=msg.academy_id and any_mt.message_id=msg.id)
        and exists(select 1 from public.olli_team_chat_mentions mine
                   where mine.academy_id=msg.academy_id
                     and mine.message_id=msg.id
                     and mine.member_id=v_member.id
                     and mine.read_at is null)
      )
      or
      not exists(select 1 from public.olli_team_chat_mentions any_mt
                 where any_mt.academy_id=msg.academy_id and any_mt.message_id=msg.id)
    );

  if v_latest_message_id is not null then
    select msg.sender_name_snapshot,msg.body
      into v_latest_sender,v_latest_body
    from public.olli_team_chat_messages msg
    where msg.academy_id=p_academy_id and msg.id=v_latest_message_id
    limit 1;
  end if;

  if v_member.role in ('owner','manager') then
    select count(*)::integer,max(e.id)
      into v_material_unread,v_latest_material_event_id
    from public.olli_team_material_request_events e
    where e.academy_id=p_academy_id
      and e.event_type='created'
      and e.id>v_last_read_material_event_id;

    if v_latest_material_event_id is not null then
      select r.item_name,r.requested_by_name_snapshot
        into v_latest_material_item,v_latest_material_requester
      from public.olli_team_material_request_events e
      join public.olli_team_material_requests r
        on r.id=e.request_id and r.academy_id=e.academy_id
      where e.academy_id=p_academy_id and e.id=v_latest_material_event_id
      limit 1;
    end if;
  end if;

  return jsonb_build_object(
    'ok',true,
    'member_id',v_member.id,
    'current_role',v_member.role,
    'chat_unread_count',coalesce(v_chat_unread,0),
    'mention_unread_count',coalesce(v_chat_unread,0),
    'material_unread_count',coalesce(v_material_unread,0),
    'unread_count',coalesce(v_chat_unread,0)+coalesce(v_material_unread,0),
    'latest_message_id',v_latest_message_id,
    'latest_sender_name',v_latest_sender,
    'latest_body',v_latest_body,
    'latest_material_event_id',v_latest_material_event_id,
    'latest_material_item',v_latest_material_item,
    'latest_material_requester',v_latest_material_requester
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.olli_team_chat_push_targets(p_session_token text, p_academy_id uuid, p_message_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_sender_member_id uuid;
  v_sender_name text;
  v_body text;
  v_has_mentions boolean := false;
  v_targets jsonb;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;

  select m.id into v_sender_member_id
  from public.academy_members m
  where m.academy_id=p_academy_id
    and m.account_id=v_account_id
    and m.status='active'
  order by m.created_at
  limit 1;

  if v_sender_member_id is null then
    raise exception '현재 계정은 이 학원의 올리톡을 사용할 수 없습니다.';
  end if;

  select msg.sender_name_snapshot,msg.body
    into v_sender_name,v_body
  from public.olli_team_chat_messages msg
  where msg.academy_id=p_academy_id
    and msg.id=p_message_id
    and msg.sender_member_id=v_sender_member_id
    and msg.deleted_at is null
  limit 1;

  if v_body is null then
    raise exception '현재 계정이 보낸 메시지만 푸시 알림을 전송할 수 있습니다.';
  end if;

  select exists(
    select 1
    from public.olli_team_chat_mentions mt
    where mt.academy_id=p_academy_id
      and mt.message_id=p_message_id
  ) into v_has_mentions;

  select coalesce(jsonb_agg(jsonb_build_object(
    'subscription_id',s.id,
    'member_id',target.id,
    'endpoint',s.endpoint,
    'p256dh',s.p256dh,
    'auth',s.auth,
    'unread_count',
      (
        select count(*)::integer
        from public.olli_team_chat_messages um
        left join public.olli_team_chat_member_state st
          on st.academy_id=p_academy_id and st.member_id=target.id
        where um.academy_id=p_academy_id
          and um.deleted_at is null
          and um.id>coalesce(st.last_read_message_id,0)
          and um.sender_member_id is distinct from target.id
          and um.material_event_id is null
          and (
            um.audience='all'
            or (um.audience='management' and target.role in ('owner','manager'))
          )
          and (
            (
              exists(select 1 from public.olli_team_chat_mentions mm
                     where mm.academy_id=um.academy_id and mm.message_id=um.id)
              and exists(select 1 from public.olli_team_chat_mentions mine
                         where mine.academy_id=um.academy_id
                           and mine.message_id=um.id
                           and mine.member_id=target.id
                           and mine.read_at is null)
            )
            or
            not exists(select 1 from public.olli_team_chat_mentions mm
                       where mm.academy_id=um.academy_id and mm.message_id=um.id)
          )
      )
      +
      case when target.role in ('owner','manager') then (
        select count(*)::integer
        from public.olli_team_material_request_events me
        left join public.olli_team_chat_member_state mst
          on mst.academy_id=p_academy_id and mst.member_id=target.id
        where me.academy_id=p_academy_id
          and me.event_type='created'
          and me.id>coalesce(mst.last_read_material_event_id,0)
      ) else 0 end
  ) order by target.id,s.id),'[]'::jsonb)
  into v_targets
  from public.academy_members target
  join public.olli_team_chat_push_subscriptions s
    on s.academy_id=target.academy_id
   and s.member_id=target.id
   and s.disabled_at is null
  where target.academy_id=p_academy_id
    and target.status='active'
    and target.id<>v_sender_member_id
    and (
      (
        v_has_mentions
        and exists(
          select 1 from public.olli_team_chat_mentions mt
          where mt.academy_id=p_academy_id
            and mt.message_id=p_message_id
            and mt.member_id=target.id
            and mt.read_at is null
        )
      )
      or
      (not v_has_mentions)
    )
    and not exists(
      select 1 from public.olli_team_chat_push_deliveries d
      where d.message_id=p_message_id and d.subscription_id=s.id
    );

  return jsonb_build_object(
    'ok',true,
    'sender_name',v_sender_name,
    'body',v_body,
    'message_id',p_message_id,
    'target_mode',case when v_has_mentions then 'mentions' else 'all' end,
    'targets',v_targets
  );
end;
$function$;

