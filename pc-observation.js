(function pcObservationCompatibility(global) {
  'use strict';

  // 독립 PC 관찰노트 페이지는 성향기록부로 통합되었습니다.
  // 구버전 캐시/호환 호출만 성향기록부로 전달하고, 별도 화면 로직은 더 이상 두지 않습니다.
  function recordsFeature() {
    return global.OlliPcPersonalityRecords || global.OlliPcAttendance || null;
  }

  function open() {
    if (typeof global.pcOpenSection === 'function') return global.pcOpenSection('attendance');
  }

  function renderContext(elementary, kinder) {
    return recordsFeature()?.renderContext?.(elementary || [], kinder || []);
  }

  function renderTopbar(title) {
    if (title) title.textContent = '성향기록부';
  }

  function openSidebarSort(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const popup = document.getElementById('recordSortPopup');
    const bottom = document.querySelector('#olliPcShell .olliPcSidebarBottom');
    if (!popup || !bottom) return;
    if (popup.parentElement !== bottom) bottom.appendChild(popup);
    if (typeof global.refreshRecordSortPopup === 'function') global.refreshRecordSortPopup('elementary');
    popup.classList.toggle('show');
  }

  function refreshRoster() {
    return recordsFeature()?.renderList?.();
  }

  function selectStudent(studentId) {
    const finish = () => recordsFeature()?.selectStudent?.(studentId);
    if (typeof global.pcOpenSection === 'function') {
      const result = global.pcOpenSection('attendance');
      Promise.resolve(result).then(() => setTimeout(finish, 0));
      return result;
    }
    finish();
  }

  function openStudentInfo(studentId, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const student = typeof global.findStudentById === 'function' ? global.findStudentById(studentId) : null;
    if (!student) return;
    try { global.studentInfoModalTarget = student; } catch (_) {}
    if ((student.type || 'kinder') === 'elementary') global.openElementaryInfoModal?.();
    else global.openKinderInfoModal?.();
  }

  function openArchive() {
    // 독립 관찰노트 보관함 진입점은 제거되었습니다.
  }

  const api = { renderContext, renderTopbar, open, openStudentInfo, openSidebarSort, refreshRoster, selectStudent, openArchive };
  global.OlliPcObservationNote = api;
  global.OlliPcObservation = api;
})(window);
