(function pcStudentInfoCardRuntime(global) {
  'use strict';
  if (global.__OLLI_PC_STUDENT_INFO_CARD_V1__) return;
  global.__OLLI_PC_STUDENT_INFO_CARD_V1__ = true;

  const DAYS = ['월', '화', '수', '목', '금', '토'];
  const DAY_NUM = Object.freeze({ 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 });
  const NUM_DAY = Object.freeze({ 1: '월', 2: '화', 3: '수', 4: '목', 5: '금', 6: '토' });
  const SESSION_KEY = 'olli_account_session_token_v1';
  const WEEK_CACHE_PREFIXES = ['olli_schedule_week_cache_v1_', 'olli_schedule_attendance_month_cache_v1_', 'olli_attendance_month_cache_v1_'];

  const cardState = {
    studentId: '',
    student: null,
    enrollments: [],
    loading: false,
    saveInFlight: false,
    observer: null,
    installed: false
  };

  const scheduleStates = {
    student: emptyScheduleState(),
    elementary: emptyScheduleState(),
    kinder: emptyScheduleState()
  };
  let studentAddDivision = 'elementary';

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function esc(value) {
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(clean(value));
    return clean(value).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  }
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function currentAcademyId() {
    try {
      if (typeof global.getOlliCurrentAcademyId === 'function') return clean(global.getOlliCurrentAcademyId());
    } catch (_) {}
    return clean(localStorage.getItem('olli_current_academy_id'));
  }
  function currentSessionToken() { return clean(localStorage.getItem(SESSION_KEY)); }
  function unwrapRpc(value) { return Array.isArray(value) && value.length === 1 ? value[0] : value; }

  async function scheduleRpc(name, payload) {
    if (typeof global.supabase !== 'function') throw new Error('시간표 서버 연결을 찾지 못했습니다.');
    const academyId = currentAcademyId();
    const sessionToken = currentSessionToken();
    if (!academyId) throw new Error('현재 학원 정보를 찾지 못했습니다. 다시 로그인해 주세요.');
    if (!sessionToken) throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
    const result = unwrapRpc(await global.supabase('POST', `rpc/${name}`, Object.assign({
      p_session_token: sessionToken,
      p_academy_id: academyId
    }, payload || {}))) || {};
    if (result && result.ok === false) throw new Error(result.message || '시간표 요청을 처리하지 못했습니다.');
    return result;
  }

  async function loadAuthoritativeSchedule(studentId) {
    const result = await scheduleRpc('olli_schedule_student_enrollments', {
      p_student_id: studentId,
      p_reference_date: todayKey()
    });
    return Array.isArray(result.enrollments) ? result.enrollments : [];
  }

  async function loadAuthoritativeTeacherAssignments() {
    const result = await scheduleRpc('olli_schedule_class_teacher_context');
    return Array.isArray(result.assignments) ? result.assignments : [];
  }

  function primaryEnrollmentForTeacher(rows) {
    return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
      const aOrder = Number(a && a.session_order);
      const bOrder = Number(b && b.session_order);
      const aRank = aOrder === 1 ? 0 : (a && a.session_order == null ? 1 : 2);
      const bRank = bOrder === 1 ? 0 : (b && b.session_order == null ? 1 : 2);
      if (aRank !== bRank) return aRank - bRank;
      if (aRank === 2 && aOrder !== bOrder) return aOrder - bOrder;
      return Number(a && a.weekday) - Number(b && b.weekday)
        || Number(a && a.time_slot) - Number(b && b.time_slot)
        || clean(a && a.class_group).localeCompare(clean(b && b.class_group));
    })[0] || null;
  }

  function resolveTimetableTeacherName(division, enrollments, assignments) {
    const first = primaryEnrollmentForTeacher(enrollments);
    if (!first) return '';
    const group = clean(first.class_group || 'A').toUpperCase() || 'A';
    const matched = (Array.isArray(assignments) ? assignments : []).find((item) =>
      clean(item && item.division) === clean(division)
      && Number(item && item.weekday) === Number(first.weekday)
      && Number(item && item.time_slot) === Number(first.time_slot)
      && (clean(item && item.class_group).toUpperCase() || 'A') === group
    );
    return clean(matched && matched.teacher_name);
  }

  async function setAuthoritativeSchedule(studentId, pairs) {
    const normalized = normalizePairs(pairs);
    const result = await scheduleRpc('olli_schedule_set_student_weekly_schedule', {
      p_student_id: studentId,
      p_pairs: normalized,
      p_effective_date: todayKey()
    });
    invalidateScheduleCaches();
    try {
      global.dispatchEvent(new CustomEvent('olli:schedule-changed', {
        detail: { studentId: clean(studentId), source: 'student_profile' }
      }));
    } catch (_) {}
    return result;
  }

  function invalidateScheduleCaches() {
    const academyId = currentAcademyId();
    if (!academyId) return;
    try {
      const remove = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i) || '';
        if (WEEK_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix) && key.includes(`_${academyId}_`))) remove.push(key);
      }
      remove.forEach((key) => localStorage.removeItem(key));
    } catch (_) {}
  }

  function normalizePairs(pairs) {
    const seen = new Set();
    return (Array.isArray(pairs) ? pairs : []).map((pair) => ({
      weekday: Number(pair && pair.weekday),
      time_slot: Number(pair && pair.time_slot),
      class_group: ['A','B'].includes(clean(pair && pair.class_group).toUpperCase()) ? clean(pair.class_group).toUpperCase() : null
    })).filter((pair) => {
      if (!Number.isFinite(pair.weekday) || !Number.isFinite(pair.time_slot)) return false;
      const key = `${pair.weekday}|${pair.time_slot}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => a.weekday - b.weekday || a.time_slot - b.time_slot);
  }

  function schedulePairsEqual(left, right) {
    const normalizeForCompare = (rows) => normalizePairs(rows).map((pair) => ({
      weekday: pair.weekday,
      time_slot: pair.time_slot,
      class_group: pair.class_group || null
    }));
    return JSON.stringify(normalizeForCompare(left)) === JSON.stringify(normalizeForCompare(right));
  }

  function pairsFromLessonFields(lessonDay, lessonTime) {
    const rawDay = clean(lessonDay).replace(/요일/g, '');
    const rawTime = clean(lessonTime);
    const pairs = [];
    const segments = rawTime.split(/[·,\/|\n]+/).map(clean).filter(Boolean);
    segments.forEach((segment) => {
      const dayMatch = segment.match(/([월화수목금토])/);
      const timeMatches = [];
      segment.replace(/(?:오후\s*)?([1-9]|1[0-2])\s*(?:시|:00)?/g, (_, hour) => {
        timeMatches.push(Number(hour));
        return '';
      });
      if (!dayMatch) return;
      timeMatches.forEach((time) => pairs.push({ weekday: DAY_NUM[dayMatch[1]], time_slot: time }));
    });
    if (!pairs.length) {
      const days = DAYS.filter((day) => rawDay.includes(day));
      const times = [];
      rawTime.replace(/(?:오후\s*)?([1-9]|1[0-2])\s*(?:시|:00)?/g, (_, hour) => {
        const n = Number(hour);
        if (!times.includes(n)) times.push(n);
        return '';
      });
      if (days.length === 1) times.forEach((time) => pairs.push({ weekday: DAY_NUM[days[0]], time_slot: time }));
      else if (days.length > 1 && days.length === times.length) days.forEach((day, i) => pairs.push({ weekday: DAY_NUM[day], time_slot: times[i] }));
    }
    return normalizePairs(pairs);
  }

  function lessonFieldsFromEnrollments(rows) {
    const normalized = normalizePairs(rows);
    const days = [];
    const times = [];
    normalized.forEach((row) => {
      const day = NUM_DAY[row.weekday];
      if (!day) return;
      if (!days.includes(day)) days.push(day);
      times.push(`${day} ${row.time_slot}시`);
    });
    return { lesson_day: days.join(' · '), lesson_time: times.join(' · ') };
  }

  function emptyScheduleState() {
    return { days: [], activeDay: '', timesByDay: Object.create(null), classGroupByPair: Object.create(null) };
  }

  function divisionForKind(kind) {
    if (kind === 'student') return studentAddDivision === 'kinder' ? 'kinder' : 'elementary';
    return kind === 'kinder' ? 'kinder' : 'elementary';
  }

  function timeOptions(kind, day) {
    const division = divisionForKind(kind);
    if (division === 'kinder') return ['4시', '5시'];
    if (day === '토') return ['10시', '11시', '12시'];
    return ['1시', '2시', '3시', '4시', '5시', '6시'];
  }

  function stateFromStudent(student) {
    const state = emptyScheduleState();
    const rows = Array.isArray(student && student.__olli_authoritative_enrollments)
      ? student.__olli_authoritative_enrollments
      : pairsFromLessonFields(student && student.lesson_day, student && (student.lesson_time || student.class_time));
    normalizePairs(rows).forEach((row) => {
      const day = NUM_DAY[row.weekday];
      if (!day) return;
      if (!state.days.includes(day)) state.days.push(day);
      if (!state.timesByDay[day]) state.timesByDay[day] = [];
      const label = `${row.time_slot}시`;
      if (!state.timesByDay[day].includes(label)) state.timesByDay[day].push(label);
      const source = (Array.isArray(student && student.__olli_authoritative_enrollments) ? student.__olli_authoritative_enrollments : [])
        .find((item) => Number(item.weekday) === row.weekday && Number(item.time_slot) === row.time_slot);
      const group = clean(source && source.class_group).toUpperCase();
      if (group === 'A' || group === 'B') state.classGroupByPair[`${day}|${label}`] = group;
    });
    state.days.sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b));
    state.days.forEach((day) => {
      state.timesByDay[day].sort((a, b) => Number(a.replace(/\D/g,'')) - Number(b.replace(/\D/g,'')));
    });
    state.activeDay = state.days[0] || '';
    return state;
  }

  function schedulePairsFromState(state) {
    const pairs = [];
    (state && state.days || []).forEach((day) => {
      (state.timesByDay[day] || []).forEach((time) => {
        const n = Number(String(time).replace(/\D/g, ''));
        if (!n) return;
        pairs.push({
          weekday: DAY_NUM[day],
          time_slot: n,
          class_group: state.classGroupByPair[`${day}|${time}`] || null
        });
      });
    });
    return normalizePairs(pairs);
  }

  function lessonFieldsFromState(state) {
    const pairs = schedulePairsFromState(state);
    return lessonFieldsFromEnrollments(pairs);
  }

  function dayContainers(kind) {
    if (kind === 'student') return ['studentLessonDayToggleRow', 'elementaryStudentLessonDayToggleRow'];
    if (kind === 'elementary') return ['elementaryLessonDayToggleRow'];
    return ['kinderLessonDayToggleRow'];
  }
  function timeContainers(kind) {
    if (kind === 'student') return ['studentLessonTimeToggleRow', 'elementaryStudentLessonTimeToggleRow'];
    if (kind === 'elementary') return ['elementaryLessonTimeToggleRow'];
    return ['kinderLessonTimeToggleRow'];
  }
  function daySetter(kind) {
    if (kind === 'student') return 'toggleStudentModalDay';
    if (kind === 'elementary') return 'toggleElementaryInfoDay';
    return 'toggleKinderInfoDay';
  }
  function timeSetter(kind) {
    if (kind === 'student') return 'toggleStudentModalTime';
    if (kind === 'elementary') return 'toggleElementaryInfoTime';
    return 'toggleKinderInfoTime';
  }

  function renderSchedule(kind) {
    const state = scheduleStates[kind];
    const selectedDays = new Set(state.days);
    dayContainers(kind).forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = DAYS.map((day) => {
        const cls = ['infoDayBtn'];
        if (selectedDays.has(day)) cls.push('active');
        if (state.activeDay === day) cls.push('activeDayForTime');
        return `<button type="button" class="${cls.join(' ')}" onclick="${daySetter(kind)}('${day}')">${day}</button>`;
      }).join('');
    });
    timeContainers(kind).forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (!state.activeDay) {
        el.innerHTML = '<div class="infoTimeHint">요일을 먼저 선택해 주세요.</div>';
        return;
      }
      const selected = new Set(state.timesByDay[state.activeDay] || []);
      el.innerHTML = timeOptions(kind, state.activeDay).map((time) =>
        `<button type="button" class="infoTimeBtn ${selected.has(time) ? 'active' : ''}" onclick="${timeSetter(kind)}('${time}')">${time}</button>`
      ).join('');
    });
  }

  function toggleDay(kind, day) {
    const state = scheduleStates[kind];
    const value = clean(day);
    if (!DAYS.includes(value)) return;
    const index = state.days.indexOf(value);
    if (index < 0) {
      state.days.push(value);
      state.days.sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b));
      state.timesByDay[value] = state.timesByDay[value] || [];
      state.activeDay = value;
    } else if (state.activeDay !== value) {
      state.activeDay = value;
    } else {
      (state.timesByDay[value] || []).forEach((time) => delete state.classGroupByPair[`${value}|${time}`]);
      state.days.splice(index, 1);
      delete state.timesByDay[value];
      state.activeDay = state.days[0] || '';
    }
    renderSchedule(kind);
  }

  function toggleTime(kind, time) {
    const state = scheduleStates[kind];
    if (!state.activeDay) {
      if (typeof global.showPushToast === 'function') global.showPushToast('요일을 먼저 선택해 주세요.');
      else alert('요일을 먼저 선택해 주세요.');
      return;
    }
    const label = clean(time);
    if (!timeOptions(kind, state.activeDay).includes(label)) return;
    const list = state.timesByDay[state.activeDay] || (state.timesByDay[state.activeDay] = []);
    const index = list.indexOf(label);
    if (index >= 0) {
      list.splice(index, 1);
      delete state.classGroupByPair[`${state.activeDay}|${label}`];
    } else {
      // 같은 요일에서도 서로 다른 시간은 여러 개 선택할 수 있습니다.
      list.push(label);
      list.sort((a, b) => Number(a.replace(/\D/g,'')) - Number(b.replace(/\D/g,'')));
    }
    renderSchedule(kind);
  }

  function installAuthoritativeScheduleEditor() {
    if (global.__OLLI_AUTHORITATIVE_SCHEDULE_EDITOR_V1__) return;
    global.__OLLI_AUTHORITATIVE_SCHEDULE_EDITOR_V1__ = true;

    const basePrepareAdd = global.olliPrepareStudentAddExtra;
    const baseGetAdd = global.olliGetStudentAddExtra;
    const basePrepareInfo = global.olliPrepareInfoExtra;
    const baseGetInfo = global.olliGetInfoExtra;

    global.olliPrepareStudentAddExtra = function(type) {
      if (typeof basePrepareAdd === 'function') basePrepareAdd.apply(this, arguments);
      studentAddDivision = type === 'kinder' ? 'kinder' : 'elementary';
      scheduleStates.student = emptyScheduleState();
      renderSchedule('student');
    };
    global.olliGetStudentAddExtra = function(type) {
      const base = typeof baseGetAdd === 'function' ? (baseGetAdd.apply(this, arguments) || {}) : {};
      const fields = lessonFieldsFromState(scheduleStates.student);
      return Object.assign({}, base, fields, { class_time: fields.lesson_time });
    };
    global.olliPrepareInfoExtra = function(type, student) {
      if (typeof basePrepareInfo === 'function') basePrepareInfo.apply(this, arguments);
      const kind = type === 'kinder' ? 'kinder' : 'elementary';
      scheduleStates[kind] = stateFromStudent(student || {});
      renderSchedule(kind);
    };
    global.olliGetInfoExtra = function(type) {
      let base = {};
      try {
        base = typeof baseGetInfo === 'function' ? (baseGetInfo.apply(this, arguments) || {}) : {};
      } catch (error) {
        // PC 학생정보 카드는 기존 수동 담임 선택 DOM을 사용하지 않습니다.
        // 레거시 extra 수집기가 제거된 담임 선택창을 참조해도 저장 전체를 막지 않습니다.
        console.warn('PC 학생정보 레거시 추가정보 수집 건너뜀:', error && (error.message || error));
      }
      const kind = type === 'kinder' ? 'kinder' : 'elementary';
      const fields = lessonFieldsFromState(scheduleStates[kind]);
      const result = Object.assign({}, base, fields, { class_time: fields.lesson_time });
      // 학생정보에서는 담임을 수정하지 않습니다. 담임의 유일한 원본은 시간표 1회차 반입니다.
      delete result.teacher;
      delete result.homeroom_teacher;
      return result;
    };

    global.toggleStudentModalDay = (day) => toggleDay('student', day);
    global.toggleElementaryInfoDay = (day) => toggleDay('elementary', day);
    global.toggleKinderInfoDay = (day) => toggleDay('kinder', day);
    global.toggleStudentModalTime = (time) => toggleTime('student', time);
    global.toggleElementaryInfoTime = (time) => toggleTime('elementary', time);
    global.toggleKinderInfoTime = (time) => toggleTime('kinder', time);
    global.olliGetStudentAddSchedulePairs = () => schedulePairsFromState(scheduleStates.student);
    global.olliGetInfoSchedulePairs = (type) => schedulePairsFromState(scheduleStates[type === 'kinder' ? 'kinder' : 'elementary']);
    global.olliSchedulePairsFromLessonFields = pairsFromLessonFields;
  }

  function selectedAttendanceStudentId() {
    const row = document.querySelector('#recordList .pcAttendanceSelected[data-pc-attendance-student-id], #recordList .pcAttendanceSelected');
    const fromData = clean(row && (row.dataset.pcAttendanceStudentId || row.getAttribute('data-pc-attendance-student-id')));
    if (fromData) return fromData;
    const onclick = clean(row && row.getAttribute('onclick'));
    const match = onclick.match(/handleStudentRowClick\(event,'([^']+)'\)/);
    return match ? match[1] : '';
  }

  function installStyles() {
    if (document.getElementById('olliPcStudentInfoCardStyle')) return;
    const style = document.createElement('style');
    style.id = 'olliPcStudentInfoCardStyle';
    style.textContent = `
      #recordRoomScreen .pcAttendanceStudentInfoBtn{height:32px;padding:0 12px;border:1px solid #e6e9ed;border-radius:999px;background:#fff;color:#5f6670;font:inherit;font-size:11px;font-weight:720;cursor:pointer;white-space:nowrap;}
      #recordRoomScreen .pcAttendanceStudentInfoBtn:hover{background:#f6f7f8;color:#222;}
      #recordRoomScreen .pcStudentInfoCardViewport{flex:1;min-height:0;overflow-y:auto;padding:18px 20px 22px;background:#fff;box-sizing:border-box;scrollbar-width:none;}
      #recordRoomScreen .pcStudentInfoCardViewport::-webkit-scrollbar{display:none;}
      #recordRoomScreen .pcStudentInfoCard{width:min(760px,100%);margin:0 auto;padding:4px 2px 12px;box-sizing:border-box;}
      #recordRoomScreen .pcStudentInfoCardIntro{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin:0 0 18px;padding:0 2px 14px;border-bottom:1px solid #f0f1f3;}
      #recordRoomScreen .pcStudentInfoCardIntro strong{font-size:16px;font-weight:820;color:#25282d;letter-spacing:-.035em;}
      #recordRoomScreen .pcStudentInfoCardIntro span{font-size:10.5px;font-weight:600;color:#a0a5ad;}
      #recordRoomScreen .pcStudentInfoForm{display:grid;gap:14px;}
      #recordRoomScreen .pcStudentInfoGrid3{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(82px,.7fr) minmax(82px,.7fr);gap:9px;}
      #recordRoomScreen .pcStudentInfoGrid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:9px;}
      #recordRoomScreen .pcStudentInfoField{min-width:0;}
      #recordRoomScreen .pcStudentInfoField>.modalLabel{display:block!important;margin:0 0 6px 2px!important;color:#7b8189;font-size:10.5px;font-weight:680;line-height:1.2;}
      #recordRoomScreen .pcStudentInfoField .modalInput{width:100%;height:40px;min-width:0;border:1px solid #e4e6e9;border-radius:12px;background:#fff;padding:0 11px;font-size:12px;box-sizing:border-box;outline:none;}
      #recordRoomScreen .pcStudentInfoField .modalInput:focus{border-color:#b8d6f7;box-shadow:0 0 0 3px rgba(22,135,255,.06);}
      #recordRoomScreen .pcStudentInfoSchedule{padding:14px;border-radius:16px;background:#fafbfc;border:1px solid #eef0f3;}
      #recordRoomScreen .pcStudentInfoScheduleTitle{margin-bottom:9px;color:#5f6670;font-size:11px;font-weight:760;}
      #recordRoomScreen .pcStudentInfoSchedule .infoDayToggleRow{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:5px;}
      #recordRoomScreen .pcStudentInfoSchedule .infoTimeToggleRow{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:5px;margin-top:7px;}
      #recordRoomScreen .pcStudentInfoSchedule .infoDayBtn,#recordRoomScreen .pcStudentInfoSchedule .infoTimeBtn{height:34px;min-width:0;border:0;border-radius:10px;background:#f0f2f4;color:#707780;font:inherit;font-size:10.5px;font-weight:680;cursor:pointer;}
      #recordRoomScreen .pcStudentInfoSchedule .infoDayBtn.active,#recordRoomScreen .pcStudentInfoSchedule .infoTimeBtn.active{background:#23262a;color:#fff;}
      #recordRoomScreen .pcStudentInfoSchedule .infoDayBtn.activeDayForTime{box-shadow:inset 0 0 0 2px #8cc4ff;}
      #recordRoomScreen .pcStudentInfoSchedule .infoTimeHint{grid-column:1/-1;min-height:34px;border-radius:10px;background:#f3f4f5;color:#a1a6ad;font-size:10.5px;display:flex;align-items:center;justify-content:center;}
      #recordRoomScreen .pcStudentInfoCard #elementaryGroupToggleRow{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px;}
      #recordRoomScreen .pcStudentInfoCard .infoToggleBtn.groupIconChoiceBtn{height:36px;border:0;border-radius:11px;background:#f0f2f4;color:#707780;font-size:11px;font-weight:720;cursor:pointer;}
      #recordRoomScreen .pcStudentInfoCard .infoToggleBtn.groupIconChoiceBtn.active{background:#23262a;color:#fff;}
      #recordRoomScreen .pcStudentInfoCard .infoTeacherSelectBox{height:40px;border-radius:12px;border-color:#e4e6e9;font-size:12px;}
      #recordRoomScreen .pcStudentInfoTeacherReadonly{height:40px;display:flex;align-items:center;padding:0 11px;border:1px solid #e4e6e9;border-radius:12px;background:#f6f7f8;color:#555c65;font-size:12px;font-weight:700;box-sizing:border-box;}
      #recordRoomScreen .pcStudentInfoTeacherReadonly.isEmpty{color:#a0a5ad;font-weight:600;}
      #recordRoomScreen .pcStudentInfoActions{display:flex;justify-content:flex-end;gap:8px;padding-top:4px;}
      #recordRoomScreen .pcStudentInfoActionBtn{height:38px;padding:0 16px;border:0;border-radius:12px;background:#f0f2f4;color:#555c65;font:inherit;font-size:11px;font-weight:760;cursor:pointer;}
      #recordRoomScreen .pcStudentInfoActionBtn.primary{background:#1687ff;color:#fff;}
      #recordRoomScreen .pcStudentInfoActionBtn:disabled{opacity:.55;cursor:default;}
      #recordRoomScreen .pcStudentInfoLoading{flex:1;display:flex;align-items:center;justify-content:center;color:#9aa0a8;font-size:12px;}
    `;
    document.head.appendChild(style);
  }

  function infoHeadHtml(mode) {
    const button = mode === 'info'
      ? '<button type="button" class="pcAttendanceStudentInfoBtn" onclick="closeOlliPcStudentInfoCard()">관찰기록</button>'
      : '<button type="button" class="pcAttendanceStudentInfoBtn" onclick="openOlliPcStudentInfoCard()">학생정보</button>';
    return `<div class="pcAttendanceDetailHead"><div class="pcAttendanceDetailTitle">관찰기록</div>${button}</div>`;
  }

  function ensureStudentInfoButton() {
    const panel = document.getElementById('pcAttendanceDetailPanel');
    if (!panel || panel.querySelector('.pcStudentInfoCardViewport')) return;
    const head = panel.querySelector('.pcAttendanceDetailHead');
    if (!head) return;
    const studentId = selectedAttendanceStudentId();
    let btn = head.querySelector('.pcAttendanceStudentInfoBtn');
    if (!studentId) {
      if (btn) btn.remove();
      return;
    }
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pcAttendanceStudentInfoBtn';
      btn.textContent = '학생정보';
      btn.addEventListener('click', () => global.openOlliPcStudentInfoCard(studentId));
      head.appendChild(btn);
    }
  }

  function renderGroupButtons() {
    return ['1','2','3','4','5','6'].map((group, i) =>
      `<button type="button" class="infoToggleBtn groupIconChoiceBtn" data-group="${group}" onclick="selectElementaryGroup('${group}')">${String.fromCharCode(65 + i)}</button>`
    ).join('');
  }

  function elementaryCardHtml(student) {
    return `<div class="pcStudentInfoCardViewport"><div class="pcStudentInfoCard" data-division="elementary">
      <div class="pcStudentInfoCardIntro"><strong>${esc(student.name || '학생')} 학생정보</strong><span>요일·시간은 시간표 기준으로 저장됩니다.</span></div>
      <div class="pcStudentInfoForm">
        <div class="pcStudentInfoGrid3">
          <div class="pcStudentInfoField"><div class="modalLabel">이름</div><input class="modalInput" id="elementaryInfoNameInput"></div>
          <div class="pcStudentInfoField"><div class="modalLabel">성향</div><div id="elementaryPersonalityToggleRow" class="infoTeacherToggleRow infoPersonalityToggleRow"></div></div>
          <div class="pcStudentInfoField"><div class="modalLabel">담임 · 시간표 1회차 기준</div><div class="pcStudentInfoTeacherReadonly ${clean(student.__olli_timetable_teacher) ? '' : 'isEmpty'}">${esc(student.__olli_timetable_teacher || '미지정')}</div></div>
        </div>
        <div class="pcStudentInfoGrid3">
          <div class="pcStudentInfoField"><div class="modalLabel">학교</div><input class="modalInput" id="elementarySchoolInput"></div>
          <div class="pcStudentInfoField"><div class="modalLabel">학년</div><input class="modalInput" id="elementaryGradeInput" inputmode="numeric" onfocus="focusElementaryGradeInput(this)" oninput="syncElementaryInfoAgeFromGrade()" onblur="blurElementaryInfoGradeInput()"></div>
          <div class="pcStudentInfoField"><div class="modalLabel">나이</div><input class="modalInput" id="elementaryAgeInput" readonly></div>
        </div>
        <div class="pcStudentInfoGrid3">
          <div class="pcStudentInfoField"><div class="modalLabel">등록 년</div><input class="modalInput" id="elementaryInfoYearInput" type="number" min="1900" max="2100"></div>
          <div class="pcStudentInfoField"><div class="modalLabel">월</div><input class="modalInput" id="elementaryInfoMonthInput" type="number" min="1" max="12"></div>
          <div class="pcStudentInfoField"><div class="modalLabel">일</div><input class="modalInput" id="elementaryInfoDayInput" type="number" min="1" max="31"></div>
        </div>
        <div class="pcStudentInfoSchedule"><div class="pcStudentInfoScheduleTitle">요일 / 시간</div><div id="elementaryLessonDayToggleRow" class="infoDayToggleRow"></div><div id="elementaryLessonTimeToggleRow" class="infoTimeToggleRow"></div></div>
        <div class="pcStudentInfoField"><div class="modalLabel">그룹</div><div id="elementaryGroupToggleRow" class="infoToggleRow">${renderGroupButtons()}</div></div>
        <div class="pcStudentInfoActions"><button type="button" class="pcStudentInfoActionBtn" onclick="closeOlliPcStudentInfoCard()">취소</button><button type="button" class="pcStudentInfoActionBtn primary" id="pcStudentInfoSaveBtn" onclick="saveOlliPcStudentInfoCard()">저장</button></div>
      </div>
    </div></div>`;
  }

  function kinderCardHtml(student) {
    return `<div class="pcStudentInfoCardViewport"><div class="pcStudentInfoCard" data-division="kinder">
      <div class="pcStudentInfoCardIntro"><strong>${esc(student.name || '학생')} 학생정보</strong><span>요일·시간은 시간표 기준으로 저장됩니다.</span></div>
      <div class="pcStudentInfoForm">
        <div class="pcStudentInfoGrid3">
          <div class="pcStudentInfoField"><div class="modalLabel">이름</div><input class="modalInput" id="kinderInfoNameInput"></div>
          <div class="pcStudentInfoField"><div class="modalLabel">성향</div><div id="kinderPersonalityToggleRow" class="infoTeacherToggleRow infoPersonalityToggleRow"></div></div>
          <div class="pcStudentInfoField"><div class="modalLabel">담임 · 시간표 1회차 기준</div><div class="pcStudentInfoTeacherReadonly ${clean(student.__olli_timetable_teacher) ? '' : 'isEmpty'}">${esc(student.__olli_timetable_teacher || '미지정')}</div></div>
        </div>
        <div class="pcStudentInfoGrid2">
          <div class="pcStudentInfoField"><div class="modalLabel">유치원</div><input class="modalInput" id="kinderKindergartenInput"></div>
          <div class="pcStudentInfoField"><div class="modalLabel">나이</div><input class="modalInput" id="kinderAgeInput" type="number" min="1" max="8"></div>
        </div>
        <div class="pcStudentInfoGrid3">
          <div class="pcStudentInfoField"><div class="modalLabel">등록 년</div><input class="modalInput" id="kinderInfoYearInput" type="number" min="1900" max="2100"></div>
          <div class="pcStudentInfoField"><div class="modalLabel">월</div><input class="modalInput" id="kinderInfoMonthInput" type="number" min="1" max="12"></div>
          <div class="pcStudentInfoField"><div class="modalLabel">일</div><input class="modalInput" id="kinderInfoDayInput" type="number" min="1" max="31"></div>
        </div>
        <input id="kinderLessonDayInput" type="hidden">
        <div class="pcStudentInfoSchedule"><div class="pcStudentInfoScheduleTitle">요일 / 시간</div><div id="kinderLessonDayToggleRow" class="infoDayToggleRow"></div><div id="kinderLessonTimeToggleRow" class="infoTimeToggleRow"></div></div>
        <div class="pcStudentInfoActions"><button type="button" class="pcStudentInfoActionBtn" onclick="closeOlliPcStudentInfoCard()">취소</button><button type="button" class="pcStudentInfoActionBtn primary" id="pcStudentInfoSaveBtn" onclick="saveOlliPcStudentInfoCard()">저장</button></div>
      </div>
    </div></div>`;
  }

  function setDateInputs(prefix, student) {
    const enrolled = clean(student && student.enrolled_at).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const year = enrolled ? enrolled[1] : clean(student && student.year);
    const month = enrolled ? String(Number(enrolled[2])) : clean(student && student.month);
    const day = enrolled ? String(Number(enrolled[3])) : clean(student && student.day);
    const y = document.getElementById(`${prefix}YearInput`);
    const m = document.getElementById(`${prefix}MonthInput`);
    const d = document.getElementById(`${prefix}DayInput`);
    if (y) y.value = year || '';
    if (m) m.value = month || '';
    if (d) d.value = day || '';
  }

  function readDateInputs(prefix) {
    const y = Number(document.getElementById(`${prefix}YearInput`)?.value || 0);
    const m = Number(document.getElementById(`${prefix}MonthInput`)?.value || 0);
    const d = Number(document.getElementById(`${prefix}DayInput`)?.value || 0);
    if (!y || y < 1900 || y > 2100 || !m || m < 1 || m > 12 || !d || d < 1 || d > 31) return null;
    const test = new Date(y, m - 1, d);
    if (test.getFullYear() !== y || test.getMonth() !== m - 1 || test.getDate() !== d) return null;
    return { year: y, month: String(m), day: String(d), enrolled_at: `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}` };
  }

  async function renderStudentInfoCard(student, enrollments, teacherAssignments) {
    const panel = document.getElementById('pcAttendanceDetailPanel');
    if (!panel) throw new Error('학생정보를 표시할 관찰기록 카드를 찾지 못했습니다.');
    const division = student.type === 'kinder' ? 'kinder' : 'elementary';
    const fields = lessonFieldsFromEnrollments(enrollments);
    const timetableTeacher = resolveTimetableTeacherName(division, enrollments, teacherAssignments);
    const authoritativeStudent = Object.assign({}, student, fields, {
      class_time: fields.lesson_time,
      __olli_timetable_teacher: timetableTeacher,
      __olli_authoritative_enrollments: enrollments
    });
    cardState.student = authoritativeStudent;
    cardState.enrollments = enrollments;
    try { studentInfoModalTarget = authoritativeStudent; } catch (_) {}

    panel.innerHTML = infoHeadHtml('info') + (division === 'kinder' ? kinderCardHtml(authoritativeStudent) : elementaryCardHtml(authoritativeStudent));

    if (division === 'elementary') {
      try {
        elementaryInfoDraft = { group: authoritativeStudent.group || '', personality: authoritativeStudent.personality || '' };
      } catch (_) {}
      const name = document.getElementById('elementaryInfoNameInput');
      const school = document.getElementById('elementarySchoolInput');
      const grade = document.getElementById('elementaryGradeInput');
      const age = document.getElementById('elementaryAgeInput');
      if (name) name.value = authoritativeStudent.name || '';
      if (school) school.value = authoritativeStudent.school || '';
      if (grade) grade.value = typeof global.formatElementaryGradeInputValue === 'function' ? global.formatElementaryGradeInputValue(authoritativeStudent.grade) : (authoritativeStudent.grade || '');
      if (age) age.value = typeof global.formatElementaryAgeInputValue === 'function'
        ? global.formatElementaryAgeInputValue((typeof global.getElementaryAgeFromGrade === 'function' ? global.getElementaryAgeFromGrade(authoritativeStudent.grade) : '') || authoritativeStudent.age || '')
        : (authoritativeStudent.age || '');
      setDateInputs('elementaryInfo', authoritativeStudent);
      if (typeof global.olliPrepareInfoExtra === 'function') global.olliPrepareInfoExtra('elementary', authoritativeStudent);
      if (typeof global.syncElementaryInfoButtons === 'function') global.syncElementaryInfoButtons();
    } else {
      try { kinderInfoDraft = { personality: authoritativeStudent.personality || '' }; } catch (_) {}
      const name = document.getElementById('kinderInfoNameInput');
      const kindergarten = document.getElementById('kinderKindergartenInput');
      const age = document.getElementById('kinderAgeInput');
      const hiddenDay = document.getElementById('kinderLessonDayInput');
      if (name) name.value = authoritativeStudent.name || '';
      if (kindergarten) kindergarten.value = authoritativeStudent.kindergarten || '';
      if (age) age.value = authoritativeStudent.age || '';
      if (hiddenDay) hiddenDay.value = fields.lesson_day;
      setDateInputs('kinderInfo', authoritativeStudent);
      if (typeof global.olliPrepareInfoExtra === 'function') global.olliPrepareInfoExtra('kinder', authoritativeStudent);
    }
  }

  async function openStudentInfoCard(studentId) {
    let id = clean(studentId) || selectedAttendanceStudentId();
    if (!id && cardState.studentId) id = cardState.studentId;
    if (!id) return;
    let student = typeof global.findStudentById === 'function' ? global.findStudentById(id) : null;
    if (!student) return;

    const shell = document.getElementById('olliPcShell');
    if (shell && clean(shell.dataset.pcSection) !== 'attendance' && typeof global.pcOpenSection === 'function') {
      await Promise.resolve(global.pcOpenSection('attendance'));
      if (typeof global.pcSelectAttendanceStudent === 'function') await Promise.resolve(global.pcSelectAttendanceStudent(id));
    }

    const panel = document.getElementById('pcAttendanceDetailPanel');
    if (!panel) return;
    if (global.OlliPcAttendance && typeof global.OlliPcAttendance.unmountEditor === 'function') global.OlliPcAttendance.unmountEditor();
    cardState.studentId = id;
    cardState.loading = true;
    panel.innerHTML = infoHeadHtml('info') + '<div class="pcStudentInfoLoading">학생정보와 시간표를 불러오고 있습니다.</div>';
    try {
      const [enrollments, teacherAssignments] = await Promise.all([
        loadAuthoritativeSchedule(id),
        loadAuthoritativeTeacherAssignments()
      ]);
      student = typeof global.findStudentById === 'function' ? (global.findStudentById(id) || student) : student;
      if (cardState.studentId !== id) return;
      await renderStudentInfoCard(student, enrollments, teacherAssignments);
    } catch (error) {
      if (cardState.studentId !== id) return;
      panel.innerHTML = infoHeadHtml('info') + `<div class="pcStudentInfoLoading">${esc(error.message || '학생정보를 불러오지 못했습니다.')}</div>`;
    } finally {
      cardState.loading = false;
    }
  }

  async function closeStudentInfoCard() {
    const id = cardState.studentId || selectedAttendanceStudentId();
    cardState.studentId = '';
    cardState.student = null;
    cardState.enrollments = [];
    try { studentInfoModalTarget = null; } catch (_) {}
    if (id && typeof global.pcSelectAttendanceStudent === 'function') {
      await Promise.resolve(global.pcSelectAttendanceStudent(id));
      setTimeout(ensureStudentInfoButton, 0);
    }
  }

  async function saveStudentInfoCard() {
    if (cardState.saveInFlight || !cardState.student) return;
    const target = cardState.student;
    const division = target.type === 'kinder' ? 'kinder' : 'elementary';
    const saveBtn = document.getElementById('pcStudentInfoSaveBtn');
    cardState.saveInFlight = true;
    let saveStage = 'profile';
    let profileSaved = false;
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '저장 중...'; }
    try {
      const extra = typeof global.olliGetInfoExtra === 'function' ? (global.olliGetInfoExtra(division) || {}) : {};
      const pairs = typeof global.olliGetInfoSchedulePairs === 'function'
        ? global.olliGetInfoSchedulePairs(division)
        : pairsFromLessonFields(extra.lesson_day, extra.lesson_time || extra.class_time);
      const dateInfo = readDateInputs(division === 'kinder' ? 'kinderInfo' : 'elementaryInfo');
      if (!dateInfo) throw new Error('등록 날짜를 올바르게 입력해 주세요.');

      const profileBase = Object.assign({}, target);
      // 담임은 학생정보 저장 대상이 아닙니다. 시간표의 반 담당 정보만 원본으로 사용합니다.
      delete profileBase.__olli_timetable_teacher;
      delete profileBase.__olli_authoritative_enrollments;

      let profile;
      if (division === 'elementary') {
        const name = clean(document.getElementById('elementaryInfoNameInput')?.value);
        if (!name) throw new Error('학생 이름을 입력해 주세요.');
        const duplicate = typeof global.getStudentsByType === 'function' && global.getStudentsByType('elementary').some((item) => String(item.id) !== String(target.id) && clean(item.name) === name);
        if (duplicate) throw new Error('이미 등록된 학생 이름입니다.');
        const grade = typeof global.normalizeElementaryGradeValue === 'function' ? global.normalizeElementaryGradeValue(document.getElementById('elementaryGradeInput')?.value || '') : clean(document.getElementById('elementaryGradeInput')?.value);
        profile = Object.assign({}, profileBase, dateInfo, {
          name,
          group: (typeof elementaryInfoDraft !== 'undefined' && elementaryInfoDraft) ? (elementaryInfoDraft.group || '') : (target.group || ''),
          personality: (typeof elementaryInfoDraft !== 'undefined' && elementaryInfoDraft) ? (elementaryInfoDraft.personality || '') : (target.personality || ''),
          school: clean(document.getElementById('elementarySchoolInput')?.value),
          grade,
          age: typeof global.getElementaryAgeFromGrade === 'function' ? global.getElementaryAgeFromGrade(grade) : (target.age || ''),
          school_entry_year: typeof global.inferOlliSchoolEntryYearFromGrade === 'function' ? global.inferOlliSchoolEntryYearFromGrade(grade) : (target.school_entry_year || ''),
          className: '',
          lesson_day: target.lesson_day || '',
          lesson_time: target.lesson_time || '',
          class_time: target.lesson_time || target.class_time || ''
        });
        if (typeof global.elementaryGroupMonthsToText === 'function' && typeof global.getElementaryGroupFeedbackMonths === 'function') {
          const months = global.elementaryGroupMonthsToText(global.getElementaryGroupFeedbackMonths(profile.group, profile));
          profile.group_months = months;
          profile.feedback_months = months;
        }
      } else {
        const name = clean(document.getElementById('kinderInfoNameInput')?.value);
        if (!name) throw new Error('학생 이름을 입력해 주세요.');
        const duplicate = typeof global.getStudentsByType === 'function' && global.getStudentsByType('kinder').some((item) => String(item.id) !== String(target.id) && clean(item.name) === name);
        if (duplicate) throw new Error('이미 등록된 학생 이름입니다.');
        const age = clean(document.getElementById('kinderAgeInput')?.value);
        profile = Object.assign({}, profileBase, dateInfo, {
          name,
          kindergarten: clean(document.getElementById('kinderKindergartenInput')?.value),
          age,
          birth_year: typeof global.inferOlliBirthYearFromAge === 'function' ? global.inferOlliBirthYearFromAge(age) : (target.birth_year || ''),
          personality: Object.prototype.hasOwnProperty.call(extra, 'personality') ? extra.personality : ((typeof kinderInfoDraft !== 'undefined' && kinderInfoDraft) ? (kinderInfoDraft.personality || '') : (target.personality || '')),
          lesson_day: target.lesson_day || '',
          lesson_time: target.lesson_time || '',
          class_time: target.lesson_time || target.class_time || ''
        });
      }

      if (typeof global.ensureStudentSavedToSupabase !== 'function') throw new Error('학생정보 저장 함수를 찾지 못했습니다.');
      const scheduleChanged = !schedulePairsEqual(pairs, cardState.enrollments);
      const savedStudent = await global.ensureStudentSavedToSupabase(profile);
      profileSaved = true;
      if (scheduleChanged) {
        saveStage = 'schedule';
        await setAuthoritativeSchedule(savedStudent.id, pairs);
      }
      saveStage = 'reload';
      if (typeof global.loadStudentsFromSupabase === 'function') await global.loadStudentsFromSupabase();
      if (typeof global.showPushToast === 'function') {
        global.showPushToast(scheduleChanged ? '학생정보와 시간표를 저장했어요.' : '학생정보를 저장했어요.');
      }
      const id = savedStudent.id;
      cardState.studentId = '';
      cardState.student = null;
      cardState.enrollments = [];
      try { studentInfoModalTarget = null; } catch (_) {}
      if (typeof global.pcSelectAttendanceStudent === 'function') await Promise.resolve(global.pcSelectAttendanceStudent(id));
      if (global.OlliPcAttendance && typeof global.OlliPcAttendance.renderList === 'function') global.OlliPcAttendance.renderList();
      setTimeout(ensureStudentInfoButton, 0);
    } catch (error) {
      const message = error.message || error;
      if (saveStage === 'schedule' && profileSaved) {
        alert(`학생정보는 저장되었지만 시간표 저장에 실패했어요.\n\n${message}\n\n시간표 변경예약이 있다면 시간표 페이지에서 예약 내용을 먼저 확인해 주세요.`);
      } else if (saveStage === 'reload' && profileSaved) {
        alert(`학생정보는 저장되었지만 화면 새로고침 중 오류가 발생했어요.\n\n${message}`);
      } else {
        alert(`학생정보 서버 저장 중 오류가 발생했어요.\n\n${message}`);
      }
    } finally {
      cardState.saveInFlight = false;
      if (saveBtn && saveBtn.isConnected) { saveBtn.disabled = false; saveBtn.textContent = '저장'; }
    }
  }

  async function openStudentInfoFromLegacyTarget(target) {
    const student = target || (() => {
      try { return typeof getStudentInfoModalTarget === 'function' ? getStudentInfoModalTarget() : null; } catch (_) { return null; }
    })();
    if (!student || !student.id) return;
    try { studentInfoModalTarget = student; } catch (_) {}
    if (typeof global.pcOpenSection === 'function') await Promise.resolve(global.pcOpenSection('attendance'));
    if (typeof global.pcSelectAttendanceStudent === 'function') await Promise.resolve(global.pcSelectAttendanceStudent(student.id));
    await openStudentInfoCard(student.id);
  }

  function removeLegacyInfoModals() {
    ['elementaryInfoModal', 'kinderInfoModal'].forEach((id) => document.getElementById(id)?.remove());
  }

  function wrapStudentRegistration() {
    if (global.confirmStudent && !global.confirmStudent.__olliScheduleLinked) {
      const original = global.confirmStudent;
      const wrapped = async function linkedStudentRegistration() {
        const type = (() => {
          try { return currentRecordView === 'kinder' ? 'kinder' : 'elementary'; } catch (_) { return 'elementary'; }
        })();
        const name = clean(document.getElementById('studentNameInput')?.value);
        const year = Number(document.getElementById('studentYearBadge')?.value || 0);
        const month = Number(document.getElementById('studentMonthInput')?.value || 0);
        const day = Number(document.getElementById('studentDayInput')?.value || 0);
        const extra = typeof global.olliGetStudentAddExtra === 'function' ? (global.olliGetStudentAddExtra(type) || {}) : {};
        const pairs = typeof global.olliGetStudentAddSchedulePairs === 'function'
          ? global.olliGetStudentAddSchedulePairs()
          : pairsFromLessonFields(extra.lesson_day, extra.lesson_time || extra.class_time);
        const beforeIds = new Set((typeof global.getAllStudents === 'function' ? global.getAllStudents() : []).map((s) => String(s.id || '')));
        const result = await original.apply(this, arguments);
        if (!name || !year || !month || !day) return result;
        const students = typeof global.getStudentsByType === 'function' ? global.getStudentsByType(type) : [];
        const created = students.find((s) => !beforeIds.has(String(s.id || '')) && clean(s.name) === name && Number(s.year) === year && Number(s.month) === month && Number(s.day) === day);
        if (!created || !created.id) return result;
        try {
          await setAuthoritativeSchedule(created.id, pairs);
          if (typeof global.loadStudentsFromSupabase === 'function') await global.loadStudentsFromSupabase();
          if (global.OlliPcAttendance && typeof global.OlliPcAttendance.renderList === 'function') global.OlliPcAttendance.renderList();
        } catch (error) {
          alert(`학생은 등록되었지만 시간표 반영에 실패했어요.\n\n${error.message || error}\n\n학생정보에서 다시 저장하거나 시간표에서 확인해 주세요.`);
        }
        return result;
      };
      wrapped.__olliScheduleLinked = true;
      global.confirmStudent = wrapped;
    }
  }

  function installLegacyInfoRoutes() {
    global.openCurrentStudentInfoModal = function() {
      const student = (() => {
        try { return currentMemoStudent || null; } catch (_) { return null; }
      })();
      return openStudentInfoFromLegacyTarget(student);
    };
    global.openElementaryInfoModal = function() {
      let target = null;
      try { target = typeof getStudentInfoModalTarget === 'function' ? getStudentInfoModalTarget('elementary') : studentInfoModalTarget; } catch (_) {}
      return openStudentInfoFromLegacyTarget(target);
    };
    global.openKinderInfoModal = function() {
      let target = null;
      try { target = typeof getStudentInfoModalTarget === 'function' ? getStudentInfoModalTarget('kinder') : studentInfoModalTarget; } catch (_) {}
      return openStudentInfoFromLegacyTarget(target);
    };
    global.closeElementaryInfoModal = closeStudentInfoCard;
    global.closeKinderInfoModal = closeStudentInfoCard;
    global.saveElementaryInfo = saveStudentInfoCard;
    global.saveKinderInfo = saveStudentInfoCard;
  }

  function observeAttendancePanel() {
    if (cardState.observer) return;
    cardState.observer = new MutationObserver(() => setTimeout(ensureStudentInfoButton, 0));
    cardState.observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('click', (event) => {
      if (event.target.closest('#recordList .elementaryStudentRow, #recordList .kinderStudentRow')) setTimeout(ensureStudentInfoButton, 0);
    }, true);
  }

  function install() {
    if (cardState.installed) return;
    cardState.installed = true;
    installStyles();
    installAuthoritativeScheduleEditor();
    wrapStudentRegistration();
    installLegacyInfoRoutes();
    removeLegacyInfoModals();
    observeAttendancePanel();
    setTimeout(ensureStudentInfoButton, 0);
  }

  global.loadOlliStudentAuthoritativeSchedule = loadAuthoritativeSchedule;
  global.setOlliStudentAuthoritativeSchedule = setAuthoritativeSchedule;
  global.saveOlliStudentScheduleFromInfo = function(studentId, lessonDay, lessonTime, options) {
    const pairs = Array.isArray(options && options.pairs) ? options.pairs : pairsFromLessonFields(lessonDay, lessonTime);
    return setAuthoritativeSchedule(studentId, pairs);
  };
  global.openOlliPcStudentInfoCard = openStudentInfoCard;
  global.closeOlliPcStudentInfoCard = closeStudentInfoCard;
  global.saveOlliPcStudentInfoCard = saveStudentInfoCard;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(install, 0), { once: true });
  else setTimeout(install, 0);
})(window);
