-- Cover the class-split creator foreign key for account cleanup and joins.

create index if not exists olli_schedule_class_splits_creator_idx
  on public.olli_schedule_class_splits (created_by_account_id)
  where created_by_account_id is not null;
