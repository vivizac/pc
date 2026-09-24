const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'olli-sync-manager-common.js'), 'utf8');
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};

function sandbox() {
  let now = 1000;
  let timerId = 0;
  let contextVersion = 1;
  const timers = new Map();
  const listeners = new Map();
  const values = new Map([
    ['olli_current_academy_id', 'academy-a'],
    ['olli_account_session_token_v1', 'session-a']
  ]);

  const add = (name, fn) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
  };
  const remove = (name, fn) => listeners.get(name)?.delete(fn);

  const document = {
    hidden: false,
    addEventListener: add,
    removeEventListener: remove
  };

  const win = {
    document,
    navigator: { onLine: true },
    localStorage: {
      getItem: key => values.get(key) || null,
      setItem: (key, value) => values.set(key, String(value))
    },
    console: { warn() {} },
    Date: class extends Date {
      static now() { return now; }
    },
    setTimeout(fn, delay = 0) {
      const id = ++timerId;
      timers.set(id, { fn, at: now + Number(delay || 0) });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    addEventListener: add,
    removeEventListener: remove,
    dispatchEvent(event) {
      for (const fn of listeners.get(event.type) || []) fn(event);
    },
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.detail = options?.detail;
      }
    }
  };

  win.window = win;
  win.OlliStorageCore = {
    AcademyContext: {
      getCurrent: () => ({
        academyId: values.get('olli_current_academy_id') || '',
        contextVersion
      }),
      captureToken: () => Object.freeze({
        academyId: values.get('olli_current_academy_id') || '',
        contextVersion
      }),
      isTokenCurrent: token => !!token
        && token.academyId === (values.get('olli_current_academy_id') || '')
        && token.contextVersion === contextVersion
    }
  };

  vm.createContext(win);
  vm.runInContext(source, win, { filename: 'olli-sync-manager-common.js' });

  return {
    win,
    document,
    values,
    timers,
    emit(type, detail) { win.dispatchEvent({ type, detail }); },
    switchAcademy(id, session) {
      values.set('olli_current_academy_id', id);
      values.set('olli_account_session_token_v1', session);
      contextVersion += 1;
    },
    async tick(ms = 0) {
      now += ms;
      let guard = 0;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= now)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        timers.delete(due[0]);
        due[1].fn();
        await settle();
        if (++guard > 200) throw new Error('timer loop');
      }
      await settle();
    }
  };
}

test('loading the manager is inert until a domain is registered and requested', () => {
  const env = sandbox();
  assert.equal(env.win.OlliSyncManager.version, '0.1.0-step2');
  assert.deepEqual(Array.from(env.win.OlliSyncManager.getStates()), []);
  assert.equal(env.timers.size, 0);
});

test('registers one adapter per domain and rejects accidental duplicates', () => {
  const env = sandbox();
  const sync = async () => true;
  env.win.OlliSyncManager.registerDomain({ domain: 'schedule', sync });
  assert.throws(() => env.win.OlliSyncManager.registerDomain({ domain: 'schedule', sync }), /already registered/);
});

test('one request runs one adapter and exposes the academy context', async () => {
  const env = sandbox();
  const contexts = [];
  env.win.OlliSyncManager.registerDomain({
    domain: 'students',
    sync: async context => {
      contexts.push(context);
      return true;
    }
  });

  const request = env.win.OlliSyncManager.request('students', { reason: 'test', priority: 'user' });
  await env.tick(0);
  assert.equal(await request, true);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].academyId, 'academy-a');
  assert.equal(contexts[0].sessionToken, 'session-a');
  assert.equal(contexts[0].isCurrent(), true);
  assert.equal(env.win.OlliSyncManager.getState('students').status, 'synced');
});

test('requests arriving during a read never run concurrently and cause one trailing pass', async () => {
  const env = sandbox();
  const first = deferred();
  let calls = 0;
  let concurrent = 0;
  let maxConcurrent = 0;

  env.win.OlliSyncManager.registerDomain({
    domain: 'chat',
    sync: async () => {
      calls += 1;
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      if (calls === 1) await first.promise;
      concurrent -= 1;
      return true;
    }
  });

  const p1 = env.win.OlliSyncManager.request('chat', { reason: 'signal' });
  await env.tick(0);
  const p2 = env.win.OlliSyncManager.request('chat', { reason: 'signal' });
  const p3 = env.win.OlliSyncManager.request('chat', { reason: 'signal' });
  await env.tick(0);
  assert.equal(calls, 1);

  first.resolve();
  await settle();
  await env.tick(0);

  assert.equal(await p1, true);
  assert.equal(await p2, true);
  assert.equal(await p3, true);
  assert.equal(calls, 2);
  assert.equal(maxConcurrent, 1);
});

