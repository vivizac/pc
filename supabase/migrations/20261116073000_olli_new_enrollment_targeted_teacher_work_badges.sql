-- Assign automatic new-enrollment Work badges and mobile push icon counts
-- only to the active teacher assigned to the enrolled class.
-- Replaces two existing notification functions in place. No schedule, student,
-- saved chat, read-state, or Realtime data is migrated or deleted.
-- The existing insertion trigger covers PC, mobile and schedule RPC callers.
begin;

create or replace function private.olli_team_talk_emit_schedule_event(
  p_academy_id uuid,
  p_event_key text,
  p_event_type text,
  p_source_table text,
  p_source_id text,
  p_student_name text,
  p_class_date date,
  p_division text,
  p_weekday integer,
  p_time_slot integer,
  p_class_group text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_enabled boolean := true;
  v_event_id bigint;
  v_message_id bigint;
  v_target_member_id uuid;
  v_event_label text;
  v_division_label text;
  v_weekday_label text;
  v_body text;
  v_group text := upper(coalesce(nullif(btrim(p_class_group), ''), 'A'));
  v_secret text;
  v_pickup_label text;
  v_pickup_time time;
  v_pickup_detail text := '';
begin
  select coalesce(s.team_talk_bot_notifications_enabled, true)
    into v_enabled
  from public.academy_settings s
  where s.academy_id = p_academy_id;

  if coalesce(v_enabled, true) = false then
    return null;
  end if;

  -- Resolve the actual class teacher, including date-specific substitutes.
  v_target_member_id := private.olli_team_talk_effective_teacher(
    p_academy_id,
    p_class_date,
    p_division,
    p_time_slot,
    v_group
  );
  -- For a new enrollment, do not broadcast an unassigned-class alert
  -- to unrelated staff. Other schedule event types retain their behavior.
  if p_event_type = 'registration_add' and not exists (
    select 1 from public.academy_members m
    where m.id = v_target_member_id
      and m.academy_id = p_academy_id
      and m.status = 'active'
      and m.account_id is not null
  ) then
    return null;
  end if;

  insert into public.olli_team_chat_bot_events(
    academy_id, event_key, event_type, source_table, source_id,
    class_date, division, weekday, time_slot, class_group
  )
  values (
    p_academy_id, p_event_key, p_event_type, p_source_table, p_source_id,
    p_class_date, p_division, p_weekday, p_time_slot, v_group
  )
  on conflict (academy_id, event_key) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return null;
  end if;

  v_event_label := case p_event_type
    when 'registration_add' then '신규 등록'
    when 'registration_cancel' then '등록 취소'
    when 'trial_add' then '체험 등록'
    when 'trial_cancel' then '체험 취소'
    when 'wait_add' then '대기 등록'
    when 'wait_cancel' then '대기 취소'
    when 'pickup_add' then '픽업 등록'
    when 'pickup_cancel' then '픽업 취소'
    else '일정 알림'
  end;
  v_division_label := case p_division when 'kinder' then '유치부' else '초등부' end;
  v_weekday_label := case p_weekday
    when 1 then '월요일'
    when 2 then '화요일'
    when 3 then '수요일'
    when 4 then '목요일'
    when 5 then '금요일'
    when 6 then '토요일'
    else ''
  end;

  if p_event_type in ('pickup_add', 'pickup_cancel')
     and p_source_table = 'olli_schedule_pickups'
     and nullif(btrim(coalesce(p_source_id, '')), '') is not null then
    begin
      select p.pickup_label, p.pickup_time
        into v_pickup_label, v_pickup_time
      from public.olli_schedule_pickups p
      where p.academy_id = p_academy_id
        and p.id = p_source_id::uuid
      limit 1;

      if nullif(btrim(coalesce(v_pickup_label, '')), '') is not null then
        v_pickup_detail := btrim(v_pickup_label);
      end if;
      if v_pickup_time is not null then
        v_pickup_detail := concat_ws(
          ' ',
          nullif(v_pickup_detail, ''),
          to_char(v_pickup_time, 'HH24:MI')
        );
      end if;
    exception
      when invalid_text_representation then
        v_pickup_detail := '';
    end;
  end if;

  v_body := v_event_label || ' · ' || coalesce(nullif(btrim(p_student_name), ''), '이름 미확인')
    || ' · ' || v_division_label
    || case when v_weekday_label <> '' then ' ' || v_weekday_label else '' end
    || case when p_time_slot is not null then ' ' || p_time_slot::text || '시' else '' end
    || case when v_group <> 'A' then ' ' || v_group || '반' else '' end
    || case when v_pickup_detail <> '' then ' · ' || v_pickup_detail else '' end;

  insert into public.olli_team_chat_messages(
    academy_id,
    sender_member_id,
    sender_name_snapshot,
    message_type,
    body,
    client_message_id
  )
  values (
    p_academy_id,
    null,
    '올리',
    'system',
    v_body,
    extensions.gen_random_uuid()
  )
  returning id into v_message_id;

  update public.olli_team_chat_bot_events
  set message_id = v_message_id,
      target_member_id = v_target_member_id
  where id = v_event_id;

  -- Existing Work badge/mark-read logic already isolates explicit mentions.
  -- A registration system message without this relation was counted as
  -- general unread chat for every staff member.
  if p_event_type = 'registration_add' then
    insert into public.olli_team_chat_mentions (academy_id, message_id, member_id)
    values (p_academy_id, v_message_id, v_target_member_id)
    on conflict (message_id, member_id) do nothing;
  end if;

  if v_target_member_id is not null then
    begin
      select ds.decrypted_secret
        into v_secret
      from vault.decrypted_secrets ds
      where ds.name = 'olli_team_chat_system_push_secret_20260921'
      order by ds.created_at desc
      limit 1;

      if nullif(v_secret, '') is not null then
        perform net.http_post(
          url := 'https://fvkxipjwgeyosgnfhdnx.supabase.co/functions/v1/olli-team-chat-push',
          headers := jsonb_build_object('Content-Type','application/json'),
          body := jsonb_build_object(
            'action','dispatch-system',
            'academy_id',p_academy_id,
            'message_id',v_message_id,
            'target_member_id',v_target_member_id,
            'internal_token',v_secret
          ),
          timeout_milliseconds := 8000
        );
      end if;
    exception when others then
      null;
    end;
  end if;

  return v_message_id;
end;
$function$;;

CREATE OR REPLACE FUNCTION public.olli_team_chat_system_push_targets(p_academy_id uuid, p_message_id bigint, p_member_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_body text;
  v_targets jsonb;
begin
  if p_academy_id is null or p_message_id is null or p_member_id is null then
    raise exception '시스템 알림 대상 정보가 없습니다.';
  end if;

  select m.body into v_body
  from public.olli_team_chat_messages m
  join public.olli_team_chat_bot_events e
    on e.academy_id = m.academy_id
   and e.message_id = m.id
   and e.target_member_id = p_member_id
  where m.academy_id = p_academy_id
    and m.id = p_message_id
    and m.message_type = 'system'
    and m.deleted_at is null
  limit 1;

  if v_body is null then
    raise exception '시스템 알림 메시지를 찾을 수 없습니다.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'subscription_id', s.id,
    'member_id', s.member_id,
    'endpoint', s.endpoint,
    'p256dh', s.p256dh,
    'auth', s.auth,
    -- Keep the mobile app-icon badge in sync with all of this member's
    -- unread Work messages, not zero when the system push is received.
    'unread_count', (
      select count(*)::integer
      from public.olli_team_chat_messages msg
      left join public.olli_team_chat_member_state st
        on st.academy_id = p_academy_id and st.member_id = m.id
      where msg.academy_id = p_academy_id
        and msg.deleted_at is null
        and msg.id > coalesce(st.last_read_message_id, 0)
        and msg.sender_member_id is distinct from m.id
        and msg.material_event_id is null
        and (msg.audience = 'all' or (msg.audience = 'management' and m.role in ('owner', 'manager')))
        and (
          (exists (
            select 1 from public.olli_team_chat_mentions any_mention
            where any_mention.academy_id = p_academy_id and any_mention.message_id = msg.id
          ) and exists (
            select 1 from public.olli_team_chat_mentions own_mention
            where own_mention.academy_id = p_academy_id
              and own_mention.message_id = msg.id
              and own_mention.member_id = m.id
              and own_mention.read_at is null
          ))
          or not exists (
            select 1 from public.olli_team_chat_mentions any_mention
            where any_mention.academy_id = p_academy_id and any_mention.message_id = msg.id
          )
        )
    ) + case when m.role in ('owner', 'manager') then (
      select count(*)::integer
      from public.olli_team_material_request_events material
      left join public.olli_team_chat_member_state st
        on st.academy_id = p_academy_id and st.member_id = m.id
      where material.academy_id = p_academy_id
        and material.event_type = 'created'
        and material.id > coalesce(st.last_read_material_event_id, 0)
    ) else 0 end
  ) order by s.id), '[]'::jsonb)
  into v_targets
  from public.olli_team_chat_push_subscriptions s
  join public.academy_members m
    on m.id = s.member_id
   and m.academy_id = s.academy_id
   and m.status = 'active'
  where s.academy_id = p_academy_id
    and s.member_id = p_member_id
    and s.disabled_at is null
    and not exists (
      select 1
      from public.olli_team_chat_push_deliveries d
      where d.academy_id = p_academy_id
        and d.message_id = p_message_id
        and d.subscription_id = s.id
    );

  return jsonb_build_object(
    'ok', true,
    'body', v_body,
    'message_id', p_message_id,
    'target_member_id', p_member_id,
    'targets', v_targets
  );
end;
$function$;

commit;
