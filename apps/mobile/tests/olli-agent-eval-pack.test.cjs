'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const {
  CONTRACTS,
  REPRESENTATIVE_SCENARIOS,
  resolveAgentEvalContract,
}=require('../api/_lib/olli-agent/eval-contracts.cjs');
const {
  summarizeAgentRun,
  evaluateRunSummary,
}=require('../api/_lib/olli-agent/observability.cjs');
const {
  prepareAgentReadPrivacyInput,
}=require('../api/_lib/olli-agent/privacy.cjs');
const {
  createOlliAgentSession,
}=require('../api/_lib/olli-agent/session.cjs');

const root=path.resolve(__dirname,'..');
const runtime=fs.readFileSync(path.join(root,'api/_lib/olli-agent/runtime.cjs'),'utf8');
const endpoint=fs.readFileSync(path.join(root,'api/olli-agent.js'),'utf8');

function student(id,name,division='elementary'){
  return {id,name,division,status:'active',is_deleted:false};
}

function fakeContext(memberId='member-1'){
  return {
    academyId:'academy-1',
    memberId,
    sessionToken:'session-secret',
  };
}

function fakeBindingSession(){
  let bindings=[];
  return {
    async getSubjectBindings(){return bindings.slice();},
    async bindSubjectBindings(items){
      bindings=(items||[]).map((item)=>{
        const value={
          label:item.label,
          subjectRef:item.subjectRef,
          lastUsedAt:'2026-10-02T00:00:00Z',
        };
        Object.defineProperty(value,'studentId',{value:item.studentId,enumerable:false});
        return value;
      });
      return bindings.slice();
    },
    async clearSession(){bindings=[];},
  };
}

test('eval pack declares the roadmap scenarios exactly once',()=>{
  const ids=REPRESENTATIVE_SCENARIOS.map((item)=>item.id);
  assert.equal(ids.length,new Set(ids).size);
  for(const required of [
    'explicit-student-schedule',
    'contextual-student-attendance',
    'cross-device-team-talk-context',
    'ambiguous-student-blocked-before-model',
    'availability-tool-selection',
    'attendance-tool-selection',
    'pickup-tool-selection',
    'write-stops-at-confirmation',
    'retry-idempotency',
    'duplicate-tool-detected',
  ]){
    assert.ok(ids.includes(required),required);
  }
});

