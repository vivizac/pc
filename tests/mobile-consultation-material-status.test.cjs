const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'apps/mobile/olli-student-core.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'apps/mobile/index.html'), 'utf8');

function between(begin, end) {
  const start = core.indexOf(begin);
  const stop = core.indexOf(end, start + begin.length);
  assert.ok(start >= 0 && stop > start, 'functions not found: ' + begin);
  return core.slice(start, stop);
}

test('unchecked consultation cards default to checking instead of insufficient', () => {
  const code = between('function getAcademyConsultationSummaryItemByKey(', 'function setAcademyConsultationSummaryItem(');
  const { getAcademyConsultationSummaryItemByKey } = vm.runInNewContext(
    code + '\n({getAcademyConsultationSummaryItemByKey})',
    {
      academyConsultationSummaryState: { transientItems: {} },
      readAcademyConsultationSummarySnapshot: () => ({ items: {} }),
      normalizeAcademyConsultationSummaryStableItem: () => null,
      getAcademyConsultationSummaryKey: () => 'student',
    }
  );
  assert.equal(getAcademyConsultationSummaryItemByKey('student').status, 'checking');
});

test('labels distinguish checking, actual insufficiency, errors, and ready', () => {
  const code = between('function getAcademyConsultationSummaryStatusLabel(', 'function isSummaryFeedbackRowForMonth(');
  const value = vm.runInNewContext(code + '\n({label:getAcademyConsultationSummaryStatusLabel,display:getAcademyConsultationSummaryDisplayStatus})');
  assert.equal(value.label('checking'), '확인중');
  assert.equal(value.label('insufficient'), '자료부족');
  assert.equal(value.label('error'), '확인오류');
  assert.equal(value.label('ready'), '준비완료');
  assert.equal(value.label('generating'), '생성중');
  assert.equal(value.display('checking'), 'checking');
  assert.equal(value.display('generating'), 'generating');
  assert.equal(value.display('ready'), 'ready');
  assert.equal(value.display('error'), 'error');
});

test('old insufficiency snapshot is invalidated when the material rule revision changes', () => {
  const code = between('function getAcademyConsultationSummaryInputsSignature(', 'function createEmptyAcademyConsultationSummarySnapshot(');
  const signature = vm.runInNewContext(code + '\ngetAcademyConsultationSummaryInputsSignature', {
    getOlliConsultationRulesMap: () => ({ repeat: true }),
    readElementaryGroupFeedbackMonthsMap: () => ({}),
    normalizeAcademyConsultationSummarySignatureValue: v => v,
  });
  const parsed = JSON.parse(signature());
  assert.equal(parsed.consultationMaterialsRevision, '20261023-secure-final-month-status-v2');
  const reader = between('function readAcademyConsultationSummarySnapshot(', 'function writeAcademyConsultationSummarySnapshot(');
  assert.match(reader, /raw.inputs_signature.*!== empty.inputs_signature/);
});

test('a stuck checking status does not block subsequent server recheck', () => {
  const source = between('async function runAcademyConsultationSummaryAutoCheck(', 'window.toggleAcademyConsultationSummaryPreview =');
  assert.doesNotMatch(source, /existingState.status === 'generating' \|\| existingState.status === 'checking'/);
  assert.match(source, /fetchConsultationSummaryFromServer/);
  assert.match(source, /await fetchConsultationSummaryFromServer/);
  assert.match(source, /status:'error'/);
});

test('mobile HTML requests the newly versioned script', () => {
  assert.match(html, /olli-student-core\.js\?v=20261024-target-month-save-2/);
});