test('higher-priority queued domain runs before background work', async () => {
  const env = sandbox();
  env.win.OlliSyncManager.configure({ maxConcurrent: 1 });
  const blocker = deferred();
  const order = [];

  env.win.OlliSyncManager.registerDomain({
    domain: 'blocker',
    sync: async () => { order.push('blocker'); await blocker.promise; return true; }
  });
  env.win.OlliSyncManager.registerDomain({
    domain: 'background',
    sync: async () => { order.push('background'); return true; }
  });
  env.win.OlliSyncManager.registerDomain({
    domain: 'active',
    sync: async () => { order.push('active'); return true; }
  });

  const first = env.win.OlliSyncManager.request('blocker', { priority: 'critical' });
  await env.tick(0);
  const background = env.win.OlliSyncManager.request('background', { priority: 'background' });
  const active = env.win.OlliSyncManager.request('active', { priority: 'user' });
  await env.tick(0);
  assert.deepEqual(order, ['blocker']);

  blocker.resolve();
  await settle();
  await env.tick(0);
  await settle();
  await env.tick(0);

  assert.equal(await first, true);
  assert.equal(await active, true);
  assert.equal(await background, true);
  assert.deepEqual(order, ['blocker', 'active', 'background']);
});

test('active page domain receives an automatic priority boost', async () => {
  const env = sandbox();
  env.win.OlliSyncManager.configure({ maxConcurrent: 1 });
  const blocker = deferred();
  const order = [];

  for (const domain of ['blocker', 'students', 'feedback']) {
    env.win.OlliSyncManager.registerDomain({
      domain,
      sync: async () => {
        order.push(domain);
        if (domain === 'blocker') await blocker.promise;
        return true;
      }
    });
  }

  env.win.OlliSyncManager.setActiveDomain('feedback');
  const p0 = env.win.OlliSyncManager.request('blocker', { priority: 'critical' });
  await env.tick(0);
  const p1 = env.win.OlliSyncManager.request('students', { priority: 'background' });
  const p2 = env.win.OlliSyncManager.request('feedback', { priority: 'background' });

  blocker.resolve();
  await settle();
  await env.tick(0);
  await settle();
  await env.tick(0);

  await Promise.all([p0, p1, p2]);
  assert.deepEqual(order, ['blocker', 'feedback', 'students']);
});

test('offline requests do not touch the adapter and remain resumable', async () => {
  const env = sandbox();
  let calls = 0;
  env.win.navigator.onLine = false;
  env.win.OlliSyncManager.registerDomain({
    domain: 'students',
    sync: async () => { calls += 1; return true; }
  });

  const request = env.win.OlliSyncManager.request('students');
  await env.tick(0);
  assert.equal(await request, false);
  assert.equal(calls, 0);
  assert.equal(env.win.OlliSyncManager.getState('students').status, 'waiting_network');
  assert.equal(env.win.OlliSyncManager.getState('students').pending, true);

  env.win.navigator.onLine = true;
  const resumed = env.win.OlliSyncManager.resumePending('online');
  await env.tick(0);
  assert.deepEqual(Array.from(await resumed), [true]);
  assert.equal(calls, 1);
  assert.equal(env.win.OlliSyncManager.getState('students').pending, false);
});

