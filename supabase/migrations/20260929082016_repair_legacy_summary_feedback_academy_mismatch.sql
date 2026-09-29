-- Repair two legacy summary_feedbacks rows whose academy_id drifted away from
-- the exact current student_id owner academy. Preserve the before-state in the
-- admin audit log and abort the whole migration unless exactly two rows match.
-- Production DB migration version: 20260929082016

begin;

do $$
declare
  v_logged integer := 0;
  v_updated integer := 0;
begin
  insert into public.olli_admin_audit_logs(action, target_type, target_id, detail)
  select
    'integrity_repair_summary_feedback_academy',
    'summary_feedbacks',
    sf.id::text,
    jsonb_build_object(
      'student_id', sf.student_id,
      'old_academy_id', sf.academy_id,
      'new_academy_id', s.academy_id,
      'reason', 'student_id_exact_match_and_peer_feedbacks_same_academy'
    )
  from public.summary_feedbacks sf
  join public.students s on s.id = sf.student_id
  where (
      sf.id = 14
      and sf.student_id = 'c758d308-c6de-4799-92c5-6253b6f26a10'::uuid
      and sf.academy_id = '31b3a19f-fd01-4b74-b2de-63f4e4992393'::uuid
      and s.academy_id = '6871d975-6c50-426d-97b1-81ac4e35ba27'::uuid
      and coalesce(s.is_deleted,false) = false
    )
    or (
      sf.id = 20
      and sf.student_id = '4847f7fd-307b-45f7-87cf-b6b07470af12'::uuid
      and sf.academy_id = '53f6748e-8a0b-49ca-b59d-3a1edd8f1a0b'::uuid
      and s.academy_id = '6871d975-6c50-426d-97b1-81ac4e35ba27'::uuid
      and coalesce(s.is_deleted,false) = false
    );

  get diagnostics v_logged = row_count;
  if v_logged <> 2 then
    raise exception 'Expected to audit 2 summary feedback rows, got %', v_logged;
  end if;

  update public.summary_feedbacks sf
     set academy_id = s.academy_id,
         updated_at = now()
    from public.students s
   where s.id = sf.student_id
     and (
       (
         sf.id = 14
         and sf.student_id = 'c758d308-c6de-4799-92c5-6253b6f26a10'::uuid
         and sf.academy_id = '31b3a19f-fd01-4b74-b2de-63f4e4992393'::uuid
         and s.academy_id = '6871d975-6c50-426d-97b1-81ac4e35ba27'::uuid
         and coalesce(s.is_deleted,false) = false
       )
       or
       (
         sf.id = 20
         and sf.student_id = '4847f7fd-307b-45f7-87cf-b6b07470af12'::uuid
         and sf.academy_id = '53f6748e-8a0b-49ca-b59d-3a1edd8f1a0b'::uuid
         and s.academy_id = '6871d975-6c50-426d-97b1-81ac4e35ba27'::uuid
         and coalesce(s.is_deleted,false) = false
       )
     );

  get diagnostics v_updated = row_count;
  if v_updated <> 2 then
    raise exception 'Expected to repair 2 summary feedback rows, got %', v_updated;
  end if;
end
$$;

commit;
