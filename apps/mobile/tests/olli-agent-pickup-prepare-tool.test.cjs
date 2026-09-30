const test = require('node:test');
const assert = require('node:assert/strict');

const pickup = require('../api/_lib/olli-agent/tools/pickup-prepare-tools.cjs');
const { resolvePickupPrepareScope } = require('../api/_lib/olli-agent/runtime.cjs');

function requestContext() {
  return {
    sessionToken:'server-session-secret',
    academyId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    memberId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  };
}

function subjectAccess(division = 'kinder') {
  return {
    resolve(label) {
      assert.equal(label, '학생A');
      return {
        studentId:'11111111-1111-4111-8111-111111111111',
        division,
        status:'active',
      };
    },
  };
}

function baseRpc(options = {}) {
  const calls = [];
  const rpc = async (name, params) => {
    calls.push({name, params});

    if (name === 'olli_student_data_access') {
      return {
        ok:true,
        rows:[{
          id:'11111111-1111-4111-8111-111111111111',
          name:'최지안',
          division:'kinder',
          status:'active',
          is_deleted:false,
        }],
      };
    }
    if (name === 'olli_academy_settings_get') {
      return { ok:true, academy:{ kinder_timetable_mode:'half_hour' } };
    }
    if (name === 'olli_schedule_week') {
      return options.scheduleWeek || { ok:true, pickups:[] };
    }
    if (name === 'olli_team_chat_send_action') {
      return {
        ok:true,
        message:{
          id:987,
          sender_member_id:null,
          sender_name:'올리',
          message_type:'ai',
          body:params.p_body,
          reply_to_message_id:params.p_reply_to_message_id,
          created_at:'2026-10-01T00:00:00Z',
          action:{
            id:'hidden-action-id',
            action_type:'add_pickup',
            status:'pending',
            revision:0,
          },
        },
      };
    }
    throw new Error('unexpected RPC: ' + name);
  };
  return { calls, rpc };
}

test('pickup class time encoding reuses visible half-hour timetable labels', () => {
  assert.equal(pickup.encodePickupClassTime('half_hour', 3, 30), 7);
  assert.equal(pickup.encodePickupClassTime('half_hour', 4, 0), 4);
  assert.equal(pickup.encodePickupClassTime('half_hour', 4, 30), 8);
  assert.equal(pickup.encodePickupClassTime('half_hour', 5, 30), 9);
  assert.equal(pickup.encodePickupClassTime('hourly', 4, 0), 4);
  assert.equal(pickup.encodePickupClassTime('hourly', 4, 30), 0);
});

test('next occurrence matches existing Team Chat semantics including same-day application', () => {
  assert.equal(pickup.nextOccurrenceKey('2026-10-01', 4), '2026-10-01');
  assert.equal(pickup.nextOccurrenceKey('2026-10-01', 5), '2026-10-02');
  assert.equal(pickup.nextOccurrenceKey('2026-10-01', 1), '2026-10-05');
});

test('prepare arrival pickup keeps real identity server-side and returns anonymous pending data', async () => {
  const {calls, rpc} = baseRpc();
  let persistedMessage = null;
  const result = await pickup.preparePickupAddAction({
    requestContext:requestContext(),
    subjectAccess:subjectAccess(),
    studentLabel:'학생A',
    pickupKind:'arrival',
    weekday:4,
    classHour:4,
    classMinute:30,
    arrivalLabel:'리슈빌',
    arrivalTime:'15:20',
    dropoffLabel:'',
    currentDate:'2026-10-01',
    requestId:'pickup-source-123',
    replyToMessageId:321,
    capturePersistedMessage(message) { persistedMessage = message; },
    sanitizePayload(payload) { return payload; },
    callRpc:rpc,
  });

  assert.equal(result.status, 'pending');
  assert.equal(result.requires_confirmation, true);
  assert.equal(result.action_type, 'add_pickup');
  assert.equal(result.student_label, '학생A');
  assert.equal(result.weekday, 4);
  assert.equal(result.effective_date, '2026-10-01');
  assert.equal(result.class_time_label, '4시 30분');
  assert.equal(result.timetable_mode, 'half_hour');
  assert.equal(result.pickup_kind, 'arrival');
  assert.equal(result.arrival_label, '리슈빌');
  assert.equal(result.arrival_time, '15:20');
  assert.equal(result.dropoff_label, '');

  const action = calls.find((item) => item.name === 'olli_team_chat_send_action');
  assert.ok(action);
  assert.equal(action.params.p_action_type, 'add_pickup');
  assert.equal(action.params.p_action_payload.studentId, '11111111-1111-4111-8111-111111111111');
  assert.equal(action.params.p_action_payload.studentName, '최지안');
  assert.equal(action.params.p_action_payload.classTime, 8);
  assert.equal(action.params.p_action_payload.pickupLabel, '리슈빌');
  assert.equal(action.params.p_action_payload.pickupTime, '15:20');
  assert.equal(action.params.p_action_payload.dropoffLabel, '');
  assert.equal(action.params.p_action_payload.isDropoff, false);
  assert.equal(action.params.p_reply_to_message_id, 321);
  assert.equal(persistedMessage?.id, 987);
  assert.equal(persistedMessage?.reply_to_message_id, 321);
  assert.equal(persistedMessage?.action?.id, 'hidden-action-id');
  assert.match(action.params.p_body, /최지안/);
  assert.match(action.params.p_body, /4시 30분/);
  assert.doesNotMatch(action.params.p_body, /학생A/);

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(
    serialized,
    /최지안|11111111-1111-4111-8111-111111111111|hidden-action-id|server-session-secret|aaaaaaaa-aaaa/
  );
});

