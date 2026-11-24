\set ON_ERROR_STOP on
begin;
create schema private;
create schema extensions;
create schema vault;
create schema net;
create schema cron;
create role anon;
create role authenticated;
create table public.students(id uuid primary key, academy_id uuid,name text,division text,status text,is_deleted boolean);
create table public.academy_settings(academy_id uuid primary key,team_talk_bot_notifications_enabled boolean);
create table public.academy_members(id uuid primary key,academy_id uuid,status text,account_id uuid,role text);
create table public.olli_schedule_class_teachers(academy_id uuid,division text,weekday integer,time_slot integer,class_group text,teacher_member_id uuid);
create table public.olli_schedule_teacher_overrides(academy_id uuid,session_date date,division text,time_slot integer,class_group text,regular_teacher_member_id uuid,teacher_member_id uuid);
create table public.olli_schedule_enrollments(id uuid primary key,academy_id uuid,student_id uuid,weekday integer,time_slot integer,class_group text,status text,effective_from date,effective_to date);
create table public.olli_schedule_changes(id uuid primary key,academy_id uuid,student_id uuid,source_enrollment_id uuid,target_enrollment_id uuid,effective_date date,change_type text,status text);
create table public.olli_schedule_one_time_sessions(id uuid primary key,academy_id uuid,student_id uuid,session_date date,time_slot integer,class_group text,session_type text,status text,note text,guest_name text,guest_division text);
create table public.olli_schedule_attendance(academy_id uuid,student_id uuid,session_date date,time_slot integer,class_group text,session_kind text);
create table private.olli_schedule_attendance_session_overrides(academy_id uuid,student_id uuid,session_date date,time_slot integer,class_group text,session_kind text,status text);
create table public.olli_schedule_pickups(id uuid,academy_id uuid,pickup_label text,pickup_time time);
create table public.olli_team_chat_messages(id bigint generated always as identity primary key,academy_id uuid,sender_member_id uuid,sender_name_snapshot text,message_type text,body text,client_message_id uuid);
create table public.olli_team_chat_mentions(academy_id uuid,message_id bigint,member_id uuid,unique(message_id,member_id));
create table public.olli_team_chat_bot_events(id bigint generated always as identity primary key,academy_id uuid,event_key text,event_type text,source_table text,source_id text,class_date date,division text,weekday integer,time_slot integer,class_group text,message_id bigint,target_member_id uuid,unique(academy_id,event_key),constraint olli_team_chat_bot_events_event_type_check check(event_type in ('registration_add','registration_cancel','trial_add','trial_cancel','wait_add','wait_cancel','pickup_add','pickup_move','pickup_cancel')));
create table vault.decrypted_secrets(name text,decrypted_secret text,created_at timestamptz default now());
insert into vault.decrypted_secrets(name,decrypted_secret) values('olli_team_chat_system_push_secret_20260921','fixture-secret');
create table net.fixture_dispatch(body jsonb);
create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$ begin insert into net.fixture_dispatch values(body);return 1;end $$;
create function extensions.gen_random_uuid() returns uuid language sql as $$ select gen_random_uuid() $$;
create function cron.schedule(text,text,text) returns bigint language sql as $$ select 1::bigint $$;
create function private.olli_team_talk_effective_teacher(uuid,date,text,integer,text) returns uuid language sql as $$
 select coalesce((select o.teacher_member_id from public.olli_schedule_teacher_overrides o where o.academy_id=$1 and o.session_date=$2 and o.division=$3 and o.time_slot=$4 and o.class_group=$5 limit 1),
 (select c.teacher_member_id from public.olli_schedule_class_teachers c where c.academy_id=$1 and c.weekday=extract(isodow from $2) and c.division=$3 and c.time_slot=$4 and c.class_group=$5 limit 1))
$$;
create function private.olli_team_talk_next_class_date(date,integer) returns date language sql as $$ select $1+mod($2-extract(isodow from $1)::int+7,7) $$;
create function private.olli_schedule_group_is_enabled(uuid,text,integer,integer,date) returns boolean language sql as $$ select $4<>3 $$;
create function private.olli_schedule_is_closed_day(uuid,date) returns boolean language sql as $$ select $2=date '2027-01-01' $$;
create function private.olli_schedule_timetable_mode(uuid) returns text language sql as $$ select 'half_hour'::text $$;
create function private.olli_makeup_slot_label(uuid,text,date,integer) returns text language sql as $$ select case when $4=9 then '5시 30분' else $4::text||'시' end $$;
\ir ../../../supabase/migrations/schedule_day_teacher_reminders.sql
do $test$
declare
 a uuid := gen_random_uuid(); s uuid := gen_random_uuid(); teacher uuid := gen_random_uuid(); substitute uuid := gen_random_uuid(); wrong uuid := gen_random_uuid();
 b uuid := gen_random_uuid(); guest uuid:=gen_random_uuid(); temp uuid:=gen_random_uuid(); move_id uuid:=gen_random_uuid();
 root uuid:=gen_random_uuid(); leaf uuid:=gen_random_uuid(); cancelled uuid:=gen_random_uuid(); attended uuid:=gen_random_uuid();
 returned_root uuid:=gen_random_uuid(); returned_mid uuid:=gen_random_uuid(); returned_leaf uuid:=gen_random_uuid(); returned_change uuid:=gen_random_uuid();
 later uuid:=gen_random_uuid(); no_teacher uuid:=gen_random_uuid();
 d date:=date '2026-12-02'; n integer; r bigint;
