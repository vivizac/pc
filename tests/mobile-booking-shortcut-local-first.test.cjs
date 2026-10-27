'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../packages/common/olli-booking-owner-ui.js'),'utf8');
const a=source.indexOf(' let mobileShortcutVisible=false;'),b=source.indexOf(' global.OlliBookingDashboard=Object.freeze(',a);
assert.ok(a>=0&&b>a,'use the production shortcut lifecycle');
const shortcut=source.slice(a,b);

function harness({sharedStorage=new Map(),academy='academy-A',day='2026-10-27',responses=[],blockedStorage=false,visible=true}={}){
 let currentAcademy=academy,currentDay=day,shown=visible,requests=0,onMutation=null;
 const listeners={};const gridState={grid:null};
 const classList={contains(k){return k==='show'&&shown;}};
 const dashboard={
  classList,
  querySelector(selector){
   if(selector==='.recordAcademyStatGrid')return gridState.grid;
   if(selector==='[data-olli-booking-entry]')return gridState.grid?.children?.find(x=>x.dataset?.olliBookingEntry)||null;
   if(selector==='[data-olli-booking-count]')return this.querySelector('[data-olli-booking-entry]')?.badge||null;
   return null;
  }
 };
 const setFreshGrid=()=>{
  gridState.grid={children:Array.from({length:4},()=>({})),appendChild(x){this.children.push(x)}};
 };
 setFreshGrid();
 const doc={
  hidden:false,
  body:{classList:{contains(){return false;}}},
  getElementById(id){return id==='recordAcademyDashboard'?dashboard:null},
  querySelector(sel){return sel==='[data-olli-booking-entry]'?dashboard.querySelector(sel):null;},
  addEventListener(name,fn){listeners[name]=fn;}
 };
 const localStorage={
  getItem(key){if(blockedStorage)throw Error('storage blocked');return sharedStorage.get(key)||null;},
  setItem(key,val){if(blockedStorage)throw Error('storage blocked');sharedStorage.set(key,val);}
 };
 function el(tag,className){
  const attrs={};
  return {
   tag,className,dataset:{},
   getAttribute(key){return attrs[key]||null;},
   setAttribute(key,val){attrs[key]=val;},
   addEventListener(){},
   querySelector(key){return key==='[data-olli-booking-count]'?this.badge:null;},
   set innerHTML(html){
    this.html=html;
    const count=html.match(/data-olli-booking-count[^>]*>([^<]*)<\/span>/);
    this.badge={textContent:count?count[1]:'–'};
   },
   get innerHTML(){return this.html;}
  };
 }
 const sandbox={
  state:{entryObserver:null},
  today:()=>currentDay,
  ctx:()=>({academyId:currentAcademy,sessionToken:'session-token'}),
  currentMonth:()=>currentDay.slice(0,7),
  isOwner:()=>true,
  manage:async()=>{
   requests++;
   const outcome=responses.length?responses.shift():{ok:true,appointments:[]};
   return typeof outcome==='function'?outcome():outcome;
  },
  kstParts:date=>({ymd:date.slice(0,10)}),
  document:doc,localStorage,
  global:{addEventListener(name,fn){listeners[name]=fn;}},
  el,open:()=>{},
  MutationObserver:class{
   constructor(cb){onMutation=cb;}
   observe(){}
  },Map,Date,Number,String,Array,JSON,Promise
 };
 const api=vm.runInNewContext(shortcut+'\n({initMobileShortcut,refreshMobileShortcutCount,syncMobileShortcut,insertMobileShortcut,readMobileShortcutCount,rememberMobileShortcutCount,updateMobileShortcutBadge});',sandbox);
 const current=()=>dashboard.querySelector('[data-olli-booking-entry]');
 return {
  api,sharedStorage,listeners,doc,requests:()=>requests,
  count:()=>current()?.badge.textContent,
  card:current,
  async flush(){await new Promise(resolve=>setImmediate(resolve));},
  redraw(){setFreshGrid();onMutation?.();},
  show(val){shown=val;onMutation?.();},
  switchAcademy(value){currentAcademy=value;setFreshGrid();onMutation?.();},
  switchDay(value){currentDay=value;setFreshGrid();onMutation?.();},
  triggerMutation(){onMutation?.();}
 };
}
const booking=(day,name='student')=>({status:'confirmed',name,start_at:day+'T11:30:00+09:00'});

