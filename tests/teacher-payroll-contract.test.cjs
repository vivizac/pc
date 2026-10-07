const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const activeWorkdayMigration = read('supabase/migrations/20261007052135_teacher_payroll_active_workdays.sql');
const substitutePayrollMigration = read('supabase/migrations/20261007171000_teacher_payroll_substitute_slot_hours.sql');
const migration = [
  read('supabase/migrations/20261006150241_teacher_payroll_calculator.sql'),
  read('supabase/migrations/20261006153614_harden_owner_roles_and_payroll_cycle.sql'),
  activeWorkdayMigration,
  substitutePayrollMigration
].join('\n');
const common = read('packages/common/olli-teacher-payroll-common.js');
const pcHtml = read('apps/pc/index.html');
const mobileHtml = read('apps/mobile/index.html');
const pcChat = read('apps/pc/pc-team-talk.js');
const mobileChat = read('apps/mobile/olli-talk-beta.js');

test('payroll data stays in private schema and amount lookup is owner-gated', () => {
  assert.match(migration, /create table if not exists private\.olli_teacher_payroll_settings/);
  assert.match(migration, /create table if not exists private\.olli_teacher_payroll_notifications/);
  assert.match(migration, /m\.role='owner'/);
  assert.match(migration, /급여 금액은 원장만 확인할 수 있습니다/);
  assert.doesNotMatch(migration, /format\([^\n]*amount/);
});

test('workday calculation resolves modern member ids and legacy teacher-name assignments', () => {
  assert.match(migration, /coalesce\(o\.teacher_member_id,override_member\.teacher_member_id\)/);
  assert.match(migration, /coalesce\(ct\.teacher_member_id,class_member\.teacher_member_id\)/);
  assert.match(migration, /trim\(m\.display_name\)=trim\(ct\.teacher_name\)/);
  assert.match(migration, /trim\(m\.display_name\)=trim\(o\.teacher_name\)/);
  assert.match(migration, /where rd\.is_holiday=false/);
});

test('payroll overview excludes non-teaching shared accounts unless explicitly configured', () => {
  assert.match(migration, /s\.teacher_member_id is not null[\s\S]*olli_schedule_class_teachers[\s\S]*olli_schedule_teacher_overrides/);
});

test('payday sync refreshes the amount snapshot without creating duplicate chat messages', () => {
  assert.match(migration, /on conflict \(academy_id,teacher_member_id,payroll_month\)[\s\S]*do update set[\s\S]*amount=excluded\.amount/);
  assert.match(migration, /returning id,message_id into v_notification_id,v_message_id/);
  assert.match(migration, /if v_message_id is not null then continue; end if/);
  assert.match(migration, /'olli-teacher-payroll-hourly'[\s\S]*'7 \* \* \* \*'/);
  assert.match(migration, /insert into public\.olli_team_chat_mentions[\s\S]*m\.role='owner'/);
  assert.doesNotMatch(migration, /vault\.decrypted_secrets|net\.http_post|insert into public\.olli_team_chat_bot_events/);
});

test('settings entry and shared runtime are wired on PC and mobile', () => {
  for (const html of [pcHtml, mobileHtml]) {
    assert.match(html, /급여 및 지출 관리/);
    assert.match(html, /openOlliTeacherPayrollSettings\(\)/);
    assert.match(html, /olli-teacher-payroll-common\.js\?v=20261007-finance-1/);
    assert.match(html, /olli-teacher-payroll-common\.css\?v=20261007-finance-1/);
  }
});

test('team chat salary reveal is transient and owner-only', () => {
  assert.match(common, /function isPayrollMessage\(item\)/);
  assert.match(common, /if\(!isOwner\(\)\) return false/);
  assert.match(common, /button\.textContent='선생님 급여'/);
  assert.match(common, /button\.dataset\.revealed='0'/);
  assert.match(common, /olli_teacher_payroll_notification_amount_get/);
  const start = common.indexOf('function createTeamChatPayrollButton');
  const end = common.indexOf('\n  async function syncDueNotifications', start);
  assert.ok(start >= 0 && end > start);
  const revealCode = common.slice(start, end);
  assert.doesNotMatch(revealCode, /localStorage|sessionStorage/);
  assert.match(pcChat, /createTeamChatPayrollButton\(item,\s*'pc'\)/);
  assert.match(mobileChat, /createTeamChatPayrollButton\(item,\s*'mobile'\)/);
});

test('leaving and reopening Team Chat rebuilds payroll buttons in the hidden state', () => {
  assert.match(pcChat, /async function open\(\)[\s\S]*loadMessages\(\{ showLoading: true, followBottom: true \}\)/);
  assert.match(mobileChat, /async function openOlliTalkBetaPage\(event\)[\s\S]*renderOlliTalkServerMessages\(openCachedPayload/);
  assert.match(common, /button\.dataset\.revealed='0'/);
});


test('payday reminders remain owner-only in Team Chat history while normal management messages stay unchanged', () => {
  assert.equal((migration.match(/private\.olli_teacher_payroll_notifications payroll_notice/g)||[]).length, 5);
  assert.match(migration, /v_member\.role='owner'[\s\S]*not exists \([\s\S]*payroll_notice\.message_id=msg\.id/);
});

test('payday date calculation clamps 29-31 to the actual last day of short months', () => {
  assert.match(migration, /least\(v_row\.payday,extract\(day from v_month_end\)::integer\)/);
});

test('settings row is hidden by the existing owner-only permission contract', () => {
  assert.match(pcHtml, /data-owner-only="true"[^>]*>[\s\S]{0,900}급여 및 지출 관리/);
  assert.match(mobileHtml, /data-owner-only="true"[^>]*>[\s\S]{0,900}급여 및 지출 관리/);
});

test('owner login sync is fallback protection in addition to database cron', () => {
  assert.match(common, /async function syncDueNotifications\(\)[\s\S]*!isOwner\(\)[\s\S]*olli_teacher_payroll_due_sync/);
  assert.match(common, /setTimeout\(\(\)=>\{ syncDueNotifications\(\); \},1200\)/);
});


test('monthly salary is editable and saved through the payroll v2 RPC', () => {
  assert.match(migration, /monthly_salary bigint not null default 0/);
  assert.match(migration, /olli_teacher_payroll_setting_upsert_v2/);
  assert.match(common, /data-payroll-monthly-salary/);
  assert.match(common, /olli_teacher_payroll_setting_upsert_v2/);
  assert.match(common, /p_monthly_salary:monthlySalary/);
  assert.match(common, /monthlySalary > 0 \? Math\.round\(monthlySalary\)/);
});

test('payroll period starts the day after the previous payday and ends on the current payday', () => {
  assert.match(activeWorkdayMigration, /v_period_start := \(v_prev_pay_date \+ interval '1 day'\)::date;/);
  assert.match(activeWorkdayMigration, /v_period_end := v_pay_date;/);
  assert.doesNotMatch(activeWorkdayMigration, /v_period_start := \(v_prev_pay_date - interval '1 day'\)::date;/);
});

test('payroll counts only occupied teaching slots and preserves date substitute ownership', () => {
  assert.match(migration, /active_slots as \(/);
  assert.match(migration, /public\.olli_schedule_enrollments e/);
  assert.match(migration, /e\.effective_from<=rd\.session_date/);
  assert.match(migration, /public\.olli_schedule_one_time_sessions o/);
  assert.match(migration, /o\.status<>'cancelled'/);
  assert.match(migration, /when o\.id is not null then coalesce\(o\.teacher_member_id,override_member\.teacher_member_id\)/);
  assert.match(migration, /else coalesce\(ct\.teacher_member_id,class_member\.teacher_member_id\)/);
});

test('teacher card shows the actual payroll period instead of calendar-month wording', () => {
  assert.match(common, /function payrollPeriodLabel\(teacher\)/);
  assert.match(common, /teacher\?\.period_start/);
  assert.match(common, /teacher\?\.period_end/);
  assert.match(common, /근무 <strong>'\+workdayCount\+'일<\/strong>/);
  assert.doesNotMatch(common, /이번 달 출근/);
});

test('payroll period presentation reuses server-calculated boundaries without client date math', () => {
  assert.match(migration, /'period_start',calc\.data->>'period_start'/);
  assert.match(migration, /'period_end',calc\.data->>'period_end'/);
  const start = common.indexOf('function payrollPeriodLabel');
  const end = common.indexOf('\n  function paydayOptions', start);
  assert.ok(start >= 0 && end > start);
  const labelCode = common.slice(start, end);
  assert.doesNotMatch(labelCode, /setDate|Date\(|getDate|payday/);
});

test('substitute payroll snapshots transfer the regular teacher slot share', () => {
  assert.match(substitutePayrollMigration, /add column if not exists payroll_hours numeric\(10,4\)/);
  assert.match(substitutePayrollMigration, /olli_teacher_payroll_override_snapshot/);
  assert.match(substitutePayrollMigration, /v_payroll_hours := round\(v_daily_hours \/ v_slot_count,4\)/);
  assert.match(substitutePayrollMigration, /payroll_source_weekday_hours/);
  assert.match(substitutePayrollMigration, /payroll_source_slot_count/);
  assert.match(substitutePayrollMigration, /payroll_snapshot_at/);
});

test('partial substitutions deduct only the transferred slot hours from the regular teacher', () => {
  assert.match(substitutePayrollMigration, /regular_slot_hours/);
  assert.match(substitutePayrollMigration, /snapshot_payroll_hours/);
  assert.match(substitutePayrollMigration, /coalesce\(a\.snapshot_payroll_hours,a\.regular_slot_hours\) as substitute_hours/);
  assert.match(substitutePayrollMigration, /a\.regular_teacher_member_id=p_teacher_member_id/);
  assert.match(substitutePayrollMigration, /a\.substitute_teacher_member_id=p_teacher_member_id/);
});

test('substitute work is added on top of the substitute teacher own regular work', () => {
  assert.match(substitutePayrollMigration, /sum\(t\.regular_hours\) as regular_hours/);
  assert.match(substitutePayrollMigration, /sum\(t\.substitute_hours\) as substitute_hours/);
  assert.match(substitutePayrollMigration, /sum\(c\.regular_hours\+c\.substitute_hours\)/);
  assert.match(substitutePayrollMigration, /'regular_hours',v_regular_hours/);
  assert.match(substitutePayrollMigration, /'substitute_hours',v_substitute_hours/);
});

test('substitute payroll warns instead of silently paying zero when settings are missing', () => {
  assert.match(substitutePayrollMigration, /'has_unpriced_substitute_work'/);
  assert.match(substitutePayrollMigration, /'substitute_wage_missing'/);
  assert.match(substitutePayrollMigration, /'substitute_hours_unresolved'/);
  assert.match(common, /function renderPayrollWarnings\(payroll\)/);
  assert.match(common, /대체 <strong>'\+hours\(substituteHours\)/);
  assert.match(common, /대체근무 급여 설정을 확인해 주세요/);
});

