create table if not exists public.olli_consultation_test_sends (
 id uuid primary key default gen_random_uuid(),
 academy_id uuid not null references public.academies(id),
 student_id uuid not null references public.students(id),
 template_id text not null,
 status text not null default 'reserved' check(status in ('reserved','submitted','delivered','failed','unknown')),
 provider_message_id text,
 provider_code text,
 created_at timestamptz not null default now(),
 unique(academy_id,student_id,template_id)
);
alter table public.olli_consultation_test_sends enable row level security;
revoke all on public.olli_consultation_test_sends from public,anon,authenticated;
grant select,insert,update on public.olli_consultation_test_sends to service_role;
comment on table public.olli_consultation_test_sends is 'One-off owner-authorized test sends; never included in normal consultation delivery schedules.';
