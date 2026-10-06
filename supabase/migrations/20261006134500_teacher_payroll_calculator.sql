begin;

create extension if not exists pg_cron;

create table if not exists private.olli_teacher_payroll_settings (
  academy_id uuid not null references public.academies(id) on delete cascade,
  teacher_member_id uuid not null references public.academy_members(id) on delete cascade,
  hourly_wage bigint not null default 0 check (hourly_wage >= 0 and hourly_wage <= 10000000),
  payday smallint not null default 15 check (payday between 1 and 31),
  weekday_hours jsonb not null default '{"1":0,"2":0,"3":0,"4":0,"5":0,"6":0}'::jsonb,
  is_enabled boolean not null default true,
  updated_by_member_id uuid references public.academy_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (academy_id, teacher_member_id),
  constraint olli_teacher_payroll_settings_weekday_hours_object_check
    check (jsonb_typeof(weekday_hours) = 'object')
);

create table if not exists private.olli_teacher_payroll_notifications (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  teacher_member_id uuid not null references public.academy_members(id) on delete cascade,
  payroll_month date not null,
  pay_date date not null,
  amount bigint not null check (amount >= 0),
  workday_count integer not null default 0 check (workday_count >= 0),
  total_hours numeric(10,2) not null default 0 check (total_hours >= 0),
  breakdown jsonb not null default '[]'::jsonb,
  message_id bigint,
  created_at timestamptz not null default now(),
  unique (academy_id, teacher_member_id, payroll_month)
);

create index if not exists olli_teacher_payroll_notifications_academy_month_idx
  on private.olli_teacher_payroll_notifications (academy_id, payroll_month, teacher_member_id);

alter table public.olli_team_chat_bot_events
  drop constraint if exists olli_team_chat_bot_events_event_type_check;

alter table public.olli_team_chat_bot_events
  add constraint olli_team_chat_bot_events_event_type_check
  check (event_type = any (array[
    'registration_add'::text,
    'registration_cancel'::text,
    'trial_add'::text,
    'trial_cancel'::text,
    'wait_add'::text,
    'wait_cancel'::text,
    'pickup_add'::text,
    'pickup_cancel'::text,
    'payroll_due'::text
  ]));

create or replace function public.olli_team_chat_system_push_targets(
  p_academy_id uuid,
  p_message_id bigint,
  p_member_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_body text;
  v_targets jsonb;
begin
  if p_academy_id is null or p_message_id is null or p_member_id is null then
    raise exception '시스템 알림 대상 정보가 없습니다.';
  end if;

  select m.body into v_body
  from public.olli_team_chat_messages m
  join public.olli_team_chat_bot_events e
    on e.academy_id=m.academy_id
   and e.message_id=m.id
   and e.target_member_id=p_member_id
  where m.academy_id=p_academy_id
    and m.id=p_message_id
    and (
      m.message_type='system'
      or (m.message_type='ai' and e.event_type='payroll_due')
    )
    and m.deleted_at is null
  limit 1;

  if v_body is null then
    raise exception '시스템 알림 메시지를 찾을 수 없습니다.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'subscription_id',s.id,
    'member_id',s.member_id,
    'endpoint',s.endpoint,
    'p256dh',s.p256dh,
    'auth',s.auth
  ) order by s.id),'[]'::jsonb)
  into v_targets
  from public.olli_team_chat_push_subscriptions s
  join public.academy_members m
    on m.id=s.member_id
   and m.academy_id=s.academy_id
   and m.status='active'
  where s.academy_id=p_academy_id
    and s.member_id=p_member_id
    and s.disabled_at is null
    and not exists (
      select 1
      from public.olli_team_chat_push_deliveries d
      where d.academy_id=p_academy_id
        and d.message_id=p_message_id
        and d.subscription_id=s.id
    );

  return jsonb_build_object(
    'ok',true,
    'body',v_body,
    'message_id',p_message_id,
    'target_member_id',p_member_id,
    'targets',v_targets
  );
end;
$function$;

revoke all on private.olli_teacher_payroll_settings from anon, authenticated;
revoke all on private.olli_teacher_payroll_notifications from anon, authenticated;

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
  v_hourly_wage bigint := 0;
  v_weekday_hours jsonb := '{"1":0,"2":0,"3":0,"4":0,"5":0,"6":0}'::jsonb;
  v_breakdown jsonb := '[]'::jsonb;
  v_weekday_workdays jsonb := '{}'::jsonb;
  v_workday_count integer := 0;
  v_total_hours numeric(10,2) := 0;
  v_amount bigint := 0;
begin
  select s.hourly_wage, s.weekday_hours
    into v_hourly_wage, v_weekday_hours
  from private.olli_teacher_payroll_settings s
  where s.academy_id=p_academy_id
    and s.teacher_member_id=p_teacher_member_id;

  v_hourly_wage := coalesce(v_hourly_wage,0);
  v_weekday_hours := coalesce(v_weekday_hours,'{"1":0,"2":0,"3":0,"4":0,"5":0,"6":0}'::jsonb);

  with dates as (
    select gs::date as session_date, extract(isodow from gs)::integer as weekday
    from generate_series(v_month::timestamp, v_month_end::timestamp, interval '1 day') gs
    where extract(isodow from gs) between 1 and 6
  ),
  resolved_dates as (
    select d.session_date, d.weekday,
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
    'weekday_workdays',v_weekday_workdays,
    'breakdown',v_breakdown,
    'workday_count',v_workday_count,
    'total_hours',v_total_hours,
    'hourly_wage',v_hourly_wage,
    'amount',v_amount
  );
