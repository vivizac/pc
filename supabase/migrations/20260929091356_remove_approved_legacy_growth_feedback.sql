-- Remove one user-approved legacy growth feedback row.
-- Production DB migration version: 20260929091356
-- Scope: exactly one fail_feedbacks row for the legacy Han Junwoo student id.
-- Preserve metadata in olli_admin_audit_logs before deletion.

begin;

do $$
declare
  v_count integer := 0;
begin
  select count(*) into v_count
  from public.fail_feedbacks
  where id='2e543132-09a1-4eda-ae9c-bf5384d2126f'::uuid
    and student_id='a7120482-6731-4828-8a5b-662989717fd0'::uuid
    and student_name='한준우'
    and coalesce(is_deleted,false)=false;

  if v_count <> 1 then
    raise exception 'Expected exactly 1 target growth feedback, got %', v_count;
  end if;

  insert into public.olli_admin_audit_logs(action,target_type,target_id,detail)
  select
    'legacy_growth_feedback_delete',
    'fail_feedbacks',
    f.id::text,
    jsonb_build_object(
      'academy_id', f.academy_id,
      'student_id', f.student_id,
      'student_name', f.student_name,
      'created_at', f.created_at,
      'reason', 'user_approved_legacy_growth_feedback_delete'
    )
  from public.fail_feedbacks f
  where f.id='2e543132-09a1-4eda-ae9c-bf5384d2126f'::uuid
    and f.student_id='a7120482-6731-4828-8a5b-662989717fd0'::uuid
    and f.student_name='한준우'
    and coalesce(f.is_deleted,false)=false;

  delete from public.fail_feedbacks
  where id='2e543132-09a1-4eda-ae9c-bf5384d2126f'::uuid
    and student_id='a7120482-6731-4828-8a5b-662989717fd0'::uuid
    and student_name='한준우'
    and coalesce(is_deleted,false)=false;

  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'Expected to delete exactly 1 target growth feedback, got %', v_count;
  end if;
end
$$;

commit;
