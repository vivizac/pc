-- Validate the final student/academy foreign keys after legacy orphan cleanup.
-- Production DB migration version: 20260929134515

begin;

alter table public.fail_feedbacks
  validate constraint fail_feedbacks_student_academy_fkey;

alter table public.student_note_drafts
  validate constraint student_note_drafts_student_academy_fkey;

commit;
