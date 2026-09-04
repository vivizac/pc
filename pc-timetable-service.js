(function timetableServiceModule(global) {
  'use strict';

  const DAYS = ['월', '화', '수', '목', '금', '토'];
  const SESSION_KEY = 'olli_account_session_token_v1';
  const WEEK_CACHE_PREFIX = 'olli_schedule_week_cache_v1';
  const ATTENDANCE_MONTH_CACHE_PREFIX = 'olli_schedule_attendance_month_cache_v1';

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function currentAcademyId() {
    try {
      if (typeof global.getOlliCurrentAcademyId === 'function') {
        const id = clean(global.getOlliCurrentAcademyId());
        if (id) return id;
      }
    } catch (_) {}
    return clean(localStorage.getItem('olli_current_academy_id'));
  }

  function currentSessionToken() {
    return clean(localStorage.getItem(SESSION_KEY));
  }

  function weekCacheKey(weekStart) {
    return `${WEEK_CACHE_PREFIX}_${currentAcademyId() || 'unknown'}_${clean(weekStart)}`;
  }

  function getCachedWeek(weekStart) {
    try {
      const cached = JSON.parse(localStorage.getItem(weekCacheKey(weekStart)) || 'null');
      if (!cached || cached.academy_id !== currentAcademyId() || cached.week_start !== clean(weekStart)) return null;
      return cached.data && typeof cached.data === 'object' ? cached.data : null;
    } catch (_) {
      return null;
    }
  }

  function cacheWeek(weekStart, data) {
    if (!data || typeof data !== 'object' || data.error) return;
    try {
      localStorage.setItem(weekCacheKey(weekStart), JSON.stringify({
        academy_id: currentAcademyId(),
        week_start: clean(weekStart),
        cached_at: new Date().toISOString(),
        data
      }));
    } catch (_) {}
  }

  function attendanceMonthCacheKey(yearMonth) {
    return `${ATTENDANCE_MONTH_CACHE_PREFIX}_${currentAcademyId() || 'unknown'}_${clean(yearMonth)}`;
  }

  function getCachedAttendanceMonth(yearMonth) {
    try {
      const cached = JSON.parse(localStorage.getItem(attendanceMonthCacheKey(yearMonth)) || 'null');
      return cached && Array.isArray(cached.attendance) ? cached.attendance : null;
    } catch (_) { return null; }
  }

  function cacheAttendanceMonth(yearMonth, rows) {
    try { localStorage.setItem(attendanceMonthCacheKey(yearMonth), JSON.stringify({ cached_at: new Date().toISOString(), attendance: rows || [] })); }
    catch (_) {}
  }

  function invalidateAttendanceMonth(value) {
    const yearMonth = clean(value).slice(0, 7);
    if (!yearMonth) return;
    try { localStorage.removeItem(attendanceMonthCacheKey(yearMonth)); } catch (_) {}
  }

  function activeStudents() {
    const elementary = typeof global.getStudentsByType === 'function' ? global.getStudentsByType('elementary') : [];
    const kinder = typeof global.getStudentsByType === 'function' ? global.getStudentsByType('kinder') : [];
    return [...(Array.isArray(elementary) ? elementary : []), ...(Array.isArray(kinder) ? kinder : [])]
      .filter((student) => {
        try {
          return typeof global.getStudentStatus !== 'function' || global.getStudentStatus(student) === 'active';
        } catch (_) {
          return true;
        }
      });
  }

  function parseTimes(value) {
    const found = [];
    clean(value).replace(/(?:오후\s*)?([1-7])\s*(?:시|:00)?/g, (_, hour) => {
      const time = Number(hour);
      if (!found.includes(time)) found.push(time);
      return '';
    });
    return found;
  }

  function legacyPairs(student) {
    const rawDay = clean(student && (student.lesson_day || student.lessonDay || student.class_day || student.classDay));
    const rawTime = clean(student && (student.lesson_time || student.lessonTime || student.class_time || student.classTime));
    const pairs = [];

    rawTime.split(/[·,\/|\n]+/).map(clean).filter(Boolean).forEach((part) => {
      const dayMatch = part.match(/([월화수목금토])/);
      const times = parseTimes(part);
      if (!dayMatch) return;
      times.forEach((time) => pairs.push({ weekday: DAYS.indexOf(dayMatch[1]) + 1, time_slot: time }));
    });

    if (!pairs.length) {
      const days = DAYS.filter((day) => rawDay.includes(day));
      const times = parseTimes(rawTime);
      if (days.length === 1) {
        times.forEach((time) => pairs.push({ weekday: DAYS.indexOf(days[0]) + 1, time_slot: time }));
      } else if (days.length > 1 && days.length === times.length) {
        days.forEach((day, index) => pairs.push({ weekday: DAYS.indexOf(day) + 1, time_slot: times[index] }));
      } else {
        days.forEach((day) => times.forEach((time) => pairs.push({ weekday: DAYS.indexOf(day) + 1, time_slot: time })));
      }
    }

    const seen = new Set();
    return pairs.filter((pair) => {
      const key = `${pair.weekday}/${pair.time_slot}`;
      if (pair.weekday < 1 || pair.weekday > 6 || pair.time_slot < 1 || pair.time_slot > 7 || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async function rpc(name, payload) {
    if (typeof global.supabase !== 'function') throw new Error('시간표 서버 연결을 찾지 못했습니다.');
    const result = await global.supabase('POST', `rpc/${name}`, payload || {});
    const data = Array.isArray(result) && result.length === 1 ? result[0] : result;
    if (data && data.ok === false) throw new Error(data.message || '시간표 요청을 처리하지 못했습니다.');
    return data || {};
  }

  function contextPayload(extra) {
    const academyId = currentAcademyId();
    const sessionToken = currentSessionToken();
    if (!academyId) throw new Error('현재 학원 정보를 찾지 못했습니다. 다시 로그인해 주세요.');
    if (!sessionToken) throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
    return Object.assign({ p_session_token: sessionToken, p_academy_id: academyId }, extra || {});
  }

  async function bootstrapLegacy() {
    const students = activeStudents()
      .filter((student) => clean(student && student.id))
      .map((student) => ({ student_id: clean(student.id), pairs: legacyPairs(student) }));
    return rpc('olli_schedule_bootstrap', contextPayload({ p_students: students }));
  }

  async function loadWeek(weekStart) {
    await bootstrapLegacy();
    await rpc('olli_schedule_apply_due', contextPayload());
    const data = await rpc('olli_schedule_week', contextPayload({ p_week_start: weekStart }));
    cacheWeek(weekStart, data);
    return data;
  }

  async function executeScheduleAction(action, params) {
    return rpc('olli_schedule_execute', contextPayload({
      p_action: action,
      p_params: params || {}
    }));
  }

  async function setSessionOrder(studentId, enrollmentId, sessionOrder, effectiveDate) {
    return executeScheduleAction('set_session_order', {
      student_id: studentId,
      enrollment_id: enrollmentId,
      session_order: Number(sessionOrder),
      effective_date: effectiveDate || new Date().toISOString().slice(0, 10)
    });
  }

  async function saveCellMemo(division, sessionDate, timeSlot, note) {
    return executeScheduleAction('save_cell_memo', {
      division,
      session_date: sessionDate,
      time_slot: Number(timeSlot),
      note: note || ''
    });
  }

  async function changeSchedule(options) {
    return executeScheduleAction('change', {
      student_id: options.studentId,
      source_enrollment_id: options.sourceEnrollmentId || null,
      target_weekday: Number(options.targetWeekday),
      target_time_slot: Number(options.targetTimeSlot),
      target_class_group: options.targetClassGroup || 'A',
      effective_date: options.effectiveDate,
      change_type: options.changeType,
      allow_wait: options.allowWait !== false
    });
  }

  async function resolveWaitlist(waitlistId, action, effectiveDate) {
    return executeScheduleAction('resolve_waitlist', {
      waitlist_id: waitlistId,
      action,
      effective_date: effectiveDate || new Date().toISOString().slice(0, 10)
    });
  }

  async function addMakeup(studentId, sessionDate, timeSlot, note, classGroup) {
    return executeScheduleAction('add_one_time', {
      student_id: studentId,
      session_date: sessionDate,
      time_slot: Number(timeSlot),
      class_group: classGroup || 'A',
      note: note || ''
    });
  }

  async function addWaitlist(options) {
    return executeScheduleAction('add_waitlist', {
      student_id: options.studentId,
      target_weekday: Number(options.targetWeekday),
      target_time_slot: Number(options.targetTimeSlot),
      target_class_group: options.targetClassGroup || 'A',
      effective_date: options.effectiveDate
    });
  }

  async function cancelMakeup(oneTimeSessionId) {
    return executeScheduleAction('cancel_one_time', { one_time_session_id: oneTimeSessionId });
  }

  async function cancelChange(changeId) {
    return executeScheduleAction('cancel_change', { change_id: changeId });
  }

  async function removeEnrollment(studentId, enrollmentId, effectiveDate) {
    return executeScheduleAction('remove_enrollment', {
      student_id: studentId,
      enrollment_id: enrollmentId,
      effective_date: effectiveDate
    });
  }

  async function splitClass(weekday, timeSlot) {
    return executeScheduleAction('split_class', {
      weekday: Number(weekday),
      time_slot: Number(timeSlot)
    });
  }

  async function mergeClass(weekday, timeSlot) {
    return executeScheduleAction('merge_class', { weekday: Number(weekday), time_slot: Number(timeSlot) });
  }

  async function toggleAttendance(options) {
    const result = await executeScheduleAction('toggle_attendance', {
      student_id: options.studentId,
      session_date: options.sessionDate,
      time_slot: Number(options.timeSlot),
      class_group: options.classGroup || 'A',
      session_kind: options.sessionKind || 'regular'
    });
    invalidateAttendanceMonth(options.sessionDate);
    return result;
  }

  async function loadAttendanceMonth(yearMonth) {
    const value = /^\d{4}-\d{2}$/.test(clean(yearMonth)) ? `${clean(yearMonth)}-01` : new Date().toISOString().slice(0, 8) + '01';
    const data = await rpc('olli_schedule_attendance_month', contextPayload({ p_month: value }));
    const rows = Array.isArray(data.attendance) ? data.attendance : [];
    cacheAttendanceMonth(value.slice(0, 7), rows);
    return rows;
  }

  async function savePickup(options) {
    return executeScheduleAction('save_pickup', {
      student_id: options.studentId,
      weekday: Number(options.weekday),
      class_time: Number(options.classTime),
      pickup_label: options.pickupLabel,
      pickup_time: options.pickupTime,
      effective_date: options.effectiveDate
    });
  }

  async function removePickup(pickupId, effectiveDate) {
    return executeScheduleAction('remove_pickup', {
      pickup_id: pickupId,
      effective_date: effectiveDate
    });
  }

  async function loadHistory(limit) {
    return rpc('olli_schedule_history_list', contextPayload({
      p_limit: Math.min(Math.max(Number(limit) || 50, 1), 100)
    }));
  }

  async function restoreHistory(transactionId) {
    return rpc('olli_schedule_restore_history', contextPayload({
      p_transaction_id: String(transactionId || '')
    }));
  }

  global.OlliTimetableService = Object.freeze({
    DAYS,
    activeStudents,
    currentAcademyId,
    legacyPairs,
    getCachedWeek,
    getCachedAttendanceMonth,
    loadWeek,
    changeSchedule,
    resolveWaitlist,
    addMakeup,
    addWaitlist,
    cancelMakeup,
    cancelChange,
    removeEnrollment,
    splitClass,
    mergeClass,
    toggleAttendance,
    loadAttendanceMonth,
    savePickup,
    removePickup,
    loadHistory,
    restoreHistory,
    setSessionOrder,
    saveCellMemo
  });
})(window);

