
/* 2026-07-04: 부모 박스가 다른 출결 버튼을 1분 피드백 버튼 좌표에 맞춰 보정 */
(function(){
  var alignTimer = null;

  function getRect(el) {
    try { return el && el.getBoundingClientRect ? el.getBoundingClientRect() : null; }
    catch (_) { return null; }
  }

  function getThirdUtilitySlotRight() {
    var screen = document.getElementById('recordRoomScreen');
    if (!screen) return 0;

    var buttons = Array.prototype.slice.call(
      screen.querySelectorAll('.recordUtilityRow .recordUtilityCircle')
    ).filter(function(button){
      var rect = getRect(button);
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      var style = window.getComputedStyle(button);
      return style.display !== 'none' && style.visibility !== 'hidden';
    }).sort(function(a,b){
      return getRect(a).left - getRect(b).left;
    });

    if (buttons[2]) return getRect(buttons[2]).right;
    if (buttons[0] && buttons[1]) {
      var firstRect = getRect(buttons[0]);
      var secondRect = getRect(buttons[1]);
      return secondRect.right + (secondRect.right - firstRect.right);
    }
    return 0;
  }

  function alignRecordAttendanceGuideButton() {
    var row = document.querySelector('#recordRoomScreen .recordModeLabelRow');
    var btn = document.getElementById('recordAttendanceGuideToggle');
    if (!row || !btn) return;
    if (!row.contains(btn)) return;

    var rowRect = getRect(row);
    var btnRect = getRect(btn);
    var targetRight = getThirdUtilitySlotRight();
    if (!rowRect || !btnRect || !targetRight) return;

    var btnWidth = btn.offsetWidth || btnRect.width || 58;
    var targetLeft = Math.round(targetRight - rowRect.left - btnWidth);
    var maxLeft = Math.max(0, row.clientWidth - btnWidth);
    targetLeft = Math.max(0, Math.min(maxLeft, targetLeft));

    var nextLeft = targetLeft + 'px';
    if (btn.style.left !== nextLeft) btn.style.left = nextLeft;
    if (btn.style.right !== 'auto') btn.style.right = 'auto';
  }

  function scheduleAlign() {
    if (alignTimer) clearTimeout(alignTimer);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(alignRecordAttendanceGuideButton);
    } else {
      setTimeout(alignRecordAttendanceGuideButton, 0);
    }
    alignTimer = setTimeout(alignRecordAttendanceGuideButton, 90);
  }

  window.alignRecordAttendanceGuideButton = alignRecordAttendanceGuideButton;
  window.scheduleRecordAttendanceGuideButtonAlign = scheduleAlign;

  if (typeof ResizeObserver !== 'undefined') {
    try {
      var ro = new ResizeObserver(scheduleAlign);
      var observeTargets = function(){
        var row = document.querySelector('#recordRoomScreen .recordModeLabelRow');
        var utilityRow = document.querySelector('#recordRoomScreen .recordUtilityRow');
        var btn = document.getElementById('recordAttendanceGuideToggle');
        if (row) ro.observe(row);
        if (utilityRow) ro.observe(utilityRow);
        if (btn) ro.observe(btn);
        document.querySelectorAll('#recordRoomScreen .recordUtilityRow .recordUtilityCircle').forEach(function(anchor){
          ro.observe(anchor);
        });
      };
      setTimeout(observeTargets, 0);
      setTimeout(observeTargets, 300);
    } catch (_) {}
  }

  try {
    var mo = new MutationObserver(scheduleAlign);
    var target = document.getElementById('recordRoomScreen') || document.body;
    if (target) mo.observe(target, { childList: true, subtree: true });
  } catch (_) {}

  window.addEventListener('resize', scheduleAlign);
  window.addEventListener('orientationchange', function(){ setTimeout(scheduleAlign, 240); });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleAlign);
  } else {
    scheduleAlign();
  }
  setTimeout(scheduleAlign, 250);
  setTimeout(scheduleAlign, 700);
})();

/* 2026-09-10: PC에서 바뀐 출석을 폰 출석부에 자동 반영한다.
   매 5초에는 가벼운 sync revision만 확인하고, 실제 변경이 있을 때만 월 출석 데이터를 다시 받는다. */
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
    if (refreshing || !isRecordRoomVisible()) return;
    var syncMonth = window.syncRecordAttendanceCurrentMonthFromServer;
    var syncToday = window.syncOlliTodayAttendanceSchedule;
    if (typeof syncMonth !== 'function') return;

    refreshing = true;
    try {
      if (typeof syncToday === 'function') await syncToday(new Date(), { render: false });
      await syncMonth(new Date(), { render: true });
    } catch (error) {
      console.warn('PC→폰 출석 동기화 보류:', error && (error.message || error));
    } finally {
      refreshing = false;
    }
  }

  async function checkRevision(forceRefresh) {
    if (checking || !isRecordRoomVisible()) return;
    var academyId = currentAcademyId();
    var sessionToken = currentSessionToken();
    if (!academyId || !sessionToken || typeof window.supabase !== 'function') return;

    if (academyId !== lastAcademyId) {
      lastAcademyId = academyId;
      lastRevision = null;
    }

    checking = true;
    try {
      var revision = await fetchRevision(academyId, sessionToken);
      if (revision == null) return;
      var changed = lastRevision != null && revision !== lastRevision;
      var firstCheck = lastRevision == null;
      lastRevision = revision;
      if (changed || (firstCheck && forceRefresh) || forceRefresh) {
        await refreshAttendanceFromServer();
      }
    } catch (error) {
      console.warn('출석 변경 확인 보류:', error && (error.message || error));
    } finally {
      checking = false;
    }
  }

  function forceCheckSoon(delay) {
    setTimeout(function(){ checkRevision(true); }, Number(delay) || 0);
  }

  window.syncPhoneAttendanceFromOtherDevices = function(){ return checkRevision(true); };
  window.addEventListener('focus', function(){ forceCheckSoon(0); });
  window.addEventListener('pageshow', function(){ forceCheckSoon(80); });
  document.addEventListener('visibilitychange', function(){
    if (document.visibilityState === 'visible') forceCheckSoon(0);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ forceCheckSoon(900); });
  } else {
    forceCheckSoon(900);
  }

  setInterval(function(){ checkRevision(false); }, REVISION_POLL_MS);
})();
