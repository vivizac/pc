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
\ir ../../../supabase/migrations/pc_pickup_immediate_continuation.sql
do $test$
declare
 a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
 s uuid := gen_random_uuid();
 s2 uuid := gen_random_uuid();
 s3 uuid := gen_random_uuid();
 s4 uuid := gen_random_uuid();
 s5 uuid := gen_random_uuid();
 s6 uuid := gen_random_uuid();
 s7 uuid := gen_random_uuid();
 p uuid := gen_random_uuid();
 q uuid := gen_random_uuid();
 p2 uuid := gen_random_uuid();
 q2 uuid := gen_random_uuid();
 p3 uuid := gen_random_uuid();
 q3 uuid := gen_random_uuid();
 p4 uuid := gen_random_uuid();
 q4 uuid := gen_random_uuid();
 p5 uuid := gen_random_uuid();
 p6 uuid := gen_random_uuid();
 q6 uuid := gen_random_uuid();
 p7 uuid := gen_random_uuid();
 q7 uuid := gen_random_uuid();
 v_today date := (now() at time zone 'Asia/Seoul')::date;
 v_next date := date_trunc('week',v_today)::date+7;
 r jsonb;
 v_id uuid;
begin
 insert into public.students values(s,a,'kinder','active',false),(s2,a,'kinder','active',false),(s3,a,'kinder','active',false),(s4,a,'kinder','active',false),(s5,a,'kinder','active',false),(s6,a,'kinder','active',false),(s7,a,'kinder','active',false);
 -- Reproduce the live case: identical weekly rows with a finite first segment.
 insert into public.olli_schedule_pickups(id,academy_id,student_id,weekday,class_time,pickup_label,pickup_time,is_dropoff,dropoff_label,dropoff_time,pickup_scope,effective_from,effective_to) values
 (p,a,s,3,5,'세븐','04:25',false,null,null,'weekly',v_next+2,v_next+8),
 (q,a,s,3,5,'세븐','04:25',false,null,null,'weekly',v_next+9,null),
 (p2,a,s2,3,5,'세븐','04:25',false,'home','17:30','weekly',v_next+2,v_next+8),
 (q2,a,s2,3,5,'세븐','04:25',false,'home','17:30','weekly',v_next+9,null),
 (p3,a,s3,3,5,'세븐','04:25',false,null,null,'weekly',v_next+2,v_next+8),
 (q3,a,s3,3,5,'different','04:35',false,null,null,'weekly',v_next+9,null),
 (p4,a,s4,3,5,'old','04:25',false,null,null,'weekly',v_next-28,v_next+1),
 (q4,a,s4,3,5,'old','04:25',false,null,null,'weekly',v_next+2,null),
 (p5,a,s5,3,5,'finite','04:25',false,null,null,'weekly',v_next+2,v_next+8),
 (p6,a,s6,3,5,'schedule','04:25',false,null,null,'weekly',v_next+2,v_next+8),
 (q6,a,s6,3,5,'schedule','04:25',false,null,null,'weekly',v_next+9,null),
 (p7,a,s7,3,4,'daily','04:25',false,null,null,'daily',v_next+2,v_next+2),
 (q7,a,s7,3,4,'daily','04:25',false,null,null,'daily',v_next+9,v_next+9);

 r:=public.olli_schedule_change_pickup_v2('fixture',a,p,v_next+2,v_next+8,v_next+9,'세븐','04:30',null,null,'immediate');
 if r->>'ok'<>'true' or (r->>'pickup_id')::uuid<>p then raise exception 'forward continuation failed %',r; end if;
 if not exists(select 1 from public.olli_schedule_pickups where id=p and effective_from=v_next+9 and effective_to is null and pickup_time='04:30' and status='active') then raise exception 'logical pickup not restored'; end if;
 if not exists(select 1 from public.olli_schedule_pickups where id=q and status='cancelled') then raise exception 'duplicate continuation not retired'; end if;
 -- Opening the later card resolves back to the same original pending pickup.
 r:=public.olli_schedule_change_pickup_v2('fixture',a,q2,v_next+9,null,v_next+16,'세븐','04:35','home','17:30','immediate');
 if r->>'ok'<>'true' or (r->>'pickup_id')::uuid<>p2 then raise exception 'backward continuation failed %',r; end if;
 if not exists(select 1 from public.olli_schedule_pickups where id=p2 and effective_from=v_next+16 and effective_to is null and dropoff_time='17:30' and status='active') then raise exception 'original pickup or dropoff lost'; end if;
 if not exists(select 1 from public.olli_schedule_pickups where id=q2 and status='cancelled') then raise exception 'later version not retired'; end if;
 -- Distinct future reservation is protected.
 r:=public.olli_schedule_change_pickup_v2('fixture',a,p3,v_next+2,v_next+8,v_next+9,'세븐','04:25',null,null,'immediate');
 if r->>'ok'<>'false' then raise exception 'different reservation overwritten %',r; end if;
 if not exists(select 1 from public.olli_schedule_pickups where id=q3 and status='active' and pickup_label='different') then raise exception 'different reservation changed'; end if;
 -- Already started pickup preserves history and extends new period through the continuation.
 r:=public.olli_schedule_change_pickup_v2('fixture',a,p4,v_next-28,v_next+1,v_next+2,'new','04:40',null,null,'immediate');
 if r->>'ok'<>'true' then raise exception 'active pickup edit failed %',r; end if;
 v_id:=(r->>'pickup_id')::uuid;
 if not exists(select 1 from public.olli_schedule_pickups where id=p4 and effective_to=v_today-1 and pickup_label='old' and status='active') then raise exception 'elapsed history changed'; end if;
 if not exists(select 1 from public.olli_schedule_pickups where id=v_id and effective_from=v_today and effective_to is null and pickup_label='new') then raise exception 'active edit not applied'; end if;
 if not exists(select 1 from public.olli_schedule_pickups where id=q4 and status='cancelled') then raise exception 'active continuation not retired'; end if;
 -- A real finite end is not extended silently.
 r:=public.olli_schedule_change_pickup_v2('fixture',a,p5,v_next+2,v_next+8,v_next+9,'finite','04:25',null,null,'immediate');
 if r->>'ok'<>'false' then raise exception 'finite pickup extended %',r; end if;
 -- Scheduling is deliberately independent of immediate consolidation.
 r:=public.olli_schedule_change_pickup_v2('fixture',a,p6,v_next+2,v_next+8,v_next+9,'schedule','04:30',null,null,'schedule');
 if r->>'ok'<>'false' then raise exception 'scheduled edit crossed another period %',r; end if;
 if not exists(select 1 from public.olli_schedule_pickups where id=q6 and status='active') then raise exception 'scheduled continuation touched'; end if;
 -- Daily rows are never merged, including identical pickups.
 r:=public.olli_schedule_change_pickup_v2('fixture',a,p7,v_next+2,v_next+2,v_next+3,'daily','04:25',null,null,'immediate');
 if r->>'ok'<>'true' then raise exception 'daily move failed %',r; end if;
 if not exists(select 1 from public.olli_schedule_pickups where id=p7 and effective_from=v_next+3 and effective_to=v_next+3 and pickup_scope='daily') then raise exception 'daily scope altered'; end if;
 if not exists(select 1 from public.olli_schedule_pickups where id=q7 and status='active' and effective_from=v_next+9) then raise exception 'independent daily pickup touched'; end if;
 raise notice 'pickup immediate continuation SQL: identical split rows, later card, history, true end, distinct reservation and daily scope passed';
end $test$;
rollback;
