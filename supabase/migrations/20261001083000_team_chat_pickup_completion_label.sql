-- Fix Team Chat add_pickup completion labels for half-hour timetable slots.
-- Storage, action execution, confirmation/cancel semantics, and pickup validation are unchanged.
-- Example: stored kinder slot 8 is rendered as "4시 30분", not "8시".

-- Render stored timetable slots as user-facing clock labels without duplicating the
-- half-hour slot table in Team Chat completion messages.
create or replace function private.olli_schedule_time_slot_label(
  p_academy_id uuid,
  p_division text,
  p_weekday integer,
  p_time_slot integer
)
returns text
language sql
stable
set search_path=''
as $$
  select case
    when p_time_slot is null or p_time_slot <= 0 then ''
    when lower(coalesce(p_division,''))='elementary'
      and p_weekday=6
      and p_time_slot between 10 and 12
      then (p_time_slot - 9)::text || '시'
    when private.olli_schedule_timetable_mode(p_academy_id)='half_hour'
      and lower(coalesce(p_division,''))='elementary'
      and p_time_slot between 7 and 11
      then (p_time_slot - 6)::text || '시 30분'
    when private.olli_schedule_timetable_mode(p_academy_id)='half_hour'
      and lower(coalesce(p_division,''))='kinder'
      and p_time_slot between 7 and 9
      then (p_time_slot - 4)::text || '시 30분'
    else p_time_slot::text || '시'
  end;
$$;

revoke all on function private.olli_schedule_time_slot_label(uuid,text,integer,integer) from public,anon,authenticated;

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
      v_result := public.olli_schedule_save_pickup_v3(
        p_session_token,p_academy_id,nullif(v_payload->>'studentId','')::uuid,
        (v_payload->>'weekday')::integer,(v_payload->>'classTime')::integer,
        case
          when coalesce((v_payload->>'isDropoff')::boolean,false) then null
          else nullif(v_payload->>'pickupLabel','')
        end,
        case
          when coalesce((v_payload->>'isDropoff')::boolean,false) then null
          else nullif(v_payload->>'pickupTime','')::time
        end,
        coalesce(
          nullif(v_payload->>'dropoffLabel',''),
          case
            when coalesce((v_payload->>'isDropoff')::boolean,false)
              then nullif(v_payload->>'pickupLabel','')
            else null
          end
        ),
        nullif(v_payload->>'effectiveDate','')::date
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
      nullif(v_result->>'session_date','')::date,
      nullif(v_payload->>'targetSessionDate','')::date,
      nullif(v_payload->>'sessionDate','')::date,
      nullif(v_payload->>'desiredEffectiveDate','')::date,
      nullif(v_payload->>'effectiveDate','')::date
    );
    v_time := coalesce(
      nullif(v_result->>'time_slot','')::integer,
      nullif(v_payload->>'targetTimeSlot','')::integer,
      nullif(v_payload->>'timeSlot','')::integer,
      nullif(v_payload->>'classTime','')::integer
    );
    v_source_weekday := nullif(v_payload->>'sourceWeekday','')::integer;
    v_target_weekday := coalesce(
      nullif(v_result->>'target_weekday','')::integer,
      nullif(v_payload->>'targetWeekday','')::integer,
      nullif(v_payload->>'weekday','')::integer
    );
    v_source_time := nullif(v_payload->>'sourceTimeSlot','')::integer;
    v_target_time := coalesce(
      nullif(v_result->>'target_time_slot','')::integer,
      nullif(v_result->>'time_slot','')::integer,
      nullif(v_payload->>'targetTimeSlot','')::integer,
      nullif(v_payload->>'classTime','')::integer,
      nullif(v_payload->>'timeSlot','')::integer
    );
    v_target_group := coalesce(
      nullif(v_result->>'target_class_group',''),
      nullif(v_result->>'class_group',''),
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
        ' '||private.olli_schedule_time_slot_label(p_academy_id,'kinder',v_target_weekday,v_target_time)||' 수업 '||
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
