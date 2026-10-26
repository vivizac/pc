'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {collectMonthSlots,monthDays,allowedDate}=require('../../../packages/common/api/_lib/olli-booking-month-slots.cjs');
const NOW=new Date('2026-10-26T09:00:00Z');

test('monthly booking builds a Sunday-first calendar month with the existing Monday-based consultation week rules',()=>{
 const dates=monthDays('2026-11',NOW);
 assert.equal(dates.length,30);
 const bookable=dates.filter(day=>allowedDate(day,[2,3],[1,2,3,4,5]));
 assert.deepEqual(bookable,[
  '2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06',
  '2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13'
 ]);
});
test('monthly booking rejects out-of-range and malformed months',()=>{
 for(const month of ['2026-09','2027-05','2026-13','bad']){
  assert.throws(()=>monthDays(month,NOW),/MONTH_INVALID/);
 }
 assert.equal(monthDays('2026-10',NOW)[0],'2026-10-26');
});
test('monthly booking returns all dates and fetches only configured days with four concurrent reads',async()=>{
 let active=0,peak=0,count=0;
 const slots=await collectMonthSlots({month:'2026-11',weeks:[2,3],
  weekdays:[1,2,3,4,5],now:NOW,fetchDay:async date=>{
   active++;peak=Math.max(peak,active);count++;
   await Promise.resolve();
   active--;
   return [{start_at:date+'T11:00:00+09:00'}];
  }});
 assert.equal(count,10);
 assert.ok(peak<=4);
 assert.equal(Object.keys(slots).length,30);
 assert.deepEqual(slots['2026-11-01'],[]);
 assert.equal(slots['2026-11-02'][0].start_at,'2026-11-02T11:00:00+09:00');
});
test('a failed daily read rejects the month rather than showing a misleading partially loaded timetable',async()=>{
 await assert.rejects(collectMonthSlots({month:'2026-11',weeks:[2,3],weekdays:[1,2,3,4,5],
  now:NOW,fetchDay:async()=>{throw new Error('DATABASE_DOWN');}}),/DATABASE_DOWN/);
});