test('every Olli Agent name in runtime has an eval contract',()=>{
  const names=Array.from(runtime.matchAll(/['"`](Olli [^'"`]+)['"`]/g))
    .map((match)=>match[1])
    .filter((name)=>!name.includes('application'))
    .filter((name)=>name !== 'Olli Agent')
    .filter((name)=>name !== 'Olli academy')
    .filter((name)=>name !== 'Olli application');
  const unique=Array.from(new Set(names));
  const missing=unique.filter((name)=>!resolveAgentEvalContract(name));
  assert.deepEqual(missing,[]);
});

test('single-tool contracts accept the expected tool and reject duplicate or unexpected tools',()=>{
  const contract=resolveAgentEvalContract('Olli Attendance Probe');
  assert.ok(contract);

  const good=evaluateRunSummary({
    toolCalls:[{name:'get_attendance'}],
    toolCallCount:1,
    duplicateToolNames:[],
    finalOutputPresent:true,
  },contract);
  assert.equal(good.ok,true);

  const bad=evaluateRunSummary({
    toolCalls:[{name:'get_attendance'},{name:'get_attendance'},{name:'get_pickups'}],
    toolCallCount:3,
    duplicateToolNames:['get_attendance'],
    finalOutputPresent:true,
  },contract);
  assert.equal(bad.ok,false);
  assert.ok(bad.issues.includes('DUPLICATE_TOOL_CALL'));
  assert.ok(bad.issues.includes('UNEXPECTED_TOOL:get_pickups'));
  assert.ok(bad.issues.includes('TOOL_CALL_LIMIT_EXCEEDED'));
});

test('explicit student then contextual phrase reuses one private subject binding',async()=>{
  const session=fakeBindingSession();
  const rows=[student('student-real-1','김민수')];

  const first=await prepareAgentReadPrivacyInput(
    '김민수 오늘 수업 몇 시야?',
    fakeContext(),
    {session,rows,createSubjectRef:()=> 'subject_abcdefghijklmnop'}
  );
  assert.match(first.preparedPrivacy.safeText,/학생A/);
  assert.doesNotMatch(first.preparedPrivacy.safeText,/김민수/);

  const follow=await prepareAgentReadPrivacyInput(
    '그 학생 이번 달 출결 어때?',
    fakeContext(),
    {session,rows,createSubjectRef:()=> 'subject_qrstuvwxyzABCDEF'}
  );
  assert.equal(follow.preparedPrivacy.subjectRefs[0].subject_ref,'subject_abcdefghijklmnop');
  assert.equal(follow.preparedPrivacy.subjectAccess.resolve('학생A').studentId,'student-real-1');
  assert.doesNotMatch(JSON.stringify(follow.preparedPrivacy),/student-real-1/);
});

test('ambiguous student stays blocked before Agent execution',async()=>{
  const result=await prepareAgentReadPrivacyInput(
    '김민수 출결 알려줘',
    fakeContext(),
    {
      session:fakeBindingSession(),
      rows:[student('s1','김민수'),student('s2','김민수')],
      createSubjectRef:()=> 'subject_abcdefghijklmnop',
    }
  );
  assert.equal(result.preparedPrivacy.needsDisambiguation,true);
  assert.equal(result.preparedPrivacy.subjectRefs.length,0);
});

test('PC and Mobile share the same server session key because device is not part of scope',async()=>{
  const keys=[];
  const backend=new Map();
  async function callRpc(_name,params){
    const key=[params.p_academy_id,params.p_member_id,params.p_surface].join('|');
    keys.push(key);
    if(!backend.has(key)) backend.set(key,'session-'+(backend.size+1));
    return {ok:true,session_id:backend.get(key),items:[]};
  }

  const pc=createOlliAgentSession({requestContext:fakeContext(),callRpc});
  const mobile=createOlliAgentSession({requestContext:fakeContext(),callRpc});
  const otherTeacher=createOlliAgentSession({requestContext:fakeContext('member-2'),callRpc});

  assert.equal(await pc.getSessionId(),await mobile.getSessionId());
  assert.notEqual(await pc.getSessionId(),await otherTeacher.getSessionId());
  assert.ok(keys.every((key)=>key.endsWith('|team_talk')));
});

test('same source run key produces the same first batch key across retry instances',async()=>{
  const batchKeys=[];
  const callRpc=async(_name,params)=>{
    if(params.p_action==='add_items') batchKeys.push(params.p_payload.batch_key);
    return {ok:true,session_id:'session-1',items:[]};
  };

  for(let retry=0;retry<2;retry+=1){
    const session=createOlliAgentSession({
      requestContext:fakeContext(),
      runKey:'team-chat-message:777',
      callRpc,
    });
    await session.addItems([{role:'user',content:'학생A 시간표'}]);
  }

  assert.deepEqual(batchKeys,[
    'team-chat-message:777:1',
    'team-chat-message:777:1',
  ]);
});

test('Agent endpoint never directly executes pending Team Chat mutations',()=>{
  assert.doesNotMatch(endpoint,/olli_team_chat_action_execute/);
  for(const mode of [
    'memo_prepare',
    'absence_prepare',
    'makeup_prepare',
    'trial_add_prepare',
    'waitlist_add_prepare',
    'move_prepare',
    'pickup_prepare',
    'timetable_admin_prepare',
    'attendance_status_prepare',
  ]){
    assert.match(endpoint,new RegExp("'"+mode+"'"));
  }
});

test('structural run summaries never retain tool values or final answer contents',()=>{
  const summary=summarizeAgentRun(
    {name:'Olli Pickup Probe'},
    {
      finalOutput:'실제 답변 값',
      newItems:[
        {
          type:'tool_call_item',
          rawItem:{name:'get_pickups',arguments:JSON.stringify({subject_ref:'private-ref',reference_date:'2026-10-02'})},
        },
        {
          type:'tool_call_output_item',
          rawItem:{name:'get_pickups'},
          output:{location:'비밀주소',student_label:'학생A'},
        },
      ],
    }
  );
  const serialized=JSON.stringify(summary);
  assert.doesNotMatch(serialized,/private-ref|2026-10-02|비밀주소|실제 답변 값/);
  assert.match(serialized,/get_pickups/);
});

test('contract inventory includes all expected read and prepare tool families',()=>{
  const tools=new Set(Object.values(CONTRACTS).flatMap((contract)=>contract.allowedTools||[]));
  for(const tool of [
    'get_student_schedule',
    'get_recent_records',
    'get_schedule_availability',
    'get_attendance',
    'get_pickups',
    'get_student_profile',
    'read_timetable_query',
    'prepare_absence',
    'prepare_class_once',
    'prepare_makeup',
    'prepare_trial_add',
    'prepare_waitlist_add',
    'prepare_move_class',
    'prepare_timetable_memo',
    'prepare_pickup_add',
    'prepare_timetable_admin',
    'prepare_attendance_status',
  ]){
    assert.ok(tools.has(tool),tool);
  }
});