end;
$function$;

revoke all on function private.olli_teacher_payroll_calculate(uuid,uuid,date) from public, anon, authenticated;

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
    'hourly_wage',coalesce(s.hourly_wage,0),
    'payday',coalesce(s.payday,15),
    'weekday_hours',coalesce(s.weekday_hours,'{"1":0,"2":0,"3":0,"4":0,"5":0,"6":0}'::jsonb),
    'is_enabled',coalesce(s.is_enabled,true),
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

  return jsonb_build_object('ok',true,'month',to_char(v_month,'YYYY-MM'),'teachers',v_teachers);
end;
$function$;

revoke all on function public.olli_teacher_payroll_overview(text,uuid,date) from public;
grant execute on function public.olli_teacher_payroll_overview(text,uuid,date) to anon, authenticated;

create or replace function public.olli_teacher_payroll_setting_upsert(
  p_session_token text,
  p_academy_id uuid,
  p_teacher_member_id uuid,
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
    academy_id,teacher_member_id,hourly_wage,payday,weekday_hours,is_enabled,updated_by_member_id,updated_at
  ) values (
    p_academy_id,p_teacher_member_id,p_hourly_wage,p_payday,v_hours,true,v_owner.id,now()
  )
  on conflict (academy_id,teacher_member_id)
  do update set
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
    'hourly_wage',p_hourly_wage,
    'payday',p_payday,
    'weekday_hours',v_hours,
    'payroll',v_calc
  );
end;
$function$;

revoke all on function public.olli_teacher_payroll_setting_upsert(text,uuid,uuid,bigint,integer,jsonb,date) from public;
grant execute on function public.olli_teacher_payroll_setting_upsert(text,uuid,uuid,bigint,integer,jsonb,date) to anon, authenticated;

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
  v_month_end date := (date_trunc('month',coalesce(p_today,timezone('Asia/Seoul',now())::date)) + interval '1 month - 1 day')::date;
  v_row record;
  v_pay_date date;
  v_calc jsonb;
  v_notification_id uuid;
  v_message_id bigint;
  v_created integer := 0;
  v_teacher_label text;
  v_owner record;
  v_secret text;
