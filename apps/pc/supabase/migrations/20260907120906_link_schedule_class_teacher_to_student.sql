create table if not exists public.olli_schedule_class_teachers (
  academy_id uuid not null,
  division text not null check (division in ('elementary','kinder')),
  weekday smallint not null check (weekday between 1 and 6),
  time_slot smallint not null check (time_slot between 1 and 12),
  class_group text not null default 'A' check (class_group in ('A','B')),
  teacher_member_id uuid references public.academy_members(id) on delete set null,
  teacher_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (academy_id, division, weekday, time_slot, class_group)
);

create index if not exists olli_schedule_class_teachers_member_idx
  on public.olli_schedule_class_teachers (academy_id, teacher_member_id);

alter table public.olli_schedule_class_teachers enable row level security;
revoke all on public.olli_schedule_class_teachers from anon, authenticated;

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
    update public.students
       set teacher = v_teacher_name,
           homeroom_teacher = v_teacher_name,
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

  perform private.olli_schedule_sync_student_teacher(p_student_id, p_reference_date, false);
end;
$$;

create or replace function public.olli_schedule_class_teacher_context(
  p_session_token text,
  p_academy_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teachers jsonb;
  v_assignments jsonb;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '담임 정보를 확인할 권한이 없습니다.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'display_name', trim(m.display_name),
    'role', m.role
  ) order by trim(m.display_name), m.id), '[]'::jsonb)
    into v_teachers
  from public.academy_members m
  where m.academy_id = p_academy_id
    and m.status = 'active'
    and nullif(trim(coalesce(m.display_name, '')), '') is not null
    and m.role in ('owner','manager','teacher');

  select coalesce(jsonb_agg(jsonb_build_object(
    'division', ct.division,
    'weekday', ct.weekday,
    'time_slot', ct.time_slot,
    'class_group', ct.class_group,
    'teacher_member_id', ct.teacher_member_id,
    'teacher_name', ct.teacher_name
  ) order by ct.division, ct.weekday, ct.time_slot, ct.class_group), '[]'::jsonb)
    into v_assignments
  from public.olli_schedule_class_teachers ct
  where ct.academy_id = p_academy_id;

  return jsonb_build_object('ok', true, 'teachers', v_teachers, 'assignments', v_assignments);
end;
$$;

create or replace function public.olli_schedule_set_class_teacher(
  p_session_token text,
  p_academy_id uuid,
  p_division text,
  p_weekday integer,
  p_time_slot integer,
  p_class_group text,
  p_teacher_member_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_division text := lower(trim(coalesce(p_division, '')));
  v_group text := upper(trim(coalesce(p_class_group, 'A')));
  v_teacher_name text;
  v_student_id uuid;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '담임을 변경할 권한이 없습니다.');
  end if;

  if v_division not in ('elementary','kinder') or p_weekday not between 1 and 6 or p_time_slot not between 1 and 12 or v_group not in ('A','B') then
    return jsonb_build_object('ok', false, 'message', '담임을 지정할 수업 정보를 확인해 주세요.');
  end if;

  if p_teacher_member_id is null then
    delete from public.olli_schedule_class_teachers ct
    where ct.academy_id = p_academy_id
      and ct.division = v_division
      and ct.weekday = p_weekday
      and ct.time_slot = p_time_slot
      and ct.class_group = v_group;
  else
    select trim(m.display_name)
      into v_teacher_name
    from public.academy_members m
    where m.id = p_teacher_member_id
      and m.academy_id = p_academy_id
      and m.status = 'active'
      and m.role in ('owner','manager','teacher')
      and nullif(trim(coalesce(m.display_name, '')), '') is not null;

    if v_teacher_name is null then
      return jsonb_build_object('ok', false, 'message', '선택한 선생님을 찾을 수 없습니다.');
    end if;

    insert into public.olli_schedule_class_teachers (
      academy_id, division, weekday, time_slot, class_group,
      teacher_member_id, teacher_name, updated_at
    ) values (
      p_academy_id, v_division, p_weekday, p_time_slot, v_group,
      p_teacher_member_id, v_teacher_name, now()
    )
    on conflict (academy_id, division, weekday, time_slot, class_group)
    do update set teacher_member_id = excluded.teacher_member_id,
                  teacher_name = excluded.teacher_name,
                  updated_at = now();
  end if;

  for v_student_id in
    select distinct e.student_id
    from public.olli_schedule_enrollments e
    join public.students s on s.id = e.student_id
    where e.academy_id = p_academy_id
      and s.division = v_division
      and e.weekday = p_weekday
      and e.time_slot = p_time_slot
      and coalesce(nullif(upper(trim(e.class_group)), ''), 'A') = v_group
      and e.status = 'active'
      and e.effective_from <= current_date
      and (e.effective_to is null or e.effective_to >= current_date)
  loop
    perform private.olli_schedule_sync_student_teacher(v_student_id, current_date, true);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'division', v_division,
    'weekday', p_weekday,
    'time_slot', p_time_slot,
    'class_group', v_group,
    'teacher_member_id', p_teacher_member_id,
    'teacher_name', coalesce(v_teacher_name, '')
  );
