-- Preserve the original A/B choice prompt as conversation history.
-- Selecting a group completes the choice action and creates a separate confirmation action below it.
-- No schedule mutation occurs here.

create or replace function private.olli_team_chat_select_group_choice(
  p_session_token text,
  p_academy_id uuid,
  p_action_id uuid,
  p_class_group text,
  p_choice_type text
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
  v_group text := upper(btrim(coalesce(p_class_group,'')));
  v_choice_type text := lower(btrim(coalesce(p_choice_type,'')));
  v_target_intent text;
  v_group_field text;
  v_next_payload jsonb;
  v_name text;
  v_date date;
  v_time integer;
  v_weekday integer;
  v_source_weekday integer;
  v_source_time integer;
  v_target_weekday integer;
  v_target_time integer;
  v_body text;
  v_confirmation jsonb;
  v_confirmation_message_id bigint;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;
  if p_academy_id is null or p_action_id is null then
    raise exception '반 선택 작업 정보를 확인해 주세요.';
  end if;
  if v_group not in ('A','B') then
    raise exception 'A반 또는 B반을 선택해 주세요.';
  end if;

  select m.id into v_member_id
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id
    and m.account_id=v_account_id
    and m.status='active'
    and a.status='active'
    and a.deleted_at is null
  order by case m.role
    when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end,
    m.created_at
  limit 1;

  if v_member_id is null then
    raise exception '현재 계정은 이 학원의 팀톡을 사용할 수 없습니다.';
  end if;

  select a.* into v_action
  from public.olli_team_chat_actions a
  where a.id=p_action_id
    and a.academy_id=p_academy_id
  for update;

  if v_action.id is null then
    raise exception '반 선택 작업을 찾지 못했습니다.';
  end if;
  if v_action.status <> 'pending' then
    return jsonb_build_object(
      'ok',false,
      'message','이미 처리된 작업입니다.',
      'action',jsonb_build_object(
        'id',v_action.id,
        'action_type',v_action.action_type,
        'status',v_action.status,
        'revision',v_action.revision,
        'updated_at',v_action.updated_at,
        'result_message_id',v_action.result_message_id
      )
    );
  end if;
  if v_action.action_type <> v_choice_type then
    raise exception '현재 작업은 요청한 반 선택 상태가 아닙니다.';
  end if;

  v_payload := v_action.action_payload;

  case v_choice_type
    when 'choose_makeup_group' then
      v_target_intent := 'add_makeup';
      v_group_field := 'classGroup';
    when 'choose_trial_group' then
      v_target_intent := 'add_trial';
      v_group_field := 'classGroup';
    when 'choose_waitlist_group' then
      v_target_intent := 'add_waitlist';
      v_group_field := 'targetClassGroup';
    when 'choose_move_group' then
      v_target_intent := 'move_class';
      v_group_field := 'targetClassGroup';
    else
      raise exception '지원하지 않는 반 선택 작업입니다.';
  end case;

  if lower(btrim(coalesce(v_payload->>'targetIntent',''))) <> v_target_intent then
    raise exception '반 선택 대상 작업이 올바르지 않습니다.';
  end if;
  if jsonb_typeof(v_payload->'allowedClassGroups') <> 'array'
     or not exists (
       select 1
       from jsonb_array_elements_text(v_payload->'allowedClassGroups') as item(value)
       where upper(btrim(item.value))=v_group
     ) then
    raise exception '선택할 수 없는 반입니다.';
  end if;

  v_next_payload := (v_payload - 'allowedClassGroups' - 'targetIntent')
    || jsonb_build_object('intent',v_target_intent)
    || jsonb_build_object(v_group_field,v_group);

  case v_choice_type
    when 'choose_makeup_group' then
      v_date := nullif(btrim(v_payload->>'sessionDate'),'')::date;
      v_time := nullif(btrim(v_payload->>'timeSlot'),'')::integer;
      v_name := coalesce(nullif(btrim(v_payload->>'studentName'),''),'학생');
      if v_date is null or v_time is null then
        raise exception '보강 날짜와 시간을 확인하지 못했습니다.';
      end if;
      v_body := v_name
        || ' · ' || extract(month from v_date)::integer || '월 ' || extract(day from v_date)::integer || '일'
        || ' ' || v_time || '시 ' || v_group || '반'
        || E'\n보강으로 등록할까요?';

    when 'choose_trial_group' then
      v_date := nullif(btrim(v_payload->>'sessionDate'),'')::date;
      v_time := nullif(btrim(v_payload->>'timeSlot'),'')::integer;
      v_name := coalesce(
        nullif(btrim(v_payload->>'guestName'),''),
        nullif(btrim(v_payload->>'studentName'),''),
        '학생'
      );
      if v_date is null or v_time is null then
        raise exception '체험 날짜와 시간을 확인하지 못했습니다.';
      end if;
      v_body := v_name
        || ' · ' || extract(month from v_date)::integer || '월 ' || extract(day from v_date)::integer || '일'
        || ' ' || v_time || '시 ' || v_group || '반'
        || E'\n체험수업으로 등록할까요?';

    when 'choose_waitlist_group' then
      v_name := coalesce(
        nullif(btrim(v_payload->>'studentName'),''),
        nullif(btrim(v_payload->>'guestName'),''),
        '학생'
      );
      v_weekday := nullif(btrim(v_payload->>'targetWeekday'),'')::integer;
      v_time := nullif(btrim(v_payload->>'targetTimeSlot'),'')::integer;
      if v_weekday is null or v_time is null then
        raise exception '대기 요일과 시간을 확인하지 못했습니다.';
      end if;
      v_body := v_name
        || ' · '
        || case v_weekday
             when 1 then '월요일' when 2 then '화요일' when 3 then '수요일'
             when 4 then '목요일' when 5 then '금요일' when 6 then '토요일' else ''
           end
        || ' ' || v_time || '시 ' || v_group || '반'
        || E'\n대기로 등록할까요?';

    when 'choose_move_group' then
      v_name := coalesce(nullif(btrim(v_payload->>'studentName'),''),'학생');
      v_source_weekday := nullif(btrim(v_payload->>'sourceWeekday'),'')::integer;
      v_source_time := nullif(btrim(v_payload->>'sourceTimeSlot'),'')::integer;
      v_target_weekday := nullif(btrim(v_payload->>'targetWeekday'),'')::integer;
      v_target_time := nullif(btrim(v_payload->>'targetTimeSlot'),'')::integer;
      if v_source_weekday is null or v_source_time is null
         or v_target_weekday is null or v_target_time is null then
        raise exception '수업 이동 요일과 시간을 확인하지 못했습니다.';
      end if;
      v_body := v_name
        || ' · '
        || case v_source_weekday
             when 1 then '월요일' when 2 then '화요일' when 3 then '수요일'
             when 4 then '목요일' when 5 then '금요일' when 6 then '토요일' else ''
           end
        || ' ' || v_source_time || '시 → '
        || case v_target_weekday
             when 1 then '월요일' when 2 then '화요일' when 3 then '수요일'
             when 4 then '목요일' when 5 then '금요일' when 6 then '토요일' else ''
           end
        || ' ' || v_target_time || '시 ' || v_group || '반'
        || E'\n정규수업 시간을 변경할까요?';
  end case;

  v_confirmation := public.olli_team_chat_send_action(
    p_session_token,
    p_academy_id,
    v_body,
    v_target_intent,
    v_next_payload,
    extensions.gen_random_uuid(),
    null
  );

  if coalesce((v_confirmation->>'ok')::boolean,false) is not true then
    raise exception '확인 작업 카드를 저장하지 못했습니다.';
  end if;

  v_confirmation_message_id := nullif(v_confirmation #>> '{message,id}','')::bigint;
  if v_confirmation_message_id is null then
    raise exception '확인 메시지를 저장하지 못했습니다.';
  end if;

  update public.olli_team_chat_actions
  set action_payload=v_payload || jsonb_build_object('selectedClassGroup',v_group),
      status='completed',
      resolved_by_member_id=v_member_id,
      result_message_id=v_confirmation_message_id,
      resolved_at=now(),
      revision=revision+1,
      updated_at=now()
  where id=v_action.id
  returning * into v_action;

  return jsonb_build_object(
    'ok',true,
    'changed',true,
    'action',jsonb_build_object(
      'id',v_action.id,
      'action_type',v_action.action_type,
      'status',v_action.status,
      'revision',v_action.revision,
      'updated_at',v_action.updated_at,
      'resolved_at',v_action.resolved_at,
      'result_message_id',v_action.result_message_id
    ),
    'confirmation_message',v_confirmation->'message'
  );
end;
$function$;

revoke execute on function private.olli_team_chat_select_group_choice(text,uuid,uuid,text,text) from public, anon, authenticated;

create or replace function public.olli_team_chat_action_select_makeup_group(
  p_session_token text,
  p_academy_id uuid,
  p_action_id uuid,
  p_class_group text
)
returns jsonb
language sql
security definer
set search_path to ''
as $function$
  select private.olli_team_chat_select_group_choice(
    p_session_token,p_academy_id,p_action_id,p_class_group,'choose_makeup_group'
  );
$function$;

create or replace function public.olli_team_chat_action_select_trial_group(
  p_session_token text,
  p_academy_id uuid,
  p_action_id uuid,
  p_class_group text
)
returns jsonb
language sql
security definer
set search_path to ''
as $function$
  select private.olli_team_chat_select_group_choice(
    p_session_token,p_academy_id,p_action_id,p_class_group,'choose_trial_group'
  );
$function$;

create or replace function public.olli_team_chat_action_select_waitlist_group(
  p_session_token text,
  p_academy_id uuid,
  p_action_id uuid,
  p_class_group text
)
returns jsonb
language sql
security definer
set search_path to ''
as $function$
  select private.olli_team_chat_select_group_choice(
    p_session_token,p_academy_id,p_action_id,p_class_group,'choose_waitlist_group'
  );
$function$;

create or replace function public.olli_team_chat_action_select_move_group(
  p_session_token text,
  p_academy_id uuid,
  p_action_id uuid,
  p_class_group text
)
returns jsonb
language sql
security definer
set search_path to ''
as $function$
  select private.olli_team_chat_select_group_choice(
    p_session_token,p_academy_id,p_action_id,p_class_group,'choose_move_group'
  );
$function$;

revoke execute on function public.olli_team_chat_action_select_makeup_group(text,uuid,uuid,text) from public;
revoke execute on function public.olli_team_chat_action_select_trial_group(text,uuid,uuid,text) from public;
revoke execute on function public.olli_team_chat_action_select_waitlist_group(text,uuid,uuid,text) from public;
revoke execute on function public.olli_team_chat_action_select_move_group(text,uuid,uuid,text) from public;

grant execute on function public.olli_team_chat_action_select_makeup_group(text,uuid,uuid,text) to anon, authenticated;
grant execute on function public.olli_team_chat_action_select_trial_group(text,uuid,uuid,text) to anon, authenticated;
grant execute on function public.olli_team_chat_action_select_waitlist_group(text,uuid,uuid,text) to anon, authenticated;
grant execute on function public.olli_team_chat_action_select_move_group(text,uuid,uuid,text) to anon, authenticated;
