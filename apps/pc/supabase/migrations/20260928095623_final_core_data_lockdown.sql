-- Olli core-data RLS final lockdown plan
-- STATUS: PREPARED ONLY. DO NOT APPLY TO PRODUCTION BEFORE PC/MOBILE WORK BRANCHES
-- ARE MERGED TO MAIN AND BOTH PRODUCTION DEPLOYMENTS ARE VERIFIED.
--
-- Reason: current production main still performs direct Data API access to several
-- tables below. Applying this file early will intentionally break those old clients.
--
-- Final architecture after activation:
-- browser -> explicit account-session RPC -> SECURITY DEFINER implementation -> table
-- No direct anon/authenticated table access for these core academy-data tables.

begin;

-- 1. Close direct Data API table privileges.
revoke all on table public.students from anon, authenticated;
revoke all on table public.feedbacks from anon, authenticated;
revoke all on table public.fail_feedbacks from anon, authenticated;
revoke all on table public.summary_feedbacks from anon, authenticated;
revoke all on table public.feedback_photos from anon, authenticated;
revoke all on table public.student_note_drafts from anon, authenticated;
revoke all on table public.student_note_archives from anon, authenticated;
revoke all on table public.risk_signals from anon, authenticated;
revoke all on table public.academies from anon, authenticated;
revoke all on table public.academy_members from anon, authenticated;

-- 2. Keep RLS enabled as defense in depth, but remove old broad/direct-client policies.
alter table public.students enable row level security;
drop policy if exists students_delete_by_academy on public.students;
drop policy if exists students_insert_by_academy on public.students;
drop policy if exists students_insert_member on public.students;
drop policy if exists students_select_by_academy on public.students;
drop policy if exists students_select_member on public.students;
drop policy if exists students_update_by_academy on public.students;
drop policy if exists students_update_member on public.students;

alter table public.feedbacks enable row level security;
drop policy if exists feedbacks_delete_by_academy on public.feedbacks;
drop policy if exists feedbacks_insert_by_academy on public.feedbacks;
drop policy if exists feedbacks_insert_member on public.feedbacks;
drop policy if exists feedbacks_select_by_academy on public.feedbacks;
drop policy if exists feedbacks_select_member on public.feedbacks;
drop policy if exists feedbacks_update_by_academy on public.feedbacks;
drop policy if exists feedbacks_update_member on public.feedbacks;

alter table public.fail_feedbacks enable row level security;
drop policy if exists fail_feedbacks_delete_by_academy on public.fail_feedbacks;
drop policy if exists fail_feedbacks_insert_by_academy on public.fail_feedbacks;
drop policy if exists fail_feedbacks_select_by_academy on public.fail_feedbacks;
drop policy if exists fail_feedbacks_update_by_academy on public.fail_feedbacks;

alter table public.summary_feedbacks enable row level security;
drop policy if exists summary_feedbacks_delete_by_academy on public.summary_feedbacks;
drop policy if exists summary_feedbacks_insert_by_academy on public.summary_feedbacks;
drop policy if exists summary_feedbacks_insert_member on public.summary_feedbacks;
drop policy if exists summary_feedbacks_select_by_academy on public.summary_feedbacks;
drop policy if exists summary_feedbacks_select_member on public.summary_feedbacks;
drop policy if exists summary_feedbacks_update_by_academy on public.summary_feedbacks;

alter table public.feedback_photos enable row level security;
drop policy if exists feedback_photos_delete on public.feedback_photos;
drop policy if exists feedback_photos_insert on public.feedback_photos;
drop policy if exists feedback_photos_select on public.feedback_photos;
drop policy if exists feedback_photos_update on public.feedback_photos;

alter table public.student_note_drafts enable row level security;
drop policy if exists student_note_drafts_delete on public.student_note_drafts;
drop policy if exists student_note_drafts_insert on public.student_note_drafts;
drop policy if exists student_note_drafts_select on public.student_note_drafts;
drop policy if exists student_note_drafts_update on public.student_note_drafts;

alter table public.student_note_archives enable row level security;
drop policy if exists student_note_archives_delete on public.student_note_archives;
drop policy if exists student_note_archives_insert on public.student_note_archives;
drop policy if exists student_note_archives_select on public.student_note_archives;
drop policy if exists student_note_archives_update on public.student_note_archives;

alter table public.risk_signals enable row level security;
drop policy if exists risk_signals_delete on public.risk_signals;
drop policy if exists risk_signals_insert on public.risk_signals;
drop policy if exists risk_signals_insert_member on public.risk_signals;
drop policy if exists risk_signals_select on public.risk_signals;
drop policy if exists risk_signals_select_member on public.risk_signals;
drop policy if exists risk_signals_update on public.risk_signals;
drop policy if exists risk_signals_update_admin on public.risk_signals;

alter table public.academies enable row level security;
drop policy if exists academies_select_member on public.academies;
drop policy if exists academies_update_owner on public.academies;

alter table public.academy_members enable row level security;
drop policy if exists academy_members_select_member on public.academy_members;
drop policy if exists academy_members_update_owner on public.academy_members;

-- 3. Close legacy data RPCs that bypass the new custom-account-session contract.
-- These are not called by the stabilization work branch.
revoke all on function public.create_student_for_academy(uuid,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.save_feedback_for_academy(uuid,uuid,text,text,text,text,date) from public, anon, authenticated;
revoke all on function public.save_summary_feedback_for_academy(uuid,uuid,text,integer,text,uuid[]) from public, anon, authenticated;

revoke all on function public.olli_feedback_insert_idempotent(jsonb) from public, anon, authenticated;
revoke all on function public.olli_growth_feedback_insert_idempotent(jsonb) from public, anon, authenticated;
revoke all on function public.olli_summary_feedback_insert_idempotent(jsonb) from public, anon, authenticated;

-- Old Supabase-Auth-era academy helpers are not browser APIs in the new contract.
revoke all on function public.current_member_id(uuid) from public, anon, authenticated;
revoke all on function public.is_academy_member(uuid) from public, anon, authenticated;
revoke all on function public.is_academy_admin(uuid) from public, anon, authenticated;
revoke all on function public.is_academy_owner(uuid) from public, anon, authenticated;

-- Old pre-account approval/onboarding endpoints.
-- Activate these revokes only after final production smoke tests confirm the account-session
-- onboarding flow (olli_* account RPCs) is the only live path.
revoke all on function public.approve_teacher_request(uuid) from public, anon, authenticated;
revoke all on function public.request_teacher_approval(text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.create_academy_with_owner(text,text,text) from public, anon, authenticated;

commit;
