'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  recentConversation,
  resolveContextualReadRewrite,
} = require('../apps/mobile/api/_lib/olli-agent/context-route.cjs');

test('recentConversation keeps only current member and Olli AI before the source message', () => {
  const result = recentConversation([
    { id:1, message_type:'text', sender_member_id:'member-a', body:'테스트 학생 시간표 알려줘' },
    { id:2, message_type:'text', sender_member_id:'member-b', body:'다른 선생님 메시지' },
    { id:3, message_type:'ai', reply_to_message_id:1, body:'정규 수업이 없습니다.' },
    { id:4, message_type:'text', sender_member_id:'member-a', body:'테스트2학생은?' },
  ], 'member-a', 4);

  assert.deepEqual(result, [
    { role:'user', text:'테스트 학생 시간표 알려줘' },
    { role:'assistant', text:'정규 수업이 없습니다.' },
  ]);
});

test('context resolver anonymizes names and restores a standalone follow-up request', async () => {
  let observed = null;
  const result = await resolveContextualReadRewrite({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:3,
    currentMessage:'테스트2학생은?',
    callRpc:async (name, params) => {
      assert.equal(name, 'olli_team_chat_list');
      assert.equal(params.p_academy_id, 'academy');
      return {
        ok:true,
        messages:[
          { id:1, message_type:'text', sender_member_id:'member-a', body:'테스트 학생의 시간표를 알려줘' },
          { id:2, message_type:'ai', reply_to_message_id:1, body:'2026-10-02 기준으로 테스트 학생의 정규 수업이 없습니다.' },
          { id:3, message_type:'text', sender_member_id:'member-a', body:'테스트2학생은?' },
        ],
      };
    },
    loadStudents:async () => [
      { id:'student-1', name:'테스트 학생' },
      { id:'student-2', name:'테스트2학생' },
    ],
    modelRunner:async (input) => {
      observed=input;
      return '학생B의 시간표를 알려줘';
    },
  });

  assert.ok(observed);
  assert.match(observed.transcript, /학생A/);
  assert.doesNotMatch(observed.transcript, /테스트 학생/);
  assert.match(observed.currentText, /학생B/);
  assert.doesNotMatch(observed.currentText, /테스트2학생/);
  assert.equal(result.usedContext, true);
  assert.equal(result.resolvedText, '테스트2학생의 시간표를 알려줘');
});

test('context resolver does not call AI without a preceding Olli reply', async () => {
  let called = false;
  const result = await resolveContextualReadRewrite({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:2,
    currentMessage:'테스트2학생은?',
    callRpc:async () => ({
      ok:true,
      messages:[
        { id:1, message_type:'text', sender_member_id:'member-a', body:'테스트 학생 시간표 알려줘' },
        { id:2, message_type:'text', sender_member_id:'member-a', body:'테스트2학생은?' },
      ],
    }),
    loadStudents:async () => [],
    modelRunner:async () => {
      called=true;
      return 'should not run';
    },
  });

  assert.equal(called, false);
  assert.equal(result.usedContext, false);
  assert.equal(result.resolvedText, '테스트2학생은?');
});
