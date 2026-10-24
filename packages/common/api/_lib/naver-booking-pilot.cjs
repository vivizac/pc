'use strict';
// Manual owner-triggered, single-academy pilot. Off unless configured in the Olli server.
const SUPABASE_URL='https://fvkxipjwgeyosgnfhdnx.supabase.co';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER=/^\d{8,20}$/;
function problem(code,status=400){const e=new Error(code);e.code=code;e.status=status;return e;}
function configFrom(env){
 const academyId=String(env.OLLI_NAVER_PILOT_ACADEMY_ID||'').trim();
 const businessId=String(env.OLLI_NAVER_PILOT_BUSINESS_ID||'').trim();
 const profileId=String(env.OLLI_NAVER_PILOT_TINYFISH_PROFILE_ID||'').trim();
 const apiKey=String(env.OLLI_NAVER_PILOT_TINYFISH_API_KEY||'').trim();
 return {academyId,businessId,profileId,apiKey,scoped:UUID.test(academyId)&&/^\d{1,20}$/.test(businessId),
 ready:UUID.test(academyId)&&/^\d{1,20}$/.test(businessId)&&/^prof_[\w-]{6,}$/.test(profileId)&&apiKey.length>=16};
}
function validateDetail(data,{number,businessId}){
 const obj=data&&typeof data==='object'?data:{};
 if(String(obj.bookingNumber||'')!==number)throw problem('BOOKING_NUMBER_MISMATCH',422);
 if(String(obj.businessId||'')!==businessId)throw problem('BOOKING_BUSINESS_MISMATCH',422);
 const name=String(obj.studentName||'').trim().replace(/\s+/g,' ');
 const age=String(obj.gradeOrAge||'').trim();
 const startAt=String(obj.startAt||'').trim();
 if(!name||name.length>80||!age||age.length>80)throw problem('STUDENT_FIELDS_MISSING',422);
 if(String(obj.status)!=='confirmed')throw problem('BOOKING_STATUS_NOT_CONFIRMED',422);
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?\+09:00$/.test(startAt)||!Number.isFinite(Date.parse(startAt)))
  throw problem('BOOKING_TIME_INVALID',422);
 const product=String(obj.product||'');
 if(product.length>200)throw problem('BOOKING_PRODUCT_INVALID',422);
 return {booking_number:number,business_id:businessId,student_name:name,grade_or_age:age,
 starts_at:new Date(startAt).toISOString(),product_name:product,status:'confirmed'};
}
function createService({env=process.env,fetchImpl=globalThis.fetch}={}){
 const cfg=configFrom(env),secret=String(env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY||'');
 function scope(academyId){
  if(!cfg.scoped||String(academyId)!==cfg.academyId)throw problem('PILOT_ACADEMY_NOT_ENABLED',403);
 }
 async function db(path,{method='GET',data,prefer}={}){
  if(secret.length<12)throw problem('DB_CONFIG_MISSING',503);
  const h={apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json'};
  if(prefer)h.Prefer=prefer;
  const r=await fetchImpl(SUPABASE_URL+path,{method,headers:h,...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw problem('DB_REQUEST_FAILED',503);
  return r.json();
 }
 async function requireOwner(token,academyId){
  scope(academyId);
  if(typeof token!=='string'||token.length<12||token.length>500)throw problem('OWNER_SESSION_REQUIRED',401);
  const a=await db('/rest/v1/rpc/olli_consultation_messages_manage',{method:'POST',data:{
   p_session_token:token,p_academy_id:academyId,p_action:'load',p_data:{}}});
  if(a?.ok!==true)throw problem('OWNER_NOT_AUTHORIZED',403);
 }
 function filter(extra=''){return '/rest/v1/olli_naver_booking_pilot_reservations?academy_id=eq.'+cfg.academyId+extra;}
 async function get(number){
  const rows=await db(filter('&booking_number=eq.'+encodeURIComponent(number)+'&select=booking_number,business_id,product_name,starts_at,student_name,grade_or_age,status,matched_student_id,verified_at'));
  return Array.isArray(rows)?rows[0]||null:null;
 }
 async function list(){
  const rows=await db(filter('&select=booking_number,business_id,product_name,starts_at,student_name,grade_or_age,status,matched_student_id,verified_at&order=starts_at.asc&limit=80'));
  return Array.isArray(rows)?rows:[];
 }
 async function readFromNaver(number){
  if(!cfg.ready)throw problem('NAVER_PILOT_NOT_CONFIGURED',503);
  const url='https://partner.booking.naver.com/bizes/'+cfg.businessId+'/booking-list-view/bookings/'+number;
  const goal='읽기 전용: 이 네이버 예약 상세정보의 예약번호 '+number+' 를 확인합니다. 우측 예약자입력정보의 이름 답변을 studentName, (초등, 유치부 반) 학년 또는 나이 답변을 gradeOrAge로 추출하세요. 예약번호 bookingNumber, 예약 서비스 ID businessId, 상담상품 product, 확정 여부 status(confirmed), 한국시간 ISO 8601(+09:00) 이용일시 startAt를 JSON 필드로 반환하세요. 입력이 없으면 추측하지 마세요. 그 외 개인정보 수집, 취소, 변경, 제출, 메시지 전송은 하지 마세요.';
  const r=await fetchImpl('https://agent.tinyfish.ai/v1/automation/run',{
   method:'POST',headers:{'Content-Type':'application/json','X-API-Key':cfg.apiKey},
   body:JSON.stringify({url,goal,use_profile:true,profile_id:cfg.profileId,
    agent_config:{mode:'strict',max_steps:22,max_duration_seconds:130},
    output_schema:{type:'object',properties:{bookingNumber:{type:'string'},businessId:{type:'string'},studentName:{type:'string'},gradeOrAge:{type:'string'},startAt:{type:'string'},status:{type:'string'},product:{type:'string'}},required:['bookingNumber','businessId','studentName','gradeOrAge','startAt','status']}}),
   signal:AbortSignal.timeout(155000)
  });
  if(!r.ok)throw problem('NAVER_BROWSER_REQUEST_FAILED',503);
  const result=await r.json();
  if(!['COMPLETED','completed'].includes(String(result.status||'')))throw problem('NAVER_BROWSER_INCOMPLETE',503);
  return validateDetail(result.result||result.result_json,{number,businessId:cfg.businessId});
 }
 async function sync(value){
  const number=String(value||'').trim();
  if(!NUMBER.test(number))throw problem('BOOKING_NUMBER_INVALID');
  const old=await get(number);
  if(old && Date.now()-Date.parse(old.verified_at)<30*60*1000)return {row:old,cached:true};
  const detail=await readFromNaver(number);
  const linked=old?.student_name===detail.student_name?old.matched_student_id:null;
  const rows=await db('/rest/v1/olli_naver_booking_pilot_reservations?on_conflict=academy_id,booking_number',{
   method:'POST',prefer:'resolution=merge-duplicates,return=representation',data:{
    academy_id:cfg.academyId,...detail,matched_student_id:linked,verified_at:new Date().toISOString()}});
  if(!Array.isArray(rows)||rows.length!==1)throw problem('BOOKING_SAVE_UNCONFIRMED',503);
  return {row:rows[0],cached:false};
 }
 async function candidates(number){
  const row=await get(number);
  if(!row)return {row:null,students:[]};
  const rows=await db('/rest/v1/students?academy_id=eq.'+cfg.academyId+'&status=eq.active&is_deleted=eq.false&deleted_at=is.null&name=eq.'+encodeURIComponent(row.student_name)+'&select=id,name,grade,age,division&limit=15');
  return {row,students:Array.isArray(rows)?rows:[]};
 }
 async function match(number,studentId){
  if(!NUMBER.test(String(number)))throw problem('BOOKING_NUMBER_INVALID');
  if(studentId!==null&&!UUID.test(String(studentId||'')))throw problem('STUDENT_ID_INVALID');
  const {row,students}=await candidates(number);
  if(!row)throw problem('BOOKING_NOT_FOUND',404);
  const selected=students.find(s=>s.id===studentId);
  if(studentId!==null&&!selected)throw problem('STUDENT_ACADEMY_OR_NAME_MISMATCH',409);
  if(selected){
   // An age/grade conflict must never be silently linked to another student.
   const bookingValue=String(row.grade_or_age||'');
   const targetNumbers=[selected.age,selected.grade].map(x=>String(x||'').trim()).filter(Boolean);
   const bookingDigits=(bookingValue.match(/\d+/g)||[]).map(Number);
   const targetDigits=targetNumbers.flatMap(x=>(x.match(/\d+/g)||[]).map(Number));
   if(bookingDigits.length&&targetDigits.length&&!bookingDigits.some(n=>targetDigits.includes(n)))
    throw problem('STUDENT_AGE_OR_GRADE_CONFLICT',409);
  }
  const rows=await db(filter('&booking_number=eq.'+number+'&select=booking_number,matched_student_id'),{
   method:'PATCH',prefer:'return=representation',data:{matched_student_id:studentId}});
  if(!Array.isArray(rows)||rows.length!==1||rows[0].matched_student_id!==studentId)
   throw problem('BOOKING_MATCH_SAVE_FAILED',503);
  return rows[0];
 }
 return {cfg,requireOwner,readFromNaver,db,get,list,sync,candidates,match};
}
module.exports={configFrom,validateDetail,createService,problem};
