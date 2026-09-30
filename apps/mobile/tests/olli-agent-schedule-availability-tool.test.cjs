const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_AVAILABILITY_DAYS,
  normalizeDateRange,
  readScheduleAvailability,
  safeAvailabilityPayload,
} = require('../api/_lib/olli-agent/tools/availability-tools.cjs');
const { resolveAvailabilityScope } = require('../api/_lib/olli-agent/runtime.cjs');

function requestContext() {
  return {
    sessionToken:'server-session-secret',
    academyId:'11111111-1111-4111-8111-111111111111',
  };
}

test('availability read uses only server context and emits a privacy-safe half-hour payload', async () => {
  const calls = [];
  let sanitized = null;
  const result = await readScheduleAvailability({
    requestContext:requestContext(),
    division:'elementary',
    purpose:'makeup',
    startDate:'2026-10-01',
    endDate:'2026-10-02',
    timeSlot:0,
    classGroup:'ALL',
    sanitizePayload(payload) {
      sanitized = payload;
      return payload;
    },
    async callRpc(name, params) {
      calls.push({ name, params });
      return {
        ok:true,
        timetable_mode:'half_hour',
        capacity:5,
        slots:[{
          date:'2026-10-01',
          weekday:4,
          time_slot:10,
          class_group:'A',
          grouped:false,
          capacity:5,
          regular_count:5,
          absent_count:1,
          effective_regular_count:4,
          makeup_count:0,
          trial_count:0,
          one_time_count:0,
          occupancy:4,
          remaining:1,
          waitlist_count:0,
          waitlist_open:true,
          class_full:false,
          available:true,
          student_id:'should-not-leak',
          student_name:'should-not-leak',
          teacher_member_id:'should-not-leak',
        }],
        closed_dates:[{ date:'2026-10-02', reason:'휴원일', student_name:'should-not-leak' }],
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'olli_schedule_availability_slots');
  assert.equal(calls[0].params.p_session_token, 'server-session-secret');
  assert.equal(calls[0].params.p_academy_id, '11111111-1111-4111-8111-111111111111');
  assert.equal(calls[0].params.p_division, 'elementary');
  assert.equal(calls[0].params.p_purpose, 'makeup');
  assert.equal(calls[0].params.p_start_date, '2026-10-01');
  assert.equal(calls[0].params.p_end_date, '2026-10-02');

  assert.equal(result, sanitized);
  assert.equal(result.slots.length, 1);
  assert.equal(result.slots[0].time_label, '4시 30분');
  assert.equal(result.slots[0].absent_count, 1);
  assert.equal(result.slots[0].remaining, 1);
  assert.equal(result.available_count, 1);

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /should-not-leak/);
  assert.doesNotMatch(serialized, /student_id|student_name|teacher_member_id|academy_id|session_token/i);
});

test('availability payload filters by encoded time slot and class group without exposing raw fields', () => {
  const payload = safeAvailabilityPayload({
    ok:true,
    timetable_mode:'hourly',
    capacity:5,
    slots:[
      { date:'2026-10-03', weekday:6, time_slot:10, class_group:'A', grouped:true, remaining:1, available:true },
      { date:'2026-10-03', weekday:6, time_slot:10, class_group:'B', grouped:true, remaining:0, available:false },
      { date:'2026-10-03', weekday:6, time_slot:11, class_group:'A', grouped:false, remaining:2, available:true },
    ],
    closed_dates:[],
  }, {
    division:'elementary',
    purpose:'regular',
    startDate:'2026-10-03',
    endDate:'2026-10-03',
    timeSlot:10,
    classGroup:'B',
  });

  assert.equal(payload.slots.length, 1);
  assert.equal(payload.slots[0].class_group, 'B');
  assert.equal(payload.slots[0].time_label, '1시');
  assert.equal(payload.slots[0].available, false);
});

test('availability range is bounded to keep tool context compact', () => {
  assert.equal(MAX_AVAILABILITY_DAYS, 14);
  assert.equal(normalizeDateRange('2026-10-01','2026-10-14').days, 14);
  assert.throws(
    () => normalizeDateRange('2026-10-01','2026-10-15'),
    (error) => error?.code === 'OLLI_AGENT_AVAILABILITY_RANGE_TOO_WIDE'
  );
});

test('availability scope derives division from one resolved anonymous student and purpose from safe text', () => {
  const scope = resolveAvailabilityScope({
    safeText:'학생A 다음 주 보강 자리 있어?',
    subjectRefs:[{ label:'학생A', subjectRef:'opaque-1' }],
    subjectAccess:{
      resolve(value) {
        assert.equal(value, '학생A');
        return { division:'kinder' };
      },
    },
  });
  assert.deepEqual(scope, {
    division:'kinder',
    purpose:'makeup',
    subjectLabel:'학생A',
  });
});

test('availability scope accepts explicit division without a student and defaults generic seat questions to regular', () => {
  const scope = resolveAvailabilityScope({
    safeText:'다음 주 초등부 4시 자리 있어?',
    subjectRefs:[],
    subjectAccess:{ resolve(){ return null; } },
  });
  assert.equal(scope.division, 'elementary');
  assert.equal(scope.purpose, 'regular');
  assert.equal(scope.subjectLabel, '');
});

test('availability scope blocks division mismatch and mixed purposes before any tool call', () => {
  assert.throws(
    () => resolveAvailabilityScope({
      safeText:'학생A 초등부 보강 자리',
      subjectRefs:[{ label:'학생A' }],
      subjectAccess:{ resolve(){ return { division:'kinder' }; } },
    }),
    (error) => error?.code === 'OLLI_AGENT_AVAILABILITY_DIVISION_MISMATCH'
  );

  assert.throws(
    () => resolveAvailabilityScope({
      safeText:'유치부 보강이나 체험 자리',
      subjectRefs:[],
      subjectAccess:{ resolve(){ return null; } },
    }),
    (error) => error?.code === 'OLLI_AGENT_AVAILABILITY_PURPOSE_AMBIGUOUS'
  );
});
