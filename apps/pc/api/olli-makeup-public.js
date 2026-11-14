'use strict';
// Parent-only REST gateway. All student data and schedule mutations stay inside
// vetted service-role RPCs. No service key, parent token or guardian phone is logged.
const crypto = require('node:crypto');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fvkxipjwgeyosgnfhdnx.supabase.co';
const SLUG = /^[0-9a-f]{36}$/;
const PHONE = /^01[016789][0-9]{7,8}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d\d-\d\d$/;
const HASH = /^[0-9a-f]{64}$/;
const KNOWN_CODES = new Set(['FORM_INVALID','MATCH_NOT_FOUND','NAME_AMBIGUOUS',
  'TOO_MANY_ATTEMPTS','ACCESS_DENIED','DATE_INVALID','ABSENCE_INVALID',
  'MAKEUP_CREDIT_REQUIRED','SLOT_UNAVAILABLE','SLOT_CONFLICT','REQUEST_CONFLICT']);
function fail(code,status=400){const e=new Error(code);e.code=code;e.status=status;throw e;}
function send(res,status,data){
  for(const [k,v] of Object.entries({
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'private, no-store, max-age=0',
    'Referrer-Policy':'no-referrer',
    'X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'DENY'
  }))res.setHeader(k,v);
  return res.status(status).json(data);
}
async function bodyOf(req){
  if(req.body && typeof req.body==='object'&&!Buffer.isBuffer(req.body)){
    if(Buffer.byteLength(JSON.stringify(req.body))>8192)fail('FORM_INVALID',413);
    return req.body;
  }
  if(typeof req.body==='string'){
    if(Buffer.byteLength(req.body)>8192)fail('FORM_INVALID',413);
    try{return JSON.parse(req.body);}catch{fail('FORM_INVALID');}
  }
  let size=0;const chunks=[];
  for await(const c of req){
    size+=c.length;if(size>8192)fail('FORM_INVALID',413);
    chunks.push(c);
  }
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('FORM_INVALID');}
}
function originGuard(req){
  if(!req.headers?.origin)return;
  let u;
  try{u=new URL(req.headers.origin);}catch{fail('ACCESS_DENIED',403);}
  if(u.protocol!=='https:'||u.origin!==req.headers.origin)fail('ACCESS_DENIED',403);
  if(u.host===req.headers.host)return;
  let configured;
  try{configured=new URL(process.env.OLLI_BOOKING_PUBLIC_ORIGIN);}catch{}
  if(configured?.protocol==='https:' && configured.origin===u.origin && configured.pathname==='/' &&
     !configured.username&&!configured.password&&!configured.search&&!configured.hash)return;
  fail('ACCESS_DENIED',403);
}
function getSecret(){
  const s=process.env.OLLI_BOOKING_AUTH_SECRET;
  if(!s||s.length<32)fail('SERVICE_UNAVAILABLE',503);
  return s;
}
function sessionHash(token){return crypto.createHash('sha256').update(token).digest('hex');}
function ipHash(req,secret){
  const via=process.env.VERCEL==='1'?String(req.headers?.['x-vercel-forwarded-for']||''):'';
  const ip=(via||String(req.socket?.remoteAddress||'unknown')).slice(0,96);
  return crypto.createHmac('sha256',secret).update('ip:'+ip).digest('hex');
}
async function rpc(name,params){
  const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!key)fail('SERVICE_UNAVAILABLE',503);
  let response, data;
  try{
    response=await fetch(SUPABASE_URL+'/rest/v1/rpc/'+name,{
      method:'POST',
      headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
      body:JSON.stringify(params),redirect:'error',signal:AbortSignal.timeout(15000)
    });
    data=await response.json();
  }catch{fail('SERVICE_UNAVAILABLE',503);}
  if(!response.ok){
    if(data?.code==='P0001' && KNOWN_CODES.has(data?.message)){
      const code=data.message;
      fail(code,code==='SLOT_UNAVAILABLE'||code==='SLOT_CONFLICT'||code==='REQUEST_CONFLICT'?409:400);
    }
    fail('SERVICE_UNAVAILABLE',503);
  }
  return data;
}
function tokenFrom(body){
  const token=String(body.session_token||'');
  if(token.length!==43||!/^[A-Za-z0-9_-]{43}$/.test(token))fail('ACCESS_DENIED',403);
  const digest=sessionHash(token);
  if(!HASH.test(digest))fail('ACCESS_DENIED',403);
  return digest;
}
function parseDate(date){
  if(typeof date!=='string'||!DATE.test(date))fail('FORM_INVALID');
  const d=new Date(date+'T00:00:00Z');
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==date)fail('FORM_INVALID');
  return date;
}
function entries(value){
  if(!Array.isArray(value)||value.length>10)fail('FORM_INVALID');
  const used=new Set();
  return value.map(v=>{
    if(!v||typeof v!=='object'||Array.isArray(v))fail('FORM_INVALID');
    const date=parseDate(v.date);
    const time=Number(v.time_slot);
    const group=v.group;
    if(!Number.isInteger(time)||time<1||time>12||!['A','B'].includes(group))fail('FORM_INVALID');
    const tag=date+'|'+time+'|'+group;
    if(used.has(tag))fail('FORM_INVALID');
    used.add(tag);
    return {date,time_slot:time,group};
  });
}
module.exports=async function handler(req,res){
  try{
    if(req.method!=='POST')return send(res,405,{ok:false,code:'METHOD_NOT_ALLOWED'});
    originGuard(req);
    const b=await bodyOf(req);
    if(!b||typeof b!=='object'||Array.isArray(b))fail('FORM_INVALID');
    const action=String(b.action||'');
    if(action==='info'){
      const slug=String(b.academy||'');
      if(!SLUG.test(slug))fail('FORM_INVALID');
      const result=await rpc('olli_booking_public_info',{p_slug:slug});
      if(result?.ok!==true)fail('ACADEMY_NOT_FOUND',404);
      return send(res,200,{ok:true,academy_name:String(result.academy_name||'')});
    }
    if(action==='identify'){
      const slug=String(b.academy||'');
      const name=String(b.student_name||'').trim();
      const phone=String(b.guardian_phone||'').replace(/[\s-]/g,'');
      if(!SLUG.test(slug)||name.length<2||name.length>60||/[%_]/.test(name)||!PHONE.test(phone))
        fail('FORM_INVALID');
      const secret=getSecret();
      const token=crypto.randomBytes(32).toString('base64url');
      const result=await rpc('olli_makeup_parent_identify',{
        p_slug:slug,p_student_name:name,p_guardian_phone:phone,
        p_token_hash:sessionHash(token),p_ip_digest:ipHash(req,secret)
      });
      if(result?.ok!==true){
        const c=KNOWN_CODES.has(result?.code)?result.code:'MATCH_NOT_FOUND';
        fail(c,c==='TOO_MANY_ATTEMPTS'?429:400);
      }
      return send(res,200,{ok:true,session_token:token,
        student_name:String(result.student_name||''),
        division:result.division==='kinder'?'kinder':'elementary'});
    }
    if(action==='snapshot'){
      const result=await rpc('olli_makeup_parent_snapshot',{p_token_hash:tokenFrom(b)});
      if(result?.ok!==true)fail('ACCESS_DENIED',403);
      return send(res,200,result);
    }
    if(action==='week'){
      const weekStart=parseDate(b.week_start);
      // Parent credentials are checked inside the service-role SQL RPC.
      const result=await rpc('olli_makeup_parent_week',{
        p_token_hash:tokenFrom(b),p_week_start:weekStart});
      if(result?.ok!==true){
        const code=result?.code==='DATE_INVALID'?'DATE_INVALID':'ACCESS_DENIED';
        fail(code,code==='ACCESS_DENIED'?403:400);
      }
      return send(res,200,{ok:true,week_start:String(result.week_start||weekStart),
        slots:Array.isArray(result.slots)?result.slots:[]});
    }
    if(action==='slots'){
      const date=parseDate(b.date);
      const result=await rpc('olli_makeup_parent_slots',{
        p_token_hash:tokenFrom(b),p_date:date});
      if(result?.ok!==true)fail('ACCESS_DENIED',403);
      return send(res,200,{ok:true,slots:Array.isArray(result.slots)?result.slots:[]});
    }
    if(action==='submit'){
      const reqKey=String(b.request_key||'');
      if(!UUID.test(reqKey))fail('FORM_INVALID');
      const absences=entries(b.absences),makeups=entries(b.makeups);
      if(!absences.length&&!makeups.length)fail('FORM_INVALID');
      const result=await rpc('olli_makeup_parent_submit',{
        p_token_hash:tokenFrom(b),p_request_key:reqKey,
        p_absences:absences,p_makeups:makeups
      });
      if(result?.ok!==true)fail('SERVICE_UNAVAILABLE',503);
      return send(res,200,{ok:true,request_id:String(result.request_id||''),
        unchanged:result.unchanged===true});
    }
    fail('FORM_INVALID');
  }catch(e){
    const status=Number.isInteger(e.status)?e.status:500;
    const code=typeof e.code==='string'?e.code:'SERVICE_UNAVAILABLE';
    // Neither student data nor exception strings may enter logs/responses.
    return send(res,status,{ok:false,code});
  }
};
