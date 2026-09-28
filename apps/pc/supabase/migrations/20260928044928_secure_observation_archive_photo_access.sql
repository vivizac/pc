-- Production migration: 20260928044928 secure_observation_archive_photo_access

CREATE OR REPLACE FUNCTION public.olli_note_draft_read(p_session_token text, p_academy_id uuid, p_student_id uuid, p_note_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_role text;
  v_note_type text := btrim(coalesce(p_note_type,''));
  v_row public.student_note_drafts%rowtype;
begin
  if p_academy_id is null then
    return jsonb_build_object('ok',false,'code','ACADEMY_ID_MISSING','message','학원 정보를 확인할 수 없습니다.');
  end if;
  if p_student_id is null then
    return jsonb_build_object('ok',false,'code','STUDENT_ID_MISSING','message','학생 ID가 없습니다.');
  end if;
  if v_note_type = '' then
    return jsonb_build_object('ok',false,'code','NOTE_TYPE_MISSING','message','관찰노트 유형이 없습니다.');
  end if;

  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    return jsonb_build_object('ok',false,'code','SESSION_INVALID','message','계정 세션이 만료되었거나 올바르지 않습니다.');
  end if;

  select m.role into v_role
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id
    and m.account_id=v_account_id
    and m.status='active'
    and m.role in ('owner','manager','teacher','super_admin')
    and a.status='active'
    and a.deleted_at is null
  limit 1;

  if v_role is null then
    return jsonb_build_object('ok',false,'code','PERMISSION_DENIED','message','현재 학원의 관찰노트에 접근할 권한이 없습니다.');
  end if;

  select d.* into v_row
  from public.student_note_drafts d
  where d.academy_id=p_academy_id
    and d.student_id=p_student_id
    and d.note_type=v_note_type
  limit 1;

  if not found then
    return jsonb_build_object('ok',true,'rows','[]'::jsonb);
  end if;

  return jsonb_build_object('ok',true,'rows',jsonb_build_array(to_jsonb(v_row)));
end;
$function$


CREATE OR REPLACE FUNCTION public.olli_note_archive_data_access(p_session_token text, p_academy_id uuid, p_action text, p_operation text, p_identity jsonb DEFAULT '{}'::jsonb, p_payload jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_role text;
  v_action text := lower(btrim(coalesce(p_action,'')));
  v_operation text := lower(btrim(coalesce(p_operation,'')));
  v_limit integer := least(greatest(coalesce(p_limit,100),1),5000);
  v_student_id uuid;
  v_student_text text := btrim(coalesce(p_identity->>'student_id',p_payload->>'student_id',''));
  v_local_record_id text := btrim(coalesce(p_identity->>'local_record_id',p_payload->>'local_record_id',''));
  v_note_type text := btrim(coalesce(p_identity->>'note_type',p_payload->>'note_type',''));
  v_payload_academy uuid;
  v_rows jsonb := '[]'::jsonb;
  v_row public.student_note_archives%rowtype;
begin
  if p_academy_id is null then
    return jsonb_build_object('ok',false,'code','ACADEMY_ID_MISSING','message','학원 정보를 확인할 수 없습니다.');
  end if;

  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    return jsonb_build_object('ok',false,'code','SESSION_INVALID','message','계정 세션이 만료되었거나 올바르지 않습니다.');
  end if;

  select m.role into v_role
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id
    and m.account_id=v_account_id
    and m.status='active'
    and m.role in ('owner','manager','teacher','super_admin')
    and a.status='active'
    and a.deleted_at is null
  limit 1;

  if v_role is null then
    return jsonb_build_object('ok',false,'code','PERMISSION_DENIED','message','현재 학원의 관찰노트 보관기록에 접근할 권한이 없습니다.');
  end if;

  if nullif(btrim(coalesce(p_payload->>'academy_id','')),'') is not null then
    begin
      v_payload_academy := (p_payload->>'academy_id')::uuid;
    exception when others then
      return jsonb_build_object('ok',false,'code','INVALID_ACADEMY_ID','message','보관기록 학원 ID가 올바르지 않습니다.');
    end;
    if v_payload_academy is distinct from p_academy_id then
      return jsonb_build_object('ok',false,'code','ACADEMY_MISMATCH','message','다른 학원의 보관기록은 처리할 수 없습니다.');
    end if;
  end if;

  if v_student_text <> '' then
    begin
      v_student_id := v_student_text::uuid;
    exception when others then
      return jsonb_build_object('ok',false,'code','INVALID_STUDENT_ID','message','학생 ID가 올바르지 않습니다.');
    end;
  end if;

  if v_action='read' then
    select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id desc),'[]'::jsonb)
      into v_rows
    from (
      select a.*
      from public.student_note_archives a
      where a.academy_id=p_academy_id
        and (v_student_id is null or a.student_id=v_student_id)
        and (v_local_record_id='' or a.local_record_id=v_local_record_id)
        and (v_note_type='' or a.note_type=v_note_type)
      order by a.created_at desc,a.id desc
      limit v_limit
    ) q;
    return jsonb_build_object('ok',true,'rows',v_rows);
  end if;

  if v_action<>'write' or v_operation not in ('upsert','post','insert') then
    return jsonb_build_object('ok',false,'code','OPERATION_NOT_ALLOWED','message','지원하지 않는 관찰노트 보관 작업입니다.');
  end if;

  if v_student_id is null then
    return jsonb_build_object('ok',false,'code','STUDENT_ID_MISSING','message','학생 ID가 없습니다.');
  end if;
  if v_local_record_id='' then
    return jsonb_build_object('ok',false,'code','LOCAL_RECORD_ID_MISSING','message','관찰기록 식별값이 없습니다.');
  end if;
  if btrim(coalesce(p_payload->>'content',''))='' then
    return jsonb_build_object('ok',false,'code','NOTE_CONTENT_MISSING','message','보관할 관찰노트 내용이 없습니다.');
  end if;
  if not exists (
    select 1 from public.students s
    where s.id=v_student_id and s.academy_id=p_academy_id
  ) then
    return jsonb_build_object('ok',false,'code','STUDENT_NOT_FOUND','message','현재 학원에서 학생을 찾을 수 없습니다.');
  end if;

  insert into public.student_note_archives as a(
    academy_id,student_id,student_name,note_type,content,analysis,record_label,
    local_record_id,feedback_id,year,month,day,created_at
  ) values (
    p_academy_id,
    v_student_id,
    nullif(p_payload->>'student_name',''),
    coalesce(nullif(p_payload->>'note_type',''),'elementary_observation'),
    p_payload->>'content',
    case when p_payload ? 'analysis' then p_payload->'analysis' else null end,
    nullif(p_payload->>'record_label',''),
    v_local_record_id,
    nullif(p_payload->>'feedback_id',''),
    nullif(p_payload->>'year','')::integer,
    nullif(p_payload->>'month','')::integer,
    nullif(p_payload->>'day','')::integer,
    coalesce(nullif(p_payload->>'created_at','')::timestamptz,now())
  )
  on conflict (academy_id,student_id,local_record_id) do update set
    student_name=excluded.student_name,
    note_type=excluded.note_type,
    content=excluded.content,
    analysis=excluded.analysis,
    record_label=excluded.record_label,
    feedback_id=excluded.feedback_id,
    year=excluded.year,
    month=excluded.month,
    day=excluded.day
  returning a.* into v_row;

  return jsonb_build_object('ok',true,'rows',jsonb_build_array(to_jsonb(v_row)));
