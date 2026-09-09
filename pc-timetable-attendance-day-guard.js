(function timetableAttendanceDayGuard(global) {
  'use strict';
  if (global.__OLLI_TIMETABLE_ATTENDANCE_DAY_GUARD_V1__) return;
  global.__OLLI_TIMETABLE_ATTENDANCE_DAY_GUARD_V1__ = true;

  function pad(value) { return String(value).padStart(2, '0'); }
  function todayKey() {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  document.addEventListener('click', (event) => {
    const button = event.target && event.target.closest ? event.target.closest('[data-tt-attendance]') : null;
    if (!button) return;
    const sessionDate = String(button.dataset.sessionDate || '').trim();
    if (!sessionDate || sessionDate === todayKey()) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }, true);
})(window);