begin
 insert into public.students values(s,a,'테스트학생','kinder','active',false);
 insert into public.academy_settings values(a,false);
 insert into public.academy_members values(teacher,a,'active',gen_random_uuid(),'teacher'),(substitute,a,'active',gen_random_uuid(),'teacher'),(wrong,a,'active',gen_random_uuid(),'teacher');
 insert into public.olli_schedule_class_teachers values(a,'kinder',3,4,'A',wrong),(a,'kinder',3,4,'B',teacher),(a,'kinder',3,5,'A',teacher),(a,'kinder',3,9,'B',teacher);
 insert into public.olli_schedule_teacher_overrides values(a,d,'kinder',4,'B',teacher,substitute);
 insert into public.olli_schedule_one_time_sessions values
 (b,a,s,d,4,'B','makeup','scheduled','',null,null),
 (guest,a,null,d,5,'A','trial','scheduled','','체험학생','kinder'),
 (temp,a,s,d,9,'B','makeup','scheduled','일시변경 [olli:temporary-move-v2:'||root::text||':'||d::text||':blank]',null,null),
 (cancelled,a,s,d,4,'A','makeup','cancelled','',null,null),
 (attended,a,s,d,5,'A','makeup','scheduled','',null,null),
 (no_teacher,a,s,d,8,'A','makeup','scheduled','',null,null);
 insert into public.olli_schedule_attendance values(a,s,d,5,'A','makeup');
 insert into public.olli_schedule_enrollments values
 (root,a,s,1,4,'A','active',d-40,d-3),
 (leaf,a,s,3,4,'B','active',d-2,null),
 (returned_root,a,s,3,5,'A','cancelled',d-40,d-3),
 (returned_mid,a,s,3,4,'A','cancelled',d-2,null),
 (returned_leaf,a,s,3,5,'A','active',d-2,null);
 insert into public.olli_schedule_changes values
 (move_id,a,s,root,leaf,d-2,'move','scheduled'),
 (gen_random_uuid(),a,s,returned_root,returned_mid,d-2,'move','applied'),
 (returned_change,a,s,returned_mid,returned_leaf,d-1,'move','applied');
 -- Candidates exclude cancelled, attended, net-zero return, past and following-week routine.
 if (select count(*) from private.olli_team_talk_day_candidates(d))<>5 then raise exception 'candidate count';end if;
 if exists(select 1 from private.olli_team_talk_day_candidates(d) where source_id in(cancelled::text,attended::text,returned_change::text)) then raise exception 'ineligible reminder';end if;
 if exists(select 1 from private.olli_team_talk_day_candidates(d+7) where source_id=move_id::text) then raise exception 'repeat regular move next week';end if;
 if private.olli_team_talk_day_slot_start(a,'elementary',6,10)<>time '10:00' or private.olli_team_talk_day_slot_start(a,'kinder',3,9)<>time '17:30' then raise exception 'slot conversion';end if;
 n:=private.olli_team_talk_dispatch_day_reminders((d+time '09:50') at time zone 'Asia/Seoul');
 if n<>0 then raise exception 'sent before morning';end if;
 n:=private.olli_team_talk_dispatch_day_reminders((d+time '10:00') at time zone 'Asia/Seoul');
 if n<>4 then raise exception 'expected four messages, got %',n;end if;
 if (select count(*) from public.olli_team_chat_mentions)<>4 or (select count(*) from net.fixture_dispatch)<>4 then raise exception 'mention or push missing';end if;
 if exists(select 1 from public.olli_team_chat_bot_events where source_id in(b::text,move_id::text) and target_member_id<>substitute) then raise exception 'wrong substitute';end if;
 if exists(select 1 from public.olli_team_chat_mentions where member_id=wrong) then raise exception 'wrong group teacher';end if;
 if not exists(select 1 from public.olli_team_chat_messages where body like '오늘 일시변경 수업%5시 30분%B반') then raise exception 'temporary label';end if;
 if not exists(select 1 from public.olli_team_chat_messages where body like '오늘 체험수업%체험학생%') then raise exception 'guest label';end if;
 n:=private.olli_team_talk_dispatch_day_reminders((d+time '10:10') at time zone 'Asia/Seoul');
 if n<>0 then raise exception 'duplicate';end if;
 insert into public.olli_schedule_one_time_sessions values(later,a,s,d,5,'A','trial','scheduled','',null,null);
 -- Same day new trial for a registered student with completed makeup at same slot is skipped.
 n:=private.olli_team_talk_dispatch_day_reminders((d+time '10:20') at time zone 'Asia/Seoul');
 if n<>0 then raise exception 'attended late entry';end if;
 update public.olli_schedule_one_time_sessions set student_id=null,guest_name='당일체험',guest_division='kinder' where id=later;
 n:=private.olli_team_talk_dispatch_day_reminders((d+time '10:30') at time zone 'Asia/Seoul');
 if n<>1 then raise exception 'late entry not sent';end if;
 update public.olli_schedule_teacher_overrides set teacher_member_id=teacher where academy_id=a and session_date=d;
 n:=private.olli_team_talk_dispatch_day_reminders((d+time '10:40') at time zone 'Asia/Seoul');
 if n<>2 then raise exception 'new effective teacher did not receive reminder';end if;
 -- Existing optional trial notification setting remains unchanged.
 r:=private.olli_team_talk_emit_schedule_event(a,'fixture:old','trial_add','olli_schedule_one_time_sessions',guest::text,'old',d,'kinder',3,5,'A');
 if r is not null then raise exception 'existing bot setting changed';end if;
 raise notice 'day reminder SQL: four event types, effective substitute, deduplication, late changes, cancellation and optional setting passed';
end $test$;
rollback;
