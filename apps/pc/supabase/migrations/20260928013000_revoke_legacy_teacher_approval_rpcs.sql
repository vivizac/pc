-- Contract step for secure teacher approval migration.
-- DO NOT apply before PC/Mobile production has switched away from legacy test_* RPCs.

revoke all on function public.test_list_academy_members(text) from public, anon, authenticated;
revoke all on function public.test_list_teacher_approval_requests(text) from public, anon, authenticated;
revoke all on function public.test_approve_teacher_request(text, text) from public, anon, authenticated;
revoke all on function public.test_reject_teacher_request(text, text) from public, anon, authenticated;
