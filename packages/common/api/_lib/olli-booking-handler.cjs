'use strict';
// Guardian booking boundary: no browser service-role key or staff auth session.
// Shared unchanged by PC and mobile; both invoke this Vercel API entrypoint.
const crypto=require('node:crypto');
const {collectMonthSlots}=require('./olli-booking-month-slots.cjs');
const SUPABASE_URL=process.env.SUPABASE_URL||'https://fvkxipjwgeyosgnfhdnx.supabase.co';
const MAX_BYTES=8192;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
function respond(res,status,payload){
 res.setHeader('Cache-Control','no-store, max-age=0, private');
 res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','no-referrer');
 return res.status(status).json(payload);
}
function problem(code,status=400){const e=new Error(code);e.publicCode=code;e.status=status;return e;}
async function readBody(req){
 if(req.body&&typeof req.body==='object'&&!Buffer.isBuffer(req.body)){
  if(Buffer.byteLength(JSON.stringify(req.body))>MAX_BYTES)throw problem('REQUEST_TOO_LARGE',413);
  return req.body;
 }
 if(typeof req.body==='string'){
  if(Buffer.byteLength(req.body)>MAX_BYTES)throw problem('REQUEST_TOO_LARGE',413);
  try{return JSON.parse(req.body);}catch{throw problem('INVALID_JSON');}
 }
 let size=0;
 const chunks=[];
 for await(const c of req){size+=c.length;if(size>MAX_BYTES)throw problem('REQUEST_TOO_LARGE',413);chunks.push(c);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw problem('INVALID_JSON');}
}
function assertOrigin(req){
 const origin=req.headers.origin;
 if(!origin)return;
 let parsed;
 try{parsed=new URL(origin);}catch{throw problem('ORIGIN_FORBIDDEN',403);}
 if(parsed.protocol!=='https:'||parsed.host!==req.headers.host)
   throw problem('ORIGIN_FORBIDDEN',403);
}
function tokenHash(t){
 if(typeof t!=='string'||!TOKEN.test(t))throw problem('LINK_INVALID',401);
 return crypto.createHash('sha256').update(t,'utf8').digest('hex');
}
function cleanIso(s){
 if(typeof s!=='string'||s.length>40||!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(s)
   ||!Number.isFinite(Date.parse(s)))throw problem('START_AT_INVALID');
 return s;
}
async function rpc(name,payload,fetchFn=fetch,env=process.env){
 const key=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
 if(!key)throw problem('SERVER_NOT_CONFIGURED',503);
 const r=await fetchFn((env.SUPABASE_URL||SUPABASE_URL)+'/rest/v1/rpc/'+name,{
  method:'POST',
  headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
  body:JSON.stringify(payload),redirect:'error'
 });
 const data=await r.json().catch(()=>null);
 if(!r.ok){
  const pgCode=String(data?.code||'');
  if(pgCode==='23P01'||pgCode==='23505')throw problem('SLOT_UNAVAILABLE',409);
  if(pgCode==='42501')throw problem('ACCESS_DENIED',403);
  if(pgCode==='40001')throw problem('BOOKING_CONFLICT',409);
  if(pgCode==='22023')throw problem('BOOKING_INVALID',400);
  throw problem('BOOKING_STORAGE_ERROR',502);
 }
 return data;
}
function uuid(x){return typeof x==='string'&&UUID.test(x);}
function assertActionShape(action,body){
 if(['reserve','reschedule','cancel'].includes(action)&&!uuid(body.request_key))
  throw problem('REQUEST_KEY_REQUIRED');
 if(['reschedule','cancel'].includes(action)&&!uuid(body.reservation_id))
  throw problem('RESERVATION_ID_REQUIRED');
 if(['reserve','reschedule'].includes(action))cleanIso(body.start_at);
 if(action==='slots'&&(typeof body.date!=='string'||!/^\d{4}-\d\d-\d\d$/.test(body.date)))
  throw problem('DATE_INVALID');
}
function createHandler({fetchFn,env}={}){
 return async(req,res)=>{
  try{
   if(req.method!=='POST')return respond(res,405,{ok:false,code:'METHOD_NOT_ALLOWED'});
   assertOrigin(req);
   const body=await readBody(req);
   if(!body||Array.isArray(body)||typeof body!=='object')throw problem('INVALID_BODY');
   const action=String(body.action||'');
   if(action==='issue'||action==='revoke'){
    if(!uuid(body.academy_id)||typeof body.session_token!=='string'||!body.session_token||body.session_token.length>300)
      throw problem('STAFF_AUTH_REQUIRED',401);
    if(action==='issue'){
     if((uuid(body.student_id)?1:0)+(uuid(body.intake_id)?1:0)!==1)
      throw problem('INVALID_LINK_TARGET');
     const raw=crypto.randomBytes(32).toString('base64url');
     const ttl=Number(body.days_valid??14);
     if(!Number.isInteger(ttl)||ttl<1||ttl>44)throw problem('INVALID_TTL');
     const expiresAt=new Date(Date.now()+ttl*86400*1000).toISOString();
     const result=await rpc('olli_booking_staff_link_manage',{
      p_session_token:body.session_token,p_academy_id:body.academy_id,
      p_action:'issue',p_student_id:body.student_id||null,p_intake_id:body.intake_id||null,
      p_token_hash:tokenHash(raw),p_expires_at:expiresAt,p_link_id:null
     },fetchFn,env);
     // Client places token in URL fragment only, never in URL query or path.
     return respond(res,200,{ok:true,link_id:result.link_id,
      expires_at:result.expires_at,fragment:'#token='+raw});
    }
    if(!uuid(body.link_id))throw problem('LINK_ID_REQUIRED');
    const result=await rpc('olli_booking_staff_link_manage',{
     p_session_token:body.session_token,p_academy_id:body.academy_id,
     p_action:'revoke',p_student_id:null,p_intake_id:null,p_token_hash:null,
     p_expires_at:null,p_link_id:body.link_id
    },fetchFn,env);
    return respond(res,200,result);
   }
   if(action==='month-slots'){
    const digest=tokenHash(body.token);
    const slug=String(body.academy||'');
    if(!/^[0-9a-f]{36}$/.test(slug))throw problem('MONTH_INVALID');
    const args={p_token_hash:digest,p_date:null,p_start_at:null,
     p_request_key:null,p_reservation_id:null};
    // Authenticate at the same server boundary before any month response.
    await rpc('olli_booking_parent_request',{...args,p_action:'snapshot'},fetchFn,env);
    const cfg=await rpc('olli_booking_public_info',{p_slug:slug},fetchFn,env);
    if(cfg?.ok!==true)throw problem('ACADEMY_NOT_FOUND',404);
    let schedule;
    try{
     schedule=await collectMonthSlots({month:body.month,weeks:cfg.weeks,
      weekdays:cfg.weekdays,fetchDay:async date=>{
       const d=await rpc('olli_booking_parent_request',{
        ...args,p_action:'slots',p_date:date},fetchFn,env);
       return d?.slots;
      }});
    }catch(e){if(e.message==='MONTH_INVALID')throw problem('MONTH_INVALID');throw e;}
    return respond(res,200,{ok:true,month:body.month,slots_by_date:schedule});
   }
   if(!['snapshot','slots','reserve','reschedule','cancel'].includes(action))
    throw problem('INVALID_ACTION');
   assertActionShape(action,body);
   const result=await rpc('olli_booking_parent_request',{
    p_token_hash:tokenHash(body.token),p_action:action,
    p_date:action==='slots'?body.date:null,
    p_start_at:['reserve','reschedule'].includes(action)?body.start_at:null,
    p_request_key:['reserve','reschedule','cancel'].includes(action)?body.request_key:null,
    p_reservation_id:['reschedule','cancel'].includes(action)?body.reservation_id:null
   },fetchFn,env);
   return respond(res,200,result);
  }catch(e){
   if(!e.publicCode)console.error('OLLI_BOOKING_BACKEND_ERROR',e?.name||'Error');
   return respond(res,e.status||500,{ok:false,code:e.publicCode||'INTERNAL_ERROR'});
  }
 };
}
module.exports=createHandler();
module.exports.createHandler=createHandler;
module.exports._test={tokenHash,cleanIso};
