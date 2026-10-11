const fs = require('fs');
const vm = require('vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync('olli-main-subpage-drawer.js', 'utf8');

function setup() {
  const frames = [], events = [], nodes = new Map();
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
      addEventListener: (key, callback) => listeners.set(key, callback),
      removeEventListener: key => listeners.delete(key),
      appendChild: child => nodes.set(child.id, child),
      dispatchTransition: () => listeners.get('transitionend')?.({ target: node, propertyName: 'transform' })
    };
    nodes.set(id, node);
    return node;
  }
  const rear = element('recordRoomScreen');
  rear.children = [element('recordPageInner'), element('floatingBar')];
  const quick = element('kinderChatFeedbackScreen', 'flex');
  const observation = element('observationRosterScreen', 'flex');
  element('studentMemoScreen');
  element('kcfPersistentTopLayer');
  element('observationPersistentNavLayer');
  element('olliTalkBetaScreen', 'flex');
  const body = element('body', 'block');
  const window = {
    matchMedia: () => ({ matches: false }),
    setTimeout: () => 1, clearTimeout: () => {},
    // Local render happens synchronously; server synchronization remains pending.
    openRecordAttendanceDashboard: () => {
      events.push('local-render');
      assert.equal(quick.classList.contains('is-olli-main-drawer-open'), false);
      return new Promise(() => {});
    }
  };
  const document = {
    body, activeElement: null,
    getElementById: id => nodes.get(id) || null,
    createElement: () => element('created'),
    querySelectorAll: () => []
  };
  vm.runInNewContext(source, {
    window, document,
    requestAnimationFrame: callback => frames.push(callback),
    getComputedStyle: node => {
      events.push('style:' + node.id);
      return { display: node.style.display, opacity: '.18' };
    }
  });
  return { window, frames, events, rear, quick, observation, tick: () => frames.shift()?.() };
}

test('local render and pale styles precede motion without waiting for server sync', () => {
  for (const kind of ['quicknote', 'observation', 'work']) {
    const s = setup();
    assert.equal(s.window.openOlliMainSubpageDrawer(null, kind), true);
    assert.equal(s.window.openOlliMainSubpageDrawer(null, kind), false);
    assert.equal(s.events.includes('local-render'), false);
    s.tick();
    assert.equal(s.rear.classList.contains('is-olli-main-drawer-rear-open'), false);
    assert.deepEqual(s.events.slice(-3), ['local-render', 'style:recordPageInner', 'style:floatingBar']);
    s.tick();
    assert.equal(s.rear.classList.contains('is-olli-main-drawer-rear-open'), true);
    assert.equal(s.window.isOlliMainSubpageDrawerOpen(), true);
  }
});

test('closing cancels pending opening frames and restores the original screen', async () => {
  for (const ticks of [0, 1, 2]) {
    const s = setup();
    s.window.openOlliMainSubpageDrawer(null, 'quicknote');
    for (let i = 0; i < ticks; i++) s.tick();
    const closed = s.window.closeOlliMainSubpageDrawer();
    while (s.frames.length) s.tick();
    assert.equal(s.rear.classList.contains('is-olli-main-drawer-rear-open'), false);
    s.quick.dispatchTransition();
    assert.equal(await closed, true);
    assert.equal(s.rear.style.display, 'none');
    assert.equal(s.quick.style.display, 'flex');
    assert.equal(s.window.isOlliMainSubpageDrawerOpen(), false);
    assert.equal(s.window.openOlliMainSubpageDrawer(null, 'quicknote'), true);
    s.tick(); s.tick();
    assert.equal(s.rear.classList.contains('is-olli-main-drawer-rear-open'), true);
  }
});