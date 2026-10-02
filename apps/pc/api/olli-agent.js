const SHARED_AGENT_SERVER_URL = 'https://vivizac-feedback.vercel.app/api/olli-agent';

async function pipeResponse(upstream, res) {
  res.statusCode = upstream.status;

  const contentType = upstream.headers.get('content-type');
  if (contentType) res.setHeader('Content-Type', contentType);

  const cacheControl = upstream.headers.get('cache-control');
  if (cacheControl) res.setHeader('Cache-Control', cacheControl);

  if (!upstream.body || typeof upstream.body.getReader !== 'function') {
    const body = await upstream.text();
    return res.end(body);
  }

  const reader = upstream.body.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) res.write(Buffer.from(value));
  }
  return res.end();
}

export default async function handler(req, res) {
  const requestStartedAt = process.hrtime.bigint();
  let upstreamStartedAt = null;
  let upstreamHeaderDurationMs = null;
  res.once('finish', () => {
    if (process.env.NODE_ENV === 'test' || process.env.OLLI_AGENT_PERF_LOGS === '0') return;
    const durationMs = Math.round((Number(process.hrtime.bigint() - requestStartedAt) / 1e6) * 10) / 10;
    console.info('[OLLI Agent Perf] ' + JSON.stringify({
      version:1,
      phase:'pc_agent_proxy_total',
      status:res.statusCode >= 500 ? 'error' : 'ok',
      durationMs,
      httpStatus:res.statusCode,
      upstreamHeaderDurationMs,
    }));
  });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error:'Method not allowed' });
  }

  try {
    upstreamStartedAt = process.hrtime.bigint();
    const upstream = await fetch(SHARED_AGENT_SERVER_URL, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify(req.body || {}),
    });
    upstreamHeaderDurationMs = Math.round((Number(process.hrtime.bigint() - upstreamStartedAt) / 1e6) * 10) / 10;
    return pipeResponse(upstream, res);
  } catch (error) {
    if (res.writableEnded) return;
    return res.status(502).json({
      error:error?.message || '공용 Agent 서버 연결에 실패했습니다.',
    });
  }
}
