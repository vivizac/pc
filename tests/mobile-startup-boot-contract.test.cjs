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
  const vercelConfig = JSON.parse(fs.readFileSync(path.join(MOBILE, 'vercel.json'), 'utf8'));
  assert.match(indexHtml, /olli-app-startup\.js\?v=20260929-push-notification-fix-1/);
  assert.match(indexHtml, /olli-auth-entry-phone-adapter\.js\?v=20260929-local-route-owner-1/);
  const findHeader = source => (vercelConfig.headers || []).find(item => item.source === source);
  const hasNoStore = source => (findHeader(source)?.headers || []).some(item => item.key === 'Cache-Control' && item.value === 'no-store, max-age=0');
  assert.equal(hasNoStore('/olli-app-startup.js'), true);
  assert.equal(hasNoStore('/olli-auth-entry-phone-adapter.js'), true);
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
  const localFirstStart = observationRoute.indexOf('if (localFirst)');
  const localFirstEnd = observationRoute.indexOf('return true;', localFirstStart);
  const localFirstBlock = observationRoute.slice(localFirstStart, localFirstEnd + 'return true;'.length);
  assert.doesNotMatch(localFirstBlock, /await showRecordRoom/);

  const recordResume = startup.slice(
    startup.indexOf("case 'recordRoomScreen':"),
    startup.indexOf('return false;', startup.indexOf("case 'recordRoomScreen':")) + 'return false;'.length
  );
  assert.match(recordResume, /const recordOpen = showRecordRoom\(\{ localOnly: true \}\);/);
  assert.doesNotMatch(recordResume, /await showRecordRoom\(\{ localOnly: true \}\)/);
});


test('memo navigation opens the screen shell before optional initialization', () => {
  const runtime = fs.readFileSync(path.join(MOBILE, 'olli-observation-runtime.js'), 'utf8');
  const roster = fs.readFileSync(path.join(MOBILE, 'olli-observation-roster-phone.js'), 'utf8');
  const html = fs.readFileSync(path.join(MOBILE, 'index.html'), 'utf8');

  const openStart = runtime.indexOf('function openStudentMemoPageById(studentId)');
  const openEnd = runtime.indexOf('\n}', openStart);
  const openBlock = runtime.slice(openStart, openEnd + 2);
  assert.ok(openStart >= 0);
  assert.ok(openBlock.indexOf('openObservationMemoScreenShell(session)') >= 0);
  assert.ok(openBlock.indexOf('openObservationMemoScreenShell(session)') < openBlock.indexOf('renderObservationMemoScreenChrome(session)'));
  assert.ok(openBlock.indexOf('openObservationMemoScreenShell(session)') < openBlock.indexOf('renderObservationMemoInitialView(session)'));
  assert.match(openBlock, /return true;/);

  assert.doesNotMatch(roster, /memoScreen\.style\.visibility = 'hidden'/);
  assert.match(roster, /opened = openStudentMemoPageById\(studentId\) !== false/);
  assert.match(roster, /memoScreen\.removeAttribute\('aria-hidden'\)/);
  assert.match(roster, /memoScreen\.removeAttribute\('inert'\)/);

  assert.match(html, /observation-memo-session-common\.js\?v=20260929-memo-page-owner-1/);
  assert.match(html, /olli-observation-runtime\.js\?v=20260930-attendance-runtime-cleanup-1/);
  assert.match(html, /olli-observation-roster-phone\.js\?v=20260930-note-keyboard-stability-1/);
});


