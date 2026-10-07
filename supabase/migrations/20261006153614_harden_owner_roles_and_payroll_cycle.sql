
begin;

alter table private.olli_teacher_payroll_settings
  add column if not exists monthly_salary bigint not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='olli_teacher_payroll_settings_monthly_salary_check'
      and conrelid='private.olli_teacher_payroll_settings'::regclass
  ) then
    alter table private.olli_teacher_payroll_settings
      add constraint olli_teacher_payroll_settings_monthly_salary_check
      check (monthly_salary >= 0 and monthly_salary <= 100000000);
  end if;
end $$;

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

  v_pay_date := (v_month + (least(v_payday,extract(day from v_month_end)::integer)-1) * interval '1 day')::date;
  v_prev_pay_date := (v_prev_month + (least(v_payday,extract(day from v_prev_month_end)::integer)-1) * interval '1 day')::date;
  v_period_start := (v_prev_pay_date - interval '1 day')::date;
  v_period_end := v_pay_date;

  if v_monthly_salary > 0 then
    v_pay_type := 'monthly';
    v_amount := v_monthly_salary;
    return jsonb_build_object(
      'month',to_char(v_month,'YYYY-MM'),
      'pay_type',v_pay_type,
      'pay_date',v_pay_date,
      'period_start',null,
      'period_end',null,
      'weekday_workdays','{}'::jsonb,
      'breakdown','[]'::jsonb,
      'workday_count',0,
      'total_hours',0,
      'monthly_salary',v_monthly_salary,
      'hourly_wage',v_hourly_wage,
      'amount',v_amount
    );
  end if;

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
  effective_slots as (
    select rd.session_date,rd.weekday,
      case
        when o.id is not null then coalesce(o.teacher_member_id,override_member.teacher_member_id)
        else coalesce(ct.teacher_member_id,class_member.teacher_member_id)
      end as teacher_member_id
    from resolved_dates rd
    join public.olli_schedule_class_teachers ct
      on ct.academy_id=p_academy_id
     and ct.weekday=rd.weekday
    left join public.olli_schedule_teacher_overrides o
      on o.academy_id=p_academy_id
     and o.session_date=rd.session_date
     and o.division=ct.division
     and o.time_slot=ct.time_slot
     and o.class_group=ct.class_group
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
    where rd.is_holiday=false
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

  v_amount := round(v_total_hours * v_hourly_wage)::bigint;

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
    and m.role in ('manager','teacher')
    and (
      s.teacher_member_id is not null
      or exists (
        select 1 from public.olli_schedule_class_teachers ct
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
        select 1 from public.olli_schedule_teacher_overrides o
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

  return jsonb_build_object('ok',true,'month',to_char(v_month,'YYYY-MM'),'teachers',v_teachers);
end;
$function$;

revoke all on function public.olli_teacher_payroll_overview(text,uuid,date) from public;
grant execute on function public.olli_teacher_payroll_overview(text,uuid,date) to anon,authenticated;

create or replace function public.olli_teacher_payroll_setting_upsert_v2(
  p_session_token text,
  p_academy_id uuid,
  p_teacher_member_id uuid,
  p_monthly_salary bigint,
  p_hourly_wage bigint,
  p_payday integer,
  p_weekday_hours jsonb,
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
  v_teacher public.academy_members%rowtype;
  v_hours jsonb;
  v_calc jsonb;
  v_day integer;
  v_value numeric;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;

  select m.* into v_owner
  from public.academy_members m
  where m.academy_id=p_academy_id and m.account_id=v_account_id and m.status='active' and m.role='owner'
  order by m.created_at limit 1;
  if v_owner.id is null then raise exception '선생님 급여 설정은 원장만 변경할 수 있습니다.'; end if;

  select m.* into v_teacher
  from public.academy_members m
  where m.id=p_teacher_member_id and m.academy_id=p_academy_id and m.status='active' and m.role in ('manager','teacher')
  limit 1;
  if v_teacher.id is null then raise exception '현재 학원의 선생님을 찾지 못했습니다.'; end if;

  if coalesce(p_monthly_salary,-1) < 0 or p_monthly_salary > 100000000 then
    raise exception '월급을 확인해 주세요.';
  end if;
  if coalesce(p_hourly_wage,-1) < 0 or p_hourly_wage > 10000000 then
    raise exception '시급을 확인해 주세요.';
  end if;
  if coalesce(p_payday,0) not between 1 and 31 then
    raise exception '급여일은 1일부터 31일까지 선택할 수 있습니다.';
  end if;
  if p_weekday_hours is null or jsonb_typeof(p_weekday_hours) <> 'object' then
    raise exception '요일별 근무시간을 확인해 주세요.';
  end if;

  v_hours := '{}'::jsonb;
  for v_day in 1..6 loop
    begin
      v_value := coalesce(nullif(p_weekday_hours->>v_day::text,'')::numeric,0);
    exception when others then
      raise exception '요일별 근무시간을 숫자로 입력해 주세요.';
    end;
    if v_value < 0 or v_value > 24 then raise exception '하루 근무시간은 0~24시간으로 입력해 주세요.'; end if;
    v_hours := v_hours || jsonb_build_object(v_day::text,round(v_value,2));
  end loop;

  insert into private.olli_teacher_payroll_settings(
    academy_id,teacher_member_id,monthly_salary,hourly_wage,payday,weekday_hours,is_enabled,updated_by_member_id,updated_at
  ) values (
    p_academy_id,p_teacher_member_id,p_monthly_salary,p_hourly_wage,p_payday,v_hours,true,v_owner.id,now()
  )
  on conflict (academy_id,teacher_member_id)
  do update set
    monthly_salary=excluded.monthly_salary,
    hourly_wage=excluded.hourly_wage,
    payday=excluded.payday,
    weekday_hours=excluded.weekday_hours,
    is_enabled=true,
    updated_by_member_id=excluded.updated_by_member_id,
    updated_at=now();

  v_calc := private.olli_teacher_payroll_calculate(p_academy_id,p_teacher_member_id,p_month);

  update private.olli_teacher_payroll_notifications
  set amount=coalesce((v_calc->>'amount')::bigint,0),
      workday_count=coalesce((v_calc->>'workday_count')::integer,0),
      total_hours=coalesce((v_calc->>'total_hours')::numeric,0),
      breakdown=coalesce(v_calc->'breakdown','[]'::jsonb)
  where academy_id=p_academy_id
    and teacher_member_id=p_teacher_member_id
    and payroll_month=date_trunc('month',coalesce(p_month,current_date))::date;

  return jsonb_build_object(
    'ok',true,
    'teacher_member_id',p_teacher_member_id,
    'monthly_salary',p_monthly_salary,
    'hourly_wage',p_hourly_wage,
    'payday',p_payday,
    'weekday_hours',v_hours,
    'payroll',v_calc
  );
end;
$function$;

revoke all on function public.olli_teacher_payroll_setting_upsert_v2(text,uuid,uuid,bigint,bigint,integer,jsonb,date) from public;
grant execute on function public.olli_teacher_payroll_setting_upsert_v2(text,uuid,uuid,bigint,bigint,integer,jsonb,date) to anon,authenticated;

create or replace function public.olli_request_academy_access(
  p_session_token text,
  p_academy_code text,
  p_requested_role text default 'manager'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions'
as $function$
declare
  v_account_id uuid;
  v_account_name text;
  v_academy public.academies%rowtype;
  v_role text;
  v_request public.olli_academy_access_requests%rowtype;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    return jsonb_build_object('ok',false,'message','계정 세션이 만료되었거나 올바르지 않습니다.');
  end if;
  if p_academy_code is null or length(btrim(p_academy_code))=0 then
    return jsonb_build_object('ok',false,'message','연결할 학원 ID를 입력해 주세요.');
  end if;

  v_role := lower(btrim(coalesce(p_requested_role,'manager')));
  if v_role not in ('manager','teacher') then
    return jsonb_build_object(
      'ok',false,
      'message','일반 학원 연결 요청에서는 원장 권한을 요청할 수 없습니다. 원장 변경은 원장권한 넘기기를 사용해 주세요.'
    );
  end if;

  select a.* into v_academy
  from public.academies a
  where upper(btrim(a.academy_code))=upper(btrim(p_academy_code))
    and a.status='active'
    and a.deleted_at is null
  limit 1;
  if not found then
    return jsonb_build_object('ok',false,'message','입력한 학원 ID와 일치하는 활성 학원을 찾지 못했습니다.');
  end if;

  if exists (
    select 1 from public.academy_members m
    where m.academy_id=v_academy.id and m.account_id=v_account_id
  ) then
    return jsonb_build_object('ok',false,'message','이미 이 계정에 연결된 학원입니다.');
  end if;

  select a.display_name into v_account_name
  from public.olli_accounts a
  where a.id=v_account_id and a.status='active';
  if v_account_name is null then
    return jsonb_build_object('ok',false,'message','활성 계정 정보를 찾지 못했습니다.');
  end if;

  select r.* into v_request
  from public.olli_academy_access_requests r
  where r.academy_id=v_academy.id
    and r.requester_account_id=v_account_id
    and r.status='pending'
  limit 1;

  if found then
    update public.olli_academy_access_requests
    set requested_role=v_role,requester_name=v_account_name,updated_at=now()
    where id=v_request.id
    returning * into v_request;
  else
    insert into public.olli_academy_access_requests(
      academy_id,requester_account_id,requester_name,requested_role,status
    ) values (
      v_academy.id,v_account_id,v_account_name,v_role,'pending'
    )
    returning * into v_request;
  end if;

  return jsonb_build_object(
    'ok',true,'request_id',v_request.id,'academy_id',v_academy.id,
    'academy_code',v_academy.academy_code,'academy_name',v_academy.academy_name,
    'requested_role',v_request.requested_role,'status',v_request.status
  );
exception when others then
  return jsonb_build_object('ok',false,'message','학원 연결 요청을 저장하지 못했습니다.','details',sqlerrm);
end;
$function$;

create or replace function public.olli_approve_academy_access_request(
  p_session_token text,
  p_academy_id uuid,
  p_request_id uuid,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions'
as $function$
declare
  v_reviewer_account_id uuid;
  v_reviewer_member_id uuid;
  v_request public.olli_academy_access_requests%rowtype;
  v_account_name text;
  v_role text;
  v_display_base text;
  v_display_name text;
  v_suffix integer := 2;
  v_member public.academy_members%rowtype;
begin
  v_reviewer_account_id := public.olli_account_id_from_session(p_session_token);
  if v_reviewer_account_id is null then
    return jsonb_build_object('ok',false,'message','계정 세션이 만료되었거나 올바르지 않습니다.');
  end if;

  select m.id into v_reviewer_member_id
  from public.academy_members m
  where m.academy_id=p_academy_id
    and m.account_id=v_reviewer_account_id
    and m.role='owner'
    and m.status='active'
  limit 1;
  if v_reviewer_member_id is null then
    return jsonb_build_object('ok',false,'message','현재 계정에는 이 학원의 원장 권한이 없습니다.');
  end if;

  v_role := lower(btrim(coalesce(p_role,'')));
  if v_role not in ('manager','teacher') then
    return jsonb_build_object(
      'ok',false,
      'message','일반 학원 연결 승인에서는 원장 권한을 부여할 수 없습니다. 원장 변경은 원장권한 넘기기를 사용해 주세요.'
    );
  end if;

  select r.* into v_request
  from public.olli_academy_access_requests r
  where r.id=p_request_id
    and r.academy_id=p_academy_id
    and r.status='pending'
  for update;
  if not found then
    return jsonb_build_object('ok',false,'message','처리할 학원 연결 요청을 찾지 못했습니다.');
  end if;

  if lower(coalesce(v_request.requested_role,'')) not in ('manager','teacher') then
    return jsonb_build_object(
      'ok',false,
      'message','이 요청은 허용되지 않는 원장 권한 요청입니다. 요청을 새로 받아 주세요.'
    );
  end if;

  select a.display_name into v_account_name
  from public.olli_accounts a
  where a.id=v_request.requester_account_id and a.status='active';
  if v_account_name is null then
    return jsonb_build_object('ok',false,'message','요청 계정이 비활성화되었거나 존재하지 않습니다.');
  end if;

  select m.* into v_member
  from public.academy_members m
  where m.academy_id=p_academy_id and m.account_id=v_request.requester_account_id
  limit 1;

  if found then
    update public.academy_members
    set role=v_role,status='active',updated_at=now()
    where id=v_member.id
    returning * into v_member;
  else
    v_display_base := coalesce(nullif(btrim(v_account_name),''),'사용자');
    v_display_name := v_display_base;
    while exists (
      select 1 from public.academy_members m
      where m.academy_id=p_academy_id and m.display_name=v_display_name
    ) loop
      v_display_name := v_display_base || ' ' || v_suffix::text;
      v_suffix := v_suffix + 1;
    end loop;

    insert into public.academy_members(
      academy_id,account_id,display_name,role,status,device_status
    ) values (
      p_academy_id,v_request.requester_account_id,v_display_name,v_role,'active','not_registered'
    )
    returning * into v_member;
  end if;

  update public.olli_academy_access_requests
  set status='approved',approved_role=v_role,
      reviewed_by_account_id=v_reviewer_account_id,
      reviewed_by_member_id=v_reviewer_member_id,
      reviewed_at=now(),updated_at=now()
  where id=v_request.id;

  return jsonb_build_object(
    'ok',true,'request_id',v_request.id,'member_id',v_member.id,
    'account_id',v_member.account_id,'member_name',v_member.display_name,
    'role',v_member.role,'status',v_member.status
  );
exception when others then
  return jsonb_build_object('ok',false,'message','학원 연결 승인을 완료하지 못했습니다.','details',sqlerrm);
end;
$function$;

create or replace function public.olli_set_account_membership_role(
  p_session_token text,
  p_academy_id uuid,
  p_member_id uuid,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions'
as $function$
declare
  v_reviewer_account_id uuid;
  v_target public.academy_members%rowtype;
  v_role text;
  v_other_owner_id uuid;
begin
  v_reviewer_account_id := public.olli_account_id_from_session(p_session_token);
  if v_reviewer_account_id is null then
    return jsonb_build_object('ok',false,'message','계정 세션이 만료되었거나 올바르지 않습니다.');
  end if;

  if not exists (
    select 1 from public.academy_members m
    where m.academy_id=p_academy_id
      and m.account_id=v_reviewer_account_id
      and m.role='owner'
      and m.status='active'
  ) then
    return jsonb_build_object('ok',false,'message','현재 계정에는 이 학원의 원장 권한이 없습니다.');
  end if;

  v_role := lower(btrim(coalesce(p_role,'')));
  if v_role not in ('manager','teacher') then
    return jsonb_build_object(
      'ok',false,
      'message','일반 권한 변경에서는 owner를 지정할 수 없습니다. 원장 변경은 원장권한 넘기기를 사용해 주세요.'
    );
  end if;

  select m.* into v_target
  from public.academy_members m
  where m.id=p_member_id
    and m.academy_id=p_academy_id
    and m.account_id is not null
  for update;
  if not found then
    return jsonb_build_object('ok',false,'message','변경할 계정 연결을 찾지 못했습니다.');
  end if;

  if v_target.role='owner' and v_role<>'owner' then
    select m.id into v_other_owner_id
    from public.academy_members m
    where m.academy_id=p_academy_id
      and m.id<>v_target.id
      and m.role='owner'
      and m.status='active'
    order by m.created_at
    limit 1;
    if v_other_owner_id is null then
      return jsonb_build_object('ok',false,'message','마지막 원장의 권한은 일반 권한 변경으로 낮출 수 없습니다.');
    end if;
  end if;

  update public.academy_members
  set role=v_role,updated_at=now()
  where id=v_target.id
  returning * into v_target;

  if exists (
    select 1 from public.academies a
    where a.id=p_academy_id and a.owner_member_id=v_target.id
  ) then
    update public.academies
    set owner_member_id=v_other_owner_id,updated_at=now()
    where id=p_academy_id;
  end if;

  return jsonb_build_object('ok',true,'member_id',v_target.id,'role',v_target.role,'status',v_target.status);
end;
$function$;

create or replace function public.olli_transfer_academy_owner(
  p_session_token text,
  p_academy_id text,
  p_target_member_id text,
  p_keep_current_as text default 'manager'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account_id uuid;
  v_academy_id uuid;
  v_target_id uuid;
  v_keep_role text := lower(coalesce(nullif(trim(p_keep_current_as),''),'manager'));
  v_current public.academy_members%rowtype;
  v_target public.academy_members%rowtype;
begin
  if coalesce(trim(p_session_token),'')='' then raise exception '계정 세션이 없습니다.'; end if;
  if coalesce(trim(p_academy_id),'')='' then raise exception '학원 ID가 없습니다.'; end if;
  if coalesce(trim(p_target_member_id),'')='' then raise exception '원장권한을 넘길 대상 계정이 없습니다.'; end if;
  if v_keep_role not in ('manager','teacher') then raise exception '현재 계정을 유지할 권한은 manager 또는 teacher만 가능합니다.'; end if;

  begin
    v_academy_id := p_academy_id::uuid;
    v_target_id := p_target_member_id::uuid;
  exception when others then
    raise exception '학원 또는 대상 계정 ID가 올바르지 않습니다.';
  end;

  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '계정 세션이 만료되었거나 올바르지 않습니다.'; end if;

  select m.* into v_current
  from public.academy_members m
  where m.academy_id=v_academy_id
    and m.account_id=v_account_id
    and m.role='owner'
    and m.status='active'
  order by m.created_at
  limit 1
  for update;
  if not found then raise exception '원장권한 넘기기는 현재 학원의 원장 계정만 실행할 수 있습니다.'; end if;

  select m.* into v_target
  from public.academy_members m
  where m.id=v_target_id
    and m.academy_id=v_academy_id
    and m.status='active'
    and m.account_id is not null
  for update;
  if not found then raise exception '원장권한을 넘길 대상 계정을 현재 학원에서 찾지 못했습니다.'; end if;
  if v_target.id=v_current.id then raise exception '현재 계정 자기 자신에게는 원장권한을 넘길 수 없습니다.'; end if;

  update public.academy_members
  set role='owner',updated_at=now()
  where id=v_target.id;

  update public.academy_members
  set role=v_keep_role,updated_at=now()
  where id=v_current.id;

  update public.academies
  set owner_member_id=v_target.id,updated_at=now()
  where id=v_academy_id;

  return jsonb_build_object(
    'ok',true,
    'message','원장권한 넘기기 완료',
    'new_owner_member_id',v_target.id,
    'new_owner_name',v_target.display_name,
    'previous_owner_member_id',v_current.id,
    'current_role',v_keep_role
  );
end;
$function$;

create or replace function public.approve_teacher_request(p_request_id uuid)
returns public.academy_members
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  req public.teacher_approval_requests;
  new_member public.academy_members;
  v_role text;
begin
  select * into req
  from public.teacher_approval_requests
  where id=p_request_id and status='pending';
  if req.id is null then raise exception '대기 중인 승인 요청을 찾을 수 없습니다.'; end if;
  if not public.is_academy_admin(req.academy_id) then raise exception '승인 권한이 없습니다.'; end if;

  v_role := case when req.requested_role in ('teacher','manager') then req.requested_role else 'teacher' end;

  insert into public.academy_members(academy_id,display_name,role,status,device_status)
  values(req.academy_id,req.teacher_name,v_role,'active','registered')
  on conflict (academy_id,display_name)
  do update set role=excluded.role,status='active',device_status='registered',updated_at=now()
  returning * into new_member;

  update public.teacher_approval_requests
  set status='approved',approved_by=auth.uid(),approved_member_id=new_member.id,approved_at=now()
  where id=p_request_id;

  return new_member;
end;
$function$;

create or replace function public.olli_admin_approve_teacher_approval_request(
  p_session_token text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_req jsonb;
  v_academy_id text;
  v_academy_code text;
  v_teacher_name text;
  v_role text;
  v_device_id text;
  v_device_name text;
  v_member_id text;
  v_payload jsonb;
  v_cols text[] := array[]::text[];
  v_vals text[] := array[]::text[];
  v_sets text[] := array[]::text[];
  v_key text;
  v_sql text;
begin
  if not public.olli_is_global_approval_admin(p_session_token) then
    raise exception '전역 승인관리 권한이 없습니다.';
  end if;

  select to_jsonb(r) into v_req
  from public.teacher_approval_requests r
  where r.id::text=p_request_id
  limit 1;
  if v_req is null then raise exception '승인 요청을 찾지 못했습니다.'; end if;

  v_academy_id := coalesce(v_req->>'academy_id','');
  v_academy_code := coalesce(v_req->>'academy_code','');
  v_teacher_name := coalesce(v_req->>'teacher_name',v_req->>'member_name',v_req->>'display_name',v_req->>'name','');
  v_role := coalesce(v_req->>'requested_role',v_req->>'role','teacher');
  if v_role not in ('teacher','manager') then v_role := 'teacher'; end if;
  v_device_id := coalesce(v_req->>'requested_device_id',v_req->>'device_id','');
  v_device_name := coalesce(v_req->>'requested_device_name',v_req->>'device_name','');

  if trim(v_teacher_name)='' then raise exception '선생님 이름이 비어 있습니다.'; end if;

  v_sql := 'select id::text from public.academy_members where 1=1';
  if public.olli_has_column('academy_members','academy_id') and v_academy_id<>'' then
    v_sql := v_sql || ' and academy_id::text = ' || quote_literal(v_academy_id);
  elsif public.olli_has_column('academy_members','academy_code') and v_academy_code<>'' then
    v_sql := v_sql || ' and academy_code::text = ' || quote_literal(v_academy_code);
  end if;
  if public.olli_has_column('academy_members','member_name') then
    v_sql := v_sql || ' and member_name::text = ' || quote_literal(v_teacher_name);
  elsif public.olli_has_column('academy_members','teacher_name') then
    v_sql := v_sql || ' and teacher_name::text = ' || quote_literal(v_teacher_name);
  end if;
  if public.olli_has_column('academy_members','device_id') and v_device_id<>'' then
    v_sql := v_sql || ' and coalesce(device_id::text, '''') = ' || quote_literal(v_device_id);
  end if;
  v_sql := v_sql || ' limit 1';
  execute v_sql into v_member_id;

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'academy_id',nullif(v_academy_id,''),
    'academy_code',nullif(v_academy_code,''),
    'member_name',nullif(v_teacher_name,''),
    'teacher_name',nullif(v_teacher_name,''),
    'display_name',nullif(v_teacher_name,''),
    'role',v_role,
    'status','active',
    'membership_status','active',
    'device_status','active',
    'device_id',nullif(v_device_id,''),
    'device_name',nullif(v_device_name,''),
    'created_at',now()::text,
    'updated_at',now()::text
  ));

  if v_member_id is null then
    for v_key in select jsonb_object_keys(v_payload) loop
      if public.olli_has_column('academy_members',v_key) then
        v_cols := array_append(v_cols,quote_ident(v_key));
        v_vals := array_append(v_vals,quote_nullable(v_payload->>v_key));
      end if;
    end loop;
    if array_length(v_cols,1) is null then raise exception 'academy_members에 저장할 수 있는 컬럼을 찾지 못했습니다.'; end if;
    v_sql := format(
      'insert into public.academy_members (%s) values (%s) returning id::text',
      array_to_string(v_cols,', '),array_to_string(v_vals,', ')
    );
    execute v_sql into v_member_id;
  else
    v_payload := jsonb_strip_nulls(jsonb_build_object(
      'role',v_role,'status','active','membership_status','active','device_status','active',
      'device_id',nullif(v_device_id,''),'device_name',nullif(v_device_name,''),'updated_at',now()::text
    ));
    for v_key in select jsonb_object_keys(v_payload) loop
      if public.olli_has_column('academy_members',v_key) then
        v_sets := array_append(v_sets,quote_ident(v_key) || ' = ' || quote_nullable(v_payload->>v_key));
      end if;
    end loop;
    if array_length(v_sets,1) is not null then
      v_sql := format('update public.academy_members set %s where id::text = %L',array_to_string(v_sets,', '),v_member_id);
      execute v_sql;
    end if;
  end if;

  v_sets := array[]::text[];
  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'status','approved','member_id',nullif(v_member_id,''),'approved_at',now()::text,'reviewed_at',now()::text,'updated_at',now()::text
  ));
  for v_key in select jsonb_object_keys(v_payload) loop
    if public.olli_has_column('teacher_approval_requests',v_key) then
      v_sets := array_append(v_sets,quote_ident(v_key) || ' = ' || quote_nullable(v_payload->>v_key));
    end if;
  end loop;
  if array_length(v_sets,1) is not null then
    v_sql := format('update public.teacher_approval_requests set %s where id::text = %L',array_to_string(v_sets,', '),p_request_id);
    execute v_sql;
  end if;

  return jsonb_build_object('ok',true,'member_id',v_member_id,'message','승인 완료');
end;
$function$;

commit;
