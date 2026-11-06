-- Additive shared conversation boundary. Never repoint legacy academy messages.
-- Release gate intentionally starts closed; no production activation in this migration.
begin;

create table private.olli_shared_chat_release (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false
);
insert into private.olli_shared_chat_release(singleton) values (true);

create table private.olli_shared_chat_rooms (
  id uuid primary key default gen_random_uuid(),
  created_by_account_id uuid not null,
  revision bigint not null default 1,
  message_seq bigint not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz
);
create table private.olli_shared_chat_academies (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references private.olli_shared_chat_rooms(id),
  academy_id uuid not null references public.academies(id),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 20),
  joined_at timestamptz not null default clock_timestamp(),
  joined_after_seq bigint not null check (joined_after_seq >= 0),
  left_at timestamptz,
  active_name text generated always as (case when left_at is null then lower(btrim(display_name)) end) stored,
  constraint olli_shared_chat_unique_branch unique(room_id, active_name) deferrable initially deferred,
  check (left_at is null or left_at >= joined_at)
);
create unique index olli_shared_chat_one_active_room on private.olli_shared_chat_academies(academy_id) where left_at is null;
create index olli_shared_chat_room_academies on private.olli_shared_chat_academies(room_id) where left_at is null;

create table private.olli_shared_chat_messages (
  id bigint generated always as identity primary key,
  room_id uuid not null references private.olli_shared_chat_rooms(id),
  seq bigint not null,
  academy_id uuid references public.academies(id),
  sender_member_id uuid references public.academy_members(id),
  sender_account_id uuid,
  sender_name text not null,
  branch_name text not null,
  message_type text not null check (message_type in ('text','system','file')),
  body text not null check (char_length(body) <= 5000),
  reply_to_message_id bigint references private.olli_shared_chat_messages(id),
  client_message_id uuid,
  mention_all boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  edited_at timestamptz,
  deleted_at timestamptz,
  unique(room_id, seq),
  unique(room_id, sender_account_id, client_message_id),
  check ((message_type = 'system' and sender_member_id is null and sender_account_id is null)
    or (message_type <> 'system' and sender_member_id is not null and sender_account_id is not null and academy_id is not null))
);
create table private.olli_shared_chat_mentions (
  message_id bigint not null references private.olli_shared_chat_messages(id),
  account_id uuid not null,
  display_name text not null,
  branch_name text not null,
  primary key(message_id, account_id)
);
create table private.olli_shared_chat_reads (
  room_id uuid not null references private.olli_shared_chat_rooms(id),
  account_id uuid not null,
  last_read_seq bigint not null default 0 check (last_read_seq >= 0),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(room_id, account_id)
);
create table private.olli_shared_chat_attachments (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references private.olli_shared_chat_rooms(id),
  participation_id uuid not null references private.olli_shared_chat_academies(id),
  uploader_account_id uuid not null,
  message_id bigint unique references private.olli_shared_chat_messages(id),
  file_name text not null check (char_length(file_name) between 1 and 180),
  mime_type text not null,
  file_size bigint not null check (file_size between 1 and 20971520),
  storage_path text not null unique,
  created_at timestamptz not null default clock_timestamp()
);
create table private.olli_shared_chat_config_requests (
  account_id uuid not null,
  request_id uuid not null,
  room_id uuid not null references private.olli_shared_chat_rooms(id),
  primary key(account_id, request_id)
);
create table private.olli_shared_chat_push_claims (
  message_id bigint not null references private.olli_shared_chat_messages(id),
  endpoint text not null,
  claimed_at timestamptz not null default clock_timestamp(),
  delivered_at timestamptz,
  primary key(message_id, endpoint)
);

-- No Data API table access, including service clients. All access is through checked RPCs.
do $lockdown$
declare t text;
begin
  foreach t in array array['release','rooms','academies','messages','mentions','reads','attachments','config_requests','push_claims'] loop
    execute format('alter table private.%I enable row level security', 'olli_shared_chat_' || t);
    execute format('revoke all on private.%I from public, anon, authenticated, service_role', 'olli_shared_chat_' || t);
  end loop;
end;
$lockdown$;
revoke all on sequence private.olli_shared_chat_messages_id_seq from public,anon,authenticated,service_role;

