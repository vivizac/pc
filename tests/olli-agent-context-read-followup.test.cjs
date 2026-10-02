'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  normalizeMentionConversation,
  resolveContextualReadRewrite,
  resolveContextualMakeupRewrite,
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

test('makeup continuation restores B반 into the prior complete makeup request', async () => {
  let observed=null;
  const result=await resolveContextualMakeupRewrite({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:30,
    currentMessage:'B반',
    conversation:[
      {role:'user',content:'테스트2 학생 다음주 화요일 4시 보강 등록'},
      {role:'assistant',content:'A반과 B반 중 어느 반으로 보강을 진행할까요?'},
    ],
    loadStudents:async()=>[
      {id:'student-2',name:'테스트2 학생'},
    ],
    modelRunner:async(input)=>{
      observed=input;
      return '학생A 다음주 화요일 4시 B반 보강 등록';
    },
  });

  assert.ok(observed);
  assert.match(observed.transcript,/학생A 다음주 화요일 4시 보강 등록/);
  assert.match(observed.currentText,/B반/);
  assert.equal(result.usedContext,true);
  assert.equal(result.resolvedText,'테스트2 학생 다음주 화요일 4시 B반 보강 등록');
});

test('makeup continuation restores a changed date after a blocked makeup result', async () => {
  const result=await resolveContextualMakeupRewrite({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:31,
    currentMessage:'그럼 다다음주로 해줘',
    conversation:[
      {role:'user',content:'테스트 학생 다음주 월요일 5시에 보강 등록해줘'},
      {role:'assistant',content:'공휴일에는 보강을 등록할 수 없습니다.'},
    ],
    loadStudents:async()=>[
      {id:'student-1',name:'테스트 학생'},
    ],
    modelRunner:async()=> '학생A 다다음주 월요일 5시 보강 등록',
  });

  assert.equal(result.usedContext,true);
  assert.equal(result.resolvedText,'테스트 학생 다다음주 월요일 5시 보강 등록');
});

test('makeup continuation can reject an unrelated reply without hijacking general chat', async () => {
  const result=await resolveContextualMakeupRewrite({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:32,
    currentMessage:'오늘 비 와?',
    conversation:[
      {role:'user',content:'테스트 학생 다음주 화요일 4시 보강 등록'},
      {role:'assistant',content:'A반과 B반 중 어느 반으로 보강을 진행할까요?'},
    ],
    loadStudents:async()=>[
      {id:'student-1',name:'테스트 학생'},
    ],
    modelRunner:async()=> 'OLLI_CONTEXT_UNRELATED',
  });

  assert.equal(result.usedContext,false);
  assert.equal(result.resolvedText,'오늘 비 와?');
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


test('makeup context stays active for both clarification and recoverable blocked replies', () => {
  const root=path.resolve(__dirname,'..');
  const api=fs.readFileSync(path.join(root,'apps/mobile/api/olli-agent.js'),'utf8');
  const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
  const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');

  const branch=api.indexOf("if (mode === 'context_makeup_prepare')");
  const resolver=api.indexOf('resolveContextualMakeupRewrite',branch);
  const classify=api.indexOf("safeText(route?.key,40)!=='makeup_add'",branch);
  assert.ok(branch>=0 && resolver>branch && classify>resolver);
  assert.match(mobile,/olliTalkPendingMakeupDialogue=\{ active:true, status:interactionStatus \};/);
  assert.match(pc,/state\.pendingMakeupDialogue=\{ active:true, status:interactionStatus \};/);
});

test('contextual read is executed server-side after persisted source validation', () => {
  const root=path.resolve(__dirname,'..');
  const api=fs.readFileSync(path.join(root,'apps/mobile/api/olli-agent.js'),'utf8');
  const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
  const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');

  assert.match(api,/mode === 'context_read'/);
  const readBranch=api.indexOf("if (mode === 'context_read'");
  const validateIndex=api.indexOf('validatePickupSourceMessage({',readBranch);
  const resolveIndex=api.indexOf('resolveContextualReadRewrite({',readBranch);
  const privacyIndex=api.indexOf('prepareAgentReadPrivacyInput(',readBranch);
  assert.ok(readBranch>=0 && validateIndex>readBranch);
  assert.ok(resolveIndex>validateIndex);
  assert.ok(privacyIndex>resolveIndex);
  assert.match(api,/executionMessage=safeText\(resolved\.resolvedText,5000\)/);
  assert.match(api,/sourceMessageText:executionMessage/);

  assert.match(mobile,/mode:'context_read'/);
  assert.match(pc,/mode:'context_read'/);
  assert.doesNotMatch(
    mobile.slice(
      mobile.indexOf('async function resolveOlliTalkContextualReadTurn'),
      mobile.indexOf('function reportOlliTalkAiLegacyRouteOutcome')
    ),
    /routeClassifier\.classify/
  );
  assert.doesNotMatch(
    pc.slice(
      pc.indexOf('async function resolveContextualReadTurn'),
      pc.indexOf('function reportAiLegacyRouteOutcome')
    ),
    /routeClassifier\.classify/
  );
});