test('prepare dropoff-only pickup writes only dropoff fields to the pending action', async () => {
  const {calls, rpc} = baseRpc();
  const result = await pickup.preparePickupAddAction({
    requestContext:requestContext(),
    subjectAccess:subjectAccess(),
    studentLabel:'학생A',
    pickupKind:'dropoff',
    weekday:5,
    classHour:5,
    classMinute:30,
    arrivalLabel:'',
    arrivalTime:'',
    dropoffLabel:'정문',
    currentDate:'2026-10-01',
    requestId:'pickup-dropoff-1',
    sanitizePayload(payload) { return payload; },
    callRpc:rpc,
  });

  assert.equal(result.pickup_kind, 'dropoff');
  assert.equal(result.arrival_label, '');
  assert.equal(result.arrival_time, '');
  assert.equal(result.dropoff_label, '정문');

  const action = calls.find((item) => item.name === 'olli_team_chat_send_action');
  assert.equal(action.params.p_action_payload.classTime, 9);
  assert.equal(action.params.p_action_payload.pickupLabel, '');
  assert.equal(action.params.p_action_payload.pickupTime, '');
  assert.equal(action.params.p_action_payload.dropoffLabel, '정문');
  assert.equal(action.params.p_action_payload.isDropoff, true);
});

test('prepare combined arrival and dropoff pickup keeps both sides in one add action', async () => {
  const {calls, rpc} = baseRpc();
  const result = await pickup.preparePickupAddAction({
    requestContext:requestContext(),
    subjectAccess:subjectAccess(),
    studentLabel:'학생A',
    pickupKind:'both',
    weekday:6,
    classHour:4,
    classMinute:0,
    arrivalLabel:'리슈빌',
    arrivalTime:'15:10',
    dropoffLabel:'정문',
    currentDate:'2026-10-01',
    requestId:'pickup-both-1',
    sanitizePayload(payload) { return payload; },
    callRpc:rpc,
  });

  assert.equal(result.pickup_kind, 'both');
  const action = calls.find((item) => item.name === 'olli_team_chat_send_action');
  assert.equal(action.params.p_action_payload.pickupLabel, '리슈빌');
  assert.equal(action.params.p_action_payload.pickupTime, '15:10');
  assert.equal(action.params.p_action_payload.dropoffLabel, '정문');
  assert.equal(action.params.p_action_payload.isDropoff, false);
});

test('same request id produces the same pickup action client id', () => {
  const base = {
    academyId:'academy',
    memberId:'member',
  };
  const first = pickup.stablePickupActionClientMessageId({...base, requestId:'request-1'});
  const retry = pickup.stablePickupActionClientMessageId({...base, requestId:'request-1'});
  const second = pickup.stablePickupActionClientMessageId({...base, requestId:'request-2'});
  assert.equal(first, retry);
  assert.notEqual(first, second);
  assert.match(first, /^[0-9a-f-]{36}$/);
});

test('existing same student weekday and class blocks a second add action before storage', async () => {
  const {calls, rpc} = baseRpc({
    scheduleWeek:{
      ok:true,
      pickups:[{
        id:'existing-pickup',
        student_id:'11111111-1111-4111-8111-111111111111',
        weekday:4,
        class_time:8,
        effective_from:'2026-09-01',
        effective_to:null,
      }],
    },
  });

  await assert.rejects(
    pickup.preparePickupAddAction({
      requestContext:requestContext(),
      subjectAccess:subjectAccess(),
      studentLabel:'학생A',
      pickupKind:'arrival',
      weekday:4,
      classHour:4,
      classMinute:30,
      arrivalLabel:'리슈빌',
      arrivalTime:'15:20',
      currentDate:'2026-10-01',
      requestId:'pickup-duplicate-1',
      sanitizePayload(payload) { return payload; },
      callRpc:rpc,
    }),
    (error) => error?.code === 'OLLI_AGENT_PICKUP_ALREADY_EXISTS'
  );

  assert.equal(calls.some((item) => item.name === 'olli_team_chat_send_action'), false);
});

