-- Store lesson month of growth feedback separately from writing date, preserving legacy rows.
alter table public.feedbacks add column if not exists target_month text;
alter table public.feedbacks drop constraint if exists feedbacks_target_month_valid;
alter table public.feedbacks add constraint feedbacks_target_month_valid
 check (target_month is null or target_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$');
comment on column public.feedbacks.target_month is
 'YYYY-MM lesson month of feedback; can precede created_at month.';
