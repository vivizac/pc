'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('index.html', 'utf8');
const sheet = fs.readFileSync('kcf-teacher-sheet.js', 'utf8');
const sheetCss = fs.readFileSync('kcf-teacher-sheet.css', 'utf8');
const autoCss = fs.readFileSync('kcf-auto-mode.css', 'utf8');
const feedbackCss = fs.readFileSync('kinder-feedback.css', 'utf8');
const todayCss = fs.readFileSync('kcf-today-records.css', 'utf8');

test('the original Plus and microphone remain present and visible in the idle toolbar',()=>{
  assert.match(html, /id="kcfAttachBtn"/);
  assert.match(html, /id="kcfVoiceBtn"/);
  assert.match(html, /id="kcfModeSwitchBtn"/);
  assert.doesNotMatch(autoCss, /kcfTeacherRosterMode \.kcfComposerBottom \{/);
  assert.match(feedbackCss, /\.kcfAttachBtn \{[\s\S]*?display:inline-flex;/);
  assert.match(feedbackCss, /\.kcfVoiceBtn \{[\s\S]*?display:inline-flex;/);
  assert.doesNotMatch(autoCss, /\.kcfVoiceBtn \{\s*display:none;/);
  assert.doesNotMatch(autoCss, /\.kcfAttachBtn \{\s*display:none;/);
});

test('active sheet has the same five control slots, reusing existing DOM nodes',()=>{
  assert.match(sheet, /id="kcfTeacherSheetAttachHost"/);
  assert.match(sheet, /id="kcfTeacherSheetModeHost"/);
  assert.match(sheet, /id="kcfTeacherSheetRosterHost"/);
  assert.doesNotMatch(sheet, /kcfTeacherSheetEmptyRosterGuide/);
  assert.doesNotMatch(sheet, /오늘 수업 기록 학생이 없습니다\./);
  assert.match(sheetCss, /\.kcfTeacherSheetRosterHost\[hidden\]\{display:none;\}/);
  assert.match(sheet, /teacherMode\.refreshRoster\(\)/);
  assert.doesNotMatch(sheetCss, /#kcfTeacherSheetEmptyRosterGuide/);
  assert.match(sheet, /id="kcfTeacherSheetVoiceHost"/);
  assert.match(sheet, /id="kcfTeacherSheetSendBtn"/);
  // + → roster → mode → microphone → send, also while active.
  assert.ok(sheet.indexOf('id="kcfTeacherSheetRosterHost"') < sheet.indexOf('class="kcfTeacherSheetBottom"'));
  assert.ok(sheet.indexOf('id="kcfTeacherSheetAttachHost"') < sheet.indexOf('id="kcfTeacherSheetModeHost"'));
  assert.ok(sheet.indexOf('class="kcfTeacherSheetSpacer"') < sheet.indexOf('id="kcfTeacherSheetModeHost"'));
  assert.ok(sheet.indexOf('id="kcfTeacherSheetModeHost"') < sheet.indexOf('id="kcfTeacherSheetVoiceHost"'));
  assert.ok(sheet.indexOf('id="kcfTeacherSheetVoiceHost"') < sheet.indexOf('id="kcfTeacherSheetSendBtn"'));
  assert.match(sheetCss, /\.kcfTeacherSheetBottom \{[\s\S]*?display:flex;/);
  assert.match(sheetCss, /\.kcfTeacherSheetSpacer\{flex:1 1 auto;min-width:0;\}/);
  assert.doesNotMatch(sheetCss, /grid-template-columns:33px minmax\(0,1fr\) 88px 33px 33px;/);
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

test('empty student state keeps all four original buttons aligned, with no extra guide',()=>{
  const bottomStart=sheet.indexOf("'    <div class=\"kcfTeacherSheetBottom\">'");
  const bottomEnd=sheet.indexOf("'    </div>'",bottomStart);
  assert.ok(bottomStart>0&&bottomEnd>bottomStart);
  const bottomMarkup=sheet.slice(bottomStart,bottomEnd);
  const order=['kcfTeacherSheetAttachHost','kcfTeacherSheetModeHost','kcfTeacherSheetVoiceHost','kcfTeacherSheetSendBtn'];
  const offsets=order.map(id=>bottomMarkup.indexOf('id="'+id+'"'));
  assert.ok(offsets.every(n=>n>=0));
  assert.ok(offsets.every((value,i)=>i===0||offsets[i-1]<value));
  assert.match(sheetCss, /\.kcfTeacherSheetBottom \{[\s\S]*?display:flex;/);
  assert.match(sheetCss, /\.kcfTeacherSheetSpacer\{flex:1 1 auto;min-width:0;\}/);
  assert.match(sheetCss, /#kcfTeacherSheetModeHost\{flex:0 0 auto;\}/);
  assert.match(sheetCss, /#kcfTeacherSheetVoiceHost\{flex:0 0 33px;\}/);
  assert.match(sheetCss, /#kcfTeacherSheetAttachHost \.kcfAttachBtn svg\{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1\.7;/);
  assert.match(sheetCss, /\.kcfTeacherSheetSendBtn\{flex:0 0 33px;\}/);
  assert.doesNotMatch(sheetCss, /grid-template-rows:40px;/);
  assert.doesNotMatch(sheetCss, /kcfTeacherSheetEmptyRosterGuide/);
  assert.doesNotMatch(bottomMarkup, /오늘 수업 기록 학생이 없습니다/);
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

test('empty roster has no inline guide, while existing student cards and completed status still render',()=>{
  const runtime=fs.readFileSync('kcf-auto-mode-runtime.js','utf8');
  const start=runtime.indexOf('function renderAutoRoster() {');
  const end=runtime.indexOf('function syncAutoButton()',start);
  assert.ok(start>=0&&end>start);
  const sheetHost={hidden:true};
  const roster={hidden:true,querySelector(){return scroller;}};
  const scroller={children:[],set innerHTML(_){this.children=[];},appendChild(c){this.children.push(c);}};
  const state={enabled:true,queue:[],rosterStatus:'empty',completedIds:new Set(),selectedStudentId:''};
  const document={getElementById(id){return id==='kcfTeacherSheetRosterHost'?sheetHost:null;},
    createElement(){return {dataset:{},setAttribute(){},addEventListener(){},textContent:''};}};
  const render=new Function('state','document','ensureAutoRoster','clean','global','selectAutoStudent',
    runtime.slice(start,end)+'return renderAutoRoster;')(state,document,()=>roster,v=>String(v||'').trim(),{__kcfSelectedStudentId:''},()=>{});
  render();
  assert.equal(sheetHost.hidden,true);
  assert.equal(roster.hidden,true);
  assert.equal(scroller.children.length,0);
  state.rosterStatus='ready';
  state.queue=[{studentId:'s1',name:'서아',timeSlot:16}];
  render();
  assert.equal(sheetHost.hidden,false);
  assert.equal(roster.hidden,false);
  assert.equal(scroller.children[0].textContent,'서아');
  state.completedIds.add('s1');
  render();
  assert.equal(scroller.children[0].textContent,'오늘 학생 선택 완료');
  state.enabled=false;
  render();
  assert.equal(roster.hidden,true);
  assert.doesNotMatch(runtime, /kcfTeacherSheetEmptyRosterGuide/);
});

test('active QuickNote placeholder matches Team Chat size and elides only when narrow',()=>{
  const from=sheet.indexOf('  function fitEditorPlaceholder(){');
  const to=sheet.indexOf('  function syncFromBase(options){',from);
  assert.ok(from>=0&&to>from);
  const fakeInput={clientWidth:200,placeholder:''};
  const fakeContext={font:'',measureText(text){return {width:String(text).length*10};}};
  const state={placeholderCanvas:null};
  const fakeDocument={createElement(tag){assert.equal(tag,'canvas');return {getContext(){return fakeContext;}};}};
  const fakeGlobal={getComputedStyle(){return {paddingLeft:'8px',paddingRight:'8px',fontWeight:'400',fontSize:'16px',fontFamily:'sans-serif'};}};
  const fit=new Function('editor','state','document','global',
    sheet.slice(from,to)+'\nreturn fitEditorPlaceholder;')(()=>fakeInput,state,fakeDocument,fakeGlobal);
  fit();
  assert.equal(fakeInput.placeholder,'수업기록을 적어주세요');
  fakeInput.clientWidth=74;
  fit();
  assert.ok(fakeInput.placeholder.endsWith('…'));
  assert.ok(fakeInput.placeholder.length < '수업기록을 적어주세요'.length);
  assert.ok(fakeContext.measureText(fakeInput.placeholder).width <= 54);
  assert.match(sheetCss,/\.kcfTeacherSheetInput::placeholder \{[\s\S]*?font-size:calc\(14\.5px \* var\(--olli-text-scale, 1\)\)/);
  assert.doesNotMatch(sheet,/학생 이름과 수업기록을 적어주세요/);
});

test('Today Records title uses the same safe-area top anchor as observation student list',()=>{
  const observation=fs.readFileSync('olli-observation-roster-phone.css','utf8');
  assert.ok(observation.includes('var(--vivizac-note-header-h'));
  assert.match(observation,/padding:calc\(var\(--vivizac-note-header-h\) \+ max\(18px, calc\(env\(safe-area-inset-top\) \+ 6px\)\) \+ 6px\)/);
  assert.match(todayCss,/padding:calc\(var\(--vivizac-note-header-h, 60px\) \+ max\(18px, calc\(env\(safe-area-inset-top\) \+ 6px\)\) \+ 8px\)/);
  assert.match(todayCss,/padding:0 2px 15px 12px;/);
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
