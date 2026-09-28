-- Keep student/test-reset soft deletes out of the record-only trash view.

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
       and f.delete_reason in ('manual_delete_from_student_record', 'summary_feedback_regenerated')
    union all
    select 'fail_feedbacks', f.id::text, 'observation', f.student_id,
           coalesce(s.name, f.student_name), f.content, coalesce(f.date, f.created_at::text), f.deleted_at, f.deleted_by
      from public.fail_feedbacks f left join public.students s on s.id = f.student_id and s.academy_id = f.academy_id
     where f.academy_id = p_academy_id and coalesce(f.is_deleted, false) = true
       and f.delete_reason in ('manual_delete_from_student_record', 'summary_feedback_regenerated')
    union all
    select 'summary_feedbacks', f.id::text, 'summary_growth', f.student_id,
           coalesce(s.name, f.student_name), f.content, coalesce(f.date, f.created_at::text), f.deleted_at, f.deleted_by
      from public.summary_feedbacks f left join public.students s on s.id = f.student_id and s.academy_id = f.academy_id
     where f.academy_id = p_academy_id and coalesce(f.is_deleted, false) = true
       and f.delete_reason in ('manual_delete_from_student_record', 'summary_feedback_regenerated')
  ) x;
  return jsonb_build_object('ok', true, 'items', v_rows);
end;
$$;

revoke all on function public.olli_record_trash_list(text, uuid) from public;
grant execute on function public.olli_record_trash_list(text, uuid) to anon, authenticated;
