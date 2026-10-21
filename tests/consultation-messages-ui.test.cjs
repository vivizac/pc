'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const js=fs.readFileSync(path.join(__dirname,'../packages/common/olli-consultation-messages.js'),'utf8');
let css=fs.readFileSync(path.join(__dirname,'../packages/common/olli-consultation-messages.css'),'utf8');
if(process.env.OLLI_TEST_FONT_PATH)css+="@font-face{font-family:OlliTest;src:url(data:font/otf;base64,"+fs.readFileSync(process.env.OLLI_TEST_FONT_PATH).toString('base64')+")}body{font-family:OlliTest,sans-serif}";
const fixture={ok:true,settings:{enabled:false,booking_url:'',channel_id:'',template_id:'',template_body:'',template_confirmed:false},students:[{id:'student',name:'김테스트',division:'kinder',phone:null,enabled:null,confirmed:null}],deliveries:[]};
test('PC/mobile settings, read-only recipients, context isolation and Naver message layout',async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.OLLI_CHROMIUM_PATH ? {executablePath:process.env.OLLI_CHROMIUM_PATH} : {}),args:['--no-sandbox']});
 try{
  for(const width of [1280,390]){
   const page=await browser.newPage({viewport:{width,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://olli.test/**',async route=>{
    if(route.request().url().includes('/api/'))return route.fulfill({json:{ok:true,configured:true,counts:{submitted:1}}});
    return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><style>'+css+'</style>'});
   });
   await page.goto('https://olli.test');await page.evaluate(()=>document.fonts.ready);
   await page.evaluate(data=>{
    window.fixture=data;window.calls=[];
    localStorage.setItem('olli_current_academy_id','academy');localStorage.setItem('olli_account_session_token_v1','owner-session');localStorage.setItem('olli_current_member_role','owner');
    window.getOlliCurrentRole=()=>localStorage.getItem('olli_current_member_role');
    window.callOlliRpc=async(name,args)=>{
     window.calls.push({name,args});
     if(args.p_action==='settings')window.fixture.settings=args.p_data;
     if(args.p_action==='disable')window.fixture.settings.enabled=false;
     if(args.p_action==='contact')Object.assign(window.fixture.students[0],args.p_data);
     return structuredClone(window.fixture);
    };
   },fixture);
   await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../packages/common/olli-consultation-message-templates.js'),'utf8')});await page.addScriptTag({content:js});await page.evaluate(()=>OlliConsultationMessages.open());
   await page.locator('[data-connection]').filter({hasText:'현재 사용하지 않습니다'}).waitFor();
   assert.equal(await page.getByRole('switch',{name:'상담 안내 문자 사용'}).isChecked(),false);
   assert.equal(await page.locator('dialog').count(),1);
   const bounds=await page.locator('dialog').boundingBox();assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width);
   await page.locator('[name=booking_url]').fill('https://booking.naver.com/booking/13/bizes/123');
   await page.locator('[name=channel_id]').fill('KA01PF');await page.locator('[name=template_id]').fill('KA01TP');
   await page.locator('[name=template_confirmed]').check();await page.locator('[name=template_body]').fill('#{학생명}\n#{예약링크}');assert.equal(await page.locator('[name=template_confirmed]').isChecked(),false);
   await page.locator('[name=template_confirmed]').check();await page.locator('[name=enabled]').first().check();await page.locator('[data-settings] [type=submit]').click();
   await page.getByRole('status').filter({hasText:'다음 자동 발송'}).waitFor();
   await page.locator('[name=template_mode]').selectOption('by_type');
   const slot=page.locator('[data-template-key="kinder:after_1"]');
   await slot.locator('summary').click();await slot.locator('[data-use-common]').uncheck();
   await slot.locator('[data-variant-id]').fill('KINDER-ONE');await slot.locator('[data-variant-body]').fill('유치부 첫 상담 #{학생명} #{예약링크}');await slot.locator('[data-variant-confirmed]').check();
   await page.locator('[data-settings] [type=submit]').click();
   await page.waitForFunction(()=>fixture.settings.template_variants?.['kinder:after_1']?.template_id==='KINDER-ONE');
   await page.locator('[name=template_mode]').selectOption('common');await page.locator('[data-settings] [type=submit]').click();
   await page.waitForFunction(()=>fixture.settings.template_mode==='common');
   await page.locator('[name=template_mode]').selectOption('by_type');
   assert.equal(await slot.locator('[data-variant-id]').inputValue(),'KINDER-ONE');
   await slot.locator('[data-variant-body]').fill('수정된 첫 상담 #{학생명}');assert.equal(await slot.locator('[data-variant-confirmed]').isChecked(),false);
   await page.locator('[data-tab=contacts]').click();
   assert.equal(await page.locator('[data-panel=contacts] input[type=tel]').count(),0);
   await page.locator('[data-panel=contacts]').filter({hasText:'학생 등록·학생정보 화면'}).waitFor();
   await page.locator('[data-tab=settings]').click();
   // Off changes only usage, even when the current unsaved form is invalid.
   await page.locator('[name=booking_url]').fill('https://invalid.example');
   await page.getByRole('switch',{name:'상담 안내 문자 사용'}).uncheck();
   await page.waitForFunction(()=>fixture.settings.enabled===false);
   assert.equal(await page.evaluate(()=>fixture.settings.booking_url),'https://booking.naver.com/booking/13/bizes/123');
   assert.equal(await page.evaluate(()=>fixture.settings.template_variants['kinder:after_1'].template_id),'KINDER-ONE');
   assert.equal(await slot.locator('[data-variant-body]').inputValue(),'수정된 첫 상담 #{학생명}');
   await page.locator('[data-tab=contacts]').click();assert.equal(await page.locator('[data-send]').isDisabled(),true);
   await page.locator('[data-tab=settings]').click();
   await page.screenshot({path:'/tmp/olli-consultation-'+width+'.png'});
   await page.evaluate(()=>{localStorage.setItem('olli_current_academy_id','other');window.dispatchEvent(new Event('focus'));});assert.equal(await page.locator('dialog').count(),0);
   await page.evaluate(()=>{localStorage.setItem('olli_current_member_role','teacher');OlliConsultationMessages.open();});assert.equal(await page.locator('dialog').count(),0);
   assert.deepEqual(errors,[]);await page.close();
  }
 }finally{await browser.close();}
});
