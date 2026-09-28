create or replace function public.olli_team_chat_delete_attachment(
  p_session_token text,
  p_academy_id uuid,
  p_attachment_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_attachment public.olli_team_chat_attachments%rowtype;
  v_message public.olli_team_chat_messages%rowtype;
  v_already_deleted boolean := false;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;
  if p_academy_id is null then raise exception '학원 ID가 없습니다.'; end if;
  if coalesce(p_attachment_id, 0) < 1 then raise exception '첨부파일 ID가 올바르지 않습니다.'; end if;

  select m.* into v_member
  from public.academy_members m
  join public.academies a on a.id = m.academy_id
  where m.academy_id = p_academy_id
    and m.account_id = v_account_id
    and m.status = 'active'
    and a.status = 'active'
    and a.deleted_at is null
  order by case m.role when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end, m.created_at
  limit 1;
  if v_member.id is null then raise exception '현재 계정은 이 학원의 팀톡을 사용할 수 없습니다.'; end if;

  select a.* into v_attachment
  from public.olli_team_chat_attachments a
  where a.academy_id = p_academy_id and a.id = p_attachment_id
  limit 1;
  if v_attachment.id is null then raise exception '삭제할 사진을 찾지 못했습니다.'; end if;

  if v_member.role not in ('owner','manager')
     and v_attachment.uploaded_by_member_id is distinct from v_member.id then
    raise exception '본인이 올린 사진만 삭제할 수 있습니다.';
  end if;

  select m.* into v_message
  from public.olli_team_chat_messages m
  where m.academy_id = p_academy_id and m.id = v_attachment.message_id
  limit 1;
  if v_message.id is null then raise exception '사진 메시지를 찾지 못했습니다.'; end if;

  v_already_deleted := v_message.deleted_at is not null;
  if not v_already_deleted then
    update public.olli_team_chat_messages
    set deleted_at = now(), deleted_by_member_id = v_member.id
    where academy_id = p_academy_id and id = v_message.id and deleted_at is null;
  end if;

  perform private.olli_realtime_send_signal(p_academy_id, 'chat', v_message.id);

  return jsonb_build_object(
    'ok', true,
    'attachment_id', v_attachment.id,
    'message_id', v_message.id,
    'storage_bucket', v_attachment.storage_bucket,
    'storage_path', v_attachment.storage_path,
    'thumbnail_storage_path', v_attachment.thumbnail_storage_path,
    'already_deleted', v_already_deleted
  );
end;
$function$;

revoke all on function public.olli_team_chat_delete_attachment(text, uuid, bigint) from public;
grant execute on function public.olli_team_chat_delete_attachment(text, uuid, bigint)
  to anon, authenticated, service_role;

comment on function public.olli_team_chat_delete_attachment(text, uuid, bigint)
  is 'Soft-deletes a Team Chat attachment message after session + academy authorization. Uploader may delete own attachment; owner/manager may delete any attachment. Returns storage paths for server-side object cleanup.';
