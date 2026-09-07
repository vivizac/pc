create or replace function private.olli_students_apply_timetable_teacher()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher_name text;
  v_profile_teacher_name text;
begin
  select nullif(trim(ct.teacher_name), '')
    into v_teacher_name
  from public.olli_schedule_enrollments e
  left join public.olli_schedule_class_teachers ct
    on ct.academy_id = e.academy_id
   and ct.division = new.division
   and ct.weekday = e.weekday
   and ct.time_slot = e.time_slot
   and ct.class_group = coalesce(nullif(upper(trim(e.class_group)), ''), 'A')
  where e.academy_id = new.academy_id
    and e.student_id = new.id
    and e.status = 'active'
    and e.effective_from <= current_date
    and (e.effective_to is null or e.effective_to >= current_date)
  order by
    case when e.session_order = 1 then 0 when e.session_order is null then 1 else 2 end,
    coalesce(e.session_order, 99),
    e.weekday,
    e.time_slot,
    coalesce(e.class_group, 'A')
  limit 1;

  if v_teacher_name is not null then
    v_profile_teacher_name := case
      when v_teacher_name ~* 'T\s*$' then regexp_replace(v_teacher_name, '\s*T\s*$', 'T', 'i')
      else v_teacher_name || 'T'
    end;
    new.teacher := v_profile_teacher_name;
    new.homeroom_teacher := v_profile_teacher_name;
  else
    new.teacher := '';
    new.homeroom_teacher := '';
  end if;

  return new;
end;
$$;

drop trigger if exists olli_students_timetable_teacher_guard on public.students;
create trigger olli_students_timetable_teacher_guard
before insert or update on public.students
for each row
execute function private.olli_students_apply_timetable_teacher();

create or replace function private.olli_schedule_sync_student(p_student_id uuid, p_reference_date date default current_date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days text;
  v_times text;
begin
  select string_agg(x.day_label, ' · ' order by x.weekday)
  into v_days
  from (
    select distinct e.weekday,
      case e.weekday
        when 1 then '월' when 2 then '화' when 3 then '수'
        when 4 then '목' when 5 then '금' when 6 then '토'
      end as day_label
    from public.olli_schedule_enrollments e
    where e.student_id = p_student_id
      and e.status = 'active'
      and e.effective_from <= p_reference_date
      and (e.effective_to is null or e.effective_to >= p_reference_date)
  ) x;

  select string_agg(
    case e.weekday
      when 1 then '월' when 2 then '화' when 3 then '수'
      when 4 then '목' when 5 then '금' when 6 then '토'
    end || ' ' || e.time_slot::text || '시',
    ' · ' order by e.weekday, e.time_slot
  )
  into v_times
  from public.olli_schedule_enrollments e
  where e.student_id = p_student_id
    and e.status = 'active'
    and e.effective_from <= p_reference_date
    and (e.effective_to is null or e.effective_to >= p_reference_date);

  update public.students
  set lesson_day = coalesce(v_days, ''),
      lesson_time = coalesce(v_times, ''),
      updated_at = now()
  where id = p_student_id;

  perform private.olli_schedule_sync_student_teacher(p_student_id, p_reference_date, true);
end;
$$;

do $$
declare
  v_student_id uuid;
begin
  for v_student_id in
    select s.id
    from public.students s
    where coalesce(s.is_deleted, false) = false
      and s.status = 'active'
  loop
    perform private.olli_schedule_sync_student_teacher(v_student_id, current_date, true);
  end loop;
end;
$$;
