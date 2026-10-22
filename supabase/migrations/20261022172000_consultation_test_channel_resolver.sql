-- Test-only channel resolver: verify exact approved academy/channel/template binding
-- without enabling scheduled or ordinary dispatch.
create or replace function public.olli_consultation_channel_resolve_test(p_academy_id uuid,p_template_id text,p_template_body text)
returns table(pf_id text,channel_revision bigint)
language sql security invoker set search_path='' as $$
 select c.pf_id,c.revision
 from public.olli_consultation_message_settings s
 join public.olli_consultation_channels c on c.id=s.selected_channel_id and c.channel_type=s.channel_mode
 join public.olli_consultation_channel_assignments a on a.channel_id=c.id and a.academy_id=s.academy_id
 join public.olli_consultation_channel_templates t on t.channel_id=c.id and t.template_id=p_template_id and t.template_body=p_template_body
 where s.academy_id=p_academy_id and not s.enabled
 and c.approval_state='approved' and a.approval_state='approved' and t.approval_state='approved'
 and (c.channel_type='headquarters' or c.owner_academy_id=p_academy_id);
$$;
revoke all on function public.olli_consultation_channel_resolve_test(uuid,text,text) from public,anon,authenticated;
grant execute on function public.olli_consultation_channel_resolve_test(uuid,text,text) to service_role;
