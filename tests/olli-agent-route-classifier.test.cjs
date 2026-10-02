'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const router=require('../packages/common/olli-command-router-common.js');
const classifier=require('../packages/common/olli-team-talk-agent-route-common.js');

function classify(text){
  return classifier.classify(text,{router});
}

test('classifier exposes one canonical route order',()=>{
  assert.equal(typeof classifier.classify,'function');
  assert.equal(new Set(classifier.ROUTE_KEYS).size,classifier.ROUTE_KEYS.length);
  assert.deepEqual(classifier.ROUTE_KEYS.slice(0,4),[
    'attendance_status','timetable_admin','batch_write','timetable_memo'
  ]);
});

test('representative writes map to expected shared routes',()=>{
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

test('representative reads preserve current parser precedence',()=>{
  assert.equal(classify('오늘 초등부 4시 빈자리 알려줘')?.key,'timetable_read');
  assert.equal(classify('민수 출결 내역 알려줘')?.key,'attendance_read');
  assert.equal(classify('민수 픽업 일정 알려줘')?.key,'timetable_read');
  assert.equal(classifier.isStudentPickupReadCandidate('민수 픽업 일정 알려줘'),true);
  assert.equal(classify('민수 수업 언제야?')?.key,'schedule_read');
});

test('parsed write candidate is returned for future dispatch without reparsing',()=>{
  const result=classify('민수 오늘 4시 출석부를 결석으로 표시해줘');
  assert.equal(result.key,'attendance_status');
  assert.equal(result.parsed.intent,'set_attendance_status');
  assert.equal(result.mode,'attendance_status_prepare');
});

test('general conversation remains a classifier miss',()=>{
  assert.equal(classify('오늘 기분이 어때?'),null);
});
