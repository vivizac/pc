(function initOlliAttendanceGuide(global){
  'use strict';

  let active = false;

  function safeEscape(value){
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(value);
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getCounts(student){
    const policy = global.OlliAttendancePolicy;
    if (!policy || typeof policy.getCounts !== 'function') return null;
    return policy.getCounts(student);
  }

  function renderHtml(student){
    if (!active) return '';
    const counts = getCounts(student);
    if (!counts) return '';
    return '<span class="recordAttendanceGuideOutput">'
      + '<span class="recordAttendanceGuideMetric recordAttendanceGuideYear">' + safeEscape(counts.year) + '년</span>'
      + '<span class="recordAttendanceGuideMetric">결석 <b>' + safeEscape(counts.yearAbsence) + '회</b></span>'
      + '<span class="recordAttendanceGuideMetric">보강 <b>' + safeEscape(counts.yearMakeup) + '회</b></span>'
      + '<span class="recordAttendanceGuideMetric">남은 보강 <b>' + safeEscape(counts.remainingMakeup) + '회</b></span>'
      + '</span>';
  }

  function currentView(){
    try {
      if (typeof currentRecordView !== 'undefined') {
        return currentRecordView === 'kinder' ? 'kinder' : 'elementary';
      }
    } catch (_) {}
    try {
      return global.getOlliLastRecordDivisionView?.() === 'kinder' ? 'kinder' : 'elementary';
    } catch (_) {
      return 'elementary';
    }
  }

  function rerenderCurrentList(){
    const searchValue = global.document.getElementById('searchName')?.value?.trim() || '';
    const view = currentView();
    if (view === 'kinder' && typeof global.renderKinderRecords === 'function') {
      global.renderKinderRecords(searchValue);
    } else if (typeof global.renderElementaryRecords === 'function') {
      global.renderElementaryRecords(searchValue);
    }
  }

  function updateButton(){
    const button = global.document.getElementById('recordAttendanceGuideToggle');
    if (!button) return;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.setAttribute('aria-label', active ? '출결 가이드 끄기' : '출결 가이드 보기');
  }

  function scheduleListRender(){
    if (typeof global.requestAnimationFrame === 'function') {
      global.requestAnimationFrame(rerenderCurrentList);
    } else {
      global.setTimeout(rerenderCurrentList, 0);
    }
  }

  function toggle(event){
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    active = !active;
    updateButton();
    scheduleListRender();
  }

  function refreshStudent(studentId){
    if (!active || !studentId || typeof global.getAllStudents !== 'function') return false;
    const student = global.getAllStudents().find(item => String(item?.id) === String(studentId));
    if (!student) return false;
    const rows = global.document.querySelectorAll('[data-record-student-id]');
    let row = null;
    for (const candidate of rows) {
      if (candidate.getAttribute('data-record-student-id') === String(studentId)) {
        row = candidate;
        break;
      }
    }
    if (!row) return false;
    const host = row.querySelector('.studentTextWrap');
    if (!host) return false;
    host.querySelector('.recordAttendanceGuideOutput')?.remove();
    const html = renderHtml(student);
    if (!html) {
      host.classList.remove('recordAttendanceGuideHost');
      return true;
    }
    host.classList.add('recordAttendanceGuideHost');
    host.insertAdjacentHTML('beforeend', html);
    return true;
  }

  global.toggleOlliAttendanceGuide = toggle;
  global.OlliAttendanceGuide = Object.freeze({
    isActive: () => active,
    renderHtml,
    refreshStudent
  });
})(window);
