begin;

alter table public.olli_schedule_teacher_overrides
  add column if not exists payroll_hours numeric(10,4),
  add column if not exists payroll_source_weekday_hours numeric(10,4),
  add column if not exists payroll_source_slot_count integer,
  add column if not exists payroll_source_teacher_member_id uuid references public.academy_members(id) on delete set null,
  add column if not exists payroll_snapshot_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='olli_schedule_teacher_overrides_payroll_hours_check'
      and conrelid='public.olli_schedule_teacher_overrides'::regclass
  ) then
    alter table public.olli_schedule_teacher_overrides
      add constraint olli_schedule_teacher_overrides_payroll_hours_check
      check (payroll_hours is null or (payroll_hours >= 0 and payroll_hours <= 24));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname='olli_schedule_teacher_overrides_payroll_source_hours_check'
      and conrelid='public.olli_schedule_teacher_overrides'::regclass
  ) then
    alter table public.olli_schedule_teacher_overrides
      add constraint olli_schedule_teacher_overrides_payroll_source_hours_check
      check (payroll_source_weekday_hours is null or (payroll_source_weekday_hours >= 0 and payroll_source_weekday_hours <= 24));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname='olli_schedule_teacher_overrides_payroll_slot_count_check'
      and conrelid='public.olli_schedule_teacher_overrides'::regclass
  ) then
    alter table public.olli_schedule_teacher_overrides
      add constraint olli_schedule_teacher_overrides_payroll_slot_count_check
      check (payroll_source_slot_count is null or payroll_source_slot_count >= 1);
  end if;
end $$;

