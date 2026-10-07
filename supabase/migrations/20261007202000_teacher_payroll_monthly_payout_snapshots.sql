begin;

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
    -- If a payout date already passed before Olli could capture it, create the
    -- missing current/previous-month snapshot before the finalization step.
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

commit;
