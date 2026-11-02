'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'apps/pc/index.html'),'utf8');
const style=html.match(/<style id="olliAcademyManagementConsultationStyle">([\s\S]*?)<\/style>/)?.[1];
assert.ok(style,'original PC statistics stylesheet');
const attendance=fs.readFileSync(path.join(root,'apps/pc/pc-attendance.css'),'utf8');
const management=fs.readFileSync(path.join(root,'apps/pc/pc-student-management.css'),'utf8');
function stat(value,label,details){
 return `<div class="recordAcademyStatCard"><div class="recordAcademyStatBody"><div class="recordAcademyStatValue">${value}</div><div class="recordAcademyStatGuide"><div class="recordAcademyStatLabel">${label}</div><div class="recordAcademyStatSub">${details}</div></div></div></div>`;
}
function fixture(){
 const cards=[stat(89,'원생수','초등부 53명<br>유치부 36명'),stat(14,'11월 상담','초등부 10명<br>유치부 4명'),stat(40,'올해 등록','이달 등록 0명<br>이달 퇴원 0명'),stat(22,'올해 퇴원','휴원 1명<br>퇴원 22명')].join('');
 return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
 <style>:root{--pc-bg:#f5f6f8;--pc-topbar-h:78px;--olli-text-scale:1}body{margin:0}
 #recordRoomScreen{height:calc(100vh - 78px)}</style>
 <style>${style}</style><style>${attendance}</style><style>${management}</style></head>
 <body class="olliPcApp"><div id="recordRoomScreen" class="record-academy-management-mode">
 <div class="recordPageInner"><div id="recordBodyNew" class="recordBodyNew pcAcademyLayout">
 <div id="recordAcademyDashboard" class="recordAcademyDashboard show">
 <div class="recordAcademyStatGrid">${cards}</div>
 <div class="pcAcademyWorkOrderGrid">
 <section class="recordAcademyConsultSection pcAcademyTodoSection">
 <div class="pcAcademySectionHeader pcAcademyTodoHeader"><div class="pcAcademySectionTitle">학원 업무</div></div>
 <form class="pcAcademyTodoForm"><input placeholder="할 일 입력"><button type="button">추가</button></form>
 <div class="pcAcademyTodoList" id="todos"><div class="pcAcademyTodoItem">처리할 업무</div></div></section>
 <section class="recordAcademyConsultSection pcAcademyMaterialsSection">
 <div class="pcAcademySectionHeader"><div class="pcAcademySectionTitle">재료주문</div></div>
 <button class="pcAcademyMaterialsOpen">재료주문 화면 열기</button>
 <div class="pcAcademyMaterialsList" id="materials"><div class="pcAcademyMaterialRow">재료 주문</div></div></section>
 </div></div>
 <aside class="pcAcademyDetailPanel" id="pcAcademyDetailPanel">
 <div class="pcAcademySectionHeader pcAcademyConsultHeader"><div class="pcAcademyDetailName">상담예정 학생</div></div>
 <div class="pcAcademyConsultationList" id="consultations"><div class="recordAcademyConsultListItem">상담 학생</div></div></aside>
 </div></div></div></body></html>`;
}
test('PC page grid stays flush and only hidden-scroll inner lists move as data grows',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const [width,height] of [[1600,900],[1250,800],[1050,800],[850,850]]){
   const page=await browser.newPage({viewport:{width,height}});
   await page.setContent(fixture());
   const initial=await page.evaluate(()=>{
    const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,height:r.height,width:r.width}};
    return {consult:rect('#pcAcademyDetailPanel'),todo:rect('.pcAcademyTodoSection'),material:rect('.pcAcademyMaterialsSection'),stat:rect('.recordAcademyStatCard'),main:rect('.recordBodyNew.pcAcademyLayout'),listLeft:rect('.pcAcademyTodoItem').left};
   });
   await page.evaluate(()=>{
    const add=(selector,count,cls)=>{const el=document.querySelector(selector);for(let i=0;i<count;i++){const item=document.createElement('div');item.className=cls;item.textContent='길게 작성한 항목 '+i+' 학생 관리 기록과 원장님 업무 내용';el.append(item)}};
    add('#todos',90,'pcAcademyTodoItem');add('#materials',90,'pcAcademyMaterialRow');add('#consultations',120,'recordAcademyConsultListItem');
   });
   const next=await page.evaluate(()=>{
    const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,height:r.height,width:r.width}};
    const selectors=['#todos','#materials','#consultations'];
    const scroll=selectors.map(selector=>{const el=document.querySelector(selector);const start=el.scrollTop;el.scrollTop=140;return {selector,scrollTop:el.scrollTop,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,scrollbarWidth:getComputedStyle(el).scrollbarWidth,pseudo:getComputedStyle(el,'::-webkit-scrollbar').display}});
    const body=document.querySelector('#recordRoomScreen .recordPageInner'),main=document.querySelector('.recordBodyNew.pcAcademyLayout');
    return {consult:rect('#pcAcademyDetailPanel'),todo:rect('.pcAcademyTodoSection'),material:rect('.pcAcademyMaterialsSection'),stat:rect('.recordAcademyStatCard'),main:rect('.recordBodyNew.pcAcademyLayout'),listLeft:rect('.pcAcademyTodoItem').left,pageScroll:body.scrollHeight-body.clientHeight,mainScroll:main.scrollHeight-main.clientHeight,scroll};
   });
   for(const name of ['consult','todo','material','stat']){
    assert.ok(Math.abs(initial[name].height-next[name].height)<1.5,`${width}: ${name} grew because of child contents`);
   }
   assert.ok(next.pageScroll<=1,`${width}: page scrolls`);
   assert.ok(next.mainScroll<=1,`${width}: dashboard body scrolls`);
   assert.ok(Math.abs(initial.listLeft-next.listLeft)<1.5,`${width}: content shifted horizontally when overflow appeared`);
   if(width>900){
    assert.ok(Math.abs(next.consult.top-next.stat.top)<1.5,`${width}: top grid misaligned`);
    assert.ok(Math.abs(next.consult.bottom-next.todo.bottom)<1.5,`${width}: todo bottom misaligned`);
    assert.ok(Math.abs(next.consult.bottom-next.material.bottom)<1.5,`${width}: materials bottom misaligned`);
   }
   for(const el of next.scroll){
    assert.ok(el.scrollHeight>el.clientHeight,`${width}: no overflowing child ${el.selector}`);
    assert.ok(el.scrollTop>0,`${width}: cannot scroll ${el.selector}`);
    assert.equal(el.scrollbarWidth,'none');
    assert.equal(el.pseudo,'none');
   }
   if(width>=1250){
    assert.ok(next.stat.height>=120&&next.stat.height<=123,`${width}: stats not fixed`);
   }
   await page.close();
  }
 }finally{await browser.close()}
});
