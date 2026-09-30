const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_ATTENDANCE_DAYS,
  normalizeDateRange,
  monthStartsBetween,
  finalSessionStatus,
  buildAttendancePayload,
  readAttendance,
} = require('../api/_lib/olli-agent/tools/attendance-tools.cjs');

function requestContext() {
  return {
    sessionToken:'server-session-secret',
    academyId:'11111111-1111-4111-8111-111111111111',
  };
}

test('attendance range is bounded and spans the exact month RPCs needed', () => {
  assert.equal(MAX_ATTENDANCE_DAYS, 62);
  assert.equal(normalizeDateRange('2026-09-01','2026-11-01').days, 62);
  assert.deepEqual(
    monthStartsBetween('2026-09-30','2026-11-01'),
    ['2026-09-01','2026-10-01','2026-11-01']
  );
  assert.throws(
    () => normalizeDateRange('2026-09-01','2026-11-02'),
    (error) => error?.code === 'OLLI_AGENT_ATTENDANCE_RANGE_TOO_WIDE'
  );
});

test('final status follows register precedence and keeps blank distinct from absence', () => {
  const rows = [
    {
      session_date:'2026-09-30', time_slot:4, class_group:'A',
      session_kind:'regular_expected', attended:false,
    },
    {
      session_date:'2026-09-30', time_slot:4, class_group:'A',
      session_kind:'regular', attended:true, marked_at:'2026-09-30T08:00:00Z',
    },
    {
      session_date:'2026-09-30', time_slot:4, class_group:'A',
      session_kind:'register_override', register_session_kind:'regular',
      register_status:'absent', marked_at:'2026-09-30T09:00:00Z',
    },
  ];

  assert.equal(
    finalSessionStatus(rows,'2026-09-30','regular',4,'A',true,'2026-09-30'),
    'absent'
  );

  rows[1].marked_at = '2026-09-30T10:00:00Z';
  assert.equal(
    finalSessionStatus(rows,'2026-09-30','regular',4,'A',true,'2026-09-30'),
    'present'
  );

  assert.equal(
    finalSessionStatus([
      { session_date:'2026-09-30', time_slot:5, class_group:'A', session_kind:'regular_expected', attended:false },
    ],'2026-09-30','regular',5,'A',true,'2026-09-30'),
    'blank'
  );
  assert.equal(
    finalSessionStatus([
      { session_date:'2026-09-29', time_slot:5, class_group:'A', session_kind:'regular_expected', attended:false },
    ],'2026-09-29','regular',5,'A',true,'2026-09-30'),
    'absent'
  );
  assert.equal(
    finalSessionStatus([
      { session_date:'2026-09-29', time_slot:5, class_group:'A', session_kind:'makeup_expected', attended:false },
    ],'2026-09-29','makeup',5,'A',true,'2026-09-30'),
    'blank'
  );
});

test('legacy coarse override applies only to the first rendered session just like the PC attendance register', () => {
  const rows = [
    { session_date:'2026-09-30', time_slot:4, class_group:'A', session_kind:'regular_expected', attended:false },
    { session_date:'2026-09-30', time_slot:5, class_group:'A', session_kind:'regular_expected', attended:false },
    {
      session_date:'2026-09-30', time_slot:0, class_group:'A',
      session_kind:'register_override', register_session_kind:'regular',
      register_status:'present', marked_at:'2026-09-30T08:00:00Z',
    },
  ];

  assert.equal(
    finalSessionStatus(rows,'2026-09-30','regular',4,'A',true,'2026-09-30'),
    'present'
  );
  assert.equal(
    finalSessionStatus(rows,'2026-09-30','regular',5,'A',false,'2026-09-30'),
    'blank'
  );
});

