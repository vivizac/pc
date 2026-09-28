const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'..','olli-attendance-phone-adapter.js'),'utf8');
const settle = async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function phone(options = {}){
  let academy='academy-a',session='session-a',revision=10,visible=true,editing=false,readCount=0,renderCount=0,watcher;
  let weekReader=async()=>({enrollments:[{student_id:'fixture',weekday:new Date().getDay()||7,time_slot:5,class_group:'A'}]});
  const listeners=new Map(),rpcCalls=[];
  const win={console:{warn(){}},currentRecordView:'elementary',studentSelectionMode:false,
    document:{activeElement:null,getElementById:id=>id==='recordRoomScreen'?{getClientRects:()=>visible?[{}]:[]}:null,querySelectorAll:()=>editing?[{getClientRects:()=>[{}]}]:[]},
    OlliAttendanceData:{currentAcademyId:()=>academy,currentSessionToken:()=>session,loadWeek:()=>{readCount++;return weekReader();}},
    OlliRealtime:{watchDomain:(domain,fn)=>{assert.equal(domain,'schedule');watcher=fn;return {request:()=>listeners.get('requested')?.()};}},
    renderElementaryRecords:()=>{renderCount++;},getRecordSortCriteria:()=>'',
    addEventListener:(name,fn)=>listeners.set(name,fn),
    supabase:async(method,name,body)=>{rpcCalls.push({method,name,body});return {ok:true,version:revision};}
  };
  if (options.legacy) delete win.OlliRealtime;
  win.window=win;vm.createContext(win);vm.runInContext(source,win);
  return {win,rpcCalls,listeners,get reads(){return readCount;},get renders(){return renderCount;},
    check:()=>{const a=academy,s=session;return watcher({academyId:a,isCurrent:()=>a===academy&&s===session});},
    setRevision:v=>revision=v,setRead:fn=>weekReader=fn,setAcademy:v=>academy=v,setSession:v=>session=v,setVisible:v=>visible=v,setEditing:v=>editing=v};
}
test('Phone re-reads today schedule and skips duplicate revisions',async()=>{
  const env=phone();assert.equal(await env.check(),true);assert.equal(env.reads,1);assert.equal(env.renders,1);assert.equal(env.win.getOlliTodayScheduleEntry('fixture').regular.time_slot,5);
  assert.equal(await env.check(),true);assert.equal(env.reads,1);assert.equal(env.renders,1);
  env.setRevision(11);env.setRead(async()=>({enrollments:[]}));assert.equal(await env.check(),true);assert.equal(env.reads,2);assert.equal(env.win.getOlliTodayScheduleEntry('fixture').regular,null);
  assert.ok(env.rpcCalls.every(r=>r.name==='rpc/olli_schedule_sync_revision'));
});
test('Phone editing, selection and hidden roster defer without reading or changing drafts',async()=>{
  const env=phone();env.setEditing(true);assert.equal(await env.check(),false);env.setEditing(false);
  env.win.studentSelectionMode=true;assert.equal(await env.check(),false);env.win.studentSelectionMode=false;
  env.setVisible(false);assert.equal(await env.check(),false);assert.equal(env.reads,0);
  env.setVisible(true);env.win.document.activeElement={matches:()=>true,value:'unsaved note'};assert.equal(await env.check(),false);assert.equal(env.win.document.activeElement.value,'unsaved note');
  env.win.document.activeElement=null;assert.equal(await env.check(),true);
});
test('Phone failed read does not acknowledge revision or erase previous schedule',async()=>{
  const env=phone();await env.check();env.setRevision(11);env.setRead(async()=>{throw Error('network');});assert.equal(await env.check(),false);assert.equal(env.win.getOlliTodayScheduleEntry('fixture').regular.time_slot,5);
  env.setRead(async()=>({enrollments:[]}));assert.equal(await env.check(),true);assert.equal(env.reads,3);
});
test('Phone synchronous load failure is safely retryable',async()=>{
  const env=phone();env.setRead(()=>{throw Error('not ready');});assert.equal(await env.check(),false);
  env.setRead(async()=>({enrollments:[]}));assert.equal(await env.check(),true);
});
test('Phone in-flight old academy response cannot replace current schedule',async()=>{
  const env=phone(),d=deferred();env.setRead(()=>d.promise);const first=env.check();await settle();env.setAcademy('academy-b');env.setSession('session-b');
  env.setRead(async()=>({enrollments:[{student_id:'new-fixture',weekday:new Date().getDay()||7,time_slot:6}]}));assert.equal(await env.check(),false); // old load still in flight; common watcher retries
  d.resolve({enrollments:[{student_id:'old-fixture',weekday:new Date().getDay()||7,time_slot:1}]});assert.equal(await first,false);
  assert.equal(await env.check(),true);assert.equal(env.win.getOlliTodayScheduleEntry('old-fixture').regular,null);assert.equal(env.win.getOlliTodayScheduleEntry('new-fixture').regular.time_slot,6);
});
test('Phone new-context foreground load stays intact when old request completes',async()=>{
  const env=phone(),old=deferred(),next=deferred();env.setRead(()=>old.promise);const p1=env.win.syncOlliTodayAttendanceSchedule(new Date(),{render:false});await settle();
  env.setAcademy('academy-b');env.setSession('session-b');env.setRead(()=>next.promise);const p2=env.win.syncOlliTodayAttendanceSchedule(new Date(),{render:false});await settle();
  old.resolve({enrollments:[]});assert.equal(await p1,false);next.resolve({enrollments:[{student_id:'new-fixture',weekday:new Date().getDay()||7,time_slot:6}]});assert.equal(await p2,true);assert.equal(env.win.getOlliTodayScheduleEntry('new-fixture').regular.time_slot,6);
});
test('Phone modal opened during read defers rendering and preserves pending refresh',async()=>{
  const env=phone(),d=deferred();env.setRead(()=>d.promise);const p=env.check();await settle();env.setEditing(true);d.resolve({enrollments:[]});assert.equal(await p,false);assert.equal(env.renders,0);
  env.setEditing(false);env.setRead(async()=>({enrollments:[]}));assert.equal(await env.check(),true);assert.equal(env.reads,2);assert.equal(env.renders,0);
});
test('Phone normal foreground schedule load remains available without new common API',async()=>{
  const env=phone({legacy:true});assert.equal(await env.win.syncOlliTodayAttendanceSchedule(new Date(),{render:false}),true);
  assert.equal(env.renders,0);assert.equal(env.reads,1);
});
