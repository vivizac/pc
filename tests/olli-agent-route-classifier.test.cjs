'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const router=require('../packages/common/olli-command-router-common.js');
const classifier=require('../packages/common/olli-team-talk-agent-route-common.js');

function classify(text){
  return classifier.classify(text,{router});
}

test('classifier exposes only current Agent routes',()=>{
  assert.deepEqual(classifier.ROUTE_KEYS,[
    'attendance_status','attendance_read','pickup_read'
  ]);
});

test('attendance status remains Agent-routed',()=>{
  const result=classify('민수 오늘 4시 출석부를 결석으로 표시해줘');
  assert.equal(result?.key,'attendance_status');
  assert.equal(result?.parsed?.intent,'set_attendance_status');
  assert.equal(result?.mode,'attendance_status_prepare');
});

test('student attendance and pickup history remain Agent reads',()=>{
  assert.equal(classify('민수 출결 내역 알려줘')?.key,'attendance_read');
  assert.equal(classify('민수 픽업 일정 알려줘')?.key,'pickup_read');
});

test('deterministic routine operations are not Agent-classified',()=>{
  const cases=[
    '민수 초등부 10월 5일 4시 체험 등록해줘',
    '민수 10월 5일 체험 취소해줘',
    '민수 화요일 4시 대기 등록해줘',
    '민수 화요일 4시 픽업 등록해줘',
    '민수 10월 6일 4시 보강 등록해줘',
    '민수 화요일 4시에서 목요일 5시로 수업 이동해줘',
    '오늘 초등부 4시 빈자리 알려줘',
    '민수 수업 언제야?'
  ];
  for(const input of cases) assert.equal(classify(input),null,input);
});

test('general conversation remains a classifier miss',()=>{
  assert.equal(classify('오늘 기분이 어때?'),null);
});
