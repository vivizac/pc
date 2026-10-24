'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const runtime = read('apps/mobile/olli-consultation-mobile-runtime.js');
const css = read('apps/mobile/olli-academy-dashboard.css');
const html = read('apps/mobile/index.html');
const notices = read('packages/common/olli-consultation-messages.js');
test('server consultation rows use the existing academy panel, list and card layout contracts', () => {
  assert.match(runtime, /recordAcademyPanel recordAcademyConsultSection recordAcademyConsultationListMobile/);
  assert.match(runtime, /recordAcademyPanelTitle recordAcademyMobileConsultationHeading/);
  assert.match(runtime, /recordAcademyConsultGroups/);
  assert.match(runtime, /recordAcademyList recordAcademyMobileConsultCards/);
  assert.match(runtime, /recordAcademyListItem recordAcademyConsultListItem/);
  assert.doesNotMatch(runtime, /recordAcademySectionHeader/);
});
test('consultation action buttons are grouped, status is visibly differentiated, and student ID is stable', () => {
  assert.match(runtime, /data-student-id/);
  assert.match(runtime, /recordAcademyConsultActions/);
  assert.match(runtime, /recordAcademyConsultStatusChip '/);
  assert.match(runtime, /\['ready', 'generating', 'checking', 'error'\]/);
  assert.match(runtime, /data-consult-preview/);
  assert.match(runtime, /data-consult-ref/);
});
test('mobile CSS keeps cards within viewport and actions in a wrapping row', () => {
  assert.match(css, /\.recordAcademyConsultationListMobile \.recordAcademyConsultListItem \{[\s\S]*?display: flex;[\s\S]*?flex-direction: column;[\s\S]*?min-width: 0;[\s\S]*?width: 100%/);
  assert.match(css, /\.recordAcademyConsultationListMobile \.recordAcademyConsultActions \{[\s\S]*?width: 100%;[\s\S]*?flex-wrap: wrap;/);
  assert.match(css, /@media \(max-width: 380px\)/);
});
test('the owner copy button belongs in the mobile action row without changing the PC layout', () => {
  assert.match(notices, /card\.closest\('\.recordAcademyConsultationListMobile'\)/);
  assert.match(notices, /mobileActions\.appendChild\(button\)/);
  assert.match(notices, /card\.insertBefore\(button, card\.firstChild\)/);
});
test('new JS and CSS are versioned to reload existing installed apps', () => {
  assert.match(html, /olli-academy-dashboard\.css\?v=20261024-consult-card-layout-hotfix-1/);
  assert.match(html, /olli-consultation-mobile-runtime\.js\?v=20261024-consult-card-layout-hotfix-1/);
  assert.match(html, /olli-consultation-messages\.js\?v=20261024-consult-card-copy-placement-1/);
});
