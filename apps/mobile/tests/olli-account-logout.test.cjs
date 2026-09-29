const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runtime = fs.readFileSync(path.join(__dirname, '..', 'olli-settings-account-runtime.js'), 'utf8');
const phoneUi = fs.readFileSync(path.join(__dirname, '..', 'olli-settings-phone-ui.js'), 'utf8');

test('account logout clears local authority even if secondary cleanup fails', () => {
  const clearStart = runtime.indexOf('function clearOlliAccountLogoutLocalState()');
  const logoutStart = runtime.indexOf('async function doOlliAccountLogout()');
  assert.ok(clearStart >= 0 && logoutStart > clearStart);
  const clearBlock = runtime.slice(clearStart, logoutStart);
  const tokenClear = clearBlock.indexOf("'olli_account_session_token_v1'");
  const academyCleanup = clearBlock.indexOf("window.OlliStorageCore?.AcademyContext");
  assert.ok(tokenClear >= 0);
  assert.ok(academyCleanup > tokenClear);
  assert.match(clearBlock, /try\{[\s\S]*?AcademyContext\.clearRuntime\('account_logout'\)[\s\S]*?\}catch\(err\)/);
});

test('account logout does not wait for Supabase session revoke before local logout', () => {
  const logoutStart = runtime.indexOf('async function doOlliAccountLogout()');
  const exportStart = runtime.indexOf('window.clearOlliAccountLogoutLocalState', logoutStart);
  const logoutBlock = runtime.slice(logoutStart, exportStart);
  assert.doesNotMatch(logoutBlock, /await\s+revokeOlliAccountSessionBestEffort/);
  assert.match(logoutBlock, /revokePromise=Promise\.resolve\(revokeOlliAccountSessionBestEffort\(\)\)/);
  assert.match(logoutBlock, /const cleared=clearOlliAccountLogoutLocalState\(\);[\s\S]*?routeOlliAccountLogoutToLogin\(\);/);
});

test('logout cleanup is exported for account soft-delete and login routing has reload fallback', () => {
  assert.match(runtime, /window\.clearOlliAccountLogoutLocalState=clearOlliAccountLogoutLocalState/);
  assert.match(runtime, /if\(typeof showOlliLoginEntry==='function'\)\{[\s\S]*?showOlliLoginEntry\(\)/);
  assert.match(runtime, /window\.location\.reload\(\)/);
});


test('phone settings owns the logout sheet while account runtime only owns logout execution', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /class="settingsRow" onclick="openPhoneSettingsSheet\('logout'\)" role="button">[\s\S]*계정 로그아웃/);
  assert.match(phoneUi, /logout:\{title:'계정 로그아웃'[\s\S]*html:renderPhoneLogoutSheet,ownActions:true\}/);
  assert.match(phoneUi, /data-account-logout-btn[^>]*onclick="doOlliAccountLogout\(\)"/);
  assert.doesNotMatch(runtime, /openOlliAccountLogoutSheet/);
  assert.doesNotMatch(runtime, /settingsSheetData\.logout/);
  assert.match(runtime, /'olli_team_chat_last_cache_context_v1'/);
});
