'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const base=path.resolve(__dirname,'..');
const shared=fs.readFileSync(path.join(base,'packages/common/olli-student-weekend-badge.js'),'utf8');
const pc=fs.readFileSync(path.join(base,'apps/pc/olli-record-list-view.js'),'utf8');
const mobile=fs.readFileSync(path.join(base,'apps/mobile/olli-observation-roster-phone.js'),'utf8');

function context(){
 const window={};
 vm.runInNewContext(shared,{window});
 return window;
}
const example={id:'00000000-0000-4000-8000-000000000001',name:'민기',
 school:'한샘',grade:2,group:1,lesson_day:'토'};

test('PC observation roster keeps weekend capsules beside names, not in guide text',()=>{
 const globals=context();
 const from=pc.indexOf('function renderPcRosterGuide(');
 const to=pc.indexOf('function renderElementaryStudentRows(',from);
 assert.ok(from>=0&&to>from);
 const runner=vm.runInNewContext(pc.slice(from,to)+'\nrenderPcRosterGuide;',{
  renderOlliStudentRosterGuideMeta:globals.renderOlliStudentRosterGuideMeta,
  renderOlliStudentRosterMarkers:globals.renderOlliStudentRosterMarkers,
  escapeHtml:value=>String(value)
 });
 const output=runner(example,'한샘/2학년/발송월10월',null,true);
 assert.equal(output,'한샘/2학년/발송월10월');
 assert.equal(runner(example,'한샘/2학년/발송월10월',null,false),'한샘/2학년/발송월10월');
 assert.equal(runner(example,'','한샘/2학년/발송월10월',true),'한샘/2학년/발송월10월');
 const badges=globals.renderOlliStudentRosterMarkers(example);
 assert.match(badges,/<span class="olliStudentWeekendBadge"[^>]*>토<\/span>/);
 assert.equal((pc.match(/\$\{escapeHtml\(student.name\)\}\$\{options.showRosterMarkers === true \? renderOlliStudentRosterMarkers\(student\) : ''\}/g)||[]).length,2,
  'PC elementary and kindergarten both retain their original badge position after student name');
});
test('mobile observation puts the month on the right and keeps weekend badges in school/grade',()=>{
 const globals=context();
 const from=mobile.indexOf('function renderObservationMemoRoster()');
 const to=mobile.indexOf('function applyObservationMemoNavigationIcons()',from);
 assert.ok(from>=0&&to>from);
 const root={innerHTML:''};
 vm.runInNewContext(mobile.slice(from,to)+'\nrenderObservationMemoRoster();',{
  document:{getElementById:()=>root},
  getObservationRosterSortCriterion:()=> 'name',
  getObservationRosterStudentsForCurrentSort:()=>[example],
  getObservationRosterSortLabel:()=> '이름',
  getObservationRosterMeta:()=> '한샘/2학년',
  getObservationRosterRightGuide:()=> '발송월10월',
  getObservationRosterSectionKey:()=> '1',
  renderOlliStudentRosterGuideMeta:globals.renderOlliStudentRosterGuideMeta,
  renderOlliStudentRosterMarkers:globals.renderOlliStudentRosterMarkers,
  renderOlliStudentGroupUnsetGuideMarker:globals.renderOlliStudentGroupUnsetGuideMarker,
  escapeHtml:value=>String(value),
  observationRosterSearchQuery:'',
  observationRosterSearchFocused:false,
  renderObservationRosterFooter:()=> '',
  bindObservationRosterFooterEvents:()=>{}
 });
 assert.match(root.innerHTML,/<span class="memoBodyRosterName">민기<\/span>/);
 assert.match(root.innerHTML,/<span class="memoBodyRosterMeta">한샘\/2학년<span class="olliStudentWeekendBadge"[^>]*>토<\/span><\/span>/);
 assert.match(root.innerHTML,/<span class="memoBodyRosterSideMeta">발송월10월<\/span>/);
 assert.equal((root.innerHTML.match(/발송월10월/g)||[]).length,1,'month must only appear on right');
 assert.equal((root.innerHTML.match(/olliStudentWeekendBadge/g)||[]).length,1);
});
test('Saturday and Sunday markers stay in order; missing month remains before the badges',()=>{
 const api=context();
 const weekends={...example,group:'',lesson_day:'토 일'};
 const guide=api.renderOlliStudentRosterGuideMeta(weekends,'한샘 / 2학년 / 발송월10월');
 const output=guide+api.renderOlliStudentRosterMarkers(weekends);
 assert.match(output,/한샘 \/ 2학년 \/ <span class="olliStudentFeedbackMonthUnset">발송월 미정<\/span>/);
 assert.ok(output.indexOf('발송월 미정')<output.indexOf('olliStudentWeekendBadge'));
 assert.deepEqual(api.getOlliStudentWeekendDays(weekends).join(','),'토,일');
 assert.equal((output.match(/olliStudentWeekendBadge/g)||[]).length,2);
 assert.equal(api.renderOlliStudentRosterMarkers({...example,lesson_day:'월'}),'');
});

test('students without an assigned group show a blue star at the end of the name-side guide',()=>{
 const api=context();
 const unset={...example,group:'',group_no:0,groupNo:''};
 const marker=api.renderOlliStudentGroupUnsetGuideMarker(unset);
 assert.ok(marker.includes('class="olliStudentGroupUnsetGuideMarker"'));
 assert.ok(marker.endsWith('>*</span>'));
 assert.equal(api.renderOlliStudentGroupUnsetGuideMarker(example),'');
 assert.equal(api.renderOlliStudentGroupUnsetGuideMarker({...unset,group_no:2}),'');
 assert.equal(pc.split('renderOlliStudentGroupUnsetGuideMarker(student)').length-1,2);
 assert.ok(mobile.includes('escapeHtml(meta) + renderOlliStudentGroupUnsetGuideMarker(student)'));
 const css=fs.readFileSync(path.join(base,'packages/common/olli-student-weekend-badge.css'),'utf8');
 assert.ok(css.includes('color:#0A84FF !important;'));
});

test('mobile observation roster uses a 1px black divider equal to gray rows only at sort boundaries',()=>{
 const css=fs.readFileSync(path.join(base,'apps/mobile/olli-observation-roster-phone.css'),'utf8');
 const html=fs.readFileSync(path.join(base,'apps/mobile/index.html'),'utf8');
 const normal=css.match(/#observationRosterScreen \.memoBodyRosterRow \+ \.memoBodyRosterRow \{([^}]*)\}/)?.[1];
 const section=css.match(/#observationRosterScreen \.memoBodyRosterRow \+ \.memoBodyRosterRow\.memoBodyRosterSectionStart \{([^}]*)\}/)?.[1];
 assert.ok(normal,'ordinary adjacent student rows must retain their divider');
 assert.ok(section,'section-start override must remain defined');
 assert.match(normal,/border-top:\s*1px solid #eeeeee\s*;/,'ordinary rows keep original faint line');
 assert.match(section,/border-top:\s*1px solid #000000\s*;/,'group boundary must match the 1px gray divider');
 assert.match(mobile,/memoBodyRosterRow\$\{newSection \? ' memoBodyRosterSectionStart' : ''\}/,
   'section-start modifier must still be applied only when sort key changes');
 assert.match(html,/olli-observation-roster-phone\.css\?v=20261108-header-gap-35px-1/,
   'bust old stylesheet cache on mobile');
});
