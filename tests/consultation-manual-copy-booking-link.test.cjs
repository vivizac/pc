'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'packages/common/olli-consultation-messages.js'),'utf8');
const a=src.indexOf('  async function manualNoticeAcademyBookingUrl(ctx) {');
const b=src.indexOf('  function manualConsultationCopyIconSvg() {',a);
assert.ok(a>=0&&b>a,'manual copy functions must remain together');
const segment=src.slice(a,b);
const nameStart=src.indexOf('  function manualGivenName(');
const nameEnd=src.indexOf('  function manualNoticeStage(',nameStart);
assert.ok(nameStart>=0&&nameEnd>nameStart,'student name substitution functions must exist');
const getNameValue=vm.runInNewContext('(function(){\n'+src.slice(nameStart,nameEnd)+'\nreturn manualNameValue\n})()',{});
const academy='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const slug='0123456789abcdef0123456789abcdef0123';
const bookingUrl='https://booking.example.org/consultation-booking.html?academy='+slug;
const old='https://booking.naver.com/booking/13/bizes/987';
function prepare(body,options={}){
 let copied=null,requests=[],account=academy;
 const context=()=>({academyId:account,sessionToken:'owner-session'});
 const button={dataset:{consultationCopyIcon:'false'},textContent:'',isConnected:false};
 const fakeWindow={fetch:async(url,init)=>{
   requests.push({url,payload:JSON.parse(init.body)});
   if(typeof options.beforeReturn==='function')options.beforeReturn(()=>{account='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';});
   return {ok:options.httpOk!==false,json:async()=>({ok:options.apiOk!==false,url:options.link||bookingUrl})};
 }};
 const sandbox={
   global:fakeWindow, context, sameContext:ctx=>ctx.academyId===account&&ctx.sessionToken==='owner-session',
   manualNoticeStudent:()=>({name:options.name||'김하늘',type:'kinder'}),
   manualNoticeStage:()=>options.stage||'after_1',
   manualNoticeConfig:async()=>({academy_name:'비비작',booking_url:old}),
   loadManualNotices:async()=>({[options.stage==='annual:every_12'?'annual:every_12':'kinder:'+(options.stage||'after_1')]:body}),
   manualNoticeDefaults:()=>'', manualGivenName:n=>n,
   manualNameValue:(n,kind)=>options.stage==='annual:every_12'?getNameValue(n,kind):n,
   navigator:{clipboard:{writeText:async value=>{copied=value;}}},
   setTimeout:()=>{}, URL, document:{}, console
 };
 async function copy(){
   await vm.runInNewContext('(async function(card,button){\n'+segment+'\nreturn copyManualConsultationNotice(card,button)\n})',
     sandbox)({},button);
   return {copied,requests,button};
 }
 return {copy,read:()=>copied};
}
test('manual notice appends academy-specific shared booking URL, not old Naver link',async()=>{
 const x=prepare('안녕하세요 #{학생명} 학부모님.\n상담예약은 #{예약링크}\n'+old);
 const r=await x.copy();
 assert.ok(r.copied.includes('김하늘'));
 assert.ok(r.copied.includes('\n\n상담 예약 링크\n'+bookingUrl));
 assert.ok(!r.copied.includes(old));
 assert.ok(!r.copied.includes('#{예약링크}'));
 assert.equal(r.copied.split(bookingUrl).length-1,1);
 assert.equal(r.requests.length,1);
 assert.equal(r.requests[0].url,'/api/olli-booking-public');
 assert.deepEqual(Object.keys(r.requests[0].payload).sort(),
   ['action','academy_id','session_token'].sort());
 assert.equal(r.requests[0].payload.action,'public-link');
 assert.equal(r.requests[0].payload.academy_id,academy);
 assert.equal(r.button.textContent,'복사 완료');
});
test('saved manual copy body without link gets the same academy URL at the end',async()=>{
 const text='안녕하세요 어머님. 이번 달 정기상담을 신청해 주세요.';
 const r=await prepare(text).copy();
 assert.equal(r.copied,text+'\n\n상담 예약 링크\n'+bookingUrl);
});
test('previously embedded academy URL is never duplicated',async()=>{
 const r=await prepare('신청: '+bookingUrl).copy();
 assert.equal(r.copied.split(bookingUrl).length-1,1);
});
test('public-link failure prevents clipboard copy; no fallback to old Naver URL',async()=>{
 const r=prepare('안내문',{httpOk:false});
 await assert.rejects(r.copy(),/학원 통합 예약 링크/);
 assert.equal(r.read(),null);
});
test('changing logged-in academy before link arrives prevents clipboard copy',async()=>{
 const r=prepare('안내문',{beforeReturn:change=>change()});
 await assert.rejects(r.copy(),/로그인 학원이 변경/);
 assert.equal(r.read(),null);
});
test('bad URL from backend is rejected before copying',async()=>{
 for(const bad of ['https://booking.naver.com/another',
  'http://booking.example.org/consultation-booking.html?academy='+slug,
  'https://booking.example.org/consultation-booking.html?academy=student-identifier']){
  const r=prepare('안내문',{link:bad});
  await assert.rejects(r.copy(),/학원 예약 링크 형식/);
  assert.equal(r.read(),null);
 }
});
test('Solapi approved template body is separate; no direct URL in new default',()=>{
 assert.match(src,/const DEFAULT_BODY = '[^;]+상담 예약하기 버튼을 눌러/);
 const defaultLine=src.split('\n').find(s=>s.includes('const DEFAULT_BODY ='));
 assert.ok(!defaultLine.includes('#{예약링크}'));
 assert.ok(!defaultLine.includes('네이버'));
 // Existing stored Kakao approved template is NOT re-written by manual copy.
 assert.match(src,/async function saveManualNotice/);
 assert.match(src,/p_action:'save',p_key:key,p_body:body/);
 assert.match(src,/data-variant-body/);
});
test('mobile and PC load the same one-source copy functionality',()=>{
 for(const app of ['pc','mobile']){
  const html=fs.readFileSync(path.join(root,'apps',app,'index.html'),'utf8');
  assert.match(html,/olli-consultation-messages\.js/);
  assert.ok(require('../packages/common/'+app+'-runtime-manifest.json').files.includes('olli-consultation-messages.js'));
 }
});

test('annual recurring notice uses the new phrase and per-student possessive name',async()=>{
 const old='올해도 #{학생이름_소유격} 정기상담 기간이 돌아왔습니다^^';
 const r=await prepare('안녕하세요, 어머님 😊\\n\\n'+old,{stage:'annual:every_12',name:'김지오'}).copy();
 assert.ok(r.copied.includes('지오의 정기상담 신청 안내 입니다^^'));
 assert.ok(!r.copied.includes('올해도'));
 assert.equal(getNameValue('김하늘','possessive'),'하늘이의');
 assert.equal(getNameValue('김지오','possessive'),'지오의');
 assert.ok(src.includes('"annual:every_12": "안녕하세요, 어머님 😊\\n\\n#{학생이름_소유격} 정기상담 신청 안내 입니다^^'));
});
test('legacy notice migration does not change 1, 6, or initial 12 month messages',()=>{
 const normalize=vm.runInNewContext('(function(){\\n'+segment+'\\nreturn updateLegacyAnnualNoticeLine\\n})()', {});
 const old='올해도 #{학생이름_소유격} 정기상담 기간이 돌아왔습니다^^';
 const replacement='#{학생이름_소유격} 정기상담 신청 안내 입니다^^';
 assert.equal(normalize('annual:every_12',old),replacement);
 for(const stage of ['after_1','after_3','every_6','every_12']){
  for(const group of ['kinder','elementary']){
   assert.equal(normalize(group+':'+stage,old),old,'must not change '+group+':'+stage);
  }
 }
 assert.ok(src.includes('"kinder:after_1": "안녕하세요 어머님'));
 assert.ok(src.includes('"kinder:every_6": "안녕하세요, 어머님'));
 assert.ok(src.includes('"elementary:after_1": "안녕하세요 어머님'));
 assert.ok(src.includes('"elementary:every_6": "안녕하세요, 어머님'));
});