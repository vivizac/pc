-- Keep editable feedback tables on one update-timestamp contract.
-- feedbacks already has updated_at; fail_feedbacks and summary_feedbacks
-- must expose the same column because the shared edit path writes it.

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

notify pgrst, 'reload schema';
