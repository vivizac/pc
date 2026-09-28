-- 당일 대체 수업 교사를 정규 담임과 분리해 기록합니다.
-- 정규 담임(olli_schedule_class_teachers)은 변경하지 않고 실제 수업자만 날짜 단위로 덮어씁니다.
-- 향후 근태/시급 계산에서 실제 수업자와 원래 담임을 모두 추적할 수 있도록 스냅샷을 함께 보존합니다.

create table if not exists public.olli_schedule_teacher_overrides (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  session_date date not null,
  division text not null check (division in ('elementary','kinder')),
  time_slot smallint not null check (time_slot between 1 and 12),
  class_group text not null default 'A' check (class_group in ('A','B')),
  regular_teacher_member_id uuid references public.academy_members(id) on delete set null,
  regular_teacher_name text not null default '',
  teacher_member_id uuid references public.academy_members(id) on delete set null,
  teacher_name text not null default '',
  reason text not null default 'teacher_absence',
  created_by_account_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, session_date, division, time_slot, class_group)
);

create index if not exists olli_schedule_teacher_overrides_date_idx
  on public.olli_schedule_teacher_overrides (academy_id, session_date, division, time_slot, class_group);

create index if not exists olli_schedule_teacher_overrides_teacher_idx
  on public.olli_schedule_teacher_overrides (academy_id, teacher_member_id, session_date);

alter table public.olli_schedule_teacher_overrides enable row level security;
revoke all on public.olli_schedule_teacher_overrides from anon, authenticated;

create or replace function private.olli_schedule_resolve_effective_teacher(
  p_academy_id uuid,
  p_session_date date,
  p_division text,
  p_time_slot integer,
  p_class_group text
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  with regular as (
    select ct.teacher_member_id, coalesce(ct.teacher_name, '') as teacher_name
    from public.olli_schedule_class_teachers ct
    where ct.academy_id = p_academy_id
      and ct.division = lower(trim(coalesce(p_division, '')))
      and ct.weekday = extract(isodow from p_session_date)::integer
      and ct.time_slot = p_time_slot
      and ct.class_group = upper(trim(coalesce(nullif(p_class_group, ''), 'A')))
    limit 1
  ),
  day_override as (
    select o.id, o.teacher_member_id, coalesce(o.teacher_name, '') as teacher_name,
           o.regular_teacher_member_id, coalesce(o.regular_teacher_name, '') as regular_teacher_name,
           o.reason
    from public.olli_schedule_teacher_overrides o
    where o.academy_id = p_academy_id
      and o.session_date = p_session_date
      and o.division = lower(trim(coalesce(p_division, '')))
      and o.time_slot = p_time_slot
      and o.class_group = upper(trim(coalesce(nullif(p_class_group, ''), 'A')))
    limit 1
  )
  select jsonb_build_object(
    'regular_teacher_member_id', coalesce((select regular_teacher_member_id from day_override), (select teacher_member_id from regular)),
    'regular_teacher_name', coalesce(nullif((select regular_teacher_name from day_override), ''), (select teacher_name from regular), ''),
    'effective_teacher_member_id', coalesce((select teacher_member_id from day_override), (select teacher_member_id from regular)),
    'effective_teacher_name', coalesce(nullif((select teacher_name from day_override), ''), (select teacher_name from regular), ''),
    'override_id', (select id from day_override),
    'is_override', exists(select 1 from day_override),
    'reason', coalesce((select reason from day_override), '')
  );
$function$;

revoke all on function private.olli_schedule_resolve_effective_teacher(uuid, date, text, integer, text) from public, anon, authenticated;

create or replace function public.olli_schedule_teacher_overrides_range(
  p_session_token text,
  p_academy_id uuid,
  p_start_date date,
  p_end_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_start date := coalesce(p_start_date, current_date);
  v_end date := coalesce(p_end_date, p_start_date, current_date);
  v_overrides jsonb;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '당일 수업 담당 정보를 볼 권한이 없습니다.');
  end if;

  if v_end < v_start then
    return jsonb_build_object('ok', false, 'message', '조회 날짜 범위를 확인해 주세요.');
  end if;

  if (v_end - v_start) > 370 then
    return jsonb_build_object('ok', false, 'message', '당일 수업 담당 조회 범위가 너무 큽니다.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id,
    'session_date', o.session_date,
    'division', o.division,
    'time_slot', o.time_slot,
    'class_group', o.class_group,
    'regular_teacher_member_id', o.regular_teacher_member_id,
    'regular_teacher_name', o.regular_teacher_name,
    'teacher_member_id', o.teacher_member_id,
    'teacher_name', o.teacher_name,
    'reason', o.reason,
    'created_at', o.created_at,
    'updated_at', o.updated_at
  ) order by o.session_date, o.division, o.time_slot, o.class_group), '[]'::jsonb)
    into v_overrides
  from public.olli_schedule_teacher_overrides o
  where o.academy_id = p_academy_id
    and o.session_date between v_start and v_end;

  return jsonb_build_object('ok', true, 'overrides', v_overrides);
end;
$function$;

