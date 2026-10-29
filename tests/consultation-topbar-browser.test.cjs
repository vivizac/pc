'use strict';
// Real PC shell + consultation manager scripts in an isolated browser fixture.
// No live students, Supabase, SMS, or booking mutations.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const base=path.resolve(__dirname,'..');
const script=name=>fs.readFileSync(path.join(base,name),'utf8');
const shell=script('apps/pc/pc-shell.js');
const consultation=script('apps/pc/consultation-survey-core.js');
const shellCSS=script('apps/pc/pc-shell.css');
const consultationCSS=script('apps/pc/consultation-survey.css');
const html=[
 '<!doctype html><html lang="ko"><head><meta charset="utf-8">',
 '<style>:root{--pc-content-left:200px;--pc-topbar-h:78px;--pc-line:#e5e8eb}',
 'body{margin:0;font-family:Arial,sans-serif}.pageScreen{display:none}</style>',
 '</head><body class="olliPcApp">',
 '<div id="olliPcShell"><button data-pc-nav="academy">학생관리</button>',
 '<button data-pc-nav="consultation">상담기록</button></div>',
 '<div id="olliPcTopbar" class="olliPcTopbar">',
 '<div id="olliPcTopbarTitle" class="olliPcTopbarTitle">학생관리</div>',
 '<div class="olliPcTopbarRight"><input id="olliPcSearch"></div></div>',
 '<div id="olliPcContextTitle"></div><div id="olliPcContextBody"></div>',
 '<div id="recordRoomScreen" class="pageScreen"></div>',
 '</body></html>'
].join('');
test('consultation tabs replace the white PC topbar title, not the page body',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.route('https://olli-ui.test/**',route=>{
   if(new URL(route.request().url()).pathname==='/')return route.fulfill({status:200,contentType:'text/html',body:html});
   // The production consultation analysis module is intentionally absent in this
   // no-network fixture. Never feed HTML to a dynamically loaded JS request.
   return route.fulfill({status:200,contentType:'application/javascript',
     body:'window.OlliConsultationAnalysis={analyze:()=>({primary:[],confirm:[],axes:[],questions:[],observations:[],directions:[]})};'});
  });
  await page.goto('https://olli-ui.test/');
  await page.addStyleTag({content:shellCSS});
  await page.addStyleTag({content:consultationCSS});
  await page.addScriptTag({content:shell});
  await page.addScriptTag({content:consultation});
  // The production booking owner UI normally fills this panel. In this isolated
  // test mock only the card content, so visibility can be checked without API calls.
  await page.evaluate(()=>{
    window.OlliBookingDashboard={open:()=>{
      document.getElementById('olliConsultationBookingPanel').textContent='예약 목록';
    }};
  });
  await page.evaluate(()=>window.pcOpenSection('consultation'));

  const top='#olliPcTopbarTitle';
  const booking=page.locator(top+' [data-consultation-page-tab="booking"]');
  const survey=page.locator(top+' [data-consultation-page-tab="survey"]');
  const debug=await page.evaluate(()=>({
   title:document.getElementById('olliPcTopbarTitle')?.innerHTML,
   section:window.OlliPcCore?.state?.section,
   shell:document.getElementById('olliPcShell')?.dataset?.pcSection,
   survey:document.getElementById('consultationSurveyScreen')?.style.display,
   errors:window.__consultationDebugError||null
  }));
  assert.equal(await page.locator(top+' [role=tablist]').count(),1,'missing topbar tabs: '+JSON.stringify(debug)+' JS='+errors.join(';'));
  assert.equal(await page.locator(top+' [role=tab]').count(),2);
  assert.equal(await page.locator('#consultationSurveyScreen .consultationPageTabs').count(),0,
    'there must be no duplicate tab bar below the white title');
  assert.equal((await page.locator(top+' [role=tablist]').innerText()).replace(/\s+/g,' ').trim(),'상담예약현황 설문기록');
  assert.equal(await page.locator(top+' .olliPcBookingLinkCopy').count(),1,'copy link action belongs to PC consultation topbar');
  assert.equal(await booking.getAttribute('aria-selected'),'true');
  assert.equal(await survey.getAttribute('aria-selected'),'false');
  const bounds=await Promise.all([page.locator('#olliPcTopbar').boundingBox(),booking.boundingBox()]);
  assert.ok(bounds[1].y>=bounds[0].y && bounds[1].y+bounds[1].height<=bounds[0].y+bounds[0].height,
    'tab button must physically be within the top white bar');
  assert.equal(await page.locator('#olliConsultationBookingPanel').isVisible(),true);
  assert.equal(await page.locator('#olliConsultationSurveyPanel').isVisible(),false);

  await survey.click();
  assert.equal(await booking.getAttribute('aria-selected'),'false');
  assert.equal(await survey.getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('#olliConsultationBookingPanel').isVisible(),false);
  assert.equal(await page.locator('#olliConsultationSurveyPanel').isVisible(),true);

  await survey.press('ArrowLeft');
  assert.equal(await booking.getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('#olliConsultationBookingPanel').isVisible(),true);

  await page.evaluate(()=>window.OlliPcCore.setChrome('academy'));
  assert.equal(await page.locator('#olliPcTopbarTitle').innerText(),'학생관리');
  assert.equal(await page.locator(top+' [role=tab]').count(),0,
    'other PC sections must retain their ordinary white-bar heading');
  assert.equal(await page.locator(top+' .olliPcBookingLinkCopy').count(),0);
  await page.evaluate(()=>window.pcOpenSection('consultation'));
  assert.equal(await page.locator(top+' [role=tab]').count(),2);
  assert.equal(await booking.getAttribute('aria-selected'),'true');
  assert.ok(!errors.some(s=>/SyntaxError|ReferenceError/.test(s)),errors.join('\n'));
 }finally{await browser.close();}
});
