-- Remove the user-approved final orphan observation chain and all legacy
-- feedback rows without a student_id.
-- Production DB migration version: 20260929134112
-- Scope:
--   - Kim Gijun orphan observation chain: 1 draft + 1 private version + 4 archives
--   - public.feedbacks rows with student_id IS NULL: 20
--   - public.summary_feedbacks rows with student_id IS NULL: 2
-- All rows are fully snapshotted to olli_admin_audit_logs before deletion.

begin;

do $$
declare
  v_draft integer := 0;
  v_version integer := 0;
  v_archives integer := 0;
  v_feedbacks integer := 0;
  v_summaries integer := 0;
begin
  insert into public.olli_admin_audit_logs(action,target_type,target_id,detail)
  select 'legacy_orphan_cleanup_delete','student_note_drafts',d.id::text,to_jsonb(d)
  from public.student_note_drafts d
  where d.id='cd28ada6-96e1-444f-b96c-af57a85ab7cf'::uuid
    and d.student_id='e740eb5f-8a0c-478d-9168-a0aca6e30a8d'::uuid
    and d.student_name='김기준';
  get diagnostics v_draft = row_count;
  if v_draft <> 1 then
    raise exception 'Expected 1 Kim Gijun draft, got %', v_draft;
  end if;

  insert into public.olli_admin_audit_logs(action,target_type,target_id,detail)
  select 'legacy_orphan_cleanup_delete','olli_note_draft_versions',v.id::text,to_jsonb(v)
  from private.olli_note_draft_versions v
  where v.student_id='e740eb5f-8a0c-478d-9168-a0aca6e30a8d'::uuid;
  get diagnostics v_version = row_count;
  if v_version <> 1 then
    raise exception 'Expected 1 Kim Gijun version, got %', v_version;
  end if;

  insert into public.olli_admin_audit_logs(action,target_type,target_id,detail)
  select 'legacy_orphan_cleanup_delete','student_note_archives',a.id::text,to_jsonb(a)
  from public.student_note_archives a
  where a.student_id='e740eb5f-8a0c-478d-9168-a0aca6e30a8d'::uuid;
  get diagnostics v_archives = row_count;
  if v_archives <> 4 then
    raise exception 'Expected 4 Kim Gijun archives, got %', v_archives;
  end if;

  insert into public.olli_admin_audit_logs(action,target_type,target_id,detail)
  select 'legacy_orphan_cleanup_delete','feedbacks',f.id::text,to_jsonb(f)
  from public.feedbacks f
  where f.student_id is null;
  get diagnostics v_feedbacks = row_count;
  if v_feedbacks <> 20 then
    raise exception 'Expected 20 legacy feedback rows, got %', v_feedbacks;
  end if;

  insert into public.olli_admin_audit_logs(action,target_type,target_id,detail)
  select 'legacy_orphan_cleanup_delete','summary_feedbacks',s.id::text,to_jsonb(s)
  from public.summary_feedbacks s
  where s.student_id is null;
  get diagnostics v_summaries = row_count;
  if v_summaries <> 2 then
    raise exception 'Expected 2 legacy summary rows, got %', v_summaries;
  end if;

  delete from private.olli_note_draft_versions
  where student_id='e740eb5f-8a0c-478d-9168-a0aca6e30a8d'::uuid;
  get diagnostics v_version = row_count;
  if v_version <> 1 then
    raise exception 'Expected to delete 1 Kim Gijun version, got %', v_version;
  end if;

  delete from public.student_note_archives
  where student_id='e740eb5f-8a0c-478d-9168-a0aca6e30a8d'::uuid;
  get diagnostics v_archives = row_count;
  if v_archives <> 4 then
    raise exception 'Expected to delete 4 Kim Gijun archives, got %', v_archives;
  end if;

  delete from public.student_note_drafts
  where id='cd28ada6-96e1-444f-b96c-af57a85ab7cf'::uuid
    and student_id='e740eb5f-8a0c-478d-9168-a0aca6e30a8d'::uuid
    and student_name='김기준';
  get diagnostics v_draft = row_count;
  if v_draft <> 1 then
    raise exception 'Expected to delete 1 Kim Gijun draft, got %', v_draft;
  end if;

  delete from public.summary_feedbacks
  where student_id is null;
  get diagnostics v_summaries = row_count;
  if v_summaries <> 2 then
    raise exception 'Expected to delete 2 legacy summary rows, got %', v_summaries;
  end if;

  delete from public.feedbacks
  where student_id is null;
  get diagnostics v_feedbacks = row_count;
  if v_feedbacks <> 20 then
    raise exception 'Expected to delete 20 legacy feedback rows, got %', v_feedbacks;
  end if;
end
$$;

commit;
