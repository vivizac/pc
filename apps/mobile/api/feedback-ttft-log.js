const SUPABASE_URL = 'https://fvkxipjwgeyosgnfhdnx.supabase.co';
const AI_USAGE_LOG_URL = `${SUPABASE_URL}/rest/v1/olli_ai_usage_logs`;

function getServerKey() {
  return (
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  );
}

function cleanAcademyId(value) {
  const text = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const ttftMs = Math.round(Number(body.ttftMs));
  if (!Number.isFinite(ttftMs) || ttftMs < 0 || ttftMs > 60000) {
    return res.status(400).json({ error: 'ttftMs 형식이 올바르지 않습니다.' });
  }

  const serverKey = getServerKey();
  if (!serverKey) {
    return res.status(500).json({ error: '서버 로그 키가 설정되지 않았습니다.' });
  }

  const promptType = String(body.promptType || 'class').trim() || 'class';
  const requestId = String(req.headers['x-vercel-id'] || req.headers['x-request-id'] || '').trim() || null;

  try {
    const response = await fetch(AI_USAGE_LOG_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serverKey,
        Authorization: `Bearer ${serverKey}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        academy_id: cleanAcademyId(body.academyId),
        feature: `${promptType}_ttft`,
        model: process.env.OPENAI_MODEL || 'gpt-5-mini',
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost_krw: 0,
        success: true,
        latency_ms: null,
        ttft_ms: ttftMs,
        request_id: requestId,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return res.status(502).json({ error: 'TTFT 로그 저장 실패', detail });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'TTFT 로그 저장 실패' });
  }
}
