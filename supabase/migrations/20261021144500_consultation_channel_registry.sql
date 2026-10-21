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
