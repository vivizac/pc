'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const server=read('apps/mobile/olli-consultation-mobile-runtime.js');
const legacy=read('apps/mobile/olli-settings-server-sync.js');
const html=read('apps/mobile/index.html');

test('both real mobile scripts parse together, exactly as loaded in index.html',()=>{
  const first=html.indexOf('src="olli-consultation-mobile-runtime.js');
  const second=html.indexOf('src="olli-settings-server-sync.js');
  assert.ok(first>=0&&second>first,'Scripts must be checked in browser load order');
  assert.doesNotThrow(()=>new vm.Script(server+'\n'+legacy,{filename:'mobile-consultation-runtime-and-original-dashboard.js'}));
});
test('mobile runtime only synchronizes rules and academy todos; no consultation completion',()=>{
  assert.doesNotMatch(server,/setCompleted|toggleAcademyConsultationCompleted/);
  assert.match(server,/window\.OlliConsultationServer\.readProgress\(/);
  assert.match(server,/window\.OlliConsultationServer\.readRules\(/);
  assert.doesNotMatch(legacy,/function\s+(?:getOlliConsultationProgress|normalizeOlliConsultationProgress|loadOlliConsultationRulesFromServer|loadOlliConsultationProgressFromServer|toggleAcademyConsultationCompleted)\s*\(/);
  assert.doesNotMatch(legacy,/let olliConsultationProgressRefreshPromise/);
});
test('restore original cards with unchanged HTML/CSS and shared feedback-month sync',()=>{
  assert.match(legacy,/function renderRecordAcademyManagementDashboard\(\)/);
  assert.match(legacy,/function renderAcademyConsultationList\(students\)/);
  assert.match(legacy,/recordAcademyStatGrid/);
  assert.match(legacy,/recordAcademyListItem recordAcademyConsultListItem/);
  assert.doesNotMatch(legacy,/consultationBtn|toggleAcademyConsultationCompleted/);
  assert.match(legacy,/function bindOlliGroupFeedbackMonthsSyncOnce\(\)/);
  assert.match(html,/olli-settings-server-sync\.js\?v=20261024-month-only-1/);
});
test('display original dashboard immediately without waiting for the server',()=>{
  const start=legacy.indexOf('function renderAcademyConsultationList(students){');
  assert.ok(start>=0);
  const source=legacy.slice(start);
  const node={innerHTML:''};
  const sandbox={
    document:{getElementById:id=>id==='recordAcademyDashboard'?node:null},
    getAcademyManagementStudentsForStats:()=>[],
    isAcademyManagementActiveStudent:()=>false,
    getStudentStatus:()=>'inactive',
    getStudentEnrollmentDateForStats:()=>null,
    getStudentWithdrawalDateForStats:()=>null,
    isCurrentYearDate:()=>false,
    isCurrentMonthYear:()=>false,
    getThisMonthConsultationDueStudents:()=>[],
    buildAcademyStatCard:(label)=>'<div class="recordAcademyStatCard">'+label+'</div>',
    window:{OlliConsultationMessages:{isOwner:()=>false}},
    escapeHtml:v=>String(v),
    Date
  };
  vm.runInNewContext(source+'\nrenderRecordAcademyManagementDashboard();',sandbox);
  assert.match(node.innerHTML,/recordAcademyStatGrid/);
  assert.match(node.innerHTML,/recordAcademyConsultSection/);
  assert.match(node.innerHTML,/이번 달 상담 예정 학생이 없습니다/);
});
