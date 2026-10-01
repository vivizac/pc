const test = require('node:test');
const assert = require('node:assert/strict');

const resolver = require('../api/_lib/olli-agent/student-reference-resolver.cjs');
const privacy = require('../api/_lib/olli-agent/privacy.cjs');
const profiles = require('../api/_lib/olli-agent/tools/profile-tools.cjs');

const students = [{
  id:'11111111-1111-4111-8111-111111111111',
  name:'최지안',
  division:'kinder',
  status:'active',
  grade:'',
  age:'5',
  enrolled_at:'2025-03-04',
  school:'비밀초등학교',
  kindergarten:'비밀유치원',
  personality:'관찰형',
  memo:'민감한 메모',
  academy_id:'22222222-2222-4222-8222-222222222222',
  is_deleted:false,
}];

function preparedPrivacy() {
  const resolution = resolver.matchStudentReferences(
    '최지안 학생 기본정보 알려줘',
    students,
    { createSubjectRef: () => 'subject_AAAAAAAAAAAAAAAA' }
  );
  return privacy.prepareAgentPrivacyFromResolution(
    '최지안 학생 기본정보 알려줘',
    resolution
  );
}

test('student profile normalization keeps only the approved minimal profile fields', () => {
  const profile = profiles.normalizeProfileRow(students[0], '학생A');

  assert.deepEqual(profile, {
    ok:true,
    student_label:'학생A',
    division:'kinder',
    division_label:'유치부',
    status:'active',
    status_label:'재원',
    grade:'',
    age:'5',
    enrolled_at:'2025-03-04',
  });

  const serialized=JSON.stringify(profile);
  assert.doesNotMatch(serialized,/최지안|비밀초등학교|비밀유치원|관찰형|민감한 메모/);
  assert.doesNotMatch(serialized,/11111111-1111-4111-8111-111111111111|22222222-2222-4222-8222-222222222222/);
  assert.doesNotMatch(serialized,/school|kindergarten|personality|memo|academy_id|student_id|\bid\b/);
});

test('student profile reads one resolved student through secured student data RPC', async () => {
  const prepared=preparedPrivacy();
  const calls=[];

  const result=await profiles.readStudentProfile({
    requestContext:{
      sessionToken:'server-session-secret',
      academyId:'academy-secret',
    },
    subjectAccess:prepared.subjectAccess,
    studentLabel:'학생A',
    sanitizePayload:(payload)=>privacy.sanitizeAgentToolPayload(payload,prepared),
    async callRpc(name,params){
      calls.push({name,params});
      return {
        ok:true,
        rows:[{
          ...students[0],
          created_by:'33333333-3333-4333-8333-333333333333',
          lesson_day:'월요일',
          lesson_time:'4시',
          class_no:'7',
        }],
      };
    },
  });

  assert.equal(calls.length,1);
  assert.equal(calls[0].name,'olli_student_data_access');
  assert.equal(calls[0].params.p_action,'read');
  assert.equal(calls[0].params.p_operation,'get');
  assert.deepEqual(calls[0].params.p_identity,{id:students[0].id});
  assert.equal(calls[0].params.p_limit,1);
  assert.equal(calls[0].params.p_session_token,'server-session-secret');
  assert.equal(calls[0].params.p_academy_id,'academy-secret');

  const serialized=JSON.stringify(result);
  assert.equal(result.student_label,'학생A');
  assert.equal(result.division_label,'유치부');
  assert.equal(result.status_label,'재원');
  assert.doesNotMatch(serialized,/최지안|비밀초등학교|비밀유치원|관찰형|민감한 메모|월요일|4시/);
  assert.doesNotMatch(serialized,/11111111-1111-4111-8111-111111111111|33333333-3333-4333-8333-333333333333|academy-secret|server-session-secret/);
});

test('student profile status labels remain explicit and non-evaluative', () => {
  assert.equal(profiles.statusLabel('active'),'재원');
  assert.equal(profiles.statusLabel('paused'),'휴원');
  assert.equal(profiles.statusLabel('withdrawn'),'퇴원');
  assert.equal(profiles.statusLabel('inactive'),'비활성');
});

test('student profile rejects a label outside the current privacy scope before RPC', async () => {
  let called=false;
  await assert.rejects(
    profiles.readStudentProfile({
      requestContext:{sessionToken:'secret',academyId:'academy'},
      subjectAccess:{resolve(){return null;}},
      studentLabel:'학생B',
      sanitizePayload:(value)=>value,
      callRpc:async()=>{called=true; return {ok:true,rows:[]};},
    }),
    (error)=>error?.code==='OLLI_AGENT_SUBJECT_NOT_AVAILABLE'
  );
  assert.equal(called,false);
});

test('student profile fails closed when the secured student read fails', async () => {
  const prepared=preparedPrivacy();
  await assert.rejects(
    profiles.readStudentProfile({
      requestContext:{sessionToken:'secret',academyId:'academy'},
      subjectAccess:prepared.subjectAccess,
      studentLabel:'학생A',
      sanitizePayload:(value)=>value,
      callRpc:async()=>({ok:false,code:'PERMISSION_DENIED',message:'denied'}),
    }),
    (error)=>error?.code==='PERMISSION_DENIED'
  );
});
