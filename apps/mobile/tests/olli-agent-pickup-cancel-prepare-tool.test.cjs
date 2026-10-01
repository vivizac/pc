const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cancel = require('../api/_lib/olli-agent/tools/pickup-cancel-prepare-tools.cjs');
const {
  resolvePickupCancelPrepareScope,
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
          body:params.p_body,
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
  return {calls, rpc};
}

function baseArgs(rpc) {
  return {
    requestContext:requestContext(),
    subjectAccess:subjectAccess(),
    studentLabel:'학생A',
    currentDate:'2026-10-01',
    requestId:'pickup-cancel-source-1',
    sanitizePayload(payload) { return payload; },
    callRpc:rpc,
  };
}

test('whole pickup cancellation prepares cancel_pickup with server-fixed current effective date and keeps private ids out of egress', async () => {
  const {calls, rpc} = baseRpc();
  const result = await cancel.preparePickupCancelAction({
    ...baseArgs(rpc),
    cancelKind:'all',
    weekday:4,
    classHour:4,
    classMinute:30,
  });

  assert.equal(result.status, 'pending');
  assert.equal(result.action_type, 'cancel_pickup');
  assert.equal(result.cancel_kind, 'all');
  assert.equal(result.effective_date, '2026-10-01');
  assert.equal(result.class_time_label, '4시 30분');

  const action = calls.find((item) => item.name === 'olli_team_chat_send_action');
  assert.equal(action.params.p_action_type, 'cancel_pickup');
  assert.equal(action.params.p_action_payload.intent, 'cancel_pickup');
  assert.equal(action.params.p_action_payload.pickupId, '22222222-2222-4222-8222-222222222222');
  assert.equal(action.params.p_action_payload.studentId, '11111111-1111-4111-8111-111111111111');
  assert.equal(action.params.p_action_payload.effectiveDate, '2026-10-01');

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(
    serialized,
    /최지안|11111111-1111-4111-8111-111111111111|22222222-2222-4222-8222-222222222222|hidden-action-id|server-session-secret|aaaaaaaa-aaaa/
  );
});

test('dropoff cancellation prepares only cancel_pickup_dropoff and never calls schedule mutation RPCs', async () => {
  const {calls, rpc} = baseRpc();
  const result = await cancel.preparePickupCancelAction({
    ...baseArgs(rpc),
    cancelKind:'dropoff',
    weekday:4,
    classHour:4,
    classMinute:30,
  });

  assert.equal(result.action_type, 'cancel_pickup_dropoff');
  assert.equal(result.cancel_kind, 'dropoff');
  assert.equal(result.effective_date, '');

  const action = calls.find((item) => item.name === 'olli_team_chat_send_action');
  assert.equal(action.params.p_action_type, 'cancel_pickup_dropoff');
  assert.equal(
    calls.some((item) => [
      'olli_schedule_remove_pickup',
      'olli_schedule_remove_pickup_dropoff',
      'olli_schedule_save_pickup_arrival',
      'olli_schedule_register_pickup_dropoff',
    ].includes(item.name)),
    false
  );
});

