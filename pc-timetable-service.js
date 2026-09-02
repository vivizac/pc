(function timetableServiceModule(global) {
  'use strict';

  const DAYS = ['월', '화', '수', '목', '금', '토'];
  const SESSION_KEY = 'olli_account_session_token_v1';

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
    return rpc('olli_schedule_week', contextPayload({ p_week_start: weekStart }));
  }

  async function changeSchedule(options) {
    return rpc('olli_schedule_change', contextPayload({
      p_student_id: options.studentId,
      p_source_enrollment_id: options.sourceEnrollmentId || null,
      p_target_weekday: Number(options.targetWeekday),
      p_target_time_slot: Number(options.targetTimeSlot),
      p_effective_date: options.effectiveDate,
      p_change_type: options.changeType,
      p_allow_wait: options.allowWait !== false
    }));
  }

  async function resolveWaitlist(waitlistId, action, effectiveDate) {
    return rpc('olli_schedule_resolve_waitlist', contextPayload({
      p_waitlist_id: waitlistId,
      p_action: action,
      p_effective_date: effectiveDate || new Date().toISOString().slice(0, 10)
    }));
  }

  async function addMakeup(studentId, sessionDate, timeSlot, note) {
    return rpc('olli_schedule_add_one_time', contextPayload({
      p_student_id: studentId,
      p_session_date: sessionDate,
      p_time_slot: Number(timeSlot),
      p_note: note || ''
    }));
  }

  async function cancelMakeup(oneTimeSessionId) {
    return rpc('olli_schedule_cancel_one_time', contextPayload({ p_one_time_session_id: oneTimeSessionId }));
  }

  async function cancelChange(changeId) {
    return rpc('olli_schedule_cancel_change', contextPayload({ p_change_id: changeId }));
  }

  async function removeEnrollment(studentId, enrollmentId, effectiveDate) {
    return rpc('olli_schedule_remove_enrollment', contextPayload({
      p_student_id: studentId,
      p_enrollment_id: enrollmentId,
      p_effective_date: effectiveDate
    }));
  }

  global.OlliTimetableService = Object.freeze({
    DAYS,
    activeStudents,
    currentAcademyId,
    legacyPairs,
    loadWeek,
    changeSchedule,
    resolveWaitlist,
    addMakeup,
    cancelMakeup,
    cancelChange,
    removeEnrollment
  });
})(window);
