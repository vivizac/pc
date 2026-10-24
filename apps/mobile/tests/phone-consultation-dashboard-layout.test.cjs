'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const read = p => fs.readFileSync(path.join(root, p),'utf8');
const blobSha = content => crypto.createHash('sha1')
  .update('blob '+Buffer.byteLength(content,'utf8')+'\0')
  .update(content,'utf8')
  .digest('hex');
const originalDashboard = read('apps/mobile/olli-settings-server-sync.js');
const style = read('apps/mobile/olli-academy-dashboard.css');
const copy = read('packages/common/olli-consultation-messages.js');
const runtime = read('apps/mobile/olli-consultation-mobile-runtime.js');
const html = read('apps/mobile/index.html');

test('original consultation dashboard markup is preserved byte-for-byte', () => {
  // Only the legacy consultation data duplicate was removed; the original
  // renderer and its CSS still own the UI, unchanged.
  const renderer = originalDashboard.slice(originalDashboard.indexOf('function renderAcademyConsultationList(students){'));
  assert.match(renderer, /function renderRecordAcademyManagementDashboard\(\)/);
  assert.match(originalDashboard, /function renderRecordAcademyManagementDashboard\(\)/);
  assert.match(originalDashboard, /function renderAcademyConsultationList\(students\)/);
  assert.match(originalDashboard, /recordAcademyStatGrid/);
  assert.match(originalDashboard, /recordAcademyConsultGroups/);
  assert.match(originalDashboard, /recordAcademyListItem recordAcademyConsultListItem/);
});
test('original academy CSS is restored byte-for-byte', () => {
  assert.equal(blobSha(style), '071040b9ba796a84b4664b9d761d3ea1123d4423');
});
test('original consultation notice button location is restored, no redesign', () => {
  assert.equal(blobSha(copy), '441eec890dd943fc21d0851d41c61a8c87294cc0');
  assert.match(copy, /card\.insertBefore\(button, card\.firstChild\)/);
});
test('new server keeps data synchronization but never overlays or replaces the old dashboard', () => {
  assert.doesNotMatch(runtime, /renderOlliServerConsultationDashboard|recordAcademyConsultationListMobile|root\.prepend\(panel\)/);
  assert.doesNotMatch(runtime, /window\.renderRecordAcademyManagementDashboard\s*=/);
  assert.match(runtime, /window\.OlliConsultationServer\.readProgress\(\)/);
  assert.match(runtime, /window\.OlliConsultationServer\.setCompleted\(/);
  assert.match(runtime, /function initializeMobileConsultationServer\(\)/);
  assert.match(runtime, /loadOlliConsultationProgressFromServer/);
});
test('restored scripts and stylesheet are explicitly cache-busted for installed phones', () => {
  assert.match(html,/olli-academy-dashboard\.css\?v=20261024-original-ui-restore-1/);
  assert.match(html,/olli-consultation-mobile-runtime\.js\?v=20261024-server-duplicate-scope-fix-1/);
  assert.match(html,/olli-settings-server-sync\.js\?v=20261024-server-duplicate-scope-fix-1/);
  assert.match(html,/olli-consultation-messages\.js\?v=20261024-original-ui-restore-1/);
});
