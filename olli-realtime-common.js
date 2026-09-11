(function initializeOlliRealtime(global) {
  'use strict';

  if (global.OlliRealtime && global.OlliRealtime.version) return;

  const VERSION = '1.1.1';
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm';
  const ACCOUNT_SESSION_TOKEN_KEY = 'olli_account_session_token_v1';
  const CONTEXT_CHECK_INTERVAL_MS = 5000;
  const RETRY_DELAY_MS = 10000;
  const SUBSCRIBE_TIMEOUT_MS = 8000;
  const VALID_DOMAINS = new Set(['observation', 'schedule']);

  const state = {
    client: null,
    channel: null,
    academyId: '',
    sessionToken: '',
    topic: '',
    status: 'idle',
    connectPromise: null,
    retryAt: 0,
    lastSignalAt: 0
  };

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function currentAcademyId() {
    try {
      const context = global.OlliStorageCore?.AcademyContext?.getCurrent?.();
      const fromContext = clean(context?.academyId || context?.academy_id);
      if (fromContext) return fromContext;
    } catch (_) {}
    try { return clean(localStorage.getItem('olli_current_academy_id')); }
    catch (_) { return ''; }
  }

  function currentSessionToken() {
    try { return clean(localStorage.getItem(ACCOUNT_SESSION_TOKEN_KEY)); }
    catch (_) { return ''; }
  }

  function getSupabaseConfig() {
    const url = typeof SUPABASE_URL !== 'undefined' ? clean(SUPABASE_URL) : '';
    const key = typeof SUPABASE_KEY !== 'undefined' ? clean(SUPABASE_KEY) : '';
    return { url, key };
  }

  function dispatchStatus(reason) {
    try {
      global.dispatchEvent(new CustomEvent('olli:realtime-status', {
        detail: {
          status: state.status,
          academyId: state.academyId,
          reason: clean(reason),
          version: VERSION
        }
      }));
    } catch (_) {}
  }

  async function loadSdk() {
    if (global.__olliRealtimeSdkPromise) return global.__olliRealtimeSdkPromise;
    global.__olliRealtimeSdkPromise = import(SDK_URL).catch(error => {
      global.__olliRealtimeSdkPromise = null;
      throw error;
    });
    return global.__olliRealtimeSdkPromise;
  }

  async function getClient() {
    if (state.client) return state.client;
    const config = getSupabaseConfig();
    if (!config.url || !config.key) throw new Error('Supabase Realtime 연결 설정이 없습니다.');
    const sdk = await loadSdk();
    if (!sdk || typeof sdk.createClient !== 'function') throw new Error('Supabase Realtime SDK를 불러오지 못했습니다.');

    state.client = sdk.createClient(config.url, config.key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
    return state.client;
  }

  async function loadChannelInfo(academyId, sessionToken) {
    if (typeof supabase !== 'function') throw new Error('올리 Supabase 요청 함수가 준비되지 않았습니다.');
    const result = await supabase('POST', 'rpc/olli_realtime_channel_info', {
      p_session_token: sessionToken,
      p_academy_id: academyId
    });
    const info = Array.isArray(result) ? result[0] : result;
    if (!info || info.ok !== true || !clean(info.topic)) {
      throw new Error(clean(info?.message) || '리얼타임 채널 정보를 확인하지 못했습니다.');
    }
    return info;
  }

  async function removeCurrentChannel(reason) {
    const channel = state.channel;
    const client = state.client;
    state.channel = null;
    state.academyId = '';
    state.sessionToken = '';
    state.topic = '';
    state.status = 'idle';
    dispatchStatus(reason || 'disconnect');
    if (!channel || !client || typeof client.removeChannel !== 'function') return;
    try { await client.removeChannel(channel); }
    catch (error) { console.warn('올리 Realtime 채널 정리 실패:', error); }
  }

  function normalizeSignal(message) {
    const payload = message && typeof message === 'object' && message.payload && typeof message.payload === 'object'
      ? message.payload
      : message;
    if (!payload || typeof payload !== 'object') return null;
    if (Number(payload.protocol || 0) !== 1) return null;
    const domain = clean(payload.domain).toLowerCase();
    if (!VALID_DOMAINS.has(domain)) return null;
    return {
      domain,
      revision: Number(payload.revision || 0),
      protocol: 1
    };
  }

  function handleSignal(message) {
    const signal = normalizeSignal(message);
    if (!signal) return;
    state.lastSignalAt = Date.now();
    try {
      global.dispatchEvent(new CustomEvent('olli:realtime-change', {
        detail: {
          ...signal,
          academyId: state.academyId,
          receivedAt: state.lastSignalAt
        }
      }));
    } catch (error) {
      console.warn('올리 Realtime 변경 신호 전달 실패:', error);
    }
  }

  function isSameContext(academyId, sessionToken) {
    return !!state.channel
      && state.academyId === academyId
      && state.sessionToken === sessionToken;
  }

  async function ensureConnected(options) {
    const opts = Object.assign({ force: false, reason: 'auto' }, options || {});
    const academyId = currentAcademyId();
    const sessionToken = currentSessionToken();

    if (!academyId || !sessionToken || typeof navigator !== 'undefined' && navigator.onLine === false) {
      if (state.channel) await removeCurrentChannel(!academyId || !sessionToken ? 'no_context' : 'offline');
      return false;
    }

    if (isSameContext(academyId, sessionToken) && state.status === 'SUBSCRIBED') return true;
    if (!opts.force && isSameContext(academyId, sessionToken) && Date.now() < state.retryAt) return false;
    if (state.connectPromise) return state.connectPromise;

    state.connectPromise = (async () => {
      if (state.channel) await removeCurrentChannel('reconnect');

      const info = await loadChannelInfo(academyId, sessionToken);
      if (academyId !== currentAcademyId() || sessionToken !== currentSessionToken()) return false;

      const client = await getClient();
      const channel = client.channel(clean(info.topic), {
        config: {
          private: false,
          broadcast: { self: false }
        }
      });

      channel.on('broadcast', { event: 'changed' }, handleSignal);
      state.channel = channel;
      state.academyId = academyId;
      state.sessionToken = sessionToken;
      state.topic = clean(info.topic);
      state.status = 'CONNECTING';
      dispatchStatus(opts.reason);

      return await new Promise(resolve => {
        let settled = false;
        const finish = value => {
          if (settled) return;
          settled = true;
          resolve(value);
        };

        channel.subscribe(status => {
          if (state.channel !== channel) return;
          state.status = clean(status) || 'UNKNOWN';
          dispatchStatus(opts.reason);

          if (status === 'SUBSCRIBED') {
            state.retryAt = 0;
            finish(true);
            return;
          }

          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            state.retryAt = Date.now() + RETRY_DELAY_MS;
            finish(false);
          }
        });

        setTimeout(() => {
          if (settled || state.channel !== channel || state.status === 'SUBSCRIBED') return;
          state.retryAt = Date.now() + RETRY_DELAY_MS;
          finish(false);
        }, SUBSCRIBE_TIMEOUT_MS);
      });
    })().catch(error => {
      state.status = 'ERROR';
      state.retryAt = Date.now() + RETRY_DELAY_MS;
      dispatchStatus(error?.message || opts.reason);
      console.warn('올리 Realtime 연결 실패 - 기존 동기화 방식으로 계속 동작합니다:', error);
      return false;
    }).finally(() => {
      state.connectPromise = null;
    });

    return state.connectPromise;
  }

  function getStatus() {
    return {
      version: VERSION,
      status: state.status,
      academyId: state.academyId,
      connected: state.status === 'SUBSCRIBED',
      lastSignalAt: state.lastSignalAt
    };
  }

  // Platform adapters re-read authoritative data. Signals never carry UI data.
  // Keep one pending refresh during edits, in-flight reads, and transient failures.
  function watchDomain(domain, refresh) {
    if (!VALID_DOMAINS.has(domain) || typeof refresh !== 'function') {
      throw new Error('Invalid OLLI Realtime watcher');
    }
    let pending = false;
    let running = false;
    let disposed = false;
    let sequence = 0;
    let timer = null;
    let retryPending = false;
    let pendingTrigger = '';

    function schedule(delay) {
      if (disposed || !pending || running || timer !== null || document.hidden) return;
      timer = global.setTimeout(() => { timer = null; flush(); }, delay);
    }

    function request(reason = 'manual', retryUntilApplied = false) {
      if (disposed) return;
      sequence += 1;
      pending = true;
      if (retryUntilApplied) retryPending = true;
      const trigger = clean(reason) || 'manual';
      if (trigger === 'change' || pendingTrigger !== 'change') pendingTrigger = trigger;
      schedule(120);
    }

    async function flush() {
      if (disposed || running || !pending || document.hidden) return;
      const academyId = currentAcademyId();
      const sessionToken = currentSessionToken();
      if (!academyId || !sessionToken) {
        pending = false;
        retryPending = false;
        pendingTrigger = '';
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      const receivedSequence = sequence;
      const trigger = pendingTrigger || 'manual';
      const academyContext = global.OlliStorageCore?.AcademyContext;
      const contextToken = academyContext?.captureToken?.();
      const isCurrent = () => !disposed && academyId === currentAcademyId()
        && sessionToken === currentSessionToken()
        && (!academyContext?.isTokenCurrent || academyContext.isTokenCurrent(contextToken));
      running = true;
      let retryDelay = 1000;
      try {
        const applied = await refresh({ academyId, isCurrent, trigger });
        if (applied === true && isCurrent() && sequence === receivedSequence) {
          pending = false;
          retryPending = false;
          pendingTrigger = '';
        }
      } catch (error) {
        retryDelay = 5000;
        console.warn('올리 Realtime 최신 데이터 확인 재시도:', error?.message || error);
      } finally {
        running = false;
        if (!pending) return;
        if (retryPending) schedule(retryDelay);
        else {
          pending = false;
          pendingTrigger = '';
        }
      }
    }

    function onChange(event) {
      const detail = event?.detail;
      if (detail?.domain === domain && clean(detail.academyId) === currentAcademyId()) request('change', true);
    }
    function onStatus(event) {
      const detail = event?.detail;
      if (detail?.status === 'SUBSCRIBED' && clean(detail.academyId) === currentAcademyId()) request('subscribed', false);
    }
    function onVisible() { if (!document.hidden) request('visible', false); }
    function onOnline() { request('online', false); }
    function onFocus() { request('focus', false); }
    function onStorage(event) {
      if (!event || event.key === null || [ACCOUNT_SESSION_TOKEN_KEY, 'olli_current_academy_id'].includes(event.key)) request('storage', false);
    }
    global.addEventListener('olli:realtime-change', onChange);
    global.addEventListener('olli:realtime-status', onStatus);
    global.addEventListener('online', onOnline);
    global.addEventListener('focus', onFocus);
    global.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
    if (state.status === 'SUBSCRIBED') request('already_subscribed', false);

    return Object.freeze({
      request: () => request('manual', false),
      dispose() {
        disposed = true;
        pending = false;
        retryPending = false;
        pendingTrigger = '';
        if (timer !== null) global.clearTimeout(timer);
        global.removeEventListener('olli:realtime-change', onChange);
        global.removeEventListener('olli:realtime-status', onStatus);
        global.removeEventListener('online', onOnline);
        global.removeEventListener('focus', onFocus);
        global.removeEventListener('storage', onStorage);
        document.removeEventListener('visibilitychange', onVisible);
      }
    });
  }

  global.OlliRealtime = Object.freeze({
    version: VERSION,
    watchDomain,
    ensureConnected,
    disconnect: removeCurrentChannel,
    getStatus
  });

  const scheduleEnsure = (force, reason) => {
    setTimeout(() => { ensureConnected({ force: !!force, reason }).catch(() => {}); }, 0);
  };

  global.addEventListener('online', () => scheduleEnsure(true, 'online'));
  global.addEventListener('focus', () => scheduleEnsure(true, 'focus'));
  global.addEventListener('storage', event => {
    if (!event || [ACCOUNT_SESSION_TOKEN_KEY, 'olli_current_academy_id'].includes(event.key)) {
      scheduleEnsure(true, 'storage');
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleEnsure(true, 'visible');
  });

  if (!global.__olliRealtimeContextTimer) {
    global.__olliRealtimeContextTimer = setInterval(() => {
      if (document.hidden) return;
      ensureConnected({ force: false, reason: 'context_check' }).catch(() => {});
    }, CONTEXT_CHECK_INTERVAL_MS);
  }

  scheduleEnsure(false, 'boot');
})(window);
