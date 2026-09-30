function safeText(value, maxLength = 200) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const mode = safeText(body.mode, 40);

    if (mode !== 'probe') {
      return res.status(400).json({
        error: '현재 독립 Agent endpoint는 probe 모드만 지원합니다.',
      });
    }

    const contextModule = await import('./_lib/olli-agent/request-context.cjs');
    const runtimeModule = await import('./_lib/olli-agent/runtime.cjs');

    const requestContext = await contextModule.loadOlliAgentRequestContext(body);
    const agentContext = contextModule.toAgentRunContext(requestContext);
    const probe = await runtimeModule.runFoundationProbe(agentContext);

    return res.status(200).json({
      ok: true,
      mode: 'probe',
      ready: probe.ready === true,
      model: probe.model,
      nodeVersion: probe.nodeVersion,
      output: probe.output,
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode || 500);
    console.error('[OLLI Agent] foundation probe failed:', safeText(error?.code || error?.name || 'ERROR', 80));

    return res.status(statusCode).json({
      error: error?.message || '올리 Agent 서버 오류가 발생했습니다.',
      code: safeText(error?.code || 'OLLI_AGENT_ERROR', 80),
    });
  }
}
