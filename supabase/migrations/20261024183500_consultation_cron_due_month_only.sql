-- Current-month-only consultation generation. Previous months are never retried or rolled forward.
-- Existing summary feedbacks and job rows remain unchanged.
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
      a.consultation_rules,
      seq.n, to_char(date_trunc('month',s.enrolled_at)::date + make_interval(months=>seq.n),'YYYY-MM') due_month
    from public.students s
    join public.academies academy on academy.id=s.academy_id
      and academy.status='active' and academy.deleted_at is null
    join public.academy_settings a on a.academy_id=s.academy_id
    cross join lateral generate_series(1,240) seq(n)
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
      -- Only generate for consultation tasks whose ORIGINAL due month is the current month.
      -- Never backfill overdue, unfinished or previously skipped appointments.
      and sc.due_month = to_char(now() at time zone 'Asia/Seoul','YYYY-MM')
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
