-- Date-effective elementary A/B class layout v2.
-- Backward-compatible during rollout: legacy class_splits snapshots remain in read RPCs.

alter table public.olli_schedule_class_splits
  add column if not exists effective_from date,
  add column if not exists effective_to date;

update public.olli_schedule_class_splits
set effective_from = (created_at at time zone 'Asia/Seoul')::date
where effective_from is null;

alter table public.olli_schedule_class_splits
  alter column effective_from set not null;

alter table public.olli_schedule_class_splits
  drop constraint if exists olli_schedule_class_splits_pkey;
alter table public.olli_schedule_class_splits
  add constraint olli_schedule_class_splits_pkey
  primary key (academy_id, weekday, time_slot, effective_from);

alter table public.olli_schedule_class_splits
  drop constraint if exists olli_schedule_class_splits_effective_range_check;
alter table public.olli_schedule_class_splits
  add constraint olli_schedule_class_splits_effective_range_check
  check (effective_to is null or effective_to >= effective_from);

create index if not exists olli_schedule_class_splits_lookup_idx
  on public.olli_schedule_class_splits (academy_id, weekday, time_slot, effective_from, effective_to);

create or replace function private.olli_schedule_first_occurrence_on_or_after(
  p_effective_date date,
  p_weekday integer
)
returns date
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_effective_date is null or p_weekday not between 1 and 7 then null
    else p_effective_date + ((p_weekday - extract(isodow from p_effective_date)::integer + 7) % 7)
  end;
$$;

