const SHARED_AI_SERVER_URL = 'https://vivizac-feedback.vercel.app/api/chat';

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
    const upstream = await fetch(SHARED_AI_SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body || {}),
    });

    return pipeResponse(upstream, res);
  } catch (error) {
    if (res.writableEnded) return;

    return res.status(502).json({
      error: error?.message || '공용 AI 서버 연결에 실패했습니다.',
    });
  }
}
