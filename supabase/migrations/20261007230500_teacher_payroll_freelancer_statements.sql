begin;

alter table private.olli_teacher_payroll_settings
  add column if not exists deduction_mode text not null default 'none';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='olli_teacher_payroll_settings_deduction_mode_check'
      and conrelid='private.olli_teacher_payroll_settings'::regclass
  ) then
    alter table private.olli_teacher_payroll_settings
      add constraint olli_teacher_payroll_settings_deduction_mode_check
      check (deduction_mode in ('none','freelancer_33'));
  end if;
end $$;

alter table private.olli_teacher_payroll_notifications
  add column if not exists gross_amount bigint not null default 0,
  add column if not exists deduction_mode text not null default 'none',
  add column if not exists deduction_amount bigint not null default 0,
  add column if not exists net_amount bigint not null default 0,
  add column if not exists statement_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists statement_message_version smallint not null default 0;

update private.olli_teacher_payroll_notifications
set gross_amount=case when gross_amount=0 then amount else gross_amount end,
    net_amount=case when net_amount=0 then amount else net_amount end
where gross_amount=0 or net_amount=0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='olli_teacher_payroll_notifications_deduction_mode_check'
      and conrelid='private.olli_teacher_payroll_notifications'::regclass
  ) then
    alter table private.olli_teacher_payroll_notifications
      add constraint olli_teacher_payroll_notifications_deduction_mode_check
      check (deduction_mode in ('none','freelancer_33'));
  end if;
end $$;

