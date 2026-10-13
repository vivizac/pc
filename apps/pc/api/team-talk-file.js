const SHARED_FILE_SERVER_URL = 'https://vivizac-feedback.vercel.app/api/team-talk-file';

function headerValue(value) {
  return Array.isArray(value) ? String(value[0] || '').trim() : String(value || '').trim();
}

async function forwardResponse(upstream, res) {
  res.statusCode = upstream.status;
  for (const header of ['content-type', 'content-length', 'content-disposition', 'cache-control', 'x-olli-asset-variant']) {
    const value = upstream.headers.get(header);
    if (value) res.setHeader(header, value);
  }
  if (!upstream.body || typeof upstream.body.getReader !== 'function') {
    return res.end(Buffer.from(await upstream.arrayBuffer()));
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
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const upstreamUrl = new URL(SHARED_FILE_SERVER_URL);
  if (req.method === 'GET') {
    if (req.query?.attachmentId != null) upstreamUrl.searchParams.set('attachmentId', String(req.query.attachmentId));
    if (req.query?.variant != null) upstreamUrl.searchParams.set('variant', String(req.query.variant));
  }
  try {
    const upstream = await fetch(upstreamUrl.toString(), {
      method: req.method,
      headers: {
        'X-Olli-Session-Token': headerValue(req.headers['x-olli-session-token']),
        'X-Olli-Academy-Id': headerValue(req.headers['x-olli-academy-id']),
        ...(req.method === 'POST' ? { 'Content-Type': 'application/json' } : {})
      },
      ...(req.method === 'POST' ? { body: JSON.stringify(req.body || {}) } : {}),
      redirect: 'error'
    });
    return forwardResponse(upstream, res);
  } catch (error) {
    if (res.writableEnded) return;
    return res.status(502).json({ error: error?.message || '파일 서버 연결에 실패했습니다.' });
  }
}
