create or replace function private.olli_schedule_clear_register_override_on_attendance_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_academy_id uuid;
  v_student_id uuid;
  v_session_date date;
  v_session_kind text;
begin
  if tg_op = 'DELETE' then
    v_academy_id := old.academy_id;
    v_student_id := old.student_id;
    v_session_date := old.session_date;
    v_session_kind := old.session_kind;
  else
    v_academy_id := new.academy_id;
    v_student_id := new.student_id;
    v_session_date := new.session_date;
    v_session_kind := new.session_kind;
  end if;

  if v_session_kind in ('regular','makeup') then
    delete from public.olli_schedule_attendance_register_overrides o
    where o.academy_id = v_academy_id
      and o.student_id = v_student_id
      and o.session_date = v_session_date
      and o.session_kind = v_session_kind;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

drop trigger if exists olli_schedule_attendance_clear_register_override on public.olli_schedule_attendance;
create trigger olli_schedule_attendance_clear_register_override
after insert or delete on public.olli_schedule_attendance
for each row execute function private.olli_schedule_clear_register_override_on_attendance_change();

-- Existing rows: when timetable/attendance marking happened after a manual register override,
-- keep the newer actual attendance record authoritative.
delete from public.olli_schedule_attendance_register_overrides o
using public.olli_schedule_attendance a
where a.academy_id = o.academy_id
  and a.student_id = o.student_id
  and a.session_date = o.session_date
  and a.session_kind = o.session_kind
  and a.session_kind in ('regular','makeup')
  and a.marked_at > o.updated_at;
