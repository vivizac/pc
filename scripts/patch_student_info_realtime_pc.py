from pathlib import Path

p = Path('pc-student-info-card-runtime.js')
s = p.read_text()

old = """  const cardState = {
    studentId: '',
    student: null,
    enrollments: [],
    loading: false,
    saveInFlight: false,
    observer: null,
    installed: false
  };"""
new = """  const cardState = {
    studentId: '',
    student: null,
    enrollments: [],
    pickups: [],
    loading: false,
    saveInFlight: false,
    dirty: false,
    observer: null,
    installed: false
  };"""
assert old in s
s = s.replace(old, new, 1)

old = """  async function loadAuthoritativeSchedule(studentId) {
    const result = await scheduleRpc('olli_schedule_student_enrollments', {
      p_student_id: studentId,
      p_reference_date: todayKey()
    });
    return Array.isArray(result.enrollments) ? result.enrollments : [];
  }"""
new = """  async function loadAuthoritativeStudentContext(studentId) {
    const result = await scheduleRpc('olli_schedule_student_enrollments', {
      p_student_id: studentId,
      p_reference_date: todayKey()
    });
    return {
      enrollments: Array.isArray(result.enrollments) ? result.enrollments : [],
      pickups: Array.isArray(result.pickups) ? result.pickups : []
    };
  }

  async function loadAuthoritativeSchedule(studentId) {
    return (await loadAuthoritativeStudentContext(studentId)).enrollments;
  }"""
assert old in s
s = s.replace(old, new, 1)

old = """  function resolveTimetableTeacherName(division, enrollments, assignments) {
    const first = primaryEnrollmentForTeacher(enrollments);
    if (!first) return '';
    const group = clean(first.class_group || 'A').toUpperCase() || 'A';"""
new = """  function resolveTimetableTeacherName(division, enrollments, assignments) {
    const first = primaryEnrollmentForTeacher(enrollments);
    if (!first) return '';
    const directTeacher = clean(first.teacher_name);
    if (directTeacher) return directTeacher;
    const group = clean(first.class_group || 'A').toUpperCase() || 'A';"""
assert old in s
s = s.replace(old, new, 1)

marker = "  function kinderCardHtml(student) {"
assert marker in s
helper = """  function pickupSummary(rows) {
    return (Array.isArray(rows) ? rows : []).map((row) => {
      const day = NUM_DAY[Number(row && row.weekday)] || '';
      const label = clean(row && row.pickup_label);
      const raw = clean(row && row.pickup_time);
      const match = raw.match(/^(\\d{1,2}):(\\d{2})/);
      let time = raw;
      if (match) {
        const hour24 = Number(match[1]);
        const hour12 = hour24 > 12 ? hour24 - 12 : hour24;
        time = `${hour12}:${match[2]}`;
      }
      const classTime = Number(row && row.class_time);
      return [day && `${day}요일`, classTime ? `${classTime}시` : '', label, time].filter(Boolean).join(' · ');
    }).filter(Boolean).join(' / ');
  }

"""
s = s.replace(marker, helper + marker, 1)

old = """        <div class=\"pcStudentInfoSchedule\"><div class=\"pcStudentInfoScheduleTitle\">요일 / 시간</div><div id=\"kinderLessonDayToggleRow\" class=\"infoDayToggleRow\"></div><div id=\"kinderLessonTimeToggleRow\" class=\"infoTimeToggleRow\"></div></div>
        <div class=\"pcStudentInfoActions\">"""
new = """        <div class=\"pcStudentInfoSchedule\"><div class=\"pcStudentInfoScheduleTitle\">요일 / 시간</div><div id=\"kinderLessonDayToggleRow\" class=\"infoDayToggleRow\"></div><div id=\"kinderLessonTimeToggleRow\" class=\"infoTimeToggleRow\"></div></div>
        <div class=\"pcStudentInfoField\"><div class=\"modalLabel\">픽업</div><div id=\"kinderInfoPickupReadonly\" class=\"pcStudentInfoTeacherReadonly isEmpty\">등록된 픽업 없음</div></div>
        <div class=\"pcStudentInfoActions\">"""