end;
$function$


CREATE OR REPLACE FUNCTION public.olli_feedback_photo_data_access(p_session_token text, p_academy_id uuid, p_action text, p_operation text, p_identity jsonb DEFAULT '{}'::jsonb, p_payload jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_role text;
  v_action text := lower(btrim(coalesce(p_action,'')));
  v_operation text := lower(btrim(coalesce(p_operation,'')));
  v_limit integer := least(greatest(coalesce(p_limit,100),1),5000);
  v_photo_id text := btrim(coalesce(p_identity->>'id',p_payload->>'id',''));
  v_student_id uuid;
  v_student_text text := btrim(coalesce(p_identity->>'student_id',p_payload->>'student_id',''));
  v_month_key text := btrim(coalesce(p_identity->>'month_key',p_payload->>'month_key',''));
  v_feedback_job_id text := btrim(coalesce(p_identity->>'feedback_job_id',p_payload->>'feedback_job_id',''));
  v_payload_academy uuid;
  v_image_path text := btrim(coalesce(p_payload->>'image_path',''));
  v_thumbnail_path text := btrim(coalesce(p_payload->>'thumbnail_path',''));
  v_rows jsonb := '[]'::jsonb;
  v_row public.feedback_photos%rowtype;
begin
  if p_academy_id is null then
    return jsonb_build_object('ok',false,'code','ACADEMY_ID_MISSING','message','학원 정보를 확인할 수 없습니다.');
  end if;

  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    return jsonb_build_object('ok',false,'code','SESSION_INVALID','message','계정 세션이 만료되었거나 올바르지 않습니다.');
  end if;

  select m.role into v_role
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id
    and m.account_id=v_account_id
    and m.status='active'
    and m.role in ('owner','manager','teacher','super_admin')
    and a.status='active'
    and a.deleted_at is null
  limit 1;

  if v_role is null then
    return jsonb_build_object('ok',false,'code','PERMISSION_DENIED','message','현재 학원의 수업사진에 접근할 권한이 없습니다.');
  end if;

  if nullif(btrim(coalesce(p_payload->>'academy_id','')),'') is not null then
    begin
      v_payload_academy := (p_payload->>'academy_id')::uuid;
    exception when others then
      return jsonb_build_object('ok',false,'code','INVALID_ACADEMY_ID','message','수업사진 학원 ID가 올바르지 않습니다.');
    end;
    if v_payload_academy is distinct from p_academy_id then
      return jsonb_build_object('ok',false,'code','ACADEMY_MISMATCH','message','다른 학원의 수업사진은 처리할 수 없습니다.');
    end if;
  end if;

  if v_student_text <> '' then
    begin
      v_student_id := v_student_text::uuid;
    exception when others then
      return jsonb_build_object('ok',false,'code','INVALID_STUDENT_ID','message','학생 ID가 올바르지 않습니다.');
    end;
  end if;

  if v_action='read' then
    select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.image_order,q.id),'[]'::jsonb)
      into v_rows
    from (
      select p.*
      from public.feedback_photos p
      where p.academy_id=p_academy_id
        and (v_photo_id='' or p.id=v_photo_id)
        and (v_student_id is null or p.student_id=v_student_id)
        and (v_month_key='' or p.month_key=v_month_key)
        and (v_feedback_job_id='' or p.feedback_job_id=v_feedback_job_id)
      order by p.created_at desc,p.image_order,p.id
      limit v_limit
    ) q;
    return jsonb_build_object('ok',true,'rows',v_rows);
  end if;

  if v_action not in ('write','remove') then
    return jsonb_build_object('ok',false,'code','ACTION_NOT_ALLOWED','message','지원하지 않는 수업사진 작업입니다.');
  end if;

  if v_photo_id='' then
    return jsonb_build_object('ok',false,'code','PHOTO_ID_MISSING','message','수업사진 ID가 없습니다.');
  end if;

  if v_student_id is not null and not exists (
    select 1 from public.students s
    where s.id=v_student_id and s.academy_id=p_academy_id and coalesce(s.is_deleted,false)=false
  ) then
    return jsonb_build_object('ok',false,'code','STUDENT_NOT_FOUND','message','현재 학원에서 학생을 찾을 수 없습니다.');
  end if;

  if v_operation in ('post','insert','upsert') then
    if v_image_path='' or v_thumbnail_path='' or v_month_key='' then
      return jsonb_build_object('ok',false,'code','PHOTO_METADATA_INCOMPLETE','message','수업사진 저장 정보가 부족합니다.');
    end if;
    if v_image_path not like p_academy_id::text || '/%' or v_thumbnail_path not like p_academy_id::text || '/%' then
      return jsonb_build_object('ok',false,'code','PHOTO_PATH_ACADEMY_MISMATCH','message','수업사진 저장 경로가 현재 학원과 일치하지 않습니다.');
    end if;

    insert into public.feedback_photos as p(
      id,academy_id,student_id,student_name,feedback_job_id,image_path,thumbnail_path,
      image_url,thumbnail_url,image_width,image_height,file_size,mime_type,month_key,
      image_order,is_deleted,created_at,updated_at,deleted_at,deleted_by,delete_reason
    ) values (
      v_photo_id,p_academy_id,v_student_id,nullif(p_payload->>'student_name',''),
      nullif(p_payload->>'feedback_job_id',''),v_image_path,v_thumbnail_path,
      nullif(p_payload->>'image_url',''),nullif(p_payload->>'thumbnail_url',''),
      nullif(p_payload->>'image_width','')::integer,nullif(p_payload->>'image_height','')::integer,
      nullif(p_payload->>'file_size','')::bigint,nullif(p_payload->>'mime_type',''),
      v_month_key,coalesce(nullif(p_payload->>'image_order','')::integer,1),
      coalesce((p_payload->>'is_deleted')::boolean,false),
      coalesce(nullif(p_payload->>'created_at','')::timestamptz,now()),
      now(),
      nullif(p_payload->>'deleted_at','')::timestamptz,
      nullif(p_payload->>'deleted_by',''),
      nullif(p_payload->>'delete_reason','')
    )
    on conflict (id) do update set
      student_id=excluded.student_id,
      student_name=excluded.student_name,
      feedback_job_id=excluded.feedback_job_id,
      image_path=excluded.image_path,
      thumbnail_path=excluded.thumbnail_path,
      image_url=excluded.image_url,
      thumbnail_url=excluded.thumbnail_url,
      image_width=excluded.image_width,
      image_height=excluded.image_height,
      file_size=excluded.file_size,
      mime_type=excluded.mime_type,
      month_key=excluded.month_key,
      image_order=excluded.image_order,
      is_deleted=excluded.is_deleted,
      deleted_at=excluded.deleted_at,
      deleted_by=excluded.deleted_by,
      delete_reason=excluded.delete_reason,
      updated_at=now()
    where p.academy_id=p_academy_id
    returning p.* into v_row;

    if not found then
      return jsonb_build_object('ok',false,'code','PHOTO_ACADEMY_MISMATCH','message','다른 학원에 속한 수업사진 ID는 수정할 수 없습니다.');
    end if;
    return jsonb_build_object('ok',true,'rows',jsonb_build_array(to_jsonb(v_row)));
  end if;

  if v_operation in ('patch','update') then
    if v_student_id is null then
      return jsonb_build_object('ok',false,'code','STUDENT_ID_MISSING','message','수업사진에 연결할 학생 ID가 없습니다.');
    end if;
    update public.feedback_photos p
      set student_id=v_student_id,
          updated_at=now()
    where p.academy_id=p_academy_id and p.id=v_photo_id
    returning p.* into v_row;
    if not found then
      return jsonb_build_object('ok',false,'code','PHOTO_NOT_FOUND','message','현재 학원에서 수업사진을 찾을 수 없습니다.');
    end if;
    return jsonb_build_object('ok',true,'rows',jsonb_build_array(to_jsonb(v_row)));
  end if;

  if v_operation='soft_delete' then
    update public.feedback_photos p
      set is_deleted=true,
          deleted_at=coalesce(nullif(p_payload->>'deleted_at','')::timestamptz,now()),
          deleted_by=nullif(p_payload->>'deleted_by',''),
          delete_reason=coalesce(nullif(p_payload->>'delete_reason',''),'photo_deleted'),
          updated_at=now()
    where p.academy_id=p_academy_id and p.id=v_photo_id
    returning p.* into v_row;
    if not found then
      return jsonb_build_object('ok',false,'code','PHOTO_NOT_FOUND','message','현재 학원에서 수업사진을 찾을 수 없습니다.');
    end if;
    return jsonb_build_object('ok',true,'rows',jsonb_build_array(to_jsonb(v_row)));
  end if;

  return jsonb_build_object('ok',false,'code','OPERATION_NOT_ALLOWED','message','지원하지 않는 수업사진 저장 방식입니다.');
end;
$function$


revoke all on function public.olli_note_draft_read(text,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.olli_note_archive_data_access(text,uuid,text,text,jsonb,jsonb,integer) from public, anon, authenticated;
revoke all on function public.olli_feedback_photo_data_access(text,uuid,text,text,jsonb,jsonb,integer) from public, anon, authenticated;

grant execute on function public.olli_note_draft_read(text,uuid,uuid,text) to anon, authenticated;
grant execute on function public.olli_note_archive_data_access(text,uuid,text,text,jsonb,jsonb,integer) to anon, authenticated;
grant execute on function public.olli_feedback_photo_data_access(text,uuid,text,text,jsonb,jsonb,integer) to anon, authenticated;
