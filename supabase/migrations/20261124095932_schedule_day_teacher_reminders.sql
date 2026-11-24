-- Add day-of reminders to the existing team-chat event / mention / push pipeline.
-- Existing schedule mutations, regular notifications and app sync are unchanged.
alter table public.olli_team_chat_bot_events drop constraint olli_team_chat_bot_events_event_type_check;
alter table public.olli_team_chat_bot_events add constraint olli_team_chat_bot_events_event_type_check
  check (event_type in ('registration_add','registration_cancel','trial_add','trial_cancel',
    'wait_add','wait_cancel','pickup_add','pickup_move','pickup_cancel',
    'makeup_day','trial_day','temporary_move_day','move_day'));

CREATE OR REPLACE FUNCTION private.olli_team_talk_emit_schedule_event(p_academy_id uuid, p_event_key text, p_event_type text, p_source_table text, p_source_id text, p_student_name text, p_class_date date, p_division text, p_weekday integer, p_time_slot integer, p_class_group text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_pickup_targets uuid[] := ARRAY[]::uuid[];
  v_dispatch_targets uuid[] := ARRAY[]::uuid[];
  v_dispatch_member_id uuid;
  v_day_reminder boolean := p_event_type in ('makeup_day','trial_day','temporary_move_day','move_day');
begin
  select coalesce(s.team_talk_bot_notifications_enabled, true)
    into v_enabled
  from public.academy_settings s
  where s.academy_id = p_academy_id;

  -- New student enrollment is explicitly requested as an essential class
  -- notification even while optional Olli-bot automatic messages are off.
  -- All other schedule bot event categories still obey the existing setting.
  if coalesce(v_enabled, true) = false
     and p_event_type not in ('registration_add','pickup_add','pickup_move') and not v_day_reminder then
    return null;
  end if;

  -- Pickup: everyone assigned to the destination kinder slot, including
  -- A/B regular teachers and date-specific substitute teachers.
  if p_event_type in ('pickup_add','pickup_move') then
    select coalesce(array_agg(distinct m.id order by m.id), ARRAY[]::uuid[])
      into v_pickup_targets
    from (
      select ct.teacher_member_id as member_id
      from public.olli_schedule_class_teachers ct
      where ct.academy_id = p_academy_id
        and ct.division = 'kinder'
        and ct.weekday = extract(isodow from p_class_date)::integer
        and ct.time_slot = p_time_slot
      union
      select o.regular_teacher_member_id
      from public.olli_schedule_teacher_overrides o
      where o.academy_id = p_academy_id
        and o.session_date = p_class_date
        and o.division = 'kinder'
        and o.time_slot = p_time_slot
      union
      select o.teacher_member_id
      from public.olli_schedule_teacher_overrides o
      where o.academy_id = p_academy_id
        and o.session_date = p_class_date
        and o.division = 'kinder'
        and o.time_slot = p_time_slot
    ) teachers
    join public.academy_members m
      on m.id = teachers.member_id
     and m.academy_id = p_academy_id
     and m.status = 'active'
     and m.account_id is not null
     and m.role in ('owner','manager','teacher');
    if cardinality(v_pickup_targets) = 0 then return null; end if;
    v_target_member_id := v_pickup_targets[1];
  else
    -- Preserve the existing registration/other schedule event recipient.
    v_target_member_id := private.olli_team_talk_effective_teacher(
      p_academy_id, p_class_date, p_division, p_time_slot, v_group
    );
    if (p_event_type = 'registration_add' or v_day_reminder) and not exists (
      select 1 from public.academy_members m
      where m.id = v_target_member_id
        and m.academy_id = p_academy_id
        and m.status = 'active'
        and m.account_id is not null
        and (not v_day_reminder or m.role in ('owner','manager','teacher'))
    ) then return null; end if;
  end if;

  insert into public.olli_team_chat_bot_events(
    academy_id, event_key, event_type, source_table, source_id,
    class_date, division, weekday, time_slot, class_group
  )
  values (
    p_academy_id, case when v_day_reminder then p_event_key || ':' || v_target_member_id::text else p_event_key end,
    p_event_type, p_source_table, p_source_id,
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
    when 'pickup_move' then '픽업 이동'
    when 'pickup_cancel' then '픽업 취소'
    when 'makeup_day' then '오늘 보강수업'
    when 'trial_day' then '오늘 체험수업'
    when 'temporary_move_day' then '오늘 일시변경 수업'
    when 'move_day' then '오늘 이동 수업'
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

  if p_event_type in ('pickup_add','pickup_move','pickup_cancel')
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
    || case when (v_day_reminder or p_event_type in ('pickup_add','pickup_move')) and p_class_date is not null
      then ' (' || to_char(p_class_date, 'YYYY.MM.DD') || ')' else '' end
    || case when v_day_reminder then ' ' || private.olli_makeup_slot_label(p_academy_id,p_division,p_class_date,p_time_slot)
      when p_time_slot is not null then ' ' || p_time_slot::text || '시' else '' end
    || case when v_group <> 'A' or (v_day_reminder and private.olli_schedule_group_is_enabled(
        p_academy_id,p_division,p_weekday,p_time_slot,p_class_date)) then ' ' || v_group || '반' else '' end
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

  -- One shared system message, targeted Work mention for every recipient.
  if p_event_type = 'registration_add' or v_day_reminder then
    insert into public.olli_team_chat_mentions (academy_id, message_id, member_id)
    values (p_academy_id, v_message_id, v_target_member_id)
    on conflict (message_id, member_id) do nothing;
  elsif p_event_type in ('pickup_add','pickup_move') then
    insert into public.olli_team_chat_mentions (academy_id, message_id, member_id)
    select p_academy_id, v_message_id, unnest(v_pickup_targets)
    on conflict (message_id, member_id) do nothing;
  end if;

  v_dispatch_targets := case
    when p_event_type in ('pickup_add','pickup_move') then v_pickup_targets
    when v_target_member_id is not null then ARRAY[v_target_member_id]
    else ARRAY[]::uuid[]
  end;

  if cardinality(v_dispatch_targets) > 0 then
    begin
      select ds.decrypted_secret into v_secret
      from vault.decrypted_secrets ds
      where ds.name = 'olli_team_chat_system_push_secret_20260921'
      order by ds.created_at desc limit 1;
    exception when others then v_secret := null;
    end;
    if nullif(v_secret, '') is not null then
      foreach v_dispatch_member_id in array v_dispatch_targets loop
        begin
          perform net.http_post(
            url := 'https://fvkxipjwgeyosgnfhdnx.supabase.co/functions/v1/olli-team-chat-push',
            headers := jsonb_build_object('Content-Type','application/json'),
            body := jsonb_build_object(
              'action','dispatch-system',
              'academy_id',p_academy_id,
              'message_id',v_message_id,
              'target_member_id',v_dispatch_member_id,
              'internal_token',v_secret
            ),
            timeout_milliseconds := 8000
          );
        exception when others then
          -- Push failure must never roll back the saved pickup or team message.
          null;
        end;
      end loop;
    end if;
  end if;

  return v_message_id;
end;
$function$
;

-- Read the current schedule, not a stale queue or a cached teacher assignment.
create or replace function private.olli_team_talk_day_candidates(p_date date)
returns table(academy_id uuid, event_type text, source_table text, source_id text,
 student_id uuid, student_name text, division text, weekday integer, time_slot integer,
 class_group text, session_kind text)
language sql stable set search_path=''
as $function$
  with recursive move_leaves as (
    select c.id as change_id,c.academy_id,c.student_id,c.source_enrollment_id,
      c.target_enrollment_id,c.effective_date,e.weekday,e.time_slot,e.class_group,s.name,s.division
    from public.olli_schedule_changes c
    join public.olli_schedule_enrollments e on e.id=c.target_enrollment_id
      and e.academy_id=c.academy_id and e.student_id=c.student_id
    join public.students s on s.id=c.student_id and s.academy_id=c.academy_id
    where c.change_type='move' and c.status in ('scheduled','applied')
      and c.effective_date between p_date-6 and p_date
      and e.status='active' and e.effective_from<=p_date
      and (e.effective_to is null or e.effective_to>=p_date)
      and e.weekday=extract(isodow from p_date)::integer
      and private.olli_team_talk_next_class_date(c.effective_date,e.weekday)=p_date
      and s.status='active' and not coalesce(s.is_deleted,false)
  ), lineage as (
    select l.change_id,l.academy_id,l.student_id,l.source_enrollment_id as root_id,
      date_trunc('week',l.effective_date)::date as week_start,
      array[l.change_id]::uuid[] as visited,0 as depth
    from move_leaves l
    union all
    select l.change_id,l.academy_id,l.student_id,c.source_enrollment_id,
      l.week_start,l.visited||c.id,l.depth+1
    from lineage l join public.olli_schedule_changes c
      on c.academy_id=l.academy_id and c.student_id=l.student_id
      and c.target_enrollment_id=l.root_id and c.change_type='move'
      and c.status in ('scheduled','applied')
      and c.effective_date between l.week_start and l.week_start+6
      and not(c.id=any(l.visited))
    where l.depth<100
  ), roots as (
    select distinct on (l.change_id) l.change_id,l.root_id
    from lineage l order by l.change_id,l.depth desc,l.root_id
  ), candidates as (
    select o.academy_id,
      case when o.session_type='trial' then 'trial_day'
        when o.note ~ '^일시변경 \[olli:temporary-move-v[12]:[0-9a-fA-F-]{36}:[0-9]{4}-[0-9]{2}-[0-9]{2}(:blank|:keep)?\]$'
          then 'temporary_move_day' else 'makeup_day' end as event_type,
      'olli_schedule_one_time_sessions'::text as source_table,o.id::text as source_id,
      o.student_id,coalesce(s.name,o.guest_name) as student_name,
      coalesce(s.division,o.guest_division) as division,
      extract(isodow from p_date)::integer as weekday,o.time_slot::integer as time_slot,
      upper(coalesce(nullif(btrim(o.class_group),''),'A')) as class_group,'makeup'::text as session_kind
    from public.olli_schedule_one_time_sessions o
    left join public.students s on s.id=o.student_id and s.academy_id=o.academy_id
    where o.session_date=p_date and o.status='scheduled' and o.session_type in ('makeup','trial')
      and (o.student_id is null or (s.status='active' and not coalesce(s.is_deleted,false)))
    union all
    select l.academy_id,'move_day','olli_schedule_changes',l.change_id::text,l.student_id,l.name,l.division,
      l.weekday::integer,l.time_slot::integer,upper(coalesce(nullif(btrim(l.class_group),''),'A')),'regular'
    from move_leaves l join roots r on r.change_id=l.change_id
    where not exists (
      select 1 from public.olli_schedule_enrollments original
      where original.id=r.root_id and original.academy_id=l.academy_id and original.student_id=l.student_id
        and original.weekday=l.weekday and original.time_slot=l.time_slot
        and (upper(coalesce(nullif(btrim(original.class_group),''),'A'))=upper(coalesce(nullif(btrim(l.class_group),''),'A'))
          or not private.olli_schedule_group_is_enabled(l.academy_id,l.division,l.weekday,l.time_slot,p_date))
    )
  ), normalized as (
    select c.academy_id,c.event_type,c.source_table,c.source_id,c.student_id,c.student_name,c.division,
      c.weekday,c.time_slot,case when private.olli_schedule_group_is_enabled(
        c.academy_id,c.division,c.weekday,c.time_slot,p_date) then c.class_group else 'A' end class_group,c.session_kind
    from candidates c
    where c.division in ('kinder','elementary') and nullif(btrim(c.student_name),'') is not null
      and not private.olli_schedule_is_closed_day(c.academy_id,p_date)
  )
  select n.* from normalized n
  where not exists (
    select 1 from public.olli_schedule_attendance a
    where a.academy_id=n.academy_id and a.student_id=n.student_id and a.session_date=p_date
      and a.time_slot=n.time_slot and coalesce(nullif(a.class_group,''),'A')=n.class_group
      and a.session_kind=n.session_kind
  ) and not exists (
    select 1 from private.olli_schedule_attendance_session_overrides a
    where a.academy_id=n.academy_id and a.student_id=n.student_id and a.session_date=p_date
      and a.time_slot=n.time_slot and a.class_group=n.class_group and a.session_kind=n.session_kind
      and a.status in ('present','makeup','absent')
  );
$function$;

-- Use the same real slot numbering as the timetable, including half-hour and
-- Saturday morning classes. No late reminders for already elapsed sessions.
create or replace function private.olli_team_talk_day_slot_start(
  p_academy_id uuid,p_division text,p_weekday integer,p_time_slot integer)
returns time language sql stable set search_path=''
as $function$
  select case
    when p_division='elementary' and p_weekday=6 and p_time_slot between 10 and 12
      then make_time(p_time_slot,0,0)
    when private.olli_schedule_timetable_mode(p_academy_id)='half_hour'
      and p_division='elementary' and p_time_slot between 7 and 11
      then make_time(p_time_slot+6,30,0)
    when private.olli_schedule_timetable_mode(p_academy_id)='half_hour'
      and p_division='kinder' and p_time_slot between 7 and 9
      then make_time(p_time_slot+8,30,0)
    when p_time_slot between 1 and 6 then make_time(p_time_slot+12,0,0)
    else null::time end;
$function$;

create or replace function private.olli_team_talk_dispatch_day_reminders(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path=''
as $function$
declare
  v_local timestamp := p_now at time zone 'Asia/Seoul';
  v_date date := v_local::date;
  v record;
  v_message bigint;
  v_sent integer := 0;
begin
  if v_local::time < time '10:00' or v_local::time >= time '19:00'
     or extract(isodow from v_date)=7 then return 0; end if;
  -- A transaction lock avoids overlapping scheduler runs; event uniqueness
  -- also protects each lesson/date/recipient across retried runs.
  if not pg_try_advisory_xact_lock(hashtextextended('olli-day-teacher-reminder:'||v_date::text,0))
    then return 0; end if;
  for v in
    select c.* from private.olli_team_talk_day_candidates(v_date) c
    where v_local::time <= private.olli_team_talk_day_slot_start(
      c.academy_id,c.division,c.weekday,c.time_slot)+interval '10 minutes'
    order by c.academy_id,c.time_slot,c.source_id
  loop
    begin
      v_message := private.olli_team_talk_emit_schedule_event(v.academy_id,
        'schedule:day:'||v.event_type||':'||v.source_id||':'||v_date::text,
        v.event_type,v.source_table,v.source_id,v.student_name,v_date,v.division,
        v.weekday,v.time_slot,v.class_group);
      if v_message is not null then v_sent:=v_sent+1; end if;
    exception when others then
      -- Keep other classrooms running; an uncommitted event is retried next run.
      raise warning 'day reminder failed for source %: %',v.source_id,sqlstate;
    end;
  end loop;
  return v_sent;
end;
$function$;
revoke all on function private.olli_team_talk_day_candidates(date) from public,anon,authenticated;
revoke all on function private.olli_team_talk_day_slot_start(uuid,text,integer,integer) from public,anon,authenticated;
revoke all on function private.olli_team_talk_dispatch_day_reminders(timestamptz) from public,anon,authenticated;

-- UTC scheduler (production cron.timezone is GMT): 10:00–18:50 KST.
-- Recheck live changes every ten minutes, sending each eligible reminder once.
select cron.schedule('olli-schedule-day-teacher-reminders-v1','*/10 1-9 * * *',
  'select private.olli_team_talk_dispatch_day_reminders();');
