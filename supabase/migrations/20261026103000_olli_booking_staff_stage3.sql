-- Olli booking stage 3: authenticated academy-owner schedule management.
-- Branch-only migration. No data movement and no feedback/summary mutation.
begin;

create table public.olli_booking_staff_mutations (
  academy_id uuid not null references public.academies(id) on delete cascade,
  request_key uuid not null,
  reservation_id uuid not null references public.olli_booking_reservations(id) on delete cascade,
  action text not null check (action in ('reschedule','cancel')),
  new_start_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (academy_id,request_key)
);
create index olli_booking_staff_mutations_reservation_idx
 on public.olli_booking_staff_mutations(reservation_id,created_at);
alter table public.olli_booking_staff_mutations enable row level security;
revoke all on public.olli_booking_staff_mutations from public,anon,authenticated;
grant select,insert,update,delete on public.olli_booking_staff_mutations to service_role;

create function public.olli_booking_staff_manage(
 p_session_token text,
 p_academy_id uuid,
 p_action text default 'list',
 p_month text default null,
 p_reservation_id uuid default null,
 p_start_at timestamptz default null,
 p_request_key uuid default null
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
 v_month date;
 v_rows jsonb;
 v_settings public.olli_booking_settings%rowtype;
 v_record public.olli_booking_reservations%rowtype;
 v_saved public.olli_booking_staff_mutations%rowtype;
 v_end timestamptz;
begin
 perform olli_consultation_private.require_owner(p_session_token,p_academy_id);
 if p_action not in ('list','reschedule','cancel') then
  raise exception 'INVALID_ACTION' using errcode='22023';
 end if;
 if p_action='list' then
  if p_month is null or p_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then
    raise exception 'INVALID_MONTH' using errcode='22023';
  end if;
  v_month:=(p_month||'-01')::date;
  if v_month < date_trunc('month',(now() at time zone 'Asia/Seoul')-interval '12 months')::date
    or v_month > date_trunc('month',(now() at time zone 'Asia/Seoul')+interval '12 months')::date then
    raise exception 'MONTH_OUTSIDE_RANGE' using errcode='22023';
  end if;
  insert into public.olli_booking_settings(academy_id) values(p_academy_id)
    on conflict(academy_id) do nothing;
  select * into strict v_settings from public.olli_booking_settings where academy_id=p_academy_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,
    'student_id',r.student_id,
    'intake_id',r.intake_id,
    'name',coalesce(s.name,i.child_name,'이름 없음'),
    'kind',case when r.student_id is not null then 'student' else 'intake' end,
    'start_at',r.start_at,'end_at',r.end_at,'status',r.status,
    'due_month',r.due_month,'rule_key',r.rule_key
  ) order by r.start_at),'[]'::jsonb) into v_rows
  from public.olli_booking_reservations r
  left join public.students s on s.id=r.student_id and s.academy_id=r.academy_id
  left join public.olli_booking_intakes i on i.id=r.intake_id and i.academy_id=r.academy_id
  where r.academy_id=p_academy_id and
    (r.start_at at time zone v_settings.timezone)::date>=v_month
    and (r.start_at at time zone v_settings.timezone)::date<(v_month+interval '1 month')::date;
  return jsonb_build_object('ok',true,'month',p_month,
    'appointments',v_rows,'settings',to_jsonb(v_settings));
 end if;

 if p_request_key is null or p_reservation_id is null then
  raise exception 'REQUEST_ID_REQUIRED' using errcode='22023';
 end if;
 if (p_action='cancel' and p_start_at is not null)
   or (p_action='reschedule' and p_start_at is null) then
    raise exception 'INVALID_MUTATION_DATA' using errcode='22023';
 end if;
 -- Serialize duplicate retries and overlapping owner/parent updates to this target.
 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(p_academy_id::text||':'||p_reservation_id::text,0));
 select * into v_saved from public.olli_booking_staff_mutations m
   where m.academy_id=p_academy_id and m.request_key=p_request_key;
 if found then
   if v_saved.action<>p_action or v_saved.reservation_id<>p_reservation_id
     or v_saved.new_start_at is distinct from p_start_at then
     raise exception 'REQUEST_KEY_REUSED' using errcode='22023';
   end if;
   return jsonb_build_object('ok',true,'reservation_id',p_reservation_id,'replayed',true);
 end if;
 select * into v_record from public.olli_booking_reservations
   where id=p_reservation_id and academy_id=p_academy_id and status='confirmed'
   for update;
 if not found then raise exception 'ACTIVE_RESERVATION_NOT_FOUND' using errcode='22023'; end if;
 if p_action='reschedule' then
   v_end:=olli_booking_private.assert_slot(p_academy_id,p_start_at);
   if p_start_at=v_record.start_at then
     raise exception 'SAME_SLOT' using errcode='22023';
   end if;
   update public.olli_booking_reservations set start_at=p_start_at,end_at=v_end,
     updated_at=clock_timestamp() where id=v_record.id;
   insert into public.olli_booking_events(reservation_id,academy_id,action,actor,detail)
     values(v_record.id,p_academy_id,'rescheduled','staff',
       jsonb_build_object('previous_start_at',v_record.start_at,'new_start_at',p_start_at));
 else
   update public.olli_booking_reservations set status='cancelled',updated_at=clock_timestamp()
    where id=v_record.id;
   insert into public.olli_booking_events(reservation_id,academy_id,action,actor)
    values(v_record.id,p_academy_id,'cancelled','staff');
 end if;
 insert into public.olli_booking_staff_mutations
   (academy_id,request_key,reservation_id,action,new_start_at)
   values(p_academy_id,p_request_key,p_reservation_id,p_action,p_start_at);
 return jsonb_build_object('ok',true,'reservation_id',p_reservation_id,'replayed',false);
end;
$function$;
-- Function is exposed only through the established authenticated Olli session checks.
revoke all on function public.olli_booking_staff_manage(text,uuid,text,text,uuid,timestamptz,uuid)
  from public,anon,authenticated;
grant execute on function public.olli_booking_staff_manage(text,uuid,text,text,uuid,timestamptz,uuid)
  to anon,authenticated,service_role;
commit;