end;
$$;

create or replace function public.olli_schedule_set_session_order(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_enrollment_id uuid,
  p_session_order integer,
  p_effective_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date := coalesce(p_effective_date, current_date);
  v_count integer;
  v_selected_exists boolean;
  v_orders jsonb;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '수업 회차를 변경할 권한이 없습니다.');
  end if;
  if p_session_order not in (1, 2) then
    return jsonb_build_object('ok', false, 'message', '수업 회차를 1회차 또는 2회차로 선택해 주세요.');
  end if;
  if p_student_id is null or p_enrollment_id is null then
    return jsonb_build_object('ok', false, 'message', '변경할 수업 정보를 확인해 주세요.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':session-order:' || p_student_id::text || ':' || v_date::text,
    0
  ));

  select count(*), bool_or(e.id = p_enrollment_id)
    into v_count, v_selected_exists
  from public.olli_schedule_enrollments e
  where e.academy_id = p_academy_id
    and e.student_id = p_student_id
    and e.status = 'active'
    and e.effective_from <= v_date
    and (e.effective_to is null or e.effective_to >= v_date);

  if v_count <> 2 then
    return jsonb_build_object('ok', false, 'message', '주 2회 정규수업인 학생만 회차를 변경할 수 있습니다.');
  end if;
  if not coalesce(v_selected_exists, false) then
    return jsonb_build_object('ok', false, 'message', '선택한 정규수업을 찾을 수 없습니다.');
  end if;

  update public.olli_schedule_enrollments e
     set session_order = case
       when e.id = p_enrollment_id then p_session_order::smallint
       else (3 - p_session_order)::smallint
     end,
         updated_at = now()
   where e.academy_id = p_academy_id
     and e.student_id = p_student_id
     and e.status = 'active'
     and e.effective_from <= v_date
     and (e.effective_to is null or e.effective_to >= v_date);

  perform private.olli_schedule_sync_student_teacher(p_student_id, v_date, true);

  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', e.id, 'session_order', e.session_order)
      order by e.session_order, e.weekday, e.time_slot, e.class_group
    ),
    '[]'::jsonb
  )
  into v_orders
  from public.olli_schedule_enrollments e
  where e.academy_id = p_academy_id
    and e.student_id = p_student_id
    and e.status = 'active'
    and e.effective_from <= v_date
    and (e.effective_to is null or e.effective_to >= v_date);

  return jsonb_build_object('ok', true, 'session_orders', v_orders);
end;
$$;

revoke all on function public.olli_schedule_class_teacher_context(text, uuid) from public;
revoke all on function public.olli_schedule_set_class_teacher(text, uuid, text, integer, integer, text, uuid) from public;
revoke all on function public.olli_schedule_set_session_order(text, uuid, uuid, uuid, integer, date) from public;
grant execute on function public.olli_schedule_class_teacher_context(text, uuid) to anon, authenticated;
grant execute on function public.olli_schedule_set_class_teacher(text, uuid, text, integer, integer, text, uuid) to anon, authenticated;
grant execute on function public.olli_schedule_set_session_order(text, uuid, uuid, uuid, integer, date) to anon, authenticated;
