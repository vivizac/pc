const { createService, cronAuthorized, centralCredentials } = require('./consultation-messages.cjs');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  if (process.env.VERCEL_ENV !== 'production') return res.status(503).json({ error: 'PRODUCTION_ONLY' });
  try {
    const service = createService();
    if (req.method === 'GET') {
      if (!cronAuthorized(req.headers.authorization)) return res.status(401).json({ error: 'UNAUTHORIZED' });
      const counts = await service.run();
      return res.status(counts.errors || counts.configurationMissing ? 503 : 200).json({ ok: !counts.errors && !counts.configurationMissing, counts });
    }
    const { academyId, sessionToken, action, studentId } = req.body || {};
    if (!academyId || !sessionToken) return res.status(401).json({ error: 'SESSION_REQUIRED' });
    if (!['status', 'send', 'refresh', 'test-send'].includes(action)) return res.status(400).json({ error: 'INVALID_ACTION' });
    // The DB authenticates the session AND owner membership before any provider operation.
    const access = await service.rpc('olli_consultation_messages_manage', { p_session_token: sessionToken, p_academy_id: academyId, p_action: 'load', p_data: {} });
    if (access?.ok !== true) return res.status(403).json({ error: 'PERMISSION_DENIED' });
    const configured = !!centralCredentials();
    if (action === 'status') return res.status(200).json({ ok: true, configured });
    if (action === 'test-send') {
      if (access.settings?.enabled === true) return res.status(409).json({error:'시험 발송 전에 자동 발송을 꺼 주세요.'});
      if (!studentId || typeof studentId !== 'string') return res.status(400).json({error:'STUDENT_REQUIRED'});
      if (!configured) return res.status(503).json({error:'PROVIDER_NOT_CONFIGURED'});
      const result = await service.testSend(academyId, studentId);
      return res.status(200).json({ok:true,result});
    }
    if (action === 'send' && access.settings?.enabled !== true) return res.status(409).json({ error: '상담 안내 문자 사용이 꺼져 있습니다.' });
    if (!configured) return res.status(503).json({ error: '발송업체 서버 연결 설정이 필요합니다.' });
    if (action === 'send' && !studentId) return res.status(400).json({ error: 'STUDENT_REQUIRED' });
    const counts = await service.run({ academyId, studentId: action === 'send' ? studentId : null, dispatch: action === 'send' });
    return res.status(counts.errors ? 503 : 200).json({ ok: !counts.errors, counts });
  } catch (error) {
    // Never emit phone numbers, message content, session tokens or provider response bodies.
    console.error('[consultation-messages]', error.code || 'REQUEST_FAILED');
    return res.status(error.status || 503).json({ error: error.code || 'REQUEST_FAILED' });
  }
};
