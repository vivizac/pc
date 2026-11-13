'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const shared=require('../packages/common/olli-consultation-task-core.js');
const h=require('../packages/common/api/_lib/consultation-summary-handler.cjs').__test;
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const firstStudent={type:'elementary',id:'11111111-1111-4111-8111-111111111111'};
const d=(monthDay)=>new Date(2026,9,Number(monthDay));
const rules=['after_1','after_3','every_12'];
const tasks=(day,now,firstLessonDate)=>shared.calculateOlliConsultationTasks(firstStudent,{
  now:new Date(now+'T12:00:00'),enrolled:d(day),firstLessonDate:firstLessonDate?new Date(firstLessonDate+'T00:00:00'):null,rules
});
test('first consultation: 2026-10-12 through 19 is November; 20 is December',()=>{
  for(const day of [12,15,19]){
    const row=tasks(day,'2026-11-01');
    assert.equal(row.length,1);
    assert.equal(row[0].ruleKey,'after_1');
    assert.equal(row[0].dueMonth,'2026-11');
  }
  assert.equal(tasks(20,'2026-11-01').length,0);
  const deferred=tasks(20,'2026-12-01');
  assert.equal(deferred.length,1);
  assert.equal(deferred[0].dueMonth,'2026-12');
  assert.equal(deferred[0].ruleKey,'after_1');
  assert.equal(tasks(12,'2026-12-01').length,0,'No second first-month report');
});
test('first scheduled lesson is the next weekday on or after enrollment/effective date',()=>{
  const enrolled=new Date(2026,9,15);
  const rows=[
    {effective_from:'2026-10-15',weekday:6},
    {effective_from:'2026-10-17',weekday:6}
  ];
  const date=shared.consultationFirstScheduledLessonDate(enrolled,rows);
  assert.equal(shared.consultationMonthKey(date),'2026-10');
  assert.equal(date.getDate(),17);
  const serverDate=h.firstScheduledLessonDate(enrolled,rows);
  assert.equal(serverDate.getDate(),17,'Server and UI must use same actual first lesson');
  const later=shared.consultationFirstEligibleMonth(d(19),new Date(2026,9,24));
  assert.equal(shared.consultationMonthKey(later),'2026-12',
    'Registered Oct 19 but first scheduled class Oct 24 => December consultation');
});
test('different month starting weekdays and year boundary are calculated by the second Monday',()=>{
  const nov=new Date(2026,10,1);
  assert.equal(shared.consultationSecondMonday(2026,10).getDate(),9);
  assert.equal(shared.consultationSecondMonday(2026,11).getDate(),14);
  assert.equal(shared.consultationMonthKey(shared.consultationFirstEligibleMonth(nov,new Date(2026,10,1))),'2026-12');
  assert.equal(shared.consultationMonthKey(shared.consultationFirstEligibleMonth(new Date(2026,11,31),new Date(2027,0,7))),'2027-02');
});
test('existing 3-month and annual consultation periods remain unchanged',()=>{
  const result=tasks(20,'2027-01-10');
  assert.ok(result.some(x=>x.ruleKey==='after_3'&&x.dueMonth==='2027-01'));
  assert.equal(shared.consultationFirstEligibleMonth(d(20),d(20)).getFullYear(),2026);
});
test('first elementary summary uses all recorded source types in the deferred teaching period',()=>{
 const due=h.parseMonth('2026-12');
 const records=[
   {id:1,date:'2026-10-23',feedback_type:'growth',content:'First meaningful classroom observation'},
   {id:2,date:'2026-11-16',lesson_date:'2026-11-16',feedback_type:'class',content:'Quick Note lesson'},
   {id:3,date:'2026-12-03',lesson_date:'2026-12-03',feedback_type:'class',content:'December saved lesson'},
   {id:4,date:'2026-09-29',feedback_type:'growth',content:'Before registration'}
 ];
 const selection=h.relevantRows(records,[],'elementary','after_1',due,1,new Date(2026,9,20));
 assert.equal(selection.status,'ready');
 assert.equal(selection.mode,'elementary_first_month_summary');
 assert.deepEqual(Array.from(selection.rows.map(x=>x.id)),[1,2,3]);
 assert.equal(h.relevantRows([],[],'elementary','after_1',due,1,new Date(2026,9,20)).status,'insufficient');
});
test('elementary report prompt forbids invented event dates; one source can be summarized',()=>{
 const due=h.parseMonth('2026-11');
 const result=h.relevantRows([{id:1,date:'2026-10-29',feedback_type:'growth',content:'Observed confidence during drawing'}],
  [],'elementary','after_1',due,1,new Date(2026,9,12));
 assert.equal(result.status,'ready');
 assert.equal(result.rows.length,1);
 const prompt=h.userPrompt({name:'테스트',division:'elementary',enrolled_at:'2026-10-12'},1,result.rows,'2026-11');
 assert.match(prompt,/특정 날짜\(월\/일\)를 사례에 붙이지 마세요/);
 assert.match(prompt,/기록에 없는 수업, 행동, 변화, 성과를 만들어 쓰지 마세요/);
});
test('automatic generation remains single server-owned Cron, not device double generation',()=>{
 const server=read('packages/common/api/_lib/consultation-summary-handler.cjs');
 const cron=read('packages/common/api/_lib/consultation-summary-cron.cjs');
 const policy=read('packages/common/olli-operations-consultation-policy.js');
 const pc=read('apps/pc/olli-consultation-runtime.js');
 const mobile=read('apps/mobile/olli-consultation-mobile-runtime.js');
 assert.match(server,/olli_consultation_summary_finish_with_sources/);
 assert.doesNotMatch(server,/if\(material\.mode==='elementary_one_month_records'\)/);
 assert.match(server,/action==='first_lessons'/);
 assert.match(server,/olli_consultation_progress_access/);
 assert.match(cron,/OLLI_CONSULTATION_CRON_ENABLED/);
 assert.match(cron,/CRON_SECRET/);
 assert.match(policy,/loadOlliConsultationFirstLessonsFromServer/);
 assert.match(pc,/loadOlliConsultationFirstLessonsFromServer\(\)/);
 assert.match(mobile,/loadOlliConsultationFirstLessonsFromServer\(\)/);
});
