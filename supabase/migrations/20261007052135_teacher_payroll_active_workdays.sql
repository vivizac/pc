begin;

create or replace function private.olli_teacher_payroll_calculate(
  p_academy_id uuid,
  p_teacher_member_id uuid,
  p_month date
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_month date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_month_end date := (date_trunc('month', coalesce(p_month, current_date)) + interval '1 month - 1 day')::date;
  v_prev_month date := (date_trunc('month', coalesce(p_month, current_date)) - interval '1 month')::date;
  v_prev_month_end date := (date_trunc('month', coalesce(p_month, current_date)) - interval '1 day')::date;
  v_hourly_wage bigint := 0;
  v_monthly_salary bigint := 0;
  v_payday integer := 15;
  v_pay_date date;
  v_prev_pay_date date;
  v_period_start date;
  v_period_end date;
  v_weekday_hours jsonb := '{"1":0,"2":0,"3":0,"4":0,"5":0,"6":0}'::jsonb;
  v_breakdown jsonb := '[]'::jsonb;
  v_weekday_workdays jsonb := '{}'::jsonb;
  v_workday_count integer := 0;
  v_total_hours numeric(10,2) := 0;
  v_amount bigint := 0;
  v_pay_type text := 'hourly';
begin
  select s.hourly_wage,s.monthly_salary,s.payday,s.weekday_hours
    into v_hourly_wage,v_monthly_salary,v_payday,v_weekday_hours
  from private.olli_teacher_payroll_settings s
  where s.academy_id=p_academy_id
    and s.teacher_member_id=p_teacher_member_id;

  v_hourly_wage := coalesce(v_hourly_wage,0);
  v_monthly_salary := coalesce(v_monthly_salary,0);
  v_payday := greatest(1,least(31,coalesce(v_payday,15)));
  v_weekday_hours := coalesce(v_weekday_hours,'{"1":0,"2":0,"3":0,"4":0,"5":0,"6":0}'::jsonb);
  v_pay_type := case when v_monthly_salary > 0 then 'monthly' else 'hourly' end;

  v_pay_date := (v_month + (least(v_payday,extract(day from v_month_end)::integer)-1) * interval '1 day')::date;
  v_prev_pay_date := (v_prev_month + (least(v_payday,extract(day from v_prev_month_end)::integer)-1) * interval '1 day')::date;
  v_period_start := (v_prev_pay_date + interval '1 day')::date;
  v_period_end := v_pay_date;

  with dates as (
    select gs::date as session_date, extract(isodow from gs)::integer as weekday
    from generate_series(v_period_start::timestamp, v_period_end::timestamp, interval '1 day') gs
    where extract(isodow from gs) between 1 and 6
  ),
  resolved_dates as (
    select d.session_date,d.weekday,
      case
        when academy_day.day_type='normal' then false
        when academy_day.day_type='holiday' then true
        when global_day.id is not null then true
        else false
      end as is_holiday
    from dates d
    left join lateral (
      select c.id,c.day_type
      from public.olli_schedule_calendar_days c
      where c.academy_id is null and c.session_date=d.session_date
      order by c.updated_at desc,c.created_at desc
      limit 1
    ) global_day on true
    left join lateral (
      select c.id,c.day_type
      from public.olli_schedule_calendar_days c
      where c.academy_id=p_academy_id and c.session_date=d.session_date
      order by c.updated_at desc,c.created_at desc
      limit 1
    ) academy_day on true
  ),
  active_slots as (
    select distinct
      rd.session_date,
      rd.weekday,
      s.division,
      e.time_slot,
      coalesce(nullif(upper(trim(e.class_group)),''),'A') as class_group
    from resolved_dates rd
    join public.olli_schedule_enrollments e
      on e.academy_id=p_academy_id
     and e.weekday=rd.weekday
     and e.status='active'
     and e.effective_from<=rd.session_date
     and (e.effective_to is null or e.effective_to>=rd.session_date)
    join public.students s
      on s.id=e.student_id
     and s.academy_id=p_academy_id
     and s.status='active'
     and coalesce(s.is_deleted,false)=false
    where rd.is_holiday=false

    union

    select distinct
      rd.session_date,
      rd.weekday,
      coalesce(s.division,o.guest_division) as division,
      o.time_slot,
      coalesce(nullif(upper(trim(o.class_group)),''),'A') as class_group
    from resolved_dates rd
    join public.olli_schedule_one_time_sessions o
      on o.academy_id=p_academy_id
     and o.session_date=rd.session_date
     and o.status<>'cancelled'
    left join public.students s
      on s.id=o.student_id
    where rd.is_holiday=false
      and (
        o.student_id is null
        or (
          s.academy_id=p_academy_id
          and s.status='active'
          and coalesce(s.is_deleted,false)=false
        )
      )
  ),
  effective_slots as (
    select a.session_date,a.weekday,
      case
        when o.id is not null then coalesce(o.teacher_member_id,override_member.teacher_member_id)
        else coalesce(ct.teacher_member_id,class_member.teacher_member_id)
      end as teacher_member_id
    from active_slots a
    join public.olli_schedule_class_teachers ct
      on ct.academy_id=p_academy_id
     and ct.division=a.division
     and ct.weekday=a.weekday
     and ct.time_slot=a.time_slot
     and coalesce(nullif(upper(trim(ct.class_group)),''),'A')=a.class_group
    left join public.olli_schedule_teacher_overrides o
      on o.academy_id=p_academy_id
     and o.session_date=a.session_date
     and o.division=a.division
     and o.time_slot=a.time_slot
     and coalesce(nullif(upper(trim(o.class_group)),''),'A')=a.class_group
    left join lateral (
      select (array_agg(m.id order by m.created_at,m.id))[1] as teacher_member_id
      from public.academy_members m
      where m.academy_id=ct.academy_id
        and m.status='active'
        and m.role in ('manager','teacher')
        and ct.teacher_member_id is null
        and nullif(trim(ct.teacher_name),'') is not null
        and trim(m.display_name)=trim(ct.teacher_name)
      having count(*)=1
    ) class_member on true
    left join lateral (
      select (array_agg(m.id order by m.created_at,m.id))[1] as teacher_member_id
      from public.academy_members m
      where m.academy_id=ct.academy_id
        and m.status='active'
        and m.role in ('manager','teacher')
        and o.id is not null
        and o.teacher_member_id is null
        and nullif(trim(o.teacher_name),'') is not null
        and trim(m.display_name)=trim(o.teacher_name)
      having count(*)=1
    ) override_member on true
  ),
  teacher_days as (
    select distinct e.session_date,e.weekday
    from effective_slots e
    where e.teacher_member_id=p_teacher_member_id
  ),
  counts as (
    select g.weekday,coalesce(count(td.session_date),0)::integer as workdays
    from generate_series(1,6) as g(weekday)
    left join teacher_days td on td.weekday=g.weekday
    group by g.weekday
    order by g.weekday
  ),
  totals as (
    select
      coalesce(sum(c.workdays),0)::integer as workday_count,
      coalesce(sum(
        c.workdays * greatest(0,least(24,coalesce(nullif(v_weekday_hours->>c.weekday::text,'')::numeric,0)))
      ),0)::numeric(10,2) as total_hours
    from counts c
  )
  select
    coalesce(jsonb_object_agg(c.weekday::text,c.workdays order by c.weekday),'{}'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'weekday',c.weekday,
      'workdays',c.workdays,
      'hours_per_day',greatest(0,least(24,coalesce(nullif(v_weekday_hours->>c.weekday::text,'')::numeric,0))),
      'hours',round(c.workdays * greatest(0,least(24,coalesce(nullif(v_weekday_hours->>c.weekday::text,'')::numeric,0))),2)
    ) order by c.weekday),'[]'::jsonb),
    t.workday_count,
    t.total_hours
  into v_weekday_workdays,v_breakdown,v_workday_count,v_total_hours
  from counts c
  cross join totals t
  group by t.workday_count,t.total_hours;

  v_amount := case
    when v_monthly_salary > 0 then v_monthly_salary
    else round(v_total_hours * v_hourly_wage)::bigint
  end;

  return jsonb_build_object(
    'month',to_char(v_month,'YYYY-MM'),
    'pay_type',v_pay_type,
    'pay_date',v_pay_date,
    'period_start',v_period_start,
    'period_end',v_period_end,
    'weekday_workdays',v_weekday_workdays,
    'breakdown',v_breakdown,
    'workday_count',v_workday_count,
    'total_hours',v_total_hours,
    'monthly_salary',v_monthly_salary,
    'hourly_wage',v_hourly_wage,
    'amount',v_amount
  );
end;
$function$;

revoke all on function private.olli_teacher_payroll_calculate(uuid,uuid,date) from public,anon,authenticated;

commit;
