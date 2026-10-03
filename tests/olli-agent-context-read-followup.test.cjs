'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  normalizeMentionConversation,
  resolveOlliSystemInterpretation,
  OLLI_INTERPRETER_LANES,
  routeForSystemIntent,
  resolveContextualReadRewrite,
  resolveContextualMakeupRewrite,
  studentLabel,
} = require('../apps/mobile/api/_lib/olli-agent/context-route.cjs');



test('unified interpreter runs on the first turn without loading student data', async () => {
  let observed=null;
  let studentLoadCalled=false;
  const result=await resolveOlliSystemInterpretation({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:10,
    currentMessage:'이민형 시간표 알려줘',
    conversation:[],
    loadStudents:async()=>{
      studentLoadCalled=true;
      return [{id:'student-1',name:'이민형'}];
    },
    modelRunner:async(input)=>{
      observed=input;
      return {
        lane:'routine',
        route:'rule',
        intent:'get_student_schedule',
        standalone_command:'이민형 시간표 알려줘',
        context_used:false,
      };
    },
  });

  assert.ok(observed);
  assert.equal(studentLoadCalled,false,'routine interpretation must not load the academy student list');
  assert.equal(observed.transcript,'');
  assert.equal(observed.currentText,'이민형 시간표 알려줘');
  assert.equal(result.lane,'routine');
  assert.equal(result.route,'rule');
  assert.equal(result.intent,'get_student_schedule');
  assert.equal(result.standaloneCommand,'이민형 시간표 알려줘');
  assert.equal(result.contextUsed,false);
});

test('unified interpreter resolves follow-up context from conversation text only', async () => {
  let observed=null;
  let studentLoadCalled=false;
  const result=await resolveOlliSystemInterpretation({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:11,
    currentMessage:'그럼 지난주는?',
    conversation:[
      {role:'user',content:'이민형 시간표 알려줘'},
      {role:'assistant',content:'이민형님의 정규 수업은 월요일 4시 A반입니다.'},
    ],
    loadStudents:async()=>{
      studentLoadCalled=true;
      return [{id:'student-1',name:'이민형'}];
    },
    modelRunner:async(input)=>{
      observed=input;
      return {
        lane:'routine',
        route:'agent',
        intent:'get_student_schedule',
        standalone_command:'이민형 지난주 시간표 알려줘',
        context_used:true,
      };
    },
  });

  assert.equal(studentLoadCalled,false);
  assert.match(observed.transcript,/이민형 시간표 알려줘/);
  assert.match(observed.transcript,/이민형님의 정규 수업/);
  assert.equal(result.lane,'routine');
  assert.equal(result.route,'rule','server route is derived from the intent contract, not model route text');
  assert.equal(result.intent,'get_student_schedule');
  assert.equal(result.standaloneCommand,'이민형 지난주 시간표 알려줘');
  assert.equal(result.contextUsed,true);
});

test('unified interpreter classifies feedback/data work separately from routine work', async () => {
  const result=await resolveOlliSystemInterpretation({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:12,
    currentMessage:'민준이 최근 관찰노트 보고 성장피드백 작성해줘',
    conversation:[],
    modelRunner:async()=>({
      lane:'feedback',
      route:'chat',
      intent:'complex_analysis',
      standalone_command:'민준이 최근 관찰노트 보고 성장피드백 작성해줘',
      context_used:false,
    }),
  });

  assert.equal(result.lane,'feedback');
  assert.equal(result.route,'chat');
  assert.equal(result.intent,'complex_analysis');
});

test('interpreter lane contract is explicit', () => {
  assert.deepEqual(OLLI_INTERPRETER_LANES,['routine','feedback','chat']);
});

test('unified interpreter has one deterministic route contract per system intent', () => {
  assert.equal(routeForSystemIntent('add_makeup'),'rule');
  assert.equal(routeForSystemIntent('get_student_schedule'),'rule');
  assert.equal(routeForSystemIntent('get_attendance'),'agent');
  assert.equal(routeForSystemIntent('set_attendance_status'),'agent');
  assert.equal(routeForSystemIntent('complex_analysis'),'chat');
  assert.equal(routeForSystemIntent('general_chat'),'chat');
});

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
  assert.match(mobile,/olliTalkPendingMakeupDialogue=\{ active:true, status:interactionStatus, prompt:aiReply \};/);
  assert.match(pc,/state\.pendingMakeupDialogue=\{ active:true, status:interactionStatus, prompt:aiReply \};/);
});

test('PC and Mobile use one unified interpreter before rule or Agent routing', () => {
  const root=path.resolve(__dirname,'..');
  const api=fs.readFileSync(path.join(root,'apps/mobile/api/olli-agent.js'),'utf8');
  const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
  const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');

  const interpretBranch=api.indexOf("if (mode === 'interpret')");
  const validateIndex=api.indexOf('validatePickupSourceMessage({',interpretBranch);
  const resolverIndex=api.indexOf('resolveOlliSystemInterpretation',interpretBranch);
  assert.ok(interpretBranch>=0 && validateIndex>interpretBranch && resolverIndex>validateIndex);

  for(const source of [mobile,pc]){
    const resolveName=source===mobile ? 'async function resolveOlliTalkAiTurn' : 'async function resolveAiTurn';
    const start=source.indexOf(resolveName);
    const end=source===mobile
      ? source.indexOf('function getOlliTalkMentionMessageText',start)
      : source.indexOf('function updateComposerState',start);
    const block=source.slice(start,end);
    assert.match(source,/mode:'interpret'/);
    assert.doesNotMatch(block,/mode:'context_read'/);
    assert.doesNotMatch(block,/mode:'context_resolve'/);
    const interpret=block.indexOf('interpretOlli');
    const classify=block.indexOf('routeClassifier.classify(commandText,{router})');
    const prepare=block.search(/router\.prepareAction/);
    assert.ok(interpret>=0 && classify>interpret && prepare>interpret);
    assert.match(block,/sharedRoute=interpreterRoute==='agent'/);
    assert.match(block,/if\(interpreterRoute==='rule'\)/);
  }
});

