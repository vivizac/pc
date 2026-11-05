'use strict';
// Read-only iOS Shortcuts bridge; never send staff session credentials to Shortcuts.
const crypto = require('node:crypto');
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const API_URL = 'https://fvkxipjwgeyosgnfhdnx.supabase.co';
function response(res, status, body) {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  return res.status(status).json(body);
}
function clock(s) {
  const match = /^(\d\d):(\d\d)$/.exec(String(s || ''));
  if (!match) return '시간 미정';
  const h = Number(match[1]), m = Number(match[2]);
  if (h > 23 || m > 59) return '시간 미정';
  const period = h < 12 ? '오전' : '오후';
  const hour = h % 12 || 12;
  return period + ' ' + hour + '시' + (m ? ' ' + m + '분' : '');
}
function speak(data) {
  const consultations = Array.isArray(data.consultations) ? data.consultations.slice(0, 30) : [];
  const tasks = Array.isArray(data.tasks) ? data.tasks.slice(0, 5) : [];
  const lines = ['좋은 아침입니다. 올리입니다.'];
  if (consultations.length) {
    lines.push('오늘 예정된 학부모 상담은 ' + consultations.length + '건입니다.');
    consultations.forEach((row, i) => {
      const kind = row?.kind === '신규 상담' ? '신규 상담' : '재원생 상담';
      lines.push((i + 1) + '번째, ' + clock(row?.time) + ', ' + kind + '입니다.');
    });
  } else {
    lines.push('오늘 예정된 학부모 상담은 없습니다.');
  }
  if (tasks.length) {
    lines.push('현재 미완료 업무가 ' + tasks.length + '건 있습니다.');
    tasks.forEach((task, i) => {
      const clean = String(task || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80);
      if (clean) lines.push((i + 1) + '번째 업무, ' + clean + '.');
    });
  } else {
    lines.push('현재 등록된 미완료 업무는 없습니다.');
  }
  return lines.join(' ').slice(0, 1200);
}
function createHandler({fetchFn = fetch, env = process.env} = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return response(res, 405, {ok:false,code:'METHOD_NOT_ALLOWED'});
    let body = req.body;
    try {
      if (typeof body === 'string') {
        if (Buffer.byteLength(body) > 1024) return response(res, 413, {ok:false,code:'REQUEST_TOO_LARGE'});
        body = JSON.parse(body);
      }
      if (!body || Array.isArray(body) || typeof body !== 'object')
        return response(res, 400, {ok:false,code:'INVALID_BODY'});
      const token = body.token;
      if (typeof token !== 'string' || !TOKEN.test(token))
        return response(res, 401, {ok:false,code:'INVALID_TOKEN'});
      const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
      if (!secret) return response(res, 503, {ok:false,code:'NOT_CONFIGURED'});
      const hash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
      const result = await fetchFn((env.SUPABASE_URL || API_URL) + '/rest/v1/rpc/olli_shortcut_briefing_read', {
        method:'POST',
        redirect:'error',
        headers:{apikey:secret,Authorization:'Bearer ' + secret,'Content-Type':'application/json'},
        body:JSON.stringify({p_token_hash:hash})
      });
      const data = await result.json().catch(() => null);
      if (!result.ok) return response(res, 502, {ok:false,code:'STORAGE_UNAVAILABLE'});
      if (data?.ok !== true) return response(res, 401, {ok:false,code:'TOKEN_EXPIRED_OR_REVOKED'});
      return response(res, 200, {ok:true,date:data.date,consultation_count:Array.isArray(data.consultations)?data.consultations.length:0,text:speak(data)});
    } catch (_) {
      return response(res, 502, {ok:false,code:'BRIEFING_UNAVAILABLE'});
    }
  };
}
module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.speak = speak;
