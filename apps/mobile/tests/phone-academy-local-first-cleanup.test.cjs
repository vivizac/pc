const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const startup = fs.readFileSync('olli-app-startup.js', 'utf8');
const navigation = fs.readFileSync('olli-record-room-navigation.js', 'utf8');
const settingsSync = fs.readFileSync('olli-settings-server-sync.js', 'utf8');
const dashboardCss = fs.readFileSync('olli-academy-dashboard.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('academy server refresh has one owner', () => {
  assert.match(navigation, /function refreshRecordAcademyManagementFromServer\(options = \{\}\)/);
  assert.match(navigation, /loadOlliConsultationRulesFromServer[\s\S]*?loadOlliConsultationProgressFromServer[\s\S]*?loadStudentsFromSupabase/);
  assert.match(startup, /window\.refreshRecordAcademyManagementFromServer\(\{ force: true \}\)/);
  assert.doesNotMatch(startup, /loadOlliConsultationRulesFromServer/);
  assert.doesNotMatch(startup, /loadOlliConsultationProgressFromServer/);
});

test('academy first render is local and server rerender is change-only', () => {
  assert.match(navigation, /if \(currentRecordView === 'academy'\) \{[\s\S]*?renderRecordAcademyManagementDashboard\(\);[\s\S]*?if \(localOnly\) return true;[\s\S]*?refreshRecordAcademyManagementFromServer/);
  assert.match(navigation, /const beforeSignature = getRecordAcademyManagementDataSignature\(\)/);
  assert.match(navigation, /const changed = beforeSignature !== afterSignature/);
  assert.match(navigation, /if \(changed && typeof renderRecordAcademyManagementDashboard === 'function'\)/);
});

test('consultation data loaders no longer own dashboard rerenders or focus refresh', () => {
  assert.doesNotMatch(settingsSync, /document\.addEventListener\('visibilitychange'/);
  assert.doesNotMatch(settingsSync, /window\.addEventListener\('focus'/);
  assert.doesNotMatch(settingsSync, /olliConsultationAutoSyncTimer/);

  const rulesStart = settingsSync.indexOf('async function loadOlliConsultationRulesFromServer');
  const rulesEnd = settingsSync.indexOf('let olliConsultationProgressRefreshPromise', rulesStart);
  assert.doesNotMatch(settingsSync.slice(rulesStart, rulesEnd), /refreshOlliConsultationViews\(\)/);

  const progressStart = settingsSync.indexOf('async function loadOlliConsultationProgressFromServer');
  const progressEnd = settingsSync.indexOf('function bindOlliConsultationSyncOnce', progressStart);
  assert.doesNotMatch(settingsSync.slice(progressStart, progressEnd), /renderRecordAcademyManagementDashboard\(\)/);
});

test('consultation progress uses the common LocalStore after one-time legacy mirror migration', () => {
  assert.match(settingsSync, /function migrateOlliConsultationProgressLegacyMirrorOnce\(academyId\)/);
  assert.match(settingsSync, /writeOlliLocal\([\s\S]*?OLLI_CONSULTATION_PROGRESS_FEATURE/);
  assert.match(settingsSync, /localStorage\.removeItem\(legacyKey\)/);
  assert.doesNotMatch(settingsSync, /function writeOlliConsultationProgressMirror/);
  assert.doesNotMatch(settingsSync, /function readOlliConsultationProgressMirror/);
});

test('boot and consultation style patches were folded into their canonical owners', () => {
  assert.doesNotMatch(html, /olli-academy-consultation-status\.css/);
  assert.doesNotMatch(html, /olliSessionResume/);
  assert.match(dashboardCss, /\.recordAcademyConsultStatusChip \{[\s\S]*?font-weight: 700;[\s\S]*?line-height: 1;[\s\S]*?border: none;/);
});
