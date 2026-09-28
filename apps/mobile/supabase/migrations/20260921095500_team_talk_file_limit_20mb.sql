-- Raise Team Talk class-file limit from 4 MB to 20 MB.
update storage.buckets
set file_size_limit = 20971520
where id = 'team_talk_files';

alter table public.olli_team_chat_attachments
  drop constraint if exists olli_team_chat_attachments_file_size_check;

alter table public.olli_team_chat_attachments
  add constraint olli_team_chat_attachments_file_size_check
  check (file_size >= 0 and file_size <= 20971520);

create or replace function public.olli_team_chat_send_attachment(
  p_session_token text,
  p_academy_id uuid,
  p_file_name text,
  p_mime_type text,
  p_file_size bigint,
  p_storage_path text,
  p_kind text default 'file',
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
        'mime_type',v_attachment.mime_type,'file_size',v_attachment.file_size
      )
    )
  );
end;
$function$;

revoke all on function public.olli_team_chat_send_attachment(text,uuid,text,text,bigint,text,text,uuid) from public;
grant execute on function public.olli_team_chat_send_attachment(text,uuid,text,text,bigint,text,text,uuid)
  to anon, authenticated, service_role;