-- Custom Olli account sessions are the authentication authority in this application.
-- Never substitute auth.uid(), a client member/role, or a room ID for that authority.
create function private.olli_shared_chat_member(p_session_token text, p_academy_id uuid)
returns public.academy_members language plpgsql stable security definer set search_path = '' as $$
declare v_account uuid; v_member public.academy_members;
begin
  if not coalesce((select enabled from private.olli_shared_chat_release where singleton),false) then
    raise exception '공동 팀챗은 아직 사용할 수 없습니다.' using errcode='42501';
  end if;
  v_account := public.olli_account_id_from_session(p_session_token);
  if v_account is null then raise exception '유효한 로그인 세션이 필요합니다.' using errcode='42501'; end if;
  select m.* into v_member from public.academy_members m join public.academies a on a.id=m.academy_id
    where m.account_id=v_account and m.academy_id=p_academy_id and m.status='active'
      and a.status='active' and a.deleted_at is null
    order by case m.role when 'owner' then 0 when 'manager' then 1 else 2 end,m.created_at,m.id limit 1;
  if v_member.id is null then raise exception '이 학원의 활성 멤버십이 필요합니다.' using errcode='42501'; end if;
  return v_member;
end; $$;

create function private.olli_shared_chat_participation(p_academy_id uuid, p_room_id uuid)
returns private.olli_shared_chat_academies language plpgsql stable security definer set search_path = '' as $$
declare v_row private.olli_shared_chat_academies;
begin
  select a.* into v_row from private.olli_shared_chat_academies a join private.olli_shared_chat_rooms r on r.id=a.room_id
    where a.academy_id=p_academy_id and a.room_id=p_room_id and a.left_at is null and r.archived_at is null;
  if v_row.id is null then raise exception '현재 학원은 이 공동 대화방에 참여하지 않습니다.' using errcode='42501'; end if;
  return v_row;
end; $$;

-- Visibility is always evaluated from CURRENT active academy membership, including join epoch.
create function private.olli_shared_chat_can_read(p_account_id uuid, p_room_id uuid, p_seq bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.olli_shared_chat_academies p
    join private.olli_shared_chat_rooms r on r.id=p.room_id and r.archived_at is null
    join public.academies a on a.id=p.academy_id and a.status='active' and a.deleted_at is null
    join public.academy_members m on m.academy_id=a.id and m.status='active'
    where m.account_id=p_account_id and p.room_id=p_room_id and p.left_at is null and p_seq>p.joined_after_seq);
$$;

