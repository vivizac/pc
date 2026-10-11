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
      id, style: { display, removeProperty(key) { delete this[key]; }, setProperty(key, value) { this[key] = value; } }, children: [], offsetWidth: 390,
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
  const observation = element('observationRosterScreen');
  const work = element('olliTalkBetaScreen');
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
    document: { body, readyState: 'complete', activeElement: null, getElementById: id => nodes.get(id) || null, createElement: () => element('created'), querySelectorAll: () => [...nodes.values()].filter(n => /Screen$/.test(n.id)) },
    requestAnimationFrame: fn => frames.push(fn),
    getComputedStyle: node => { events.push({ kind: 'style', id: node.id }); return { display: node.style.display, opacity: '1', zIndex: node.style.zIndex || 'auto' }; },
    loadRecords: (_name, options) => { events.push({ kind: 'server-sync', reuseRendered: options.reuseRendered }); return Promise.resolve(); }
  };
  vm.runInNewContext(source, context);
  return { context, window, frames, idle, events, timers, rear, list, quick, observation, work, nodes,
    notify: () => window.syncOlliMainDrawerAttendanceRearPage(),
    setAcademy: value => academy = value, setDivision: value => division = value,
    tick: () => frames.shift()?.(), runIdle: async () => { idle.shift()?.(); await flush(); } };
}

test('idle preparation renders the actual rear page below the foreground without interaction', async () => {
  const s = setup();
  s.window.scheduleOlliMainDrawerAttendancePrewarm();
  s.window.scheduleOlliMainDrawerAttendancePrewarm();
  assert.equal(s.idle.length, 1);
  assert.equal(s.events.filter(e => e.kind === 'local-render').length, 0);
  await s.runIdle();
  assert.deepEqual(s.events.filter(e => e.kind === 'local-render'), [{ kind: 'local-render', localOnly: true }]);
  assert.equal(s.rear.style.display, 'flex');
  assert.equal(s.list.children.length, 1);
  assert.ok(Number(s.rear.style.zIndex) < Number(s.quick.style.zIndex));
  assert.equal(s.rear.style.pointerEvents, 'none');
  assert.equal(s.rear.getAttribute('aria-hidden'), 'true');
  assert.equal(s.rear.hasAttribute('inert'), true);
  assert.equal(s.events.some(e => e.kind === 'server-sync'), false);
});

