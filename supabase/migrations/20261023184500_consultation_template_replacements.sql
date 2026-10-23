create table if not exists public.olli_consultation_template_replacements(
 id bigint generated always as identity primary key,
 channel_id uuid not null references public.olli_consultation_channels(id),
 old_template_id text not null,
 new_template_id text not null,
 affected_academies int not null default 0,
 changed_at timestamptz not null default now()
);
alter table public.olli_consultation_template_replacements enable row level security;
revoke all on public.olli_consultation_template_replacements from public,anon,authenticated;
create or replace function public.olli_consultation_template_replace(p_channel_id uuid,p_old_id text,p_new_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare new_row public.olli_consultation_channel_templates%rowtype;
 old_row public.olli_consultation_channel_templates%rowtype;
 setting public.olli_consultation_message_settings%rowtype;
 variants jsonb;k text;v jsonb;changed boolean;count_academies int:=0;
begin
 if p_old_id is null or p_new_id is null or p_old_id=p_new_id then raise exception 'Template replacement IDs must be different'; end if;
 select * into old_row from public.olli_consultation_channel_templates where channel_id=p_channel_id and template_id=p_old_id for update;
 if not found then raise exception 'Old template does not exist'; end if;
 select * into new_row from public.olli_consultation_channel_templates where channel_id=p_channel_id and template_id=p_new_id for update;
 if not found then raise exception 'New template is not registered on this channel'; end if;
 if new_row.approval_state<>'approved' or new_row.provider_status<>'APPROVED' or new_row.provider_content_matches is distinct from true
    or new_row.provider_error_code is not null or new_row.provider_checked_at is null
    or new_row.provider_checked_at<now()-interval '7 days' then raise exception 'New template does not have fresh, verified Solapi approval'; end if;
 for setting in select * from public.olli_consultation_message_settings where selected_channel_id=p_channel_id for update loop
   changed:=false; variants:=coalesce(setting.template_variants,'{}'::jsonb);
   for k,v in select key,value from jsonb_each(variants) loop
     if v->>'template_id'=p_old_id then
       variants:=jsonb_set(variants,array[k],v||jsonb_build_object('template_id',p_new_id,'template_body',new_row.template_body,'template_confirmed',true),true);
       changed:=true;
     end if;
   end loop;
   if setting.template_id=p_old_id then changed:=true; end if;
   if changed then
     update public.olli_consultation_message_settings set
       template_id=case when template_id=p_old_id then p_new_id else template_id end,
       template_body=case when template_id=p_old_id then new_row.template_body else template_body end,
       template_confirmed=case when template_id=p_old_id then true else template_confirmed end,
       template_variants=variants,revision=revision+1,updated_at=now()
     where academy_id=setting.academy_id;
     count_academies:=count_academies+1;
   end if;
 end loop;
 delete from public.olli_consultation_channel_templates where channel_id=p_channel_id and template_id=p_old_id;
 insert into public.olli_consultation_template_replacements(channel_id,old_template_id,new_template_id,affected_academies)
 values(p_channel_id,p_old_id,p_new_id,count_academies);
 return jsonb_build_object('ok',true,'affected',count_academies,'old_template_id',p_old_id,'new_template_id',p_new_id);
end $$;
revoke all on function public.olli_consultation_template_replace(uuid,text,text) from public,anon,authenticated;
grant execute on function public.olli_consultation_template_replace(uuid,text,text) to service_role;