'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const live = fs.readFileSync(path.join(root, 'kinder-feedback.js'), 'utf8');
const save = fs.readFileSync(path.join(root, 'olli-student-core.js'), 'utf8');
const common = fs.readFileSync(path.join(root, '../../packages/common/olli-feedback-runtime.js'), 'utf8');

test('corrected response supplies a stable mutation id to storage', () => {
  assert.match(live, /clientRecordId:\s*'corrected_'\s*\+\s*String\(item\.id/);
  assert.match(save, /options\.clientRecordId\s*\?\s*\{ client_record_id:/);
  assert.match(common, /createTodayFeedbackItem\(\{ \.+options/);
});

test('pending correction does not retire the previous feedback', () => {
  assert.match(live, /savedOk\.__pending_sync && Array\.isArray\(item\.supersededFeedbacks\)/);
  assert.match(live, /item\.pendingCorrectionSave = true;/);
  assert.match(live, /item\.saved = false;/);
  assert.match(common, /item\.savedRow\?\.__pending_sync\) return false;/);
});

test('interrupted correction keeps retry metadata and reconnect handler', () => {
  assert.match(live, /pendingCorrectionSave:!!item\.pendingCorrectionSave/);
  assert.match(live, /addEventListener\('online', resumePendingCorrectedQuickNoteSaves\)/);
  assert.match(live, /Promise\.resolve\(\)\.then\(resumePendingCorrectedQuickNoteSaves\)/);
});