create or replace function private.olli_teacher_payroll_override_snapshot(
  p_academy_id uuid,
  p_session_date date,
  p_division text,
  p_time_slot integer,
  p_class_group text,
  p_regular_teacher_member_id uuid,
  p_regular_teacher_name text
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_weekday integer := extract(isodow from p_session_date)::integer;
  v_regular_id uuid := p_regular_teacher_member_id;
  v_match_count integer := 0;
  v_daily_hours numeric(10,4) := 0;
  v_slot_count integer := 0;
  v_payroll_hours numeric(10,4);
begin
  if v_regular_id is null and nullif(btrim(coalesce(p_regular_teacher_name,'')),'') is not null then
    select count(*),(array_agg(m.id order by m.created_at,m.id))[1]
      into v_match_count,v_regular_id
    from public.academy_members m
    where m.academy_id=p_academy_id
      and m.status='active'
      and m.role in ('owner','manager','teacher')
      and btrim(m.display_name)=btrim(p_regular_teacher_name);

    if v_match_count<>1 then
      v_regular_id := null;
    end if;
  end if;

  if v_regular_id is null then
    return jsonb_build_object(
      'ready',false,
      'source_teacher_member_id',null,
      'source_weekday_hours',null,
      'source_slot_count',null,
      'payroll_hours',null,
      'reason','regular_teacher_unresolved'
    );
  end if;

  select greatest(
           0,
           least(
             24,
             coalesce(nullif(s.weekday_hours->>v_weekday::text,'')::numeric,0)
           )
         )::numeric(10,4)
    into v_daily_hours
  from private.olli_teacher_payroll_settings s
  where s.academy_id=p_academy_id
    and s.teacher_member_id=v_regular_id;

  v_daily_hours := coalesce(v_daily_hours,0);

  select count(*)::integer
    into v_slot_count
  from public.olli_schedule_class_teachers ct
  left join lateral (
    select (array_agg(m.id order by m.created_at,m.id))[1] as teacher_member_id
    from public.academy_members m
    where m.academy_id=ct.academy_id
      and m.status='active'
      and m.role in ('owner','manager','teacher')
      and ct.teacher_member_id is null
      and nullif(btrim(ct.teacher_name),'') is not null
      and btrim(m.display_name)=btrim(ct.teacher_name)
    having count(*)=1
  ) class_member on true
  where ct.academy_id=p_academy_id
    and ct.weekday=v_weekday
    and coalesce(ct.teacher_member_id,class_member.teacher_member_id)=v_regular_id
    and private.olli_schedule_slot_is_valid(
      p_academy_id,
      ct.division,
      ct.weekday,
      ct.time_slot
    )
    and (
      coalesce(nullif(upper(btrim(ct.class_group)),''),'A')='A'
      or private.olli_schedule_group_is_enabled(
        p_academy_id,
        ct.division,
        ct.weekday,
        ct.time_slot,
        p_session_date
      )
    );

  if v_daily_hours<=0 then
    return jsonb_build_object(
      'ready',false,
      'source_teacher_member_id',v_regular_id,
      'source_weekday_hours',v_daily_hours,
      'source_slot_count',nullif(v_slot_count,0),
      'payroll_hours',null,
      'reason','weekday_hours_missing'
    );
  end if;

  if v_slot_count<=0 then
    return jsonb_build_object(
      'ready',false,
      'source_teacher_member_id',v_regular_id,
      'source_weekday_hours',v_daily_hours,
      'source_slot_count',null,
      'payroll_hours',null,
      'reason','regular_slot_count_missing'
    );
  end if;

  v_payroll_hours := round(v_daily_hours / v_slot_count,4);

  return jsonb_build_object(
    'ready',true,
    'source_teacher_member_id',v_regular_id,
    'source_weekday_hours',v_daily_hours,
    'source_slot_count',v_slot_count,
    'payroll_hours',v_payroll_hours,
    'reason',null
  );
end;
$function$;

revoke all on function private.olli_teacher_payroll_override_snapshot(uuid,date,text,integer,text,uuid,text)
  from public,anon,authenticated;

-- Backfill existing date-specific substitutions where the source schedule can be resolved.
with snapshots as (
  select
    o.id,
    private.olli_teacher_payroll_override_snapshot(
      o.academy_id,
      o.session_date,
      o.division,
      o.time_slot,
      o.class_group,
      o.regular_teacher_member_id,
      o.regular_teacher_name
    ) as snapshot
  from public.olli_schedule_teacher_overrides o
  where o.payroll_hours is null
)
update public.olli_schedule_teacher_overrides o
set
  regular_teacher_member_id=coalesce(
    o.regular_teacher_member_id,
    nullif(s.snapshot->>'source_teacher_member_id','')::uuid
  ),
  payroll_source_teacher_member_id=nullif(s.snapshot->>'source_teacher_member_id','')::uuid,
  payroll_source_weekday_hours=nullif(s.snapshot->>'source_weekday_hours','')::numeric,
  payroll_source_slot_count=nullif(s.snapshot->>'source_slot_count','')::integer,
  payroll_hours=nullif(s.snapshot->>'payroll_hours','')::numeric,
  payroll_snapshot_at=case
    when coalesce((s.snapshot->>'ready')::boolean,false) then coalesce(o.updated_at,o.created_at,now())
    else null
  end
from snapshots s
where s.id=o.id;

create or replace function public.olli_schedule_set_teacher_override(
  p_session_token text,
  p_academy_id uuid,
  p_session_date date,
  p_division text,
  p_time_slot integer,
  p_class_group text,
  p_teacher_member_id uuid default null,
  p_reason text default 'teacher_absence'
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_division text := lower(trim(coalesce(p_division, '')));
  v_group text := upper(trim(coalesce(nullif(p_class_group, ''), 'A')));
  v_teacher_name text;
  v_regular_teacher_member_id uuid;
  v_regular_teacher_name text := '';
  v_actor_account_id uuid;
  v_snapshot jsonb;
  v_payroll_hours numeric(10,4);
  v_source_weekday_hours numeric(10,4);
  v_source_slot_count integer;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '당일 수업 담당을 변경할 권한이 없습니다.');
  end if;

  if p_session_date is null
     or v_division not in ('elementary','kinder')
     or p_time_slot not between 1 and 12
     or v_group not in ('A','B') then
    return jsonb_build_object('ok', false, 'message', '당일 수업 담당 정보를 확인해 주세요.');
  end if;

  select ct.teacher_member_id, coalesce(ct.teacher_name, '')
    into v_regular_teacher_member_id, v_regular_teacher_name
  from public.olli_schedule_class_teachers ct
  where ct.academy_id = p_academy_id
    and ct.division = v_division
    and ct.weekday = extract(isodow from p_session_date)::integer
    and ct.time_slot = p_time_slot
    and coalesce(nullif(upper(trim(ct.class_group)),''),'A') = v_group
  limit 1;

  v_snapshot := private.olli_teacher_payroll_override_snapshot(
    p_academy_id,
    p_session_date,
    v_division,
    p_time_slot,
    v_group,
    v_regular_teacher_member_id,
    v_regular_teacher_name
  );

  if v_regular_teacher_member_id is null then
    v_regular_teacher_member_id := nullif(v_snapshot->>'source_teacher_member_id','')::uuid;
  end if;

  -- Selecting the regular teacher means the date-specific override is no longer needed.
  if p_teacher_member_id is null
     or (v_regular_teacher_member_id is not null and p_teacher_member_id = v_regular_teacher_member_id) then
    delete from public.olli_schedule_teacher_overrides o
    where o.academy_id = p_academy_id
      and o.session_date = p_session_date
      and o.division = v_division
      and o.time_slot = p_time_slot
      and coalesce(nullif(upper(trim(o.class_group)),''),'A') = v_group;

    return jsonb_build_object(
      'ok', true,
      'removed', true,
      'teacher', private.olli_schedule_resolve_effective_teacher(
        p_academy_id, p_session_date, v_division, p_time_slot, v_group
      )
    );
  end if;

  select trim(m.display_name)
    into v_teacher_name
  from public.academy_members m
  where m.id = p_teacher_member_id
    and m.academy_id = p_academy_id
    and m.status = 'active'
    and m.role in ('owner','manager','teacher')
    and nullif(trim(coalesce(m.display_name, '')), '') is not null;

  if v_teacher_name is null then
    return jsonb_build_object('ok', false, 'message', '선택한 대체 선생님을 찾을 수 없습니다.');
  end if;

  v_payroll_hours := nullif(v_snapshot->>'payroll_hours','')::numeric;
  v_source_weekday_hours := nullif(v_snapshot->>'source_weekday_hours','')::numeric;
  v_source_slot_count := nullif(v_snapshot->>'source_slot_count','')::integer;
  v_actor_account_id := public.olli_account_id_from_session(p_session_token);

  insert into public.olli_schedule_teacher_overrides (
    academy_id, session_date, division, time_slot, class_group,
    regular_teacher_member_id, regular_teacher_name,
    teacher_member_id, teacher_name, reason,
    payroll_hours, payroll_source_weekday_hours, payroll_source_slot_count,
    payroll_source_teacher_member_id, payroll_snapshot_at,
    created_by_account_id, updated_at
  ) values (
    p_academy_id, p_session_date, v_division, p_time_slot, v_group,
    v_regular_teacher_member_id, coalesce(v_regular_teacher_name, ''),
    p_teacher_member_id, v_teacher_name, coalesce(nullif(trim(p_reason), ''), 'teacher_absence'),
    v_payroll_hours, v_source_weekday_hours, v_source_slot_count,
    v_regular_teacher_member_id,
    case when v_payroll_hours is not null then now() else null end,
    v_actor_account_id, now()
  )
  on conflict (academy_id, session_date, division, time_slot, class_group)
  do update set
    regular_teacher_member_id = excluded.regular_teacher_member_id,
    regular_teacher_name = excluded.regular_teacher_name,
    teacher_member_id = excluded.teacher_member_id,
    teacher_name = excluded.teacher_name,
    reason = excluded.reason,
    payroll_hours = excluded.payroll_hours,
    payroll_source_weekday_hours = excluded.payroll_source_weekday_hours,
    payroll_source_slot_count = excluded.payroll_source_slot_count,
    payroll_source_teacher_member_id = excluded.payroll_source_teacher_member_id,
    payroll_snapshot_at = excluded.payroll_snapshot_at,
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'removed', false,
    'teacher', private.olli_schedule_resolve_effective_teacher(
      p_academy_id, p_session_date, v_division, p_time_slot, v_group
    ),
    'payroll_snapshot', jsonb_build_object(
      'ready',coalesce((v_snapshot->>'ready')::boolean,false),
      'hours',v_payroll_hours,
      'source_weekday_hours',v_source_weekday_hours,
      'source_slot_count',v_source_slot_count,
      'reason',v_snapshot->>'reason'
    )
  );
