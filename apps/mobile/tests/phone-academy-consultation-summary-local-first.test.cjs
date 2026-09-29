const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const storage = fs.readFileSync('olli-storage-core.js', 'utf8');
const student = fs.readFileSync('olli-student-core.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('consultation summary snapshot is one academy-scoped local-only OlliStorageCore feature', () => {
  assert.match(storage, /feature: 'consultation_summary_snapshot'[\s\S]*?scope: 'academy'[\s\S]*?persistence: 'local_only'/);
  assert.match(storage, /defaultValue: \{ version: 1, month_key: '', inputs_signature: '', items: \{\} \}/);
  assert.match(storage, /permissions: \{ read: \['manager', 'owner', 'super_admin'\], write: \['manager', 'owner', 'super_admin'\] \}/);
});

test('academy summary runtime no longer keeps stable items in a second memory source', () => {
  assert.match(student, /const academyConsultationSummaryState = \{\s*running: false,\s*transientItems: \{\},\s*expandedKey: ''\s*\}/);
  assert.doesNotMatch(student, /academyConsultationSummaryState\.items/);
});

test('stable ready and insufficient states read and write only through Olli LocalStore', () => {
  assert.match(student, /readOlliLocal\(\s*OLLI_CONSULTATION_SUMMARY_SNAPSHOT_FEATURE/);
  assert.match(student, /writeOlliLocal\(\s*OLLI_CONSULTATION_SUMMARY_SNAPSHOT_FEATURE/);
  assert.doesNotMatch(student, /localStorage\.(?:getItem|setItem)\([^\n]*consultation_summary/i);
  assert.match(student, /if \(status !== 'ready' && status !== 'insufficient'\) return null;/);
});

test('snapshot is limited to the current academy month and current consultation inputs', () => {
  assert.match(student, /month_key: getAcademyConsultationMonthKey\(\)/);
  assert.match(student, /inputs_signature: getAcademyConsultationSummaryInputsSignature\(\)/);
  assert.match(student, /if \(String\(raw\.month_key \|\| ''\) !== empty\.month_key\) return empty;/);
  assert.match(student, /if \(String\(raw\.inputs_signature \|\| ''\) !== empty\.inputs_signature\) return empty;/);
  assert.match(student, /getOlliConsultationRulesMap/);
  assert.match(student, /readElementaryGroupFeedbackMonthsMap/);
});

test('transient checking and generating states are not persisted', () => {
  assert.match(student, /const stable = normalizeAcademyConsultationSummaryStableItem\(next\);\s*\n\s*if \(!stable\) \{[\s\S]*?transientItems\[safeKey\] = next;[\s\S]*?persisted: false/);
});

test('background consultation check rerenders only when a stable snapshot actually changes', () => {
  assert.match(student, /let dashboardChanged = false;/);
  assert.match(student, /dashboardChanged = dashboardChanged \|\| update\.changed;/);
  assert.match(student, /if \(dashboardChanged\) scheduleRecordAcademyManagementDashboardRender\(120\);/);
  assert.doesNotMatch(student, /finally \{\s*academyConsultationSummaryState\.running = false;\s*scheduleRecordAcademyManagementDashboardRender/);
});

test('consultation summary scripts are cache-busted', () => {
  assert.match(html, /olli-student-core\.js\?v=20260924-consult-summary-local-first-1/);
  assert.match(html, /olli-storage-core\.js\?v=20260924-consult-summary-local-first-1/);
});
