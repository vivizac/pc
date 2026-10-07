const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const activeWorkdayMigration = read('supabase/migrations/20261007052135_teacher_payroll_active_workdays.sql');
const substitutePayrollMigration = read('supabase/migrations/20261007171000_teacher_payroll_substitute_slot_hours.sql');
const finalizedPayrollMigration = read('supabase/migrations/20261007172000_teacher_payroll_finalized_periods.sql');
const monthlyPayoutMigration = read('supabase/migrations/20261007202000_teacher_payroll_monthly_payout_snapshots.sql');
const freelancerStatementMigration = read('supabase/migrations/20261007230500_teacher_payroll_freelancer_statements.sql');
const migration = [
  read('supabase/migrations/20261006150241_teacher_payroll_calculator.sql'),
  read('supabase/migrations/20261006153614_harden_owner_roles_and_payroll_cycle.sql'),
  activeWorkdayMigration,
  substitutePayrollMigration,
  finalizedPayrollMigration,
  monthlyPayoutMigration,
  freelancerStatementMigration
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
    assert.match(html, /olli-teacher-payroll-common\.js\?v=20261007-payroll-statement-1/);
    assert.match(html, /olli-teacher-payroll-common\.css\?v=20261007-payroll-statement-1/);
  }
});

test('team chat payroll statement opens only through the private statement RPC', () => {
  assert.match(common, /function isPayrollMessage\(item\)/);
  assert.match(common, /button\.textContent='급여명세서 보기'/);
  assert.match(common, /olli_teacher_payroll_statement_get/);
  assert.match(common, /function renderPayrollStatementModal\(payload\)/);
  const start = common.indexOf('function createTeamChatPayrollButton');
  const end = common.indexOf('\n  async function syncDueNotifications', start);
  assert.ok(start >= 0 && end > start);
  const statementCode = common.slice(start, end);
  assert.doesNotMatch(statementCode, /localStorage|sessionStorage/);
  assert.match(pcChat, /createTeamChatPayrollButton\(item,\s*'pc'\)/);
  assert.match(mobileChat, /createTeamChatPayrollButton\(item,\s*'mobile'\)/);
});

