-- Phase 1: projected academy revenue from schedule enrollment and initial registration.
-- No changes to students, schedule enrollments, payroll snapshots or expense history.
-- Deliberately read-only: income is an estimate, not an actual payment record.
create or replace function private.olli_academy_revenue_estimate(
  p_academy_id uuid,
  p_month date
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  with month_window as (
    select date_trunc('month', coalesce(p_month, current_date))::date as month_start,
           ((date_trunc('month', coalesce(p_month, current_date)) + interval '1 month')::date - 1) as as_of_date
  ),
  weekly_schedule as (
    select e.student_id,
           count(distinct (e.weekday, e.time_slot))::integer as sessions
    from public.olli_schedule_enrollments e
    cross join month_window w
    where e.academy_id=p_academy_id
      and e.status='active'
      and e.effective_from <= w.as_of_date
      and (e.effective_to is null or e.effective_to >= w.as_of_date)
    group by e.student_id
  ),
  eligible_students as (
    select s.id,
           s.enrolled_at,
           coalesce(ws.sessions, 0) as sessions
    from public.students s
    cross join month_window w
    left join weekly_schedule ws on ws.student_id=s.id
    where s.academy_id=p_academy_id
      and s.enrolled_at is not null
      and s.enrolled_at <= w.as_of_date
      and (s.withdrawn_at is null or (s.withdrawn_at at time zone 'Asia/Seoul')::date > w.as_of_date)
      and (s.deleted_at is null or (s.deleted_at at time zone 'Asia/Seoul')::date > w.as_of_date)
      and (s.paused_at is null or (s.paused_at at time zone 'Asia/Seoul')::date > w.as_of_date or s.status='active')
      and (w.as_of_date < (now() at time zone 'Asia/Seoul')::date
           or (s.status='active' and coalesce(s.is_deleted,false)=false))
  ),
  aggregates as (
    select count(*) filter (where es.sessions=1)::bigint as once_count,
           count(*) filter (where es.sessions=2)::bigint as twice_count,
           count(*) filter (where es.sessions not in (1,2))::bigint as unpriced_count,
           count(*) filter (where es.enrolled_at>=w.month_start)::bigint as new_count
    from eligible_students es
    cross join month_window w
  )
  select jsonb_build_object(
    'basis','schedule_estimate',
    'weekly_once_students',a.once_count,
    'weekly_twice_students',a.twice_count,
    'unpriced_students',a.unpriced_count,
    'new_students',a.new_count,
    'tuition_once_amount',a.once_count * 110000,
    'tuition_twice_amount',a.twice_count * 150000,
    'tuition_total_amount',a.once_count * 110000 + a.twice_count * 150000,
    'workbook_amount',a.new_count * 70000,
    'total_amount',a.once_count * 110000 + a.twice_count * 150000 + a.new_count * 70000
  )
  from aggregates a;
$function$;

revoke all on function private.olli_academy_revenue_estimate(uuid,date) from public,anon,authenticated;

-- Preserve existing finance response fields for backward-compatible clients.
-- Gross payroll includes the withheld 3.3% as a payroll cost; legacy net
-- payroll and legacy total_amount remain unchanged.
create or replace function public.olli_academy_finance_overview(
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
  v_month date := date_trunc('month',coalesce(p_month,current_date))::date;
  v_owner_id uuid;
  v_payroll jsonb;
  v_expenses jsonb;
  v_revenue jsonb;
  v_payroll_total bigint := 0;
  v_payroll_gross bigint := 0;
  v_expense_total bigint := 0;
  v_estimated_expenses bigint := 0;
  v_estimated_profit bigint := 0;
begin
  v_owner_id := private.olli_academy_finance_owner_member(p_session_token,p_academy_id);
  v_payroll := public.olli_teacher_payroll_overview(p_session_token,p_academy_id,v_month);
  v_expenses := private.olli_academy_expense_overview(p_academy_id,v_month);
  v_revenue := private.olli_academy_revenue_estimate(p_academy_id,v_month);

  select coalesce(sum(coalesce((t->>'total_amount')::bigint,0)),0)::bigint,
         coalesce(sum(coalesce((t->>'gross_amount')::bigint,(t->>'total_amount')::bigint,0)),0)::bigint
    into v_payroll_total,v_payroll_gross
  from jsonb_array_elements(coalesce(v_payroll->'teachers','[]'::jsonb)) t;

  v_expense_total := coalesce((v_expenses->>'total_amount')::bigint,0);
  v_estimated_expenses := v_expense_total + v_payroll_gross;
  v_estimated_profit := coalesce((v_revenue->>'total_amount')::bigint,0) - v_estimated_expenses;

  return jsonb_build_object(
    'ok',true,
    'month',to_char(v_month,'YYYY-MM'),
    'payroll',v_payroll,
    'expenses',v_expenses,
    'payroll_total_amount',v_payroll_total,
    'expense_total_amount',v_expense_total,
    'total_amount',v_payroll_total+v_expense_total,
    'revenue',v_revenue,
    'payroll_gross_total_amount',v_payroll_gross,
    'estimated_expense_total_amount',v_estimated_expenses,
    'estimated_profit_amount',v_estimated_profit
  );
end;
$function$;

revoke all on function public.olli_academy_finance_overview(text,uuid,date) from public;
grant execute on function public.olli_academy_finance_overview(text,uuid,date) to anon,authenticated;
