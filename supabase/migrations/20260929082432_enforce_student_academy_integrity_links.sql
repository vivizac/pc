-- Enforce academy/student identity consistency without deleting legacy rows.
-- Production DB migration version: 20260929082432
--
-- feedbacks and summary_feedbacks have no current mismatches, so their
-- composite foreign keys are validated immediately.
-- fail_feedbacks and student_note_drafts retain known legacy orphan rows;
-- their NOT VALID foreign keys still enforce all new inserts/updates.

begin;

alter table public.students
  add constraint students_id_academy_unique unique (id, academy_id);

alter table public.feedbacks
  add constraint feedbacks_student_academy_fkey
  foreign key (student_id, academy_id)
  references public.students(id, academy_id)
  not valid;

alter table public.summary_feedbacks
  add constraint summary_feedbacks_student_academy_fkey
  foreign key (student_id, academy_id)
  references public.students(id, academy_id)
  not valid;

alter table public.fail_feedbacks
  add constraint fail_feedbacks_student_academy_fkey
  foreign key (student_id, academy_id)
  references public.students(id, academy_id)
  not valid;

alter table public.student_note_drafts
  add constraint student_note_drafts_student_academy_fkey
  foreign key (student_id, academy_id)
  references public.students(id, academy_id)
  not valid;

alter table public.feedbacks
  validate constraint feedbacks_student_academy_fkey;

alter table public.summary_feedbacks
  validate constraint summary_feedbacks_student_academy_fkey;

commit;
