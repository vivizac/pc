-- Existing sequence is owned by summary_feedbacks.id but the ID column has no default.
-- Server-owned consultation insert omits id; install the existing sequence as the
-- column default without altering any existing student or feedback rows.
-- In the live preflight: max(summary_feedbacks.id)=55; sequence last_value=55.
alter table public.summary_feedbacks
  alter column id set default nextval('public.summary_feedbacks_id_seq'::regclass);
