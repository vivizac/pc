'use strict';
const test = require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const mobile=read('apps/mobile/olli-student-core.js');
const pcSummary=read('apps/pc/olli-data-consultation-summary.js');
const pcUi=read('apps/pc/pc-student-management.js');
const extract=(source,start,end)=>{
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'Function section not found '+start);
  return source.slice(a,b);
};
test('mobile shows 자료부족 before any server response, and ready cache wins while refreshing',()=>{
  const code=extract(mobile,'function getAcademyConsultationSummaryItemByKey(key) {','function getAcademyConsultationSummaryItem(student, months)');
  const saved={status:'ready',content:'saved'};
  const state={transientItems:{}};
  const data={items:{}};
  const sandbox={
    academyConsultationSummaryState:state,
    readAcademyConsultationSummarySnapshot:()=>data,
    normalizeAcademyConsultationSummaryStableItem:x=>x||null,
    window:{OlliConsultationServer:{readCachedStatus:()=>null}}
  };
  vm.runInNewContext(code+';this.getItem=getAcademyConsultationSummaryItemByKey;',sandbox);
  assert.equal(sandbox.getItem('student').status,'insufficient');
  data.items.student=saved;
  assert.equal(sandbox.getItem('student'),saved);
  state.transientItems.student={status:'generating'};
  assert.equal(sandbox.getItem('student'),saved);
  state.transientItems.student={status:'checking'};
  assert.equal(sandbox.getItem('student'),saved);
});
test('mobile status labels map checking/generating to the existing 자료부족 chip',()=>{
  const code=extract(mobile,'function getAcademyConsultationSummaryStatusLabel(status) {','function isSummaryFeedbackRowForMonth(');
  const s={};vm.runInNewContext(code+';this.label=getAcademyConsultationSummaryStatusLabel;this.display=getAcademyConsultationSummaryDisplayStatus;',s);
  for(const status of ['checking','generating','insufficient','']) {
    assert.equal(s.label(status),'자료부족');
    assert.equal(s.display(status),'insufficient');
  }
  assert.equal(s.label('ready'),'준비완료');
  assert.equal(s.display('ready'),'ready');
});
test('PC first paints insufficient or cached ready without confirmation spinner',()=>{
  const code=extract(pcUi,'function consultationStatusChipHtml(student, labels) {','function updateConsultationStatusChip(');
  const map=new Map();
  const sandbox={consultationStatusCache:map,consultationStatusKey:()=> 'case',global:{OlliConsultationServer:{readCachedStatus:()=>null}}};
  vm.runInNewContext(code+';this.chip=consultationStatusChipHtml;',sandbox);
  assert.match(sandbox.chip({},[]),/자료부족/);
  assert.doesNotMatch(sandbox.chip({},[]),/확인중/);
  map.set('case',{status:'ready'});
  assert.match(sandbox.chip({},[]),/준비완료/);
});
test('PC and mobile background checks never replace local ready status with checking',()=>{
  for(const source of [mobile,pcSummary]){
    const code=extract(source,'async function runAcademyConsultationSummaryAutoCheck()', 'window.toggleAcademyConsultationSummaryPreview =');
    assert.doesNotMatch(code,/setAcademyConsultationSummaryItem\(key,\s*\{[^}]*status:\s*'checking'/);
    assert.match(code,/getAcademyConsultationSummaryItem/);
  }
});
