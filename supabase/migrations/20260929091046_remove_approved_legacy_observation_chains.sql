-- Remove five user-approved legacy observation draft chains.
-- Production DB migration version: 20260929091046
-- Scope: 5 drafts + 5 private versions + 8 archives only.
-- A separate fail_feedbacks row sharing one legacy student_id is intentionally preserved.

begin;

do $$
declare
  v_drafts integer := 0;
  v_versions integer := 0;
  v_archives integer := 0;
begin
  insert into public.olli_admin_audit_logs(action,target_type,target_id,detail)
  select
    'legacy_observation_chain_delete',
    'student_note_drafts',
    d.id::text,
    jsonb_build_object(
      'student_id', d.student_id,
      'student_name', d.student_name,
      'academy_id', d.academy_id,
      'note_type', d.note_type,
      'content', d.content,
      'revision', d.revision,
      'updated_at', d.updated_at
    )
  from public.student_note_drafts d
  where d.student_id in (
    'e262d0ff-caef-4d88-a164-d8a783eef751'::uuid,
    'cdf18dd7-e973-401e-a544-d24a8b7b55dd'::uuid,
    '55c2f7fa-b365-4643-b612-ee9fdc73f3fa'::uuid,
    'a7120482-6731-4828-8a5b-662989717fd0'::uuid,
    'ef4f2875-c715-4d2e-9590-d2a882321649'::uuid
  );

  get diagnostics v_drafts = row_count;
  if v_drafts <> 5 then
    raise exception 'Expected 5 draft rows, got %', v_drafts;
  end if;

  insert into public.olli_admin_audit_logs(action,target_type,target_id,detail)
  select
    'legacy_observation_chain_delete',
    'olli_note_draft_versions',
    v.id::text,
    jsonb_build_object(
      'student_id', v.student_id,
      'academy_id', v.academy_id,
      'note_type', v.note_type,
      'revision', v.revision,
      'content', v.content,
      'saved_at', v.saved_at,
      'created_at', v.created_at
    )
  from private.olli_note_draft_versions v
  where v.student_id in (
    'e262d0ff-caef-4d88-a164-d8a783eef751'::uuid,
    'cdf18dd7-e973-401e-a544-d24a8b7b55dd'::uuid,
    '55c2f7fa-b365-4643-b612-ee9fdc73f3fa'::uuid,
    'a7120482-6731-4828-8a5b-662989717fd0'::uuid,
    'ef4f2875-c715-4d2e-9590-d2a882321649'::uuid
  );

  get diagnostics v_versions = row_count;
  if v_versions <> 5 then
    raise exception 'Expected 5 version rows, got %', v_versions;
  end if;

  insert into public.olli_admin_audit_logs(action,target_type,target_id,detail)
  select
    'legacy_observation_chain_delete',
    'student_note_archives',
    a.id::text,
    jsonb_build_object(
      'student_id', a.student_id,
      'student_name', a.student_name,
      'academy_id', a.academy_id,
      'note_type', a.note_type,
      'content', a.content,
      'record_label', a.record_label,
      'local_record_id', a.local_record_id,
      'feedback_id', a.feedback_id,
      'created_at', a.created_at
    )
  from public.student_note_archives a
  where a.student_id in (
    'e262d0ff-caef-4d88-a164-d8a783eef751'::uuid,
    'cdf18dd7-e973-401e-a544-d24a8b7b55dd'::uuid,
    '55c2f7fa-b365-4643-b612-ee9fdc73f3fa'::uuid,
    'a7120482-6731-4828-8a5b-662989717fd0'::uuid,
    'ef4f2875-c715-4d2e-9590-d2a882321649'::uuid
  );

  get diagnostics v_archives = row_count;
  if v_archives <> 8 then
    raise exception 'Expected 8 archive rows, got %', v_archives;
  end if;

  delete from private.olli_note_draft_versions
  where student_id in (
    'e262d0ff-caef-4d88-a164-d8a783eef751'::uuid,
    'cdf18dd7-e973-401e-a544-d24a8b7b55dd'::uuid,
    '55c2f7fa-b365-4643-b612-ee9fdc73f3fa'::uuid,
    'a7120482-6731-4828-8a5b-662989717fd0'::uuid,
    'ef4f2875-c715-4d2e-9590-d2a882321649'::uuid
  );
  get diagnostics v_versions = row_count;
  if v_versions <> 5 then
    raise exception 'Expected to delete 5 version rows, got %', v_versions;
  end if;

  delete from public.student_note_archives
  where student_id in (
    'e262d0ff-caef-4d88-a164-d8a783eef751'::uuid,
    'cdf18dd7-e973-401e-a544-d24a8b7b55dd'::uuid,
    '55c2f7fa-b365-4643-b612-ee9fdc73f3fa'::uuid,
    'a7120482-6731-4828-8a5b-662989717fd0'::uuid,
    'ef4f2875-c715-4d2e-9590-d2a882321649'::uuid
  );
  get diagnostics v_archives = row_count;
  if v_archives <> 8 then
    raise exception 'Expected to delete 8 archive rows, got %', v_archives;
  end if;

  delete from public.student_note_drafts
  where student_id in (
    'e262d0ff-caef-4d88-a164-d8a783eef751'::uuid,
    'cdf18dd7-e973-401e-a544-d24a8b7b55dd'::uuid,
    '55c2f7fa-b365-4643-b612-ee9fdc73f3fa'::uuid,
    'a7120482-6731-4828-8a5b-662989717fd0'::uuid,
    'ef4f2875-c715-4d2e-9590-d2a882321649'::uuid
  );
  get diagnostics v_drafts = row_count;
  if v_drafts <> 5 then
    raise exception 'Expected to delete 5 draft rows, got %', v_drafts;
  end if;
end
$$;

commit;