test('memo utility controls are fixed markup and never dynamically mounted', () => {
  const utility = fs.readFileSync(path.join(MOBILE, 'olli-record-utility-touch.js'), 'utf8');
  const roster = fs.readFileSync(path.join(MOBILE, 'olli-observation-roster-phone.js'), 'utf8');
  const rosterCss = fs.readFileSync(path.join(MOBILE, 'olli-observation-roster-phone.css'), 'utf8');
  const baseCss = fs.readFileSync(path.join(MOBILE, 'olli-phone-base.css'), 'utf8');
  const html = fs.readFileSync(path.join(MOBILE, 'index.html'), 'utf8');

  const groupIndex = html.indexOf('id="memoEditorUtilityGroup"');
  const archiveIndex = html.indexOf('id="memoRecordsBtn"', groupIndex);
  const voiceIndex = html.indexOf('id="memoEditorVoiceBtn"', groupIndex);
  const historyIndex = html.indexOf('id="olliMemoVersionHistoryBtn"', groupIndex);
  const surveyIndex = html.indexOf('id="memoBottomAnalysisBtn"', groupIndex);

  assert.ok(groupIndex >= 0);
  assert.ok(archiveIndex > groupIndex);
  assert.ok(voiceIndex > archiveIndex);
  assert.ok(historyIndex > voiceIndex);
  assert.ok(surveyIndex > historyIndex);

  assert.match(utility, /function bindFixedEditorTools\(\)/);
  assert.match(utility, /document\.getElementById\('memoEditorUtilityGroup'\)/);
  assert.doesNotMatch(utility, /ensureGroup\(/);
  assert.doesNotMatch(utility, /ensureArchiveButton\(/);
  assert.doesNotMatch(utility, /ensureVoiceButton\(/);
  assert.doesNotMatch(utility, /ensureHistoryButton\(/);
  assert.doesNotMatch(utility, /mountObservationMemoEditorTools/);
  assert.doesNotMatch(utility, /appendChild\(btn\)/);
  assert.doesNotMatch(roster, /mountObservationMemoEditorTools/);
  assert.doesNotMatch(roster, /memoBottomBar/);
  assert.doesNotMatch(html, /memoBottomBar/);
  assert.doesNotMatch(rosterCss, /memoBottomBar/);
  assert.doesNotMatch(baseCss, /memoBottomBar/);

  assert.match(html, /olli-phone-base\.css\?v=20260929-settings-spacing-3/);
  assert.match(html, /olli-observation-roster-phone\.css\?v=20260930-note-keyboard-stability-1/);
  assert.match(html, /olli-record-utility-touch\.js\?v=20260929-memo-fixed-group-1/);
});


test('memo archive uses secure feedback reads and fixed survey visibility', () => {
  const attendanceFeedback = fs.readFileSync(path.join(MOBILE, 'olli-data-attendance-feedback.js'), 'utf8');
  const analysisAdapter = fs.readFileSync(path.join(MOBILE, 'elementary-analysis-phone-adapter.js'), 'utf8');
  const roster = fs.readFileSync(path.join(MOBILE, 'olli-observation-roster-phone.js'), 'utf8');
  const html = fs.readFileSync(path.join(MOBILE, 'index.html'), 'utf8');

  assert.match(attendanceFeedback, /window\.loadOlliFeedbackRowsSecure = loadAttendanceFeedbackRowsSecure/);
  assert.match(analysisAdapter, /const secureReader = typeof window\.loadOlliFeedbackRowsSecure === 'function'/);
  assert.match(analysisAdapter, /secureReader\('feedbacks', student, 120\)/);
  assert.match(analysisAdapter, /secureReader\('fail_feedbacks', student, 120\)/);
  assert.doesNotMatch(analysisAdapter, /feedbacks\?select=\*&student_id=/);
  assert.doesNotMatch(analysisAdapter, /fail_feedbacks\?select=\*&student_id=/);
  assert.doesNotMatch(analysisAdapter, /supabase\('GET'/);

  assert.match(roster, /analysisBtn\.hidden = false/);
  assert.match(roster, /analysisBtn\.style\.display = 'inline-flex'/);
  assert.match(roster, /analysisBtn\.style\.visibility = 'visible'/);
  assert.doesNotMatch(roster, /const showAnalysis = currentMemoType === 'elementary'/);

  assert.match(html, /olli-data-attendance-feedback\.js\?v=20260929-secure-archive-read-1/);
  assert.match(html, /elementary-analysis-phone-adapter\.js\?v=20260929-secure-archive-read-1/);
  assert.match(html, /olli-observation-roster-phone\.js\?v=20260930-note-keyboard-stability-1/);
});
