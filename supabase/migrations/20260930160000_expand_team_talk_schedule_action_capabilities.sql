-- Expand Team Talk schedule action capabilities before Olli Agents SDK rollout.
-- This migration is backward compatible with the existing UI:
-- 1) keeps the existing add/cancel/memo actions,
-- 2) adds full date/time/class-group changes for makeup/trial,
-- 3) adds waitlist target changes and cancel,
-- 4) exposes existing pickup update/remove RPCs through Team Talk actions.
--
-- UI/Agent routing is intentionally not connected here. This is server capability only.

create or replace function public.olli_schedule_update_one_time_session(
  p_session_token text,
  p_academy_id uuid,
  p_one_time_session_id uuid,
  p_session_date date default null,
  p_time_slot integer default null,
  p_class_group text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_item public.olli_schedule_one_time_sessions%rowtype;
  v_division text;
  v_target_date date;
  v_target_time integer;
  v_target_group text;
  v_capacity integer;
  v_weekday integer;
  v_occupancy integer;
  v_account_id uuid;
  v_type_label text;
  v_identity_key text;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '보강·체험 수업을 변경할 권한이 없습니다.');
  end if;

  if p_one_time_session_id is null then
    return jsonb_build_object('ok', false, 'message', '변경할 보강·체험 수업을 확인해 주세요.');
  end if;

  select o.* into v_item
  from public.olli_schedule_one_time_sessions o
  where o.id = p_one_time_session_id
    and o.academy_id = p_academy_id
  for update;

  if not found
     or v_item.session_type not in ('makeup', 'trial')
     or v_item.status = 'cancelled'
     or (v_item.session_type = 'makeup' and v_item.student_id is null)
     or (v_item.session_type = 'trial' and v_item.student_id is null and nullif(btrim(v_item.guest_name), '') is null) then
    return jsonb_build_object('ok', false, 'message', '변경할 보강·체험 수업을 찾을 수 없습니다.');
  end if;

  v_target_date := coalesce(p_session_date, v_item.session_date);
  v_target_time := coalesce(p_time_slot, v_item.time_slot);
  v_target_group := upper(coalesce(nullif(btrim(p_class_group), ''), nullif(btrim(v_item.class_group), ''), 'A'));
  v_type_label := case when v_item.session_type = 'trial' then '체험' else '보강' end;

  if v_target_date is null or v_target_date < current_date then
    return jsonb_build_object('ok', false, 'message', '변경할 날짜를 확인해 주세요.');
  end if;

  if v_item.session_type = 'makeup' and (
    exists (
      select 1
      from public.olli_schedule_attendance a
      where a.academy_id = p_academy_id
        and a.student_id = v_item.student_id
        and a.session_date = v_item.session_date
        and a.time_slot = v_item.time_slot
        and upper(coalesce(nullif(btrim(a.class_group), ''), 'A')) = upper(coalesce(nullif(btrim(v_item.class_group), ''), 'A'))
        and a.session_kind = 'makeup'
    )
    or exists (
      select 1
      from private.olli_schedule_attendance_session_overrides a
      where a.academy_id = p_academy_id
        and a.student_id = v_item.student_id
        and a.session_date = v_item.session_date
        and a.time_slot = v_item.time_slot
        and upper(coalesce(nullif(btrim(a.class_group), ''), 'A')) = upper(coalesce(nullif(btrim(v_item.class_group), ''), 'A'))
        and a.session_kind = 'makeup'
    )
  ) then
    return jsonb_build_object('ok', false, 'message', '출결 정보가 있는 보강은 날짜·시간·반을 변경할 수 없습니다.');
  end if;

  v_weekday := extract(isodow from v_target_date)::integer;
  if v_weekday not between 1 and 6 then
    return jsonb_build_object('ok', false, 'message', '일요일에는 보강·체험 수업을 등록할 수 없습니다.');
  end if;

  if v_item.student_id is not null then
    select s.division into v_division
    from public.students s
    where s.id = v_item.student_id
      and s.academy_id = p_academy_id
      and s.status = 'active'
      and coalesce(s.is_deleted, false) = false;
  else
    v_division := nullif(btrim(v_item.guest_division), '');
  end if;

  if v_division is null then
    return jsonb_build_object('ok', false, 'message', '수업 구분 정보를 찾을 수 없습니다.');
  end if;

  if not private.olli_schedule_slot_is_valid(
    p_academy_id,
    v_division,
    v_weekday,
    v_target_time
  ) then
    return jsonb_build_object('ok', false, 'message', '선택한 날짜와 수업 시간을 확인해 주세요.');
  end if;

  if not private.olli_schedule_group_is_enabled(
    p_academy_id,
    v_division,
    v_weekday,
    v_target_time,
    v_target_date
  ) then
    v_target_group := 'A';
  elsif v_target_group not in ('A', 'B') then
    return jsonb_build_object('ok', false, 'message', '수업 반을 A반 또는 B반으로 선택해 주세요.');
  end if;

  if v_target_date = v_item.session_date
     and v_target_time = v_item.time_slot
     and v_target_group = upper(coalesce(nullif(btrim(v_item.class_group), ''), 'A')) then
    return jsonb_build_object(
      'ok', true,
      'result', 'unchanged',
      'session_type', v_item.session_type,
      'one_time_session_id', v_item.id,
      'session_date', v_item.session_date,
      'time_slot', v_item.time_slot,
      'class_group', upper(coalesce(nullif(btrim(v_item.class_group), ''), 'A')),
      'unchanged', true
    );
  end if;

  v_identity_key := case
    when v_item.student_id is not null then 'student:' || v_item.student_id::text
    else 'guest:' || lower(btrim(v_item.guest_name))
  end;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':one-time-update:' || v_item.id::text,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':' || v_item.session_type || ':' || v_identity_key || ':' ||
    v_target_date::text || ':' || v_target_time::text || ':' || v_target_group,
    0
  ));

  if v_item.student_id is not null then
    if exists (
      select 1
      from public.olli_schedule_one_time_sessions o
      where o.academy_id = p_academy_id
        and o.student_id = v_item.student_id
        and o.session_date = v_target_date
        and o.time_slot = v_target_time
        and o.status <> 'cancelled'
        and o.id <> v_item.id
    ) then
      return jsonb_build_object('ok', false, 'message', '같은 날짜와 시간에 이미 등록된 수업이 있습니다.');
    end if;
  else
    if exists (
      select 1
      from public.olli_schedule_one_time_sessions o
      where o.academy_id = p_academy_id
        and o.student_id is null
        and o.session_type = 'trial'
        and lower(btrim(o.guest_name)) = lower(btrim(v_item.guest_name))
        and o.session_date = v_target_date
        and o.time_slot = v_target_time
        and upper(coalesce(nullif(btrim(o.class_group), ''), 'A')) = v_target_group
        and o.status <> 'cancelled'
        and o.id <> v_item.id
    ) then
      return jsonb_build_object('ok', false, 'message', '같은 날짜와 시간에 이미 등록된 체험수업이 있습니다.');
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':' || v_target_date::text || ':' || v_target_time::text || ':' || v_target_group,
    0
  ));

  v_capacity := private.olli_schedule_capacity(p_academy_id, v_division);

  select
    (select count(*)
       from public.olli_schedule_enrollments e
       join public.students s on s.id = e.student_id
      where e.academy_id = p_academy_id
        and s.division = v_division
        and e.weekday = v_weekday
        and e.time_slot = v_target_time
        and e.class_group = v_target_group
        and e.status = 'active'
        and e.effective_from <= v_target_date
        and (e.effective_to is null or e.effective_to >= v_target_date)
        and (
          v_item.session_type = 'trial'
          or not exists (
            select 1
            from private.olli_schedule_attendance_session_overrides a
            where a.academy_id = p_academy_id
              and a.student_id = e.student_id
              and a.session_date = v_target_date
              and a.time_slot = v_target_time
              and upper(coalesce(nullif(btrim(a.class_group), ''), 'A')) = v_target_group
              and a.session_kind = 'regular'
              and a.status = 'absent'
          )
        ))
    +
    (select count(*)
       from public.olli_schedule_one_time_sessions o
       left join public.students s on s.id = o.student_id
      where o.academy_id = p_academy_id
        and coalesce(s.division, o.guest_division) = v_division
        and o.session_date = v_target_date
        and o.time_slot = v_target_time
        and o.class_group = v_target_group
        and o.status <> 'cancelled'
        and o.id <> v_item.id)
  into v_occupancy;

  if v_capacity is not null and v_occupancy >= v_capacity then
    return jsonb_build_object('ok', false, 'message', '선택한 날짜와 시간의 정원이 가득 찼습니다.', 'full', true);
  end if;

  v_account_id := public.olli_account_id_from_session(p_session_token);
  perform set_config('olli.actor_account_id', coalesce(v_account_id::text, ''), true);
  perform set_config(
    'olli.schedule_action',
    case when v_item.session_type = 'trial' then 'trial_session_change' else 'makeup_session_change' end,
    true
  );

  update public.olli_schedule_one_time_sessions
  set session_date = v_target_date,
      time_slot = v_target_time,
      class_group = v_target_group,
      updated_at = now()
  where id = v_item.id
    and academy_id = p_academy_id;

  return jsonb_build_object(
    'ok', true,
    'result', 'updated',
    'session_type', v_item.session_type,
    'one_time_session_id', v_item.id,
    'old_session_date', v_item.session_date,
    'old_time_slot', v_item.time_slot,
    'old_class_group', upper(coalesce(nullif(btrim(v_item.class_group), ''), 'A')),
    'session_date', v_target_date,
    'time_slot', v_target_time,
    'class_group', v_target_group,
    'unchanged', false
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'message', '같은 날짜와 시간에 이미 등록된 수업이 있습니다.');
end;
$function$;

