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
function slice(source,start,end){
  const a=source.indexOf(start);
  const b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a);
  return source.slice(a,b);
}

test('routine write families no longer enter current Agent classifier',()=>{
  for(const input of [
    '민수 오늘 4시 수업 결석 처리해줘',
    '민수 10월 5일 체험 취소해줘',
    '민수 10월 5일 보강 취소해줘',
    '민수 초등부 10월 5일 4시 체험 등록해줘',
    '민수 화요일 4시 픽업 등록해줘'
  ]) assert.equal(classify(input),null,input);
});

test('structured reason-required paths run before Agent classifier on PC and Mobile',()=>{
  const pcTurn=slice(pc,'async function resolveAiTurn','function updateComposerState');
  const mobileTurn=slice(mobile,'async function resolveOlliTalkAiTurn','function getOlliTalkMentionMessageText');
  for(const source of [pcTurn,mobileTurn]){
    const classifierPos=source.indexOf('const routeClassifier=');
    assert.ok(classifierPos>=0);
    assert.ok(source.indexOf('cancel_makeup')>=0 && source.indexOf('cancel_makeup')<classifierPos);
    assert.ok(source.indexOf('cancel_trial')>=0 && source.indexOf('cancel_trial')<classifierPos);
  }
});

test('deterministic read families no longer enter Agent classifier',()=>{
  const cases=[
    ['오늘 초등부 4시 빈자리 알려줘','find_available_slots'],
    ['오늘 4시 체험 학생 누구야?','find_roster_entries'],
    ['오늘 4시 픽업 누구 있어?','find_pickups'],
    ['월요일 4시 자리하고 화요일 5시 자리 알려줘','multi_read_query']
  ];
  for(const [input,intent] of cases){
    assert.equal(router.parseQueryIntent(input)?.intent,intent,input);
    assert.equal(classify(input),null,input);
  }
});

test('reply-button suggested query remains before general chat fallback',()=>{
  for(const source of [
    slice(pc,'async function resolveAiTurn','function updateComposerState'),
    slice(mobile,'async function resolveOlliTalkAiTurn','function getOlliTalkMentionMessageText')
  ]){
    const suggested=source.indexOf('runSuggestedQuery(commandText');
    const general=Math.max(source.indexOf('resolveAiReply(rawCommandText'),source.indexOf('resolveOlliTalkAiReply(rawCommandText'));
    assert.ok(suggested>=0);
    assert.ok(general>suggested);
  }
});
