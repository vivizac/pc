begin;

create table if not exists private.olli_teacher_payroll_periods (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  teacher_member_id uuid not null,
  teacher_name_snapshot text not null,
  payroll_month date not null,
  pay_date date not null,
  period_start date not null,
  period_end date not null,
  snapshot jsonb not null,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint olli_teacher_payroll_periods_month_check
    check (payroll_month=date_trunc('month',payroll_month)::date),
  constraint olli_teacher_payroll_periods_period_check
    check (period_start<=period_end and pay_date=period_end),
  constraint olli_teacher_payroll_periods_snapshot_check
    check (jsonb_typeof(snapshot)='object'),
  constraint olli_teacher_payroll_periods_academy_teacher_month_key
    unique (academy_id,teacher_member_id,payroll_month)
);

create index if not exists olli_teacher_payroll_periods_academy_month_idx
  on private.olli_teacher_payroll_periods(academy_id,payroll_month,teacher_member_id);

create index if not exists olli_teacher_payroll_periods_finalize_idx
  on private.olli_teacher_payroll_periods(pay_date,academy_id)
  where finalized_at is null;

alter table private.olli_teacher_payroll_periods enable row level security;
revoke all on table private.olli_teacher_payroll_periods from public,anon,authenticated;

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

  if v_member.id is null then
    return null;
  end if;

  select s.* into v_setting
  from private.olli_teacher_payroll_settings s
  where s.academy_id=p_academy_id
    and s.teacher_member_id=p_teacher_member_id
  limit 1;

  v_calc := private.olli_teacher_payroll_calculate(
    p_academy_id,
    p_teacher_member_id,
    p_month
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
    'total_amount',coalesce((v_calc->>'amount')::bigint,0)
  );
end;
$function$;

revoke all on function private.olli_teacher_payroll_teacher_payload(uuid,uuid,date)
  from public,anon,authenticated;

