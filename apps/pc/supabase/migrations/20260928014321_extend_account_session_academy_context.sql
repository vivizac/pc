-- Extend authoritative account-session academy context.
-- Existing callers remain compatible; only additional academy fields are returned.

create or replace function public.olli_get_my_academies(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_account_name text;
  v_academies jsonb;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);

  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;

  update public.olli_account_sessions
  set
    last_seen_at = now(),
    expires_at = now() + interval '30 days',
    updated_at = now()
  where account_id = v_account_id
    and token_hash = encode(extensions.digest(coalesce(p_session_token, ''), 'sha256'), 'hex')
    and revoked_at is null
    and expires_at > now();

  select a.display_name
  into v_account_name
  from public.olli_accounts a
  where a.id = v_account_id
    and a.status = 'active';

  if v_account_name is null then
    raise exception '활성 계정을 찾지 못했습니다.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'academy_id', a.id,
        'academy_code', a.academy_code,
        'academy_name', a.academy_name,
        'region', a.region,
        'academy_status', a.status,
        'member_id', m.id,
        'owner_member_id', a.owner_member_id,
        'member_name', m.display_name,
        'role', m.role,
        'membership_status', m.status,
        'plan_type', a.plan_type,
        'access_status',
          case
            when a.plan_type = 'trial'
             and a.access_status = 'active'
             and a.trial_expires_at is not null
             and a.trial_expires_at < current_date
            then 'expired'
            else a.access_status
          end,
        'trial_started_at', a.trial_started_at,
        'trial_expires_at', a.trial_expires_at
      )
      order by a.created_at, a.academy_name
    ),
    '[]'::jsonb
  )
  into v_academies
  from public.academy_members m
  join public.academies a
    on a.id = m.academy_id
  where m.account_id = v_account_id
    and m.status = 'active'
    and a.status = 'active'
    and a.deleted_at is null;

  return jsonb_build_object(
    'account_id', v_account_id,
    'account_name', v_account_name,
    'academies', v_academies
  );
end;
$$;

revoke all on function public.olli_get_my_academies(text) from public;
grant execute on function public.olli_get_my_academies(text) to anon, authenticated;
