alter table public.olli_ai_usage_logs
  add column if not exists ttft_ms integer;

comment on column public.olli_ai_usage_logs.ttft_ms is
  'Time to first streamed text token in milliseconds; nullable for non-stream or legacy requests.';