create or replace function private.olli_teacher_payroll_calculate_payout(
  p_academy_id uuid,
  p_teacher_member_id uuid,
  p_month date
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_calc jsonb;
  v_mode text := 'none';
  v_gross bigint := 0;
  v_deduction bigint := 0;
  v_net bigint := 0;
begin
  v_calc := private.olli_teacher_payroll_calculate(
    p_academy_id,p_teacher_member_id,p_month
  );

  select coalesce(s.deduction_mode,'none')
    into v_mode
  from private.olli_teacher_payroll_settings s
  where s.academy_id=p_academy_id
    and s.teacher_member_id=p_teacher_member_id;

  v_mode := case when v_mode='freelancer_33' then 'freelancer_33' else 'none' end;
  v_gross := greatest(0,coalesce((v_calc->>'amount')::bigint,0));
  v_deduction := case
    when v_mode='freelancer_33'
      then round(v_gross::numeric * 0.033)::bigint
    else 0
  end;
  v_net := greatest(0,v_gross-v_deduction);

  return v_calc || jsonb_build_object(
    'deduction_mode',v_mode,
    'deduction_rate',case when v_mode='freelancer_33' then 0.033 else 0 end,
    'gross_amount',v_gross,
    'deduction_amount',v_deduction,
    'net_amount',v_net,
    'amount',v_net
  );
end;
$function$;

revoke all on function private.olli_teacher_payroll_calculate_payout(uuid,uuid,date)
  from public,anon,authenticated;

create or replace function private.olli_teacher_payroll_teacher_payload(
  p_academy_id uuid,
  p_teacher_member_id uuid,
  p_month date
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_member public.academy_members%rowtype;
  v_setting private.olli_teacher_payroll_settings%rowtype;
  v_calc jsonb;
begin
  select m.* into v_member
  from public.academy_members m
  where m.id=p_teacher_member_id
    and m.academy_id=p_academy_id
  limit 1;

  if v_member.id is null then return null; end if;

  select s.* into v_setting
  from private.olli_teacher_payroll_settings s
  where s.academy_id=p_academy_id
    and s.teacher_member_id=p_teacher_member_id
  limit 1;

  v_calc := private.olli_teacher_payroll_calculate_payout(
    p_academy_id,p_teacher_member_id,p_month
  );

  return jsonb_build_object(
    'teacher_member_id',v_member.id,
    'teacher_name',v_member.display_name,
    'role',v_member.role,
    'monthly_salary',coalesce(v_setting.monthly_salary,0),
    'hourly_wage',coalesce(v_setting.hourly_wage,0),
    'payday',coalesce(v_setting.payday,15),
    'weekday_hours',coalesce(
      v_setting.weekday_hours,
      '{"1":0,"2":0,"3":0,"4":0,"5":0,"6":0}'::jsonb
    ),
    'deduction_mode',coalesce(v_calc->>'deduction_mode','none'),
    'is_enabled',coalesce(v_setting.is_enabled,true),
    'pay_type',coalesce(v_calc->>'pay_type','hourly'),
    'pay_date',v_calc->>'pay_date',
    'period_start',v_calc->>'period_start',
    'period_end',v_calc->>'period_end',
    'weekday_workdays',coalesce(v_calc->'weekday_workdays','{}'::jsonb),
    'breakdown',coalesce(v_calc->'breakdown','[]'::jsonb),
    'workday_count',coalesce((v_calc->>'workday_count')::integer,0),
    'total_hours',coalesce((v_calc->>'total_hours')::numeric,0),
    'regular_hours',coalesce((v_calc->>'regular_hours')::numeric,0),
    'substitute_hours',coalesce((v_calc->>'substitute_hours')::numeric,0),
    'substitute_slot_count',coalesce((v_calc->>'substitute_slot_count')::integer,0),
    'unresolved_substitute_slot_count',coalesce((v_calc->>'unresolved_substitute_slot_count')::integer,0),
    'has_unpriced_substitute_work',coalesce((v_calc->>'has_unpriced_substitute_work')::boolean,false),
    'gross_amount',coalesce((v_calc->>'gross_amount')::bigint,0),
    'deduction_amount',coalesce((v_calc->>'deduction_amount')::bigint,0),
    'net_amount',coalesce((v_calc->>'net_amount')::bigint,0),
    'total_amount',coalesce((v_calc->>'net_amount')::bigint,0)
  );
end;
$function$;

revoke all on function private.olli_teacher_payroll_teacher_payload(uuid,uuid,date)
  from public,anon,authenticated;

create or replace function private.olli_teacher_payroll_statement_payload(
  p_academy_id uuid,
  p_teacher_member_id uuid,
  p_month date
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_calc jsonb;
  v_teacher_name text;
  v_period_start date;
  v_period_end date;
  v_regular_days jsonb := '[]'::jsonb;
  v_substitute_days jsonb := '[]'::jsonb;
begin
  v_calc := private.olli_teacher_payroll_calculate_payout(
    p_academy_id,p_teacher_member_id,p_month
  );

  select m.display_name
    into v_teacher_name
  from public.academy_members m
  where m.id=p_teacher_member_id
    and m.academy_id=p_academy_id
  limit 1;

  v_period_start := nullif(v_calc->>'period_start','')::date;
  v_period_end := nullif(v_calc->>'period_end','')::date;

  if v_period_start is not null and v_period_end is not null then
    with dates as (
      select
        gs::date as session_date,
        extract(isodow from gs)::integer as weekday
      from generate_series(v_period_start::timestamp,v_period_end::timestamp,interval '1 day') gs
      where extract(isodow from gs) between 1 and 6
    ),
    resolved_dates as (
      select
        d.session_date,
        d.weekday,
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
        where c.academy_id is null
          and c.session_date=d.session_date
        order by c.updated_at desc,c.created_at desc
        limit 1
      ) global_day on true
      left join lateral (
        select c.id,c.day_type
        from public.olli_schedule_calendar_days c
        where c.academy_id=p_academy_id
          and c.session_date=d.session_date
        order by c.updated_at desc,c.created_at desc
        limit 1
      ) academy_day on true
    ),
    active_slots as (
      select distinct
        rd.session_date,rd.weekday,rd.is_holiday,
        s.division,e.time_slot,
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

      union

      select distinct
        rd.session_date,rd.weekday,rd.is_holiday,
        coalesce(s.division,o.guest_division) as division,
        o.time_slot,
        coalesce(nullif(upper(trim(o.class_group)),''),'A') as class_group
      from resolved_dates rd
      join public.olli_schedule_one_time_sessions o
        on o.academy_id=p_academy_id
       and o.session_date=rd.session_date
       and o.status<>'cancelled'
      left join public.students s on s.id=o.student_id
      where o.student_id is null
         or (
           s.academy_id=p_academy_id
           and s.status='active'
           and coalesce(s.is_deleted,false)=false
         )
    ),
    regular_slots as (
      select
        a.*,
        coalesce(ct.teacher_member_id,class_member.teacher_member_id) as regular_teacher_member_id
      from active_slots a
      join public.olli_schedule_class_teachers ct
        on ct.academy_id=p_academy_id
       and ct.division=a.division
       and ct.weekday=a.weekday
       and ct.time_slot=a.time_slot
       and coalesce(nullif(upper(trim(ct.class_group)),''),'A')=a.class_group
      left join lateral (
        select (array_agg(m.id order by m.created_at,m.id))[1] as teacher_member_id
        from public.academy_members m
        where m.academy_id=ct.academy_id
          and m.status='active'
          and m.role in ('owner','manager','teacher')
          and ct.teacher_member_id is null
          and nullif(trim(ct.teacher_name),'') is not null
          and trim(m.display_name)=trim(ct.teacher_name)
        having count(*)=1
      ) class_member on true
    ),
    regular_slot_shares as (
      select
        r.*,
        coalesce(
          day_snapshot.payroll_source_weekday_hours,
          greatest(
            0,
            least(
              24,
              coalesce(nullif(rs.weekday_hours->>r.weekday::text,'')::numeric,0)
            )
          )
        ) as regular_day_hours,
        coalesce(
          day_snapshot.payroll_source_slot_count,
          count(*) over (
            partition by r.session_date,r.weekday,r.regular_teacher_member_id
          )
        ) as regular_active_slot_count
      from regular_slots r
      left join private.olli_teacher_payroll_settings rs
        on rs.academy_id=p_academy_id
       and rs.teacher_member_id=r.regular_teacher_member_id
      left join lateral (
        select o.payroll_source_weekday_hours,o.payroll_source_slot_count
        from public.olli_schedule_teacher_overrides o
        where o.academy_id=p_academy_id
          and o.session_date=r.session_date
          and coalesce(o.payroll_source_teacher_member_id,o.regular_teacher_member_id)=r.regular_teacher_member_id
          and o.payroll_source_weekday_hours is not null
          and o.payroll_source_slot_count is not null
        order by o.payroll_snapshot_at desc nulls last,o.updated_at desc,o.id
        limit 1
      ) day_snapshot on true
    ),
    assigned_slots as (
      select
        r.*,
        case
          when r.regular_teacher_member_id is null or r.regular_active_slot_count<=0
            then 0::numeric
          else r.regular_day_hours/r.regular_active_slot_count
        end as regular_slot_hours,
        o.id as override_id,
        coalesce(o.teacher_member_id,override_member.teacher_member_id) as substitute_teacher_member_id,
        o.payroll_hours as snapshot_payroll_hours
      from regular_slot_shares r
      left join public.olli_schedule_teacher_overrides o
        on o.academy_id=p_academy_id
       and o.session_date=r.session_date
       and o.division=r.division
       and o.time_slot=r.time_slot
       and coalesce(nullif(upper(trim(o.class_group)),''),'A')=r.class_group
      left join lateral (
        select (array_agg(m.id order by m.created_at,m.id))[1] as teacher_member_id
        from public.academy_members m
        where m.academy_id=p_academy_id
          and m.status='active'
          and m.role in ('owner','manager','teacher')
          and o.id is not null
          and o.teacher_member_id is null
          and nullif(trim(o.teacher_name),'') is not null
          and trim(m.display_name)=trim(o.teacher_name)
        having count(*)=1
      ) override_member on true
    ),
    regular_by_day as (
      select
        a.session_date,
        a.weekday,
        bool_or(a.is_holiday) as is_holiday,
        count(*)::integer as slot_count,
        count(*) filter (
          where a.override_id is not null
            and a.substitute_teacher_member_id is not null
            and a.substitute_teacher_member_id is distinct from a.regular_teacher_member_id
        )::integer as replaced_slot_count,
        coalesce(sum(
          case
            when a.is_holiday then 0
            when a.override_id is null
              or a.substitute_teacher_member_id is null
              or a.substitute_teacher_member_id=a.regular_teacher_member_id
            then a.regular_slot_hours
            else 0
          end
        ),0)::numeric(10,2) as worked_hours
      from assigned_slots a
      where a.regular_teacher_member_id=p_teacher_member_id
      group by a.session_date,a.weekday
    ),
    substitute_by_day as (
      select
        a.session_date,
        a.weekday,
        coalesce(sum(coalesce(a.snapshot_payroll_hours,a.regular_slot_hours)),0)::numeric(10,2) as worked_hours
      from assigned_slots a
      where a.is_holiday=false
        and a.override_id is not null
        and a.substitute_teacher_member_id=p_teacher_member_id
        and a.substitute_teacher_member_id is distinct from a.regular_teacher_member_id
      group by a.session_date,a.weekday
    )
    select
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'date',r.session_date,
          'weekday',r.weekday,
          'status',case
            when r.is_holiday then 'holiday'
            when r.slot_count>0 and r.replaced_slot_count=r.slot_count then 'absent'
            else 'normal'
          end,
          'hours',round(r.worked_hours,2)
        ) order by r.session_date)
        from regular_by_day r
      ),'[]'::jsonb),
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'date',s.session_date,
          'weekday',s.weekday,
          'status','substitute',
          'hours',round(s.worked_hours,2)
        ) order by s.session_date)
        from substitute_by_day s
      ),'[]'::jsonb)
    into v_regular_days,v_substitute_days;
  end if;

  return jsonb_build_object(
    'teacher_member_id',p_teacher_member_id,
    'teacher_name',coalesce(nullif(trim(v_teacher_name),''),'선생님'),
    'payroll_month',to_char(date_trunc('month',coalesce(p_month,current_date)),'YYYY-MM'),
    'pay_date',v_calc->>'pay_date',
    'period_start',v_calc->>'period_start',
    'period_end',v_calc->>'period_end',
    'pay_type',coalesce(v_calc->>'pay_type','hourly'),
    'hourly_wage',coalesce((v_calc->>'hourly_wage')::bigint,0),
    'monthly_salary',coalesce((v_calc->>'monthly_salary')::bigint,0),
    'total_hours',coalesce((v_calc->>'total_hours')::numeric,0),
    'regular_hours',coalesce((v_calc->>'regular_hours')::numeric,0),
    'substitute_hours',coalesce((v_calc->>'substitute_hours')::numeric,0),
    'deduction_mode',coalesce(v_calc->>'deduction_mode','none'),
    'gross_amount',coalesce((v_calc->>'gross_amount')::bigint,0),
    'deduction_amount',coalesce((v_calc->>'deduction_amount')::bigint,0),
    'net_amount',coalesce((v_calc->>'net_amount')::bigint,0),
    'regular_days',v_regular_days,
    'substitute_days',v_substitute_days
  );
