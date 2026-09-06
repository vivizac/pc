(function attendanceDataModule(global) {
  'use strict';

  const DAYS = ['월', '화', '수', '목', '금', '토'];
  const SESSION_KEY = 'olli_account_session_token_v1';
  const MONTH_CACHE_PREFIX = 'olli_attendance_month_cache_v1';

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function currentAcademyId() {
    try {
      if (typeof global.getOlliCurrentAcademyId === 'function') {
        const value = clean(global.getOlliCurrentAcademyId());
        if (value) return value;
      }
    } catch (_) {}
    return clean(localStorage.getItem('olli_current_academy_id'));
  }

  function currentSessionToken() {
    return clean(localStorage.getItem(SESSION_KEY));
  }

  function contextPayload(extra) {
    const academyId = currentAcademyId();
    const sessionToken = currentSessionToken();
    if (!academyId) throw new Error('현재 학원 정보를 찾지 못했습니다. 다시 로그인해 주세요.');
    if (!sessionToken) throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
    return Object.assign({ p_session_token: sessionToken, p_academy_id: academyId }, extra || {});
  }

  async function rpc(name, payload) {
    if (typeof global.supabase !== 'function') throw new Error('출석 서버 연결을 찾지 못했습니다.');
    const result = await global.supabase('POST', `rpc/${name}`, payload || {});
    const data = Array.isArray(result) && result.length === 1 ? result[0] : result;
    if (data && data.ok === false) throw new Error(data.message || '출석 요청을 처리하지 못했습니다.');
    return data || {};
  }

  async function execute(action, params) {
    return rpc('olli_schedule_execute', contextPayload({
      p_action: action,
      p_params: params || {}
    }));
  }

  function monthValue(value) {
    const raw = clean(value);
    if (/^\d{4}-\d{2}$/.test(raw)) return raw;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.slice(0, 7);
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  function monthCacheKey(value) {
    return `${MONTH_CACHE_PREFIX}_${currentAcademyId() || 'unknown'}_${monthValue(value)}`;
  }

  function getCachedMonth(value) {
    try {
      const cached = JSON.parse(localStorage.getItem(monthCacheKey(value)) || 'null');
      if (!cached || cached.academy_id !== currentAcademyId()) return null;
      return Array.isArray(cached.attendance) ? cached.attendance : null;
    } catch (_) {
      return null;
    }
  }

  function cacheMonth(value, rows) {
    try {
      localStorage.setItem(monthCacheKey(value), JSON.stringify({
        academy_id: currentAcademyId(),
        year_month: monthValue(value),
        cached_at: new Date().toISOString(),
        attendance: Array.isArray(rows) ? rows : []
      }));
    } catch (_) {}
  }

  function invalidateMonth(value) {
    try { localStorage.removeItem(monthCacheKey(value)); } catch (_) {}
  }

  async function loadMonth(value) {
    const ym = monthValue(value);
    const data = await rpc('olli_schedule_attendance_month', contextPayload({ p_month: `${ym}-01` }));
    const rows = Array.isArray(data.attendance) ? data.attendance : [];
    cacheMonth(ym, rows);
    return rows;
  }

  function parseTimes(value) {
    const found = [];
    clean(value).replace(/(?:오후\s*)?([1-9]|1[0-2])\s*(?:시|:00)?/g, (_, hour) => {
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
      if (pair.weekday < 1 || pair.weekday > 6 || pair.time_slot < 1 || pair.time_slot > 12 || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async function bootstrapLegacy(students) {
    const payload = (Array.isArray(students) ? students : [])
      .filter((student) => clean(student && student.id))
      .map((student) => ({ student_id: clean(student.id), pairs: legacyPairs(student) }));
    if (!payload.length) return { ok: true, inserted: 0 };
    return rpc('olli_schedule_bootstrap', contextPayload({ p_students: payload }));
  }

  function dateKey(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    }
    const raw = clean(value).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
  }

  function weekdayOf(value) {
    const key = dateKey(value);
    if (!key) return 0;
    const [y, m, d] = key.split('-').map(Number);
    const day = new Date(y, m - 1, d).getDay();
    return day === 0 ? 7 : day;
  }

  function weekStartOf(value) {
    const key = dateKey(value);
    if (!key) return '';
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const weekday = date.getDay() === 0 ? 7 : date.getDay();
    date.setDate(date.getDate() - (weekday - 1));
    return dateKey(date);
  }

  async function loadWeek(value) {
    const weekStart = weekStartOf(value);
    if (!weekStart) throw new Error('출석 날짜를 확인해 주세요.');
    try { await rpc('olli_schedule_apply_due', contextPayload()); } catch (_) {}
    return rpc('olli_schedule_week', contextPayload({ p_week_start: weekStart }));
  }

  function activeOnDate(enrollment, value) {
    const key = dateKey(value);
    const from = clean(enrollment && enrollment.effective_from).slice(0, 10);
    const to = clean(enrollment && enrollment.effective_to).slice(0, 10);
    return (!from || from <= key) && (!to || to >= key);
  }

  function chooseEnrollment(enrollments, student, value) {
    const weekday = weekdayOf(value);
    const rows = (Array.isArray(enrollments) ? enrollments : []).filter((row) =>
      clean(row && row.student_id) === clean(student && student.id)
      && Number(row && row.weekday) === weekday
      && activeOnDate(row, value)
    );
    if (rows.length < 2) return rows[0] || null;
    const preferred = legacyPairs(student).find((pair) => pair.weekday === weekday);
    return rows.find((row) => preferred && Number(row.time_slot) === Number(preferred.time_slot)) || rows[0] || null;
  }

  function attendanceMarked(rows, studentId, value, timeSlot, classGroup, kind) {
    const key = dateKey(value);
    return (Array.isArray(rows) ? rows : []).some((row) =>
      clean(row && row.student_id) === clean(studentId)
      && clean(row && row.session_date).slice(0, 10) === key
      && Number(row && row.time_slot) === Number(timeSlot)
      && clean(row && row.class_group || 'A') === clean(classGroup || 'A')
      && clean(row && row.session_kind) === clean(kind)
    );
  }

  async function resolveTarget(student, value, kind, students) {
    const key = dateKey(value);
    if (!student || !clean(student.id) || !key) throw new Error('학생과 출석 날짜를 확인해 주세요.');
    if (Array.isArray(students) && students.length) await bootstrapLegacy(students);
    let week = await loadWeek(key);
    const attendance = Array.isArray(week.attendance) ? week.attendance : [];
    const oneTime = (Array.isArray(week.one_time_sessions) ? week.one_time_sessions : []).find((row) =>
      clean(row && row.student_id) === clean(student.id)
      && clean(row && row.session_date).slice(0, 10) === key
      && clean(row && row.status) !== 'cancelled'
    );

    if (kind === 'regular') {
      const enrollment = chooseEnrollment(week.enrollments, student, key);
      if (!enrollment) throw new Error('해당 날짜의 정규 수업을 찾을 수 없습니다. 시간표를 확인해 주세요.');
      const timeSlot = Number(enrollment.time_slot);
      const classGroup = clean(enrollment.class_group) || 'A';
      return {
        kind: 'regular', timeSlot, classGroup,
        present: attendanceMarked(attendance, student.id, key, timeSlot, classGroup, 'regular')
      };
    }

    if (kind !== 'makeup') throw new Error('출석 수업 유형을 확인해 주세요.');
    if (oneTime) {
      const timeSlot = Number(oneTime.time_slot);
      const classGroup = clean(oneTime.class_group) || 'A';
      return {
        kind: 'makeup', timeSlot, classGroup,
        present: attendanceMarked(attendance, student.id, key, timeSlot, classGroup, 'makeup')
      };
    }

    const sameStudentEnrollments = (Array.isArray(week.enrollments) ? week.enrollments : [])
      .filter((row) => clean(row && row.student_id) === clean(student.id) && activeOnDate(row, key));
    let reference = sameStudentEnrollments[0] || null;
    if (!reference) {
      const fallback = legacyPairs(student)[0] || null;
      if (fallback) reference = { time_slot: fallback.time_slot, class_group: 'A' };
    }
    if (!reference) throw new Error('보강 수업 시간을 확인할 수 없습니다. 시간표에서 수업 시간을 먼저 등록해 주세요.');
    return {
      kind: 'makeup', timeSlot: Number(reference.time_slot), classGroup: clean(reference.class_group) || 'A',
      present: false, needsOneTime: true
    };
  }

  async function toggleAttendance(options) {
    const result = await execute('toggle_attendance', {
      student_id: options.studentId,
      session_date: dateKey(options.sessionDate),
      time_slot: Number(options.timeSlot),
      class_group: options.classGroup || 'A',
      session_kind: options.sessionKind || 'regular'
    });
    invalidateMonth(options.sessionDate);
    return result;
  }

  async function setAttendancePresent(options) {
    const student = options && options.student;
    const key = dateKey(options && options.sessionDate);
    const kind = clean(options && options.sessionKind) === 'makeup' ? 'makeup' : 'regular';
    const desired = !!(options && options.present);
    let target = await resolveTarget(student, key, kind, options && options.students);

    if (kind === 'makeup' && target.needsOneTime) {
      if (!desired) return { ok: true, attended: false, unchanged: true };
      await execute('add_one_time', {
        student_id: clean(student.id),
        session_date: key,
        time_slot: Number(target.timeSlot),
        class_group: target.classGroup || 'A',
        note: '폰 출석 체크에서 자동 등록'
      });
      target = await resolveTarget(student, key, kind, null);
    }

    if (!!target.present === desired) {
      return { ok: true, attended: desired, unchanged: true, target };
    }
    const result = await toggleAttendance({
      studentId: clean(student.id),
      sessionDate: key,
      timeSlot: target.timeSlot,
      classGroup: target.classGroup,
      sessionKind: kind
    });
    return Object.assign({}, result, { target });
  }

  function presentStatusMap(rows) {
    const map = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      if (!row || row.attended === false) return;
      const studentId = clean(row.student_id);
      const sessionDate = clean(row.session_date).slice(0, 10);
      const kind = clean(row.session_kind);
      if (!studentId || !sessionDate || (kind !== 'regular' && kind !== 'makeup')) return;
      const key = `${studentId}|${sessionDate}`;
      if (kind === 'makeup' || !map.has(key)) map.set(key, kind === 'makeup' ? 'makeup' : 'attended');
    });
    return map;
  }

  global.OlliAttendanceData = Object.freeze({
    currentAcademyId,
    currentSessionToken,
    getCachedMonth,
    invalidateMonth,
    loadMonth,
    legacyPairs,
    bootstrapLegacy,
    loadWeek,
    toggleAttendance,
    setAttendancePresent,
    presentStatusMap
  });
})(window);
