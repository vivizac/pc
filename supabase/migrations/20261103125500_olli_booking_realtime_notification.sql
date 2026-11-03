-- Consultation booking changes piggyback on the existing random, session-
-- authorized academy Realtime topic. Broadcast contains NO student data.
-- Existing observation/schedule/chat sync functions are unchanged.
begin;

create or replace function private.olli_booking_realtime_notify_change()
returns trigger language plpgsql security definer set search_path = ''
as $function$
declare
  v_academy_id uuid;
  v_topic text;
begin
  if tg_op = 'DELETE' then
    v_academy_id := old.academy_id;
  else
    v_academy_id := new.academy_id;
    if tg_op = 'UPDATE' and new.status is not distinct from old.status
       and new.start_at is not distinct from old.start_at
       and new.end_at is not distinct from old.end_at
       and new.student_id is not distinct from old.student_id
       and new.intake_id is not distinct from old.intake_id
       and new.academy_id is not distinct from old.academy_id then
      return new;
    end if;
  end if;

  v_topic := private.olli_realtime_topic_for_academy(v_academy_id);
  if v_topic is not null then
    perform realtime.send(
      pg_catalog.jsonb_build_object('protocol',1,'domain','booking','revision',0),
      'changed',v_topic,false
    );
  end if;
  -- No reminder or realtime disruption must roll back a confirmed booking.
  return case when tg_op='DELETE' then old else new end;
exception when others then
  raise warning 'OLLI booking refresh signal skipped: %', sqlerrm;
  return case when tg_op='DELETE' then old else new end;
end;
$function$;

revoke all on function private.olli_booking_realtime_notify_change()
from public,anon,authenticated;

drop trigger if exists olli_booking_realtime_notify_trg on public.olli_booking_reservations;
create trigger olli_booking_realtime_notify_trg
after insert or update of status,start_at,end_at,student_id,intake_id,academy_id or delete
on public.olli_booking_reservations
for each row execute function private.olli_booking_realtime_notify_change();

commit;
