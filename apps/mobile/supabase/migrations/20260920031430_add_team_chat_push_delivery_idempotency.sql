create table if not exists public.olli_team_chat_push_deliveries (
  message_id bigint not null,
  subscription_id uuid not null references public.olli_team_chat_push_subscriptions(id) on delete cascade,
  academy_id uuid not null references public.academies(id) on delete cascade,
  member_id uuid not null references public.academy_members(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  primary key (message_id, subscription_id),
  constraint olli_team_chat_push_deliveries_message_fk
    foreign key (academy_id, message_id)
    references public.olli_team_chat_messages(academy_id, id)
    on delete cascade
);

create index if not exists olli_team_chat_push_deliveries_member_idx
  on public.olli_team_chat_push_deliveries (academy_id, member_id, delivered_at desc);

alter table public.olli_team_chat_push_deliveries enable row level security;
revoke all on table public.olli_team_chat_push_deliveries from anon, authenticated;
grant select, insert, update, delete on table public.olli_team_chat_push_deliveries to service_role;
