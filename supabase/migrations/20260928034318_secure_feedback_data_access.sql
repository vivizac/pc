-- Production migration: 20260928034318 secure_feedback_data_access

CREATE OR REPLACE FUNCTION private.olli_feedback_data_access_impl(p_resource text, p_session_token text, p_academy_id uuid, p_action text, p_operation text, p_identity jsonb DEFAULT '{}'::jsonb, p_payload jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_role text;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_operation text := lower(btrim(coalesce(p_operation, '')));
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 5000);
  v_student_id uuid;
  v_student_name text := btrim(coalesce(p_identity->>'student_name', ''));
  v_record_text text := btrim(coalesce(p_identity->>'id', ''));
  v_record_bigint bigint;
  v_record_uuid uuid;
  v_payload_academy uuid;
  v_mutation_id text := btrim(coalesce(p_payload->>'client_mutation_id', ''));
  v_content text := coalesce(p_payload->>'content', '');
  v_rows jsonb := '[]'::jsonb;
  v_row_feedback public.feedbacks%rowtype;
  v_row_growth public.fail_feedbacks%rowtype;
  v_row_summary public.summary_feedbacks%rowtype;
  v_deleted_by text := nullif(btrim(coalesce(p_payload->>'deleted_by', '')), '');
  v_delete_reason text := coalesce(nullif(btrim(coalesce(p_payload->>'delete_reason', '')), ''), 'student_deleted');