test('local-first: repeated full student-dashboard DOM replacements keep 2 and cause no extra RPCs',async()=>{
 const h=harness({responses:[{ok:true,appointments:[booking('2026-10-27'),booking('2026-10-27'),{status:'cancelled',start_at:'2026-10-27T12:00:00+09:00'}]}]});
 h.api.initMobileShortcut();
 assert.equal(h.count(),'–','only a cold cache may initially show a placeholder');
 await h.flush();
 assert.equal(h.count(),'2');
 assert.equal(h.requests(),1);
 for(let i=0;i<12;i++){
  h.redraw();
  assert.equal(h.count(),'2','the local count is restored synchronously before any await');
 }
 assert.equal(h.requests(),1,'DOM-only re-render must not trigger repeated server requests');
});
test('failed background refresh leaves last good count visible without a dash',async()=>{
 const h=harness({responses:[{ok:true,appointments:[booking('2026-10-27')]},()=>Promise.reject(Error('network down'))]});
 h.api.initMobileShortcut();await h.flush();
 assert.equal(h.count(),'1');
 await h.api.refreshMobileShortcutCount();await h.flush();
 assert.equal(h.count(),'1');
 assert.equal(h.requests(),2);
 h.redraw();assert.equal(h.count(),'1');
});
test('new session hydrates cache immediately; server newer count replaces it without flash',async()=>{
 const storage=new Map();
 const initial=harness({sharedStorage:storage,responses:[{ok:true,appointments:[booking('2026-10-27')]}]});
 initial.api.initMobileShortcut();await initial.flush();assert.equal(initial.count(),'1');
 const again=harness({sharedStorage:storage,responses:[{ok:true,appointments:[booking('2026-10-27'),booking('2026-10-27'),booking('2026-10-27')]}]});
 again.api.initMobileShortcut();
 assert.equal(again.count(),'1','show stored number before fetching');
 await again.flush();assert.equal(again.count(),'3');
 assert.equal(again.requests(),1);
});
test('academy and KST date changes never reuse another school or yesterday count',async()=>{
 const storage=new Map();
 const h=harness({sharedStorage:storage,responses:[
  {ok:true,appointments:[booking('2026-10-27'),booking('2026-10-27')]},
  {ok:true,appointments:[booking('2026-10-27')]},
  {ok:true,appointments:[]}
 ]});
 h.api.initMobileShortcut();await h.flush();assert.equal(h.count(),'2');
 h.switchAcademy('academy-B');assert.equal(h.count(),'–');await h.flush();assert.equal(h.count(),'1');
 h.switchDay('2026-10-28');assert.equal(h.count(),'–');await h.flush();assert.equal(h.count(),'0');
 assert.equal(h.requests(),3);
 assert.ok(storage.has('olli_booking_today_count_v1:academy-A'));
 assert.ok(storage.has('olli_booking_today_count_v1:academy-B'));
});
test('browser focus refreshes once and checks latest remote appointments; DOM mutation alone does not',async()=>{
 const h=harness({responses:[{ok:true,appointments:[booking('2026-10-27')]},
   {ok:true,appointments:[booking('2026-10-27'),booking('2026-10-27')]}]});
 h.api.initMobileShortcut();await h.flush();assert.equal(h.count(),'1');
 h.listeners.focus();h.listeners.visibilitychange();await h.flush();
 assert.equal(h.requests(),1,'focus and visibility are throttled just after initial fetch');
 await h.api.refreshMobileShortcutCount();await h.flush();
 assert.equal(h.count(),'2');
 h.redraw();assert.equal(h.count(),'2');
 assert.equal(h.requests(),2);
});
test('storage restrictions fall back to memory cache on every dashboard redraw',async()=>{
 const h=harness({blockedStorage:true,responses:[{ok:true,appointments:[booking('2026-10-27'),booking('2026-10-27')]}]});
 h.api.initMobileShortcut();await h.flush();assert.equal(h.count(),'2');
 for(let i=0;i<3;i++){h.redraw();assert.equal(h.count(),'2');}
 assert.equal(h.requests(),1);
});
test('pending duplicate requests coalesce and stale previous-academy responses are ignored',async()=>{
 let firstResolve;
 const deferred=new Promise(resolve=>{firstResolve=resolve;});
 const h=harness({responses:[()=>deferred,{ok:true,appointments:[booking('2026-10-27')]}]});
 h.api.initMobileShortcut();
 h.redraw();h.redraw();
 assert.equal(h.requests(),1);
 h.switchAcademy('academy-B');await h.flush();
 assert.equal(h.count(),'1');
 firstResolve({ok:true,appointments:Array.from({length:9},()=>booking('2026-10-27'))});
 await h.flush();
 assert.equal(h.count(),'1','stale academy-A reply must not overwrite academy-B');
});
