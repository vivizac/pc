-- Isolated PostgreSQL contract test. These are synthetic fixtures, never live data.
\set ON_ERROR_STOP on
begin;
create schema if not exists private;
create role anon;
create role authenticated;
create role service_role;
create table public.students (id uuid primary key, academy_id uuid not null, division text, status text, is_deleted boolean);
create table public.olli_schedule_enrollments (
  id uuid primary key, academy_id uuid, student_id uuid, weekday integer, time_slot integer,
  class_group text, status text, effective_from date, effective_to date
);
create table public.olli_schedule_attendance (
  academy_id uuid, student_id uuid, session_date date, time_slot integer, class_group text, session_kind text
);
create table private.olli_schedule_attendance_session_overrides (
  academy_id uuid, student_id uuid, session_date date, time_slot integer, class_group text, session_kind text, status text,
  primary key(academy_id,student_id,session_date,time_slot,class_group,session_kind)
);
create table public.olli_schedule_one_time_sessions (
  id uuid primary key default gen_random_uuid(), academy_id uuid, student_id uuid, session_date date,
  time_slot integer, class_group text, session_type text default 'makeup', status text default 'scheduled', note text
);
create function private.olli_schedule_can_access(text,uuid) returns boolean language sql as $$
 select $1='fixture-session' and $2='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
$$;
create function private.olli_schedule_is_closed_day(uuid,date) returns boolean language sql as $$ select false $$;
create function private.olli_schedule_slot_is_valid(uuid,text,integer,integer) returns boolean language sql as $$ select $3 between 1 and 6 and $4 between 1 and 12 $$;
create function private.olli_schedule_group_is_enabled(uuid,text,integer,integer,date) returns boolean language sql as $$ select true $$;
-- These stubs model the existing RPC contracts, including the exact failure modes.
create function public.olli_schedule_set_attendance_session_status_v2(text,uuid,uuid,date,text,integer,text,text)
returns jsonb language plpgsql as $$
begin
  if $6=9 then return jsonb_build_object('ok',false,'message','fixture absence failed'); end if;
  insert into private.olli_schedule_attendance_session_overrides values($2,$3,$4,$6,$7,$5,$8)
  on conflict (academy_id,student_id,session_date,time_slot,class_group,session_kind)
  do update set status=excluded.status;
  return jsonb_build_object('ok',true);
end $$;
create function public.olli_schedule_execute(text,uuid,text,jsonb) returns jsonb language plpgsql as $$
declare v_id uuid;
begin
  if $3<>'add_one_time' then raise exception 'unexpected action'; end if;
  if ($4->>'time_slot')::integer=6 then
    return jsonb_build_object('ok',false,'message','fixture capacity full');
  end if;
  select id into v_id from public.olli_schedule_one_time_sessions
    where academy_id=$2 and student_id=($4->>'student_id')::uuid
      and session_date=($4->>'session_date')::date and time_slot=($4->>'time_slot')::integer and status<>'cancelled';
  if found then return jsonb_build_object('ok',true,'unchanged',true,'one_time_session_id',v_id); end if;
  insert into public.olli_schedule_one_time_sessions(academy_id,student_id,session_date,time_slot,class_group,note)
    values($2,($4->>'student_id')::uuid,($4->>'session_date')::date,($4->>'time_slot')::integer,$4->>'class_group',$4->>'note')
    returning id into v_id;
  return jsonb_build_object('ok',true,'result','scheduled','unchanged',false,'one_time_session_id',v_id);
end $$;
\ir ../../../supabase/migrations/20261124071708_pc_timetable_temporary_move.sql

do $test$
declare
  a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  s uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  e uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  other uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  monday date := date_trunc('week',current_date)::date+7;
  original date := monday+2;
  r jsonb;
  before_row jsonb;
  failed boolean;
