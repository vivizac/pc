'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  WORKFLOW_NAME,
  buildTraceGroupId,
  buildOlliTraceOptions,
  summarizeAgentRun,
  evaluateRunSummary,
  buildRouteOutcomeEvent,
  emitModelUsageDiagnostics,
  emitAgentInputDiagnostics,
  attachAgentPhaseTiming,
  wrapOlliAgentRun,
} = require('../api/_lib/olli-agent/observability.cjs');

function agent(name = 'Olli Student Schedule') {
  return { name };
}

function context(memberId = 'member-secret-1') {
  return {
    academyId: 'academy-secret-1',
    memberId,
    memberRole: 'teacher',
  };
}

test('trace grouping is stable for one academy/member and separated by member', () => {
  const first = buildTraceGroupId(context());
  const second = buildTraceGroupId(context());
  const otherMember = buildTraceGroupId(context('member-secret-2'));

  assert.equal(first, second);
  assert.notEqual(first, otherMember);
  assert.match(first, /^olli_team_talk_[a-f0-9]{32}$/);
  assert.doesNotMatch(first, /academy-secret|member-secret/);
});

test('trace options force redacted tracing and never serialize academy/member ids', () => {
  const options = buildOlliTraceOptions(agent(), {
    context: context(),
    session: { kind: 'opaque-session' },
    traceIncludeSensitiveData: true,
    workflowName: 'unsafe workflow',
    groupId: 'academy-secret-1',
    traceMetadata: {
      student: 'real student',
    },
  });

  assert.equal(options.traceIncludeSensitiveData, false);
  assert.equal(options.workflowName, WORKFLOW_NAME);
  assert.equal(options.traceMetadata.privacy, 'redacted');
  assert.equal(options.traceMetadata.surface, 'team_talk');
  assert.equal(options.context.academyId, 'academy-secret-1');
  assert.equal(options.session.kind, 'opaque-session');

  const tracingOnly = JSON.stringify({
    workflowName: options.workflowName,
    groupId: options.groupId,
    traceMetadata: options.traceMetadata,
    traceIncludeSensitiveData: options.traceIncludeSensitiveData,
  });
  assert.doesNotMatch(tracingOnly, /academy-secret|member-secret|real student/);
});

test('run summary records tool names and shapes without argument or output values', () => {
  const result = {
    finalOutput: '학생A는 화요일 4시에 수업이 있어요.',
    newItems: [
      {
        type: 'tool_call_item',
        rawItem: {
          type: 'function_call',
          name: 'get_student_schedule',
          arguments: JSON.stringify({
            subject_ref: 'subject_private_value',
            reference_date: '2026-10-02',
          }),
        },
      },
      {
        type: 'tool_call_output_item',
        rawItem: {
          type: 'function_call_result',
          name: 'get_student_schedule',
        },
        output: {
          sessions: [{ weekday: 2, time_slot: 16 }],
          private_value: 'must-not-leak',
        },
      },
      {
        type: 'message_output_item',
      },
    ],
  };

  const summary = summarizeAgentRun(agent(), result);
  assert.equal(summary.toolCallCount, 1);
  assert.deepEqual(summary.toolCalls[0], {
    name: 'get_student_schedule',
    argumentKeys: ['reference_date', 'subject_ref'],
  });
  assert.equal(summary.toolOutputs[0].shape.type, 'object');
  assert.deepEqual(summary.toolOutputs[0].shape.keys, ['private_value', 'sessions']);
  assert.equal(summary.finalOutputPresent, true);
  assert.equal(summary.modelResponseCount, null);

  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /subject_private_value|2026-10-02|must-not-leak|화요일|4시/);
});

test('eval contracts detect missing, unexpected and duplicate tools deterministically', () => {
  const summary = {
    toolCalls: [
      { name: 'get_student_schedule' },
      { name: 'get_student_schedule' },
      { name: 'unexpected_tool' },
    ],
    toolCallCount: 3,
    duplicateToolNames: ['get_student_schedule'],
    finalOutputPresent: false,
  };

  const evaluation = evaluateRunSummary(summary, {
    requiredTools: ['get_student_schedule', 'get_attendance'],
    allowedTools: ['get_student_schedule', 'get_attendance'],
    maxToolCalls: 2,
    requireFinalOutput: true,
    forbidDuplicateTools: true,
  });

  assert.equal(evaluation.ok, false);
  assert.deepEqual(evaluation.issues.sort(), [
    'DUPLICATE_TOOL_CALL',
    'FINAL_OUTPUT_MISSING',
    'REQUIRED_TOOL_MISSING:get_attendance',
    'TOOL_CALL_LIMIT_EXCEEDED',
    'UNEXPECTED_TOOL:unexpected_tool',
  ].sort());
});

