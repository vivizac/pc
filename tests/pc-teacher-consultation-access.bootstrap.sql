-- Isolated CI fixture. No production sessions or student data.
alter table public.academies add column owner_member_id uuid, add column updated_at timestamptz default now(), add column consultation_survey_token text default 'fixture-link';
create table public.academy_members (
 id uuid primary key, academy_id uuid not null references public.academies(id),
 account_id uuid, display_name text, role text not null check(role in ('owner','manager','teacher')),
 status text not null default 'active', created_at timestamptz default now(), updated_at timestamptz default now()
);
create function public.olli_account_id_from_session(p_session_token text) returns uuid
language sql immutable as $$
 select case p_session_token when 'fixture-owner' then '10000000-0000-4000-8000-000000000001'::uuid
 when 'fixture-teacher' then '10000000-0000-4000-8000-000000000002'::uuid
 when 'fixture-other' then '10000000-0000-4000-8000-000000000003'::uuid else null end
$$;
insert into public.academy_members(id,academy_id,account_id,display_name,role) values
 ('20000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000001','owner','owner'),
 ('20000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000002','teacher','teacher'),
 ('20000000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000003','other','teacher'),
 ('20000000-0000-4000-8000-000000000004','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','10000000-0000-4000-8000-000000000002','teacher elsewhere','teacher');
-- Survey tables are not part of the booking fixture. Compile their SQL functions
-- lazily and execute the permission check and booking paths below.
set check_function_bodies = false;
