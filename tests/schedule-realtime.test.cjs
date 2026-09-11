const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const settle = async () => { for (let i = 0; i < 35; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };

function sandbox() {
  let now = 0, timerId = 0;
  const timers = new Map(), intervals = [], listeners = new Map();
  const values = new Map([['olli_current_academy_id', 'academy-a'], ['olli_account_session_token_v1', 'session-a']]);
  const add = (name, fn) => { if (!listeners.has(name)) listeners.set(name,new Set()); listeners.get(name).add(fn); };
  const remove = (name, fn) => listeners.get(name)?.delete(fn);
  const dom = {hidden:false,readyState:'loading',activeElement:null,querySelector:()=>null,querySelectorAll:()=>[],getElementById:()=>null,addEventListener:add,removeEventListener:remove};
  const win = {document:dom,navigator:{onLine:true},localStorage:{getItem:key=>values.get(key)||null,setItem:(k,v)=>values.set(k,v)},
    console:{warn(){}},setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id),
    setInterval:(fn,delay)=>{intervals.push({fn,delay});return intervals.length;},addEventListener:add,removeEventListener:remove,
    dispatchEvent:event=>{for(const fn of listeners.get(event.type)||[])fn(event);},
    CustomEvent:class {constructor(type,options){this.type=type;this.detail=options?.detail;}},
  };
  win.window=win;
  vm.createContext(win);
  const emit = (type,detail) => win.dispatchEvent({type,detail});
  const run = file => vm.runInContext(source(file),win,{filename:file});
  return {win,dom,values,intervals,emit,run,timers,async tick(ms){now+=ms;let count=0;while(true){const next=[...timers].find(([,t])=>t.at<=now);if(!next)break;timers.delete(next[0]);next[1].fn();await settle();if(++count>100)throw Error('timer loop');}await settle();}};
}

function realtime() { const env=sandbox();env.run('olli-realtime-common.js');return env; }
const signal = env => env.emit('olli:realtime-change',{domain:'schedule',academyId:'academy-a',revision:999});