test('dropoff-only pickup row is a valid dropoff cancellation target', async () => {
  const {calls, rpc} = baseRpc({
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

  const result = await cancel.preparePickupCancelAction({
    ...baseArgs(rpc),
    cancelKind:'dropoff',
    weekday:4,
    classHour:4,
    classMinute:30,
  });
  assert.equal(result.action_type, 'cancel_pickup_dropoff');
  assert.ok(calls.some((item) => item.name === 'olli_team_chat_send_action'));
});

test('dropoff cancellation refuses an arrival-only pickup row', async () => {
  const {calls, rpc} = baseRpc({
    scheduleWeek:{
      ok:true,
      timetable_mode:'half_hour',
      pickups:[pickupRow({dropoff_label:null})],
    },
  });

  await assert.rejects(
    cancel.preparePickupCancelAction({
      ...baseArgs(rpc),
      cancelKind:'dropoff',
      weekday:4,
      classHour:4,
      classMinute:30,
    }),
    (error) => error?.code === 'OLLI_AGENT_PICKUP_CANCEL_NOT_FOUND'
  );
  assert.equal(calls.some((item) => item.name === 'olli_team_chat_send_action'), false);
});

test('half-hour visible class time resolves to the existing stored slot server-side', async () => {
  const {calls, rpc} = baseRpc();
  await cancel.preparePickupCancelAction({
    ...baseArgs(rpc),
    cancelKind:'all',
    weekday:4,
    classHour:4,
    classMinute:30,
  });
  const action = calls.find((item) => item.name === 'olli_team_chat_send_action');
  assert.equal(action.params.p_action_payload.classTime, 8);
});

test('omitted weekday and class time are accepted only when the active pickup target is unique', async () => {
  const {rpc} = baseRpc();
  const result = await cancel.preparePickupCancelAction({
    ...baseArgs(rpc),
    cancelKind:'all',
    weekday:0,
    classHour:0,
    classMinute:0,
  });
  assert.equal(result.weekday, 4);
  assert.equal(result.class_time_label, '4시 30분');
});

test('multiple matching pickup rows are never guessed', async () => {
  const {calls, rpc} = baseRpc({
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
    cancel.preparePickupCancelAction({
      ...baseArgs(rpc),
      cancelKind:'all',
      weekday:0,
      classHour:0,
      classMinute:0,
    }),
    (error) => error?.code === 'OLLI_AGENT_PICKUP_CANCEL_AMBIGUOUS'
  );
  assert.equal(calls.some((item) => item.name === 'olli_team_chat_send_action'), false);
});

test('missing pickup row is blocked before action storage', async () => {
  const {calls, rpc} = baseRpc({
    scheduleWeek:{ok:true, timetable_mode:'half_hour', pickups:[]},
  });
  await assert.rejects(
    cancel.preparePickupCancelAction({
      ...baseArgs(rpc),
      cancelKind:'all',
      weekday:4,
      classHour:4,
      classMinute:30,
    }),
    (error) => error?.code === 'OLLI_AGENT_PICKUP_CANCEL_NOT_FOUND'
  );
  assert.equal(calls.some((item) => item.name === 'olli_team_chat_send_action'), false);
});

test('same cancel request id produces a stable generic retry key', () => {
  const base = {academyId:'academy', memberId:'member', requestId:'source-77'};
  const first = cancel.stablePickupCancelClientMessageId(base);
  const retry = cancel.stablePickupCancelClientMessageId(base);
  const other = cancel.stablePickupCancelClientMessageId({...base, requestId:'source-78'});
  assert.equal(first, retry);
  assert.notEqual(first, other);
  assert.match(first, /^[0-9a-f-]{36}$/);
});

test('pickup cancel scope fixes all versus dropoff server-side and rejects unsafe scopes', () => {
  const allScope = resolvePickupCancelPrepareScope({
    safeText:'학생A 목요일 4시 30분 픽업 삭제해줘',
    subjectRefs:[{label:'학생A'}],
    subjectAccess:subjectAccess(),
  });
  assert.deepEqual(allScope, {subjectLabel:'학생A', cancelKind:'all'});

  const dropoff = resolvePickupCancelPrepareScope({
    safeText:'학생A 목요일 4시 30분 하원 픽업만 삭제해줘',
    subjectRefs:[{label:'학생A'}],
    subjectAccess:subjectAccess(),
  });
  assert.deepEqual(dropoff, {subjectLabel:'학생A', cancelKind:'dropoff'});

  assert.throws(
    () => resolvePickupCancelPrepareScope({
      safeText:'학생A 픽업 변경해줘',
      subjectRefs:[{label:'학생A'}],
      subjectAccess:subjectAccess(),
    }),
    (error) => error?.code === 'OLLI_AGENT_PICKUP_CANCEL_INTENT_REQUIRED'
  );
  assert.throws(
    () => resolvePickupCancelPrepareScope({
      safeText:'학생A 픽업 삭제해줘',
      subjectRefs:[{label:'학생A'}],
      subjectAccess:subjectAccess(),
      needsDisambiguation:true,
    }),
    (error) => error?.code === 'OLLI_AGENT_STUDENT_AMBIGUOUS'
  );
  assert.throws(
    () => resolvePickupCancelPrepareScope({
      safeText:'학생A 학생B 픽업 삭제해줘',
      subjectRefs:[{label:'학생A'},{label:'학생B'}],
      subjectAccess:subjectAccess(),
    }),
    (error) => error?.code === 'OLLI_AGENT_PICKUP_CANCEL_SINGLE_STUDENT_REQUIRED'
  );
  assert.throws(
    () => resolvePickupCancelPrepareScope({
      safeText:'학생A 픽업 삭제해줘',
      subjectRefs:[{label:'학생A'}],
      subjectAccess:subjectAccess('elementary'),
    }),
    (error) => error?.code === 'OLLI_AGENT_PICKUP_CANCEL_KINDER_ONLY'
  );
});

test('cancel tool does not expose cancel kind or effective date to the model', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../api/_lib/olli-agent/tools/pickup-cancel-prepare-tools.cjs'),
    'utf8'
  );
  const start = source.indexOf("parameters:z.object({");
  const end = source.indexOf("}),\n    async execute", start);
  const schema = source.slice(start, end);
  assert.match(schema, /weekday/);
  assert.match(schema, /class_hour/);
  assert.match(schema, /class_minute/);
  assert.doesNotMatch(schema, /cancel_kind|effective_date|pickup_id|student_id/);
});

test('endpoint exposes cancel as probe-only mode with request id', () => {
  const endpoint = fs.readFileSync(
    path.join(__dirname, '../api/olli-agent.js'),
    'utf8'
  );
  assert.match(endpoint, /'pickup_cancel_prepare_probe'/);
  assert.match(endpoint, /mode === 'pickup_cancel_prepare_probe'/);
  assert.match(endpoint, /pickup_cancel_prepare_probe에는 재시도 중복 방지용 requestId가 필요합니다/);
  assert.match(endpoint, /runPickupCancelPrepareProbe/);
  assert.doesNotMatch(endpoint, /mode === 'pickup_cancel_prepare'/);
});
