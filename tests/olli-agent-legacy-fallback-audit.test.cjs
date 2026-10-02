'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.resolve(__dirname,'..');
const router=require('../packages/common/olli-command-router-common.js');
const classifier=require('../packages/common/olli-team-talk-agent-route-common.js');
const pc=fs.readFileSync(path.join(ROOT,'apps','pc','pc-team-talk.js'),'utf8');
const mobile=fs.readFileSync(path.join(ROOT,'apps','mobile','olli-talk-beta.js'),'utf8');

function classify(text){
  return classifier.classify(text,{router});
}

function functionSlice(source,startToken,endToken){
  const start=source.indexOf(startToken);
  assert.ok(start>=0,'missing start token: '+startToken);
  const end=source.indexOf(endToken,start);
  assert.ok(end>start,'missing end token: '+endToken);
  return source.slice(start,end);
}

test('divisionless trial add is an intentional live legacy write dependency',()=>{
  const input='민수 10월 5일 4시 체험 등록해줘';
  const legacy=router.classifyRequest(input);
  assert.equal(legacy.type,'mutation');
  assert.equal(legacy.intent,'add_trial');
  assert.equal(legacy.parsed.division,'');
  assert.equal(classify(input),null);
});

test('reason-required writes intentionally fall through to legacy reason prompting when reason is missing',()=>{
  const cases=[
    ['민수 오늘 4시 수업 결석 처리해줘','absence'],
    ['민수 10월 5일 체험 취소해줘','trial_cancel'],
    ['민수 10월 5일 보강 취소해줘','makeup_cancel'],
  ];
  for(const [input,key] of cases){
    const route=classify(input);
    assert.equal(route?.key,key,input);
    assert.equal(String(route?.parsed?.reason || '').trim(),'',input);
  }

  const pcDispatch=functionSlice(
    pc,
    'async function resolveSharedAgentRouteTurn',
    'async function resolveAiTurn'
  );
  const mobileDispatch=functionSlice(
    mobile,
    'async function resolveOlliTalkSharedAgentRouteTurn',
    'async function resolveOlliTalkAiTurn'
  );

  for(const source of [pcDispatch,mobileDispatch]){
    assert.match(source,/case 'trial_cancel':[\s\S]*?return null/);
    assert.match(source,/case 'makeup_cancel':[\s\S]*?return null/);
    assert.match(source,/case 'absence':[\s\S]*?return null/);
  }
});

test('legacy parser-recognized reads are already classified before runQuery fallback',()=>{
  const cases=[
    ['오늘 초등부 4시 빈자리 알려줘','find_available_slots'],
    ['오늘 4시 체험 학생 누구야?','find_roster_entries'],
    ['오늘 4시 픽업 누구 있어?','find_pickups'],
    ['월요일 4시 자리하고 화요일 5시 자리 알려줘','multi_read_query'],
  ];

  for(const [input,intent] of cases){
    const parsed=router.parseQueryIntent(input);
    assert.equal(parsed?.intent,intent,input);
    const route=classify(input);
    assert.equal(route?.key,'timetable_read',input);
    assert.equal(route?.parsed?.intent,intent,input);
  }
});

test('AI mode keeps shared Agent dispatch before legacy executor on both platforms',()=>{
  const pcTurn=functionSlice(pc,'async function resolveAiTurn','function updateComposerState');
  const mobileTurn=functionSlice(mobile,'async function resolveOlliTalkAiTurn','function getOlliTalkMentionMessageText');

  for(const source of [pcTurn,mobileTurn]){
    const classifyPos=source.indexOf('routeClassifier.classify(commandText,{router})');
    const preparePos=source.indexOf('router.prepareAction(commandText');
    const queryPos=source.indexOf('router.runQuery(commandText');
    assert.ok(classifyPos>=0);
    assert.ok(preparePos>classifyPos);
    assert.ok(queryPos>preparePos);
  }
});

test('reply-button suggested query remains an intentional legacy dependency before general chat',()=>{
  const pcTurn=functionSlice(pc,'async function resolveAiTurn','function updateComposerState');
  const mobileTurn=functionSlice(mobile,'async function resolveOlliTalkAiTurn','function getOlliTalkMentionMessageText');

  for(const source of [pcTurn,mobileTurn]){
    const suggestedPos=source.indexOf('runSuggestedQuery(commandText');
    const generalPos=source.indexOf('resolveAiReply(rawCommandText');
    const mobileGeneralPos=source.indexOf('resolveOlliTalkAiReply(rawCommandText');
    const fallbackPos=generalPos>=0 ? generalPos : mobileGeneralPos;
    assert.ok(suggestedPos>=0);
    assert.ok(fallbackPos>suggestedPos);
  }
});

test('Mobile-only student info and makeup draft adapters remain outside shared/legacy executor ownership',()=>{
  const turn=functionSlice(mobile,'async function resolveOlliTalkAiTurn','function getOlliTalkMentionMessageText');
  const dispatchPos=turn.indexOf('resolveOlliTalkSharedAgentRouteTurn');
  const draftPos=turn.indexOf('parseOlliTalkMakeupAddDraftCandidate',dispatchPos);
  const studentInfoPos=turn.indexOf('resolveOlliTalkStudentInfoCommand',draftPos);
  const preparePos=turn.indexOf('router.prepareAction(commandText',studentInfoPos);
  assert.ok(dispatchPos>=0);
  assert.ok(draftPos>dispatchPos);
  assert.ok(studentInfoPos>draftPos);
  assert.ok(preparePos>studentInfoPos);
});
