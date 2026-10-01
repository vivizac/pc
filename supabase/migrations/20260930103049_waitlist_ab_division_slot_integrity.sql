-- Make active waitlist slots independent by division and A/B class group.
-- Existing rows are backfilled without deletion, and pre-migration audit history remains restorable.

alter table public.olli_schedule_waitlist
  add column if not exists target_division text;

CREATE OR REPLACE FUNCTION private.olli_schedule_waitlist_fill_target_division()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_division text;
begin
  if new.student_id is not null then
    select lower(btrim(s.division)) into v_division
    from public.students s
    where s.id = new.student_id
      and s.academy_id = new.academy_id;
  else
    v_division := lower(nullif(btrim(new.guest_division), ''));
  end if;
  if v_division not in ('elementary','kinder') then
    raise exception '대기 수업 구분을 확인해 주세요.';
  end if;
  new.target_division := v_division;
  return new;
end;
$function$;

revoke all on function private.olli_schedule_waitlist_fill_target_division() from public, anon, authenticated;

drop trigger if exists olli_schedule_waitlist_fill_target_division_trg on public.olli_schedule_waitlist;
create trigger olli_schedule_waitlist_fill_target_division_trg
before insert or update of academy_id, student_id, guest_division, target_division
on public.olli_schedule_waitlist
for each row execute function private.olli_schedule_waitlist_fill_target_division();

update public.olli_schedule_waitlist w
set target_division = coalesce(
  (
    select lower(btrim(s.division))
    from public.students s
    where s.id = w.student_id
      and s.academy_id = w.academy_id
  ),
  lower(nullif(btrim(w.guest_division), ''))
)
where w.target_division is null;

do $block$
begin
  if exists (
    select 1
    from public.olli_schedule_waitlist w
    where w.target_division is null
       or w.target_division not in ('elementary','kinder')
  ) then
    raise exception '기존 대기 데이터의 수업 구분을 복원할 수 없습니다.';
  end if;
end;
$block$;

alter table public.olli_schedule_waitlist
  alter column target_division set not null;

alter table public.olli_schedule_waitlist
  drop constraint if exists olli_schedule_waitlist_target_division_check;
alter table public.olli_schedule_waitlist
  add constraint olli_schedule_waitlist_target_division_check
  check (target_division in ('elementary','kinder'));

drop index if exists public.olli_schedule_waitlist_one_active_per_slot_idx;
drop index if exists public.olli_schedule_waitlist_one_active_per_class_slot_idx;
create unique index olli_schedule_waitlist_one_active_per_class_slot_idx
  on public.olli_schedule_waitlist (
    academy_id,
    target_division,
    target_weekday,
    target_time_slot,
    target_class_group
  )
  where status in ('waiting','offered');