create function private.olli_shared_chat_signal(p_room_id uuid, p_message_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_academy uuid;
begin
  -- Fan out invalidation only. No body, sender, or private business data in Realtime.
  for v_academy in select academy_id from private.olli_shared_chat_academies where room_id=p_room_id and left_at is null loop
    perform private.olli_realtime_send_signal(v_academy,'chat',p_message_id);
  end loop;
end; $$;

create function public.olli_shared_chat_status(p_session_token text, p_academy_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_member public.academy_members; v_room uuid; v_room_info jsonb; v_candidates jsonb;
begin
  if not coalesce((select enabled from private.olli_shared_chat_release where singleton),false) then
    return jsonb_build_object('ok',true,'enabled',false,'room',null,'academies','[]'::jsonb);
  end if;
  v_member := private.olli_shared_chat_member(p_session_token,p_academy_id);
  select room_id into v_room from private.olli_shared_chat_academies where academy_id=p_academy_id and left_at is null;
  select jsonb_build_object('id',r.id,'revision',r.revision,'participation_id',p.id,'joined_after_seq',p.joined_after_seq,
    'academies',(select jsonb_agg(jsonb_build_object('academy_id',g.academy_id,'display_name',g.display_name,'joined_at',g.joined_at) order by g.joined_at,g.id)
      from private.olli_shared_chat_academies g where g.room_id=r.id and g.left_at is null)) into v_room_info
    from private.olli_shared_chat_rooms r join private.olli_shared_chat_academies p on p.room_id=r.id and p.academy_id=p_academy_id and p.left_at is null
    where r.id=v_room and r.archived_at is null;
  if v_member.role='owner' then
    select coalesce(jsonb_agg(jsonb_build_object('academy_id',a.id,'academy_name',a.academy_name,'room_id',p.room_id) order by a.academy_name),'[]'::jsonb)
      into v_candidates from public.academies a left join private.olli_shared_chat_academies p on p.academy_id=a.id and p.left_at is null
      where a.status='active' and a.deleted_at is null and exists(select 1 from public.academy_members m
        where m.academy_id=a.id and m.account_id=v_member.account_id and m.status='active' and m.role='owner');
  end if;
  return jsonb_build_object('ok',true,'enabled',true,'can_manage',v_member.role='owner',
    'room',v_room_info,'academies',coalesce(v_candidates,'[]'::jsonb));
end; $$;

-- Full desired set, optimistic revision, and idempotent request key. 2..20 academies.
create function public.olli_shared_chat_configure(p_session_token text, p_academy_id uuid,
  p_room_id uuid, p_expected_revision bigint, p_academies jsonb, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_member public.academy_members; v_room private.olli_shared_chat_rooms; v_ids uuid[];
  v_id uuid; v_existing_room uuid; v_seq bigint; v_notice text; v_changed boolean;
begin
  v_member := private.olli_shared_chat_member(p_session_token,p_academy_id);
  if v_member.role<>'owner' then raise exception '원장만 팀챗 통합을 관리할 수 있습니다.' using errcode='42501'; end if;
  if p_request_id is null or jsonb_typeof(p_academies) is distinct from 'array' then raise exception '통합 요청이 올바르지 않습니다.'; end if;
  if jsonb_array_length(p_academies) not between 2 and 20 then raise exception '참여 학원은 2개 이상 20개 이하로 선택해 주세요.'; end if;
  select array_agg((x->>'academy_id')::uuid order by (x->>'academy_id')::uuid) into v_ids from jsonb_array_elements(p_academies) x;
  if array_position(v_ids,null) is not null or not (p_academy_id=any(v_ids))
    or cardinality(v_ids)<>(select count(distinct x) from unnest(v_ids) x)
    or exists(select 1 from jsonb_array_elements(p_academies) x where char_length(btrim(coalesce(x->>'display_name',''))) not between 1 and 20)
    or (select count(distinct lower(btrim(x->>'display_name'))) from jsonb_array_elements(p_academies) x)<>cardinality(v_ids) then
    raise exception '학원과 지점 표시 이름을 중복 없이 입력해 주세요.';
  end if;
  -- Consistent academy lock order serializes overlapping create/update requests.
  perform 1 from public.academies where id=any(v_ids) order by id for update;
  foreach v_id in array v_ids loop
    if not exists(select 1 from public.academies a join public.academy_members m on m.academy_id=a.id
      where a.id=v_id and a.status='active' and a.deleted_at is null and m.status='active'
      and m.role='owner' and m.account_id=v_member.account_id) then
      raise exception '참여 학원 모두의 현재 원장 권한이 필요합니다.' using errcode='42501';
    end if;
  end loop;
  select room_id into v_existing_room from private.olli_shared_chat_config_requests where account_id=v_member.account_id and request_id=p_request_id;
  if v_existing_room is not null then
    perform private.olli_shared_chat_participation(p_academy_id,v_existing_room);
    return public.olli_shared_chat_status(p_session_token,p_academy_id);
  end if;
  if p_room_id is null then
    if exists(select 1 from private.olli_shared_chat_academies where academy_id=any(v_ids) and left_at is null) then
      raise exception '이미 통합된 학원이 있습니다. 상태를 새로고침해 주세요.' using errcode='40001';
    end if;
    insert into private.olli_shared_chat_rooms(created_by_account_id) values(v_member.account_id) returning * into v_room;
  else
    select * into v_room from private.olli_shared_chat_rooms where id=p_room_id and archived_at is null for update;
    perform private.olli_shared_chat_participation(p_academy_id,p_room_id);
    if v_room.revision is distinct from p_expected_revision then raise exception '통합 설정이 변경되었습니다. 다시 확인해 주세요.' using errcode='40001'; end if;
    if exists(select 1 from private.olli_shared_chat_academies p where p.room_id=p_room_id and p.left_at is null
      and not exists(select 1 from public.academies a join public.academy_members m on m.academy_id=a.id
        where a.id=p.academy_id and a.status='active' and a.deleted_at is null and m.status='active' and m.role='owner' and m.account_id=v_member.account_id)) then
      raise exception '기존 참여 학원 모두의 현재 원장 권한이 필요합니다.' using errcode='42501';
    end if;
    if exists(select 1 from private.olli_shared_chat_academies where academy_id=any(v_ids) and left_at is null and room_id<>p_room_id) then
      raise exception '다른 공동 대화방에 참여한 학원이 있습니다.';
    end if;
    select exists(
      (select academy_id,display_name from private.olli_shared_chat_academies where room_id=p_room_id and left_at is null
        except select (x->>'academy_id')::uuid,btrim(x->>'display_name') from jsonb_array_elements(p_academies) x)
      union all
      (select (x->>'academy_id')::uuid,btrim(x->>'display_name') from jsonb_array_elements(p_academies) x
        except select academy_id,display_name from private.olli_shared_chat_academies where room_id=p_room_id and left_at is null)
    ) into v_changed;
    if not v_changed then
      insert into private.olli_shared_chat_config_requests values(v_member.account_id,p_request_id,v_room.id);
      return public.olli_shared_chat_status(p_session_token,p_academy_id);
    end if;
    -- Deferred name uniqueness permits an atomic branch-name swap without new epochs.
    update private.olli_shared_chat_academies set left_at=clock_timestamp()
      where room_id=v_room.id and left_at is null and not(academy_id=any(v_ids));
    update private.olli_shared_chat_rooms set revision=revision+1 where id=v_room.id;
  end if;
  insert into private.olli_shared_chat_academies(room_id,academy_id,display_name,joined_after_seq)
    select v_room.id,(x->>'academy_id')::uuid,btrim(x->>'display_name'),v_room.message_seq
    from jsonb_array_elements(p_academies) x
    where not exists(select 1 from private.olli_shared_chat_academies p where p.academy_id=(x->>'academy_id')::uuid and p.left_at is null);
  update private.olli_shared_chat_academies p set display_name=btrim(x.value->>'display_name')
    from jsonb_array_elements(p_academies) x where p.room_id=v_room.id and p.left_at is null and p.academy_id=(x.value->>'academy_id')::uuid;
  update private.olli_shared_chat_rooms set message_seq=message_seq+1 where id=v_room.id returning message_seq into v_seq;
  select string_agg(a.academy_name,' · ' order by a.academy_name) || '의 팀챗이 통합되었습니다. 참여 학원 또는 지점 표시 이름이 변경되었습니다.'
    into v_notice from public.academies a where a.id=any(v_ids);
  insert into private.olli_shared_chat_messages(room_id,seq,sender_name,branch_name,message_type,body)
    values(v_room.id,v_seq,'시스템','','system',left(v_notice,5000));
  insert into private.olli_shared_chat_config_requests values(v_member.account_id,p_request_id,v_room.id);
  -- Include removed academies in invalidation, as well as retained/new academies.
  for v_id in select distinct academy_id from private.olli_shared_chat_academies where room_id=v_room.id loop
    perform private.olli_realtime_send_signal(v_id,'chat',null);
  end loop;
  return public.olli_shared_chat_status(p_session_token,p_academy_id);
end; $$;

create function public.olli_shared_chat_leave(p_session_token text,p_academy_id uuid,p_room_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_member public.academy_members; v_room private.olli_shared_chat_rooms; v_seq bigint;
begin
  v_member := private.olli_shared_chat_member(p_session_token,p_academy_id);
  if v_member.role<>'owner' then raise exception '원장만 통합을 해제할 수 있습니다.' using errcode='42501'; end if;
  select * into v_room from private.olli_shared_chat_rooms where id=p_room_id for update;
  perform private.olli_shared_chat_participation(p_academy_id,p_room_id);
  if v_room.revision is distinct from p_expected_revision then raise exception '통합 설정이 변경되었습니다.' using errcode='40001'; end if;
  -- Signal the departing academy too, so open clients discard their room immediately.
  perform private.olli_shared_chat_signal(p_room_id,null);
  update private.olli_shared_chat_academies set left_at=clock_timestamp() where room_id=p_room_id and academy_id=p_academy_id and left_at is null;
  if (select count(*) from private.olli_shared_chat_academies where room_id=p_room_id and left_at is null)<2 then
    update private.olli_shared_chat_academies set left_at=clock_timestamp() where room_id=p_room_id and left_at is null;
    update private.olli_shared_chat_rooms set archived_at=clock_timestamp(),revision=revision+1 where id=p_room_id;
  else
    update private.olli_shared_chat_rooms set revision=revision+1,message_seq=message_seq+1 where id=p_room_id returning message_seq into v_seq;
    insert into private.olli_shared_chat_messages(room_id,seq,sender_name,branch_name,message_type,body)
      values(p_room_id,v_seq,'시스템','','system',v_member.display_name || ' 원장이 참여 학원 통합을 해제했습니다.');
  end if;
  return public.olli_shared_chat_status(p_session_token,p_academy_id);
end; $$;

create function public.olli_shared_chat_members(p_session_token text,p_academy_id uuid,p_room_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_member public.academy_members; v_members jsonb;
begin
  v_member := private.olli_shared_chat_member(p_session_token,p_academy_id);
  perform private.olli_shared_chat_participation(p_academy_id,p_room_id);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.display_name,x.member_id),'[]'::jsonb) into v_members from (
    select distinct on(m.account_id) m.id as member_id,m.display_name,m.role,p.display_name as branch_name,
      m.account_id=v_member.account_id as is_current_member,m.team_talk_avatar_key as avatar_key
    from public.academy_members m join public.academies a on a.id=m.academy_id and a.status='active' and a.deleted_at is null
      join private.olli_shared_chat_academies p on p.academy_id=m.academy_id and p.left_at is null
    where p.room_id=p_room_id and m.status='active' and m.account_id is not null
    order by m.account_id,(m.academy_id=p_academy_id) desc,m.created_at,m.id
  ) x;
  return jsonb_build_object('ok',true,'current_member_id',v_member.id,'members',v_members);
end; $$;

create function public.olli_shared_chat_send(p_session_token text,p_academy_id uuid,p_room_id uuid,p_body text,
  p_client_message_id uuid,p_reply_to_message_id bigint default null,p_member_ids uuid[] default '{}',p_mention_all boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_member public.academy_members; v_part private.olli_shared_chat_academies; v_msg private.olli_shared_chat_messages; v_seq bigint;
begin
  v_member := private.olli_shared_chat_member(p_session_token,p_academy_id);
  -- Same lock as configure/leave: join boundaries cannot race with sends.
  perform 1 from private.olli_shared_chat_rooms where id=p_room_id for update;
  v_part := private.olli_shared_chat_participation(p_academy_id,p_room_id);
  if p_client_message_id is null or char_length(btrim(coalesce(p_body,''))) not between 1 and 5000 then raise exception '메시지는 1~5000자로 입력해 주세요.'; end if;
  select * into v_msg from private.olli_shared_chat_messages where room_id=p_room_id and sender_account_id=v_member.account_id and client_message_id=p_client_message_id;
  if v_msg.id is not null then
    if v_msg.seq<=v_part.joined_after_seq or v_msg.deleted_at is not null then raise exception '이전 참여 기간의 요청은 다시 사용할 수 없습니다.'; end if;
    return jsonb_build_object('ok',true,'message_id',v_msg.id);
  end if;
  if p_reply_to_message_id is not null and not exists(select 1 from private.olli_shared_chat_messages
    where id=p_reply_to_message_id and room_id=p_room_id and seq>v_part.joined_after_seq and deleted_at is null) then
    raise exception '답장할 메시지에 접근할 수 없습니다.' using errcode='42501';
  end if;
  if exists(select 1 from unnest(coalesce(p_member_ids,'{}')) target where not exists(
    select 1 from public.academy_members m join public.academies a on a.id=m.academy_id and a.status='active' and a.deleted_at is null
      join private.olli_shared_chat_academies p on p.academy_id=m.academy_id and p.left_at is null
    where m.id=target and m.status='active' and m.account_id is not null and p.room_id=p_room_id)) then
    raise exception '참여하지 않는 선생님을 멘션할 수 없습니다.' using errcode='42501';
  end if;
  update private.olli_shared_chat_rooms set message_seq=message_seq+1 where id=p_room_id returning message_seq into v_seq;
  insert into private.olli_shared_chat_messages(room_id,seq,academy_id,sender_member_id,sender_account_id,sender_name,branch_name,message_type,body,reply_to_message_id,client_message_id)
    values(p_room_id,v_seq,p_academy_id,v_member.id,v_member.account_id,v_member.display_name,v_part.display_name,'text',btrim(p_body),p_reply_to_message_id,p_client_message_id) returning * into v_msg;
  update private.olli_shared_chat_messages set mention_all=coalesce(p_mention_all,false) where id=v_msg.id;
  insert into private.olli_shared_chat_mentions(message_id,account_id,display_name,branch_name)
    select distinct on(m.account_id) v_msg.id,m.account_id,m.display_name,p.display_name from public.academy_members m join public.academies a on a.id=m.academy_id and a.status='active' and a.deleted_at is null
      join private.olli_shared_chat_academies p on p.academy_id=m.academy_id and p.left_at is null
    where p.room_id=p_room_id and m.status='active' and m.account_id is not null and m.account_id<>v_member.account_id
      and (p_mention_all or m.id=any(coalesce(p_member_ids,'{}')))
    order by m.account_id,(m.academy_id=p_academy_id) desc,m.id;
  perform private.olli_shared_chat_signal(p_room_id,v_msg.id);
  return jsonb_build_object('ok',true,'message_id',v_msg.id);
end; $$;

create function public.olli_shared_chat_list(p_session_token text,p_academy_id uuid,p_room_id uuid,p_before_seq bigint default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_member public.academy_members; v_part private.olli_shared_chat_academies; v_messages jsonb; v_deleted jsonb;
begin
  v_member := private.olli_shared_chat_member(p_session_token,p_academy_id);
  v_part := private.olli_shared_chat_participation(p_academy_id,p_room_id);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.seq),'[]'::jsonb) into v_messages from (
    select msg.id,msg.seq,msg.academy_id,msg.sender_member_id,msg.sender_name,msg.branch_name,msg.message_type,msg.body,
      msg.reply_to_message_id,msg.client_message_id,msg.created_at,msg.edited_at,msg.mention_all,msg.sender_account_id=v_member.account_id as is_mine,
      (select coalesce(jsonb_agg(jsonb_build_object('display_name',mt.display_name,'branch_name',mt.branch_name) order by mt.display_name,mt.branch_name),'[]'::jsonb)
        from private.olli_shared_chat_mentions mt where mt.message_id=msg.id) as mentions,
      exists(select 1 from private.olli_shared_chat_mentions mt where mt.message_id=msg.id and mt.account_id=v_member.account_id) as mentions_me,
      (select jsonb_build_object('id',f.id,'file_name',f.file_name,'mime_type',f.mime_type,'file_size',f.file_size)
        from private.olli_shared_chat_attachments f where f.message_id=msg.id) as attachment,
      (select count(distinct m.account_id)::integer from public.academy_members m
        join public.academies a on a.id=m.academy_id and a.status='active' and a.deleted_at is null
        join private.olli_shared_chat_academies p on p.academy_id=m.academy_id and p.left_at is null
        left join private.olli_shared_chat_reads rd on rd.room_id=p.room_id and rd.account_id=m.account_id
        where p.room_id=p_room_id and msg.seq>p.joined_after_seq and m.status='active' and m.account_id is not null
          and m.account_id is distinct from msg.sender_account_id and coalesce(rd.last_read_seq,0)<msg.seq) as unread_count
    from private.olli_shared_chat_messages msg where msg.room_id=p_room_id and msg.seq>v_part.joined_after_seq and msg.deleted_at is null
      and (p_before_seq is null or msg.seq<p_before_seq) order by msg.seq desc limit greatest(1,least(coalesce(p_limit,50),100))
  ) x;
  select coalesce(jsonb_agg(id),'[]'::jsonb) into v_deleted from private.olli_shared_chat_messages
    where room_id=p_room_id and seq>v_part.joined_after_seq and deleted_at is not null;
  return jsonb_build_object('ok',true,'room_id',p_room_id,'participation_id',v_part.id,'messages',v_messages,'deleted_message_ids',v_deleted);
end; $$;

create function public.olli_shared_chat_mark_read(p_session_token text,p_academy_id uuid,p_room_id uuid,p_up_to_seq bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_member public.academy_members; v_part private.olli_shared_chat_academies; v_changed integer;
begin
  v_member := private.olli_shared_chat_member(p_session_token,p_academy_id);
  v_part := private.olli_shared_chat_participation(p_academy_id,p_room_id);
  if not exists(select 1 from private.olli_shared_chat_messages where room_id=p_room_id and seq=p_up_to_seq and seq>v_part.joined_after_seq and deleted_at is null) then
    raise exception '읽을 수 없는 메시지입니다.' using errcode='42501';
  end if;
  insert into private.olli_shared_chat_reads(room_id,account_id,last_read_seq) values(p_room_id,v_member.account_id,p_up_to_seq)
    on conflict(room_id,account_id) do update set last_read_seq=excluded.last_read_seq,updated_at=clock_timestamp()
      where private.olli_shared_chat_reads.last_read_seq<excluded.last_read_seq;
  get diagnostics v_changed=row_count;
  if v_changed>0 then perform private.olli_shared_chat_signal(p_room_id,null); end if;
  return jsonb_build_object('ok',true);
end; $$;

create function public.olli_shared_chat_update_message(p_session_token text,p_academy_id uuid,p_room_id uuid,p_message_id bigint,p_body text,p_delete boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_member public.academy_members; v_part private.olli_shared_chat_academies; v_msg private.olli_shared_chat_messages;
begin
  v_member := private.olli_shared_chat_member(p_session_token,p_academy_id);
  perform 1 from private.olli_shared_chat_rooms where id=p_room_id for update;
  v_part := private.olli_shared_chat_participation(p_academy_id,p_room_id);
  select * into v_msg from private.olli_shared_chat_messages where id=p_message_id and room_id=p_room_id and seq>v_part.joined_after_seq for update;
  if v_msg.id is null or v_msg.sender_account_id is distinct from v_member.account_id or v_msg.message_type='system' then
    raise exception '내 메시지만 변경할 수 있습니다.' using errcode='42501';
  end if;
  if p_delete then
    update private.olli_shared_chat_messages set deleted_at=coalesce(deleted_at,clock_timestamp()) where id=p_message_id;
  else
    if v_msg.deleted_at is not null or char_length(btrim(coalesce(p_body,''))) not between 1 and 5000 then raise exception '수정할 메시지가 올바르지 않습니다.'; end if;
    update private.olli_shared_chat_messages set body=btrim(p_body),edited_at=clock_timestamp() where id=p_message_id;
  end if;
  perform private.olli_shared_chat_signal(p_room_id,p_message_id);
  return jsonb_build_object('ok',true);
end; $$;

create function public.olli_shared_chat_summary(p_session_token text,p_academy_id uuid,p_room_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_member public.academy_members; v_part private.olli_shared_chat_academies; v_unread integer; v_mentions integer;
begin
  v_member := private.olli_shared_chat_member(p_session_token,p_academy_id);
  v_part := private.olli_shared_chat_participation(p_academy_id,p_room_id);
  select count(*)::integer,count(*) filter(where exists(select 1 from private.olli_shared_chat_mentions mt
      where mt.message_id=msg.id and mt.account_id=v_member.account_id))::integer into v_unread,v_mentions
    from private.olli_shared_chat_messages msg left join private.olli_shared_chat_reads rd on rd.room_id=msg.room_id and rd.account_id=v_member.account_id
    where msg.room_id=p_room_id and msg.seq>greatest(v_part.joined_after_seq,coalesce(rd.last_read_seq,0))
      and msg.deleted_at is null and msg.sender_account_id is distinct from v_member.account_id;
  return jsonb_build_object('ok',true,'unread_count',v_unread,'mention_count',v_mentions);
end; $$;

-- Attachment broker RPCs: only service_role may obtain paths, after the same live
-- session/membership/epoch checks. Browser callers never receive read signed URLs.
create function public.olli_shared_chat_file_prepare(p_session_token text,p_academy_id uuid,p_room_id uuid,p_file_name text,p_mime_type text,p_file_size bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_member public.academy_members; v_part private.olli_shared_chat_academies; v_file private.olli_shared_chat_attachments; v_id uuid:=gen_random_uuid();
begin
  v_member := private.olli_shared_chat_member(p_session_token,p_academy_id);
  perform 1 from private.olli_shared_chat_rooms where id=p_room_id for update;
  v_part := private.olli_shared_chat_participation(p_academy_id,p_room_id);
  insert into private.olli_shared_chat_attachments(id,room_id,participation_id,uploader_account_id,file_name,mime_type,file_size,storage_path)
    values(v_id,p_room_id,v_part.id,v_member.account_id,left(btrim(p_file_name),180),left(coalesce(p_mime_type,'application/octet-stream'),120),p_file_size,
      p_room_id::text || '/' || v_part.id::text || '/' || v_id::text)
    returning * into v_file;
  return jsonb_build_object('ok',true,'attachment_id',v_file.id,'storage_path',v_file.storage_path);
end; $$;

create function public.olli_shared_chat_file_commit(p_session_token text,p_academy_id uuid,p_room_id uuid,p_attachment_id uuid,
  p_reply_to_message_id bigint default null,p_member_ids uuid[] default '{}',p_mention_all boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_member public.academy_members; v_part private.olli_shared_chat_academies; v_file private.olli_shared_chat_attachments; v_result jsonb;
begin
  v_member := private.olli_shared_chat_member(p_session_token,p_academy_id);
  perform 1 from private.olli_shared_chat_rooms where id=p_room_id for update;
  v_part := private.olli_shared_chat_participation(p_academy_id,p_room_id);
  select * into v_file from private.olli_shared_chat_attachments where id=p_attachment_id and room_id=p_room_id
    and participation_id=v_part.id and uploader_account_id=v_member.account_id for update;
  if v_file.id is null then raise exception '이 업로드에 접근할 수 없습니다.' using errcode='42501'; end if;
  v_result := public.olli_shared_chat_send(p_session_token,p_academy_id,p_room_id,v_file.file_name,p_attachment_id,p_reply_to_message_id,p_member_ids,p_mention_all);
  update private.olli_shared_chat_messages set message_type='file' where id=(v_result->>'message_id')::bigint;
  update private.olli_shared_chat_attachments set message_id=(v_result->>'message_id')::bigint where id=p_attachment_id;
  return v_result;
end; $$;

create function public.olli_shared_chat_file_access(p_session_token text,p_academy_id uuid,p_room_id uuid,p_attachment_id uuid,p_upload boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_member public.academy_members; v_part private.olli_shared_chat_academies; v_file private.olli_shared_chat_attachments;
begin
  v_member := private.olli_shared_chat_member(p_session_token,p_academy_id);
  v_part := private.olli_shared_chat_participation(p_academy_id,p_room_id);
  select f.* into v_file from private.olli_shared_chat_attachments f
    left join private.olli_shared_chat_messages msg on msg.id=f.message_id
    where f.id=p_attachment_id and f.room_id=p_room_id and (
      (p_upload and f.uploader_account_id=v_member.account_id and f.participation_id=v_part.id and
        ((f.message_id is null and f.created_at>clock_timestamp()-interval '1 hour')
          or (msg.room_id=p_room_id and msg.seq>v_part.joined_after_seq and msg.deleted_at is null)))
      or (not p_upload and msg.room_id=p_room_id and msg.seq>v_part.joined_after_seq and msg.deleted_at is null));
  if v_file.id is null then raise exception '첨부파일에 접근할 수 없습니다.' using errcode='42501'; end if;
  return jsonb_build_object('ok',true,'storage_path',v_file.storage_path,'file_name',v_file.file_name,'file_size',v_file.file_size,'mime_type',v_file.mime_type,'message_id',v_file.message_id);
end; $$;

-- Service-only dispatcher. Claims endpoints atomically, once per message even for
-- accounts with several memberships/subscriptions. Failed sends may retry after 2 min.
create function public.olli_shared_chat_push_claim(p_session_token text,p_academy_id uuid,p_room_id uuid,p_message_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_member public.academy_members; v_part private.olli_shared_chat_academies; v_msg private.olli_shared_chat_messages;
  v_target record; v_targets jsonb:='[]'; v_claimed boolean;
begin
  v_member := private.olli_shared_chat_member(p_session_token,p_academy_id);
  v_part := private.olli_shared_chat_participation(p_academy_id,p_room_id);
  select * into v_msg from private.olli_shared_chat_messages where id=p_message_id and room_id=p_room_id
    and seq>v_part.joined_after_seq and sender_account_id=v_member.account_id and deleted_at is null;
  if v_msg.id is null then raise exception '내 공동 메시지만 알림을 전송할 수 있습니다.' using errcode='42501'; end if;
  for v_target in
    select distinct on(s.endpoint) s.id as subscription_id,s.endpoint,s.p256dh,s.auth,m.account_id,m.academy_id
      from public.olli_team_chat_push_subscriptions s join public.academy_members m on m.id=s.member_id and m.academy_id=s.academy_id
      join public.academies a on a.id=m.academy_id and a.status='active' and a.deleted_at is null
      join private.olli_shared_chat_academies p on p.academy_id=m.academy_id and p.left_at is null
      where p.room_id=p_room_id and v_msg.seq>p.joined_after_seq and m.status='active' and m.account_id is not null
        and m.account_id<>v_member.account_id and s.disabled_at is null
        and (not exists(select 1 from private.olli_shared_chat_mentions where message_id=v_msg.id)
          or exists(select 1 from private.olli_shared_chat_mentions where message_id=v_msg.id and account_id=m.account_id))
      order by s.endpoint,s.id
  loop
    v_claimed:=false;
    insert into private.olli_shared_chat_push_claims(message_id,endpoint) values(v_msg.id,v_target.endpoint)
      on conflict(message_id,endpoint) do update set claimed_at=clock_timestamp()
        where private.olli_shared_chat_push_claims.delivered_at is null
          and private.olli_shared_chat_push_claims.claimed_at<clock_timestamp()-interval '2 minutes'
      returning true into v_claimed;
    if coalesce(v_claimed,false) then v_targets:=v_targets || jsonb_build_array(to_jsonb(v_target)); end if;
  end loop;
  -- Generic notification text: message content stays behind the authenticated app.
  return jsonb_build_object('ok',true,'room_id',p_room_id,'message_id',v_msg.id,'targets',v_targets);
end; $$;

create function public.olli_shared_chat_push_complete(p_message_id bigint,p_endpoint text)
returns void language sql security definer set search_path = '' as $$
  update private.olli_shared_chat_push_claims set delivered_at=clock_timestamp() where message_id=p_message_id and endpoint=p_endpoint;
$$;

-- Dedicated private bucket. No client storage policies; uploads are signed by the
-- broker and downloads are streamed only after live session authorization.
insert into storage.buckets(id,name,public,file_size_limit)
  values('olli_shared_chat_files','olli_shared_chat_files',false,20971520);
-- Protect this bucket even if a broader permissive policy is introduced later.
create policy olli_shared_chat_broker_only on storage.objects as restrictive for all to anon,authenticated
  using (bucket_id<>'olli_shared_chat_files') with check (bucket_id<>'olli_shared_chat_files');

-- Explicit function allowlist; private helpers never inherit PUBLIC EXECUTE.
do $grants$
declare f record;
begin
  for f in select p.oid::regprocedure as signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.proname like 'olli_shared_chat_%' loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role',f.signature);
    if f.nspname='public' then
      if f.signature::text ~ 'olli_shared_chat_(file_|push_)' then
        execute format('grant execute on function %s to service_role',f.signature);
      else
        execute format('grant execute on function %s to anon, authenticated, service_role',f.signature);
      end if;
    end if;
  end loop;
end; $grants$;

commit;