create or replace function public.olli_schedule_effective_teacher(
  p_session_token text,
  p_academy_id uuid,
  p_session_date date,
  p_division text,
  p_time_slot integer,
  p_class_group text default 'A'
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '수업 담당 정보를 볼 권한이 없습니다.');
  end if;

  return jsonb_build_object(
    'ok', true,
    'session_date', p_session_date,
    'division', lower(trim(coalesce(p_division, ''))),
    'time_slot', p_time_slot,
    'class_group', upper(trim(coalesce(nullif(p_class_group, ''), 'A'))),
    'teacher', private.olli_schedule_resolve_effective_teacher(
      p_academy_id,
      p_session_date,
      p_division,
      p_time_slot,
      p_class_group
    )
  );
end;
$function$;

create or replace function public.olli_schedule_set_teacher_override(
  p_session_token text,
  p_academy_id uuid,
  p_session_date date,
  p_division text,
  p_time_slot integer,
  p_class_group text,
  p_teacher_member_id uuid default null,
  p_reason text default 'teacher_absence'
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_division text := lower(trim(coalesce(p_division, '')));
  v_group text := upper(trim(coalesce(nullif(p_class_group, ''), 'A')));
  v_teacher_name text;
  v_regular_teacher_member_id uuid;
  v_regular_teacher_name text := '';
  v_actor_account_id uuid;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '당일 수업 담당을 변경할 권한이 없습니다.');
  end if;

  if p_session_date is null
     or v_division not in ('elementary','kinder')
     or p_time_slot not between 1 and 12
     or v_group not in ('A','B') then
    return jsonb_build_object('ok', false, 'message', '당일 수업 담당 정보를 확인해 주세요.');
  end if;

  select ct.teacher_member_id, coalesce(ct.teacher_name, '')
    into v_regular_teacher_member_id, v_regular_teacher_name
  from public.olli_schedule_class_teachers ct
  where ct.academy_id = p_academy_id
    and ct.division = v_division
    and ct.weekday = extract(isodow from p_session_date)::integer
    and ct.time_slot = p_time_slot
    and ct.class_group = v_group
  limit 1;

  -- 정규 담임과 같은 교사를 선택하면 별도 override를 둘 필요가 없습니다.
  if p_teacher_member_id is null
     or (v_regular_teacher_member_id is not null and p_teacher_member_id = v_regular_teacher_member_id) then
    delete from public.olli_schedule_teacher_overrides o
    where o.academy_id = p_academy_id
      and o.session_date = p_session_date
      and o.division = v_division
      and o.time_slot = p_time_slot
      and o.class_group = v_group;

    return jsonb_build_object(
      'ok', true,
      'removed', true,
      'teacher', private.olli_schedule_resolve_effective_teacher(
        p_academy_id, p_session_date, v_division, p_time_slot, v_group
      )
    );
  end if;

  select trim(m.display_name)
    into v_teacher_name
  from public.academy_members m
  where m.id = p_teacher_member_id
    and m.academy_id = p_academy_id
    and m.status = 'active'
    and m.role in ('owner','manager','teacher')
    and nullif(trim(coalesce(m.display_name, '')), '') is not null;

  if v_teacher_name is null then
    return jsonb_build_object('ok', false, 'message', '선택한 대체 선생님을 찾을 수 없습니다.');
  end if;

  v_actor_account_id := public.olli_account_id_from_session(p_session_token);

  insert into public.olli_schedule_teacher_overrides (
    academy_id, session_date, division, time_slot, class_group,
    regular_teacher_member_id, regular_teacher_name,
    teacher_member_id, teacher_name, reason,
    created_by_account_id, updated_at
  ) values (
    p_academy_id, p_session_date, v_division, p_time_slot, v_group,
    v_regular_teacher_member_id, coalesce(v_regular_teacher_name, ''),
    p_teacher_member_id, v_teacher_name, coalesce(nullif(trim(p_reason), ''), 'teacher_absence'),
    v_actor_account_id, now()
  )
  on conflict (academy_id, session_date, division, time_slot, class_group)
  do update set
    regular_teacher_member_id = excluded.regular_teacher_member_id,
    regular_teacher_name = excluded.regular_teacher_name,
    teacher_member_id = excluded.teacher_member_id,
    teacher_name = excluded.teacher_name,
    reason = excluded.reason,
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'removed', false,
    'teacher', private.olli_schedule_resolve_effective_teacher(
      p_academy_id, p_session_date, v_division, p_time_slot, v_group
    )
  );
end;
$function$;

drop trigger if exists olli_schedule_sync_revision_trg on public.olli_schedule_teacher_overrides;
create trigger olli_schedule_sync_revision_trg
after insert or update or delete on public.olli_schedule_teacher_overrides
for each row execute function private.olli_schedule_bump_sync_revision();

revoke all on function public.olli_schedule_teacher_overrides_range(text, uuid, date, date) from public;
revoke all on function public.olli_schedule_effective_teacher(text, uuid, date, text, integer, text) from public;
revoke all on function public.olli_schedule_set_teacher_override(text, uuid, date, text, integer, text, uuid, text) from public;

grant execute on function public.olli_schedule_teacher_overrides_range(text, uuid, date, date) to anon, authenticated;
grant execute on function public.olli_schedule_effective_teacher(text, uuid, date, text, integer, text) to anon, authenticated;
grant execute on function public.olli_schedule_set_teacher_override(text, uuid, date, text, integer, text, uuid, text) to anon, authenticated;
