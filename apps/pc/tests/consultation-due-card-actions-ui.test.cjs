const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const messages = fs.readFileSync(path.join(root, '../../packages/common/olli-consultation-messages.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'pc-student-management.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('consultation copy is a labeled icon next to the ready status inside card actions', async () => {
  const start = messages.indexOf('  function manualConsultationCopyIconMarkup(');
  const end = messages.indexOf('  function startManualConsultationButtons()', start);
  assert.ok(start >= 0 && end > start);
  let attached = 0;
  let copied = 0;
  const status = { className: 'recordAcademyConsultStatusChip' };
  const completed = { className: 'recordAcademyConsultCompleteBtn' };
  const actions = {
    firstChild: status,
    children: [status, completed],
    querySelector(selector) {
      return selector === '.recordAcademyConsultStatusChip' ? status : null;
    },
    insertBefore(button, next) {
      assert.equal(next, status);
      this.children.splice(0, 0, button);
      attached += 1;
    },
  };
  const card = {
    querySelector(selector) {
      if (selector === '.recordAcademyConsultActions') return actions;
      if (selector === '[data-consultation-manual-copy]') return actions.children.find(e => e.dataset?.consultationManualCopy) || null;
      return null;
    }
  };
  const context = {
    isOwner: () => true,
    document: {
      querySelectorAll: () => [card],
      createElement: () => ({
        dataset: {}, isConnected: true, disabled: false,
        setAttribute(key, value) { this[key] = value; },
        addEventListener(key, handler) { this[key] = handler; }
      })
    },
    copyManualConsultationNotice: async (_card, button) => {
      assert.equal(_card, card);
      copied++;
      button.innerHTML = 'done';
    },
    alert: message => { throw new Error(message); }
  };
  const script = messages.slice(start, end) + '\nattachManualConsultationButtons(); attachManualConsultationButtons();';
  vm.runInNewContext(script, context);
  assert.equal(attached, 1, 'only one copy control per card');
  assert.equal(actions.children[0].dataset.consultationManualCopy, 'true');
  assert.equal(actions.children[1], status);
  assert.equal(actions.children[2], completed);
  assert.match(actions.children[0].innerHTML, /<svg/);
  assert.doesNotMatch(actions.children[0].innerHTML, /안내문 복사/);
  assert.equal(actions.children[0]['aria-label'], '학생 상담 안내문 복사');
  assert.equal(actions.children[0].title, '안내문 복사');
  await actions.children[0].click({ preventDefault(){}, stopPropagation(){} });
  assert.equal(copied, 1);
  assert.equal(actions.children[0].disabled, false);
});

test('copy feedback remains icon-only and shows accessible completion message', () => {
  assert.match(messages, /button\.innerHTML = manualConsultationCopyIconMarkup\(true\)/);
  assert.match(messages, /button\.setAttribute\('aria-label', '안내문 복사 완료'\)/);
  assert.match(messages, /button\.innerHTML = manualConsultationCopyIconMarkup\(false\)/);
  assert.doesNotMatch(messages, /button\.textContent = '복사 완료'/);
  assert.match(messages, /navigator\.clipboard\?\.writeText/);
});

test('completed consultation is blue and both changed assets are versioned', () => {
  assert.match(css, /\.pcAcademyDetailPanel \.recordAcademyConsultCompleteBtn\.active\{background:#0A84FF;color:#fff;\}/);
  assert.match(css, /\.pcAcademyDetailPanel \.recordAcademyConsultManualCopyBtn\{[^}]*width:30px;height:30px/);
  assert.match(html, /pc-student-management\.css\?v=20261023-consult-card-actions-1/);
  assert.match(html, /olli-consultation-messages\.js\?v=20261023-consult-card-actions-1/);
});
