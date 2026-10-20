-- Additive only: existing student, consultation rules/progress and sync RPCs are unchanged.
create schema if not exists olli_consultation_private;
revoke all on schema olli_consultation_private from public, anon, authenticated;

create table public.olli_consultation_message_settings (
  academy_id uuid primary key references public.academies(id),
  enabled boolean not null default false,
  start_month text not null default to_char(now() at time zone 'Asia/Seoul','YYYY-MM'),
  started_at timestamptz,
  booking_url text not null default '',
  channel_id text not null default '',
  template_id text not null default '',
  template_body text not null default '',
  template_confirmed boolean not null default false,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);
create table public.olli_consultation_message_contacts (
  academy_id uuid not null references public.academies(id),
  student_id uuid not null references public.students(id),
  phone text not null,
  enabled boolean not null default true,
  confirmed boolean not null default false,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (academy_id,student_id),
  check (phone ~ '^01[016789][0-9]{7,8}$')
);
create table public.olli_consultation_message_deliveries (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id),
  student_id uuid not null references public.students(id),
  due_month text not null check (due_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  task_keys jsonb not null,
  status text not null default 'reserved' check(status in ('reserved','submitted','delivered','failed','unknown')),
  provider_message_id text,
  provider_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id,student_id,due_month)
);
create index on public.olli_consultation_message_contacts(student_id);
create index on public.olli_consultation_message_deliveries(student_id);
create index on public.olli_consultation_message_deliveries(academy_id,created_at desc);

alter table public.olli_consultation_message_settings enable row level security;
alter table public.olli_consultation_message_contacts enable row level security;
alter table public.olli_consultation_message_deliveries enable row level security;
revoke all on public.olli_consultation_message_settings,public.olli_consultation_message_contacts,public.olli_consultation_message_deliveries from public,anon,authenticated;
grant select,insert,update on public.olli_consultation_message_settings,public.olli_consultation_message_contacts,public.olli_consultation_message_deliveries to service_role;

-- Existing Olli uses account-session tokens, not Supabase auth.uid(). Match that auth model.
create function olli_consultation_private.require_owner(p_session_token text,p_academy_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (
    select 1 from public.academy_members m join public.academies a on a.id=m.academy_id
    where m.account_id=public.olli_account_id_from_session(p_session_token)
      and m.academy_id=p_academy_id and m.status='active' and m.role in ('owner','super_admin')
      and a.status='active' and a.deleted_at is null
  ) then raise exception '상담 안내 설정은 현재 학원의 원장 계정에서만 사용할 수 있습니다.' using errcode='42501'; end if;
end;
$$;
revoke all on function olli_consultation_private.require_owner(text,uuid) from public,anon,authenticated;

create function public.olli_consultation_messages_manage(p_session_token text,p_academy_id uuid,p_action text default 'load',p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_phone text;
  v_setting public.olli_consultation_message_settings%rowtype;
  v_enabled boolean;
  v_body text;
  v_url text;
begin
  perform olli_consultation_private.require_owner(p_session_token,p_academy_id);
  if p_action='settings' then
    v_enabled := coalesce((p_data->>'enabled')::boolean,false);
    v_url := btrim(coalesce(p_data->>'booking_url',''));
    v_body := btrim(coalesce(p_data->>'template_body',''));
    if length(v_body)>1000 or length(v_url)>2000 or length(coalesce(p_data->>'channel_id',''))>100 or length(coalesce(p_data->>'template_id',''))>100 then raise exception '설정값이 너무 깁니다.'; end if;
    if v_url<>'' and v_url !~ '^https://([a-z0-9-]+\.)*naver\.com(/|$)|^https://naver\.me/' then raise exception 'HTTPS 네이버 플레이스 또는 네이버 예약 링크를 입력해 주세요.'; end if;
    if v_body ~ '#\{(?!학원명\}|학생명\}|상담구분\}|예약링크\})' then raise exception '지원하지 않는 템플릿 변수입니다.'; end if;
    if v_enabled and (v_url='' or v_body='' or btrim(coalesce(p_data->>'channel_id',''))='' or btrim(coalesce(p_data->>'template_id',''))='' or coalesce((p_data->>'template_confirmed')::boolean,false)=false) then
      raise exception '예약 링크와 승인된 알림톡 채널·템플릿 정보를 먼저 등록해 주세요.';
    end if;
    insert into public.olli_consultation_message_settings(academy_id,enabled,booking_url,channel_id,template_id,template_body,template_confirmed,started_at)
    values(p_academy_id,v_enabled,v_url,btrim(coalesce(p_data->>'channel_id','')),btrim(coalesce(p_data->>'template_id','')),v_body,coalesce((p_data->>'template_confirmed')::boolean,false),case when v_enabled then clock_timestamp() else null end)
    on conflict(academy_id) do update set start_month=case when public.olli_consultation_message_settings.started_at is null and excluded.enabled then to_char(now() at time zone 'Asia/Seoul','YYYY-MM') else public.olli_consultation_message_settings.start_month end,started_at=coalesce(public.olli_consultation_message_settings.started_at,excluded.started_at),enabled=excluded.enabled,booking_url=excluded.booking_url,channel_id=excluded.channel_id,template_id=excluded.template_id,template_body=excluded.template_body,template_confirmed=excluded.template_confirmed,revision=public.olli_consultation_message_settings.revision+1,updated_at=clock_timestamp();
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
revoke all on function public.olli_consultation_messages_manage(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.olli_consultation_messages_manage(text,uuid,text,jsonb) to anon,authenticated;

-- Server-only snapshot; no browser grants, no provider secrets stored in the DB.
create function public.olli_consultation_messages_snapshot(p_academy_id uuid default null)
returns jsonb language sql security invoker set search_path = '' as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'settings',to_jsonb(cfg),'academy_name',a.academy_name,
  'rules',settings.consultation_rules,'progress',settings.consultation_progress,
  'students',coalesce((select jsonb_agg(jsonb_build_object(
    'id',s.id,'name',s.name,'division',s.division,'type',s.division,'enrolled_at',s.enrolled_at,'updated_at',s.updated_at,
    'phone',c.phone,'contact_revision',c.revision
  )) from public.students s join public.olli_consultation_message_contacts c on c.student_id=s.id and c.academy_id=s.academy_id
  where s.academy_id=a.id and coalesce(s.status,'active')='active' and not coalesce(s.is_deleted,false) and s.deleted_at is null
    and s.division in ('kinder','elementary') and c.enabled and c.confirmed),'[]'::jsonb),
  'pending',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'provider_message_id',d.provider_message_id)) from public.olli_consultation_message_deliveries d
    where d.academy_id=a.id and d.status='submitted' and d.created_at > now()-interval '30 days'),'[]'::jsonb)
)),'[]'::jsonb)
from public.olli_consultation_message_settings cfg join public.academies a on a.id=cfg.academy_id
left join public.academy_settings settings on settings.academy_id=a.id
where a.status='active' and a.deleted_at is null and (p_academy_id is null or a.id=p_academy_id)
  and (cfg.enabled or exists(select 1 from public.olli_consultation_message_deliveries d where d.academy_id=a.id and d.status='submitted' and d.created_at>now()-interval '30 days'));
