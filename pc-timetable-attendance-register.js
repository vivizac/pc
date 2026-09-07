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
    renderAttendanceRegister();
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

  async function loadAttendanceRegister() {
    if (!state.active || state.view !== 'schedule' || state.pane !== 'attendance') return;
    const month = state.attendanceMonth;
    if (state.attendanceRowsMonth !== month && typeof service.getCachedAttendanceMonth === 'function') {
      const cached = service.getCachedAttendanceMonth(month);
      if (cached) {
        state.attendanceRows = cached;
        state.attendanceRowsMonth = month;
        renderAttendanceRegister();
      }
    }
    const token = ++state.attendanceLoadToken;
    state.attendanceLoading = true;
    if (state.attendanceRowsMonth !== month || state.attendanceCalendarMonth !== month) renderAttendanceRegister();
    try {
      const range = monthRange(month);
      const [rows, calendarDays] = await Promise.all([
        service.loadAttendanceMonth(month),
        typeof service.loadCalendarRange === 'function' ? service.loadCalendarRange(range.start, range.end) : Promise.resolve([])
      ]);
      if (token !== state.attendanceLoadToken || state.attendanceMonth !== month) return;
      state.attendanceRows = rows;
      state.attendanceRowsMonth = month;
      state.attendanceCalendarDays = Array.isArray(calendarDays) ? calendarDays : [];
      state.attendanceCalendarMonth = month;
    } catch (error) {
      if (token !== state.attendanceLoadToken) return;
      if (state.attendanceRowsMonth !== month) state.attendanceRows = [];
      if (state.attendanceCalendarMonth !== month) state.attendanceCalendarDays = [];
      notify(error && (error.message || error) || '출석부를 불러오지 못했습니다.');
    } finally {
      if (token === state.attendanceLoadToken) {
        state.attendanceLoading = false;
        renderAttendanceRegister();
      }
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
    const staticWidth = 20 + 42 + 51 + 20;
    const tableStyle = ` style="--attendance-static-col-width:${staticWidth}px;--attendance-date-col-count:${days};--attendance-date-col-width:calc((100% - ${staticWidth}px) / ${days});"`;
    const colGroup = '<colgroup><col class="noCol"><col class="nameCol"><col class="schoolGradeCol"><col class="personalityCol">'
      + Array.from({ length: days }, () => '<col class="dateCol">').join('') + '</colgroup>';
    const dayHeaders = Array.from({ length: days }, (_, index) => {
      const day = index + 1;
      const closed = isAttendanceClosedDate(year, month, day);
      const title = attendanceHolidayTitle(year, month, day);
      return `<th class="dateCol${closed ? ' attendanceHolidayHead' : ''}"${title ? ` title="${esc(title)}"` : ''}>${day}</th>`;
    }).join('');
    const schoolHeader = state.attendanceDivision === 'combined' ? '소속' : (state.attendanceDivision === 'kinder' ? '유치원/나이' : '학교/학년');
    const header = `<thead><tr><th class="noCol"></th><th class="nameCol">이름</th><th class="schoolGradeCol">${schoolHeader}</th><th class="personalityCol">성향</th>${dayHeaders}</tr></thead>`;
    const rowHtml = students.map((student, index) => {
      const dateCells = Array.from({ length: days }, (_, offset) => {
        const day = offset + 1;
        const key = `${year}-${pad(month)}-${pad(day)}`;
        if (isAttendanceClosedDate(year, month, day)) return '<td class="dateCol attendanceHolidayCell" aria-disabled="true"></td>';
        const records = rowsByStudentDate.get(`${clean(student.id)}|${key}`) || [];
        const makeupRows = records.filter((row) => clean(row.session_kind) === 'makeup');
        const regular = records.find((row) => clean(row.session_kind) === 'regular' && row.attended !== false);
        if (makeupRows.some((row) => row.attended !== false)) return '<td class="dateCol attendanceMakeupMark"><span aria-label="보강 출석">보</span></td>';
        if (makeupRows.length && key <= todayKey()) return '<td class="dateCol attendanceAbsentMark"><span aria-label="결석">결</span></td>';
        if (regular) return '<td class="dateCol attendanceLinkedMark"><span aria-label="출석">✓</span></td>';
        return '<td class="dateCol"></td>';
      }).join('');
      return `<tr><td class="noCol">${index + 1}</td><td class="nameCol">${esc(student.name)}</td><td class="schoolGradeCol">${esc(attendanceRosterMeta(student))}</td><td class="personalityCol">${esc(student.personality)}</td>${dateCells}</tr>`;
    }).join('');
    const blankRows = Array.from({ length: Math.max(0, 40 - students.length) }, (_, index) => {
      const dateCells = Array.from({ length: days }, (_, offset) => {
        const day = offset + 1;
        return isAttendanceClosedDate(year, month, day)
          ? '<td class="dateCol attendanceHolidayCell" aria-disabled="true"></td>'
          : '<td class="dateCol"></td>';
      }).join('');
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
    const html = linkedAttendanceRegisterHtml();
    ui.root.innerHTML = `<section class="olliTtAttendanceRegister"><div class="olliTtAttendanceRegisterHead"><div><strong>${esc(monthLabel(state.attendanceMonth))} 출석부</strong><span>시간표에서 체크한 출석이 자동으로 표시됩니다.</span></div>${state.attendanceLoading ? '<em>동기화 중…</em>' : ''}</div><div class="olliTtAttendanceRegisterScroll">${html}</div></section>`;
    if (typeof global.settingsAttendanceScheduleFitText === 'function') global.settingsAttendanceScheduleFitText(ui.root);
  }


    return { monthLabel, shiftAttendanceMonth, loadAttendanceRegister, attendanceStudents, attendanceRosterMeta, sortedAttendanceStudents, linkedAttendanceRegisterHtml, renderAttendanceRegister };
  }

  global.OlliTimetableAttendanceRegisterModule = { create };
})(window);
