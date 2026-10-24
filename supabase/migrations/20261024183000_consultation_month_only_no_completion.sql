-- Monthly consultation appointments have no completion or carryover state.
-- Preserve general academy todos and consultation summary records.
-- Old progress RPC signature remains for API compatibility, but completed writes are rejected.
CREATE OR REPLACE FUNCTION public.olli_consultation_progress_access(p_session_token text, p_academy_id uuid, p_action text DEFAULT 'read'::text, p_task_keys text[] DEFAULT NULL::text[], p_completed boolean DEFAULT NULL::boolean, p_todos jsonb DEFAULT NULL::jsonb, p_rules jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account uuid; v_role text; v_progress jsonb;
  v_rule text; v_division text;
begin
  if p_academy_id is null then return jsonb_build_object('ok',false,'code','ACADEMY_REQUIRED'); end if;
  v_account := public.olli_account_id_from_session(p_session_token);
  if v_account is null then return jsonb_build_object('ok',false,'code','SESSION_INVALID'); end if;
  select m.role into v_role
  from public.academy_members m join public.academies a on a.id=m.academy_id
  where m.account_id=v_account and m.academy_id=p_academy_id
    and m.status='active' and a.status='active' and a.deleted_at is null
    and m.role in ('owner','manager','teacher','super_admin')
  limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'code','PERMISSION_DENIED'); end if;
  if p_action not in ('read','set_todos','read_rules','set_rules') then
    return jsonb_build_object('ok',false,'code','ACTION_INVALID');
  end if;
  if p_action not in ('read','read_rules') and v_role not in ('owner','manager','super_admin') then
    return jsonb_build_object('ok',false,'code','WRITE_DENIED');
  end if;

  -- A single locked academy todo list; old consultation completion is unsupported.
  select coalesce(a.consultation_progress,'{}'::jsonb) into v_progress
  from public.academy_settings a where a.academy_id=p_academy_id for update;
  if not found then return jsonb_build_object('ok',false,'code','SETTINGS_NOT_FOUND'); end if;
  if jsonb_typeof(v_progress) <> 'object' then v_progress := '{}'::jsonb; end if;
  if p_action='read' then
    return jsonb_build_object('ok',true,'progress',jsonb_build_object(
      'version',1,'todos',coalesce(v_progress->'todos','[]'::jsonb)));
  end if;
  if p_action='read_rules' then
    return jsonb_build_object('ok',true,'rules',
      coalesce((select consultation_rules from public.academy_settings where academy_id=p_academy_id),'{}'::jsonb));
  end if;
  if p_action='set_rules' then
    if jsonb_typeof(p_rules)<>'object' then return jsonb_build_object('ok',false,'code','RULES_INVALID'); end if;
    for v_division in select jsonb_object_keys(p_rules) loop
      if v_division not in ('elementary','kinder') or jsonb_typeof(p_rules->v_division)<>'array' then
        return jsonb_build_object('ok',false,'code','DIVISION_RULES_INVALID');
      end if;
      for v_rule in select jsonb_array_elements_text(p_rules->v_division) loop
        if v_rule not in ('after_1','after_3','every_6','every_12') then
          return jsonb_build_object('ok',false,'code','RULE_INVALID');
        end if;
      end loop;
    end loop;
    update public.academy_settings set consultation_rules=p_rules,updated_at=now() where academy_id=p_academy_id;
    return jsonb_build_object('ok',true,'rules',p_rules);
  end if;

  if p_action='set_todos' then
    if jsonb_typeof(p_todos) <> 'array' or jsonb_array_length(p_todos)>100 then
      return jsonb_build_object('ok',false,'code','TODOS_INVALID');
    end if;
    v_progress := jsonb_set(v_progress,'{todos}',p_todos,true);
  end if;
  -- Old consultation-completion keys never leave this RPC or get re-saved.
  v_progress := jsonb_build_object('version',1,'todos',coalesce(v_progress->'todos','[]'::jsonb));
  update public.academy_settings a
  set consultation_progress=v_progress,updated_at=now() where a.academy_id=p_academy_id;
  return jsonb_build_object('ok',true,'progress',v_progress);
end;
$function$
;
-- Remove obsolete completion state from stored progress without touching unrelated academy todos.
update public.academy_settings
set consultation_progress=(coalesce(consultation_progress,'{}'::jsonb)
                            - 'completed' - 'tracking_started_month'),
    updated_at=now()
where consultation_progress ? 'completed' or consultation_progress ? 'tracking_started_month';
