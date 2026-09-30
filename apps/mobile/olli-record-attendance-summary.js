(function initRecordAttendanceSummary(global){
  'use strict';

  let active = false;
  let renderGeneration = 0;

  function text(value){
    return String(value == null ? '' : value).trim();
  }

  function escapeHtml(value){
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(value);
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function parseDateKey(value){
    const parts = text(value).split('-').map(Number);
    if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) return null;
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function enrollmentDate(student){
    let raw = '';
    try {
      if (typeof global.getEnrolledAtFromStudent === 'function') raw = global.getEnrolledAtFromStudent(student);
    } catch (_) {}
    raw = raw || student?.enrolled_at || student?.enrolledAt || student?.registered_at || student?.registeredAt || '';
    if (!raw && student) {
      const y = student.year || student.enrolled_year || '';
      const m = student.month || student.enrolled_month || '';
      const d = student.day || student.enrolled_day || '';
      if (y && m && d) raw = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return parseDateKey(String(raw).split('T')[0]);
  }

  function addMonthsSafe(date, months){
    const original = new Date(date.getTime());
    const day = original.getDate();
    const target = new Date(original.getFullYear(), original.getMonth() + Number(months || 0), 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(day, lastDay));
    target.setHours(23, 59, 59, 999);
    return target;
  }

  function expiryDate(absenceDate, expireRule){
    const date = new Date(absenceDate.getTime());
    if (expireRule === 'year_end') {
      const end = new Date(date.getFullYear(), 11, 31);
      end.setHours(23, 59, 59, 999);
      return end;
    }
    const months = Number(String(expireRule || '3m').replace('m', '')) || 3;
    return addMonthsSafe(date, months);
  }

  function readSnapshot(){
    const students = typeof global.getAllStudents === 'function' ? global.getAllStudents() : [];
    const studentMap = new Map(students.map(student => [String(student?.id || ''), student]));
    const store = typeof global.readRecordDailyAttendanceStore === 'function'
      ? global.readRecordDailyAttendanceStore()
      : {};
    const policy = typeof global.getOlliAttendancePolicy === 'function'
      ? global.getOlliAttendancePolicy()
      : (global.OlliAttendancePolicy?.getPolicy?.() || { startDate: '', makeupExpire: '3m' });
    return { studentMap, store, policy };
  }

  function statusFromStore(store, dateKey, studentId){
    const status = text(store?.[dateKey]?.[String(studentId)]?.status).toLowerCase();
    return status === 'attended' || status === 'absent' || status === 'makeup' ? status : '';
  }

  function formatDateKey(date){
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function calculateCounts(student, snapshot){
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const year = today.getFullYear();
    const yearStart = new Date(year, 0, 1);
    const policyStart = parseDateKey(snapshot.policy?.startDate) || yearStart;
    const enrolled = enrollmentDate(student);
    let start = yearStart;
    if (policyStart > start) start = new Date(policyStart.getTime());
    if (enrolled && enrolled > start) start = new Date(enrolled.getTime());

    let yearAbsence = 0;
    let unexpiredAbsence = 0;
    let yearMakeup = 0;

    for (let cursor = new Date(start.getTime()); cursor <= today; cursor.setDate(cursor.getDate() + 1)) {
      const dateKey = formatDateKey(cursor);
      const status = statusFromStore(snapshot.store, dateKey, student.id);
      const lessonDate = typeof global.isRecordStudentLessonDate === 'function'
        ? !!global.isRecordStudentLessonDate(student, cursor)
        : false;
      if (status === 'makeup') yearMakeup += 1;
      if (lessonDate && cursor < today && status !== 'attended') {
        yearAbsence += 1;
        const expiry = expiryDate(cursor, snapshot.policy?.makeupExpire);
        if (today <= expiry) unexpiredAbsence += 1;
      }
    }

    return {
      year,
      yearAbsence,
      yearMakeup,
      remainingMakeup: Math.max(unexpiredAbsence - yearMakeup, 0)
    };
  }

  function summaryHtml(counts){
    return '<span class="recordAttendanceSummaryLine">'
      + '<span class="recordAttendanceSummaryMetric recordAttendanceSummaryYear">' + escapeHtml(counts.year) + '년</span>'
      + '<span class="recordAttendanceSummaryMetric">결석 <b>' + escapeHtml(counts.yearAbsence) + '회</b></span>'
      + '<span class="recordAttendanceSummaryMetric">보강 <b>' + escapeHtml(counts.yearMakeup) + '회</b></span>'
      + '<span class="recordAttendanceSummaryMetric">남은 보강 <b>' + escapeHtml(counts.remainingMakeup) + '회</b></span>'
      + '</span>';
  }

  function clearRows(){
    global.document.querySelectorAll('#recordRoomScreen .recordAttendanceSummaryLine').forEach(node => node.remove());
    global.document.querySelectorAll('#recordRoomScreen .recordAttendanceSummaryHost').forEach(node => node.classList.remove('recordAttendanceSummaryHost'));
  }

  function renderRow(row, snapshot){
    if (!active || !row) return false;
    const studentId = row.getAttribute('data-record-student-id');
    const student = snapshot.studentMap.get(String(studentId || ''));
    const host = row.querySelector('.studentTextWrap');
    if (!student || !host) return false;
    host.querySelector('.recordAttendanceSummaryLine')?.remove();
    host.classList.add('recordAttendanceSummaryHost');
    host.insertAdjacentHTML('beforeend', summaryHtml(calculateCounts(student, snapshot)));
    return true;
  }

  function scheduleRows(){
    const generation = ++renderGeneration;
    clearRows();
    if (!active) return;

    const snapshot = readSnapshot();
    const rows = Array.from(global.document.querySelectorAll('#recordRoomScreen [data-record-student-id]'));
    let index = 0;

    const runChunk = () => {
      if (!active || generation !== renderGeneration) return;
      const stop = Math.min(index + 4, rows.length);
      while (index < stop) {
        renderRow(rows[index], snapshot);
        index += 1;
      }
      if (index < rows.length) global.setTimeout(runChunk, 0);
    };

    if (typeof global.requestAnimationFrame === 'function') {
      global.requestAnimationFrame(() => global.requestAnimationFrame(runChunk));
    } else {
      global.setTimeout(runChunk, 0);
    }
  }

  function updateButton(){
    const button = global.document.getElementById('recordAttendanceSummaryToggle');
    if (!button) return;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.setAttribute('aria-label', active ? '출결 닫기' : '출결 보기');
  }

  function toggle(event){
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    active = !active;
    updateButton();
    if (active) scheduleRows();
    else {
      renderGeneration += 1;
      clearRows();
    }
  }

  function refreshStudent(studentId){
    if (!active || !studentId) return false;
    const snapshot = readSnapshot();
    const rows = Array.from(global.document.querySelectorAll('#recordRoomScreen [data-record-student-id]'))
      .filter(row => row.getAttribute('data-record-student-id') === String(studentId));
    rows.forEach(row => renderRow(row, snapshot));
    return rows.length > 0;
  }

  global.addEventListener('olli:record-list-rendered', () => {
    if (active) scheduleRows();
  });
  global.addEventListener('olli:attendance-changed', event => {
    const studentId = event?.detail?.studentId;
    if (active && studentId) refreshStudent(studentId);
  });

  global.toggleRecordAttendanceSummary = toggle;
  global.OlliRecordAttendanceSummary = Object.freeze({
    isActive: () => active,
    refresh: scheduleRows,
    refreshStudent
  });
})(window);
