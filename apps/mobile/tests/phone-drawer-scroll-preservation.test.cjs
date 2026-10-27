const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'olli-page-scroll-reset.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup() {
  const frames = [], timers = [], resets = [];
  let drawerOpen = false, navigating = false, observer;
  function page(id) {
    const attrs = new Set(), classes = new Set(['pageScreen']);
    const inner = { scrollTop:0, scrollLeft:0 };
    return { id, style:{display:'flex'}, scrollTop:0, scrollLeft:0, inner,
      classList:{contains:name => classes.has(name),
        add:name => classes.add(name), remove:name => classes.delete(name)},
      querySelector:selector => id === 'recordRoomScreen' && selector === '#recordPageInner' ? inner : null,
      contains:() => false, querySelectorAll:() => [inner],
      hasAttribute:name => attrs.has(name),
      setAttribute:name => attrs.add(name), removeAttribute:name => attrs.delete(name) };
  }
  const rear = page('recordRoomScreen'), front = page('kinderChatFeedbackScreen');
  const window = { getComputedStyle:el => ({display:el.style.display,visibility:'visible',opacity:'1'}),
    scrollTo:() => resets.push('viewport'),
    isOlliMainSubpageDrawerOpen:() => drawerOpen,
    isOlliPhoneNavigationInFlight:() => navigating,
    openRecordAttendanceDashboard:() => Promise.resolve(true),
    openKinderChatFeedbackPage:() => true };
  const context = { window,
    document:{readyState:'complete',activeElement:null,querySelectorAll:() => [rear,front]},
    getComputedStyle:window.getComputedStyle,
    requestAnimationFrame:fn => frames.push(fn),
    setTimeout:(fn,ms) => {timers.push({fn,ms});return timers.length;},
    MutationObserver:class {constructor(fn){observer=fn;}observe(){}} };
  vm.runInNewContext(source, context);
  return {window,rear,front,frames,timers,resets,
    positions(){rear.scrollTop=64;rear.inner.scrollTop=64;front.scrollTop=24;front.inner.scrollTop=24;resets.length=0;},
    setOpen:value => drawerOpen=value, setNavigating:value => navigating=value,
    notify:el => observer([{target:el}]),
    run(){while(frames.length)frames.shift()();while(timers.length)timers.shift().fn();} };
}

test('local preparation does not schedule any foreground or rear scroll reset', async () => {
  const s=setup();s.positions();
  await s.window.openRecordAttendanceDashboard({localOnly:true});await flush();s.run();
  assert.equal(s.rear.inner.scrollTop,64);assert.equal(s.front.inner.scrollTop,24);
  assert.equal(s.resets.length,0);assert.equal(s.timers.length,0);
});

test('a previously scheduled 320ms reset preserves the mounted rear', async () => {
  const s=setup();s.positions();
  s.window.openKinderChatFeedbackPage();await flush();
  assert.ok(s.timers.some(t => t.ms === 320));
  s.setOpen(true);s.run();
  assert.equal(s.rear.scrollTop,64);assert.equal(s.rear.inner.scrollTop,64);
});

test('delayed callbacks cannot move any page or viewport during opening, closing or switching', async () => {
  for(const mode of ['drawer','navigation']) {
    const s=setup();s.positions();s.window.openKinderChatFeedbackPage();await flush();
    if(mode==='drawer')s.setOpen(true);else s.setNavigating(true);
    s.run();assert.equal(s.rear.inner.scrollTop,64);assert.equal(s.front.inner.scrollTop,24);
    assert.equal(s.resets.length,0);
  }
});

test('the visibility observer also preserves a rear becoming visible', () => {
  const s=setup();s.rear.style.display='none';s.notify(s.rear);s.positions();
  s.setOpen(true);s.rear.style.display='flex';s.notify(s.rear);s.run();
  assert.equal(s.rear.inner.scrollTop,64);
});

test('ordinary attendance navigation still resets its scroll when the rear role is released', async () => {
  const s=setup();s.front.style.display='none';s.positions();
  await s.window.openRecordAttendanceDashboard();await flush();s.run();
  assert.equal(s.rear.inner.scrollTop,0);assert.ok(s.resets.length>0);
  s.positions();s.setOpen(true);s.window.olliResetPageScroll();
  assert.equal(s.rear.inner.scrollTop,64);
  s.setOpen(false);s.window.olliResetPageScroll();
  assert.equal(s.rear.inner.scrollTop,0);
});


test('scrolling Students then switching to Attendance resets only the shared record scroller', () => {
  const s=setup();
  s.rear.classList.add('record-academy-view');
  s.notify(s.rear); // Enter Students.
  s.positions();
  s.rear.classList.remove('record-academy-view');
  s.notify(s.rear);
  assert.equal(s.rear.inner.scrollTop,0);
  assert.equal(s.front.inner.scrollTop,24);
  assert.equal(s.resets.length,0, 'view switch does not move the viewport');
});

test('switching Attendance to Students starts the student management page at top', () => {
  const s=setup();
  s.positions();
  s.rear.classList.add('record-academy-view');
  s.notify(s.rear);
  assert.equal(s.rear.inner.scrollTop,0);
  assert.equal(s.front.inner.scrollTop,24);
});

test('leaving a scrolled student or attendance page discards its old scroll', () => {
  for (const view of ['academy','attendance']) {
    const s=setup();
    if (view === 'academy') {
      s.rear.classList.add('record-academy-view');
      s.notify(s.rear);
    }
    s.positions();
    s.rear.style.display='none';
    s.notify(s.rear);
    assert.equal(s.rear.inner.scrollTop,0, view+' should reset on hide');
    assert.equal(s.front.inner.scrollTop,24, 'other page scroll should remain');
    s.rear.style.display='flex';
    s.notify(s.rear);
    assert.equal(s.rear.inner.scrollTop,0, 'reopening at the top');
  }
});

test('prewarmed and drawer-controlled attendance remain scroll-stable', () => {
  const s=setup();
  s.rear.style.display='none';
  s.notify(s.rear);
  s.positions();
  s.rear.classList.add('olliAttendanceRearPrepared');
  s.rear.style.display='flex';
  s.notify(s.rear);
  assert.equal(s.rear.inner.scrollTop,64, 'prewarming cannot reset the background list');
  s.setOpen(true);
  s.rear.classList.remove('olliAttendanceRearPrepared');
  s.notify(s.rear);
  assert.equal(s.rear.inner.scrollTop,64, 'drawer open does not jump a visible rear');
  s.setOpen(false);
});

test('installed mobile HTML refreshes the record scroll reset script only', () => {
  const html=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','index.html'),'utf8');
  assert.match(html,/olli-page-scroll-reset\.js\?v=20261027-record-room-scroll-reset-1/);
});
