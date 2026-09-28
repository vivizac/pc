-- Applied to Production as migration 20260928034318 secure_feedback_data_access\n\nrevoke all on function private.olli_feedback_data_access_impl(text,text,uuid,text,text,jsonb,jsonb,integer) from public, anon, authenticated;
revoke all on function public.olli_general_feedback_data_access(text,uuid,text,text,jsonb,jsonb,integer) from public, anon, authenticated;
revoke all on function public.olli_growth_feedback_data_access(text,uuid,text,text,jsonb,jsonb,integer) from public, anon, authenticated;
revoke all on function public.olli_summary_feedback_data_access(text,uuid,text,text,jsonb,jsonb,integer) from public, anon, authenticated;
grant execute on function public.olli_general_feedback_data_access(text,uuid,text,text,jsonb,jsonb,integer) to anon, authenticated;
grant execute on function public.olli_growth_feedback_data_access(text,uuid,text,text,jsonb,jsonb,integer) to anon, authenticated;
grant execute on function public.olli_summary_feedback_data_access(text,uuid,text,text,jsonb,jsonb,integer) to anon, authenticated;
