/* 출결 가이드 UI. 학생행/헤더 원본을 덮어쓰지 않고 명시적 확장 API만 제공합니다. */
(function initOlliAttendanceGuideUI(global){
  'use strict';
  let attendanceGuideMode = false;

  function safeEscape(value){
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(value);
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function renderAttendanceGuideHtml(student){
    const policy = global.OlliAttendancePolicy;
    const counts = policy && typeof policy.getCounts === 'function' ? policy.getCounts(student) : null;
    if (!counts) return '';
    return '<span class="recordAttendanceGuideMeta">'
      + '<span class="recordAttendanceMetric recordAttendanceYearMetric"><b>' + safeEscape(counts.year) + '년</b></span>'
      + '<span class="recordAttendanceMetric">결석 <b>' + safeEscape(counts.yearAbsence) + '회</b></span>'
      + '<span class="recordAttendanceMetric">보강 <b>' + safeEscape(counts.yearMakeup) + '회</b></span>'
      + '<span class="recordAttendanceMetric">남은 보강 <b>' + safeEscape(counts.remainingMakeup) + '회</b></span>'
      + '</span>';
  }

  function getMetaHtml(student, normalText){
    if (!attendanceGuideMode) return safeEscape(normalText || '');
    return renderAttendanceGuideHtml(student);
  }

  function refreshCurrentStudentRows(){
    const searchValue = global.document.getElementById('searchName')?.value.trim() || '';
    try {
      if (typeof currentRecordView !== 'undefined' && currentRecordView === 'kinder' && typeof global.renderKinderRecords === 'function') global.renderKinderRecords(searchValue);
      else if (typeof currentRecordView !== 'undefined' && currentRecordView === 'elementary' && typeof global.renderElementaryRecords === 'function') global.renderElementaryRecords(searchValue);
      else if (typeof global.loadRecords === 'function') global.loadRecords(searchValue);
    } catch (_) {}
  }

  function updateGuideButton(){
    const btn = global.document.getElementById('recordAttendanceGuideToggle');
    if (!btn) return;
    btn.classList.toggle('active', attendanceGuideMode);
    btn.setAttribute('aria-pressed', attendanceGuideMode ? 'true' : 'false');
    btn.title = attendanceGuideMode ? '출결 가이드 끄기' : '출결 가이드 보기';
  }

  function scheduleAlign(){
    if (typeof global.scheduleRecordAttendanceGuideButtonAlign === 'function') {
      try { global.scheduleRecordAttendanceGuideButtonAlign(); } catch (_) {}
    }
  }

  function toggleRecordAttendanceGuideMode(event){
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    attendanceGuideMode = !attendanceGuideMode;
    updateGuideButton();
    refreshCurrentStudentRows();
    scheduleAlign();
  }

  function installGuideButton(){
    const row = global.document.querySelector('#recordRoomScreen .recordModeLabelRow');
    if (!row) return;
    let btn = global.document.getElementById('recordAttendanceGuideToggle');
    if (!btn) {
      btn = global.document.createElement('button');
      btn.id = 'recordAttendanceGuideToggle';
      btn.className = 'recordAttendanceGuideBtn';
      btn.type = 'button';
      btn.textContent = '출결';
      btn.setAttribute('aria-label', '출결 가이드 보기');
      btn.onclick = toggleRecordAttendanceGuideMode;
      row.appendChild(btn);
    }
    updateGuideButton();
    scheduleAlign();
  }

  function onHeaderUpdated(){
    setTimeout(installGuideButton, 0);
    scheduleAlign();
  }

  global.toggleRecordAttendanceGuideMode = toggleRecordAttendanceGuideMode;
  global.OlliAttendanceGuideUI = Object.freeze({
    isActive: () => attendanceGuideMode,
    getMetaHtml,
    installButton: installGuideButton,
    onHeaderUpdated
  });

  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', installGuideButton);
  else installGuideButton();
})(window);
