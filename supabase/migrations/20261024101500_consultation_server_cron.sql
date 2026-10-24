-- Server-only scheduled job discovery and server scheduler claim path.
-- Does not create feedback rows or mark any consultation complete at migration time.
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
  if p_session_token='__olli_server_cron_internal__' then
    -- Cron cannot use or retain a human owner's login credential.
    -- Only the service_role REST connection is eligible for this path.
    if current_setting('request.jwt.claim.role',true) is distinct from 'service_role'
       then return jsonb_build_object('ok',false,'code','CRON_ROLE_DENIED'); end if;
    v_role:='service_scheduler'; v_member_id:=null;
  else
    v_account := public.olli_account_id_from_session(p_session_token);
    if v_account is null then return jsonb_build_object('ok',false,'code','SESSION_INVALID'); end if;
    select m.id,m.role into v_member_id,v_role
    from public.academy_members m join public.academies a on a.id=m.academy_id
    where m.account_id=v_account and m.academy_id=p_academy_id
      and m.status='active' and a.status='active' and a.deleted_at is null
      and m.role in ('owner','manager','super_admin') limit 1;
    if v_role is null then return jsonb_build_object('ok',false,'code','PERMISSION_DENIED'); end if;
  end if;
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
) from public,anon,authenticated;
grant execute on function public.olli_consultation_summary_job_access(
  text,uuid,uuid,text,text,text,uuid,text,text
) to service_role;

create or replace function public.olli_consultation_summary_cron_candidates(p_limit integer default 6)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_candidates jsonb;
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
    return jsonb_build_object('ok',false,'code','ROLE_DENIED');
  end if;
  with months as (
    select s.id student_id, s.academy_id, s.division,s.enrolled_at,
      a.consultation_rules,a.consultation_progress,
      seq.n, to_char(date_trunc('month',s.enrolled_at)::date + make_interval(months=>seq.n),'YYYY-MM') due_month
    from public.students s
    join public.academies academy on academy.id=s.academy_id
      and academy.status='active' and academy.deleted_at is null
    join public.academy_settings a on a.academy_id=s.academy_id
    cross join lateral generate_series(1,72) seq(n)
    where s.status='active' and s.is_deleted=false and s.enrolled_at is not null
      and date_trunc('month',s.enrolled_at)::date + make_interval(months=>seq.n)
        <= date_trunc('month', now() at time zone 'Asia/Seoul')
  ),
  scheduled as (
    select m.*,
      case
        when n=1 and coalesce(m.consultation_rules->m.division,'[]'::jsonb) ? 'after_1' then 'after_1'
        when n=3 and coalesce(m.consultation_rules->m.division,'[]'::jsonb) ? 'after_3' then 'after_3'
        when n=6 and coalesce(m.consultation_rules->m.division,'[]'::jsonb) ? 'every_6' then 'every_6'
        when n%12=0 and (n>12 or coalesce(m.consultation_rules->m.division,'[]'::jsonb) ? 'every_12') then 'every_12'
        else null end as rule_key
    from months m
  ),
  eligible as (
    select sc.*,
      'id:'||sc.student_id::text||'|'||sc.rule_key||'|'||sc.due_month as task_key
    from scheduled sc
    left join public.olli_consultation_summary_jobs j
      on j.academy_id=sc.academy_id and j.student_id=sc.student_id
      and j.rule_key=sc.rule_key and j.due_month=sc.due_month
    where sc.rule_key is not null
      and sc.due_month >= coalesce(sc.consultation_progress->>'tracking_started_month',
        to_char(now() at time zone 'Asia/Seoul','YYYY-MM'))
      and sc.due_month >= to_char((now() at time zone 'Asia/Seoul') - interval '13 months','YYYY-MM')
      and not coalesce(sc.consultation_progress->'completed','{}'::jsonb) ?
        ('id:'||sc.student_id::text||'|'||sc.rule_key||'|'||sc.due_month)
      and (j.status is null or j.status='error' or j.status='pending'
           or (j.status='generating' and coalesce(j.leased_until,now()-interval '1 second')<now()))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'academyId',c.academy_id,'studentId',c.student_id,'taskKey',c.task_key)), '[]'::jsonb)
    into v_candidates
  from (
    select academy_id,student_id,task_key from eligible
    order by md5(student_id::text||task_key||to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD'))
    limit least(greatest(coalesce(p_limit,6),1),16)
  ) c;
  return jsonb_build_object('ok',true,'candidates',v_candidates);
end;
$$;
revoke all on function public.olli_consultation_summary_cron_candidates(integer) from public,anon,authenticated;
grant execute on function public.olli_consultation_summary_cron_candidates(integer) to service_role;
