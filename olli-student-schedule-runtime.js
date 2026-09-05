
/* 2026-07-03: 학생정보 수동 빈값 저장 + 요일별 시간 선택 */
(function(){
  const DAYS = ['월','화','수','목','금','토','일'];
  const ELEMENTARY_TIMES = ['1시','2시','3시','4시','5시','6시','7시'];
  const KINDER_TIMES = ['3시','4시','5시','6시'];
  const ALL_TIMES = ['1시','2시','3시','4시','5시','6시','7시'];
  function timeOptions(kind){
    if (kind === 'kinder') return KINDER_TIMES;
    if (kind === 'student') {
      try {
        if (typeof currentRecordView !== 'undefined' && currentRecordView === 'kinder') return KINDER_TIMES;
        if (window.currentRecordView === 'kinder') return KINDER_TIMES;
      } catch(e) {}
    }
    return ELEMENTARY_TIMES;
  }

  function text(value){ return String(value == null ? '' : value).trim(); }
  function hasOwn(obj, key){ return !!obj && Object.prototype.hasOwnProperty.call(obj, key); }
  function firstOwn(obj, keys, fallback){
    for (const key of keys) {
      if (hasOwn(obj, key) && obj[key] !== undefined && obj[key] !== null) return obj[key];
    }
    return fallback;
  }
  function mutableValue(remote, local, keys, fallback = ''){
    if (remote && typeof remote === 'object') {
      for (const key of keys) {
        if (hasOwn(remote, key) && remote[key] !== undefined && remote[key] !== null) return remote[key];
      }
    }
    if (local && typeof local === 'object') {
      for (const key of keys) {
        if (hasOwn(local, key) && local[key] !== undefined && local[key] !== null) return local[key];
      }
    }
    return fallback;
  }
  function requiredValue(remote, local, keys, fallback = ''){
    for (const key of keys) {
      const value = remote && remote[key];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    for (const key of keys) {
      const value = local && local[key];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return fallback;
  }

  // 학생정보창에서 직접 비운 값이 서버 동기화 후 예전 로컬 값으로 되살아나는 문제를 막습니다.
  // 이름/등록날짜는 기존처럼 필수값으로 유지하고, 그 외 학생정보 필드는 remote의 빈 문자열도 유효한 변경값으로 봅니다.
  window.mergeStudentInfoPreservingLocal = function(local = {}, remote = {}){
    const type = requiredValue(remote, local, ['type','division'], 'elementary');
    const merged = {
      ...local,
      ...remote,
      id: requiredValue(remote, local, ['id'], ''),
      academy_id: requiredValue(remote, local, ['academy_id'], (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '')),
      type,
      name: requiredValue(remote, local, ['name','student_name'], ''),
      year: requiredValue(remote, local, ['year'], (typeof getCurrentYear === 'function' ? getCurrentYear() : new Date().getFullYear())),
      month: requiredValue(remote, local, ['month'], ''),
      day: requiredValue(remote, local, ['day'], ''),
      enrolled_at: requiredValue(remote, local, ['enrolled_at'], ''),
      kindergarten: mutableValue(remote, local, ['kindergarten','kindergarten_name','kindergartenName']),
      age: mutableValue(remote, local, ['age','student_age','studentAge']),
      lesson_day: mutableValue(remote, local, ['lesson_day','lessonDay','class_day','classDay']),
      lesson_time: mutableValue(remote, local, ['lesson_time','lessonTime','class_time','classTime']),
      class_time: mutableValue(remote, local, ['class_time','classTime','lesson_time','lessonTime']),
      teacher: mutableValue(remote, local, ['teacher','homeroom_teacher','teacher_name']),
      homeroom_teacher: mutableValue(remote, local, ['homeroom_teacher','teacher','teacher_name']),
      group: mutableValue(remote, local, ['group','group_no']),
      group_months: mutableValue(remote, local, ['group_months','feedback_months','feedbackMonths','groupFeedbackMonths']),
      feedback_months: mutableValue(remote, local, ['feedback_months','group_months','feedbackMonths','groupFeedbackMonths']),
      personality: mutableValue(remote, local, ['personality','tendency','tendency_type','personality_type']),
      school: mutableValue(remote, local, ['school','school_name','schoolName']),
      grade: mutableValue(remote, local, ['grade','school_grade','studentGrade']),
      className: mutableValue(remote, local, ['className','class_no','class','school_class']),
      memoUpdatedAt: mutableValue(remote, local, ['memoUpdatedAt','memo_updated_at']),
      status: requiredValue(local, remote, ['status'], 'active'),
      withdrawn_at: mutableValue(remote, local, ['withdrawn_at','withdrawal_at','quit_at']),
      paused_at: mutableValue(remote, local, ['paused_at','pause_at']),
      status_changed_at: mutableValue(remote, local, ['status_changed_at']),
      updated_at: mutableValue(remote, local, ['updated_at'])
    };
    return typeof normalizeStudentObject === 'function' ? normalizeStudentObject(merged, type) : merged;
  };

  // 그룹을 수동으로 해제했을 때, 예전 그룹의 발송월이 다시 따라붙지 않게 합니다.
  const oldGetElementaryGroupFeedbackMonths = window.getElementaryGroupFeedbackMonths;
  window.getElementaryGroupFeedbackMonths = function(group, student = null){
    const groupProvided = arguments.length >= 1;
    const groupText = text(group);
    if (groupProvided && !groupText) return [];
    return typeof oldGetElementaryGroupFeedbackMonths === 'function'
      ? oldGetElementaryGroupFeedbackMonths.apply(this, arguments)
      : [];
  };

  function uniqueOrdered(list, order){
    const seen = new Set();
    const values = (Array.isArray(list) ? list : [])
      .map(text)
      .filter(Boolean)
      .filter(v => { if (seen.has(v)) return false; seen.add(v); return true; });
    if (Array.isArray(order) && order.length) {
      const pos = new Map(order.map((v, i) => [v, i]));
      values.sort((a, b) => (pos.has(a) ? pos.get(a) : 999) - (pos.has(b) ? pos.get(b) : 999));
    }
    return values;
  }
  function parseDays(value){
    const raw = text(value).replace(/요일/g, '');
    if (!raw) return [];
    return DAYS.filter(day => raw.includes(day));
  }
  function parseTimes(value){
    const raw = text(value);
    if (!raw) return [];
    const out = [];
    raw.replace(/(?:오후\s*)?([1-7])\s*(?:시|:00)?/g, function(_, hour){
      const label = Number(hour) + '시';
      if (!out.includes(label)) out.push(label);
      return '';
    });
    return uniqueOrdered(out, ALL_TIMES);
  }
  function normalizeDayTimePairs(value){
    const raw = text(value);
    if (!raw) return '';
    const segments = raw.split(/[·,\/|\n]+/).map(text).filter(Boolean);
    const pairs = [];
    segments.forEach(segment => {
      const dayMatch = segment.match(/([월화수목금토일])(?:요일)?/);
      const timeMatches = parseTimes(segment);
      if (dayMatch && timeMatches.length) {
        timeMatches.forEach(time => pairs.push(dayMatch[1] + ' ' + time));
      }
    });
    if (!pairs.length) {
      const compact = raw.replace(/\s+/g, '');
      const re = /([월화수목금토일])(?:요일)?(?:[:：\-~])?(?:오후)?([1-7])(?:시|:00)?/g;
      let m;
      while ((m = re.exec(compact)) !== null) pairs.push(m[1] + ' ' + Number(m[2]) + '시');
    }
    if (pairs.length) return uniqueOrdered(pairs, []).join(' · ');
    return parseTimes(raw).join(' · ');
  }

  window.normalizeLessonTimeDisplay = function(value){
    return normalizeDayTimePairs(value);
  };

  function emptyState(){ return { days: [], activeDay: '', timesByDay: Object.create(null) }; }
  let addState = emptyState();
  let elementaryInfoState = emptyState();
  let kinderInfoState = emptyState();

  function getState(kind){
    if (kind === 'student') return addState;
    if (kind === 'elementary') return elementaryInfoState;
    return kinderInfoState;
  }
  function setState(kind, next){
    if (kind === 'student') addState = next;
    else if (kind === 'elementary') elementaryInfoState = next;
    else kinderInfoState = next;
  }
  function parseScheduleState(lessonDay, lessonTime){
    const state = emptyState();
    parseDays(lessonDay).forEach(day => {
      if (!state.days.includes(day)) state.days.push(day);
      if (!state.timesByDay[day]) state.timesByDay[day] = [];
    });

    const rawTime = text(lessonTime);
    const pairText = normalizeDayTimePairs(rawTime);
    const pairSegments = pairText.split(/\s*·\s*/).map(text).filter(Boolean);
    let hasPairs = false;
    pairSegments.forEach(segment => {
      const dayMatch = segment.match(/^([월화수목금토일])\s*(.+)$/);
      if (!dayMatch) return;
      const day = dayMatch[1];
      const times = parseTimes(dayMatch[2]);
      if (!times.length) return;
      hasPairs = true;
      if (!state.days.includes(day)) state.days.push(day);
      state.timesByDay[day] = uniqueOrdered([...(state.timesByDay[day] || []), ...times], ALL_TIMES);
    });

    if (!hasPairs) {
      const times = parseTimes(rawTime);
      if (times.length) {
        if (state.days.length === 1) {
          state.timesByDay[state.days[0]] = times;
        } else if (state.days.length > 1 && times.length === state.days.length) {
          state.days.forEach((day, index) => { state.timesByDay[day] = [times[index]]; });
        } else {
          state.days.forEach(day => { state.timesByDay[day] = [...times]; });
        }
      }
    }

    state.days = uniqueOrdered(state.days, DAYS);
    state.days.forEach(day => { state.timesByDay[day] = uniqueOrdered(state.timesByDay[day] || [], ALL_TIMES); });
    state.activeDay = state.days[0] || '';
    return state;
  }
  function scheduleLessonDay(state){ return uniqueOrdered(state.days, DAYS).join(' · '); }
  function scheduleLessonTime(state){
    const parts = [];
    uniqueOrdered(state.days, DAYS).forEach(day => {
      uniqueOrdered(state.timesByDay[day] || [], ALL_TIMES).forEach(time => parts.push(day + ' ' + time));
    });
    return parts.join(' · ');
  }
  function dayContainers(kind){
    if (kind === 'student') return ['studentLessonDayToggleRow','elementaryStudentLessonDayToggleRow'];
    if (kind === 'elementary') return ['elementaryLessonDayToggleRow'];
    return ['kinderLessonDayToggleRow'];
  }
  function timeContainers(kind){
    if (kind === 'student') return ['studentLessonTimeToggleRow','elementaryStudentLessonTimeToggleRow'];
    if (kind === 'elementary') return ['elementaryLessonTimeToggleRow'];
    return ['kinderLessonTimeToggleRow'];
  }
  function daySetter(kind){
    if (kind === 'student') return 'toggleStudentModalDay';
    if (kind === 'elementary') return 'toggleElementaryInfoDay';
    return 'toggleKinderInfoDay';
  }
  function timeSetter(kind){
    if (kind === 'student') return 'toggleStudentModalTime';
    if (kind === 'elementary') return 'toggleElementaryInfoTime';
    return 'toggleKinderInfoTime';
  }
  function renderScheduleDayButtons(kind){
    const state = getState(kind);
    const selected = new Set(state.days);
    const setter = daySetter(kind);
    dayContainers(kind).forEach(containerId => {
      const el = document.getElementById(containerId);
      if (!el) return;
      el.innerHTML = DAYS.map(day => {
        const cls = ['infoDayBtn'];
        if (selected.has(day)) cls.push('active');
        if (state.activeDay === day) cls.push('activeDayForTime');
        return '<button type="button" class="' + cls.join(' ') + '" onclick="' + setter + '(\'' + day + '\')">' + day + '</button>';
      }).join('');
    });
  }
  function renderScheduleTimeButtons(kind){
    const state = getState(kind);
    const setter = timeSetter(kind);
    timeContainers(kind).forEach(containerId => {
      const el = document.getElementById(containerId);
      if (!el) return;
      if (!state.activeDay) {
        el.innerHTML = '<div class="infoTimeHint">요일을 먼저 선택해 주세요.</div>';
        return;
      }
      const selected = new Set(state.timesByDay[state.activeDay] || []);
      el.innerHTML = timeOptions(kind).map(time => '<button type="button" class="infoTimeBtn ' + (selected.has(time) ? 'active' : '') + '" onclick="' + setter + '(\'' + time + '\')">' + time + '</button>').join('');
    });
  }
  function renderSchedule(kind){
    renderScheduleDayButtons(kind);
    renderScheduleTimeButtons(kind);
  }
  function toggleDay(kind, day){
    const state = getState(kind);
    const current = text(day);
    if (!current) return;
    const idx = state.days.indexOf(current);
    if (idx >= 0 && state.activeDay === current) {
      state.days.splice(idx, 1);
      delete state.timesByDay[current];
      state.activeDay = state.days[0] || '';
    } else if (idx >= 0) {
      state.activeDay = current;
    } else {
      state.days.push(current);
      state.days = uniqueOrdered(state.days, DAYS);
      if (!state.timesByDay[current]) state.timesByDay[current] = [];
      state.activeDay = current;
    }
    setState(kind, state);
    renderSchedule(kind);
  }
  function toggleTime(kind, time){
    const state = getState(kind);
    if (!state.activeDay) {
      if (typeof showPushToast === 'function') showPushToast('요일을 먼저 선택해 주세요.');
      else alert('요일을 먼저 선택해 주세요.');
      return;
    }
    const label = text(time);
    if (!timeOptions(kind).includes(label)) return;
    const list = state.timesByDay[state.activeDay] || [];
    const idx = list.indexOf(label);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(label);
    state.timesByDay[state.activeDay] = uniqueOrdered(list, timeOptions(kind));
    setState(kind, state);
    renderSchedule(kind);
  }

  window.toggleStudentModalDay = function(day){ toggleDay('student', day); };
  window.toggleElementaryInfoDay = function(day){ toggleDay('elementary', day); };
  window.toggleKinderInfoDay = function(day){ toggleDay('kinder', day); };
  window.toggleStudentModalTime = function(time){ toggleTime('student', time); };
  window.toggleElementaryInfoTime = function(time){ toggleTime('elementary', time); };
  window.toggleKinderInfoTime = function(time){ toggleTime('kinder', time); };

  function setLabelForContainer(containerId, labelText){
    const el = document.getElementById(containerId);
    const field = el && (el.closest('.kinderInfoModalField') || el.parentElement);
    const label = field && field.querySelector('.modalLabel');
    if (label) label.textContent = labelText;
  }
  function hideTimeLabelForContainer(containerId){
    const el = document.getElementById(containerId);
    const field = el && (el.closest('.kinderInfoModalField') || el.parentElement);
    const label = field && field.querySelector('.modalLabel');
    if (label) {
      label.textContent = '';
      label.style.display = 'none';
    }
  }
  function patchScheduleLabels(){
    ['studentLessonDayToggleRow','elementaryStudentLessonDayToggleRow','kinderLessonDayToggleRow','elementaryLessonDayToggleRow'].forEach(id => setLabelForContainer(id, '요일/시간'));
    ['studentLessonTimeToggleRow','elementaryStudentLessonTimeToggleRow','kinderLessonTimeToggleRow','elementaryLessonTimeToggleRow'].forEach(hideTimeLabelForContainer);
  }

  const oldPatchStudentModalMarkup = window.olliPatchStudentModalMarkup;
  window.olliPatchStudentModalMarkup = function(){
    if (typeof oldPatchStudentModalMarkup === 'function') oldPatchStudentModalMarkup.apply(this, arguments);
    patchScheduleLabels();
    renderSchedule('student');
    renderSchedule('elementary');
    renderSchedule('kinder');
  };

  const oldPrepareStudentAddExtra = window.olliPrepareStudentAddExtra;
  window.olliPrepareStudentAddExtra = function(type){
    if (typeof oldPrepareStudentAddExtra === 'function') oldPrepareStudentAddExtra.apply(this, arguments);
    addState = emptyState();
    patchScheduleLabels();
    renderSchedule('student');
  };

  const oldGetStudentAddExtra = window.olliGetStudentAddExtra;
  window.olliGetStudentAddExtra = function(type){
    const base = typeof oldGetStudentAddExtra === 'function' ? (oldGetStudentAddExtra.apply(this, arguments) || {}) : {};
    const lessonDay = scheduleLessonDay(addState);
    const lessonTime = scheduleLessonTime(addState);
    return Object.assign({}, base, {
      lesson_day: lessonDay,
      lesson_time: lessonTime,
      class_time: lessonTime
    });
  };

  const oldPrepareInfoExtra = window.olliPrepareInfoExtra;
  window.olliPrepareInfoExtra = function(type, student){
    if (typeof oldPrepareInfoExtra === 'function') oldPrepareInfoExtra.apply(this, arguments);
    patchScheduleLabels();
    if (type === 'elementary') {
      elementaryInfoState = parseScheduleState(student && (student.lesson_day || student.lessonDay || ''), student && (student.lesson_time || student.class_time || student.lessonTime || student.classTime || ''));
      renderSchedule('elementary');
    } else if (type === 'kinder') {
      kinderInfoState = parseScheduleState(student && (student.lesson_day || student.lessonDay || ''), student && (student.lesson_time || student.class_time || student.lessonTime || student.classTime || ''));
      renderSchedule('kinder');
    }
  };

  const oldGetInfoExtra = window.olliGetInfoExtra;
  window.olliGetInfoExtra = function(type){
    const base = typeof oldGetInfoExtra === 'function' ? (oldGetInfoExtra.apply(this, arguments) || {}) : {};
    if (type === 'elementary') {
      const lessonDay = scheduleLessonDay(elementaryInfoState);
      const lessonTime = scheduleLessonTime(elementaryInfoState);
      return Object.assign({}, base, { lesson_day: lessonDay, lesson_time: lessonTime, class_time: lessonTime });
    }
    if (type === 'kinder') {
      const lessonDay = scheduleLessonDay(kinderInfoState);
      const lessonTime = scheduleLessonTime(kinderInfoState);
      return Object.assign({}, base, { lesson_day: lessonDay, lesson_time: lessonTime, class_time: lessonTime });
    }
    return base;
  };

  function normalizeScheduleMeta(student){
    const timeValue = text(student && (student.lesson_time || student.class_time || student.lessonTime || student.classTime || ''));
    if (/[월화수목금토일]/.test(timeValue) && /[1-7]\s*시/.test(timeValue)) return normalizeDayTimePairs(timeValue);
    const dayValue = text(student && (student.lesson_day || student.lessonDay || student.class_day || student.classDay || ''));
    const state = parseScheduleState(dayValue, timeValue);
    const pair = scheduleLessonTime(state);
    return pair || (typeof normalizeLessonDayDisplay === 'function' ? normalizeLessonDayDisplay(dayValue) : dayValue);
  }
  if (typeof window.getElementaryMetaText === 'function') {
    window.getElementaryMetaText = function(student){
      const personality = typeof formatElementaryPersonalityDisplay === 'function' ? formatElementaryPersonalityDisplay(student) : '';
      const school = typeof formatElementarySchoolGuideDisplay === 'function' ? formatElementarySchoolGuideDisplay(student) : '';
      const gradeClass = typeof formatElementaryGradeClassDisplay === 'function' ? formatElementaryGradeClassDisplay(student) : '';
      const teacherName = typeof getStudentTeacherDisplay === 'function' ? getStudentTeacherDisplay(student) : '';
      const schedule = normalizeScheduleMeta(student);
      const feedbackMonth = typeof getElementaryGroupFeedbackMonthDisplay === 'function' ? getElementaryGroupFeedbackMonthDisplay(student && student.group, student) : '';
      return [personality, school, gradeClass, teacherName, schedule, feedbackMonth].filter(Boolean).join(' / ');
    };
  }
  if (typeof window.getKinderMetaText === 'function') {
    window.getKinderMetaText = function(student){
      const personality = typeof formatElementaryPersonalityDisplay === 'function' ? formatElementaryPersonalityDisplay(student) : '';
      const kindergarten = typeof normalizeRecordInfoValue === 'function' ? normalizeRecordInfoValue(student && student.kindergarten, student && student.kindergarten_name, student && student.kindergartenName) : text(student && student.kindergarten);
      const age = typeof normalizeRecordInfoValue === 'function' ? normalizeRecordInfoValue(student && student.age, student && student.student_age, student && student.studentAge) : text(student && student.age);
      const teacherName = typeof getStudentTeacherDisplay === 'function' ? getStudentTeacherDisplay(student) : '';
      const schedule = normalizeScheduleMeta(student);
      return [personality, kindergarten, age ? age + '세' : '', teacherName, schedule].filter(Boolean).join(' / ');
    };
  }

  const style = document.createElement('style');
  style.id = 'olliStudentInfoDayTimePerDayStyle';
  style.textContent = `
    .infoDayBtn.activeDayForTime{box-shadow:inset 0 0 0 2px #0A84FF;background:#111;color:#fff;}
    .infoTimeHint{grid-column:1 / -1;min-height:36px;border-radius:16px;background:#f6f6f4;color:#999;font-size:calc(12px * var(--olli-text-scale));display:flex;align-items:center;justify-content:center;}
    .studentScheduleTimeField{margin-top:-8px;margin-bottom:13px;}
  `;
  document.head.appendChild(style);

  document.addEventListener('DOMContentLoaded', function(){
    try {
      if (typeof window.olliPatchStudentModalMarkup === 'function') window.olliPatchStudentModalMarkup();
      patchScheduleLabels();
    } catch(e) {}
  });
})();
