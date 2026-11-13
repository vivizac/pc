-- Initial consultation requires at least 21 days of actual scheduled lessons
-- by the consultation month's second Monday. Deferred first consultations
-- use their ORIGINAL first-consultation rule and exactly one due month.
-- No existing student, feedback, summary, or consultation job is modified.
create or replace function public.olli_consultation_summary_cron_candidates(p_limit integer default 6)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_candidates jsonb;
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
    return jsonb_build_object('ok',false,'code','ROLE_DENIED');
  end if;

  with active_students as (
    select s.id as student_id,s.academy_id,s.division,s.enrolled_at,
      case when jsonb_typeof(a.consultation_rules)='array' then a.consultation_rules
           else coalesce(a.consultation_rules->s.division,'[]'::jsonb) end as rules,
      coalesce((
        select min(greatest(e.effective_from,s.enrolled_at)
          + ((e.weekday-extract(dow from greatest(e.effective_from,s.enrolled_at))::integer+7)%7))
        from public.olli_schedule_enrollments e
        where e.student_id=s.id and e.academy_id=s.academy_id
          and e.effective_from is not null and e.weekday between 0 and 6
      ),s.enrolled_at) as first_lesson
    from public.students s
    join public.academies academy on academy.id=s.academy_id
      and academy.status='active' and academy.deleted_at is null
    join public.academy_settings a on a.academy_id=s.academy_id
    where s.status='active' and coalesce(s.is_deleted,false)=false
      and coalesce(s.is_stat_only,false)=false and s.enrolled_at is not null
  ),
  thresholds as (
    select s.*,s.first_lesson+21 as threshold_day,
      date_trunc('month',(s.first_lesson+21)::timestamp)::date as threshold_month
    from active_students s
  ),
  first_months as (
    select t.*,greatest(
      (date_trunc('month',t.enrolled_at::timestamp)+interval '1 month')::date,
      case when t.threshold_day <= t.threshold_month
        + ((1-extract(dow from t.threshold_month)::integer+7)%7)+7
        then t.threshold_month else (t.threshold_month+interval '1 month')::date end
    ) as first_due_date
    from thresholds t
  ),
  months as (
    select m.student_id,m.academy_id,m.division,m.rules,seq.n,
      case when seq.n=1 then to_char(m.first_due_date,'YYYY-MM')
           else to_char((date_trunc('month',m.enrolled_at::timestamp)+make_interval(months=>seq.n))::date,'YYYY-MM') end as due_month
    from first_months m cross join lateral generate_series(1,240) seq(n)
  ),
  scheduled as (
    select m.*,
      case
        when n=1 and rules ? 'after_1' then 'after_1'
        when n=3 and rules ? 'after_3' then 'after_3'
        when n%12=0 and (n>12 or rules ? 'every_12') then 'every_12'
        when n%6=0 and rules ? 'every_6' then 'every_6'
        else null
      end as rule_key
    from months m
  ),
  eligible as (
    select sc.academy_id,sc.student_id,sc.rule_key,sc.due_month,
      'id:'||sc.student_id::text||'|'||sc.rule_key||'|'||sc.due_month as task_key
    from scheduled sc
    left join public.olli_consultation_summary_jobs j
      on j.academy_id=sc.academy_id and j.student_id=sc.student_id
      and j.rule_key=sc.rule_key and j.due_month=sc.due_month
    where sc.rule_key is not null
      and sc.due_month=to_char(now() at time zone 'Asia/Seoul','YYYY-MM')
      and (j.status is null or j.status in ('pending','error')
           or (j.status='generating' and coalesce(j.leased_until,now()-interval '1 second')<now()))
  )

  select coalesce(jsonb_agg(jsonb_build_object(
      'academyId',c.academy_id,'studentId',c.student_id,'taskKey',c.task_key
    )), '[]'::jsonb)
    into v_candidates
  from (
    select academy_id,student_id,task_key from eligible
    order by md5(student_id::text||task_key||to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD'))
    limit least(greatest(coalesce(p_limit,6),1),16)
  ) c;
  return jsonb_build_object('ok',true,'candidates',v_candidates);
end;
$function$;
revoke all on function public.olli_consultation_summary_cron_candidates(integer) from public,anon,authenticated;
grant execute on function public.olli_consultation_summary_cron_candidates(integer) to service_role;
