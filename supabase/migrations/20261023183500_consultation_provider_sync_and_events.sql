alter table public.olli_consultation_channel_templates
 add column if not exists provider_status text,
 add column if not exists provider_checked_at timestamptz,
 add column if not exists provider_content_matches boolean,
 add column if not exists provider_error_code text;
create table if not exists public.olli_consultation_template_sync_events (
 id bigint generated always as identity primary key,
 channel_id uuid not null references public.olli_consultation_channels(id),
 template_id text not null,
 checked_at timestamptz not null default now(),
 previous_state text,
 new_state text,
 provider_status text,
 content_matches boolean,
 event_type text not null check(event_type in('provider_sync','provider_error','manual_request')),
 error_code text
);
create index if not exists olli_consultation_template_sync_events_template_idx on public.olli_consultation_template_sync_events(channel_id,template_id,checked_at desc);
alter table public.olli_consultation_template_sync_events enable row level security;
revoke all on public.olli_consultation_template_sync_events from public,anon,authenticated;
create or replace function public.olli_consultation_template_sync_snapshot()
returns table(channel_id uuid,pf_id text,template_id text,template_body text,approval_state text)
language sql security definer set search_path='' as $$
 select t.channel_id,c.pf_id,t.template_id,t.template_body,t.approval_state
 from public.olli_consultation_channel_templates t join public.olli_consultation_channels c on c.id=t.channel_id
 where c.approval_state='approved' and t.approval_state<>'disabled' order by c.id,t.template_id limit 1000;
$$;
revoke all on function public.olli_consultation_template_sync_snapshot() from public,anon,authenticated;
grant execute on function public.olli_consultation_template_sync_snapshot() to service_role;
create or replace function public.olli_consultation_template_sync_apply(p_channel_id uuid,p_template_id text,p_provider_status text,p_content_matches boolean,p_error_code text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old_row public.olli_consultation_channel_templates%rowtype; new_state text;
begin
 select * into old_row from public.olli_consultation_channel_templates where channel_id=p_channel_id and template_id=p_template_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','missing'); end if;
 if p_error_code is not null then
  update public.olli_consultation_channel_templates set provider_checked_at=now(),provider_error_code=left(p_error_code,100) where channel_id=p_channel_id and template_id=p_template_id;
  insert into public.olli_consultation_template_sync_events(channel_id,template_id,previous_state,new_state,event_type,error_code)
  values(p_channel_id,p_template_id,old_row.approval_state,old_row.approval_state,'provider_error',left(p_error_code,100));
  return jsonb_build_object('ok',true,'state',old_row.approval_state,'error',true);
 end if;
 if p_provider_status not in ('PENDING','INSPECTING','APPROVED','REJECTED') then raise exception 'Invalid provider status'; end if;
 new_state:=case when old_row.approval_state='disabled' then 'disabled'
  when p_provider_status='APPROVED' and p_content_matches is true then 'approved'
  when p_provider_status='REJECTED' then 'rejected' else 'pending' end;
 update public.olli_consultation_channel_templates set approval_state=new_state,
 provider_status=p_provider_status,provider_checked_at=now(),provider_content_matches=p_content_matches,provider_error_code=null
 where channel_id=p_channel_id and template_id=p_template_id;
 if old_row.approval_state is distinct from new_state or old_row.provider_status is distinct from p_provider_status or old_row.provider_content_matches is distinct from p_content_matches then
  insert into public.olli_consultation_template_sync_events(channel_id,template_id,previous_state,new_state,provider_status,content_matches,event_type)
  values(p_channel_id,p_template_id,old_row.approval_state,new_state,p_provider_status,p_content_matches,'provider_sync');
 end if;
 return jsonb_build_object('ok',true,'state',new_state);
end $$;
revoke all on function public.olli_consultation_template_sync_apply(uuid,text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.olli_consultation_template_sync_apply(uuid,text,text,boolean,text) to service_role;