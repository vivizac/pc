const test = require('node:test');
const assert = require('node:assert/strict');

const resolver = require('../api/_lib/olli-agent/student-reference-resolver.cjs');
const privacy = require('../api/_lib/olli-agent/privacy.cjs');
const pickups = require('../api/_lib/olli-agent/tools/pickup-tools.cjs');

const students = [
  {
    id:'11111111-1111-4111-8111-111111111111',
    name:'최지안',
    division:'kinder',
    status:'active',
    is_deleted:false,
  },
];

function preparedPrivacy() {
  const resolution = resolver.matchStudentReferences(
    '최지안 픽업 알려줘',
    students,
    { createSubjectRef: () => 'subject_AAAAAAAAAAAAAAAA' }
  );
  return privacy.prepareAgentPrivacyFromResolution(
    '최지안 픽업 알려줘',
    resolution
  );
}

test('pickup range is bounded to 62 days', () => {
  assert.equal(pickups.MAX_PICKUP_DAYS, 62);
  assert.equal(pickups.normalizeDateRange('2026-09-01','2026-11-01').days, 62);
  assert.throws(
    () => pickups.normalizeDateRange('2026-09-01','2026-11-02'),
    (error) => error?.code === 'OLLI_AGENT_PICKUP_RANGE_TOO_WIDE'
  );
});

test('pickup normalization keeps arrival/dropoff semantics and half-hour class labels', () => {
  const row = pickups.normalizePickup({
    date:'2026-10-01',
    weekday:4,
    class_time:8,
    has_arrival:true,
    arrival_label:'정문',
    arrival_time:'15:20:00',
    has_dropoff:true,
    dropoff_label:'후문',
    student_id:'must-not-leak',
    pickup_id:'must-not-leak',
  }, 'kinder', 'half_hour');

  assert.deepEqual(row, {
    date:'2026-10-01',
    weekday:4,
    weekday_label:'목요일',
    class_time:8,
    class_time_label:'4시 30분',
    has_arrival:true,
    arrival_label:'정문',
    arrival_time:'15:20',
    has_dropoff:true,
    dropoff_label:'후문',
  });
  assert.doesNotMatch(JSON.stringify(row), /student_id|pickup_id|must-not-leak/);
});

test('pickup read keeps student id server-local and sanitizes location text before model egress', async () => {
  const prepared = preparedPrivacy();
  const calls = [];
  const result = await pickups.readPickups({
    requestContext:{
      sessionToken:'server-session-secret',
      academyId:'academy-secret',
    },
    subjectAccess:prepared.subjectAccess,
    studentLabel:'학생A',
    startDate:'2026-09-30',
    endDate:'2026-10-06',
    sanitizePayload:(payload) => privacy.sanitizeAgentToolPayload(payload, prepared),
    async callRpc(name, params) {
      calls.push({name,params});
      if (name === 'olli_schedule_student_pickups_range') {
        return {
          ok:true,
          division:'kinder',
          start_date:'2026-09-30',
          end_date:'2026-10-06',
          pickup_supported:true,
          pickups:[{
            date:'2026-10-01',
            weekday:4,
            class_time:4,
            has_arrival:true,
            arrival_label:'최지안 010-1234-5678 정문',
            arrival_time:'15:20',
            has_dropoff:true,
            dropoff_label:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa 후문',
            id:'pickup-secret',
            student_id:students[0].id,
          }],
          closed_dates:[{date:'2026-10-03',reason:'휴원일'}],
        };
      }
      if (name === 'olli_academy_settings_get') {
        return {ok:true,academy:{kinder_timetable_mode:'hourly'}};
      }
      throw new Error('unexpected rpc');
    },
  });

  assert.deepEqual(calls.map((call)=>call.name).sort(),[
    'olli_academy_settings_get',
    'olli_schedule_student_pickups_range',
  ]);
  const pickupCall=calls.find((call)=>call.name==='olli_schedule_student_pickups_range');
  assert.equal(pickupCall.params.p_student_id,students[0].id);
  assert.equal(pickupCall.params.p_session_token,'server-session-secret');
  assert.equal(pickupCall.params.p_academy_id,'academy-secret');

  assert.equal(result.student_label,'학생A');
  assert.equal(result.pickup_count,1);
  assert.equal(result.pickups[0].class_time_label,'4시');

  const serialized=JSON.stringify(result);
  assert.doesNotMatch(serialized,/최지안|010-1234-5678|aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/);
  assert.doesNotMatch(serialized,/11111111-1111-4111-8111-111111111111|pickup-secret|academy-secret|server-session-secret/);
  assert.match(serialized,/학생A/);
  assert.match(serialized,/\[전화번호 제거\]/);
  assert.match(serialized,/\[내부식별자 제거\]/);
});

test('pickup read reports elementary students as unsupported without leaking identifiers', async () => {
  const safe=pickups.safePickupPayload({
    ok:true,
    division:'elementary',
    start_date:'2026-09-30',
    end_date:'2026-10-06',
    pickup_supported:false,
    pickups:[],
    closed_dates:[],
    student_id:'secret',
  }, {
    ok:true,
    academy:{kinder_timetable_mode:'hourly'},
  }, '학생A');

  assert.equal(safe.pickup_supported,false);
  assert.equal(safe.pickup_count,0);
  assert.doesNotMatch(JSON.stringify(safe),/student_id|secret/);
});

test('pickup read rejects labels outside current privacy scope before RPC calls', async () => {
  let called=false;
  await assert.rejects(
    pickups.readPickups({
      requestContext:{sessionToken:'secret',academyId:'academy'},
      subjectAccess:{resolve(){return null;}},
      studentLabel:'학생B',
      startDate:'2026-09-30',
      endDate:'2026-10-06',
      sanitizePayload:(value)=>value,
      callRpc:async()=>{called=true; return {ok:true};},
    }),
    (error)=>error?.code==='OLLI_AGENT_SUBJECT_NOT_AVAILABLE'
  );
  assert.equal(called,false);
});