test('wrapped SDK run applies safe trace options on the actual run boundary', async () => {
  const calls = [];
  const wrapped = wrapOlliAgentRun(async (receivedAgent, input, options) => {
    calls.push({ receivedAgent, input, options });
    return {
      finalOutput: 'ok',
      newItems: [],
    };
  });

  const runContext = context();
  const result = await wrapped(agent('Olli Pickup Read'), '학생A 픽업 알려줘', {
    context: runContext,
  });

  assert.equal(result.finalOutput, 'ok');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.traceIncludeSensitiveData, false);
  assert.equal(calls[0].options.workflowName, WORKFLOW_NAME);
  assert.match(calls[0].options.groupId, /^olli_team_talk_[a-f0-9]{32}$/);
  assert.equal(calls[0].options.context, runContext);
});


test('route outcome event keeps only fixed structural fields and drops private input', () => {
  const event = buildRouteOutcomeEvent({
    surface:'pc',
    outcome:'legacy_write',
    routeKey:'cancel_trial',
    sharedRouteKey:'trial_cancel',
    classifierAvailable:true,
    academyId:'academy-secret',
    memberId:'member-secret',
    sessionToken:'session-secret',
    message:'민수 체험 취소해줘',
  });

  assert.deepEqual(event, {
    version:1,
    surface:'pc',
    outcome:'legacy_write',
    routeKey:'cancel_trial',
    sharedRouteKey:'trial_cancel',
    classifierAvailable:true,
  });

  const serialized=JSON.stringify(event);
  assert.doesNotMatch(serialized,/academy-secret|member-secret|session-secret|민수/);
});

test('route outcome event rejects unknown surface/outcome and buckets unknown route keys', () => {
  assert.equal(buildRouteOutcomeEvent({surface:'web',outcome:'legacy_write'}),null);
  assert.equal(buildRouteOutcomeEvent({surface:'pc',outcome:'raw-message'}),null);
  assert.deepEqual(
    buildRouteOutcomeEvent({
      surface:'mobile',
      outcome:'legacy_read',
      routeKey:'student-private-value',
      sharedRouteKey:'private-shared-value',
      classifierAvailable:false,
    }),
    {
      version:1,
      surface:'mobile',
      outcome:'legacy_read',
      routeKey:'other',
      sharedRouteKey:'other',
      classifierAvailable:false,
    }
  );
});


