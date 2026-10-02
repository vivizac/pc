-- Notify the original material requester with an Olli Team Chat bubble
-- when a material request transitions into the ordered state.

create or replace function public.olli_team_material_request_set_status(
  p_session_token text,
  p_academy_id uuid,
  p_request_id uuid,
  p_status text,
  p_expected_revision bigint,
  p_hold_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_request public.olli_team_material_requests%rowtype;
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_hold_reason text := nullif(btrim(coalesce(p_hold_reason, '')), '');
  v_previous_status text;
  v_notification_message_id bigint;
  v_notification_body text;
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
    case m.role when 'owner' then 1 when 'manager' then 2 else 3 end,
    m.created_at
  limit 1;

  if v_member.id is null or v_member.role not in ('owner','manager') then
    raise exception '재료 주문 상태는 원장 또는 관리자만 변경할 수 있습니다.';
  end if;

  if v_status not in ('requested','on_hold','ordered','arrived') then
    raise exception '재료 주문 상태 값을 확인해 주세요.';
  end if;

  if v_hold_reason is not null and char_length(v_hold_reason) > 500 then
    raise exception '보류 사유는 500자 이내로 입력해 주세요.';
  end if;

  select r.status
    into v_previous_status
  from public.olli_team_material_requests r
  where r.id = p_request_id
    and r.academy_id = p_academy_id
    and r.deleted_at is null;

  if v_previous_status is null then
    raise exception '재료 요청을 찾지 못했습니다.';
  end if;

  update public.olli_team_material_requests r
  set
    status = v_status,
    hold_reason = case when v_status = 'on_hold' then v_hold_reason else null end,
    status_changed_by_member_id = v_member.id,
    status_changed_at = now(),
    ordered_at = case
      when v_status = 'ordered' then coalesce(r.ordered_at, now())
      when v_status in ('requested','on_hold') then null
      else r.ordered_at
    end,
    ordered_by_member_id = case
      when v_status = 'ordered' then v_member.id
      when v_status in ('requested','on_hold') then null
      else r.ordered_by_member_id
    end,
    arrived_at = case
      when v_status = 'arrived' then coalesce(r.arrived_at, now())
      else null
    end,
    arrived_by_member_id = case
      when v_status = 'arrived' then v_member.id
      else null
    end,
    revision = r.revision + 1,
    updated_at = now()
  where r.id = p_request_id
    and r.academy_id = p_academy_id
    and r.deleted_at is null
    and r.revision = p_expected_revision
  returning r.* into v_request;

  if v_request.id is null then
    if exists (
      select 1
      from public.olli_team_material_requests r
      where r.id = p_request_id
        and r.academy_id = p_academy_id
        and r.deleted_at is null
    ) then
      raise exception '다른 기기에서 재료 상태가 먼저 변경되었습니다. 최신 상태를 다시 불러와 주세요.';
    end if;
    raise exception '재료 요청을 찾지 못했습니다.';
  end if;

  insert into public.olli_team_material_request_events (
    academy_id,
    request_id,
    member_id,
    event_type,
    from_status,
    to_status,
    note
  )
  values (
    p_academy_id,
    v_request.id,
    v_member.id,
    'status_changed',
    v_previous_status,
    v_status,
    case when v_status = 'on_hold' then v_hold_reason else null end
  );

  if v_status = 'ordered' and v_previous_status is distinct from 'ordered' then
    v_notification_body :=
      '재료 주문이 완료됐어요.' || E'\n'
      || '요청자 · ' || coalesce(nullif(btrim(v_request.requested_by_name_snapshot), ''), '선생님') || E'\n'
      || '품목 · ' || v_request.item_name || E'\n'
      || '수량 · ' || v_request.quantity_text
      || case
           when v_request.needed_on is not null
             then E'\n필요일 · ' || to_char(v_request.needed_on, 'YYYY.MM.DD')
           else ''
         end;

    insert into public.olli_team_chat_messages (
      academy_id,
      sender_member_id,
      sender_name_snapshot,
      message_type,
      body,
      client_message_id,
      audience,
      material_request_id
    )
    values (
      p_academy_id,
      null,
      '올리',
      'ai',
      v_notification_body,
      extensions.gen_random_uuid(),
      'all',
      v_request.id
    )
    returning id into v_notification_message_id;

    insert into public.olli_team_chat_mentions (
      academy_id,
      message_id,
      member_id
    )
    values (
      p_academy_id,
      v_notification_message_id,
      v_request.requested_by_member_id
    )
    on conflict (message_id, member_id) do nothing;
  end if;

  perform private.olli_realtime_send_signal(
    p_academy_id,
    'chat',
    coalesce(v_notification_message_id, v_request.revision)
  );

  return jsonb_build_object(
    'ok', true,
    'request_id', v_request.id,
    'status', v_request.status,
    'revision', v_request.revision,
    'updated_at', v_request.updated_at,
    'notification_message_id', v_notification_message_id,
    'notification_member_id',
      case
        when v_notification_message_id is not null
          then v_request.requested_by_member_id
        else null
      end
  );
end;
$function$;

comment on function public.olli_team_material_request_set_status(text, uuid, uuid, text, bigint, text)
is 'Changes material request status and emits a targeted Olli Team Chat bubble to the original requester when the request becomes ordered.';
