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
function validFutureDates(){
 const found=[];
 for(let offset=1;offset<=120&&found.length<2;offset++){
  const date=futureDate(offset);
  const [year,month,day]=date.split('-').map(Number);
  const dt=new Date(Date.UTC(year,month-1,day));
  const week=Math.floor((day-1+(new Date(Date.UTC(year,month-1,1)).getUTCDay()+6)%7)/7)+1;
  const weekday=(dt.getUTCDay()+6)%7+1;
  if([2,3].includes(week)&&weekday<=5)found.push(date);
 }
 return found;
}
for(const width of [390,1280]){
 test('choice first at '+width+'px: book, reopen page, lookup by phone, change and cancel',async()=>{
  const [date,date2]=validFutureDates();
  const first=date+'T11:00:00+09:00',second=date2+'T11:30:00+09:00';
  let current=null,requests=[],reservationSeq=0;
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try{
   const page=await browser.newPage({viewport:{width,height:850}});
   // Vercel protected previews use a same-origin authentication cookie.
   // API requests without this cookie must be rejected by the mocked preview gate.
   await page.context().addCookies([{name:'_vercel_share_session',
     value:'qa-sso-session',domain:'olli-booking.test',path:'/',secure:true,sameSite:'Lax'}]);
   const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
   await page.route('https://olli-booking.test/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.pathname==='/olli-booking-guardian.js')return route.fulfill({contentType:'application/javascript',body:js});
    if(url.pathname==='/olli-booking-guardian.css')return route.fulfill({contentType:'text/css',body:css});
    if(url.pathname==='/consultation-booking.html')return route.fulfill({contentType:'text/html',body:html});
    if(url.pathname.startsWith('/api/')){
     if(!String(req.headers().cookie||'').includes('_vercel_share_session=qa-sso-session'))
       return route.fulfill({status:401,contentType:'text/html',body:'<html>Vercel Authentication</html>'});
     const body=req.postDataJSON();requests.push({endpoint:url.pathname,...body});
     if(url.pathname==='/api/olli-booking-public'){
      if(body.action==='info')return route.fulfill({json:{ok:true,academy_name:'비비작아이성향미술학원',weeks:[2,3],weekdays:[1,2,3,4,5]}});
      if(body.action==='slots')return route.fulfill({json:{ok:true,slots:[{start_at:body.date===date?first:second}]}});
      if(body.action==='lookup'){
       if(body.guardian_phone!=='01012345678'||body.student_name!=='김하늘')
        return route.fulfill({status:400,json:{ok:false,code:'MATCH_NOT_FOUND'}});
       if(!current)return route.fulfill({status:404,json:{ok:false,code:'BOOKING_NOT_FOUND'}});
       return route.fulfill({json:{ok:true,session_token:'mock-guardian-session'}});
      }
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
   await page.getByRole('heading',{name:'상담 예약',exact:true}).waitFor();
   await page.getByText('비비작아이성향미술학원',{exact:true}).waitFor();
   assert.equal(await page.locator('input[name=student_name]').count(),0);
   assert.equal(await page.locator('.ogbCalendar').count(),0);
   assert.equal(await page.getByRole('button',{name:'기존 예약 변경하기'}).count(),1);
   // Both green controls use the same survey green, and the old eyebrow is gone.
   assert.equal(await page.locator('.ogbEyebrow').count(),0);
   assert.equal(await page.locator('.ogbTitleBand').count(),1);
   await page.getByRole('button',{name:'상담 예약하기'}).click();
   const headerGreen=await page.locator('.ogbTitleBand').evaluate(node=>getComputedStyle(node).backgroundColor);
   const buttonGreen=await page.locator('[data-action="commit"]').evaluate(node=>getComputedStyle(node).backgroundColor);
   assert.equal(headerGreen,buttonGreen,'booking title and submit button share survey green');
   assert.ok((await page.locator('.ogbMonth strong').innerText()).includes(Number(date.slice(5,7))+'월'),
     'initial calendar must show next available booking month');
   assert.equal(await page.locator('input[name=student_name]').count(),1);
   assert.equal(await page.locator('input[name=guardian_phone]').count(),1);
   assert.equal(await page.locator('input[name=otp],input[name=age],input[name=grade]').count(),0);
   assert.ok(await page.getByText('비비작 채널 알림톡을 받고 계신 휴대전화번호를 입력해 주세요.').isVisible());
   assert.equal(await page.getByText('학생 정보 확인').count(),0);
   assert.equal(await page.getByText('상담 예약하기를 누르면 올리에 등록된 학생 정보와 대조합니다.').count(),0);
   const namePosition=await page.locator('[name=student_name]').boundingBox();
   const calendarPosition=await page.locator('.ogbCalendar').boundingBox();
   assert.ok(namePosition.y<calendarPosition.y,'student name and phone must appear before calendar');
   assert.ok((await page.locator('.ogbBrand strong').innerText()).includes('비비작'));
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
   // Returning parents lost the ephemeral session, so a fresh navigation
   // must still allow them to find and change a previously saved booking.
   await page.reload();
   await page.getByRole('button',{name:'기존 예약 변경하기'}).click();
   await page.locator('[name=student_name]').fill('김하늘');
   await page.locator('[name=guardian_phone]').fill('01099999999');
   await page.getByRole('button',{name:'기존 예약 확인하기'}).click();
   await page.getByText('학생 이름 또는 보호자 휴대전화번호가 올바르지 않습니다. 다시 입력해 주세요.').waitFor();
   await page.locator('[name=guardian_phone]').fill('01012345678');
   await page.getByRole('button',{name:'기존 예약 확인하기'}).click();
   await page.getByRole('heading',{name:'상담 일정 변경'}).waitFor();
   await selectDate(date2);
   await page.locator('[data-start="'+second+'"]').click();
   await page.getByRole('button',{name:'변경 저장'}).click();
   await page.getByRole('heading',{name:'예약이 완료되었습니다'}).waitFor();
   await page.getByRole('button',{name:'예약 취소'}).click();
   await page.getByRole('heading',{name:'상담 예약',exact:true}).waitFor();
   assert.equal(current,null);
   assert.deepEqual(requests.filter(x=>['reserve','reschedule','cancel'].includes(x.action)).map(x=>x.action),
     ['reserve','reserve','reschedule','cancel']);
   assert.deepEqual(requests.filter(x=>x.action==='lookup').map(x=>x.guardian_phone),
     ['01099999999','01012345678']);
   assert.ok(!requests.some(x=>['begin','verify'].includes(x.action)));
   assert.equal(requests.find(x=>x.action==='reserve').academy,slug);
   assert.equal(await page.evaluate(()=>localStorage.length),0);
   assert.equal(await page.evaluate(()=>sessionStorage.length),0);
   assert.deepEqual(errors,[]);
   await page.close();
  }finally{await browser.close();}
 });
}
