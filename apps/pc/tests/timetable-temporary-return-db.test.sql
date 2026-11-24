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
  academy_id uuid, student_id uuid, session_date date, time_slot integer, class_group text, session_kind text, status text, created_at timestamptz default now(), updated_at timestamptz default now(),
  primary key(academy_id,student_id,session_date,time_slot,class_group,session_kind)
);
create table public.olli_schedule_one_time_sessions (
  id uuid primary key default gen_random_uuid(), academy_id uuid, student_id uuid, session_date date,
  time_slot integer, class_group text, session_type text default 'makeup', status text default 'scheduled', note text, created_at timestamptz default now()
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
  if $8='blank' and current_setting('fixture.fail_blank',true)='1' then return jsonb_build_object('ok',false,'message','fixture restore failed'); end if;
  insert into private.olli_schedule_attendance_session_overrides(academy_id,student_id,session_date,time_slot,class_group,session_kind,status) values($2,$3,$4,$6,$7,$5,$8)
  on conflict (academy_id,student_id,session_date,time_slot,class_group,session_kind)
  do update set status=excluded.status,updated_at=now();
  return jsonb_build_object('ok',true);
end $$;
create function public.olli_schedule_execute(text,uuid,text,jsonb) returns jsonb language plpgsql as $$
declare v_id uuid;
begin
  if $3='cancel_one_time' then
    update public.olli_schedule_one_time_sessions set status='cancelled'
      where id=($4->>'one_time_session_id')::uuid and academy_id=$2 and status='scheduled';
    return jsonb_build_object('ok',found);
  end if;
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
\ir ../../../supabase/migrations/pc_temporary_move_return.sql
do $test$
declare
 a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
 s uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
 e uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
 other uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
 monday date := date_trunc('week',current_date)::date+7;
 original date := monday+2;
 r jsonb;
 v_id uuid;
 v_regular jsonb;
 v_failed boolean;
begin
 insert into public.students values(s,a,'kinder','active',false);
 insert into public.olli_schedule_enrollments values(e,a,s,3,4,'B','active',monday,null);
 insert into public.olli_schedule_enrollments values(other,a,s,3,5,'A','active',monday,null);
 select to_jsonb(x) into v_regular from public.olli_schedule_enrollments x where id=e;
 insert into private.olli_schedule_attendance_session_overrides(academy_id,student_id,session_date,time_slot,class_group,session_kind,status)
 values(a,s,original,5,'A','regular','absent');
 -- Ordinary makeup must never be cancelled by temporary-return RPC.
 insert into public.olli_schedule_one_time_sessions(academy_id,student_id,session_date,time_slot,class_group,note)
 values(a,s,monday,3,'A','ordinary') returning id into v_id;
 r:=public.olli_schedule_cancel_temporary_move_v1('fixture-session',a,v_id,original,4,'B');
 if r->>'ok'<>'false' then raise exception 'ordinary makeup accepted'; end if;
 -- Create a temporary move, then undo exactly its source override.
 r:=public.olli_schedule_temporary_move_v1('fixture-session',a,s,e,original,4,'B',monday,4,'A');
 if r->>'ok'<>'true' then raise exception 'creation failed %',r; end if;
 v_id:=(r->>'one_time_session_id')::uuid;
 if not exists(select 1 from public.olli_schedule_one_time_sessions where id=v_id and note like '%:blank]') then raise exception 'provenance missing'; end if;
 r:=public.olli_schedule_temporary_move_v1('fixture-session',a,s,e,original,4,'B',monday,4,'A');
 if r->>'unchanged'<>'true' then raise exception 'v2 retry failed'; end if;
 r:=public.olli_schedule_cancel_temporary_move_v1('bad-session',a,v_id,original,4,'B');
 if r->>'ok'<>'false' then raise exception 'unauthorized cancellation'; end if;
 r:=public.olli_schedule_cancel_temporary_move_v1('fixture-session',a,v_id,original,4,'A');
 if r->>'ok'<>'false' then raise exception 'wrong group accepted'; end if;
 r:=public.olli_schedule_cancel_temporary_move_v1('fixture-session',a,v_id,original+7,4,'B');
 if r->>'ok'<>'false' then raise exception 'wrong date accepted'; end if;
 insert into public.olli_schedule_attendance values(a,s,monday,4,'A','makeup');
 r:=public.olli_schedule_cancel_temporary_move_v1('fixture-session',a,v_id,original,4,'B');
 if r->>'ok'<>'false' then raise exception 'attended makeup accepted'; end if;
 delete from public.olli_schedule_attendance;
 -- Failure restoring the original must rollback cancellation.
 perform set_config('fixture.fail_blank','1',true);
 v_failed:=false;
 begin
   perform public.olli_schedule_cancel_temporary_move_v1('fixture-session',a,v_id,original,4,'B');
 exception when others then
   if sqlerrm<>'fixture restore failed' then raise; end if;
   v_failed:=true;
 end;
 perform set_config('fixture.fail_blank','0',true);
 if not v_failed or not exists(select 1 from public.olli_schedule_one_time_sessions where id=v_id and status='scheduled') then raise exception 'partial cancel committed'; end if;
 r:=public.olli_schedule_cancel_temporary_move_v1('fixture-session',a,v_id,original,4,'B');
 if r->>'absence_cleared'<>'true' then raise exception 'absence not restored %',r; end if;
 if not exists(select 1 from public.olli_schedule_one_time_sessions where id=v_id and status='cancelled') then raise exception 'temp card not cancelled'; end if;
 if not exists(select 1 from private.olli_schedule_attendance_session_overrides where student_id=s and session_date=original and time_slot=4 and class_group='B' and status='blank') then raise exception 'original absence remains'; end if;
 if (select to_jsonb(x) from public.olli_schedule_enrollments x where id=e) is distinct from v_regular then raise exception 'regular enrollment changed'; end if;
 if not exists(select 1 from private.olli_schedule_attendance_session_overrides where student_id=s and session_date=original and time_slot=5 and status='absent') then raise exception 'unrelated absence changed'; end if;
 r:=public.olli_schedule_cancel_temporary_move_v1('fixture-session',a,v_id,original,4,'B');
 if r->>'unchanged'<>'true' then raise exception 'cancel retry not idempotent'; end if;
 -- Existing blank override (created earlier) must restore correctly.
 update private.olli_schedule_attendance_session_overrides set created_at=now()-interval '1 day'
 where student_id=s and session_date=original and time_slot=4;
 r:=public.olli_schedule_temporary_move_v1('fixture-session',a,s,e,original,4,'B',monday,4,'A');
 v_id:=(r->>'one_time_session_id')::uuid;
 r:=public.olli_schedule_cancel_temporary_move_v1('fixture-session',a,v_id,original,4,'B');
 if r->>'absence_cleared'<>'true' then raise exception 'existing blank not restored %',r; end if;
 -- Existing genuine absence must be preserved.
 update private.olli_schedule_attendance_session_overrides set status='absent',updated_at=now()-interval '1 hour'
 where student_id=s and session_date=original and time_slot=4;
 r:=public.olli_schedule_temporary_move_v1('fixture-session',a,s,e,original,4,'B',monday,4,'A');
 v_id:=(r->>'one_time_session_id')::uuid;
 if not exists(select 1 from public.olli_schedule_one_time_sessions where id=v_id and note like '%:keep]') then raise exception 'preexisting absence not identified'; end if;
 r:=public.olli_schedule_cancel_temporary_move_v1('fixture-session',a,v_id,original,4,'B');
 if r->>'absence_preserved'<>'true' then raise exception 'preexisting absence lost %',r; end if;
 -- Subsequent independent attendance edit must remain.
 update private.olli_schedule_attendance_session_overrides set status='blank' where student_id=s and session_date=original and time_slot=4;
 r:=public.olli_schedule_temporary_move_v1('fixture-session',a,s,e,original,4,'B',monday,4,'A');
 v_id:=(r->>'one_time_session_id')::uuid;
 update private.olli_schedule_attendance_session_overrides set updated_at=now()+interval '1 second' where student_id=s and session_date=original and time_slot=4;
 r:=public.olli_schedule_cancel_temporary_move_v1('fixture-session',a,v_id,original,4,'B');
 if r->>'absence_preserved'<>'true' then raise exception 'later absence changed %',r; end if;
 -- Legacy marker created by the original release: new override and makeup share a transaction timestamp.
 update private.olli_schedule_attendance_session_overrides set status='absent',created_at=now(),updated_at=now()
 where student_id=s and session_date=original and time_slot=4;
 insert into public.olli_schedule_one_time_sessions(academy_id,student_id,session_date,time_slot,class_group,note)
 values(a,s,monday,4,'A','일시변경 [olli:temporary-move-v1:'||e::text||':'||original::text||']') returning id into v_id;
 r:=public.olli_schedule_cancel_temporary_move_v1('fixture-session',a,v_id,original,4,'B');
 if r->>'absence_cleared'<>'true' then raise exception 'legacy override not restored %',r; end if;
 raise notice 'temporary return SQL: exact undo, rollback, attendance protection, idempotency and legacy marker passed';
end $test$;
rollback;
