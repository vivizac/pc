-- Olli Naver Booking single-academy pilot. DO NOT deploy until API connection secrets and rollout tests are approved.
-- No role except service_role may read these sensitive child records directly.
create table if not exists public.olli_naver_booking_pilot_reservations (
  academy_id uuid not null references public.academies(id) on delete cascade,
  booking_number text not null check (booking_number ~ '^[0-9]{8,20}$'),
  business_id text not null check (business_id ~ '^[0-9]{1,20}$'),
  product_name text not null default '' check (char_length(product_name) <= 200),
  starts_at timestamptz,
  student_name text not null check (char_length(student_name) between 1 and 80),
  grade_or_age text not null default '' check (char_length(grade_or_age) <= 80),
  status text not null default 'confirmed' check (status in ('confirmed','cancelled','changed')),
  matched_student_id uuid references public.students(id) on delete set null,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (academy_id,booking_number)
);
create index if not exists olli_naver_booking_pilot_due_idx
  on public.olli_naver_booking_pilot_reservations(academy_id,starts_at);
alter table public.olli_naver_booking_pilot_reservations enable row level security;
revoke all on public.olli_naver_booking_pilot_reservations from public,anon,authenticated;
grant select,insert,update on public.olli_naver_booking_pilot_reservations to service_role;
-- Matched students must belong to the same academy and remain actively enrolled.
create or replace function public.olli_naver_booking_pilot_guard_match()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.matched_student_id is not null and not exists(
    select 1 from public.students s
    where s.id=new.matched_student_id and s.academy_id=new.academy_id
      and s.status='active' and s.deleted_at is null and not coalesce(s.is_deleted,false)
      and btrim(s.name)=btrim(new.student_name)
  ) then
    raise exception 'Booking student assignment is invalid' using errcode='23514';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.olli_naver_booking_pilot_guard_match() from public,anon,authenticated;
drop trigger if exists olli_naver_booking_pilot_guard_match on public.olli_naver_booking_pilot_reservations;
create trigger olli_naver_booking_pilot_guard_match
before insert or update on public.olli_naver_booking_pilot_reservations
for each row execute function public.olli_naver_booking_pilot_guard_match();
