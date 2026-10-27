'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const pc=read('apps/pc/pc-student-info-card-runtime.js');
const phoneElementary=read('apps/mobile/olli-phone-elementary-student-info-card.js');
const phoneKinder=read('apps/mobile/olli-phone-kinder-student-info-card.js');
const commonTuition=read('packages/common/olli-tuition-common.css');
const commonGuardian=read('packages/common/olli-student-guardian-contact.css');
const commonFinance=read('packages/common/olli-teacher-payroll-common.css');
const pcHtml=read('apps/pc/index.html');
const phoneHtml=read('apps/mobile/index.html');

function section(source,start,end){
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'source function boundaries '+start);
 return source.slice(a,b);
}
function assertFields(source,kind,ids){
 const fn=kind==='elementary'?'elementaryCardHtml':'kinderCardHtml';
 const html=section(source,source===pc?'  function '+fn+'(student) {':'  function cardHtml(student) {',
   source===pc?(kind==='elementary'?'  function studentInfoScheduleHtml(':'  function setDateInputs('):'  function ensureModal(student)');
 const rowStart=html.indexOf('<div class="pcStudentInfoGrid3">');
 const untilSchedule=html.indexOf('<div class="pcStudentInfoSchedule"',rowStart);
 assert.ok(rowStart>=0&&untilSchedule>rowStart);
 const rows=html.slice(rowStart,untilSchedule).split('<div class="pcStudentInfoGrid3">').slice(1);
 assert.equal(rows.length,2,'two profile rows');
 const beforeSchedule=rows.join('');
 for(const [i,id] of ids.entries()){
   const at=beforeSchedule.indexOf('id="'+id+'"');
   assert.ok(at>=0,'missing '+id);
   if(i)assert.ok(at>beforeSchedule.indexOf('id="'+ids[i-1]+'"'),'correct field order '+id);
 }
 assert.match(rows[1],/type="date"/);
 assert.equal((rows[1].match(/type="date"/g)||[]).length,1,'one date control');
 assert.doesNotMatch(beforeSchedule,/id="(?:elementaryInfo|kinderInfo)(?:Year|Month|Day)Input"/);
}
test('PC elementary and kindergarten display both requested rows in exactly the same order',()=>{
 assertFields(pc,'elementary',['elementaryInfoNameInput','elementarySchoolInput','elementaryGradeInput','pcStudentInfoFeedbackTeacher','elementaryPersonalityToggleRow','elementaryInfoEnrolledAtInput']);
 assertFields(pc,'kinder',['kinderInfoNameInput','kinderKindergartenInput','kinderAgeInput','pcStudentInfoFeedbackTeacher','kinderPersonalityToggleRow','kinderInfoEnrolledAtInput']);
});
test('mobile elementary and kindergarten display the matching profile order',()=>{
 assertFields(phoneElementary,'elementary',['elementaryInfoNameInput','elementarySchoolInput','elementaryGradeInput','elementaryInfoFeedbackTeacher','elementaryPersonalityToggleRow','elementaryInfoEnrolledAtInput']);
 assertFields(phoneKinder,'kinder',['kinderInfoNameInput','kinderKindergartenInput','kinderAgeInput','kinderInfoFeedbackTeacher','kinderPersonalityToggleRow','kinderInfoEnrolledAtInput']);
 assert.match(phoneElementary,/<input id="elementaryAgeInput" type="hidden"/);
});
function dateHarness(source,marker,end,identifier){
 const document={
  value:'',
  getElementById(id){assert.equal(id,identifier);return this.input},
  input:{value:''}
 };
 const js=section(source,marker,end);
 const names=['document','clean','Date',js+';return {setDate:typeof setDate===\'function\'?setDate:null,readDate:typeof readDate===\'function\'?readDate:null,setDateInputs:typeof setDateInputs===\'function\'?setDateInputs:null,readDateInputs:typeof readDateInputs===\'function\'?readDateInputs:null};'];
 const helpers=new Function(...names)(document,value=>String(value==null?'':value).trim(),Date);
 return {document,helpers};
}
test('PC date round-trip retains the existing server payload and rejects invalid days',()=>{
 for(const prefix of ['elementaryInfo','kinderInfo']){
  const h=dateHarness(pc,'  function studentInfoEnrolledDate(', '  async function renderStudentInfoCard(',prefix+'EnrolledAtInput');
  h.helpers.setDateInputs(prefix,{enrolled_at:'2026-03-25'});
  assert.equal(h.document.input.value,'2026-03-25');
  assert.deepEqual(h.helpers.readDateInputs(prefix),{year:2026,month:'3',day:'25',enrolled_at:'2026-03-25'});
  h.document.input.value='2026-02-30';
  assert.equal(h.helpers.readDateInputs(prefix),null);
  h.document.input.value='2024-02-29';
  assert.equal(h.helpers.readDateInputs(prefix).enrolled_at,'2024-02-29');
 }
});
test('mobile date round-trip saves unchanged enrolment metadata and validates real dates',()=>{
 for(const [source,prefix,end] of [[phoneElementary,'elementaryInfo','  function renderPersonality(student)'],[phoneKinder,'kinderInfo','  function renderPersonalityFallback(student)']]){
  const h=dateHarness(source,'  function setDate(student)',end,prefix+'EnrolledAtInput');
  h.helpers.setDate({enrolled_at:'2026-03-25'});
  assert.equal(h.document.input.value,'2026-03-25');
  assert.deepEqual(h.helpers.readDate(),{year:2026,month:'3',day:'25',enrolled_at:'2026-03-25'});
  h.document.input.value='2026-02-30';
  assert.throws(()=>h.helpers.readDate(),/등록 날짜/);
  h.document.input.value='2024-02-29';
  assert.equal(h.helpers.readDate().enrolled_at,'2024-02-29');
 }
});
test('grey-blue tuition, guardian, and finances retain error semantics',()=>{
 assert.match(commonTuition,/background:\s*#0A84FF/);
 assert.doesNotMatch(commonTuition,/#172c29|#f1f5f4|#52655d/i);
 assert.match(commonGuardian,/accent-color:\s*#0A84FF/);
 assert.doesNotMatch(commonGuardian,/#4f8877|#53655f|#263f36/i);
 assert.match(commonFinance,/\.olliPayrollPage\{[^}]*background:#F7F9FC/);
 assert.doesNotMatch(commonFinance,/#f3f8f6|#647b72|#f0f5f3|#526b62|#526a61/i);
 assert.match(commonFinance,/\.olliFinanceSummaryStatus\{[^}]*background:#EEF6FF/);
 assert.match(commonFinance,/\.olliFinanceSummary\.is-incomplete/,'financial incomplete warning stays distinct');
 assert.match(commonTuition,/\.olliTuitionError/,'tuition error retains dedicated styling');
});
test('both deployed entrypoints reference refreshed CSS and corresponding student info runtimes',()=>{
 const version='20261027-student-info-bluegray-1';
 for(const html of [pcHtml,phoneHtml])for(const css of ['olli-tuition-common.css','olli-student-guardian-contact.css','olli-teacher-payroll-common.css'])assert.ok(html.includes(css+'?v='+version),css);
 for(const js of ['olli-phone-kinder-student-info-card.js','olli-phone-elementary-student-info-card.js'])assert.ok(phoneHtml.includes(js+'?v='+version));
 const pcStart=read('apps/pc/pc-start-page.js');
 assert.ok(pcHtml.includes('pc-start-page.js?v='+version));
 assert.ok(pcStart.includes('pc-student-info-card-runtime.js?v='+version));
});
