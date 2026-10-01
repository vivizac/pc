const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const startup = fs.readFileSync(path.join(root, 'olli-app-startup.js'), 'utf8');
const authEntry = fs.readFileSync(path.join(root, 'olli-auth-entry-phone-adapter.js'), 'utf8');
const startPageStorage = fs.readFileSync(path.join(root, 'olli-start-page-storage-phone.js'), 'utf8');
const recordNavigation = fs.readFileSync(path.join(root, 'olli-record-room-navigation.js'), 'utf8');
const observationRuntime = fs.readFileSync(path.join(root, 'olli-observation-runtime.js'), 'utf8');
const talk = fs.readFileSync(path.join(root, 'olli-talk-beta.js'), 'utf8');
const attendance = fs.readFileSync(path.join(root, 'olli-data-attendance-feedback.js'), 'utf8');
const storage = fs.readFileSync(path.join(root, 'olli-storage-core.js'), 'utf8');

test('shared storage loader remains local-first with background server refresh', () => {
  assert.match(storage, /function load\(feature, input\)[\s\S]*?localData[\s\S]*?refreshPromise/);
  assert.match(storage, /return \{ feature: spec\.feature, localData, localEnvelope: cloneValue\(localEnvelope\), refreshPromise \};/);
});

test('phone reconnect prepares the saved local start page before remote validation', () => {
  const localEntry = startup.indexOf("enterOlliAfterLoginOrSetup({ localFirst: true })");
  const remoteValidation = startup.indexOf('void startOlliReconnectValidationInBackground(initialAcademyId)');
  assert.ok(localEntry >= 0, 'startup must enter the saved local page');
  assert.ok(remoteValidation > localEntry, 'remote validation must start after the local route is prepared');
  assert.match(startup, /startOlliReconnectValidationInBackground[\s\S]*?restoreOlliAccountSession[\s\S]*?refreshRecordAcademyManagementFromServer[\s\S]*?startOlliStudentServerRefreshLocalFirst\(\)/);
  assert.doesNotMatch(startup, /migrateStudentStorageIfNeeded\(\);[\s\S]{0,300}startOlliStudentServerRefreshLocalFirst\(\);/);
});

test('local-first start-page entry skips network session validation only for reconnect paint', () => {
  assert.match(authEntry, /async function enterOlliByStartPage\(page, options = \{\}\)/);
  assert.match(authEntry, /const localFirst = options\?\.localFirst === true;[\s\S]*?if \(localFirst\)[\s\S]*?hasOlliPhoneWritableAccountSession\(\)[\s\S]*?else if \(!\(await requireOlliPhoneWritableAccountSession\(\)\)\)/);
  assert.match(authEntry, /async function enterOlliAfterLoginOrSetup\(options = \{\}\)/);
  assert.match(authEntry, /return enterOlliByStartPage\(page, \{ localFirst \}\)/);
});

test('record room has a render-only path that cannot await student server refresh', () => {
  assert.match(recordNavigation, /async function loadRecords\(name, options = \{\}\)/);
  assert.match(recordNavigation, /hydrateRecordAttendanceLocalSnapshot\(\{ render: false \}\);\s*renderElementaryRecords\(name\);\s*if \(localOnly\) return true;/);
  assert.match(recordNavigation, /hydrateRecordAttendanceLocalSnapshot\(\{ render: false \}\);\s*renderKinderRecords\(name\);\s*if \(localOnly\) return true;/);
  assert.match(recordNavigation, /const beforeStudentSignature = getRecordAttendanceStudentSignature\('elementary'\);\s*await loadStudentsFromSupabase\(\);/);
  assert.match(recordNavigation, /const beforeStudentSignature = getRecordAttendanceStudentSignature\('kinder'\);\s*await loadStudentsFromSupabase\(\);/);
  assert.match(recordNavigation, /renderRecordAcademyManagementDashboard\(\);[\s\S]*?if \(localOnly\) return true;[\s\S]*?refreshRecordAcademyManagementFromServer/);
  assert.match(observationRuntime, /async function showRecordRoom\(options = \{\}\)[\s\S]*?loadRecords\('', \{ localOnly \}\)/);
});

test('record room normal open path forwards localOnly to the list loader', () => {
  const start = observationRuntime.indexOf('async function showRecordRoom(options = {})');
  const end = observationRuntime.indexOf('function hideRecordRoom()', start);
  const body = observationRuntime.slice(start, end);
  const finishStart = body.indexOf('const finishRecordOpen = async () => {');
  const finishBody = body.slice(finishStart, body.indexOf('  };', finishStart) + 4);

  assert.ok(finishStart >= 0, 'finishRecordOpen must exist');
  assert.match(finishBody, /await loadRecords\('', \{ localOnly \}\);/);
  assert.doesNotMatch(finishBody, /await loadRecords\(''\);/);
});

test('start-page storage no longer overrides the app entry controller', () => {
  assert.doesNotMatch(startPageStorage, /window\.enterOlliAfterLoginOrSetup\s*=/);
  assert.match(startPageStorage, /앱 진입 흐름은 olli-auth-entry-phone-adapter\.js의 enterOlliAfterLoginOrSetup 하나만 사용합니다/);
});

test('Olli Talk renders the single local cache before the Work screen is exposed', () => {
  const openStart = talk.indexOf('async function openOlliTalkBetaPage');
  const openEnd = talk.indexOf('async function closeOlliTalkBetaPage', openStart);
  const body = talk.slice(openStart, openEnd);
  const readLocal = body.indexOf('const openCachedPayload = readOlliTalkMessageCache(openContext)');
  const renderLocal = body.indexOf('renderOlliTalkServerMessages(openCachedPayload', readLocal);
  const showScreen = body.indexOf("screen.style.display = 'flex'", renderLocal);
  const serverRefresh = body.indexOf('loadOlliTalkBetaMessages({', showScreen);

  assert.ok(readLocal >= 0);
  assert.ok(renderLocal > readLocal);
  assert.ok(showScreen > renderLocal);
  assert.ok(serverRefresh > showScreen);
  assert.match(talk, /writeOlliTalkMessageCache\(context,mergedPayload\)/);
});

test('student feedback sheet renders local cache before Supabase refresh', () => {
  assert.match(attendance, /readAttendanceFeedbackLocalFirstCache\(student\)/);
  assert.match(attendance, /if \(cached\) \{[\s\S]*?renderAttendanceStudentFeedbackSheet\(student, cached\)/);
  assert.match(attendance, /writeAttendanceFeedbackLocalFirstCache\(student, data\)/);
});
