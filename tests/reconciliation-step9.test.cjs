const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','olli-reconciliation-common.js'),'utf8');
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve()};

function sandbox(){
  let now=1000,timerId=0,contextVersion=1;
  const timers=new Map(),listeners=new Map();
  const values=new Map([
    ['olli_current_academy_id','academy-a'],
    ['olli_account_session_token_v1','session-a']
  ]);
  const add=(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn)};
  const remove=(name,fn)=>listeners.get(name)?.delete(fn);

  const document={
    hidden:false,
    readyState:'loading',
    addEventListener:add,
    removeEventListener:remove
  };

  const win={
    window:null,
    document,
    navigator:{onLine:true},
    localStorage:{
      getItem:key=>values.get(key)||null,
      setItem:(key,val)=>values.set(key,String(val))
    },
    console:{warn(){}},
    Date:class extends Date{static now(){return now}},
    setTimeout(fn,delay=0){
      const id=++timerId;
      timers.set(id,{fn,at:now+Number(delay||0)});
      return id;
    },
    clearTimeout(id){timers.delete(id)},
    addEventListener:add,
    removeEventListener:remove,
    dispatchEvent(event){for(const fn of listeners.get(event.type)||[])fn(event)},
    CustomEvent:class{
      constructor(type,options){this.type=type;this.detail=options?.detail}
    }
  };
  win.window=win;

  const realtimeCalls=[];
  win.OlliRealtime={
    ensureConnected:async options=>{
      realtimeCalls.push(options);
      return true;
    }
  };

  const managerCalls=[];
  win.OlliSyncManager={
    resumePending:(reason,options)=>{
      managerCalls.push({reason,options});
      return Promise.resolve([]);
    }
  };

  win.OlliStorageCore={
    AcademyContext:{
      getCurrent:()=>({academyId:values.get('olli_current_academy_id')||'',contextVersion}),
      captureToken:()=>({academyId:values.get('olli_current_academy_id')||'',contextVersion}),
      isTokenCurrent:token=>!!token
        && token.academyId===(values.get('olli_current_academy_id')||'')
        && token.contextVersion===contextVersion
    }
  };

  vm.createContext(win);
  vm.runInContext(source,win,{filename:'olli-reconciliation-common.js'});

  return{
    win,document,values,timers,realtimeCalls,managerCalls,
    emit(type,detail){win.dispatchEvent({type,detail})},
    switchAcademy(id,session){
      values.set('olli_current_academy_id',id);
      values.set('olli_account_session_token_v1',session);
      contextVersion+=1;
    },
    async tick(ms=0){
      now+=ms;
      let guard=0;
      while(true){
        const next=[...timers.entries()]
          .filter(([,t])=>t.at<=now)
          .sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
        if(!next)break;
        timers.delete(next[0]);
        next[1].fn();
        await settle();
        if(++guard>100)throw new Error('timer loop');
      }
      await settle();
    }
  };
}

test('module is inert until DOMContentLoaded',()=>{
  const env=sandbox();
  assert.equal(env.win.OlliReconciliation.getState().started,false);
  assert.equal(env.timers.size,0);
  assert.equal(env.realtimeCalls.length,0);
});

test('boot starts once and dispatches one reconciliation pass',async()=>{
  const env=sandbox();
  const events=[];
  env.win.addEventListener('olli:reconcile',event=>events.push(event.detail));
  env.emit('DOMContentLoaded');
  await env.tick(0);
  assert.equal(env.win.OlliReconciliation.getState().started,true);
  assert.equal(env.realtimeCalls.length,1);
  assert.equal(events.length,1);
  assert.equal(events[0].academyId,'academy-a');
  assert.equal(events[0].reason,'boot');
  assert.equal(env.managerCalls.length,1);
});

test('focus online visible burst coalesces into one pass',async()=>{
  const env=sandbox();
  const events=[];
  env.win.addEventListener('olli:reconcile',event=>events.push(event.detail));
  env.emit('DOMContentLoaded');
  await env.tick(0);
  events.length=0;env.realtimeCalls.length=0;env.managerCalls.length=0;

  env.emit('focus');
  env.emit('online');
  env.emit('visibilitychange');
  await env.tick(139);
  assert.equal(events.length,0);
  await env.tick(1);
  assert.equal(events.length,1);
  assert.equal(env.realtimeCalls.length,1);
  assert.equal(env.managerCalls.length,1);
  assert.ok(events[0].reasons.includes('focus'));
  assert.ok(events[0].reasons.includes('online'));
  assert.ok(events[0].reasons.includes('visible'));
});

