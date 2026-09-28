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
  v_deleted_message_ids jsonb;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;
  if p_academy_id is null then raise exception '학원 ID가 없습니다.'; end if;

  select m.* into v_member
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id and m.account_id=v_account_id and m.status='active'
    and a.status='active' and a.deleted_at is null
  order by case m.role when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end,m.created_at
  limit 1;
  if v_member.id is null then raise exception '현재 계정은 이 학원의 팀톡을 사용할 수 없습니다.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'academy_id',x.academy_id,'sender_member_id',x.sender_member_id,
    'sender_name',x.sender_name_snapshot,'message_type',x.message_type,'body',x.body,
    'reply_to_message_id',x.reply_to_message_id,'client_message_id',x.client_message_id,
    'created_at',x.created_at,
    'attachment',(select jsonb_build_object(
      'id',a.id,'kind',a.kind,'file_name',a.file_name,'mime_type',a.mime_type,'file_size',a.file_size,
      'thumbnail_storage_path',a.thumbnail_storage_path,'thumbnail_mime_type',a.thumbnail_mime_type,
      'thumbnail_size',a.thumbnail_size,'image_width',a.image_width,'image_height',a.image_height
    ) from public.olli_team_chat_attachments a
      where a.academy_id=x.academy_id and a.message_id=x.id limit 1),
    'action',(select jsonb_build_object(
      'id',ac.id,'action_type',ac.action_type,'status',ac.status,'revision',ac.revision,
      'created_at',ac.created_at,'updated_at',ac.updated_at,'resolved_at',ac.resolved_at,
      'error',ac.error_text,'result_message_id',ac.result_message_id
    ) from public.olli_team_chat_actions ac
      where ac.academy_id=x.academy_id and ac.message_id=x.id limit 1),
    'unread_count',
      case
        when exists (
          select 1 from public.olli_team_chat_mentions mt
          where mt.academy_id=x.academy_id and mt.message_id=x.id
        ) then (
          select count(*)::integer from public.olli_team_chat_mentions mt
          where mt.academy_id=x.academy_id and mt.message_id=x.id and mt.read_at is null
        ) else (
          select count(*)::integer
          from public.academy_members am
          left join public.olli_team_chat_member_state st
            on st.academy_id=am.academy_id and st.member_id=am.id
          where am.academy_id=x.academy_id and am.status='active' and am.account_id is not null
            and (x.sender_member_id is null or am.id<>x.sender_member_id)
            and coalesce(st.last_read_message_id,0)<x.id
        )
      end
  ) order by x.id asc),'[]'::jsonb) into v_messages
  from (
    select msg.* from public.olli_team_chat_messages msg
    where msg.academy_id=p_academy_id and msg.deleted_at is null
      and (p_before_message_id is null or msg.id<p_before_message_id)
    order by msg.id desc limit v_limit
  ) x;

  select coalesce(jsonb_agg(d.id order by d.id asc),'[]'::jsonb)
  into v_deleted_message_ids
  from (
    select msg.id from public.olli_team_chat_messages msg
    where msg.academy_id=p_academy_id and msg.deleted_at is not null
    order by msg.id desc limit 2000
  ) d;

  return jsonb_build_object(
    'ok',true,'academy_id',p_academy_id,
    'current_member_id',v_member.id,'current_member_name',v_member.display_name,
    'deleted_message_ids',v_deleted_message_ids,'messages',v_messages
  );
end;
$function$;

comment on function public.olli_team_chat_list(text, uuid, bigint, integer)
  is 'Session-aware Team Chat list. Includes recent soft-deleted message IDs so local-first clients can remove tombstoned cached messages across devices.';
