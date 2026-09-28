const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const storage = fs.readFileSync(path.join(root, 'olli-storage-core.js'), 'utf8');
const students = fs.readFileSync(path.join(root, 'olli-data-student-operations.js'), 'utf8');

function featureBlock(feature) {
  const start = storage.indexOf(`feature: '${feature}'`);
  assert.notEqual(start, -1, `${feature} feature missing`);
  const blockStart = storage.lastIndexOf('FeatureRegistry.register({', start);
  const blockEnd = storage.indexOf('\n  });', start);
  return storage.slice(blockStart, blockEnd + 6);
}

test('student features use the protected account-session RPC transport', () => {
  ['student_profile', 'student_status', 'student_soft_delete', 'students_list'].forEach(feature => {
    const block = featureBlock(feature);
    assert.match(block, /transport: 'session_rpc'/);
    assert.match(block, /rpc: 'olli_student_data_access'/);
  });
  assert.match(featureBlock('student_soft_delete'), /operation: 'soft_delete'/);
});

test('student list refresh no longer reads students through direct REST', () => {
  assert.match(students, /async function loadStudentRowsFromSecureServer\(academyId\)/);
  assert.match(students, /core\.ServerAdapter\.read\(spec, \{ academyId \}, \{ limit: 5000 \}\)/);
  assert.match(students, /const rows = await loadStudentRowsFromSecureServer\(academyId\)/);
  assert.doesNotMatch(students, /supabase\('GET', `students\?select=\*&academy_id=/);
});

test('obsolete direct student status PATCH helper is removed', () => {
  assert.doesNotMatch(students, /function patchStudentStatusReturning/);
  assert.doesNotMatch(students, /async function patchStudentStatusReturning/);
});


test('settings backup no longer reads students through direct REST', () => {
  const settingsStorage = fs.readFileSync(path.join(root, 'olli-settings-storage.js'), 'utf8');
  assert.match(settingsStorage, /async function loadSettingsBackupStudentsSecure\(academyId\)/);
  assert.match(settingsStorage, /core\.ServerAdapter\.read\(spec, \{ academyId \}, \{ limit: 5000 \}\)/);
  assert.match(settingsStorage, /loadSettingsBackupStudentsSecure\(academyId\)/);
  assert.doesNotMatch(settingsStorage, /supabase\('GET', `students\?select=\*&academy_id=/);
});
