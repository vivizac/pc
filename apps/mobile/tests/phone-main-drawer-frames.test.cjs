const fs = require('fs');
const vm = require('vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const source = fs.readFileSync('olli-main-subpage-drawer.js', 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup({ idleSupported = true } = {}) {
  const frames = [], idle = [], events = [], nodes = new Map(), timers = new Map();
  let academy = 'academy-1', division = 'elementary', nextTimer = 0, context;
  function element(id, display = 'none') {
    const classes = new Set(), attrs = new Map(), listeners = new Map();
    const node = {
      id, style: { display }, children: [], offsetWidth: 390,
      classList: {
        add: (...items) => items.forEach(item => classes.add(item)),
        remove: (...items) => items.forEach(item => classes.delete(item)),
        contains: item => classes.has(item),
        toggle: (item, enabled) => enabled ? classes.add(item) : classes.delete(item)
      },
      getAttribute: key => attrs.get(key) ?? null,
      setAttribute: (key, value) => attrs.set(key, value),
      removeAttribute: key => attrs.delete(key),
      hasAttribute: key => attrs.has(key),
      querySelector: selector => selector === '#recordList' ? nodes.get('recordList') : null,
      addEventListener: (key, callback) => {
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key).add(callback);
      },
      removeEventListener: (key, callback) => listeners.get(key)?.delete(callback),
      appendChild: child => nodes.set(child.id, child),
      dispatchTransition: () => [...(listeners.get('transitionend') || [])].forEach(fn => fn({ target: node, propertyName: 'transform' }))
    };
    nodes.set(id, node);
    return node;
  }
  const rear = element('recordRoomScreen'), list = element('recordList');
  rear.children = [element('recordPageInner'), element('floatingBar')];
  const quick = element('kinderChatFeedbackScreen', 'flex');
  const observation = element('observationRosterScreen', 'flex');
  const work = element('olliTalkBetaScreen', 'flex');
  element('studentMemoScreen'); element('kcfPersistentTopLayer'); element('observationPersistentNavLayer');
  const body = element('body', 'block');
  const window = {
    matchMedia: () => ({ matches: false }),
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    getOlliCurrentAcademyId: () => academy,
    getOlliLastRecordDivisionView: () => division,
    openRecordAttendanceDashboard: options => {
      events.push({ kind: 'local-render', localOnly: options.localOnly });
      context.currentRecordView = division;
      list.children = [{}];
      return Promise.resolve(true);
    }
  };
  if (idleSupported) window.requestIdleCallback = fn => idle.push(fn);
  context = { window, currentRecordView: 'elementary',
    document: { body, activeElement: null, getElementById: id => nodes.get(id) || null, createElement: () => element('created'), querySelectorAll: () => [] },
    requestAnimationFrame: fn => frames.push(fn),
    getComputedStyle: node => { events.push({ kind: 'style', id: node.id }); return { display: node.style.display, opacity: '.18' }; },
    loadRecords: (_name, options) => { events.push({ kind: 'server-sync', reuseRendered: options.reuseRendered }); return Promise.resolve(); }
  };
  vm.runInNewContext(source, context);
  return { window, frames, idle, events, timers, rear, list, quick, observation, work,
    setAcademy: value => academy = value, setDivision: value => division = value,
    tick: () => frames.shift()?.(), runIdle: async () => { idle.shift()?.(); await flush(); } };
}

test('idle preparation runs once from local data and leaves the rear screen hidden', async () => {
  const s = setup();
  s.window.scheduleOlliMainDrawerAttendancePrewarm();
  s.window.scheduleOlliMainDrawerAttendancePrewarm();
  assert.equal(s.idle.length, 1);
  assert.equal(s.events.filter(e => e.kind === 'local-render').length, 0);
  await s.runIdle();
  assert.deepEqual(s.events.filter(e => e.kind === 'local-render'), [{ kind: 'local-render', localOnly: true }]);
  assert.equal(s.rear.style.display, 'none');
  assert.equal(s.list.children.length, 1);
  assert.equal(s.events.some(e => e.kind === 'server-sync'), false);
});

test('a prepared roster opens in one frame without rebuilding cards, then syncs after motion', async () => {
  for (const kind of ['quicknote', 'observation', 'work']) {
    const s = setup();
    s.window.scheduleOlliMainDrawerAttendancePrewarm(); await s.runIdle();
    const cards = s.list.children;
    assert.equal(s.window.openOlliMainSubpageDrawer(null, kind), true);
    assert.equal(s.window.openOlliMainSubpageDrawer(null, kind), false);
    s.tick();
    assert.equal(s.rear.classList.contains('is-olli-main-drawer-rear-open'), true);
    assert.equal(s.list.children, cards);
    assert.equal(s.events.filter(e => e.kind === 'local-render').length, 1);
    assert.equal(s.events.some(e => e.kind === 'server-sync'), false);
    ({ quicknote: s.quick, observation: s.observation, work: s.work })[kind].dispatchTransition();
    await flush();
    assert.deepEqual(s.events.filter(e => e.kind === 'server-sync'), [{ kind: 'server-sync', reuseRendered: true }]);
  }
});

test('an early click or changed academy/division falls back to local-only rendering', async () => {
  for (const change of ['early', 'academy', 'division']) {
    const s = setup();
    s.window.scheduleOlliMainDrawerAttendancePrewarm();
    if (change !== 'early') await s.runIdle();
    if (change === 'academy') s.setAcademy('academy-2');
    if (change === 'division') s.setDivision('kinder');
    const before = s.events.filter(e => e.kind === 'local-render').length;
    s.window.openOlliMainSubpageDrawer(null, 'quicknote');
    assert.equal(s.events.filter(e => e.kind === 'local-render').length, before + 1);
    assert.equal(s.events.filter(e => e.kind === 'local-render').at(-1).localOnly, true);
    s.tick(); await s.runIdle();
    assert.equal(s.events.filter(e => e.kind === 'local-render').length, before + 1);
    assert.equal(s.events.some(e => e.kind === 'server-sync'), false);
  }
});

test('closing during opening cancels stale motion and deferred synchronization', async () => {
  for (const ticks of [0, 1]) {
    const s = setup();
    s.window.scheduleOlliMainDrawerAttendancePrewarm(); await s.runIdle();
    s.window.openOlliMainSubpageDrawer(null, 'quicknote');
    for (let i = 0; i < ticks; i++) s.tick();
    const closed = s.window.closeOlliMainSubpageDrawer();
    while (s.frames.length) s.tick();
    s.quick.dispatchTransition(); await closed; await flush();
    assert.equal(s.rear.style.display, 'none');
    assert.equal(s.quick.style.display, 'flex');
    assert.equal(s.window.isOlliMainSubpageDrawerOpen(), false);
    assert.equal(s.events.some(e => e.kind === 'server-sync'), false);
    s.window.openOlliMainSubpageDrawer(null, 'quicknote'); s.tick();
    assert.equal(s.rear.classList.contains('is-olli-main-drawer-rear-open'), true);
  }
});

test('idle fallback works and visible attendance is not prepared again', async () => {
  const s = setup({ idleSupported: false });
  s.window.scheduleOlliMainDrawerAttendancePrewarm();
  const timer = [...s.timers.values()].find(t => t.delay === 120);
  assert.ok(timer); timer.fn(); await flush();
  assert.equal(s.list.children.length, 1);
  const visible = setup(); visible.rear.style.display = 'flex';
  visible.window.scheduleOlliMainDrawerAttendancePrewarm(); await visible.runIdle();
  assert.equal(visible.events.some(e => e.kind === 'local-render'), false);
});