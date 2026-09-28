begin;

alter table public.olli_schedule_waitlist
  add column if not exists guest_name text,
  add column if not exists guest_division text;

alter table public.olli_schedule_waitlist
  alter column student_id drop not null;

alter table public.olli_schedule_waitlist
  drop constraint if exists olli_schedule_waitlist_guest_identity_check;
alter table public.olli_schedule_waitlist
  add constraint olli_schedule_waitlist_guest_identity_check check (
    (student_id is not null and guest_name is null and guest_division is null)
    or
    (student_id is null and nullif(btrim(guest_name), '') is not null and guest_division in ('elementary','kinder'))
  );

alter table public.olli_schedule_one_time_sessions
  add column if not exists guest_name text,
  add column if not exists guest_division text;

alter table public.olli_schedule_one_time_sessions
  alter column student_id drop not null;

alter table public.olli_schedule_one_time_sessions
  drop constraint if exists olli_schedule_one_time_sessions_session_type_check;
alter table public.olli_schedule_one_time_sessions
  add constraint olli_schedule_one_time_sessions_session_type_check check (session_type in ('makeup','trial'));

alter table public.olli_schedule_one_time_sessions
  drop constraint if exists olli_schedule_one_time_sessions_guest_identity_check;
alter table public.olli_schedule_one_time_sessions
  add constraint olli_schedule_one_time_sessions_guest_identity_check check (
    (student_id is not null and guest_name is null and guest_division is null and session_type = 'makeup')
    or
    (student_id is null and nullif(btrim(guest_name), '') is not null and guest_division in ('elementary','kinder') and session_type = 'trial')
  );

create unique index if not exists olli_schedule_trial_active_guest_slot_key
on public.olli_schedule_one_time_sessions (
  academy_id, lower(guest_name), session_date, time_slot, class_group
)
where student_id is null and session_type = 'trial' and status <> 'cancelled';

