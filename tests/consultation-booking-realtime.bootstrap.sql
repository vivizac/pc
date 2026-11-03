-- Isolated PostgreSQL only. Stub the existing Olli topic and Supabase send.
create schema if not exists private;
create schema if not exists realtime;
create table public.olli_booking_signal_fixture (
  id bigserial primary key,
  topic text not null,
  event text not null,
  private boolean not null,
  payload jsonb not null
);
create function private.olli_realtime_topic_for_academy(p_academy_id uuid)
returns text language sql as $$
 select 'olli:test:'||p_academy_id::text;
$$;
create function realtime.send(payload jsonb,event text,topic text,private boolean)
returns void language plpgsql as $$
begin
  insert into public.olli_booking_signal_fixture(topic,event,private,payload)
  values(topic,event,private,payload);
end;$$;
