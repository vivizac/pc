-- Additive registry for consultation Alimtalk channels.
-- Never auto-approve existing channel IDs or migrate them by inference.
create table public.olli_consultation_channels (
 id uuid primary key default gen_random_uuid(),
 pf_id text not null unique,
 channel_name text not null default '',
 channel_type text not null check (channel_type in ('headquarters','academy')),
 owner_academy_id uuid references public.academies(id),
 approval_state text not null default 'pending' check (approval_state in ('pending','approved','rejected','disabled')),
 revision bigint not null default 1,
 check ((channel_type='headquarters' and owner_academy_id is null)
     or (channel_type='academy' and owner_academy_id is not null))
);
create table public.olli_consultation_channel_assignments (
 academy_id uuid not null references public.academies(id),
 channel_id uuid not null references public.olli_consultation_channels(id),
 approval_state text not null default 'pending' check (approval_state in ('pending','approved','rejected','disabled')),
 primary key (academy_id,channel_id)
);
create table public.olli_consultation_channel_templates (
 channel_id uuid not null references public.olli_consultation_channels(id),
 template_id text not null,
 template_body text not null,
 approval_state text not null default 'pending' check (approval_state in ('pending','approved','rejected','disabled')),
 primary key (channel_id,template_id)
);
alter table public.olli_consultation_message_settings
 add column channel_mode text not null default 'headquarters' check (channel_mode in ('headquarters','academy')),
 add column selected_channel_id uuid references public.olli_consultation_channels(id);
alter table public.olli_consultation_channels enable row level security;
alter table public.olli_consultation_channel_assignments enable row level security;
alter table public.olli_consultation_channel_templates enable row level security;
revoke all on public.olli_consultation_channels,public.olli_consultation_channel_assignments,public.olli_consultation_channel_templates from public,anon,authenticated;
grant select,insert,update on public.olli_consultation_channels,public.olli_consultation_channel_assignments,public.olli_consultation_channel_templates to service_role;
create function public.olli_consultation_channel_resolve(p_academy_id uuid,p_template_id text,p_template_body text)
returns table(pf_id text,channel_revision bigint)
language sql security invoker set search_path = '' as $$
 select c.pf_id,c.revision from public.olli_consultation_message_settings s
 join public.olli_consultation_channels c on c.id=s.selected_channel_id and c.channel_type=s.channel_mode
 join public.olli_consultation_channel_assignments a on a.channel_id=c.id and a.academy_id=s.academy_id
 join public.olli_consultation_channel_templates t on t.channel_id=c.id and t.template_id=p_template_id and t.template_body=p_template_body
 where s.academy_id=p_academy_id and s.enabled and c.approval_state='approved'
 and a.approval_state='approved' and t.approval_state='approved'
 and (c.channel_type='headquarters' or c.owner_academy_id=p_academy_id);
$$;
revoke all on function public.olli_consultation_channel_resolve(uuid,text,text) from public,anon,authenticated;
grant execute on function public.olli_consultation_channel_resolve(uuid,text,text) to service_role;

