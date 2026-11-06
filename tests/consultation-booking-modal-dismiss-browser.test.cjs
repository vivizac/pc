'use strict';
// Real Chromium click regression. RPC, booking data, auth and dialogs are mocked;
// no live Supabase queries, records, SMS or deployment interactions.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const source=fs.readFileSync(path.join(__dirname,'..','packages/common/olli-booking-owner-ui.js'),'utf8');

function futureKstDate(days){
 const today=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
  timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'
 }).formatToParts(new Date()).map(x=>[x.type,x.value]));
 const base=new Date(Date.UTC(+today.year,+today.month-1,+today.day+days));
 return base.toISOString().slice(0,10);
}

for(const mode of ['pc','mobile']){
 test('manual appointment dialog in '+mode+' keeps inputs open, saves, and explicitly closes',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
   const page=await browser.newPage({viewport:{width:mode==='pc'?1280:390,height:900}});
   page.setDefaultTimeout(7000);
   const date=futureKstDate(2);
   const slot=date+'T16:00:00+09:00';
   const calls=[],notices=[];
   page.on('pageerror',e=>{throw e;});
   await page.route('https://olli-dialog.test/**',route=>route.fulfill({
    status:200,contentType:'text/html',body:'<!DOCTYPE html><html><body><section id="olliConsultationBookingPanel"></section></body></html>'
   }));
   await page.goto('https://olli-dialog.test/');
   await page.evaluate(()=>{
    localStorage.setItem('olli_current_academy_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    localStorage.setItem('olli_account_session_token_v1','fixture-owner');
    window.OlliConsultationMessages={isOwner:()=>true};
    window.__calls=[];
    window.__notices=[];
    window.alert=message=>{window.__notices.push(String(message));};
    window.confirm=()=>true;
    window.callOlliRpc=async(name,params)=>{
     window.__calls.push({name,params});
     if(name==='olli_booking_staff_manage')return {ok:true,appointments:[],settings:{}};
     if(name==='olli_booking_staff_manual_manage'){
      if(params.p_action==='students')return {ok:true,students:[
       {id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name:'테스트 학생',school:'한샘초',grade:'2학년'},
       {id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',name:'다른 학생',school:'달서초',grade:'1학년'}
      ]};
      if(params.p_action==='create')return {ok:true,reservation_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'};
     }
     if(name==='olli_booking_staff_manual_slots')return {ok:true,slots:[{start_at:params.p_date+'T16:00:00+09:00'}]};
     throw Error('Unexpected mock RPC: '+name);
    };
   });
   await page.addScriptTag({content:source});
   await page.evaluate(mode=>window.OlliBookingDashboard.open(mode),mode);
   await page.locator('[data-action="add-manual"]').waitFor({state:'visible'});
   await page.locator('[data-action="add-manual"]').click();
   const dialog=page.getByRole('dialog',{name:mode==='pc'?'재원생 상담':'상담일정 추가'});
   await dialog.waitFor({state:'visible'});
   await page.locator('[data-slot-time] option[value*="T"]').first().waitFor({state:'attached'});
   // Regression: clicking inside the modal MUST NOT be interpreted as a backdrop click.
   await dialog.locator('label').first().click();
   assert.equal(await dialog.count(),1,'the student label must not close the dialog');
   await page.locator('[data-manual-search]').click();
   assert.equal(await dialog.count(),1,'opening the student search must not close it');
   await page.locator('[data-slot-date]').click();
   assert.equal(await dialog.count(),1,'opening the date picker must not close it');
   await page.locator('[data-slot-time]').click();
   assert.equal(await dialog.count(),1,'opening the time selector must not close it');
   await page.locator('[data-action="save-manual"]').click();
   assert.equal(await dialog.count(),1,'incomplete form must remain open');
   assert.equal(await page.evaluate(()=>window.__notices.at(-1)),'학생과 상담 시간을 모두 선택해 주세요.');
   await page.locator('[data-manual-search]').fill('테스');
   assert.equal(await page.locator('[data-action="pick-manual-student"]').count(),1,'partial name filters results');
   await page.locator('[data-action="pick-manual-student"]').click();
   assert.equal(await page.locator('[data-manual-student]').inputValue(),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
   await page.locator('[data-manual-search]').fill('다른');
   assert.equal(await page.locator('[data-manual-student]').inputValue(),'','editing name clears selected ID');
   await page.locator('[data-action="pick-manual-student"]').click();
   assert.equal(await page.locator('[data-manual-student]').inputValue(),'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
   await page.locator('[data-manual-search]').fill('테스');
   await page.locator('[data-action="pick-manual-student"]').click();
   await page.locator('[data-slot-date]').fill(date);
   await page.waitForFunction(date=>window.__calls.some(c=>c.name==='olli_booking_staff_manual_slots'&&c.params.p_date===date),date);
   await page.locator('[data-slot-time]').selectOption(slot);
   assert.equal(await dialog.count(),1,'date and time choices leave the modal open');
   await page.locator('[data-action="save-manual"]').click();
   await page.waitForFunction(()=>window.__calls.some(c=>c.name==='olli_booking_staff_manual_manage'&&c.params.p_action==='create'));
   assert.equal(await page.evaluate(()=>window.__notices.at(-1)),'상담일정을 추가했습니다.');
   const create=await page.evaluate(()=>window.__calls.find(c=>c.name==='olli_booking_staff_manual_manage'&&c.params.p_action==='create'));
   assert.equal(create.params.p_student_id,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
   assert.equal(create.params.p_start_at,slot);
   // Close button is still explicit and functional.
   await page.locator('[data-action="add-manual"]').click();
   await dialog.waitFor({state:'visible'});
   await page.locator('.obmModal [data-action="dismiss"]').click();
   assert.equal(await dialog.count(),0,'Close button must dismiss');
   // Click within blank modal area does not dismiss; click on backdrop does.
   await page.locator('[data-action="add-manual"]').click();
   await dialog.waitFor({state:'visible'});
   await dialog.locator('h3').click();
   assert.equal(await dialog.count(),1,'clicking dialog header must not dismiss');
   await page.locator('.obmModalBackdrop').evaluate(e=>e.click());
   assert.equal(await dialog.count(),0,'direct backdrop click must dismiss');
   assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c.name==='olli_booking_staff_manual_manage'&&c.params.p_action==='create').length),1);
   await page.close();
  }finally{await browser.close();}
 });
}