test('leaving and reopening Team Chat rebuilds payroll statement buttons from server messages', () => {
  assert.match(pcChat, /async function open\(\)[\s\S]*loadMessages\(\{ showLoading: true, followBottom: true \}\)/);
  assert.match(mobileChat, /async function openOlliTalkBetaPage\(event\)[\s\S]*renderOlliTalkServerMessages\(openCachedPayload/);
  assert.match(common, /button\.textContent='급여명세서 보기'/);
});


test('new payroll statements are visible only to the target teacher while legacy notices stay owner-only', () => {
  assert.match(freelancerStatementMigration, /statement_message_version smallint not null default 0/);
  assert.match(freelancerStatementMigration, /statement_message_version=1/);
  assert.match(freelancerStatementMigration, /n\.statement_message_version>=1[\s\S]*n\.teacher_member_id=p_member_id/);
  assert.match(freelancerStatementMigration, /n\.statement_message_version=0[\s\S]*p_member_role='owner'/);
  assert.match(freelancerStatementMigration, /olli_team_chat_message_visible_to_member/);
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


test('monthly salary and freelancer withholding are saved through payroll v3', () => {
  assert.match(migration, /monthly_salary bigint not null default 0/);
  assert.match(freelancerStatementMigration, /deduction_mode text not null default 'none'/);
  assert.match(freelancerStatementMigration, /olli_teacher_payroll_setting_upsert_v3/);
  assert.match(common, /data-payroll-monthly-salary/);
  assert.match(common, /data-payroll-deduction-mode/);
  assert.match(common, /프리랜서 3\.3%/);
  assert.match(common, /olli_teacher_payroll_setting_upsert_v3/);
  assert.match(common, /p_deduction_mode:deductionMode/);
  assert.match(common, /Math\.round\(grossAmount\*0\.033\)/);
  assert.doesNotMatch(common, /4대보험/);
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

test('payroll periods keep a private immutable snapshot after payday', () => {
  assert.match(finalizedPayrollMigration, /create table if not exists private\.olli_teacher_payroll_periods/);
  assert.match(finalizedPayrollMigration, /snapshot jsonb not null/);
  assert.match(finalizedPayrollMigration, /finalized_at timestamptz/);
  assert.match(finalizedPayrollMigration, /unique \(academy_id,teacher_member_id,payroll_month\)/);
  assert.match(finalizedPayrollMigration, /alter table private\.olli_teacher_payroll_periods enable row level security/);
  assert.match(finalizedPayrollMigration, /revoke all on table private\.olli_teacher_payroll_periods from public,anon,authenticated/);
});

test('payday cron refreshes the open snapshot and freezes it on the following day', () => {
  assert.match(finalizedPayrollMigration, /olli_teacher_payroll_period_capture/);
  assert.match(finalizedPayrollMigration, /Keep today's payroll period fresh through the pay date/);
  assert.match(finalizedPayrollMigration, /p\.pay_date<v_today/);
  assert.match(finalizedPayrollMigration, /finalized_at=coalesce\(p\.finalized_at,now\(\)\)/);
  assert.match(finalizedPayrollMigration, /where private\.olli_teacher_payroll_periods\.finalized_at is null/);
});

test('missed payout snapshots are backfilled after the payout date and then frozen', () => {
  assert.match(monthlyPayoutMigration, /v_candidate_pay_date<v_today/);
  assert.match(monthlyPayoutMigration, /not exists \([\s\S]*private\.olli_teacher_payroll_periods/);
  assert.match(monthlyPayoutMigration, /olli_teacher_payroll_period_capture/);
  assert.match(monthlyPayoutMigration, /finalized_at=coalesce\(p\.finalized_at,now\(\)\)/);
});

test('future payout month is presented as an estimate while paid months use payout wording', () => {
  assert.match(common, /function selectedMonthIsFuture\(\)/);
  assert.match(common, /지급 예정/);
  assert.match(common, /예상 총지출/);
  assert.match(common, /function payrollAmountLabel\(teacher\)/);
  assert.match(common, /지급 급여/);
  assert.match(common, /historical_payroll_unfinalized/);
});

test('historical payroll overview prefers finalized snapshots and preserves former teachers', () => {
  assert.match(finalizedPayrollMigration, /period_candidates as \(/);
  assert.match(finalizedPayrollMigration, /select p\.teacher_member_id[\s\S]*from private\.olli_teacher_payroll_periods p/);
  assert.match(finalizedPayrollMigration, /when p\.finalized_at is not null then[\s\S]*p\.snapshot/);
  assert.match(finalizedPayrollMigration, /'snapshot_status','finalized'/);
  assert.match(finalizedPayrollMigration, /'historical_payroll_unfinalized'/);
});

test('ordinary payroll setting save is blocked for a finalized historical month', () => {
  assert.match(finalizedPayrollMigration, /확정된 과거 급여는 일반 급여 설정 저장으로 변경할 수 없습니다/);
  assert.match(finalizedPayrollMigration, /p\.payroll_month=v_month[\s\S]*p\.finalized_at is not null/);
  assert.match(common, /data-payroll-finalized=/);
  assert.match(common, /if\(card\.dataset\.payrollFinalized==='1'\) return false/);
  assert.match(common, /olliPayrollFinalizedBadge/);
  assert.match(common, /급여 확정/);
  assert.match(common, /확정됨/);
});

test('payroll notification mention uses the actual message-member primary key', () => {
  assert.match(finalizedPayrollMigration, /on conflict \(message_id,member_id\) do nothing/);
  assert.doesNotMatch(finalizedPayrollMigration, /on conflict \(academy_id,message_id,member_id\)/);
});



test('payday statement is scheduled for 10 AM Korea time and created once per teacher-month', () => {
  assert.match(freelancerStatementMigration, /olli-teacher-payroll-statement-10am/);
  assert.match(freelancerStatementMigration, /'0 1 \* \* \*'/);
  assert.match(freelancerStatementMigration, /olli_teacher_payroll_send_due_statements/);
  assert.match(freelancerStatementMigration, /if v_notification\.id is null or v_notification\.message_id is not null then/);
  assert.match(freelancerStatementMigration, /10월|급여 지급 안내|급여 지급 안내/);
});

test('payroll statement shows regular and substitute dates with holiday and absence states', () => {
  assert.match(freelancerStatementMigration, /'regular_days',v_regular_days/);
  assert.match(freelancerStatementMigration, /'substitute_days',v_substitute_days/);
  assert.match(freelancerStatementMigration, /when r\.is_holiday then 'holiday'/);
  assert.match(freelancerStatementMigration, /then 'absent'/);
  assert.match(common, /olliPayrollStatementDate holiday/);
  assert.match(common, /olliPayrollStatementDate absent/);
  assert.match(common, /공휴일/);
  assert.match(common, /결근일/);
  assert.match(common, /workedRows\.length\+'회 · '\+statementHours\(totalHours\)\+'시간'/);
});

test('payday edits remain live through the pay date and freeze on the following day', () => {
  assert.match(freelancerStatementMigration, /if v_pay_date=v_today then[\s\S]*olli_teacher_payroll_notification_refresh/);
  assert.match(freelancerStatementMigration, /지급일 다음 날 첫 동기화 때 한 번 더 최신 계산을 저장한 뒤 고정합니다/);
  assert.match(freelancerStatementMigration, /p\.pay_date<v_today/);
  assert.match(freelancerStatementMigration, /finalized_at=coalesce\(p\.finalized_at,now\(\)\)/);
});
