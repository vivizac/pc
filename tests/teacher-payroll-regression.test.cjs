'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const payroll=fs.readFileSync(path.join(root,'packages/common/olli-teacher-payroll-common.js'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261006134500_teacher_payroll_calculator.sql'),'utf8');
const pcTalk=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobileTalk=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const pcHtml=fs.readFileSync(path.join(root,'apps/pc/index.html'),'utf8');
const mobileHtml=fs.readFileSync(path.join(root,'apps/mobile/index.html'),'utf8');

function section(source,start,end){
  const from=source.indexOf(start);
  const to=source.indexOf(end,from+start.length);
  assert.ok(from>=0, start+' 시작점을 찾지 못했습니다.');
  assert.ok(to>from, end+' 끝점을 찾지 못했습니다.');
  return source.slice(from,to);
}

test('teacher payroll settings entry and runtime are owner-only on PC and mobile',()=>{
  assert.match(pcHtml,/data-owner-only="true"[^>]*>[\s\S]{0,900}선생님 급여 계산/);
  assert.match(mobileHtml,/data-owner-only="true"[^>]*>[\s\S]{0,900}선생님 급여 계산/);
  assert.match(pcHtml,/olli-teacher-payroll-common\.js\?v=/);
  assert.match(mobileHtml,/olli-teacher-payroll-common\.js\?v=/);
  assert.match(payroll,/function isOwner\(\)[\s\S]*role\(\) === 'owner'/);
});

test('payroll amount is not stored in Team Chat and is fetched only through owner-authorized RPC',()=>{
  const button=section(payroll,'function createTeamChatPayrollButton','async function syncDueNotifications');
  assert.match(button,/button\.textContent='선생님 급여'/);
  assert.match(button,/button\.dataset\.revealed='0'/);
  assert.match(button,/if\(button\.dataset\.revealed==='1'\)[\s\S]*button\.textContent='선생님 급여'/);
  assert.match(button,/olli_teacher_payroll_notification_amount_get/);
  assert.doesNotMatch(button,/localStorage\.setItem|sessionStorage\.setItem|indexedDB/);
  assert.match(migration,/if v_owner_id is null then raise exception '급여 금액은 원장만 확인할 수 있습니다\.'/);
});

test('payroll reveal control is attached below Olli Team Chat bubbles on both surfaces',()=>{
  assert.match(pcTalk,/OlliTeacherPayroll\?\.createTeamChatPayrollButton[\s\S]*content\.appendChild\(payrollButton\)/);
  assert.match(mobileTalk,/OlliTeacherPayroll\?\.createTeamChatPayrollButton[\s\S]*incomingLayout\.appendChild\(payrollButton\)/);
});

test('payday notification is idempotent and handles short months',()=>{
  assert.match(migration,/unique \(academy_id, teacher_member_id, payroll_month\)/);
  assert.match(migration,/returning id,message_id into v_notification_id,v_message_id;[\s\S]*if v_message_id is not null then continue; end if;/);
  assert.match(migration,/least\(v_row\.payday,extract\(day from v_month_end\)::integer\)/);
  assert.match(migration,/오늘은 %s %s월 급여일 입니다\./);
  assert.match(migration,/'7 \* \* \* \*'/);
});

test('payday reminder targets owners and stays hidden from managers in Team Chat history',()=>{
  assert.match(migration,/where m\.academy_id=v_row\.academy_id and m\.status='active' and m\.role='owner'/);
  assert.match(migration,/event_type='payroll_due'/);
  assert.equal((migration.match(/private\.olli_teacher_payroll_notifications payroll_notice/g)||[]).length,3);
  assert.match(migration,/v_member\.role='owner'[\s\S]*not exists \([\s\S]*payroll_notice\.message_id=msg\.id/);
});

test('owner login is only a fallback; scheduled payroll sync exists independently',()=>{
  assert.match(migration,/cron\.schedule\([\s\S]*'olli-teacher-payroll-hourly'[\s\S]*private\.olli_teacher_payroll_sync_due/);
  assert.match(payroll,/async function syncDueNotifications\(\)[\s\S]*!isOwner\(\)[\s\S]*olli_teacher_payroll_due_sync/);
  assert.match(payroll,/setTimeout\(\(\)=>\{ syncDueNotifications\(\); \},1200\)/);
});
