-- SMS reminders no longer depend on a deleted consultation-completed state.
-- Provider approvals, snapshots, revision checks and delivery deduplication stay intact.
CREATE OR REPLACE FUNCTION public.olli_consultation_messages_reserve(p_academy_id uuid, p_student_id uuid, p_due_month text, p_task_keys jsonb, p_config_revision bigint, p_contact_revision bigint, p_student_updated_at timestamp with time zone, p_rules jsonb, p_progress jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
  -- Lock only the new settings/contact rows. Existing sync tables are never written.
  perform 1 from public.olli_consultation_message_settings where academy_id=p_academy_id and enabled and revision=p_config_revision and template_confirmed and start_month<=p_due_month for share;
  if not found then return null; end if;
  perform 1 from public.olli_consultation_message_contacts where academy_id=p_academy_id and student_id=p_student_id and enabled and confirmed and revision=p_contact_revision for share;
  if not found then return null; end if;
  if not exists(select 1 from public.students s where s.id=p_student_id and s.academy_id=p_academy_id and coalesce(s.status,'active')='active'
      and not coalesce(s.is_deleted,false) and s.deleted_at is null and s.updated_at is not distinct from p_student_updated_at) then return null; end if;
  if exists(select 1 from public.academies where id=p_academy_id and (status<>'active' or deleted_at is not null)) then return null; end if;
  if exists(select 1 from public.academy_settings where academy_id=p_academy_id and (consultation_rules is distinct from p_rules or consultation_progress is distinct from p_progress)) then return null; end if;
  if jsonb_typeof(p_task_keys)<>'array' or jsonb_array_length(p_task_keys)=0 then return null; end if;
  -- Consultation completion is retired. Dispatch depends only on due_month and
  -- durable (academy,student,due_month) delivery deduplication.
  insert into public.olli_consultation_message_deliveries(academy_id,student_id,due_month,task_keys)
  values(p_academy_id,p_student_id,p_due_month,p_task_keys) on conflict(academy_id,student_id,due_month) do nothing returning id into v_id;
  return v_id;
end;
$function$
;
