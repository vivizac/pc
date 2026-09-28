
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
    p_academy_id,
    p_division,
    p_weekday,
    p_time_slot,
    coalesce(
      private.olli_schedule_first_occurrence_on_or_after(
        nullif(current_setting('olli.schedule_effective_date', true), '')::date,
        p_weekday
      ),
      current_date
    )
  );
$$;

create or replace function public.olli_schedule_split_class(
  p_session_token text,p_academy_id uuid,p_weekday integer,p_time_slot integer
)
returns jsonb language sql security definer set search_path=''
as $$
  select public.olli_schedule_split_class(
    p_session_token,p_academy_id,p_weekday,p_time_slot,
    coalesce(
      private.olli_schedule_first_occurrence_on_or_after(
        nullif(current_setting('olli.schedule_effective_date', true), '')::date,
        p_weekday
      ),
      private.olli_schedule_first_occurrence_on_or_after(current_date,p_weekday)
    )
  );
$$;

create or replace function public.olli_schedule_merge_class(
  p_session_token text,p_academy_id uuid,p_weekday integer,p_time_slot integer
)
returns jsonb language sql security definer set search_path=''
as $$
  select public.olli_schedule_merge_class(
    p_session_token,p_academy_id,p_weekday,p_time_slot,
    coalesce(
      private.olli_schedule_first_occurrence_on_or_after(
        nullif(current_setting('olli.schedule_effective_date', true), '')::date,
        p_weekday
      ),
      private.olli_schedule_first_occurrence_on_or_after(current_date,p_weekday)
    )
  );
$$;
