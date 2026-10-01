alter table public.academies add column if not exists timetable_week_days smallint not null default 6;
alter table public.academies drop constraint if exists academies_timetable_week_days_check;
alter table public.academies add constraint academies_timetable_week_days_check check (timetable_week_days in (5,6));

alter table public.academies add column if not exists timetable_student_columns smallint not null default 2;
alter table public.academies drop constraint if exists academies_timetable_student_columns_check;
alter table public.academies add constraint academies_timetable_student_columns_check check (timetable_student_columns in (2,3));

create or replace function public.olli_academy_settings_update(p_session_token text,p_academy_id uuid,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  v_account_id uuid; v_role text; v_patch jsonb:=coalesce(p_patch,'{}'::jsonb); v_key text;
  v_row public.academies%rowtype; v_name text; v_profile_url text; v_kinder_timetable_mode text;
  v_timetable_week_days smallint; v_timetable_student_columns smallint;
begin
  if p_academy_id is null then return jsonb_build_object('ok',false,'code','ACADEMY_ID_MISSING','message','학원 ID가 없습니다.'); end if;
  v_account_id:=public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then return jsonb_build_object('ok',false,'code','SESSION_INVALID','message','계정 세션이 만료되었거나 올바르지 않습니다.'); end if;
  select m.role into v_role from public.academy_members m join public.academies a on a.id=m.academy_id
   where m.academy_id=p_academy_id and m.account_id=v_account_id and m.status='active'
     and m.role in ('owner','manager','teacher','super_admin') and a.status='active' and a.deleted_at is null limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'code','PERMISSION_DENIED','message','현재 계정에는 이 학원 설정 수정 권한이 없습니다.'); end if;
  for v_key in select jsonb_object_keys(v_patch) loop
    if v_key not in ('academy_name','profile_image_url','manager_can_backup','manager_can_director_note','kinder_timetable_mode','timetable_week_days','timetable_student_columns') then
      return jsonb_build_object('ok',false,'code','SETTING_FIELD_NOT_ALLOWED','message','허용되지 않은 학원 설정 항목입니다: '||v_key);
    end if;
  end loop;
  if (v_patch?'academy_name') or (v_patch?'profile_image_url') or (v_patch?'kinder_timetable_mode') or (v_patch?'timetable_week_days') or (v_patch?'timetable_student_columns') then
    if v_role not in ('owner','manager','super_admin') then return jsonb_build_object('ok',false,'code','PROFILE_UPDATE_PERMISSION_DENIED','message','학원 설정 수정 권한이 없습니다.'); end if;
  end if;
  if (v_patch?'manager_can_backup') or (v_patch?'manager_can_director_note') then
    if v_role not in ('owner','super_admin') then return jsonb_build_object('ok',false,'code','MANAGER_PERMISSION_UPDATE_DENIED','message','관리자 추가권한은 원장만 변경할 수 있습니다.'); end if;
  end if;
  if v_patch?'academy_name' then v_name:=btrim(coalesce(v_patch->>'academy_name','')); if v_name='' then return jsonb_build_object('ok',false,'code','ACADEMY_NAME_MISSING','message','학원 이름이 비어 있습니다.'); end if; end if;
  if v_patch?'profile_image_url' then v_profile_url:=btrim(coalesce(v_patch->>'profile_image_url','')); if v_profile_url<>'' and v_profile_url!~*'^https?://' then return jsonb_build_object('ok',false,'code','PROFILE_URL_INVALID','message','프로필 이미지 URL이 올바르지 않습니다.'); end if; end if;
  if v_patch?'kinder_timetable_mode' then v_kinder_timetable_mode:=btrim(coalesce(v_patch->>'kinder_timetable_mode','')); if v_kinder_timetable_mode not in ('hourly','half_hour') then return jsonb_build_object('ok',false,'code','TIMETABLE_MODE_INVALID','message','시간표 설정 값을 확인해 주세요.'); end if; end if;
  if v_patch?'timetable_week_days' then v_timetable_week_days:=(v_patch->>'timetable_week_days')::smallint; if v_timetable_week_days not in (5,6) then return jsonb_build_object('ok',false,'code','TIMETABLE_WEEK_DAYS_INVALID','message','수업 요일 설정 값을 확인해 주세요.'); end if; end if;
  if v_patch?'timetable_student_columns' then v_timetable_student_columns:=(v_patch->>'timetable_student_columns')::smallint; if v_timetable_student_columns not in (2,3) then return jsonb_build_object('ok',false,'code','TIMETABLE_STUDENT_COLUMNS_INVALID','message','타임당 정원 설정 값을 확인해 주세요.'); end if; end if;
  update public.academies a set
    academy_name=case when v_patch?'academy_name' then v_name else a.academy_name end,
    profile_image_url=case when v_patch?'profile_image_url' then nullif(v_profile_url,'') else a.profile_image_url end,
    manager_can_backup=case when v_patch?'manager_can_backup' then (v_patch->>'manager_can_backup')::boolean else a.manager_can_backup end,
    manager_can_director_note=case when v_patch?'manager_can_director_note' then (v_patch->>'manager_can_director_note')::boolean else a.manager_can_director_note end,
    kinder_timetable_mode=case when v_patch?'kinder_timetable_mode' then v_kinder_timetable_mode else a.kinder_timetable_mode end,
    timetable_week_days=case when v_patch?'timetable_week_days' then v_timetable_week_days else a.timetable_week_days end,
    timetable_student_columns=case when v_patch?'timetable_student_columns' then v_timetable_student_columns else a.timetable_student_columns end,
    updated_at=now()
   where a.id=p_academy_id and a.status='active' and a.deleted_at is null returning a.* into v_row;
  if not found then return jsonb_build_object('ok',false,'code','ACADEMY_NOT_FOUND','message','현재 학원을 찾을 수 없습니다.'); end if;
  return jsonb_build_object('ok',true,'role',v_role,'academy',to_jsonb(v_row));
exception when invalid_text_representation then
  return jsonb_build_object('ok',false,'code','SETTING_VALUE_INVALID','message','학원 설정 값 형식이 올바르지 않습니다.');
end;
$function$;

revoke all on function public.olli_academy_settings_update(text,uuid,jsonb) from public;
revoke all on function public.olli_academy_settings_update(text,uuid,jsonb) from anon,authenticated;
grant execute on function public.olli_academy_settings_update(text,uuid,jsonb) to anon,authenticated;
