'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('index.html', 'utf8');
const sheet = fs.readFileSync('kcf-teacher-sheet.js', 'utf8');
const sheetCss = fs.readFileSync('kcf-teacher-sheet.css', 'utf8');
const autoCss = fs.readFileSync('kcf-auto-mode.css', 'utf8');
const todayCss = fs.readFileSync('kcf-today-records.css', 'utf8');

test('the original Plus and microphone remain present and visible in the idle toolbar',()=>{
  assert.match(html, /id="kcfAttachBtn"/);
  assert.match(html, /id="kcfVoiceBtn"/);
  assert.match(html, /id="kcfModeSwitchBtn"/);
  assert.match(autoCss, /grid-template-columns:33px minmax\(0,1fr\) 88px 33px 33px;/);
  assert.match(autoCss, /\.kcfAttachBtn \{[\s\S]*?display:inline-flex;/);
  assert.match(autoCss, /\.kcfVoiceBtn \{[\s\S]*?display:inline-flex;/);
  assert.doesNotMatch(autoCss, /\.kcfVoiceBtn \{\s*display:none;/);
  assert.doesNotMatch(autoCss, /\.kcfAttachBtn \{\s*display:none;/);
});

test('active sheet has the same five control slots, reusing existing DOM nodes',()=>{
  assert.match(sheet, /id="kcfTeacherSheetAttachHost"/);
  assert.match(sheet, /id="kcfTeacherSheetModeHost"/);
  assert.match(sheet, /id="kcfTeacherSheetRosterHost"/);
  assert.match(sheet, /id="kcfTeacherSheetEmptyRosterGuide"/);
  assert.match(sheet, /오늘 수업 기록 학생이 없습니다\./);
  assert.match(sheetCss, /\.kcfTeacherSheetRosterHost\[hidden\]\{display:none;\}/);
  assert.match(sheet, /teacherMode\.refreshRoster\(\)/);
  assert.match(sheetCss, /#kcfTeacherSheetEmptyRosterGuide\{grid-column:2;/);
  assert.match(sheet, /id="kcfTeacherSheetVoiceHost"/);
  assert.match(sheet, /id="kcfTeacherSheetSendBtn"/);
  // + → roster → mode → microphone → send, also while active.
  assert.ok(sheet.indexOf('id="kcfTeacherSheetRosterHost"') < sheet.indexOf('class="kcfTeacherSheetBottom"'));
  assert.ok(sheet.indexOf('id="kcfTeacherSheetAttachHost"') < sheet.indexOf('id="kcfTeacherSheetModeHost"'));
  assert.ok(sheet.indexOf('id="kcfTeacherSheetEmptyRosterGuide"') < sheet.indexOf('id="kcfTeacherSheetModeHost"'));
  assert.ok(sheet.indexOf('id="kcfTeacherSheetModeHost"') < sheet.indexOf('id="kcfTeacherSheetVoiceHost"'));
  assert.ok(sheet.indexOf('id="kcfTeacherSheetVoiceHost"') < sheet.indexOf('id="kcfTeacherSheetSendBtn"'));
  assert.match(autoCss, /kcfTeacherRosterMode \.kcfAutoStudentRoster \{[\s\S]*?grid-column:1 \/ -1;[\s\S]*?grid-row:2;/);
  assert.match(autoCss, /kcfTeacherRosterMode \.kcfComposerModeBtn \{[\s\S]*?grid-column:3;/);

  assert.match(sheetCss, /grid-template-columns:33px minmax\(0,1fr\) 88px 33px 33px;/);
  assert.match(sheet, /\['kcfAttachBtn','kcfTeacherSheetAttachHost'\]/);
  assert.match(sheet, /\['kcfModeSwitchBtn','kcfTeacherSheetModeHost'\]/);
  assert.match(sheet, /\['kcfVoiceBtn','kcfTeacherSheetVoiceHost'\]/);
  assert.match(sheet, /restoreSheetControls\(\);/);
  assert.doesNotMatch(sheet, /id="kcfSheetModeSwitchBtn"/);
});

test('the active microphone reuses the existing voice recorder after returning to the inline composer',()=>{
  const from=sheet.indexOf('function mountSheetControls(){');
  const to=sheet.indexOf('function finishSheetEntrance(){',from);
  assert.ok(from>=0&&to>from);
  const micHandler=sheet.slice(from,to);
  assert.match(micHandler, /mic\.addEventListener\('click',[\s\S]*?stopImmediatePropagation\(\);[\s\S]*?close\(\{ sync:true \}\);/);
  assert.match(micHandler, /global\.KcfVoiceTranscription/);
  assert.match(micHandler, /voice\.toggle\(event\);/);
  assert.match(micHandler, /photo\.addEventListener\('pointerdown'/);
  assert.match(sheet, /\['kcfPhotoPreview','kcfTeacherSheetPhotoHost'\]/);
  assert.match(sheetCss, /\.kcfTeacherSheetPhotoHost \.kcfPhotoPreview\.show\{display:flex;\}/);
});

test('empty student guide never replaces or moves the four permanent actions',()=>{
  const bottomStart=sheet.indexOf("'    <div class=\"kcfTeacherSheetBottom\">'");
  const bottomEnd=sheet.indexOf("'    </div>'",bottomStart);
  assert.ok(bottomStart>0&&bottomEnd>bottomStart);
  const bottomMarkup=sheet.slice(bottomStart,bottomEnd);
  const order=['kcfTeacherSheetAttachHost','kcfTeacherSheetEmptyRosterGuide','kcfTeacherSheetModeHost','kcfTeacherSheetVoiceHost','kcfTeacherSheetSendBtn'];
  const offsets=order.map(id=>bottomMarkup.indexOf('id="'+id+'"'));
  assert.ok(offsets.every(n=>n>=0));
  assert.ok(offsets.every((value,i)=>i===0||offsets[i-1]<value));
  assert.match(sheetCss, /grid-template-columns:33px minmax\(0,1fr\) 88px 33px 33px;/);
  assert.match(sheetCss, /grid-template-rows:40px;/);
  for(const [id,col] of [['kcfTeacherSheetAttachHost',1],['kcfTeacherSheetEmptyRosterGuide',2],['kcfTeacherSheetModeHost',3],['kcfTeacherSheetVoiceHost',4]]){
    assert.ok(sheetCss.includes('#'+id+'{grid-column:'+col+';grid-row:1;}'));
  }
  assert.ok(sheetCss.includes('.kcfTeacherSheetSendBtn{grid-column:5;grid-row:1;}'));
  assert.ok(sheetCss.includes('#kcfTeacherSheetEmptyRosterGuide[hidden]{display:none;}'));
  assert.doesNotMatch(bottomMarkup, /kcfTeacherSheet(?:Attach|Mode|Voice)Host[^>]*hidden/);
  assert.match(sheet, /\['kcfAttachBtn','kcfTeacherSheetAttachHost'\]/);
  assert.match(sheet, /\['kcfModeSwitchBtn','kcfTeacherSheetModeHost'\]/);
  assert.match(sheet, /\['kcfVoiceBtn','kcfTeacherSheetVoiceHost'\]/);
});

test('the very same button nodes move to the sheet and return home; microphone starts only once',()=>{
  const start=sheet.indexOf('function mountSheetControls(){');
  const end=sheet.indexOf('function finishSheetEntrance(){',start);
  assert.ok(start>=0&&end>start);
  class Node {
    constructor(id){this.id=id;this.parentNode=null;this.children=[];this.events=[];}
    detach(){
      if (!this.parentNode)return;
      const i=this.parentNode.children.indexOf(this);
      if(i>=0)this.parentNode.children.splice(i,1);
      this.parentNode=null;
    }
    appendChild(n){n.detach();this.children.push(n);n.parentNode=this;}
    insertBefore(n,anchor){
      n.detach();const i=this.children.indexOf(anchor);
      if(i<0)throw Error('missing insertion anchor');
      this.children.splice(i,0,n);n.parentNode=this;
    }
    addEventListener(type,handler,capture){this.events.push({type,handler,capture});}
    remove(){this.detach();}
  }
  const composer=new Node('composer');
  const photoArea=new Node('photoArea');
  const original={
    kcfAttachBtn:new Node('kcfAttachBtn'),
    kcfModeSwitchBtn:new Node('kcfModeSwitchBtn'),
    kcfVoiceBtn:new Node('kcfVoiceBtn'),
    kcfPhotoPreview:new Node('kcfPhotoPreview')
  };
  composer.appendChild(original.kcfAttachBtn);
  composer.appendChild(original.kcfModeSwitchBtn);
  composer.appendChild(original.kcfVoiceBtn);
  photoArea.appendChild(original.kcfPhotoPreview);
  const hosts={};
  for(const id of ['kcfTeacherSheetAttachHost','kcfTeacherSheetModeHost','kcfTeacherSheetVoiceHost','kcfTeacherSheetPhotoHost'])hosts[id]=new Node(id);
  const doc={
    getElementById(id){return original[id]||hosts[id]||null;},
    createComment(text){return new Node(text);}
  };
  const state={open:true,portaledControls:[]};
  let voiceCalls=0,closeCalls=0;
  const global={KcfVoiceTranscription:{toggle(){voiceCalls++;}}};
  let restore;
  const close=()=>{closeCalls++;state.open=false;restore();};
  const funcs=new Function('document','state','global','close','function sheetHost(id){return document.getElementById(id);}\n'+sheet.slice(start,end)+'\nreturn {mountSheetControls,restoreSheetControls};')(doc,state,global,close);
  restore=funcs.restoreSheetControls;
  funcs.mountSheetControls();
  assert.equal(state.portaledControls.length,4);
  assert.equal(original.kcfAttachBtn.parentNode,hosts.kcfTeacherSheetAttachHost);
  assert.equal(original.kcfModeSwitchBtn.parentNode,hosts.kcfTeacherSheetModeHost);
  assert.equal(original.kcfVoiceBtn.parentNode,hosts.kcfTeacherSheetVoiceHost);
  assert.equal(original.kcfPhotoPreview.parentNode,hosts.kcfTeacherSheetPhotoHost);
  const mic=original.kcfVoiceBtn;
  const handler=mic.events.find(e=>e.type==='click'&&e.capture===true);
  assert.ok(handler);
  let prevented=false,stopped=false;
  handler.handler({preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}});
  assert.ok(prevented&&stopped);
  assert.equal(closeCalls,1);
  assert.equal(voiceCalls,1);
  assert.equal(state.portaledControls.length,0);
  assert.equal(mic.parentNode,composer);
  assert.equal(original.kcfAttachBtn.parentNode,composer);
  assert.equal(original.kcfModeSwitchBtn.parentNode,composer);
  assert.equal(original.kcfPhotoPreview.parentNode,photoArea);
  assert.equal(composer.children.map(c=>c.id).join(','),'kcfAttachBtn,kcfModeSwitchBtn,kcfVoiceBtn');
  // Reopening must not duplicate handlers or markers.
  state.open=true;
  funcs.mountSheetControls();
  assert.equal(mic.events.filter(e=>e.type==='click').length,1);
  funcs.restoreSheetControls();
  assert.equal(composer.children.map(c=>c.id).join(','),'kcfAttachBtn,kcfModeSwitchBtn,kcfVoiceBtn');
});

test('no-students guide reacts only to a confirmed empty roster, not loading, error, or finished entries',()=>{
  const runtime=fs.readFileSync('kcf-auto-mode-runtime.js','utf8');
  const start=runtime.indexOf('function renderAutoRoster() {');
  const end=runtime.indexOf('function syncAutoButton()',start);
  assert.ok(start>0&&end>start);
  const guide={hidden:true};
  const sheetHost={hidden:true};
  const roster={hidden:true,querySelector(){return scroller;}};
  const scroller={children:[],_html:'',set innerHTML(value){this._html=value;this.children=[];},get innerHTML(){return this._html;},appendChild(child){this.children.push(child);}};
  const state={enabled:true,queue:[],rosterStatus:'empty',completedIds:new Set(),selectedStudentId:''};
  const doc={getElementById(id){return id==='kcfTeacherSheetRosterHost'?sheetHost:id==='kcfTeacherSheetEmptyRosterGuide'?guide:null;},createElement(tag){return {tagName:tag,dataset:{},attributes:{},setAttribute(n,v){this.attributes[n]=v;},addEventListener(){},textContent:'',className:''};}};
  const render=new Function('state','document','ensureAutoRoster','clean','global','selectAutoStudent',
    runtime.slice(start,end)+'return renderAutoRoster;')(state,doc,()=>roster,v=>String(v||'').trim(),{__kcfSelectedStudentId:''},()=>{});
  render();
  assert.equal(guide.hidden,false);
  assert.equal(sheetHost.hidden,true);
  assert.equal(roster.hidden,true);
  assert.equal(scroller.children.length,0);
  state.rosterStatus='loading';
  render();
  assert.equal(guide.hidden,true);
  state.rosterStatus='error';
  render();
  assert.equal(guide.hidden,true);
  state.rosterStatus='ready';
  state.queue=[{studentId:'s1',name:'서아',timeSlot:16}];
  render();
  assert.equal(guide.hidden,true);
  assert.equal(sheetHost.hidden,false);
  assert.equal(roster.hidden,false);
  assert.equal(scroller.children[0].textContent,'서아');
  state.completedIds.add('s1');
  render();
  assert.equal(guide.hidden,true);
  assert.equal(scroller.children[0].textContent,'오늘 학생 선택 완료');
  state.rosterStatus='empty';
  state.queue=[];
  render();
  assert.equal(guide.hidden,false);
  state.enabled=false;
  render();
  assert.equal(guide.hidden,true);
  assert.equal(roster.hidden,true);
  assert.match(runtime, /state\.rosterStatus = 'loading';\s*if \(state\.enabled\) renderAutoRoster\(\);/);
  assert.match(runtime, /state\.rosterStatus = 'error';[\s\S]*?if \(state\.enabled\) renderAutoRoster\(\);/);
});
test('mode selector uses a real vector chevron, not a text glyph',()=>{
  assert.match(html, /class="kcfModeChevron" viewBox="0 0 24 24"/);
  assert.match(html, /<path d="m6 9 6 6 6-6"\/>/);
  assert.doesNotMatch(html, /kcfModeChevron">⌄/);
  assert.match(sheetCss, /\.kcfModeChevron\{flex:0 0 13px;width:13px;height:13px;fill:none;stroke:currentColor;/);
});

test('Today Records title aligns with observation roster title left edge',()=>{
  const observationOuterPadding=18,observationHeaderMargin=2,observationTitleShift=10;
  const target=observationOuterPadding+observationHeaderMargin+observationTitleShift;
  const todayOuterPadding=18,todayHeadPadding=12;
  assert.equal(target,todayOuterPadding+todayHeadPadding);
  assert.match(todayCss, /padding:0 2px 15px 12px;/);
});

test('close restores controls and closes state before blurring the textarea',()=>{
  assert.match(sheet, /if \(shouldSync\) syncToBase\(\);[\s\S]*?state\.open = false;[\s\S]*?activeEditor\.blur\(\)/);
  assert.match(sheet, /restoreRoster\(\);\s*restoreSheetControls\(\);/);
  assert.match(sheet, /entry\.marker\.parentNode\.insertBefore\(entry\.node,entry\.marker\)/);
});