test('attendance payload excludes holidays and Sundays and labels half-hour sessions', () => {
  const rows = [
    { student_id:'student-1', session_date:'2026-09-28', time_slot:10, class_group:'A', session_kind:'regular_expected', attended:false },
    { student_id:'student-1', session_date:'2026-09-29', time_slot:10, class_group:'A', session_kind:'regular_expected', attended:false },
    { student_id:'student-1', session_date:'2026-09-29', time_slot:10, class_group:'A', session_kind:'regular', attended:true, marked_at:'2026-09-29T08:00:00Z' },
    { student_id:'student-1', session_date:'2026-10-04', time_slot:10, class_group:'A', session_kind:'regular_expected', attended:false },
    { student_id:'other-student', session_date:'2026-09-29', time_slot:10, class_group:'A', session_kind:'regular', attended:true },
  ];
  const payload = buildAttendancePayload({
    rows,
    calendarRows:[{ session_date:'2026-09-28', name:'휴원', is_holiday:true }],
    studentId:'student-1',
    studentLabel:'학생A',
    division:'elementary',
    timetableMode:'half_hour',
    startDate:'2026-09-28',
    endDate:'2026-10-04',
    sessionKind:'ALL',
    todayKey:'2026-09-30',
  });

  assert.equal(payload.sessions.length, 1);
  assert.equal(payload.sessions[0].date, '2026-09-29');
  assert.equal(payload.sessions[0].time_label, '4시 30분');
  assert.equal(payload.sessions[0].status, 'present');
  assert.equal(payload.counts.present, 1);
  assert.equal(payload.closed_dates.length, 2);
  assert.deepEqual(payload.closed_dates.map((x) => x.date), ['2026-09-28','2026-10-04']);

  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /student-1|other-student|student_id|academy_id|session_token/i);
});

test('attendance read keeps real student id server-local and combines month, calendar, and timetable settings RPCs', async () => {
  const calls = [];
  const result = await readAttendance({
    requestContext:requestContext(),
    subjectAccess:{
      resolve(label) {
        assert.equal(label, '학생A');
        return { studentId:'real-student-id', division:'kinder' };
      },
    },
    studentLabel:'학생A',
    startDate:'2026-09-29',
    endDate:'2026-10-02',
    sessionKind:'ALL',
    todayKey:'2026-09-30',
    sanitizePayload(payload) { return payload; },
    async callRpc(name, params) {
      calls.push({ name, params });
      if (name === 'olli_schedule_calendar_range') {
        return { ok:true, days:[] };
      }
      if (name === 'olli_academy_settings_get') {
        return { ok:true, academy:{ kinder_timetable_mode:'half_hour', academy_name:'SECRET' } };
      }
      if (name === 'olli_schedule_attendance_month') {
        return {
          ok:true,
          attendance:[
            {
              student_id:'real-student-id',
              session_date:params.p_month === '2026-09-01' ? '2026-09-29' : '2026-10-01',
              time_slot:8,
              class_group:'A',
              session_kind:'regular_expected',
              attended:false,
            },
          ],
        };
      }
      throw new Error('unexpected rpc ' + name);
    },
  });

  assert.deepEqual(
    calls.filter((call) => call.name === 'olli_schedule_attendance_month')
      .map((call) => call.params.p_month),
    ['2026-09-01','2026-10-01']
  );
  calls.forEach((call) => {
    assert.equal(call.params.p_session_token, 'server-session-secret');
    assert.equal(call.params.p_academy_id, '11111111-1111-4111-8111-111111111111');
  });

  assert.equal(result.student_label, '학생A');
  assert.equal(result.sessions[0].time_label, '4시 30분');
  assert.equal(result.sessions[0].status, 'absent');
  assert.equal(result.sessions[1].status, 'blank');

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /real-student-id|SECRET|student_id|academy_id|session_token/i);
});

test('attendance read fails closed for an unknown anonymous student label', async () => {
  await assert.rejects(
    readAttendance({
      requestContext:requestContext(),
      subjectAccess:{ resolve(){ return null; } },
      studentLabel:'학생Z',
      startDate:'2026-09-01',
      endDate:'2026-09-30',
      sanitizePayload(payload) { return payload; },
      async callRpc() { throw new Error('must not call rpc'); },
    }),
    (error) => error?.code === 'OLLI_AGENT_SUBJECT_NOT_AVAILABLE'
  );
});