test('coalesces bursts and ignores observation/other-academy signals',async()=>{
  const env=realtime();let calls=0;env.win.OlliRealtime.watchDomain('schedule',()=>{calls++;return true;});
  env.emit('olli:realtime-change',{domain:'observation',academyId:'academy-a'});
  env.emit('olli:realtime-change',{domain:'schedule',academyId:'academy-b'});
  await env.tick(150);assert.equal(calls,0);
  for(let i=0;i<20;i++)signal(env);
  await env.tick(150);assert.equal(calls,1);await env.tick(5000);assert.equal(calls,1);
});
test('retains a signal while editing and retries without another signal',async()=>{
  const env=realtime();let busy=true,calls=0;
  env.win.OlliRealtime.watchDomain('schedule',()=>{calls++;return !busy;});
  signal(env);await env.tick(150);assert.equal(calls,1);busy=false;await env.tick(1000);assert.equal(calls,2);
  await env.tick(5000);assert.equal(calls,2);
});
test('non-change catch-up checks never enter the 1s retry loop when not applied',async()=>{
  const env=realtime();let calls=0,trigger='';
  env.win.OlliRealtime.watchDomain('schedule',ctx=>{calls++;trigger=ctx.trigger;return false;});
  env.emit('olli:realtime-status',{status:'SUBSCRIBED',academyId:'academy-a'});
  await env.tick(150);assert.equal(calls,1);assert.equal(trigger,'subscribed');
  await env.tick(5000);assert.equal(calls,1);
});
test('actual change signals keep retrying and expose change trigger',async()=>{
  const env=realtime();let busy=true,calls=0,triggers=[];
  env.win.OlliRealtime.watchDomain('schedule',ctx=>{calls++;triggers.push(ctx.trigger);return !busy;});
  signal(env);await env.tick(150);assert.equal(calls,1);assert.equal(triggers[0],'change');
  busy=false;await env.tick(1000);assert.equal(calls,2);assert.equal(triggers[1],'change');
});
test('a change during a read causes one additional read, never concurrent reads',async()=>{
  const env=realtime(),d=deferred();let calls=0;
  env.win.OlliRealtime.watchDomain('schedule',()=>++calls===1?d.promise:true);
  signal(env);await env.tick(150);for(let i=0;i<10;i++)signal(env);await env.tick(1000);assert.equal(calls,1);
  d.resolve(true);await settle();await env.tick(1000);assert.equal(calls,2);
});
test('failed reads retry and a completed read clears pending work',async()=>{
  const env=realtime();let calls=0;
  env.win.OlliRealtime.watchDomain('schedule',()=>{if(++calls===1)throw Error('offline');return true;});
  signal(env);await env.tick(150);await env.tick(1000);assert.equal(calls,1);await env.tick(4000);assert.equal(calls,2);
});
test('hidden/offline tabs catch up on visible, online, focus and subscribed events',async()=>{
  const env=realtime();let calls=0;env.win.OlliRealtime.watchDomain('schedule',()=>{calls++;return true;});
  env.dom.hidden=true;signal(env);await env.tick(5000);assert.equal(calls,0);
  env.dom.hidden=false;env.emit('visibilitychange');await env.tick(150);assert.equal(calls,1);
  env.win.navigator.onLine=false;signal(env);await env.tick(150);assert.equal(calls,1);
  env.win.navigator.onLine=true;env.emit('online');await env.tick(150);assert.equal(calls,2);
  env.emit('focus');await env.tick(150);assert.equal(calls,3);
  env.emit('olli:realtime-status',{status:'SUBSCRIBED',academyId:'academy-a'});await env.tick(150);assert.equal(calls,4);
});
test('in-flight academy/session responses become invalid and new context catches up',async()=>{
  const env=realtime(),d=deferred();let captured,calls=0;
  env.win.OlliRealtime.watchDomain('schedule',ctx=>{captured=ctx;return ++calls===1?d.promise:true;});
  signal(env);await env.tick(150);assert.equal(captured.isCurrent(),true);
  env.values.set('olli_current_academy_id','academy-b');env.values.set('olli_account_session_token_v1','session-b');
  assert.equal(captured.isCurrent(),false);d.resolve(true);await settle();await env.tick(1000);assert.equal(captured.academyId,'academy-b');assert.equal(calls,2);
});
test('dispose removes listeners and scheduled refreshes',async()=>{
  const env=realtime();let calls=0;const watcher=env.win.OlliRealtime.watchDomain('schedule',()=>{calls++;return true;});
  signal(env);watcher.dispose();await env.tick(10000);signal(env);env.emit('focus');await env.tick(150);assert.equal(calls,0);
});

