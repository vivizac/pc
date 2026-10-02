'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  prepareAgentReadPrivacyInput,
  prepareAgentContextReadPrivacyInput,
}=require('../api/_lib/olli-agent/privacy.cjs');

function student(id,name,division='elementary'){
  return {
    id,
    name,
    division,
    status:'active',
    is_deleted:false,
  };
}

function fakeSession(){
  let bindings=[];
  let clears=0;
  let binds=0;
  return {
    async getSubjectBindings(){ return bindings.slice(); },
    async bindSubjectBindings(items){
      binds+=1;
      for(const item of items){
        const current={
          label:item.label,
          subjectRef:item.subjectRef,
          lastUsedAt:'2026-10-02T00:00:00Z',
        };
        Object.defineProperty(current,'studentId',{
          value:item.studentId,
          enumerable:false,
        });
        bindings=[current];
      }
      return bindings.slice();
    },
    async clearSession(){ bindings=[]; clears+=1; },
    state(){
      return {
        bindings:bindings.slice(),
        clears,
        binds,
      };
    },
  };
}

const requestContext={
  academyId:'academy-1',
  memberId:'member-1',
  sessionToken:'secret',
};

test('first explicit student is sanitized and bound as stable 학생A',async()=>{
  const session=fakeSession();
  const result=await prepareAgentReadPrivacyInput(
    '김민수 오늘 수업 몇 시야?',
    requestContext,
    {
      session,
      rows:[student('student-1','김민수')],
      createSubjectRef:()=> 'subject_abcdefghijklmnop',
    }
  );

  assert.equal(result.sessionEnabled,true);
  assert.equal(result.sessionReset,false);
  assert.match(result.preparedPrivacy.safeText,/학생A/);
  assert.doesNotMatch(result.preparedPrivacy.safeText,/김민수/);
  assert.deepEqual(result.preparedPrivacy.subjectRefs,[{
    label:'학생A',
    subject_ref:'subject_abcdefghijklmnop',
    division:'elementary',
  }]);
  assert.equal(
    result.preparedPrivacy.subjectAccess.resolve('학생A').studentId,
    'student-1'
  );
  assert.equal(JSON.stringify(result.preparedPrivacy).includes('student-1'),false);
  assert.equal(session.state().bindings[0].studentId,'student-1');
  assert.equal(session.state().binds,1);
});

test('context phrase reuses the same private subject without requiring the real name again',async()=>{
  const session=fakeSession();
  const rows=[student('student-1','김민수')];

  await prepareAgentReadPrivacyInput(
    '김민수 오늘 수업 몇 시야?',
    requestContext,
    {
      session,
      rows,
      createSubjectRef:()=> 'subject_abcdefghijklmnop',
    }
  );

  const follow=await prepareAgentReadPrivacyInput(
    '그 학생 이번 달 출결 어때?',
    requestContext,
    {
      session,
      rows,
      createSubjectRef:()=> 'subject_qrstuvwxyzABCDEF',
    }
  );

  assert.equal(follow.sessionEnabled,true);
  assert.equal(follow.sessionReset,false);
  assert.equal(follow.preparedPrivacy.safeText,'그 학생 이번 달 출결 어때?');
  assert.deepEqual(follow.preparedPrivacy.subjectRefs,[{
    label:'학생A',
    subject_ref:'subject_abcdefghijklmnop',
    division:'elementary',
  }]);
  assert.equal(
    follow.preparedPrivacy.subjectAccess.resolve('학생A').studentId,
    'student-1'
  );
  assert.equal(session.state().binds,1,'same subject follow-up should not rewrite the binding');
});

test('explicitly switching to another student clears stale history before binding the new subject',async()=>{
  const session=fakeSession();
  const rows=[
    student('student-1','김민수'),
    student('student-2','박지수'),
  ];

  await prepareAgentReadPrivacyInput(
    '김민수 시간표 알려줘',
    requestContext,
    {
      session,
      rows,
      createSubjectRef:()=> 'subject_abcdefghijklmnop',
    }
  );

  const next=await prepareAgentReadPrivacyInput(
    '박지수 시간표 알려줘',
    requestContext,
    {
      session,
      rows,
      createSubjectRef:()=> 'subject_qrstuvwxyzABCDEF',
    }
  );

  assert.equal(next.sessionEnabled,true);
  assert.equal(next.sessionReset,true);
  assert.equal(session.state().clears,1);
  assert.equal(session.state().bindings[0].studentId,'student-2');
  assert.match(next.preparedPrivacy.safeText,/학생A/);
  assert.doesNotMatch(next.preparedPrivacy.safeText,/김민수|박지수/);
});

test('generic no-student query does not silently inherit the active student',async()=>{
  const session=fakeSession();
  const rows=[student('student-1','김민수')];

  await prepareAgentReadPrivacyInput(
    '김민수 시간표 알려줘',
    requestContext,
    {
      session,
      rows,
      createSubjectRef:()=> 'subject_abcdefghijklmnop',
    }
  );

  const generic=await prepareAgentReadPrivacyInput(
    '오늘 시간표 보여줘',
    requestContext,
    {
      session,
      rows,
      createSubjectRef:()=> 'subject_qrstuvwxyzABCDEF',
    }
  );

  assert.equal(generic.sessionEnabled,false);
  assert.deepEqual(generic.preparedPrivacy.subjectRefs,[]);
  assert.equal(session.state().clears,0);
});


test('bare contextual follow-up reuses 학생A and sends the full sanitized conversation to the main Agent',async()=>{
  const session=fakeSession();
  const rows=[student('student-1','김민수')];

  await prepareAgentReadPrivacyInput(
    '김민수 시간표 알려줘',
    requestContext,
    {
      session,
      rows,
      createSubjectRef:()=> 'subject_abcdefghijklmnop',
    }
  );

  const follow=await prepareAgentContextReadPrivacyInput(
    '그럼 지난주는?',
    [
      {role:'user',content:'김민수 시간표 알려줘'},
      {role:'assistant',content:'김민수는 화요일 5시 A반이에요.'},
    ],
    requestContext,
    {
      session,
      rows,
      createSubjectRef:()=> 'subject_qrstuvwxyzABCDEF',
    }
  );

  assert.equal(follow.sessionEnabled,true);
  assert.equal(follow.sessionReset,false);
  assert.deepEqual(follow.preparedPrivacy.subjectRefs,[{
    label:'학생A',
    subject_ref:'subject_abcdefghijklmnop',
    division:'elementary',
  }]);
  assert.equal(follow.agentInput.length,3);
  assert.deepEqual(follow.agentInput[0],{
    type:'message',
    role:'user',
    content:[{type:'input_text',text:'학생A 시간표 알려줘'}],
  });
  assert.deepEqual(follow.agentInput[1],{
    type:'message',
    role:'assistant',
    status:'completed',
    content:[{type:'output_text',text:'학생A는 화요일 5시 A반이에요.'}],
  });
  assert.deepEqual(follow.agentInput[2],{
    type:'message',
    role:'user',
    content:[{type:'input_text',text:'그럼 지난주는?'}],
  });
  assert.doesNotMatch(JSON.stringify(follow.agentInput),/김민수/);
  assert.equal(session.state().binds,1,'context continuation should reuse the existing subject binding');
});
