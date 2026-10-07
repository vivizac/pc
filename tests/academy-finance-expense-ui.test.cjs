const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const migration = read('supabase/migrations/20261007170000_academy_finance_expenses.sql');
const materialsModeMigration = read('supabase/migrations/20261007215500_materials_expense_mode.sql');
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
  assert.match(common, /rpc\('olli_academy_expense_save'/);
  assert.match(common, /rpc\('olli_academy_expense_item_end'/);
  assert.doesNotMatch(common, /rpc\('olli_academy_expense_value_set'/);
  assert.doesNotMatch(common, /rpc\('olli_academy_expense_item_save'/);
  assert.match(common, /rpc\('olli_teacher_payroll_setting_upsert_v2'/);
});

test('monthly costs remain visibly missing until explicitly entered', () => {
  assert.match(common, /const amount=entered \? Math\.max\(0,Math\.round\(Number\(item\?\.amount \|\| 0\)\)\) : '';/);
  assert.match(common, /const missing=recurrence==='monthly' && !entered/);
  assert.ok(common.includes("placeholder=\"'+(missing?'미입력':'금액')+'\""));
  assert.match(common, /이번 달 아직 입력하지 않은 월별 지출/);
});

test('custom expense rows rename and save the amount in one atomic RPC', () => {
  assert.match(common, /data-expense-name/);
  assert.match(common, /data-revision=/);
  const saveStart = common.indexOf('async function saveExpenseRow');
  const saveEnd = common.indexOf('\n  async function endExpenseItem', saveStart);
  assert.ok(saveStart >= 0 && saveEnd > saveStart);
  const saveCode = common.slice(saveStart, saveEnd);
  assert.match(saveCode, /rpc\('olli_academy_expense_save'/);
  assert.equal((saveCode.match(/rpc\(/g) || []).length, 1);
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

test('expense items carry one optimistic revision across name, amount, and end mutations', () => {
  assert.match(migration, /revision bigint not null default 0/);
  assert.match(migration, /olli_academy_expense_items_revision_check check \(revision >= 0\)/);
  assert.match(migration, /'revision',r\.revision/);
  assert.match(migration, /v_item\.revision<>p_expected_revision/);
  assert.match(migration, /set revision=revision\+1/);
  assert.match(common, /const revision=Math\.max\(0,Number\(item\?\.revision \|\| 0\)\)/);
  assert.match(common, /p_expected_revision:revision/);
});

test('expense mutation requests are idempotent and reject request-id reuse with different payloads', () => {
  assert.match(migration, /create table private\.olli_academy_expense_mutations/);
  assert.match(migration, /primary key \(academy_id,request_id\)/);
  assert.match(migration, /expense-request:/);
  assert.match(migration, /v_existing_mutation\.request_payload<>v_request_payload/);
  assert.match(migration, /'replayed',true/);
  assert.match(common, /function newExpenseRequestId\(\)/);
  assert.match(common, /function expenseMutationId\(node,key,kind\)/);
  assert.match(common, /p_request_id:requestId/);
});

test('stale expense edits reload the latest state instead of overwriting another device', () => {
  assert.match(migration, /'conflict',true/);
  assert.match(migration, /다른 기기에서 이 지출 항목을 먼저 변경했습니다/);
  assert.match(common, /function handleExpenseConflict\(payload,node,kind\)/);
  assert.match(common, /await loadOverview\(\)/);
  assert.match(common, /다른 기기에서 지출 내용이 변경되었습니다/);
});

test('expense mutation storage stays private and old split-write RPCs are not exposed', () => {
  assert.match(migration, /alter table private\.olli_academy_expense_mutations enable row level security/);
  assert.match(migration, /revoke all on table private\.olli_academy_expense_mutations from public,anon,authenticated/);
  assert.match(migration, /create or replace function public\.olli_academy_expense_save/);
  assert.doesNotMatch(migration, /create or replace function public\.olli_academy_expense_value_set/);
  assert.doesNotMatch(migration, /create or replace function public\.olli_academy_expense_item_save/);
});

test('expense audit events are private, ordered, and capture before and after states', () => {
  assert.match(migration, /create table private\.olli_academy_expense_events/);
  assert.match(migration, /event_seq bigint generated always as identity unique/);
  assert.match(migration, /event_type in \('create','update','end','restore'\)/);
  assert.match(migration, /changed_by_name_snapshot text not null/);
  assert.match(migration, /before_state jsonb null/);
  assert.match(migration, /after_state jsonb not null/);
  assert.match(migration, /olli_academy_expense_events_request_uidx/);
  assert.match(migration, /alter table private\.olli_academy_expense_events enable row level security/);
  assert.match(migration, /revoke all on table private\.olli_academy_expense_events from public,anon,authenticated/);
  assert.match(migration, /order by e\.event_seq desc/);
});

test('expense saves and ends write immutable audit events inside the same transaction', () => {
  assert.match(migration, /insert into private\.olli_academy_expense_events\([\s\S]*case when v_created then 'create' else 'update' end/);
  assert.match(migration, /insert into private\.olli_academy_expense_events\([\s\S]*'end'/);
  assert.match(migration, /private\.olli_academy_expense_audit_state/);
  assert.match(migration, /'event_id',v_event_id/);
});

test('expense history RPC only exposes owner-authorized audit records for the selected month', () => {
  assert.match(migration, /create or replace function public\.olli_academy_expense_history/);
  assert.match(migration, /private\.olli_academy_finance_owner_member\(/);
  assert.match(migration, /where r\.event_month=v_month/);
  assert.match(migration, /'can_restore',f\.item_rank=1 and f\.event_type<>'create'/);
  assert.match(migration, /'current_revision'/);
});

test('expense restore only undoes the latest non-create event and records the restore itself', () => {
  assert.match(migration, /create or replace function public\.olli_academy_expense_restore/);
  assert.match(migration, /가장 최근 변경부터 복구해 주세요/);
  assert.match(migration, /if v_event\.event_type='create' or v_event\.before_state is null/);
  assert.match(migration, /v_item\.revision<>p_expected_revision/);
  assert.match(migration, /event_type,event_month,request_id,[\s\S]*'restore'/);
  assert.match(migration, /restore_of_event_id/);
});

test('recurring expense restore can remove a newly-created effective value and resume inheritance', () => {
  assert.match(migration, /v_before_exact_exists/);
  assert.match(migration, /if v_before_exact_exists then/);
  assert.match(migration, /delete from private\.olli_academy_expense_values v[\s\S]*v\.effective_month=v_event_month/);
  assert.match(migration, /effective_value_month/);
  assert.match(migration, /effective_amount/);
});

test('operating expense UI exposes selected-month history and safe restore', () => {
  assert.match(common, /expenseHistoryOpen: false/);
  assert.match(common, /expenseHistoryRequestSeq: 0/);
  assert.match(common, /data-expense-history-toggle>변경 기록/);
  assert.match(common, /function loadExpenseHistory\(\)/);
  assert.match(common, /rpc\('olli_academy_expense_history'/);
  assert.match(common, /function restoreExpenseHistory\(button\)/);
  assert.match(common, /rpc\('olli_academy_expense_restore'/);
  assert.match(common, /이 변경 직전 상태로 복구할까요/);
  assert.match(common, /복구 자체도 변경 기록에 남습니다/);
  assert.match(common, /state\.expenseHistoryRequestSeq!==requestSeq/);
});

test('expense history restore reuses revision and request-id conflict protections', () => {
  assert.match(common, /p_expected_revision:revision/);
  assert.match(common, /expenseMutationId\(button,requestKey,'restore'\)/);
  assert.match(common, /handleExpenseConflict\(payload,button,'restore'\)/);
  assert.match(common, /const reloaded=await loadOverview\(\)/);
  assert.match(migration, /operation in \('save','end','restore'\)/);
  assert.match(migration, /v_existing_mutation\.operation<>'restore'/);
});

test('expense history UI is scoped and remains usable on mobile', () => {
  assert.match(css, /\.olliExpenseHistoryPanel\{display:none/);
  assert.match(css, /\.olliExpenseHistoryPanel\.is-open\{display:block\}/);
  assert.match(css, /\.olliExpenseRestoreButton\{/);
  assert.match(css, /@media\(max-width:560px\)\{[\s\S]*\.olliExpenseHistoryHead\{display:block\}/);
});

test('finance summary distinguishes incomplete monthly expenses from a complete total', () => {
  assert.match(common, /const missingMonthly=Math\.max\(0,Number\(expenses\.missing_monthly_count \|\| 0\)\)/);
  assert.match(common, /future\?'현재 입력 기준 예상 총지출':'현재 입력 기준 총지출'/);
  assert.match(common, /future\?'예상 총지출':'총지출'/);
  assert.match(common, /'월별 지출 미입력 '\+missingMonthly\+'건'/);
  assert.match(common, /'월별 지출 입력 완료'/);
  assert.match(common, /class="olliFinanceSummary'\+\(missingMonthly>0\?' is-incomplete':' is-complete'\)/);
});

test('missing monthly expenses explicitly state that they are excluded from the current total', () => {
  assert.match(common, /현재 총액에는 포함되지 않습니다/);
  assert.match(common, /이번 달 아직 입력하지 않은 월별 지출/);
});

test('finance month selector uses the broader 조회 월 label', () => {
  assert.match(common, /<span>조회 월<\/span>/);
  assert.doesNotMatch(common, /<span>계산 월<\/span>/);
});

test('finance completeness status has subtle complete and incomplete styles', () => {
  assert.match(css, /\.olliFinanceSummaryStatus\{/);
  assert.match(css, /\.olliFinanceSummary\.is-incomplete \.olliFinanceSummaryStatus\{/);
});



test('expense currency inputs format with thousands separators on PC and mobile', () => {
  assert.match(common, /function currencyInputValue\(value\)/);
  assert.match(common, /function currencyInputAmount\(value\)/);
  assert.match(common, /data-expense-amount/);
  assert.match(common, /maxlength="13" type="text" autocomplete="off"/);
  assert.match(common, /data-expense-new-amount/);
  assert.match(common, /bindCurrencyInput\(row\.querySelector\('\[data-expense-amount\]'\)\)/);
});

test('materials appears before franchise royalty and can switch monthly entry mode atomically', () => {
  assert.match(common, /basicOrder=\{rent:10,maintenance:20,materials:30,franchise_royalty:40/);
  assert.match(common, /data-expense-recurrence/);
  assert.match(common, />매달 유지<\/option>/);
  assert.match(common, />이번 달 입력<\/option>/);
  assert.match(common, /row\.querySelector\('\[data-expense-recurrence\]'\)\?\.value/);
  assert.match(materialsModeMigration, /v_item\.system_key='materials'/);
  assert.match(materialsModeMigration, /v_recurrence not in \('recurring','monthly'\)/);
  assert.match(materialsModeMigration, /set recurrence_mode=v_recurrence/);
});

test('mobile payroll workday cards keep day count and hours on one large row', () => {
  assert.match(common, /class="olliPayrollDayHours"/);
  assert.match(css, /\.olliPayrollDayField\{display:grid;grid-template-columns:minmax\(0,1fr\) auto;align-items:center;min-height:70px/);
  assert.match(css, /\.olliPayrollDayLabel\{grid-column:auto;margin:0;font-size:19px/);
  assert.match(css, /\.olliPayrollDayField input\{width:48px;text-align:right;font-size:22px/);
});

test('mobile month control is a button with a full-width picker below it', () => {
  assert.match(common, /data-payroll-month-toggle/);
  assert.match(common, /data-payroll-month-picker/);
  assert.match(common, /function bindMonthPicker\(body\)/);
  assert.match(common, /data-payroll-year-step/);
  assert.match(common, /data-payroll-month-option/);
  assert.match(css, /\.olliPayrollMonthToggle\{display:inline-flex/);
  assert.match(css, /\.olliPayrollMonthPicker:not\(\[hidden\]\)\{position:absolute;left:0;right:0;top:calc\(100% \+ 12px\)/);
});
