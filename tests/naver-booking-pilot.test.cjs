'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {configFrom,validateDetail,createService}=require('../packages/common/api/_lib/naver-booking-pilot.cjs');
const academyId='43bdc4c1-64e0-4b3d-958d-e8ea56e4ac5e',otherId='d750b878-b303-44dc-83f3-ae7b04a1b118';
const studentId='a9d3670a-8a82-40dc-b8b4-f83eafee61f4';
const biz='937262',number='1234567890';
const baseEnv={OLLI_NAVER_PILOT_ACADEMY_ID:academyId,OLLI_NAVER_PILOT_BUSINESS_ID:biz,
 OLLI_NAVER_PILOT_TINYFISH_PROFILE_ID:'prof_fake123456',OLLI_NAVER_PILOT_TINYFISH_API_KEY:'test-key-for-mocks-only',
 SUPABASE_SECRET_KEY:'test-supabase-service-key-only'};
const result={bookingNumber:number,businessId:biz,studentName:'김테스트',
 gradeOrAge:'7세',startAt:'2026-10-31T10:00:00+09:00',status:'confirmed',product:'재원생 정기 상담'};
const record={academy_id:academyId,booking_number:number,business_id:biz,student_name:'김테스트',
 grade_or_age:'7세',starts_at:'2026-10-31T01:00:00Z',status:'confirmed',verified_at:'2026-10-01T00:00:00Z',matched_student_id:null};
function harness({providerResult=result,old=null,students=[{id:studentId,name:'김테스트',age:'7',grade:'',division:'kinder'}]}={}){
 const calls=[],saved=[];
 const fetchImpl=async(url,options={})=>{
  const path=String(url);calls.push({url:path,method:options.method,body:options.body});
  if(path.includes('/rpc/olli_consultation_messages_manage'))return Response.json({ok:true});
  if(path.startsWith('https://agent.tinyfish.ai'))return Response.json({status:'COMPLETED',result:providerResult});
  if(path.includes('/rest/v1/students?'))return Response.json(students);
  if(path.includes('/olli_naver_booking_pilot_reservations?')){
   if(options.method==='POST'){const data=JSON.parse(options.body);saved.push(data);return Response.json([data]);}
   if(options.method==='PATCH'){const data=JSON.parse(options.body);return Response.json([{booking_number:number,matched_student_id:data.matched_student_id}]);}
   if(path.includes('booking_number=eq.'))return Response.json(old?[old]:[]);
   return Response.json(old?[old]:[]);
  }
  throw Error('Unexpected mocked URL');
 };
 return {service:createService({env:baseEnv,fetchImpl}),calls,saved};
}
test('pilot stays off unless academy, business and browser key are present',()=>{
 assert.equal(configFrom({}).ready,false);
 assert.equal(configFrom({...baseEnv,OLLI_NAVER_PILOT_TINYFISH_API_KEY:''}).ready,false);
 assert.equal(configFrom(baseEnv).ready,true);
});
test('checks number, business ID, student fields and confirmed state',()=>{
 const d=validateDetail(result,{number,businessId:biz});
 assert.equal(d.student_name,'김테스트');assert.equal(d.grade_or_age,'7세');
 assert.equal(d.starts_at,'2026-10-31T01:00:00.000Z');
 assert.throws(()=>validateDetail({...result,businessId:'555'},{number,businessId:biz}),{code:'BOOKING_BUSINESS_MISMATCH'});
 assert.throws(()=>validateDetail({...result,bookingNumber:'555'},{number,businessId:biz}),{code:'BOOKING_NUMBER_MISMATCH'});
 assert.throws(()=>validateDetail({...result,studentName:''},{number,businessId:biz}),{code:'STUDENT_FIELDS_MISSING'});
 assert.throws(()=>validateDetail({...result,status:'cancelled'},{number,businessId:biz}),{code:'BOOKING_STATUS_NOT_CONFIRMED'});
});
test('owner authentication enforces the single academy before any external request',async()=>{
 const h=harness();
 await assert.rejects(h.service.requireOwner('valid-token-has-length',otherId),{code:'PILOT_ACADEMY_NOT_ENABLED'});
 assert.equal(h.calls.length,0);
 await h.service.requireOwner('valid-token-has-length',academyId);
 assert.equal(h.calls.length,1);
});
test('manual import reads the configured booking and stores minimum child fields only',async()=>{
 const h=harness();const out=await h.service.sync(number);
 assert.equal(out.cached,false);assert.equal(h.saved.length,1);
 assert.equal(h.saved[0].academy_id,academyId);
 assert.equal(h.saved[0].student_name,'김테스트');
 assert.equal(h.saved[0].matched_student_id,null);
 const tiny=h.calls.find(c=>c.url.startsWith('https://agent.tinyfish.ai'));
 assert.ok(tiny);
 const request=JSON.parse(tiny.body);
 assert.equal(request.use_profile,true);
 assert.equal(request.url,'https://partner.booking.naver.com/bizes/'+biz+'/booking-list-view/bookings/'+number);
 assert.ok(!tiny.body.includes('valid-token-has-length'));
 assert.ok(!tiny.body.includes('SUPABASE_SECRET_KEY'));
});
test('already imported recently avoids new billable browser run',async()=>{
 const h=harness({old:{...record,verified_at:new Date().toISOString()}});
 const data=await h.service.sync(number);assert.equal(data.cached,true);
 assert.equal(h.calls.some(c=>c.url.startsWith('https://agent.tinyfish.ai')),false);
});
test('name match does not auto-link; grade conflict blocks manual link',async()=>{
 const h=harness({old:record,students:[{id:studentId,name:'김테스트',age:'8',grade:'2'}]});
 const found=await h.service.candidates(number);
 assert.equal(found.students.length,1);
 assert.equal(found.row.matched_student_id,null);
 await assert.rejects(h.service.match(number,studentId),{code:'STUDENT_AGE_OR_GRADE_CONFLICT'});
 assert.equal(h.calls.some(c=>c.method==='PATCH'),false);
});
test('matching valid enrolled student requires explicit owner action',async()=>{
 const h=harness({old:record});
 const saved=await h.service.match(number,studentId);
 assert.equal(saved.matched_student_id,studentId);
 assert.equal(h.calls.filter(c=>c.method==='PATCH').length,1);
});
test('bad booking identifiers and fake cross-academy student IDs fail closed',async()=>{
 const h=harness({old:record});
 await assert.rejects(h.service.sync('../admin'),{code:'BOOKING_NUMBER_INVALID'});
 await assert.rejects(h.service.match(number,otherId),{code:'STUDENT_ACADEMY_OR_NAME_MISMATCH'});
});