-- Disable only usage; preserve current templates, contacts and delivery history.
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
  if p_action='channel' then
    if coalesce(p_data->>'channel_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception '올바른 카카오채널 ID를 선택해 주세요.';
    end if;
    if not exists (
      select 1 from public.olli_consultation_channels c
      join public.olli_consultation_channel_assignments a on a.channel_id=c.id
      where a.academy_id=p_academy_id
        and c.id=(p_data->>'channel_id')::uuid
        and c.channel_type=p_data->>'channel_mode'
        and c.approval_state='approved' and a.approval_state='approved'
        and (c.channel_type='headquarters' or c.owner_academy_id=p_academy_id)
    ) then
      raise exception '승인된 학원 채널이 아닙니다.';
    end if;
    update public.olli_consultation_message_settings
    set selected_channel_id=(p_data->>'channel_id')::uuid,
        channel_mode=p_data->>'channel_mode',
        enabled=false,template_confirmed=false,revision=revision+1,
        updated_at=clock_timestamp() where academy_id=p_academy_id;
  elsif p_action='disable' then
    update public.olli_consultation_message_settings
    set enabled=false,revision=revision+1,updated_at=clock_timestamp()
    where academy_id=p_academy_id;
  elsif p_action='settings' then
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
      if coalesce(v_variant->>'template_body','') ~ '#\{(?!학원명\}|학생명\}|학생이름_주제\}|학생이름_주격\}|학생이름_목적격\}|학생이름_함께\}|학생이름_방향\}|상담구분\}|예약링크\})' then raise exception '지원하지 않는 개별 안내문 변수입니다.'; end if;
      if v_enabled and v_mode='by_type' and v_custom and (btrim(coalesce(v_variant->>'template_id',''))='' or btrim(coalesce(v_variant->>'template_body',''))='' or coalesce((v_variant->>'template_confirmed')::boolean,false)=false) then
        raise exception '개별 안내문의 승인된 템플릿 ID·문구·승인 확인이 필요합니다: %',v_key;
      end if;
    end loop;
    v_url := btrim(coalesce(p_data->>'booking_url',''));
    v_body := btrim(coalesce(p_data->>'template_body',''));
    if length(v_body)>1000 or length(v_url)>2000 or length(coalesce(p_data->>'channel_id',''))>100 or length(coalesce(p_data->>'template_id',''))>100 then raise exception '설정값이 너무 깁니다.'; end if;
    if v_url<>'' and v_url !~ '^https://([a-z0-9-]+\.)*naver\.com(/|$)|^https://naver\.me/' then raise exception 'HTTPS 네이버 플레이스 또는 네이버 예약 링크를 입력해 주세요.'; end if;
    if v_body ~ '#\{(?!학원명\}|학생명\}|학생이름_주제\}|학생이름_주격\}|학생이름_목적격\}|학생이름_함께\}|학생이름_방향\}|상담구분\}|예약링크\})' then raise exception '지원하지 않는 템플릿 변수입니다.'; end if;
    if v_enabled and (v_url='' or v_body='' or not exists (select 1 from public.olli_consultation_channels c
      join public.olli_consultation_channel_assignments a on a.channel_id=c.id and a.academy_id=p_academy_id
      where c.id=v_setting.selected_channel_id and c.channel_type=v_setting.channel_mode
        and c.approval_state='approved' and a.approval_state='approved'
        and (c.channel_type='headquarters' or c.owner_academy_id=p_academy_id)) or btrim(coalesce(p_data->>'template_id',''))='' or coalesce((p_data->>'template_confirmed')::boolean,false)=false) then
      raise exception '예약 링크와 승인된 알림톡 채널·템플릿 정보를 먼저 등록해 주세요.';
    end if;
    if v_enabled and not exists (
      select 1 from public.olli_consultation_channel_templates t
      join public.olli_consultation_channels c on c.id=t.channel_id
      join public.olli_consultation_channel_assignments a
        on a.channel_id=c.id and a.academy_id=p_academy_id
      where c.id=v_setting.selected_channel_id and c.channel_type=v_setting.channel_mode
        and c.approval_state='approved' and a.approval_state='approved'
        and t.template_id=btrim(coalesce(p_data->>'template_id',''))
        and t.template_body=v_body and t.approval_state='approved'
        and (c.channel_type='headquarters' or c.owner_academy_id=p_academy_id)
    ) then raise exception '해당 채널에서 승인받은 안내문이 아닙니다.'; end if;
    insert into public.olli_consultation_message_settings(academy_id,enabled,booking_url,channel_id,template_id,template_body,template_confirmed,started_at,template_mode,template_variants)
    values(p_academy_id,v_enabled,v_url,coalesce(v_setting.channel_id,''),btrim(coalesce(p_data->>'template_id','')),v_body,coalesce((p_data->>'template_confirmed')::boolean,false),case when v_enabled then clock_timestamp() else null end,v_mode,v_variants)
    on conflict(academy_id) do update set template_mode=excluded.template_mode,template_variants=excluded.template_variants,start_month=case when public.olli_consultation_message_settings.started_at is null and excluded.enabled then to_char(now() at time zone 'Asia/Seoul','YYYY-MM') else public.olli_consultation_message_settings.start_month end,started_at=coalesce(public.olli_consultation_message_settings.started_at,excluded.started_at),enabled=excluded.enabled,booking_url=excluded.booking_url,channel_id=public.olli_consultation_message_settings.channel_id,template_id=excluded.template_id,template_body=excluded.template_body,template_confirmed=excluded.template_confirmed,revision=public.olli_consultation_message_settings.revision+1,updated_at=clock_timestamp();
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
  return jsonb_build_object('ok',true,'settings',to_jsonb(v_setting),'channels',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.channel_name,'mode',c.channel_type))
  from public.olli_consultation_channels c join public.olli_consultation_channel_assignments a on a.channel_id=c.id
  where a.academy_id=p_academy_id and c.approval_state='approved' and a.approval_state='approved'
    and (c.channel_type='headquarters' or c.owner_academy_id=p_academy_id)),'[]'::jsonb),'students',coalesce((
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
