'use strict';
// UI-only Chromium regression: all RPCs and student data are test fixtures.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const source=fs.readFileSync(path.join(__dirname,'..','packages/common/olli-booking-owner-ui.js'),'utf8');
const styles=fs.readFileSync(path.join(__dirname,'..','packages/common/olli-booking-owner-ui.css'),'utf8');

function kstDay(days){
 const d=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
  timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'
 }).formatToParts(new Date()).map(x=>[x.type,x.value]));
 return new Date(Date.UTC(+d.year,+d.month-1,+d.day+days)).toISOString().slice(0,10);
}

for(const mode of ['pc','mobile']){
 test(mode+' reschedule uses owner slots and mobile date stays inside dialog',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
   const page=await browser.newPage({viewport:{width:mode==='pc'?1280:375,height:800}});
   const date=kstDay(2);
   const oldStart=date+'T15:00:00+09:00';
   const newStart=date+'T17:30:00+09:00';
   const errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://olli-reschedule.test/**',route=>route.fulfill({
    status:200,contentType:'text/html',
    body:'<!DOCTYPE html><html><body><section id="olliConsultationBookingPanel"></section></body></html>'
   }));
   await page.goto('https://olli-reschedule.test/');
   await page.evaluate(({oldStart})=>{
    localStorage.setItem('olli_current_academy_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    localStorage.setItem('olli_account_session_token_v1','fixture-owner');
    window.OlliConsultationMessages={isOwner:()=>true};
    window.confirm=()=>true;
    window.alert=()=>{};
    window.__calls=[];
    window.callOlliRpc=async(name,args)=>{
     window.__calls.push({name,args});
     if(name==='olli_booking_staff_manage'){
      if(args.p_action==='reschedule')return {ok:true,reservation_id:args.p_reservation_id};
      return {ok:true,appointments:[{
       id:'33333333-3333-4333-8333-333333333333',name:'상담 학생',
       status:'confirmed',kind:'student',student_id:'22222222-2222-4222-8222-222222222222',
       start_at:oldStart,end_at:oldStart
      }],settings:{weeks:[2],weekdays:[1],start_time:'10:00',end_time:'17:00',
       slot_minutes:30,revision:1}};
     }
     if(name==='olli_booking_staff_manual_slots')return {ok:true,slots:[
      {start_at:args.p_date+'T17:30:00+09:00',
       end_at:args.p_date+'T18:00:00+09:00'}
     ]};
     if(name==='olli_booking_list_slots')return {ok:true,slots:[]};
     throw Error('Unexpected RPC '+name);
    };
   },{oldStart});
   await page.addStyleTag({content:styles});
   await page.addScriptTag({content:source});
   await page.evaluate(mode=>window.OlliBookingDashboard.open(mode),mode);
   if(mode==='pc')await page.locator('[data-view="list"]').click();
   else await page.locator('[data-view="list"]').click();
   await page.locator('[data-action="edit"]').first().click();
   const dialog=page.getByRole('dialog',{name:'상담 일정 변경'});
   await dialog.waitFor({state:'visible'});
   await page.locator('[data-slot-time] option[value*="T17:30"]').waitFor({state:'attached'});
   assert.equal(await page.locator('[data-slot-date]').inputValue(),date);
   const calls=await page.evaluate(()=>window.__calls);
   assert.ok(calls.some(c=>c.name==='olli_booking_staff_manual_slots'&&c.args.p_date===date));
   assert.equal(calls.filter(c=>c.name==='olli_booking_list_slots').length,0,
    'reschedule must not use the parent-only slot restrictions');
   const fits=await page.locator('[data-slot-date]').evaluate(input=>{
    const a=input.getBoundingClientRect();
    const m=input.closest('.obmModal').getBoundingClientRect();
    return a.left>=m.left-1&&a.right<=m.right+1&&a.width>0;
   });
   assert.equal(fits,true,'date input must remain inside modal');
   await page.locator('[data-slot-date]').fill(kstDay(3));
   await page.locator('[data-slot-time] option[value*="T17:30"]').waitFor({state:'attached'});
   await page.locator('[data-slot-time]').selectOption(kstDay(3)+'T17:30:00+09:00');
   await page.locator('[data-action="save-reschedule"]').click();
   await page.waitForFunction(()=>window.__calls.some(c=>
    c.name==='olli_booking_staff_manage'&&c.args.p_action==='reschedule'));
   const saved=await page.evaluate(()=>window.__calls.find(c=>
    c.name==='olli_booking_staff_manage'&&c.args.p_action==='reschedule'));
   assert.equal(saved.args.p_start_at,kstDay(3)+'T17:30:00+09:00');
   assert.deepEqual(errors,[]);
  }finally{await browser.close();}
 });
}