begin
  if p_resource not in ('feedbacks','fail_feedbacks','summary_feedbacks') then
    return jsonb_build_object('ok', false, 'code', 'RESOURCE_NOT_ALLOWED', 'message', '지원하지 않는 피드백 데이터입니다.');
  end if;

  if p_academy_id is null then
    return jsonb_build_object('ok', false, 'code', 'ACADEMY_ID_MISSING', 'message', '학원 정보를 확인할 수 없습니다.');
  end if;

  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'code', 'SESSION_INVALID', 'message', '계정 세션이 만료되었거나 올바르지 않습니다.');
  end if;

  select m.role
    into v_role
  from public.academy_members m
  join public.academies a on a.id = m.academy_id
  where m.academy_id = p_academy_id
    and m.account_id = v_account_id
    and m.status = 'active'
    and m.role in ('owner','manager','teacher','super_admin')
    and a.status = 'active'
    and a.deleted_at is null
  limit 1;

  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'PERMISSION_DENIED', 'message', '현재 학원의 피드백 데이터에 접근할 권한이 없습니다.');
  end if;

  if nullif(btrim(coalesce(p_payload->>'academy_id', '')), '') is not null then
    begin
      v_payload_academy := (p_payload->>'academy_id')::uuid;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ACADEMY_ID', 'message', '피드백 저장 학원 ID가 올바르지 않습니다.');
    end;
    if v_payload_academy is distinct from p_academy_id then
      return jsonb_build_object('ok', false, 'code', 'ACADEMY_MISMATCH', 'message', '다른 학원의 피드백 데이터는 처리할 수 없습니다.');
    end if;
  end if;

  if nullif(btrim(coalesce(p_identity->>'student_id', p_payload->>'student_id', '')), '') is not null then
    begin
      v_student_id := coalesce(nullif(p_identity->>'student_id',''), nullif(p_payload->>'student_id',''))::uuid;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'INVALID_STUDENT_ID', 'message', '학생 ID가 올바르지 않습니다.');
    end;
  end if;

  if v_action = 'read' then
    if p_resource = 'feedbacks' then
      select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc, q.id desc), '[]'::jsonb)
        into v_rows
      from (
        select f.*
        from public.feedbacks f
        where f.academy_id = p_academy_id
          and (v_student_id is null or f.student_id = v_student_id)
          and (v_student_id is not null or v_student_name = '' or f.student_name = v_student_name)
        order by f.created_at desc, f.id desc
        limit v_limit
      ) q;
    elsif p_resource = 'fail_feedbacks' then
      select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc, q.id desc), '[]'::jsonb)
        into v_rows
      from (
        select f.*
        from public.fail_feedbacks f
        where f.academy_id = p_academy_id
          and (v_student_id is null or f.student_id = v_student_id)
          and (v_student_id is not null or v_student_name = '' or f.student_name = v_student_name)
        order by f.created_at desc, f.id desc
        limit v_limit
      ) q;
    else
      select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc, q.id desc), '[]'::jsonb)
        into v_rows
      from (
        select f.*
        from public.summary_feedbacks f
        where f.academy_id = p_academy_id
          and (v_student_id is null or f.student_id = v_student_id)
          and (v_student_id is not null or v_student_name = '' or f.student_name = v_student_name)
        order by f.created_at desc, f.id desc
        limit v_limit
      ) q;
    end if;
    return jsonb_build_object('ok', true, 'rows', v_rows);
  end if;

  if v_action not in ('write','remove') then
    return jsonb_build_object('ok', false, 'code', 'ACTION_NOT_ALLOWED', 'message', '지원하지 않는 피드백 작업입니다.');
  end if;

  if v_operation in ('post','insert','create') then
    if v_student_id is null then
      return jsonb_build_object('ok', false, 'code', 'STUDENT_ID_MISSING', 'message', '학생 ID가 없습니다.');
    end if;
    if not exists (
      select 1 from public.students s
      where s.id = v_student_id
        and s.academy_id = p_academy_id
        and coalesce(s.is_deleted,false) = false
    ) then
      return jsonb_build_object('ok', false, 'code', 'STUDENT_NOT_FOUND', 'message', '현재 학원에서 학생을 찾을 수 없습니다.');
    end if;
    if btrim(v_content) = '' then
      return jsonb_build_object('ok', false, 'code', 'FEEDBACK_CONTENT_MISSING', 'message', '피드백 내용이 비어 있습니다.');
    end if;
    if v_mutation_id = '' then
      return jsonb_build_object('ok', false, 'code', 'FEEDBACK_IDEMPOTENCY_INPUT_MISSING', 'message', '피드백 중복방지 식별값이 없습니다.');
    end if;

    if p_resource = 'feedbacks' then
      insert into public.feedbacks (
        academy_id, student_id, student_name, content, feedback_type,
        future_direction, year, date, lesson_date, member_id, client_mutation_id
      ) values (
        p_academy_id,
        v_student_id,
        coalesce(p_payload->>'student_name',''),
        v_content,
        nullif(p_payload->>'feedback_type',''),
        nullif(p_payload->>'future_direction',''),
        nullif(p_payload->>'year','')::integer,
        nullif(p_payload->>'date',''),
        nullif(p_payload->>'lesson_date','')::date,
        nullif(p_payload->>'member_id','')::uuid,
        v_mutation_id
      )
      on conflict (academy_id, client_mutation_id) do nothing
      returning * into v_row_feedback;

      if not found then
        select * into v_row_feedback
        from public.feedbacks f
        where f.academy_id = p_academy_id
          and f.client_mutation_id = v_mutation_id
        limit 1;
      end if;

      if not found
         or v_row_feedback.student_id is distinct from v_student_id
         or coalesce(v_row_feedback.content,'') is distinct from v_content
         or coalesce(v_row_feedback.feedback_type,'') is distinct from coalesce(p_payload->>'feedback_type','') then
        return jsonb_build_object('ok', false, 'code', 'FEEDBACK_IDEMPOTENCY_MISMATCH', 'message', '같은 피드백 중복방지 ID에 다른 내용이 감지되었습니다.');
      end if;
      return jsonb_build_object('ok', true, 'rows', jsonb_build_array(to_jsonb(v_row_feedback)));
    end if;

    if p_resource = 'fail_feedbacks' then
      insert into public.fail_feedbacks (
        academy_id, student_id, student_name, content, feedback_type,
        year, date, client_mutation_id
      ) values (
        p_academy_id,
        v_student_id,
        coalesce(p_payload->>'student_name',''),
        v_content,
        coalesce(nullif(p_payload->>'feedback_type',''),'fail'),
        nullif(p_payload->>'year','')::integer,
        nullif(p_payload->>'date',''),
        v_mutation_id
      )
      on conflict (academy_id, client_mutation_id) do nothing
      returning * into v_row_growth;

      if not found then
        select * into v_row_growth
        from public.fail_feedbacks f
        where f.academy_id = p_academy_id
          and f.client_mutation_id = v_mutation_id
        limit 1;
      end if;

      if not found
         or v_row_growth.student_id is distinct from v_student_id
         or coalesce(v_row_growth.content,'') is distinct from v_content
         or coalesce(v_row_growth.feedback_type,'') is distinct from coalesce(nullif(p_payload->>'feedback_type',''),'fail') then
        return jsonb_build_object('ok', false, 'code', 'FEEDBACK_IDEMPOTENCY_MISMATCH', 'message', '같은 성장 피드백 중복방지 ID에 다른 내용이 감지되었습니다.');
      end if;
      return jsonb_build_object('ok', true, 'rows', jsonb_build_array(to_jsonb(v_row_growth)));
    end if;

    insert into public.summary_feedbacks (
      academy_id, student_id, student_name, content, feedback_type, date,
      period_months, source_feedback_ids, created_by, year, summary_months,
      client_mutation_id
    ) values (
      p_academy_id,
      v_student_id,
      nullif(p_payload->>'student_name',''),
      v_content,
      nullif(p_payload->>'feedback_type',''),
      nullif(p_payload->>'date',''),
      nullif(p_payload->>'period_months','')::integer,
      case
        when jsonb_typeof(p_payload->'source_feedback_ids') = 'array'
        then array(select jsonb_array_elements_text(p_payload->'source_feedback_ids')::uuid)
        else null
      end,
      nullif(p_payload->>'created_by','')::uuid,
      nullif(p_payload->>'year','')::integer,
      nullif(p_payload->>'summary_months','')::integer,
      v_mutation_id
    )
    on conflict (academy_id, client_mutation_id) do nothing
    returning * into v_row_summary;

    if not found then
      select * into v_row_summary
      from public.summary_feedbacks f
      where f.academy_id = p_academy_id
        and f.client_mutation_id = v_mutation_id
      limit 1;
    end if;

    if not found
       or v_row_summary.student_id is distinct from v_student_id
       or coalesce(v_row_summary.content,'') is distinct from v_content
       or coalesce(v_row_summary.feedback_type,'') is distinct from coalesce(p_payload->>'feedback_type','') then
      return jsonb_build_object('ok', false, 'code', 'FEEDBACK_IDEMPOTENCY_MISMATCH', 'message', '같은 종합 피드백 중복방지 ID에 다른 내용이 감지되었습니다.');
    end if;
    return jsonb_build_object('ok', true, 'rows', jsonb_build_array(to_jsonb(v_row_summary)));
  end if;

  if v_operation in ('patch','update') then
    if v_record_text = '' then
      return jsonb_build_object('ok', false, 'code', 'RECORD_ID_MISSING', 'message', '피드백 기록 ID가 없습니다.');
    end if;
    if btrim(v_content) = '' then
      return jsonb_build_object('ok', false, 'code', 'FEEDBACK_CONTENT_MISSING', 'message', '피드백 내용은 비워둘 수 없습니다.');
    end if;

    if p_resource = 'fail_feedbacks' then
      begin v_record_uuid := v_record_text::uuid;
      exception when others then
        return jsonb_build_object('ok', false, 'code', 'INVALID_RECORD_ID', 'message', '피드백 기록 ID가 올바르지 않습니다.');
      end;
      update public.fail_feedbacks f
         set content = v_content,
             updated_at = now()
       where f.academy_id = p_academy_id
         and f.id = v_record_uuid
       returning * into v_row_growth;
      if not found then
        return jsonb_build_object('ok', false, 'code', 'FEEDBACK_NOT_FOUND', 'message', '현재 학원에서 피드백 기록을 찾을 수 없습니다.');
      end if;
      return jsonb_build_object('ok', true, 'rows', jsonb_build_array(to_jsonb(v_row_growth)));
    end if;

    begin v_record_bigint := v_record_text::bigint;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'INVALID_RECORD_ID', 'message', '피드백 기록 ID가 올바르지 않습니다.');
    end;

    if p_resource = 'feedbacks' then
      update public.feedbacks f
         set content = v_content,
             updated_at = now()
       where f.academy_id = p_academy_id
         and f.id = v_record_bigint
       returning * into v_row_feedback;
      if not found then
        return jsonb_build_object('ok', false, 'code', 'FEEDBACK_NOT_FOUND', 'message', '현재 학원에서 피드백 기록을 찾을 수 없습니다.');
      end if;
      return jsonb_build_object('ok', true, 'rows', jsonb_build_array(to_jsonb(v_row_feedback)));
    end if;

    update public.summary_feedbacks f
       set content = v_content,
           updated_at = now()
     where f.academy_id = p_academy_id
       and f.id = v_record_bigint
     returning * into v_row_summary;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'FEEDBACK_NOT_FOUND', 'message', '현재 학원에서 종합 피드백 기록을 찾을 수 없습니다.');
    end if;
    return jsonb_build_object('ok', true, 'rows', jsonb_build_array(to_jsonb(v_row_summary)));
  end if;

  if v_operation = 'soft_delete' then
    if v_record_text <> '' then
      if p_resource = 'fail_feedbacks' then
        begin v_record_uuid := v_record_text::uuid;
        exception when others then
          return jsonb_build_object('ok', false, 'code', 'INVALID_RECORD_ID', 'message', '피드백 기록 ID가 올바르지 않습니다.');
        end;
        update public.fail_feedbacks f
           set is_deleted = true,
               deleted_at = coalesce(nullif(p_payload->>'deleted_at','')::timestamptz, now()),
               deleted_by = v_deleted_by,
               delete_reason = v_delete_reason,
               updated_at = now()
         where f.academy_id = p_academy_id and f.id = v_record_uuid
         returning * into v_row_growth;
        if not found then return jsonb_build_object('ok', false, 'code', 'FEEDBACK_NOT_FOUND', 'message', '피드백 기록을 찾을 수 없습니다.'); end if;
        return jsonb_build_object('ok', true, 'rows', jsonb_build_array(to_jsonb(v_row_growth)));
      end if;

      begin v_record_bigint := v_record_text::bigint;
      exception when others then
        return jsonb_build_object('ok', false, 'code', 'INVALID_RECORD_ID', 'message', '피드백 기록 ID가 올바르지 않습니다.');
      end;

      if p_resource = 'feedbacks' then
        update public.feedbacks f
           set is_deleted = true,
               deleted_at = coalesce(nullif(p_payload->>'deleted_at','')::timestamptz, now()),
               deleted_by = v_deleted_by,
               delete_reason = v_delete_reason,
               updated_at = now()
         where f.academy_id = p_academy_id and f.id = v_record_bigint
         returning * into v_row_feedback;
        if not found then return jsonb_build_object('ok', false, 'code', 'FEEDBACK_NOT_FOUND', 'message', '피드백 기록을 찾을 수 없습니다.'); end if;
        return jsonb_build_object('ok', true, 'rows', jsonb_build_array(to_jsonb(v_row_feedback)));
      end if;

      update public.summary_feedbacks f
         set is_deleted = true,
             deleted_at = coalesce(nullif(p_payload->>'deleted_at','')::timestamptz, now()),
             deleted_by = v_deleted_by,
             delete_reason = v_delete_reason,
             updated_at = now()
       where f.academy_id = p_academy_id and f.id = v_record_bigint
       returning * into v_row_summary;
      if not found then return jsonb_build_object('ok', false, 'code', 'FEEDBACK_NOT_FOUND', 'message', '종합 피드백 기록을 찾을 수 없습니다.'); end if;
      return jsonb_build_object('ok', true, 'rows', jsonb_build_array(to_jsonb(v_row_summary)));
    end if;

    if v_student_id is null then
      return jsonb_build_object('ok', false, 'code', 'STUDENT_ID_MISSING', 'message', '학생 ID가 없습니다.');
    end if;
    if v_role not in ('owner','manager','super_admin') then
      return jsonb_build_object('ok', false, 'code', 'PERMISSION_DENIED', 'message', '학생 전체 피드백 삭제는 관리자 권한이 필요합니다.');
    end if;

    if p_resource = 'feedbacks' then
      update public.feedbacks f
         set is_deleted = true,
             deleted_at = coalesce(nullif(p_payload->>'deleted_at','')::timestamptz, now()),
             deleted_by = v_deleted_by,
             delete_reason = v_delete_reason,
             updated_at = now()
       where f.academy_id = p_academy_id and f.student_id = v_student_id;
    elsif p_resource = 'fail_feedbacks' then
      update public.fail_feedbacks f
         set is_deleted = true,
             deleted_at = coalesce(nullif(p_payload->>'deleted_at','')::timestamptz, now()),
             deleted_by = v_deleted_by,
             delete_reason = v_delete_reason,
             updated_at = now()
       where f.academy_id = p_academy_id and f.student_id = v_student_id;
    else
      update public.summary_feedbacks f
         set is_deleted = true,
             deleted_at = coalesce(nullif(p_payload->>'deleted_at','')::timestamptz, now()),
             deleted_by = v_deleted_by,
             delete_reason = v_delete_reason,
             updated_at = now()
       where f.academy_id = p_academy_id and f.student_id = v_student_id;
    end if;
    return jsonb_build_object('ok', true, 'rows', '[]'::jsonb);
  end if;

  return jsonb_build_object('ok', false, 'code', 'OPERATION_NOT_ALLOWED', 'message', '지원하지 않는 피드백 저장 방식입니다.');
