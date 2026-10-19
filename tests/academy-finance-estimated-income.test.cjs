const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migration=read('supabase/migrations/20261015100000_academy_finance_estimated_income.sql');
const js=read('packages/common/olli-teacher-payroll-common.js');
const pricingMigration=read('supabase/migrations/20261019075624_academy_tuition_policies.sql');
const css=read('packages/common/olli-teacher-payroll-common.css');

test('only the owner-gated finance overview reveals aggregated tuition',()=>{
  assert.match(migration,/private\.olli_academy_finance_owner_member\(p_session_token,p_academy_id\)/);
  assert.match(migration,/private\.olli_academy_revenue_estimate\(p_academy_id,v_month\)/);
  assert.match(migration,/revoke all on function private\.olli_academy_revenue_estimate/);
  assert.match(migration,/s\.academy_id=p_academy_id/);
  assert.match(migration,/e\.academy_id=p_academy_id/);
  assert.doesNotMatch(migration,/drop table|truncate table|delete from public\.students/i);
});

test('tuition derives from effective regular schedule, not absence or one-off lessons',()=>{
  assert.match(migration,/from public\.olli_schedule_enrollments e/);
  assert.match(migration,/e\.status='active'/);
  assert.match(migration,/e\.effective_from <= w\.as_of_date/);
  assert.match(migration,/e\.effective_to >= w\.as_of_date/);
  assert.match(migration,/count\(distinct \(e\.weekday, e\.time_slot\)\)/);
  assert.match(migration,/es\.sessions=1/);
  assert.match(migration,/es\.sessions=2/);
  assert.match(migration,/unpriced_students/);
});

test('workbook fee is separate and applies only in first enrollment month',()=>{
  assert.match(migration,/es\.enrolled_at>=w\.month_start/);
  assert.match(migration,/tuition_once_amount.*110000/);
  assert.match(migration,/tuition_twice_amount.*150000/);
  assert.match(migration,/workbook_amount.*70000/);
  assert.match(pricingMigration,/워크북 교환비/);
  assert.match(js,/재료비·교재비 등 별도 비용/);
  assert.match(js,/실제 입금 확인 전의 예상 매출/);
});

test('finance preserves legacy expense totals while exposing gross-payroll profit',()=>{
  assert.match(migration,/'total_amount',v_payroll_total\+v_expense_total/);
  assert.match(migration,/'estimated_expense_total_amount',v_estimated_expenses/);
  assert.match(migration,/v_estimated_profit := .* - v_estimated_expenses/);
  assert.match(migration,/v_payroll_gross/);
  assert.match(js,/payload\.estimated_profit_amount/);
  assert.match(js,/signedMoney\(totalProfit\)/);
});

test('PC retains existing two expense/payroll columns and mobile has income tab',()=>{
  assert.match(css,/grid-template-columns:minmax\(0,\.47fr\) minmax\(0,\.53fr\)/);
  assert.match(css,/\.olliFinanceIncomeColumn\.is-active\{display:block\}/);
  assert.match(css,/body\.olliPcApp \.olliFinanceIncomeColumn\{display:block;grid-column:1 \/ -1\}/);
  assert.match(js,/data-finance-tab="income">예상 수입/);
  assert.match(js,/class="olliFinanceIncomeColumn/);
  assert.match(js,/renderRevenueSection\(\)/);
});
