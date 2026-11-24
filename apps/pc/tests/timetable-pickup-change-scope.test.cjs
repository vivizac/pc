'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ui = fs.readFileSync(path.join(__dirname,'../pc-timetable.js'),'utf8');
const service = fs.readFileSync(path.join(__dirname,'../pc-timetable-service.js'),'utf8');
const css = fs.readFileSync(path.join(__dirname,'../pc-timetable.css'),'utf8');
const migrations = path.join(__dirname,'../../../supabase/migrations');
const migrationFile = fs.readdirSync(migrations).find(x=>x.endsWith('_pc_pickup_change_scope.sql'));
const sql = fs.readFileSync(path.join(migrations,migrationFile),'utf8');
const code = ui.slice(ui.indexOf('  async function applyPickupChange('),ui.indexOf('  async function removePickup() {'));
function fixture(overrides={}) {
  const calls=[];
  const item={id:'p1',student_name:'학생',weekday:4,class_time:4,pickup_scope:'weekly',effective_from:'2026-10-01',effective_to:null,...overrides};
  const state={saving:false,dialog:{kind:'pickupManage',pickupId:'p1',originalEffectiveFrom:item.effective_from,originalEffectiveTo:'',effectiveDate:'2026-12-04',pickupLabel:'등원 장소',pickupTime:'15:30',dropoffLabel:'하원 장소',dropoffTime:'17:30'}};
  const ctx=vm.createContext({
    state,pickups:()=>[item],clean:v=>String(v??'').trim(),todayKey:()=> '2026-11-24',
    parseDate:v=>new Date(v+'T00:00:00'),pickupScope:p=>p.pickup_scope,
    isReservedMoveDate:d=>d>='2026-11-30',shortDate:v=>v,notify:()=>{},alert:m=>calls.push(['alert',m]),
    withSaving:async f=>f(),service:{changePickup:async p=>{calls.push(['save',p]);return {week_start:'2026-11-30'};}}
  });
  vm.runInContext(code+'\nthis.api={updatePickupNow,schedulePickupChange};',ctx);
  return {api:ctx.api,state,calls,item};
}
test('both actions save the same full pickup details and exact selected date with distinct mode',async()=>{
  const f=fixture();await f.api.updatePickupNow();await f.api.schedulePickupChange();
  const p=JSON.parse(JSON.stringify(f.calls[0][1]));
  assert.deepEqual(p,{pickupId:'p1',expectedFrom:'2026-10-01',expectedTo:'',targetDate:'2026-12-04',pickupLabel:'등원 장소',pickupTime:'15:30',dropoffLabel:'하원 장소',dropoffTime:'17:30',mode:'immediate'});
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[1][1])),{...p,mode:'schedule'});
});
test('current-week change is immediate only; daily cards cannot be reserved',async()=>{
  const f=fixture();f.state.dialog.effectiveDate='2026-11-27';
  await f.api.schedulePickupChange();assert.equal(f.calls[0][0],'alert');
  await f.api.updatePickupNow();assert.equal(f.calls[1][0],'save');
  const d=fixture({pickup_scope:'daily'});
  await d.api.schedulePickupChange();assert.equal(d.calls[0][0],'alert');
  await d.api.updatePickupNow();assert.equal(d.calls[1][0],'save');
});
test('dropoff-only cards and delayed future start are accepted without inventing arrival fields',async()=>{
  const f=fixture({effective_from:'2026-12-03'});
  Object.assign(f.state.dialog,{pickupLabel:'',pickupTime:'',effectiveDate:'2026-12-10'});
  await f.api.updatePickupNow();
  assert.equal(f.calls[0][1].expectedFrom,'2026-12-03');
  assert.equal(f.calls[0][1].targetDate,'2026-12-10');
  assert.equal(f.calls[0][1].pickupTime,'');
  assert.equal(f.calls[0][1].dropoffTime,'17:30');
});
test('existing pickup popup has both buttons on a single row and both handlers',()=>{
  assert.match(ui,/effectiveRow[\s\S]*?data-tt-pickup-effective-date[\s\S]*?data-tt-update-pickup>즉시변경[\s\S]*?data-tt-schedule-pickup/);
  assert.match(ui,/updatePickupButton\.addEventListener\('click', updatePickupNow\)/);
  assert.match(ui,/schedulePickupButton\.addEventListener\('click', schedulePickupChange\)/);
  assert.match(css,/\.olliTtPickupManageSection\.effective \.olliTtPickupManageFieldRow \{[^}]*grid-template-columns:minmax\(0,1fr\) 100px 100px/);
  assert.match(service,/rpc\('olli_schedule_change_pickup_v2'/);
});
test('server uses period guards, week cutoff, future start in-place and preserves full fields',()=>{
  assert.match(sql,/v_cutoff := v_week;/);
  assert.match(sql,/effective_to=v_cutoff-1/);
  assert.match(sql,/elsif v_old\.effective_from > v_today then[\s\S]*?v_in_place := true;/);
  assert.match(sql,/dropoff_label=nullif\(v_dropoff,''\),dropoff_time=p_dropoff_time/);
  assert.match(sql,/v_old\.effective_from is distinct from p_expected_from/);
  assert.match(sql,/private\.olli_schedule_can_access/);
  assert.match(sql,/v_old\.created_at/);
});
