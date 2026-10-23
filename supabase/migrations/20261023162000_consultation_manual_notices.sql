create table if not exists public.olli_consultation_manual_notices (
 academy_id uuid not null references public.academies(id) on delete cascade,
 notice_key text not null check (notice_key in ('kinder:after_1','kinder:after_3','kinder:every_6','kinder:every_12','elementary:after_1','elementary:after_3','elementary:every_6','elementary:every_12','annual:every_12')),
 body text not null check (char_length(body) between 1 and 5000),
 updated_at timestamptz not null default now(),
 primary key(academy_id,notice_key)
);
alter table public.olli_consultation_manual_notices enable row level security;
revoke all on public.olli_consultation_manual_notices from public, anon, authenticated;
create or replace function public.olli_consultation_manual_notice_manage(p_session_token text,p_academy_id uuid,p_action text default 'load',p_key text default null,p_body text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_rows jsonb;
begin
 perform olli_consultation_private.require_owner(p_session_token,p_academy_id);
 if p_action='load' then
  select coalesce(jsonb_object_agg(notice_key,body),'{}'::jsonb) into v_rows from public.olli_consultation_manual_notices where academy_id=p_academy_id;
  return jsonb_build_object('ok',true,'notices',v_rows);
 elsif p_action='save' then
  if p_key is null or p_key not in ('kinder:after_1','kinder:after_3','kinder:every_6','kinder:every_12','elementary:after_1','elementary:after_3','elementary:every_6','elementary:every_12','annual:every_12') then raise exception 'Invalid notice type'; end if;
  if p_body is null or char_length(btrim(p_body))<1 or char_length(p_body)>5000 then raise exception 'Invalid notice body'; end if;
  insert into public.olli_consultation_manual_notices(academy_id,notice_key,body) values(p_academy_id,p_key,p_body)
  on conflict(academy_id,notice_key) do update set body=excluded.body,updated_at=now();
  return jsonb_build_object('ok',true,'notice_key',p_key);
 end if;
 raise exception 'Invalid action';
end $$;
revoke all on function public.olli_consultation_manual_notice_manage(text,uuid,text,text,text) from public;
grant execute on function public.olli_consultation_manual_notice_manage(text,uuid,text,text,text) to anon,authenticated;