'use strict';
// One stable public URL per academy. No SMS or OTP; matching only on final reserve.
const crypto=require('node:crypto');
const SUPABASE_URL=process.env.SUPABASE_URL||'https://fvkxipjwgeyosgnfhdnx.supabase.co';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG=/^[0-9a-f]{36}$/;
const DIGITS=/^01[016789][0-9]{7,8}$/;
const ISO=/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/;
function error(code,status=400){const e=new Error(code);e.code=code;e.status=status;return e;}
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
function ipDigest(req,secret,env){
 const forwarded=env.VERCEL==='1'?String(req.headers?.['x-vercel-forwarded-for']||''):'';
 const ip=forwarded.slice(0,96)||String(req.socket?.remoteAddress||'unknown').slice(0,96);
 return digest(secret,'ip',ip);
}
async function rpc(name,params,fetchFn,env){
 const key=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
 if(!key)throw error('DATABASE_NOT_CONFIGURED',503);
 const response=await fetchFn((env.SUPABASE_URL||SUPABASE_URL)+'/rest/v1/rpc/'+name,{
  method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
  body:JSON.stringify(params),redirect:'error',signal:AbortSignal.timeout(12000)
 });
 if(!response.ok)throw error('BOOKING_NOT_AVAILABLE',503);
 return response.json();
}
function parseDate(s){
 if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(Date.parse(s+'T00:00:00Z')))
  throw error('DATE_INVALID');return s;
}
function createHandler({fetchFn=fetch,env=process.env}={}){
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
   const slug=String(body.academy||'');
   if(!SLUG.test(slug))throw error('FORM_INVALID');
   if(action==='info'){
    const d=await rpc('olli_booking_public_info',{p_slug:slug},fetchFn,env);
    if(d?.ok!==true)throw error('ACADEMY_NOT_FOUND',404);
    return out(res,200,{ok:true,academy_name:String(d.academy_name||''),
      weeks:Array.isArray(d.weeks)?d.weeks:[2,3],
      weekdays:Array.isArray(d.weekdays)?d.weekdays:[1,2,3,4,5]});
   }
   if(action==='slots'){
    const date=parseDate(body.date);
    const d=await rpc('olli_booking_public_slots',{p_slug:slug,p_date:date},fetchFn,env);
    return out(res,200,{ok:true,slots:Array.isArray(d?.slots)?d.slots:[]});
   }
   if(action==='reserve'){
    const name=String(body.student_name||'').trim();
    const phone=String(body.guardian_phone||'').replace(/[-\s]/g,'');
    const when=body.start_at;
    if(name.length<2||name.length>60||!DIGITS.test(phone)||
       !UUID.test(body.request_key||'')||typeof when!=='string'||!ISO.test(when)||!Number.isFinite(Date.parse(when)))
      throw error('FORM_INVALID');
    const secret=authSecret(env);
    const token=crypto.randomBytes(32).toString('base64url');
    const d=await rpc('olli_booking_public_reserve',{
     p_slug:slug,p_student_name:name,p_guardian_phone:phone,
     p_start_at:when,p_request_key:body.request_key,
     p_session_hash:crypto.createHash('sha256').update(token).digest('hex'),
     p_ip_digest:ipDigest(req,secret,env)
    },fetchFn,env);
    if(d?.ok!==true){
     const code=['MATCH_NOT_FOUND','SLOT_UNAVAILABLE','BOOKING_INVALID','TOO_MANY_ATTEMPTS','ACCESS_DENIED']
      .includes(d?.code)?d.code:'BOOKING_NOT_AVAILABLE';
     const status={MATCH_NOT_FOUND:400,SLOT_UNAVAILABLE:409,BOOKING_INVALID:400,
       TOO_MANY_ATTEMPTS:429,ACCESS_DENIED:403}[code]||503;
     return out(res,status,{ok:false,code});
    }
    return out(res,200,{ok:true,session_token:token,existing:d.existing===true});
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
