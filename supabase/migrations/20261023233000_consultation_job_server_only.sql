-- Summary generation's internal lease RPC may be called only by the dedicated server service role.
-- Clients must use /api/consultation-summary; direct browser use could bypass material readiness validation.
begin;
revoke execute on function public.olli_consultation_summary_job_access(
  text,uuid,uuid,text,text,text,uuid,text,text
) from public, anon, authenticated;
grant execute on function public.olli_consultation_summary_job_access(
  text,uuid,uuid,text,text,text,uuid,text,text
) to service_role;
commit;
