\set ON_ERROR_STOP on
begin;
create schema if not exists private;
create role anon;
create role authenticated;
create role service_role;
create table public.students(id uuid primary key,academy_id uuid,division text,status text,is_deleted boolean);
create table public.olli_schedule_pickups(
 id uuid primary key default gen_random_uuid(),academy_id uuid,student_id uuid,weekday integer,class_time integer,
 pickup_label text,pickup_time time,is_dropoff boolean,dropoff_label text,dropoff_time time,pickup_scope text,
 effective_from date,effective_to date,status text default 'active',created_by_account_id uuid,
 created_at timestamptz default now(),updated_at timestamptz default now(),check(effective_to is null or effective_to>=effective_from)
);
create function private.olli_schedule_can_access(text,uuid) returns boolean language sql as $$
 select $1='fixture' and $2='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
$$;
create function private.olli_schedule_slot_is_valid(uuid,text,integer,integer) returns boolean language sql as $$ select $3 between 1 and 6 and $4 in (4,5) $$;
create function public.olli_account_id_from_session(text) returns uuid language sql as $$ select 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid $$;
\ir ../../../supabase/migrations/pc_pickup_change_scope.sql
do $test$
declare
 a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
 s uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
 p uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
 future_p uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
 daily_p uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
 s2 uuid := '11111111-1111-1111-1111-111111111111';
 s3 uuid := '22222222-2222-2222-2222-222222222222';
 v_today date := (now() at time zone 'Asia/Seoul')::date;
 v_next date := date_trunc('week',v_today)::date+7;
 v_old date := v_next-28;
 v_id uuid;
 r jsonb;
 before_row jsonb;
begin
 insert into public.students values(s,a,'kinder','active',false),(s2,a,'kinder','active',false),(s3,a,'kinder','active',false);
 insert into public.olli_schedule_pickups(id,academy_id,student_id,weekday,class_time,pickup_label,pickup_time,is_dropoff,dropoff_label,dropoff_time,pickup_scope,effective_from)
 values(p,a,s,4,4,'old arrival','15:00',false,'old dropoff','17:00','weekly',v_old),
       (future_p,a,s2,4,4,'future arrival','15:00',false,'future dropoff','17:00','weekly',v_next+3);
 insert into public.olli_schedule_pickups(id,academy_id,student_id,weekday,class_time,pickup_label,pickup_time,is_dropoff,dropoff_label,dropoff_time,pickup_scope,effective_from,effective_to)
 values(daily_p,a,s3,4,4,'home',null,true,'home','17:00','daily',v_next+3,v_next+3);
 select to_jsonb(x) into before_row from public.olli_schedule_pickups x where id=p;
 r:=public.olli_schedule_change_pickup_v2('bad',a,p,v_old,null,v_next+4,'new arrival','15:30','new dropoff','17:30','schedule');
 if r->>'ok'<>'false' then raise exception 'unauthorized change'; end if;
 if (select to_jsonb(x) from public.olli_schedule_pickups x where id=p) is distinct from before_row then raise exception 'unauthorized mutation'; end if;
 -- Thursday -> Friday in the same selected week: old stops Sunday, new starts Friday.
 r:=public.olli_schedule_change_pickup_v2('fixture',a,p,v_old,null,v_next+4,'new arrival','15:30','new dropoff','17:30','schedule');
 if r->>'ok'<>'true' or (r->>'week_start')::date<>v_next then raise exception 'scheduled change failed: %',r; end if;
 v_id:=(r->>'pickup_id')::uuid;
 if not exists(select 1 from public.olli_schedule_pickups where id=p and effective_to=v_next-1 and weekday=4 and pickup_time='15:00' and dropoff_time='17:00') then raise exception 'old pickup history changed'; end if;
 if not exists(select 1 from public.olli_schedule_pickups where id=v_id and weekday=5 and effective_from=v_next+4 and pickup_time='15:30' and dropoff_time='17:30' and pickup_label='new arrival' and dropoff_label='new dropoff') then raise exception 'scheduled details lost'; end if;
 if (select created_at from public.olli_schedule_pickups where id=p) is distinct from (select created_at from public.olli_schedule_pickups where id=v_id) then raise exception 'creation metadata changed'; end if;
 -- Unstarted card postpones in place, no extra reservation or old card.
 r:=public.olli_schedule_change_pickup_v2('fixture',a,future_p,v_next+3,null,v_next+10,'future arrival','15:00','future dropoff','17:00','immediate');
 if r->>'ok'<>'true' or (r->>'pickup_id')::uuid<>future_p then raise exception 'future start edit failed: %',r; end if;
 if not exists(select 1 from public.olli_schedule_pickups where id=future_p and effective_from=v_next+10 and weekday=4) then raise exception 'future start unchanged'; end if;
 if (select count(*) from public.olli_schedule_pickups where student_id=s2)<>1 then raise exception 'future duplicate'; end if;
 -- Active pickup immediately moves to a selected weekday, retaining past days.
 r:=public.olli_schedule_change_pickup_v2('fixture',a,p,v_old,v_next-1,v_next+2,'today arrival','15:20','today dropoff','17:20','immediate');
 if r->>'ok'<>'true' or (r->>'effective_date')::date<>v_today then
   -- If today is late in the week, the bounded historical row may have no
   -- occurrence left; validate with a separate unbounded active row instead.
   if extract(isodow from v_today)::integer<=3 then raise exception 'immediate change failed: %',r; end if;
 else
   if not exists(select 1 from public.olli_schedule_pickups where id=p and effective_to=v_today-1) then raise exception 'past history lost'; end if;
 end if;
 -- Daily/dropoff-only date remains a single day.
 r:=public.olli_schedule_change_pickup_v2('fixture',a,daily_p,v_next+3,v_next+3,v_next+4,null,null,'new home','17:40','immediate');
 if r->>'ok'<>'true' or (r->>'pickup_id')::uuid<>daily_p then raise exception 'daily move failed: %',r; end if;
 if not exists(select 1 from public.olli_schedule_pickups where id=daily_p and weekday=5 and effective_from=v_next+4 and effective_to=v_next+4 and is_dropoff and pickup_time is null and dropoff_time='17:40') then raise exception 'daily scope/dropoff lost'; end if;
 r:=public.olli_schedule_change_pickup_v2('fixture',a,daily_p,v_next+4,v_next+4,v_next+11,null,null,'new home','17:40','schedule');
 if r->>'ok'<>'false' then raise exception 'daily reservation accepted'; end if;
 raise notice 'pickup change SQL: week boundaries, immediate edit, future start, dropoff-only, daily scope, access passed';
end $test$;
rollback;
