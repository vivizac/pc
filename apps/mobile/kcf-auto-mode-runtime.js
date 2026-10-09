/* Phone-only KCF Teacher mode timetable picker and submitted record editing. */
(function initKcfTeacherMode(global) {
  'use strict';

  var state = global.__kcfTeacherModeState || global.__kcfAutoModeState || {
    enabled: false,
    manualEntry: false,
    loading: false,
    queue: [],
    index: -1,
    submitSerial: 0,
    lastStartOptions: null,
    pendingDocumentRow: null,
    pendingDocumentData: null,
    records: Object.create(null),
    discardedIds: new Set(),
    editing: null,
    completedIds: new Set(),
    selectedStudentId: '',
    drafts: Object.create(null),
    rosterStatus: 'loading',
    rosterDateKey: '',
    dateKey: ''
  };
  if (!(state.discardedIds instanceof Set)) state.discardedIds = new Set();
  if (!(state.completedIds instanceof Set)) state.completedIds = new Set();
  if (!state.drafts || typeof state.drafts !== 'object' || Array.isArray(state.drafts)) state.drafts = Object.create(null);
  if (!Array.isArray(state.queue)) state.queue = [];
  if (!['loading', 'ready', 'empty', 'error'].includes(state.rosterStatus)) state.rosterStatus = 'loading';
  state.rosterDateKey = clean(state.rosterDateKey);
  state.selectedStudentId = clean(state.selectedStudentId);
  state.manualEntry = state.manualEntry === true;
  global.__kcfTeacherModeState = state;
  global.__kcfAutoModeState = state; // legacy alias for older sessions
  var rosterLoadPromise = null;

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function studentDivision(student) {
    var raw = clean(student && (student.type || student.division)).toLowerCase();
    return raw === 'kinder' || raw === '유치부' ? 'kinder' : 'elementary';
  }

  function todayKey() {
    var now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  }

  function isoWeekday(value) {
    var key = clean(value || todayKey()).slice(0, 10);
    var parts = key.split('-').map(Number);
    if (parts.length !== 3 || parts.some(function(v) { return !Number.isFinite(v); })) return 0;
    var day = new Date(parts[0], parts[1] - 1, parts[2]).getDay();
    return day === 0 ? 7 : day;
  }

  function isActiveOnDate(row, key) {
    var from = clean(row && (row.effective_from || row.start_date || row.valid_from)).slice(0, 10);
    var to = clean(row && (row.effective_to || row.end_date || row.valid_to)).slice(0, 10);
    return (!from || from <= key) && (!to || to >= key);
  }

  function getAllActiveFeedbackStudents() {
    var students = [];
    try { students = typeof global.getAllStudents === 'function' ? global.getAllStudents() : []; } catch (_) {}
    return (Array.isArray(students) ? students : []).filter(function(student) {
      if (!student || !clean(student.id) || !clean(student.name)) return false;
      try {
        if (typeof global.getStudentStatus === 'function') return global.getStudentStatus(student) === 'active';
      } catch (_) {}
      var status = clean(student.status || 'active');
      return status !== 'inactive' && status !== 'withdrawn';
    });
  }

  function directTeacherName(source) {
    if (!source || typeof source !== 'object') return '';
    var candidates = [
      source.teacher_name,
      source.teacherName,
      source.teacher_display_name,
      source.teacherDisplayName,
      source.homeroom_teacher,
      source.homeroomTeacher,
      source.member_name,
      source.memberName,
      source.instructor_name,
      source.instructorName
    ];
    for (var i = 0; i < candidates.length; i += 1) {
      var name = clean(candidates[i]);
      if (name) return name;
    }
    return '';
  }

  function findTeacherNameById(week, id) {
    var target = clean(id);
    if (!target) return '';
    var pools = [week && week.teachers, week && week.members, week && week.teacher_options, week && week.teacherOptions];
    for (var p = 0; p < pools.length; p += 1) {
      var list = Array.isArray(pools[p]) ? pools[p] : [];
      for (var i = 0; i < list.length; i += 1) {
        var item = list[i] || {};
        var itemId = clean(item.id || item.teacher_id || item.member_id || item.user_id);
        if (itemId !== target) continue;
        var name = directTeacherName(item) || clean(item.display_name || item.name);
        if (name) return name;
      }
    }
    return '';
  }

  function assignmentMatchesRow(assignment, row) {
    if (!assignment || !row) return false;
    var division = clean(assignment.division || assignment.student_type || assignment.class_type);
    var rowDivision = clean(row.division || row.student_type || row.studentType);
    if (division && rowDivision && division !== rowDivision) return false;
    var weekday = Number(assignment.weekday || assignment.day_of_week || 0);
    var rowWeekday = Number(row.weekday || row.day_of_week || (row.session_date ? isoWeekday(row.session_date) : 0));
    if (weekday && weekday !== rowWeekday) return false;
    var timeSlot = Number(assignment.time_slot || assignment.class_time || 0);
    if (timeSlot && timeSlot !== Number(row.time_slot || row.class_time || 0)) return false;
    var aGroup = clean(assignment.class_group || assignment.group || 'A').toUpperCase() || 'A';
    var rGroup = clean(row.class_group || row.group || 'A').toUpperCase() || 'A';
    return aGroup === rGroup;
  }

  function resolveTeacherName(row, week, student) {
    var direct = directTeacherName(row);
    if (direct) return direct;

    var teacherId = clean(row && (row.teacher_id || row.teacher_member_id || row.member_id || row.instructor_id));
    var idName = findTeacherNameById(week, teacherId);
    if (idName) return idName;

    var assignmentPools = [
      week && week.teacher_assignments,
      week && week.teacherAssignments,
      week && week.class_assignments,
      week && week.classAssignments,
      week && week.schedule_assignments,
      week && week.scheduleAssignments,
      week && week.assignments
    ];
    for (var p = 0; p < assignmentPools.length; p += 1) {
      var assignments = Array.isArray(assignmentPools[p]) ? assignmentPools[p] : [];
      for (var i = 0; i < assignments.length; i += 1) {
        var assignment = assignments[i];
        if (!assignmentMatchesRow(assignment, row)) continue;
        var assignmentName = directTeacherName(assignment);
        if (assignmentName) return assignmentName;
        var assignmentId = clean(assignment && (assignment.teacher_id || assignment.teacher_member_id || assignment.member_id));
        var mappedName = findTeacherNameById(week, assignmentId);
        if (mappedName) return mappedName;
      }
    }

    var studentName = directTeacherName(student) || clean(student && student.__olli_timetable_teacher);
    if (studentName) return studentName;
    var group = clean(row && (row.class_group || row.group)).toUpperCase();
    return group ? group + '반' : '담임 미지정';
  }

  function resolveTeacherMemberId(row, week) {
    var directId = clean(row && (row.teacher_member_id || row.teacherMemberId || row.teacher_id || row.member_id || row.instructor_id));
    if (directId) return directId;

    var assignmentPools = [
      week && week.teacher_assignments,
      week && week.teacherAssignments,
      week && week.class_assignments,
      week && week.classAssignments,
      week && week.schedule_assignments,
      week && week.scheduleAssignments,
      week && week.assignments
    ];
    for (var p = 0; p < assignmentPools.length; p += 1) {
      var assignments = Array.isArray(assignmentPools[p]) ? assignmentPools[p] : [];
      for (var i = 0; i < assignments.length; i += 1) {
        var assignment = assignments[i];
        if (!assignmentMatchesRow(assignment, row)) continue;
        var assignmentId = clean(assignment && (assignment.teacher_member_id || assignment.teacherMemberId || assignment.teacher_id || assignment.member_id));
        if (assignmentId) return assignmentId;
      }
    }
    return '';
  }

  function classGroupKey(row) {
    return clean(row && (row.class_group || row.group || 'A')).toUpperCase() || 'A';
  }

  function rowWeekday(row) {
    return Number(row && (row.weekday || row.day_of_week || (row.session_date ? isoWeekday(row.session_date) : 0))) || 0;
  }

  function sameClassSession(a, b) {
    if (!a || !b) return false;
    return rowWeekday(a) === rowWeekday(b)
      && Number(a.time_slot || a.class_time || 0) === Number(b.time_slot || b.class_time || 0)
      && classGroupKey(a) === classGroupKey(b);
  }

  function teacherOverrideForRow(row, week, sessionDate) {
    var date = clean(sessionDate || (row && row.session_date) || todayKey()).slice(0, 10);
    var division = clean(row && (row.division || row.student_type || row.studentType || 'kinder')) || 'kinder';
    var timeSlot = Number(row && (row.time_slot || row.class_time || 0));
    var group = classGroupKey(row);
    var overrides = Array.isArray(week && week.teacher_overrides) ? week.teacher_overrides : [];
    return overrides.find(function(item) {
      return clean(item && item.session_date).slice(0, 10) === date
        && clean(item && item.division) === division
        && Number(item && item.time_slot) === timeSlot
        && classGroupKey(item) === group;
    }) || null;
  }

  function resolveEffectiveTeacher(row, week, student, sessionDate) {
    var dayOverride = teacherOverrideForRow(row, week, sessionDate);
    if (dayOverride) {
      return {
        name: clean(dayOverride.teacher_name) || resolveTeacherName(row, week, student),
        memberId: clean(dayOverride.teacher_member_id) || resolveTeacherMemberId(row, week),
        isOverride: true
      };
    }
    return {
      name: resolveTeacherName(row, week, student),
      memberId: resolveTeacherMemberId(row, week),
      isOverride: false
    };
  }

  function primaryFeedbackEnrollment(week, studentId, key) {
    var id = clean(studentId);
    if (!id) return null;
    var rows = (Array.isArray(week && week.enrollments) ? week.enrollments : []).filter(function(row) {
      return row && clean(row.student_id) === id && isActiveOnDate(row, key || todayKey());
    });
    rows.sort(function(a, b) {
      var ao = Number(a && a.session_order);
      var bo = Number(b && b.session_order);
      if (!Number.isFinite(ao) || ao <= 0) ao = 999;
      if (!Number.isFinite(bo) || bo <= 0) bo = 999;
      if (ao !== bo) return ao - bo;
      var ad = Number(a && a.weekday) || 999;
      var bd = Number(b && b.weekday) || 999;
      if (ad !== bd) return ad - bd;
      return (Number(a && a.time_slot) || 999) - (Number(b && b.time_slot) || 999);
    });
    return rows[0] || null;
  }

  function resolveFeedbackTeacher(student, todayRow, week, sourceKind) {
    var firstSession = primaryFeedbackEnrollment(week, student && student.id, todayKey()) || todayRow;
    var todayIsPrimaryRegular = sourceKind === 'regular' && sameClassSession(firstSession, todayRow);
    if (todayIsPrimaryRegular) return resolveEffectiveTeacher(firstSession, week, student, todayKey());
    return {
      name: resolveTeacherName(firstSession, week, student),
      memberId: resolveTeacherMemberId(firstSession, week),
      isOverride: false
    };
  }

  function scheduleStudentForRow(row, byId) {
    // Guest trials have a stable one-time session UUID, not a registered student UUID.
    // Keep their identity separate to avoid foreign-key and student-directory pollution.
    if (row && row.is_guest === true && clean(row.session_type) === 'trial') {
      var sessionId = clean(row.id);
      var guestName = clean(row.student_name);
      if (!sessionId || !guestName) return null;
      var division = clean(row.division) === 'kinder' ? 'kinder' : 'elementary';
      return {
        id: 'trial:' + sessionId, name:guestName, type:division, division:division,
        status:'trial', __olliTrialSessionId:sessionId
      };
    }
    var studentId = clean(row && row.student_id);
    if (!studentId) return null;
    var localStudent = byId && byId[studentId];
    if (localStudent) return localStudent;
    var serverName = clean(row && (row.student_name || row.studentName));
    var serverDivision = clean(row && (row.division || row.student_type || row.studentType));
    if (!serverName) return null;
    var normalizedDivision = serverDivision === 'kinder' ? 'kinder' : 'elementary';
    return {
      id: studentId,
      name: serverName,
      type: normalizedDivision,
      division: normalizedDivision,
      status: 'active',
      __olliScheduleFallback: true
    };
  }

  function makeQueueItem(student, row, week, sourceKind) {
    var effectiveRow = Object.assign({}, row || {});
    if (!clean(effectiveRow.division || effectiveRow.student_type || effectiveRow.studentType)) {
      effectiveRow.division = studentDivision(student);
    }
    var timeSlot = Number(effectiveRow.time_slot || effectiveRow.class_time) || 999;
    var classGroup = clean(effectiveRow.class_group || effectiveRow.group || 'A') || 'A';
    var classTeacher = resolveEffectiveTeacher(effectiveRow, week, student, todayKey());
    var classTeacherName = classTeacher.name;
    var classTeacherMemberId = classTeacher.memberId;
    var feedbackTeacher = resolveFeedbackTeacher(student, effectiveRow, week, sourceKind);
    return {
      student: student,
      studentId: clean(student.id),
      name: clean(student.name),
      studentDivision: studentDivision(student),
      timeSlot: timeSlot,
      classGroup: classGroup,
      classTeacherName: classTeacherName,
      classTeacherMemberId: classTeacherMemberId,
      feedbackTeacherName: feedbackTeacher.name,
      feedbackTeacherMemberId: feedbackTeacher.memberId,
      teacherName: feedbackTeacher.name,
      teacherMemberId: feedbackTeacher.memberId,
      sourceKind: sourceKind || 'regular',
      trialSessionId: clean(student.__olliTrialSessionId)
    };
  }

  function shouldReplaceQueueItem(current, next) {
    if (!current) return true;
    if (next.timeSlot !== current.timeSlot) return next.timeSlot < current.timeSlot;
    if (current.sourceKind !== 'regular' && next.sourceKind === 'regular') return true;
    return false;
  }

  function buildScheduleQueueFromWeek(week) {
    var key = todayKey();
    var weekday = isoWeekday(key);
    var students = getAllActiveFeedbackStudents();
    var byId = Object.create(null);
    students.forEach(function(student) { byId[clean(student.id)] = student; });
    var selectedByStudent = new Map();

    (Array.isArray(week && week.enrollments) ? week.enrollments : []).forEach(function(row) {
      if (!row || Number(row.weekday) !== weekday || !isActiveOnDate(row, key)) return;
      var student = scheduleStudentForRow(row, byId);
      if (!student) return;
      var next = makeQueueItem(student, row, week, 'regular');
      if (!queueItemMatchesCurrentMember(next)) return;
      var current = selectedByStudent.get(next.studentId);
      if (shouldReplaceQueueItem(current, next)) selectedByStudent.set(next.studentId, next);
    });

    (Array.isArray(week && week.one_time_sessions) ? week.one_time_sessions : []).forEach(function(row) {
      if (!row || clean(row.session_date).slice(0, 10) !== key) return;
      if (clean(row.status).toLowerCase() === 'cancelled') return;
      var student = scheduleStudentForRow(row, byId);
      if (!student) return;
      var next = makeQueueItem(student, row, week, clean(row.session_type) === 'trial' ? 'trial' : clean(row.session_kind || 'one_time'));
      if (!queueItemMatchesCurrentMember(next)) return;
      var current = selectedByStudent.get(next.studentId);
      if (shouldReplaceQueueItem(current, next)) selectedByStudent.set(next.studentId, next);
    });

    var queue = Array.from(selectedByStudent.values());
    queue.sort(function(a, b) {
      var teacherResult = clean(a.feedbackTeacherName || a.teacherName).localeCompare(clean(b.feedbackTeacherName || b.teacherName), 'ko');
      if (teacherResult !== 0) return teacherResult;
      if (a.timeSlot !== b.timeSlot) return a.timeSlot - b.timeSlot;
      var groupResult = a.classGroup.localeCompare(b.classGroup, 'ko');
      if (groupResult !== 0) return groupResult;
      return a.name.localeCompare(b.name, 'ko');
    });
    return queue;
  }

  async function buildScheduleQueueFallback() {
    var students = getAllActiveFeedbackStudents();
    try {
      if (typeof global.syncOlliTodayAttendanceSchedule === 'function') {
        await global.syncOlliTodayAttendanceSchedule(new Date(), { render: false });
      }
    } catch (_) {}
    if (typeof global.getOlliTodayAttendanceSections !== 'function') return [];
    var sections = global.getOlliTodayAttendanceSections(students) || {};
    var combined = [];
    (Array.isArray(sections.regular) ? sections.regular : []).forEach(function(student) {
      combined.push({ student: student, sourceKind: 'regular' });
    });
    (Array.isArray(sections.makeup) ? sections.makeup : []).forEach(function(student) {
      combined.push({ student: student, sourceKind: 'makeup' });
    });
    var seen = new Set();
    var queue = [];
    combined.forEach(function(entry) {
      var student = entry.student;
      var id = clean(student && student.id);
      if (!id || seen.has(id)) return;
      seen.add(id);
      var scheduleEntry = typeof global.getOlliTodayScheduleEntry === 'function' ? (global.getOlliTodayScheduleEntry(id) || {}) : {};
      var row = entry.sourceKind === 'makeup' ? scheduleEntry.makeup : scheduleEntry.regular;
      row = row || {
        time_slot: Number(student && student.__olliAttendanceRegularTimeSlot) || 999,
        class_group: clean(student && student.__olliAttendanceRegularClassGroup) || 'A'
      };
      queue.push(makeQueueItem(student, row, {}, entry.sourceKind));
    });
    return queue.filter(queueItemMatchesCurrentMember);
  }

  async function loadScheduleTeacherContext(data) {
    if (!data || typeof global.supabase !== 'function') return null;
    var academyId = clean(typeof data.currentAcademyId === 'function' ? data.currentAcademyId() : '');
    var sessionToken = clean(typeof data.currentSessionToken === 'function' ? data.currentSessionToken() : '');
    if (!academyId || !sessionToken) return null;
    try {
      var raw = await global.supabase('POST', 'rpc/olli_schedule_class_teacher_context', {
        p_session_token: sessionToken,
        p_academy_id: academyId
      });
      var context = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
      return context && context.ok !== false ? context : null;
    } catch (err) {
      console.warn('1분 피드백 AUTO 담임 정보 불러오기 실패:', err && (err.message || err));
      return null;
    }
  }

  async function loadTodayTeacherOverrides(data) {
    if (!data || typeof global.supabase !== 'function') return [];
    var academyId = clean(typeof data.currentAcademyId === 'function' ? data.currentAcademyId() : '');
    var sessionToken = clean(typeof data.currentSessionToken === 'function' ? data.currentSessionToken() : '');
    if (!academyId || !sessionToken) return [];
    var key = todayKey();
    try {
      var raw = await global.supabase('POST', 'rpc/olli_schedule_teacher_overrides_range', {
        p_session_token: sessionToken,
        p_academy_id: academyId,
        p_start_date: key,
        p_end_date: key
      });
      var context = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
      return context && context.ok !== false && Array.isArray(context.overrides) ? context.overrides : [];
    } catch (err) {
      console.warn('1분 피드백 Teacher 당일 담당 조회 실패:', err && (err.message || err));
      return [];
    }
  }

  function mergeTeacherContextIntoWeek(week, context, overrides) {
    var next = Object.assign({}, week || {});
    if (context) {
      next.teachers = Array.isArray(context.teachers) ? context.teachers : [];
      next.teacher_assignments = Array.isArray(context.assignments) ? context.assignments : [];
    }
    next.teacher_overrides = Array.isArray(overrides) ? overrides : (Array.isArray(next.teacher_overrides) ? next.teacher_overrides : []);
    return next;
  }

  async function loadTodayScheduleQueue() {
    var data = global.OlliAttendanceData;
    if (data && typeof data.loadWeek === 'function') {
      try {
        var results = await Promise.all([
          data.loadWeek(new Date()),
          loadScheduleTeacherContext(data),
          loadTodayTeacherOverrides(data)
        ]);
        var week = mergeTeacherContextIntoWeek(results[0] || {}, results[1], results[2]);
        return buildScheduleQueueFromWeek(week);
      } catch (err) {
        console.warn('1분 피드백 AUTO 오늘 시간표 불러오기 실패:', err && (err.message || err));
      }
    }
    return buildScheduleQueueFallback();
  }

  function teacherRosterScopeKey() {
    return 'all';
  }

  function applyTodayScheduleQueue(queue) {
    state.queue = Array.isArray(queue) ? queue : [];
    var today = todayKey();
    state.rosterDivision = teacherRosterScopeKey();
    if (state.dateKey !== today) {
      state.completedIds.clear();
      state.dateKey = today;
    }
    var validIds = new Set(state.queue.map(function(item) { return item.studentId; }));
    Array.from(state.completedIds).forEach(function(studentId) {
      if (!validIds.has(studentId)) state.completedIds.delete(studentId);
    });
    loadAutoDrafts();
    state.rosterDateKey = today;
    state.rosterStatus = state.queue.length ? 'ready' : 'empty';

    if (state.enabled) {
      var selectedId = clean(state.selectedStudentId || global.__kcfSelectedStudentId);
      if (selectedId && !validIds.has(selectedId)) {
        state.selectedStudentId = '';
        global.__kcfSelectedStudentId = '';
      }
      renderAutoRoster();
      if (!state.manualEntry && !clean(state.selectedStudentId || global.__kcfSelectedStudentId)) {
        selectFirstAvailableAutoStudent();
      }
      if (global.KcfTeacherSheet && typeof global.KcfTeacherSheet.syncFromBase === 'function') {
        global.KcfTeacherSheet.syncFromBase();
      }
    }
    return state.queue;
  }

  function preloadTodayScheduleQueue(options) {
    var opts = options || {};
    var today = todayKey();
    var division = teacherRosterScopeKey();
    var cacheCurrent = state.rosterDateKey === today && clean(state.rosterDivision) === division;
    if (!opts.force && cacheCurrent && (state.rosterStatus === 'ready' || state.rosterStatus === 'empty')) {
      return Promise.resolve(state.queue);
    }
    if (rosterLoadPromise) return rosterLoadPromise;

    state.rosterStatus = 'loading';
    if (state.enabled) renderAutoRoster();
    rosterLoadPromise = Promise.resolve()
      .then(loadTodayScheduleQueue)
      .then(function(queue) {
        return applyTodayScheduleQueue(queue);
      })
      .catch(function(err) {
        state.rosterStatus = 'error';
        state.rosterDateKey = today;
        if (state.enabled) renderAutoRoster();
        console.warn('1분 피드백 Teacher 학생 미리 불러오기 실패:', err && (err.message || err));
        return null;
      })
      .finally(function() {
        rosterLoadPromise = null;
      });
    return rosterLoadPromise;
  }

  function showTeacherRosterEmptyNotice() {
    if (typeof global.showPushToast === 'function') {
      global.showPushToast('오늘 피드백할 학생이 없습니다.');
    }
  }

  function showTeacherRosterErrorNotice() {
    if (typeof global.showPushToast === 'function') {
      global.showPushToast('오늘 피드백 학생을 불러오지 못했어요.');
    }
  }

  function getAutoRoster() {
    return document.getElementById('kcfAutoStudentRoster');
  }

  function ensureAutoRoster() {
    var existing = getAutoRoster();
    if (existing) return existing;
    var wrap = document.querySelector('#kinderChatFeedbackScreen .kcfComposerWrap');
    var composer = wrap && wrap.querySelector('.kcfComposer');
    if (!composer) return null;
    // The floating feedback toggle owns a shell around the composer.
    // insertBefore needs a direct child of wrap, not the nested composer.
    var composerAnchor = composer.closest('.kcfComposerShell') || composer;
    if (composerAnchor.parentNode !== wrap) return null;
    var roster = document.createElement('div');
    roster.id = 'kcfAutoStudentRoster';
    roster.className = 'kcfAutoStudentRoster';
    roster.setAttribute('aria-label', '오늘 수업 학생 선택');
    var scroller = document.createElement('div');
    scroller.className = 'kcfAutoStudentRosterScroller';
    roster.appendChild(scroller);
    wrap.insertBefore(roster, composerAnchor);
    return roster;
  }

  function currentMemberId() {
    try {
      var current = global.OlliStorageCore && global.OlliStorageCore.AcademyContext && typeof global.OlliStorageCore.AcademyContext.getCurrent === 'function'
        ? global.OlliStorageCore.AcademyContext.getCurrent()
        : null;
      var memberId = clean(current && (current.memberId || current.member_id));
      if (memberId) return memberId;
    } catch (_) {}
    try { return clean(localStorage.getItem('olli_current_member_id')); } catch (_) { return ''; }
  }

  function queueItemMatchesCurrentMember(item) {
    var activeMemberId = currentMemberId();
    var feedbackTeacherMemberId = clean(item && (item.feedbackTeacherMemberId || item.teacherMemberId));
    if (activeMemberId && feedbackTeacherMemberId) return activeMemberId === feedbackTeacherMemberId;

    var activeMemberName = currentMemberName();
    var feedbackTeacherName = clean(item && (item.feedbackTeacherName || item.teacherName));
    return !!activeMemberName && !!feedbackTeacherName && activeMemberName === feedbackTeacherName;
  }

  function currentMemberName() {
    try {
      var current = global.OlliStorageCore && global.OlliStorageCore.AcademyContext && typeof global.OlliStorageCore.AcademyContext.getCurrent === 'function'
        ? global.OlliStorageCore.AcademyContext.getCurrent()
        : null;
      var name = clean(current && current.memberName);
      if (name) return name;
    } catch (_) {}
    try { return clean(localStorage.getItem('olli_current_member_name')); } catch (_) { return ''; }
  }

  function autoDraftStorageKey() {
    var current = null;
    try {
      current = global.OlliStorageCore && global.OlliStorageCore.AcademyContext && typeof global.OlliStorageCore.AcademyContext.getCurrent === 'function'
        ? global.OlliStorageCore.AcademyContext.getCurrent()
        : null;
    } catch (_) {}
    var academyId = clean(current && (current.academyId || current.academy_id));
    var memberId = clean(current && (current.memberId || current.member_id || current.userId || current.user_id));
    if (!academyId) {
      try { academyId = clean(localStorage.getItem('olli_current_academy_id')); } catch (_) {}
    }
    if (!memberId) memberId = currentMemberName() || 'member';
    return 'olli_kcf_auto_student_drafts_v1_' + encodeURIComponent(academyId || 'unscoped') + '_' + encodeURIComponent(memberId) + '_' + todayKey();
  }

  function loadAutoDrafts() {
    state.drafts = Object.create(null);
    try {
      var raw = localStorage.getItem(autoDraftStorageKey());
      var parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        Object.keys(parsed).forEach(function(studentId) {
          var value = String(parsed[studentId] == null ? '' : parsed[studentId]);
          if (value.trim()) state.drafts[studentId] = value;
        });
      }
    } catch (_) {}
  }

  function persistAutoDrafts() {
    try {
      var keys = Object.keys(state.drafts || {}).filter(function(studentId) {
        return String(state.drafts[studentId] == null ? '' : state.drafts[studentId]).trim();
      });
      if (!keys.length) {
        localStorage.removeItem(autoDraftStorageKey());
        return;
      }
      var payload = Object.create(null);
      keys.forEach(function(studentId) { payload[studentId] = String(state.drafts[studentId]); });
      localStorage.setItem(autoDraftStorageKey(), JSON.stringify(payload));
    } catch (_) {}
  }

  function saveCurrentAutoDraft() {
    if (!state.enabled || state.editing) return;
    var studentId = clean(state.selectedStudentId || global.__kcfSelectedStudentId);
    var input = document.getElementById('kcfInput');
    if (!studentId || !input) return;
    var value = String(input.value || '');
    if (value.trim()) state.drafts[studentId] = value;
    else delete state.drafts[studentId];
    persistAutoDrafts();
  }

  function readAutoDraft(studentId) {
    return String((state.drafts || {})[clean(studentId)] || '');
  }

  function clearAutoDraft(studentId) {
    var id = clean(studentId);
    if (!id) return;
    delete state.drafts[id];
    persistAutoDrafts();
  }

  function findAutoItem(studentId) {
    var id = clean(studentId);
    return state.queue.find(function(item) { return item.studentId === id; }) || null;
  }

  function selectFirstAvailableAutoStudent() {
    if (!state.enabled || state.editing) return;
    var roster = getAutoRoster();
    var firstChip = roster ? roster.querySelector('.kcfAutoStudentChip') : null;
    var item = firstChip ? findAutoItem(firstChip.dataset.studentId) : null;
    if (item) selectAutoStudent(item);
    else {
      state.selectedStudentId = '';
      global.__kcfSelectedStudentId = '';
      var input = document.getElementById('kcfInput');
      if (input) {
        input.value = '';
        if (typeof global.autoResizeKinderChatFeedbackInput === 'function') global.autoResizeKinderChatFeedbackInput(input);
      }
      if (global.KcfTeacherSheet && typeof global.KcfTeacherSheet.syncFromBase === 'function') {
        global.KcfTeacherSheet.syncFromBase();
      }
    }
  }

  function getAutoRenderedStudentIds() {
    var roster = getAutoRoster();
    if (!roster) return [];
    return Array.from(roster.querySelectorAll('.kcfAutoStudentChip'))
      .map(function(button) { return clean(button.dataset.studentId); })
      .filter(Boolean);
  }

  function selectNextAvailableAutoStudent(afterStudentId, orderedIds) {
    if (!state.enabled || state.editing) return;
    var order = Array.isArray(orderedIds) && orderedIds.length ? orderedIds.slice() : getAutoRenderedStudentIds();
    var afterId = clean(afterStudentId);
    var start = order.indexOf(afterId);
    var candidates = start >= 0 ? order.slice(start + 1).concat(order.slice(0, start)) : order;
    var nextId = candidates.find(function(studentId) {
      return !state.completedIds.has(studentId) && !!findAutoItem(studentId);
    });
    var item = nextId ? findAutoItem(nextId) : null;
    if (item) {
      selectAutoStudent(item);
      return;
    }
    selectFirstAvailableAutoStudent();
  }

  function deselectAutoStudent() {
    if (state.editing) return;
    saveCurrentAutoDraft();
    state.manualEntry = true;
    state.selectedStudentId = '';
    global.__kcfSelectedStudentId = '';
    var input = document.getElementById('kcfInput');
    if (input) {
      input.value = '';
      input.placeholder = '수업 기록을 적어주세요';
    }
    renderAutoRoster();
    if (global.KcfTeacherSheet && typeof global.KcfTeacherSheet.syncFromBase === 'function') {
      global.KcfTeacherSheet.syncFromBase({ focus:true });
    }
  }

  function selectAutoStudent(item) {
    if (!item || state.editing) return;
    var input = document.getElementById('kcfInput');
    if (!input) return;
    var keepInputFocus = document.activeElement === input;
    var nextId = clean(item.studentId);
    var currentId = clean(state.selectedStudentId || global.__kcfSelectedStudentId);
    if (nextId === currentId) { deselectAutoStudent(); return; }
    if (currentId) saveCurrentAutoDraft();
    state.manualEntry = false;
    state.selectedStudentId = nextId;
    global.__kcfSelectedStudentId = nextId;
    input.value = readAutoDraft(nextId);
    input.placeholder = '수업 기록을 적어주세요';
    if (typeof global.clearKinderChatFeedbackPhoto === 'function') global.clearKinderChatFeedbackPhoto();
    if (typeof global.clearKinderChatFeedbackKeyword === 'function') global.clearKinderChatFeedbackKeyword();
    if (typeof global.setKinderChatFeedbackWarning === 'function') global.setKinderChatFeedbackWarning('');
    renderAutoRoster();
    if (global.KcfTeacherSheet && typeof global.KcfTeacherSheet.syncFromBase === 'function') {
      global.KcfTeacherSheet.syncFromBase();
    }
    if (keepInputFocus) focusInputAtEnd(input);
    else if (typeof global.autoResizeKinderChatFeedbackInput === 'function') global.autoResizeKinderChatFeedbackInput(input);
  }

  function renderAutoRoster() {
    var roster = ensureAutoRoster();
    if (!roster) return;
    var scroller = roster.querySelector('.kcfAutoStudentRosterScroller');
    if (!scroller) return;
    scroller.innerHTML = '';
    var hasAssignedStudents = state.queue.length > 0;
    // Only the confirmed empty schedule receives the guide. Loading, errors, and
    // an already-completed class must never be reported as "no students".
    var sheetRoster = document.getElementById('kcfTeacherSheetRosterHost');
    if (sheetRoster) sheetRoster.hidden = !state.enabled || !hasAssignedStudents;
    roster.hidden = !state.enabled || !hasAssignedStudents;

    var remaining = state.queue
      .filter(function(item) { return !state.completedIds.has(item.studentId); })
      .slice()
      .sort(function(a, b) {
        if (a.timeSlot !== b.timeSlot) return a.timeSlot - b.timeSlot;
        return clean(a.name).localeCompare(clean(b.name), 'ko');
      });

    if (!remaining.length) {
      if (!hasAssignedStudents) return;
      var empty = document.createElement('span');
      empty.className = 'kcfAutoStudentRosterEmpty';
      empty.textContent = '오늘 학생 선택 완료';
      scroller.appendChild(empty);
      return;
    }

    remaining.forEach(function(item) {
      var button = document.createElement('span');
      button.setAttribute('role', 'button');
      var isSelected = item.studentId === clean(state.selectedStudentId || global.__kcfSelectedStudentId);
      button.className = 'kcfAutoStudentChip' + (isSelected ? ' selected' : '');
      button.textContent = item.name + (item.trialSessionId ? ' · 체험' : '');
      button.dataset.studentId = item.studentId;
      button.setAttribute('aria-label', item.name + ' 선택');
      button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
      button.addEventListener('click', function(event) {
        event.preventDefault();
        event.stopPropagation();
        selectAutoStudent(item);
      });
      scroller.appendChild(button);
    });
  }

  function syncAutoButton() {
    var screen = document.getElementById('kinderChatFeedbackScreen');
    var roster = ensureAutoRoster();
    if (screen) {
      screen.classList.toggle('kcfTeacherRosterMode', state.enabled);
      screen.classList.toggle('kcfAutoRosterMode', state.enabled); // legacy CSS compatibility
    }
    if (roster) roster.hidden = !state.enabled || !state.queue.length;
    var input = document.getElementById('kcfInput');
    if (input && !state.editing) {
      input.placeholder = state.manualEntry ? '수업 기록을 적어주세요' : '수업 기록을 적어주세요';
    }
    if (state.enabled) renderAutoRoster();
  }

  function focusInputAtEnd(input) {
    if (!input) return;
    try { input.focus({ preventScroll: true }); } catch (_) { input.focus(); }
    var end = String(input.value || '').length;
    try { input.setSelectionRange(end, end); } catch (_) {}
    if (typeof global.autoResizeKinderChatFeedbackInput === 'function') global.autoResizeKinderChatFeedbackInput(input);
    if (typeof global.updateKinderChatFeedbackKeyboardOffset === 'function') global.updateKinderChatFeedbackKeyboardOffset();
  }

  function activateTeacherRoster(teacherPrefill, event) {
    if (state.editing) return false;
    if (typeof global.clearKinderChatFeedbackManualSelection === 'function') {
      global.clearKinderChatFeedbackManualSelection();
    }

    state.enabled = true;
    state.manualEntry = false;
    state.selectedStudentId = '';
    global.__kcfSelectedStudentId = '';
    syncAutoButton();
    // Focus immediately in the initiating touch gesture; load schedule asynchronously.
    if (global.KcfTeacherSheet && typeof global.KcfTeacherSheet.open === 'function') {
      global.KcfTeacherSheet.open(event);
    }
    renderAutoRoster();
    if (state.rosterStatus === 'ready' && state.queue.length) {
      selectFirstAvailableAutoStudent();
    } else {
      state.manualEntry = true;
      var inlineInput = document.getElementById('kcfInput');
      if (inlineInput) inlineInput.placeholder = '수업 기록을 적어주세요';
      preloadTodayScheduleQueue({ force:state.rosterStatus === 'error' });
    }

    var input = document.getElementById('kcfInput');
    if (input && teacherPrefill.trim()) {
      input.value = teacherPrefill;
      var selectedId = clean(state.selectedStudentId || global.__kcfSelectedStudentId);
      if (selectedId) {
        state.drafts[selectedId] = teacherPrefill;
        persistAutoDrafts();
      }
    }
    if (global.KcfTeacherSheet && typeof global.KcfTeacherSheet.syncFromBase === 'function') {
      global.KcfTeacherSheet.syncFromBase({ focus:true });
    }
    return true;
  }

  function filterFeedbackItems(list) {
    return Array.isArray(list)
      ? list.filter(function(item) { return !item || !state.discardedIds.has(clean(item.id)); })
      : list;
  }

  function shouldDiscardFeedbackJob(jobId) {
    return state.discardedIds.has(clean(jobId));
  }

  function discardFeedbackJob(jobId) {
    var id = clean(jobId);
    if (!id) return false;
    state.discardedIds.add(id);

    try {
      var liveItem = typeof global.getKinderChatFeedbackLiveItem === 'function'
        ? global.getKinderChatFeedbackLiveItem(id)
        : null;
      if (liveItem) {
        liveItem.status = 'discarded';
        liveItem.updatedAt = new Date().toISOString();
      }
    } catch (_) {}

    try {
      var escapedId = global.CSS && typeof global.CSS.escape === 'function' ? global.CSS.escape(id) : id.replace(/(["\\])/g, '\\$1');
      var liveRow = document.querySelector('[data-kcf-live-feedback-id="' + escapedId + '"]');
      if (liveRow) liveRow.remove();
    } catch (_) {}

    try {
      if (typeof global.persistKinderChatFeedbackLiveSessionNow === 'function') {
        global.persistKinderChatFeedbackLiveSessionNow();
      }
    } catch (_) {}
    try {
      if (typeof global.renderKinderChatFeedbackInbox === 'function') global.renderKinderChatFeedbackInbox();
      if (typeof global.updateKinderChatFeedbackBadge === 'function') global.updateKinderChatFeedbackBadge();
    } catch (_) {}
    return true;
  }

  function findRecordForRow(row) {
    if (!row) return null;
    var ids = Object.keys(state.records || {});
    for (var i = 0; i < ids.length; i += 1) {
      var record = state.records[ids[i]];
      if (record && record.row === row) return record;
    }
    return null;
  }

  function onDocumentMessageAdded(row, data) {
    if (!row) return;
    row.classList.add('kcfEditableRecordRow');
    var editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'kcfRecordEditBtn';
    editBtn.textContent = '수정하기';
    editBtn.setAttribute('aria-label', clean(data && data.studentName || '학생') + ' 수업기록 수정하기');
    editBtn.addEventListener('click', function(event) {
      event.preventDefault();
      event.stopPropagation();
      var jobId = clean(row.dataset.kcfJobId);
      if (!jobId) {
        var record = findRecordForRow(row);
        jobId = clean(record && record.jobId);
      }
      if (jobId) global.editKinderChatSubmittedRecord(jobId);
    });
    row.appendChild(editBtn);
    state.pendingDocumentRow = row;
    state.pendingDocumentData = {
      studentName: clean(data && data.studentName),
      body: clean(data && data.body),
      subtitle: clean(data && data.subtitle),
      photoMeta: data && data.photoMeta || null
    };
  }

  function onFeedbackRequestStarted(options, result) {
    var opts = options || {};
    if (opts.sourcePage !== 'kinderChatFeedback' || clean(opts.feedbackType || 'class') !== 'class') return;
    state.submitSerial += 1;
    state.lastStartOptions = Object.assign({}, opts, {
      attachments: Array.isArray(opts.attachments) ? opts.attachments.slice() : []
    });
    if (!state.pendingDocumentRow) return;
    var jobId = clean(opts.id) || clean(result && result.id);
    if (jobId) {
      state.pendingDocumentRow.dataset.kcfJobId = jobId;
      state.records[jobId] = {
        jobId: jobId,
        row: state.pendingDocumentRow,
        studentName: clean(opts.studentName || (state.pendingDocumentData && state.pendingDocumentData.studentName)),
        studentId: clean(opts.studentId),
        studentDivision: clean(opts.studentDivision) || 'elementary',
        body: clean(opts.userText || (state.pendingDocumentData && state.pendingDocumentData.body)),
        options: Object.assign({}, opts, {
          id: jobId,
          attachments: Array.isArray(opts.attachments) ? opts.attachments.slice() : []
        })
      };
    }
    state.pendingDocumentRow = null;
    state.pendingDocumentData = null;
  }

  function setEditUi(active) {
    var screen = document.getElementById('kinderChatFeedbackScreen');
    var sendBtn = document.getElementById('kcfSendBtn');
    var autoBtn = document.getElementById('kcfModeSwitchBtn');
    if (screen) screen.classList.toggle('kcfRecordEditMode', !!active);
    if (sendBtn) {
      sendBtn.classList.toggle('kcfRecordEditSaveMode', !!active);
      if (active) {
        sendBtn.dataset.kcfOriginalHtml = sendBtn.innerHTML;
        sendBtn.innerHTML = '<span>저장</span>';
        sendBtn.setAttribute('aria-label', '수정한 수업기록 저장');
        sendBtn.title = '수정 저장';
      } else {
        if (sendBtn.dataset.kcfOriginalHtml) sendBtn.innerHTML = sendBtn.dataset.kcfOriginalHtml;
        delete sendBtn.dataset.kcfOriginalHtml;
        sendBtn.setAttribute('aria-label', '피드백 전송');
        sendBtn.removeAttribute('title');
      }
    }
    if (autoBtn) autoBtn.disabled = !!active;
  }

  function ensureLiveRecordEditButton(row) {
    if (!row || !row.classList || !row.classList.contains('user')) return;
    var jobId = clean(row.dataset && row.dataset.kcfLiveUserFor);
    if (!jobId) return;
    if (row.querySelector(':scope > .kcfRecordEditBtn')) return;

    row.classList.add('kcfEditableRecordRow');
    var editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'kcfRecordEditBtn';
    editBtn.textContent = '수정하기';
    editBtn.setAttribute('aria-label', '수업기록 수정하기');
    editBtn.addEventListener('click', function(event) {
      event.preventDefault();
      event.stopPropagation();
      var currentJobId = clean(row.dataset && row.dataset.kcfLiveUserFor);
      if (currentJobId) global.editKinderChatLiveRecord(currentJobId, row);
    });
    row.appendChild(editBtn);
  }

  function bindLiveRecordEditButtons() {
    var area = document.getElementById('kcfChatArea');
    if (!area) return;
    area.querySelectorAll('.kcfMsgRow.user[data-kcf-live-user-for]').forEach(ensureLiveRecordEditButton);
    if (area.__kcfLiveEditObserver) return;

    var observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        if (mutation.type === 'attributes') {
          ensureLiveRecordEditButton(mutation.target);
          return;
        }
        Array.from(mutation.addedNodes || []).forEach(function(node) {
          if (!node || node.nodeType !== 1) return;
          ensureLiveRecordEditButton(node);
          if (node.querySelectorAll) node.querySelectorAll('.kcfMsgRow.user[data-kcf-live-user-for]').forEach(ensureLiveRecordEditButton);
        });
      });
    });
    observer.observe(area, { childList:true, subtree:true, attributes:true, attributeFilter:['data-kcf-live-user-for'] });
    area.__kcfLiveEditObserver = observer;
  }

  global.editKinderChatLiveRecord = function(jobId, row) {
    var id = clean(jobId);
    if (!id || state.editing) return;
    var input = document.getElementById('kcfInput');
    if (!input) return;

    var liveItem = null;
    try {
      liveItem = typeof global.getKinderChatFeedbackLiveItem === 'function'
        ? global.getKinderChatFeedbackLiveItem(id)
        : null;
    } catch (_) {}
    var bubble = row && row.querySelector ? row.querySelector('.kcfBubble') : null;
    var body = clean(liveItem && liveItem.sourceText) || clean(bubble && bubble.textContent);
    if (!body) return;

    var record = {
      jobId: id,
      row: row || null,
      studentName: clean(liveItem && liveItem.studentName),
      studentId: clean(liveItem && liveItem.studentId),
      studentDivision: clean(liveItem && liveItem.studentDivision) || 'elementary',
      body: body,
      live: true,
      options: {
        id: id,
        promptType: 'class',
        userText: body,
        requestContent: body,
        studentName: clean(liveItem && liveItem.studentName),
        studentDivision: clean(liveItem && liveItem.studentDivision) || 'elementary',
        studentId: clean(liveItem && liveItem.studentId),
        feedbackType: clean(liveItem && liveItem.feedbackType) || 'class',
        label: clean(liveItem && liveItem.label) || '피드백',
        sourcePage: 'kinderChatFeedback',
        attachments: Array.isArray(liveItem && liveItem.attachments) ? liveItem.attachments.slice() : [],
        feedbackMonth: clean(liveItem && liveItem.feedbackMonth),
        feedbackMonthNumber: Number(liveItem && liveItem.feedbackMonthNumber) || 0,
        silent: true
      }
    };

    state.editing = {
      mode: 'live',
      record: record,
      resumeValue: input.value || '',
      resumeSelectedStudentId: clean(global.__kcfSelectedStudentId)
    };
    discardFeedbackJob(id);
    setEditUi(true);
    global.__kcfSelectedStudentId = record.studentId;
    input.value = body;
    if (typeof global.setKinderChatFeedbackWarning === 'function') {
      global.setKinderChatFeedbackWarning('수업기록 수정 중 · 저장하면 수정된 내용으로 다시 피드백을 생성합니다.');
    }
    focusInputAtEnd(input);
  };

  global.editKinderChatSubmittedRecord = function(jobId) {
    var id = clean(jobId);
    var record = state.records[id];
    if (!record || state.editing) return;
    var input = document.getElementById('kcfInput');
    if (!input) return;

    state.editing = {
      mode: 'archive',
      record: record,
      resumeValue: input.value || '',
      resumeSelectedStudentId: clean(global.__kcfSelectedStudentId)
    };
    discardFeedbackJob(id);
    setEditUi(true);
    global.__kcfSelectedStudentId = record.studentId;
    input.value = record.body;
    if (typeof global.setKinderChatFeedbackWarning === 'function') {
      global.setKinderChatFeedbackWarning('수업기록 수정 중 · 저장하면 수정된 내용으로 다시 피드백을 생성합니다.');
    }
    focusInputAtEnd(input);
  };

  async function saveSubmittedRecordEdit() {
    var editing = state.editing;
    var input = document.getElementById('kcfInput');
    if (!editing || !editing.record || !input) return;
    var record = editing.record;
    var body = String(input.value || '').trim();
    if (!body) {
      if (typeof global.setKinderChatFeedbackWarning === 'function') global.setKinderChatFeedbackWarning('수정할 수업기록 내용을 입력해 주세요.');
      return;
    }

    var isLiveEdit = editing.mode === 'live' || record.live === true;
    var oldId = record.jobId;
    var newId = (isLiveEdit ? 'live_' : 'fbjob_') + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    var nextOptions = Object.assign({}, record.options || {}, {
      id: newId,
      promptType: (record.options && record.options.promptType) || 'class',
      userText: body,
      requestContent: body,
      studentName: record.studentName,
      studentDivision: clean(record.studentDivision || (record.options && record.options.studentDivision)) || 'elementary',
      studentId: record.studentId,
      sourcePage: 'kinderChatFeedback',
      silent: true,
      attachments: Array.isArray(record.options && record.options.attachments) ? record.options.attachments.slice() : []
    });

    state.discardedIds.delete(newId);
    if (isLiveEdit && record.row) {
      var bubble = record.row.querySelector('.kcfBubble');
      if (bubble) bubble.textContent = body;
      record.row.dataset.kcfLiveUserFor = newId;
      record.row.classList.add('kcfRecordEdited');
      ensureLiveRecordEditButton(record.row);
    }

    if (typeof global.startTodayFeedbackRequest === 'function') {
      global.startTodayFeedbackRequest(nextOptions);
    } else if (isLiveEdit && typeof global.startKinderChatFeedbackLiveRequest === 'function') {
      global.startKinderChatFeedbackLiveRequest(nextOptions);
    }

    if (!isLiveEdit) delete state.records[oldId];
    record.jobId = newId;
    record.body = body;
    record.options = nextOptions;
    if (!isLiveEdit) state.records[newId] = record;
    if (record.row && !isLiveEdit) {
      record.row.dataset.kcfJobId = newId;
      record.row.classList.add('kcfRecordEdited');
    }

    var resumeValue = editing.resumeValue;
    var resumeSelectedStudentId = editing.resumeSelectedStudentId;
    state.editing = null;
    setEditUi(false);
    input.value = resumeValue;
    global.__kcfSelectedStudentId = resumeSelectedStudentId;
    if (typeof global.setKinderChatFeedbackWarning === 'function') global.setKinderChatFeedbackWarning('');
    if (typeof global.autoResizeKinderChatFeedbackInput === 'function') global.autoResizeKinderChatFeedbackInput(input);
    if (!isLiveEdit) {
      try { if (typeof global.addKinderChatMessage === 'function') global.addKinderChatMessage('bot', '수정한 수업기록으로 피드백을 다시 정리할게요.'); } catch (_) {}
    }
    if (resumeValue) setTimeout(function() { focusInputAtEnd(input); }, 0);
  }

  function isEditing() {
    return !!state.editing;
  }

  function captureSubmitContext() {
    var studentId = state.enabled ? clean(state.selectedStudentId || global.__kcfSelectedStudentId) : '';
    var item = studentId ? findAutoItem(studentId) : null;
    return {
      enabled: state.enabled === true,
      studentId: studentId,
      studentName: item ? clean(item.name) : '',
      studentDivision: item ? clean(item.studentDivision || studentDivision(item.student)) : '',
      order: state.enabled ? getAutoRenderedStudentIds() : []
    };
  }

  function completeSuccessfulSubmit(context) {
    var submitted = context || {};
    if (submitted.enabled && submitted.studentId) {
      state.completedIds.add(submitted.studentId);
      clearAutoDraft(submitted.studentId);
      state.selectedStudentId = '';
      global.__kcfSelectedStudentId = '';
      renderAutoRoster();
      selectNextAvailableAutoStudent(submitted.studentId, submitted.order || []);
    } else {
      global.__kcfSelectedStudentId = '';
    }
    if (global.KcfTeacherSheet && typeof global.KcfTeacherSheet.onSuccessfulSubmit === 'function') {
      global.KcfTeacherSheet.onSuccessfulSubmit();
    }
  }

  function onFeedbackRequestResult(result) {
    var resolved = result || {};
    var jobId = clean(resolved.id);
    var record = jobId ? state.records[jobId] : null;
    var studentId = clean(resolved.studentId || (record && record.studentId));
    var status = clean(resolved.status).toLowerCase();
    if (!studentId) return;

    if (status === 'done' || status === 'review' || status === 'success') {
      if (typeof global.markKcfStudentFeedbackSent === 'function') {
        try { global.markKcfStudentFeedbackSent(studentId); } catch (_) {}
      }
      return;
    }

    if (status !== 'error') return;
    if (state.completedIds.has(studentId)) {
      state.completedIds.delete(studentId);
      renderAutoRoster();
      if (global.KcfTeacherSheet && typeof global.KcfTeacherSheet.syncFromBase === 'function') {
        global.KcfTeacherSheet.syncFromBase();
      }
    }
  }

  function disableForManualSelection() {
    if (state.enabled) deselectAutoStudent();
  }

  function getSelection() {
    if (!state.enabled || state.editing) return null;
    var studentId = clean(state.selectedStudentId || global.__kcfSelectedStudentId);
    var item = findAutoItem(studentId);
    if (!item) return null;
    return {
      studentId: item.studentId,
      studentName: item.name,
      studentDivision: clean(item.studentDivision || studentDivision(item.student)),
      trialSessionId: clean(item.trialSessionId)
    };
  }

  function bindAutoDraftPersistence() {
    var input = document.getElementById('kcfInput');
    if (!input || input.__kcfAutoDraftBound) return;
    input.__kcfAutoDraftBound = true;
    input.addEventListener('input', function() {
      if (state.enabled && !state.editing && state.selectedStudentId) saveCurrentAutoDraft();
    });
  }

  function onPageOpened() {
    var today = todayKey();
    var activeDivision = teacherRosterScopeKey();
    var canRestoreTeacher = state.enabled &&
      state.rosterDateKey === today &&
      clean(state.rosterDivision) === activeDivision &&
      state.rosterStatus === 'ready' &&
      state.queue.length > 0;

    if (canRestoreTeacher) {
      renderAutoRoster();
    } else if (state.enabled) {
      state.enabled = false;
      state.selectedStudentId = '';
      global.__kcfSelectedStudentId = '';
    }

    // Page entry must never wait for the schedule. Warm today's Teacher roster in the background.
    preloadTodayScheduleQueue({ force:true });
    syncAutoButton();
    bindLiveRecordEditButtons();
  }

  function bindTeacherRosterRefreshEvents() {
    if (global.__kcfTeacherRosterRefreshBound) return;
    global.__kcfTeacherRosterRefreshBound = true;
    global.addEventListener('olli:schedule-changed', function() {
      preloadTodayScheduleQueue({ force:true });
    });
  }

  function isEnabled() {
    return state.enabled === true;
  }

  global.KcfTeacherMode = {
    isEnabled: isEnabled,
    isEditing: isEditing,
    saveSubmittedRecordEdit: saveSubmittedRecordEdit,
    captureSubmitContext: captureSubmitContext,
    completeSuccessfulSubmit: completeSuccessfulSubmit,
    getSelection: getSelection,
    disableForManualSelection: disableForManualSelection,
    filterFeedbackItems: filterFeedbackItems,
    shouldDiscardFeedbackJob: shouldDiscardFeedbackJob,
    discardFeedbackJob: discardFeedbackJob,
    onDocumentMessageAdded: onDocumentMessageAdded,
    onFeedbackRequestStarted: onFeedbackRequestStarted,
    onFeedbackRequestResult: onFeedbackRequestResult,
    onPageOpened: onPageOpened,
    activateForComposer: function(event){
      if (!state.enabled) return activateTeacherRoster('', event);
      return true;
    },
    preloadRoster: preloadTodayScheduleQueue,
    getRosterStatus: function() { return state.rosterStatus; },
    refreshRoster: renderAutoRoster
  };
  global.KcfAutoMode = global.KcfTeacherMode; // legacy alias

  bindAutoDraftPersistence();
  bindTeacherRosterRefreshEvents();
  syncAutoButton();
  bindLiveRecordEditButtons();
})(window);