assert old in s
s = s.replace(old, new, 1)

old = "async function renderStudentInfoCard(student, enrollments, teacherAssignments) {"
assert old in s
s = s.replace(old, "async function renderStudentInfoCard(student, enrollments, teacherAssignments, pickups = []) {", 1)

old = """      __olli_timetable_teacher: timetableTeacher,
      __olli_authoritative_enrollments: enrollments
    });
    cardState.student = authoritativeStudent;
    cardState.enrollments = enrollments;"""
new = """      __olli_timetable_teacher: timetableTeacher,
      __olli_authoritative_enrollments: enrollments,
      __olli_authoritative_pickups: pickups
    });
    cardState.student = authoritativeStudent;
    cardState.enrollments = enrollments;
    cardState.pickups = pickups;"""
assert old in s
s = s.replace(old, new, 1)

old = """      if (hiddenDay) hiddenDay.value = fields.lesson_day;
      setDateInputs('kinderInfo', authoritativeStudent);
      if (typeof global.olliPrepareInfoExtra === 'function') global.olliPrepareInfoExtra('kinder', authoritativeStudent);
    }
  }"""
new = """      if (hiddenDay) hiddenDay.value = fields.lesson_day;
      setDateInputs('kinderInfo', authoritativeStudent);
      const pickupEl = document.getElementById('kinderInfoPickupReadonly');
      if (pickupEl) {
        const text = pickupSummary(pickups);
        pickupEl.textContent = text || '등록된 픽업 없음';
        pickupEl.classList.toggle('isEmpty', !text);
      }
      if (typeof global.olliPrepareInfoExtra === 'function') global.olliPrepareInfoExtra('kinder', authoritativeStudent);
    }
    cardState.dirty = false;
  }"""
assert old in s
s = s.replace(old, new, 1)

old = """    cardState.studentId = id;
    cardState.loading = true;
    panel.innerHTML = infoHeadHtml('info') + '<div class=\"pcStudentInfoLoading\">학생정보와 시간표를 불러오고 있습니다.</div>';
    try {
      const [enrollments, teacherAssignments] = await Promise.all([
        loadAuthoritativeSchedule(id),
        loadAuthoritativeTeacherAssignments()
      ]);
      student = typeof global.findStudentById === 'function' ? (global.findStudentById(id) || student) : student;
      if (cardState.studentId !== id) return;
      await renderStudentInfoCard(student, enrollments, teacherAssignments);"""
new = """    cardState.studentId = id;
    cardState.loading = true;
    cardState.dirty = false;
    panel.innerHTML = infoHeadHtml('info') + '<div class=\"pcStudentInfoLoading\">학생정보와 시간표를 불러오고 있습니다.</div>';
    try {
      if (typeof global.loadStudentsFromSupabase === 'function') {
        await global.loadStudentsFromSupabase({ skipLifecycleSync: true });
        student = typeof global.findStudentById === 'function' ? (global.findStudentById(id) || student) : student;
      }
      const context = await loadAuthoritativeStudentContext(id);
      let teacherAssignments = [];
      if (context.enrollments.length && !resolveTimetableTeacherName(student.type === 'kinder' ? 'kinder' : 'elementary', context.enrollments, [])) {
        teacherAssignments = await loadAuthoritativeTeacherAssignments();
      }
      student = typeof global.findStudentById === 'function' ? (global.findStudentById(id) || student) : student;
      if (cardState.studentId !== id) return;
      await renderStudentInfoCard(student, context.enrollments, teacherAssignments, context.pickups);"""
assert old in s
s = s.replace(old, new, 1)

old = """    cardState.enrollments = [];
    try { studentInfoModalTarget = null; } catch (_) {}"""
new = """    cardState.enrollments = [];
    cardState.pickups = [];
    cardState.dirty = false;
    try { studentInfoModalTarget = null; } catch (_) {}"""
assert old in s
s = s.replace(old, new, 1)

old = """      cardState.enrollments = [];
      try { studentInfoModalTarget = null; } catch (_) {}"""
new = """      cardState.enrollments = [];
      cardState.pickups = [];
      cardState.dirty = false;
      try { studentInfoModalTarget = null; } catch (_) {}"""
