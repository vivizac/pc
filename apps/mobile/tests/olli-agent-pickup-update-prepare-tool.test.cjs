const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const update = require('../api/_lib/olli-agent/tools/pickup-update-prepare-tools.cjs');
const {
  resolvePickupUpdatePrepareScope,
} = require('../api/_lib/olli-agent/runtime.cjs');

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

function pickupRow(overrides = {}) {
  return {
    id:'22222222-2222-4222-8222-222222222222',
    student_id:'11111111-1111-4111-8111-111111111111',
    weekday:4,
    class_time:8,
    pickup_label:'리슈빌',
    pickup_time:'15:20:00',
    is_dropoff:false,
    dropoff_label:'정문',
    status:'active',
    effective_from:'2026-09-01',
    effective_to:null,
    ...overrides,
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
    if (name === 'olli_schedule_week') {
      return options.scheduleWeek || {
        ok:true,
        timetable_mode:'half_hour',
        pickups:[pickupRow()],
      };
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
            action_type:params.p_action_type,
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

function baseArgs(rpc) {
  return {
    requestContext:requestContext(),
    subjectAccess:subjectAccess(),
    studentLabel:'학생A',
    currentDate:'2026-10-01',
    requestId:'pickup-update-source-1',
    sanitizePayload(payload) { return payload; },
    callRpc:rpc,
  };
}

test('arrival update resolves a half-hour pickup row server-side and keeps pickupId private', async () => {
  const { calls, rpc } = baseRpc();
  const result = await update.preparePickupUpdateAction({
    ...baseArgs(rpc),
    updateKind:'arrival',
    weekday:4,
    classHour:4,
    classMinute:30,
    arrivalLabel:'새정문',
    arrivalTime:'',
    dropoffLabel:'',
  });

  assert.equal(result.status, 'pending');
  assert.equal(result.action_type, 'update_pickup_arrival');
  assert.equal(result.student_label, '학생A');
  assert.equal(result.weekday, 4);
  assert.equal(result.class_time_label, '4시 30분');
  assert.equal(result.timetable_mode, 'half_hour');
  assert.equal(result.update_kind, 'arrival');
  assert.equal(result.arrival_label, '새정문');
  assert.equal(result.arrival_time, '15:20');

  const week = calls.find((item) => item.name === 'olli_schedule_week');
  assert.equal(week.params.p_week_start, '2026-09-28');

  const action = calls.find((item) => item.name === 'olli_team_chat_send_action');
  assert.ok(action);
  assert.equal(action.params.p_action_type, 'update_pickup_arrival');
  assert.equal(action.params.p_action_payload.intent, 'update_pickup_arrival');
  assert.equal(action.params.p_action_payload.pickupId, '22222222-2222-4222-8222-222222222222');
  assert.equal(action.params.p_action_payload.studentId, '11111111-1111-4111-8111-111111111111');
  assert.equal(action.params.p_action_payload.studentName, '최지안');
  assert.equal(action.params.p_action_payload.classTime, 8);
  assert.equal(action.params.p_action_payload.pickupLabel, '새정문');
  assert.equal(action.params.p_action_payload.pickupTime, '15:20');

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(
    serialized,
    /최지안|11111111-1111-4111-8111-111111111111|22222222-2222-4222-8222-222222222222|hidden-action-id|server-session-secret|aaaaaaaa-aaaa/
  );
});

test('dropoff update uses the same existing row and prepares only a pending dropoff action', async () => {
  const { calls, rpc } = baseRpc();
  const result = await update.preparePickupUpdateAction({
    ...baseArgs(rpc),
    updateKind:'dropoff',
    weekday:4,
    classHour:4,
    classMinute:30,
    dropoffLabel:'후문',
  });

  assert.equal(result.action_type, 'update_pickup_dropoff');
  assert.equal(result.update_kind, 'dropoff');
  assert.equal(result.dropoff_label, '후문');
  assert.equal(result.arrival_label, '');
  assert.equal(result.arrival_time, '');

  const action = calls.find((item) => item.name === 'olli_team_chat_send_action');
  assert.equal(action.params.p_action_type, 'update_pickup_dropoff');
  assert.equal(action.params.p_action_payload.pickupId, '22222222-2222-4222-8222-222222222222');
  assert.equal(action.params.p_action_payload.dropoffLabel, '후문');
  assert.equal(
    calls.some((item) => [
      'olli_schedule_save_pickup_arrival',
      'olli_schedule_register_pickup_dropoff',
      'olli_schedule_remove_pickup',
      'olli_schedule_remove_pickup_dropoff',
    ].includes(item.name)),
    false
  );
});

test('omitted weekday and class time resolve only when one active pickup is unique', async () => {
  const { calls, rpc } = baseRpc();
  const result = await update.preparePickupUpdateAction({
    ...baseArgs(rpc),
    updateKind:'arrival',
    weekday:0,
    classHour:0,
    classMinute:0,
    arrivalLabel:'',
    arrivalTime:'15:40',
  });

  assert.equal(result.weekday, 4);
  assert.equal(result.class_time_label, '4시 30분');
  assert.equal(result.arrival_label, '리슈빌');
  assert.equal(result.arrival_time, '15:40');
  assert.ok(calls.some((item) => item.name === 'olli_team_chat_send_action'));
});

test('multiple matching pickup rows are never guessed', async () => {
  const { calls, rpc } = baseRpc({
    scheduleWeek:{
      ok:true,
      timetable_mode:'half_hour',
      pickups:[
        pickupRow(),
        pickupRow({
          id:'33333333-3333-4333-8333-333333333333',
          weekday:5,
          class_time:9,
        }),
      ],
    },
  });

  await assert.rejects(
    update.preparePickupUpdateAction({
      ...baseArgs(rpc),
      updateKind:'arrival',
      weekday:0,
      classHour:0,
      classMinute:0,
      arrivalLabel:'새정문',
      arrivalTime:'',
    }),
    (error) => error?.code === 'OLLI_AGENT_PICKUP_UPDATE_AMBIGUOUS'
  );

  assert.equal(calls.some((item) => item.name === 'olli_team_chat_send_action'), false);
});

test('missing pickup row is blocked before action storage', async () => {
  const { calls, rpc } = baseRpc({
    scheduleWeek:{
      ok:true,
      timetable_mode:'half_hour',
      pickups:[],
    },
  });

  await assert.rejects(
    update.preparePickupUpdateAction({
      ...baseArgs(rpc),
      updateKind:'dropoff',
      weekday:4,
      classHour:4,
      classMinute:30,
      dropoffLabel:'후문',
    }),
    (error) => error?.code === 'OLLI_AGENT_PICKUP_UPDATE_NOT_FOUND'
  );

  assert.equal(calls.some((item) => item.name === 'olli_team_chat_send_action'), false);
});

test('dropoff-only row can gain arrival only when arrival place and time are both provided', async () => {
  const { calls, rpc } = baseRpc({
    scheduleWeek:{
      ok:true,
      timetable_mode:'half_hour',
      pickups:[pickupRow({
        pickup_label:'정문',
        pickup_time:null,
        is_dropoff:true,
        dropoff_label:'정문',
      })],
    },
  });

  const result = await update.preparePickupUpdateAction({
    ...baseArgs(rpc),
    updateKind:'arrival',
    weekday:4,
    classHour:4,
    classMinute:30,
    arrivalLabel:'리슈빌',
    arrivalTime:'15:10',
  });
  assert.equal(result.arrival_label, '리슈빌');
  assert.equal(result.arrival_time, '15:10');

  const action = calls.find((item) => item.name === 'olli_team_chat_send_action');
  assert.equal(action.params.p_action_payload.pickupLabel, '리슈빌');
  assert.equal(action.params.p_action_payload.pickupTime, '15:10');

  const { calls:missingCalls, rpc:missingRpc } = baseRpc({
    scheduleWeek:{
      ok:true,
      timetable_mode:'half_hour',
      pickups:[pickupRow({
        pickup_label:'정문',
        pickup_time:null,
        is_dropoff:true,
        dropoff_label:'정문',
      })],
    },
  });

  await assert.rejects(
    update.preparePickupUpdateAction({
      ...baseArgs(missingRpc),
      updateKind:'arrival',
      weekday:4,
      classHour:4,
      classMinute:30,
      arrivalLabel:'',
      arrivalTime:'15:10',
    }),
    (error) => error?.code === 'OLLI_AGENT_PICKUP_UPDATE_ARRIVAL_REQUIRED'
  );
  assert.equal(missingCalls.some((item) => item.name === 'olli_team_chat_send_action'), false);
});

test('same update request id always produces the same generic retry key', () => {
  const base = {
    academyId:'academy',
    memberId:'member',
    requestId:'source-77',
  };
  const first = update.stablePickupUpdateClientMessageId(base);
  const retry = update.stablePickupUpdateClientMessageId(base);
  const other = update.stablePickupUpdateClientMessageId({...base, requestId:'source-78'});

  assert.equal(first, retry);
  assert.notEqual(first, other);
  assert.match(first, /^[0-9a-f-]{36}$/);
});

test('pickup update scope fixes one kinder student and update kind server-side', () => {
  const arrival = resolvePickupUpdatePrepareScope({
    safeText:'학생A 목요일 4시 30분 픽업 시간을 변경해줘',
    subjectRefs:[{label:'학생A'}],
    subjectAccess:subjectAccess(),
  });
  assert.deepEqual(arrival, {subjectLabel:'학생A', updateKind:'arrival'});

  const dropoff = resolvePickupUpdatePrepareScope({
    safeText:'학생A 목요일 4시 30분 하원 픽업 장소를 후문으로 바꿔줘',
    subjectRefs:[{label:'학생A'}],
    subjectAccess:subjectAccess(),
  });
  assert.deepEqual(dropoff, {subjectLabel:'학생A', updateKind:'dropoff'});
});

test('pickup update scope rejects non-update, delete, ambiguous, multiple, and non-kinder requests', () => {
  assert.throws(
    () => resolvePickupUpdatePrepareScope({
      safeText:'학생A 픽업 등록해줘',
      subjectRefs:[{label:'학생A'}],
      subjectAccess:subjectAccess(),
    }),
    (error) => error?.code === 'OLLI_AGENT_PICKUP_UPDATE_INTENT_REQUIRED'
  );

  assert.throws(
    () => resolvePickupUpdatePrepareScope({
      safeText:'학생A 픽업 삭제해줘',
      subjectRefs:[{label:'학생A'}],
      subjectAccess:subjectAccess(),
    }),
    (error) => error?.code === 'OLLI_AGENT_PICKUP_UPDATE_INTENT_REQUIRED'
  );

  assert.throws(
    () => resolvePickupUpdatePrepareScope({
      safeText:'학생A 픽업 변경해줘',
      subjectRefs:[{label:'학생A'}],
      subjectAccess:subjectAccess(),
      needsDisambiguation:true,
    }),
    (error) => error?.code === 'OLLI_AGENT_STUDENT_AMBIGUOUS'
  );

  assert.throws(
    () => resolvePickupUpdatePrepareScope({
      safeText:'학생A 학생B 픽업 변경해줘',
      subjectRefs:[{label:'학생A'},{label:'학생B'}],
      subjectAccess:subjectAccess(),
    }),
    (error) => error?.code === 'OLLI_AGENT_PICKUP_UPDATE_SINGLE_STUDENT_REQUIRED'
  );

  assert.throws(
    () => resolvePickupUpdatePrepareScope({
      safeText:'학생A 픽업 변경해줘',
      subjectRefs:[{label:'학생A'}],
      subjectAccess:subjectAccess('elementary'),
    }),
    (error) => error?.code === 'OLLI_AGENT_PICKUP_UPDATE_KINDER_ONLY'
  );
});

test('endpoint keeps update probe and adds a source-bound production mode', () => {
  const endpoint = fs.readFileSync(
    path.join(__dirname, '../api/olli-agent.js'),
    'utf8'
  );
  assert.match(endpoint, /'pickup_update_prepare_probe'/);
  assert.match(endpoint, /runPickupUpdatePrepareProbe/);
  assert.match(endpoint, /pickup_update_prepare_probe에는 재시도 중복 방지용 requestId가 필요합니다/);
  assert.match(endpoint, /mode === 'pickup_update_prepare'/);
  assert.match(endpoint, /pickup_update_prepare에는 저장된 원문 Team Chat message id가 필요합니다/);
  assert.match(endpoint, /runPickupUpdatePrepare\(/);
  assert.match(endpoint, /sourceMessageText: message/);
  assert.match(endpoint, /mode:'pickup_update_prepare'/);
  assert.match(endpoint, /message:probe\.persistedMessage/);
});
