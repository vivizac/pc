-- Align password-login academy context with session restore context.

create or replace function public.olli_account_login(
  p_login_id text,
  p_password text,
  p_device_id text default null::text,
  p_device_name text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_login_id text := btrim(coalesce(p_login_id, ''));
  v_password text := coalesce(p_password, '');
  v_device_id text := nullif(btrim(coalesce(p_device_id, '')), '');
  v_credential record;
  v_raw_token text;
  v_token_hash text;
  v_academies jsonb;
begin
  if v_login_id = '' then
    raise exception '로그인 ID를 입력해 주세요.';
  end if;
  if v_password = '' then
    raise exception '비밀번호를 입력해 주세요.';
  end if;

  select
    c.id as credential_id,
    c.account_id,
    c.password_hash,
    a.display_name,
    a.status as account_status
  into v_credential
  from public.olli_account_credentials c
  join public.olli_accounts a on a.id = c.account_id
  where upper(btrim(c.login_id)) = upper(v_login_id)
    and c.status = 'active'
    and a.status = 'active'
  limit 1;

  if not found
     or v_credential.password_hash is null
     or v_credential.password_hash <> extensions.crypt(v_password, v_credential.password_hash) then
    raise exception '로그인 ID 또는 비밀번호가 맞지 않습니다.';
  end if;

  if v_device_id is null then
    v_device_id := 'web-' || gen_random_uuid()::text;
  end if;

  v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := encode(extensions.digest(v_raw_token, 'sha256'), 'hex');

  insert into public.olli_account_sessions (
    account_id,
    device_id,
    device_name,
    token_hash,
    expires_at,
    revoked_at,
    last_seen_at
  ) values (
    v_credential.account_id,
    v_device_id,
    nullif(btrim(coalesce(p_device_name, '')), ''),
    v_token_hash,
    now() + interval '30 days',
    null,
    now()
  )
  on conflict (account_id, device_id)
  do update set
    device_name = excluded.device_name,
    token_hash = excluded.token_hash,
    expires_at = excluded.expires_at,
    revoked_at = null,
    last_seen_at = now(),
    updated_at = now();

  update public.olli_accounts
  set last_login_at = now(), updated_at = now()
  where id = v_credential.account_id;

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
  join public.academies a on a.id = m.academy_id
  where m.account_id = v_credential.account_id
    and m.status = 'active'
    and a.status = 'active'
    and a.deleted_at is null;

  return jsonb_build_object(
    'account_id', v_credential.account_id,
    'account_name', v_credential.display_name,
    'session_token', v_raw_token,
    'device_id', v_device_id,
    'academies', v_academies
  );
end;
$$;

revoke all on function public.olli_account_login(text, text, text, text) from public;
grant execute on function public.olli_account_login(text, text, text, text) to anon, authenticated;