end;
$function$;

revoke all on function private.olli_teacher_payroll_statement_payload(uuid,uuid,date)
  from public,anon,authenticated;

create or replace function private.olli_teacher_payroll_notification_refresh(
  p_academy_id uuid,
  p_teacher_member_id uuid,
  p_month date
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_month date := date_trunc('month',coalesce(p_month,current_date))::date;
  v_calc jsonb;
  v_statement jsonb;
  v_id uuid;
begin
  v_calc := private.olli_teacher_payroll_calculate_payout(
    p_academy_id,p_teacher_member_id,v_month
  );
  v_statement := private.olli_teacher_payroll_statement_payload(
    p_academy_id,p_teacher_member_id,v_month
  );

  insert into private.olli_teacher_payroll_notifications(
    academy_id,teacher_member_id,payroll_month,pay_date,
    amount,workday_count,total_hours,breakdown,
    gross_amount,deduction_mode,deduction_amount,net_amount,statement_snapshot
  ) values (
    p_academy_id,
    p_teacher_member_id,
    v_month,
    (v_calc->>'pay_date')::date,
    coalesce((v_calc->>'net_amount')::bigint,0),
    coalesce((v_calc->>'workday_count')::integer,0),
    coalesce((v_calc->>'total_hours')::numeric,0),
    coalesce(v_calc->'breakdown','[]'::jsonb),
    coalesce((v_calc->>'gross_amount')::bigint,0),
    coalesce(v_calc->>'deduction_mode','none'),
    coalesce((v_calc->>'deduction_amount')::bigint,0),
    coalesce((v_calc->>'net_amount')::bigint,0),
    coalesce(v_statement,'{}'::jsonb)
  )
  on conflict (academy_id,teacher_member_id,payroll_month)
  do update set
    pay_date=excluded.pay_date,
    amount=excluded.amount,
    workday_count=excluded.workday_count,
    total_hours=excluded.total_hours,
    breakdown=excluded.breakdown,
    gross_amount=excluded.gross_amount,
    deduction_mode=excluded.deduction_mode,
    deduction_amount=excluded.deduction_amount,
    net_amount=excluded.net_amount,
    statement_snapshot=excluded.statement_snapshot
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function private.olli_teacher_payroll_notification_refresh(uuid,uuid,date)
  from public,anon,authenticated;

create or replace function private.olli_teacher_payroll_sync_due(
  p_today date,
  p_academy_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_today date := coalesce(p_today,timezone('Asia/Seoul',now())::date);
  v_month date := date_trunc('month',coalesce(p_today,timezone('Asia/Seoul',now())::date))::date;
  v_prev_month date := (date_trunc('month',coalesce(p_today,timezone('Asia/Seoul',now())::date)) - interval '1 month')::date;
  v_month_end date := (date_trunc('month',coalesce(p_today,timezone('Asia/Seoul',now())::date)) + interval '1 month - 1 day')::date;
  v_row record;
  v_period record;
  v_pay_date date;
  v_candidate_month date;
  v_candidate_end date;
  v_candidate_pay_date date;
  v_refreshed integer := 0;
begin
  for v_row in
    select s.academy_id,s.teacher_member_id,s.payday
    from private.olli_teacher_payroll_settings s
    join public.academy_members m
      on m.id=s.teacher_member_id and m.academy_id=s.academy_id
    join public.academies a on a.id=s.academy_id
    where s.is_enabled=true
      and (p_academy_id is null or s.academy_id=p_academy_id)
      and m.status='active'
      and m.role in ('owner','manager','teacher')
      and a.status='active'
      and a.deleted_at is null
  loop
    for v_candidate_month in
      select v_month
      union all
      select v_prev_month
    loop
      v_candidate_end := (
        date_trunc('month',v_candidate_month) + interval '1 month - 1 day'
      )::date;
      v_candidate_pay_date := (
        v_candidate_month
        + (
          least(v_row.payday,extract(day from v_candidate_end)::integer)-1
        ) * interval '1 day'
      )::date;

      if v_candidate_pay_date<v_today
         and not exists (
           select 1
           from private.olli_teacher_payroll_periods p
           where p.academy_id=v_row.academy_id
             and p.teacher_member_id=v_row.teacher_member_id
             and p.payroll_month=v_candidate_month
         ) then
        perform private.olli_teacher_payroll_period_capture(
          v_row.academy_id,v_row.teacher_member_id,v_candidate_month
        );
      end if;
    end loop;

    v_pay_date := (
      v_month
      + (
        least(v_row.payday,extract(day from v_month_end)::integer)-1
      ) * interval '1 day'
    )::date;

    if v_pay_date=v_today then
      perform private.olli_teacher_payroll_period_capture(
        v_row.academy_id,v_row.teacher_member_id,v_month
      );
      perform private.olli_teacher_payroll_notification_refresh(
        v_row.academy_id,v_row.teacher_member_id,v_month
      );
      v_refreshed := v_refreshed + 1;
    end if;
  end loop;

  -- 지급일 다음 날 첫 동기화 때 한 번 더 최신 계산을 저장한 뒤 고정합니다.
  -- 따라서 지급일 당일 늦게 수정한 대체근무도 최종 급여에 반영됩니다.
  for v_period in
    select p.academy_id,p.teacher_member_id,p.payroll_month
    from private.olli_teacher_payroll_periods p
    where p.finalized_at is null
      and p.pay_date<v_today
      and (p_academy_id is null or p.academy_id=p_academy_id)
    order by p.pay_date,p.teacher_member_id
  loop
    perform private.olli_teacher_payroll_period_capture(
      v_period.academy_id,v_period.teacher_member_id,v_period.payroll_month
    );
    perform private.olli_teacher_payroll_notification_refresh(
      v_period.academy_id,v_period.teacher_member_id,v_period.payroll_month
    );

    update private.olli_teacher_payroll_periods p
    set finalized_at=coalesce(p.finalized_at,now()),
        updated_at=now()
    where p.academy_id=v_period.academy_id
      and p.teacher_member_id=v_period.teacher_member_id
      and p.payroll_month=v_period.payroll_month
      and p.finalized_at is null;
  end loop;

  return v_refreshed;
end;
$function$;

revoke all on function private.olli_teacher_payroll_sync_due(date,uuid)
  from public,anon,authenticated;

create or replace function private.olli_teacher_payroll_send_due_statements(
  p_now timestamptz default now(),
  p_academy_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_today date := timezone('Asia/Seoul',coalesce(p_now,now()))::date;
  v_month date := date_trunc('month',timezone('Asia/Seoul',coalesce(p_now,now()))::date)::date;
  v_month_end date := (date_trunc('month',timezone('Asia/Seoul',coalesce(p_now,now()))::date) + interval '1 month - 1 day')::date;
  v_row record;
  v_notification private.olli_teacher_payroll_notifications%rowtype;
  v_pay_date date;
  v_message_id bigint;
  v_teacher_label text;
  v_sent integer := 0;
begin
  perform private.olli_teacher_payroll_sync_due(v_today,p_academy_id);

  for v_row in
    select s.academy_id,s.teacher_member_id,s.payday,m.display_name,m.account_id
    from private.olli_teacher_payroll_settings s
    join public.academy_members m
      on m.id=s.teacher_member_id and m.academy_id=s.academy_id
    join public.academies a on a.id=s.academy_id
    where s.is_enabled=true
      and (p_academy_id is null or s.academy_id=p_academy_id)
      and m.status='active'
      and m.account_id is not null
      and m.role in ('owner','manager','teacher')
      and a.status='active'
      and a.deleted_at is null
  loop
    v_pay_date := (
      v_month
      + (
        least(v_row.payday,extract(day from v_month_end)::integer)-1
      ) * interval '1 day'
    )::date;

    if v_pay_date<>v_today then continue; end if;

    perform private.olli_teacher_payroll_notification_refresh(
      v_row.academy_id,v_row.teacher_member_id,v_month
    );

    select * into v_notification
    from private.olli_teacher_payroll_notifications n
    where n.academy_id=v_row.academy_id
      and n.teacher_member_id=v_row.teacher_member_id
      and n.payroll_month=v_month
    limit 1;

    if v_notification.id is null or v_notification.message_id is not null then
      continue;
    end if;

    v_teacher_label := case
      when trim(coalesce(v_row.display_name,'')) ~ '선생님$'
        then trim(v_row.display_name)
      else trim(coalesce(v_row.display_name,'선생님')) || ' 선생님'
    end;

    insert into public.olli_team_chat_messages(
      academy_id,sender_member_id,sender_name_snapshot,
      message_type,body,client_message_id,audience
    ) values (
      v_row.academy_id,
      null,
      '올리',
      'ai',
      format(
        '%s월 %s일 급여 지급 안내%s오늘 지급 예정인 급여 내역을 확인해 주세요.%s%s에게만 표시되는 개인 안내입니다.',
        extract(month from v_pay_date)::integer,
        extract(day from v_pay_date)::integer,
        E'\n',
        E'\n',
        v_teacher_label
      ),
      v_notification.id,
      'management'
    )
    returning id into v_message_id;

    update private.olli_teacher_payroll_notifications
    set message_id=v_message_id,
        statement_message_version=1
    where id=v_notification.id;

    insert into public.olli_team_chat_mentions(
      academy_id,message_id,member_id
    ) values (
      v_row.academy_id,v_message_id,v_row.teacher_member_id
    )
    on conflict (message_id,member_id) do nothing;

    perform private.olli_realtime_send_signal(
      v_row.academy_id,'chat',v_message_id
    );

    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$function$;

revoke all on function private.olli_teacher_payroll_send_due_statements(timestamptz,uuid)
  from public,anon,authenticated;

create or replace function public.olli_teacher_payroll_setting_upsert_v3(
  p_session_token text,
  p_academy_id uuid,
  p_teacher_member_id uuid,
  p_monthly_salary bigint,
  p_hourly_wage bigint,
  p_payday integer,
  p_weekday_hours jsonb,
  p_deduction_mode text,
  p_month date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_base jsonb;
  v_mode text := lower(trim(coalesce(p_deduction_mode,'none')));
  v_calc jsonb;
  v_month date := date_trunc('month',coalesce(p_month,current_date))::date;
begin
  if v_mode not in ('none','freelancer_33') then
    raise exception '급여 공제 방식을 확인해 주세요.';
  end if;

  v_base := public.olli_teacher_payroll_setting_upsert_v2(
    p_session_token,
    p_academy_id,
    p_teacher_member_id,
    p_monthly_salary,
    p_hourly_wage,
    p_payday,
    p_weekday_hours,
    v_month
  );

  update private.olli_teacher_payroll_settings
  set deduction_mode=v_mode,
      updated_at=now()
  where academy_id=p_academy_id
    and teacher_member_id=p_teacher_member_id;

  v_calc := private.olli_teacher_payroll_calculate_payout(
    p_academy_id,p_teacher_member_id,v_month
  );

  update private.olli_teacher_payroll_notifications
  set amount=coalesce((v_calc->>'net_amount')::bigint,0),
      gross_amount=coalesce((v_calc->>'gross_amount')::bigint,0),
      deduction_mode=v_mode,
      deduction_amount=coalesce((v_calc->>'deduction_amount')::bigint,0),
      net_amount=coalesce((v_calc->>'net_amount')::bigint,0),
      workday_count=coalesce((v_calc->>'workday_count')::integer,0),
      total_hours=coalesce((v_calc->>'total_hours')::numeric,0),
      breakdown=coalesce(v_calc->'breakdown','[]'::jsonb),
      statement_snapshot=private.olli_teacher_payroll_statement_payload(
        p_academy_id,p_teacher_member_id,v_month
      )
  where academy_id=p_academy_id
    and teacher_member_id=p_teacher_member_id
    and payroll_month=v_month;

  if exists (
    select 1
    from private.olli_teacher_payroll_periods p
    where p.academy_id=p_academy_id
      and p.teacher_member_id=p_teacher_member_id
      and p.payroll_month=v_month
      and p.finalized_at is null
  ) then
    perform private.olli_teacher_payroll_period_capture(
      p_academy_id,p_teacher_member_id,v_month
    );
  end if;

  return v_base || jsonb_build_object(
    'deduction_mode',v_mode,
    'payroll',v_calc
  );
end;
$function$;

revoke all on function public.olli_teacher_payroll_setting_upsert_v3(
  text,uuid,uuid,bigint,bigint,integer,jsonb,text,date
) from public;

grant execute on function public.olli_teacher_payroll_setting_upsert_v3(
  text,uuid,uuid,bigint,bigint,integer,jsonb,text,date
) to anon,authenticated;

create or replace function public.olli_teacher_payroll_statement_get(
  p_session_token text,
  p_academy_id uuid,
  p_notification_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_notice private.olli_teacher_payroll_notifications%rowtype;
  v_payload jsonb;
  v_period_finalized_at timestamptz;
  v_today date := timezone('Asia/Seoul',now())::date;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;

  select m.* into v_member
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id
    and m.account_id=v_account_id
    and m.status='active'
    and a.status='active'
    and a.deleted_at is null
  order by case m.role when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end,m.created_at
  limit 1;

  if v_member.id is null then
    raise exception '현재 계정은 이 학원의 팀챗을 사용할 수 없습니다.';
  end if;

  select * into v_notice
  from private.olli_teacher_payroll_notifications n
  where n.id=p_notification_id
    and n.academy_id=p_academy_id
    and n.teacher_member_id=v_member.id
  limit 1;

  if v_notice.id is null then
    raise exception '본인에게 발급된 급여명세서만 확인할 수 있습니다.';
  end if;

  select p.finalized_at
    into v_period_finalized_at
  from private.olli_teacher_payroll_periods p
  where p.academy_id=v_notice.academy_id
    and p.teacher_member_id=v_notice.teacher_member_id
    and p.payroll_month=v_notice.payroll_month
  limit 1;

  if v_period_finalized_at is not null
     and v_notice.statement_snapshot is not null
     and v_notice.statement_snapshot<>'{}'::jsonb then
    v_payload := v_notice.statement_snapshot;
  else
    v_payload := private.olli_teacher_payroll_statement_payload(
      v_notice.academy_id,
      v_notice.teacher_member_id,
      v_notice.payroll_month
    );
  end if;

  return jsonb_build_object(
    'ok',true,
    'notification_id',v_notice.id,
    'is_finalized',v_period_finalized_at is not null,
    'statement',coalesce(v_payload,'{}'::jsonb)
  );
end;
$function$;

revoke all on function public.olli_teacher_payroll_statement_get(text,uuid,uuid)
  from public;
grant execute on function public.olli_teacher_payroll_statement_get(text,uuid,uuid)
  to anon,authenticated;

create or replace function public.olli_teacher_payroll_due_sync(
  p_session_token text,
  p_academy_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_account_id uuid;
  v_owner_id uuid;
  v_refreshed integer := 0;
  v_sent integer := 0;
  v_now timestamptz := now();
  v_hour integer := extract(hour from timezone('Asia/Seoul',now()))::integer;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;

  select m.id into v_owner_id
  from public.academy_members m
  where m.academy_id=p_academy_id
    and m.account_id=v_account_id
    and m.status='active'
    and m.role='owner'
  order by m.created_at
  limit 1;

  if v_owner_id is null then
    raise exception '급여일 동기화는 원장만 실행할 수 있습니다.';
  end if;

  v_refreshed := private.olli_teacher_payroll_sync_due(
    timezone('Asia/Seoul',v_now)::date,p_academy_id
  );

  if v_hour>=10 then
    v_sent := private.olli_teacher_payroll_send_due_statements(
      v_now,p_academy_id
    );
  end if;

  return jsonb_build_object(
    'ok',true,
    'refreshed',v_refreshed,
    'sent',v_sent
  );
end;
$function$;

revoke all on function public.olli_teacher_payroll_due_sync(text,uuid) from public;
grant execute on function public.olli_teacher_payroll_due_sync(text,uuid)
  to anon,authenticated;

create or replace function private.olli_team_chat_message_visible_to_member(
  p_academy_id uuid,
  p_message_id bigint,
  p_audience text,
  p_member_id uuid,
  p_member_role text
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select case
    when exists (
      select 1
      from private.olli_teacher_payroll_notifications n
      where n.academy_id=p_academy_id
        and n.message_id=p_message_id
    ) then exists (
      select 1
      from private.olli_teacher_payroll_notifications n
      where n.academy_id=p_academy_id
        and n.message_id=p_message_id
        and (
          (
            n.statement_message_version>=1
            and n.teacher_member_id=p_member_id
          )
          or (
            n.statement_message_version=0
            and p_member_role='owner'
          )
        )
    )
    when p_audience='all' then true
    when p_audience='management' and p_member_role in ('owner','manager') then true
    else false
  end;
$function$;

revoke all on function private.olli_team_chat_message_visible_to_member(
  uuid,bigint,text,uuid,text
) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.olli_team_chat_list(p_session_token text, p_academy_id uuid, p_before_message_id bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_limit integer := greatest(1,least(coalesce(p_limit,50),100));
  v_messages jsonb;
  v_deleted_message_ids jsonb;
  v_last_read_material_event_id bigint := 0;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;
  if p_academy_id is null then raise exception '학원 ID가 없습니다.'; end if;

  select m.* into v_member
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id
    and m.account_id=v_account_id
    and m.status='active'
    and a.status='active'
    and a.deleted_at is null
  order by case m.role when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end,m.created_at
  limit 1;

  if v_member.id is null then raise exception '현재 계정은 이 학원의 팀톡을 사용할 수 없습니다.'; end if;

  select coalesce(st.last_read_material_event_id,0)
  into v_last_read_material_event_id
  from public.olli_team_chat_member_state st
  where st.academy_id=p_academy_id and st.member_id=v_member.id;
  v_last_read_material_event_id := coalesce(v_last_read_material_event_id,0);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,
    'academy_id',x.academy_id,
    'sender_member_id',x.sender_member_id,
    'sender_name',x.sender_name_snapshot,
    'message_type',x.message_type,
    'body',x.body,
    'reply_to_message_id',x.reply_to_message_id,
    'client_message_id',x.client_message_id,
    'created_at',x.created_at,
    'material_request_id',x.material_request_id,
    'material_event_id',x.material_event_id,
    'material_confirmed',case
      when x.material_event_id is null then null
      else x.material_event_id <= v_last_read_material_event_id
    end,
    'attachment',(
      select jsonb_build_object(
        'id',a.id,'kind',a.kind,'file_name',a.file_name,'mime_type',a.mime_type,'file_size',a.file_size,
        'thumbnail_storage_path',a.thumbnail_storage_path,
        'thumbnail_mime_type',a.thumbnail_mime_type,
        'thumbnail_size',a.thumbnail_size,
        'image_width',a.image_width,
        'image_height',a.image_height
      )
      from public.olli_team_chat_attachments a
      where a.academy_id=x.academy_id and a.message_id=x.id
      limit 1
    ),
    'action',(
      select jsonb_build_object(
        'id',ac.id,'action_type',ac.action_type,'status',ac.status,'revision',ac.revision,
        'created_at',ac.created_at,'updated_at',ac.updated_at,'resolved_at',ac.resolved_at,
        'error',ac.error_text,'result_message_id',ac.result_message_id,
        'display_label',private.olli_team_chat_action_display_label(
          ac.action_type,ac.status,ac.action_payload
        )
      )
      from public.olli_team_chat_actions ac
      where ac.academy_id=x.academy_id and ac.message_id=x.id
      limit 1
    ),
    'unread_count',
      case
        when x.audience='management' then 0
        when exists (
          select 1 from public.olli_team_chat_mentions mt
          where mt.academy_id=x.academy_id and mt.message_id=x.id
        )
        then (
          select count(*)::integer
          from public.olli_team_chat_mentions mt
          where mt.academy_id=x.academy_id and mt.message_id=x.id and mt.read_at is null
        )
        else (
          select count(*)::integer
          from public.academy_members am
          left join public.olli_team_chat_member_state st
            on st.academy_id=am.academy_id and st.member_id=am.id
          where am.academy_id=x.academy_id
            and am.status='active'
            and am.account_id is not null
            and (x.sender_member_id is null or am.id<>x.sender_member_id)
            and coalesce(st.last_read_message_id,0)<x.id
        )
      end
  ) order by x.id asc),'[]'::jsonb)
  into v_messages
  from (
    select msg.*
    from public.olli_team_chat_messages msg
    where msg.academy_id=p_academy_id
      and msg.deleted_at is null
      and (p_before_message_id is null or msg.id<p_before_message_id)
      and (
        private.olli_team_chat_message_visible_to_member(
          msg.academy_id,msg.id,msg.audience,v_member.id,v_member.role
        )
      )
    order by msg.id desc
    limit v_limit
  ) x;

  select coalesce(jsonb_agg(d.id order by d.id asc),'[]'::jsonb)
  into v_deleted_message_ids
  from (
    select msg.id
    from public.olli_team_chat_messages msg
    where msg.academy_id=p_academy_id
      and msg.deleted_at is not null
      and (
        private.olli_team_chat_message_visible_to_member(
          msg.academy_id,msg.id,msg.audience,v_member.id,v_member.role
        )
      )
    order by msg.id desc
    limit 2000
  ) d;

  return jsonb_build_object(
    'ok',true,
    'academy_id',p_academy_id,
    'current_member_id',v_member.id,
    'current_member_name',v_member.display_name,
    'current_role',v_member.role,
    'deleted_message_ids',v_deleted_message_ids,
    'messages',v_messages
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.olli_team_chat_archive(p_session_token text, p_academy_id uuid, p_limit integer DEFAULT 1000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_limit integer := greatest(1,least(coalesce(p_limit,1000),2000));
  v_messages jsonb;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;

  select m.* into v_member
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id
    and m.account_id=v_account_id
    and m.status='active'
    and a.status='active'
    and a.deleted_at is null
  order by case m.role when 'owner' then 1 when 'manager' then 2 else 3 end,m.created_at
  limit 1;

  if v_member.id is null then raise exception '현재 계정은 이 학원의 팀톡을 사용할 수 없습니다.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'sender_member_id',x.sender_member_id,'sender_name',x.sender_name_snapshot,
    'message_type',x.message_type,'body',x.body,'client_message_id',x.client_message_id,'created_at',x.created_at,
    'attachment',(
      select jsonb_build_object(
        'id',a.id,'kind',a.kind,'file_name',a.file_name,'mime_type',a.mime_type,
        'file_size',a.file_size,'created_at',a.created_at,
        'thumbnail_storage_path',a.thumbnail_storage_path,
        'thumbnail_mime_type',a.thumbnail_mime_type,'thumbnail_size',a.thumbnail_size,
        'image_width',a.image_width,'image_height',a.image_height
      )
      from public.olli_team_chat_attachments a
      where a.academy_id=x.academy_id and a.message_id=x.id limit 1
    )
  ) order by x.id desc),'[]'::jsonb)
  into v_messages
  from (
    select msg.*
    from public.olli_team_chat_messages msg
    where msg.academy_id=p_academy_id
      and msg.deleted_at is null
      and (
        private.olli_team_chat_message_visible_to_member(
          msg.academy_id,msg.id,msg.audience,v_member.id,v_member.role
        )
      )
    order by msg.id desc
    limit v_limit
  ) x;

  return jsonb_build_object(
    'ok',true,
    'academy_id',p_academy_id,
    'current_member_id',v_member.id,
    'messages',v_messages
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.olli_mobile_work_notification_summary(p_session_token text, p_academy_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_chat_unread integer := 0;
  v_latest_message_id bigint;
  v_latest_sender text;
  v_latest_body text;
  v_material_unread integer := 0;
  v_latest_material_event_id bigint;
  v_latest_material_item text;
  v_latest_material_requester text;
  v_last_read_message_id bigint := 0;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;

  select m.*
    into v_member
  from public.academy_members m
  join public.academies a on a.id = m.academy_id
  where m.academy_id = p_academy_id
    and m.account_id = v_account_id
    and m.status = 'active'
    and a.status = 'active'
    and a.deleted_at is null
  order by
    case m.role when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end,
    m.created_at
  limit 1;

  if v_member.id is null then
    raise exception '현재 계정은 이 학원의 Work 알림을 사용할 수 없습니다.';
  end if;

  select coalesce(s.last_read_message_id, 0)
    into v_last_read_message_id
  from public.olli_team_chat_member_state s
  where s.academy_id = p_academy_id
    and s.member_id = v_member.id;

  v_last_read_message_id := coalesce(v_last_read_message_id, 0);

  select count(*)::integer, max(msg.id)
    into v_chat_unread, v_latest_message_id
  from public.olli_team_chat_messages msg
  where msg.academy_id = p_academy_id
    and msg.deleted_at is null
    and msg.id > v_last_read_message_id
    and msg.sender_member_id is distinct from v_member.id
    and msg.material_event_id is null
    and (
      private.olli_team_chat_message_visible_to_member(
        msg.academy_id,msg.id,msg.audience,v_member.id,v_member.role
      )
    )
    and (
      (
        exists(
          select 1
          from public.olli_team_chat_mentions any_mt
          where any_mt.academy_id = msg.academy_id
            and any_mt.message_id = msg.id
        )
        and exists(
          select 1
          from public.olli_team_chat_mentions mine
          where mine.academy_id = msg.academy_id
            and mine.message_id = msg.id
            and mine.member_id = v_member.id
            and mine.read_at is null
        )
      )
      or not exists(
        select 1
        from public.olli_team_chat_mentions any_mt
        where any_mt.academy_id = msg.academy_id
          and any_mt.message_id = msg.id
      )
    );

  if v_latest_message_id is not null then
    select msg.sender_name_snapshot, msg.body
      into v_latest_sender, v_latest_body
    from public.olli_team_chat_messages msg
    where msg.academy_id = p_academy_id
      and msg.id = v_latest_message_id
    limit 1;
  end if;

  if v_member.role in ('owner','manager') then
    select count(*)::integer
      into v_material_unread
    from public.olli_team_material_requests r
    where r.academy_id = p_academy_id
      and r.deleted_at is null
      and r.status in ('requested','on_hold');

    select max(e.id)
      into v_latest_material_event_id
    from public.olli_team_material_request_events e
    join public.olli_team_material_requests r
      on r.id = e.request_id
     and r.academy_id = e.academy_id
    where e.academy_id = p_academy_id
      and e.event_type = 'created'
      and r.deleted_at is null
      and r.status in ('requested','on_hold');

    if v_latest_material_event_id is not null then
      select r.item_name, r.requested_by_name_snapshot
        into v_latest_material_item, v_latest_material_requester
      from public.olli_team_material_request_events e
      join public.olli_team_material_requests r
        on r.id = e.request_id
       and r.academy_id = e.academy_id
      where e.academy_id = p_academy_id
        and e.id = v_latest_material_event_id
      limit 1;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'member_id', v_member.id,
    'current_role', v_member.role,
    'chat_unread_count', coalesce(v_chat_unread, 0),
    'mention_unread_count', coalesce(v_chat_unread, 0),
    'material_unread_count', coalesce(v_material_unread, 0),
    'unread_count', coalesce(v_chat_unread, 0) + coalesce(v_material_unread, 0),
    'latest_message_id', v_latest_message_id,
    'latest_sender_name', v_latest_sender,
    'latest_body', v_latest_body,
    'latest_material_event_id', v_latest_material_event_id,
    'latest_material_item', v_latest_material_item,
    'latest_material_requester', v_latest_material_requester
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.olli_team_chat_push_targets(p_session_token text, p_academy_id uuid, p_message_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_sender_member_id uuid;
  v_sender_name text;
  v_body text;
  v_has_mentions boolean := false;
  v_targets jsonb;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;

  select m.id
    into v_sender_member_id
  from public.academy_members m
  where m.academy_id = p_academy_id
    and m.account_id = v_account_id
    and m.status = 'active'
  order by m.created_at
  limit 1;

  if v_sender_member_id is null then
    raise exception '현재 계정은 이 학원의 올리톡을 사용할 수 없습니다.';
  end if;

  select msg.sender_name_snapshot, msg.body
    into v_sender_name, v_body
  from public.olli_team_chat_messages msg
  where msg.academy_id = p_academy_id
    and msg.id = p_message_id
    and msg.sender_member_id = v_sender_member_id
    and msg.deleted_at is null
  limit 1;

  if v_body is null then
    raise exception '현재 계정이 보낸 메시지만 푸시 알림을 전송할 수 있습니다.';
  end if;

  select exists(
    select 1
    from public.olli_team_chat_mentions mt
    where mt.academy_id = p_academy_id
      and mt.message_id = p_message_id
  )
    into v_has_mentions;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'subscription_id', s.id,
        'member_id', target.id,
        'endpoint', s.endpoint,
        'p256dh', s.p256dh,
        'auth', s.auth,
        'unread_count',
          (
            select count(*)::integer
            from public.olli_team_chat_messages um
            left join public.olli_team_chat_member_state st
              on st.academy_id = p_academy_id
             and st.member_id = target.id
            where um.academy_id = p_academy_id
              and um.deleted_at is null
              and um.id > coalesce(st.last_read_message_id, 0)
              and um.sender_member_id is distinct from target.id
              and um.material_event_id is null
              and (
                private.olli_team_chat_message_visible_to_member(
                  um.academy_id,um.id,um.audience,target.id,target.role
                )
              )
              and (
                (
                  exists(
                    select 1
                    from public.olli_team_chat_mentions mm
                    where mm.academy_id = um.academy_id
                      and mm.message_id = um.id
                  )
                  and exists(
                    select 1
                    from public.olli_team_chat_mentions mine
                    where mine.academy_id = um.academy_id
                      and mine.message_id = um.id
                      and mine.member_id = target.id
                      and mine.read_at is null
                  )
                )
                or not exists(
                  select 1
                  from public.olli_team_chat_mentions mm
                  where mm.academy_id = um.academy_id
                    and mm.message_id = um.id
                )
              )
          )
          +
          case when target.role in ('owner','manager') then (
            select count(*)::integer
            from public.olli_team_material_requests mr
            where mr.academy_id = p_academy_id
              and mr.deleted_at is null
              and mr.status in ('requested','on_hold')
          ) else 0 end
      )
      order by target.id, s.id
    ),
    '[]'::jsonb
  )
    into v_targets
  from public.academy_members target
  join public.olli_team_chat_push_subscriptions s
    on s.academy_id = target.academy_id
   and s.member_id = target.id
   and s.disabled_at is null
  where target.academy_id = p_academy_id
    and target.status = 'active'
    and target.id <> v_sender_member_id
    and (
      (
        v_has_mentions
        and exists(
          select 1
          from public.olli_team_chat_mentions mt
          where mt.academy_id = p_academy_id
            and mt.message_id = p_message_id
            and mt.member_id = target.id
            and mt.read_at is null
        )
      )
      or not v_has_mentions
    )
    and not exists(
      select 1
      from public.olli_team_chat_push_deliveries d
      where d.message_id = p_message_id
        and d.subscription_id = s.id
    );

  return jsonb_build_object(
    'ok', true,
    'sender_name', v_sender_name,
    'body', v_body,
    'message_id', p_message_id,
    'target_mode', case when v_has_mentions then 'mentions' else 'all' end,
    'targets', v_targets
  );
end;
$function$
;

do $cron_setup$
begin
  if exists(
    select 1 from cron.job
    where jobname='olli-teacher-payroll-statement-10am'
  ) then
    perform cron.unschedule('olli-teacher-payroll-statement-10am');
  end if;

  perform cron.schedule(
    'olli-teacher-payroll-statement-10am',
    '0 1 * * *',
    $job$select private.olli_teacher_payroll_send_due_statements(now(),null);$job$
  );
end;
$cron_setup$;

commit;
