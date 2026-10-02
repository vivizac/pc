'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const router=require('../packages/common/olli-command-router-common.js');
const classifier=require('../packages/common/olli-team-talk-agent-route-common.js');

const root=path.resolve(__dirname,'..');
const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const pcManifest=JSON.parse(fs.readFileSync(path.join(root,'packages/common/pc-runtime-manifest.json'),'utf8'));
const mobileManifest=JSON.parse(fs.readFileSync(path.join(root,'packages/common/mobile-runtime-manifest.json'),'utf8'));

function classify(text){
  return classifier.classify(text,{router});
}

test('shared classifier is staged for both PC and Mobile runtime',()=>{
  assert.ok(pcManifest.files.includes('olli-team-talk-agent-route-common.js'));
  assert.ok(mobileManifest.files.includes('olli-team-talk-agent-route-common.js'));
});

test('classifier exposes one canonical route order and API',()=>{
  assert.equal(typeof classifier.classify,'function');
  assert.equal(new Set(classifier.ROUTE_KEYS).size,classifier.ROUTE_KEYS.length);
  assert.deepEqual(classifier.ROUTE_KEYS.slice(0,4),[
    'attendance_status','timetable_admin','batch_write','timetable_memo'
  ]);
  assert.ok(classifier.ROUTE_KEYS.includes('timetable_read'));
  assert.ok(classifier.ROUTE_KEYS.includes('schedule_read'));
});

test('PC and Mobile currently expose the same Agent route families before wiring',()=>{
  const pcFamilies=[
    /AttendanceStatusAgentCandidate/,
    /TimetableAdminAgentCandidate/,
    /BatchAgentCandidate/,
    /TimetableMemoAgentCandidate/,
    /TrialAddAgentCandidate/,
    /TrialCancelAgentCandidate/,
    /TrialUpdateAgentCandidate/,
    /WaitlistAddAgentCandidate/,
    /WaitlistUpdateAgentCandidate/,
    /WaitlistCancelAgentCandidate/,
    /MakeupAddAgentCandidate/,
    /MakeupCancelAgentCandidate/,
    /MakeupUpdateAgentCandidate/,
    /PickupAddAgentCandidate/,
    /PickupCancelAgentCandidate/,
    /PickupUpdateAgentCandidate/,
    /AbsenceAgentCandidate/,
    /ClassOnceAgentCandidate/,
    /MoveAgentCandidate/,
    /MoveCancelAgentCandidate/,
    /TimetableReadAgentCandidate/,
    /StudentAttendanceReadCandidate/,
    /StudentPickupReadCandidate/,
    /StudentScheduleReadCandidate/,
  ];
  for(const pattern of pcFamilies){
    assert.match(pc,pattern);
    assert.match(mobile,pattern);
  }
});

test('representative writes map to one shared route key',()=>{
  const cases=[
    ['민수 초등부 10월 5일 4시 체험 등록해줘','trial_add'],
    ['민수 10월 5일 체험 취소해줘','trial_cancel'],
    ['민수 화요일 4시 대기 등록해줘','waitlist_add'],
    ['민수 화요일 4시 픽업 등록해줘','pickup_add'],
    ['민수 10월 6일 4시 보강 등록해줘','makeup_add'],
    ['민수 10월 6일 4시 수업 등록해줘','class_once'],
    ['민수 화요일 4시에서 목요일 5시로 수업 이동해줘','move'],
    ['민수 오늘 4시 수업 결석 처리해줘','absence'],
    ['민수 오늘 4시 출석부를 출석으로 표시해줘','attendance_status'],
  ];
  for(const [input,key] of cases){
    assert.equal(classify(input)?.key,key,input);
  }
});

test('trial add without division intentionally stays outside Agent route',()=>{
  assert.notEqual(classify('민수 10월 5일 4시 체험 등록해줘')?.key,'trial_add');
});

test('representative reads share one classifier across PC and Mobile',()=>{
  const cases=[
    ['오늘 초등부 4시 빈자리 알려줘','timetable_read'],
    ['민수 출결 내역 알려줘','attendance_read'],
    ['민수 픽업 일정 알려줘','pickup_read'],
    ['민수 수업 언제야?','schedule_read'],
  ];
  for(const [input,key] of cases){
    assert.equal(classify(input)?.key,key,input);
  }
});

test('classifier returns parsed candidate so platform dispatch will not need to reparse',()=>{
  const result=classify('민수 오늘 4시 출석부를 결석으로 표시해줘');
  assert.equal(result.key,'attendance_status');
  assert.equal(result.parsed.intent,'set_attendance_status');
  assert.equal(result.mode,'attendance_status_prepare');
});

test('unknown/general conversation remains a miss for legacy/general fallback observation',()=>{
  assert.equal(classify('오늘 기분이 어때?'),null);
});

test('classifier does not own Mobile-only UI adapters',()=>{
  assert.doesNotMatch(fs.readFileSync(path.join(root,'packages/common/olli-team-talk-agent-route-common.js'),'utf8'),/open_student_info|makeupAddDraft|학생정보/);
});
