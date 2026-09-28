-- Team Chat thumbnail metadata foundation.
-- Backward-compatible: all new columns are nullable and existing upload RPC signatures stay unchanged.

alter table public.olli_team_chat_attachments
  add column if not exists thumbnail_storage_path text,
  add column if not exists thumbnail_mime_type text,
  add column if not exists thumbnail_size bigint,
  add column if not exists image_width integer,
  add column if not exists image_height integer;

alter table public.olli_team_chat_attachments
  drop constraint if exists olli_team_chat_attachments_thumbnail_size_check;
alter table public.olli_team_chat_attachments
  add constraint olli_team_chat_attachments_thumbnail_size_check
  check (thumbnail_size is null or (thumbnail_size >= 0 and thumbnail_size <= 2097152));

alter table public.olli_team_chat_attachments
  drop constraint if exists olli_team_chat_attachments_image_width_check;
alter table public.olli_team_chat_attachments
  add constraint olli_team_chat_attachments_image_width_check
  check (image_width is null or (image_width > 0 and image_width <= 50000));

alter table public.olli_team_chat_attachments
  drop constraint if exists olli_team_chat_attachments_image_height_check;
alter table public.olli_team_chat_attachments
  add constraint olli_team_chat_attachments_image_height_check
  check (image_height is null or (image_height > 0 and image_height <= 50000));

create unique index if not exists olli_team_chat_attachments_academy_thumbnail_path_uidx
  on public.olli_team_chat_attachments (academy_id, thumbnail_storage_path)
  where thumbnail_storage_path is not null;

create or replace function public.olli_team_chat_send_attachment(
  p_session_token text, p_academy_id uuid, p_file_name text, p_mime_type text,
  p_file_size bigint, p_storage_path text, p_kind text default 'file',
  p_client_message_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_message public.olli_team_chat_messages%rowtype;
  v_attachment public.olli_team_chat_attachments%rowtype;
  v_kind text := case when lower(coalesce(p_kind,'file'))='media' then 'media' else 'file' end;
  v_name text := btrim(coalesce(p_file_name,''));
  v_path text := btrim(coalesce(p_storage_path,''));
  v_mime text := nullif(btrim(coalesce(p_mime_type,'')),'');
  v_client_message_id uuid := coalesce(p_client_message_id, extensions.gen_random_uuid());
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;
  if p_academy_id is null then raise exception '학원 ID가 없습니다.'; end if;
  if char_length(v_name)<1 or char_length(v_name)>255 then raise exception '파일 이름이 올바르지 않습니다.'; end if;
  if coalesce(p_file_size,0)<1 or p_file_size>20971520 then raise exception '파일은 20MB 이하만 올릴 수 있습니다.'; end if;
  if char_length(v_path)<1 or position(p_academy_id::text || '/' in v_path)<>1 then raise exception '파일 저장 경로가 올바르지 않습니다.'; end if;

  select m.* into v_member
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id and m.account_id=v_account_id and m.status='active'
    and a.status='active' and a.deleted_at is null
  order by case m.role when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end, m.created_at
  limit 1;
  if v_member.id is null then raise exception '현재 계정은 이 학원의 팀톡을 사용할 수 없습니다.'; end if;

  insert into public.olli_team_chat_messages
    (academy_id,sender_member_id,sender_name_snapshot,message_type,body,client_message_id)
  values
    (p_academy_id,v_member.id,v_member.display_name,v_kind,v_name,v_client_message_id)
  on conflict (academy_id,client_message_id) do nothing
  returning * into v_message;

  if v_message.id is null then
    select m.* into v_message
    from public.olli_team_chat_messages m
    where m.academy_id=p_academy_id and m.client_message_id=v_client_message_id
    limit 1;
  end if;

  insert into public.olli_team_chat_attachments
    (academy_id,message_id,uploaded_by_member_id,kind,storage_bucket,storage_path,file_name,mime_type,file_size)
  values
    (p_academy_id,v_message.id,v_member.id,v_kind,'team_talk_files',v_path,v_name,v_mime,p_file_size)
  on conflict (message_id) do nothing
  returning * into v_attachment;

  if v_attachment.id is null then
    select a.* into v_attachment
    from public.olli_team_chat_attachments a
    where a.message_id=v_message.id
    limit 1;
  end if;

  perform private.olli_realtime_send_signal(p_academy_id,'chat',v_message.id);

  return jsonb_build_object(
    'ok',true,
    'message',jsonb_build_object(
      'id',v_message.id,'academy_id',v_message.academy_id,
      'sender_member_id',v_message.sender_member_id,'sender_name',v_message.sender_name_snapshot,
      'message_type',v_message.message_type,'body',v_message.body,'created_at',v_message.created_at,
      'attachment',jsonb_build_object(
        'id',v_attachment.id,'kind',v_attachment.kind,'file_name',v_attachment.file_name,
        'mime_type',v_attachment.mime_type,'file_size',v_attachment.file_size,
        'thumbnail_storage_path',v_attachment.thumbnail_storage_path,
        'thumbnail_mime_type',v_attachment.thumbnail_mime_type,
        'thumbnail_size',v_attachment.thumbnail_size,
        'image_width',v_attachment.image_width,
        'image_height',v_attachment.image_height
      )
    )
  );
end;
$function$;

create or replace function public.olli_team_chat_archive(
  p_session_token text, p_academy_id uuid, p_limit integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_member_id uuid;
  v_limit integer := greatest(1,least(coalesce(p_limit,1000),2000));
  v_messages jsonb;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;

  select m.id into v_member_id
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id and m.account_id=v_account_id and m.status='active'
    and a.status='active' and a.deleted_at is null
  order by m.created_at limit 1;
  if v_member_id is null then raise exception '현재 계정은 이 학원의 팀톡을 사용할 수 없습니다.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'sender_member_id',x.sender_member_id,'sender_name',x.sender_name_snapshot,
    'message_type',x.message_type,'body',x.body,'created_at',x.created_at,
    'attachment',(
      select jsonb_build_object(
        'id',a.id,'kind',a.kind,'file_name',a.file_name,'mime_type',a.mime_type,
        'file_size',a.file_size,'created_at',a.created_at,
        'thumbnail_storage_path',a.thumbnail_storage_path,
        'thumbnail_mime_type',a.thumbnail_mime_type,
        'thumbnail_size',a.thumbnail_size,
        'image_width',a.image_width,
        'image_height',a.image_height
      )
      from public.olli_team_chat_attachments a
      where a.academy_id=x.academy_id and a.message_id=x.id limit 1
    )
  ) order by x.id desc),'[]'::jsonb) into v_messages
  from (
    select msg.* from public.olli_team_chat_messages msg
    where msg.academy_id=p_academy_id and msg.deleted_at is null
    order by msg.id desc limit v_limit
  ) x;

  return jsonb_build_object('ok',true,'academy_id',p_academy_id,'current_member_id',v_member_id,'messages',v_messages);
end;
$function$;

create or replace function public.olli_team_chat_list(
  p_session_token text, p_academy_id uuid, p_before_message_id bigint default null, p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_limit integer := greatest(1,least(coalesce(p_limit,50),100));
  v_messages jsonb;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;
  if p_academy_id is null then
    raise exception '학원 ID가 없습니다.';
  end if;

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