begin
  for v_row in
    select s.academy_id,s.teacher_member_id,s.payday,m.display_name
    from private.olli_teacher_payroll_settings s
    join public.academy_members m on m.id=s.teacher_member_id and m.academy_id=s.academy_id
    join public.academies a on a.id=s.academy_id
    where s.is_enabled=true
      and (p_academy_id is null or s.academy_id=p_academy_id)
      and m.status='active'
      and m.role in ('manager','teacher')
      and a.status='active'
      and a.deleted_at is null
  loop
    v_pay_date := (v_month + (least(v_row.payday,extract(day from v_month_end)::integer)-1) * interval '1 day')::date;
    if v_pay_date <> v_today then continue; end if;

    v_calc := private.olli_teacher_payroll_calculate(v_row.academy_id,v_row.teacher_member_id,v_month);
    v_notification_id := null;
    v_message_id := null;

    insert into private.olli_teacher_payroll_notifications(
      academy_id,teacher_member_id,payroll_month,pay_date,amount,workday_count,total_hours,breakdown
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

    if v_message_id is not null then continue; end if;

    v_teacher_label := case
      when trim(coalesce(v_row.display_name,'')) ~ '선생님$' then trim(v_row.display_name)
      else trim(coalesce(v_row.display_name,'선생님')) || '선생님'
    end;

    insert into public.olli_team_chat_messages(
      academy_id,sender_member_id,sender_name_snapshot,message_type,body,client_message_id,audience
    ) values (
      v_row.academy_id,
      null,
      '올리',
      'ai',
      format('오늘은 %s %s월 급여일 입니다.',v_teacher_label,extract(month from v_month)::integer),
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
    where m.academy_id=v_row.academy_id and m.status='active' and m.role='owner'
    on conflict (academy_id,message_id,member_id) do nothing;

    begin
      select ds.decrypted_secret
        into v_secret
      from vault.decrypted_secrets ds
      where ds.name='olli_team_chat_system_push_secret_20260921'
      order by ds.created_at desc
      limit 1;

      for v_owner in
        select m.id
        from public.academy_members m
        where m.academy_id=v_row.academy_id
          and m.status='active'
          and m.role='owner'
      loop
        insert into public.olli_team_chat_bot_events(
          academy_id,event_key,event_type,source_table,source_id,message_id,target_member_id,
          class_date,division,weekday,time_slot,class_group
        )
        values (
          v_row.academy_id,
          'payroll_due:'||v_notification_id::text||':'||v_owner.id::text,
          'payroll_due',
          'olli_teacher_payroll_notifications',
          v_notification_id::text,
          v_message_id,
          v_owner.id,
          v_today,
          null,
          null,
          null,
          'A'
        )
        on conflict (academy_id,event_key) do nothing;

        if nullif(v_secret,'') is not null then
          perform net.http_post(
            url := 'https://fvkxipjwgeyosgnfhdnx.supabase.co/functions/v1/olli-team-chat-push',
            headers := jsonb_build_object('Content-Type','application/json'),
            body := jsonb_build_object(
              'action','dispatch-system',
              'academy_id',v_row.academy_id,
              'message_id',v_message_id,
              'target_member_id',v_owner.id,
              'internal_token',v_secret
            ),
            timeout_milliseconds := 8000
          );
        end if;
      end loop;
    exception when others then
      null;
    end;

    v_created := v_created + 1;
  end loop;

  return v_created;
end;
$function$;

revoke all on function private.olli_teacher_payroll_sync_due(date,uuid) from public, anon, authenticated;

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
  v_created integer;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;

  select m.id into v_owner_id
  from public.academy_members m
  where m.academy_id=p_academy_id and m.account_id=v_account_id and m.status='active' and m.role='owner'
  order by m.created_at limit 1;
  if v_owner_id is null then raise exception '급여일 알림은 원장만 동기화할 수 있습니다.'; end if;

  v_created := private.olli_teacher_payroll_sync_due(timezone('Asia/Seoul',now())::date,p_academy_id);
  return jsonb_build_object('ok',true,'created',v_created);
end;
$function$;

revoke all on function public.olli_teacher_payroll_due_sync(text,uuid) from public;
grant execute on function public.olli_teacher_payroll_due_sync(text,uuid) to anon, authenticated;

create or replace function public.olli_teacher_payroll_notification_amount_get(
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
  v_owner_id uuid;
  v_row record;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;

  select m.id into v_owner_id
  from public.academy_members m
  where m.academy_id=p_academy_id and m.account_id=v_account_id and m.status='active' and m.role='owner'
  order by m.created_at limit 1;
  if v_owner_id is null then raise exception '급여 금액은 원장만 확인할 수 있습니다.'; end if;

  select n.amount,n.payroll_month,n.teacher_member_id,m.display_name
  into v_row
  from private.olli_teacher_payroll_notifications n
  join public.academy_members m on m.id=n.teacher_member_id
  where n.id=p_notification_id and n.academy_id=p_academy_id
  limit 1;

  if v_row.teacher_member_id is null then raise exception '급여 알림을 찾지 못했습니다.'; end if;

  return jsonb_build_object(
    'ok',true,
    'amount',v_row.amount,
    'payroll_month',to_char(v_row.payroll_month,'YYYY-MM'),
    'teacher_member_id',v_row.teacher_member_id,
    'teacher_name',v_row.display_name
  );
end;
$function$;

revoke all on function public.olli_teacher_payroll_notification_amount_get(text,uuid,uuid) from public;
grant execute on function public.olli_teacher_payroll_notification_amount_get(text,uuid,uuid) to anon, authenticated;

-- payroll owner-only Team Chat visibility start
-- 급여일 알림은 management 저장 형식을 유지하되 원장 외 관리자의 팀챗 조회에서는 제외합니다.
-- 기존 일반 management 메시지의 권한/동작은 변경하지 않습니다.
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
    'message_type',x.message_type,'body',x.body,'created_at',x.created_at,
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
        msg.audience='all'
        or (msg.audience='management' and v_member.role in ('owner','manager') and (
          v_member.role='owner'
          or not exists (
            select 1
            from private.olli_teacher_payroll_notifications payroll_notice
            where payroll_notice.academy_id=msg.academy_id
              and payroll_notice.message_id=msg.id
          )
        ))
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
        msg.audience='all'
        or (msg.audience='management' and v_member.role in ('owner','manager') and (
          v_member.role='owner'
          or not exists (
            select 1
            from private.olli_teacher_payroll_notifications payroll_notice
            where payroll_notice.academy_id=msg.academy_id
              and payroll_notice.message_id=msg.id
          )
        ))
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
        msg.audience='all'
        or (msg.audience='management' and v_member.role in ('owner','manager') and (
          v_member.role='owner'
          or not exists (
            select 1
            from private.olli_teacher_payroll_notifications payroll_notice
            where payroll_notice.academy_id=msg.academy_id
              and payroll_notice.message_id=msg.id
          )
        ))
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


-- payroll owner-only Team Chat visibility end
do $cron_setup$
begin
  if exists(select 1 from cron.job where jobname='olli-teacher-payroll-daily') then
    perform cron.unschedule('olli-teacher-payroll-daily');
  end if;
  if exists(select 1 from cron.job where jobname='olli-teacher-payroll-hourly') then
    perform cron.unschedule('olli-teacher-payroll-hourly');
  end if;
  perform cron.schedule(
    'olli-teacher-payroll-hourly',
    '7 * * * *',
    $job$select private.olli_teacher_payroll_sync_due(timezone('Asia/Seoul',now())::date,null);$job$
  );
end;
$cron_setup$;

commit;