end;
$function$;

CREATE OR REPLACE FUNCTION public.olli_general_feedback_data_access(p_session_token text, p_academy_id uuid, p_action text, p_operation text, p_identity jsonb DEFAULT '{}'::jsonb, p_payload jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.olli_feedback_data_access_impl('feedbacks', p_session_token, p_academy_id, p_action, p_operation, p_identity, p_payload, p_limit);
$function$;

CREATE OR REPLACE FUNCTION public.olli_growth_feedback_data_access(p_session_token text, p_academy_id uuid, p_action text, p_operation text, p_identity jsonb DEFAULT '{}'::jsonb, p_payload jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.olli_feedback_data_access_impl('fail_feedbacks', p_session_token, p_academy_id, p_action, p_operation, p_identity, p_payload, p_limit);
$function$;

CREATE OR REPLACE FUNCTION public.olli_summary_feedback_data_access(p_session_token text, p_academy_id uuid, p_action text, p_operation text, p_identity jsonb DEFAULT '{}'::jsonb, p_payload jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.olli_feedback_data_access_impl('summary_feedbacks', p_session_token, p_academy_id, p_action, p_operation, p_identity, p_payload, p_limit);
$function$;

revoke all on function private.olli_feedback_data_access_impl(text,text,uuid,text,text,jsonb,jsonb,integer) from public, anon, authenticated;

revoke all on function public.olli_general_feedback_data_access(text,uuid,text,text,jsonb,jsonb,integer) from public, anon, authenticated;
revoke all on function public.olli_growth_feedback_data_access(text,uuid,text,text,jsonb,jsonb,integer) from public, anon, authenticated;
revoke all on function public.olli_summary_feedback_data_access(text,uuid,text,text,jsonb,jsonb,integer) from public, anon, authenticated;

grant execute on function public.olli_general_feedback_data_access(text,uuid,text,text,jsonb,jsonb,integer) to anon, authenticated;
grant execute on function public.olli_growth_feedback_data_access(text,uuid,text,text,jsonb,jsonb,integer) to anon, authenticated;
grant execute on function public.olli_summary_feedback_data_access(text,uuid,text,text,jsonb,jsonb,integer) to anon, authenticated;
