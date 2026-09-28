create index if not exists olli_team_material_requests_requested_by_idx
  on public.olli_team_material_requests (requested_by_member_id);

create index if not exists olli_team_material_requests_status_changed_by_idx
  on public.olli_team_material_requests (status_changed_by_member_id);

create index if not exists olli_team_material_requests_ordered_by_idx
  on public.olli_team_material_requests (ordered_by_member_id);

create index if not exists olli_team_material_requests_arrived_by_idx
  on public.olli_team_material_requests (arrived_by_member_id);

create index if not exists olli_team_material_request_events_academy_idx
  on public.olli_team_material_request_events (academy_id);

create index if not exists olli_team_material_request_events_member_idx
  on public.olli_team_material_request_events (member_id);
