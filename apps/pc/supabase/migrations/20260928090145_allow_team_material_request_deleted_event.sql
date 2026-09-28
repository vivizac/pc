alter table public.olli_team_material_request_events
  drop constraint if exists olli_team_material_request_events_type_check;

alter table public.olli_team_material_request_events
  add constraint olli_team_material_request_events_type_check
  check (event_type in ('created','status_changed','deleted'));
