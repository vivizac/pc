'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const source=fs.readFileSync(path.join(__dirname,'../packages/common/olli-booking-owner-ui.js'),'utf8');
function futureDate(days){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));
 return new Date(Date.UTC(+p.year,+p.month-1,+p.day+days)).toISOString().slice(0,10);
}
test('PC intake modal supports age, free text, radios and rejects occupied time without closing',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:950}});
  page.setDefaultTimeout(10000);
  const date=futureDate(2),slot=date+'T16:00:00+09:00';
  await page.route('https://olli-intake.test/**',route=>route.fulfill({
   status:200,contentType:'text/html',body:'<!doctype html><html><body><section id="olliConsultationBookingPanel"></section></body></html>'
  }));
  await page.goto('https://olli-intake.test/');
  await page.evaluate(()=>{
   localStorage.setItem('olli_current_academy_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
   localStorage.setItem('olli_account_session_token_v1','owner-session');
   window.OlliConsultationMessages={isOwner:()=>true};
   window.__calls=[];window.__alerts=[];window.__intakeSaved=false;
   window.alert=value=>window.__alerts.push(String(value));
   window.confirm=()=>true;
   window.callOlliRpc=async(name,p)=>{
    window.__calls.push({name,p});
    if(name==='olli_booking_staff_manage')return {
     ok:true,appointments:window.__intakeSaved?[{
      id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',name:'김지오',
      kind:'intake',visit_type:'trial',age_years:6,
      start_at:window.__savedSlot,end_at:window.__savedSlot,status:'confirmed'
     }]:[],settings:{}
    };
    if(name==='olli_booking_staff_manual_slots')return {ok:true,slots:[{start_at:p.p_date+'T16:00:00+09:00'}]};
    if(name==='olli_booking_staff_intake_create'){
     if(window.__intakeSaved)throw new Error('SLOT_NOT_AVAILABLE');
     window.__intakeSaved=true;window.__savedSlot=p.p_start_at;
     return {ok:true,reservation_id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'};
    }
    throw new Error('Unexpected RPC '+name);
   };
  });
  await page.addScriptTag({content:source});
  await page.evaluate(()=>window.OlliBookingDashboard.open('pc'));
  await page.locator('[data-action="add-intake"]').click();
  const modal=page.getByRole('dialog',{name:'신규 상담'});
  await modal.waitFor({state:'visible'});
  assert.equal(await modal.locator('[data-manual-search]').count(),0);
  assert.equal(await modal.locator('[type=tel]').count(),0);
  assert.equal(await modal.locator('[name=obmIntakeType]').count(),2);
  assert.equal(await modal.locator('[name=obmIntakeType]:checked').inputValue(),'consultation');
  await modal.locator('[data-action="save-intake"]').click();
  assert.equal(await page.evaluate(()=>window.__alerts.at(-1)),'아이 이름을 입력해 주세요.');
  assert.equal(await modal.count(),1);
  await modal.locator('[data-intake-name]').fill('김지오');
  await modal.locator('[data-intake-age]').fill('6');
  await modal.locator('[name=obmIntakeType][value=trial]').check();
  await modal.locator('[data-slot-date]').fill(date);
  await modal.locator('[data-slot-time]').selectOption(slot);
  await modal.locator('[data-action="save-intake"]').click();
  await page.waitForFunction(()=>window.__intakeSaved===true);
  const sent=await page.evaluate(()=>window.__calls.find(x=>x.name==='olli_booking_staff_intake_create')?.p);
  assert.equal(sent.p_student_id,undefined);
  assert.equal(sent.p_child_name,'김지오');
  assert.equal(sent.p_age_years,6);
  assert.equal(sent.p_visit_type,'trial');
  assert.equal(sent.p_start_at,slot);
  await page.waitForFunction(()=>window.__alerts.includes('체험수업 일정을 추가했습니다.'));
  assert.equal(await modal.count(),0,'successful server save closes via refreshed list');
  assert.match(await page.locator('#olliConsultationBookingPanel').innerText(),/체험/);

  await page.locator('[data-action="add-intake"]').click();
  await modal.locator('[data-intake-name]').fill('박하늘');
  await modal.locator('[data-intake-age]').fill('7');
  await modal.locator('[data-slot-date]').fill(date);
  await modal.locator('[data-slot-time]').selectOption(slot);
  await modal.locator('[data-action="save-intake"]').click();
  await page.waitForFunction(()=>window.__alerts.some(t=>t.includes('선택한 시간이 이미 예약되었습니다')));
  assert.equal(await modal.count(),1,'collision leaves unsaved form intact');
  assert.equal(await modal.locator('[data-intake-name]').inputValue(),'박하늘');
  assert.equal(await modal.locator('[data-intake-age]').inputValue(),'7');
  await modal.locator('[data-action="dismiss"]').click();
  assert.equal(await modal.count(),0);
 }finally{await browser.close();}
});
