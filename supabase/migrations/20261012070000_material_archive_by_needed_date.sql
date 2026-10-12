-- Material request list/archive uses Korean local date when needed_on has passed.

-- No existing request records, revisions or statuses are modified.

begin;

create index if not exists olli_team_material_requests_needed_on_archive_idx on public.olli_team_material_requests (academy_id, needed_on desc, created_at desc) where deleted_at is null and needed_on is not null;

CREATE OR REPLACE FUNCTION public.olli_team_material_requests_list(p_session_token text, p_academy_id uuid, p_limit integer DEFAULT 300)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_limit integer := greatest(1, least(coalesce(p_limit, 300), 500));
  v_items jsonb;
  v_summary jsonb;
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
    raise exception '현재 계정은 이 학원의 재료주문을 사용할 수 없습니다.';
  end if;

  select jsonb_build_object(
    'requested', count(*) filter (where r.status = 'requested'),
    'on_hold', count(*) filter (where r.status = 'on_hold'),
    'ordered', count(*) filter (where r.status = 'ordered'),
    'arrived', count(*) filter (where r.status = 'arrived')
  )
    into v_summary
  from public.olli_team_material_requests r
  where r.academy_id = p_academy_id
    and r.deleted_at is null
    and (r.needed_on is null or r.needed_on >= (now() at time zone 'Asia/Seoul')::date);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', x.id,
        'item_name', x.item_name,
        'quantity_text', x.quantity_text,
        'needed_on', x.needed_on,
        'use_context', x.use_context,
        'purchase_url', x.purchase_url,
        'memo', x.memo,
        'status', x.status,
        'hold_reason', x.hold_reason,
        'requested_by_member_id', x.requested_by_member_id,
        'requested_by_name', x.requested_by_name_snapshot,
        'status_changed_by_member_id', x.status_changed_by_member_id,
        'status_changed_by_name', x.status_changed_by_name,
        'status_changed_at', x.status_changed_at,
        'ordered_at', x.ordered_at,
        'arrived_at', x.arrived_at,
        'revision', x.revision,
        'created_at', x.created_at,
        'updated_at', x.updated_at
      )
      order by
        case x.status when 'requested' then 1 when 'on_hold' then 2 when 'ordered' then 3 when 'arrived' then 4 else 5 end,
        x.needed_on nulls last,
        x.created_at desc
    ),
    '[]'::jsonb
  )
    into v_items
  from (
    select
      r.*,
      changed.display_name as status_changed_by_name
    from public.olli_team_material_requests r
    left join public.academy_members changed on changed.id = r.status_changed_by_member_id
    where r.academy_id = p_academy_id
      and r.deleted_at is null
      and (r.needed_on is null or r.needed_on >= (now() at time zone 'Asia/Seoul')::date)
    order by
      case r.status when 'requested' then 1 when 'on_hold' then 2 when 'ordered' then 3 when 'arrived' then 4 else 5 end,
      r.needed_on nulls last,
      r.created_at desc
    limit v_limit
  ) x;

  return jsonb_build_object(
    'ok', true,
    'academy_id', p_academy_id,
    'current_member_id', v_member.id,
    'current_role', v_member.role,
    'can_process', v_member.role in ('owner','manager'),
    'summary', coalesce(v_summary, '{}'::jsonb),
    'items', coalesce(v_items, '[]'::jsonb)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.olli_team_material_requests_archive(p_session_token text, p_academy_id uuid, p_year integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_year integer := p_year;
  v_years jsonb;
  v_items jsonb := '[]'::jsonb;
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
    raise exception '현재 계정은 이 학원의 재료주문 보관함을 사용할 수 없습니다.';
  end if;

  if v_year is not null and (v_year < 2000 or v_year > 2100) then
    raise exception '보관함 연도를 확인해 주세요.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'year', grouped.archive_year,
        'count', grouped.archive_count
      )
      order by grouped.archive_year desc
    ),
    '[]'::jsonb
  )
    into v_years
  from (
    select
      extract(year from r.needed_on)::integer as archive_year,
      count(*)::integer as archive_count
    from public.olli_team_material_requests r
    where r.academy_id = p_academy_id
      and r.deleted_at is null
      and r.needed_on is not null
      and r.needed_on < (now() at time zone 'Asia/Seoul')::date
    group by extract(year from r.needed_on)::integer
  ) grouped;

  if v_year is not null then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', x.id,
          'item_name', x.item_name,
          'quantity_text', x.quantity_text,
          'needed_on', x.needed_on,
          'use_context', x.use_context,
          'purchase_url', x.purchase_url,
          'memo', x.memo,
          'status', x.status,
          'hold_reason', x.hold_reason,
          'requested_by_member_id', x.requested_by_member_id,
          'requested_by_name', x.requested_by_name_snapshot,
          'status_changed_by_member_id', x.status_changed_by_member_id,
          'status_changed_by_name', x.status_changed_by_name,
          'status_changed_at', x.status_changed_at,
          'ordered_at', x.ordered_at,
          'arrived_at', x.arrived_at,
          'revision', x.revision,
          'created_at', x.created_at,
          'updated_at', x.updated_at
        )
        order by x.needed_on desc, x.created_at desc
      ),
      '[]'::jsonb
    )
      into v_items
    from (
      select
        r.*,
        changed.display_name as status_changed_by_name
      from public.olli_team_material_requests r
      left join public.academy_members changed
        on changed.id = r.status_changed_by_member_id
      where r.academy_id = p_academy_id
        and r.deleted_at is null
        and r.needed_on is not null
        and r.needed_on < (now() at time zone 'Asia/Seoul')::date
        and extract(year from r.needed_on)::integer = v_year
      order by r.needed_on desc, r.created_at desc
    ) x;
  end if;

  return jsonb_build_object(
    'ok', true,
    'academy_id', p_academy_id,
    'current_member_id', v_member.id,
    'archive_basis', 'needed_on_past',
    'years', coalesce(v_years, '[]'::jsonb),
    'selected_year', v_year,
    'items', coalesce(v_items, '[]'::jsonb)
  );