test('pickup prepare scope fixes one kinder student and pickup kind server-side', () => {
  const arrival = resolvePickupPrepareScope({
    safeText:'학생A 월요일 4시 픽업 등록해줘',
    subjectRefs:[{label:'학생A'}],
    subjectAccess:subjectAccess(),
  });
  assert.deepEqual(arrival, {subjectLabel:'학생A', pickupKind:'arrival'});

  const dropoff = resolvePickupPrepareScope({
    safeText:'학생A 월요일 4시 하원 픽업 정문 등록해줘',
    subjectRefs:[{label:'학생A'}],
    subjectAccess:subjectAccess(),
  });
  assert.deepEqual(dropoff, {subjectLabel:'학생A', pickupKind:'dropoff'});

  const both = resolvePickupPrepareScope({
    safeText:'학생A 등원 리슈빌, 하원 정문 픽업 등록해줘',
    subjectRefs:[{label:'학생A'}],
    subjectAccess:subjectAccess(),
  });
  assert.deepEqual(both, {subjectLabel:'학생A', pickupKind:'both'});
});

test('pickup prepare scope blocks ambiguous, multiple, and non-kinder subjects', () => {
  assert.throws(
    () => resolvePickupPrepareScope({
      safeText:'학생A 픽업',
      subjectRefs:[{label:'학생A'}],
      subjectAccess:subjectAccess(),
      needsDisambiguation:true,
    }),
    (error) => error?.code === 'OLLI_AGENT_STUDENT_AMBIGUOUS'
  );

  assert.throws(
    () => resolvePickupPrepareScope({
      safeText:'학생A 학생B 픽업',
      subjectRefs:[{label:'학생A'},{label:'학생B'}],
      subjectAccess:subjectAccess(),
    }),
    (error) => error?.code === 'OLLI_AGENT_PICKUP_SINGLE_STUDENT_REQUIRED'
  );

  assert.throws(
    () => resolvePickupPrepareScope({
      safeText:'학생A 픽업',
      subjectRefs:[{label:'학생A'}],
      subjectAccess:subjectAccess('elementary'),
    }),
    (error) => error?.code === 'OLLI_AGENT_PICKUP_KINDER_ONLY'
  );
});

test('pickup prepare validates required fields for each pickup kind', async () => {
  const {rpc} = baseRpc();
  await assert.rejects(
    pickup.preparePickupAddAction({
      requestContext:requestContext(),
      subjectAccess:subjectAccess(),
      studentLabel:'학생A',
      pickupKind:'arrival',
      weekday:4,
      classHour:4,
      classMinute:0,
      arrivalLabel:'리슈빌',
      arrivalTime:'',
      currentDate:'2026-10-01',
      requestId:'missing-arrival-time',
      sanitizePayload(payload) { return payload; },
      callRpc:rpc,
    }),
    (error) => error?.code === 'OLLI_AGENT_PICKUP_ARRIVAL_REQUIRED'
  );

  await assert.rejects(
    pickup.preparePickupAddAction({
      requestContext:requestContext(),
      subjectAccess:subjectAccess(),
      studentLabel:'학생A',
      pickupKind:'dropoff',
      weekday:4,
      classHour:4,
      classMinute:0,
      dropoffLabel:'',
      currentDate:'2026-10-01',
      requestId:'missing-dropoff',
      sanitizePayload(payload) { return payload; },
      callRpc:rpc,
    }),
    (error) => error?.code === 'OLLI_AGENT_PICKUP_DROPOFF_REQUIRED'
  );
});


test('pickup prepare rejects an invalid source reply id before storing an action', async () => {
  const {calls, rpc} = baseRpc();
  await assert.rejects(
    pickup.preparePickupAddAction({
      requestContext:requestContext(),
      subjectAccess:subjectAccess(),
      studentLabel:'학생A',
      pickupKind:'arrival',
      weekday:4,
      classHour:4,
      classMinute:0,
      arrivalLabel:'리슈빌',
      arrivalTime:'15:20',
      currentDate:'2026-10-01',
      requestId:'pickup-invalid-source',
      replyToMessageId:-1,
      sanitizePayload(payload) { return payload; },
      callRpc:rpc,
    }),
    (error) => error?.code === 'OLLI_AGENT_PICKUP_SOURCE_MESSAGE_INVALID'
  );
  assert.equal(calls.some((item) => item.name === 'olli_team_chat_send_action'), false);
});