create or replace function private.olli_teacher_payroll_period_capture(
  p_academy_id uuid,
  p_teacher_member_id uuid,
  p_month date
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_month date := date_trunc('month',coalesce(p_month,current_date))::date;
  v_payload jsonb;
  v_row private.olli_teacher_payroll_periods%rowtype;
begin
  v_payload := private.olli_teacher_payroll_teacher_payload(
    p_academy_id,
    p_teacher_member_id,
    v_month
  );

  if v_payload is null then
    return null;
  end if;

  insert into private.olli_teacher_payroll_periods(
    academy_id,
    teacher_member_id,
    teacher_name_snapshot,
    payroll_month,
    pay_date,
    period_start,
    period_end,
    snapshot,
    updated_at
  ) values (
    p_academy_id,
    p_teacher_member_id,
    coalesce(nullif(trim(v_payload->>'teacher_name'),''),'선생님'),
    v_month,
    (v_payload->>'pay_date')::date,
    (v_payload->>'period_start')::date,
    (v_payload->>'period_end')::date,
    v_payload,
    now()
  )
  on conflict (academy_id,teacher_member_id,payroll_month)
  do update set
    teacher_name_snapshot=excluded.teacher_name_snapshot,
    pay_date=excluded.pay_date,
    period_start=excluded.period_start,
    period_end=excluded.period_end,
    snapshot=excluded.snapshot,
    updated_at=now()
  where private.olli_teacher_payroll_periods.finalized_at is null
  returning * into v_row;

  if v_row.id is null then
    select * into v_row
    from private.olli_teacher_payroll_periods p
    where p.academy_id=p_academy_id
      and p.teacher_member_id=p_teacher_member_id
      and p.payroll_month=v_month
    limit 1;
  end if;

  return v_row.snapshot;
end;
$function$;

revoke all on function private.olli_teacher_payroll_period_capture(uuid,uuid,date)
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
  v_pay_date date;
  v_calc jsonb;
  v_notification_id uuid;
  v_message_id bigint;
  v_created integer := 0;
  v_teacher_label text;
  v_candidate_month date;
  v_candidate_end date;
  v_candidate_pay_date date;
begin
  for v_row in
    select s.academy_id,s.teacher_member_id,s.payday,m.display_name
    from private.olli_teacher_payroll_settings s
    join public.academy_members m
      on m.id=s.teacher_member_id
     and m.academy_id=s.academy_id
    join public.academies a on a.id=s.academy_id
    where s.is_enabled=true
      and (p_academy_id is null or s.academy_id=p_academy_id)
      and m.status='active'
      and m.role in ('owner','manager','teacher')
      and a.status='active'
      and a.deleted_at is null
  loop
    -- If the cron missed the whole pay date, capture yesterday once as a safe fallback.
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

      if v_candidate_pay_date=(v_today - interval '1 day')::date
         and not exists (
           select 1
           from private.olli_teacher_payroll_periods p
           where p.academy_id=v_row.academy_id
             and p.teacher_member_id=v_row.teacher_member_id
             and p.payroll_month=v_candidate_month
         ) then
        perform private.olli_teacher_payroll_period_capture(
          v_row.academy_id,
          v_row.teacher_member_id,
          v_candidate_month
        );
      end if;
    end loop;

    v_pay_date := (
      v_month
      + (
          least(v_row.payday,extract(day from v_month_end)::integer)-1
        ) * interval '1 day'
    )::date;

    if v_pay_date<>v_today then
      continue;
    end if;

    -- Keep today's payroll period fresh through the pay date.
    perform private.olli_teacher_payroll_period_capture(
      v_row.academy_id,
      v_row.teacher_member_id,
      v_month
    );

    v_calc := private.olli_teacher_payroll_calculate(
      v_row.academy_id,
      v_row.teacher_member_id,
      v_month
    );
    v_notification_id := null;
    v_message_id := null;

    insert into private.olli_teacher_payroll_notifications(
      academy_id,teacher_member_id,payroll_month,pay_date,
      amount,workday_count,total_hours,breakdown
    ) values (
      v_row.academy_id,
      v_row.teacher_member_id,
      v_month,
      v_pay_date,
      coalesce((v_calc->>'amount')::bigint,0),
      coalesce((v_calc->>'workday_count')::integer,0),
      coalesce((v_calc->>'total_hours')::numeric,0),
      coalesce(v_calc->'breakdown','[]'::jsonb)
    )
    on conflict (academy_id,teacher_member_id,payroll_month)
    do update set
      pay_date=excluded.pay_date,
      amount=excluded.amount,
      workday_count=excluded.workday_count,
      total_hours=excluded.total_hours,
      breakdown=excluded.breakdown
    returning id,message_id into v_notification_id,v_message_id;

    if v_message_id is not null then
      continue;
    end if;

    v_teacher_label := case
      when trim(coalesce(v_row.display_name,'')) ~ '선생님$'
        then trim(v_row.display_name)
      else trim(coalesce(v_row.display_name,'선생님')) || '선생님'
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
        '오늘은 %s %s월 급여일 입니다.',
        v_teacher_label,
        extract(month from v_month)::integer
      ),
      v_notification_id,
      'management'
    )
    returning id into v_message_id;

    update private.olli_teacher_payroll_notifications
    set message_id=v_message_id
    where id=v_notification_id;

    insert into public.olli_team_chat_mentions(academy_id,message_id,member_id)
    select v_row.academy_id,v_message_id,m.id
    from public.academy_members m
    where m.academy_id=v_row.academy_id
      and m.status='active'
      and m.role='owner'
    on conflict (message_id,member_id) do nothing;

    v_created := v_created + 1;
  end loop;

  -- The first cron run after the pay date freezes the last pay-date snapshot.
  update private.olli_teacher_payroll_periods p
  set finalized_at=coalesce(p.finalized_at,now()),
      updated_at=now()
  where p.finalized_at is null
    and p.pay_date<v_today
    and (p_academy_id is null or p.academy_id=p_academy_id);

  return v_created;
