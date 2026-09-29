begin;

alter table public.olli_team_chat_messages
  add column if not exists audience text not null default 'all',
  add column if not exists material_request_id uuid,
  add column if not exists material_event_id bigint;

alter table public.olli_team_chat_messages
  drop constraint if exists olli_team_chat_messages_audience_check;

alter table public.olli_team_chat_messages
  add constraint olli_team_chat_messages_audience_check
  check (audience in ('all','management'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='olli_team_chat_messages_material_request_id_fkey'
  ) then
    alter table public.olli_team_chat_messages
      add constraint olli_team_chat_messages_material_request_id_fkey
      foreign key (material_request_id)
      references public.olli_team_material_requests(id)
      on delete set null;
  end if;
end $$;

create index if not exists olli_team_chat_messages_material_event_idx
  on public.olli_team_chat_messages (academy_id, material_event_id)
  where material_event_id is not null;

CREATE OR REPLACE FUNCTION public.olli_mobile_work_mark_material_read_to(p_session_token text, p_academy_id uuid, p_up_to_event_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_latest_event_id bigint;
  v_target_event_id bigint;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;

  select m.* into v_member
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id
    and m.account_id=v_account_id
    and m.status='active'
    and a.status='active'
    and a.deleted_at is null
  order by case m.role when 'owner' then 1 when 'manager' then 2 else 3 end, m.created_at
  limit 1;

  if v_member.id is null then
    raise exception '현재 계정은 이 학원의 Work 알림을 사용할 수 없습니다.';
  end if;

  if v_member.role not in ('owner','manager') then
    raise exception '재료주문 확인은 원장 또는 관리자만 할 수 있습니다.';
  end if;

  select max(e.id) into v_latest_event_id
  from public.olli_team_material_request_events e
  where e.academy_id=p_academy_id and e.event_type='created';

  v_target_event_id := least(
    coalesce(p_up_to_event_id, v_latest_event_id, 0),
    coalesce(v_latest_event_id, p_up_to_event_id, 0)
  );

  insert into public.olli_team_chat_member_state(
    academy_id, member_id, last_read_material_event_id, last_read_material_at, updated_at
  )
  values(
    p_academy_id, v_member.id, nullif(v_target_event_id,0), now(), now()
  )
  on conflict (academy_id, member_id)
  do update set
    last_read_material_event_id=greatest(
      coalesce(public.olli_team_chat_member_state.last_read_material_event_id,0),
      v_target_event_id
    ),
    last_read_material_at=now(),
    updated_at=now();

  return jsonb_build_object(
    'ok',true,
    'marked_read',true,
    'last_read_material_event_id',v_target_event_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.olli_team_chat_archive(p_session_token text, p_academy_id uuid, p_limit integer DEFAULT 1000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_limit integer := greatest(1,least(coalesce(p_limit,1000),2000));
  v_messages jsonb;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;

  select m.* into v_member
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id
    and m.account_id=v_account_id
    and m.status='active'
    and a.status='active'
    and a.deleted_at is null
  order by case m.role when 'owner' then 1 when 'manager' then 2 else 3 end,m.created_at
  limit 1;

  if v_member.id is null then raise exception '현재 계정은 이 학원의 팀톡을 사용할 수 없습니다.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'sender_member_id',x.sender_member_id,'sender_name',x.sender_name_snapshot,
    'message_type',x.message_type,'body',x.body,'created_at',x.created_at,
    'attachment',(
      select jsonb_build_object(
        'id',a.id,'kind',a.kind,'file_name',a.file_name,'mime_type',a.mime_type,
        'file_size',a.file_size,'created_at',a.created_at,
        'thumbnail_storage_path',a.thumbnail_storage_path,
        'thumbnail_mime_type',a.thumbnail_mime_type,'thumbnail_size',a.thumbnail_size,
        'image_width',a.image_width,'image_height',a.image_height
      )
      from public.olli_team_chat_attachments a
      where a.academy_id=x.academy_id and a.message_id=x.id limit 1
    )
  ) order by x.id desc),'[]'::jsonb)
  into v_messages
  from (
    select msg.*
    from public.olli_team_chat_messages msg
    where msg.academy_id=p_academy_id
      and msg.deleted_at is null
      and (
        msg.audience='all'
        or (msg.audience='management' and v_member.role in ('owner','manager'))
      )
    order by msg.id desc
    limit v_limit
  ) x;

  return jsonb_build_object(
    'ok',true,
    'academy_id',p_academy_id,
    'current_member_id',v_member.id,
    'messages',v_messages
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.olli_team_chat_list(p_session_token text, p_academy_id uuid, p_before_message_id bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_limit integer := greatest(1,least(coalesce(p_limit,50),100));
  v_messages jsonb;
  v_deleted_message_ids jsonb;
  v_last_read_material_event_id bigint := 0;
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
  order by case m.role when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end,m.created_at
  limit 1;

  if v_member.id is null then raise exception '현재 계정은 이 학원의 팀톡을 사용할 수 없습니다.'; end if;

  select coalesce(st.last_read_material_event_id,0)
  into v_last_read_material_event_id
  from public.olli_team_chat_member_state st
  where st.academy_id=p_academy_id and st.member_id=v_member.id;
  v_last_read_material_event_id := coalesce(v_last_read_material_event_id,0);

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
    'material_request_id',x.material_request_id,
    'material_event_id',x.material_event_id,
    'material_confirmed',case
      when x.material_event_id is null then null
      else x.material_event_id <= v_last_read_material_event_id
    end,
    'attachment',(
      select jsonb_build_object(
        'id',a.id,'kind',a.kind,'file_name',a.file_name,'mime_type',a.mime_type,'file_size',a.file_size,
        'thumbnail_storage_path',a.thumbnail_storage_path,
        'thumbnail_mime_type',a.thumbnail_mime_type,
        'thumbnail_size',a.thumbnail_size,
        'image_width',a.image_width,
        'image_height',a.image_height
      )
      from public.olli_team_chat_attachments a
      where a.academy_id=x.academy_id and a.message_id=x.id
      limit 1
    ),
    'action',(
      select jsonb_build_object(
        'id',ac.id,'action_type',ac.action_type,'status',ac.status,'revision',ac.revision,
        'created_at',ac.created_at,'updated_at',ac.updated_at,'resolved_at',ac.resolved_at,
        'error',ac.error_text,'result_message_id',ac.result_message_id
      )
      from public.olli_team_chat_actions ac
      where ac.academy_id=x.academy_id and ac.message_id=x.id
      limit 1
    ),
    'unread_count',
      case
        when x.audience='management' then 0
        when exists (
          select 1 from public.olli_team_chat_mentions mt
          where mt.academy_id=x.academy_id and mt.message_id=x.id
        )
        then (
          select count(*)::integer
          from public.olli_team_chat_mentions mt
          where mt.academy_id=x.academy_id and mt.message_id=x.id and mt.read_at is null
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
  ) order by x.id asc),'[]'::jsonb)
  into v_messages
  from (
    select msg.*
    from public.olli_team_chat_messages msg
    where msg.academy_id=p_academy_id
      and msg.deleted_at is null
      and (p_before_message_id is null or msg.id<p_before_message_id)
      and (
        msg.audience='all'
        or (msg.audience='management' and v_member.role in ('owner','manager'))
      )
    order by msg.id desc
    limit v_limit
  ) x;

  select coalesce(jsonb_agg(d.id order by d.id asc),'[]'::jsonb)
  into v_deleted_message_ids
  from (
    select msg.id
    from public.olli_team_chat_messages msg
    where msg.academy_id=p_academy_id
      and msg.deleted_at is not null
      and (
        msg.audience='all'
        or (msg.audience='management' and v_member.role in ('owner','manager'))
      )
    order by msg.id desc
    limit 2000
  ) d;

  return jsonb_build_object(
    'ok',true,
    'academy_id',p_academy_id,
    'current_member_id',v_member.id,
    'current_member_name',v_member.display_name,
    'current_role',v_member.role,
    'deleted_message_ids',v_deleted_message_ids,
    'messages',v_messages
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.olli_team_material_request_create(p_session_token text, p_academy_id uuid, p_item_name text, p_quantity_text text, p_needed_on date DEFAULT NULL::date, p_use_context text DEFAULT NULL::text, p_purchase_url text DEFAULT NULL::text, p_memo text DEFAULT NULL::text, p_client_mutation_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_request public.olli_team_material_requests%rowtype;
  v_item_name text := btrim(coalesce(p_item_name, ''));
  v_quantity_text text := btrim(coalesce(p_quantity_text, ''));
  v_use_context text := nullif(btrim(coalesce(p_use_context, '')), '');
  v_purchase_url text := nullif(btrim(coalesce(p_purchase_url, '')), '');
  v_memo text := nullif(btrim(coalesce(p_memo, '')), '');
  v_client_mutation_id uuid := coalesce(p_client_mutation_id, extensions.gen_random_uuid());
  v_created_new boolean := false;
  v_material_event_id bigint;
  v_notification_message_id bigint;
  v_summary text;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;

  select m.* into v_member
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id
    and m.account_id=v_account_id
    and m.status='active'
    and a.status='active'
    and a.deleted_at is null
  order by case m.role when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end,m.created_at
  limit 1;

  if v_member.id is null then raise exception '현재 계정은 이 학원의 재료주문을 사용할 수 없습니다.'; end if;

  if char_length(v_item_name)<1 or char_length(v_item_name)>120 then raise exception '재료명은 1~120자로 입력해 주세요.'; end if;
  if char_length(v_quantity_text)<1 or char_length(v_quantity_text)>60 then raise exception '수량은 1~60자로 입력해 주세요.'; end if;
  if v_use_context is not null and char_length(v_use_context)>160 then raise exception '사용수업은 160자 이내로 입력해 주세요.'; end if;
  if v_purchase_url is not null and (char_length(v_purchase_url)>2000 or v_purchase_url !~* '^https?://') then raise exception '구매링크는 http 또는 https 주소로 입력해 주세요.'; end if;
  if v_memo is not null and char_length(v_memo)>1000 then raise exception '메모는 1000자 이내로 입력해 주세요.'; end if;

  insert into public.olli_team_material_requests(
    academy_id,item_name,quantity_text,needed_on,use_context,purchase_url,memo,status,
    requested_by_member_id,requested_by_name_snapshot,status_changed_by_member_id,client_mutation_id
  )
  values(
    p_academy_id,v_item_name,v_quantity_text,p_needed_on,v_use_context,v_purchase_url,v_memo,
    'requested',v_member.id,v_member.display_name,v_member.id,v_client_mutation_id
  )
  on conflict (academy_id,client_mutation_id) do nothing
  returning * into v_request;

  if v_request.id is null then
    select r.* into v_request
    from public.olli_team_material_requests r
    where r.academy_id=p_academy_id and r.client_mutation_id=v_client_mutation_id
    limit 1;
  else
    v_created_new := true;

    insert into public.olli_team_material_request_events(
      academy_id,request_id,member_id,event_type,to_status
    )
    values(p_academy_id,v_request.id,v_member.id,'created','requested')
    returning id into v_material_event_id;

    v_summary := '재료주문이 등록됐어요.' || E'\n'
      || '요청자 · ' || coalesce(v_member.display_name,'선생님') || E'\n'
      || '품목 · ' || v_item_name || E'\n'
      || '수량 · ' || v_quantity_text
      || case when p_needed_on is not null then E'\n필요일 · ' || to_char(p_needed_on,'YYYY.MM.DD') else '' end
      || case when v_use_context is not null then E'\n사용수업 · ' || v_use_context else '' end
      || case when v_memo is not null then E'\n메모 · ' || v_memo else '' end;

    insert into public.olli_team_chat_messages(
      academy_id,sender_member_id,sender_name_snapshot,message_type,body,client_message_id,
      audience,material_request_id,material_event_id
    )
    values(
      p_academy_id,null,'올리','ai',v_summary,extensions.gen_random_uuid(),
      'management',v_request.id,v_material_event_id
    )
    returning id into v_notification_message_id;

    perform private.olli_realtime_send_signal(p_academy_id,'chat',v_request.revision);
  end if;

  return jsonb_build_object(
    'ok',true,
    'request_id',v_request.id,
    'revision',v_request.revision,
    'status',v_request.status,
    'created_new',v_created_new,
    'material_event_id',v_material_event_id,
    'notification_message_id',v_notification_message_id
  );
end;
$function$;

commit;
