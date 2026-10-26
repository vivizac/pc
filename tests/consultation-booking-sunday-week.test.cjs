'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const client=fs.readFileSync(path.join(root,'packages/common/olli-booking-guardian.js'),'utf8');
const server=fs.readFileSync(path.join(root,'packages/common/api/_lib/olli-booking-public-handler.cjs'),'utf8');
const {allowedDate}=require('../packages/common/api/_lib/olli-booking-month-slots.cjs');
const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261027081500_olli_booking_sunday_first_week_numbering.sql'),'utf8');

test('November 2026 weeks begin on Sunday in the actual month slots predicate',()=>{
 const weeks=[2,3], weekdays=[1,2,3,4,5];
 const shouldBook=['2026-11-09','2026-11-13','2026-11-16','2026-11-20'];
 const shouldNotBook=['2026-11-02','2026-11-06','2026-11-08','2026-11-22','2026-11-23','2026-11-30'];
 for(const d of shouldBook)assert.equal(allowedDate(d,weeks,weekdays),true,d);
 for(const d of shouldNotBook)assert.equal(allowedDate(d,weeks,weekdays),false,d);
 assert.equal(allowedDate('2026-06-07',[2],[7]),true,'first Sunday after a Monday-start month begins week 2');
 assert.equal(allowedDate('2026-06-01',[1],[1]),true);
});

test('guardian client calendar header, numeric grid and enabled dates use same Sunday-first convention',()=>{
 const start=client.indexOf(' function allowedDay(');
 const finish=client.indexOf(' function slotsHtml(',start);
 assert.ok(start>=0&&finish>start,'inspect the real calendar implementation');
 const state={weeks:[2,3],weekdays:[1,2,3,4,5],month:'2026-11',day:''};
 const ctx={state,Date,Number,Array,String,
  today:()=> '2026-10-27',maxDate:()=> '2027-02-01',
  monthShift:(month,n)=>{
   const [year,m]=month.split('-').map(Number);
   return new Date(Date.UTC(year,m-1+n,1)).toISOString().slice(0,7);
  }
 };
 const calendar=vm.runInNewContext(client.slice(start,finish)+'\ncalendarHtml;',ctx);
 const markup=calendar();
 const grid=markup.slice(markup.indexOf('class="ogbCalendar"'));
 const heads=[...grid.matchAll(/<span>([일월화수목금토])<\/span>/g)].map(x=>x[1]);
 assert.deepEqual(heads,['일','월','화','수','목','금','토']);
 assert.match(grid,/<\/span><button type="button" data-date="2026-11-01"/,
  'Nov 1 is Sunday and starts in the first column without blanks');
 assert.match(grid,/data-date="2026-11-02" disabled/);
 assert.match(grid,/data-date="2026-11-09" /);
 assert.doesNotMatch(grid,/data-date="2026-11-09" disabled/);
 assert.match(grid,/data-date="2026-11-23" disabled/);
 state.month='2026-06';
 const june=calendar().slice(calendar().indexOf('class="ogbCalendar"'));
 assert.match(june,/<\/span><i aria-hidden="true"><\/i><button type="button" data-date="2026-06-01"/,
  'Monday start month has exactly one empty Sunday cell');
});

test('QA preview uses the same Sunday-first week arithmetic',()=>{
 assert.match(server,/const week=Math\.floor\(\(d-1\+first\.getUTCDay\(\)\)\/7\)\+1;/);
 assert.doesNotMatch(server,/const week=Math\.floor\(\(d-1\+\(first\.getUTCDay\(\)\+6\)%7\)/);
});

test('staged database migration changes all four booking availability and reservation guards, without touching weekday numbering',()=>{
 const methods=['olli_booking_private.assert_slot','olli_booking_private.available_slots',
  'public.olli_booking_list_slots','public.olli_booking_server_reserve'];
 for(const fn of methods)assert.ok(sql.includes('FUNCTION '+fn+'('),fn);
 assert.equal((sql.match(/extract\(dow from date_trunc\('month'/g)||[]).length,4);
 assert.ok(!sql.includes("extract(isodow from date_trunc('month'"));
 assert.match(sql,/extract\(isodow from p_date\)/);
 assert.match(sql,/extract\(isodow from v_date\)/);
 assert.match(sql,/begin;/i);
 assert.match(sql,/commit;/i);
 assert.doesNotMatch(sql,/drop table|delete from public\.olli_booking_reservations|truncate table/i);
});
