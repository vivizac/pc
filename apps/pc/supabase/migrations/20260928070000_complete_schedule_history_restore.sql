-- Keep schedule history restore aligned with the current audited table schemas.
-- This preserves the existing signature, permissions, stale-restore conflict checks,
-- transaction grouping, and restore bookkeeping while restoring fields added later.

CREATE OR REPLACE FUNCTION public.olli_schedule_restore_history(p_session_token text, p_academy_id uuid, p_transaction_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_role text;
  v_item public.olli_schedule_audit_log%rowtype;
  v_current jsonb;
  v_restore_txid bigint;
  v_student_id uuid;
  v_found boolean := false;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  select m.role into v_role
  from public.academy_members m
  where m.academy_id = p_academy_id
    and m.account_id = v_account_id
    and m.status = 'active'
    and m.role in ('owner','manager')
  order by case m.role when 'owner' then 1 else 2 end
  limit 1;

  if v_role is null then
    return jsonb_build_object('ok', false, 'message', '시간표 복구는 원장 또는 관리자만 할 수 있습니다.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_academy_id::text || ':schedule-restore', 0));

  if not exists (
    select 1 from public.olli_schedule_audit_log a
    where a.academy_id = p_academy_id
      and a.transaction_id = p_transaction_id
      and a.created_at >= now() - interval '30 days'
  ) then
    return jsonb_build_object('ok', false, 'message', '복구할 변경 이력을 찾지 못했습니다.');
  end if;
  if exists (
    select 1 from public.olli_schedule_audit_log a
    where a.academy_id = p_academy_id
      and a.transaction_id = p_transaction_id
      and (a.restore_of_transaction_id is not null or a.restored_at is not null)
  ) then
    return jsonb_build_object('ok', false, 'message', '이미 복구했거나 복구 작업으로 생성된 이력입니다.');
  end if;

  -- Refuse a stale restore. A later edit to any affected row must be reviewed first.
  for v_item in
    select * from public.olli_schedule_audit_log a
    where a.academy_id = p_academy_id
      and a.transaction_id = p_transaction_id
    order by a.id
    for update
  loop
    v_found := true;
    v_current := null;
    if v_item.table_name = 'olli_schedule_enrollments' then
      select to_jsonb(e) into v_current from public.olli_schedule_enrollments e where e.id = v_item.row_id;
    elsif v_item.table_name = 'olli_schedule_waitlist' then
      select to_jsonb(w) into v_current from public.olli_schedule_waitlist w where w.id = v_item.row_id;
    elsif v_item.table_name = 'olli_schedule_changes' then
      select to_jsonb(c) into v_current from public.olli_schedule_changes c where c.id = v_item.row_id;
    else
      select to_jsonb(o) into v_current from public.olli_schedule_one_time_sessions o where o.id = v_item.row_id;
    end if;

    if v_item.operation in ('INSERT','UPDATE') then
      if v_current is null or (v_current - 'updated_at') <> (v_item.new_data - 'updated_at') then
        return jsonb_build_object(
          'ok', false,
          'conflict', true,
          'message', '이 변경 이후 같은 시간표가 다시 수정되었습니다. 최근 변경부터 확인해 주세요.'
        );
      end if;
    elsif v_item.operation = 'DELETE' and v_current is not null then
      return jsonb_build_object(
        'ok', false,
        'conflict', true,
        'message', '이 변경 이후 같은 시간표가 다시 생성되었습니다. 최근 변경부터 확인해 주세요.'
      );
    end if;
  end loop;

  if not v_found then
    return jsonb_build_object('ok', false, 'message', '복구할 변경 내용이 없습니다.');
  end if;

  v_restore_txid := txid_current();
  perform set_config('olli.actor_account_id', v_account_id::text, true);
  perform set_config('olli.schedule_action', 'restore', true);
  perform set_config('olli.restore_of_transaction_id', p_transaction_id::text, true);

  -- Reverse child rows before parent rows by replaying the audit in reverse order.
  for v_item in
    select * from public.olli_schedule_audit_log a
    where a.academy_id = p_academy_id
      and a.transaction_id = p_transaction_id
    order by a.id desc
  loop
    v_student_id := coalesce(v_student_id, v_item.student_id);
    if v_item.operation = 'INSERT' then
      if v_item.table_name = 'olli_schedule_changes' then
        delete from public.olli_schedule_changes where id = v_item.row_id;
      elsif v_item.table_name = 'olli_schedule_waitlist' then
        delete from public.olli_schedule_waitlist where id = v_item.row_id;
      elsif v_item.table_name = 'olli_schedule_one_time_sessions' then
        delete from public.olli_schedule_one_time_sessions where id = v_item.row_id;
      else
        delete from public.olli_schedule_enrollments where id = v_item.row_id;
      end if;
    elsif v_item.operation = 'UPDATE' then
      if v_item.table_name = 'olli_schedule_enrollments' then
        update public.olli_schedule_enrollments set
          academy_id = (v_item.old_data->>'academy_id')::uuid,
          student_id = (v_item.old_data->>'student_id')::uuid,
          weekday = (v_item.old_data->>'weekday')::smallint,
          time_slot = (v_item.old_data->>'time_slot')::smallint,
          class_group = coalesce(nullif(v_item.old_data->>'class_group', ''), 'A'),
          session_order = nullif(v_item.old_data->>'session_order', '')::smallint,
          effective_from = (v_item.old_data->>'effective_from')::date,
          effective_to = nullif(v_item.old_data->>'effective_to', '')::date,
          status = v_item.old_data->>'status',
          source = v_item.old_data->>'source',
          created_at = (v_item.old_data->>'created_at')::timestamptz,
          updated_at = now()
        where id = v_item.row_id;
      elsif v_item.table_name = 'olli_schedule_waitlist' then
        update public.olli_schedule_waitlist set
          academy_id = (v_item.old_data->>'academy_id')::uuid,
          student_id = (v_item.old_data->>'student_id')::uuid,
          target_weekday = (v_item.old_data->>'target_weekday')::smallint,
          target_time_slot = (v_item.old_data->>'target_time_slot')::smallint,
          target_class_group = coalesce(nullif(v_item.old_data->>'target_class_group', ''), 'A'),
          request_type = v_item.old_data->>'request_type',
          source_enrollment_id = nullif(v_item.old_data->>'source_enrollment_id', '')::uuid,
          desired_effective_date = nullif(v_item.old_data->>'desired_effective_date', '')::date,
          status = v_item.old_data->>'status',
          requested_at = (v_item.old_data->>'requested_at')::timestamptz,
          resolved_at = nullif(v_item.old_data->>'resolved_at', '')::timestamptz,
          guest_name = nullif(v_item.old_data->>'guest_name', ''),
          guest_division = nullif(v_item.old_data->>'guest_division', ''),
          updated_at = now()
        where id = v_item.row_id;
      elsif v_item.table_name = 'olli_schedule_changes' then
        update public.olli_schedule_changes set
          academy_id = (v_item.old_data->>'academy_id')::uuid,
          student_id = (v_item.old_data->>'student_id')::uuid,
          change_type = v_item.old_data->>'change_type',
          source_enrollment_id = nullif(v_item.old_data->>'source_enrollment_id', '')::uuid,
          target_enrollment_id = nullif(v_item.old_data->>'target_enrollment_id', '')::uuid,
          target_class_group = nullif(v_item.old_data->>'target_class_group', ''),
          effective_date = (v_item.old_data->>'effective_date')::date,
          status = v_item.old_data->>'status',
          waitlist_id = nullif(v_item.old_data->>'waitlist_id', '')::uuid,
          created_at = (v_item.old_data->>'created_at')::timestamptz,
          updated_at = now(),
          cancelled_at = nullif(v_item.old_data->>'cancelled_at', '')::timestamptz
        where id = v_item.row_id;
      else
        update public.olli_schedule_one_time_sessions set
          academy_id = (v_item.old_data->>'academy_id')::uuid,
          student_id = (v_item.old_data->>'student_id')::uuid,
          session_date = (v_item.old_data->>'session_date')::date,
          time_slot = (v_item.old_data->>'time_slot')::smallint,
          class_group = coalesce(nullif(v_item.old_data->>'class_group', ''), 'A'),
          session_type = v_item.old_data->>'session_type',
          status = v_item.old_data->>'status',
          note = coalesce(v_item.old_data->>'note', ''),
          guest_name = nullif(v_item.old_data->>'guest_name', ''),
          guest_division = nullif(v_item.old_data->>'guest_division', ''),
          created_at = (v_item.old_data->>'created_at')::timestamptz,
          updated_at = now()
        where id = v_item.row_id;
      end if;
    else
      if v_item.table_name = 'olli_schedule_changes' then
        insert into public.olli_schedule_changes
          select * from jsonb_populate_record(null::public.olli_schedule_changes, v_item.old_data);
      elsif v_item.table_name = 'olli_schedule_waitlist' then
        insert into public.olli_schedule_waitlist
          select * from jsonb_populate_record(null::public.olli_schedule_waitlist, v_item.old_data);
      elsif v_item.table_name = 'olli_schedule_one_time_sessions' then
        insert into public.olli_schedule_one_time_sessions
          select * from jsonb_populate_record(null::public.olli_schedule_one_time_sessions, v_item.old_data);
      else
        insert into public.olli_schedule_enrollments
          select * from jsonb_populate_record(null::public.olli_schedule_enrollments, v_item.old_data);
      end if;
    end if;
  end loop;

  for v_student_id in
    select distinct a.student_id
    from public.olli_schedule_audit_log a
    where a.academy_id = p_academy_id
      and a.transaction_id = p_transaction_id
      and a.student_id is not null
  loop
    perform private.olli_schedule_sync_student(v_student_id, current_date);
  end loop;

  update public.olli_schedule_audit_log
  set restored_at = now(),
      restored_by_account_id = v_account_id,
      restore_transaction_id = v_restore_txid
  where academy_id = p_academy_id
    and transaction_id = p_transaction_id;

  return jsonb_build_object(
    'ok', true,
    'result', 'restored',
    'restored_transaction_id', p_transaction_id::text,
    'restore_transaction_id', v_restore_txid::text
  );
end;
$function$;
