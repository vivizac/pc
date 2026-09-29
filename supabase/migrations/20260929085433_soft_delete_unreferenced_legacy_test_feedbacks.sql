-- Soft-delete three unreferenced legacy test/error feedback rows.
-- Production DB migration version: 20260929085433
-- Preserve the rows and record the before-state in olli_admin_audit_logs.

begin;

do $$
declare
  v_logged integer := 0;
  v_updated integer := 0;
begin
  insert into public.olli_admin_audit_logs(action,target_type,target_id,detail)
  select
    'legacy_test_feedback_soft_delete',
    'feedbacks',
    f.id::text,
    jsonb_build_object(
      'academy_id', f.academy_id,
      'student_id', f.student_id,
      'student_name', f.student_name,
      'created_at', f.created_at,
      'reason', 'legacy_test_or_error_record_no_downstream_references'
    )
  from public.feedbacks f
  where f.id in (8,11,41)
    and coalesce(f.is_deleted,false)=false;

  get diagnostics v_logged = row_count;
  if v_logged <> 3 then
    raise exception 'Expected to audit 3 legacy feedback rows, got %', v_logged;
  end if;

  update public.feedbacks
     set is_deleted = true,
         deleted_at = now(),
         deleted_by = 'system:data-integrity-cleanup',
         delete_reason = 'legacy_test_or_error_record_no_downstream_references',
         updated_at = now()
   where id in (8,11,41)
     and coalesce(is_deleted,false)=false;

  get diagnostics v_updated = row_count;
  if v_updated <> 3 then
    raise exception 'Expected to soft-delete 3 legacy feedback rows, got %', v_updated;
  end if;
end
$$;

commit;