revoke execute on function public.olli_schedule_update_one_time_session(text,uuid,uuid,date,integer,text) from public;
grant execute on function public.olli_schedule_update_one_time_session(text,uuid,uuid,date,integer,text) to anon, authenticated;

-- Preserve the existing date-only UI contract by delegating to the expanded RPC.
create or replace function public.olli_schedule_update_one_time_date(
  p_session_token text,
  p_academy_id uuid,
  p_one_time_session_id uuid,
  p_session_date date
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  return public.olli_schedule_update_one_time_session(
    p_session_token,
    p_academy_id,
    p_one_time_session_id,
    p_session_date,
    null,
    null
  );
end;
$function$;

revoke execute on function public.olli_schedule_update_one_time_date(text,uuid,uuid,date) from public;
grant execute on function public.olli_schedule_update_one_time_date(text,uuid,uuid,date) to anon, authenticated;

create or replace function public.olli_schedule_update_waitlist_target(
  p_session_token text,
  p_academy_id uuid,
  p_waitlist_id uuid,
  p_target_weekday integer default null,
  p_target_time_slot integer default null,
  p_target_class_group text default null,
  p_desired_effective_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_wait public.olli_schedule_waitlist%rowtype;
  v_division text;
  v_weekday integer;
  v_time integer;
  v_group text;
  v_effective date;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '대기 명단을 변경할 권한이 없습니다.');
  end if;

  if p_waitlist_id is null then
    return jsonb_build_object('ok', false, 'message', '변경할 대기 정보를 확인해 주세요.');
  end if;

  select w.* into v_wait
  from public.olli_schedule_waitlist w
  where w.id = p_waitlist_id
    and w.academy_id = p_academy_id
    and w.status in ('waiting', 'offered')
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', '변경할 대기 정보를 찾을 수 없습니다.');
  end if;

  if v_wait.student_id is not null then
    select s.division into v_division
    from public.students s
    where s.id = v_wait.student_id
      and s.academy_id = p_academy_id
      and s.status = 'active'
      and coalesce(s.is_deleted, false) = false;
  else
    v_division := nullif(btrim(v_wait.guest_division), '');
  end if;

  if v_division is null then
    return jsonb_build_object('ok', false, 'message', '대기 학생의 수업 구분을 찾을 수 없습니다.');
  end if;

  v_weekday := coalesce(p_target_weekday, v_wait.target_weekday);
  v_time := coalesce(p_target_time_slot, v_wait.target_time_slot);
  v_group := upper(coalesce(nullif(btrim(p_target_class_group), ''), nullif(btrim(v_wait.target_class_group), ''), 'A'));
  v_effective := coalesce(p_desired_effective_date, v_wait.desired_effective_date, current_date);

  if v_weekday not between 1 and 6 or v_effective < current_date then
    return jsonb_build_object('ok', false, 'message', '대기 날짜와 요일을 확인해 주세요.');
  end if;

  if not private.olli_schedule_slot_is_valid(
    p_academy_id,
    v_division,
    v_weekday,
    v_time
  ) then
    return jsonb_build_object('ok', false, 'message', '선택한 요일의 수업 시간을 확인해 주세요.');
  end if;

  if not private.olli_schedule_group_is_enabled(
    p_academy_id,
    v_division,
    v_weekday,
    v_time,
    private.olli_schedule_first_occurrence_on_or_after(v_effective, v_weekday)
  ) then
    v_group := 'A';
  elsif v_group not in ('A', 'B') then
    return jsonb_build_object('ok', false, 'message', '수업 반을 A반 또는 B반으로 선택해 주세요.');
  end if;

  if v_weekday = v_wait.target_weekday
     and v_time = v_wait.target_time_slot
     and v_group = upper(coalesce(nullif(btrim(v_wait.target_class_group), ''), 'A'))
     and v_effective = coalesce(v_wait.desired_effective_date, current_date) then
    return jsonb_build_object(
      'ok', true,
      'result', 'unchanged',
      'waitlist_id', v_wait.id,
      'target_weekday', v_wait.target_weekday,
      'target_time_slot', v_wait.target_time_slot,
      'target_class_group', upper(coalesce(nullif(btrim(v_wait.target_class_group), ''), 'A')),
      'desired_effective_date', v_wait.desired_effective_date,
      'unchanged', true
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':waitlist-update:' || v_wait.id::text,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':wait:' || v_division || ':' || v_weekday::text || ':' || v_time::text || ':' || v_group,
    0
  ));

  if v_wait.student_id is not null and exists (
    select 1
    from public.olli_schedule_enrollments e
    where e.academy_id = p_academy_id
      and e.student_id = v_wait.student_id
      and e.weekday = v_weekday
      and e.time_slot = v_time
      and e.status = 'active'
      and e.effective_from <= v_effective
      and (e.effective_to is null or e.effective_to >= v_effective)
  ) then
    return jsonb_build_object('ok', false, 'message', '이미 같은 요일과 시간에 등록된 학생입니다.');
  end if;

  if exists (
    select 1
    from public.olli_schedule_waitlist w
    where w.academy_id = p_academy_id
      and w.target_weekday = v_weekday
      and w.target_time_slot = v_time
      and w.status in ('waiting', 'offered')
      and w.id <> v_wait.id
  ) then
    return jsonb_build_object('ok', false, 'message', '이 시간에는 이미 다른 대기 학생이 있습니다.', 'waitlist_full', true);
  end if;

  update public.olli_schedule_waitlist
  set target_weekday = v_weekday,
      target_time_slot = v_time,
      target_class_group = v_group,
      desired_effective_date = v_effective,
      updated_at = now()
  where id = v_wait.id
    and academy_id = p_academy_id;

  return jsonb_build_object(
    'ok', true,
    'result', 'updated',
    'waitlist_id', v_wait.id,
    'old_target_weekday', v_wait.target_weekday,
    'old_target_time_slot', v_wait.target_time_slot,
    'old_target_class_group', upper(coalesce(nullif(btrim(v_wait.target_class_group), ''), 'A')),
    'old_desired_effective_date', v_wait.desired_effective_date,
    'target_weekday', v_weekday,
    'target_time_slot', v_time,
    'target_class_group', v_group,
    'desired_effective_date', v_effective,
    'unchanged', false
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'message', '이 시간에는 이미 다른 대기 학생이 있습니다.', 'waitlist_full', true);
end;
$function$;

