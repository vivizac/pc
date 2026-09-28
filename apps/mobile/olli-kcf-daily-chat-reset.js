/* Phone-only 1-minute-feedback daily chat reset.
 * LIVE chat rows are temporary for the current calendar day only.
 */
(function(){
  const KCF_LIVE_SESSION_KEY_PREFIX = 'olli_kcf_live_session_v1_';
  let activeDateKey = getLocalDateKey();
  let midnightTimer = null;

  function getLocalDateKey(value) {
    const date = value ? new Date(value) : new Date();
    const safe = Number.isNaN(date.getTime()) ? new Date() : date;
    const year = safe.getFullYear();
    const month = String(safe.getMonth() + 1).padStart(2, '0');
    const day = String(safe.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getTodayDateKey() {
    try {
      if (typeof getTodayFeedbackDateKey === 'function') {
        const key = String(getTodayFeedbackDateKey() || '').trim();
        if (key) return key;
      }
    } catch(e) {}
    return getLocalDateKey();
  }

  function getStoredSessionDateKey(session) {
    const explicit = String(session?.dateKey || '').trim();
    if (explicit) return explicit;
    const raw = session?.updatedAt || session?.createdAt || '';
    return raw ? getLocalDateKey(raw) : '';
  }

  function pruneStaleStoredSessions(todayKey) {
    const today = String(todayKey || getTodayDateKey());
    try {
      const staleKeys = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = String(localStorage.key(index) || '');
        if (!key.startsWith(KCF_LIVE_SESSION_KEY_PREFIX)) continue;
        try {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          const session = JSON.parse(raw);
          const sessionDateKey = getStoredSessionDateKey(session);
          if (sessionDateKey && sessionDateKey !== today) staleKeys.push(key);
        } catch(e) {
          staleKeys.push(key);
        }
      }
      staleKeys.forEach(key => localStorage.removeItem(key));
    } catch(e) {}
  }

  function clearRenderedChatForNewDay() {
    const area = document.getElementById('kcfChatArea');
    if (area) {
      area.querySelectorAll('.kcfMsgRow').forEach(row => row.remove());
      area.scrollTop = 0;
    }
    const intro = document.getElementById('kcfCenterIntro');
    if (intro) intro.classList.remove('hidden');

    try {
      if (typeof kcfLiveSessionPersistTimer !== 'undefined' && kcfLiveSessionPersistTimer) {
        clearTimeout(kcfLiveSessionPersistTimer);
        kcfLiveSessionPersistTimer = null;
      }
    } catch(e) {}
    try {
      if (typeof kcfLiveFeedbackItems !== 'undefined' && kcfLiveFeedbackItems?.clear) {
        kcfLiveFeedbackItems.clear();
      }
    } catch(e) {}
    try {
      if (typeof kcfLiveSessionRenderedScope !== 'undefined') kcfLiveSessionRenderedScope = '';
    } catch(e) {}
  }

  function checkForNewDay() {
    const today = getTodayDateKey();
    pruneStaleStoredSessions(today);
    if (today === activeDateKey) return false;
    activeDateKey = today;
    clearRenderedChatForNewDay();
    try { if (typeof updateKinderChatFeedbackBadge === 'function') updateKinderChatFeedbackBadge(); } catch(e) {}
    return true;
  }

  function scheduleMidnightReset() {
    if (midnightTimer) clearTimeout(midnightTimer);
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1, 0);
    const delay = Math.max(1000, nextMidnight.getTime() - now.getTime());
    midnightTimer = window.setTimeout(() => {
      midnightTimer = null;
      checkForNewDay();
      scheduleMidnightReset();
    }, delay);
  }

  pruneStaleStoredSessions(activeDateKey);
  scheduleMidnightReset();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    checkForNewDay();
    scheduleMidnightReset();
  });
  window.addEventListener('pageshow', () => {
    checkForNewDay();
    scheduleMidnightReset();
  });
  window.addEventListener('focus', () => {
    checkForNewDay();
  });

  window.OlliKcfDailyChatReset = Object.freeze({
    check: checkForNewDay
  });
})();
