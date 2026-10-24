-- Exact-task consultation summary linking. No existing summary rows are changed.
-- A historical summary is NEVER linked from year/summary_months/created_at alone.
-- Only an authorized owner can explicitly confirm one exact record.
create unique index if not exists olli_consultation_summary_jobs_feedback_unique
  on public.olli_consultation_summary_jobs(feedback_id)
  where feedback_id is not null;

create table if not exists private.olli_consultation_summary_link_audit(
  id bigint generated always as identity primary key,
  academy_id uuid not null,
  student_id uuid not null,
  rule_key text not null,
  due_month text not null,
  feedback_id bigint not null,
  account_id uuid not null,
  action text not null check(action in ('owner_confirmed_legacy_link')),
  linked_at timestamptz not null default now(),
  unique(academy_id,student_id,rule_key,due_month,feedback_id,action)
);
revoke all on private.olli_consultation_summary_link_audit from public, anon, authenticated;
grant select,insert on private.olli_consultation_summary_link_audit to service_role;
grant usage,select on sequence private.olli_consultation_summary_link_audit_id_seq to service_role;

create or replace function public.olli_consultation_legacy_summary_link(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_rule_key text,
  p_due_month text,
  p_feedback_id bigint,
  p_confirm_exact_record boolean default false
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_account uuid;
  v_rule_months integer;
  v_due date;
  v_job public.olli_consultation_summary_jobs%rowtype;
  v_saved public.summary_feedbacks%rowtype;
begin
  if not coalesce(p_confirm_exact_record,false) then
    return jsonb_build_object('ok',false,'code','EXPLICIT_CONFIRMATION_REQUIRED');
  end if;
  v_account:=public.olli_account_id_from_session(p_session_token);
  if v_account is null then
    return jsonb_build_object('ok',false,'code','SESSION_INVALID');
  end if;
  if not exists (
    select 1 from public.academy_members m
    join public.academies a on a.id=m.academy_id
    where m.account_id=v_account and m.academy_id=p_academy_id
      and m.status='active' and m.role in ('owner','super_admin')
      and a.status='active' and a.deleted_at is null
  ) then
    return jsonb_build_object('ok',false,'code','OWNER_REQUIRED');
  end if;
  if p_rule_key not in ('after_1','after_3','every_6','every_12')
    or p_due_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
    or p_feedback_id is null or p_feedback_id<=0 then
    return jsonb_build_object('ok',false,'code','INVALID_TASK');
  end if;
  if not exists (
    select 1 from public.students s
    where s.id=p_student_id and s.academy_id=p_academy_id
      and s.status='active' and coalesce(s.is_deleted,false)=false
  ) then
    return jsonb_build_object('ok',false,'code','STUDENT_NOT_FOUND');
  end if;

  v_due:=(p_due_month||'-01')::date;
  v_rule_months:=case p_rule_key when 'after_1' then 1 when 'after_3' then 3
    when 'every_6' then 6 else 12 end;
  select * into v_saved from public.summary_feedbacks sf
    where sf.id=p_feedback_id and sf.academy_id=p_academy_id
      and sf.student_id=p_student_id and coalesce(sf.is_deleted,false)=false
    for update;
  if not found or btrim(coalesce(v_saved.content,''))=''
    or v_saved.summary_months is distinct from v_rule_months
    or v_saved.year is distinct from extract(year from v_due)::integer
    or v_saved.created_at < v_due-interval '1 month'
    or v_saved.created_at >= v_due+interval '2 months' then
    return jsonb_build_object('ok',false,'code','RECORD_PERIOD_NOT_VERIFIED');
  end if;
  -- A summary generated for a DIFFERENT exact task is never re-adopted.
  if coalesce(v_saved.client_mutation_id,'') like 'consultation:%'
    and v_saved.client_mutation_id is distinct from
      ('consultation:'||p_academy_id||':'||p_student_id||':'||p_rule_key||':'||p_due_month)
  then
    return jsonb_build_object('ok',false,'code','RECORD_BELONGS_TO_ANOTHER_TASK');
  end if;

  insert into public.olli_consultation_summary_jobs(academy_id,student_id,rule_key,due_month)
  values(p_academy_id,p_student_id,p_rule_key,p_due_month) on conflict do nothing;
  select * into v_job from public.olli_consultation_summary_jobs
    where academy_id=p_academy_id and student_id=p_student_id
      and rule_key=p_rule_key and due_month=p_due_month for update;

  if v_job.feedback_id=p_feedback_id and v_job.status='ready' then
    return jsonb_build_object('ok',true,'status','ready','feedback_id',p_feedback_id,'already_linked',true);
  end if;
  if v_job.feedback_id is not null and v_job.feedback_id<>p_feedback_id then
    return jsonb_build_object('ok',false,'code','TASK_ALREADY_LINKED');
  end if;
  if exists(select 1 from public.olli_consultation_summary_jobs j
    where j.feedback_id=p_feedback_id
      and (j.academy_id,j.student_id,j.rule_key,j.due_month) is distinct from
      (p_academy_id,p_student_id,p_rule_key,p_due_month)) then
    return jsonb_build_object('ok',false,'code','SUMMARY_ALREADY_LINKED_ELSEWHERE');
  end if;
  if v_job.status='generating' and v_job.leased_until>now() then
    return jsonb_build_object('ok',false,'code','GENERATION_IN_PROGRESS');
  end if;
  update public.olli_consultation_summary_jobs
    set status='ready',feedback_id=p_feedback_id,claim_token=null,
      leased_until=null,last_error=null,updated_at=now()
    where academy_id=p_academy_id and student_id=p_student_id
      and rule_key=p_rule_key and due_month=p_due_month;
  insert into private.olli_consultation_summary_link_audit
    (academy_id,student_id,rule_key,due_month,feedback_id,account_id,action)
    values(p_academy_id,p_student_id,p_rule_key,p_due_month,p_feedback_id,v_account,
      'owner_confirmed_legacy_link')
    on conflict do nothing;
  return jsonb_build_object('ok',true,'status','ready','feedback_id',p_feedback_id,'already_linked',false);
end;
$$;
revoke execute on function public.olli_consultation_legacy_summary_link(
  text,uuid,uuid,text,text,bigint,boolean
) from public,anon,authenticated;
grant execute on function public.olli_consultation_legacy_summary_link(
  text,uuid,uuid,text,text,bigint,boolean
) to service_role;
