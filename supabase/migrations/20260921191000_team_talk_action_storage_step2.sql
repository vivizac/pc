-- Team Talk action cards step 2: persistence and state only.
-- No timetable/schedule mutation is executed by this migration.
-- Action execution will be introduced in a later stage after UI confirmation is connected.

create table if not exists public.olli_team_chat_actions (
  id uuid primary key default extensions.gen_random_uuid(),
  academy_id uuid not null references public.academies(id),
  message_id bigint not null,
  action_type text not null,
  action_payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  requested_by_member_id uuid not null references public.academy_members(id),
  resolved_by_member_id uuid null references public.academy_members(id),
  result_message_id bigint null,
  error_text text null,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz null,
  constraint olli_team_chat_actions_message_fkey
    foreign key (academy_id, message_id)
    references public.olli_team_chat_messages(academy_id, id)
    on delete cascade,
  constraint olli_team_chat_actions_result_message_fkey
    foreign key (academy_id, result_message_id)
    references public.olli_team_chat_messages(academy_id, id),
  constraint olli_team_chat_actions_message_unique unique (academy_id, message_id),
  constraint olli_team_chat_actions_status_check
    check (status = any (array[
      'pending'::text,'completed'::text,'cancelled'::text,'failed'::text
    ])),
  constraint olli_team_chat_actions_type_check
    check (action_type = any (array[
      'add_class_once'::text,'cancel_class_once'::text,
      'add_makeup'::text,'cancel_makeup'::text,
      'add_trial'::text,'cancel_trial'::text,
      'add_waitlist'::text,'move_class'::text,
      'cancel_move'::text,'mark_absent'::text
    ])),
  constraint olli_team_chat_actions_payload_object_check
    check (jsonb_typeof(action_payload) = 'object'),
  constraint olli_team_chat_actions_revision_check
    check (revision >= 1)
);

alter table public.olli_team_chat_actions
  add column if not exists revision bigint not null default 1;

alter table public.olli_team_chat_actions
  drop constraint if exists olli_team_chat_actions_revision_check;
alter table public.olli_team_chat_actions
  add constraint olli_team_chat_actions_revision_check check (revision >= 1);

alter table public.olli_team_chat_actions
  drop constraint if exists olli_team_chat_actions_type_check;
alter table public.olli_team_chat_actions
  add constraint olli_team_chat_actions_type_check
  check (action_type = any (array[
    'add_class_once'::text,'cancel_class_once'::text,
    'add_makeup'::text,'cancel_makeup'::text,
    'add_trial'::text,'cancel_trial'::text,
    'add_waitlist'::text,'move_class'::text,
    'cancel_move'::text,'mark_absent'::text
  ]));

create index if not exists olli_team_chat_actions_academy_status_idx
  on public.olli_team_chat_actions(academy_id, status, created_at desc);
create index if not exists olli_team_chat_actions_requested_member_idx
  on public.olli_team_chat_actions(requested_by_member_id);
create index if not exists olli_team_chat_actions_resolved_member_idx
  on public.olli_team_chat_actions(resolved_by_member_id)
  where resolved_by_member_id is not null;
create index if not exists olli_team_chat_actions_result_message_idx
  on public.olli_team_chat_actions(academy_id, result_message_id)
  where result_message_id is not null;

alter table public.olli_team_chat_actions enable row level security;
revoke all on table public.olli_team_chat_actions from public, anon, authenticated;

-- Remove an abandoned early execution endpoint. Step 2 stores/cancels cards only.
drop function if exists public.olli_team_chat_action_execute(text, uuid, uuid);