test('an old-academy response is rejected and a queued new-context request wins', async () => {
  const env = sandbox();
  const first = deferred();
  const seen = [];
  let calls = 0;

  env.win.OlliSyncManager.registerDomain({
    domain: 'students',
    sync: async context => {
      calls += 1;
      seen.push({ academyId: context.academyId, isCurrent: context.isCurrent });
      if (calls === 1) await first.promise;
      return true;
    }
  });

  const oldRequest = env.win.OlliSyncManager.request('students', { reason: 'old' });
  await env.tick(0);
  assert.equal(seen[0].academyId, 'academy-a');

  env.switchAcademy('academy-b', 'session-b');
  assert.equal(seen[0].isCurrent(), false);
  const newRequest = env.win.OlliSyncManager.request('students', { reason: 'academy_switch', priority: 'critical' });

  first.resolve();
  await settle();
  await env.tick(0);
  await settle();
  await env.tick(0);

  assert.equal(await oldRequest, false);
  assert.equal(await newRequest, true);
  assert.equal(calls, 2);
  assert.equal(seen[1].academyId, 'academy-b');
  assert.equal(env.win.OlliSyncManager.getState('students').lastAcademyId, 'academy-b');
});

test('adapter failure stays pending and retries only when explicitly resumed', async () => {
  const env = sandbox();
  let calls = 0;
  env.win.OlliSyncManager.registerDomain({
    domain: 'feedback',
    sync: async () => {
      calls += 1;
      if (calls === 1) throw new Error('network failed');
      return true;
    }
  });

  const first = env.win.OlliSyncManager.request('feedback');
  await env.tick(0);
  assert.equal(await first, false);
  assert.equal(calls, 1);
  assert.equal(env.win.OlliSyncManager.getState('feedback').status, 'error');

  await env.tick(60000);
  assert.equal(calls, 1);

  const resumed = env.win.OlliSyncManager.resumePending('manual_retry');
  await env.tick(0);
  assert.deepEqual(Array.from(await resumed), [true]);
  assert.equal(calls, 2);
});

test('adapter returning false is pending but never creates a polling loop', async () => {
  const env = sandbox();
  let calls = 0;
  env.win.OlliSyncManager.registerDomain({
    domain: 'schedule',
    sync: async () => { calls += 1; return false; }
  });

  const request = env.win.OlliSyncManager.request('schedule');
  await env.tick(0);
  assert.equal(await request, false);
  assert.equal(calls, 1);
  await env.tick(120000);
  assert.equal(calls, 1);
  assert.equal(env.timers.size, 0);
});

test('canSync may defer without applying or losing pending work', async () => {
  const env = sandbox();
  let syncCalls = 0;
  let allowed = false;

  env.win.OlliSyncManager.registerDomain({
    domain: 'observation',
    canSync: async () => allowed,
    sync: async () => { syncCalls += 1; return true; }
  });

  const first = env.win.OlliSyncManager.request('observation');
  await env.tick(0);
  assert.equal(await first, false);
  assert.equal(syncCalls, 0);
  assert.equal(env.win.OlliSyncManager.getState('observation').status, 'deferred');

  allowed = true;
  const resumed = env.win.OlliSyncManager.resumePending('editor_closed');
  await env.tick(0);
  assert.deepEqual(Array.from(await resumed), [true]);
  assert.equal(syncCalls, 1);
});

test('lifecycle reconciliation is opt-in and only resumes already-pending domains', async () => {
  const env = sandbox();
  let calls = 0;
  env.win.navigator.onLine = false;
  env.win.OlliSyncManager.registerDomain({
    domain: 'students',
    sync: async () => { calls += 1; return true; }
  });

  const first = env.win.OlliSyncManager.request('students');
  await env.tick(0);
  await first;
  assert.equal(calls, 0);

  env.win.navigator.onLine = true;
  env.emit('online');
  await env.tick(0);
  assert.equal(calls, 0);

  assert.equal(env.win.OlliSyncManager.startLifecycle(), true);
  assert.equal(env.win.OlliSyncManager.startLifecycle(), false);
  env.emit('online');
  await env.tick(0);
  assert.equal(calls, 1);
  assert.equal(env.win.OlliSyncManager.stopLifecycle(), true);
});

test('captureContext is academy-scoped and detects context changes', () => {
  const env = sandbox();
  const snapshot = env.win.OlliSyncManager.captureContext();
  assert.equal(snapshot.academyId, 'academy-a');
  assert.equal(env.win.OlliSyncManager.isContextCurrent(snapshot), true);
  env.switchAcademy('academy-b', 'session-b');
  assert.equal(env.win.OlliSyncManager.isContextCurrent(snapshot), false);
});
