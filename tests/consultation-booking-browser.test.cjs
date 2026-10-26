'use strict';
// UI-only browser exercise. Every HTTP/API response is intercepted. NO real DB, SMS or credentials.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'apps/pc/consultation-booking.html'),'utf8');
const js=fs.readFileSync(path.join(root,'packages/common/olli-booking-guardian.js'),'utf8');
const css=fs.readFileSync(path.join(root,'packages/common/olli-booking-guardian.css'),'utf8');
const slug='0123456789abcdef0123456789abcdef0123';
function futureDate(days){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const map=Object.fromEntries(parts.map(x=>[x.type,x.value]));
 const d=new Date(Date.UTC(+map.year,+map.month-1,+map.day+days));
 return d.toISOString().slice(0,10);
}
for(const width of [390,1280]){
 test('guardian browser flow on '+width+'px: guardian OTP, reserve, reschedule, cancel, no persistence',async()=>{
  const date=futureDate(7),date2=futureDate(8);
  const first=date+'T11:00:00+09:00',second=date2+'T11:30:00+09:00';
  let current=null,requests=[],reservationSeq=0;
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try{
   const page=await browser.newPage({viewport:{width,height:850}});
   const errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   page.on('dialog',d=>d.accept());
   await page.route('https://olli-booking.test/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.pathname==='/olli-booking-guardian.js')
     return route.fulfill({status:200,contentType:'application/javascript',body:js});
    if(url.pathname==='/olli-booking-guardian.css')
     return route.fulfill({status:200,contentType:'text/css',body:css});
    if(url.pathname==='/consultation-booking.html')
     return route.fulfill({status:200,contentType:'text/html',body:html});
    if(url.pathname.startsWith('/api/')){
     const body=req.postDataJSON();requests.push({pathname:url.pathname,...body});
     if(url.pathname==='/api/olli-booking-public'){
      if(body.action==='begin')return route.fulfill({json:{ok:true,challenge_id:'11111111-1111-4111-8111-111111111111'}});
      if(body.action==='verify'){
       if(body.code!=='123456')return route.fulfill({status:401,json:{ok:false,code:'OTP_INVALID'}});
       return route.fulfill({json:{ok:true,session_token:'mock-only-session',expires_in_seconds:2700}});
      }
     }
     if(url.pathname==='/api/olli-booking'){
      if(body.token!=='mock-only-session')return route.fulfill({status:403,json:{ok:false,code:'ACCESS_DENIED'}});
      if(body.action==='snapshot')return route.fulfill({json:{ok:true,reservation:current,can_reschedule:true,can_cancel:true}});
      if(body.action==='slots')return route.fulfill({json:{ok:true,slots:[{start_at:body.date===date?first:second}]}});
      if(body.action==='reserve'||body.action==='reschedule'){
       current={id:'reservation-'+(++reservationSeq),start_at:body.start_at};
       return route.fulfill({json:{ok:true,reservation:current}});
      }
      if(body.action==='cancel'){current=null;return route.fulfill({json:{ok:true}});}
     }
     return route.fulfill({status:400,json:{ok:false,code:'INVALID_ACTION'}});
    }
    return route.fulfill({status:404,body:'not found'});
   });
   await page.goto('https://olli-booking.test/consultation-booking.html?academy='+slug);
   assert.ok(await page.getByRole('heading',{name:'학생 정보를 확인할게요'}).isVisible());
   assert.ok(await page.getByText('비비작 채널 알림톡을 받고 계신 휴대전화번호를 입력해 주세요.',{exact:false}).isVisible());
   assert.equal(await page.locator('[name=age],[name=grade],[name=division]').count(),0);
   const bounds=await page.locator('.ogbPanel').boundingBox();
   assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1,'panel should fit viewport');
   await page.locator('[name=student_name]').fill('김하늘');
   await page.locator('[name=guardian_phone]').fill('01012345678');
   await page.getByRole('button',{name:'인증번호 받기'}).click();
   await page.locator('[name=otp]').fill('111111');
   await page.getByRole('button',{name:'본인 확인'}).click();
   assert.ok(await page.getByText('인증번호가 올바르지 않거나 만료되었습니다.',{exact:false}).isVisible());
   await page.locator('[name=otp]').fill('123456');
   await page.getByRole('button',{name:'본인 확인'}).click();
   assert.ok(await page.getByRole('heading',{name:'상담 날짜를 골라 주세요'}).isVisible());
   async function selectDate(d){
    const visibleMonth=await page.locator('.ogbMonth strong').innerText();
    if(!visibleMonth.includes(Number(d.slice(5,7))+'월')) await page.getByRole('button',{name:'다음 달'}).click();
    await page.locator('[data-date="'+d+'"]').click();
   }
   await selectDate(date);
   await page.locator('[data-start="'+first+'"]').click();
   await page.getByRole('button',{name:'상담 예약하기'}).click();
   assert.ok(await page.getByRole('heading',{name:'예약이 완료되었습니다'}).isVisible());
   assert.ok(await page.getByText('현재 예약').isVisible());
   await page.getByRole('button',{name:'예약 변경'}).click();
   await selectDate(date2);
   await page.locator('[data-start="'+second+'"]').click();
   await page.getByRole('button',{name:'변경 저장'}).click();
   assert.ok(await page.getByRole('heading',{name:'예약이 완료되었습니다'}).isVisible());
   await page.getByRole('button',{name:'예약 취소'}).click();
   assert.ok(await page.getByRole('heading',{name:'상담 날짜를 골라 주세요'}).isVisible());
   assert.equal(current,null);
   assert.deepEqual(requests.filter(x=>['reserve','reschedule','cancel'].includes(x.action)).map(x=>x.action),
     ['reserve','reschedule','cancel']);
   assert.equal(requests.find(x=>x.action==='begin').guardian_phone,'01012345678');
   assert.equal(requests.find(x=>x.action==='begin').academy,slug);
   assert.equal(await page.evaluate(()=>localStorage.length),0);
   assert.equal(await page.evaluate(()=>sessionStorage.length),0);
   assert.deepEqual(errors,[]);
   await page.close();
  }finally{await browser.close();}
 });
}