create or replace function private.olli_schedule_class_split_at(
  p_academy_id uuid,
  p_weekday integer,
  p_time_slot integer,
  p_session_date date
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when p_academy_id is null or p_session_date is null then false
    else exists (
      select 1
      from public.olli_schedule_class_splits s
      where s.academy_id = p_academy_id
        and s.weekday = p_weekday
        and s.time_slot = p_time_slot
        and s.effective_from <= p_session_date
        and (s.effective_to is null or s.effective_to >= p_session_date)
    )
  end;
$$;

create or replace function private.olli_schedule_group_is_enabled(
  p_academy_id uuid,
  p_division text,
  p_weekday integer,
  p_time_slot integer,
  p_target_date date
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when coalesce(p_division, 'elementary') = 'kinder' then true
    when p_target_date is null then false
    else private.olli_schedule_class_split_at(
      p_academy_id,p_weekday,p_time_slot,p_target_date
    )
  end;
$$;

-- Transitional wrapper for old server code only.
create or replace function private.olli_schedule_group_is_enabled(
  p_academy_id uuid,
  p_division text,
  p_weekday integer,
  p_time_slot integer
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.olli_schedule_group_is_enabled(
    p_academy_id,p_division,p_weekday,p_time_slot,current_date
  );
$$;

create or replace function private.olli_schedule_validate_class_split_period()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_overlap boolean;
begin
  if new.effective_to is not null and new.effective_to < new.effective_from then
    raise exception 'CLASS_LAYOUT_CONFLICT: invalid effective range';
  end if;

  if tg_op = 'INSERT' then
    select exists (
      select 1
      from public.olli_schedule_class_splits s
      where s.academy_id=new.academy_id
        and s.weekday=new.weekday
        and s.time_slot=new.time_slot
        and daterange(s.effective_from,coalesce(s.effective_to,'infinity'::date),'[]')
          && daterange(new.effective_from,coalesce(new.effective_to,'infinity'::date),'[]')
    ) into v_overlap;
  else
    select exists (
      select 1
      from public.olli_schedule_class_splits s
      where s.academy_id=new.academy_id
        and s.weekday=new.weekday
        and s.time_slot=new.time_slot
        and (s.academy_id,s.weekday,s.time_slot,s.effective_from)
          <> (old.academy_id,old.weekday,old.time_slot,old.effective_from)
        and daterange(s.effective_from,coalesce(s.effective_to,'infinity'::date),'[]')
          && daterange(new.effective_from,coalesce(new.effective_to,'infinity'::date),'[]')
    ) into v_overlap;
  end if;

  if v_overlap then
    raise exception 'CLASS_LAYOUT_CONFLICT: overlapping split periods';
  end if;
  return new;
end;
$$;

drop trigger if exists olli_schedule_class_split_period_guard_trg
  on public.olli_schedule_class_splits;
create trigger olli_schedule_class_split_period_guard_trg
before insert or update on public.olli_schedule_class_splits
for each row execute function private.olli_schedule_validate_class_split_period();

do $$
begin
  if to_regprocedure('public.olli_schedule_week_legacy_v1(text,uuid,date)') is null then
    alter function public.olli_schedule_week(text,uuid,date)
      rename to olli_schedule_week_legacy_v1;
  end if;
  if to_regprocedure('public.olli_schedule_availability_horizon_legacy_v1(text,uuid,date,date)') is null then
    alter function public.olli_schedule_availability_horizon(text,uuid,date,date)
      rename to olli_schedule_availability_horizon_legacy_v1;
  end if;
end;
$$;

create or replace function public.olli_schedule_week(
  p_session_token text,p_academy_id uuid,p_week_start date
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_base jsonb;
  v_periods jsonb;
  v_legacy_snapshot jsonb;
  v_start date := p_week_start;
  v_end date := p_week_start + 6;
begin
  v_base := public.olli_schedule_week_legacy_v1(p_session_token,p_academy_id,p_week_start);
  if not coalesce((v_base->>'ok')::boolean,false) then return v_base; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'weekday',s.weekday,'time_slot',s.time_slot,
    'effective_from',s.effective_from,'effective_to',s.effective_to
  ) order by s.weekday,s.time_slot,s.effective_from),'[]'::jsonb)
  into v_periods
  from public.olli_schedule_class_splits s
  where s.academy_id=p_academy_id
    and s.effective_from<=v_end
    and (s.effective_to is null or s.effective_to>=v_start);

  select coalesce(jsonb_agg(jsonb_build_object(
    'weekday',x.weekday,'time_slot',x.time_slot
  ) order by x.weekday,x.time_slot),'[]'::jsonb)
  into v_legacy_snapshot
  from (
    select distinct s.weekday,s.time_slot
    from public.olli_schedule_class_splits s
    where s.academy_id=p_academy_id
      and s.effective_from<=current_date
      and (s.effective_to is null or s.effective_to>=current_date)
  ) x;

  return v_base || jsonb_build_object(
    'class_layout_version',2,
    'class_split_periods',v_periods,
    'class_splits',v_legacy_snapshot
  );
end;
$$;

create or replace function public.olli_schedule_availability_horizon(
  p_session_token text,p_academy_id uuid,p_start_date date,p_end_date date
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_base jsonb;
  v_periods jsonb;
  v_legacy_snapshot jsonb;
begin
  v_base := public.olli_schedule_availability_horizon_legacy_v1(
    p_session_token,p_academy_id,p_start_date,p_end_date
  );
  if not coalesce((v_base->>'ok')::boolean,false) then return v_base; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'weekday',s.weekday,'time_slot',s.time_slot,
    'effective_from',s.effective_from,'effective_to',s.effective_to
  ) order by s.weekday,s.time_slot,s.effective_from),'[]'::jsonb)
  into v_periods
  from public.olli_schedule_class_splits s
  where s.academy_id=p_academy_id
    and s.effective_from<=p_end_date
    and (s.effective_to is null or s.effective_to>=p_start_date);

  select coalesce(jsonb_agg(jsonb_build_object(
    'weekday',x.weekday,'time_slot',x.time_slot
  ) order by x.weekday,x.time_slot),'[]'::jsonb)
  into v_legacy_snapshot
  from (
    select distinct s.weekday,s.time_slot
    from public.olli_schedule_class_splits s
    where s.academy_id=p_academy_id
      and s.effective_from<=current_date
      and (s.effective_to is null or s.effective_to>=current_date)
  ) x;

  return v_base || jsonb_build_object(
    'class_layout_version',2,
    'class_split_periods',v_periods,
    'class_splits',v_legacy_snapshot
  );
end;
$$;

revoke all on function public.olli_schedule_week(text,uuid,date) from public,anon,authenticated;
grant execute on function public.olli_schedule_week(text,uuid,date) to anon,authenticated;
revoke all on function public.olli_schedule_availability_horizon(text,uuid,date,date) from public,anon,authenticated;
grant execute on function public.olli_schedule_availability_horizon(text,uuid,date,date) to anon,authenticated;
revoke all on function public.olli_schedule_week_legacy_v1(text,uuid,date) from public,anon,authenticated;
revoke all on function public.olli_schedule_availability_horizon_legacy_v1(text,uuid,date,date) from public,anon,authenticated;

