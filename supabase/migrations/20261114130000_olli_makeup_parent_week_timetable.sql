-- Read-only guardian makeup week timetable.
-- Additive: existing parent authentication, vacancy, submit, revision and timetable RPCs stay unchanged.
begin;
create function public.olli_makeup_parent_week(
  p_token_hash text,
  p_week_start date
) returns jsonb
language plpgsql security definer set search_path=''
as $fn$
declare
  v_session public.olli_makeup_parent_sessions%rowtype;
  v_division text;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_first_monday date;
  v_rows jsonb;
begin
  select * into v_session
    from public.olli_makeup_parent_sessions
    where token_hash=p_token_hash and expires_at>now();
  if not found then
    return jsonb_build_object('ok',false,'code','ACCESS_DENIED');
  end if;

  select s.division into v_division
    from public.students s
    join public.academies a on a.id=s.academy_id
    where s.id=v_session.student_id and s.academy_id=v_session.academy_id
      and s.status='active' and not s.is_deleted
      and not coalesce(s.is_stat_only,false)
      and a.status='active' and a.access_status='active' and a.deleted_at is null;
  if v_division is null then
    return jsonb_build_object('ok',false,'code','ACCESS_DENIED');
  end if;

  v_first_monday := v_today - (extract(isodow from v_today)::integer-1);
  if p_week_start is null
     or extract(isodow from p_week_start)::integer<>1
     or p_week_start<v_first_monday
     or p_week_start>v_today+90
  then
    return jsonb_build_object('ok',false,'code','DATE_INVALID');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'date',d.day,
    'time_slot',t.slot,
    'group',g.grp,
    'label',private.olli_makeup_slot_label(
      v_session.academy_id,v_division,d.day,t.slot),
    'status',case
      when d.day<v_today or d.day>v_today+90 then 'past'
      when private.olli_schedule_is_closed_day(v_session.academy_id,d.day) then 'closed'
      when counts.own_regular or counts.own_once then 'own'
      when counts.regular_count+counts.once_count >= private.olli_schedule_capacity(
        v_session.academy_id,v_division)
        and counts.other_makeup then 'prebooked'
      when counts.regular_count+counts.once_count >= private.olli_schedule_capacity(
        v_session.academy_id,v_division) then 'unavailable'
      else 'available' end
  ) order by d.day,t.slot,g.grp),'[]'::jsonb)
  into v_rows
  from generate_series(0,5) as offset_day(day_index)
  cross join generate_series(1,12) as t(slot)
  cross join (values('A'),('B')) as g(grp)
  cross join lateral (
    select (p_week_start+offset_day.day_index)::date as day
  ) d
  cross join lateral (
    select extract(isodow from d.day)::integer as weekday,
      private.olli_schedule_group_is_enabled(
        v_session.academy_id,v_division,
        extract(isodow from d.day)::integer,t.slot,d.day) as is_split
  ) context
  cross join lateral (
    select
      (select count(*)
        from public.olli_schedule_enrollments e
        join public.students s on s.id=e.student_id
        where e.academy_id=v_session.academy_id and s.division=v_division
          and s.status='active' and not s.is_deleted
          and e.status='active' and e.weekday=context.weekday
          and e.time_slot=t.slot
          and (not context.is_split
            or upper(coalesce(nullif(btrim(e.class_group),''),'A'))=g.grp)
          and e.effective_from<=d.day
          and (e.effective_to is null or e.effective_to>=d.day)
          and not exists (
            select 1 from private.olli_schedule_attendance_session_overrides a
              where a.academy_id=v_session.academy_id and a.student_id=e.student_id
                and a.session_date=d.day and a.time_slot=t.slot
                and a.session_kind='regular' and a.status='absent'
                and (not context.is_split or upper(coalesce(nullif(btrim(a.class_group),''),'A'))=g.grp)
          )
      ) as regular_count,
      (select count(*)
        from public.olli_schedule_one_time_sessions o
        left join public.students s on s.id=o.student_id
        where o.academy_id=v_session.academy_id
          and coalesce(s.division,o.guest_division)=v_division
          and (o.student_id is null or (s.status='active' and not s.is_deleted))
          and o.session_date=d.day and o.time_slot=t.slot
          and o.status<>'cancelled'
          and (not context.is_split or o.class_group=g.grp)
      ) as once_count,
      exists(select 1
        from public.olli_schedule_enrollments e
        where e.academy_id=v_session.academy_id
          and e.student_id=v_session.student_id
          and e.status='active' and e.weekday=context.weekday
          and e.time_slot=t.slot
          and e.effective_from<=d.day
          and (e.effective_to is null or e.effective_to>=d.day)
      ) as own_regular,
      exists(select 1
        from public.olli_schedule_one_time_sessions o
        where o.academy_id=v_session.academy_id
          and o.student_id=v_session.student_id
          and o.session_date=d.day and o.time_slot=t.slot
          and o.status<>'cancelled'
      ) as own_once,
      exists(select 1
        from public.olli_schedule_one_time_sessions o
        join public.students s on s.id=o.student_id
        where o.academy_id=v_session.academy_id
          and o.student_id<>v_session.student_id
          and s.division=v_division
          and s.status='active' and not s.is_deleted
          and o.session_type='makeup'
          and o.status<>'cancelled'
          and o.session_date=d.day and o.time_slot=t.slot
          and (not context.is_split or o.class_group=g.grp)
      ) as other_makeup
  ) counts
  where private.olli_schedule_slot_is_valid(
        v_session.academy_id,v_division,context.weekday,t.slot)
    and (g.grp='A' or context.is_split);

  return jsonb_build_object(
    'ok',true,'week_start',p_week_start,'slots',v_rows);
end;
$fn$;
revoke all on function public.olli_makeup_parent_week(text,date)
  from public,anon,authenticated;
grant execute on function public.olli_makeup_parent_week(text,date)
  to service_role;
commit;
