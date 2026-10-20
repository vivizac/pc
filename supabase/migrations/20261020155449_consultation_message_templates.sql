-- Extend only the new consultation message settings; existing values are preserved.
alter table public.olli_consultation_message_settings
  add column template_mode text not null default 'common' check(template_mode in ('common','by_type')),
  add column template_variants jsonb not null default '{}'::jsonb check(jsonb_typeof(template_variants)='object');

create or replace function public.olli_consultation_messages_manage(p_session_token text,p_academy_id uuid,p_action text default 'load',p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_phone text;
  v_setting public.olli_consultation_message_settings%rowtype;
  v_enabled boolean;
  v_body text;
  v_url text;
  v_mode text;
  v_variants jsonb;
  v_key text;
  v_variant jsonb;
  v_custom boolean;
begin
  perform olli_consultation_private.require_owner(p_session_token,p_academy_id);
  if p_action='settings' then
    v_enabled := coalesce((p_data->>'enabled')::boolean,false);
    select * into v_setting from public.olli_consultation_message_settings where academy_id=p_academy_id;
    v_mode := coalesce(p_data->>'template_mode',v_setting.template_mode,'common');
    v_variants := coalesce(p_data->'template_variants',v_setting.template_variants,'{}'::jsonb);
    if v_mode not in ('common','by_type') or jsonb_typeof(v_variants)<>'object' then raise exception '상담 안내문 설정 형식이 올바르지 않습니다.'; end if;
    for v_key,v_variant in select key,value from jsonb_each(v_variants) loop
      if v_key not in ('elementary:after_1','elementary:after_3','elementary:every_6','elementary:every_12','kinder:after_1','kinder:after_3','kinder:every_6','kinder:every_12') or jsonb_typeof(v_variant)<>'object' then raise exception '지원하지 않는 상담 안내문 종류입니다.'; end if;
      if (v_variant ? 'use_common') and jsonb_typeof(v_variant->'use_common')<>'boolean' then raise exception '공통 안내문 사용 설정을 확인해 주세요.'; end if;
      v_custom := coalesce((v_variant->>'use_common')::boolean,true)=false;
      if length(coalesce(v_variant->>'template_id',''))>100 or length(coalesce(v_variant->>'template_body',''))>1000 then raise exception '개별 안내문 또는 템플릿 ID가 너무 깁니다.'; end if;
      if coalesce(v_variant->>'template_body','') ~ '#\{(?!학원명\}|학생명\}|상담구분\}|예약링크\})' then raise exception '지원하지 않는 개별 안내문 변수입니다.'; end if;
      if v_enabled and v_mode='by_type' and v_custom and (btrim(coalesce(v_variant->>'template_id',''))='' or btrim(coalesce(v_variant->>'template_body',''))='' or coalesce((v_variant->>'template_confirmed')::boolean,false)=false) then
        raise exception '개별 안내문의 승인된 템플릿 ID·문구·승인 확인이 필요합니다: %',v_key;
      end if;
    end loop;
    v_url := btrim(coalesce(p_data->>'booking_url',''));
    v_body := btrim(coalesce(p_data->>'template_body',''));
    if length(v_body)>1000 or length(v_url)>2000 or length(coalesce(p_data->>'channel_id',''))>100 or length(coalesce(p_data->>'template_id',''))>100 then raise exception '설정값이 너무 깁니다.'; end if;
    if v_url<>'' and v_url !~ '^https://([a-z0-9-]+\.)*naver\.com(/|$)|^https://naver\.me/' then raise exception 'HTTPS 네이버 플레이스 또는 네이버 예약 링크를 입력해 주세요.'; end if;
    if v_body ~ '#\{(?!학원명\}|학생명\}|상담구분\}|예약링크\})' then raise exception '지원하지 않는 템플릿 변수입니다.'; end if;
    if v_enabled and (v_url='' or v_body='' or btrim(coalesce(p_data->>'channel_id',''))='' or btrim(coalesce(p_data->>'template_id',''))='' or coalesce((p_data->>'template_confirmed')::boolean,false)=false) then
      raise exception '예약 링크와 승인된 알림톡 채널·템플릿 정보를 먼저 등록해 주세요.';
    end if;
    insert into public.olli_consultation_message_settings(academy_id,enabled,booking_url,channel_id,template_id,template_body,template_confirmed,started_at,template_mode,template_variants)
    values(p_academy_id,v_enabled,v_url,btrim(coalesce(p_data->>'channel_id','')),btrim(coalesce(p_data->>'template_id','')),v_body,coalesce((p_data->>'template_confirmed')::boolean,false),case when v_enabled then clock_timestamp() else null end,v_mode,v_variants)
    on conflict(academy_id) do update set template_mode=excluded.template_mode,template_variants=excluded.template_variants,start_month=case when public.olli_consultation_message_settings.started_at is null and excluded.enabled then to_char(now() at time zone 'Asia/Seoul','YYYY-MM') else public.olli_consultation_message_settings.start_month end,started_at=coalesce(public.olli_consultation_message_settings.started_at,excluded.started_at),enabled=excluded.enabled,booking_url=excluded.booking_url,channel_id=excluded.channel_id,template_id=excluded.template_id,template_body=excluded.template_body,template_confirmed=excluded.template_confirmed,revision=public.olli_consultation_message_settings.revision+1,updated_at=clock_timestamp();
  elsif p_action='contact' then
    v_id := (p_data->>'student_id')::uuid;
    if not exists(select 1 from public.students s where s.id=v_id and s.academy_id=p_academy_id and not coalesce(s.is_deleted,false) and s.deleted_at is null) then raise exception '현재 학원의 학생을 찾지 못했습니다.'; end if;
    v_phone := regexp_replace(coalesce(p_data->>'phone',''),'[^0-9]','','g');
    if v_phone !~ '^01[016789][0-9]{7,8}$' then raise exception '보호자 휴대전화 번호를 확인해 주세요.'; end if;
    insert into public.olli_consultation_message_contacts(academy_id,student_id,phone,enabled,confirmed)
    values(p_academy_id,v_id,v_phone,coalesce((p_data->>'enabled')::boolean,true),coalesce((p_data->>'confirmed')::boolean,false))
    on conflict(academy_id,student_id) do update set phone=excluded.phone,enabled=excluded.enabled,confirmed=excluded.confirmed,revision=public.olli_consultation_message_contacts.revision+1,updated_at=clock_timestamp();
  elsif p_action <> 'load' then raise exception '지원하지 않는 요청입니다.';
  end if;
  select * into v_setting from public.olli_consultation_message_settings where academy_id=p_academy_id;
  return jsonb_build_object('ok',true,'settings',to_jsonb(v_setting),'students',coalesce((
    select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'division',s.division,'phone',c.phone,'enabled',c.enabled,'confirmed',c.confirmed) order by s.name)
    from public.students s left join public.olli_consultation_message_contacts c on c.student_id=s.id and c.academy_id=s.academy_id
    where s.academy_id=p_academy_id and coalesce(s.status,'active')='active' and not coalesce(s.is_deleted,false) and s.deleted_at is null
  ),'[]'::jsonb),'deliveries',coalesce((
    select jsonb_agg(to_jsonb(d) order by d.created_at desc) from (
      select id,student_id,due_month,status,provider_code,created_at,updated_at from public.olli_consultation_message_deliveries
      where academy_id=p_academy_id order by created_at desc limit 300
    ) d
  ),'[]'::jsonb));
end;
$$;
