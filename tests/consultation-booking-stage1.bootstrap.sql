-- Isolated CI fixture only. Not for the production Supabase project.
create schema if not exists extensions;
create schema if not exists olli_consultation_private;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon,authenticated,service_role;
create table public.academies (
  id uuid primary key,
  status text not null default 'active',
  access_status text not null default 'active',
  deleted_at timestamptz
);
create table public.students (
  id uuid primary key,
  academy_id uuid not null references public.academies(id),
  name text not null default '테스트 학생',
  status text not null default 'active',
  is_deleted boolean not null default false,
  unique(id,academy_id)
);
-- Replaces the real Olli session helper only in an isolated database.
create function olli_consultation_private.require_owner(
  p_session_token text,p_academy_id uuid
) returns void language plpgsql set search_path='' as $$
begin
  if p_session_token is distinct from 'fixture-owner'
    or p_academy_id is distinct from 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid then
      raise exception 'OWNER_REQUIRED' using errcode='42501';
  end if;
end $$;
insert into public.academies(id) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.students(id,academy_id) values
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
