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
test('PC and mobile copy buttons share exact styling, but mobile sits before status', () => {
  const vm = require('node:vm');
  const start = copy.indexOf('function attachManualConsultationButtons() {');
  const finish = copy.indexOf('function startManualConsultationButtons()', start);
  assert.ok(start > 0 && finish > start);
  const source = copy.slice(start, finish);
  const render = isPc => {
    const status = { textContent: '자료부족' };
    const actions = {
      children: [status],
      querySelector: selector => selector === '.recordAcademyConsultStatusChip' ? status : null,
      insertBefore(button, anchor) {
        const i = this.children.indexOf(anchor);
        assert.ok(i >= 0);
        this.children.splice(i, 0, button);
      }
    };
    const studentMain = { textContent: '김테스트 · 12개월' };
    const card = {
      children: [studentMain, actions],
      firstChild: studentMain,
      querySelector(selector) {
        if (selector === '[data-consultation-manual-copy]') return null;
        if (selector === '.recordAcademyConsultActions') return actions;
        return null;
      },
      insertBefore(button, anchor) {
        const i = this.children.indexOf(anchor);
        assert.ok(i >= 0);
        this.children.splice(i, 0, button);
      }
    };
    let button;
    const document = {
      body: { classList: { contains: value => value === 'olliPcApp' && isPc } },
      querySelectorAll: selector => selector === '.recordAcademyConsultListItem' ? [card] : [],
      createElement(tag) {
        assert.equal(tag, 'button');
        button = {dataset: {}, style: {}, addEventListener(){}, setAttribute(){}};
        return button;
      }
    };
    vm.runInNewContext(source + '\nattachManualConsultationButtons();', { document, isOwner: () => true });
    return { status, actions, studentMain, card, button };
  };
  const mobile = render(false);
  const pc = render(true);
  assert.deepEqual(mobile.actions.children, [mobile.button, mobile.status]);
  assert.deepEqual(mobile.card.children, [mobile.studentMain, mobile.actions]);
  assert.deepEqual(pc.card.children, [pc.button, pc.studentMain, pc.actions]);
  assert.deepEqual(pc.actions.children, [pc.status]);
  assert.equal(mobile.button.style.cssText, pc.button.style.cssText);
  assert.match(mobile.button.style.cssText, /border-radius:8px;background:#fff;color:#343d4b/);
  assert.match(mobile.button.style.cssText, /font-size:12px;font-weight:600/);
  assert.equal(mobile.button.textContent, '안내문 복사');
  assert.equal(mobile.button.dataset.consultationManualCopy, 'true');
  assert.equal(blobSha(style), '071040b9ba796a84b4664b9d761d3ea1123d4423',
    'the student card styling must remain byte-for-byte unchanged');
});

test('new server keeps data synchronization but never overlays or replaces the old dashboard', () => {
  assert.doesNotMatch(runtime, /renderOlliServerConsultationDashboard|recordAcademyConsultationListMobile|root\.prepend\(panel\)/);
  assert.doesNotMatch(runtime, /window\.renderRecordAcademyManagementDashboard\s*=/);
  assert.match(runtime, /window\.OlliConsultationServer\.readProgress\(\)/);
  assert.doesNotMatch(runtime, /window\.OlliConsultationServer\.setCompleted\(|toggleAcademyConsultationCompleted/);
  assert.match(runtime, /function initializeMobileConsultationServer\(\)/);
  assert.match(runtime, /loadOlliConsultationProgressFromServer/);
});
test('restored scripts and stylesheet are explicitly cache-busted for installed phones', () => {
  assert.match(html,/olli-academy-dashboard\.css\?v=20261024-original-ui-restore-1/);
  assert.match(html,/olli-consultation-mobile-runtime\.js\?v=20261024-month-only-1/);
  assert.match(html,/olli-settings-server-sync\.js\?v=20261024-remove-consultation-entry-1/);
  assert.match(html,/olli-consultation-messages\.js\?v=20261024-copy-beside-status-1/);
});
