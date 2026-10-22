'use strict';
const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const { calculateOlliConsultationTasks, normalizeOlliConsultationRulesByType } = require('../../olli-consultation-task-core.js');

const { select: selectTemplate } = require('../../olli-consultation-message-templates.js');

const SUPABASE_URL = 'https://fvkxipjwgeyosgnfhdnx.supabase.co';

const SOLAPI_AUTH_CODES = ['InvalidAPIKey','SignatureDoesNotMatch','RequestTimeTooSkewed','DuplicatedSignature'];
function safeSolapiAuthCategory(value) {
  // Search only a bounded provider error structure for documented enum names.
  // Do not return untrusted provider text: it might echo authorization secrets.
  const fields = [];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    fields.push(value.errorCode,value.error_code,value.code,value.statusCode,value.message);
    if(value.error && typeof value.error==='object')fields.push(value.error.code,value.error.errorCode,value.error.message);
    else fields.push(value.error);
  } else if (typeof value==='string') fields.push(value);
  for(const field of fields){
    if(typeof field!=='string')continue;
    for(const code of SOLAPI_AUTH_CODES){
      if(new RegExp('(^|[^A-Za-z])'+code+'([^A-Za-z]|$)','i').test(field.slice(0,1024)))return code;
    }
  }
  return null;
}
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
function nameWithParticle(name, pair) {
  const value = String(name || '').trim();
  if (!value) throw problem('STUDENT_NAME_MISSING', 400);
  const last = value.codePointAt(value.length - 1);
  const hangul = last >= 0xAC00 && last <= 0xD7A3;
  // On non-Hangul endings do not guess particles for foreign names.
  if (!hangul) throw problem('STUDENT_NAME_PARTICLE_UNSUPPORTED', 400);
  const jong = (last - 0xAC00) % 28;
  const suffixes = {
    subject: jong ? '은' : '는',
    nominative: jong ? '이' : '가',
    object: jong ? '을' : '를',
    with: jong ? '과' : '와',
    direction: !jong || jong === 8 ? '로' : '으로'
  };
  return value + suffixes[pair];
}
function messageFor(snapshot, student, tasks) {
  const config = snapshot.settings;
  const template = selectTemplate(config, student, tasks);
  let url;
  try { url = new URL(config.booking_url); } catch { throw problem('BOOKING_URL_INVALID', 400); }
  if (url.protocol !== 'https:' || !(url.hostname === 'naver.com' || url.hostname.endsWith('.naver.com') || url.hostname === 'naver.me') || url.username || url.password || (url.port && url.port !== '443')) throw problem('BOOKING_URL_INVALID', 400);
  if (!/^01[016789]\d{7,8}$/.test(student.phone || '')) throw problem('CONTACT_INVALID', 400);
  if (!template.template_confirmed || !config.channel_id || !template.template_id) throw problem('TEMPLATE_NOT_READY', 400);
  const variables = {
    '#{학원명}': snapshot.academy_name,
    '#{학생명}': student.name,
    '#{상담구분}': String(template.task.label || '').replace(/(후|마다)$/, ''),
    '#{예약링크}': config.booking_url
  };
  // A complete value occupies each approved Solapi placeholder, e.g.
  // '#{학생이름_주제}' becomes '민서는', never '민서' plus a hardcoded suffix.
  const nameTokens = {
    '#{학생이름_주제}':'subject', '#{학생이름_주격}':'nominative',
    '#{학생이름_목적격}':'object', '#{학생이름_함께}':'with',
    '#{학생이름_방향}':'direction'
  };
  const body = String(template.template_body || '');
  for (const [token, kind] of Object.entries(nameTokens)) {
    if (body.includes(token)) variables[token] = nameWithParticle(student.name, kind);
  }
  const allowed = new Set(Object.keys(variables));
  if (!body || [...body.matchAll(/#\{[^}]+\}/g)].some(([token]) => !allowed.has(token))) throw problem('TEMPLATE_BODY_INVALID', 400);
  const text = body.replace(/#\{[^}]+\}/g, (key) => String(variables[key] || ''));
  if (text.length > 1000) throw problem('TEMPLATE_TOO_LONG', 400);
  return { to: student.phone, type: 'ATA', text, kakaoOptions: {
    pfId: config.channel_id, templateId: template.template_id,
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
    // Read the response once. Non-JSON denial pages can originate upstream of the API.
    const contentType=String(response.headers?.get?.('content-type')||'').toLowerCase();
    let data;
    try { data = await response.json(); }
    catch {
      if (!response.ok) {
        const err=problem('PROVIDER_REJECTED',502);
        err.providerCode='HTTP_'+response.status+'_NON_JSON';
        err.responseKind=contentType.includes('text/html')?'HTML':contentType.includes('text/plain')?'TEXT':'OTHER';
        err.authCategory='Unclassified403';
        err.knownFailure=response.status>=400&&response.status<500&&response.status!==408;
        throw err;
      }
      throw problem('PROVIDER_RESPONSE_UNKNOWN',502);
    }
    if (!response.ok) {
      // Only an explicit API rejection is a known failure; gateway/5xx/timeouts are ambiguous.
      const err = problem(response.status >= 500 || response.status === 408 ? 'PROVIDER_RESULT_UNKNOWN' : 'PROVIDER_REJECTED', 502);
      // Store only HTTP status and provider's short machine error code; never log response text, phone or credentials.
      const rawCode = data && typeof data === 'object'
        ? (data.errorCode ?? data.error_code ?? data.code ?? data.statusCode ?? data.error?.code ?? data.error?.errorCode)
        : null;
      const safeCode = typeof rawCode === 'number' || typeof rawCode === 'string' ? String(rawCode) : '';
      err.providerCode = 'HTTP_' + response.status + (safeCode && /^[A-Za-z0-9_-]{1,30}$/.test(safeCode) ? '_' + safeCode : '');
      err.authCategory = response.status === 403 ? (safeSolapiAuthCategory(data) || 'Unclassified403') : null;
      err.responseKind=contentType.includes('application/json')||contentType.includes('+json')?'JSON':contentType.includes('text/html')?'HTML':contentType.includes('text/plain')?'TEXT':'OTHER';
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
    const selected = selectTemplate(snapshot.settings, student, tasks);
    const matches = await rpc('olli_consultation_channel_resolve', {
      p_academy_id: snapshot.settings.academy_id,
      p_template_id: selected.template_id,
      p_template_body: selected.template_body
    });
    if (!Array.isArray(matches) || matches.length !== 1 || !matches[0].pf_id) return 'skipped';
    const message = messageFor({
      ...snapshot,
      settings: { ...snapshot.settings, channel_id: matches[0].pf_id }
    }, student, tasks);
    // Month grouping: one notice per student per consultation due month even when rules overlap.
    const dueMonth = tasks[tasks.length - 1].dueMonth;
    const id = await rpc('olli_consultation_messages_reserve', {
      p_academy_id: snapshot.settings.academy_id, p_student_id: student.id, p_due_month: dueMonth,
      p_task_keys: tasks.map((t) => t.key), p_config_revision: snapshot.settings.revision,
      p_contact_revision: student.contact_revision, p_student_updated_at: student.updated_at,
      p_rules: snapshot.rules ?? null, p_progress: snapshot.progress ?? null
    });
    if (!id) return 'skipped';
    // Check again after obtaining the deduplicated reservation. Never send if
    // headquarters revoked this academy's channel or template meanwhile.
    // An interrupted reservation remains reserved for manual reconciliation,
    // deliberately never retried automatically.
    const latest = await rpc('olli_consultation_channel_resolve', {
      p_academy_id: snapshot.settings.academy_id,
      p_template_id: selected.template_id,
      p_template_body: selected.template_body
    });
    if (!Array.isArray(latest) || latest.length !== 1 ||
        latest[0].pf_id !== message.kakaoOptions.pfId ||
        latest[0].channel_revision !== matches[0].channel_revision) return 'skipped';
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
  async function testSend(academyId, studentId) {
    if (!/^[0-9a-f-]{36}$/i.test(String(studentId||''))) throw problem('STUDENT_REQUIRED',400);
    const snapshots = await rpc('olli_consultation_messages_snapshot', { p_academy_id: academyId });
    const snapshot = snapshots.find(x=>x.settings?.academy_id===academyId);
    if (!snapshot) throw problem('ACADEMY_NOT_CONFIGURED',409);
    if (snapshot.settings.enabled) throw problem('TURN_OFF_AUTOMATIC_SENDING_FIRST',409);
    const student=(snapshot.students||[]).find(x=>x.id===studentId);
    // Snapshot students are already inner-joined to enabled, confirmed contacts.
    if (!student || !student.phone) throw problem('TEST_CONTACT_NOT_READY',409);
    const credential=centralCredentials(env);
    if (!credential) throw problem('PROVIDER_NOT_CONFIGURED',503);
    const task={ruleKey:'after_1',label:'1개월',dueMonth:'2099-01',occurrenceMonths:1};
    const template=selectTemplate(snapshot.settings,student,[task]);
    const matches=await rpc('olli_consultation_channel_resolve_test',{
      p_academy_id:academyId,p_template_id:template.template_id,p_template_body:template.template_body
    });
    if(!Array.isArray(matches)||matches.length!==1||!matches[0].pf_id)throw problem('CHANNEL_TEMPLATE_NOT_APPROVED',409);
    const message=messageFor({...snapshot,settings:{...snapshot.settings,channel_id:matches[0].pf_id}},student,[task]);
    // A unique reservation is inserted BEFORE the provider request, so retries
    // and double clicks cannot submit a second Kakao message.
    const key=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
    if(!key)throw problem('SUPABASE_SERVER_KEY_MISSING',503);
    const url=SUPABASE_URL+'/rest/v1/olli_consultation_test_sends';
    const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'};
    const reservationId=await rpc('olli_consultation_test_reserve',{p_academy_id:academyId,p_student_id:studentId,p_template_id:template.template_id});
    if(!reservationId)return {status:'duplicate'};
    const entry={id:reservationId};
    const latest=await rpc('olli_consultation_channel_resolve_test',{p_academy_id:academyId,p_template_id:template.template_id,p_template_body:template.template_body});
    if(!Array.isArray(latest)||latest.length!==1||latest[0].pf_id!==matches[0].pf_id||latest[0].channel_revision!==matches[0].channel_revision)
      throw problem('CHANNEL_CHANGED_AFTER_RESERVATION',409);
    let status='unknown',messageId=null,code='CHECK_PROVIDER_CONSOLE';
    try{
      const result=await provider(credential,'/messages/v4/send-many/detail',{messages:[message],showMessageList:true,allowDuplicates:false,strict:true});
      const failure=result.failedMessageList?.[0];
      if(failure){status='failed';messageId=failure.messageId||null;code=String(failure.statusCode||'REGISTRATION_FAILED');}
      else{
        const accepted=Array.isArray(result.messageList)?result.messageList[0]:Object.values(result.messageList||{})[0];
        if(accepted?.messageId){
          messageId=accepted.messageId;code=String(accepted.statusCode||'');
          status=code==='4000'?'delivered':/^[345]\\d{3}$/.test(code)?'failed':'submitted';
        }
      }
    }catch(error){status=error.knownFailure?'failed':'unknown';code=error.knownFailure?(error.providerCode||'PROVIDER_REJECTED'):'CHECK_PROVIDER_CONSOLE';}
    await fetchImpl(url+'?id=eq.'+encodeURIComponent(entry.id),{
      method:'PATCH',headers:{...headers,Prefer:'return=minimal'},
      body:JSON.stringify({status,provider_message_id:messageId,provider_code:code}),
      signal:AbortSignal.timeout(12000)
    }).then(response=>{if(!response.ok)throw problem('TEST_LOG_UPDATE_FAILED',503);});
    return {status};
  }
  async function checkProviderAuth() {
    const credential=centralCredentials(env);
    if(!credential)throw problem('PROVIDER_NOT_CONFIGURED',503);
    const diagnostics={
      apiKeySurroundingWhitespace: credential.apiKey !== credential.apiKey.trim(),
      apiSecretSurroundingWhitespace: credential.apiSecret !== credential.apiSecret.trim(),
      apiKeyContainsQuotationMarks: credential.apiKey.includes('"') || credential.apiKey.includes("'"),
      apiSecretContainsQuotationMarks: credential.apiSecret.includes('"') || credential.apiSecret.includes("'")
    };
    try{
      // Read-only authenticated request: never submits any message.
      await provider(credential,'/messages/v4/list?limit=1');
      return {authenticated:true,diagnostics};
    }catch(error){
      return {authenticated:false,code:error.providerCode||error.code||'PROVIDER_CHECK_FAILED',authCategory:error.authCategory||null,responseKind:error.responseKind||'UNKNOWN',diagnostics};
    }
  }
  async function run({ academyId = null, studentId = null, dispatch = true } = {}) {
    const snapshots = await rpc('olli_consultation_messages_snapshot', { p_academy_id: academyId });
    const counts = { submitted: 0, delivered: 0, failed: 0, unknown: 0, skipped: 0, configurationMissing: 0, deferred: 0, errors: 0 };
    const calendarNow = koreaDate(now());
    const started = Date.now();
    for (const snapshot of snapshots) {
      // A shared Solapi account serves every academy, but only DB-approved
      // channel assignments can produce new outgoing messages.
      const credential = centralCredentials(env);
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
  return { rpc, run, testSend, checkProviderAuth };
}

/**
 * Future headquarters-account integration gate. This is intentionally NOT wired
 * into the live dispatch loop until the authoritative channel registry and
 * academy-scoped database authorization are deployed together.
 *
 * Never trust a channel ID supplied by a client. A channel binding must come
 * from the server registry and have an explicit academy authorization.
 */
function centralCredentials(env = process.env) {
  let value;
  try { value = JSON.parse(env.OLLI_CONSULTATION_SOLAPI_CREDENTIALS || '{}'); }
  catch { return null; }
  if (!value || Array.isArray(value) ||
      typeof value.apiKey !== 'string' || !value.apiKey.trim() ||
      typeof value.apiSecret !== 'string' || !value.apiSecret.trim()) return null;
  return { apiKey:value.apiKey, apiSecret:value.apiSecret };
}
function verifiedChannel(snapshot, binding, env = process.env) {
  const settings = snapshot?.settings;
  if (!settings?.academy_id || !binding || !centralCredentials(env)) return null;
  const mode = settings.channel_mode || 'headquarters';
  if (!['headquarters','academy'].includes(mode)) return null;
  if (binding.academy_id !== settings.academy_id ||
      binding.mode !== mode || binding.enabled !== true ||
      binding.approved !== true || binding.revision !== settings.channel_revision ||
      typeof binding.pf_id !== 'string' || !binding.pf_id.trim()) return null;
  if (mode === 'headquarters' && binding.allowed_academy_id !== settings.academy_id) return null;
  if (mode === 'academy' && binding.owner_academy_id !== settings.academy_id) return null;
  return { pfId:binding.pf_id, credential:centralCredentials(env) };
}
function verifiedTemplate(template, binding) {
  if (!template || !binding?.approved || !Array.isArray(binding.approved_templates)) return false;
  return binding.approved_templates.some(row => row.approved === true &&
    row.channel_id === binding.pf_id &&
    row.template_id === template.template_id &&
    row.body === template.template_body);
}

module.exports = { createService, cronAuthorized, credentials, koreaDate, pendingTasks, messageFor, centralCredentials, verifiedChannel, verifiedTemplate, nameWithParticle };
