const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const core=fs.readFileSync(path.join(root,'olli-settings-common-core.js'),'utf8');
const account=fs.readFileSync(path.join(root,'olli-settings-account-runtime.js'),'utf8');
const pcui=fs.readFileSync(path.join(root,'olli-settings-pc-ui.js'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260928073800_secure_academy_settings_access.sql'),'utf8');

test('settings academy read is protected RPC only',()=>{
  assert.match(core,/olli_academy_settings_get/);
  assert.match(core,/loadOlliAcademySettingsSecure/);
  assert.doesNotMatch(core,/supabase\('GET', `academies\?/);
});

test('academy profile and manager permission writes use protected RPC',()=>{
  assert.match(account,/saveOlliAcademySettingsSecure/);
  assert.doesNotMatch(account,/supabase\('PATCH',`academies/);
  assert.match(pcui,/saveOlliAcademySettingsSecure/);
  assert.doesNotMatch(pcui,/supabase\('PATCH',[^\n]*academies/);
});

test('settings RPC migration validates session membership and field whitelist',()=>{
  assert.match(migration,/olli_account_id_from_session/);
  assert.match(migration,/academy_members/);
  assert.match(migration,/SETTING_FIELD_NOT_ALLOWED/);
  assert.match(migration,/MANAGER_PERMISSION_UPDATE_DENIED/);
  assert.match(migration,/revoke all on function public\.olli_academy_settings_get\(text,uuid\) from public/);
  assert.match(migration,/revoke all on function public\.olli_academy_settings_update\(text,uuid,jsonb\) from public/);
});
