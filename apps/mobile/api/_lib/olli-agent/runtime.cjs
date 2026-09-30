'use strict';

const MIN_NODE_MAJOR = 22;

function runtimeError(message, statusCode = 500, code = 'OLLI_AGENT_RUNTIME_ERROR') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function nodeMajorVersion() {
  return Number(String(process.versions?.node || '').split('.')[0] || 0);
}

function assertSupportedNodeRuntime() {
  const major = nodeMajorVersion();
  if (!Number.isFinite(major) || major < MIN_NODE_MAJOR) {
    throw runtimeError(
      `OpenAI Agents SDK는 Node.js ${MIN_NODE_MAJOR} 이상이 필요합니다. 현재 runtime: ${process.versions?.node || 'unknown'}`,
      500,
      'OLLI_AGENT_NODE_UNSUPPORTED'
    );
  }
  return major;
}

function todayInSeoul() {
  const shifted = new Date(Date.now() + (9 * 60 * 60 * 1000));
  return shifted.toISOString().slice(0, 10);
}

async function loadAgentsSdk() {
  assertSupportedNodeRuntime();

  const [agentsSdk, zodModule] = await Promise.all([
    import('@openai/agents'),
    import('zod'),
  ]);

  if (
    !agentsSdk?.Agent ||
    typeof agentsSdk?.run !== 'function' ||
    typeof agentsSdk?.tool !== 'function' ||
    !zodModule?.z
  ) {
    throw runtimeError(
      'OpenAI Agents SDK 의존성을 불러오지 못했습니다.',
      500,
      'OLLI_AGENT_SDK_LOAD_FAILED'
    );
  }

  return {
    Agent: agentsSdk.Agent,
    run: agentsSdk.run,
    tool: agentsSdk.tool,
    z: zodModule.z,
  };
}

function agentModel() {
  return (
    String(process.env.OPENAI_AGENT_MODEL || process.env.OPENAI_MODEL || '').trim() ||
    'gpt-5-mini'
  );
}

function assertOpenAiKey() {
  if (!process.env.OPENAI_API_KEY) {
    throw runtimeError(
      'OPENAI_API_KEY가 서버 환경변수에 설정되지 않았습니다.',
      500,
      'OPENAI_API_KEY_MISSING'
    );
  }
}

async function runFoundationProbe(agentContext) {
  assertOpenAiKey();

  const { Agent, run } = await loadAgentsSdk();
  const model = agentModel();

  const agent = new Agent({
    name: 'Olli Foundation Probe',
    model,
    instructions: [
      'You are a private diagnostic agent for the Olli application.',
      'This probe has no business tools and must not infer, retrieve, or modify academy data.',
      'When asked for the readiness token, reply with OLLI_AGENT_READY only.',
    ].join(' '),
    tools: [],
  });

  const result = await run(
    agent,
    'Return the readiness token OLLI_AGENT_READY only.',
    {
      context: agentContext,
    }
  );

  const finalOutput = String(result?.finalOutput || '').trim();
  if (!finalOutput) {
    throw runtimeError(
      'Agents SDK probe 응답이 비어 있습니다.',
      502,
      'OLLI_AGENT_EMPTY_PROBE'
    );
  }

  return {
    ready: true,
    model,
    output: finalOutput,
    nodeVersion: process.versions.node,
  };
}

async function runStudentScheduleProbe({
  agentContext,
  requestContext,
  preparedPrivacy,
}) {
  assertOpenAiKey();

  const subjectRefs = Array.isArray(preparedPrivacy?.subjectRefs)
    ? preparedPrivacy.subjectRefs
    : [];

  if (preparedPrivacy?.needsDisambiguation) {
    throw runtimeError(
      '학생 이름을 한 명으로 구분할 수 없습니다. 전체 이름으로 다시 알려 주세요.',
      409,
      'OLLI_AGENT_STUDENT_AMBIGUOUS'
    );
  }

  if (subjectRefs.length !== 1) {
    throw runtimeError(
      '시간표 조회 probe에서는 학생 한 명을 정확히 지정해 주세요.',
      400,
      'OLLI_AGENT_SINGLE_STUDENT_REQUIRED'
    );
  }

  const { Agent, run, tool, z } = await loadAgentsSdk();
  const { createGetStudentScheduleTool } = require('./tools/schedule-tools.cjs');
  const model = agentModel();
  const today = todayInSeoul();
  const onlyLabel = subjectRefs[0].label;

  const getStudentSchedule = createGetStudentScheduleTool({
    tool,
    z,
    requestContext,
    subjectAccess: preparedPrivacy.subjectAccess,
  });

  const agent = new Agent({
    name: 'Olli Student Schedule Probe',
    model,
    instructions: [
      'You are the Olli academy schedule assistant.',
      'The user message has already been privacy-sanitized.',
      `The only available anonymous student label for this run is ${onlyLabel}.`,
      `Today in Korea is ${today}.`,
      'Always use get_student_schedule before answering a student schedule question.',
      'Never ask for, infer, or reveal a real student name, UUID, member ID, session token, or academy ID.',
      'Use the tool result only. If no regular enrollment exists, say that no regular class was found for that reference date.',
      'Answer briefly in Korean.',
    ].join(' '),
    tools: [getStudentSchedule],
    modelSettings: {
      toolChoice: 'get_student_schedule',
    },
  });

  const result = await run(agent, preparedPrivacy.safeText, {
    context: agentContext,
  });

  const finalOutput = String(result?.finalOutput || '').trim();
  if (!finalOutput) {
    throw runtimeError(
      '학생 시간표 Agent 응답이 비어 있습니다.',
      502,
      'OLLI_AGENT_EMPTY_SCHEDULE_RESPONSE'
    );
  }

  return {
    ready: true,
    model,
    output: finalOutput,
    nodeVersion: process.versions.node,
  };
}

module.exports = {
  MIN_NODE_MAJOR,
  assertSupportedNodeRuntime,
  todayInSeoul,
  loadAgentsSdk,
  runFoundationProbe,
  runStudentScheduleProbe,
};
