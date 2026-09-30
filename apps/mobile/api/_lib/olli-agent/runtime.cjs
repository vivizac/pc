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

async function loadAgentsSdk() {
  assertSupportedNodeRuntime();

  const [agentsSdk, zodModule] = await Promise.all([
    import('@openai/agents'),
    import('zod'),
  ]);

  if (!agentsSdk?.Agent || typeof agentsSdk?.run !== 'function' || !zodModule?.z) {
    throw runtimeError(
      'OpenAI Agents SDK 의존성을 불러오지 못했습니다.',
      500,
      'OLLI_AGENT_SDK_LOAD_FAILED'
    );
  }

  return {
    Agent: agentsSdk.Agent,
    run: agentsSdk.run,
  };
}

async function runFoundationProbe(agentContext) {
  if (!process.env.OPENAI_API_KEY) {
    throw runtimeError(
      'OPENAI_API_KEY가 서버 환경변수에 설정되지 않았습니다.',
      500,
      'OPENAI_API_KEY_MISSING'
    );
  }

  const { Agent, run } = await loadAgentsSdk();
  const model =
    String(process.env.OPENAI_AGENT_MODEL || process.env.OPENAI_MODEL || '').trim() ||
    'gpt-5-mini';

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

module.exports = {
  MIN_NODE_MAJOR,
  assertSupportedNodeRuntime,
  loadAgentsSdk,
  runFoundationProbe,
};
