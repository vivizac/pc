create or replace function private.olli_realtime_send_signal(
  p_academy_id uuid,
  p_domain text,
  p_revision bigint default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_topic text;
  v_domain text;
begin
  v_domain := lower(btrim(coalesce(p_domain, '')));
  if p_academy_id is null or v_domain not in ('observation', 'schedule', 'chat') then
    return;
  end if;

  v_topic := private.olli_realtime_topic_for_academy(p_academy_id);
  if v_topic is null then
    return;
  end if;

  perform realtime.send(
    pg_catalog.jsonb_build_object(
      'protocol', 1,
      'domain', v_domain,
      'revision', p_revision
    ),
    'changed',
    v_topic,
    false
  );
exception
  when others then
    raise warning 'OLLI realtime signal skipped: %', sqlerrm;
end;
$function$;

create or replace function private.olli_realtime_team_chat_signal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.olli_realtime_send_signal(new.academy_id, 'chat', new.id);
  return new;
end;
$function$;

drop trigger if exists olli_team_chat_realtime_signal_after_insert
  on public.olli_team_chat_messages;

create trigger olli_team_chat_realtime_signal_after_insert
after insert on public.olli_team_chat_messages
for each row
execute function private.olli_realtime_team_chat_signal();

comment on function private.olli_realtime_team_chat_signal()
  is 'Broadcasts an academy-scoped chat change signal after a durable team-chat insert. Clients re-read authoritative chat rows.';
