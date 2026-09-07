create or replace function private.olli_schedule_sync_student_teacher(
  p_student_id uuid,
  p_reference_date date default current_date,
  p_clear_if_unassigned boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_academy_id uuid;
  v_division text;
  v_weekday smallint;
  v_time_slot smallint;
  v_class_group text;
  v_teacher_name text;
  v_profile_teacher_name text;
begin
  select s.academy_id, s.division
    into v_academy_id, v_division
  from public.students s
  where s.id = p_student_id
    and coalesce(s.is_deleted, false) = false;

  if v_academy_id is null or v_division is null then
    return;
  end if;

  select e.weekday, e.time_slot, coalesce(nullif(upper(trim(e.class_group)), ''), 'A')
    into v_weekday, v_time_slot, v_class_group
  from public.olli_schedule_enrollments e
  where e.academy_id = v_academy_id
    and e.student_id = p_student_id
    and e.status = 'active'
    and e.effective_from <= coalesce(p_reference_date, current_date)
    and (e.effective_to is null or e.effective_to >= coalesce(p_reference_date, current_date))
  order by
    case when e.session_order = 1 then 0 when e.session_order is null then 1 else 2 end,
    coalesce(e.session_order, 99),
    e.weekday,
    e.time_slot,
    coalesce(e.class_group, 'A')
  limit 1;

  if v_weekday is null then
    if p_clear_if_unassigned then
      update public.students
         set teacher = '',
             homeroom_teacher = '',
             updated_at = now()
       where id = p_student_id;
    end if;
    return;
  end if;

  select nullif(trim(ct.teacher_name), '')
    into v_teacher_name
  from public.olli_schedule_class_teachers ct
  where ct.academy_id = v_academy_id
    and ct.division = v_division
    and ct.weekday = v_weekday
    and ct.time_slot = v_time_slot
    and ct.class_group = v_class_group;

  if v_teacher_name is not null then
    v_profile_teacher_name := case
      when v_teacher_name ~* 'T\s*$' then regexp_replace(v_teacher_name, '\s*T\s*$', 'T', 'i')
      else v_teacher_name || 'T'
    end;
    update public.students
       set teacher = v_profile_teacher_name,
           homeroom_teacher = v_profile_teacher_name,
           updated_at = now()
     where id = p_student_id;
  elsif p_clear_if_unassigned then
    update public.students
       set teacher = '',
           homeroom_teacher = '',
           updated_at = now()
     where id = p_student_id;
  end if;
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
      and coalesce(s.status, 'active') = 'active'
  loop
    perform private.olli_schedule_sync_student_teacher(v_student_id, current_date, true);
  end loop;
end;
$$;
