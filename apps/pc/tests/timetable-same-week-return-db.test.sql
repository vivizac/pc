\set ON_ERROR_STOP on
begin;
create schema if not exists private;
create table public.students(id uuid primary key,academy_id uuid,status text,division text,is_deleted boolean);
create table public.olli_schedule_enrollments(id uuid primary key default gen_random_uuid(),academy_id uuid,student_id uuid,weekday int,time_slot int,class_group text,session_order smallint,effective_from date,effective_to date,source text,status text default 'active',updated_at timestamptz default now(),check(effective_to is null or effective_to>=effective_from));
create table public.olli_schedule_changes(id uuid primary key default gen_random_uuid(),academy_id uuid,student_id uuid,change_type text,source_enrollment_id uuid,target_enrollment_id uuid,target_class_group text,effective_date date,status text,cancelled_at timestamptz,updated_at timestamptz);
create table public.olli_schedule_one_time_sessions(academy_id uuid,student_id uuid,guest_division text,session_date date,time_slot int,class_group text,status text);
create table public.olli_schedule_waitlist(id uuid default gen_random_uuid(),academy_id uuid,student_id uuid,target_division text,target_weekday int,target_time_slot int,target_class_group text,request_type text,source_enrollment_id uuid,desired_effective_date date,status text);
create table public.olli_schedule_attendance(academy_id uuid,student_id uuid,session_kind text,session_date date);
create table public.olli_schedule_attendance_register_overrides(academy_id uuid,student_id uuid,session_kind text,session_date date);
create function private.olli_schedule_can_access(text,uuid) returns boolean language sql as $$ select $1='fixture' $$;
create function private.olli_schedule_slot_is_valid(uuid,text,int,int) returns boolean language sql as $$ select true $$;
create function private.olli_schedule_group_is_enabled(uuid,text,int,int,date) returns boolean language sql as $$ select true $$;
create function private.olli_schedule_timetable_mode(uuid) returns text language sql as $$ select 'hourly'::text $$;
create function private.olli_schedule_capacity(uuid,text) returns int language sql as $$ select 6 $$;
create function private.olli_schedule_first_occurrence_on_or_after(date,int) returns date language sql as $$ select $1+(($2-extract(isodow from $1)::int+7)%7) $$;
create function private.olli_schedule_sync_student(uuid,date) returns void language plpgsql as $$ begin return; end $$;
\ir ../../../supabase/migrations/pc_same_week_move_return.sql
do $test$
declare
 a uuid:=gen_random_uuid();
 s uuid:=gen_random_uuid();
 orig uuid:=gen_random_uuid();
 other uuid:=gen_random_uuid();
 leaf uuid;
 r jsonb;
 i int;
 day int:=3;
 wk date:=date_trunc('week',current_date)::date;
begin
 insert into public.students values(s,a,'active','kinder',false);
 insert into public.olli_schedule_enrollments(id,academy_id,student_id,weekday,time_slot,class_group,session_order,effective_from,source) values
 (orig,a,s,day,5,'B',1,wk-28,'regular'),(other,a,s,5,4,'A',2,wk-28,'regular');
 for i in 1..4 loop
  r:=public.olli_schedule_change('fixture',a,s,orig,day,5,current_date,'move',false,'A');
  if r->>'result'<>'applied' then raise exception 'forward failed %',r;end if;
  leaf:=(r->>'target_enrollment_id')::uuid;
  r:=public.olli_schedule_change('fixture',a,s,leaf,day,5,current_date,'move',false,'B');
  if r->>'result'<>'cancelled' or (r->>'target_enrollment_id')::uuid<>orig then raise exception 'return failed %',r;end if;
  if not exists(select 1 from public.olli_schedule_enrollments where id=orig and status='active' and effective_to is null and class_group='B' and session_order=1) then raise exception 'original not restored';end if;
  if exists(select 1 from public.olli_schedule_changes where student_id=s and status<>'cancelled') then raise exception 'active moves accumulated';end if;
  if not exists(select 1 from public.olli_schedule_enrollments where id=other and status='active' and session_order=2 and effective_to is null) then raise exception 'unrelated enrollment changed';end if;
 end loop;
 -- Two forward moves, then return to the original slot: cancel the entire linked suffix.
 r:=public.olli_schedule_change('fixture',a,s,orig,day,5,current_date,'move',false,'A');
 leaf:=(r->>'target_enrollment_id')::uuid;
 r:=public.olli_schedule_change('fixture',a,s,leaf,day,4,current_date,'move',false,'A');
 leaf:=(r->>'target_enrollment_id')::uuid;
 r:=public.olli_schedule_change('fixture',a,s,leaf,day,5,current_date,'move',false,'B');
 if r->>'result'<>'cancelled' or (r->>'target_enrollment_id')::uuid<>orig then raise exception 'multi-hop undo failed %',r;end if;
 if exists(select 1 from public.olli_schedule_changes where student_id=s and status<>'cancelled') then raise exception 'multi-hop active changes';end if;
 -- Attendance is preserved; no new movement should be created when undo is unsafe.
 r:=public.olli_schedule_change('fixture',a,s,orig,day,5,current_date,'move',false,'A');
 leaf:=(r->>'target_enrollment_id')::uuid;
 insert into public.olli_schedule_attendance values(a,s,'regular',current_date);
 r:=public.olli_schedule_change('fixture',a,s,leaf,day,5,current_date,'move',false,'B');
 if r->>'ok'<>'false' then raise exception 'unsafe undo accepted %',r;end if;
 if (select count(*) from public.olli_schedule_changes where student_id=s and status='applied')<>1 then raise exception 'unsafe undo mutated moves';end if;
 if not exists(select 1 from public.olli_schedule_attendance where student_id=s) then raise exception 'attendance lost';end if;
 r:=public.olli_schedule_change('invalid',a,s,leaf,day,5,current_date,'move',false,'B');
 if r->>'ok'<>'false' then raise exception 'unauthorized undo accepted';end if;
 raise notice 'same-week return SQL: repeated moves, exact enrollment restoration, multi-hop cancellation, attendance preservation passed';
end $test$;
rollback;
