-- Team Talk action cards step 3: execute a persisted pending action only after explicit button approval.
-- The browser sends action_id only. The server reads the stored payload and reuses existing schedule RPCs.

alter table public.olli_team_chat_actions
  drop constraint if exists olli_team_chat_actions_type_check;
alter table public.olli_team_chat_actions
  add constraint olli_team_chat_actions_type_check
  check (action_type = any (array[
    'add_class_once'::text,
    'cancel_class_once'::text,
    'add_pickup'::text,
    'add_makeup'::text,
    'cancel_makeup'::text,
    'add_trial'::text,
    'cancel_trial'::text,
    'add_waitlist'::text,
    'move_class'::text,
    'cancel_move'::text,
    'mark_absent'::text
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
    'add_makeup','cancel_makeup','add_trial','cancel_trial',
    'add_waitlist','move_class','cancel_move','mark_absent'
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
    elsif v_type='add_pickup' then
      v_result := public.olli_schedule_save_pickup_v2(
        p_session_token,p_academy_id,nullif(v_payload->>'studentId','')::uuid,
        (v_payload->>'weekday')::integer,(v_payload->>'classTime')::integer,
        v_payload->>'pickupLabel',nullif(v_payload->>'pickupTime','')::time,
        nullif(v_payload->>'effectiveDate','')::date,coalesce((v_payload->>'isDropoff')::boolean,false)
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
    elsif v_type='add_trial' then
      v_result := public.olli_schedule_add_guest_entry(
        p_session_token,p_academy_id,coalesce(nullif(v_payload->>'guestName',''),v_payload->>'studentName'),
        v_payload->>'division','trial',nullif(v_payload->>'sessionDate','')::date,
        (v_payload->>'timeSlot')::integer,coalesce(nullif(v_payload->>'classGroup',''),'A')
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

    v_date := nullif(v_payload->>'sessionDate','')::date;
    v_time := coalesce(
      nullif(v_payload->>'timeSlot','')::integer,
      nullif(v_payload->>'targetTimeSlot','')::integer,
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
      nullif(v_payload->>'classTime','')::integer
    );

    v_body := case v_type
      when 'add_class_once' then '✓ '||v_name||' · '||extract(month from v_date)::integer||'월 '||extract(day from v_date)::integer||'일 '||v_time||'시 수업을 등록했어요.'
      when 'add_makeup' then '✓ '||v_name||' · '||extract(month from v_date)::integer||'월 '||extract(day from v_date)::integer||'일 '||v_time||'시 보강을 등록했어요.'
      when 'add_trial' then '✓ '||v_name||' · '||extract(month from v_date)::integer||'월 '||extract(day from v_date)::integer||'일 '||v_time||'시 체험수업을 등록했어요.'
      when 'add_waitlist' then '✓ '||v_name||' · '||
        case coalesce(v_target_weekday,0) when 1 then '월요일' when 2 then '화요일' when 3 then '수요일' when 4 then '목요일' when 5 then '금요일' when 6 then '토요일' else '' end||
        ' '||coalesce(v_target_time,0)||'시 대기에 등록했어요.'
      when 'add_pickup' then '✓ '||v_name||' · '||
        case coalesce(v_target_weekday,0) when 1 then '월요일' when 2 then '화요일' when 3 then '수요일' when 4 then '목요일' when 5 then '금요일' when 6 then '토요일' else '' end||
        ' '||coalesce(v_target_time,0)||'시 수업 '||
        case when coalesce((v_payload->>'isDropoff')::boolean,false) then '하원 픽업' else '픽업' end||'을 등록했어요.'
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
