const test = require('node:test');
const assert = require('node:assert/strict');

const memo = require('../api/_lib/olli-agent/tools/timetable-memo-tools.cjs');
const { resolveTimetableMemoScope } = require('../api/_lib/olli-agent/runtime.cjs');

function requestContext() {
  return {
    sessionToken:'server-session-secret',
    academyId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    memberId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  };
}

test('half-hour memo slot encoding follows the shared timetable encoding', () => {
  assert.equal(memo.encodeMemoTimeSlot('elementary', 3, 'half_hour', 4, 30), 10);
  assert.equal(memo.encodeMemoTimeSlot('elementary', 3, 'half_hour', 5, 30), 11);
  assert.equal(memo.encodeMemoTimeSlot('kinder', 3, 'half_hour', 3, 30), 7);
  assert.equal(memo.encodeMemoTimeSlot('kinder', 3, 'half_hour', 4, 30), 8);
  assert.equal(memo.encodeMemoTimeSlot('elementary', 6, 'half_hour', 1, 0), 10);
  assert.equal(memo.encodeMemoTimeSlot('elementary', 6, 'half_hour', 1, 30), 0);
});

test('prepare add keeps real student identity server-side and returns anonymous pending data', async () => {
  const calls = [];
  const fakeRpc = async (name, params) => {
    calls.push({name,params});
    if (name === 'olli_academy_settings_get') {
      return { ok:true, academy:{ kinder_timetable_mode:'half_hour' } };
    }
    if (name === 'olli_schedule_week') {
      return {
        ok:true,
        timetable_mode:'half_hour',
        enrollments:[{
          student_id:'11111111-1111-4111-8111-111111111111',
          student_name:'최지안',
          division:'elementary',
          weekday:3,
          time_slot:10,
          class_group:'B',
          effective_from:'2026-01-01',
          effective_to:null,
        }],
        one_time_sessions:[],
        class_split_periods:[],
      };
    }
    if (name === 'olli_schedule_kinder_class_layouts') {
      return { ok:true, merged_slots:[] };
    }
    if (name === 'olli_team_chat_send_action') {
      return { ok:true, message:{ action:{ id:'hidden-action-id', status:'pending' } } };
    }
    throw new Error('unexpected RPC: ' + name);
  };

  const result = await memo.prepareTimetableMemoAction({
    requestContext:requestContext(),
    subjectAccess:{
      resolve(label) {
        assert.equal(label, '학생A');
        return {
          studentId:'11111111-1111-4111-8111-111111111111',
          division:'elementary',
        };
      },
    },
    studentLabel:'학생A',
    division:'elementary',
    operation:'add',
    sessionDate:'2026-09-30',
    hour:4,
    minute:30,
    classGroup:'AUTO',
    memoNote:'학생A 준비물 확인',
    requestId:'source-message-123',
    sanitizePayload(payload) { return payload; },
    callRpc:fakeRpc,
  });

  assert.equal(result.status, 'pending');
  assert.equal(result.requires_confirmation, true);
  assert.equal(result.time_slot, 10);
  assert.equal(result.time_label, '4시 30분');
  assert.equal(result.class_group, 'A');
  assert.equal(result.student_label, '학생A');

  const actionCall = calls.find((item) => item.name === 'olli_team_chat_send_action');
  assert.ok(actionCall);
  assert.equal(actionCall.params.p_action_type, 'add_timetable_memo');
  assert.equal(actionCall.params.p_action_payload.studentId, '11111111-1111-4111-8111-111111111111');
  assert.equal(actionCall.params.p_action_payload.studentName, '최지안');
  assert.equal(actionCall.params.p_action_payload.memoNote, '최지안 준비물 확인');
  assert.equal(actionCall.params.p_action_payload.timeSlot, 10);
  assert.equal(actionCall.params.p_action_payload.classGroup, 'A');
  assert.match(actionCall.params.p_body, /최지안/);
  assert.doesNotMatch(actionCall.params.p_body, /학생A/);

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /최지안|11111111-1111-4111-8111-111111111111|hidden-action-id|server-session-secret|aaaaaaaa-aaaa/);
});

test('same request id produces the same action client id', () => {
  const base = {
    academyId:'academy',
    memberId:'member',
    actionType:'add_timetable_memo',
  };
  const first = memo.stableActionClientMessageId({...base, requestId:'request-1'});
  const retry = memo.stableActionClientMessageId({...base, requestId:'request-1'});
  const second = memo.stableActionClientMessageId({...base, requestId:'request-2'});
  assert.equal(first, retry);
  assert.notEqual(first, second);
  assert.match(first, /^[0-9a-f-]{36}$/);
});

test('delete ambiguity never returns stored memo contents to the model', async () => {
  await assert.rejects(
    memo.prepareTimetableMemoAction({
      requestContext:requestContext(),
      subjectAccess:{ resolve(){ return null; } },
      studentLabel:'',
      division:'elementary',
      operation:'delete',
      sessionDate:'2026-09-30',
      hour:4,
      minute:30,
      classGroup:'AUTO',
      memoNote:'',
      requestId:'delete-request',
      sanitizePayload(payload) { return payload; },
      async callRpc(name) {
        if (name === 'olli_academy_settings_get') return { ok:true, academy:{ kinder_timetable_mode:'half_hour' } };
        if (name === 'olli_schedule_week') return { ok:true, timetable_mode:'half_hour', enrollments:[], one_time_sessions:[], class_split_periods:[] };
        if (name === 'olli_schedule_kinder_class_layouts') return { ok:true, merged_slots:[] };
        if (name === 'olli_schedule_cell_memos_week_v2') {
          return {
            ok:true,
            memos:[
              {id:'m1',division:'elementary',session_date:'2026-09-30',time_slot:10,class_group:'A',note:'비밀 학생명 A'},
              {id:'m2',division:'elementary',session_date:'2026-09-30',time_slot:10,class_group:'A',note:'비밀 학생명 B'},
            ],
          };
        }
        throw new Error('unexpected RPC: ' + name);
      },
    }),
    (error) => {
      assert.equal(error?.code, 'OLLI_AGENT_TIMETABLE_MEMO_DELETE_AMBIGUOUS');
      assert.doesNotMatch(error?.message || '', /비밀 학생명/);
      return true;
    }
  );
});

test('memo scope fixes student division and blocks a mismatch', () => {
  const scope = resolveTimetableMemoScope({
    safeText:'학생A 오늘 메모 등록해줘',
    subjectRefs:[{label:'학생A'}],
    subjectAccess:{ resolve(){ return {division:'kinder'}; } },
  });
  assert.deepEqual(scope, {
    subjectLabel:'학생A',
    division:'kinder',
    operation:'add',
  });

  assert.throws(
    () => resolveTimetableMemoScope({
      safeText:'학생A 초등부 메모 삭제해줘',
      subjectRefs:[{label:'학생A'}],
      subjectAccess:{resolve(){return {division:'kinder'};}},
    }),
    (error) => error?.code === 'OLLI_AGENT_TIMETABLE_MEMO_DIVISION_MISMATCH'
  );
});
