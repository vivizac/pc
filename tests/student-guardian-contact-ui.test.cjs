'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const source=fs.readFileSync(path.join(__dirname,'../packages/common/olli-student-guardian-contact.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../packages/common/olli-student-guardian-contact.css'),'utf8');

test('student info uses existing contact, verifies writes, preserves failures and registration retry ID',async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.OLLI_CHROMIUM_PATH?{executablePath:process.env.OLLI_CHROMIUM_PATH}:{}),args:['--no-sandbox']});
 try{for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://olli.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><style>'+css+'</style><div id="card"><div class="pcStudentInfoActions"><button id="save">저장</button></div></div>'}));
  await page.goto('https://olli.test');
  await page.evaluate(()=>{
   localStorage.setItem('olli_current_academy_id','academy');localStorage.setItem('olli_account_session_token_v1','owner-session');localStorage.setItem('olli_current_member_role','owner');
   window.contact={id:'student',phone:'01012345678',enabled:true,confirmed:true};window.calls=[];window.fail=false;window.failLoad=false;
   window.callOlliRpc=async(name,args)=>{
    window.calls.push(args);
    if(args.p_action==='load' && window.failLoad)throw Error('offline');
    if(args.p_action==='contact'){
     if(window.fail)throw Error('offline');
     window.contact={id:args.p_data.student_id,...args.p_data};
    }
    return {ok:true,students:[structuredClone(window.contact)]};
   };
  });
  await page.addScriptTag({content:source});
  await page.evaluate(()=>{window.root=document.getElementById('card');OlliGuardianContact.mount(root,{id:'student'});});
  await page.waitForFunction(()=>document.querySelector('[data-guardian-phone]').value==='01012345678');
  assert.equal(await page.locator('[data-guardian-confirmed]').isChecked(),true);
  assert.equal(await page.evaluate(()=>OlliGuardianContact.capture(root)),null);
  await page.locator('[data-guardian-phone]').fill('01087654321');assert.equal(await page.locator('[data-guardian-confirmed]').isChecked(),false);
  // A background student profile refresh cannot overwrite a pending contact edit.
  await page.evaluate(()=>OlliGuardianContact.mount(root,{id:'student'}));assert.equal(await page.locator('[data-guardian-phone]').inputValue(),'01087654321');
  await page.locator('[data-guardian-confirmed]').check();
  await page.evaluate(async()=>{window.fail=true;try{await OlliGuardianContact.save(root,{id:'student'},OlliGuardianContact.capture(root));}catch(e){window.lastError=e.message;}});
  assert.match(await page.evaluate(()=>lastError),/입력한 번호는 화면에 남아/);
  assert.equal(await page.locator('[data-guardian-phone]').inputValue(),'01087654321');
  await page.evaluate(async()=>{window.fail=false;await OlliGuardianContact.save(root,{id:'student'},OlliGuardianContact.capture(root));});
  assert.equal(await page.evaluate(()=>contact.phone),'01087654321');
  assert.equal(await page.evaluate(()=>OlliGuardianContact.capture(root)),null);
  // Existing contact load failure leaves inputs disabled and does not produce an empty write.
  await page.evaluate(()=>{window.failLoad=true;OlliGuardianContact.mount(root,{id:'student'},{reset:true});});
  await page.waitForFunction(()=>document.querySelector('[data-guardian-status]').textContent.includes('기존 번호를 보존'));
  assert.equal(await page.locator('[data-guardian-phone]').isDisabled(),true);
  assert.equal(await page.evaluate(()=>OlliGuardianContact.capture(root)),null);
  // A new registration starts empty; its created ID remains available after a failed contact save.
  await page.evaluate(()=>{window.failLoad=false;OlliGuardianContact.mount(root,null,{reset:true});OlliGuardianContact.markRegistered(root,{id:'new-student'});});
  assert.equal(await page.evaluate(()=>OlliGuardianContact.registered(root).id),'new-student');
  await page.locator('[data-guardian-phone]').fill('01055556666');await page.locator('[data-guardian-confirmed]').check();
  await page.evaluate(async()=>{window.fail=true;try{await OlliGuardianContact.save(root,{id:'new-student'},OlliGuardianContact.capture(root));}catch{}});
  assert.equal(await page.evaluate(()=>OlliGuardianContact.registered(root).id),'new-student');
  // Different academy cannot write the stale field or reuse its registration ID.
  await page.evaluate(()=>localStorage.setItem('olli_current_academy_id','other'));
  assert.equal(await page.evaluate(()=>OlliGuardianContact.registered(root)),null);
  assert.match(await page.evaluate(()=>{try{OlliGuardianContact.capture(root);}catch(e){return e.message;}}),/학원/);
  assert.deepEqual(errors,[]);await page.close();
 }}finally{await browser.close();}
});


