'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const handler=require('../packages/common/api/_lib/consultation-summary-handler.cjs');
const h=handler.__test;
const f=(date,type,extra={})=>({date,feedback_type:type,content:(type==='class'?'Quick Note lesson':'Quarterly growth')+' observations',...extra});
const month=s=>h.parseMonth(s);
test('November annual summary includes previous November through October, not new November',()=>{
  const due=month('2026-11');
  const selected=h.relevantRows([
    f('2025-10-30','class'),
    f('2025-11-05','class'),
    f('2026-10-30','class'),
    f('2026-11-01','class'),
    f('2026-11-05','growth')
  ],[],'kinder','every_12',due,12);
  assert.equal(selected.status,'ready');
  assert.equal(selected.rows.length,2);
  assert.equal(h.monthKey(selected.rows[0]._reportingDate),'2025-11');
  assert.equal(h.monthKey(selected.rows[1]._reportingDate),'2026-10');
});
test('weekly class records bypass final-month growth requirement regardless of student division',()=>{
  for(const division of ['kinder','elementary']){
    const due=month('2026-11');
    const records=[
      f('2025-12-12','growth'),
      f('2026-03-10','growth'),
      f('2026-06-20','growth'),
      f('2026-09-07','class'),
      f('2026-10-21','class')
    ];
    const result=h.relevantRows(records,[],division,'every_12',due,12);
    assert.equal(result.status,'ready');
    assert.equal(result.mode,'weekly_class_records');
    assert.equal(result.rows.length,5);
    assert.equal(result.rows.filter(x=>x.feedback_type==='growth').length,3);
    assert.equal(result.rows.filter(x=>x.feedback_type==='class').length,2);
  }
});
test('growth-only annual records must include previous October growth for November due',()=>{
  const due=month('2026-11');
  const before=[f('2026-01-15','growth'),f('2026-04-15','growth'),f('2026-07-15','growth')];
  assert.equal(h.relevantRows(before,[],'elementary','every_12',due,12).status,'insufficient');
  const withLast=h.relevantRows([...before,f('2026-10-30','growth')],[],'elementary','every_12',due,12);
  assert.equal(withLast.status,'ready');
  assert.equal(withLast.mode,'quarterly_growth_records');
  // A current-November growth record cannot masquerade as last October's.
  assert.equal(h.relevantRows([...before,f('2026-11-03','growth')],[],'elementary','every_12',due,12).status,'insufficient');
});
test('growth saved after month rollover counts only with explicit prior-month target_month',()=>{
  const due=month('2026-11');
  const before=[f('2026-01-15','growth'),f('2026-04-15','growth')];
  assert.equal(h.relevantRows([...before,f('2026-11-04','growth',{target_month:'2026-10'})],[],'elementary','every_12',due,12).status,'ready');
  assert.equal(h.relevantRows([...before,f('2026-11-04','growth',{target_month:'2026-11'})],[],'elementary','every_12',due,12).status,'insufficient');
});
test('quarterly growth-only gates apply to 3-month and 6-month consultations',()=>{
  const due=month('2026-11');
  assert.equal(h.relevantRows([f('2026-09-10','growth')],[],'elementary','after_3',due,3).status,'insufficient');
  assert.equal(h.relevantRows([f('2026-10-30','growth')],[],'elementary','after_3',due,3).status,'ready');
  assert.equal(h.relevantRows([f('2026-07-13','growth'),f('2026-09-11','growth')],[],'elementary','every_6',due,6).status,'insufficient');
  assert.equal(h.relevantRows([f('2026-07-13','growth'),f('2026-10-28','growth')],[],'elementary','every_6',due,6).status,'ready');
});
test('Quick Note actual lesson_date wins over save date around month boundary',()=>{
  const due=month('2026-11');
  const r=h.relevantRows([
    f('2026-11-02','class',{lesson_date:'2026-10-31'}),
    f('2025-10-30','class',{lesson_date:'2025-11-01'})
  ],[],'kinder','every_12',due,12);
  assert.equal(r.status,'ready');
  assert.equal(r.rows.length,2);
  assert.equal(h.monthKey(r.rows[0]._reportingDate),'2025-11');
  assert.equal(h.monthKey(r.rows[1]._reportingDate),'2026-10');
});
test('untyped legacy growth records cannot pretend to be weekly Quick Notes',()=>{
  const due=month('2026-11');
  const r=h.relevantRows([
    {date:'2026-01-01',content:'legacy a'},
    {date:'2026-04-01',content:'legacy b'}
  ],[],'kinder','every_12',due,12);
  assert.equal(r.status,'insufficient');
});