create or replace function public.olli_schedule_add_guest_entry(
  p_session_token text,
  p_academy_id uuid,
  p_guest_name text,
  p_division text,
  p_entry_type text,
  p_session_date date,
  p_time_slot integer,
  p_class_group text default 'A'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_name text := left(btrim(coalesce(p_guest_name, '')), 60);
  v_division text := lower(btrim(coalesce(p_division, '')));
  v_entry_type text := lower(btrim(coalesce(p_entry_type, '')));
  v_class_group text := upper(coalesce(nullif(btrim(p_class_group), ''), 'A'));
  v_weekday integer;
  v_capacity integer;
  v_occupancy integer;
  v_id uuid;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null or not exists (
    select 1 from public.academy_members m
    where m.academy_id = p_academy_id
      and m.account_id = v_account_id
      and m.status = 'active'
      and m.role in ('owner','manager','teacher')
  ) then
    return jsonb_build_object('ok', false, 'message', '시간표를 변경할 권한이 없습니다.');
  end if;

  if v_name = '' then
    return jsonb_build_object('ok', false, 'message', '학생 이름을 입력해 주세요.');
  end if;
  if v_division not in ('elementary','kinder') then
    return jsonb_build_object('ok', false, 'message', '초등부 또는 유치부를 확인해 주세요.');
  end if;
  if v_entry_type not in ('wait','trial') then
    return jsonb_build_object('ok', false, 'message', '등록 유형을 확인해 주세요.');
  end if;
  if p_session_date is null or p_session_date < current_date then
    return jsonb_build_object('ok', false, 'message', '등록 날짜를 확인해 주세요.');
  end if;

  v_weekday := extract(isodow from p_session_date)::integer;
  if v_weekday not between 1 and 6 then
    return jsonb_build_object('ok', false, 'message', '일요일에는 등록할 수 없습니다.');
  end if;
  if private.olli_schedule_is_closed_day(p_academy_id, p_session_date) then
    return jsonb_build_object('ok', false, 'message', '공휴일에는 등록할 수 없습니다. 정상수업으로 전환한 뒤 다시 시도해 주세요.');
  end if;

  if (v_division = 'elementary' and v_weekday = 6 and p_time_slot not in (10,11,12))
     or (v_division = 'elementary' and v_weekday <> 6 and p_time_slot not between 1 and 6)
     or (v_division = 'kinder' and p_time_slot not in (4,5)) then
    return jsonb_build_object('ok', false, 'message', '선택한 날짜의 수업 시간을 확인해 주세요.');
  end if;

  if not private.olli_schedule_group_is_enabled(p_academy_id, v_division, v_weekday, p_time_slot) then
    v_class_group := 'A';
  elsif v_class_group not in ('A','B') then
    return jsonb_build_object('ok', false, 'message', '수업 반을 A반 또는 B반으로 선택해 주세요.');
  end if;

  perform set_config('olli.actor_account_id', v_account_id::text, true);

  if v_entry_type = 'wait' then
    perform set_config('olli.schedule_action', 'guest_wait_add', true);
    perform pg_advisory_xact_lock(hashtextextended(
      p_academy_id::text || ':wait:' || v_division || ':' || v_weekday::text || ':' || p_time_slot::text,
      0
    ));

    if exists (
      select 1 from public.olli_schedule_waitlist w
      where w.academy_id = p_academy_id
        and w.target_weekday = v_weekday
        and w.target_time_slot = p_time_slot
        and w.status in ('waiting','offered')
    ) then
      return jsonb_build_object('ok', false, 'message', '이 시간에는 이미 대기 학생이 있습니다.', 'waitlist_full', true);
    end if;

    insert into public.olli_schedule_waitlist (
      academy_id, student_id, guest_name, guest_division,
      target_weekday, target_time_slot, target_class_group,
      request_type, source_enrollment_id, desired_effective_date
    ) values (
      p_academy_id, null, v_name, v_division,
      v_weekday, p_time_slot, v_class_group,
      'add', null, p_session_date
    ) returning id into v_id;

    return jsonb_build_object('ok', true, 'result', 'waitlisted', 'waitlist_id', v_id, 'guest', true);
  end if;

  perform set_config('olli.schedule_action', 'trial_add', true);
  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':trial:' || v_division || ':' || p_session_date::text || ':' || p_time_slot::text || ':' || v_class_group,
    0
  ));

  if exists (
    select 1 from public.olli_schedule_one_time_sessions o
    where o.academy_id = p_academy_id
      and o.student_id is null
      and o.session_type = 'trial'
      and lower(btrim(o.guest_name)) = lower(v_name)
      and o.session_date = p_session_date
      and o.time_slot = p_time_slot
      and o.class_group = v_class_group
      and o.status <> 'cancelled'
  ) then
    return jsonb_build_object('ok', false, 'message', '같은 이름의 체험수업이 이미 등록되어 있습니다.');
  end if;

  v_capacity := private.olli_schedule_capacity(p_academy_id, v_division);
  select
    (select count(*)
       from public.olli_schedule_enrollments e
       join public.students s on s.id = e.student_id
      where e.academy_id = p_academy_id
        and s.division = v_division
        and e.weekday = v_weekday
        and e.time_slot = p_time_slot
        and e.class_group = v_class_group
        and e.status = 'active'
        and e.effective_from <= p_session_date
        and (e.effective_to is null or e.effective_to >= p_session_date))
    +
    (select count(*)
       from public.olli_schedule_one_time_sessions o
       left join public.students s on s.id = o.student_id
      where o.academy_id = p_academy_id
        and coalesce(s.division, o.guest_division) = v_division
        and o.session_date = p_session_date
        and o.time_slot = p_time_slot
        and o.class_group = v_class_group
        and o.status <> 'cancelled')
  into v_occupancy;

  if v_occupancy >= v_capacity then
    return jsonb_build_object('ok', false, 'message', '선택한 날짜와 시간의 정원이 가득 찼습니다.', 'full', true);
  end if;

  insert into public.olli_schedule_one_time_sessions (
    academy_id, student_id, guest_name, guest_division,
    session_date, time_slot, class_group, session_type, note
  ) values (
    p_academy_id, null, v_name, v_division,
    p_session_date, p_time_slot, v_class_group, 'trial', ''
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'result', 'scheduled', 'one_time_session_id', v_id, 'guest', true, 'session_type', 'trial');
end;
$$;

revoke all on function public.olli_schedule_add_guest_entry(text, uuid, text, text, text, date, integer, text) from public;
grant execute on function public.olli_schedule_add_guest_entry(text, uuid, text, text, text, date, integer, text) to anon, authenticated, service_role;

