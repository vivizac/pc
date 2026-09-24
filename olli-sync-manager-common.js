(function initializeOlliSyncManager(global) {
  'use strict';

  if (global.OlliSyncManager && global.OlliSyncManager.version) return;

  const VERSION = '0.1.0-step2';
  const DEFAULT_MAX_CONCURRENT = 2;
  const SESSION_TOKEN_KEY = 'olli_account_session_token_v1';
  const ACADEMY_ID_KEY = 'olli_current_academy_id';

  const PRIORITIES = Object.freeze({
    background: 10,
    reconcile: 30,
    active: 50,
    user: 70,
    critical: 90
  });

  const registry = new Map();
  const runtime = new Map();
  let activeDomain = '';
  let maxConcurrent = DEFAULT_MAX_CONCURRENT;
  let runningCount = 0;
  let pumpTimer = null;
  let requestOrder = 0;
  let lifecycleStarted = false;

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function normalizeDomain(value) {
    const domain = clean(value).toLowerCase();
    if (!domain || !/^[a-z0-9_:-]+$/.test(domain)) {
      throw new Error('Invalid OLLI sync domain');
    }
    return domain;
  }

  function priorityValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
    const key = clean(value || 'background').toLowerCase();
    return PRIORITIES[key] || PRIORITIES.background;
  }

  function currentAcademyId() {
    try {
      const context = global.OlliStorageCore?.AcademyContext?.getCurrent?.();
      const id = clean(context?.academyId || context?.academy_id);
      if (id) return id;
    } catch (_) {}
    try { return clean(global.localStorage?.getItem?.(ACADEMY_ID_KEY)); }
    catch (_) { return ''; }
  }

  function currentSessionToken() {
    try { return clean(global.localStorage?.getItem?.(SESSION_TOKEN_KEY)); }
    catch (_) { return ''; }
  }

  function captureContext() {
    const academyContext = global.OlliStorageCore?.AcademyContext;
    const token = academyContext?.captureToken?.() || null;
    return Object.freeze({
      academyId: currentAcademyId(),
      sessionToken: currentSessionToken(),
      academyToken: token
    });
  }

  function isContextCurrent(snapshot) {
    if (!snapshot) return false;
    if (snapshot.academyId !== currentAcademyId()) return false;
    if (snapshot.sessionToken !== currentSessionToken()) return false;
    const academyContext = global.OlliStorageCore?.AcademyContext;
    if (snapshot.academyToken && academyContext?.isTokenCurrent) {
      try { return !!academyContext.isTokenCurrent(snapshot.academyToken); }
      catch (_) { return false; }
    }
    return true;
  }

  function makeRuntime(domain) {
    return {
      domain,
      status: 'idle',
      pending: false,
      queued: false,
      running: false,
      requestSeq: 0,
      completedSeq: 0,
      priority: 0,
      requestedAt: 0,
      startedAt: 0,
      completedAt: 0,
      lastSuccessAt: 0,
      lastReason: '',
      lastError: '',
      lastAcademyId: '',
      reasons: new Set(),
      waiters: []
    };
  }

  function getRuntime(domain) {
    const key = normalizeDomain(domain);
    if (!runtime.has(key)) runtime.set(key, makeRuntime(key));
    return runtime.get(key);
  }

  function publicState(item) {
    if (!item) return null;
    return Object.freeze({
      domain: item.domain,
      status: item.status,
      pending: !!item.pending,
      queued: !!item.queued,
      running: !!item.running,
      requestSeq: item.requestSeq,
      completedSeq: item.completedSeq,
      priority: item.priority,
      requestedAt: item.requestedAt,
      startedAt: item.startedAt,
      completedAt: item.completedAt,
      lastSuccessAt: item.lastSuccessAt,
      lastReason: item.lastReason,
      lastError: item.lastError,
      lastAcademyId: item.lastAcademyId
    });
  }

  function dispatchState(item, reason) {
    try {
      global.dispatchEvent?.(new global.CustomEvent('olli:sync-state', {
        detail: {
          ...publicState(item),
          reason: clean(reason),
          version: VERSION
        }
      }));
    } catch (_) {}
  }

  function registerDomain(rawSpec) {
    const spec = rawSpec && typeof rawSpec === 'object' ? rawSpec : {};
    const domain = normalizeDomain(spec.domain);
    if (registry.has(domain)) throw new Error('OLLI sync domain already registered: ' + domain);
    if (typeof spec.sync !== 'function') throw new Error('OLLI sync domain requires sync(): ' + domain);

    const normalized = Object.freeze({
      domain,
      sync: spec.sync,
      canSync: typeof spec.canSync === 'function' ? spec.canSync : null,
      defaultPriority: priorityValue(spec.defaultPriority || 'background'),
      description: clean(spec.description)
    });

    registry.set(domain, normalized);
    getRuntime(domain);
    return normalized;
  }

  function unregisterDomain(domain) {
    const key = normalizeDomain(domain);
    if (runtime.get(key)?.running) throw new Error('Cannot unregister running OLLI sync domain: ' + key);
    registry.delete(key);
    const item = runtime.get(key);
    if (item) {
      settleWaiters(item, item.requestSeq, false);
      runtime.delete(key);
    }
    return true;
  }

  function effectivePriority(item) {
    const activeBoost = item.domain === activeDomain ? PRIORITIES.active : 0;
    return Math.max(item.priority || 0, activeBoost);
  }

  function schedulePump() {
    if (pumpTimer !== null) return;
    pumpTimer = global.setTimeout(() => {
      pumpTimer = null;
      pump();
    }, 0);
  }

  function settleWaiters(item, throughSeq, value) {
    const keep = [];
    item.waiters.forEach(waiter => {
      if (waiter.seq <= throughSeq) {
        try { waiter.resolve(!!value); } catch (_) {}
      } else {
        keep.push(waiter);
      }
    });
    item.waiters = keep;
  }

  function requestDomain(domain, options) {
    const key = normalizeDomain(domain);
    const spec = registry.get(key);
    if (!spec) return Promise.reject(new Error('OLLI sync domain is not registered: ' + key));

    const opts = Object.assign({ reason: 'manual', priority: spec.defaultPriority }, options || {});
    const item = getRuntime(key);
    item.requestSeq += 1;
    item.pending = true;
    item.queued = true;
    item.requestedAt = Date.now();
    item.priority = Math.max(item.priority || 0, priorityValue(opts.priority));
    const reason = clean(opts.reason) || 'manual';
    item.reasons.add(reason);
    item.lastReason = reason;
    requestOrder += 1;
    item.order = requestOrder;
    dispatchState(item, 'queued');

    const seq = item.requestSeq;
    const promise = new Promise(resolve => item.waiters.push({ seq, resolve }));
    schedulePump();
    return promise;
  }

  function requestMany(domains, options) {
    const list = Array.isArray(domains) ? domains : [];
    return Promise.all(list.map(domain => requestDomain(domain, options)));
  }

  function waitingReason() {
    if (global.document?.hidden) return 'waiting_visibility';
    if (global.navigator && global.navigator.onLine === false) return 'waiting_network';
    if (!currentAcademyId() || !currentSessionToken()) return 'waiting_context';
    return '';
  }

  function pickNext() {
    return [...runtime.values()]
      .filter(item => item.queued && !item.running && registry.has(item.domain))
      .sort((a, b) => {
        const diff = effectivePriority(b) - effectivePriority(a);
        if (diff) return diff;
        return (a.order || 0) - (b.order || 0);
      })[0] || null;
  }

  async function runDomain(item) {
    const spec = registry.get(item.domain);
    if (!spec || item.running) return;

    const wait = waitingReason();
    if (wait) {
      const throughSeq = item.requestSeq;
      item.status = wait;
      item.queued = false;
      item.priority = 0;
      item.completedAt = Date.now();
      settleWaiters(item, throughSeq, false);
      dispatchState(item, wait);
      return;
    }

    const snapshot = captureContext();
    const targetSeq = item.requestSeq;
    const reasons = [...item.reasons];
    const reason = reasons[reasons.length - 1] || item.lastReason || 'manual';
    const requestPriority = effectivePriority(item);

    item.running = true;
    item.queued = false;
    item.status = 'syncing';
    item.startedAt = Date.now();
    item.lastAcademyId = snapshot.academyId;
    item.lastError = '';
    item.reasons.clear();
    runningCount += 1;
    dispatchState(item, 'start');

    const isCurrent = () => isContextCurrent(snapshot);
    let applied = false;

    try {
      if (spec.canSync) {
        const allowed = await spec.canSync({
          domain: item.domain,
          academyId: snapshot.academyId,
          sessionToken: snapshot.sessionToken,
          reason,
          reasons,
          priority: requestPriority,
          isCurrent
        });
        if (allowed !== true || !isCurrent()) {
          item.status = isCurrent() ? 'deferred' : 'stale';
          item.pending = true;
          return;
        }
      }

      const result = await spec.sync({
        domain: item.domain,
        academyId: snapshot.academyId,
        sessionToken: snapshot.sessionToken,
        reason,
        reasons,
        priority: requestPriority,
        isCurrent
      });

      applied = result === true || !!(result && result.applied === true);
      if (!isCurrent()) {
        item.status = 'stale';
        item.pending = true;
        applied = false;
        return;
      }

      if (applied) {
        item.completedSeq = Math.max(item.completedSeq, targetSeq);
        item.lastSuccessAt = Date.now();
        if (item.requestSeq === targetSeq) {
          item.pending = false;
          item.status = 'synced';
        } else {
          item.pending = true;
          item.queued = true;
          item.status = 'queued';
        }
      } else {
        item.pending = true;
        item.status = 'pending';
      }
    } catch (error) {
      item.pending = true;
      item.status = 'error';
      item.lastError = clean(error?.message || error);
      console.warn('올리 Sync Manager 동기화 실패:', item.domain, error?.message || error);
    } finally {
      item.running = false;
      item.completedAt = Date.now();
      item.priority = item.queued ? Math.max(item.priority, requestPriority) : 0;
      runningCount = Math.max(0, runningCount - 1);
      settleWaiters(item, targetSeq, applied && item.status !== 'stale');
      dispatchState(item, item.status);
      if (item.queued) schedulePump();
      schedulePump();
    }
  }

  function pump() {
    while (runningCount < maxConcurrent) {
      const item = pickNext();
      if (!item) break;
      void runDomain(item);
      if (runningCount === 0 && !item.running) continue;
    }
  }

  function resumePending(reason, options) {
    const opts = Object.assign({ priority: 'reconcile' }, options || {});
    const jobs = [];
    for (const item of runtime.values()) {
      if (!item.pending || !registry.has(item.domain)) continue;
      jobs.push(requestDomain(item.domain, {
        reason: clean(reason) || 'resume',
        priority: opts.priority
      }));
    }
    return Promise.all(jobs);
  }

  function requestRegistered(reason, options) {
    return requestMany([...registry.keys()], {
      reason: clean(reason) || 'reconcile_all',
      priority: options?.priority || 'reconcile'
    });
  }

  function setActiveDomain(domain) {
    activeDomain = domain ? normalizeDomain(domain) : '';
    if (activeDomain && runtime.get(activeDomain)?.queued) schedulePump();
    return activeDomain;
  }

  function getState(domain) {
    return publicState(runtime.get(normalizeDomain(domain)) || makeRuntime(normalizeDomain(domain)));
  }

  function getStates() {
    return Object.freeze([...runtime.values()].map(publicState));
  }

  function configure(options) {
    const value = Number(options?.maxConcurrent);
    if (Number.isFinite(value) && value >= 1 && value <= 6) {
      maxConcurrent = Math.floor(value);
      schedulePump();
    }
    return Object.freeze({ maxConcurrent });
  }

  function startLifecycle() {
    if (lifecycleStarted) return false;
    lifecycleStarted = true;
    const resume = reason => { resumePending(reason, { priority: 'reconcile' }).catch(() => {}); };
    global.__olliSyncManagerLifecycleHandlers = {
      online: () => resume('online'),
      focus: () => resume('focus'),
      visible: () => { if (!global.document?.hidden) resume('visible'); },
      storage: event => {
        if (!event || event.key === null || [SESSION_TOKEN_KEY, ACADEMY_ID_KEY].includes(event.key)) resume('storage');
      }
    };
    global.addEventListener?.('online', global.__olliSyncManagerLifecycleHandlers.online);
    global.addEventListener?.('focus', global.__olliSyncManagerLifecycleHandlers.focus);
    global.addEventListener?.('storage', global.__olliSyncManagerLifecycleHandlers.storage);
    global.document?.addEventListener?.('visibilitychange', global.__olliSyncManagerLifecycleHandlers.visible);
    return true;
  }

  function stopLifecycle() {
    const handlers = global.__olliSyncManagerLifecycleHandlers;
    if (!lifecycleStarted || !handlers) return false;
    global.removeEventListener?.('online', handlers.online);
    global.removeEventListener?.('focus', handlers.focus);
    global.removeEventListener?.('storage', handlers.storage);
    global.document?.removeEventListener?.('visibilitychange', handlers.visible);
    delete global.__olliSyncManagerLifecycleHandlers;
    lifecycleStarted = false;
    return true;
  }

  global.OlliSyncManager = Object.freeze({
    version: VERSION,
    priorities: PRIORITIES,
    registerDomain,
    unregisterDomain,
    request: requestDomain,
    requestMany,
    requestRegistered,
    resumePending,
    setActiveDomain,
    getState,
    getStates,
    configure,
    startLifecycle,
    stopLifecycle,
    captureContext,
    isContextCurrent
  });
})(window);
