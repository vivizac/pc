-- Explicit user-requested new student notifications must not depend on the
-- optional Team Chat bot auto-message preference. Keep pickup/trial/wait/etc.
-- entirely unchanged and reuse original teacher-targeted SQL implementation.
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

  -- New student enrollment is explicitly requested as an essential class
  -- notification even while optional Olli-bot automatic messages are off.
  -- All other schedule bot event categories still obey the existing setting.
  if coalesce(v_enabled, true) = false
     and p_event_type <> 'registration_add' then
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

commit;
