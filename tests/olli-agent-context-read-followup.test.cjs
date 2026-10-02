'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  normalizeMentionConversation,
  resolveContextualReadRewrite,
  studentLabel,
} = require('../apps/mobile/api/_lib/olli-agent/context-route.cjs');

test('active mention conversation keeps every valid user/assistant turn without truncation', () => {
  const source=[];
  for(let i=0;i<20;i+=1){
    source.push({role:'user',content:'질문 '+i});
    source.push({role:'assistant',content:'답변 '+i});
  }
  const result=normalizeMentionConversation(source);
  assert.equal(result.length,40);
  assert.deepEqual(result[0],{role:'user',text:'질문 0'});
  assert.deepEqual(result[39],{role:'assistant',text:'답변 19'});
});

test('student pseudonyms continue beyond Z for a long mention conversation', () => {
  assert.equal(studentLabel(0),'학생A');
  assert.equal(studentLabel(25),'학생Z');
  assert.equal(studentLabel(26),'학생AA');
  assert.equal(studentLabel(27),'학생AB');
});

test('context resolver anonymizes the full active mention conversation and restores standalone follow-up', async () => {
  let observed=null;
  const conversation=[
    {role:'user',content:'테스트 학생의 시간표를 알려줘'},
    {role:'assistant',content:'2026-10-02 기준으로 테스트 학생의 정규 수업이 없습니다.'},
  ];
  for(let i=0;i<12;i+=1){
    conversation.push({role:'user',content:'중간 질문 '+i});
    conversation.push({role:'assistant',content:'중간 답변 '+i});
  }

  const result=await resolveContextualReadRewrite({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:99,
    currentMessage:'테스트2학생은?',
    conversation,
    loadStudents:async()=>[
      {id:'student-1',name:'테스트 학생'},
      {id:'student-2',name:'테스트2학생'},
    ],
    modelRunner:async(input)=>{
      observed=input;
      return '학생B의 시간표를 알려줘';
    },
  });

  assert.ok(observed);
  assert.match(observed.transcript,/학생A/);
  assert.doesNotMatch(observed.transcript,/테스트 학생/);
  assert.match(observed.transcript,/중간 질문 11/);
  assert.match(observed.currentText,/학생B/);
  assert.doesNotMatch(observed.currentText,/테스트2학생/);
  assert.equal(result.usedContext,true);
  assert.equal(result.resolvedText,'테스트2학생의 시간표를 알려줘');
});

test('context resolver does not call AI without an active mention conversation containing an Olli reply', async () => {
  let called=false;
  const result=await resolveContextualReadRewrite({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:2,
    currentMessage:'테스트2학생은?',
    conversation:[
      {role:'user',content:'테스트 학생 시간표 알려줘'},
    ],
    loadStudents:async()=>[],
    modelRunner:async()=>{
      called=true;
      return 'should not run';
    },
  });

  assert.equal(called,false);
  assert.equal(result.usedContext,false);
  assert.equal(result.resolvedText,'테스트2학생은?');
});

test('PC and Mobile record every AI turn while their persistent Olli conversation is active', () => {
  const root=path.resolve(__dirname,'..');
  const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
  const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');

  assert.doesNotMatch(mobile,/olliTalkAiConversationMessages\.slice\(-12\)/);
  assert.match(
    mobile,
    /recordOlliTalkAiConversationTurn\(commandText, turn\.replyText\);/
  );
  assert.match(
    pc,
    /recordAiConversationTurn\(commandText, turn\.replyText\);/
  );
  assert.match(mobile,/conversation:olliTalkAiConversationMessages\.map/);
  assert.match(pc,/conversation:state\.aiConversationMessages\.map/);
});
