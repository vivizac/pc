const {test}=require('node:test');const assert=require('node:assert/strict');const {chromium}=require('playwright');
test('mobile login, filters, favorites, payment, failed save retry and academy isolation',async()=>{
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{
const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
let rows=[{student_id:'s1',name:'김지윤',invoice_id:'i1',amount:110000,paid:0,revision:0,favorite:true},{student_id:'s2',name:'이서준',invoice_id:'i2',amount:140000,paid:140000,revision:1,favorite:true},{student_id:'s3',name:'박소미',invoice_id:null,amount:110000,paid:0,revision:0,favorite:false}];let fail=true,paymentCalls=[];
await page.route('https://fvkxipjwgeyosgnfhdnx.supabase.co/rest/v1/rpc/**',async route=>{const n=route.request().url().split('/').pop(),d=route.request().postDataJSON();let result={};
if(n==='olli_account_login')result={session_token:'mock-session'};
if(n==='olli_get_my_academies')result={academies:[{academy_id:'a1',academy_name:'비비작 대천점',role:'owner'},{academy_id:'a2',academy_name:'다른 학원',role:'owner'}]};
if(n==='olli_receipts_overview'){if(d.p_academy_id==='a2')await new Promise(r=>setTimeout(r,100));result={ok:true,students:d.p_academy_id==='a1'?rows:[]};}
if(n==='olli_receipts_write'){
 if(d.p_action==='payment'){paymentCalls.push(d);rows[0]={...rows[0],paid:d.p_data.amount,revision:1};if(fail){fail=false;await route.abort();return;}}
 if(d.p_action==='favorite')rows=rows.map(s=>s.student_id===d.p_data.student_id?{...s,favorite:d.p_data.enabled}:s);
 result={ok:true};
}
await route.fulfill({json:result});});
await page.goto('http://127.0.0.1:4173');await page.getByLabel('올리 아이디').fill('owner');await page.getByLabel('비밀번호',{exact:true}).fill('test');await page.getByRole('button',{name:'로그인',exact:true}).click();await page.getByRole('button',{name:'김지윤',exact:true}).waitFor();
assert.equal(await page.locator('.student').count(),2);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'/workspace/olli-source/docs/receipts/mobile-390.png',fullPage:true});
await page.getByRole('button',{name:'전체',exact:true}).click();assert.equal(await page.locator('.student').count(),3);
await page.getByLabel('학생 이름 검색').fill('박소');assert.equal(await page.locator('.student').count(),1);await page.getByLabel('학생 이름 검색').fill('');
await page.getByRole('button',{name:'미납',exact:true}).click();assert.equal(await page.locator('.student').count(),1);
await page.getByRole('button',{name:'수납 처리',exact:true}).click();await page.getByLabel('이번 납부 금액').fill('40000');await page.getByRole('button',{name:'납부 확인 · 기록하기'}).click();await page.getByRole('button',{name:'저장 결과 다시 확인'}).waitFor();await page.getByLabel('닫기').click();await page.getByRole('button',{name:'저장 결과 다시 확인'}).click();await page.getByText('40,000원 납부 · 70,000원 남음').waitFor();assert.equal(paymentCalls.length,2);assert.deepEqual(paymentCalls[0],paymentCalls[1]);
await page.getByRole('button',{name:'전체',exact:true}).click();await page.getByLabel('김지윤 즐겨찾기 해제').click();await page.getByLabel('김지윤 즐겨찾기 추가').waitFor();
await page.getByLabel('학원 선택').selectOption('a2');await page.getByText('해당 월의 학생이 없습니다.').waitFor();assert.equal(await page.locator('.student').count(),0);
await page.setViewportSize({width:320,height:740});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
}finally{await browser.close();}});