revoke execute on function public.olli_schedule_update_waitlist_target(text,uuid,uuid,integer,integer,text,date) from public;
grant execute on function public.olli_schedule_update_waitlist_target(text,uuid,uuid,integer,integer,text,date) to anon, authenticated;

alter table public.olli_team_chat_actions
  drop constraint if exists olli_team_chat_actions_type_check;
alter table public.olli_team_chat_actions
  add constraint olli_team_chat_actions_type_check
  check (action_type = any (array[
    'add_class_once'::text,
    'cancel_class_once'::text,
    'add_pickup'::text,
    'update_pickup_arrival'::text,
    'update_pickup_dropoff'::text,
    'cancel_pickup'::text,
    'cancel_pickup_dropoff'::text,
    'add_makeup'::text,
    'update_makeup'::text,
    'cancel_makeup'::text,
    'add_trial'::text,
    'update_trial'::text,
    'cancel_trial'::text,
    'add_waitlist'::text,
    'update_waitlist'::text,
    'cancel_waitlist'::text,
    'move_class'::text,
    'cancel_move'::text,
    'mark_absent'::text,
    'add_timetable_memo'::text,
    'delete_timetable_memo'::text
  ]));

create or replace function public.olli_team_chat_send_action(
  p_session_token text,
  p_academy_id uuid,
  p_body text,
  p_action_type text,
  p_action_payload jsonb,
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
  v_action public.olli_team_chat_actions%rowtype;
  v_body text := btrim(coalesce(p_body,''));
  v_action_type text := lower(btrim(coalesce(p_action_type,'')));
  v_payload jsonb := coalesce(p_action_payload,'{}'::jsonb);
  v_client_message_id uuid := coalesce(p_client_message_id, extensions.gen_random_uuid());
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;
  if p_academy_id is null then raise exception '학원 ID가 없습니다.'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 5000 then raise exception '확인 메시지 내용을 확인해 주세요.'; end if;
  if jsonb_typeof(v_payload) <> 'object' or octet_length(v_payload::text) > 12000 then raise exception '작업 정보 형식이 올바르지 않습니다.'; end if;
  if v_action_type not in (
    'add_class_once','cancel_class_once','add_pickup',
    'update_pickup_arrival','update_pickup_dropoff','cancel_pickup','cancel_pickup_dropoff',
    'add_makeup','update_makeup','cancel_makeup',
    'add_trial','update_trial','cancel_trial',
    'add_waitlist','update_waitlist','cancel_waitlist',
    'move_class','cancel_move','mark_absent',
    'add_timetable_memo','delete_timetable_memo'
  ) then raise exception '지원하지 않는 작업입니다.'; end if;
  if lower(coalesce(v_payload->>'intent','')) <> v_action_type then raise exception '작업 종류가 일치하지 않습니다.'; end if;

  select m.* into v_member
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id and m.account_id=v_account_id and m.status='active'
    and a.status='active' and a.deleted_at is null
  order by case m.role when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end, m.created_at
  limit 1;
  if v_member.id is null then raise exception '현재 계정은 이 학원의 팀톡을 사용할 수 없습니다.'; end if;

  if p_reply_to_message_id is not null and not exists (
    select 1 from public.olli_team_chat_messages r
    where r.academy_id=p_academy_id and r.id=p_reply_to_message_id and r.deleted_at is null
  ) then raise exception '답장할 메시지를 찾지 못했습니다.'; end if;

  insert into public.olli_team_chat_messages(
    academy_id,sender_member_id,sender_name_snapshot,message_type,body,reply_to_message_id,client_message_id
  )
  values(p_academy_id,null,'올리','ai',v_body,p_reply_to_message_id,v_client_message_id)
  on conflict (academy_id,client_message_id) do nothing
  returning * into v_message;

  if v_message.id is null then
    select m.* into v_message
    from public.olli_team_chat_messages m
    where m.academy_id=p_academy_id and m.client_message_id=v_client_message_id
    limit 1;
  end if;

  insert into public.olli_team_chat_actions(academy_id,message_id,action_type,action_payload,requested_by_member_id)
  values(p_academy_id,v_message.id,v_action_type,v_payload,v_member.id)
  on conflict (academy_id,message_id) do nothing
  returning * into v_action;

  if v_action.id is null then
    select a.* into v_action
    from public.olli_team_chat_actions a
    where a.academy_id=p_academy_id and a.message_id=v_message.id
    limit 1;
    if v_action.id is null then raise exception '작업 카드를 저장하지 못했습니다.'; end if;
    if v_action.action_type <> v_action_type or v_action.action_payload <> v_payload then
      raise exception '같은 요청 키가 다른 작업에 이미 사용되었습니다.';
    end if;
  end if;

  return jsonb_build_object(
    'ok',true,
    'message',jsonb_build_object(
      'id',v_message.id,'academy_id',v_message.academy_id,
      'sender_member_id',v_message.sender_member_id,'sender_name',v_message.sender_name_snapshot,
      'message_type',v_message.message_type,'body',v_message.body,
      'reply_to_message_id',v_message.reply_to_message_id,'client_message_id',v_message.client_message_id,
      'created_at',v_message.created_at,
      'action',jsonb_build_object(
        'id',v_action.id,'action_type',v_action.action_type,'status',v_action.status,
        'revision',v_action.revision,'created_at',v_action.created_at,'updated_at',v_action.updated_at,
        'resolved_at',v_action.resolved_at,'error',v_action.error_text
      )
    )
  );
end;
$function$;

create or replace function public.olli_team_chat_action_execute(
  p_session_token text,
  p_academy_id uuid,
  p_action_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_account_id uuid;
  v_member_id uuid;
  v_action public.olli_team_chat_actions%rowtype;
  v_payload jsonb;
  v_result jsonb;
  v_memo_result jsonb;
  v_type text;
  v_name text;
  v_reason text;
  v_body text;
  v_error text;
  v_result_message_id bigint;
  v_date date;
  v_time integer;
  v_source_weekday integer;
  v_target_weekday integer;
  v_source_time integer;
  v_target_time integer;
  v_target_group text;
  v_source_session_type text;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;
  if p_academy_id is null or p_action_id is null then raise exception '작업 정보를 확인해 주세요.'; end if;

  select m.id into v_member_id
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id and m.account_id=v_account_id and m.status='active'
    and a.status='active' and a.deleted_at is null
  order by case m.role when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end, m.created_at
  limit 1;
  if v_member_id is null then raise exception '현재 계정은 이 학원의 팀톡을 사용할 수 없습니다.'; end if;

  select a.* into v_action
  from public.olli_team_chat_actions a
  where a.id=p_action_id and a.academy_id=p_academy_id
  for update;
  if v_action.id is null then raise exception '작업 요청을 찾지 못했습니다.'; end if;

  if v_action.status <> 'pending' then
    return jsonb_build_object(
      'ok',false,'message','이미 처리된 작업입니다.',
      'action',jsonb_build_object(
        'id',v_action.id,'action_type',v_action.action_type,'status',v_action.status,
        'revision',v_action.revision,'updated_at',v_action.updated_at,
        'resolved_at',v_action.resolved_at,'error',v_action.error_text,
        'result_message_id',v_action.result_message_id
      )
    );
  end if;

  v_payload := v_action.action_payload;
  v_type := v_action.action_type;
  v_reason := btrim(coalesce(v_payload->>'reason',''));
  v_name := coalesce(nullif(btrim(v_payload->>'studentName'),''),nullif(btrim(v_payload->>'guestName'),''),'학생');

  if nullif(v_payload->>'studentId','') is not null then
    select coalesce(nullif(btrim(s.name),''),v_name) into v_name
    from public.students s
    where s.id::text=(v_payload->>'studentId') and s.academy_id=p_academy_id
    limit 1;
    v_name := coalesce(v_name,'학생');
  end if;

  if v_type in ('cancel_makeup','cancel_trial') and v_reason='' then
    raise exception '취소 사유를 먼저 입력해 주세요.';
  end if;

  begin
    if v_type in ('add_class_once','add_makeup') then
      v_result := public.olli_schedule_execute(
        p_session_token,p_academy_id,'add_one_time',
        jsonb_build_object(
          'student_id',v_payload->>'studentId','session_date',v_payload->>'sessionDate',
          'time_slot',v_payload->>'timeSlot','class_group',coalesce(nullif(v_payload->>'classGroup',''),'A'),'note',''
        )
      );
    elsif v_type='add_timetable_memo' then
      if btrim(coalesce(v_payload->>'memoNote',''))='' then
        raise exception '등록할 메모 내용을 확인해 주세요.';
      end if;
      v_result := public.olli_schedule_save_cell_memo_v3(
        p_session_token,p_academy_id,nullif(v_payload->>'division',''),
        nullif(v_payload->>'sessionDate','')::date,(v_payload->>'timeSlot')::integer,
        v_payload->>'memoNote',coalesce(nullif(v_payload->>'classGroup',''),'A'),null
      );
    elsif v_type='delete_timetable_memo' then
      if nullif(v_payload->>'memoId','') is null then
        raise exception '삭제할 메모 정보를 확인해 주세요.';
      end if;
      v_result := public.olli_schedule_save_cell_memo_v3(
        p_session_token,p_academy_id,nullif(v_payload->>'division',''),
        nullif(v_payload->>'sessionDate','')::date,(v_payload->>'timeSlot')::integer,
        '',coalesce(nullif(v_payload->>'classGroup',''),'A'),(v_payload->>'memoId')::uuid
      );
    elsif v_type='add_pickup' then
      v_result := public.olli_schedule_save_pickup_v2(
        p_session_token,p_academy_id,nullif(v_payload->>'studentId','')::uuid,
        (v_payload->>'weekday')::integer,(v_payload->>'classTime')::integer,
        v_payload->>'pickupLabel',nullif(v_payload->>'pickupTime','')::time,
        nullif(v_payload->>'effectiveDate','')::date,coalesce((v_payload->>'isDropoff')::boolean,false)
      );
    elsif v_type='update_pickup_arrival' then
      v_result := public.olli_schedule_save_pickup_arrival(
        p_session_token,p_academy_id,nullif(v_payload->>'pickupId','')::uuid,
        v_payload->>'pickupLabel',nullif(v_payload->>'pickupTime','')::time
      );
    elsif v_type='update_pickup_dropoff' then
      v_result := public.olli_schedule_register_pickup_dropoff(
        p_session_token,p_academy_id,nullif(v_payload->>'pickupId','')::uuid,
        v_payload->>'dropoffLabel'
      );
    elsif v_type='cancel_pickup_dropoff' then
      v_result := public.olli_schedule_remove_pickup_dropoff(
        p_session_token,p_academy_id,nullif(v_payload->>'pickupId','')::uuid
      );
    elsif v_type='cancel_pickup' then
      v_result := public.olli_schedule_remove_pickup(
        p_session_token,p_academy_id,nullif(v_payload->>'pickupId','')::uuid,
        nullif(v_payload->>'effectiveDate','')::date
      );
    elsif v_type='add_waitlist' then
      if coalesce((v_payload->>'isGuest')::boolean,false) then
        v_result := public.olli_schedule_add_guest_entry(
          p_session_token,p_academy_id,coalesce(nullif(v_payload->>'guestName',''),v_payload->>'studentName'),
          v_payload->>'division','wait',nullif(v_payload->>'sessionDate','')::date,
          (v_payload->>'targetTimeSlot')::integer,coalesce(nullif(v_payload->>'targetClassGroup',''),'A')
        );
      else
        v_result := public.olli_schedule_execute(
          p_session_token,p_academy_id,'add_waitlist',
          jsonb_build_object(
            'student_id',v_payload->>'studentId','target_weekday',v_payload->>'targetWeekday',
            'target_time_slot',v_payload->>'targetTimeSlot',
            'target_class_group',coalesce(nullif(v_payload->>'targetClassGroup',''),'A'),
            'effective_date',v_payload->>'effectiveDate'
          )
        );
      end if;
    elsif v_type='update_waitlist' then
      v_result := public.olli_schedule_update_waitlist_target(
        p_session_token,p_academy_id,nullif(v_payload->>'waitlistId','')::uuid,
        nullif(v_payload->>'targetWeekday','')::integer,
        nullif(v_payload->>'targetTimeSlot','')::integer,
        nullif(v_payload->>'targetClassGroup',''),
        coalesce(
          nullif(v_payload->>'desiredEffectiveDate','')::date,
          nullif(v_payload->>'effectiveDate','')::date
        )
      );
    elsif v_type='cancel_waitlist' then
      v_result := public.olli_schedule_resolve_waitlist(
        p_session_token,p_academy_id,nullif(v_payload->>'waitlistId','')::uuid,
        'cancel',coalesce(nullif(v_payload->>'effectiveDate','')::date,current_date)
      );
    elsif v_type='add_trial' then
      v_result := public.olli_schedule_add_guest_entry(
        p_session_token,p_academy_id,coalesce(nullif(v_payload->>'guestName',''),v_payload->>'studentName'),
        v_payload->>'division','trial',nullif(v_payload->>'sessionDate','')::date,
        (v_payload->>'timeSlot')::integer,coalesce(nullif(v_payload->>'classGroup',''),'A')
      );
    elsif v_type in ('update_makeup','update_trial') then
      select o.session_type into v_source_session_type
      from public.olli_schedule_one_time_sessions o
      where o.id = nullif(v_payload->>'oneTimeSessionId','')::uuid
        and o.academy_id = p_academy_id
        and o.status <> 'cancelled'
      limit 1;

      if v_source_session_type is null then
        raise exception '변경할 보강·체험 수업을 찾을 수 없습니다.';
      end if;
      if v_type='update_makeup' and v_source_session_type <> 'makeup' then
        raise exception '선택한 항목은 보강 수업이 아닙니다.';
      end if;
      if v_type='update_trial' and v_source_session_type <> 'trial' then
        raise exception '선택한 항목은 체험수업이 아닙니다.';
      end if;

      v_result := public.olli_schedule_update_one_time_session(
        p_session_token,p_academy_id,nullif(v_payload->>'oneTimeSessionId','')::uuid,
        coalesce(
          nullif(v_payload->>'targetSessionDate','')::date,
          nullif(v_payload->>'sessionDate','')::date
        ),
        coalesce(
          nullif(v_payload->>'targetTimeSlot','')::integer,
          nullif(v_payload->>'timeSlot','')::integer
        ),
        coalesce(
          nullif(v_payload->>'targetClassGroup',''),
          nullif(v_payload->>'classGroup','')
        )
      );
    elsif v_type='move_class' then
      v_result := public.olli_schedule_execute(
        p_session_token,p_academy_id,'change',
        jsonb_build_object(
          'student_id',v_payload->>'studentId','source_enrollment_id',v_payload->>'sourceEnrollmentId',
          'target_weekday',v_payload->>'targetWeekday','target_time_slot',v_payload->>'targetTimeSlot',
          'target_class_group',coalesce(nullif(v_payload->>'targetClassGroup',''),'A'),
          'effective_date',v_payload->>'effectiveDate','change_type','move','allow_wait',false
        )
      );
    elsif v_type in ('cancel_class_once','cancel_makeup','cancel_trial') then
      v_result := public.olli_schedule_execute(
        p_session_token,p_academy_id,'cancel_one_time',
        jsonb_build_object('one_time_session_id',v_payload->>'oneTimeSessionId')
      );
    elsif v_type='cancel_move' then
      v_result := public.olli_schedule_execute(
        p_session_token,p_academy_id,'cancel_change',
        jsonb_build_object('change_id',v_payload->>'changeId')
      );
    elsif v_type='mark_absent' then
      if v_reason='' then raise exception '결석 사유를 먼저 입력해 주세요.'; end if;
      v_result := public.olli_schedule_set_attendance_session_status_v2(
        p_session_token,p_academy_id,nullif(v_payload->>'studentId','')::uuid,
        nullif(v_payload->>'sessionDate','')::date,'regular',(v_payload->>'timeSlot')::integer,
        coalesce(nullif(v_payload->>'classGroup',''),'A'),'absent'
      );
    else
      raise exception '지원하지 않는 작업입니다.';
    end if;

    if coalesce((v_result->>'ok')::boolean,false) is not true then
      raise exception '%',coalesce(nullif(v_result->>'message',''),'작업을 처리하지 못했습니다.');
    end if;

    if v_reason<>'' and v_type in ('mark_absent','cancel_makeup','cancel_trial') then
      v_memo_result := public.olli_schedule_save_cell_memo_v3(
        p_session_token,p_academy_id,coalesce(nullif(v_payload->>'division',''),'elementary'),
        nullif(v_payload->>'sessionDate','')::date,(v_payload->>'timeSlot')::integer,
        '['||v_name||']['||case when v_type='mark_absent' then '결석' else '취소' end||'] : '||v_reason,
        coalesce(nullif(v_payload->>'classGroup',''),'A'),null
      );
      if coalesce((v_memo_result->>'ok')::boolean,false) is not true then
        raise exception '%',coalesce(nullif(v_memo_result->>'message',''),'사유 메모를 저장하지 못했습니다.');
      end if;
    end if;

    v_date := coalesce(
      nullif(v_payload->>'targetSessionDate','')::date,
      nullif(v_payload->>'sessionDate','')::date,
      nullif(v_payload->>'desiredEffectiveDate','')::date,
      nullif(v_payload->>'effectiveDate','')::date
    );
    v_time := coalesce(
      nullif(v_payload->>'targetTimeSlot','')::integer,
      nullif(v_payload->>'timeSlot','')::integer,
      nullif(v_payload->>'classTime','')::integer
    );
    v_source_weekday := nullif(v_payload->>'sourceWeekday','')::integer;
    v_target_weekday := coalesce(
      nullif(v_payload->>'targetWeekday','')::integer,
      nullif(v_payload->>'weekday','')::integer
    );
    v_source_time := nullif(v_payload->>'sourceTimeSlot','')::integer;
    v_target_time := coalesce(
      nullif(v_payload->>'targetTimeSlot','')::integer,
      nullif(v_payload->>'classTime','')::integer,
      nullif(v_payload->>'timeSlot','')::integer
    );
    v_target_group := coalesce(
      nullif(v_payload->>'targetClassGroup',''),
      nullif(v_payload->>'classGroup',''),
      'A'
    );

    v_body := case v_type
      when 'add_class_once' then '✓ '||v_name||' · '||extract(month from v_date)::integer||'월 '||extract(day from v_date)::integer||'일 '||v_time||'시 수업을 등록했어요.'
      when 'add_makeup' then '✓ '||v_name||' · '||extract(month from v_date)::integer||'월 '||extract(day from v_date)::integer||'일 '||v_time||'시 보강을 등록했어요.'
      when 'update_makeup' then '✓ '||v_name||' · '||extract(month from v_date)::integer||'월 '||extract(day from v_date)::integer||'일 '||v_time||'시 '||v_target_group||'반 보강으로 변경했어요.'
      when 'add_timetable_memo' then '✓ '||
        case when nullif(btrim(v_payload->>'studentName'),'') is not null then v_name||' · ' else '' end||
        extract(month from v_date)::integer||'월 '||extract(day from v_date)::integer||'일 '||
        v_time||'시 '||coalesce(nullif(v_payload->>'classGroup',''),'A')||'반 메모를 등록했어요.'
      when 'delete_timetable_memo' then '✓ '||
        case when nullif(btrim(v_payload->>'studentName'),'') is not null then v_name||' · ' else '' end||
        extract(month from v_date)::integer||'월 '||extract(day from v_date)::integer||'일 '||
        v_time||'시 '||coalesce(nullif(v_payload->>'classGroup',''),'A')||'반 메모를 삭제했어요.'
      when 'add_trial' then '✓ '||v_name||' · '||extract(month from v_date)::integer||'월 '||extract(day from v_date)::integer||'일 '||v_time||'시 체험수업을 등록했어요.'
      when 'update_trial' then '✓ '||v_name||' · '||extract(month from v_date)::integer||'월 '||extract(day from v_date)::integer||'일 '||v_time||'시 '||v_target_group||'반 체험수업으로 변경했어요.'
      when 'add_waitlist' then '✓ '||v_name||' · '||
        case coalesce(v_target_weekday,0) when 1 then '월요일' when 2 then '화요일' when 3 then '수요일' when 4 then '목요일' when 5 then '금요일' when 6 then '토요일' else '' end||
        ' '||coalesce(v_target_time,0)||'시 대기에 등록했어요.'
      when 'update_waitlist' then '✓ '||v_name||' · '||
        case coalesce(v_target_weekday,0) when 1 then '월요일' when 2 then '화요일' when 3 then '수요일' when 4 then '목요일' when 5 then '금요일' when 6 then '토요일' else '' end||
        ' '||coalesce(v_target_time,0)||'시 '||v_target_group||'반 대기로 변경했어요.'
      when 'cancel_waitlist' then '✓ '||v_name||' 학생의 대기를 취소했어요.'
      when 'add_pickup' then '✓ '||v_name||' · '||
        case coalesce(v_target_weekday,0) when 1 then '월요일' when 2 then '화요일' when 3 then '수요일' when 4 then '목요일' when 5 then '금요일' when 6 then '토요일' else '' end||
        ' '||coalesce(v_target_time,0)||'시 수업 '||
        case when coalesce((v_payload->>'isDropoff')::boolean,false) then '하원 픽업' else '픽업' end||'을 등록했어요.'
      when 'update_pickup_arrival' then '✓ '||v_name||' 학생의 픽업 정보를 변경했어요.'
      when 'update_pickup_dropoff' then '✓ '||v_name||' 학생의 하원 픽업 정보를 변경했어요.'
      when 'cancel_pickup' then '✓ '||v_name||' 학생의 픽업을 삭제했어요.'
      when 'cancel_pickup_dropoff' then '✓ '||v_name||' 학생의 하원 픽업을 삭제했어요.'
      when 'move_class' then '✓ '||v_name||' 학생의 수업을 '||
        case coalesce(v_source_weekday,0) when 1 then '월요일' when 2 then '화요일' when 3 then '수요일' when 4 then '목요일' when 5 then '금요일' when 6 then '토요일' else '' end||
        ' '||coalesce(v_source_time,0)||'시에서 '||
        case coalesce(v_target_weekday,0) when 1 then '월요일' when 2 then '화요일' when 3 then '수요일' when 4 then '목요일' when 5 then '금요일' when 6 then '토요일' else '' end||
        ' '||coalesce(v_target_time,0)||'시로 변경했어요.'
      when 'cancel_class_once' then '✓ '||v_name||' · '||extract(month from v_date)::integer||'월 '||extract(day from v_date)::integer||'일 '||v_time||'시 수업 등록을 취소했어요.'
      when 'cancel_makeup' then '✓ '||v_name||' · '||extract(month from v_date)::integer||'월 '||extract(day from v_date)::integer||'일 '||v_time||'시 보강을 취소했어요.'
      when 'cancel_trial' then '✓ '||v_name||' · '||extract(month from v_date)::integer||'월 '||extract(day from v_date)::integer||'일 '||v_time||'시 체험수업을 취소했어요.'
      when 'cancel_move' then '✓ '||v_name||' 학생의 예약된 수업 이동을 취소했어요.'
      when 'mark_absent' then '✓ '||v_name||' · '||extract(month from v_date)::integer||'월 '||extract(day from v_date)::integer||'일 '||v_time||'시 수업을 결석 처리했어요.'
      else '✓ 작업을 완료했어요.'
    end;

    insert into public.olli_team_chat_messages(
      academy_id,sender_member_id,sender_name_snapshot,message_type,body,client_message_id
    )
    values(p_academy_id,null,'올리','system',v_body,extensions.gen_random_uuid())
    returning id into v_result_message_id;

    update public.olli_team_chat_actions
    set status='completed',resolved_by_member_id=v_member_id,result_message_id=v_result_message_id,
        error_text=null,resolved_at=now(),updated_at=now(),revision=revision+1
    where id=v_action.id
    returning * into v_action;
  exception when others then
    v_error := left(coalesce(sqlerrm,'작업을 처리하지 못했습니다.'),500);

    insert into public.olli_team_chat_messages(
      academy_id,sender_member_id,sender_name_snapshot,message_type,body,client_message_id
    )
    values(p_academy_id,null,'올리','system','처리하지 못했어요 · '||v_error,extensions.gen_random_uuid())
    returning id into v_result_message_id;

    update public.olli_team_chat_actions
    set status='failed',resolved_by_member_id=v_member_id,result_message_id=v_result_message_id,
        error_text=v_error,resolved_at=now(),updated_at=now(),revision=revision+1
    where id=v_action.id
    returning * into v_action;

    return jsonb_build_object(
      'ok',false,'message',v_error,
      'action',jsonb_build_object(
        'id',v_action.id,'action_type',v_action.action_type,'status',v_action.status,
        'revision',v_action.revision,'updated_at',v_action.updated_at,
        'resolved_at',v_action.resolved_at,'error',v_action.error_text,
        'result_message_id',v_action.result_message_id
      ),
      'result_message_id',v_result_message_id
    );
  end;

  return jsonb_build_object(
    'ok',true,'result',v_result,
    'action',jsonb_build_object(
      'id',v_action.id,'action_type',v_action.action_type,'status',v_action.status,
      'revision',v_action.revision,'updated_at',v_action.updated_at,
      'resolved_at',v_action.resolved_at,'error',v_action.error_text,
      'result_message_id',v_action.result_message_id
    ),
    'result_message_id',v_result_message_id
  );
end;
$function$;

revoke execute on function public.olli_team_chat_action_execute(text,uuid,uuid) from public;
grant execute on function public.olli_team_chat_action_execute(text,uuid,uuid) to anon, authenticated;
revoke execute on function public.olli_team_chat_send_action(text,uuid,text,text,jsonb,uuid,bigint) from public;
grant execute on function public.olli_team_chat_send_action(text,uuid,text,text,jsonb,uuid,bigint) to anon, authenticated;
