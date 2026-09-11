from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


common = Path('olli-realtime-common.js')
text = common.read_text(encoding='utf-8')
replace_once('olli-realtime-common.js', "const VERSION = '1.1.0';", "const VERSION = '1.1.1';", 'realtime version')
text = common.read_text(encoding='utf-8')
start = text.index('  function watchDomain(domain, refresh) {')
end = text.index('\n  global.OlliRealtime = Object.freeze({', start)
new_block = r'''  function watchDomain(domain, refresh) {
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
'''
common.write_text(text[:start] + new_block + text[end:], encoding='utf-8')

old_pc = """    global.OlliRealtime.watchDomain('schedule', (context) => {\n      const realtimeStatus = typeof global.OlliRealtime?.getStatus === 'function' ? global.OlliRealtime.getStatus() : null;\n      logScheduleSyncDebug('REALTIME', 'schedule 신호 수신', {\n        connected: !!realtimeStatus?.connected,\n        status: realtimeStatus?.status || '',\n        lastSignalAt: realtimeStatus?.lastSignalAt || 0,\n        academyId: currentSyncAcademyId()\n      });\n      // Stage 2 covers the timetable. The attendance register keeps its existing polling.\n      if (!state.active || state.view !== 'schedule' || state.pane !== 'schedule') return false;\n      return checkLiveScheduleSync(true, context, 'REALTIME');\n    });"""
new_pc = """    global.OlliRealtime.watchDomain('schedule', (context) => {\n      const isActualSignal = context?.trigger === 'change';\n      if (isActualSignal) {\n        const realtimeStatus = typeof global.OlliRealtime?.getStatus === 'function' ? global.OlliRealtime.getStatus() : null;\n        logScheduleSyncDebug('REALTIME', 'schedule 신호 수신', {\n          connected: !!realtimeStatus?.connected,\n          status: realtimeStatus?.status || '',\n          lastSignalAt: realtimeStatus?.lastSignalAt || 0,\n          academyId: currentSyncAcademyId()\n        });\n      }\n      // Stage 2 covers the timetable. The attendance register keeps its existing polling.\n      if (!state.active || state.view !== 'schedule' || state.pane !== 'schedule') return true;\n      return checkLiveScheduleSync(true, context, isActualSignal ? 'REALTIME' : null);\n    });"""
replace_once('pc-timetable.js', old_pc, new_pc, 'PC realtime watcher')

test = Path('tests/schedule-realtime.test.cjs')
t = test.read_text(encoding='utf-8')
marker = "test('a change during a read causes one additional read, never concurrent reads',async()=>{"
addition = """test('non-change catch-up checks never enter the 1s retry loop when not applied',async()=>{\n  const env=realtime();let calls=0,trigger='';\n  env.win.OlliRealtime.watchDomain('schedule',ctx=>{calls++;trigger=ctx.trigger;return false;});\n  env.emit('olli:realtime-status',{status:'SUBSCRIBED',academyId:'academy-a'});\n  await env.tick(150);assert.equal(calls,1);assert.equal(trigger,'subscribed');\n  await env.tick(5000);assert.equal(calls,1);\n});\ntest('actual change signals keep retrying and expose change trigger',async()=>{\n  const env=realtime();let busy=true,calls=0,triggers=[];\n  env.win.OlliRealtime.watchDomain('schedule',ctx=>{calls++;triggers.push(ctx.trigger);return !busy;});\n  signal(env);await env.tick(150);assert.equal(calls,1);assert.equal(triggers[0],'change');\n  busy=false;await env.tick(1000);assert.equal(calls,2);assert.equal(triggers[1],'change');\n});\n"""
if addition not in t:
    if marker not in t:
        raise SystemExit('test insertion marker not found')
    t = t.replace(marker, addition + marker, 1)
test.write_text(t, encoding='utf-8')

assert "const VERSION = '1.1.1';" in common.read_text(encoding='utf-8')
assert "context?.trigger === 'change'" in Path('pc-timetable.js').read_text(encoding='utf-8')
