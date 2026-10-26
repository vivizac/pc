'use strict';
// The only public booking URL is per ACADEMY, not per student. The ephemeral
// 45-minute token returned after guardian SMS verification is an internal API
// session, never a public URL, URL fragment, Solapi template variable or link.
const crypto=require('node:crypto');
const SUPABASE_URL=process.env.SUPABASE_URL||'https://fvkxipjwgeyosgnfhdnx.supabase.co';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG=/^[0-9a-f]{36}$/;
const DIGITS=/^01[016789][0-9]{7,8}$/;
const CODE=/^[0-9]{6}$/;
function error(code,status=400){let e=new Error(code);e.code=code;e.status=status;return e;}
function out(res,status,payload){
 for(const [key,val] of Object.entries({'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store, max-age=0','Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'}))res.setHeader(key,val);
 return res.status(status).json(payload);
}
function readBody(req){
 if(req.body && typeof req.body==='object' && !Buffer.isBuffer(req.body)){
  if(Buffer.byteLength(JSON.stringify(req.body))>2048)throw error('INVALID_BODY',413);
  return Promise.resolve(req.body);
 }
 if(typeof req.body==='string'){
  if(Buffer.byteLength(req.body)>2048)throw error('INVALID_BODY',413);
  try{return Promise.resolve(JSON.parse(req.body));}catch{throw error('INVALID_BODY');}
 }
 return (async()=>{let bytes=0,parts=[];for await(const part of req){
  bytes+=part.length;if(bytes>2048)throw error('INVALID_BODY',413);parts.push(part);
 }try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw error('INVALID_BODY');}})();
}
function originGuard(req){
 if(!req.headers?.origin)return;
 let u;try{u=new URL(req.headers.origin);}catch{throw error('ORIGIN_FORBIDDEN',403);}
 if(u.protocol!=='https:'||u.host!==req.headers.host)throw error('ORIGIN_FORBIDDEN',403);
}
function authSecret(env){
 const value=env.OLLI_BOOKING_AUTH_SECRET;
 if(typeof value!=='string'||value.length<32)throw error('AUTH_NOT_CONFIGURED',503);
 return value;
}
function digest(secret,...parts){return crypto.createHmac('sha256',secret).update(parts.join(':')).digest('hex');}
function fixedUrl(env,slug){
 let u;try{u=new URL(env.OLLI_BOOKING_PUBLIC_ORIGIN);}catch{throw error('BOOKING_ORIGIN_NOT_CONFIGURED',503);}
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/'||u.port&&u.port!=='443')
  throw error('BOOKING_ORIGIN_NOT_CONFIGURED',503);
 if(!SLUG.test(slug))throw error('BOOKING_ORIGIN_NOT_CONFIGURED',503);
 u.pathname='/consultation-booking.html';u.searchParams.set('academy',slug);
 return u.toString();
}
function configMap(env){
 try{const json=JSON.parse(env.OLLI_CONSULTATION_SOLAPI_CREDENTIALS||'{}');
 return typeof json==='object'&&json&&!Array.isArray(json)?json:{};}catch{return {};}
}
function ipDigest(req,secret,env){
 const cf=env.VERCEL==='1'?String(req.headers?.['x-vercel-forwarded-for']||''):'';
 const ip=cf.slice(0,96)||String(req.socket?.remoteAddress||'unknown').slice(0,96);
 return digest(secret,'ip',ip);
}
async function rpc(name,params,fetchFn,env){
 const key=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
 if(!key)throw error('DATABASE_NOT_CONFIGURED',503);
 const response=await fetchFn((env.SUPABASE_URL||SUPABASE_URL)+'/rest/v1/rpc/'+name,{
  method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
  body:JSON.stringify(params),redirect:'error',signal:AbortSignal.timeout(12000)
 });
 if(!response.ok)throw error('BOOKING_NOT_AVAILABLE',response.status===403?403:503);
 return response.json();
}
async function sms(to,academyId,code,fetchFn,env,now=()=>new Date()){
 const item=configMap(env)[academyId];
 const from=String(item?.sender||env.OLLI_BOOKING_SMS_FROM||'').replace(/\D/g,'');
 if(!item?.apiKey||!item?.apiSecret||!/^[0-9]{9,11}$/.test(from))return false;
 const date=now().toISOString();
 const salt=crypto.randomBytes(16).toString('hex');
 // SOLAPI HMAC signature is HMAC(secret, date+salt), NOT colon-separated parts.
 const realSignature=crypto.createHmac('sha256',item.apiSecret).update(date+salt).digest('hex');
 const response=await fetchFn('https://api.solapi.com/messages/v4/send-many/detail',{
  method:'POST',headers:{'Content-Type':'application/json',Authorization:
    'HMAC-SHA256 apiKey='+item.apiKey+', date='+date+', salt='+salt+', signature='+realSignature},
  body:JSON.stringify({messages:[{to,from,type:'SMS',text:'[올리] 상담 예약 인증번호 '+code+' (5분 유효)'}]}),
  redirect:'error',signal:AbortSignal.timeout(12000)
 });
 return response.ok;
}
function createHandler({fetchFn=fetch,env=process.env,now=()=>new Date()}={}){
 return async function(req,res){
  try{
   if(req.method!=='POST')return out(res,405,{ok:false,code:'METHOD_NOT_ALLOWED'});
   originGuard(req);
   const body=await readBody(req);
   if(!body||typeof body!=='object'||Array.isArray(body))throw error('INVALID_BODY');
   const action=String(body.action||'');
   if(action==='public-link'){
     if(!UUID.test(body.academy_id||'')||typeof body.session_token!=='string'||!body.session_token)
      throw error('OWNER_SESSION_REQUIRED',401);
     const d=await rpc('olli_booking_public_link_manage',{
       p_session_token:body.session_token,p_academy_id:body.academy_id
     },fetchFn,env);
     if(!d.ok)throw error('OWNER_SESSION_REQUIRED',403);
     return out(res,200,{ok:true,url:fixedUrl(env,d.slug)});
   }
   const secret=authSecret(env);
   if(action==='begin'){
     const slug=String(body.academy||''),studentName=String(body.student_name||'').trim();
     const phone=String(body.guardian_phone||'').replace(/[- ]/g,'');
     if(!SLUG.test(slug)||studentName.length<2||studentName.length>60
        ||!DIGITS.test(phone))
       throw error('FORM_INVALID');
     const challengeId=crypto.randomUUID();
     const otp=String(crypto.randomInt(0,1000000)).padStart(6,'0');
     const result=await rpc('olli_booking_public_begin',{
       p_slug:slug,p_student_name:studentName,p_guardian_phone:phone,p_challenge_id:challengeId,
       p_code_hash:digest(secret,'otp',challengeId,otp),
       p_ip_digest:ipDigest(req,secret,env)
     },fetchFn,env);
     if(result?.send_to&&result?.academy_id){
       try{if(!await sms(result.send_to,result.academy_id,otp,fetchFn,env,now))
           console.warn('OLLI_BOOKING_OTP_PROVIDER_UNAVAILABLE');}
       catch{console.warn('OLLI_BOOKING_OTP_PROVIDER_ERROR');}
     }
     // Same response for unknown students, wrong phone, duplicates and matches.
     return out(res,202,{ok:true,challenge_id:challengeId,message:'인증번호를 받으셨다면 입력해 주세요.'});
   }
   if(action==='verify'){
     if(!UUID.test(body.challenge_id||'')||!CODE.test(body.code||''))
       throw error('OTP_INVALID',400);
     const token=crypto.randomBytes(32).toString('base64url');
     const verified=await rpc('olli_booking_public_verify',{
       p_challenge_id:body.challenge_id,
       p_code_hash:digest(secret,'otp',body.challenge_id,body.code),
       p_session_hash:crypto.createHash('sha256').update(token).digest('hex')
     },fetchFn,env);
     if(verified?.ok!==true)return out(res,401,{ok:false,code:'OTP_INVALID'});
     return out(res,200,{ok:true,session_token:token,
       expires_in_seconds:verified.expires_in_seconds});
   }
   return out(res,400,{ok:false,code:'INVALID_ACTION'});
  }catch(e){
   if(!e.code)console.warn('OLLI_BOOKING_PUBLIC_REQUEST_FAILED',e?.name||'Error');
   return out(res,e.status||500,{ok:false,code:e.code||'INTERNAL_ERROR'});
  }
 };
}
module.exports=createHandler();
module.exports.createHandler=createHandler;
module.exports._test={digest,fixedUrl,ipDigest};