test('Agent phase timing hooks emit only structural pre-tool, tool, and post-tool timings', async () => {
  const previousNodeEnv=process.env.NODE_ENV;
  const previousPerf=process.env.OLLI_AGENT_PERF_LOGS;
  const previousInfo=console.info;
  process.env.NODE_ENV='production';
  process.env.OLLI_AGENT_PERF_LOGS='1';

  const lines=[];
  console.info=(line)=>lines.push(String(line));

  class FakeAgent extends EventEmitter {
    constructor(){
      super();
      this.name='Olli Student Schedule Probe';
    }
  }

  try{
    const fake=new FakeAgent();
    const detach=attachAgentPhaseTiming(fake);
    fake.emit('agent_start',{},fake,[]);
    await new Promise((resolve)=>setTimeout(resolve,2));
    fake.emit('agent_tool_start',{}, {name:'get_student_schedule'}, {toolCall:{}});
    await new Promise((resolve)=>setTimeout(resolve,2));
    fake.emit('agent_tool_end',{}, {name:'get_student_schedule'}, '{"private":"must-not-log"}', {toolCall:{}});
    await new Promise((resolve)=>setTimeout(resolve,2));
    fake.emit('agent_end',{},'done');
    detach();

    const payloads=lines
      .filter((line)=>line.startsWith('[OLLI Agent Perf] '))
      .map((line)=>JSON.parse(line.slice('[OLLI Agent Perf] '.length)));

    assert.deepEqual(payloads.map((item)=>item.phase),[
      'agent_before_tool',
      'agent_tool_execution',
      'agent_after_tool',
    ]);
    assert.equal(payloads[1].tool,'get_student_schedule');
    assert.ok(payloads[1].toolOutputChars>0);
    assert.ok(payloads.every((item)=>typeof item.durationMs==='number'));
    assert.doesNotMatch(JSON.stringify(payloads),/academy-secret|member-secret|김민수|subject_private_value/i);
  }finally{
    console.info=previousInfo;
    if(previousNodeEnv===undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV=previousNodeEnv;
    if(previousPerf===undefined) delete process.env.OLLI_AGENT_PERF_LOGS;
    else process.env.OLLI_AGENT_PERF_LOGS=previousPerf;
  }
});


test('model usage diagnostics record per-call token counts without response content', () => {
  const previousNodeEnv=process.env.NODE_ENV;
  const previousPerf=process.env.OLLI_AGENT_PERF_LOGS;
  const previousInfo=console.info;
  process.env.NODE_ENV='production';
  process.env.OLLI_AGENT_PERF_LOGS='1';

  const lines=[];
  console.info=(line)=>lines.push(String(line));

  try{
    emitModelUsageDiagnostics(
      {name:'Olli Contextual Read'},
      {
        rawResponses:[
          {
            usage:{
              inputTokens:120,
              outputTokens:30,
              totalTokens:150,
              inputTokensDetails:{cached_tokens:20},
              outputTokensDetails:{reasoning_tokens:24},
            },
          },
          {
            usage:{
              inputTokens:180,
              outputTokens:18,
              totalTokens:198,
              inputTokensDetails:[{cached_tokens:40}],
              outputTokensDetails:[{reasoning_tokens:12}],
            },
          },
        ],
      }
    );

    const payloads=lines
      .filter((line)=>line.startsWith('[OLLI Agent Perf] '))
      .map((line)=>JSON.parse(line.slice('[OLLI Agent Perf] '.length)));

    assert.equal(payloads.length,2);
    assert.deepEqual(payloads.map((item)=>item.modelCallIndex),[1,2]);
    assert.deepEqual(payloads.map((item)=>item.reasoningTokens),[24,12]);
    assert.deepEqual(payloads.map((item)=>item.cachedInputTokens),[20,40]);
    assert.doesNotMatch(JSON.stringify(payloads),/must-not-log|김민수|academy-secret/i);
  }finally{
    console.info=previousInfo;
    if(previousNodeEnv===undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV=previousNodeEnv;
    if(previousPerf===undefined) delete process.env.OLLI_AGENT_PERF_LOGS;
    else process.env.OLLI_AGENT_PERF_LOGS=previousPerf;
  }
});

test('input diagnostics log only counts, never input text', () => {
  const previousNodeEnv=process.env.NODE_ENV;
  const previousPerf=process.env.OLLI_AGENT_PERF_LOGS;
  const previousInfo=console.info;
  process.env.NODE_ENV='production';
  process.env.OLLI_AGENT_PERF_LOGS='1';

  const lines=[];
  console.info=(line)=>lines.push(String(line));

  try{
    emitAgentInputDiagnostics(
      {
        name:'Olli Contextual Read',
        instructions:'private-instruction-text',
        tools:[{name:'get_student_schedule'}],
      },
      [
        {role:'user',content:'김민수 시간표 알려줘'},
        {role:'assistant',content:'화요일 5시예요'},
      ]
    );

    const payload=JSON.parse(
      lines.find((line)=>line.startsWith('[OLLI Agent Perf] '))
        .slice('[OLLI Agent Perf] '.length)
    );
    assert.equal(payload.phase,'agent_input_shape');
    assert.equal(payload.inputItems,2);
    assert.ok(payload.inputChars>0);
    assert.equal(payload.instructionsChars,'private-instruction-text'.length);
    assert.equal(payload.toolCount,1);
    assert.doesNotMatch(JSON.stringify(payload),/김민수|private-instruction-text|화요일/i);
  }finally{
    console.info=previousInfo;
    if(previousNodeEnv===undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV=previousNodeEnv;
    if(previousPerf===undefined) delete process.env.OLLI_AGENT_PERF_LOGS;
    else process.env.OLLI_AGENT_PERF_LOGS=previousPerf;
  }
});
