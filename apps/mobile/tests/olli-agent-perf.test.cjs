'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPerfEvent,
  startPerfTimer,
  perfDurationMs,
} = require('../api/_lib/olli-agent/perf.cjs');

test('perf event keeps timing metadata only and drops private values', () => {
  const event = buildPerfEvent({
    phase:'agent_run',
    status:'ok',
    mode:'schedule_read',
    agent:'Olli Student Schedule',
    rpc:'olli_schedule_student_enrollments',
    tool:'get_student_schedule',
    durationMs:123.456,
    httpStatus:200,
    toolCallCount:1,
    assistantMessageCount:1,
    modelResponseCount:2,
    modelCallIndex:2,
    inputTokens:321,
    outputTokens:45,
    totalTokens:366,
    reasoningTokens:32,
    cachedInputTokens:100,
    inputItems:3,
    inputChars:512,
    instructionsChars:420,
    toolCount:1,
    toolOutputChars:180,
    academyId:'academy-secret',
    sessionToken:'session-secret',
    message:'민수 시간표 알려줘',
  });

  assert.deepEqual(event, {
    version:1,
    phase:'agent_run',
    status:'ok',
    mode:'schedule_read',
    agent:'Olli_Student_Schedule',
    rpc:'olli_schedule_student_enrollments',
    tool:'get_student_schedule',
    durationMs:123.456,
    httpStatus:200,
    toolCallCount:1,
    assistantMessageCount:1,
    modelResponseCount:2,
    modelCallIndex:2,
    inputTokens:321,
    outputTokens:45,
    totalTokens:366,
    reasoningTokens:32,
    cachedInputTokens:100,
    inputItems:3,
    inputChars:512,
    instructionsChars:420,
    toolCount:1,
    toolOutputChars:180,
  });

  const serialized=JSON.stringify(event);
  assert.doesNotMatch(serialized,/academy-secret|session-secret|민수/);
});

test('perf duration uses monotonic timer and returns milliseconds', async () => {
  const startedAt=startPerfTimer();
  await new Promise((resolve)=>setTimeout(resolve,5));
  const duration=perfDurationMs(startedAt);
  assert.equal(typeof duration,'number');
  assert.ok(duration>=0);
});
