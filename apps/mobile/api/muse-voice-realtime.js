import http from 'node:http';
import { randomUUID } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';

const SUPABASE_URL = 'https://fvkxipjwgeyosgnfhdnx.supabase.co';
const ACCESS_RPC_URL = SUPABASE_URL + '/rest/v1/rpc/olli_get_my_academies';
const META_REALTIME_URL = 'wss://api.meta.ai/v1/asr/realtime';
const META_MODEL = 'muse-voice-transcribe-1.0';
const AUTH_TIMEOUT_MS = 10000;
const META_CONNECT_TIMEOUT_MS = 15000;
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

function serverKey() {
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}
function metaKey() {
  return process.env.META_MODEL_API_KEY || process.env.MODEL_API_KEY || '';
}
function normalizeAcademies(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.academies)) return payload.academies;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
}
function academyIdOf(row) {
  return String(row?.academy_id || row?.academyId || row?.id || '').trim();
}
function activeStatus(value) {
  return !['inactive','deleted','removed','disabled','archived'].includes(String(value || 'active').trim().toLowerCase());
}
async function assertAcademyAccess(sessionToken, academyId) {
  const key = serverKey();
  if (!key) throw Object.assign(new Error('SUPABASE_SECRET_KEY가 설정되지 않았습니다.'), { statusCode:500 });
  if (!sessionToken || !academyId) throw Object.assign(new Error('로그인 세션과 학원 정보가 필요합니다.'), { statusCode:401 });

  const response = await fetch(ACCESS_RPC_URL, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', apikey:key, Authorization:'Bearer ' + key },
    body:JSON.stringify({ p_session_token:sessionToken })
  });
  const raw = await response.text();
  let data={};
  try { data=raw ? JSON.parse(raw) : {}; } catch (_) {}
  if (!response.ok) {
    throw Object.assign(new Error(data?.message || data?.error || '학원 접근 권한을 확인하지 못했습니다.'), { statusCode:response.status });
  }

  const matched = normalizeAcademies(data).find(row => {
    if (academyIdOf(row) !== academyId) return false;
    return activeStatus(row?.membership_status || row?.member_status)
      && activeStatus(row?.access_status || row?.academy_access_status || row?.status);
  });
  if (!matched) throw Object.assign(new Error('이 학원에서 Muse 수업기록을 사용할 권한이 없습니다.'), { statusCode:403 });
}
function sendJson(socket,payload) {
  if (socket?.readyState !== WebSocket.OPEN) return;
  try { socket.send(JSON.stringify(payload)); } catch (_) {}
}
function closeClient(socket,code,message) {
  sendJson(socket,{ type:'muse.error', message:String(message || 'Muse 연결 오류가 발생했습니다.') });
  try { socket.close(code || 1011,String(message || 'Muse relay error').slice(0,120)); } catch (_) {}
}

const server=http.createServer();
const wss=new WebSocketServer({ server,maxPayload:512*1024,perMessageDeflate:false });

wss.on('connection',client => {
  let meta=null;
  let authenticated=false;
  let metaReady=false;
  let authBusy=false;
  let endRequested=false;
  let audioBytes=0;
  let metaTimer=0;

  const authTimer=setTimeout(() => {
    if (!authenticated) closeClient(client,1008,'Muse 인증 시간이 초과되었습니다.');
  },AUTH_TIMEOUT_MS);

  function clearMetaTimer(){ if(metaTimer) clearTimeout(metaTimer); metaTimer=0; }
  function cleanupMeta(){
    clearMetaTimer();
    if(meta){ try{meta.terminate();}catch(_){} }
    meta=null;
  }

  async function connectMeta(sessionToken,academyId) {
    await assertAcademyAccess(sessionToken,academyId);
    const key=metaKey();
    if(!key) throw Object.assign(new Error('META_MODEL_API_KEY가 설정되지 않았습니다.'),{ statusCode:500 });

    authenticated=true;
    clearTimeout(authTimer);
    const sessionId='olli-muse-' + randomUUID();
    meta=new WebSocket(META_REALTIME_URL + '?sessionId=' + encodeURIComponent(sessionId),{ perMessageDeflate:false });

    metaTimer=setTimeout(() => {
      if(!metaReady){
        closeClient(client,1011,'Muse 서버 연결 시간이 초과되었습니다.');
        cleanupMeta();
      }
    },META_CONNECT_TIMEOUT_MS);

    meta.on('open',() => {
      meta.send(JSON.stringify({
        authorization:{ accessToken:'Bearer ' + key },
        audioEncoding:'PCM_24KHZ',
        model:META_MODEL,
        mode:'DIARIZATION',
        partialMode:'CUMULATIVE',
        emitAudioProgress:false,
        languageBias:['Korean']
      }));
    });
    meta.on('message',(payload,isBinary) => {
      if(isBinary) return;
      let event=null;
      try{ event=JSON.parse(payload.toString()); }catch(_){ return; }
      if(!metaReady && event?.sessionId){
        metaReady=true;
        clearMetaTimer();
        sendJson(client,{ type:'muse.ready',sessionId:String(event.sessionId || sessionId) });
        return;
      }
      if(event?.type === 'error'){
        sendJson(client,{ type:'muse.error',message:String(event.message || event.error?.message || 'Muse 전사 오류가 발생했습니다.'),detail:event });
        return;
      }
      sendJson(client,{ type:'muse.meta',event });
    });
    meta.on('close',(code,reason) => {
      clearMetaTimer();
      sendJson(client,{ type:'muse.complete',code:Number(code || 0),reason:reason ? reason.toString():'',requested:endRequested });
      try{client.close(endRequested ? 1000:1011);}catch(_){}
      meta=null;
    });
    meta.on('error',error => {
      sendJson(client,{ type:'muse.error',message:String(error?.message || 'Muse 서버 연결에 실패했습니다.') });
    });
  }

  client.on('message',async (data,isBinary) => {
    if(!authenticated){
      if(isBinary || authBusy) return closeClient(client,1008,'Muse 인증 후에 음성을 보낼 수 있습니다.');
      let message=null;
      try{message=JSON.parse(data.toString());}catch(_){}
      if(!message || message.type !== 'auth') return closeClient(client,1008,'Muse 인증 정보가 필요합니다.');
      authBusy=true;
      try{
        await connectMeta(String(message.sessionToken || '').trim(),String(message.academyId || '').trim());
      }catch(error){
        closeClient(client,error?.statusCode === 401 ? 1008:1011,error?.message || 'Muse 인증에 실패했습니다.');
      }finally{authBusy=false;}
      return;
    }

    if(isBinary){
      if(!metaReady || meta?.readyState !== WebSocket.OPEN || endRequested) return;
      audioBytes += data.length || data.byteLength || 0;
      if(audioBytes > MAX_AUDIO_BYTES){
        closeClient(client,1009,'Muse 테스트 녹음 용량을 초과했습니다.');
        cleanupMeta();
        return;
      }
      try{meta.send(data,{binary:true});}catch(_){}
      return;
    }

    let message=null;
    try{message=JSON.parse(data.toString());}catch(_){}
    if(!message) return;
    if(message.type === 'endStream'){
      endRequested=true;
      if(meta?.readyState === WebSocket.OPEN){
        try{meta.send(JSON.stringify({type:'endStream'}));}catch(_){}
      }
      return;
    }
    if(message.type === 'ping') sendJson(client,{type:'pong'});
  });

  client.on('close',() => { clearTimeout(authTimer); cleanupMeta(); });
  client.on('error',cleanupMeta);
});

export default server;
