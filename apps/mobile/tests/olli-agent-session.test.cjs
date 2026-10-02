'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createOlliAgentSession,
  MAX_SESSION_ITEMS,
} = require('../api/_lib/olli-agent/session.cjs');

function context() {
  return {
    academyId: 'academy-1',
    memberId: 'member-1',
    sessionToken: 'session-secret',
  };
}

test('session requires authenticated academy/member/session context', () => {
  assert.throws(
    () => createOlliAgentSession({ requestContext: {} }),
    (error) => error?.code === 'OLLI_AGENT_SESSION_CONTEXT_REQUIRED'
  );
});

test('getSessionId is scoped and cached without exposing secrets on serialization', async () => {
  const calls = [];
  const session = createOlliAgentSession({
    requestContext: context(),
    runKey: 'team-chat-message:77',
    callRpc: async (name, params) => {
      calls.push({ name, params });
      return { ok: true, session_id: 'agent-session-1' };
    },
  });

  assert.equal(await session.getSessionId(), 'agent-session-1');
  assert.equal(await session.getSessionId(), 'agent-session-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'olli_agent_session_access');
  assert.equal(calls[0].params.p_academy_id, 'academy-1');
  assert.equal(calls[0].params.p_member_id, 'member-1');
  assert.equal(calls[0].params.p_surface, 'team_talk');
  assert.equal(calls[0].params.p_action, 'ensure');
  assert.equal(calls[0].params.p_session_token, 'session-secret');
  assert.equal(JSON.stringify(session), '{}');
});

test('getItems requests bounded recent history and preserves returned order', async () => {
  const payloads = [];
  const session = createOlliAgentSession({
    requestContext: context(),
    callRpc: async (_name, params) => {
      payloads.push(params);
      return {
        ok: true,
        session_id: 'agent-session-1',
        items: [{ role: 'user', content: 'A' }, { role: 'assistant', content: 'B' }],
      };
    },
  });

  const items = await session.getItems(9999);
  assert.deepEqual(items, [
    { role: 'user', content: 'A' },
    { role: 'assistant', content: 'B' },
  ]);
  assert.equal(payloads[0].p_payload.limit, MAX_SESSION_ITEMS);
});

test('addItems uses deterministic per-run batch keys for retry-safe writes', async () => {
  const payloads = [];
  const session = createOlliAgentSession({
    requestContext: context(),
    runKey: 'team-chat-message:88',
    callRpc: async (_name, params) => {
      payloads.push(params);
      return { ok: true, session_id: 'agent-session-1' };
    },
  });

  await session.addItems([{ role: 'user', content: '학생A 수업 알려줘' }]);
  await session.addItems([{ role: 'assistant', content: '확인했어요.' }]);

  assert.equal(payloads[0].p_payload.batch_key, 'team-chat-message:88:1');
  assert.equal(payloads[1].p_payload.batch_key, 'team-chat-message:88:2');
  assert.equal(payloads[0].p_action, 'add_items');
  assert.equal(payloads[1].p_action, 'add_items');
});

test('popItem and clearSession follow the SDK Session contract', async () => {
  const actions = [];
  const session = createOlliAgentSession({
    requestContext: context(),
    callRpc: async (_name, params) => {
      actions.push(params.p_action);
      if (params.p_action === 'pop_item') {
        return {
          ok: true,
          session_id: 'agent-session-1',
          item: { role: 'assistant', content: 'last' },
        };
      }
      return { ok: true, session_id: 'agent-session-1' };
    },
  });

  assert.deepEqual(await session.popItem(), { role: 'assistant', content: 'last' });
  await session.clearSession();
  assert.deepEqual(actions, ['pop_item', 'clear']);
});

test('subject bindings keep real student ids non-enumerable', async () => {
  const calls = [];
  const session = createOlliAgentSession({
    requestContext: context(),
    callRpc: async (_name, params) => {
      calls.push(params);
      return {
        ok: true,
        session_id: 'agent-session-1',
        subjects: [{
          label: '학생A',
          subject_ref: 'subject_abcdefghijklmnop',
          student_id: 'real-student-uuid',
          last_used_at: '2026-10-02T00:00:00Z',
        }],
      };
    },
  });

  const bindings = await session.bindSubjectBindings([{
    label: '학생A',
    subjectRef: 'subject_abcdefghijklmnop',
    studentId: 'real-student-uuid',
  }]);

  assert.equal(calls[0].p_action, 'bind_subjects');
  assert.equal(bindings[0].studentId, 'real-student-uuid');
  assert.deepEqual(JSON.parse(JSON.stringify(bindings[0])), {
    label: '학생A',
    subjectRef: 'subject_abcdefghijklmnop',
    lastUsedAt: '2026-10-02T00:00:00Z',
  });
});
