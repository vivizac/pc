'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const base=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(base,p),'utf8');
const js=read('packages/common/olli-booking-owner-ui.js');
const shared=read('packages/common/olli-booking-owner-ui.css');
const academy=read('apps/mobile/olli-academy-dashboard.css');
const html=read('apps/mobile/index.html');
const desktop=read('apps/pc/index.html');

test('mobile-only layout reuses academy stat card source and Work header dimensions',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const width of [375,390,430]){
   const page=await browser.newPage({viewport:{width,height:880},deviceScaleFactor:1});
   page.setDefaultTimeout(7000);
   await page.route('https://mobile-consultation.test/**',route=>route.fulfill({
     status:200,contentType:'text/html',
     body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="reference" class="recordAcademyStatGrid" style="position:absolute;left:-1000px;width:'+(width-32)+'px"><div class="recordAcademyStatCard"><div class="recordAcademyStatLabel">원생수</div><div class="recordAcademyStatBody"><div class="recordAcademyStatValue">60</div></div></div></div></body></html>'
   }));
   await page.goto('https://mobile-consultation.test/');
   await page.addStyleTag({content:academy});
   await page.addStyleTag({content:shared});
   await page.evaluate(()=>{
    document.body.style.margin='0';
    localStorage.setItem('olli_current_academy_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    localStorage.setItem('olli_account_session_token_v1','fixture-owner');
    window.OlliConsultationMessages={isOwner:()=>true};
    window.__rpcCalls=[];
    window.callOlliRpc=async(name,p)=>{
      window.__rpcCalls.push({name,p});
      if(name==='olli_booking_staff_manage')return {
        ok:true,appointments:[],settings:{weeks:[2,3],weekdays:[1,2,3,4,5],start_time:'11:00:00',end_time:'17:00:00',slot_minutes:30}
      };
      if(name==='olli_booking_staff_manual_manage'&&p.p_action==='students')return {ok:true,students:[]};
      if(name==='olli_booking_staff_manual_slots')return {ok:true,slots:[]};
      throw Error('Unexpected RPC: '+name);
    };
   });
   await page.addScriptTag({content:js});
   assert.equal(await page.evaluate(()=>window.OlliBookingDashboard.open('mobile')),true);
   const overlay=page.locator('#olliBookingMobileOverlay');
   await overlay.locator('.obmMobileStatGrid .recordAcademyStatCard').first().waitFor({state:'visible'});
   const layout=await page.evaluate(()=>{
     const overlay=document.getElementById('olliBookingMobileOverlay');
     const query=x=>overlay.querySelector(x);
     const rect=e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,centerX:r.left+r.width/2}};
     const header=query('.obmMobileHeader');
     const back=query('.obmMobileBack'),plus=query('.obmMobileAdd'),title=query('.obmMobileHeading'),tabs=query('.obmTabs');
     const cards=[...overlay.querySelectorAll('.obmMobileStatGrid .recordAcademyStatCard')];
     const reference=document.querySelector('#reference .recordAcademyStatCard');
     const label=cards[0].querySelector('.recordAcademyStatLabel');
     const refLabel=reference.querySelector('.recordAcademyStatLabel');
     const value=cards[0].querySelector('.recordAcademyStatValue');
     const refValue=reference.querySelector('.recordAcademyStatValue');
     const style=e=>getComputedStyle(e);
     return{
      background:style(overlay).backgroundColor,
      header:rect(header),back:rect(back),plus:rect(plus),title:rect(title),tabs:rect(tabs),
      count:cards.length,
      labels:cards.map(c=>c.querySelector('.recordAcademyStatLabel').textContent.trim()),
      cards:cards.map(rect),reference:rect(reference),
      statPadding:style(cards[0]).padding,refPadding:style(reference).padding,
      statRadius:style(cards[0]).borderRadius,refRadius:style(reference).borderRadius,
      labelFont:style(label).fontSize,refLabelFont:style(refLabel).fontSize,
      valueFont:style(value).fontSize,refValueFont:style(refValue).fontSize,
      valueColor:style(value).color,
      guideCount:overlay.querySelectorAll('.recordAcademyStatSub').length,
      closeCount:overlay.querySelectorAll('[data-action="close"]').length,
      refreshCount:overlay.querySelectorAll('[data-action="refresh"]').length,
      plusCount:overlay.querySelectorAll('[data-action="add-manual"]').length,
      tabLabels:[...tabs.querySelectorAll('button')].map(el=>el.textContent.trim()),
      pillRadius:style(tabs).borderRadius,
      overflows:overlay.scrollWidth>overlay.clientWidth
     };
   });
   assert.equal(layout.background,'rgb(255, 255, 255)');
   assert.equal(layout.count,4);
   assert.deepEqual(layout.labels,['이번 달 예약','오늘 상담','신규생 상담','이번 달 미예약 대상']);
   assert.equal(layout.statPadding,layout.refPadding);
   assert.equal(layout.statRadius,layout.refRadius);
   assert.equal(layout.labelFont,layout.refLabelFont);
   assert.equal(layout.valueFont,layout.refValueFont);
   assert.equal(layout.valueColor,'rgb(22, 135, 255)');
   assert.equal(layout.guideCount,0);
   assert.equal(layout.closeCount,0);
   assert.equal(layout.refreshCount,0);
   assert.equal(layout.plusCount,1);
   assert.deepEqual(layout.tabLabels,['오늘','이번 주','전체 예약','설정']);
   assert.equal(layout.pillRadius,'24px');
   assert.equal(layout.tabs.height,layout.plus.height,'parent capsule matches plus button height');
   assert.equal(layout.back.height,layout.plus.height,'header back/plus heights match');
   assert.ok(Math.abs(layout.title.centerX-width/2)<2,'title is centered on viewport');
   assert.ok(Math.abs(layout.back.top-layout.plus.top)<1,'header buttons share top baseline');
   assert.equal(layout.overflows,false);
   await overlay.locator('.obmMobileAdd').click();
   await page.getByRole('dialog',{name:'상담일정 추가'}).waitFor({state:'visible'});
   await overlay.locator('.obmModal [data-action="dismiss"]').click();
   await overlay.locator('.obmMobileBack').click();
   assert.equal(await overlay.isHidden(),true,'back closes mobile overlay');
   await page.close();
  }
 }finally{await browser.close()}
});

test('PC versions and toolbar source are preserved, mobile scripts cache-busted',()=>{
 assert.match(desktop,/olli-booking-owner-ui\.js\?v=20261102-manual-slots-search-4/);
 assert.match(desktop,/olli-booking-owner-ui\.css\?v=20261102-manual-slots-search-4/);
 assert.match(html,/olli-booking-owner-ui\.js\?v=20261102-mobile-consultation-layout-1/);
 assert.match(html,/olli-booking-owner-ui\.css\?v=20261102-mobile-consultation-layout-1/);
 assert.match(shared,/#olliConsultationBookingPanel \.obmPcToolbar/);
 assert.match(js,/state\.mode==='pc'\?'<button class="obmPcAddManual"/);
});
