const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const migration = read('supabase/migrations/20261007170000_academy_finance_expenses.sql');
const common = read('packages/common/olli-teacher-payroll-common.js');
const css = read('packages/common/olli-teacher-payroll-common.css');

test('academy expenses stay private and public RPCs remain owner-gated', () => {
  assert.match(migration, /create table private\.olli_academy_expense_items/);
  assert.match(migration, /create table private\.olli_academy_expense_values/);
  assert.match(migration, /alter table private\.olli_academy_expense_items enable row level security/);
  assert.match(migration, /alter table private\.olli_academy_expense_values enable row level security/);
  assert.match(migration, /private\.olli_academy_finance_owner_member/);
  assert.match(migration, /m\.role='owner'/);
  assert.match(migration, /급여 및 지출 관리는 원장만 확인할 수 있습니다/);
  assert.match(migration, /revoke all on function public\.olli_academy_finance_overview[\s\S]*from public/);
});

test('default expenses distinguish recurring and monthly-entry costs', () => {
  assert.match(migration, /'rent'::text,'월세'::text,'rent'::text,'recurring'/);
  assert.match(migration, /'maintenance','관리비','maintenance','monthly'/);
  assert.match(migration, /'franchise_royalty','가맹·로열티','franchise_royalty','recurring'/);
  assert.match(migration, /'materials','재료비','materials','monthly'/);
  assert.match(migration, /'tax_accounting','세무·기장료','tax_accounting','recurring'/);
  assert.match(migration, /d\.recurrence_mode='recurring' and v\.effective_month<=v_month/);
  assert.match(migration, /d\.recurrence_mode='monthly' and v\.effective_month=v_month/);
});

test('finance overview reuses payroll overview and returns three totals', () => {
  assert.match(migration, /public\.olli_teacher_payroll_overview\(p_session_token,p_academy_id,v_month\)/);
  assert.match(migration, /'payroll_total_amount',v_payroll_total/);
  assert.match(migration, /'expense_total_amount',v_expense_total/);
  assert.match(migration, /'total_amount',v_payroll_total\+v_expense_total/);
});

