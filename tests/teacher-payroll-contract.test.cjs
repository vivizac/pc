const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const migration = [
  read('supabase/migrations/20261006150241_teacher_payroll_calculator.sql'),
  read('supabase/migrations/20261006153614_harden_owner_roles_and_payroll_cycle.sql'),
  read('supabase/migrations/20261007050000_teacher_payroll_active_workdays.sql')
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
    assert.match(html, /선생님 급여 계산/);
    assert.match(html, /openOlliTeacherPayrollSettings\(\)/);
    assert.match(html, /olli-teacher-payroll-common\.js/);
    assert.match(html, /olli-teacher-payroll-common\.css/);
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
  assert.match(pcHtml, /data-owner-only="true"[^>]*>[\s\S]{0,900}선생님 급여 계산/);
  assert.match(mobileHtml, /data-owner-only="true"[^>]*>[\s\S]{0,900}선생님 급여 계산/);
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

test('payroll counts only occupied teaching slots and preserves date substitute ownership', () => {
  assert.match(migration, /active_slots as \(/);
  assert.match(migration, /public\.olli_schedule_enrollments e/);
  assert.match(migration, /e\.effective_from<=rd\.session_date/);
  assert.match(migration, /public\.olli_schedule_one_time_sessions o/);
  assert.match(migration, /o\.status<>'cancelled'/);
  assert.match(migration, /when o\.id is not null then coalesce\(o\.teacher_member_id,override_member\.teacher_member_id\)/);
  assert.match(migration, /else coalesce\(ct\.teacher_member_id,class_member\.teacher_member_id\)/);
});
