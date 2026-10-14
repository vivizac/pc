const SUPABASE_URL = 'https://fvkxipjwgeyosgnfhdnx.supabase.co';
const ACCESS_RPC = SUPABASE_URL + '/rest/v1/rpc/olli_team_talk_settings_get';
const ERROR_LOG = SUPABASE_URL + '/rest/v1/olli_app_error_logs';
const STAGES = new Set(['NETWORK_REQUEST', 'HTTP_RESPONSE', 'STREAM_RECEIVE', 'EMPTY_RESPONSE', 'CLIENT_EXCEPTION', 'SAVE_FAILED']);

function validUuid(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}
function serverKey() {
  return String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
}
export default async function handler(req, res) {
  res.setHeader('Allow', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error:'Method not allowed' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const academyId = String(body.academyId || '').trim();
  const sessionToken = String(body.sessionToken || '').trim();
  const stage = String(body.stage || '').trim();
  const promptType = String(body.promptType || '').trim();
  const requestId = String(body.requestId || '').trim().slice(0, 100);
  const status = Number(body.httpStatus || 0);
  if (!validUuid(academyId) || !sessionToken || sessionToken.length > 512 || !STAGES.has(stage)
    || !['class','elementary','fail','summary','kinder_one_month'].includes(promptType)
    || !Number.isInteger(status) || status < 0 || status > 599) {
    return res.status(400).json({error:'Diagnostic payload invalid'});
  }
  const key = serverKey();
  if (!key) return res.status(503).json({error:'Diagnostic service unavailable'});
  try {
    const access = await fetch(ACCESS_RPC, {
      method:'POST',
      headers:{'Content-Type':'application/json',apikey:key,Authorization:'Bearer ' + key},
      body:JSON.stringify({p_session_token:sessionToken,p_academy_id:academyId})
    });
    const text = await access.text();
    let verified = null;
    try { verified = JSON.parse(text); } catch (_) {}
    if (!access.ok || verified?.ok !== true) return res.status(403).json({error:'Access denied'});

    // The device submits only fixed error categories and technical metadata: no raw student input.
    const record = {
      academy_id:academyId, app_type:'mobile', feature:'quicknote_feedback',
      severity:'error', message:stage,
      request_id:requestId || null,
      detail:{stage,feature:promptType,http_status:status,
        model:String(body.model || '').replace(/[^a-zA-Z0-9._-]/g,'').slice(0,60),
        effort:['none','minimal','low','medium','high','xhigh'].includes(body.effort)?body.effort:null}
    };
    const logged = await fetch(ERROR_LOG, {
      method:'POST',
      headers:{'Content-Type':'application/json',apikey:key,Authorization:'Bearer ' + key,Prefer:'return=minimal'},
      body:JSON.stringify(record)
    });
    if (!logged.ok) {
      console.warn('[OLLI AI] client error persistence failed',logged.status);
      return res.status(502).json({error:'Log persistence failed'});
    }
    return res.status(200).json({ok:true});
  } catch (error) {
    console.warn('[OLLI AI] client error telemetry unavailable',error?.name || 'Error');
    return res.status(503).json({error:'Diagnostic service unavailable'});
  }
}