begin
  insert into public.students values(s,a,'kinder','active',false);
  insert into public.olli_schedule_enrollments values(e,a,s,3,4,'B','active',monday,null);
  select to_jsonb(x) into before_row from public.olli_schedule_enrollments x where id=e;

  -- Unauthorized and different-week calls cannot write.
  r := public.olli_schedule_temporary_move_v1('bad-session',a,s,e,original,4,'B',monday,4,'A');
  if r->>'ok'<>'false' then raise exception 'unauthorized call accepted'; end if;
  r := public.olli_schedule_temporary_move_v1('fixture-session',a,s,e,original,4,'B',monday+7,4,'A');
  if r->>'ok'<>'false' then raise exception 'different week accepted'; end if;

  -- A full destination rolls back the absence created first.
  failed := false;
  begin
    perform public.olli_schedule_temporary_move_v1('fixture-session',a,s,e,original,4,'B',monday,6,'A');
  exception when others then
    if sqlerrm<>'fixture capacity full' then raise; end if;
    failed := true;
  end;
  if not failed or exists(select 1 from private.olli_schedule_attendance_session_overrides) then
    raise exception 'failed makeup left an absence';
  end if;

  -- Do not repurpose an existing makeup; rollback its attempted absence.
  insert into public.olli_schedule_one_time_sessions(academy_id,student_id,session_date,time_slot,class_group,note)
    values(a,s,monday,5,'A','existing ordinary makeup');
  failed := false;
  begin
    perform public.olli_schedule_temporary_move_v1('fixture-session',a,s,e,original,4,'B',monday,5,'A');
  exception when others then
    if sqlerrm not like '%이미 보강%' then raise; end if;
    failed := true;
  end;
  if not failed or exists(select 1 from private.olli_schedule_attendance_session_overrides) then
    raise exception 'duplicate left an absence';
  end if;
  if not exists(select 1 from public.olli_schedule_one_time_sessions where note='existing ordinary makeup') then
    raise exception 'existing makeup altered';
  end if;

  -- Already-attended lessons cannot be turned into absences.
  insert into public.olli_schedule_attendance values(a,s,original,4,'B','regular');
  r := public.olli_schedule_temporary_move_v1('fixture-session',a,s,e,original,4,'B',monday,4,'A');
  if r->>'ok'<>'false' then raise exception 'attended source accepted'; end if;
  delete from public.olli_schedule_attendance;

  -- Successful move is an exact dated absence plus one standard makeup.
  r := public.olli_schedule_temporary_move_v1('fixture-session',a,s,e,original,4,'B',monday,4,'A');
  if r->>'ok'<>'true' or r->>'temporary_move'<>'true' then raise exception 'creation failed: %',r; end if;
  if not exists(select 1 from private.olli_schedule_attendance_session_overrides
      where student_id=s and session_date=original and time_slot=4 and class_group='B' and status='absent') then
    raise exception 'source absence missing';
  end if;
  if not exists(select 1 from public.olli_schedule_one_time_sessions
    where id=(r->>'one_time_session_id')::uuid and session_date=monday and time_slot=4 and class_group='A'
      and session_type='makeup' and note like '일시변경 [olli:temporary-move-v1:%') then
    raise exception 'temporary makeup missing';
  end if;
  if (select to_jsonb(x) from public.olli_schedule_enrollments x where id=e) is distinct from before_row then
    raise exception 'regular enrollment changed';
  end if;
  r := public.olli_schedule_temporary_move_v1('fixture-session',a,s,e,original,4,'B',monday,4,'A');
  if r->>'unchanged'<>'true' then raise exception 'retry not idempotent'; end if;
  r := public.olli_schedule_temporary_move_v1('fixture-session',a,s,e,original,4,'B',monday+1,4,'A');
  if r->>'ok'<>'false' then raise exception 'second move for same source accepted'; end if;
  if (select count(*) from public.olli_schedule_one_time_sessions where note like '일시변경 [olli:temporary-move-v1:%')<>1 then
    raise exception 'duplicate temporary sessions';
  end if;

  -- An absence RPC rejection cannot create any makeup.
  insert into public.olli_schedule_enrollments values(other,a,s,3,9,'B','active',monday,null);
  failed := false;
  begin
    perform public.olli_schedule_temporary_move_v1('fixture-session',a,s,other,original,9,'B',monday+1,4,'A');
  exception when others then
    if sqlerrm<>'fixture absence failed' then raise; end if;
    failed := true;
  end;
  if not failed or exists(select 1 from public.olli_schedule_one_time_sessions where session_date=monday+1) then
    raise exception 'failed absence left a makeup';
  end if;
  raise notice 'temporary move SQL: all atomicity, idempotency, access and enrollment preservation assertions passed';
end $test$;
rollback;