end;
$function$;

revoke all on function private.olli_teacher_payroll_sync_due(date,uuid)
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
  v_today date := timezone('Asia/Seoul',now())::date;
  v_teachers jsonb;
  v_warnings jsonb;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;

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

  if v_owner.id is null then
    raise exception '선생님 급여는 원장만 확인할 수 있습니다.';
  end if;

  with live_candidates as (
    select distinct m.id as teacher_member_id
    from public.academy_members m
    left join private.olli_teacher_payroll_settings s
      on s.academy_id=m.academy_id
     and s.teacher_member_id=m.id
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
      )
  ),
  period_candidates as (
    select p.teacher_member_id
    from private.olli_teacher_payroll_periods p
    where p.academy_id=p_academy_id
      and p.payroll_month=v_month
  ),
  candidates as (
    select teacher_member_id from live_candidates
    union
    select teacher_member_id from period_candidates
  ),
  payloads as (
    select
      c.teacher_member_id,
      p.finalized_at,
      case
        when p.finalized_at is not null then
          p.snapshot || jsonb_build_object(
            'is_finalized',true,
            'finalized_at',p.finalized_at,
            'snapshot_status','finalized'
          )
        else
          coalesce(
            private.olli_teacher_payroll_teacher_payload(
              p_academy_id,
              c.teacher_member_id,
              v_month
            ),
            p.snapshot
          ) || jsonb_build_object(
            'is_finalized',false,
            'finalized_at',null,
            'snapshot_status',case when p.id is null then 'live' else 'open' end
          )
      end as data
    from candidates c
    left join private.olli_teacher_payroll_periods p
      on p.academy_id=p_academy_id
     and p.teacher_member_id=c.teacher_member_id
     and p.payroll_month=v_month
  ),
  usable as (
    select *
    from payloads p
    where p.data is not null
  )
  select coalesce(
    jsonb_agg(u.data order by u.data->>'teacher_name',u.teacher_member_id),
    '[]'::jsonb
  )
  into v_teachers
  from usable u;

  with teacher_rows as (
    select value as data
    from jsonb_array_elements(coalesce(v_teachers,'[]'::jsonb))
  ),
  warning_rows as (
    select jsonb_build_object(
      'type','substitute_hours_unresolved',
      'teacher_member_id',t.data->>'teacher_member_id',
      'teacher_name',t.data->>'teacher_name',
      'count',coalesce((t.data->>'unresolved_substitute_slot_count')::integer,0),
      'message',(t.data->>'teacher_name') || ' 선생님의 대체근무 중 급여 시간을 계산할 수 없는 수업이 있습니다.'
    ) as warning
    from teacher_rows t
    where coalesce((t.data->>'unresolved_substitute_slot_count')::integer,0)>0

    union all

    select jsonb_build_object(
      'type','substitute_wage_missing',
      'teacher_member_id',t.data->>'teacher_member_id',
      'teacher_name',t.data->>'teacher_name',
      'hours',coalesce((t.data->>'substitute_hours')::numeric,0),
      'message',(t.data->>'teacher_name') || ' 선생님의 대체근무는 반영됐지만 시급 또는 월급 설정이 없습니다.'
    ) as warning
    from teacher_rows t
    where coalesce((t.data->>'has_unpriced_substitute_work')::boolean,false)

    union all

    select jsonb_build_object(
      'type','historical_payroll_unfinalized',
      'teacher_member_id',t.data->>'teacher_member_id',
      'teacher_name',t.data->>'teacher_name',
      'message',(t.data->>'teacher_name') || ' 선생님의 지난 급여가 확정본 없이 실시간 계산되고 있습니다.'
    ) as warning
    from teacher_rows t
    where coalesce((t.data->>'is_finalized')::boolean,false)=false
      and nullif(t.data->>'pay_date','') is not null
      and (t.data->>'pay_date')::date<v_today
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
grant execute on function public.olli_teacher_payroll_overview(text,uuid,date)
  to anon,authenticated;

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
  v_month date := date_trunc('month',coalesce(p_month,current_date))::date;
  v_hours jsonb;
  v_calc jsonb;
  v_day integer;
  v_value numeric;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;

  select m.* into v_owner
  from public.academy_members m
  where m.academy_id=p_academy_id
    and m.account_id=v_account_id
    and m.status='active'
    and m.role='owner'
  order by m.created_at
  limit 1;
  if v_owner.id is null then
    raise exception '선생님 급여 설정은 원장만 변경할 수 있습니다.';
  end if;

  select m.* into v_teacher
  from public.academy_members m
  where m.id=p_teacher_member_id
    and m.academy_id=p_academy_id
    and m.status='active'
    and m.role in ('manager','teacher')
  limit 1;
  if v_teacher.id is null then
    raise exception '현재 학원의 선생님을 찾지 못했습니다.';
  end if;

  if exists (
    select 1
    from private.olli_teacher_payroll_periods p
    where p.academy_id=p_academy_id
      and p.teacher_member_id=p_teacher_member_id
      and p.payroll_month=v_month
      and p.finalized_at is not null
  ) then
    raise exception '확정된 과거 급여는 일반 급여 설정 저장으로 변경할 수 없습니다.';
  end if;

  if coalesce(p_monthly_salary,-1)<0 or p_monthly_salary>100000000 then
    raise exception '월급을 확인해 주세요.';
  end if;
  if coalesce(p_hourly_wage,-1)<0 or p_hourly_wage>10000000 then
    raise exception '시급을 확인해 주세요.';
  end if;
  if coalesce(p_payday,0) not between 1 and 31 then
    raise exception '급여일은 1일부터 31일까지 선택할 수 있습니다.';
  end if;
  if p_weekday_hours is null or jsonb_typeof(p_weekday_hours)<>'object' then
    raise exception '요일별 근무시간을 확인해 주세요.';
  end if;

  v_hours := '{}'::jsonb;
  for v_day in 1..6 loop
    begin
      v_value := coalesce(
        nullif(p_weekday_hours->>v_day::text,'')::numeric,
        0
      );
    exception when others then
      raise exception '요일별 근무시간을 숫자로 입력해 주세요.';
    end;

    if v_value<0 or v_value>24 then
      raise exception '하루 근무시간은 0~24시간으로 입력해 주세요.';
    end if;

    v_hours := v_hours || jsonb_build_object(
      v_day::text,
      round(v_value,2)
    );
  end loop;

  insert into private.olli_teacher_payroll_settings(
    academy_id,teacher_member_id,monthly_salary,hourly_wage,payday,
    weekday_hours,is_enabled,updated_by_member_id,updated_at
  ) values (
    p_academy_id,p_teacher_member_id,p_monthly_salary,p_hourly_wage,p_payday,
    v_hours,true,v_owner.id,now()
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

  v_calc := private.olli_teacher_payroll_calculate(
    p_academy_id,
    p_teacher_member_id,
    v_month
  );

  update private.olli_teacher_payroll_notifications
  set amount=coalesce((v_calc->>'amount')::bigint,0),
      workday_count=coalesce((v_calc->>'workday_count')::integer,0),
      total_hours=coalesce((v_calc->>'total_hours')::numeric,0),
      breakdown=coalesce(v_calc->'breakdown','[]'::jsonb)
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
      p_academy_id,
      p_teacher_member_id,
      v_month
    );
  end if;

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

revoke all on function public.olli_teacher_payroll_setting_upsert_v2(
  text,uuid,uuid,bigint,bigint,integer,jsonb,date
) from public;

grant execute on function public.olli_teacher_payroll_setting_upsert_v2(
  text,uuid,uuid,bigint,bigint,integer,jsonb,date
) to anon,authenticated;

commit;