$$;

create function public.olli_consultation_messages_reserve(p_academy_id uuid,p_student_id uuid,p_due_month text,p_task_keys jsonb,p_config_revision bigint,p_contact_revision bigint,p_student_updated_at timestamptz,p_rules jsonb,p_progress jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  -- Lock only the new settings/contact rows. Existing sync tables are never written.
  perform 1 from public.olli_consultation_message_settings where academy_id=p_academy_id and enabled and revision=p_config_revision and template_confirmed and start_month<=p_due_month for share;
  if not found then return null; end if;
  perform 1 from public.olli_consultation_message_contacts where academy_id=p_academy_id and student_id=p_student_id and enabled and confirmed and revision=p_contact_revision for share;
  if not found then return null; end if;
  if not exists(select 1 from public.students s where s.id=p_student_id and s.academy_id=p_academy_id and coalesce(s.status,'active')='active'
      and not coalesce(s.is_deleted,false) and s.deleted_at is null and s.updated_at is not distinct from p_student_updated_at) then return null; end if;
  if exists(select 1 from public.academies where id=p_academy_id and (status<>'active' or deleted_at is not null)) then return null; end if;
  if exists(select 1 from public.academy_settings where academy_id=p_academy_id and (consultation_rules is distinct from p_rules or consultation_progress is distinct from p_progress)) then return null; end if;
  if jsonb_typeof(p_task_keys)<>'array' or jsonb_array_length(p_task_keys)=0 then return null; end if;
  if exists(select 1 from jsonb_array_elements_text(p_task_keys) k where coalesce(p_progress->'completed','{}'::jsonb) ? k) then return null; end if;
  insert into public.olli_consultation_message_deliveries(academy_id,student_id,due_month,task_keys)
  values(p_academy_id,p_student_id,p_due_month,p_task_keys) on conflict(academy_id,student_id,due_month) do nothing returning id into v_id;
  return v_id;
end;
$$;

create function public.olli_consultation_messages_finish(p_id uuid,p_status text,p_message_id text default null,p_code text default null)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_status not in ('submitted','delivered','failed','unknown') then raise exception 'Invalid status'; end if;
  update public.olli_consultation_message_deliveries set status=p_status,
    provider_message_id=coalesce(p_message_id,provider_message_id),provider_code=left(p_code,100),updated_at=clock_timestamp()
  where id=p_id and status in ('reserved','submitted','unknown');
  return found;
end;
$$;
revoke all on function public.olli_consultation_messages_snapshot(uuid) from public,anon,authenticated;
revoke all on function public.olli_consultation_messages_reserve(uuid,uuid,text,jsonb,bigint,bigint,timestamptz,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.olli_consultation_messages_finish(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.olli_consultation_messages_snapshot(uuid) to service_role;
grant execute on function public.olli_consultation_messages_reserve(uuid,uuid,text,jsonb,bigint,bigint,timestamptz,jsonb,jsonb) to service_role;
grant execute on function public.olli_consultation_messages_finish(uuid,text,text,text) to service_role;
