-- Owner-only, read-only candidate review. No summary/job is modified by this RPC.
-- Matching by period and date is only for suggesting candidates, never for readiness.
create or replace function public.olli_consultation_legacy_summary_candidates(
  p_session_token text, p_academy_id uuid, p_student_id uuid,
  p_rule_key text, p_due_month text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_account uuid;
  v_rule_months integer;
  v_due date;
  v_candidates jsonb;
  v_job_status text;
  v_linked_id bigint;
begin
  v_account := public.olli_account_id_from_session(p_session_token);
  if v_account is null then return jsonb_build_object('ok',false,'code','SESSION_INVALID'); end if;
  if not exists(
    select 1 from public.academy_members m
    join public.academies a on a.id=m.academy_id
    where m.account_id=v_account and m.academy_id=p_academy_id
      and m.status='active' and m.role in ('owner','super_admin')
      and a.status='active' and a.deleted_at is null
  ) then return jsonb_build_object('ok',false,'code','OWNER_REQUIRED'); end if;
  if p_rule_key not in ('after_1','after_3','every_6','every_12')
     or p_due_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then
    return jsonb_build_object('ok',false,'code','INVALID_TASK');
  end if;
  if not exists(
    select 1 from public.students s
    where s.id=p_student_id and s.academy_id=p_academy_id
      and s.status='active' and not coalesce(s.is_deleted,false)
  ) then return jsonb_build_object('ok',false,'code','STUDENT_NOT_FOUND'); end if;
  v_due:=(p_due_month||'-01')::date;
  v_rule_months:=case p_rule_key when 'after_1' then 1 when 'after_3' then 3
    when 'every_6' then 6 else 12 end;
  select j.status,j.feedback_id into v_job_status,v_linked_id
  from public.olli_consultation_summary_jobs j
  where j.academy_id=p_academy_id and j.student_id=p_student_id
    and j.rule_key=p_rule_key and j.due_month=p_due_month;
  select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc,c.feedback_id desc),'[]'::jsonb)
    into v_candidates from (
    select sf.id as feedback_id,sf.summary_months,sf.period_months,
           sf.year,sf.date,sf.created_at,sf.content
    from public.summary_feedbacks sf
    where sf.academy_id=p_academy_id and sf.student_id=p_student_id
      and not coalesce(sf.is_deleted,false) and btrim(coalesce(sf.content,''))<>''
      and sf.summary_months=v_rule_months
      and sf.year=extract(year from v_due)::int
      and sf.created_at>=v_due-interval '1 month'
      and sf.created_at<v_due+interval '2 months'
      and coalesce(sf.client_mutation_id,'') not like 'consultation:%'
      and not exists(select 1 from public.olli_consultation_summary_jobs j
        where j.feedback_id=sf.id)
    order by sf.created_at desc,sf.id desc limit 30
  ) c;
  return jsonb_build_object('ok',true,'status',coalesce(v_job_status,'none'),
    'linked_feedback_id',v_linked_id,'candidates',v_candidates);
end;
$$;
revoke all on function public.olli_consultation_legacy_summary_candidates(
  text,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.olli_consultation_legacy_summary_candidates(
  text,uuid,uuid,text,text) to service_role;
