(function timetableAttendanceRegisterModule(global) {
  'use strict';

  function create(ctx) {
    const {
      state, service, clean, pad, divisionOf, esc, todayKey,
      notify, divisionLabel, ensureUi, renderAttendanceHeader
    } = ctx;

  function monthLabel(value) {
    const match = clean(value).match(/^(\d{4})-(\d{2})$/);
    return match ? `${Number(match[1])}년 ${Number(match[2])}월` : '';
  }

  function shiftAttendanceMonth(amount) {
    const match = state.attendanceMonth.match(/^(\d{4})-(\d{2})$/);
    const date = match ? new Date(Number(match[1]), Number(match[2]) - 1 + amount, 1) : new Date();
    state.attendanceMonth = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
    state.attendanceRows = [];
    state.attendanceRowsMonth = '';
    state.attendanceCalendarDays = [];
    state.attendanceCalendarMonth = '';
    loadAttendanceRegister();
  }

  function monthRange(month) {
    const match = clean(month).match(/^(\d{4})-(\d{2})$/);
    const year = match ? Number(match[1]) : new Date().getFullYear();
    const monthNumber = match ? Number(match[2]) : new Date().getMonth() + 1;
    const lastDay = new Date(year, monthNumber, 0).getDate();
    return {
      start: `${year}-${pad(monthNumber)}-01`,
      end: `${year}-${pad(monthNumber)}-${pad(lastDay)}`
    };
  }


  const ATTENDANCE_CALENDAR_CACHE_PREFIX = 'olli_schedule_attendance_calendar_cache_v1';
  let attendanceFitFrame = 0;
  let lastAttendanceRenderSignature = '';

  function currentAcademyId() {
    try {
      if (typeof global.getOlliCurrentAcademyId === 'function') {
        const id = clean(global.getOlliCurrentAcademyId());
        if (id) return id;
      }
    } catch (_) {}
    return clean(localStorage.getItem('olli_current_academy_id'));
  }

  function attendanceCalendarCacheKey(month) {
    return `${ATTENDANCE_CALENDAR_CACHE_PREFIX}_${currentAcademyId() || 'unknown'}_${clean(month)}`;
  }

  function readAttendanceCalendarCache(month) {
    try {
      const cached = JSON.parse(localStorage.getItem(attendanceCalendarCacheKey(month)) || 'null');
      if (!cached || cached.academy_id !== currentAcademyId() || cached.year_month !== clean(month)) return null;
      return Array.isArray(cached.days) ? cached.days : null;
    } catch (_) {
      return null;
    }
  }

  function writeAttendanceCalendarCache(month, days) {
    try {
      localStorage.setItem(attendanceCalendarCacheKey(month), JSON.stringify({
        academy_id: currentAcademyId(),
        year_month: clean(month),
        cached_at: new Date().toISOString(),
        days: Array.isArray(days) ? days : []
      }));
    } catch (_) {}
  }

  function attendanceRowsFingerprint(rows) {
    return JSON.stringify((Array.isArray(rows) ? rows : []).map((row) => [
      clean(row && row.id), clean(row && row.student_id), clean(row && row.session_date).slice(0, 10),
      Number(row && row.time_slot || 0), clean(row && row.class_group), clean(row && row.session_kind), row && row.attended !== false
    ]));
  }

  function attendanceCalendarFingerprint(rows) {
    return JSON.stringify((Array.isArray(rows) ? rows : []).map((row) => [
      clean(row && row.session_date).slice(0, 10), !!(row && row.is_holiday), clean(row && row.name)
    ]));
  }

  function attendanceRosterFingerprint() {
    return JSON.stringify(service.activeStudents().map((student) => [
      clean(student && student.id), clean(student && student.name), divisionOf(student),
      clean(student && student.school), clean(student && student.kindergarten),
      clean(student && student.grade), clean(student && student.age), clean(student && student.personality)
    ]));
  }

  function attendanceRenderSignature() {
    return JSON.stringify([
      state.attendanceMonth, state.attendanceDivision, state.attendanceSort, state.sidebarQuery,
      state.attendanceRowsMonth, attendanceRowsFingerprint(state.attendanceRows),
      state.attendanceCalendarMonth, attendanceCalendarFingerprint(state.attendanceCalendarDays),
      attendanceRosterFingerprint()
    ]);
  }

  function scheduleAttendanceFitText(root) {
    if (attendanceFitFrame) cancelAnimationFrame(attendanceFitFrame);
    attendanceFitFrame = requestAnimationFrame(() => {
      attendanceFitFrame = 0;
      if (!root || !root.isConnected || state.pane !== 'attendance') return;
      if (typeof global.settingsAttendanceScheduleFitText === 'function') global.settingsAttendanceScheduleFitText(root);
    });
  }

  async function loadAttendanceRegister() {
    if (!state.active || state.view !== 'schedule' || state.pane !== 'attendance') return;
    const month = state.attendanceMonth;

    // 1. 네트워크를 기다리지 않고 로컬 출석/휴일 캐시를 먼저 화면 상태에 넣습니다.
    if (state.attendanceRowsMonth !== month && typeof service.getCachedAttendanceMonth === 'function') {
      const cachedRows = service.getCachedAttendanceMonth(month);
      if (Array.isArray(cachedRows)) {
        state.attendanceRows = cachedRows;
        state.attendanceRowsMonth = month;
      } else {
        state.attendanceRows = [];
        state.attendanceRowsMonth = '';
      }
    }
    if (state.attendanceCalendarMonth !== month) {
      const cachedCalendar = readAttendanceCalendarCache(month);
      if (Array.isArray(cachedCalendar)) {
        state.attendanceCalendarDays = cachedCalendar;
        state.attendanceCalendarMonth = month;
      } else {
        state.attendanceCalendarDays = [];
        state.attendanceCalendarMonth = '';
      }
    }

    const beforeRows = state.attendanceRowsMonth === month ? attendanceRowsFingerprint(state.attendanceRows) : '';
    const beforeCalendar = state.attendanceCalendarMonth === month ? attendanceCalendarFingerprint(state.attendanceCalendarDays) : '';

    // 로컬 상태를 즉시 한 번만 그립니다. 별도 로딩 화면은 사용하지 않습니다.
    renderAttendanceRegister();

    const token = ++state.attendanceLoadToken;
    state.attendanceLoading = true;
    try {
      const range = monthRange(month);
      const [rows, calendarDays] = await Promise.all([
        service.loadAttendanceMonth(month),
        typeof service.loadCalendarRange === 'function' ? service.loadCalendarRange(range.start, range.end) : Promise.resolve([])
      ]);
      if (token !== state.attendanceLoadToken || state.attendanceMonth !== month) return;

      const freshRows = Array.isArray(rows) ? rows : [];
      const freshCalendar = Array.isArray(calendarDays) ? calendarDays : [];
      const rowsChanged = beforeRows !== attendanceRowsFingerprint(freshRows);
      const calendarChanged = beforeCalendar !== attendanceCalendarFingerprint(freshCalendar);

      state.attendanceRows = freshRows;
      state.attendanceRowsMonth = month;
      state.attendanceCalendarDays = freshCalendar;
      state.attendanceCalendarMonth = month;
      writeAttendanceCalendarCache(month, freshCalendar);

      // 서버 내용이 로컬과 실제로 달라진 경우에만 표를 다시 만듭니다.
      if (rowsChanged || calendarChanged) renderAttendanceRegister();
    } catch (error) {
      if (token !== state.attendanceLoadToken) return;
      const hasLocal = state.attendanceRowsMonth === month || state.attendanceCalendarMonth === month;
      if (!hasLocal) notify(error && (error.message || error) || '출석부를 불러오지 못했습니다.');
      else console.warn('출석부 백그라운드 최신 확인 실패:', error);
    } finally {
      if (token === state.attendanceLoadToken) state.attendanceLoading = false;
    }
  }

  function attendanceCalendarInfo(dateKey) {
    const rows = Array.isArray(state.attendanceCalendarDays) ? state.attendanceCalendarDays : [];
    return rows.find((item) => clean(item && item.session_date).slice(0, 10) === clean(dateKey).slice(0, 10)) || null;
  }

  function isAttendanceClosedDate(year, month, day) {
    const date = new Date(year, month - 1, day);
    if (date.getDay() === 0) return true;
    const key = `${year}-${pad(month)}-${pad(day)}`;
    const info = attendanceCalendarInfo(key);
    return !!(info && info.is_holiday === true);
  }

  function attendanceHolidayTitle(year, month, day) {
    const date = new Date(year, month - 1, day);
    if (date.getDay() === 0) return '일요일';
    const key = `${year}-${pad(month)}-${pad(day)}`;
    const info = attendanceCalendarInfo(key);
    return clean(info && info.name);
  }

  function attendanceStudents() {
    const query = clean(state.sidebarQuery);
    return service.activeStudents().filter((student) => {
      const division = divisionOf(student);
      return (state.attendanceDivision === 'combined' || division === state.attendanceDivision)
        && (!query || clean(student.name).includes(query));
    });
  }

  function attendanceRosterMeta(student) {
    const division = divisionOf(student);
    let school = clean(student && (division === 'kinder' ? (student.kindergarten || student.school) : student.school)).replace(/\s+/g, '');
    school = division === 'kinder'
      ? school.replace(/유치원/g, '')
      : school.replace(/초등학교|초등/g, '초').replace(/등학교/g, '');
    const gradeValue = clean(student && (division === 'kinder' ? student.age : student.grade)).replace(/\s+/g, '');
    const gradeNumber = (gradeValue.match(/\d+/) || [gradeValue])[0];
    return `${school}${gradeNumber}`;
  }

  function sortedAttendanceStudents() {
    const students = attendanceStudents().slice();
    const numberOf = (value) => Number((clean(value).match(/\d+/) || [9999])[0]);
    return students.sort((a, b) => {
      if (state.attendanceSort === 'name') return clean(a.name).localeCompare(clean(b.name), 'ko');
      const ad = divisionOf(a);
      const bd = divisionOf(b);
      if (ad !== bd) return ad === 'kinder' ? -1 : 1;
      return numberOf(ad === 'kinder' ? a.age : a.grade) - numberOf(bd === 'kinder' ? b.age : b.grade)
        || clean(a.name).localeCompare(clean(b.name), 'ko');
    });
  }

  function linkedAttendanceRegisterHtml() {
    const match = state.attendanceMonth.match(/^(\d{4})-(\d{2})$/);
    const year = match ? Number(match[1]) : new Date().getFullYear();
    const month = match ? Number(match[2]) : new Date().getMonth() + 1;
    const days = new Date(year, month, 0).getDate();
    const students = sortedAttendanceStudents();
    const rowsByStudentDate = new Map();
    state.attendanceRows.forEach((row) => {
      const key = `${clean(row.student_id)}|${clean(row.session_date).slice(0, 10)}`;
      const list = rowsByStudentDate.get(key) || [];
      list.push(row);
      rowsByStudentDate.set(key, list);
    });

    // 날짜별 휴일 정보를 한 번만 계산합니다. 기존에는 모든 학생의 모든 날짜 셀마다 배열 .find()를 반복했습니다.
    const calendarMap = new Map();
    (Array.isArray(state.attendanceCalendarDays) ? state.attendanceCalendarDays : []).forEach((item) => {
      const key = clean(item && item.session_date).slice(0, 10);
      if (key) calendarMap.set(key, item);
    });
    const dayMeta = Array.from({ length: days }, (_, index) => {
      const day = index + 1;
      const key = `${year}-${pad(month)}-${pad(day)}`;
      const date = new Date(year, month - 1, day);
      const info = calendarMap.get(key) || null;
      const sunday = date.getDay() === 0;
      return { day, key, closed: sunday || !!(info && info.is_holiday === true), title: sunday ? '일요일' : clean(info && info.name) };
    });

    const staticWidth = 20 + 42 + 51 + 20;
    const tableStyle = ` style="--attendance-static-col-width:${staticWidth}px;--attendance-date-col-count:${days};--attendance-date-col-width:calc((100% - ${staticWidth}px) / ${days});"`;
    const colGroup = '<colgroup><col class="noCol"><col class="nameCol"><col class="schoolGradeCol"><col class="personalityCol">'
      + Array.from({ length: days }, () => '<col class="dateCol">').join('') + '</colgroup>';
    const dayHeaders = dayMeta.map((meta) => `<th class="dateCol${meta.closed ? ' attendanceHolidayHead' : ''}"${meta.title ? ` title="${esc(meta.title)}"` : ''}>${meta.day}</th>`).join('');
    const schoolHeader = state.attendanceDivision === 'combined' ? '소속' : (state.attendanceDivision === 'kinder' ? '유치원/나이' : '학교/학년');
    const header = `<thead><tr><th class="noCol"></th><th class="nameCol">이름</th><th class="schoolGradeCol">${schoolHeader}</th><th class="personalityCol">성향</th>${dayHeaders}</tr></thead>`;
    const rowHtml = students.map((student, index) => {
      const dateCells = dayMeta.map((meta) => {
        if (meta.closed) return '<td class="dateCol attendanceHolidayCell" aria-disabled="true"></td>';
        const records = rowsByStudentDate.get(`${clean(student.id)}|${meta.key}`) || [];
        const makeupRows = records.filter((row) => clean(row.session_kind) === 'makeup');
        const regular = records.find((row) => clean(row.session_kind) === 'regular' && row.attended !== false);
        const expectedRegular = records.some((row) => clean(row.session_kind) === 'regular_expected');
        if (makeupRows.some((row) => row.attended !== false)) return '<td class="dateCol attendanceMakeupMark"><span aria-label="보강 출석">보</span></td>';
        if (regular) return '<td class="dateCol attendanceLinkedMark"><span aria-label="출석">✓</span></td>';
        if (expectedRegular && meta.key < todayKey()) return '<td class="dateCol attendanceAbsentMark"><span aria-label="결석">결</span></td>';
        return '<td class="dateCol"></td>';
      }).join('');
      return `<tr><td class="noCol">${index + 1}</td><td class="nameCol">${esc(student.name)}</td><td class="schoolGradeCol">${esc(attendanceRosterMeta(student))}</td><td class="personalityCol">${esc(student.personality)}</td>${dateCells}</tr>`;
    }).join('');
    const blankRows = Array.from({ length: Math.max(0, 40 - students.length) }, (_, index) => {
      const dateCells = dayMeta.map((meta) => meta.closed
        ? '<td class="dateCol attendanceHolidayCell" aria-disabled="true"></td>'
        : '<td class="dateCol"></td>').join('');
      return `<tr class="attendanceBlankRow"><td class="noCol">${students.length + index + 1}</td><td class="nameCol"></td><td class="schoolGradeCol"></td><td class="personalityCol"></td>${dateCells}</tr>`;
    }).join('');
    const academyName = typeof global.getOlliCurrentAcademyName === 'function'
      ? clean(global.getOlliCurrentAcademyName())
      : clean(localStorage.getItem('olli_current_academy_name'));
    const registerDivision = state.attendanceDivision === 'combined' ? '유치부/초등부' : divisionLabel(state.attendanceDivision);
    return `<div><div class="attendancePrintPage"><div class="attendancePrintHeader"><div class="attendancePrintAcademy">${esc(academyName || '비비작 아이성향 미술학원')} (${registerDivision})</div><div class="attendancePrintMonth">${year}년 ${month}월</div></div><table class="settingsAttendancePreviewTable"${tableStyle}>${colGroup}${header}<tbody>${rowHtml}${blankRows}</tbody></table></div></div>`;
  }

  function renderAttendanceRegister() {
    const ui = ensureUi();
    if (!ui || state.view !== 'schedule' || state.pane !== 'attendance') return;
    renderAttendanceHeader();
    const signature = attendanceRenderSignature();
    const alreadyShowingAttendance = !!ui.root.querySelector('.olliTtAttendanceRegister');
    if (alreadyShowingAttendance && signature === lastAttendanceRenderSignature) return;

    const html = linkedAttendanceRegisterHtml();
    ui.root.innerHTML = `<section class="olliTtAttendanceRegister"><div class="olliTtAttendanceRegisterHead"><div><strong>${esc(monthLabel(state.attendanceMonth))} 출석부</strong><span>시간표에서 체크한 출석이 자동으로 표시됩니다.</span></div></div><div class="olliTtAttendanceRegisterScroll">${html}</div></section>`;
    lastAttendanceRenderSignature = signature;

    // 글자 맞춤은 큰 표 DOM 생성 직후 강제로 실행하지 않고 다음 프레임으로 미뤄 첫 화면 표시를 막지 않습니다.
    scheduleAttendanceFitText(ui.root);
  }


    return { monthLabel, shiftAttendanceMonth, loadAttendanceRegister, attendanceStudents, attendanceRosterMeta, sortedAttendanceStudents, linkedAttendanceRegisterHtml, renderAttendanceRegister };
  }

  global.OlliTimetableAttendanceRegisterModule = { create };
})(window);