function pc() {
  const env=sandbox();let revision=10,revisionReads=0,weekReads=0,readWeek=async()=>({enrollments:[{student_id:'fixture',time_slot:5}]});
  env.win.OlliTimetableService={DAYS:['월','화','수','목','금','토'],currentAcademyId:()=>env.values.get('olli_current_academy_id'),loadSyncRevision:async()=>{revisionReads++;return {ok:true,version:revision};},loadWeek:()=>{weekReads++;return readWeek();},activeStudents:()=>[]};
  let watcher;
  env.win.OlliRealtime={watchDomain:(domain,fn)=>{assert.equal(domain,'schedule');watcher=fn;}};
  let code=source('pc-timetable.js');
  // Expose closures for behavior tests; rendering is separately exercised by browser fixtures.
  code=code.replace('})(window);',`global.testApi={state,checkLiveScheduleSync,loadWeek};renderTimetable=()=>{};renderSidebar=()=>{};refreshOpenStudentInfoPanel=()=>{};})(window);`);
  vm.runInContext(code,env.win);
  const state=env.win.testApi.state;state.active=true;state.syncAcademyId='academy-a';state.syncRevision=9;
  return {...env,state,get reads(){return weekReads;},get revisionReads(){return revisionReads;},setRevision:v=>revision=v,setRead:fn=>readWeek=fn,check:()=>watcher({academyId:'academy-a',isCurrent:()=>env.values.get('olli_current_academy_id')==='academy-a'})};
}
test('PC signal reads server revision and week; unchanged revision does not rerender',async()=>{
  const env=pc();assert.equal(await env.check(),true);assert.equal(env.reads,1);assert.equal(env.state.syncRevision,10);
  assert.equal(await env.check(),true);assert.equal(env.reads,1);assert.equal(env.intervals.some(x=>x.delay===3000),true);
});
test('PC 3s timer skips timetable pane and is reserved for attendance',async()=>{
  const env=pc();const interval=env.intervals.find(x=>x.delay===3000);assert.ok(interval);
  const before=env.revisionReads;interval.fn();await settle();assert.equal(env.revisionReads,before);
  env.state.pane='attendance';env.state.syncRevision=10;interval.fn();await settle();assert.equal(env.revisionReads,before+1);
});
test('PC first signal refreshes even without a baseline revision',async()=>{
  const env=pc();env.state.syncRevision=0;assert.equal(await env.check(),true);assert.equal(env.reads,1);
});
test('PC saves, editors and in-flight reads defer signals',async()=>{
  const env=pc();env.state.saving=true;assert.equal(await env.check(),false);
  env.state.saving=false;env.state.dialog={memo:'unsaved'};assert.equal(await env.check(),false);
  env.state.dialog=null;env.state.loading=true;assert.equal(await env.check(),false);assert.equal(env.reads,0);
  env.state.loading=false;assert.equal(await env.check(),true);assert.equal(env.reads,1);
});
test('PC failed week read does not acknowledge revision; retries same revision',async()=>{
  const env=pc();env.setRead(async()=>{throw Error('network');});assert.equal(await env.check(),false);assert.equal(env.state.syncRevision,9);
  env.setRead(async()=>({enrollments:[]}));assert.equal(await env.check(),true);assert.equal(env.reads,2);assert.equal(env.state.syncRevision,10);
});
test('PC academy switch during week load discards response and revision',async()=>{
  const env=pc(),d=deferred();env.setRead(()=>d.promise);const p=env.check();await settle();env.values.set('olli_current_academy_id','academy-b');d.resolve({enrollments:[{student_id:'old-academy'}]});assert.equal(await p,false);assert.equal(env.state.syncRevision,9);assert.equal(env.state.data,null);
});
test('PC dialog opened during a request preserves draft and retries after close',async()=>{
  const env=pc(),d=deferred();env.setRead(()=>d.promise);const p=env.check();await settle();env.state.dialog={memo:'draft'};d.resolve({enrollments:[]});assert.equal(await p,false);assert.equal(env.state.dialog.memo,'draft');assert.equal(env.state.syncRevision,9);
  env.state.dialog=null;env.setRead(async()=>({enrollments:[]}));assert.equal(await env.check(),true);
});
test('PC attendance register is not activated by the new realtime watcher',async()=>{const env=pc();env.state.pane='attendance';assert.equal(await env.check(),false);assert.equal(env.reads,0);});

test('PC week service never caches an old-academy response under the new academy',async()=>{
  const env=sandbox(),d=deferred();let calls=0;
  env.win.supabase=async(method,name)=>{calls++;if(name==='rpc/olli_schedule_week')return d.promise;return {ok:true};};
  env.run('pc-timetable-service.js');const p=env.win.OlliTimetableService.loadWeek('2026-09-07');await settle();assert.ok(calls>0);
  env.values.set('olli_current_academy_id','academy-b');d.resolve({enrollments:[]});await assert.rejects(p,/학원 또는 세션/);
  assert.equal([...env.values.keys()].some(k=>k.startsWith('olli_schedule_week_cache')),false);
});
