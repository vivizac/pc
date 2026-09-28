-- Recoverable record trash and monthly attendance for the PC attendance register.

create or replace function public.olli_record_trash_move(
  p_session_token text,
  p_academy_id uuid,
  p_source_table text,
  p_record_id text,
  p_reason text default 'manual_delete_from_student_record'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_table text := lower(btrim(coalesce(p_source_table, '')));
  v_count integer := 0;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '기록을 삭제할 권한이 없습니다.');
  end if;
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_table = 'feedbacks' then
    update public.feedbacks
       set is_deleted = true, deleted_at = now(), deleted_by = v_account_id::text,
           delete_reason = coalesce(nullif(btrim(p_reason), ''), 'manual_delete_from_student_record')
     where academy_id = p_academy_id and id = p_record_id::bigint and coalesce(is_deleted, false) = false;
  elsif v_table = 'fail_feedbacks' then
    update public.fail_feedbacks
       set is_deleted = true, deleted_at = now(), deleted_by = v_account_id::text,
           delete_reason = coalesce(nullif(btrim(p_reason), ''), 'manual_delete_from_student_record')
     where academy_id = p_academy_id and id = p_record_id::uuid and coalesce(is_deleted, false) = false;
  elsif v_table = 'summary_feedbacks' then
    update public.summary_feedbacks
       set is_deleted = true, deleted_at = now(), deleted_by = v_account_id::text,
           delete_reason = coalesce(nullif(btrim(p_reason), ''), 'manual_delete_from_student_record')
     where academy_id = p_academy_id and id = p_record_id::bigint and coalesce(is_deleted, false) = false;
  else
    return jsonb_build_object('ok', false, 'message', '휴지통으로 이동할 수 없는 기록입니다.');
  end if;
  get diagnostics v_count = row_count;
  if v_count = 0 then return jsonb_build_object('ok', false, 'message', '삭제할 기록을 찾지 못했습니다.'); end if;
  return jsonb_build_object('ok', true, 'result', 'trashed', 'source_table', v_table, 'record_id', p_record_id);
exception when invalid_text_representation then
  return jsonb_build_object('ok', false, 'message', '기록 번호가 올바르지 않습니다.');
end;
$$;

create or replace function public.olli_record_trash_list(
  p_session_token text,
  p_academy_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '휴지통을 볼 권한이 없습니다.');
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.deleted_at desc), '[]'::jsonb) into v_rows
  from (
    select 'feedbacks'::text source_table, f.id::text record_id, 'observation'::text record_type,
           f.student_id, coalesce(s.name, f.student_name) student_name, f.content,
           coalesce(f.date, f.lesson_date::text, f.created_at::text) record_date,
           f.deleted_at, f.deleted_by
      from public.feedbacks f left join public.students s on s.id = f.student_id and s.academy_id = f.academy_id
     where f.academy_id = p_academy_id and coalesce(f.is_deleted, false) = true
    union all
    select 'fail_feedbacks', f.id::text, 'observation', f.student_id,
           coalesce(s.name, f.student_name), f.content, coalesce(f.date, f.created_at::text), f.deleted_at, f.deleted_by
      from public.fail_feedbacks f left join public.students s on s.id = f.student_id and s.academy_id = f.academy_id
     where f.academy_id = p_academy_id and coalesce(f.is_deleted, false) = true
    union all
    select 'summary_feedbacks', f.id::text, 'summary_growth', f.student_id,
           coalesce(s.name, f.student_name), f.content, coalesce(f.date, f.created_at::text), f.deleted_at, f.deleted_by
      from public.summary_feedbacks f left join public.students s on s.id = f.student_id and s.academy_id = f.academy_id
     where f.academy_id = p_academy_id and coalesce(f.is_deleted, false) = true
  ) x;
  return jsonb_build_object('ok', true, 'items', v_rows);
end;
$$;

create or replace function public.olli_record_trash_restore(
  p_session_token text,
  p_academy_id uuid,
  p_source_table text,
  p_record_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table text := lower(btrim(coalesce(p_source_table, '')));
  v_count integer := 0;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '기록을 복구할 권한이 없습니다.');
  end if;
  if v_table = 'feedbacks' then
    update public.feedbacks set is_deleted = false, deleted_at = null, deleted_by = null, delete_reason = null
     where academy_id = p_academy_id and id = p_record_id::bigint and coalesce(is_deleted, false) = true;
  elsif v_table = 'fail_feedbacks' then
    update public.fail_feedbacks set is_deleted = false, deleted_at = null, deleted_by = null, delete_reason = null
     where academy_id = p_academy_id and id = p_record_id::uuid and coalesce(is_deleted, false) = true;
  elsif v_table = 'summary_feedbacks' then
    update public.summary_feedbacks set is_deleted = false, deleted_at = null, deleted_by = null, delete_reason = null
     where academy_id = p_academy_id and id = p_record_id::bigint and coalesce(is_deleted, false) = true;
  else
    return jsonb_build_object('ok', false, 'message', '복구할 수 없는 기록입니다.');
  end if;
  get diagnostics v_count = row_count;
  if v_count = 0 then return jsonb_build_object('ok', false, 'message', '복구할 기록을 찾지 못했습니다.'); end if;
  return jsonb_build_object('ok', true, 'result', 'restored', 'source_table', v_table, 'record_id', p_record_id);
exception when invalid_text_representation then
  return jsonb_build_object('ok', false, 'message', '기록 번호가 올바르지 않습니다.');
end;
$$;

create or replace function public.olli_schedule_attendance_month(
  p_session_token text,
  p_academy_id uuid,
  p_month date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_end date;
  v_rows jsonb;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '출석부를 볼 권한이 없습니다.');
  end if;
  v_end := (v_start + interval '1 month - 1 day')::date;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.session_date, a.student_id, a.time_slot), '[]'::jsonb)
    into v_rows
    from (
      select student_id, session_date, time_slot, class_group, session_kind, marked_at
        from public.olli_schedule_attendance
       where academy_id = p_academy_id and session_date between v_start and v_end
    ) a;
  return jsonb_build_object('ok', true, 'month_start', v_start, 'month_end', v_end, 'attendance', v_rows);
end;
$$;

revoke all on function public.olli_record_trash_move(text, uuid, text, text, text) from public;
revoke all on function public.olli_record_trash_list(text, uuid) from public;
revoke all on function public.olli_record_trash_restore(text, uuid, text, text) from public;
revoke all on function public.olli_schedule_attendance_month(text, uuid, date) from public;
grant execute on function public.olli_record_trash_move(text, uuid, text, text, text) to anon, authenticated;
grant execute on function public.olli_record_trash_list(text, uuid) to anon, authenticated;
grant execute on function public.olli_record_trash_restore(text, uuid, text, text) to anon, authenticated;
grant execute on function public.olli_schedule_attendance_month(text, uuid, date) to anon, authenticated;
