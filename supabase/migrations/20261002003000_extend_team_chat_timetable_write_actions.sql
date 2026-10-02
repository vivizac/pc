-- Extend Team Chat confirmation-card execution for the remaining timetable UI writes.
-- Existing action types continue through the preserved legacy executor unchanged.

do $migration$
begin
  if to_regprocedure('public.olli_team_chat_action_execute_legacy_20261002(text,uuid,uuid)') is null then
    alter function public.olli_team_chat_action_execute(text,uuid,uuid)
      rename to olli_team_chat_action_execute_legacy_20261002;
  end if;
end
$migration$;

create or replace function private.olli_team_chat_action_execute_timetable_ext(
  p_session_token text,
  p_academy_id uuid,
  p_action_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_member_id uuid;
  v_action public.olli_team_chat_actions%rowtype;
  v_payload jsonb;
  v_result jsonb;
  v_type text;
  v_name text;
  v_body text;
  v_error text;
  v_result_message_id bigint;
  v_status text;
  v_division text;
  v_split boolean;
  v_teacher_name text;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;
  if p_academy_id is null or p_action_id is null then
    raise exception '작업 정보를 확인해 주세요.';
  end if;

  select m.id into v_member_id
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id
    and m.account_id=v_account_id
    and m.status='active'
    and a.status='active'
    and a.deleted_at is null
  order by case m.role when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end, m.created_at
  limit 1;

  if v_member_id is null then
    raise exception '현재 계정은 이 학원의 팀톡을 사용할 수 없습니다.';
  end if;

  select a.* into v_action
  from public.olli_team_chat_actions a
  where a.id=p_action_id and a.academy_id=p_academy_id
  for update;

  if v_action.id is null then
    raise exception '작업 요청을 찾지 못했습니다.';
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
        'resolved_at',v_action.resolved_at,
        'error',v_action.error_text,
        'result_message_id',v_action.result_message_id
      )
    );
  end if;

  v_payload := coalesce(v_action.action_payload,'{}'::jsonb);
  v_type := btrim(coalesce(v_action.action_type,''));
  v_name := coalesce(
    nullif(btrim(v_payload->>'studentName'),''),
    nullif(btrim(v_payload->>'guestName'),''),
    '학생'
  );
  v_teacher_name := coalesce(nullif(btrim(v_payload->>'teacherName'),''),'선생님');

  if nullif(v_payload->>'studentId','') is not null then
    select coalesce(nullif(btrim(s.name),''),v_name) into v_name
    from public.students s
    where s.id::text=(v_payload->>'studentId')
      and s.academy_id=p_academy_id
    limit 1;
    v_name := coalesce(v_name,'학생');
  end if;

  begin
    if v_type='set_regular_schedule' then
      if jsonb_typeof(v_payload->'pairs') <> 'array' then
        raise exception '정규수업 시간표 정보를 확인해 주세요.';
      end if;
      v_result := public.olli_schedule_set_student_weekly_schedule(
        p_session_token,
        p_academy_id,
        nullif(v_payload->>'studentId','')::uuid,
        v_payload->'pairs',
        coalesce(nullif(v_payload->>'effectiveDate','')::date,current_date)
      );

    elsif v_type='remove_regular_class' then
      v_result := public.olli_schedule_execute(
        p_session_token,
        p_academy_id,
        'remove_enrollment',
        jsonb_build_object(
          'student_id',v_payload->>'studentId',
          'enrollment_id',v_payload->>'enrollmentId',
          'effective_date',coalesce(nullif(v_payload->>'effectiveDate','')::date,current_date)
        )
      );

    elsif v_type='accept_waitlist' then
      v_result := public.olli_schedule_resolve_waitlist(
        p_session_token,
        p_academy_id,
        nullif(v_payload->>'waitlistId','')::uuid,
        'accept',
        coalesce(nullif(v_payload->>'effectiveDate','')::date,current_date)
      );

    elsif v_type='set_attendance_status' then
      v_status := lower(btrim(coalesce(v_payload->>'status','')));
      if v_status not in ('present','blank','makeup') then
        raise exception '출석 상태 변경 값을 확인해 주세요.';
      end if;
      v_result := public.olli_schedule_set_attendance_session_status_v2(
        p_session_token,
        p_academy_id,
        nullif(v_payload->>'studentId','')::uuid,
        nullif(v_payload->>'sessionDate','')::date,
        coalesce(nullif(v_payload->>'sessionKind',''),'regular'),
        nullif(v_payload->>'timeSlot','')::integer,
        coalesce(nullif(v_payload->>'classGroup',''),'A'),
        v_status
      );

    elsif v_type='set_session_order' then
      v_result := public.olli_schedule_execute(
        p_session_token,
        p_academy_id,
        'set_session_order',
        jsonb_build_object(
          'student_id',v_payload->>'studentId',
          'enrollment_id',v_payload->>'enrollmentId',
          'session_order',v_payload->>'sessionOrder',
          'effective_date',coalesce(nullif(v_payload->>'effectiveDate','')::date,current_date)
        )
      );

    elsif v_type='set_class_teacher' then
      v_result := public.olli_schedule_set_class_teacher(
        p_session_token,
        p_academy_id,
        nullif(v_payload->>'division',''),
        nullif(v_payload->>'weekday','')::integer,
        nullif(v_payload->>'timeSlot','')::integer,
        coalesce(nullif(v_payload->>'classGroup',''),'A'),
        nullif(v_payload->>'teacherMemberId','')::uuid
      );

    elsif v_type='set_teacher_override' then
      v_result := public.olli_schedule_set_teacher_override(
        p_session_token,
        p_academy_id,
        nullif(v_payload->>'sessionDate','')::date,
        nullif(v_payload->>'division',''),
        nullif(v_payload->>'timeSlot','')::integer,
        coalesce(nullif(v_payload->>'classGroup',''),'A'),
        nullif(v_payload->>'teacherMemberId','')::uuid,
        coalesce(nullif(v_payload->>'reason',''),'teacher_absence')
      );

    elsif v_type='set_class_split' then
      v_division := lower(btrim(coalesce(v_payload->>'division','')));
      v_split := coalesce((v_payload->>'split')::boolean,false);
      if v_division='kinder' then
        v_result := public.olli_schedule_set_kinder_class_split(
          p_session_token,
          p_academy_id,
          nullif(v_payload->>'weekday','')::integer,
          nullif(v_payload->>'timeSlot','')::integer,
          v_split
        );
      elsif v_division='elementary' then
        v_result := public.olli_schedule_execute(
          p_session_token,
          p_academy_id,
          case when v_split then 'split_class' else 'merge_class' end,
          jsonb_build_object(
            'weekday',v_payload->>'weekday',
            'time_slot',v_payload->>'timeSlot',
            'effective_date',coalesce(nullif(v_payload->>'effectiveDate','')::date,current_date)
          )
        );
      else
        raise exception '분반 수업 구분을 확인해 주세요.';
      end if;

    elsif v_type='set_normal_class_day' then
      v_result := public.olli_schedule_set_normal_class_day(
        p_session_token,
        p_academy_id,
        nullif(v_payload->>'sessionDate','')::date,
        coalesce((v_payload->>'normalClass')::boolean,false)
      );

    elsif v_type='restore_schedule_history' then
      v_result := public.olli_schedule_restore_history(
        p_session_token,
        p_academy_id,
        nullif(v_payload->>'transactionId','')::bigint
      );

    else
      raise exception '지원하지 않는 확장 시간표 작업입니다.';
    end if;

    if coalesce((v_result->>'ok')::boolean,false) is not true then
      raise exception '%',coalesce(nullif(v_result->>'message',''),'작업을 처리하지 못했습니다.');
    end if;

    v_body := case v_type
      when 'set_regular_schedule' then
        '✓ '||v_name||' 학생의 정규수업 시간표를 변경했어요.'
      when 'remove_regular_class' then
        '✓ '||v_name||' 학생의 정규수업 등록을 해제했어요.'
      when 'accept_waitlist' then
        '✓ '||v_name||' 학생의 대기를 수업 등록으로 전환했어요.'
      when 'set_attendance_status' then
        case lower(coalesce(v_payload->>'status',''))
          when 'present' then '✓ '||v_name||' 학생을 출석 처리했어요.'
          when 'makeup' then '✓ '||v_name||' 학생의 보강 출석을 처리했어요.'
          else '✓ '||v_name||' 학생의 출석 상태를 지웠어요.'
        end
      when 'set_session_order' then
        '✓ '||v_name||' 학생의 수업 순서를 변경했어요.'
      when 'set_class_teacher' then
        case when nullif(v_payload->>'teacherMemberId','') is null
          then '✓ 해당 수업의 담당 선생님 배정을 해제했어요.'
          else '✓ 해당 수업 담당을 '||v_teacher_name||' 선생님으로 변경했어요.'
        end
      when 'set_teacher_override' then
        case when nullif(v_payload->>'teacherMemberId','') is null
          then '✓ 해당 날짜의 대체 선생님 지정을 해제했어요.'
          else '✓ 해당 날짜의 담당을 '||v_teacher_name||' 선생님으로 변경했어요.'
        end
      when 'set_class_split' then
        '✓ 해당 수업을 '||case when coalesce((v_payload->>'split')::boolean,false) then 'A/B반으로 분반했어요.' else '한 반으로 병합했어요.' end
      when 'set_normal_class_day' then
        '✓ '||coalesce(v_payload->>'sessionDate','해당 날짜')||'을 '||
        case when coalesce((v_payload->>'normalClass')::boolean,false) then '정상수업일로 전환했어요.' else '휴원일 설정으로 되돌렸어요.' end
      when 'restore_schedule_history' then
        '✓ 선택한 시간표 변경 이력을 복구했어요.'
      else '✓ 작업을 완료했어요.'
    end;

    insert into public.olli_team_chat_messages(
      academy_id,sender_member_id,sender_name_snapshot,message_type,body,client_message_id
    )
    values(
      p_academy_id,null,'올리','system',v_body,extensions.gen_random_uuid()
    )
    returning id into v_result_message_id;

    update public.olli_team_chat_actions
    set status='completed',
        resolved_by_member_id=v_member_id,
        result_message_id=v_result_message_id,
        error_text=null,
        resolved_at=now(),
        updated_at=now(),
        revision=revision+1
    where id=v_action.id
    returning * into v_action;

  exception when others then
    v_error := left(coalesce(sqlerrm,'작업을 처리하지 못했습니다.'),500);

    insert into public.olli_team_chat_messages(
      academy_id,sender_member_id,sender_name_snapshot,message_type,body,client_message_id
    )
    values(
      p_academy_id,null,'올리','system','처리하지 못했어요 · '||v_error,extensions.gen_random_uuid()
    )
    returning id into v_result_message_id;

    update public.olli_team_chat_actions
    set status='failed',
        resolved_by_member_id=v_member_id,
        result_message_id=v_result_message_id,
        error_text=v_error,
        resolved_at=now(),
        updated_at=now(),
        revision=revision+1
    where id=v_action.id
    returning * into v_action;

    return jsonb_build_object(
      'ok',false,
      'message',v_error,
      'action',jsonb_build_object(
        'id',v_action.id,
        'action_type',v_action.action_type,
        'status',v_action.status,
        'revision',v_action.revision,
        'updated_at',v_action.updated_at,
        'resolved_at',v_action.resolved_at,
        'error',v_action.error_text,
        'result_message_id',v_action.result_message_id
      ),
      'result_message_id',v_result_message_id
    );
  end;

  return jsonb_build_object(
    'ok',true,
    'result',v_result,
    'action',jsonb_build_object(
      'id',v_action.id,
      'action_type',v_action.action_type,
      'status',v_action.status,
      'revision',v_action.revision,
      'updated_at',v_action.updated_at,
      'resolved_at',v_action.resolved_at,
      'error',v_action.error_text,
      'result_message_id',v_action.result_message_id
    ),
    'result_message_id',v_result_message_id
  );
end
$function$;

revoke all on function private.olli_team_chat_action_execute_timetable_ext(text,uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function public.olli_team_chat_action_execute(
  p_session_token text,
  p_academy_id uuid,
  p_action_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_type text;
begin
  select a.action_type into v_type
  from public.olli_team_chat_actions a
  where a.id=p_action_id and a.academy_id=p_academy_id
  limit 1;

  if btrim(coalesce(v_type,'')) in (
    'set_regular_schedule',
    'remove_regular_class',
    'accept_waitlist',
    'set_attendance_status',
    'set_session_order',
    'set_class_teacher',
    'set_teacher_override',
    'set_class_split',
    'set_normal_class_day',
    'restore_schedule_history'
  ) then
    return private.olli_team_chat_action_execute_timetable_ext(
      p_session_token,p_academy_id,p_action_id
    );
  end if;

  return public.olli_team_chat_action_execute_legacy_20261002(
    p_session_token,p_academy_id,p_action_id
  );
end
$function$;

revoke all on function public.olli_team_chat_action_execute_legacy_20261002(text,uuid,uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.olli_team_chat_action_execute(text,uuid,uuid)
  to anon, authenticated, service_role;