assert old in s
s = s.replace(old, new, 1)

s = s.replace("if (typeof global.loadStudentsFromSupabase === 'function') await global.loadStudentsFromSupabase();", "if (typeof global.loadStudentsFromSupabase === 'function') await global.loadStudentsFromSupabase({ skipLifecycleSync: true });", 2)

marker = "  async function openStudentInfoFromLegacyTarget(target) {"
assert marker in s
realtime = """  function isStudentInfoEditEvent(event) {
    const target = event && event.target;
    const card = target && target.closest ? target.closest('.pcStudentInfoCard') : null;
    if (!card || !cardState.studentId || cardState.loading || cardState.saveInFlight) return false;
    if (event.type === 'click') {
      return !!target.closest('.infoDayBtn, .infoTimeBtn, .infoToggleBtn, .groupIconChoiceBtn');
    }
    return event.type === 'input' || event.type === 'change';
  }

  function bindStudentInfoDirtyTracking() {
    if (global.__OLLI_PC_STUDENT_INFO_DIRTY_TRACKING_V1__) return;
    global.__OLLI_PC_STUDENT_INFO_DIRTY_TRACKING_V1__ = true;
    ['input', 'change', 'click'].forEach((type) => document.addEventListener(type, (event) => {
      if (isStudentInfoEditEvent(event)) cardState.dirty = true;
    }, true));
  }

  async function refreshOpenStudentInfoFromRealtime(realtimeContext) {
    const id = clean(cardState.studentId);
    if (!id) return true;
    if (cardState.loading || cardState.saveInFlight || cardState.dirty) return false;
    const academyId = currentAcademyId();
    const sessionToken = currentSessionToken();
    const isCurrent = () => clean(cardState.studentId) === id
      && academyId === currentAcademyId()
      && sessionToken === currentSessionToken()
      && (!realtimeContext || realtimeContext.isCurrent());
    try {
      if (typeof global.loadStudentsFromSupabase === 'function') {
        await global.loadStudentsFromSupabase({ skipLifecycleSync: true });
      }
      if (!isCurrent() || cardState.dirty || cardState.saveInFlight) return false;
      const latest = typeof global.findStudentById === 'function' ? global.findStudentById(id) : null;
      if (!latest) return true;
      const context = await loadAuthoritativeStudentContext(id);
      if (!isCurrent() || cardState.dirty || cardState.saveInFlight) return false;
      let teacherAssignments = [];
      const division = latest.type === 'kinder' ? 'kinder' : 'elementary';
      if (context.enrollments.length && !resolveTimetableTeacherName(division, context.enrollments, [])) {
        teacherAssignments = await loadAuthoritativeTeacherAssignments();
      }
      if (!isCurrent() || cardState.dirty || cardState.saveInFlight) return false;
      await renderStudentInfoCard(latest, context.enrollments, teacherAssignments, context.pickups);
      return true;
    } catch (error) {
      console.warn('학생정보 Realtime 최신본 확인 실패:', error && (error.message || error));
      return false;
    }
  }

  function installStudentInfoRealtimeWatcher() {
    if (global.__OLLI_PC_STUDENT_INFO_REALTIME_V1__) return true;
    if (typeof global.OlliRealtime?.watchDomain !== 'function') return false;
    global.__OLLI_PC_STUDENT_INFO_REALTIME_V1__ = true;
    global.OlliRealtime.watchDomain('schedule', (context) => refreshOpenStudentInfoFromRealtime(context));
    return true;
  }

"""
s = s.replace(marker, realtime + marker, 1)

old = """    installAuthoritativeScheduleEditor();
    wrapStudentRegistration();"""
new = """    installAuthoritativeScheduleEditor();
    bindStudentInfoDirtyTracking();
    if (!installStudentInfoRealtimeWatcher()) {
      global.addEventListener('olli:realtime-status', installStudentInfoRealtimeWatcher, { once: true });
      setTimeout(installStudentInfoRealtimeWatcher, 1000);
    }
    wrapStudentRegistration();"""
assert old in s
s = s.replace(old, new, 1)

p.write_text(s)
