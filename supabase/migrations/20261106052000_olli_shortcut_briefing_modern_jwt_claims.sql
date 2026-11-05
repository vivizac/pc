-- PostgREST v14+ stores JWT claims in request.jwt.claims JSON.
-- Keep existing service_role check and scoped per-member key validation.
-- No changes to reservation, task, or synchronization data.
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
  if coalesce(
    nullif(current_setting('request.jwt.claim.role',true),''),
    nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'role'
  ) is distinct from 'service_role' then
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
