create table if not exists private.olli_realtime_topics (
  academy_id uuid primary key references public.academies(id) on delete cascade,
  topic_token text not null unique,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

alter table private.olli_realtime_topics enable row level security;
revoke all on table private.olli_realtime_topics from public, anon, authenticated;

insert into private.olli_realtime_topics (academy_id, topic_token)
select
  a.id,
  replace(pg_catalog.gen_random_uuid()::text, '-', '') || replace(pg_catalog.gen_random_uuid()::text, '-', '')
from public.academies a
on conflict (academy_id) do nothing;

create or replace function private.olli_realtime_can_access(
  p_session_token text,
  p_academy_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.academy_members m
    where m.academy_id = p_academy_id
      and m.account_id = public.olli_account_id_from_session(p_session_token)
      and m.status = 'active'
      and m.role in ('owner', 'manager', 'teacher')
  );
$function$;

revoke all on function private.olli_realtime_can_access(text, uuid) from public, anon, authenticated;

create or replace function private.olli_realtime_topic_for_academy(
  p_academy_id uuid
)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_topic_token text;
begin
  if p_academy_id is null then
    return null;
  end if;

  insert into private.olli_realtime_topics (academy_id, topic_token)
  values (
    p_academy_id,
    replace(pg_catalog.gen_random_uuid()::text, '-', '') || replace(pg_catalog.gen_random_uuid()::text, '-', '')
  )
  on conflict (academy_id) do nothing;

  select t.topic_token
    into v_topic_token
  from private.olli_realtime_topics t
  where t.academy_id = p_academy_id;

  if v_topic_token is null then
    return null;
  end if;

  return 'olli:' || v_topic_token;
end;
$function$;

revoke all on function private.olli_realtime_topic_for_academy(uuid) from public, anon, authenticated;

create or replace function private.olli_realtime_send_signal(
  p_academy_id uuid,
  p_domain text,
  p_revision bigint default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_topic text;
  v_domain text;
begin
  v_domain := lower(btrim(coalesce(p_domain, '')));
  if p_academy_id is null or v_domain not in ('observation', 'schedule') then
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

revoke all on function private.olli_realtime_send_signal(uuid, text, bigint) from public, anon, authenticated;

create or replace function public.olli_realtime_channel_info(
  p_session_token text,
  p_academy_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_topic text;
begin
  if not private.olli_realtime_can_access(p_session_token, p_academy_id) then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'message', '리얼타임 동기화 채널을 사용할 권한이 없습니다.'
    );
  end if;

  v_topic := private.olli_realtime_topic_for_academy(p_academy_id);
  if v_topic is null then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'message', '리얼타임 동기화 채널을 준비하지 못했습니다.'
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'topic', v_topic,
    'protocol', 1
  );
end;
$function$;

revoke all on function public.olli_realtime_channel_info(text, uuid) from public;
grant execute on function public.olli_realtime_channel_info(text, uuid) to anon, authenticated;

create or replace function private.olli_realtime_schedule_revision_signal()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  perform private.olli_realtime_send_signal(new.academy_id, 'schedule', new.version);
  return new;
end;
$function$;

drop trigger if exists olli_realtime_schedule_revision_signal_trg on public.olli_schedule_sync_revisions;
create trigger olli_realtime_schedule_revision_signal_trg
after insert or update on public.olli_schedule_sync_revisions
for each row execute function private.olli_realtime_schedule_revision_signal();

create or replace function private.olli_realtime_observation_signal()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_academy_id uuid;
  v_revision bigint;
begin
  if tg_op = 'DELETE' then
    v_academy_id := old.academy_id;
    v_revision := old.revision;
  else
    v_academy_id := new.academy_id;
    v_revision := new.revision;
  end if;

  perform private.olli_realtime_send_signal(v_academy_id, 'observation', v_revision);
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

drop trigger if exists olli_realtime_observation_signal_trg on public.student_note_drafts;
create trigger olli_realtime_observation_signal_trg
after insert or update or delete on public.student_note_drafts
for each row execute function private.olli_realtime_observation_signal();