test('hidden and offline requests remain pending until runnable',async()=>{
  const env=sandbox();
  const events=[];
  env.win.addEventListener('olli:reconcile',event=>events.push(event.detail));
  env.emit('DOMContentLoaded');
  await env.tick(0);
  events.length=0;

  env.document.hidden=true;
  env.emit('focus');
  await env.tick(1000);
  assert.equal(events.length,0);
  assert.equal(env.win.OlliReconciliation.getState().pending,true);

  env.document.hidden=false;
  env.emit('visibilitychange');
  await env.tick(140);
  assert.equal(events.length,1);

  events.length=0;
  env.win.navigator.onLine=false;
  env.emit('focus');
  await env.tick(1000);
  assert.equal(events.length,0);

  env.win.navigator.onLine=true;
  env.emit('online');
  await env.tick(140);
  assert.equal(events.length,1);
});

test('SUBSCRIBED caused by coordinator ensure does not create a duplicate pass',async()=>{
  const env=sandbox();
  const events=[];
  env.win.addEventListener('olli:reconcile',event=>events.push(event.detail));
  env.win.OlliRealtime.ensureConnected=async options=>{
    env.realtimeCalls.push(options);
    env.emit('olli:realtime-status',{
      status:'SUBSCRIBED',
      academyId:'academy-a',
      reason:options.reason
    });
    return true;
  };

  env.emit('DOMContentLoaded');
  await env.tick(0);
  await env.tick(500);
  assert.equal(events.length,1);
  assert.equal(events[0].reason,'boot');
});

test('spontaneous realtime resubscribe requests catch-up once',async()=>{
  const env=sandbox();
  const events=[];
  env.win.addEventListener('olli:reconcile',event=>events.push(event.detail));
  env.emit('DOMContentLoaded');
  await env.tick(0);
  events.length=0;

  env.emit('olli:realtime-status',{status:'SUBSCRIBED',academyId:'academy-a'});
  await env.tick(0);
  assert.equal(events.length,1);
  assert.equal(events[0].reason,'realtime_subscribed');
});

test('academy context signal is immediate and old context cannot win',async()=>{
  const env=sandbox();
  const events=[];
  let release;
  const pending=new Promise(resolve=>{release=resolve});
  env.win.addEventListener('olli:reconcile',event=>events.push(event.detail));
  env.win.OlliRealtime.ensureConnected=async options=>{
    env.realtimeCalls.push(options);
    if(options.reason==='reconcile:focus')await pending;
    return true;
  };

  env.emit('DOMContentLoaded');
  await env.tick(0);
  events.length=0;

  env.emit('focus');
  await env.tick(140);
  env.switchAcademy('academy-b','session-b');
  env.emit('olli:academy-context-changed',{academyId:'academy-b'});
  release();
  await settle();
  await env.tick(0);
  await settle();
  await env.tick(0);

  assert.equal(events.some(event=>event.academyId==='academy-a'),false);
  assert.equal(events.at(-1).academyId,'academy-b');
  assert.equal(events.at(-1).reason,'academy_context');
});

test('pageshow only reconciles restored bfcache pages',async()=>{
  const env=sandbox();
  const events=[];
  env.win.addEventListener('olli:reconcile',event=>events.push(event.detail));
  env.emit('DOMContentLoaded');
  await env.tick(0);
  events.length=0;

  env.emit('pageshow',{persisted:false});
  await env.tick(200);
  assert.equal(events.length,0);

  env.emit('pageshow',{persisted:true});
  await env.tick(140);
  assert.equal(events.length,1);
  assert.equal(events[0].reason,'pageshow');
});

test('coordinator owns lifecycle; it never calls manager.startLifecycle or creates intervals',async()=>{
  const env=sandbox();
  let starts=0;
  env.win.OlliSyncManager.startLifecycle=()=>{starts+=1};
  env.emit('DOMContentLoaded');
  await env.tick(0);
  assert.equal(starts,0);
  assert.equal([...env.timers.values()].some(timer=>Number(timer.delay||0)>0),false);
});
