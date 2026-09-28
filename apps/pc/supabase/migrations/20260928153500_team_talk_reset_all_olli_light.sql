-- One-time reset requested for Team Chat background on both platforms.
-- All currently saved PC/phone backgrounds become Olli style 1.
-- Users can change either platform again afterwards through the normal update RPC.

update public.academy_settings
set
  team_talk_background_pc = 'olli-light',
  team_talk_background_phone = 'olli-light',
  updated_at = now()
where team_talk_background_pc is distinct from 'olli-light'
   or team_talk_background_phone is distinct from 'olli-light';
