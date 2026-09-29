-- Close the final legacy browser-direct access path for academy_settings.
-- Production DB migration version: 20260929081433
-- Current runtime reads/writes academy settings through session-validated SECURITY DEFINER RPCs.

begin;

revoke all on table public.academy_settings from anon, authenticated;

alter table public.academy_settings enable row level security;

drop policy if exists academy_settings_insert_all on public.academy_settings;
drop policy if exists academy_settings_select_all on public.academy_settings;
drop policy if exists academy_settings_update_all on public.academy_settings;
drop policy if exists academy_settings_select_member on public.academy_settings;
drop policy if exists academy_settings_update_owner on public.academy_settings;

commit;
