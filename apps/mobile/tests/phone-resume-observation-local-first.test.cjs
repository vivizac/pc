const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const startup = fs.readFileSync('olli-app-startup.js', 'utf8');
const roster = fs.readFileSync('olli-observation-roster-phone.js', 'utf8');
const picker = fs.readFileSync('olli-record-student-picker-phone-adapter.js', 'utf8');
const bootCss = fs.readFileSync('olli-boot.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('a real document start keeps the OLLI boot screen even when login persists', () => {
  assert.doesNotMatch(html, /document\.documentElement\.classList\.add\('olliSessionResume'\)/);
  assert.doesNotMatch(bootCss, /olliSessionResume/);
  assert.doesNotMatch(bootCss, /!important/);
  assert.match(startup, /function showOlliBootScreen\(\)[\s\S]*?boot\.style\.display = 'flex';[\s\S]*?boot\.classList\.remove\('hide'\)/);
  assert.doesNotMatch(startup, /function showOlliBootScreen\(\)[\s\S]{0,400}hasOlliPersistentPhoneSession\(\)/);
});

test('backgrounding saves the current phone route without reconnecting on visibility restore', () => {
  assert.match(startup, /function captureOlliPhoneResumeState\(\)/);
  assert.match(startup, /document\.addEventListener\('visibilitychange',[\s\S]*?if \(!document\.hidden\) return;[\s\S]*?captureOlliPhoneResumeState\(\)/);
  assert.doesNotMatch(startup, /visibilitychange[\s\S]{0,500}restoreOlliAccountSession/);
  assert.match(startup, /window\.addEventListener\('pagehide', captureOlliPhoneResumeState\)/);
});

test('same login session restores the last visible page before the default start page', () => {
  const resumeIndex = startup.indexOf('const resumed = await restoreOlliPhoneResumeState()');
  const defaultIndex = startup.indexOf('await enterOlliAfterLoginOrSetup({ localFirst: true })', resumeIndex);
  assert.ok(resumeIndex >= 0);
  assert.ok(defaultIndex > resumeIndex);
  assert.match(startup, /getOlliPhoneResumeSessionFingerprint/);
  assert.match(startup, /case 'studentMemoScreen'/);
  assert.match(startup, /case 'observationRosterScreen'/);
  assert.match(startup, /case 'kinderChatFeedbackScreen'/);
  assert.match(startup, /case 'olliTalkBetaScreen'/);
  assert.match(startup, /case 'olliTalkArchiveScreen'/);
  assert.match(startup, /case 'settingsPageScreen'/);
  assert.match(startup, /case 'recordRoomScreen'/);
});

test('observation roster hydrates the cached attendance week before first roster paint', () => {
  assert.match(roster, /function hydrateObservationRosterLocalScheduleSnapshot\(\)[\s\S]*?hydrateLocalAttendanceSnapshot\(new Date\(\), \{ render: false \}\)/);
  assert.match(roster, /function completeObservationMemoRosterNavigation\([\s\S]*?hydrateObservationRosterLocalScheduleSnapshot\(\);\s*showObservationRosterScreenShell\(\);/);
});

test('observation roster server refresh is background-only and rerenders only on a changed roster signature', () => {
  assert.match(roster, /function refreshObservationRosterScheduleInBackground\(\)[\s\S]*?const beforeSignature = getObservationRosterScheduleSignature\(\);[\s\S]*?syncOlliTodayAttendanceSchedule\(new Date\(\), \{ render: false, skipLocal: true \}\)/);
  assert.match(roster, /if \(getObservationRosterScheduleSignature\(\) !== beforeSignature\) renderObservationMemoRoster\(\);/);
});

test('observation feedback archive opens from local data before remote refresh resolves', () => {
  assert.match(picker, /function renderElementaryRecordsMenu\(\)[\s\S]*?const localItems = getMemoFeedbackArchiveItems\(student\);\s*renderMemoFeedbackArchiveSheet\(menu, student, localItems\);\s*refreshElementaryRecordsMenuFromServer/);
  assert.match(picker, /function openElementaryRecordsMenuForStudent[\s\S]*?renderElementaryRecordsMenu\(\);\s*requestAnimationFrame\(\(\) => menu\.classList\.add\('show'\)\)/);
  assert.doesNotMatch(picker, /await renderElementaryRecordsMenu\(\)/);
});

test('archive remote refresh skips identical DOM replacement', () => {
  assert.match(picker, /const localSignature = getMemoFeedbackArchiveItemsSignature\(localItems\)/);
  assert.match(picker, /getMemoFeedbackArchiveItemsSignature\(safeRemoteItems\) === localSignature/);
});

test('modified resume and observation scripts are cache-busted', () => {
  assert.match(html, /olli-app-startup\.js\?v=20260924-workhub-resume-local-first-1/);
  assert.match(html, /olli-observation-roster-phone\.js\?v=20260928-roster-header-scroll-1/);
  assert.match(html, /olli-record-student-picker-phone-adapter\.js\?v=20260924-archive-local-first-1/);
  assert.match(html, /olli-boot\.css\?v=20260924-boot-owner-cleanup-1/);
});
