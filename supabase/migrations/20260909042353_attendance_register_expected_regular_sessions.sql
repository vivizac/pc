-- Monthly attendance register: include scheduled regular sessions so past unchecked lessons can be rendered as absences.
-- Makeup sessions are intentionally not synthesized as absences; only actual makeup attendance marks are returned.

create or replace function public.olli_schedule_attendance_month(
  p_session_token text,
  p_academy_id uuid,
  p_month date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_end date;
  v_rows jsonb;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '출석부를 볼 권한이 없습니다.');
  end if;

  v_end := (v_start + interval '1 month - 1 day')::date;

  select coalesce(
    jsonb_agg(to_jsonb(x) order by x.session_date, x.student_id, x.time_slot, x.session_kind),
    '[]'::jsonb
  )
  into v_rows
  from (
    select
      a.student_id,
      a.session_date,
      a.time_slot,
      a.class_group,
      a.session_kind,
      a.marked_at,
      true as attended
    from public.olli_schedule_attendance a
    where a.academy_id = p_academy_id
      and a.session_date between v_start and v_end

    union all

    select distinct
      e.student_id,
      d.session_date,
      e.time_slot,
      e.class_group,
      'regular_expected'::text as session_kind,
      null::timestamptz as marked_at,
      false as attended
    from public.olli_schedule_enrollments e
    join public.students s
      on s.id = e.student_id
     and s.academy_id = e.academy_id
     and s.status = 'active'
    cross join lateral (
      select gs::date as session_date
      from generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') gs
    ) d
    where e.academy_id = p_academy_id
      and e.status = 'active'
      and e.effective_from <= d.session_date
      and (e.effective_to is null or e.effective_to >= d.session_date)
      and e.weekday = extract(isodow from d.session_date)::integer
  ) x;

  return jsonb_build_object(
    'ok', true,
    'month_start', v_start,
    'month_end', v_end,
    'attendance', v_rows
  );
end;
$$;

revoke all on function public.olli_schedule_attendance_month(text, uuid, date) from public;
grant execute on function public.olli_schedule_attendance_month(text, uuid, date) to anon, authenticated;
