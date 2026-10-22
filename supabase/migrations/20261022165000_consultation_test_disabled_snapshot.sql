-- Allow explicitly scoped owner-authorized test requests to inspect a disabled academy.
-- Unscoped cron reads still exclude disabled academies without pending deliveries.
create or replace function public.olli_consultation_messages_snapshot(p_academy_id uuid default null)
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
  and (cfg.enabled or p_academy_id is not null or exists(select 1 from public.olli_consultation_message_deliveries d where d.academy_id=a.id and d.status='submitted' and d.created_at>now()-interval '30 days'));
$$;
