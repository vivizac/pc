/* Shared PC/mobile visual marker for regularly scheduled weekend students. */
(function (global) {
  'use strict';
  const WEEKEND = [
    { day: '토', weekday: 6, label: '토요일 수업' },
    { day: '일', weekday: 7, label: '일요일 수업' }
  ];

  function getOlliStudentWeekendDays(student, activeEnrollments) {
    if (Array.isArray(activeEnrollments)) {
      const days = new Set(activeEnrollments.map((row) => Number(row && row.weekday)));
      return WEEKEND.filter((entry) => days.has(entry.weekday)).map((entry) => entry.day);
    }
    if (!student) return [];
    const source = student.lesson_day || student.lessonDay || student.class_day
      || student.classDay || student.days || student.weekdays || student.day || '';
    const entries = Array.isArray(source) ? source : [source];
    const dayText = entries.map((entry) => String(entry == null ? '' : entry).replace(/요일/g, '')).join(' ');
    return WEEKEND.filter((entry) =>
      dayText.includes(entry.day) || entries.some((value) => Number(value) === entry.weekday)
    ).map((entry) => entry.day);
  }

  function renderOlliStudentWeekendBadges(student, activeEnrollments) {
    return getOlliStudentWeekendDays(student, activeEnrollments).map((day) => {
      const label = day === '토' ? '토요일 수업' : '일요일 수업';
      return '<span class="olliStudentWeekendBadge" aria-label="' + label
        + '" title="' + label + '">' + day + '</span>';
    }).join('');
  }

  global.getOlliStudentWeekendDays = getOlliStudentWeekendDays;
  global.renderOlliStudentWeekendBadges = renderOlliStudentWeekendBadges;
})(window);
