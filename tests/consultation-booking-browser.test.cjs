'use strict';
// Browser UI E2E with entirely mocked API. No SMS, DB or real guardian data.
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
 return new Date(Date.UTC(+map.year,+map.month-1,+map.day+days)).toISOString().slice(0,10);
}
for(const width of [390,1280]){
 test('calendar first at '+width+'px: validate identity on reserve, mismatch retry, change and cancel',async()=>{
  const date=futureDate(7),date2=futureDate(8);
  const first=date+'T11:00:00+09:00',second=date2+'T11:30:00+09:00';
  let current=null,requests=[],reservationSeq=0;
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try{
   const page=await browser.newPage({viewport:{width,height:850}});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
   await page.route('https://olli-booking.test/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.pathname==='/olli-booking-guardian.js')return route.fulfill({contentType:'application/javascript',body:js});
    if(url.pathname==='/olli-booking-guardian.css')return route.fulfill({contentType:'text/css',body:css});
    if(url.pathname==='/consultation-booking.html')return route.fulfill({contentType:'text/html',body:html});
    if(url.pathname.startsWith('/api/')){
     const body=req.postDataJSON();requests.push({endpoint:url.pathname,...body});
     if(url.pathname==='/api/olli-booking-public'){
      if(body.action==='slots')return route.fulfill({json:{ok:true,slots:[{start_at:body.date===date?first:second}]}});
      if(body.action==='reserve'){
       if(body.guardian_phone!=='01012345678'||body.student_name!=='김하늘')
        return route.fulfill({status:400,json:{ok:false,code:'MATCH_NOT_FOUND'}});
       current={id:'22222222-2222-4222-8222-222222222222',start_at:body.start_at};
       return route.fulfill({json:{ok:true,session_token:'mock-guardian-session',existing:false}});
      }
      return route.fulfill({status:400,json:{ok:false,code:'INVALID_ACTION'}});
     }
     if(body.token!=='mock-guardian-session')return route.fulfill({status:403,json:{ok:false,code:'ACCESS_DENIED'}});
     if(body.action==='snapshot')return route.fulfill({json:{ok:true,reservation:current,can_reschedule:true,can_cancel:true}});
     if(body.action==='slots')return route.fulfill({json:{ok:true,slots:[{start_at:body.date===date?first:second}]}});
     if(body.action==='reschedule'){current={...current,start_at:body.start_at};return route.fulfill({json:{ok:true}});}
     if(body.action==='cancel'){current=null;return route.fulfill({json:{ok:true}});}
     return route.fulfill({status:400,json:{ok:false,code:'INVALID_ACTION'}});
    }
    return route.fulfill({status:404,body:'not found'});
   });
   await page.goto('https://olli-booking.test/consultation-booking.html?academy='+slug);
   await page.getByRole('heading',{name:'상담 날짜를 골라 주세요'}).waitFor();
   assert.equal(await page.locator('input[name=student_name]').count(),1);
   assert.equal(await page.locator('input[name=guardian_phone]').count(),1);
   assert.equal(await page.locator('input[name=otp],input[name=age],input[name=grade]').count(),0);
   assert.ok(await page.getByText('비비작 채널 알림톡을 받고 계신 휴대전화번호를 입력해 주세요.').isVisible());
   const bounds=await page.locator('.ogbPanel').boundingBox();
   assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1);
   await page.locator('[name=student_name]').fill('김하늘');
   await page.locator('[name=guardian_phone]').fill('01000000000');
   async function selectDate(d){
    const month=await page.locator('.ogbMonth strong').innerText();
    if(!month.includes(Number(d.slice(5,7))+'월'))await page.getByRole('button',{name:'다음 달'}).click();
    await page.locator('[data-date="'+d+'"]').click();
   }
   await selectDate(date);
   await page.locator('[data-start="'+first+'"]').click();
   assert.equal(requests.some(x=>x.action==='reserve'),false,'matching must not happen on date click');
   await page.getByRole('button',{name:'상담 예약하기'}).click();
   await page.getByText('학생 이름 또는 보호자 휴대전화번호가 올바르지 않습니다. 다시 입력해 주세요.').waitFor();
   assert.equal(current,null);
   await page.locator('[name=guardian_phone]').fill('01012345678');
   await page.getByRole('button',{name:'상담 예약하기'}).click();
   await page.getByRole('heading',{name:'예약이 완료되었습니다'}).waitFor();
   assert.ok(await page.getByText('현재 예약').isVisible());
   await page.getByRole('button',{name:'예약 변경'}).click();
   await selectDate(date2);
   await page.locator('[data-start="'+second+'"]').click();
   await page.getByRole('button',{name:'변경 저장'}).click();
   await page.getByRole('heading',{name:'예약이 완료되었습니다'}).waitFor();
   await page.getByRole('button',{name:'예약 취소'}).click();
   await page.getByRole('heading',{name:'상담 날짜를 골라 주세요'}).waitFor();
   assert.equal(current,null);
   assert.deepEqual(requests.filter(x=>['reserve','reschedule','cancel'].includes(x.action)).map(x=>x.action),
     ['reserve','reserve','reschedule','cancel']);
   assert.ok(!requests.some(x=>['begin','verify'].includes(x.action)));
   assert.equal(requests.find(x=>x.action==='reserve').academy,slug);
   assert.equal(await page.evaluate(()=>localStorage.length),0);
   assert.equal(await page.evaluate(()=>sessionStorage.length),0);
   assert.deepEqual(errors,[]);
   await page.close();
  }finally{await browser.close();}
 });
}
