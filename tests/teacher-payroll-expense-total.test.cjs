const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function payrollView() {
  const source = fs.readFileSync(path.join(__dirname, '../packages/common/olli-teacher-payroll-common.js'), 'utf8');
  const window = {};
  const context = { window, document: { readyState: 'loading', addEventListener() {} } };
  vm.runInNewContext(source.replace('})(window);', 'global.__payrollView = { state, renderPayrollSection };\n})(window);'), context);
  return window.__payrollView;
}

function totalCard(view, payroll, teachers) {
  const html = view.renderPayrollSection(payroll, teachers);
  return html.match(/data-payroll-expense-total>(.*?)<\/div>/)[1];
}

test('payroll expense card uses the selected month server gross total, including zero', () => {
  const view = payrollView();
  view.state.payload = { payroll_gross_total_amount: 3030000 };
  assert.match(totalCard(view, {}, []), /급여 지출 총액 · 공제 전.*3,030,000원/);
  view.state.payload = { payroll_gross_total_amount: 0 };
  assert.match(totalCard(view, {}, [{ gross_amount: 1000000 }]), /<strong>0원<\/strong>/);
});

test('older payloads total teacher gross salaries without subtracting freelancer withholding', () => {
  const view = payrollView();
  view.state.payload = {};
  const card = totalCard(view, {}, [
    { gross_amount: 1000000, total_amount: 967000, deduction_amount: 33000 },
    { gross_amount: 2000000, total_amount: 2000000 }
  ]);
  assert.match(card, /<strong>3,000,000원<\/strong>/);
});

test('legacy teachers without a gross field include net pay and withholding', () => {
  const view = payrollView();
  view.state.payload = {};
  assert.match(totalCard(view, {}, [{ total_amount: 967000, deduction_amount: 33000 }]), /<strong>1,000,000원<\/strong>/);
  assert.match(totalCard(view, {}, []), /<strong>0원<\/strong>/);
});

test('re-rendering a different month replaces the payroll total', () => {
  const view = payrollView();
  view.state.payload = { month: '2026-10', payroll_gross_total_amount: 1000000 };
  assert.match(totalCard(view, {}, []), /1,000,000원/);
  view.state.payload = { month: '2026-11', payroll_gross_total_amount: 2000000 };
  const card = totalCard(view, {}, []);
  assert.match(card, /2,000,000원/);
  assert.doesNotMatch(card, /1,000,000원/);
});