end;
$function$;

revoke all on function public.olli_schedule_set_teacher_override(text,uuid,date,text,integer,text,uuid,text) from public;
grant execute on function public.olli_schedule_set_teacher_override(text,uuid,date,text,integer,text,uuid,text)
  to anon,authenticated;

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
  v_regular_hours numeric(10,2) := 0;
  v_substitute_hours numeric(10,2) := 0;
  v_substitute_slot_count integer := 0;
  v_unresolved_substitute_slot_count integer := 0;
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
  regular_slots as (
    select
      a.session_date,
      a.weekday,
      a.division,
      a.time_slot,
      a.class_group,
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
      select
        o.payroll_source_weekday_hours,
        o.payroll_source_slot_count
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
        when r.regular_teacher_member_id is null or r.regular_active_slot_count<=0 then 0::numeric
        else r.regular_day_hours / r.regular_active_slot_count
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
  teacher_slots as (
    select
      a.session_date,
      a.weekday,
      a.regular_slot_hours as regular_hours,
      0::numeric as substitute_hours,
      0::integer as substitute_slots,
      0::integer as unresolved_substitute_slots
    from assigned_slots a
    where a.regular_teacher_member_id=p_teacher_member_id
      and (
        a.override_id is null
        or a.substitute_teacher_member_id is null
        or a.substitute_teacher_member_id=a.regular_teacher_member_id
      )

    union all

    select
      a.session_date,
      a.weekday,
      0::numeric as regular_hours,
      coalesce(a.snapshot_payroll_hours,a.regular_slot_hours) as substitute_hours,
      1::integer as substitute_slots,
      case
        when a.snapshot_payroll_hours is null and coalesce(a.regular_slot_hours,0)<=0 then 1
        else 0
      end as unresolved_substitute_slots
    from assigned_slots a
    where a.override_id is not null
      and a.substitute_teacher_member_id=p_teacher_member_id
      and a.substitute_teacher_member_id is distinct from a.regular_teacher_member_id
  ),
  teacher_days as (
    select
      t.session_date,
      t.weekday,
      sum(t.regular_hours) as regular_hours,
      sum(t.substitute_hours) as substitute_hours,
      sum(t.substitute_slots)::integer as substitute_slots,
      sum(t.unresolved_substitute_slots)::integer as unresolved_substitute_slots
    from teacher_slots t
    group by t.session_date,t.weekday
  ),
  counts as (
    select
      g.weekday,
      count(td.session_date)::integer as workdays,
      coalesce(sum(td.regular_hours),0)::numeric as regular_hours,
      coalesce(sum(td.substitute_hours),0)::numeric as substitute_hours,
      coalesce(sum(td.substitute_slots),0)::integer as substitute_slots,
      coalesce(sum(td.unresolved_substitute_slots),0)::integer as unresolved_substitute_slots
    from generate_series(1,6) as g(weekday)
    left join teacher_days td on td.weekday=g.weekday
    group by g.weekday
    order by g.weekday
  ),
  totals as (
    select
      coalesce(sum(c.workdays),0)::integer as workday_count,
      coalesce(sum(c.regular_hours+c.substitute_hours),0)::numeric(10,2) as total_hours,
      coalesce(sum(c.regular_hours),0)::numeric(10,2) as regular_hours,
      coalesce(sum(c.substitute_hours),0)::numeric(10,2) as substitute_hours,
      coalesce(sum(c.substitute_slots),0)::integer as substitute_slot_count,
      coalesce(sum(c.unresolved_substitute_slots),0)::integer as unresolved_substitute_slot_count
    from counts c
  )
  select
    coalesce(jsonb_object_agg(c.weekday::text,c.workdays order by c.weekday),'{}'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'weekday',c.weekday,
      'workdays',c.workdays,
      'hours_per_day',greatest(0,least(24,coalesce(nullif(v_weekday_hours->>c.weekday::text,'')::numeric,0))),
      'regular_hours',round(c.regular_hours,2),
      'substitute_hours',round(c.substitute_hours,2),
      'substitute_slots',c.substitute_slots,
      'unresolved_substitute_slots',c.unresolved_substitute_slots,
      'hours',round(c.regular_hours+c.substitute_hours,2)
    ) order by c.weekday),'[]'::jsonb),
    t.workday_count,
    t.total_hours,
    t.regular_hours,
    t.substitute_hours,
    t.substitute_slot_count,
    t.unresolved_substitute_slot_count
  into
    v_weekday_workdays,
    v_breakdown,
    v_workday_count,
    v_total_hours,
    v_regular_hours,
    v_substitute_hours,
    v_substitute_slot_count,
    v_unresolved_substitute_slot_count
  from counts c
  cross join totals t
  group by
    t.workday_count,t.total_hours,t.regular_hours,t.substitute_hours,
    t.substitute_slot_count,t.unresolved_substitute_slot_count;

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
    'regular_hours',v_regular_hours,
    'substitute_hours',v_substitute_hours,
    'substitute_slot_count',v_substitute_slot_count,
    'unresolved_substitute_slot_count',v_unresolved_substitute_slot_count,
    'monthly_salary',v_monthly_salary,
    'hourly_wage',v_hourly_wage,
    'has_unpriced_substitute_work',(
      v_monthly_salary<=0
      and v_hourly_wage<=0
      and v_substitute_slot_count>0
    ),
    'amount',v_amount
  );
