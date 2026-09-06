(function attendanceLinkPolicyModule(global) {
  'use strict';

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function buildRowsByStudentDate(rows) {
    const map = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const studentId = clean(row && row.student_id);
      const sessionDate = clean(row && row.session_date).slice(0, 10);
      if (!studentId || !sessionDate) return;
      const key = `${studentId}|${sessionDate}`;
      const list = map.get(key) || [];
      list.push(row);
      map.set(key, list);
    });
    return map;
  }

  function getCellStatus(rowsByStudentDate, studentId, sessionDate, today) {
    const dateKey = clean(sessionDate).slice(0, 10);
    const records = rowsByStudentDate instanceof Map
      ? (rowsByStudentDate.get(`${clean(studentId)}|${dateKey}`) || [])
      : [];
    const makeupRows = records.filter((row) => clean(row && row.session_kind) === 'makeup');
    if (makeupRows.some((row) => row && row.attended !== false)) {
      return { type: 'makeup', label: '보', ariaLabel: '보강 출석', records };
    }
    if (makeupRows.length && dateKey && dateKey <= clean(today).slice(0, 10)) {
      return { type: 'absent', label: '결', ariaLabel: '결석', records };
    }
    const regular = records.find((row) => clean(row && row.session_kind) === 'regular' && row && row.attended !== false);
    if (regular) {
      return { type: 'regular', label: '✓', ariaLabel: '출석', records };
    }
    return { type: 'empty', label: '', ariaLabel: '', records };
  }

  function classNameForStatus(status) {
    const type = clean(status && status.type);
    if (type === 'makeup') return 'attendanceMakeupMark';
    if (type === 'absent') return 'attendanceAbsentMark';
    if (type === 'regular') return 'attendanceLinkedMark';
    return '';
  }

  global.OlliAttendanceLinkPolicy = Object.freeze({
    buildRowsByStudentDate,
    getCellStatus,
    classNameForStatus
  });
})(window);