CREATE OR REPLACE FUNCTION public.olli_schedule_add_waitlist(p_session_token text, p_academy_id uuid, p_student_id uuid, p_target_weekday integer, p_target_time_slot integer, p_effective_date date, p_target_class_group text DEFAULT 'A'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_effective_date date := coalesce(p_effective_date, current_date);
  v_division text;
  v_class_group text := upper(coalesce(nullif(btrim(p_target_class_group), ''), 'A'));
  v_waitlist_id uuid;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '대기를 등록할 권한이 없습니다.');
  end if;
  if p_target_weekday not between 1 and 6 or v_effective_date < current_date then
    return jsonb_build_object('ok', false, 'message', '대기 등록 날짜와 요일을 확인해 주세요.');
  end if;

  select s.division into v_division
  from public.students s
  where s.id = p_student_id
    and s.academy_id = p_academy_id
    and s.status = 'active';
  if v_division is null then
    return jsonb_build_object('ok', false, 'message', '학생을 찾을 수 없습니다.');
  end if;
  if (v_division = 'elementary' and p_target_weekday = 6 and p_target_time_slot not in (10, 11, 12))
     or (v_division = 'elementary' and p_target_weekday <> 6 and p_target_time_slot not between 1 and 6)
     or (v_division = 'kinder' and p_target_time_slot not in (4, 5)) then
    return jsonb_build_object('ok', false, 'message', '선택한 요일의 수업 시간을 확인해 주세요.');
  end if;
  if not private.olli_schedule_group_is_enabled(p_academy_id, v_division, p_target_weekday, p_target_time_slot, private.olli_schedule_first_occurrence_on_or_after(v_effective_date, p_target_weekday)) then
    v_class_group := 'A';
  elsif v_class_group not in ('A', 'B') then
    return jsonb_build_object('ok', false, 'message', '수업 반을 A반 또는 B반으로 선택해 주세요.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':wait:' || v_division || ':' || p_target_weekday::text || ':' || p_target_time_slot::text || ':' || v_class_group,
    0
  ));
  if exists (
    select 1
    from public.olli_schedule_enrollments e
    where e.academy_id = p_academy_id
      and e.student_id = p_student_id
      and e.weekday = p_target_weekday
      and e.time_slot = p_target_time_slot
      and e.status = 'active'
      and e.effective_from <= v_effective_date
      and (e.effective_to is null or e.effective_to >= v_effective_date)
  ) then
    return jsonb_build_object('ok', false, 'message', '이미 같은 요일과 시간에 등록된 학생입니다.');
  end if;
  if exists (
    select 1
    from public.olli_schedule_waitlist w
    where w.academy_id = p_academy_id
      and w.target_division = v_division
      and w.target_weekday = p_target_weekday
      and w.target_time_slot = p_target_time_slot
      and w.target_class_group = v_class_group
      and w.status in ('waiting', 'offered')
  ) then
    return jsonb_build_object('ok', false, 'message', '이 반에는 이미 대기 학생이 있습니다.', 'waitlist_full', true);
  end if;

  insert into public.olli_schedule_waitlist (
    academy_id, student_id, target_division, target_weekday, target_time_slot, target_class_group,
    request_type, source_enrollment_id, desired_effective_date
  ) values (
    p_academy_id, p_student_id, v_division, p_target_weekday, p_target_time_slot, v_class_group,
    'add', null, v_effective_date
  ) returning id into v_waitlist_id;
  return jsonb_build_object('ok', true, 'result', 'waitlisted', 'waitlist_id', v_waitlist_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.olli_schedule_add_guest_entry(p_session_token text, p_academy_id uuid, p_guest_name text, p_division text, p_entry_type text, p_session_date date, p_time_slot integer, p_class_group text DEFAULT 'A'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if not private.olli_schedule_group_is_enabled(p_academy_id, v_division, v_weekday, p_time_slot, p_session_date) then
    v_class_group := 'A';
  elsif v_class_group not in ('A','B') then
    return jsonb_build_object('ok', false, 'message', '수업 반을 A반 또는 B반으로 선택해 주세요.');
  end if;

  perform set_config('olli.actor_account_id', v_account_id::text, true);

  if v_entry_type = 'wait' then
    perform set_config('olli.schedule_action', 'guest_wait_add', true);
    perform pg_advisory_xact_lock(hashtextextended(
      p_academy_id::text || ':wait:' || v_division || ':' || v_weekday::text || ':' || p_time_slot::text || ':' || v_class_group,
      0
    ));

    if exists (
      select 1 from public.olli_schedule_waitlist w
      where w.academy_id = p_academy_id
        and w.target_division = v_division
        and w.target_weekday = v_weekday
        and w.target_time_slot = p_time_slot
        and w.target_class_group = v_class_group
        and w.status in ('waiting','offered')
    ) then
      return jsonb_build_object('ok', false, 'message', '이 시간에는 이미 대기 학생이 있습니다.', 'waitlist_full', true);
    end if;

    insert into public.olli_schedule_waitlist (
      academy_id, student_id, guest_name, guest_division, target_division,
      target_weekday, target_time_slot, target_class_group,
      request_type, source_enrollment_id, desired_effective_date
    ) values (
      p_academy_id, null, v_name, v_division, v_division,
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
$function$;

CREATE OR REPLACE FUNCTION public.olli_schedule_update_waitlist_target(p_session_token text, p_academy_id uuid, p_waitlist_id uuid, p_target_weekday integer DEFAULT NULL::integer, p_target_time_slot integer DEFAULT NULL::integer, p_target_class_group text DEFAULT NULL::text, p_desired_effective_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_wait public.olli_schedule_waitlist%rowtype;
  v_division text;
  v_weekday integer;
  v_time integer;
  v_group text;
  v_effective date;
  v_account_id uuid;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '대기 명단을 변경할 권한이 없습니다.');
  end if;

  if p_waitlist_id is null then
    return jsonb_build_object('ok', false, 'message', '변경할 대기 정보를 확인해 주세요.');
  end if;

  select w.* into v_wait
  from public.olli_schedule_waitlist w
  where w.id = p_waitlist_id
    and w.academy_id = p_academy_id
    and w.status in ('waiting', 'offered')
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', '변경할 대기 정보를 찾을 수 없습니다.');
  end if;

  if v_wait.student_id is not null then
    select s.division into v_division
    from public.students s
    where s.id = v_wait.student_id
      and s.academy_id = p_academy_id
      and s.status = 'active'
      and coalesce(s.is_deleted, false) = false;
  else
    v_division := nullif(btrim(v_wait.guest_division), '');
  end if;

  if v_division is null then
    return jsonb_build_object('ok', false, 'message', '대기 학생의 수업 구분을 찾을 수 없습니다.');
  end if;

  v_weekday := coalesce(p_target_weekday, v_wait.target_weekday);
  v_time := coalesce(p_target_time_slot, v_wait.target_time_slot);
  v_group := upper(coalesce(nullif(btrim(p_target_class_group), ''), nullif(btrim(v_wait.target_class_group), ''), 'A'));
  v_effective := coalesce(p_desired_effective_date, v_wait.desired_effective_date, current_date);

  if v_weekday not between 1 and 6 or v_effective < current_date then
    return jsonb_build_object('ok', false, 'message', '대기 날짜와 요일을 확인해 주세요.');
  end if;

  if not private.olli_schedule_slot_is_valid(
    p_academy_id,
    v_division,
    v_weekday,
    v_time
  ) then
    return jsonb_build_object('ok', false, 'message', '선택한 요일의 수업 시간을 확인해 주세요.');
  end if;

  if not private.olli_schedule_group_is_enabled(
    p_academy_id,
    v_division,
    v_weekday,
    v_time,
    private.olli_schedule_first_occurrence_on_or_after(v_effective, v_weekday)
  ) then
    v_group := 'A';
  elsif v_group not in ('A', 'B') then
    return jsonb_build_object('ok', false, 'message', '수업 반을 A반 또는 B반으로 선택해 주세요.');
  end if;

  if v_weekday = v_wait.target_weekday
     and v_time = v_wait.target_time_slot
     and v_group = upper(coalesce(nullif(btrim(v_wait.target_class_group), ''), 'A'))
     and v_effective = coalesce(v_wait.desired_effective_date, current_date) then
    return jsonb_build_object(
      'ok', true,
      'result', 'unchanged',
      'waitlist_id', v_wait.id,
      'target_weekday', v_wait.target_weekday,
      'target_time_slot', v_wait.target_time_slot,
      'target_class_group', upper(coalesce(nullif(btrim(v_wait.target_class_group), ''), 'A')),
      'desired_effective_date', v_wait.desired_effective_date,
      'unchanged', true
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':waitlist-update:' || v_wait.id::text,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':wait:' || v_division || ':' || v_weekday::text || ':' || v_time::text || ':' || v_group,
    0
  ));

  if v_wait.student_id is not null and exists (
    select 1
    from public.olli_schedule_enrollments e
    where e.academy_id = p_academy_id
      and e.student_id = v_wait.student_id
      and e.weekday = v_weekday
      and e.time_slot = v_time
      and e.status = 'active'
      and e.effective_from <= v_effective
      and (e.effective_to is null or e.effective_to >= v_effective)
  ) then
    return jsonb_build_object('ok', false, 'message', '이미 같은 요일과 시간에 등록된 학생입니다.');
  end if;

  if exists (
    select 1
    from public.olli_schedule_waitlist w
    where w.academy_id = p_academy_id
      and w.target_division = v_division
      and w.target_weekday = v_weekday
      and w.target_time_slot = v_time
      and w.target_class_group = v_group
      and w.status in ('waiting', 'offered')
      and w.id <> v_wait.id
  ) then
    return jsonb_build_object('ok', false, 'message', '이 시간에는 이미 다른 대기 학생이 있습니다.', 'waitlist_full', true);
  end if;

  v_account_id := public.olli_account_id_from_session(p_session_token);
  perform set_config('olli.actor_account_id', coalesce(v_account_id::text, ''), true);
  perform set_config('olli.schedule_effective_date', v_effective::text, true);
  perform set_config('olli.schedule_action', 'waitlist_target_change', true);

  update public.olli_schedule_waitlist
  set target_division = v_division,
      target_weekday = v_weekday,
      target_time_slot = v_time,
      target_class_group = v_group,
      desired_effective_date = v_effective,
      updated_at = now()
  where id = v_wait.id
    and academy_id = p_academy_id;

  return jsonb_build_object(
    'ok', true,
    'result', 'updated',
    'waitlist_id', v_wait.id,
    'old_target_weekday', v_wait.target_weekday,
    'old_target_time_slot', v_wait.target_time_slot,
    'old_target_class_group', upper(coalesce(nullif(btrim(v_wait.target_class_group), ''), 'A')),
    'old_desired_effective_date', v_wait.desired_effective_date,
    'target_weekday', v_weekday,
    'target_time_slot', v_time,
    'target_class_group', v_group,
    'desired_effective_date', v_effective,
    'unchanged', false
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'message', '이 시간에는 이미 다른 대기 학생이 있습니다.', 'waitlist_full', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.olli_schedule_change(p_session_token text, p_academy_id uuid, p_student_id uuid, p_source_enrollment_id uuid, p_target_weekday integer, p_target_time_slot integer, p_effective_date date, p_change_type text, p_allow_wait boolean, p_target_class_group text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_effective date := coalesce(p_effective_date, current_date);
  v_division text;
  v_class_group text := upper(coalesce(nullif(btrim(p_target_class_group), ''), 'A'));
  v_capacity integer;
  v_occupancy integer;
  v_target_id uuid;
  v_change_id uuid;
  v_wait_id uuid;
  v_source public.olli_schedule_enrollments%rowtype;
  v_target_order smallint;
  v_existing_count integer;
  v_existing_id uuid;
  v_existing_order smallint;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '시간표를 변경할 권한이 없습니다.');
  end if;
  if p_target_weekday not between 1 and 6 or p_change_type not in ('move','add') or v_effective < current_date then
    return jsonb_build_object('ok', false, 'message', '수업 변경 값을 확인해 주세요.');
  end if;

  select s.division into v_division
  from public.students s
  where s.id = p_student_id and s.academy_id = p_academy_id and s.status = 'active';
  if v_division is null then
    return jsonb_build_object('ok', false, 'message', '학생을 찾을 수 없습니다.');
  end if;
  if not private.olli_schedule_slot_is_valid(p_academy_id, v_division, p_target_weekday, p_target_time_slot) then
    return jsonb_build_object('ok', false, 'message', '선택한 요일의 수업 시간을 확인해 주세요.');
  end if;
  if not private.olli_schedule_group_is_enabled(p_academy_id, v_division, p_target_weekday, p_target_time_slot, private.olli_schedule_first_occurrence_on_or_after(v_effective, p_target_weekday)) then
    v_class_group := 'A';
  elsif v_class_group not in ('A','B') then
    return jsonb_build_object('ok', false, 'message', '수업 반을 A반 또는 B반으로 선택해 주세요.');
  end if;

  if p_change_type = 'move' then
    select * into v_source
    from public.olli_schedule_enrollments e
    where e.id = p_source_enrollment_id
      and e.academy_id = p_academy_id
      and e.student_id = p_student_id
      and e.status = 'active';
    if not found then
      return jsonb_build_object('ok', false, 'message', '이동할 기존 수업을 선택해 주세요.');
    end if;
    if v_source.weekday = p_target_weekday
       and v_source.time_slot = p_target_time_slot
       and coalesce(v_source.class_group,'A') = v_class_group then
      return jsonb_build_object('ok', true, 'result', 'unchanged', 'message', '현재 수업과 같은 시간입니다.');
    end if;
    v_target_order := v_source.session_order;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':' || p_target_weekday::text || ':' || p_target_time_slot::text || ':' || v_class_group,
    0
  ));

  if exists (
    select 1 from public.olli_schedule_enrollments e
    where e.academy_id = p_academy_id
      and e.student_id = p_student_id
      and e.weekday = p_target_weekday
      and e.time_slot = p_target_time_slot
      and e.status = 'active'
      and e.effective_from <= v_effective
      and (e.effective_to is null or e.effective_to >= v_effective)
      and (p_change_type <> 'move' or e.id <> p_source_enrollment_id)
  ) then
    return jsonb_build_object('ok', false, 'message', '이미 같은 요일과 시간에 등록되어 있습니다.');
  end if;

  v_capacity := private.olli_schedule_capacity(p_academy_id, v_division);
  select
    (select count(*)
       from public.olli_schedule_enrollments e
       join public.students s on s.id=e.student_id
      where e.academy_id=p_academy_id and s.division=v_division
        and e.weekday=p_target_weekday and e.time_slot=p_target_time_slot
        and (private.olli_schedule_timetable_mode(p_academy_id)='half_hour' or e.class_group=v_class_group)
        and e.status='active'
        and e.effective_from<=v_effective and (e.effective_to is null or e.effective_to>=v_effective)
        and (p_change_type<>'move' or e.id<>p_source_enrollment_id))
    +
    (select count(*)
       from public.olli_schedule_one_time_sessions o
       left join public.students s on s.id=o.student_id
      where o.academy_id=p_academy_id
        and coalesce(s.division, o.guest_division)=v_division
        and o.session_date=v_effective and o.time_slot=p_target_time_slot
        and (private.olli_schedule_timetable_mode(p_academy_id)='half_hour' or o.class_group=v_class_group)
        and o.status<>'cancelled')
  into v_occupancy;

  if v_occupancy >= v_capacity then
    if not coalesce(p_allow_wait,true) then
      return jsonb_build_object('ok',false,'message','선택한 시간의 정원이 가득 찼습니다.','full',true);
    end if;
    if exists (
      select 1 from public.olli_schedule_waitlist w
      where w.academy_id=p_academy_id
        and w.target_division=v_division
        and w.target_weekday=p_target_weekday
        and w.target_time_slot=p_target_time_slot
        and w.target_class_group=v_class_group
        and w.status in('waiting','offered')
    ) then
      return jsonb_build_object('ok',false,'message','이 시간에는 이미 대기 학생이 있습니다.','waitlist_full',true);
    end if;
    insert into public.olli_schedule_waitlist(
      academy_id,student_id,target_division,target_weekday,target_time_slot,target_class_group,
      request_type,source_enrollment_id,desired_effective_date
    ) values (
      p_academy_id,p_student_id,v_division,p_target_weekday,p_target_time_slot,v_class_group,
      p_change_type,case when p_change_type='move' then p_source_enrollment_id else null end,v_effective
    ) returning id into v_wait_id;
    return jsonb_build_object('ok',true,'result','waitlisted','waitlist_id',v_wait_id);
  end if;

  if p_change_type = 'add' then
    select count(*) into v_existing_count
    from public.olli_schedule_enrollments e
    where e.academy_id = p_academy_id
      and e.student_id = p_student_id
      and e.status = 'active'
      and e.effective_from <= v_effective
      and (e.effective_to is null or e.effective_to >= v_effective);

    if v_existing_count = 0 then
      v_target_order := 1;
    elsif v_existing_count = 1 then
      select e.id, e.session_order into v_existing_id, v_existing_order
      from public.olli_schedule_enrollments e
      where e.academy_id = p_academy_id
        and e.student_id = p_student_id
        and e.status = 'active'
        and e.effective_from <= v_effective
        and (e.effective_to is null or e.effective_to >= v_effective)
      limit 1;
      if v_existing_order is null or v_existing_order not in (1,2) then
        v_existing_order := 1;
        update public.olli_schedule_enrollments set session_order = 1, updated_at = now() where id = v_existing_id;
      end if;
      v_target_order := (3 - v_existing_order)::smallint;
    else
      v_target_order := null;
    end if;
  end if;

  if p_change_type = 'move' then
    if v_effective <= v_source.effective_from then
      update public.olli_schedule_enrollments set status='cancelled', updated_at=now() where id=v_source.id;
    else
      update public.olli_schedule_enrollments set effective_to=v_effective - 1, updated_at=now() where id=v_source.id;
    end if;
  end if;

  insert into public.olli_schedule_enrollments(
    academy_id,student_id,weekday,time_slot,class_group,session_order,effective_from,source
  ) values (
    p_academy_id,p_student_id,p_target_weekday,p_target_time_slot,v_class_group,v_target_order,v_effective,
    case when p_change_type='move' then 'move' else 'add' end
  ) returning id into v_target_id;

  insert into public.olli_schedule_changes(
    academy_id,student_id,change_type,source_enrollment_id,target_enrollment_id,
    target_class_group,effective_date,status
  ) values (
    p_academy_id,p_student_id,p_change_type,
    case when p_change_type='move' then p_source_enrollment_id else null end,
    v_target_id,v_class_group,v_effective,
    case when v_effective<=current_date then 'applied' else 'scheduled' end
  ) returning id into v_change_id;

  if v_effective <= current_date then
    perform private.olli_schedule_sync_student(p_student_id,current_date);
  end if;
  return jsonb_build_object(
    'ok',true,
    'result',case when v_effective<=current_date then 'applied' else 'scheduled' end,
    'change_id',v_change_id,
    'target_enrollment_id',v_target_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.olli_schedule_change(p_session_token text, p_academy_id uuid, p_student_id uuid, p_source_enrollment_id uuid, p_target_weekday integer, p_target_time_slot integer, p_effective_date date, p_change_type text, p_allow_wait boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.olli_schedule_change(
    p_session_token,p_academy_id,p_student_id,p_source_enrollment_id,
    p_target_weekday,p_target_time_slot,p_effective_date,p_change_type,p_allow_wait,'A'
  );
$function$;

CREATE OR REPLACE FUNCTION public.olli_schedule_restore_history(p_session_token text, p_academy_id uuid, p_transaction_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_role text;
  v_item public.olli_schedule_audit_log%rowtype;
  v_current jsonb;
  v_restore_txid bigint;
  v_student_id uuid;
  v_found boolean := false;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  select m.role into v_role
  from public.academy_members m
  where m.academy_id = p_academy_id
    and m.account_id = v_account_id
    and m.status = 'active'
    and m.role in ('owner','manager')
  order by case m.role when 'owner' then 1 else 2 end
  limit 1;

  if v_role is null then
    return jsonb_build_object('ok', false, 'message', '시간표 복구는 원장 또는 관리자만 할 수 있습니다.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_academy_id::text || ':schedule-restore', 0));

  if not exists (
    select 1 from public.olli_schedule_audit_log a
    where a.academy_id = p_academy_id
      and a.transaction_id = p_transaction_id
      and a.created_at >= now() - interval '30 days'
  ) then
    return jsonb_build_object('ok', false, 'message', '복구할 변경 이력을 찾지 못했습니다.');
  end if;
  if exists (
    select 1 from public.olli_schedule_audit_log a
    where a.academy_id = p_academy_id
      and a.transaction_id = p_transaction_id
      and (a.restore_of_transaction_id is not null or a.restored_at is not null)
  ) then
    return jsonb_build_object('ok', false, 'message', '이미 복구했거나 복구 작업으로 생성된 이력입니다.');
  end if;

  -- Refuse a stale restore. A later edit to any affected row must be reviewed first.
  for v_item in
    select * from public.olli_schedule_audit_log a
    where a.academy_id = p_academy_id
      and a.transaction_id = p_transaction_id
    order by a.id
    for update
  loop
    v_found := true;
    v_current := null;
    if v_item.table_name = 'olli_schedule_enrollments' then
      select to_jsonb(e) into v_current from public.olli_schedule_enrollments e where e.id = v_item.row_id;
    elsif v_item.table_name = 'olli_schedule_waitlist' then
      select to_jsonb(w) into v_current from public.olli_schedule_waitlist w where w.id = v_item.row_id;
    elsif v_item.table_name = 'olli_schedule_changes' then
      select to_jsonb(c) into v_current from public.olli_schedule_changes c where c.id = v_item.row_id;
    else
      select to_jsonb(o) into v_current from public.olli_schedule_one_time_sessions o where o.id = v_item.row_id;
    end if;

    if v_item.operation in ('INSERT','UPDATE') then
      if v_current is null or
         (
           case
             when v_item.table_name = 'olli_schedule_waitlist'
               then v_current - 'updated_at' - 'target_division'
             else v_current - 'updated_at'
           end
         ) <>
         (
           case
             when v_item.table_name = 'olli_schedule_waitlist'
               then v_item.new_data - 'updated_at' - 'target_division'
             else v_item.new_data - 'updated_at'
           end
         ) then
        return jsonb_build_object(
          'ok', false,
          'conflict', true,
          'message', '이 변경 이후 같은 시간표가 다시 수정되었습니다. 최근 변경부터 확인해 주세요.'
        );
      end if;
    elsif v_item.operation = 'DELETE' and v_current is not null then
      return jsonb_build_object(
        'ok', false,
        'conflict', true,
        'message', '이 변경 이후 같은 시간표가 다시 생성되었습니다. 최근 변경부터 확인해 주세요.'
      );
    end if;
  end loop;

  if not v_found then
    return jsonb_build_object('ok', false, 'message', '복구할 변경 내용이 없습니다.');
  end if;

  v_restore_txid := txid_current();
  perform set_config('olli.actor_account_id', v_account_id::text, true);
  perform set_config('olli.schedule_action', 'restore', true);
  perform set_config('olli.restore_of_transaction_id', p_transaction_id::text, true);

  -- Reverse child rows before parent rows by replaying the audit in reverse order.
  for v_item in
    select * from public.olli_schedule_audit_log a
    where a.academy_id = p_academy_id
      and a.transaction_id = p_transaction_id
    order by a.id desc
  loop
    v_student_id := coalesce(v_student_id, v_item.student_id);
    if v_item.operation = 'INSERT' then
      if v_item.table_name = 'olli_schedule_changes' then
        delete from public.olli_schedule_changes where id = v_item.row_id;
      elsif v_item.table_name = 'olli_schedule_waitlist' then
        delete from public.olli_schedule_waitlist where id = v_item.row_id;
      elsif v_item.table_name = 'olli_schedule_one_time_sessions' then
        delete from public.olli_schedule_one_time_sessions where id = v_item.row_id;
      else
        delete from public.olli_schedule_enrollments where id = v_item.row_id;
      end if;
    elsif v_item.operation = 'UPDATE' then
      if v_item.table_name = 'olli_schedule_enrollments' then
        update public.olli_schedule_enrollments set
          academy_id = (v_item.old_data->>'academy_id')::uuid,
          student_id = (v_item.old_data->>'student_id')::uuid,
          weekday = (v_item.old_data->>'weekday')::smallint,
          time_slot = (v_item.old_data->>'time_slot')::smallint,
          effective_from = (v_item.old_data->>'effective_from')::date,
          effective_to = nullif(v_item.old_data->>'effective_to', '')::date,
          status = v_item.old_data->>'status',
          source = v_item.old_data->>'source',
          created_at = (v_item.old_data->>'created_at')::timestamptz,
          updated_at = now()
        where id = v_item.row_id;
      elsif v_item.table_name = 'olli_schedule_waitlist' then
        update public.olli_schedule_waitlist set
          academy_id = (v_item.old_data->>'academy_id')::uuid,
          student_id = (v_item.old_data->>'student_id')::uuid,
          guest_name = v_item.old_data->>'guest_name',
          guest_division = v_item.old_data->>'guest_division',
          target_weekday = (v_item.old_data->>'target_weekday')::smallint,
          target_time_slot = (v_item.old_data->>'target_time_slot')::smallint,
          target_class_group = coalesce(nullif(v_item.old_data->>'target_class_group', ''), 'A'),
          request_type = v_item.old_data->>'request_type',
          source_enrollment_id = nullif(v_item.old_data->>'source_enrollment_id', '')::uuid,
          desired_effective_date = nullif(v_item.old_data->>'desired_effective_date', '')::date,
          status = v_item.old_data->>'status',
          requested_at = (v_item.old_data->>'requested_at')::timestamptz,
          resolved_at = nullif(v_item.old_data->>'resolved_at', '')::timestamptz,
          updated_at = now()
        where id = v_item.row_id;
      elsif v_item.table_name = 'olli_schedule_changes' then
        update public.olli_schedule_changes set
          academy_id = (v_item.old_data->>'academy_id')::uuid,
          student_id = (v_item.old_data->>'student_id')::uuid,
          change_type = v_item.old_data->>'change_type',
          source_enrollment_id = nullif(v_item.old_data->>'source_enrollment_id', '')::uuid,
          target_enrollment_id = nullif(v_item.old_data->>'target_enrollment_id', '')::uuid,
          effective_date = (v_item.old_data->>'effective_date')::date,
          status = v_item.old_data->>'status',
          waitlist_id = nullif(v_item.old_data->>'waitlist_id', '')::uuid,
          created_at = (v_item.old_data->>'created_at')::timestamptz,
          updated_at = now(),
          cancelled_at = nullif(v_item.old_data->>'cancelled_at', '')::timestamptz
        where id = v_item.row_id;
      else
        update public.olli_schedule_one_time_sessions set
          academy_id = (v_item.old_data->>'academy_id')::uuid,
          student_id = (v_item.old_data->>'student_id')::uuid,
          session_date = (v_item.old_data->>'session_date')::date,
          time_slot = (v_item.old_data->>'time_slot')::smallint,
          session_type = v_item.old_data->>'session_type',
          status = v_item.old_data->>'status',
          note = coalesce(v_item.old_data->>'note', ''),
          created_at = (v_item.old_data->>'created_at')::timestamptz,
          updated_at = now()
        where id = v_item.row_id;
      end if;
    else
      if v_item.table_name = 'olli_schedule_changes' then
        insert into public.olli_schedule_changes
          select * from jsonb_populate_record(null::public.olli_schedule_changes, v_item.old_data);
      elsif v_item.table_name = 'olli_schedule_waitlist' then
        insert into public.olli_schedule_waitlist
          select * from jsonb_populate_record(null::public.olli_schedule_waitlist, v_item.old_data);
      elsif v_item.table_name = 'olli_schedule_one_time_sessions' then
        insert into public.olli_schedule_one_time_sessions
          select * from jsonb_populate_record(null::public.olli_schedule_one_time_sessions, v_item.old_data);
      else
        insert into public.olli_schedule_enrollments
          select * from jsonb_populate_record(null::public.olli_schedule_enrollments, v_item.old_data);
      end if;
    end if;
  end loop;

  for v_student_id in
    select distinct a.student_id
    from public.olli_schedule_audit_log a
    where a.academy_id = p_academy_id
      and a.transaction_id = p_transaction_id
      and a.student_id is not null
  loop
    perform private.olli_schedule_sync_student(v_student_id, current_date);
  end loop;

  update public.olli_schedule_audit_log
  set restored_at = now(),
      restored_by_account_id = v_account_id,
      restore_transaction_id = v_restore_txid
  where academy_id = p_academy_id
    and transaction_id = p_transaction_id;

  return jsonb_build_object(
    'ok', true,
    'result', 'restored',
    'restored_transaction_id', p_transaction_id::text,
    'restore_transaction_id', v_restore_txid::text
  );
end;
$function$;
