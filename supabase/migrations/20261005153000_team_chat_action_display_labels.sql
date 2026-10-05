-- Give every resolved Team Chat action a user-facing completion/selection label.
-- Choice values are derived from the already-persisted action_payload, but the payload itself
-- is not exposed to clients. This preserves the existing data/mutation flow and only enriches
-- the Team Chat read contract.

create or replace function private.olli_team_chat_action_display_label(
  p_action_type text,
  p_status text,
  p_action_payload jsonb
)
returns text
language plpgsql
immutable
set search_path to ''
as $function$
declare
  v_type text := lower(btrim(coalesce(p_action_type,'')));
  v_status text := lower(btrim(coalesce(p_status,'')));
  v_payload jsonb := case
    when jsonb_typeof(p_action_payload)='object' then p_action_payload
    else '{}'::jsonb
  end;
  v_draft jsonb;
  v_field text;
  v_key text;
  v_value text;
  v_label text;
begin
  v_draft := case
    when jsonb_typeof(v_payload->'draft')='object' then v_payload->'draft'
    else '{}'::jsonb
  end;

  if v_status='cancelled' then return '취소됨'; end if;
  if v_status='failed' then return '처리 실패'; end if;
  if v_status<>'completed' then return ''; end if;

  if v_type in ('choose_makeup_group','choose_trial_group','choose_waitlist_group','choose_move_group') then
    v_value := upper(btrim(coalesce(
      v_payload->>'selectedClassGroup',
      v_payload->>'classGroup',
      v_payload->>'targetClassGroup',
      ''
    )));
    if v_value in ('A','B') then return v_value||'반 선택'; end if;
    return '반 선택';
  end if;

  if v_type='choose_structured_date' then
    v_field := lower(btrim(coalesce(v_payload->>'field','')));
    v_key := case when v_field='target_date' then 'targetDateExpression' else 'dateExpression' end;
    v_value := btrim(coalesce(v_draft->>v_key,''));
    if v_value<>'' then return v_value||' 선택'; end if;
    return case when v_field='target_date' then '변경 날짜 선택' else '날짜 선택' end;
  end if;

  if v_type='choose_structured_time' then
    v_field := lower(btrim(coalesce(v_payload->>'field','')));
    v_key := case when v_field='target_time' then 'targetTimeSlot' else 'timeSlot' end;
    v_value := btrim(coalesce(v_draft->>v_key,''));
    v_label := '';

    if v_value<>'' and jsonb_typeof(v_payload->'choices')='array' then
      select coalesce(
        nullif(btrim(item.value->>'label'),''),
        case
          when nullif(btrim(item.value->>'timeSlot'),'') is not null
            then btrim(item.value->>'timeSlot')||'시'
          else null
        end
      )
      into v_label
      from jsonb_array_elements(v_payload->'choices') as item(value)
      where btrim(coalesce(item.value->>'timeSlot',''))=v_value
      limit 1;
    end if;

    if nullif(btrim(coalesce(v_label,'')),'') is not null then
      return btrim(v_label)||' 선택';
    end if;
    if v_value<>'' then return v_value||'시 선택'; end if;
    return case when v_field='target_time' then '변경 시간 선택' else '시간 선택' end;
  end if;

  if v_type='choose_structured_student' then
    v_value := btrim(coalesce(v_draft->>'studentName',''));
    if v_value<>'' then return v_value||' 선택'; end if;
    return '학생 선택';
  end if;

  if v_type='choose_structured_division' then
    v_value := lower(btrim(coalesce(v_draft->>'division','')));
    if v_value='kinder' then return '유치부 선택'; end if;
    if v_value='elementary' then return '초등부 선택'; end if;
    return '수업 구분 선택';
  end if;

  if v_type='choose_structured_target' then
    v_key := btrim(coalesce(v_payload->>'choiceKey',''));
    if v_key='' then
      v_key := case lower(btrim(coalesce(v_payload->>'targetIntent','')))
        when 'update_pickup' then 'pickupId'
        when 'cancel_pickup' then 'pickupId'
        when 'cancel_waitlist' then 'waitlistId'
        else ''
      end;
    end if;

    if v_key<>'' then
      v_value := btrim(coalesce(v_draft->>v_key,''));
    end if;
    v_label := '';

    if coalesce(v_value,'')<>'' and jsonb_typeof(v_payload->'choices')='array' then
      select nullif(btrim(item.value->>'label'),'')
      into v_label
      from jsonb_array_elements(v_payload->'choices') as item(value)
      where btrim(coalesce(item.value->>'id',''))=v_value
      limit 1;
    end if;

    if nullif(btrim(coalesce(v_label,'')),'') is not null then
      return btrim(v_label)||' 선택';
    end if;
    return '일정 선택';
  end if;

  if v_type in (
    'add_class_once','add_pickup','add_makeup','add_trial','add_waitlist','add_timetable_memo'
  ) then
    return '등록 완료';
  end if;

  if v_type in ('delete_timetable_memo','cancel_pickup','cancel_pickup_dropoff') then
    return '삭제 완료';
  end if;

  if v_type in ('cancel_class_once','cancel_makeup','cancel_trial','cancel_waitlist','cancel_move') then
    return '취소 완료';
  end if;

  if v_type='mark_absent' then
    return '결석 처리 완료';
  end if;

  if v_type in (
    'update_pickup_arrival','update_pickup_dropoff','update_makeup','update_trial','update_waitlist',
    'move_class','set_class_layout','set_class_teacher','set_teacher_override','set_session_order',
    'set_normal_class_day','set_attendance_status'
  ) then
    return '변경 완료';
  end if;

  return '완료';
end;
$function$;

revoke execute on function private.olli_team_chat_action_display_label(text,text,jsonb)
  from public, anon, authenticated;

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
        'error',ac.error_text,'result_message_id',ac.result_message_id,
        'display_label',private.olli_team_chat_action_display_label(
          ac.action_type,ac.status,ac.action_payload
        )
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
