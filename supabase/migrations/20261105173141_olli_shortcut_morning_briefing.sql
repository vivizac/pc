-- iPhone Shortcuts: owner/manager-scoped read-only daily briefing credential.
-- The raw secret is never stored in PostgreSQL or an Olli browser cache.
create table if not exists public.olli_shortcut_briefing_tokens (
  academy_id uuid not null references public.academies(id) on delete cascade,
  member_id uuid not null references public.academy_members(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  primary key (academy_id, member_id)
);
alter table public.olli_shortcut_briefing_tokens enable row level security;
revoke all on public.olli_shortcut_briefing_tokens from public, anon, authenticated;

create or replace function public.olli_shortcut_briefing_manage(
  p_session_token text, p_academy_id uuid, p_action text, p_token_hash text default null
) returns jsonb language plpgsql security definer set search_path to ''
as $$
declare v_account uuid; v_member uuid;
begin
  v_account := public.olli_account_id_from_session(p_session_token);
  if v_account is null or p_academy_id is null then
    raise exception 'SESSION_INVALID' using errcode='42501';
  end if;
  select m.id into v_member
  from public.academy_members m
  join public.academies a on a.id=m.academy_id
  where m.account_id=v_account and m.academy_id=p_academy_id
    and m.status='active' and m.role in ('owner','manager','super_admin')
    and a.status='active' and a.deleted_at is null
  limit 1;
  if v_member is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if p_action='revoke' then
    update public.olli_shortcut_briefing_tokens
      set revoked_at=now()
      where academy_id=p_academy_id and member_id=v_member and revoked_at is null;
    return jsonb_build_object('ok',true,'revoked',true);
  end if;
  if p_action<>'issue' or coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_ACTION_OR_HASH' using errcode='22023';
  end if;
  insert into public.olli_shortcut_briefing_tokens
    (academy_id,member_id,token_hash,issued_at,expires_at,revoked_at)
  values (p_academy_id,v_member,p_token_hash,now(),now()+interval '365 days',null)
  on conflict (academy_id,member_id) do update set
    token_hash=excluded.token_hash,issued_at=now(),
    expires_at=excluded.expires_at,revoked_at=null;
  return jsonb_build_object('ok',true,'expires_at',now()+interval '365 days');
end;
$$;
revoke all on function public.olli_shortcut_briefing_manage(text,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.olli_shortcut_briefing_manage(text,uuid,text,text)
  to anon,authenticated;

create or replace function public.olli_shortcut_briefing_read(
  p_token_hash text
) returns jsonb language plpgsql security definer set search_path to ''
as $$
declare
  v_academy uuid; v_member uuid; v_role text;
  v_day date := (now() at time zone 'Asia/Seoul')::date;
  v_consultations jsonb := '[]'::jsonb;
  v_tasks jsonb := '[]'::jsonb;
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  if coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok',false,'code','INVALID_TOKEN');
  end if;
  select t.academy_id,t.member_id,m.role into v_academy,v_member,v_role
  from public.olli_shortcut_briefing_tokens t
  join public.academy_members m on m.id=t.member_id and m.academy_id=t.academy_id
  join public.academies a on a.id=t.academy_id
  where t.token_hash=p_token_hash and t.revoked_at is null and t.expires_at>now()
    and m.status='active' and m.role in ('owner','manager','super_admin')
    and a.status='active' and a.deleted_at is null
  limit 1;
  if v_member is null then return jsonb_build_object('ok',false,'code','TOKEN_EXPIRED_OR_REVOKED'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'time',to_char(x.start_at at time zone 'Asia/Seoul','HH24:MI'),
      'kind',case when x.intake_id is not null then '신규 상담' else '재원생 상담' end
    ) order by x.start_at),'[]'::jsonb)
  into v_consultations
  from (
    select r.start_at,r.intake_id
    from public.olli_booking_reservations r
    where r.academy_id=v_academy and r.status='confirmed'
      and (r.start_at at time zone 'Asia/Seoul')::date=v_day
    order by r.start_at limit 30
  ) x;

  select coalesce(jsonb_agg(t.text order by t.created_at),'[]'::jsonb)
    into v_tasks
  from (
    select left(a.text,100) as text,a.created_at
    from public.olli_academy_tasks a
    where a.academy_id=v_academy and a.completed=false and a.deleted_at is null
      and (a.assigned_to_member_id=v_member or a.assigned_to_member_id is null)
      and (coalesce(a.owner_only,false)=false or v_role in ('owner','super_admin'))
    order by a.created_at limit 5
  ) t;

  return jsonb_build_object('ok',true,'date',v_day,
    'consultations',v_consultations,'tasks',v_tasks);
end;
$$;
revoke all on function public.olli_shortcut_briefing_read(text)
  from public,anon,authenticated;
grant execute on function public.olli_shortcut_briefing_read(text)
  to service_role;