create or replace function public.olli_team_chat_send_action(
  p_session_token text,
  p_academy_id uuid,
  p_body text,
  p_action_type text,
  p_action_payload jsonb,
  p_client_message_id uuid default null,
  p_reply_to_message_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_message public.olli_team_chat_messages%rowtype;
  v_action public.olli_team_chat_actions%rowtype;
  v_body text := btrim(coalesce(p_body,''));
  v_action_type text := lower(btrim(coalesce(p_action_type,'')));
  v_payload jsonb := coalesce(p_action_payload,'{}'::jsonb);
  v_client_message_id uuid := coalesce(p_client_message_id, extensions.gen_random_uuid());
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;
  if p_academy_id is null then
    raise exception '학원 ID가 없습니다.';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 5000 then
    raise exception '확인 메시지 내용을 확인해 주세요.';
  end if;
  if jsonb_typeof(v_payload) <> 'object' or octet_length(v_payload::text) > 12000 then
    raise exception '작업 정보 형식이 올바르지 않습니다.';
  end if;
  if v_action_type not in (
    'add_class_once','cancel_class_once','add_makeup','cancel_makeup',
    'add_trial','cancel_trial','add_waitlist','move_class','cancel_move','mark_absent'
  ) then
    raise exception '지원하지 않는 작업입니다.';
  end if;
  if lower(coalesce(v_payload->>'intent','')) <> v_action_type then
    raise exception '작업 종류가 일치하지 않습니다.';
  end if;

  select m.* into v_member
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id
    and m.account_id=v_account_id
    and m.status='active'
    and a.status='active'
    and a.deleted_at is null
  order by case m.role
    when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end,
    m.created_at
  limit 1;
  if v_member.id is null then
    raise exception '현재 계정은 이 학원의 팀톡을 사용할 수 없습니다.';
  end if;

  if p_reply_to_message_id is not null and not exists (
    select 1
    from public.olli_team_chat_messages r
    where r.academy_id=p_academy_id
      and r.id=p_reply_to_message_id
      and r.deleted_at is null
  ) then
    raise exception '답장할 메시지를 찾지 못했습니다.';
  end if;

  insert into public.olli_team_chat_messages(
    academy_id,sender_member_id,sender_name_snapshot,message_type,body,
    reply_to_message_id,client_message_id
  )
  values(
    p_academy_id,null,'올리','ai',v_body,p_reply_to_message_id,v_client_message_id
  )
  on conflict (academy_id,client_message_id) do nothing
  returning * into v_message;

  if v_message.id is null then
    select m.* into v_message
    from public.olli_team_chat_messages m
    where m.academy_id=p_academy_id
      and m.client_message_id=v_client_message_id
    limit 1;
  end if;

  insert into public.olli_team_chat_actions(
    academy_id,message_id,action_type,action_payload,requested_by_member_id
  )
  values(
    p_academy_id,v_message.id,v_action_type,v_payload,v_member.id
  )
  on conflict (academy_id,message_id) do nothing
  returning * into v_action;

  if v_action.id is null then
    select a.* into v_action
    from public.olli_team_chat_actions a
    where a.academy_id=p_academy_id
      and a.message_id=v_message.id
    limit 1;

    if v_action.id is null then
      raise exception '작업 카드를 저장하지 못했습니다.';
    end if;
    if v_action.action_type <> v_action_type or v_action.action_payload <> v_payload then
      raise exception '같은 요청 키가 다른 작업에 이미 사용되었습니다.';
    end if;
  end if;

  return jsonb_build_object(
    'ok',true,
    'message',jsonb_build_object(
      'id',v_message.id,
      'academy_id',v_message.academy_id,
      'sender_member_id',v_message.sender_member_id,
      'sender_name',v_message.sender_name_snapshot,
      'message_type',v_message.message_type,
      'body',v_message.body,
      'reply_to_message_id',v_message.reply_to_message_id,
      'client_message_id',v_message.client_message_id,
      'created_at',v_message.created_at,
      'action',jsonb_build_object(
        'id',v_action.id,
        'action_type',v_action.action_type,
        'status',v_action.status,
        'revision',v_action.revision,
        'created_at',v_action.created_at,
        'updated_at',v_action.updated_at,
        'resolved_at',v_action.resolved_at,
        'error',v_action.error_text
      )
    )
  );
end;
$function$;

create or replace function public.olli_team_chat_action_cancel(
  p_session_token text,
  p_academy_id uuid,
  p_action_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_account_id uuid;
  v_member_id uuid;
  v_action public.olli_team_chat_actions%rowtype;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;

  select m.id into v_member_id
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id
    and m.account_id=v_account_id
    and m.status='active'
    and a.status='active'
    and a.deleted_at is null
  order by case m.role
    when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end,
    m.created_at
  limit 1;
  if v_member_id is null then
    raise exception '현재 계정은 이 학원의 팀톡을 사용할 수 없습니다.';
  end if;

  select a.* into v_action
  from public.olli_team_chat_actions a
  where a.id=p_action_id
    and a.academy_id=p_academy_id
  for update;
  if v_action.id is null then
    raise exception '작업 요청을 찾지 못했습니다.';
  end if;

  if v_action.status='pending' then
    update public.olli_team_chat_actions
    set status='cancelled',
        resolved_by_member_id=v_member_id,
        resolved_at=now(),
        updated_at=now(),
        error_text=null,
        revision=revision+1
    where id=v_action.id
    returning * into v_action;

    return jsonb_build_object(
      'ok',true,
      'changed',true,
      'action',jsonb_build_object(
        'id',v_action.id,'action_type',v_action.action_type,'status',v_action.status,
        'revision',v_action.revision,'updated_at',v_action.updated_at,
        'resolved_at',v_action.resolved_at,'error',v_action.error_text
      )
    );
  end if;

  if v_action.status='cancelled' then
    return jsonb_build_object(
      'ok',true,
      'changed',false,
      'action',jsonb_build_object(
        'id',v_action.id,'action_type',v_action.action_type,'status',v_action.status,
        'revision',v_action.revision,'updated_at',v_action.updated_at,
        'resolved_at',v_action.resolved_at,'error',v_action.error_text
      )
    );
  end if;

  return jsonb_build_object(
    'ok',false,
    'message','이미 처리된 작업은 취소할 수 없습니다.',
    'action',jsonb_build_object(
      'id',v_action.id,'action_type',v_action.action_type,'status',v_action.status,
      'revision',v_action.revision,'updated_at',v_action.updated_at,
      'resolved_at',v_action.resolved_at,'error',v_action.error_text
    )
  );
end;
$function$;

create or replace function public.olli_team_chat_list(
  p_session_token text,
  p_academy_id uuid,
  p_before_message_id bigint default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_limit integer := greatest(1,least(coalesce(p_limit,50),100));
  v_messages jsonb;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;
  if p_academy_id is null then raise exception '학원 ID가 없습니다.'; end if;

  select m.* into v_member
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id
    and m.account_id=v_account_id
    and m.status='active'
    and a.status='active'
    and a.deleted_at is null
  order by case m.role
    when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end,
    m.created_at
  limit 1;
  if v_member.id is null then
    raise exception '현재 계정은 이 학원의 팀톡을 사용할 수 없습니다.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,
    'academy_id',x.academy_id,
    'sender_member_id',x.sender_member_id,
    'sender_name',x.sender_name_snapshot,
    'message_type',x.message_type,
    'body',x.body,
    'reply_to_message_id',x.reply_to_message_id,
    'client_message_id',x.client_message_id,
    'created_at',x.created_at,
    'attachment',(
      select jsonb_build_object(
        'id',a.id,'kind',a.kind,'file_name',a.file_name,
        'mime_type',a.mime_type,'file_size',a.file_size
      )
      from public.olli_team_chat_attachments a
      where a.academy_id=x.academy_id and a.message_id=x.id
      limit 1
    ),
    'action',(
      select jsonb_build_object(
        'id',ac.id,
        'action_type',ac.action_type,
        'status',ac.status,
        'revision',ac.revision,
        'created_at',ac.created_at,
        'updated_at',ac.updated_at,
        'resolved_at',ac.resolved_at,
        'error',ac.error_text,
        'result_message_id',ac.result_message_id
      )
      from public.olli_team_chat_actions ac
      where ac.academy_id=x.academy_id and ac.message_id=x.id
      limit 1
    ),
    'unread_count',
      case
        when exists (
          select 1 from public.olli_team_chat_mentions mt
          where mt.academy_id=x.academy_id and mt.message_id=x.id
        )
        then (
          select count(*)::integer
          from public.olli_team_chat_mentions mt
          where mt.academy_id=x.academy_id
            and mt.message_id=x.id
            and mt.read_at is null
        )
        else (
          select count(*)::integer
          from public.academy_members am
          left join public.olli_team_chat_member_state st
            on st.academy_id=am.academy_id and st.member_id=am.id
          where am.academy_id=x.academy_id
            and am.status='active'
            and am.account_id is not null
            and (x.sender_member_id is null or am.id<>x.sender_member_id)
            and coalesce(st.last_read_message_id,0)<x.id
        )
      end
  ) order by x.id asc),'[]'::jsonb) into v_messages
  from (
    select msg.*
    from public.olli_team_chat_messages msg
    where msg.academy_id=p_academy_id
      and msg.deleted_at is null
      and (p_before_message_id is null or msg.id<p_before_message_id)
    order by msg.id desc
    limit v_limit
  ) x;

  return jsonb_build_object(
    'ok',true,
    'academy_id',p_academy_id,
    'current_member_id',v_member.id,
    'current_member_name',v_member.display_name,
    'messages',v_messages
  );
end;
$function$;

revoke execute on function public.olli_team_chat_send_action(text,uuid,text,text,jsonb,uuid,bigint) from public;
revoke execute on function public.olli_team_chat_action_cancel(text,uuid,uuid) from public;
revoke execute on function public.olli_team_chat_list(text,uuid,bigint,integer) from public;

grant execute on function public.olli_team_chat_send_action(text,uuid,text,text,jsonb,uuid,bigint) to anon, authenticated;
grant execute on function public.olli_team_chat_action_cancel(text,uuid,uuid) to anon, authenticated;
grant execute on function public.olli_team_chat_list(text,uuid,bigint,integer) to anon, authenticated;
