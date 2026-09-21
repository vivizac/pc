alter table public.fail_feedbacks
  add column if not exists updated_at timestamptz;

update public.fail_feedbacks
set updated_at = coalesce(created_at, now())
where updated_at is null;

alter table public.fail_feedbacks
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table public.summary_feedbacks
  add column if not exists updated_at timestamptz;

update public.summary_feedbacks
set updated_at = coalesce(created_at, now())
where updated_at is null;

alter table public.summary_feedbacks
  alter column updated_at set default now(),
  alter column updated_at set not null;
