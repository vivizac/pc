revoke all on function public.olli_team_material_push_targets(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.olli_team_material_push_targets(text, uuid, uuid) to service_role;

revoke all on function public.olli_team_material_push_mark_delivered(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.olli_team_material_push_mark_delivered(uuid, uuid, uuid, uuid) to service_role;
