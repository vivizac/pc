const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'olli-main-subpage-drawer.js'),'utf8');
function setup(id='kinderChatFeedbackScreen',reduced=false){
  const frames=[],calls=[],nodes=new Map(),timers=new Map();let timerId=0;
  function element(id,display='none'){
    const attrs=new Map(),classes=new Set(),listeners=new Map();
    return {id,style:{display,visibility:'',zIndex:'',transform:'',opacity:'',filter:'',pointerEvents:''},offsetWidth:393,hidden:false,
      getAttribute:key=>attrs.get(key)??null,setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k),hasAttribute:k=>attrs.has(k),
      classList:{add:(...ks)=>ks.forEach(k=>classes.add(k)),remove:(...ks)=>ks.forEach(k=>classes.delete(k)),contains:k=>classes.has(k),toggle:(k,on)=>on?classes.add(k):classes.delete(k)},
      addEventListener:(k,fn)=>{if(!listeners.has(k))listeners.set(k,new Set());listeners.get(k).add(fn);},removeEventListener:(k,fn)=>listeners.get(k)?.delete(fn),
      emit(k){for(const fn of Array.from(listeners.get(k)||[]))fn({target:this,propertyName:'transform'});},querySelector:()=>null};
  }
  for(const n of ['studentMemoScreen','observationRosterScreen','kinderChatFeedbackScreen','olliTalkBetaScreen','recordRoomScreen','olliMainDrawerReturnHit'])nodes.set(n,element(n,n===id?'flex':'none'));
  const window={matchMedia:()=>({matches:reduced}),setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),
    openRecordAttendanceDashboard:opts=>{calls.push(opts.localOnly?'local':'remote');return Promise.resolve(true);},
    loadRecords:()=>{calls.push('server-refresh');return Promise.resolve();},prepareOlliRecordSearchForDrawer:()=>calls.push('search-reset')};
  const document={getElementById:id=>nodes.get(id)||null,activeElement:null,body:{classList:element('body').classList},querySelectorAll:()=>Array.from(nodes.values())};
  const context={window,document,loadRecords:window.loadRecords,requestAnimationFrame:fn=>frames.push(fn),getComputedStyle:e=>({display:e.style.display}),clearTimeout:window.clearTimeout};
  vm.runInNewContext(source,context);
  return {window,nodes,calls,frames,main:nodes.get(id),record:nodes.get('recordRoomScreen')};
}
test('startup has no attendance preload or rear-mount callbacks',()=>{
  const s=setup();assert.equal(s.calls.length,0);assert.equal(s.record.style.display,'none');assert.equal(s.frames.length,0);
  for(const name of ['scheduleOlliMainDrawerAttendancePrewarm','syncOlliMainDrawerAttendanceRearPage','releaseOlliMainDrawerAttendanceRearPage'])assert.equal(s.window[name],undefined);
});
test('every foreground opens attendance on demand then scales it in the same animation frame',async()=>{
  for(const id of ['studentMemoScreen','observationRosterScreen','kinderChatFeedbackScreen','olliTalkBetaScreen']){
    const s=setup(id);assert.equal(s.window.openOlliMainSubpageDrawer(null),true);
    assert.equal(s.calls.filter(k=>k==='local').length,1);
    assert.equal(s.record.classList.contains('is-olli-attendance-revealed'),false);
    s.frames.shift()();assert.equal(s.record.classList.contains('is-olli-attendance-revealed'),true);
    assert.equal(s.main.classList.contains('is-olli-main-drawer-open'),true);
    s.main.emit('transitionend');await Promise.resolve();
    const closing=s.window.closeOlliMainSubpageDrawer();
    assert.equal(s.record.classList.contains('is-olli-attendance-revealed'),false);
    assert.equal(s.record.classList.contains('is-olli-main-drawer-returning'),true);
    s.main.emit('transitionend');await closing;
    assert.equal(s.record.style.display,'none');
    assert.equal(s.record.classList.contains('olliMainDrawerSubpage'),false);
    assert.equal(s.record.classList.contains('is-olli-main-drawer-returning'),false);
    assert.equal(s.window.openOlliMainSubpageDrawer(null),true);
    assert.equal(s.calls.filter(k=>k==='local').length,2);
  }
});
test('reduced motion still closes and restores the hidden attendance state',async()=>{
  const s=setup('kinderChatFeedbackScreen',true);s.window.openOlliMainSubpageDrawer(null);s.frames.shift()();await Promise.resolve();
  await s.window.closeOlliMainSubpageDrawer();assert.equal(s.record.style.display,'none');
});
test('scale is uniform, centered and matches the foreground slide durations',()=>{
  const css=fs.readFileSync(path.join(root,'olli-phone-base.css'),'utf8');
  const base=css.match(/#recordRoomScreen\.olliMainDrawerSubpage \{([^}]+)\}/)[1];
  assert.match(base,/transform:scale\(\.92\)/);assert.match(base,/transform-origin:center center/);assert.match(base,/transition:transform 320ms/);
  assert.match(css,/#recordRoomScreen\.olliMainDrawerSubpage\.is-olli-attendance-revealed \{\s*transform:scale\(1\)/);
  assert.match(css,/#recordRoomScreen\.olliMainDrawerSubpage\.is-olli-main-drawer-returning \{\s*transition-duration:340ms/);
  assert.doesNotMatch(source,/attendanceRearMountState|attendancePreparedKey|Prewarm|prewarm|mountAttendanceRearPage/);
});
