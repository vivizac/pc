'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const consultationCore = fs.readFileSync(path.join(__dirname, '../packages/common/olli-consultation-task-core.js'), 'utf8');
const managementUI = fs.readFileSync(path.join(__dirname, '../apps/pc/pc-student-management.js'), 'utf8');

function renderConsultationCard(enrolledMonthsAgo, ruleLabels) {
  const panel = { innerHTML: '' };
  const now = new Date();
  const enrollmentDate = enrolledMonthsAgo == null
    ? null
    : new Date(now.getFullYear(), now.getMonth() - enrolledMonthsAgo, 1);
  const student = { id: 'test-student', name: '테스트학생', type: 'kinder' };
  const context = {
    Date,
    console,
    window: { OlliConsultationMessages: { isOwner: () => false } },
    document: {
      getElementById: (id) => id === 'pcAcademyDetailPanel' ? panel : null,
      querySelectorAll: () => []
    },
    getDueConsultationRuleLabelsForStudent: () => ruleLabels,
    getStudentEnrollmentDateForStats: () => enrollmentDate,
    getOlliConsultationRuleShortLabel: (label) => String(label).replace(/(후|마다)$/, ''),
    escapeHtml: (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  };
  vm.createContext(context);
  vm.runInContext(consultationCore, context, { filename: 'olli-consultation-task-core.js' });
  vm.runInContext(managementUI, context, { filename: 'pc-student-management.js' });
  context.window.OlliPcStudentManagement.renderConsultationPanel([student]);
  return panel.innerHTML;
}

for (const months of [1, 6, 12, 18, 24, 30]) {
  test(`consultation student card shows actual enrollment tenure at ${months} months`, () => {
    const html = renderConsultationCard(months, ['6개월마다', '12개월마다']);
    assert.match(html, new RegExp('recordAcademyRuleChip">' + months + '개월</span>'));
    assert.equal((html.match(/recordAcademyRuleChip/g) || []).length, 1, 'only the elapsed-month badge is shown');
    assert.match(html, /recordAcademyConsultStatusChip insufficient/);
    assert.match(html, /자료부족/);
  });
}

test('consultation card keeps tenure and summary status without any completion button',()=>{
  const html=renderConsultationCard(24,['6개월마다']);
  assert.match(html,/recordAcademyRuleChip">24개월</);
  assert.match(html,/자료부족/);
  assert.doesNotMatch(html,/aria-pressed="true"|onclick="toggleAcademyConsultationCompleted|>완료<\/button>/);
});
test('unknown enrollment date falls back to existing rule label', () => {
  const html = renderConsultationCard(null, ['6개월마다']);
  assert.match(html, /recordAcademyRuleChip">6개월</);
});