create or replace function public.olli_schedule_week(
  p_session_token text,
  p_academy_id uuid,
  p_week_start date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_week_start date := coalesce(p_week_start, current_date - (extract(isodow from current_date)::integer - 1));
  v_week_end date;
  v_enrollments jsonb;
  v_waitlist jsonb;
  v_one_time jsonb;
  v_changes jsonb;
  v_attendance jsonb;
  v_pickups jsonb;
  v_class_splits jsonb;
  v_cell_memos jsonb;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '시간표를 볼 권한이 없습니다.');
  end if;
  v_week_end := v_week_start + 5;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.weekday, x.time_slot, x.student_name), '[]'::jsonb)
  into v_enrollments
  from (
    select e.id, e.student_id, s.name as student_name, s.division,
           e.weekday, e.time_slot, e.class_group, e.session_order,
           e.effective_from, e.effective_to, e.source
    from public.olli_schedule_enrollments e
    join public.students s on s.id = e.student_id
    where e.academy_id = p_academy_id and e.status = 'active'
      and e.effective_from <= v_week_end
      and (e.effective_to is null or e.effective_to >= v_week_start)
      and s.status = 'active'
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.target_weekday, x.target_time_slot, x.requested_at), '[]'::jsonb)
  into v_waitlist
  from (
    select w.id, w.student_id,
           coalesce(s.name, w.guest_name) as student_name,
           coalesce(s.division, w.guest_division) as division,
           (w.student_id is null) as is_guest,
           w.target_weekday, w.target_time_slot, w.target_class_group, w.request_type,
           w.source_enrollment_id, w.desired_effective_date, w.status, w.requested_at
    from public.olli_schedule_waitlist w
    left join public.students s on s.id = w.student_id
    where w.academy_id = p_academy_id and w.status in ('waiting','offered')
      and (w.requested_at at time zone 'Asia/Seoul')::date <= v_week_end
      and (w.student_id is null or s.status = 'active')
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.session_date, x.time_slot, x.student_name), '[]'::jsonb)
  into v_one_time
  from (
    select o.id, o.student_id,
           coalesce(s.name, o.guest_name) as student_name,
           coalesce(s.division, o.guest_division) as division,
           (o.student_id is null) as is_guest,
           o.session_date, o.time_slot, o.class_group, o.session_type, o.status, o.note
    from public.olli_schedule_one_time_sessions o
    left join public.students s on s.id = o.student_id
    where o.academy_id = p_academy_id
      and o.session_date between v_week_start and v_week_end
      and o.status <> 'cancelled'
      and (o.student_id is null or s.status = 'active')
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.effective_date, x.student_name), '[]'::jsonb)
  into v_changes
  from (
    select c.id, c.student_id, s.name as student_name, s.division,
           c.change_type, c.source_enrollment_id, c.target_enrollment_id,
           c.target_class_group, c.effective_date, c.status, c.waitlist_id
    from public.olli_schedule_changes c
    join public.students s on s.id = c.student_id
    where c.academy_id = p_academy_id and c.status in ('scheduled','applied')
      and c.effective_date >= v_week_start - 35
      and c.effective_date <= v_week_end + 365
  ) x;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.session_date, a.time_slot, a.student_id), '[]'::jsonb)
  into v_attendance
  from (
    select id, student_id, session_date, time_slot, class_group, session_kind, marked_at
    from public.olli_schedule_attendance
    where academy_id = p_academy_id and session_date between v_week_start and v_week_end
  ) a;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.weekday, x.class_time, x.pickup_time, x.student_name), '[]'::jsonb)
  into v_pickups
  from (
    select p.id, p.student_id, s.name as student_name, p.weekday, p.class_time,
           p.pickup_label, p.pickup_time, p.effective_from, p.effective_to
    from public.olli_schedule_pickups p
    join public.students s on s.id = p.student_id
    where p.academy_id = p_academy_id and p.status = 'active'
      and p.effective_from <= v_week_end
      and (p.effective_to is null or p.effective_to >= v_week_start)
      and s.status = 'active'
  ) x;

  select coalesce(
    jsonb_agg(jsonb_build_object('weekday', s.weekday, 'time_slot', s.time_slot) order by s.weekday, s.time_slot),
    '[]'::jsonb
  )
  into v_class_splits
  from public.olli_schedule_class_splits s
  where s.academy_id = p_academy_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', m.id,
        'division', m.division,
        'session_date', m.session_date,
        'time_slot', m.time_slot,
        'note', m.note,
        'updated_at', m.updated_at
      )
      order by m.session_date, m.time_slot, m.division
    ),
    '[]'::jsonb
  )
  into v_cell_memos
  from public.olli_schedule_cell_memos m
  where m.academy_id = p_academy_id
    and m.session_date between v_week_start and v_week_end;

  return jsonb_build_object(
    'ok', true,
    'week_start', v_week_start,
    'week_end', v_week_end,
    'elementary_capacity', coalesce((select st.elementary_capacity from public.olli_schedule_settings st where st.academy_id = p_academy_id), 5),
    'kinder_capacity', 5,
    'waitlist_capacity', coalesce((select st.waitlist_capacity from public.olli_schedule_settings st where st.academy_id = p_academy_id), 1),
    'enrollments', v_enrollments,
    'waitlist', v_waitlist,
    'one_time_sessions', v_one_time,
    'changes', v_changes,
    'attendance', v_attendance,
    'pickups', v_pickups,
    'class_splits', v_class_splits,
    'cell_memos', v_cell_memos
  );
end;
$$;

commit;
