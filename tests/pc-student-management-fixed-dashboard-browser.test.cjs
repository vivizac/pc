'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'apps/pc/index.html'),'utf8');
const style=html.match(/<style id="olliAcademyManagementConsultationStyle">([\s\S]*?)<\/style>/)?.[1];
assert.ok(style,'original PC statistics stylesheet');
const attendance=fs.readFileSync(path.join(root,'apps/pc/pc-attendance.css'),'utf8');
const management=fs.readFileSync(path.join(root,'apps/pc/pc-student-management.css'),'utf8');
const shell=fs.readFileSync(path.join(root,'apps/pc/pc-shell.css'),'utf8');
function stat(value,label,details){
 return `<div class="recordAcademyStatCard"><div class="recordAcademyStatLabel">${label}</div><div class="recordAcademyStatBody"><div class="recordAcademyStatValue">${value}</div><div class="recordAcademyStatSub">${details}</div></div></div>`;
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
 <div class="pcAcademySectionHeader pcAcademyTodoHeader">
 <div><div class="pcAcademySectionTitle">학원 업무</div><div class="pcAcademySectionSub">업무와 메모를 한곳에서 관리해요.</div></div>
 <div class="pcAcademyTodoHeaderActions">
 <button type="button" class="pcAcademyRecurringManageBtn">
 <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7a8 8 0 0 0-14-2L4 7m0-4v4h4"></path></svg>반복 업무 관리</button>
 <span class="pcAcademySectionCount">8개 남음</span></div></div>
 <form class="pcAcademyTodoForm"><input placeholder="할 일 입력"><button type="button">추가</button></form>
 <div class="pcAcademyTodoList" id="todos"><div class="pcAcademyTodoItem"><div class="pcAcademyTodoTextWrap"><div class="pcAcademyTodoText">처리할 업무</div><span class="pcAcademyTodoOrigin">올리톡</span></div></div><div class="pcAcademyMaterialRow"><button class="pcAcademyTodoCheck pcAcademyMaterialCheck" type="button" aria-pressed="false"><span></span></button><button class="pcAcademyMaterialOpen" type="button"><span class="pcAcademyMaterialMain"><span class="pcAcademyTodoText">재료 주문</span><span class="pcAcademyTodoGuide">3개 · 필요일 2026-11-12</span></span><span class="pcAcademyMaterialStatus requested">요청</span></button></div></div></section>
 </div></div>
 <aside class="pcAcademyDetailPanel" id="pcAcademyDetailPanel">
 <div class="pcAcademySectionHeader pcAcademyConsultHeader"><div><div class="pcAcademyDetailName">상담예정 학생</div><div class="pcAcademyDetailSub">이번 달 상담이 필요한 학생</div></div><span class="pcAcademySectionCount">3명</span></div>
 <div class="pcAcademyConsultationList" id="consultations"><div class="recordAcademyConsultGroup"><div class="recordAcademyConsultGroupTitle">초등부</div><div class="recordAcademyConsultListItem"><div class="recordAcademyListName">상담 학생</div><div class="recordAcademyInfoChip recordAcademyRuleChip">3개월</div><span class="recordAcademyConsultStatusChip ready">상담 자료 준비</span></div></div></div></aside>
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
    return {consult:rect('#pcAcademyDetailPanel'),todo:rect('.pcAcademyTodoSection'),stat:rect('.recordAcademyStatCard'),main:rect('.recordBodyNew.pcAcademyLayout'),listLeft:rect('.pcAcademyTodoItem').left};
   });
   await page.evaluate(()=>{
    const add=(selector,count,cls)=>{const el=document.querySelector(selector);for(let i=0;i<count;i++){const item=document.createElement('div');item.className=cls;item.textContent='길게 작성한 항목 '+i+' 학생 관리 기록과 원장님 업무 내용';el.append(item)}};
    add('#todos',90,'pcAcademyTodoItem');add('#todos',90,'pcAcademyMaterialRow');add('#consultations',120,'recordAcademyConsultListItem');
   });
   const next=await page.evaluate(()=>{
    const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,height:r.height,width:r.width}};
    const selectors=['#todos','#consultations'];
    const scroll=selectors.map(selector=>{const el=document.querySelector(selector);const start=el.scrollTop;el.scrollTop=140;return {selector,scrollTop:el.scrollTop,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,scrollbarWidth:getComputedStyle(el).scrollbarWidth,pseudo:getComputedStyle(el,'::-webkit-scrollbar').display}});
    const body=document.querySelector('#recordRoomScreen .recordPageInner'),main=document.querySelector('.recordBodyNew.pcAcademyLayout');
    return {consult:rect('#pcAcademyDetailPanel'),todo:rect('.pcAcademyTodoSection'),stat:rect('.recordAcademyStatCard'),main:rect('.recordBodyNew.pcAcademyLayout'),listLeft:rect('.pcAcademyTodoItem').left,pageScroll:body.scrollHeight-body.clientHeight,mainScroll:main.scrollHeight-main.clientHeight,scroll};
   });
   for(const name of ['consult','todo','stat']){
    assert.ok(Math.abs(initial[name].height-next[name].height)<1.5,`${width}: ${name} grew because of child contents`);
   }
   assert.ok(next.pageScroll<=1,`${width}: page scrolls`);
   assert.ok(next.mainScroll<=1,`${width}: dashboard body scrolls`);
   assert.ok(Math.abs(initial.listLeft-next.listLeft)<1.5,`${width}: content shifted horizontally when overflow appeared`);
   if(width>900){
    assert.ok(Math.abs(next.consult.top-next.stat.top)<1.5,`${width}: top grid misaligned`);
    assert.ok(Math.abs(next.consult.bottom-next.todo.bottom)<1.5,`${width}: todo bottom misaligned`);
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

test('material cards share the work list, headings and count capsules use requested lighter weights',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:900}});
  await page.setContent(fixture());
  const measured=await page.evaluate(()=>{
   function metrics(selector){
    const el=document.querySelector(selector),rect=el.getBoundingClientRect(),style=getComputedStyle(el);
    return {height:rect.height,backgroundColor:style.backgroundColor,color:style.color,borderRadius:style.borderRadius,fontSize:style.fontSize,fontWeight:style.fontWeight};
   }
   return {
    cardParent:document.querySelector('.pcAcademyMaterialRow').parentElement.id,
    title:metrics('.pcAcademySectionTitle'),
    consultationTitle:metrics('.pcAcademyDetailName'),
    repeat:metrics('.pcAcademyRecurringManageBtn'),
    count:metrics('.pcAcademySectionCount'),
    repeatIcon:getComputedStyle(document.querySelector('.pcAcademyRecurringManageBtn svg')).stroke
   };
  });
  assert.equal(measured.cardParent,'todos');
  assert.equal(measured.title.fontWeight,'600');
  assert.equal(measured.consultationTitle.fontWeight,'600');
  for(const property of ['height','backgroundColor','color','borderRadius','fontSize','fontWeight'])
   assert.equal(measured.repeat[property],measured.count[property],property+' capsule mismatch');
  assert.equal(measured.repeatIcon,measured.repeat.color,'icon should inherit capsule text color');
  await page.close();
 }finally{await browser.close()}
});