test('operating expense UI loads through finance overview without replacing payroll save RPC', () => {
  assert.match(common, /rpc\('olli_academy_finance_overview'/);
  assert.match(common, /function renderExpenseSection\(\)/);
  assert.match(common, />운영 지출</);
  assert.match(common, /\+ 광고 추가/);
  assert.match(common, /\+ 프로그램 추가/);
  assert.match(common, /\+ 기타 지출/);
  assert.match(common, /rpc\('olli_academy_expense_value_set'/);
  assert.match(common, /rpc\('olli_academy_expense_item_save'/);
  assert.match(common, /rpc\('olli_academy_expense_item_end'/);
  assert.match(common, /rpc\('olli_teacher_payroll_setting_upsert_v2'/);
});

test('monthly costs remain visibly missing until explicitly entered', () => {
  assert.match(common, /const amount=entered \? Math\.max\(0,Math\.round\(Number\(item\?\.amount \|\| 0\)\)\) : '';/);
  assert.match(common, /const missing=recurrence==='monthly' && !entered/);
  assert.ok(common.includes("placeholder=\"'+(missing?'미입력':'금액')+'\""));
  assert.match(common, /이번 달 아직 입력하지 않은 월별 지출/);
});

test('custom expense rows can rename, save amount, and end without hard delete UI', () => {
  assert.match(common, /data-expense-name/);
  assert.match(common, /if\(custom\)\{[\s\S]*olli_academy_expense_item_save/);
  assert.match(common, /olli_academy_expense_value_set/);
  assert.match(common, /olli_academy_expense_item_end/);
  assert.match(common, /이전 달 기록은 그대로 유지됩니다/);
  assert.doesNotMatch(common, /olli_academy_expense_item_delete/);
});

test('expense UI styling is scoped to its own classes and keeps the current stacked layout', () => {
  assert.match(css, /\.olliExpenseSection\{/);
  assert.match(css, /\.olliExpenseRow\{/);
  assert.match(css, /\.olliExpenseAddForm\{/);
  assert.match(css, /@media\(max-width:560px\)/);
  assert.doesNotMatch(css, /\.olliPayrollPage\{[^}]*grid-template-columns/);
});

test('finance summary shows operating expense, payroll, and combined monthly totals', () => {
  assert.match(common, /function renderFinanceSummary\(\)/);
  assert.match(common, /payload\.expense_total_amount/);
  assert.match(common, /payload\.payroll_total_amount/);
  assert.match(common, /payload\.total_amount/);
  assert.match(common, />운영 지출</);
  assert.match(common, />선생님 급여</);
  assert.match(common, /총 지출/);
});

test('PC uses two finance columns while non-PC layout remains stacked', () => {
  assert.match(common, /class="olliFinanceColumns"/);
  assert.match(common, /class="olliFinanceExpensesColumn"/);
  assert.match(common, /class="olliFinancePayrollColumn"/);
  assert.match(css, /\.olliFinanceColumns\{display:block\}/);
  assert.match(css, /body\.olliPcApp \.olliFinanceColumns\{display:grid;grid-template-columns:minmax\(0,\.47fr\) minmax\(0,\.53fr\)/);
  assert.match(css, /body\.olliPcApp \.olliPayrollPage\{width:100%;max-width:none/);
});

test('PC expense column adapts row actions without changing the shared mobile row model', () => {
  assert.match(css, /body\.olliPcApp \.olliFinanceExpensesColumn \.olliExpenseRow\{grid-template-columns:minmax\(0,1fr\) 145px/);
  assert.match(css, /body\.olliPcApp \.olliFinanceExpensesColumn \.olliExpenseRowActions\{grid-column:1 \/ -1/);
  assert.doesNotMatch(css, /body:not\(\.olliPcApp\) \.olliFinanceColumns\{display:grid/);
});

test('mobile switches between operating expense and payroll tabs while keeping the shared summary above', () => {
  assert.match(common, /financeTab: 'expenses'/);
  assert.match(common, /function financeTabHtml\(\)/);
  assert.match(common, /data-finance-tab="expenses">운영 지출/);
  assert.match(common, /data-finance-tab="payroll">선생님 급여/);
  assert.match(common, /function setFinanceTab\(tab,body\)/);
  assert.match(common, /function bindFinanceTabs\(body\)/);
  assert.match(common, /renderFinanceSummary\(\)[\s\S]*financeTabHtml\(\)[\s\S]*class="olliFinanceColumns"/);
});

test('mobile tab state survives finance rerenders and only toggles the lower content columns', () => {
  assert.match(common, /state\.financeTab==='expenses'\?' is-active':''/);
  assert.match(common, /state\.financeTab==='payroll'\?' is-active':''/);
  assert.match(common, /state\.financeTab=next/);
  assert.match(common, /bindFinanceTabs\(els\.body\)/);
  const tabStart = common.indexOf('function setFinanceTab');
  const tabEnd = common.indexOf('\n  function bindFinanceTabs', tabStart);
  assert.ok(tabStart >= 0 && tabEnd > tabStart);
  const tabCode = common.slice(tabStart, tabEnd);
  assert.doesNotMatch(tabCode, /loadOverview|rpc\(/);
});

test('finance tabs are visible on mobile and hidden on the PC two-column layout', () => {
  assert.match(css, /\.olliFinanceTabs\{display:flex/);
  assert.match(css, /\.olliFinanceExpensesColumn,\.olliFinancePayrollColumn\{display:none\}/);
  assert.match(css, /\.olliFinanceExpensesColumn\.is-active,\.olliFinancePayrollColumn\.is-active\{display:block\}/);
  assert.match(css, /body\.olliPcApp \.olliFinanceTabs\{display:none\}/);
  assert.match(css, /body\.olliPcApp \.olliFinanceExpensesColumn,[\s\S]*body\.olliPcApp \.olliFinancePayrollColumn\{display:block\}/);
});

test('combined total is server-owned and equals operating expense plus payroll', () => {
  assert.match(migration, /v_expense_total := coalesce\(\(v_expenses->>'total_amount'\)::bigint,0\)/);
  assert.match(migration, /'payroll_total_amount',v_payroll_total/);
  assert.match(migration, /'expense_total_amount',v_expense_total/);
  assert.match(migration, /'total_amount',v_payroll_total\+v_expense_total/);

  const start = common.indexOf('function renderFinanceSummary');
  const end = common.indexOf('\n  function renderPayrollSection', start);
  assert.ok(start >= 0 && end > start);
  const summaryCode = common.slice(start, end);
  assert.match(summaryCode, /payload\.expense_total_amount/);
  assert.match(summaryCode, /payload\.payroll_total_amount/);
  assert.match(summaryCode, /payload\.total_amount/);
  assert.doesNotMatch(summaryCode, /querySelectorAll\('\[data-payroll-teacher-card\]'\)/);
});

test('saved expense and payroll changes both refresh the combined finance overview', () => {
  const expenseSaveStart = common.indexOf('async function saveExpenseRow');
  const expenseEnd = common.indexOf('\n  async function endExpenseItem', expenseSaveStart);
  const payrollSaveStart = common.indexOf('async function saveTeacher');
  const payrollEnd = common.indexOf('\n  async function open()', payrollSaveStart);
  assert.ok(expenseSaveStart >= 0 && expenseEnd > expenseSaveStart);
  assert.ok(payrollSaveStart >= 0 && payrollEnd > payrollSaveStart);
  assert.match(common.slice(expenseSaveStart, expenseEnd), /await loadOverview\(\)/);
  assert.match(common.slice(payrollSaveStart, payrollEnd), /await loadOverview\(\)/);
  assert.match(common, /rpc\('olli_academy_finance_overview'/);
});

test('changing the selected month refreshes payroll and expenses together', () => {
  assert.match(common, /data-payroll-month/);
  assert.match(common, /state\.month = next;\s*loadOverview\(\)/);
  assert.match(migration, /v_month date := date_trunc\('month',coalesce\(p_month,current_date\)\)::date/);
});

