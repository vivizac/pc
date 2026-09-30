const test = require('node:test');
const assert = require('node:assert/strict');

const resolver = require('../api/_lib/olli-agent/student-reference-resolver.cjs');
const privacy = require('../api/_lib/olli-agent/privacy.cjs');
const records = require('../api/_lib/olli-agent/tools/record-tools.cjs');

const students = [
  {
    id:'11111111-1111-4111-8111-111111111111',
    name:'최지안',
    division:'kinder',
    status:'active',
    is_deleted:false,
    guardianName:'박보호자',
    school:'대구초등학교',
  },
  {
    id:'22222222-2222-4222-8222-222222222222',
    name:'한재림',
    division:'elementary',
    status:'active',
    is_deleted:false,
  },
];

function preparedPrivacy() {
  const resolution = resolver.matchStudentReferences(
    '최지안 요즘 수업할 때 어때?',
    students,
    { createSubjectRef: () => 'subject_AAAAAAAAAAAAAAAA' }
  );
  return privacy.prepareAgentPrivacyFromResolution(
    '최지안 요즘 수업할 때 어때?',
    resolution
  );
}

test('recent records read uses only secured read RPCs and keeps real student id server-local', async () => {
  const prepared = preparedPrivacy();
  const calls = [];
  const fakeRpc = async (name, params) => {
    calls.push({name,params});

    if (name === 'olli_general_feedback_data_access') {
      return {
        ok:true,
        rows:[
          {
            id:987654321,
            student_id:students[0].id,
            student_name:'최지안',
            member_id:'33333333-3333-4333-8333-333333333333',
            content:'최지안이 한재림과 함께 관찰했고 박보호자 연락처는 010-1234-5678입니다.',
            created_at:'2026-09-30T09:00:00Z',
            is_deleted:false,
          },
          {
            id:111,
            student_id:students[0].id,
            student_name:'최지안',
            content:'삭제된 기록은 나오면 안 됩니다.',
            created_at:'2026-09-30T12:00:00Z',
            is_deleted:true,
          },
        ],
      };
    }

    if (name === 'olli_growth_feedback_data_access') {
      return {
        ok:true,
        rows:[{
          id:'44444444-4444-4444-8444-444444444444',
          student_id:students[0].id,
          student_name:'최지안',
          content:'최지안은 어려운 부분을 다시 시도했습니다. 메일 test@example.com',
          created_at:'2026-09-30T10:00:00Z',
          is_deleted:false,
        }],
      };
    }

    if (name === 'olli_note_archive_data_access') {
      return {
        ok:true,
        rows:[{
          id:'55555555-5555-4555-8555-555555555555',
          student_id:students[0].id,
          student_name:'최지안',
          note_type:'kinder_observation',
          record_label:'9월 관찰',
          local_record_id:'local-secret',
          feedback_id:'feedback-secret',
          content:'최지안이 재료를 스스로 골랐습니다. 내부값 aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          year:2026,
          month:9,
          day:30,
          created_at:'2026-09-30T11:00:00Z',
        }],
      };
    }

    throw new Error('unexpected RPC');
  };

  const result = await records.readRecentRecords({
    requestContext:{
      sessionToken:'server-session-secret',
      academyId:'academy-secret',
    },
    subjectAccess:prepared.subjectAccess,
    studentLabel:'학생A',
    maxRecords:12,
    sanitizePayload:(payload) => privacy.sanitizeAgentToolPayload(payload, prepared),
    callRpc:fakeRpc,
  });

  assert.deepEqual(
    calls.map((call) => call.name).sort(),
    [
      'olli_general_feedback_data_access',
      'olli_growth_feedback_data_access',
      'olli_note_archive_data_access',
    ].sort()
  );
  calls.forEach((call) => {
    assert.equal(call.params.p_action, 'read');
    assert.equal(call.params.p_operation, 'list');
    assert.equal(call.params.p_identity.student_id, students[0].id);
    assert.equal(call.params.p_session_token, 'server-session-secret');
    assert.equal(call.params.p_academy_id, 'academy-secret');
  });

  assert.equal(result.record_count, 3);
  assert.deepEqual(
    result.records.map((item) => item.record_type),
    ['observation','growth_feedback','feedback']
  );

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /최지안|한재림|박보호자|010-1234-5678|test@example\.com/);
  assert.doesNotMatch(serialized, /11111111-1111-4111-8111-111111111111/);
  assert.doesNotMatch(serialized, /987654321|local-secret|feedback-secret|academy-secret|server-session-secret/);
  assert.doesNotMatch(serialized, /aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/);
  assert.doesNotMatch(serialized, /삭제된 기록은 나오면 안 됩니다/);
  assert.match(serialized, /학생A/);
  assert.match(serialized, /\[학생명 제거\]/);
  assert.match(serialized, /\[전화번호 제거\]/);
  assert.match(serialized, /\[이메일 제거\]/);
  assert.match(serialized, /\[내부식별자 제거\]/);
});

test('tool-result privacy sanitizer keeps only privacy-safe record text', () => {
  const prepared = preparedPrivacy();
  const safe = privacy.sanitizeAgentToolPayload({
    student_label:'학생A',
    content:'최지안 보호자는 박보호자이고 학교는 대구초등학교입니다.',
  }, prepared);

  assert.equal(safe.student_label, '학생A');
  assert.doesNotMatch(JSON.stringify(safe), /최지안|박보호자|대구초등학교/);
  assert.match(JSON.stringify(safe), /보호자A|학교A/);
});

test('recent records omit soft-deleted and blank rows, deduplicate exact records, and cap output', () => {
  const merged = records.mergeRecentRecords(
    [
      { content:'A', created_at:'2026-09-30T10:00:00Z', is_deleted:false },
      { content:'A', created_at:'2026-09-30T10:00:00Z', is_deleted:false },
      { content:'deleted', created_at:'2026-09-30T12:00:00Z', is_deleted:true },
      { content:'   ', created_at:'2026-09-30T13:00:00Z', is_deleted:false },
    ],
    [
      { content:'B', created_at:'2026-09-30T11:00:00Z', is_deleted:false },
    ],
    [
      { content:'C', created_at:'2026-09-30T09:00:00Z', note_type:'observation' },
    ],
    2
  );

  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((item) => item.content), ['B','A']);
});

test('recent records reject labels outside current privacy scope before any RPC call', async () => {
  let called = false;

  await assert.rejects(
    records.readRecentRecords({
      requestContext:{sessionToken:'secret',academyId:'academy'},
      subjectAccess:{resolve(){return null;}},
      studentLabel:'학생B',
      maxRecords:12,
      sanitizePayload:(value)=>value,
      callRpc:async()=>{called=true; return {ok:true,rows:[]};},
    }),
    (error) => error?.code === 'OLLI_AGENT_SUBJECT_NOT_AVAILABLE'
  );

  assert.equal(called, false);
});

test('recent records fail closed when any secured source read fails', async () => {
  const prepared = preparedPrivacy();

  await assert.rejects(
    records.readRecentRecords({
      requestContext:{sessionToken:'secret',academyId:'academy'},
      subjectAccess:prepared.subjectAccess,
      studentLabel:'학생A',
      maxRecords:12,
      sanitizePayload:(payload) => privacy.sanitizeAgentToolPayload(payload, prepared),
      callRpc:async(name)=>{
        if (name === 'olli_growth_feedback_data_access') {
          return {ok:false,code:'PERMISSION_DENIED',message:'denied'};
        }
        return {ok:true,rows:[]};
      },
    }),
    (error) => error?.code === 'PERMISSION_DENIED'
  );
});