test('original PC and mobile registration retries contact failure without duplicating a student',async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.OLLI_CHROMIUM_PATH?{executablePath:process.env.OLLI_CHROMIUM_PATH}:{}),args:['--no-sandbox']});
 try{for(const filename of ['apps/pc/olli-record-memo-storage.js','apps/mobile/olli-observation-runtime.js']){
  const original=fs.readFileSync(path.join(__dirname,'..',filename),'utf8');const start=original.indexOf('async function confirmStudent()');let end=original.indexOf('\nfunction ',start);if(end<0)end=original.length;
  const page=await browser.newPage();await page.route('https://olli.test/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><div id="studentModal"><div class="modalCard"><input id="studentNameInput" value="테스트"><input id="studentYearBadge" value="2026"><input id="studentMonthInput" value="10"><input id="studentDayInput" value="21"><input id="studentAgeInput" value="6"><input id="studentKindergartenInput" value="유치원"><div class="modalActions"></div></div></div>'}));await page.goto('https://olli.test');
  await page.evaluate(()=>{
   localStorage.setItem('olli_current_academy_id','academy');localStorage.setItem('olli_account_session_token_v1','session');localStorage.setItem('olli_current_member_role','owner');
   window.records=new Map();window.savedIds=[];window.contactFail=true;window.registrationClosed=false;window.alerts=[];
   window.currentRecordView='kinder';window.getStudentsByType=()=>Array.from(records.values());window.getCurrentYear=()=>2026;window.uid=()=>crypto.randomUUID();
   window.inferOlliBirthYearFromAge=()=>2021;window.normalizeLessonTimeDisplay=x=>x||'';window.olliGetStudentAddExtra=()=>({});
   window.ensureStudentSavedToSupabase=async student=>{records.set(student.id,student);savedIds.push(student.id);return student;};
   window.callOlliRpc=async(name,args)=>{if(contactFail)throw Error('temporary');return {ok:true,students:[{id:args.p_data.student_id,...args.p_data}]};};
   window.closeStudentModal=()=>{window.registrationClosed=true;};window.loadRecords=async()=>{};window.showPushToast=()=>{};window.alert=message=>alerts.push(message);
  });
  await page.addScriptTag({content:source});await page.addScriptTag({content:original.slice(start,end)});
  await page.evaluate(()=>OlliGuardianContact.mount(document.querySelector('#studentModal .modalCard'),null));
  await page.locator('[data-guardian-phone]').fill('01012345678');await page.locator('[data-guardian-confirmed]').check();
  await page.evaluate(()=>confirmStudent());assert.equal(await page.evaluate(()=>records.size),1);assert.equal(await page.evaluate(()=>registrationClosed),false);
  assert.match(await page.evaluate(()=>alerts[0]),/보호자 연락처/);
  await page.evaluate(async()=>{contactFail=false;await confirmStudent();});
  assert.equal(await page.evaluate(()=>records.size),1,filename);assert.equal(await page.evaluate(()=>savedIds[0]===savedIds[1]),true);assert.equal(await page.evaluate(()=>registrationClosed),true,filename+': '+JSON.stringify(await page.evaluate(()=>alerts)));
  await page.close();
 }}finally{await browser.close();}
});
