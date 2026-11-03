'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const booking=read('packages/common/olli-booking-owner-ui.js');
const bookingCss=read('packages/common/olli-booking-owner-ui.css');
const academyCss=read('apps/mobile/olli-academy-dashboard.css');
const realtime=read('packages/common/olli-realtime-common.js');
const migration=read('supabase/migrations/20261103125500_olli_booking_realtime_notification.sql');
const html=read('apps/mobile/index.html');

test('mobile consultation shows local records synchronously, tabs after stats, and updates from server signals',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const width of [375,390,430]){
   const page=await browser.newPage({viewport:{width,height:880},deviceScaleFactor:1});
   page.setDefaultTimeout(9000);
   await page.route('https://owner-consultation.test/**',route=>route.fulfill({
     status:200,contentType:'text/html',
     body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>'
   }));
   await page.goto('https://owner-consultation.test/');
   await page.addStyleTag({content:academyCss});
   await page.addStyleTag({content:bookingCss});
   await page.evaluate(()=>{
     document.body.style.margin='0';
     const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
       timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'
     }).formatToParts(new Date()).map(x=>[x.type,x.value]));
     const day=parts.year+'-'+parts.month+'-'+parts.day;
     const month=day.slice(0,7);
     const academyId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
     const settings={
       weeks:[2,3],weekdays:[1,2,3,4,5],start_time:'11:00:00',
       end_time:'17:00:00',slot_minutes:30,revision:1
     };
     const makeRow=(name,kind,hour,index)=>({
       id:'11111111-1111-4111-8111-'+String(index).padStart(12,'0'),
       student_id:'22222222-2222-4222-8222-'+String(index).padStart(12,'0'),
       name,kind,status:'confirmed',start_at:day+'T'+hour+':00:00+09:00',
       end_at:day+'T'+hour+':30:00+09:00'
     });
     window.__fixture={day,month,academyId,settings,makeRow};
     const cached=makeRow('저장된학생','regular','10',1);
     localStorage.setItem('olli_current_academy_id',academyId);
     localStorage.setItem('olli_account_session_token_v1','fixture-owner');
     localStorage.setItem('olli_booking_owner_month_snapshot_v1:'+academyId+':'+month,
       JSON.stringify({version:1,academyId,month,rows:[cached],settings,savedAt:Date.now()}));
     window.OlliConsultationMessages={isOwner:()=>true};
     window.__holdRequest=true;
     window.__requests=0;
     window.__serverRows=[makeRow('갱신된학생','intake','11',2),makeRow('새로운학생','regular','12',3)];
     window.OlliRealtime={
       watchDomain(domain,fn){window.__watcher={domain,fn};return{dispose(){}};}
     };
     window.callOlliRpc=async(name,params)=>{
       if(name!=='olli_booking_staff_manage')throw Error('Unexpected RPC '+name);
       window.__requests++;
       if(window.__holdRequest){
         await new Promise(resolve=>{window.__releaseRequest=resolve});
       }
       if(window.__networkError)throw Error('offline');
       if(params.p_academy_id!==window.__fixture.academyId)throw Error('Wrong tenant');
       return {ok:true,appointments:window.__serverRows,settings:window.__fixture.settings};
     };
   });
   await page.addScriptTag({content:booking});
   await page.evaluate(()=>window.OlliBookingDashboard.open('mobile'));
   const overlay=page.locator('#olliBookingMobileOverlay');
   // First paint is based on localStorage while the new request is unresolved.
   const immediate=await page.evaluate(()=>{
     const el=document.querySelector('#olliBookingMobileOverlay');
     const stats=el.querySelector('.obmMobileStatGrid').getBoundingClientRect();
     const tabs=el.querySelector('.obmTabs').getBoundingClientRect();
     return {
       visible:!el.hidden,
       hasSaved:el.textContent.includes('저장된학생'),
       hasNew:el.textContent.includes('갱신된학생'),
       statsBottom:stats.bottom,tabsTop:tabs.top,
       count:el.querySelector('.recordAcademyStatValue')?.textContent.trim(),
       loadingMessage:el.querySelector('.obmSyncStatus')?.textContent.trim(),
       requestCount:window.__requests,
       currentTab:el.querySelector('.obmTabs .active')?.textContent.trim(),
       watcher:window.__watcher?.domain
     };
   });
   assert.equal(immediate.visible,true,'page becomes visible synchronously');
   assert.equal(immediate.hasSaved,true,'last confirmed local snapshot paints before RPC');
   assert.equal(immediate.hasNew,false);
   assert.ok(immediate.statsBottom<immediate.tabsTop,'capsule is beneath all stat cards');
   assert.equal(immediate.count,'1');
   assert.match(immediate.loadingMessage,/저장된 상담 데이터를 표시 중/);
   assert.equal(immediate.currentTab,'오늘');
   assert.equal(immediate.watcher,'booking');
   assert.ok(immediate.requestCount>=1);
   await page.evaluate(()=>{window.__holdRequest=false;window.__releaseRequest();});
   await overlay.getByText('갱신된학생').waitFor({state:'visible'});
   assert.equal(await overlay.locator('.obmRow').count(),2);
   assert.equal(await overlay.locator('.obmMobileStatGrid .recordAcademyStatValue').first().textContent(),'2');
   assert.equal(await overlay.getByText('저장된학생').count(),0,'server data replaces saved snapshot');

   // A subsequent database signal schedules another server read, not a row merge.
   await page.evaluate(async()=>{
     const f=window.__fixture;
     window.__serverRows.push(f.makeRow('실시간추가학생','intake','13',4));
     await window.__watcher.fn({academyId:f.academyId,isCurrent:()=>true});
   });
   await overlay.getByText('실시간추가학생').waitFor({state:'visible'});
   assert.equal(await overlay.locator('.obmRow').count(),3);
   assert.equal(await overlay.locator('.obmMobileStatGrid .recordAcademyStatValue').first().textContent(),'3');
   // Failed online refresh must not destroy the last server-confirmed snapshot.
   await page.evaluate(async()=>{
     window.__networkError=true;
     await window.OlliBookingDashboard.refresh();
   });
   assert.equal(await overlay.locator('.obmRow').count(),3,'offline failure preserves local records');
   assert.equal(await overlay.getByText('실시간추가학생').count(),1);
   // Close/open draws the updated cached rows even before the next request finishes.
   await page.evaluate(()=>{
     window.OlliBookingDashboard.close();
     window.__networkError=false;
     window.__holdRequest=true;
     window.OlliBookingDashboard.open('mobile');
   });
   assert.equal(await overlay.locator('.obmRow').count(),3,'reopen is instantly local-first');
   await page.evaluate(()=>{window.__holdRequest=false;window.__releaseRequest?.();});
   // Another academy can never see this academy's cached student records.
   await page.evaluate(()=>{
     localStorage.setItem('olli_current_academy_id','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
     window.dispatchEvent(new CustomEvent('olli:realtime-status',{
       detail:{status:'SUBSCRIBED',academyId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}
     }));
   });
   await page.waitForFunction(()=>!document.getElementById('olliBookingMobileOverlay')?.textContent.includes('실시간추가학생'));
   assert.equal(await overlay.getByText('실시간추가학생').count(),0,'tenant switch clears old snapshot');
   await page.close();
  }
 }finally{await browser.close();}
});

test('isolated realtime signal carries no booking PII and existing domains remain enabled',()=>{
 assert.match(realtime,/VALID_DOMAINS = new Set\(\['observation', 'schedule', 'chat', 'booking'\]\)/);
 assert.match(migration,/after insert or update of status,start_at,end_at,student_id,intake_id,academy_id or delete/i);
 assert.match(migration,/realtime\.send\(/);
 assert.match(migration,/'domain','booking'/);
 assert.match(migration,/private\.olli_realtime_topic_for_academy/);
 assert.doesNotMatch(migration,/to_jsonb\(new\)|to_jsonb\(old\)|new\.name|new\.student_name/);
 assert.match(html,/olli-booking-owner-ui\.js\?v=20261103-local-first-realtime-1/);
 assert.match(html,/olli-booking-owner-ui\.css\?v=20261103-local-first-realtime-1/);
});
