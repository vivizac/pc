/* Attendance cross-device fallback sync.
   This file is intentionally independent from attendance-guide UI. */

/* Realtime이 연결되지 않은 경우에만 revision polling을 보조 경로로 사용한다.
   Realtime 연결 중에는 별도 5초 RPC/포그라운드 강제 새로고침을 실행하지 않는다. */
(function(){
  if (window.__olliPhoneCrossDeviceAttendanceSyncInstalled) return;
  window.__olliPhoneCrossDeviceAttendanceSyncInstalled = true;

  var REVISION_POLL_MS = 5000;
  var SESSION_KEY = 'olli_account_session_token_v1';
  var lastAcademyId = '';
  var lastRevision = null;
  var checking = false;
  var refreshing = false;

  function text(value) { return String(value == null ? '' : value).trim(); }

  function currentAcademyId() {
    try {
      if (typeof window.getOlliCurrentAcademyId === 'function') {
        var id = text(window.getOlliCurrentAcademyId());
        if (id) return id;
      }
    } catch (_) {}
    try { return text(localStorage.getItem('olli_current_academy_id')); } catch (_) { return ''; }
  }

  function currentSessionToken() {
    try { return text(localStorage.getItem(SESSION_KEY)); } catch (_) { return ''; }
  }

  function isRecordRoomVisible() {
    if (document.visibilityState === 'hidden') return false;
    var screen = document.getElementById('recordRoomScreen');
    if (!screen) return false;
    try {
      var style = window.getComputedStyle ? window.getComputedStyle(screen) : null;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
      if (screen.hidden) return false;
      return screen.getClientRects ? screen.getClientRects().length > 0 : true;
    } catch (_) {
      return true;
    }
  }

  function hasRealtimeConnection() {
    try {
      var status = window.OlliRealtime && typeof window.OlliRealtime.getStatus === 'function'
        ? window.OlliRealtime.getStatus()
        : null;
      return !!status && status.connected === true;
    } catch (_) {
      return false;
    }
  }

  function normalizeRpcResult(result) {
    return Array.isArray(result) && result.length === 1 ? result[0] : result;
  }

  async function fetchRevision(academyId, sessionToken) {
    if (typeof window.supabase !== 'function') return null;
    var result = await window.supabase('POST', 'rpc/olli_schedule_sync_revision', {
      p_session_token: sessionToken,
      p_academy_id: academyId
    });
    var data = normalizeRpcResult(result) || {};
    if (data.ok === false) throw new Error(data.message || '출석 동기화 상태를 확인하지 못했습니다.');
    var version = Number(data.version);
    return Number.isFinite(version) ? version : null;
  }

  async function refreshAttendanceFromServer() {
    if (refreshing || !isRecordRoomVisible()) return false;
    var refresh = window.refreshRecordAttendanceDashboardFromServer;
    if (typeof refresh !== 'function') return false;

    refreshing = true;
    try {
      await refresh('');
      return true;
    } catch (error) {
      console.warn('PC→폰 출석 동기화 보류:', error && (error.message || error));
      return false;
    } finally {
      refreshing = false;
    }
  }

  async function checkRevision(forceInitialRefresh, options) {
    var allowWithRealtime = !!(options && options.allowWithRealtime);
    if (!allowWithRealtime && hasRealtimeConnection()) return false;
    if (checking || !isRecordRoomVisible()) return false;

    var academyId = currentAcademyId();
    var sessionToken = currentSessionToken();
    if (!academyId || !sessionToken || typeof window.supabase !== 'function') return false;

    if (academyId !== lastAcademyId) {
      lastAcademyId = academyId;
      lastRevision = null;
    }

    checking = true;
    try {
      var revision = await fetchRevision(academyId, sessionToken);
      if (revision == null) return false;
      var changed = lastRevision != null && revision !== lastRevision;
      var firstCheck = lastRevision == null;
      lastRevision = revision;
      if (changed || (firstCheck && forceInitialRefresh)) {
        return await refreshAttendanceFromServer();
      }
      return true;
    } catch (error) {
      console.warn('출석 변경 확인 보류:', error && (error.message || error));
      return false;
    } finally {
      checking = false;
    }
  }

  function checkSoon(delay, forceInitialRefresh) {
    setTimeout(function(){ checkRevision(!!forceInitialRefresh); }, Number(delay) || 0);
  }

  window.syncPhoneAttendanceFromOtherDevices = function(){
    return checkRevision(true, { allowWithRealtime: true });
  };
  window.addEventListener('focus', function(){ checkSoon(0, true); });
  window.addEventListener('pageshow', function(){ checkSoon(80, true); });
  document.addEventListener('visibilitychange', function(){
    if (document.visibilityState === 'visible') checkSoon(0, true);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ checkSoon(900, true); });
  } else {
    checkSoon(900, true);
  }

  setInterval(function(){ checkRevision(false); }, REVISION_POLL_MS);
})();
