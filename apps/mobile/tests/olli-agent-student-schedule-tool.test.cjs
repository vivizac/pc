const test = require('node:test');
const assert = require('node:assert/strict');

const schedule = require('../api/_lib/olli-agent/tools/schedule-tools.cjs');

test('half-hour time labels preserve the stored slot encoding without exposing fake clock times', () => {
  assert.equal(schedule.timeLabel('elementary', 3, 11, 'half_hour'), '5시 30분');
  assert.equal(schedule.timeLabel('kinder', 2, 8, 'half_hour'), '4시 30분');
  assert.equal(schedule.timeLabel('elementary', 6, 10, 'half_hour'), '1시');
  assert.equal(schedule.timeLabel('elementary', 6, 12, 'hourly'), '3시');
});

test('safe schedule payload strips row IDs, teacher identity and pickup details', () => {
  const payload = schedule.safeSchedulePayload(
    {
      ok:true,
      division:'kinder',
      reference_date:'2026-09-30',
      enrollments:[{
        id:'enrollment-secret',
        weekday:3,
        time_slot:8,
        class_group:'A',
        session_order:1,
        teacher_member_id:'teacher-secret',
        teacher_name:'실명선생님',
      }],
      pickups:[{
        pickup_label:'집 앞',
        pickup_time:'16:30',
      }],
    },
    {
      ok:true,
      academy:{ kinder_timetable_mode:'half_hour', name:'비밀학원명' },
    },
    '학생A'
  );

  assert.deepEqual(payload, {
    ok:true,
    student_label:'학생A',
    reference_date:'2026-09-30',
    division:'kinder',
    timetable_mode:'half_hour',
    enrollments:[{
      weekday:3,
      weekday_label:'수요일',
      time_slot:8,
      time_label:'4시 30분',
      class_group:'A',
      session_order:1,
    }],
    enrollment_count:1,
  });

  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /enrollment-secret|teacher-secret|실명선생님|집 앞|16:30|비밀학원명/);
});

test('readStudentSchedule resolves anonymous label to real id only inside server RPC args', async () => {
  const calls = [];
  const fakeRpc = async (name, params) => {
    calls.push({name,params});
    if (name === 'olli_schedule_student_enrollments') {
      return {
        ok:true,
        division:'elementary',
        reference_date:'2026-09-30',
        enrollments:[{
          id:'hidden-enrollment',
          weekday:3,
          time_slot:5,
          class_group:'B',
          session_order:1,
        }],
        pickups:[],
      };
    }
    if (name === 'olli_academy_settings_get') {
      return { ok:true, academy:{ kinder_timetable_mode:'hourly' } };
    }
    throw new Error('unexpected RPC');
  };

  const result = await schedule.readStudentSchedule({
    requestContext:{
      sessionToken:'server-session-secret',
      academyId:'academy-secret',
    },
    subjectAccess:{
      resolve(label) {
        assert.equal(label, '학생A');
        return { studentId:'11111111-1111-4111-8111-111111111111' };
      },
    },
    studentLabel:'학생A',
    referenceDate:'2026-09-30',
    callRpc:fakeRpc,
  });

  assert.equal(calls.length, 2);
  const enrollmentCall = calls.find((item) => item.name === 'olli_schedule_student_enrollments');
  assert.equal(enrollmentCall.params.p_student_id, '11111111-1111-4111-8111-111111111111');
  assert.equal(enrollmentCall.params.p_session_token, 'server-session-secret');

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /11111111-1111-4111-8111-111111111111|server-session-secret|academy-secret|hidden-enrollment/);
  assert.equal(result.enrollments[0].time_label, '5시');
});

test('schedule tool rejects labels that were not resolved in the current privacy scope', async () => {
  await assert.rejects(
    schedule.readStudentSchedule({
      requestContext:{sessionToken:'secret',academyId:'academy'},
      subjectAccess:{resolve(){return null;}},
      studentLabel:'학생B',
      referenceDate:'2026-09-30',
      callRpc:async()=>({ok:true}),
    }),
    (error) => error?.code === 'OLLI_AGENT_SUBJECT_NOT_AVAILABLE'
  );
});

test('schedule tool rejects non-canonical dates before any RPC call', async () => {
  let called = false;
  await assert.rejects(
    schedule.readStudentSchedule({
      requestContext:{sessionToken:'secret',academyId:'academy'},
      subjectAccess:{resolve(){return {studentId:'id'};}},
      studentLabel:'학생A',
      referenceDate:'오늘',
      callRpc:async()=>{called=true; return {ok:true};},
    }),
    (error) => error?.code === 'OLLI_AGENT_REFERENCE_DATE_INVALID'
  );
  assert.equal(called, false);
});
