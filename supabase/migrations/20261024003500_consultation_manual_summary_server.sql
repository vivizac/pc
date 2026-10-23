-- Extend the server-owned idempotency key for manual archive summaries.
-- This changes no existing summary rows and maintains role-restricted execution.
alter table public.olli_consultation_summary_jobs
  drop constraint if exists olli_consultation_summary_jobs_rule_key_check;
alter table public.olli_consultation_summary_jobs
  add constraint olli_consultation_summary_jobs_rule_key_check
  check (rule_key in ('after_1','after_3','every_6','every_12','manual_1','manual_3','manual_6','manual_12'));
create or replace function public.olli_consultation_summary_job_access(
  p_session_token text, p_academy_id uuid, p_student_id uuid,
  p_rule_key text, p_due_month text, p_action text default 'claim',
  p_claim_token uuid default null, p_content text default null,
  p_error text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_account uuid; v_role text; v_member_id uuid; v_job public.olli_consultation_summary_jobs%rowtype;
  v_summary_id bigint; v_summary_months integer; v_student_name text;
  v_token uuid; v_due_date date;
begin
  v_account := public.olli_account_id_from_session(p_session_token);
  if v_account is null then return jsonb_build_object('ok',false,'code','SESSION_INVALID'); end if;
  select m.id,m.role into v_member_id,v_role
  from public.academy_members m join public.academies a on a.id=m.academy_id
  where m.account_id=v_account and m.academy_id=p_academy_id
    and m.status='active' and a.status='active' and a.deleted_at is null
    and m.role in ('owner','manager','super_admin') limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'code','PERMISSION_DENIED'); end if;
  if p_rule_key not in ('after_1','after_3','every_6','every_12','manual_1','manual_3','manual_6','manual_12')
    or p_due_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
    or p_action not in ('claim','finish','fail','read','revise') then
    return jsonb_build_object('ok',false,'code','PARAM_INVALID');
  end if;
  select s.name into v_student_name from public.students s
  where s.id=p_student_id and s.academy_id=p_academy_id
    and s.status='active' and not coalesce(s.is_deleted,false);
  if not found then return jsonb_build_object('ok',false,'code','STUDENT_NOT_FOUND'); end if;
  v_due_date := (p_due_month||'-01')::date;
  v_summary_months := case p_rule_key when 'after_1' then 1 when 'after_3' then 3
    when 'every_6' then 6 when 'manual_1' then 1 when 'manual_3' then 3 when 'manual_6' then 6 else 12 end;

  insert into public.olli_consultation_summary_jobs
    (academy_id,student_id,rule_key,due_month)
  values (p_academy_id,p_student_id,p_rule_key,p_due_month)
  on conflict do nothing;

  select * into v_job from public.olli_consultation_summary_jobs
  where academy_id=p_academy_id and student_id=p_student_id
    and rule_key=p_rule_key and due_month=p_due_month for update;

  if p_action='read' then
    return jsonb_build_object('ok',true,'status',v_job.status,'feedback_id',v_job.feedback_id);
  end if;
  if p_action='revise' then
    if v_job.status<>'ready' or v_job.feedback_id is null then
      return jsonb_build_object('ok',false,'code','NOT_READY');
    end if;
    if length(btrim(coalesce(p_content,'')))<10 then
      return jsonb_build_object('ok',false,'code','CONTENT_INVALID');
    end if;
    update public.summary_feedbacks sf
      set content=p_content,updated_at=now()
      where sf.id=v_job.feedback_id and sf.academy_id=p_academy_id
        and sf.student_id=p_student_id and not coalesce(sf.is_deleted,false)
      returning sf.id into v_summary_id;
    if v_summary_id is null then return jsonb_build_object('ok',false,'code','SUMMARY_NOT_FOUND'); end if;
    return jsonb_build_object('ok',true,'status','ready','feedback_id',v_summary_id,'content',p_content);
  end if;
  if p_action='claim' then
    if v_job.status='ready' and v_job.feedback_id is not null
      and exists(select 1 from public.summary_feedbacks sf where sf.id=v_job.feedback_id and not coalesce(sf.is_deleted,false))
    then return jsonb_build_object('ok',true,'status','ready','feedback_id',v_job.feedback_id); end if;

    -- 이전 저장본도 서버에서 먼저 확인한다. 기존 수동/자동 결과를 새로 생성하지 않는다.
    if p_rule_key not like 'manual_%' then
      select sf.id into v_summary_id from public.summary_feedbacks sf
      where sf.academy_id=p_academy_id and sf.student_id=p_student_id
        and coalesce(sf.is_deleted,false)=false and sf.summary_months=v_summary_months
        and sf.year=extract(year from v_due_date)::integer
        and sf.created_at >= (v_due_date - interval '1 month')
        and sf.created_at < (v_due_date + interval '2 months')
      order by sf.created_at desc limit 1;
    end if;
    if v_summary_id is not null then
      update public.olli_consultation_summary_jobs
      set status='ready',feedback_id=v_summary_id,claim_token=null,leased_until=null,updated_at=now()
      where academy_id=p_academy_id and student_id=p_student_id
        and rule_key=p_rule_key and due_month=p_due_month;
      return jsonb_build_object('ok',true,'status','ready','feedback_id',v_summary_id);
    end if;

    if v_job.status='generating' and v_job.leased_until>now() then
      return jsonb_build_object('ok',true,'status','generating');
    end if;
    v_token := gen_random_uuid();
    update public.olli_consultation_summary_jobs
    set status='generating',claim_token=v_token,leased_until=now()+interval '8 minutes',
      attempts=attempts+1,last_error=null,updated_at=now()
    where academy_id=p_academy_id and student_id=p_student_id
      and rule_key=p_rule_key and due_month=p_due_month;
    return jsonb_build_object('ok',true,'status','claimed','claim_token',v_token);
  end if;
  if p_claim_token is null or v_job.status<>'generating'
    or v_job.claim_token is distinct from p_claim_token then
    return jsonb_build_object('ok',false,'code','CLAIM_MISMATCH');
  end if;
  if p_action='fail' then
    update public.olli_consultation_summary_jobs
    set status='error',last_error=left(coalesce(p_error,'error'),500),
      claim_token=null,leased_until=null,updated_at=now()
    where academy_id=p_academy_id and student_id=p_student_id
      and rule_key=p_rule_key and due_month=p_due_month;
    return jsonb_build_object('ok',true,'status','error');
  end if;
  if p_action='finish' then
    if length(btrim(coalesce(p_content,'')))<40 then
      return jsonb_build_object('ok',false,'code','CONTENT_INVALID');
    end if;
    insert into public.summary_feedbacks
      (academy_id,student_id,student_name,content,feedback_type,date,
       period_months,created_by,year,summary_months,client_mutation_id)
    values
      (p_academy_id,p_student_id,v_student_name,p_content,'summary',
       to_char(now() at time zone 'Asia/Seoul','YYYY. MM. DD.'),
       v_summary_months,v_member_id,extract(year from v_due_date)::int,v_summary_months,
       'consultation:'||p_academy_id||':'||p_student_id||':'||p_rule_key||':'||p_due_month)
    on conflict (academy_id,client_mutation_id) do nothing
    returning id into v_summary_id;
    if v_summary_id is null then
      select id into v_summary_id from public.summary_feedbacks
      where academy_id=p_academy_id
        and client_mutation_id='consultation:'||p_academy_id||':'||p_student_id||':'||p_rule_key||':'||p_due_month;
    end if;
    update public.olli_consultation_summary_jobs
    set status='ready',feedback_id=v_summary_id,claim_token=null,leased_until=null,updated_at=now()
    where academy_id=p_academy_id and student_id=p_student_id
      and rule_key=p_rule_key and due_month=p_due_month;
    return jsonb_build_object('ok',true,'status','ready','feedback_id',v_summary_id);
  end if;
  return jsonb_build_object('ok',false,'code','ACTION_INVALID');
end;
$$;

revoke execute on function public.olli_consultation_summary_job_access(
  text,uuid,uuid,text,text,text,uuid,text,text
) from public, anon, authenticated;
grant execute on function public.olli_consultation_summary_job_access(
  text,uuid,uuid,text,text,text,uuid,text,text
) to service_role;
