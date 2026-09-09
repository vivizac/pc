create table if not exists public.olli_schedule_sync_revisions (
  academy_id uuid primary key references public.academies(id) on delete cascade,
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.olli_schedule_sync_revisions enable row level security;
revoke all on table public.olli_schedule_sync_revisions from anon, authenticated;

insert into public.olli_schedule_sync_revisions (academy_id, version, updated_at)
select a.id, 1, now()
from public.academies a
on conflict (academy_id) do nothing;

create or replace function private.olli_schedule_bump_sync_revision()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_academy_id uuid;
begin
  v_academy_id := case when tg_op = 'DELETE' then old.academy_id else new.academy_id end;
  if v_academy_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  insert into public.olli_schedule_sync_revisions (academy_id, version, updated_at)
  values (v_academy_id, 1, now())
  on conflict (academy_id)
  do update set
    version = public.olli_schedule_sync_revisions.version + 1,
    updated_at = now();

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

do $do$
declare
  v_table text;
  v_tables text[] := array[
    'olli_schedule_enrollments',
    'olli_schedule_waitlist',
    'olli_schedule_one_time_sessions',
    'olli_schedule_changes',
    'olli_schedule_attendance',
    'olli_schedule_attendance_register_overrides',
    'olli_schedule_pickups',
    'olli_schedule_class_splits',
    'olli_schedule_class_teachers',
    'olli_schedule_kinder_class_merges',
    'olli_schedule_cell_memos',
    'olli_schedule_calendar_days',
    'olli_schedule_settings'
  ];
begin
  foreach v_table in array v_tables
  loop
    if to_regclass('public.' || v_table) is not null then
      execute format('drop trigger if exists olli_schedule_sync_revision_trg on public.%I', v_table);
      execute format(
        'create trigger olli_schedule_sync_revision_trg after insert or update or delete on public.%I for each row execute function private.olli_schedule_bump_sync_revision()',
        v_table
      );
    end if;
  end loop;
end;
$do$;

create or replace function public.olli_schedule_sync_revision(
  p_session_token text,
  p_academy_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_version bigint;
  v_updated_at timestamptz;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '시간표 동기화 정보를 볼 권한이 없습니다.');
  end if;

  insert into public.olli_schedule_sync_revisions (academy_id, version, updated_at)
  values (p_academy_id, 1, now())
  on conflict (academy_id) do nothing;

  select r.version, r.updated_at
    into v_version, v_updated_at
  from public.olli_schedule_sync_revisions r
  where r.academy_id = p_academy_id;

  return jsonb_build_object(
    'ok', true,
    'version', coalesce(v_version, 1),
    'updated_at', v_updated_at
  );
end;
$function$;

grant execute on function public.olli_schedule_sync_revision(text, uuid) to anon, authenticated;