end;
$function$;

revoke all on function private.olli_teacher_payroll_calculate(uuid,uuid,date)
  from public,anon,authenticated;

create or replace function public.olli_teacher_payroll_overview(
  p_session_token text,
  p_academy_id uuid,
  p_month date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_account_id uuid;
  v_owner public.academy_members%rowtype;
  v_month date := date_trunc('month',coalesce(p_month,current_date))::date;
  v_teachers jsonb;
  v_warnings jsonb;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;

  select m.* into v_owner
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id
    and m.account_id=v_account_id
    and m.status='active'
    and m.role='owner'
    and a.status='active'
    and a.deleted_at is null
  order by m.created_at
  limit 1;

  if v_owner.id is null then raise exception '선생님 급여는 원장만 확인할 수 있습니다.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'teacher_member_id',m.id,
    'teacher_name',m.display_name,
    'role',m.role,
    'monthly_salary',coalesce(s.monthly_salary,0),
    'hourly_wage',coalesce(s.hourly_wage,0),
    'payday',coalesce(s.payday,15),
    'weekday_hours',coalesce(s.weekday_hours,'{"1":0,"2":0,"3":0,"4":0,"5":0,"6":0}'::jsonb),
    'is_enabled',coalesce(s.is_enabled,true),
    'pay_type',coalesce(calc.data->>'pay_type','hourly'),
    'pay_date',calc.data->>'pay_date',
    'period_start',calc.data->>'period_start',
    'period_end',calc.data->>'period_end',
    'weekday_workdays',calc.data->'weekday_workdays',
    'breakdown',calc.data->'breakdown',
    'workday_count',coalesce((calc.data->>'workday_count')::integer,0),
    'total_hours',coalesce((calc.data->>'total_hours')::numeric,0),
    'regular_hours',coalesce((calc.data->>'regular_hours')::numeric,0),
    'substitute_hours',coalesce((calc.data->>'substitute_hours')::numeric,0),
    'substitute_slot_count',coalesce((calc.data->>'substitute_slot_count')::integer,0),
    'unresolved_substitute_slot_count',coalesce((calc.data->>'unresolved_substitute_slot_count')::integer,0),
    'has_unpriced_substitute_work',coalesce((calc.data->>'has_unpriced_substitute_work')::boolean,false),
    'total_amount',coalesce((calc.data->>'amount')::bigint,0)
  ) order by m.display_name,m.id),'[]'::jsonb)
  into v_teachers
  from public.academy_members m
  left join private.olli_teacher_payroll_settings s
    on s.academy_id=m.academy_id and s.teacher_member_id=m.id
  cross join lateral (
    select private.olli_teacher_payroll_calculate(p_academy_id,m.id,v_month) as data
  ) calc
  where m.academy_id=p_academy_id
    and m.status='active'
    and (
      m.role in ('manager','teacher')
      or s.teacher_member_id is not null
    )
    and (
      s.teacher_member_id is not null
      or exists (
        select 1
        from public.olli_schedule_class_teachers ct
        where ct.academy_id=p_academy_id
          and (
            ct.teacher_member_id=m.id
            or (
              ct.teacher_member_id is null
              and nullif(trim(ct.teacher_name),'') is not null
              and trim(ct.teacher_name)=trim(m.display_name)
            )
          )
      )
      or exists (
        select 1
        from public.olli_schedule_teacher_overrides o
        where o.academy_id=p_academy_id
          and (
            o.teacher_member_id=m.id
            or (
              o.teacher_member_id is null
              and nullif(trim(o.teacher_name),'') is not null
              and trim(o.teacher_name)=trim(m.display_name)
            )
          )
      )
    );

  with substitute_candidates as (
    select distinct m.id,m.display_name
    from public.academy_members m
    where m.academy_id=p_academy_id
      and m.status='active'
      and m.role in ('owner','manager','teacher')
      and exists (
        select 1
        from public.olli_schedule_teacher_overrides o
        where o.academy_id=p_academy_id
          and (
            o.teacher_member_id=m.id
            or (
              o.teacher_member_id is null
              and nullif(trim(o.teacher_name),'') is not null
              and trim(o.teacher_name)=trim(m.display_name)
            )
          )
      )
  ),
  candidate_calc as (
    select
      m.id,
      m.display_name,
      private.olli_teacher_payroll_calculate(p_academy_id,m.id,v_month) as data
    from substitute_candidates m
  ),
  warning_rows as (
    select jsonb_build_object(
      'type','substitute_hours_unresolved',
      'teacher_member_id',c.id,
      'teacher_name',c.display_name,
      'count',coalesce((c.data->>'unresolved_substitute_slot_count')::integer,0),
      'message',c.display_name || ' 선생님의 대체근무 중 급여 시간을 계산할 수 없는 수업이 있습니다.'
    ) as warning
    from candidate_calc c
    where coalesce((c.data->>'unresolved_substitute_slot_count')::integer,0)>0

    union all

    select jsonb_build_object(
      'type','substitute_wage_missing',
      'teacher_member_id',c.id,
      'teacher_name',c.display_name,
      'hours',coalesce((c.data->>'substitute_hours')::numeric,0),
      'message',c.display_name || ' 선생님의 대체근무는 반영됐지만 시급 또는 월급 설정이 없습니다.'
    ) as warning
    from candidate_calc c
    where coalesce((c.data->>'has_unpriced_substitute_work')::boolean,false)
  )
  select coalesce(jsonb_agg(w.warning),'[]'::jsonb)
    into v_warnings
  from warning_rows w;

  return jsonb_build_object(
    'ok',true,
    'month',to_char(v_month,'YYYY-MM'),
    'teachers',v_teachers,
    'warnings',v_warnings
  );
end;
$function$;

revoke all on function public.olli_teacher_payroll_overview(text,uuid,date) from public;
grant execute on function public.olli_teacher_payroll_overview(text,uuid,date) to anon,authenticated;

commit;