test('approved typography uses consistent sizes in a desktop browser',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:900}});
  await page.setContent(fixture());
  const expected={
   '.recordAcademyStatLabel':['12px','600'],
   '.recordAcademyStatValue':['42px','400'],
   '.recordAcademyStatSub':['12px',null],
   '.pcAcademySectionTitle':['18px','600'],
   '.pcAcademyDetailName':['18px','600'],
   '.pcAcademySectionSub':['12px','400'],
   '.pcAcademyDetailSub':['12px','400'],
   '.pcAcademySectionCount':['11px','400'],
   '.pcAcademyRecurringManageBtn':['11px','400'],
   '.pcAcademyTodoForm input':['14px',null],
   '.pcAcademyTodoForm button':['14px','600'],
   '.pcAcademyTodoText':['14px','500'],
   '.pcAcademyTodoGuide':['11px','400'],
   '.pcAcademyMaterialStatus':['11px','400'],
   '.pcAcademyTodoOrigin':['11px','400'],
   '.pcAcademyDetailPanel .recordAcademyConsultGroupTitle':['12px','800'],
   '.pcAcademyDetailPanel .recordAcademyListName':['14px','500'],
   '.pcAcademyDetailPanel .recordAcademyInfoChip':['11px','400'],
   '.pcAcademyDetailPanel .recordAcademyConsultStatusChip':['11px','400'],
  };
  const measured=await page.evaluate(selectors=>Object.fromEntries(selectors.map(selector=>{
   const style=getComputedStyle(document.querySelector(selector));
   return [selector,[style.fontSize,style.fontWeight]];
  })),Object.keys(expected));
  for(const [selector,[size,weight]] of Object.entries(expected)){
   assert.equal(measured[selector][0],size,selector+' font-size');
   if(weight!==null)assert.equal(measured[selector][1],weight,selector+' font-weight');
  }
  await page.close();
 }finally{await browser.close()}
});

test('sidebar menu aligns at topbar bottom; material text stays on one line',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const width of [1600,1250,980]){
   const page=await browser.newPage({viewport:{width,height:900}});
   await page.setContent('<!doctype html><html lang="ko"><head><style>'+shell+'</style></head><body class="olliPcApp">'
    +'<div class="olliPcShell visible"><div class="olliPcBrand"><div class="olliPcBrandLogo">비비작아이성향미술학원</div></div>'
    +'<nav class="olliPcNav"><button class="olliPcNavBtn" type="button">학생관리</button></nav></div>'
    +'<div class="olliPcTopbar visible"><div class="olliPcTopbarTitle">학생관리</div></div></body></html>');
   const a=await page.evaluate(()=>({
    navTop:document.querySelector('.olliPcNavBtn').getBoundingClientRect().top,
    barBottom:document.querySelector('.olliPcTopbar').getBoundingClientRect().bottom
   }));
   assert.ok(Math.abs(a.navTop-a.barBottom)<1,'sidebar grid mismatch '+width);
   await page.setContent(fixture());
   const v=await page.evaluate(()=>{
    const main=document.querySelector('.pcAcademyMaterialMain');
    const name=main.querySelector('.pcAcademyTodoText'),guide=main.querySelector('.pcAcademyTodoGuide');
    return {direction:getComputedStyle(main).flexDirection,
     nameY:name.getBoundingClientRect().top,guideY:guide.getBoundingClientRect().top,
     nameSize:getComputedStyle(name).fontSize,guideSize:getComputedStyle(guide).fontSize,
     weight:getComputedStyle(name).fontWeight};
   });
   assert.equal(v.direction,'row');
   assert.ok(Math.abs(v.nameY-v.guideY)<5);
   assert.equal(v.nameSize,'14px');assert.equal(v.guideSize,'11px');assert.equal(v.weight,'500');
   await page.close();
  }
 }finally{await browser.close()}
});