test('a prepared roster opens in one frame without rebuilding cards, then syncs after motion', async () => {
  for (const kind of ['quicknote', 'observation', 'work']) {
    const s = setup();
    s.quick.style.display = kind === 'quicknote' ? 'flex' : 'none';
    s.observation.style.display = kind === 'observation' ? 'flex' : 'none';
    s.work.style.display = kind === 'work' ? 'flex' : 'none';
    s.window.scheduleOlliMainDrawerAttendancePrewarm(); await s.runIdle();
    assert.equal(s.rear.style.display, 'flex');
    const cards = s.list.children;
    const front = ({ quicknote: s.quick, observation: s.observation, work: s.work })[kind];
    const frontZ = front.style.zIndex, rearZ = s.rear.style.zIndex;
    assert.equal(front.hasAttribute('data-olli-drawer-rear-host'), true);
    assert.equal(s.window.openOlliMainSubpageDrawer(null, kind), true);
    assert.equal(s.window.openOlliMainSubpageDrawer(null, kind), false);
    s.tick();
    assert.equal(s.window.isOlliMainSubpageDrawerOpen(), true);
    assert.equal(s.rear.style.display, 'flex');
    assert.equal(s.list.children, cards);
    assert.equal(front.style.zIndex, frontZ);
    assert.equal(s.rear.style.zIndex, rearZ);
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
    assert.equal(s.rear.style.display, 'flex');
    assert.equal(s.rear.hasAttribute('inert'), true);
    assert.equal(s.rear.style.pointerEvents, 'none');
    assert.equal(s.quick.style.display, 'flex');
    assert.equal(s.window.isOlliMainSubpageDrawerOpen(), false);
    assert.equal(s.events.some(e => e.kind === 'server-sync'), false);
    s.window.openOlliMainSubpageDrawer(null, 'quicknote'); s.tick();
    assert.equal(s.window.isOlliMainSubpageDrawerOpen(), true);
    assert.equal(s.rear.style.display, 'flex');
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
test('page navigation restores the rear before paint and releases it for real attendance', async () => {
  const s = setup(); s.window.scheduleOlliMainDrawerAttendancePrewarm(); await s.runIdle();
  s.quick.style.display = 'none'; s.observation.style.display = 'flex';
  s.rear.style.display = 'none'; s.notify();
  assert.equal(s.rear.style.display, 'flex');
  assert.ok(Number(s.rear.style.zIndex) < Number(s.observation.style.zIndex));
  s.observation.style.display = 'none'; s.rear.style.display = 'flex'; s.notify();
  assert.equal(s.rear.style.display, 'flex');
  assert.equal(s.rear.hasAttribute('inert'), false);
  assert.notEqual(s.rear.style.pointerEvents, 'none');
  assert.equal(s.rear.hasAttribute('data-olli-drawer-rear-mounted'), false);
});
test('opening real attendance restores interactive state, and another route keeps it hidden', async () => {
  const s = setup(); s.window.scheduleOlliMainDrawerAttendancePrewarm(); await s.runIdle();
  await s.window.openOlliAttendancePage();
  assert.equal(s.rear.style.display, 'flex');
  assert.equal(s.rear.hasAttribute('inert'), false);
  assert.notEqual(s.rear.style.pointerEvents, 'none');
  assert.equal(s.quick.style.display, 'none');
  const other = setup(); other.window.scheduleOlliMainDrawerAttendancePrewarm(); await other.runIdle();
  other.quick.style.display = 'none'; other.rear.style.display = 'none'; other.notify();
  assert.equal(other.rear.style.display, 'none');
  assert.equal(other.rear.hasAttribute('inert'), false);
});
test('all drawer rear fade state and opacity animation code is removed', () => {
  assert.doesNotMatch(source, /beginDrawerReturnFade|olliMainDrawerRearFading|is-olli-main-drawer-rear-open|is-olli-main-drawer-rear-returning|getComputedStyle\(content\)\.opacity/);
});

test('memo and roster transitions retain the rendered rear under the active foreground', async () => {
  const s = setup(); s.window.scheduleOlliMainDrawerAttendancePrewarm(); await s.runIdle();
  const cards = s.list.children, memo = s.nodes.get('studentMemoScreen');
  s.quick.style.display = 'none'; s.observation.style.display = 'flex'; s.notify();
  memo.style.display = 'flex'; s.notify();
  assert.ok(Number(s.rear.style.zIndex) < Number(memo.style.zIndex));
  memo.style.display = 'none'; s.notify();
  assert.ok(Number(s.rear.style.zIndex) < Number(s.observation.style.zIndex));
  assert.equal(s.rear.style.display, 'flex');
  assert.equal(s.list.children, cards);
});


test('Work entry ignores the mounted rear as its source and restores it before the first frame', async () => {
  for (const kind of ['quicknote', 'observation', 'attendance']) {
    const s = setup();
    if (kind === 'attendance') {
      s.quick.style.display = 'none'; s.rear.style.display = 'flex';
    } else {
      if (kind === 'observation') {
        s.quick.style.display = 'none'; s.observation.style.display = 'flex';
      }
      s.window.scheduleOlliMainDrawerAttendancePrewarm(); await s.runIdle();
    }
    const cards = s.list.children;
    const talk = fs.readFileSync('olli-talk-beta.js', 'utf8');
    const open = talk.slice(talk.indexOf('  async function openOlliTalkBetaPage('), talk.indexOf('  async function closeOlliTalkBetaPage('));
    Object.assign(s.context, {
      olliTalkChatGestureSettleTimer: null, OLLI_TALK_INITIAL_RENDER_LIMIT: 100,
      getScreen: () => s.work,
      isOlliTalkTabbedPageId: id => ['kinderChatFeedbackScreen', 'observationRosterScreen', 'studentMemoScreen'].includes(id),
      getOlliTalkBetaContext: () => ({}), readOlliTalkMessageCache: () => null,
      clearTimeout: () => {}
    });
    for (const name of ['syncOlliTalkContextTab', 'syncOlliTalkContrastTheme', 'closeOlliTalkSearch', 'applyOlliTalkMemberCount', 'setOlliTalkLoadingState', 'bindViewport', 'resizeInput', 'syncViewport', 'updateOlliTalkBetaComposerState']) s.context[name] = () => {};
    vm.runInNewContext(open, s.context);
    await s.context.openOlliTalkBetaPage();
    assert.equal(s.context.olliTalkBetaReturnPageId, { quicknote:'kinderChatFeedbackScreen', observation:'observationRosterScreen', attendance:'recordRoomScreen' }[kind]);
    assert.equal(s.work.style.display, 'flex');
    if (kind === 'attendance') await s.runIdle();
    assert.equal(s.rear.style.display, 'flex');
    assert.equal(s.rear.hasAttribute('inert'), true);
    assert.equal(s.work.hasAttribute('data-olli-drawer-rear-host'), true);
    if (kind !== 'attendance') assert.equal(s.list.children, cards);
    assert.equal(s.events.some(e => e.kind === 'server-sync'), false);
    const helper = talk.slice(talk.indexOf('  async function slideOlliTalkOutTo('), talk.indexOf('  async function openOlliTalkBetaPage('));
    vm.runInNewContext(helper, s.context);
    const target = kind === 'observation' ? s.observation : kind === 'attendance' ? s.rear : s.quick;
    await s.context.slideOlliTalkOutTo(target);
    assert.equal(s.work.style.display, 'none');
    assert.equal(s.work.hasAttribute('data-olli-drawer-rear-host'), false);
    assert.equal(s.rear.style.display, 'flex');
    assert.equal(s.rear.hasAttribute('inert'), kind !== 'attendance');
    if (kind !== 'attendance') assert.equal(target.hasAttribute('data-olli-drawer-rear-host'), true);
  }
});

function bindAttendanceRenderer(s) {
  const paints = [];
  let data = 'cached';
  s.window.OlliPhoneAttendanceAdapter = { renderRecordListOverride(view, name) {
    paints.push({ view, name, data }); s.list.children = [{ data }]; return true;
  }};
  s.context.document.addEventListener = () => {};
  s.context.setTimeout = s.window.setTimeout;
  s.window.document = s.context.document;
  vm.runInNewContext(fs.readFileSync('olli-record-list-view.js', 'utf8'), s.context);
  s.window.renderElementaryRecords = s.context.renderElementaryRecords;
  s.window.renderKinderRecords = s.context.renderKinderRecords;
  return { paints, setData(value) { data = value; } };
}

test('opening holds real roster renders and paints the newest result only once after motion', async () => {
  for (const view of ['elementary', 'kinder']) {
  const s = setup(); s.setDivision(view); s.window.scheduleOlliMainDrawerAttendancePrewarm(); await s.runIdle();
  const r = bindAttendanceRenderer(s), cards = s.list.children;
  s.window.openOlliMainSubpageDrawer(null, 'quicknote'); s.tick();
  for (const data of ['first refresh', 'latest refresh']) {
    r.setData(data); s.context[view === 'kinder' ? 'renderKinderRecords' : 'renderElementaryRecords']('');
  }
  assert.equal(s.list.children, cards); assert.equal(r.paints.length, 0);
  s.quick.dispatchTransition(); await flush();
  assert.deepEqual(r.paints, [{ view, name:'', data:'latest refresh' }]);
  s.context[view === 'kinder' ? 'renderKinderRecords' : 'renderElementaryRecords']('after motion');
  assert.equal(r.paints.length, 2);
  }
});

test('closing holds updates until the return finishes', async () => {
  const s = setup(); s.window.scheduleOlliMainDrawerAttendancePrewarm(); await s.runIdle();
  const r = bindAttendanceRenderer(s);
  s.window.openOlliMainSubpageDrawer(null, 'quicknote'); s.tick(); s.quick.dispatchTransition(); await flush();
  const closing = s.window.closeOlliMainSubpageDrawer(), cards = s.list.children;
  r.setData('latest'); s.context.renderElementaryRecords('');
  assert.equal(s.list.children, cards); assert.equal(r.paints.length, 0);
  s.quick.dispatchTransition(); await closing;
  assert.equal(r.paints.length, 1); assert.equal(r.paints[0].data, 'latest');
});

test('transition fallback releases pending paints when transitionend is missing', async () => {
  const s = setup(); s.window.scheduleOlliMainDrawerAttendancePrewarm(); await s.runIdle();
  const r = bindAttendanceRenderer(s);
  s.window.openOlliMainSubpageDrawer(null, 'quicknote'); s.tick();
  s.context.renderElementaryRecords(''); assert.equal(r.paints.length, 0);
  [...s.timers.values()].find(t => t.delay === 400).fn(); await flush();
  assert.equal(r.paints.length, 1);
});

test('pending paints from a previous academy or division are discarded', async () => {
  for (const changed of ['academy', 'division']) {
    const s = setup(); s.window.scheduleOlliMainDrawerAttendancePrewarm(); await s.runIdle();
    const r = bindAttendanceRenderer(s);
    s.window.openOlliMainSubpageDrawer(null, 'quicknote'); s.tick();
    s.context.renderElementaryRecords('');
    if (changed === 'academy') s.setAcademy('academy-2');
    else { s.setDivision('kinder'); s.context.currentRecordView = 'kinder'; }
    s.quick.dispatchTransition(); await flush();
    assert.equal(r.paints.length, 0);
  }
});

test('an empty local roster is rendered immediately even while motion is active', async () => {
  const s = setup(), r = bindAttendanceRenderer(s);
  s.window.openOlliMainSubpageDrawer(null, 'quicknote'); s.tick();
  s.list.children = [];
  s.context.renderElementaryRecords(''); assert.equal(r.paints.length, 1);
});

test('the real attendance refresh merges fetched rows during motion without replacing mounted cards', async () => {
  const s = setup(); s.window.scheduleOlliMainDrawerAttendancePrewarm(); await s.runIdle();
  const r = bindAttendanceRenderer(s), cached = [{ status:'absent' }], incoming = [{ status:'attended' }];
  let stored = cached, resolveRows, requests = 0;
  const data = { getCachedMonth:() => stored, loadMonth:() => { requests++; return new Promise(resolve => { resolveRows = resolve; }); } };
  Object.assign(s.context, { global:s.window, shared:() => data, currentYearMonth:() => '2026-10', attendanceRowsSignature:JSON.stringify,
    mergeServerMonth:rows => { stored = rows; r.setData(rows[0].status); }, getCurrentRecordView:() => s.context.currentRecordView });
  const adapter = fs.readFileSync('olli-attendance-phone-adapter.js', 'utf8');
  const render = adapter.slice(adapter.indexOf('  function renderCurrentRecordList()'), adapter.indexOf('  function cloneValue('));
  const sync = adapter.slice(adapter.indexOf('  async function syncCurrentMonth('), adapter.indexOf('  function setTodayScheduleFromWeek('));
  vm.runInNewContext(render + sync, s.context);
  s.window.openOlliMainSubpageDrawer(null, 'quicknote'); s.tick();
  const cards = s.list.children, pending = s.context.syncCurrentMonth(new Date(), { render:true });
  assert.equal(requests, 1); resolveRows(incoming); await pending;
  assert.equal(stored, incoming); assert.equal(s.list.children, cards); assert.equal(r.paints.length, 0);
  s.quick.dispatchTransition(); await flush();
  assert.equal(r.paints.length, 1); assert.equal(r.paints[0].data, 'attended');
});

test('closing during opening releases the newest pending update once', async () => {
  for (const frameStarted of [false, true]) {
    const s = setup(); s.window.scheduleOlliMainDrawerAttendancePrewarm(); await s.runIdle();
    const r = bindAttendanceRenderer(s);
    s.window.openOlliMainSubpageDrawer(null, 'quicknote');
    if (frameStarted) s.tick();
    s.context.renderElementaryRecords('');
    const closing = s.window.closeOlliMainSubpageDrawer();
    while (s.frames.length) s.tick();
    s.quick.dispatchTransition(); await closing; await flush();
    assert.equal(r.paints.length, 1);
    assert.equal(s.window.isOlliMainSubpageDrawerOpen(), false);
  }
});
test('real attendance navigation still paints locally before its server request completes', async () => {
  const s = setup(); s.window.scheduleOlliMainDrawerAttendancePrewarm(); await s.runIdle();
  const r = bindAttendanceRenderer(s);
  let finishServer;
  s.window.openRecordAttendanceDashboard = () => {
    s.context.renderElementaryRecords('');
    return new Promise(resolve => { finishServer = resolve; });
  };
  const opened = s.window.openOlliAttendancePage();
  assert.equal(r.paints.length, 1);
  finishServer(true); await opened;
  assert.equal(s.rear.hasAttribute('inert'), false);
});
