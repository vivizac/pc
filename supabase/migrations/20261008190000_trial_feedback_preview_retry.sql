-- Authenticated read-only preview; keeps original trial feedback records unchanged.
create or replace function public.olli_trial_feedback_preview(p_session_token text,p_academy_id uuid,p_trial_session_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_account uuid; v_feedbacks jsonb;
begin
 v_account:=public.olli_account_id_from_session(p_session_token);
 if v_account is null or not exists (
  select 1 from public.academy_members m where m.account_id=v_account and m.academy_id=p_academy_id
    and m.status='active' and m.role in ('owner','manager','teacher')
 ) then return jsonb_build_object('ok',false,'message','체험 피드백 조회 권한이 없습니다.'); end if;
 if not exists (
  select 1 from public.olli_schedule_one_time_sessions t where t.id=p_trial_session_id and t.academy_id=p_academy_id
    and t.session_type='trial' and t.status<>'cancelled' and t.student_id is null
 ) then return jsonb_build_object('ok',false,'message','체험수업을 찾지 못했습니다.'); end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'content',f.content,'created_at',f.created_at)
    order by f.created_at,f.id),'[]'::jsonb)
 into v_feedbacks from public.olli_trial_feedbacks f
 where f.academy_id=p_academy_id and f.trial_session_id=p_trial_session_id;
 return jsonb_build_object('ok',true,'feedbacks',v_feedbacks);
end; $$;
revoke all on function public.olli_trial_feedback_preview(text,uuid,uuid) from public;
grant execute on function public.olli_trial_feedback_preview(text,uuid,uuid) to anon,authenticated,service_role;