end;
$function$
;

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

  select coalesce(s.last_read_message_id, 0)
    into v_last_read_message_id
  from public.olli_team_chat_member_state s
  where s.academy_id = p_academy_id
    and s.member_id = v_member.id;

  v_last_read_message_id := coalesce(v_last_read_message_id, 0);

  select count(*)::integer, max(msg.id)
    into v_chat_unread, v_latest_message_id
  from public.olli_team_chat_messages msg
  where msg.academy_id = p_academy_id
    and msg.deleted_at is null
    and msg.id > v_last_read_message_id
    and msg.sender_member_id is distinct from v_member.id
    and msg.material_event_id is null
    and (
      private.olli_team_chat_message_visible_to_member(
        msg.academy_id,msg.id,msg.audience,v_member.id,v_member.role
      )
    )
    and (
      (
        exists(
          select 1
          from public.olli_team_chat_mentions any_mt
          where any_mt.academy_id = msg.academy_id
            and any_mt.message_id = msg.id
        )
        and exists(
          select 1
          from public.olli_team_chat_mentions mine
          where mine.academy_id = msg.academy_id
            and mine.message_id = msg.id
            and mine.member_id = v_member.id
            and mine.read_at is null
        )
      )
      or not exists(
        select 1
        from public.olli_team_chat_mentions any_mt
        where any_mt.academy_id = msg.academy_id
          and any_mt.message_id = msg.id
      )
    );

  if v_latest_message_id is not null then
    select msg.sender_name_snapshot, msg.body
      into v_latest_sender, v_latest_body
    from public.olli_team_chat_messages msg
    where msg.academy_id = p_academy_id
      and msg.id = v_latest_message_id
    limit 1;
  end if;

  if v_member.role in ('owner','manager') then
    select count(*)::integer
      into v_material_unread
    from public.olli_team_material_requests r
    where r.academy_id = p_academy_id
      and r.deleted_at is null
      and r.status in ('requested','on_hold')
      and (r.needed_on is null or r.needed_on >= (now() at time zone 'Asia/Seoul')::date);

    select max(e.id)
      into v_latest_material_event_id
    from public.olli_team_material_request_events e
    join public.olli_team_material_requests r
      on r.id = e.request_id
     and r.academy_id = e.academy_id
    where e.academy_id = p_academy_id
      and e.event_type = 'created'
      and r.deleted_at is null
      and r.status in ('requested','on_hold')
      and (r.needed_on is null or r.needed_on >= (now() at time zone 'Asia/Seoul')::date);

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
    'chat_unread_count', coalesce(v_chat_unread, 0),
    'mention_unread_count', coalesce(v_chat_unread, 0),
    'material_unread_count', coalesce(v_material_unread, 0),
    'unread_count', coalesce(v_chat_unread, 0) + coalesce(v_material_unread, 0),
    'latest_message_id', v_latest_message_id,
    'latest_sender_name', v_latest_sender,
    'latest_body', v_latest_body,
    'latest_material_event_id', v_latest_material_event_id,
    'latest_material_item', v_latest_material_item,
    'latest_material_requester', v_latest_material_requester
  );
end;
$function$
;

commit;