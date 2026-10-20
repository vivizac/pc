'use strict';
const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const { calculateOlliConsultationTasks, normalizeOlliConsultationRulesByType } = require('../../olli-consultation-task-core.js');

const SUPABASE_URL = 'https://fvkxipjwgeyosgnfhdnx.supabase.co';

function problem(code, status = 500) { const error = new Error(code); error.code = code; error.status = status; return error; }
function credentials(academyId, env = process.env) {
  let map;
  try { map = JSON.parse(env.OLLI_CONSULTATION_SOLAPI_CREDENTIALS || '{}'); } catch { return null; }
  const entry = map[academyId];
  return entry && typeof entry.apiKey === 'string' && entry.apiKey && typeof entry.apiSecret === 'string' && entry.apiSecret ? entry : null;
}
function cronAuthorized(header, env = process.env) {
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 16) return false;
  const expected = Buffer.from('Bearer ' + env.CRON_SECRET);
  const supplied = Buffer.from(String(header || ''));
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
function koreaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (key) => Number(parts.find((p) => p.type === key).value);
  // Core deliberately uses local calendar dates, just as the existing PC/mobile policy does.
  return new Date(get('year'), get('month') - 1, get('day'), 12);
}
function enrollmentDate(raw) {
  const m = String(raw || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : null;
}
function pendingTasks(snapshot, student, now) {
  const config = snapshot.settings;
  const rules = normalizeOlliConsultationRulesByType(snapshot.rules);
  return calculateOlliConsultationTasks(student, {
    enrolled: enrollmentDate(student.enrolled_at), now,
    rules: rules[student.division === 'kinder' ? 'kinder' : 'elementary'],
    progress: snapshot.progress || {}
  }).filter((task) => !task.completed && task.dueMonth >= config.start_month);
}
function messageFor(snapshot, student, tasks) {
  const config = snapshot.settings;
  let url;
  try { url = new URL(config.booking_url); } catch { throw problem('BOOKING_URL_INVALID', 400); }
  if (url.protocol !== 'https:' || !(url.hostname === 'naver.com' || url.hostname.endsWith('.naver.com') || url.hostname === 'naver.me') || url.username || url.password || (url.port && url.port !== '443')) throw problem('BOOKING_URL_INVALID', 400);
  if (!/^01[016789]\d{7,8}$/.test(student.phone || '')) throw problem('CONTACT_INVALID', 400);
  if (!config.template_confirmed || !config.channel_id || !config.template_id) throw problem('TEMPLATE_NOT_READY', 400);
  const variables = {
    '#{학원명}': snapshot.academy_name,
    '#{학생명}': student.name,
    '#{상담구분}': Array.from(new Set(tasks.map((t) => t.label.replace(/(후|마다)$/, '')))).join(' · '),
    '#{예약링크}': config.booking_url
  };
  const body = String(config.template_body || '');
  if (!body || /#\{[^}]+\}/g.test(body.replace(/#\{(?:학원명|학생명|상담구분|예약링크)\}/g, ''))) throw problem('TEMPLATE_BODY_INVALID', 400);
  const text = body.replace(/#\{[^}]+\}/g, (key) => String(variables[key] || ''));
  if (text.length > 1000) throw problem('TEMPLATE_TOO_LONG', 400);
  return { to: student.phone, type: 'ATA', text, kakaoOptions: {
    pfId: config.channel_id, templateId: config.template_id,
    disableSms: true, variables
    // The approved template defines the '상담 예약하기' button and its #{예약링크} URL.
  } };
}
function createService({ fetchImpl = fetch, env = process.env, now = () => new Date() } = {}) {
  async function rpc(name, params) {
    const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw problem('SUPABASE_SERVER_KEY_MISSING', 503);
    const response = await fetchImpl(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(params), signal: AbortSignal.timeout(12000), redirect: 'error'
    });
    if (!response.ok) throw problem('DATABASE_REQUEST_FAILED', response.status === 403 ? 403 : 503);
    return response.json();
  }
  async function provider(credential, path, body) {
    const date = now().toISOString();
    const salt = randomBytes(24).toString('hex');
    const signature = createHmac('sha256', credential.apiSecret).update(date + salt).digest('hex');
    const response = await fetchImpl('https://api.solapi.com' + path, {
      method: body ? 'POST' : 'GET', headers: {
        Authorization: `HMAC-SHA256 apiKey=${credential.apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
        'Content-Type': 'application/json'
      }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(12000), redirect: 'error'
    });
    let data;
    try { data = await response.json(); } catch { throw problem('PROVIDER_RESPONSE_UNKNOWN', 502); }
    if (!response.ok) {
      // Only an explicit API rejection is a known failure; gateway/5xx/timeouts are ambiguous.
      const err = problem(response.status >= 500 || response.status === 408 ? 'PROVIDER_RESULT_UNKNOWN' : 'PROVIDER_REJECTED', 502);
      err.knownFailure = response.status >= 400 && response.status < 500 && response.status !== 408;
      throw err;
    }
    return data;
  }
  async function finish(id, status, messageId = null, code = null) {
    const saved = await rpc('olli_consultation_messages_finish', { p_id: id, p_status: status, p_message_id: messageId, p_code: code });
    if (saved !== true) throw problem('DELIVERY_LOG_NOT_SAVED', 503);
  }
  async function reconcile(snapshot, credential) {
    const pending = snapshot.pending || [];
    for (let i = 0; i < pending.length; i += 100) {
      const chunk = pending.slice(i, i + 100).filter((d) => d.provider_message_id);
      if (!chunk.length) continue;
      const params = new URLSearchParams({ messageIds: JSON.stringify(chunk.map((d) => d.provider_message_id)), limit: '100' });
      const data = await provider(credential, '/messages/v4/list?' + params);
      for (const delivery of chunk) {
        const result = data.messageList?.[delivery.provider_message_id];
        const code = String(result?.statusCode || '');
        if (code === '4000') await finish(delivery.id, 'delivered', null, code);
        else if (/^[345]\d{3}$/.test(code)) await finish(delivery.id, 'failed', null, code);
      }
    }
  }
  async function send(snapshot, student, tasks, credential) {
    const message = messageFor(snapshot, student, tasks);
    // Month grouping: one notice per student per consultation due month even when rules overlap.
    const dueMonth = tasks[tasks.length - 1].dueMonth;
    const id = await rpc('olli_consultation_messages_reserve', {
      p_academy_id: snapshot.settings.academy_id, p_student_id: student.id, p_due_month: dueMonth,
      p_task_keys: tasks.map((t) => t.key), p_config_revision: snapshot.settings.revision,
      p_contact_revision: student.contact_revision, p_student_updated_at: student.updated_at,
      p_rules: snapshot.rules ?? null, p_progress: snapshot.progress ?? null
    });
    if (!id) return 'skipped';
    let result;
    try {
      result = await provider(credential, '/messages/v4/send-many/detail', { messages: [message], showMessageList: true, allowDuplicates: false, strict: true });
    } catch (error) {
      await finish(id, error.knownFailure ? 'failed' : 'unknown', null, error.knownFailure ? 'PROVIDER_REJECTED' : 'CHECK_PROVIDER_CONSOLE');
      return error.knownFailure ? 'failed' : 'unknown';
    }
    // A 2xx means neither delivery nor read confirmation. Parse the per-message result.
    const failed = result.failedMessageList?.[0];
    if (failed) { await finish(id, 'failed', failed.messageId || null, String(failed.statusCode || 'REGISTRATION_FAILED')); return 'failed'; }
    const accepted = Array.isArray(result.messageList) ? result.messageList[0] : Object.values(result.messageList || {})[0];
    if (!accepted?.messageId) { await finish(id, 'unknown', null, 'CHECK_PROVIDER_CONSOLE'); return 'unknown'; }
    const code = String(accepted.statusCode || '');
    const state = code === '4000' ? 'delivered' : /^[345]\d{3}$/.test(code) ? 'failed' : 'submitted';
    await finish(id, state, accepted.messageId, code);
    return state;
  }
  async function run({ academyId = null, studentId = null, dispatch = true } = {}) {
    const snapshots = await rpc('olli_consultation_messages_snapshot', { p_academy_id: academyId });
    const counts = { submitted: 0, delivered: 0, failed: 0, unknown: 0, skipped: 0, configurationMissing: 0, deferred: 0, errors: 0 };
    const calendarNow = koreaDate(now());
    const started = Date.now();
    for (const snapshot of snapshots) {
      const credential = credentials(snapshot.settings.academy_id, env);
      if (!credential) { counts.configurationMissing++; continue; }
      try { await reconcile(snapshot, credential); } catch { counts.errors++; }
      if (!dispatch || !snapshot.settings.enabled) continue;
      const candidates = (snapshot.students || []).filter((s) => !studentId || s.id === studentId);
      let cursor = 0;
      async function worker() {
        while (cursor < candidates.length) {
          const student = candidates[cursor++];
          if (Date.now() - started > 220000) { counts.deferred++; continue; }
          const tasks = pendingTasks(snapshot, student, calendarNow);
          if (!tasks.length) continue;
          try { counts[await send(snapshot, student, tasks, credential)]++; }
          catch { counts.errors++; }
        }
      }
      await Promise.all([worker(), worker(), worker(), worker()]);
    }
    return counts;
  }
  return { rpc, run };
}
module.exports = { createService, cronAuthorized, credentials, koreaDate, pendingTasks, messageFor };
