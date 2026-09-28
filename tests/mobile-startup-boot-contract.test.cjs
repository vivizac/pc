'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MOBILE = path.join(ROOT, 'apps', 'mobile');
const COMMON = path.join(ROOT, 'packages', 'common');

test('Mobile startup does not call the removed memo autosave binding hook', () => {
  const startup = fs.readFileSync(path.join(MOBILE, 'olli-app-startup.js'), 'utf8');
  assert.equal(startup.includes('setupMemoPauseAutoSaveBindings'), false);
  assert.match(startup, /document\.addEventListener\('DOMContentLoaded',\s*async\s*\(\)\s*=>\s*\{/);
  assert.match(startup, /showOlliBootScreen\(\);/);
  assert.match(startup, /const bootDismissPromise = hideOlliBootScreen\(\);/);
});

test('Mobile startup does not block first paint on legacy device account-session conversion', () => {
  const startup = fs.readFileSync(path.join(MOBILE, 'olli-app-startup.js'), 'utf8');
  assert.match(startup, /function startOlliLegacyAccountSessionBootstrapInBackground\(/);
  assert.equal(/await\s+bootstrapOlliPhoneAccountSession\s*\(/.test(startup), false);
  assert.match(startup, /Promise\.resolve\(\)\s*\.then\(\(\)\s*=>\s*bootstrapOlliPhoneAccountSession\(\)\)/);
  assert.match(startup, /startOlliLegacyAccountSessionBootstrapInBackground\(initialAcademyId\);/);
});

test('Mobile boot dismissal starts before any resume or start-page route await', () => {
  const startup = fs.readFileSync(path.join(MOBILE, 'olli-app-startup.js'), 'utf8');
  const domStart = startup.indexOf("document.addEventListener('DOMContentLoaded', async () => {");
  assert.ok(domStart >= 0);
  const startupRoute = startup.slice(domStart);
  const dismissIndex = startupRoute.indexOf('const bootDismissPromise = hideOlliBootScreen();');
  const resumeIndex = startupRoute.indexOf('await restoreOlliPhoneResumeState();');
  const enterIndex = startupRoute.indexOf('await enterOlliAfterLoginOrSetup({ localFirst: true });');
  assert.ok(dismissIndex >= 0);
  assert.ok(resumeIndex > dismissIndex);
  assert.ok(enterIndex > dismissIndex);
  assert.equal((startupRoute.match(/await hideOlliBootScreen\(\);/g) || []).length, 0);
  assert.equal((startupRoute.match(/await bootDismissPromise;/g) || []).length, 2);
});

test('Mobile startup and auth entry assets are cache-busted and no-store', () => {
  const indexHtml = fs.readFileSync(path.join(MOBILE, 'index.html'), 'utf8');
  const vercelConfig = fs.readFileSync(path.join(MOBILE, 'vercel.json'), 'utf8');
  assert.match(indexHtml, /olli-app-startup\.js\?v=20260929-boot-session-cache-1/);
  assert.match(indexHtml, /olli-auth-entry-phone-adapter\.js\?v=20260929-boot-session-cache-1/);
  assert.match(vercelConfig, /"source": "\/olli-app-startup\.js"[\s\S]*?"Cache-Control"[\s\S]*?"no-store, max-age=0"/);
  assert.match(vercelConfig, /"source": "\/olli-auth-entry-phone-adapter\.js"[\s\S]*?"Cache-Control"[\s\S]*?"no-store, max-age=0"/);
});

test('Phone autosave adapter owns memo input lifecycle directly', () => {
  const adapter = fs.readFileSync(path.join(MOBILE, 'olli-observation-autosave-phone-adapter.js'), 'utf8');
  assert.match(adapter, /__olliObservationMemoPhoneAutosaveLifecycleBound/);
  assert.match(adapter, /document\.addEventListener\('input'/);
  assert.match(adapter, /document\.addEventListener\('compositionend'/);
  assert.match(adapter, /document\.addEventListener\('blur'/);
  assert.match(adapter, /handleMemoPauseAutoSaveInput/);
  assert.match(adapter, /handleMemoPauseAutoSaveBlur/);
});

test('Common observation memo core still owns flushMemoAutoSave', () => {
  const common = fs.readFileSync(path.join(COMMON, 'observation-memo-common.js'), 'utf8');
  assert.match(common, /function flushMemoAutoSave\(\)/);
});


test('local-first start-page routing settles page ownership before background record refresh', () => {
  const adapter = fs.readFileSync(path.join(MOBILE, 'olli-auth-entry-phone-adapter.js'), 'utf8');
  const startup = fs.readFileSync(path.join(MOBILE, 'olli-app-startup.js'), 'utf8');

  assert.match(adapter, /'observationRosterScreen'/);
  assert.match(adapter, /'kinderChatFeedbackScreen'/);
  assert.match(adapter, /'recordRoomScreen'/);
  assert.match(adapter, /'olliTalkBetaScreen'/);
  assert.match(adapter, /'olliTalkArchiveScreen'/);
  assert.match(adapter, /setObservationPersistentNavVisible\(false\)/);
  assert.match(adapter, /setKinderChatFeedbackPersistentTopVisible\(false\)/);

  const observationRoute = adapter.slice(
    adapter.indexOf("if (normalized === 'observation_note')"),
    adapter.indexOf("if (normalized === 'kinder_attendance')")
  );
  assert.match(observationRoute, /if \(localFirst\)[\s\S]*?const recordOpen = showRecordRoom\(\{ localOnly: true \}\);[\s\S]*?openObservationNoteFromRecord\(\);[\s\S]*?return true;/);
  assert.doesNotMatch(observationRoute, /if \(localFirst\)[\s\S]*?await showRecordRoom/);

  const recordResume = startup.slice(
    startup.indexOf("case 'recordRoomScreen':"),
    startup.indexOf('return false;', startup.indexOf("case 'recordRoomScreen':")) + 'return false;'.length
  );
  assert.match(recordResume, /const recordOpen = showRecordRoom\(\{ localOnly: true \}\);/);
  assert.doesNotMatch(recordResume, /await showRecordRoom\(\{ localOnly: true \}\)/);
});
