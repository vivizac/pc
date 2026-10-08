'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const feedback=fs.readFileSync('kinder-feedback.js','utf8');
const sheet=fs.readFileSync('kcf-teacher-sheet.js','utf8');
const page=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('kcf-today-records.css','utf8');

function makeHarness(initialItems){
  const items=initialItems.map(item=>({...item}));
  let listener=null, copied=0, edited='', opened=0;
  const view={scrollTop:24,contains(){return true},addEventListener(type,handler){if(type==='click')listener=handler}};
  const list={innerHTML:''},summary={textContent:''};
  const document={
    getElementById(id){return {kcfTodayRecordsView:view,kcfTodayRecordsItems:list,kcfTodayRecordsSummary:summary}[id]||null;},
    querySelector(selector){
      if(selector.startsWith('#kcfInboxOverlay [data-kcf-feedback-id'))return {scrollIntoView(){}};
      return null;
    }
  };
  const escapes={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'};
  const escapeHtml=value=>String(value).replace(/[&<>"]/g,c=>escapes[c]);
  const from=feedback.indexOf("let kcfTodayRecordsExpandedId = ''");
  const to=feedback.indexOf('window.renderKinderChatFeedbackTodayRecords = renderKinderChatFeedbackTodayRecords;',from);
  assert.ok(from>=0 && to>from);
  const dependencies=[
    document,()=>items,text=>String(text||'').includes('CHECK_ME')?['issue']:[],()=>false,
    escapeHtml,()=>'',escapeHtml,()=>'<svg></svg>',
    async id=>{copied++;items.find(item=>item.id===id).copiedAt='2026-10-08T12:00:00Z';return true;},
    ()=>{opened++;}, fn=>fn(),id=>{edited=id;},()=>null,async()=>true,async()=>true,{escape:String}
  ];
  const names=['document','getKinderChatFeedbackTodayItems','getSuspiciousFeedbackSegments',
    'isTodayFeedbackLoadFailItem','renderSuspiciousFeedbackText','buildTodayFeedbackIssueHtml',
    'escapeHtml','getKinderChatFeedbackInboxCopyIconSvg','copyKinderChatFeedbackInbox',
    'openKinderChatFeedbackInbox','requestAnimationFrame','editKinderChatFeedbackInboxItem',
    'getKinderChatFeedbackLiveItem','saveKinderChatFeedbackLive','saveTodayFeedbackItem','CSS'];
  const render=new Function(...names,feedback.slice(from,to)+'\nreturn renderKinderChatFeedbackTodayRecords;')(...dependencies);
  const tap=(id,action)=>{
    assert.ok(listener);
    const button={dataset:{kcfRecordId:id,kcfRecordAction:action},disabled:false};
    listener({target:{closest(){return button;}}});
    return button;
  };
  return {render,tap,list,summary,view,items,get copied(){return copied},get edited(){return edited},get opened(){return opened}};
}
const first={id:'job-a',studentName:'서아',createdAt:'2026-10-08T10:00:00Z',
  status:'done',saved:true,resultText:'수업 피드백',copiedAt:''};
const second={id:'job-b',studentName:'하린',createdAt:'2026-10-08T10:01:00Z',
  status:'streaming',resultText:'',copiedAt:'',trialSessionId:'trial-123'};

test('mode switch uses a separate Today Records surface, not a chat row style hack',()=>{
  assert.match(page,/id="kcfChatArea"/);
  assert.match(page,/id="kcfTodayRecordsView"[^>]*hidden/);
  assert.match(page,/kcf-today-records\.css\?v=20261008-top-match-2/);
  assert.match(sheet,/todayView\.hidden = !continuous;/);
  assert.match(css,/body\.kcfContinuousMode #kinderChatFeedbackScreen \.kcfChatArea\{display:none;\}/);
  assert.match(css,/body\.kcfContinuousMode #kinderChatFeedbackScreen \.kcfTodayRecordsView:not\(\[hidden\]\)\{display:block;\}/);
});

test('collapsed card has a right-hand copy control and live status without exposing draft text',()=>{
  const h=makeHarness([first,second]);
  h.render();
  assert.match(h.list.innerHTML,/서아/);
  assert.match(h.list.innerHTML,/하린 <small>· 체험<\/small>/);
  assert.match(h.list.innerHTML,/AI 작성 중/);
  assert.ok(h.list.innerHTML.indexOf('data-kcf-record-action="copy"')>0);
  assert.doesNotMatch(h.list.innerHTML,/class="kcfTodayRecordDetail"/);
  assert.match(h.list.innerHTML,/data-kcf-record-id="job-b"[^>]*disabled/);
  assert.match(h.summary.textContent,/2건 · 작성 중 1/);
  assert.equal(h.view.scrollTop,24);
});

test('successful copy persists blue marker through a new render without expanding the card',async()=>{
  const h=makeHarness([first]);
  h.render();
  assert.doesNotMatch(h.list.innerHTML,/kcfTodayRecordCopy copied/);
  h.tap('job-a','copy');
  await Promise.resolve();
  await Promise.resolve();
  h.render();
  assert.equal(h.copied,1);
  assert.match(h.list.innerHTML,/kcfTodayRecordCopy copied/);
  assert.match(css,/\.kcfTodayRecordCopy\.copied\{background:#0A84FF;border-color:#0A84FF;color:#fff;\}/);
  assert.doesNotMatch(h.list.innerHTML,/class="kcfTodayRecordDetail"/);
});

test('detail expands in place and editing reuses the existing Inbox editor',()=>{
  const h=makeHarness([first]);
  h.render();
  h.tap('job-a','toggle');
  assert.match(h.list.innerHTML,/class="kcfTodayRecordDetail"/);
  assert.match(h.list.innerHTML,/수업 피드백/);
  h.tap('job-a','edit');
  assert.equal(h.opened,1);
  assert.equal(h.edited,'job-a');
});

test('the Today view uses original queue, original clipboard and original saved edit paths',()=>{
  assert.match(feedback,/getKinderChatFeedbackTodayItems\(\)\.slice\(\)\.sort/);
  assert.match(feedback,/copyKinderChatFeedbackInbox\(id\)\.then/);
  assert.match(feedback,/openKinderChatFeedbackInbox\(\);/);
  assert.match(feedback,/editKinderChatFeedbackInboxItem\(id\);/);
  assert.match(feedback,/item\.copiedAt/);
  assert.match(feedback,/copiedAt: nextText === item\.resultText \? item\.copiedAt : ''/);
  assert.match(feedback,/originalItem\?\.trialSessionId/);
  assert.match(feedback,/trialSessionId:String\(item\.trialSessionId \|\| ''\)/);
  assert.doesNotMatch(css,/#kcfInboxOverlay \.kcfInboxCard\{display:none/);
});
