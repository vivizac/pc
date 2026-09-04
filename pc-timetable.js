(function timetableUiModule(global) {
  'use strict';

  const service = global.OlliTimetableService;
  if (!service) {
    console.warn('OLLI 시간표 서비스를 불러오지 못했습니다.');
    return;
  }

  const DAYS = service.DAYS;
  const TIME_SLOTS = {
    elementary: [1, 2, 3, 4, 5, 6],
    kinder: [4, 5]
  };
  const SATURDAY_ELEMENTARY_TIME_SLOTS = [10, 11, 12];

  function timeOptionsFor(division, weekday) {
    return division === 'elementary' && Number(weekday) === 6
      ? SATURDAY_ELEMENTARY_TIME_SLOTS
      : TIME_SLOTS[division];
  }

  function storedTimeForCell(division, date, displayTime) {
    const time = Number(displayTime);
    return division === 'elementary' && date.getDay() === 6 && time >= 1 && time <= 3
      ? time + 9
      : time;
  }
  const state = {
    active: false,
    view: 'list',
    weekStart: mondayOf(new Date()),
    data: null,
    dataWeek: '',
    dataAcademyId: '',
    loading: false,
    loadingWeek: '',
    loadToken: 0,
    sidebarFilter: 'all',
    sidebarQuery: '',
    pane: 'schedule',
    scheduleDivision: 'elementary',
    attendanceDivision: 'elementary',
    attendanceSort: 'grade',
    attendanceMonth: dateKey(new Date()).slice(0, 7),
    attendanceRows: [],
    attendanceRowsMonth: '',
    attendanceLoading: false,
    attendanceLoadToken: 0,
    dialog: null,
    saving: false,
    historyLoadToken: 0
  };

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function bindImeSafeSearch(input, updateValue, rerender, focusSelector) {
    if (!input) return;
    let composing = false;
    let skipNextInput = false;
    const applyValue = () => {
      updateValue(clean(input.value));
      rerender();
      if (!focusSelector) return;
      requestAnimationFrame(() => {
        const next = document.querySelector(focusSelector);
        if (next) {
          next.focus();
          next.setSelectionRange(next.value.length, next.value.length);
        }
      });
    };
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => {
      composing = false;
      skipNextInput = true;
      applyValue();
    });
    input.addEventListener('input', (event) => {
      if (composing || event.isComposing) return;
      if (skipNextInput) {
        skipNextInput = false;
        return;
      }
      applyValue();
    });
  }
  function esc(value) {
    return clean(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pad(value) { return String(value).padStart(2, '0'); }
  function dateKey(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
  function parseDate(value) {
    const match = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date();
  }
  function addDays(date, amount) { const next = new Date(date); next.setDate(next.getDate() + amount); return next; }
  function mondayOf(value) {
    const date = value instanceof Date ? new Date(value) : parseDate(value);
    date.setHours(0, 0, 0, 0);
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - day + 1);
    return date;
  }
  function koreanDate(value, withYear) {
    const date = value instanceof Date ? value : parseDate(value);
    return `${withYear ? `${date.getFullYear()}년 ` : ''}${date.getMonth() + 1}월 ${date.getDate()}일`;
  }
  function shortDate(value) {
    const date = value instanceof Date ? value : parseDate(value);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }
  function todayKey() { return dateKey(new Date()); }
  function isToday(value) { return dateKey(value instanceof Date ? value : parseDate(value)) === todayKey(); }
  function notify(message) {
    if (typeof global.showPushToast === 'function') global.showPushToast(message);
    else alert(message);
  }
  function studentById(studentId) {
    const id = clean(studentId);
    return service.activeStudents().find((student) => clean(student.id) === id) || null;
  }
  function divisionOf(student) { return clean(student && (student.type || student.division)) === 'kinder' ? 'kinder' : 'elementary'; }
  function divisionLabel(division) { return division === 'kinder' ? '유치부' : '초등부'; }
  function classGroupOf(item, key) {
    const value = clean(item && item[key || 'class_group']).toUpperCase();
    return value === 'B' ? 'B' : 'A';
  }
  function classGroupLabel(division, group) { return division === 'kinder' ? `${classGroupOf({ class_group: group })}반` : ''; }
  function timeLabel(time) { return `${Number(time)}시`; }
  function weekdayLabel(weekday) { return DAYS[Number(weekday) - 1] || ''; }

  function ensureUi() {
    const host = document.getElementById('recordBodyNew');
    if (!host) return null;
    let tabs = document.getElementById('olliTtTabs');
    if (!tabs) {
      tabs = document.createElement('div');
      tabs.id = 'olliTtTabs';
      tabs.className = 'olliTtTabs';
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', '출석부 보기');
      tabs.innerHTML = '<button type="button" class="olliTtTab active" data-tt-view="list" role="tab" aria-selected="true">명단</button>'
        + '<button type="button" class="olliTtTab" data-tt-view="schedule" role="tab" aria-selected="false">시간표</button>';
      host.insertBefore(tabs, document.getElementById('recordList') || host.firstChild);
      tabs.addEventListener('click', (event) => {
        const button = event.target.closest('[data-tt-view]');
        if (button) setView(button.dataset.ttView);
      });
    }
    let root = document.getElementById('olliTtRoot');
    if (!root) {
      root = document.createElement('div');
      root.id = 'olliTtRoot';
      root.className = 'olliTtRoot';
      root.setAttribute('aria-live', 'polite');
      host.insertBefore(root, document.getElementById('pcAcademyDetailPanel'));
      root.addEventListener('click', onTimetableClick);
    }
    ensureDialog();
    return { host, tabs, root };
  }

  function ensureDialog() {
    let overlay = document.getElementById('olliTtOverlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'olliTtOverlay';
    overlay.tabIndex = -1;
    overlay.innerHTML = '<div id="olliTtDialog" role="dialog" aria-modal="true" aria-labelledby="olliTtDialogTitle"></div>';
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay && !state.saving) closeDialog();
    });
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !state.saving) closeDialog();
    });
    document.body.appendChild(overlay);
    return overlay;
  }

  function setView(view) {
    state.view = view === 'schedule' ? 'schedule' : 'list';
    const ui = ensureUi();
    if (!ui) return;
    ui.tabs.querySelectorAll('[data-tt-view]').forEach((button) => {
      const active = button.dataset.ttView === state.view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    const screen = document.getElementById('recordRoomScreen');
    if (screen) screen.classList.toggle('olliPcAttendanceScheduleView', state.active && state.view === 'schedule');
    ui.root.classList.toggle('show', state.active && state.view === 'schedule');

    if (!state.active) return;
    if (state.view === 'schedule') {
      renderWorkspaceHeader();
      renderSidebar();
      if (state.pane === 'attendance') loadAttendanceRegister();
      else loadWeek();
    } else if (typeof global.pcRenderAttendanceList === 'function') {
      global.pcRenderAttendanceList();
    }
  }

  function syncAttendanceActive() {
    const shell = document.getElementById('olliPcShell');
    const section = shell ? clean(shell.dataset.pcSection) : '';
    const nextView = section === 'schedule' ? 'schedule' : 'list';
    const leavingSchedule = state.view === 'schedule' && nextView !== 'schedule';
    state.active = section === 'attendance' || section === 'schedule';
    const ui = ensureUi();
    if (!ui) return;
    if (!state.active) {
      ui.root.classList.remove('show');
      const screen = document.getElementById('recordRoomScreen');
      if (screen) screen.classList.remove('olliPcAttendanceScheduleView');
      closeDialog();
      return;
    }
    if (leavingSchedule) closeDialog();
    setView(nextView);
  }

  async function loadWeek() {
    if (!state.active || state.view !== 'schedule' || state.pane !== 'schedule') return;
    const requestedWeek = dateKey(state.weekStart);
    const requestedAcademyId = typeof service.currentAcademyId === 'function' ? service.currentAcademyId() : '';
    if (state.loading && state.loadingWeek === requestedWeek && state.dataAcademyId === requestedAcademyId) return;
    if ((!state.data || state.dataWeek !== requestedWeek || state.dataAcademyId !== requestedAcademyId) && typeof service.getCachedWeek === 'function') {
      const cached = service.getCachedWeek(requestedWeek);
      if (cached) {
        state.data = cached;
        state.dataWeek = requestedWeek;
        state.dataAcademyId = requestedAcademyId;
      } else {
        state.data = null;
        state.dataWeek = '';
        state.dataAcademyId = requestedAcademyId;
      }
    }
    const token = ++state.loadToken;
    state.loading = true;
    state.loadingWeek = requestedWeek;
    renderTimetable();
    try {
      const data = await service.loadWeek(requestedWeek);
      if (token !== state.loadToken) return;
      const changed = state.dataWeek !== requestedWeek || state.dataAcademyId !== requestedAcademyId || JSON.stringify(state.data) !== JSON.stringify(data);
      state.data = data;
      state.dataWeek = requestedWeek;
      state.dataAcademyId = requestedAcademyId;
      state.loading = false;
      state.loadingWeek = '';
      if (changed) {
        renderTimetable();
        renderSidebar();
        refreshOpenStudentInfoPanel();
      }
    } catch (error) {
      if (token !== state.loadToken) return;
      state.loading = false;
      state.loadingWeek = '';
      if (!state.data || state.dataWeek !== requestedWeek || state.dataAcademyId !== requestedAcademyId) {
        state.data = { error: error && (error.message || error) || '시간표를 불러오지 못했습니다.' };
        state.dataWeek = requestedWeek;
        state.dataAcademyId = requestedAcademyId;
        renderTimetable();
      }
    }
  }

  function enrollments() { return Array.isArray(state.data && state.data.enrollments) ? state.data.enrollments : []; }
  function waitlist() { return Array.isArray(state.data && state.data.waitlist) ? state.data.waitlist : []; }
  function oneTimeSessions() { return Array.isArray(state.data && state.data.one_time_sessions) ? state.data.one_time_sessions : []; }
  function changes() { return Array.isArray(state.data && state.data.changes) ? state.data.changes : []; }
  function attendanceMarks() { return Array.isArray(state.data && state.data.attendance) ? state.data.attendance : []; }
  function pickups() { return Array.isArray(state.data && state.data.pickups) ? state.data.pickups : []; }
  function classSplits() { return Array.isArray(state.data && state.data.class_splits) ? state.data.class_splits : []; }
  function kinderClassMerges() { return Array.isArray(state.data && state.data.kinder_class_merges) ? state.data.kinder_class_merges : []; }
  function cellMemos() { return Array.isArray(state.data && state.data.cell_memos) ? state.data.cell_memos : []; }
  function isClassSplit(division, weekday, time) {
    if (division === 'kinder') {
      return !kinderClassMerges().some((item) => Number(item.weekday) === Number(weekday) && Number(item.time_slot) === Number(time));
    }
    return classSplits().some((item) => Number(item.weekday) === Number(weekday) && Number(item.time_slot) === Number(time));
  }
  function enrollmentEffectiveOn(enrollment, date) {
    const key = dateKey(date);
    return clean(enrollment.effective_from) <= key
      && (!clean(enrollment.effective_to) || clean(enrollment.effective_to) >= key);
  }
  function enrollmentActiveOn(enrollment, date) {
    return Number(enrollment.weekday) === date.getDay() && enrollmentEffectiveOn(enrollment, date);
  }
  function timeSlotMatches(division, date, displayedTime, storedTime) {
    const expected = Number(displayedTime);
    const legacySaturdayTime = division === 'elementary' && date.getDay() === 6 && expected >= 10 && expected <= 12
      ? expected - 9
      : null;
    return Number(storedTime) === expected || Number(storedTime) === legacySaturdayTime;
  }
  function enrollmentSessionKey(item) {
    if (!item) return '';
    return `${Number(item.weekday)}|${Number(item.time_slot)}|${classGroupOf(item)}`;
  }

  function activeWeeklySessions(studentId, date) {
    return enrollments().filter((candidate) => clean(candidate.student_id) === clean(studentId)
      && enrollmentEffectiveOn(candidate, date))
      .sort((a, b) => Number(a.weekday) - Number(b.weekday)
        || Number(a.time_slot) - Number(b.time_slot)
        || classGroupOf(a).localeCompare(classGroupOf(b)));
  }

  function secondWeeklySession(studentId, date) {
    const weeklySessions = activeWeeklySessions(studentId, date);
    if (weeklySessions.length !== 2) return null;
    return weeklySessions.find((item) => Number(item.session_order) === 2) || weeklySessions[1];
  }

  function isSecondWeeklySession(item, date) {
    const second = secondWeeklySession(item && item.student_id, date);
    return !!second && clean(second.id) === clean(item && item.id);
  }

  async function setWeeklySessionOrder(studentId, enrollmentId, order) {
    const date = new Date();
    const weeklySessions = activeWeeklySessions(studentId, date);
    if (weeklySessions.length !== 2 || typeof service.setSessionOrder !== 'function') return false;
    const selected = weeklySessions.find((item) => clean(item.id) === clean(enrollmentId));
    if (!selected || ![1, 2].includes(Number(order))) return false;
    await service.setSessionOrder(studentId, enrollmentId, Number(order), todayKey());
    state.data = null;
    await loadWeek();
    return true;
  }

  function cellMemoText(division, date, time) {
    const keyDate = date instanceof Date ? dateKey(date) : clean(date);
    const memo = cellMemos().find((item) => clean(item.division) === clean(division)
      && clean(item.session_date) === keyDate
      && Number(item.time_slot) === Number(time));
    return clean(memo && memo.note);
  }

  async function saveCellMemoText(division, date, time, note) {
    if (typeof service.saveCellMemo !== 'function') throw new Error('시간표 메모 서버 연결을 찾지 못했습니다.');
    const keyDate = date instanceof Date ? dateKey(date) : clean(date);
    return service.saveCellMemo(clean(division), keyDate, Number(time), clean(note));
  }

  function slotEntryCount(division, date, time, classGroup) {
    return slotRegulars(division, date, time, classGroup).length
      + slotWaitlist(division, date, time, classGroup).length
      + slotMakeups(division, date, time, classGroup).length;
  }
  function slotRegulars(division, date, time, classGroup) {
    return enrollments().filter((item) => clean(item.division) === division && timeSlotMatches(division, date, time, item.time_slot) && enrollmentActiveOn(item, date)
      && (!classGroup || classGroupOf(item) === classGroupOf({ class_group: classGroup })))
      .sort((a, b) => Number(isSecondWeeklySession(b, date)) - Number(isSecondWeeklySession(a, date)));
  }
  function waitRequestedDate(item) {
    const requestedAt = new Date(clean(item && item.requested_at));
    if (Number.isNaN(requestedAt.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(requestedAt);
    const value = (type) => parts.find((part) => part.type === type)?.value || '';
    return `${value('year')}-${value('month')}-${value('day')}`;
  }
  function slotWaitlist(division, date, time, classGroup) {
    const dayKey = dateKey(date);
    return waitlist().filter((item) => clean(item.division) === division && Number(item.target_weekday) === Number(date.getDay()) && timeSlotMatches(division, date, time, item.target_time_slot)
      && (!waitRequestedDate(item) || waitRequestedDate(item) <= dayKey)
      && (!classGroup || classGroupOf(item, 'target_class_group') === classGroupOf({ class_group: classGroup })));
  }
  function slotMakeups(division, date, time, classGroup) {
    const key = dateKey(date);
    return oneTimeSessions().filter((item) => clean(item.division) === division && clean(item.session_date) === key && timeSlotMatches(division, date, time, item.time_slot)
      && (!classGroup || classGroupOf(item) === classGroupOf({ class_group: classGroup })));
  }
  function scheduledChangeForSource(enrollmentId) {
    return changes().find((item) => clean(item.source_enrollment_id) === clean(enrollmentId) && item.status === 'scheduled');
  }
  function capacityFor(division) {
    return division === 'kinder'
      ? 5
      : Number(state.data && state.data.elementary_capacity || 5);
  }
  function attendanceMarked(studentId, date, time, classGroup, sessionKind) {
    const key = dateKey(date);
    return attendanceMarks().some((item) => clean(item.student_id) === clean(studentId)
      && clean(item.session_date) === key
      && Number(item.time_slot) === Number(time)
      && classGroupOf(item) === classGroupOf({ class_group: classGroup })
      && clean(item.session_kind) === clean(sessionKind));
  }
  function pickupActiveOn(item, date) {
    const key = dateKey(date);
    return Number(item.weekday) === date.getDay()
      && clean(item.effective_from) <= key
      && (!clean(item.effective_to) || clean(item.effective_to) >= key);
  }
  function slotPickups(date, classTime) {
    return pickups().filter((item) => Number(item.class_time) === Number(classTime) && pickupActiveOn(item, date));
  }
  function pickupTimeLabel(value) {
    const match = clean(value).match(/^(\d{1,2}):(\d{2})/);
    if (!match) return clean(value);
    const hour = Number(match[1]);
    return `${hour > 12 ? hour - 12 : hour}:${match[2]}`;
  }
  function countAt(division, weekday, time, targetDate, classGroup) {
    const date = parseDate(targetDate || todayKey());
    const wantedDay = Number(weekday);
    if (date.getDay() !== wantedDay) {
      const delta = (wantedDay - date.getDay() + 7) % 7;
      date.setDate(date.getDate() + delta);
    }
    return slotRegulars(division, date, time, classGroup).length + slotMakeups(division, date, time, classGroup).length;
  }

  function weekRangeText() {
    const end = addDays(state.weekStart, 5);
    if (state.weekStart.getMonth() === end.getMonth()) return `${state.weekStart.getMonth() + 1}월 ${state.weekStart.getDate()}일 – ${end.getDate()}일`;
    return `${state.weekStart.getMonth() + 1}월 ${state.weekStart.getDate()}일 – ${end.getMonth() + 1}월 ${end.getDate()}일`;
  }

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
    renderAttendanceRegister();
    loadAttendanceRegister();
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
    if (state.attendanceRowsMonth !== month) renderAttendanceRegister();
    try {
      const rows = await service.loadAttendanceMonth(month);
      if (token !== state.attendanceLoadToken || state.attendanceMonth !== month) return;
      state.attendanceRows = rows;
      state.attendanceRowsMonth = month;
    } catch (error) {
      if (token !== state.attendanceLoadToken) return;
      if (state.attendanceRowsMonth !== month) state.attendanceRows = [];
      notify(error && (error.message || error) || '출석부를 불러오지 못했습니다.');
    } finally {
      if (token === state.attendanceLoadToken) {
        state.attendanceLoading = false;
        renderAttendanceRegister();
      }
    }
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
      const sunday = new Date(year, month - 1, day).getDay() === 0 ? ' daySun' : '';
      return `<th class="dateCol${sunday}">${day}</th>`;
    }).join('');
    const schoolHeader = state.attendanceDivision === 'combined' ? '소속' : (state.attendanceDivision === 'kinder' ? '유치원/나이' : '학교/학년');
    const header = `<thead><tr><th class="noCol"></th><th class="nameCol">이름</th><th class="schoolGradeCol">${schoolHeader}</th><th class="personalityCol">성향</th>${dayHeaders}</tr></thead>`;
    const rowHtml = students.map((student, index) => {
      const dateCells = Array.from({ length: days }, (_, offset) => {
        const day = offset + 1;
        const key = `${year}-${pad(month)}-${pad(day)}`;
        const sunday = new Date(year, month - 1, day).getDay() === 0 ? ' daySun' : '';
        const records = rowsByStudentDate.get(`${clean(student.id)}|${key}`) || [];
        const makeupRows = records.filter((row) => clean(row.session_kind) === 'makeup');
        const regular = records.find((row) => clean(row.session_kind) === 'regular' && row.attended !== false);
        if (makeupRows.some((row) => row.attended !== false)) return `<td class="dateCol${sunday} attendanceMakeupMark"><span aria-label="보강 출석">보</span></td>`;
        if (makeupRows.length && key <= todayKey()) return `<td class="dateCol${sunday} attendanceAbsentMark"><span aria-label="결석">결</span></td>`;
        if (regular) return `<td class="dateCol${sunday} attendanceLinkedMark"><span aria-label="출석">✓</span></td>`;
        return `<td class="dateCol${sunday}"></td>`;
      }).join('');
      return `<tr><td class="noCol">${index + 1}</td><td class="nameCol">${esc(student.name)}</td><td class="schoolGradeCol">${esc(attendanceRosterMeta(student))}</td><td class="personalityCol">${esc(student.personality)}</td>${dateCells}</tr>`;
    }).join('');
    const blankRows = Array.from({ length: Math.max(0, 40 - students.length) }, (_, index) => {
      const dateCells = Array.from({ length: days }, (_, offset) => {
        const sunday = new Date(year, month - 1, offset + 1).getDay() === 0 ? ' daySun' : '';
        return `<td class="dateCol${sunday}"></td>`;
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

  function cellContentsHtml(division, date, time, classGroup, memoText) {
    const regular = slotRegulars(division, date, time, classGroup);
    const waits = slotWaitlist(division, date, time, classGroup);
    const makeups = slotMakeups(division, date, time, classGroup);
    const regularHtml = regular.map((item) => {
      const scheduled = scheduledChangeForSource(item.id);
      const scheduleText = scheduled ? `<span class="olliTtReservation">◷ ${shortDate(scheduled.effective_date)} ${scheduled.change_type === 'remove' ? '삭제' : '이동'} 예정</span>` : '';
      const attendanceTime = Number(item.time_slot);
      const entryClassGroup = classGroup ? classGroupOf({ class_group: classGroup }) : classGroupOf(item);
      const attended = isToday(date) && attendanceMarked(item.student_id, date, attendanceTime, entryClassGroup, 'regular');
      const secondSessionMark = isSecondWeeklySession(item, date) ? '<strong class="olliTtSecondSessionMark" aria-label="주 2회차">▲</strong>' : '';
      return `<div class="olliTtStudent regular ${division}${scheduled ? ' scheduled' : ''}${attended ? ' attended' : ''}"><button type="button" class="olliTtAttendanceBtn" data-tt-attendance="regular" data-student-id="${esc(item.student_id)}" data-session-date="${dateKey(date)}" data-time="${attendanceTime}" data-class-group="${esc(entryClassGroup)}">${esc(item.student_name)}${secondSessionMark}${scheduleText}</button><button type="button" class="olliTtStudentMore" data-tt-entry="regular" data-student-id="${esc(item.student_id)}" data-enrollment-id="${esc(item.id)}" aria-label="${esc(item.student_name)} 수업 설정">☰</button></div>`;
    }).join('');
    const waitHtml = waits.map((item) => `<div class="olliTtStudent wait"><button type="button" class="olliTtAttendanceBtn" data-tt-entry="wait" data-waitlist-id="${esc(item.id)}">${esc(item.student_name)}</button><button type="button" class="olliTtStudentTag" data-tt-entry="wait" data-waitlist-id="${esc(item.id)}">대기</button></div>`).join('');
    const makeupHtml = makeups.map((item) => {
      const attendanceTime = Number(item.time_slot);
      const entryClassGroup = classGroup ? classGroupOf({ class_group: classGroup }) : classGroupOf(item);
      const attended = isToday(date) && attendanceMarked(item.student_id, date, attendanceTime, entryClassGroup, 'makeup');
      return `<div class="olliTtStudent makeup${attended ? ' attended' : ''}"><button type="button" class="olliTtAttendanceBtn" data-tt-attendance="makeup" data-student-id="${esc(item.student_id)}" data-session-date="${dateKey(date)}" data-time="${attendanceTime}" data-class-group="${esc(entryClassGroup)}">${esc(item.student_name)}</button><button type="button" class="olliTtStudentTag" data-tt-entry="makeup" data-makeup-id="${esc(item.id)}">보강</button></div>`;
    }).join('');
    const memo = clean(memoText);
    const memoHtml = memo ? `<button type="button" class="olliTtCellMemoCard" data-tt-memo-card="1" data-division="${esc(division)}" data-date="${dateKey(date)}" data-time="${Number(time)}" aria-label="시간표 메모 관리"><span aria-hidden="true">📝</span><strong>${esc(memo)}</strong></button>` : '';
    return `<div class="olliTtEntries">${regularHtml}${waitHtml}${makeupHtml}${memoHtml}</div>`;
  }

  function cellHtml(division, date, displayTime) {
    if (division === 'elementary' && date.getDay() === 6 && Number(displayTime) > 3) {
      return '<div class="olliTtCell saturdayUnavailable" aria-hidden="true"></div>';
    }
    const time = storedTimeForCell(division, date, displayTime);
    const attrs = `data-tt-cell="1" data-division="${division}" data-date="${dateKey(date)}" data-weekday="${date.getDay()}" data-time="${time}"`;
    const memo = cellMemoText(division, date, time);
    if (!isClassSplit(division, date.getDay(), time)) {
      return `<div class="olliTtCell" ${attrs}>${cellContentsHtml(division, date, time, '', memo)}</div>`;
    }
    const heads = division === 'kinder';
    const counts = {
      A: slotEntryCount(division, date, time, 'A'),
      B: slotEntryCount(division, date, time, 'B')
    };
    const memoGroup = counts.A <= counts.B ? 'A' : 'B';
    return `<div class="olliTtCell ${division} split" ${attrs}><div class="olliTtClassLanes ${division}">${['A', 'B'].map((group) => `<div class="olliTtClassLane ${division}" ${attrs} data-class-group="${group}">${heads ? `<div class="olliTtClassLaneHead"><strong>${group}반</strong></div>` : ''}${cellContentsHtml(division, date, time, group, memo && group === memoGroup ? memo : '')}</div>`).join('')}</div></div>`;
  }

  function pickupCellHtml(date, classTime) {
    const rows = slotPickups(date, classTime);
    const cards = rows.map((item) => `<div class="olliTtPickupCard" data-tt-pickup-manage="${esc(item.id)}"><div><strong>${esc(item.student_name)}</strong><span>${esc(item.pickup_label)} ${esc(pickupTimeLabel(item.pickup_time))}</span></div><button type="button" aria-label="${esc(item.student_name)} 픽업 설정">•••</button></div>`).join('');
    return `<div class="olliTtPickupCell" data-tt-pickup-cell="1" data-date="${dateKey(date)}" data-weekday="${date.getDay()}" data-class-time="${classTime}"><div class="olliTtPickupEntries">${cards}</div></div>`;
  }

  function pickupGridHtml(dates) {
    let grid = '<div class="olliTtPickupGrid"><div class="olliTtPickupTitle">픽업 시간표</div>';
    [4, 5].forEach((classTime) => {
      grid += `<div class="olliTtPickupTime">${classTime}시</div>`;
      dates.forEach((date) => { grid += pickupCellHtml(date, classTime); });
    });
    return `${grid}</div>`;
  }

  function sectionHtml(division) {
    const times = TIME_SLOTS[division];
    const dates = DAYS.map((_, index) => addDays(state.weekStart, index));
    let grid = `<div class="olliTtGrid" style="--olli-tt-rows:${times.length}"><div class="olliTtCorner"></div>`;
    dates.forEach((date, index) => {
      grid += `<div class="olliTtDay ${isToday(date) ? 'today' : ''}"><strong>${DAYS[index]}요일</strong><span>${date.getMonth() + 1}월 ${date.getDate()}일${isToday(date) ? ' · 오늘' : ''}</span></div>`;
    });
    times.forEach((time) => {
      grid += `<div class="olliTtTime">${time}시</div>`;
      dates.forEach((date) => { grid += cellHtml(division, date, time); });
    });
    grid += '</div>';
    return `<section class="olliTtSection ${division}"><div class="olliTtScroll">${grid}${division === 'kinder' ? pickupGridHtml(dates) : ''}</div></section>`;
  }

  function renderTimetable() {
    const ui = ensureUi();
    if (!ui || state.view !== 'schedule') return;
    if (state.pane === 'attendance') {
      renderAttendanceRegister();
      return;
    }
    if (state.loading && !state.data) {
      ui.root.innerHTML = '<div class="olliTtLoading">주간 시간표를 불러오고 있어요.</div>';
      return;
    }
    if (state.data && state.data.error) {
      ui.root.innerHTML = `<div class="olliTtError">${esc(state.data.error)}<br>로그인 상태를 확인한 후 다시 열어주세요.</div>`;
      return;
    }
    renderScheduleHeader();
    ui.root.innerHTML = sectionHtml(state.scheduleDivision);
  }

  function handleScheduleControl(event) {
    const attendanceDivision = event.target.closest('[data-tt-attendance-division]');
    if (attendanceDivision) {
      state.attendanceDivision = attendanceDivision.dataset.ttAttendanceDivision === 'combined' ? 'combined' : (attendanceDivision.dataset.ttAttendanceDivision === 'kinder' ? 'kinder' : 'elementary');
      renderAttendanceRegister();
      renderAttendanceHeader();
      return true;
    }
    const attendanceMonth = event.target.closest('[data-tt-attendance-month]');
    if (attendanceMonth) {
      if (attendanceMonth.dataset.ttAttendanceMonth === 'prev') shiftAttendanceMonth(-1);
      else if (attendanceMonth.dataset.ttAttendanceMonth === 'next') shiftAttendanceMonth(1);
      else {
        state.attendanceMonth = dateKey(new Date()).slice(0, 7);
        state.attendanceRowsMonth = '';
        loadAttendanceRegister();
      }
      return true;
    }
    const historyButton = event.target.closest('[data-tt-history]');
    if (historyButton) {
      openHistory();
      return true;
    }
    const divisionTab = event.target.closest('[data-tt-division]');
    if (divisionTab) {
      state.scheduleDivision = divisionTab.dataset.ttDivision === 'kinder' ? 'kinder' : 'elementary';
      renderTimetable();
      return true;
    }
    const weekButton = event.target.closest('[data-tt-week]');
    if (weekButton) {
      if (weekButton.dataset.ttWeek === 'prev') state.weekStart = addDays(state.weekStart, -7);
      if (weekButton.dataset.ttWeek === 'next') state.weekStart = addDays(state.weekStart, 7);
      if (weekButton.dataset.ttWeek === 'today') state.weekStart = mondayOf(new Date());
      state.data = null;
      state.dataWeek = '';
      state.dataAcademyId = '';
      loadWeek();
      return true;
    }
    return false;
  }

  function renderScheduleHeader() {
    const title = document.getElementById('olliPcTopbarTitle');
    if (!title) return;
    title.classList.add('olliTtTopbarSchedule');
    title.innerHTML = '<div class="olliTtDivisionTabs" role="tablist" aria-label="시간표 반 선택">'
      + `<button type="button" class="olliTtDivisionTab ${state.scheduleDivision === 'elementary' ? 'active' : ''}" data-tt-division="elementary" role="tab" aria-selected="${state.scheduleDivision === 'elementary'}">초등부</button>`
      + `<button type="button" class="olliTtDivisionTab ${state.scheduleDivision === 'kinder' ? 'active' : ''}" data-tt-division="kinder" role="tab" aria-selected="${state.scheduleDivision === 'kinder'}">유치부</button></div>`
      + '<div class="olliTtWeekNav"><button type="button" class="olliTtWeekBtn icon" data-tt-week="prev" aria-label="이전 주">‹</button>'
      + `<button type="button" class="olliTtWeekBtn range">${weekRangeText()}</button>`
      + '<button type="button" class="olliTtWeekBtn icon" data-tt-week="next" aria-label="다음 주">›</button><button type="button" class="olliTtWeekBtn today" data-tt-week="today">이번 주</button>'
      + '<button type="button" class="olliTtHistoryBtn" data-tt-history><span aria-hidden="true">↶</span> 변경 이력</button></div>';
    if (!title.__olliTtScheduleHeaderBound) {
      title.__olliTtScheduleHeaderBound = true;
      title.addEventListener('click', (event) => { handleScheduleControl(event); });
    }
  }

  function renderAttendanceHeader() {
    const title = document.getElementById('olliPcTopbarTitle');
    if (!title) return;
    title.classList.add('olliTtTopbarSchedule');
    title.innerHTML = '<div class="olliTtDivisionTabs" role="tablist" aria-label="출석부 부서 선택">'
      + ['elementary', 'kinder', 'combined'].map((division) => `<button type="button" class="olliTtDivisionTab ${state.attendanceDivision === division ? 'active' : ''}" data-tt-attendance-division="${division}">${division === 'elementary' ? '초등부' : (division === 'kinder' ? '유치부' : '통합')}</button>`).join('') + '</div>'
      + '<div class="olliTtWeekNav"><button type="button" class="olliTtWeekBtn icon" data-tt-attendance-month="prev" aria-label="이전 달">‹</button>'
      + `<button type="button" class="olliTtWeekBtn range">${esc(monthLabel(state.attendanceMonth))}</button>`
      + '<button type="button" class="olliTtWeekBtn icon" data-tt-attendance-month="next" aria-label="다음 달">›</button><button type="button" class="olliTtWeekBtn today" data-tt-attendance-month="today">이번 달</button></div>';
  }

  function renderWorkspaceHeader() {
    if (state.pane === 'attendance') renderAttendanceHeader();
    else renderScheduleHeader();
  }

  function onTimetableClick(event) {
    if (handleScheduleControl(event)) return;
    const attendanceButton = event.target.closest('[data-tt-attendance]');
    if (attendanceButton) {
      event.stopPropagation();
      toggleAttendance(attendanceButton);
      return;
    }
    const pickupManage = event.target.closest('[data-tt-pickup-manage]');
    if (pickupManage) {
      event.stopPropagation();
      openPickupManage(pickupManage.dataset.ttPickupManage);
      return;
    }
    const entry = event.target.closest('[data-tt-entry]');
    if (entry) {
      event.stopPropagation();
      if (entry.dataset.ttEntry === 'regular') openMove(entry.dataset.studentId, entry.dataset.enrollmentId);
      else if (entry.dataset.ttEntry === 'wait') openWait(entry.dataset.waitlistId);
      else if (entry.dataset.ttEntry === 'makeup') openMakeup(entry.dataset.makeupId);
      return;
    }
    const pickupCell = event.target.closest('[data-tt-pickup-cell]');
    if (pickupCell) {
      openPickupAdd(pickupCell.dataset);
      return;
    }
    const memoCard = event.target.closest('[data-tt-memo-card]');
    if (memoCard) {
      event.stopPropagation();
      openMemoManage(memoCard.dataset);
      return;
    }
    const cell = event.target.closest('[data-tt-cell]');
    if (cell) openAdd(cell.dataset);
  }

  function studentScheduleText(studentId) {
    const rows = enrollments().filter((item) => clean(item.student_id) === clean(studentId) && enrollmentEffectiveOn(item, new Date()));
    if (!rows.length) {
      const student = studentById(studentId);
      return service.legacyPairs(student).map((pair) => `${weekdayLabel(pair.weekday)} ${timeLabel(pair.time_slot)}`).join(' · ');
    }
    const student = studentById(studentId);
    return rows.sort((a, b) => Number(a.weekday) - Number(b.weekday) || Number(a.time_slot) - Number(b.time_slot))
      .map((item) => `${weekdayLabel(item.weekday)} ${timeLabel(item.time_slot)}${classGroupLabel(divisionOf(student), item.class_group) ? ` ${classGroupLabel(divisionOf(student), item.class_group)}` : ''}`).join(' · ');
  }

  function setPane(pane) {
    const next = pane === 'attendance' ? 'attendance' : 'schedule';
    if (state.pane === next) return;
    state.pane = next;
    closeDialog();
    renderSidebar();
    renderWorkspaceHeader();
    renderTimetable();
    if (next === 'attendance') loadAttendanceRegister();
    else loadWeek();
  }

  function renderSidebar() {
    if (!state.active || state.view !== 'schedule') return;
    const title = document.getElementById('olliPcContextTitle');
    const body = document.getElementById('olliPcContextBody');
    if (!title || !body) return;
    title.textContent = '시간표 • 출석부';
    // 한글 IME 조합이 끊기지 않도록 검색창은 유지하고 결과 영역만 갱신합니다.
    let input = body.querySelector('#olliTtQuickSearch');
    let results = body.querySelector('[data-tt-sidebar-results]');
    if (!input || !results) {
      body.innerHTML = `<div class="olliTtQuickFilter olliTtPaneTabs"><button type="button" class="olliTtQuickFilterBtn" data-tt-pane="schedule">시간표</button><button type="button" class="olliTtQuickFilterBtn" data-tt-pane="attendance">출석부</button></div>`
        + `<input type="search" class="olliTtQuickSearch" id="olliTtQuickSearch" value="${esc(state.sidebarQuery)}" placeholder="학생 검색" aria-label="시간표 학생 검색">`
        + '<div data-tt-sidebar-results></div>';
      input = body.querySelector('#olliTtQuickSearch');
      results = body.querySelector('[data-tt-sidebar-results]');
      body.querySelectorAll('[data-tt-pane]').forEach((button) => button.addEventListener('click', () => {
        setPane(button.dataset.ttPane);
      }));
      bindImeSafeSearch(
        input,
        (value) => { state.sidebarQuery = value; },
        () => { renderSidebarResults(body); if (state.pane === 'attendance') renderAttendanceRegister(); },
        null
      );
    } else if (document.activeElement !== input && input.value !== state.sidebarQuery) {
      input.value = state.sidebarQuery;
    }
    body.querySelectorAll('[data-tt-pane]').forEach((button) => button.classList.toggle('active', button.dataset.ttPane === state.pane));
    renderSidebarResults(body);
  }

  function renderSidebarResults(body) {
    if (!body || !state.active || state.view !== 'schedule') return;
    const results = body.querySelector('[data-tt-sidebar-results]');
    if (!results) return;
    const students = service.activeStudents().filter((student) => {
      const division = divisionOf(student);
      return !state.sidebarQuery || clean(student.name).includes(state.sidebarQuery);
    });
    const elementary = students.filter((student) => divisionOf(student) === 'elementary');
    const kinder = students.filter((student) => divisionOf(student) === 'kinder');
    const groupHtml = (list, division) => list.length ? `<div class="olliTtQuickGroup"><div class="olliTtQuickGroupTitle">${divisionLabel(division)} · ${list.length}명</div>${list.map((student) => `<button type="button" class="olliTtQuickStudent" data-tt-sidebar-student="${esc(student.id)}"><span>${esc(student.name)}</span><span class="olliTtQuickStudentSchedule">${esc(studentScheduleText(student.id))}</span></button>`).join('')}</div>` : '';
    results.innerHTML = students.length ? groupHtml(elementary, 'elementary') + groupHtml(kinder, 'kinder') : '<div class="olliTtQuickEmpty">조건에 맞는 학생이 없습니다.</div>';
    results.querySelectorAll('[data-tt-sidebar-student]').forEach((button) => button.addEventListener('click', () => {
      if (state.pane === 'schedule') openMove(button.dataset.ttSidebarStudent);
      else {
        const student = studentById(button.dataset.ttSidebarStudent);
        state.sidebarQuery = clean(student && student.name);
        const input = body.querySelector('#olliTtQuickSearch');
        if (input) input.value = state.sidebarQuery;
        renderSidebarResults(body);
        renderAttendanceRegister();
      }
    }));
  }

  function closeDialog() {
    if (state.saving) return;
    const overlay = document.getElementById('olliTtOverlay');
    if (overlay) overlay.classList.remove('show');
    state.dialog = null;
  }

  function openOverlay() {
    const overlay = ensureDialog();
    renderDialog();
    overlay.classList.add('show');
    requestAnimationFrame(() => overlay.focus());
  }

  function studentEnrollments(studentId) {
    return enrollments().filter((item) => clean(item.student_id) === clean(studentId));
  }

  function currentStudentEnrollments(studentId) {
    const today = todayKey();
    return studentEnrollments(studentId).filter((item) => !clean(item.effective_to) || clean(item.effective_to) >= today);
  }

  function openMove(studentId, enrollmentId) {
    const student = studentById(studentId);
    if (!student) return;
    const rows = currentStudentEnrollments(studentId);
    const source = rows.find((item) => clean(item.id) === clean(enrollmentId)) || rows.find((item) => enrollmentEffectiveOn(item, new Date())) || rows[0];
    const targetWeekday = source ? Number(source.weekday) : 1;
    const timeOptions = timeOptionsFor(divisionOf(student), targetWeekday);
    const sourceTime = source ? Number(source.time_slot) : null;
    state.dialog = {
      kind: 'move', studentId: clean(studentId), actionType: 'move',
      sourceEnrollmentId: source ? clean(source.id) : '',
      targetWeekday,
      targetTime: timeOptions.includes(sourceTime) ? sourceTime : timeOptions[0],
      targetClassGroup: source ? classGroupOf(source) : 'A',
      effectiveDate: todayKey()
    };
    openOverlay();
  }

  function openAdd(dataset) {
    const targetDate = clean(dataset.date);
    const division = clean(dataset.division);
    const time = Number(dataset.time);
    const targetClassGroup = classGroupOf({ class_group: dataset.classGroup });
    const existingMemo = cellMemoText(division, targetDate, time);
    state.dialog = {
      kind: 'add', division, date: targetDate,
      weekday: Number(dataset.weekday), time, studentId: '',
      query: '', note: existingMemo, originalNote: existingMemo, addType: 'wait', targetClassGroup
    };
    openOverlay();
  }

  function openMemoManage(dataset) {
    const division = clean(dataset && dataset.division);
    const date = clean(dataset && dataset.date);
    const time = Number(dataset && dataset.time);
    const memo = cellMemoText(division, date, time);
    if (!division || !date || !time || !memo) return;
    state.dialog = { kind: 'memoManage', division, date, time, memo };
    openOverlay();
  }

  function openWait(waitlistId) {
    const item = waitlist().find((row) => clean(row.id) === clean(waitlistId));
    if (!item) return;
    state.dialog = { kind: 'wait', waitlistId: clean(waitlistId), effectiveDate: todayKey() };
    openOverlay();
  }

  function openMakeup(makeupId) {
    const item = oneTimeSessions().find((row) => clean(row.id) === clean(makeupId));
    if (!item) return;
    state.dialog = { kind: 'makeup', makeupId: clean(makeupId) };
    openOverlay();
  }

  function openPickupAdd(dataset) {
    const date = clean(dataset.date);
    state.dialog = {
      kind: 'pickupAdd', date, weekday: Number(dataset.weekday), classTime: Number(dataset.classTime),
      studentId: '', query: '', pickupLabel: '', pickupTime: ''
    };
    openOverlay();
  }

  function openPickupManage(pickupId) {
    const item = pickups().find((row) => clean(row.id) === clean(pickupId));
    if (!item) return;
    state.dialog = { kind: 'pickupManage', pickupId: clean(pickupId), effectiveDate: todayKey() };
    openOverlay();
  }

  function dialogHead(icon, title, sub) {
    const subHtml = clean(sub) ? `<div class="olliTtDialogSub">${esc(sub)}</div>` : '';
    return `<div class="olliTtDialogHead"><div class="olliTtDialogIcon" aria-hidden="true">${icon}</div><div><div class="olliTtDialogTitle" id="olliTtDialogTitle">${esc(title)}</div>${subHtml}</div><button type="button" class="olliTtDialogClose" data-tt-dialog-close aria-label="닫기">×</button></div>`;
  }

  function classGroupChoiceHtml(division, selectedGroup, weekday, time, hideGuide, includeKinderLayoutControl) {
    const split = isClassSplit(division, weekday, time);
    const selected = classGroupOf({ class_group: selectedGroup });

    if (division === 'kinder' && includeKinderLayoutControl) {
      if (!split) {
        return '<div class="olliTtField"><div class="olliTtFieldHead"><span>수업 반</span><small>현재 A반·B반을 합반으로 운영하고 있습니다.</small></div>'
          + '<button type="button" class="olliTtSplitClassBtn" data-tt-split-kinder-class>클래스 분반</button></div>';
      }
      return '<div class="olliTtField"><div class="olliTtFieldHead"><span>수업 반</span><small>반을 선택하거나 두 반을 합반할 수 있습니다.</small></div>'
        + '<div class="olliTtClassChoiceGrid kinderLayout">'
        + ['A', 'B'].map((group) => `<button type="button" class="olliTtChoice ${selected === group ? 'active' : ''}" data-tt-target-class="${group}">${group}반</button>`).join('')
        + '<button type="button" class="olliTtChoice olliTtKinderMergeChoice" data-tt-merge-kinder-class>클래스 합반</button>'
        + '</div></div>';
    }

    if (!split) return '';
    const guide = division === 'kinder' ? '유치부는 시간별로 A반·B반을 운영합니다.' : '분리된 수업의 반을 선택합니다.';
    return `<div class="olliTtField"><div class="olliTtFieldHead"><span>수업 반</span>${hideGuide ? '' : `<small>${guide}</small>`}</div><div class="olliTtClassChoiceGrid">`
      + ['A', 'B'].map((group) => `<button type="button" class="olliTtChoice ${selected === group ? 'active' : ''}" data-tt-target-class="${group}">${group}반</button>`).join('')
      + '</div></div>';
  }

  function moveDialogHtml(dialog) {
    const student = studentById(dialog.studentId);
    const rows = currentStudentEnrollments(dialog.studentId).sort((a, b) => Number(a.weekday) - Number(b.weekday) || Number(a.time_slot) - Number(b.time_slot));
    const scheduledRows = changes().filter((item) => clean(item.student_id) === clean(dialog.studentId) && item.status === 'scheduled');
    const division = divisionOf(student);
    const timeOptions = timeOptionsFor(division, dialog.targetWeekday);
    const capacity = capacityFor(division);
    const currentRows = rows.filter((item) => enrollmentEffectiveOn(item, new Date()));
    const hasTwoCurrentSessions = currentRows.length === 2;
    const sourceHtml = rows.length ? rows.map((item) => {
      const current = enrollmentEffectiveOn(item, new Date());
      const selected = clean(item.id) === clean(dialog.sourceEnrollmentId);
      const schedule = `${weekdayLabel(item.weekday)}요일 · ${timeLabel(item.time_slot)}${classGroupLabel(division, item.class_group) ? ` · ${classGroupLabel(division, item.class_group)}` : ''}`;
      const order = hasTwoCurrentSessions && current ? (isSecondWeeklySession(item, new Date()) ? 2 : 1) : 0;
      const orderHtml = order ? `<div class="olliTtSessionOrder" role="group" aria-label="${esc(schedule)} 회차 설정"><button type="button" class="${order === 1 ? 'active' : ''}" data-tt-session-order="1" data-enrollment-id="${esc(item.id)}">1회차</button><button type="button" class="${order === 2 ? 'active' : ''}" data-tt-session-order="2" data-enrollment-id="${esc(item.id)}">2회차</button></div>` : '';
      return `<div class="olliTtEnrollmentRow${order ? ' hasSessionOrder' : ''}"><button type="button" class="olliTtEnrollmentChoice ${selected ? 'active' : ''}" data-tt-source="${esc(item.id)}"><strong>${schedule}</strong></button>${orderHtml}<button type="button" class="olliTtEnrollmentDelete" data-tt-remove-enrollment="${esc(item.id)}" ${current ? '' : 'disabled'} aria-label="${esc(schedule)} 삭제">삭제</button></div>`;
    }).join('') : '<div class="olliTtStatusNotice">현재 등록된 정규 수업이 없습니다.</div>';
    const dayHtml = DAYS.map((day, index) => `<button type="button" class="olliTtChoice ${dialog.targetWeekday === index + 1 ? 'active' : ''}" data-tt-target-day="${index + 1}">${day}</button>`).join('');
    const timeHtml = timeOptions.map((time) => {
      const count = countAt(division, dialog.targetWeekday, time, dialog.effectiveDate, dialog.targetClassGroup);
      const full = capacity && count >= capacity;
      return `<button type="button" class="olliTtChoice ${dialog.targetTime === time ? 'active' : ''} ${full ? 'full' : ''}" data-tt-target-time="${time}">${time}시${capacity ? `<small>${count}/${capacity}${full ? ' · 대기' : ''}</small>` : ''}</button>`;
    }).join('');
    const scheduledHtml = scheduledRows.length ? `<div class="olliTtField"><div class="olliTtFieldHead"><span>변경 예약</span></div><div class="olliTtEnrollmentList">${scheduledRows.map((item) => {
      const scheduledSource = rows.find((row) => clean(row.id) === clean(item.source_enrollment_id));
      const target = rows.find((row) => clean(row.id) === clean(item.target_enrollment_id));
      const targetText = item.change_type === 'remove' && scheduledSource
        ? `${weekdayLabel(scheduledSource.weekday)}요일 ${timeLabel(scheduledSource.time_slot)} 삭제`
        : target ? `${weekdayLabel(target.weekday)}요일 ${timeLabel(target.time_slot)}` : '예약된 수업';
      return `<button type="button" class="olliTtEnrollmentChoice" data-tt-cancel-change="${esc(item.id)}"><strong>${shortDate(item.effective_date)}부터 · ${esc(targetText)}</strong><span>예약 취소</span></button>`;
    }).join('')}</div></div>` : '';
    const isMakeup = dialog.actionType === 'makeup';
    const headerGuide = `${divisionLabel(division)} · 현재 수업 ${studentScheduleText(student.id) || '없음'}`;
    const modeCards = '<div class="olliTtModeCards">'
      + `<section class="olliTtModeCard move ${dialog.actionType === 'move' ? 'active' : ''}"><button type="button" class="olliTtModeCardButton" data-tt-action-type="move">수업이동</button><div class="olliTtModeCardBody"><span>현재 정규수업</span><div class="olliTtEnrollmentList">${sourceHtml}</div></div></section>`
      + '<div class="olliTtModeCardStack">'
      + `<section class="olliTtModeCard simple ${dialog.actionType === 'add' ? 'active' : ''}"><button type="button" class="olliTtModeCardButton" data-tt-action-type="add">수업추가</button></section>`
      + `<section class="olliTtModeCard simple ${dialog.actionType === 'makeup' ? 'active' : ''}"><button type="button" class="olliTtModeCardButton" data-tt-action-type="makeup">보강</button></section>`
      + '</div></div>';
    return dialogHead('↗', `${student.name} 수업 설정`, headerGuide)
      + '<div class="olliTtDialogBody">'
      + '<div class="olliTtField"><div class="olliTtFieldHead"><span>설정 방식</span></div>' + modeCards + '</div>'
      + scheduledHtml
      + (isMakeup ? `<div class="olliTtField"><div class="olliTtFieldHead"><span>보강 날짜</span></div><input type="date" class="olliTtDateInput" data-tt-effective-date min="${todayKey()}" value="${esc(dialog.effectiveDate)}"></div>` : `<div class="olliTtField"><div class="olliTtFieldHead"><span>새 요일</span></div><div class="olliTtChoiceGrid">${dayHtml}</div></div>`)
      + `<div class="olliTtField"><div class="olliTtFieldHead"><span>${isMakeup ? '보강 시간' : '새 시간'}</span></div><div class="olliTtChoiceGrid times">${timeHtml}</div></div>`
      + classGroupChoiceHtml(division, dialog.targetClassGroup, dialog.targetWeekday, dialog.targetTime, true)
      + (isMakeup ? '' : `<div class="olliTtField"><div class="olliTtFieldHead"><span>적용 날짜</span></div><input type="date" class="olliTtDateInput" data-tt-effective-date min="${todayKey()}" value="${esc(dialog.effectiveDate)}"></div>`)
      + `<div class="olliTtDialogActions"><button type="button" class="olliTtDialogCancel" data-tt-dialog-close>취소</button><button type="button" class="olliTtDialogPrimary" data-tt-save-move>${isMakeup ? '보강 등록' : '저장'}</button></div></div>`;
  }

  function addPickerHtml(dialog) {
    const students = service.activeStudents().filter((student) => divisionOf(student) === dialog.division && (!dialog.query || clean(student.name).includes(dialog.query)));
    return students.length ? students.map((student) => `<button type="button" class="olliTtPickerStudent ${clean(student.id) === dialog.studentId ? 'active' : ''}" data-tt-add-student="${esc(student.id)}"><strong>${esc(student.name)}</strong><span>${esc(studentScheduleText(student.id)) || '수업 없음'}</span></button>`).join('') : '<div class="olliTtQuickEmpty">학생을 찾지 못했습니다.</div>';
  }

  function renderAddPickerResults(dialogElement) {
    const picker = dialogElement && dialogElement.querySelector('[data-tt-add-picker]');
    if (!picker || !state.dialog || state.dialog.kind !== 'add') return;
    picker.innerHTML = addPickerHtml(state.dialog);
    picker.querySelectorAll('[data-tt-add-student]').forEach((button) => button.addEventListener('click', () => {
      state.dialog.studentId = button.dataset.ttAddStudent;
      renderDialog();
    }));
  }

  function addDialogHtml(dialog) {
    const division = dialog.division;
    const selected = studentById(dialog.studentId);
    const note = clean(dialog.note);
    const hadMemo = Boolean(clean(dialog.originalNote));
    const canRegister = Boolean(selected || note || hadMemo);
    const primaryLabel = selected ? '등록' : (note ? '메모 저장' : (hadMemo ? '메모 삭제' : '등록'));
    return dialogHead('+', '이 시간에 학생 추가', '')
      + '<div class="olliTtDialogBody">'
      + `<label class="olliTtAddMemo"><span>메모</span><textarea data-tt-add-note maxlength="500" placeholder="메모를 입력하세요">${esc(dialog.note)}</textarea></label>`
      + '<div class="olliTtField"><div class="olliTtFieldHead"><span>추가 유형</span></div><div class="olliTtTypeGrid">'
      + `<button type="button" class="olliTtTypeBtn ${dialog.addType === 'wait' ? 'active' : ''}" data-tt-add-type="wait">대기 등록</button>`
      + `<button type="button" class="olliTtTypeBtn ${dialog.addType === 'makeup' ? 'active' : ''}" data-tt-add-type="makeup">보강 등록</button></div></div>`
      + '<div class="olliTtField"><div class="olliTtFieldHead"><span>학생 선택</span></div>'
      + `<input type="search" class="olliTtStudentSearch" data-tt-add-search value="${esc(dialog.query)}" placeholder="학생 검색"><div class="olliTtPickerList" data-tt-add-picker>`
      + addPickerHtml(dialog)
      + '</div></div>'
      + (division === 'elementary' ? `<div class="olliTtField olliTtSplitClassField"><div class="olliTtFieldHead"><span>클래스 운영</span><small>${isClassSplit(division, dialog.weekday, dialog.time) ? '분리된 A반·B반을 하나의 칸으로 통합합니다.' : '현재 칸을 위·아래 A반·B반으로 나눕니다.'}</small></div><button type="button" class="olliTtSplitClassBtn" ${isClassSplit(division, dialog.weekday, dialog.time) ? 'data-tt-merge-class' : 'data-tt-split-class'}>${isClassSplit(division, dialog.weekday, dialog.time) ? '클래스 통합' : '클래스 분리'}</button></div>` : '')
      + classGroupChoiceHtml(division, dialog.targetClassGroup, dialog.weekday, dialog.time, false, true)
      + `<div class="olliTtDialogActions"><button type="button" class="olliTtDialogCancel" data-tt-dialog-close>취소</button><button type="button" class="olliTtDialogPrimary" data-tt-save-add ${canRegister ? '' : 'disabled'}>${primaryLabel}</button></div></div>`;
  }

  function memoManageDialogHtml(dialog) {
    const date = parseDate(dialog.date);
    const day = weekdayLabel(date.getDay());
    return dialogHead('📝', '메모 삭제', `${koreanDate(date, true)} ${day}요일 · ${timeLabel(dialog.time)}`)
      + '<div class="olliTtDialogBody">'
      + `<div class="olliTtMemoDeletePreview"><span>현재 메모</span><div>${esc(dialog.memo)}</div></div>`
      + '<div class="olliTtStatusNotice">메모를 삭제하면 이 시간의 수업 설정 팝업에 저장된 메모 내용도 함께 지워집니다.</div>'
      + '<div class="olliTtDialogActions"><button type="button" class="olliTtDialogCancel" data-tt-dialog-close>취소</button><button type="button" class="olliTtDialogPrimary danger" data-tt-delete-memo>메모 삭제</button></div></div>';
  }

  function waitDialogHtml(dialog) {
    const item = waitlist().find((row) => clean(row.id) === clean(dialog.waitlistId));
    if (!item) return '';
    const capacity = capacityFor(clean(item.division));
    const occupied = countAt(clean(item.division), item.target_weekday, item.target_time_slot, dialog.effectiveDate, item.target_class_group);
    const canEnter = !capacity || occupied < capacity;
    return dialogHead('⌛', `${item.student_name} 대기 관리`, `${weekdayLabel(item.target_weekday)}요일 · ${timeLabel(item.target_time_slot)}${classGroupLabel(clean(item.division), item.target_class_group) ? ` · ${classGroupLabel(clean(item.division), item.target_class_group)}` : ''}`)
      + '<div class="olliTtDialogBody">'
      + `<div class="olliTtCurrentBox"><strong>${canEnter ? '입장 가능한 자리가 있습니다.' : '아직 정원이 가득 찼습니다.'}</strong>${item.request_type === 'move' ? '기존 수업을 옮기기 위한 대기' : '주간 수업을 추가하기 위한 대기'} · 현재 ${occupied}/${capacity || '∞'}</div>`
      + `<div class="olliTtField"><div class="olliTtFieldHead"><span>입장 적용 날짜</span><small>자리가 있는 날짜를 선택하세요</small></div><input type="date" class="olliTtDateInput" data-tt-wait-date min="${todayKey()}" value="${esc(dialog.effectiveDate)}"></div>`
      + '<div class="olliTtStatusNotice">입장시키기 직전에 정원을 다시 확인합니다. 대기를 취소해도 기존 수업은 그대로 유지됩니다.</div>'
      + `<div class="olliTtDialogActions"><button type="button" class="olliTtDialogCancel" data-tt-cancel-wait>대기 취소</button><button type="button" class="olliTtDialogPrimary" data-tt-accept-wait ${canEnter ? '' : 'disabled'}>입장시키기</button></div></div>`;
  }

  function makeupDialogHtml(dialog) {
    const item = oneTimeSessions().find((row) => clean(row.id) === clean(dialog.makeupId));
    if (!item) return '';
    const date = parseDate(item.session_date);
    return dialogHead('✓', `${item.student_name} 보강`, `${koreanDate(date)} ${DAYS[date.getDay() - 1]}요일 · ${timeLabel(item.time_slot)}`)
      + '<div class="olliTtDialogBody"><div class="olliTtCurrentBox"><strong>이 날짜에만 등록된 보강 수업입니다.</strong>정규 수업 시간은 변경되지 않습니다.</div>'
      + '<div class="olliTtDialogActions"><button type="button" class="olliTtDialogCancel" data-tt-dialog-close>닫기</button><button type="button" class="olliTtDialogPrimary danger" data-tt-cancel-makeup>보강 취소</button></div></div>';
  }

  function pickupPickerHtml(dialog) {
    const students = service.activeStudents().filter((student) => divisionOf(student) === 'kinder' && (!dialog.query || clean(student.name).includes(dialog.query)));
    return students.length ? students.map((student) => `<button type="button" class="olliTtPickerStudent ${clean(student.id) === dialog.studentId ? 'active' : ''}" data-tt-pickup-student="${esc(student.id)}"><strong>${esc(student.name)}</strong><span>${esc(studentScheduleText(student.id)) || '수업 없음'}</span></button>`).join('') : '<div class="olliTtQuickEmpty">학생을 찾지 못했습니다.</div>';
  }

  function renderPickupPickerResults(dialogElement) {
    const picker = dialogElement && dialogElement.querySelector('[data-tt-pickup-picker]');
    if (!picker || !state.dialog || state.dialog.kind !== 'pickupAdd') return;
    picker.innerHTML = pickupPickerHtml(state.dialog);
    picker.querySelectorAll('[data-tt-pickup-student]').forEach((button) => button.addEventListener('click', () => {
      state.dialog.studentId = button.dataset.ttPickupStudent;
      renderDialog();
    }));
  }

  function pickupAddDialogHtml(dialog) {
    const selected = studentById(dialog.studentId);
    return dialogHead('↳', '픽업 학생 추가', `${koreanDate(dialog.date)} ${weekdayLabel(dialog.weekday)}요일 · ${dialog.classTime}시 수업`)
      + '<div class="olliTtDialogBody">'
      + '<div class="olliTtField"><div class="olliTtFieldHead"><span>학생 선택</span><small>유치부 학생을 검색하세요</small></div>'
      + `<input type="search" class="olliTtStudentSearch" data-tt-pickup-search value="${esc(dialog.query)}" placeholder="학생 검색"><div class="olliTtPickerList" data-tt-pickup-picker>${pickupPickerHtml(dialog)}</div></div>`
      + '<div class="olliTtPickupForm">'
      + `<label><span>픽업 장소</span><input type="text" maxlength="80" data-tt-pickup-label value="${esc(dialog.pickupLabel)}" placeholder="예: 리슈빌"></label>`
      + `<label><span>픽업 시간</span><input type="time" data-tt-pickup-time value="${esc(dialog.pickupTime)}"></label></div>`
      + (selected ? `<div class="olliTtStatusNotice">${esc(selected.name)} 학생의 픽업 정보를 매주 ${weekdayLabel(dialog.weekday)}요일 ${dialog.classTime}시 수업에 등록합니다.</div>` : '')
      + '<div class="olliTtDialogActions"><button type="button" class="olliTtDialogCancel" data-tt-dialog-close>취소</button><button type="button" class="olliTtDialogPrimary" data-tt-save-pickup>픽업 등록</button></div></div>';
  }

  function pickupManageDialogHtml(dialog) {
    const item = pickups().find((row) => clean(row.id) === clean(dialog.pickupId));
    if (!item) return '';
    return dialogHead('↳', `${item.student_name} 픽업`, `${weekdayLabel(item.weekday)}요일 · ${item.class_time}시 수업`)
      + '<div class="olliTtDialogBody">'
      + `<div class="olliTtCurrentBox"><strong>${esc(item.pickup_label)} ${esc(pickupTimeLabel(item.pickup_time))}</strong>매주 반복되는 픽업 일정입니다.</div>`
      + `<div class="olliTtField"><div class="olliTtFieldHead"><span>삭제 적용 날짜</span><small>선택한 날짜부터 픽업 명단에서 제외됩니다.</small></div><input type="date" class="olliTtDateInput" data-tt-pickup-effective-date min="${todayKey()}" value="${esc(dialog.effectiveDate)}"></div>`
      + '<div class="olliTtDialogActions"><button type="button" class="olliTtDialogCancel" data-tt-dialog-close>닫기</button><button type="button" class="olliTtDialogPrimary danger" data-tt-remove-pickup>픽업 삭제</button></div></div>';
  }

  function historyActionLabel(item) {
    if (item && item.is_restore) return '이전 변경 복구';
    const details = Array.isArray(item && item.details) ? item.details : [];
    const onlyWaitAdded = details.length && details.every((detail) => detail.table_name === 'olli_schedule_waitlist' && detail.operation === 'INSERT');
    if (onlyWaitAdded) return clean(item.action_name) === 'move' ? '수업 이동 대기 등록' : '수업 추가 대기 등록';
    return ({
      move: '수업 이동',
      add: '주간 수업 추가',
      remove: '주간 수업 삭제',
      wait_accept: '대기 학생 입장',
      wait_cancel: '대기 취소',
      makeup_add: '보강 등록',
      makeup_cancel: '보강 취소',
      scheduled_cancel: '변경 예약 취소',
      restore: '이전 변경 복구'
    })[clean(item && item.action_name)] || '시간표 변경';
  }

  function historyStatusLabel(data, tableName) {
    const status = clean(data && data.status);
    if (!status) return '';
    if (tableName === 'olli_schedule_waitlist') return ({ waiting: '대기', offered: '입장 안내', accepted: '입장 완료', cancelled: '대기 취소' })[status] || status;
    if (tableName === 'olli_schedule_one_time_sessions') return ({ scheduled: '보강', attended: '출석 완료', cancelled: '보강 취소' })[status] || status;
    if (tableName === 'olli_schedule_changes') return ({ scheduled: '변경 예약', applied: '적용', cancelled: '예약 취소' })[status] || status;
    return status === 'cancelled' ? '삭제' : '';
  }

  function historyPoint(data, tableName) {
    if (!data) return '';
    if (tableName === 'olli_schedule_enrollments') {
      const point = `${weekdayLabel(data.weekday)}요일 ${timeLabel(data.time_slot)}`;
      const status = historyStatusLabel(data, tableName);
      return `${point}${status ? ` · ${status}` : ''}`;
    }
    if (tableName === 'olli_schedule_waitlist') {
      const point = `${weekdayLabel(data.target_weekday)}요일 ${timeLabel(data.target_time_slot)}`;
      return `${point} · ${historyStatusLabel(data, tableName) || '대기'}`;
    }
    if (tableName === 'olli_schedule_one_time_sessions') {
      return `${shortDate(data.session_date)} ${timeLabel(data.time_slot)} · ${historyStatusLabel(data, tableName) || '보강'}`;
    }
    return '';
  }

  function historyComparison(item) {
    const details = Array.isArray(item && item.details) ? item.details : [];
    const action = clean(item && item.action_name);
    const enrollmentsChanged = details.filter((detail) => detail.table_name === 'olli_schedule_enrollments');
    const waitChanged = details.find((detail) => detail.table_name === 'olli_schedule_waitlist');
    const makeupChanged = details.find((detail) => detail.table_name === 'olli_schedule_one_time_sessions');

    let before = '';
    let after = '';
    if (action === 'move') {
      const source = enrollmentsChanged.find((detail) => detail.operation === 'UPDATE');
      const target = enrollmentsChanged.find((detail) => detail.operation === 'INSERT');
      before = historyPoint(source && source.old_data, 'olli_schedule_enrollments');
      after = historyPoint(target && target.new_data, 'olli_schedule_enrollments')
        || historyPoint(waitChanged && waitChanged.new_data, 'olli_schedule_waitlist');
    } else if (action === 'add') {
      const target = enrollmentsChanged.find((detail) => detail.operation === 'INSERT');
      before = '추가 전';
      after = historyPoint(target && target.new_data, 'olli_schedule_enrollments')
        || historyPoint(waitChanged && waitChanged.new_data, 'olli_schedule_waitlist');
    } else if (action === 'remove') {
      const source = enrollmentsChanged.find((detail) => detail.operation === 'UPDATE');
      before = historyPoint(source && source.old_data, 'olli_schedule_enrollments');
      after = source && source.new_data && source.new_data.effective_to
        ? `${shortDate(source.new_data.effective_to)}까지 수업`
        : '수업 삭제';
    } else if (makeupChanged) {
      before = historyPoint(makeupChanged.old_data, makeupChanged.table_name) || '등록 전';
      after = historyPoint(makeupChanged.new_data, makeupChanged.table_name) || '등록 취소';
    } else if (waitChanged) {
      before = historyPoint(waitChanged.old_data, waitChanged.table_name) || '대기 전';
      after = historyPoint(waitChanged.new_data, waitChanged.table_name) || '대기 취소';
    }

    if (!before || !after) {
      const oldPoint = details.map((detail) => historyPoint(detail.old_data, detail.table_name)).find(Boolean);
      const newPoint = details.slice().reverse().map((detail) => historyPoint(detail.new_data, detail.table_name)).find(Boolean);
      before = before || oldPoint || '변경 전 상태';
      after = after || newPoint || '변경 후 상태';
    }
    return { before, after };
  }

  function historyDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function historyItemHtml(item) {
    const comparison = historyComparison(item);
    const restored = !!item.is_restored;
    const canRestore = !!item.can_restore && !item.is_restore && !restored;
    return `<article class="olliTtHistoryItem ${restored ? 'restored' : ''} ${item.is_restore ? 'restoreRecord' : ''}">`
      + `<div class="olliTtHistoryItemTop"><div><span class="olliTtHistoryAction">${esc(historyActionLabel(item))}</span><strong>${esc(item.student_name || '학생')}</strong></div><time>${esc(historyDateTime(item.created_at))}</time></div>`
      + `<div class="olliTtHistoryCompare"><span>${esc(comparison.before)}</span><i aria-hidden="true">→</i><span>${esc(comparison.after)}</span></div>`
      + `<div class="olliTtHistoryMeta"><span>${esc(item.actor_name || '기록 없음')} 수정</span>${restored ? '<b>복구 완료</b>' : item.is_restore ? '<b>복구 기록</b>' : ''}</div>`
      + (canRestore ? `<button type="button" class="olliTtHistoryRestoreBtn" data-tt-prepare-restore="${esc(item.transaction_id)}">이 변경만 복구</button>` : '')
      + '</article>';
  }

  function historyDialogHtml(dialog) {
    const data = dialog.data;
    let content = '<div class="olliTtHistoryLoading">변경 이력을 불러오고 있어요.</div>';
    if (!dialog.loading && dialog.error) content = `<div class="olliTtHistoryEmpty"><strong>변경 이력을 불러오지 못했어요.</strong><span>${esc(dialog.error)}</span><button type="button" data-tt-history-refresh>다시 불러오기</button></div>`;
    else if (!dialog.loading && data) {
      const items = Array.isArray(data.items) ? data.items : [];
      content = items.length ? `<div class="olliTtHistoryList">${items.map(historyItemHtml).join('')}</div>` : '<div class="olliTtHistoryEmpty"><strong>아직 저장된 변경이 없습니다.</strong><span>앞으로 발생하는 시간표 수정은 자동으로 기록됩니다.</span></div>';
    }
    const permissionText = data && data.can_restore
      ? '최근 30일 변경을 확인하고 한 건씩 안전하게 복구할 수 있습니다.'
      : '변경 내용은 확인할 수 있으며 복구는 원장·관리자만 가능합니다.';
    return dialogHead('↶', '시간표 변경 이력', permissionText)
      + `<div class="olliTtDialogBody olliTtHistoryBody"><div class="olliTtHistorySafety"><strong>자동 안전 기록</strong><span>시간표가 수정될 때마다 변경 전·후 상태를 서버에 저장합니다.</span></div>${content}`
      + '<div class="olliTtDialogActions"><button type="button" class="olliTtDialogCancel" data-tt-dialog-close>닫기</button><button type="button" class="olliTtDialogPrimary secondary" data-tt-history-refresh>새로고침</button></div></div>';
  }

  function restoreConfirmDialogHtml(dialog) {
    const item = dialog.item;
    const comparison = historyComparison(item);
    return dialogHead('!', '시간표 복구 확인', '버튼을 잘못 눌러도 바로 복구되지 않도록 한 번 더 확인합니다.')
      + '<div class="olliTtDialogBody olliTtRestoreConfirmBody">'
      + `<div class="olliTtRestoreTarget"><span>${esc(historyActionLabel(item))}</span><strong>${esc(item.student_name || '학생')}</strong><div><b>${esc(comparison.after)}</b><i aria-hidden="true">→</i><b>${esc(comparison.before)}</b></div></div>`
      + '<div class="olliTtRestoreWarning"><strong>복구 후에도 기록은 사라지지 않습니다.</strong><span>복구 작업도 새로운 변경 이력으로 남습니다. 이후 같은 학생의 시간표가 다시 수정된 경우에는 서버가 복구를 자동으로 막습니다.</span></div>'
      + '<label class="olliTtRestoreCheck"><input type="checkbox" data-tt-restore-check><span>위의 변경 전·후 내용을 확인했습니다.</span></label>'
      + '<div class="olliTtDialogActions"><button type="button" class="olliTtDialogCancel" data-tt-back-history>이전</button><button type="button" class="olliTtDialogPrimary danger" data-tt-confirm-restore disabled>확인 후 복구</button></div></div>';
  }

  function openHistory() {
    state.dialog = { kind: 'history', loading: true, data: null, error: '' };
    openOverlay();
    loadHistoryIntoDialog();
  }

  async function loadHistoryIntoDialog() {
    const token = ++state.historyLoadToken;
    if (!state.dialog || state.dialog.kind !== 'history') return;
    state.dialog.loading = true;
    state.dialog.error = '';
    renderDialog();
    try {
      const data = await service.loadHistory(50);
      if (token !== state.historyLoadToken || !state.dialog || state.dialog.kind !== 'history') return;
      state.dialog.loading = false;
      state.dialog.data = data;
      renderDialog();
    } catch (error) {
      if (token !== state.historyLoadToken || !state.dialog || state.dialog.kind !== 'history') return;
      state.dialog.loading = false;
      state.dialog.error = error && (error.message || error) || '잠시 후 다시 시도해 주세요.';
      renderDialog();
    }
  }

  function prepareHistoryRestore(transactionId) {
    const historyData = state.dialog && state.dialog.kind === 'history' ? state.dialog.data : null;
    const items = Array.isArray(historyData && historyData.items) ? historyData.items : [];
    const item = items.find((row) => clean(row.transaction_id) === clean(transactionId));
    if (!item || !item.can_restore) return;
    state.dialog = { kind: 'restoreConfirm', item, historyData };
    renderDialog();
  }

  function backToHistory() {
    const historyData = state.dialog && state.dialog.historyData;
    state.dialog = { kind: 'history', loading: !historyData, data: historyData || null, error: '' };
    renderDialog();
    if (!historyData) loadHistoryIntoDialog();
  }

  async function restoreHistoryAction() {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== 'restoreConfirm' || state.saving) return;
    state.saving = true;
    const button = document.querySelector('[data-tt-confirm-restore]');
    if (button) { button.disabled = true; button.textContent = '복구 중…'; }
    try {
      await service.restoreHistory(dialog.item.transaction_id);
      state.saving = false;
      state.data = null;
      state.dataWeek = '';
      state.dataAcademyId = '';
      await loadWeek();
      notify(`${dialog.item.student_name || '학생'} 시간표를 변경 전 상태로 복구했어요.`);
      openHistory();
    } catch (error) {
      state.saving = false;
      renderDialog();
      alert(error && (error.message || error) || '시간표 복구에 실패했습니다.');
    }
  }

  function renderDialog() {
    const dialog = document.getElementById('olliTtDialog');
    if (!dialog || !state.dialog) return;
    dialog.classList.toggle('olliTtHistoryDialog', state.dialog.kind === 'history');
    dialog.classList.toggle('olliTtRestoreDialog', state.dialog.kind === 'restoreConfirm');
    dialog.classList.toggle('olliTtMoveDialog', state.dialog.kind === 'move');
    dialog.classList.toggle('olliTtMoveOrAddMode', state.dialog.kind === 'move' && (state.dialog.actionType === 'move' || state.dialog.actionType === 'add'));
    dialog.classList.toggle('olliTtMakeupMode', state.dialog.kind === 'move' && state.dialog.actionType === 'makeup');
    dialog.classList.toggle('olliTtMemoManageDialog', state.dialog.kind === 'memoManage');
    if (state.dialog.kind === 'move') dialog.innerHTML = moveDialogHtml(state.dialog);
    else if (state.dialog.kind === 'add') dialog.innerHTML = addDialogHtml(state.dialog);
    else if (state.dialog.kind === 'memoManage') dialog.innerHTML = memoManageDialogHtml(state.dialog);
    else if (state.dialog.kind === 'wait') dialog.innerHTML = waitDialogHtml(state.dialog);
    else if (state.dialog.kind === 'makeup') dialog.innerHTML = makeupDialogHtml(state.dialog);
    else if (state.dialog.kind === 'pickupAdd') dialog.innerHTML = pickupAddDialogHtml(state.dialog);
    else if (state.dialog.kind === 'pickupManage') dialog.innerHTML = pickupManageDialogHtml(state.dialog);
    else if (state.dialog.kind === 'history') dialog.innerHTML = historyDialogHtml(state.dialog);
    else dialog.innerHTML = restoreConfirmDialogHtml(state.dialog);
    bindDialog();
  }

  function bindDialog() {
    const dialog = document.getElementById('olliTtDialog');
    if (!dialog || !state.dialog) return;
    dialog.querySelectorAll('[data-tt-dialog-close]').forEach((button) => button.addEventListener('click', closeDialog));
    dialog.querySelectorAll('[data-tt-action-type]').forEach((button) => button.addEventListener('click', () => {
      const nextAction = button.dataset.ttActionType;
      state.dialog.actionType = nextAction;
      if (state.dialog.kind === 'move' && nextAction === 'move' && !state.dialog.sourceEnrollmentId) {
        const source = activeWeeklySessions(state.dialog.studentId, new Date())[0] || currentStudentEnrollments(state.dialog.studentId)[0];
        if (source) {
          state.dialog.sourceEnrollmentId = clean(source.id);
          state.dialog.targetWeekday = Number(source.weekday);
          state.dialog.targetTime = Number(source.time_slot);
          state.dialog.targetClassGroup = classGroupOf(source);
        }
      }
      if (state.dialog.kind === 'move' && state.dialog.actionType === 'makeup') {
        let selectedDate = parseDate(state.dialog.effectiveDate);
        if (selectedDate.getDay() === 0) selectedDate = addDays(selectedDate, 1);
        state.dialog.effectiveDate = dateKey(selectedDate);
        state.dialog.targetWeekday = selectedDate.getDay();
        const student = studentById(state.dialog.studentId);
        const options = student ? timeOptionsFor(divisionOf(student), state.dialog.targetWeekday) : [];
        if (!options.includes(state.dialog.targetTime)) state.dialog.targetTime = options[0];
      }
      renderDialog();
    }));
    dialog.querySelectorAll('[data-tt-source]').forEach((button) => button.addEventListener('click', () => {
      state.dialog.sourceEnrollmentId = button.dataset.ttSource;
      const source = enrollments().find((item) => clean(item.id) === clean(button.dataset.ttSource));
      if (source && state.dialog && state.dialog.kind === 'move') {
        state.dialog.actionType = 'move';
        state.dialog.targetWeekday = Number(source.weekday);
        state.dialog.targetTime = Number(source.time_slot);
        state.dialog.targetClassGroup = classGroupOf(source);
      }
      renderDialog();
    }));

    dialog.querySelectorAll('[data-tt-session-order]').forEach((button) => button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!state.dialog || state.dialog.kind !== 'move') return;
      const studentId = state.dialog.studentId;
      const enrollmentId = button.dataset.enrollmentId;
      const sessionOrder = Number(button.dataset.ttSessionOrder);
      const buttons = Array.from(dialog.querySelectorAll('[data-tt-session-order]'));
      buttons.forEach((item) => { item.disabled = true; });
      try {
        if (await setWeeklySessionOrder(studentId, enrollmentId, sessionOrder)) {
          renderTimetable();
          if (state.dialog && state.dialog.kind === 'move') renderDialog();
        }
      } catch (error) {
        alert(error && (error.message || error) || '수업 회차 저장에 실패했습니다.');
        if (state.dialog && state.dialog.kind === 'move') renderDialog();
      }
    }));
    dialog.querySelectorAll('[data-tt-target-day]').forEach((button) => button.addEventListener('click', () => {
      state.dialog.targetWeekday = Number(button.dataset.ttTargetDay);
      const student = studentById(state.dialog.studentId);
      if (student) {
        const timeOptions = timeOptionsFor(divisionOf(student), state.dialog.targetWeekday);
        if (!timeOptions.includes(state.dialog.targetTime)) state.dialog.targetTime = timeOptions[0];
        if (!isClassSplit(divisionOf(student), state.dialog.targetWeekday, state.dialog.targetTime)) state.dialog.targetClassGroup = 'A';
      }
      renderDialog();
    }));
    dialog.querySelectorAll('[data-tt-target-time]').forEach((button) => button.addEventListener('click', () => {
      state.dialog.targetTime = Number(button.dataset.ttTargetTime);
      const student = studentById(state.dialog.studentId);
      if (student && !isClassSplit(divisionOf(student), state.dialog.targetWeekday, state.dialog.targetTime)) state.dialog.targetClassGroup = 'A';
      renderDialog();
    }));
    dialog.querySelectorAll('[data-tt-target-class]').forEach((button) => button.addEventListener('click', () => { state.dialog.targetClassGroup = button.dataset.ttTargetClass; renderDialog(); }));
    const effective = dialog.querySelector('[data-tt-effective-date]');
    if (effective) effective.addEventListener('change', () => {
      let selectedDate = parseDate(effective.value || todayKey());
      if (state.dialog.kind === 'move' && state.dialog.actionType === 'makeup') {
        if (selectedDate.getDay() === 0) selectedDate = addDays(selectedDate, 1);
        state.dialog.targetWeekday = selectedDate.getDay();
        const student = studentById(state.dialog.studentId);
        const options = student ? timeOptionsFor(divisionOf(student), state.dialog.targetWeekday) : [];
        if (!options.includes(state.dialog.targetTime)) state.dialog.targetTime = options[0];
      }
      state.dialog.effectiveDate = dateKey(selectedDate);
      renderDialog();
    });
    bindImeSafeSearch(
      dialog.querySelector('[data-tt-add-search]'),
      (value) => { if (state.dialog && state.dialog.kind === 'add') state.dialog.query = value; },
      () => renderAddPickerResults(dialog),
      null
    );
    dialog.querySelectorAll('[data-tt-add-student]').forEach((button) => button.addEventListener('click', () => { state.dialog.studentId = button.dataset.ttAddStudent; renderDialog(); }));
    dialog.querySelectorAll('[data-tt-add-type]').forEach((button) => button.addEventListener('click', () => { state.dialog.addType = button.dataset.ttAddType; renderDialog(); }));
    const addNote = dialog.querySelector('[data-tt-add-note]');
    if (addNote) addNote.addEventListener('input', () => {
      if (!state.dialog || state.dialog.kind !== 'add') return;
      state.dialog.note = addNote.value;
      const saveButton = dialog.querySelector('[data-tt-save-add]');
      if (saveButton) {
        const hasSelectedStudent = Boolean(state.dialog.studentId);
        const hasNote = Boolean(clean(state.dialog.note));
        const hadMemo = Boolean(clean(state.dialog.originalNote));
        saveButton.disabled = !(hasSelectedStudent || hasNote || hadMemo);
        saveButton.textContent = hasSelectedStudent ? '등록' : (hasNote ? '메모 저장' : (hadMemo ? '메모 삭제' : '등록'));
      }
    });
    bindImeSafeSearch(
      dialog.querySelector('[data-tt-pickup-search]'),
      (value) => { if (state.dialog && state.dialog.kind === 'pickupAdd') state.dialog.query = value; },
      () => renderPickupPickerResults(dialog),
      null
    );
    dialog.querySelectorAll('[data-tt-pickup-student]').forEach((button) => button.addEventListener('click', () => { state.dialog.studentId = button.dataset.ttPickupStudent; renderDialog(); }));
    const pickupLabel = dialog.querySelector('[data-tt-pickup-label]');
    if (pickupLabel) pickupLabel.addEventListener('input', () => { if (state.dialog && state.dialog.kind === 'pickupAdd') state.dialog.pickupLabel = pickupLabel.value; });
    const pickupTime = dialog.querySelector('[data-tt-pickup-time]');
    if (pickupTime) pickupTime.addEventListener('change', () => { if (state.dialog && state.dialog.kind === 'pickupAdd') state.dialog.pickupTime = pickupTime.value; });
    const pickupEffectiveDate = dialog.querySelector('[data-tt-pickup-effective-date]');
    if (pickupEffectiveDate) pickupEffectiveDate.addEventListener('change', () => { if (state.dialog && state.dialog.kind === 'pickupManage') state.dialog.effectiveDate = pickupEffectiveDate.value || todayKey(); });
    const waitDate = dialog.querySelector('[data-tt-wait-date]');
    if (waitDate) waitDate.addEventListener('change', () => { state.dialog.effectiveDate = waitDate.value || todayKey(); renderDialog(); });
    const saveMoveButton = dialog.querySelector('[data-tt-save-move]');
    if (saveMoveButton) saveMoveButton.addEventListener('click', saveMove);
    const deleteMemoButton = dialog.querySelector('[data-tt-delete-memo]');
    if (deleteMemoButton) deleteMemoButton.addEventListener('click', deleteCellMemo);
    const saveAddButton = dialog.querySelector('[data-tt-save-add]');
    if (saveAddButton) saveAddButton.addEventListener('click', saveAdd);
    const splitClassButton = dialog.querySelector('[data-tt-split-class]');
    if (splitClassButton) splitClassButton.addEventListener('click', splitClass);
    const mergeClassButton = dialog.querySelector('[data-tt-merge-class]');
    if (mergeClassButton) mergeClassButton.addEventListener('click', mergeClass);
    const splitKinderClassButton = dialog.querySelector('[data-tt-split-kinder-class]');
    if (splitKinderClassButton) splitKinderClassButton.addEventListener('click', splitKinderClass);
    const mergeKinderClassButton = dialog.querySelector('[data-tt-merge-kinder-class]');
    if (mergeKinderClassButton) mergeKinderClassButton.addEventListener('click', mergeKinderClass);
    const savePickupButton = dialog.querySelector('[data-tt-save-pickup]');
    if (savePickupButton) savePickupButton.addEventListener('click', savePickup);
    const removePickupButton = dialog.querySelector('[data-tt-remove-pickup]');
    if (removePickupButton) removePickupButton.addEventListener('click', removePickup);
    const acceptWait = dialog.querySelector('[data-tt-accept-wait]');
    if (acceptWait) acceptWait.addEventListener('click', () => resolveWait('accept'));
    const cancelWait = dialog.querySelector('[data-tt-cancel-wait]');
    if (cancelWait) cancelWait.addEventListener('click', () => resolveWait('cancel'));
    const cancelMakeup = dialog.querySelector('[data-tt-cancel-makeup]');
    if (cancelMakeup) cancelMakeup.addEventListener('click', cancelMakeupSession);
    dialog.querySelectorAll('[data-tt-history-refresh]').forEach((button) => button.addEventListener('click', loadHistoryIntoDialog));
    dialog.querySelectorAll('[data-tt-prepare-restore]').forEach((button) => button.addEventListener('click', () => prepareHistoryRestore(button.dataset.ttPrepareRestore)));
    const restoreCheck = dialog.querySelector('[data-tt-restore-check]');
    const confirmRestore = dialog.querySelector('[data-tt-confirm-restore]');
    if (restoreCheck && confirmRestore) restoreCheck.addEventListener('change', () => { confirmRestore.disabled = !restoreCheck.checked; });
    if (confirmRestore) confirmRestore.addEventListener('click', restoreHistoryAction);
    const backHistory = dialog.querySelector('[data-tt-back-history]');
    if (backHistory) backHistory.addEventListener('click', backToHistory);
    dialog.querySelectorAll('[data-tt-remove-enrollment]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      removeSelectedEnrollment(button.dataset.ttRemoveEnrollment);
    }));
    dialog.querySelectorAll('[data-tt-cancel-change]').forEach((button) => button.addEventListener('click', () => cancelScheduledChange(button.dataset.ttCancelChange)));
  }

  async function toggleAttendance(button) {
    if (!button || button.disabled) return;
    const sessionDate = clean(button.dataset.sessionDate);
    if (sessionDate > todayKey()) {
      alert('아직 수업하지 않은 날짜는 출석 체크할 수 없습니다.');
      return;
    }
    const card = button.closest('.olliTtStudent');
    const wasAttended = !!(card && card.classList.contains('attended'));
    if (card) card.classList.toggle('attended', !wasAttended);
    button.disabled = true;
    try {
      const result = await service.toggleAttendance({
        studentId: button.dataset.studentId,
        sessionDate,
        timeSlot: Number(button.dataset.time),
        classGroup: button.dataset.classGroup,
        sessionKind: button.dataset.ttAttendance
      });
      const next = attendanceMarks().filter((item) => !(clean(item.student_id) === clean(button.dataset.studentId)
        && clean(item.session_date) === sessionDate
        && Number(item.time_slot) === Number(button.dataset.time)
        && classGroupOf(item) === classGroupOf({ class_group: button.dataset.classGroup })
        && clean(item.session_kind) === clean(button.dataset.ttAttendance)));
      if (result.attended) next.push({
        student_id: button.dataset.studentId,
        session_date: sessionDate,
        time_slot: Number(button.dataset.time),
        class_group: classGroupOf({ class_group: button.dataset.classGroup }),
        session_kind: button.dataset.ttAttendance,
        marked_at: result.marked_at || new Date().toISOString()
      });
      state.data.attendance = next;
      if (card) card.classList.toggle('attended', !!result.attended);
    } catch (error) {
      if (card) card.classList.toggle('attended', wasAttended);
      alert(error && (error.message || error) || '출석 체크를 저장하지 못했습니다.');
    } finally {
      button.disabled = false;
    }
  }

  async function withSaving(task) {
    if (state.saving) return;
    state.saving = true;
    const primary = document.querySelector('#olliTtDialog .olliTtDialogPrimary');
    if (primary) { primary.disabled = true; primary.textContent = '저장 중…'; }
    try {
      const result = await task();
      state.saving = false;
      closeDialog();
      state.data = null;
      await loadWeek();
      return result;
    } catch (error) {
      state.saving = false;
      renderDialog();
      alert(error && (error.message || error) || '시간표 저장에 실패했습니다.');
      return null;
    }
  }

  async function saveMove() {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== 'move') return;
    if (dialog.actionType === 'move' && !dialog.sourceEnrollmentId) {
      alert('이동할 기존 수업을 선택해 주세요.');
      return;
    }
    const result = await withSaving(() => dialog.actionType === 'makeup'
      ? service.addMakeup(dialog.studentId, dialog.effectiveDate, dialog.targetTime, '', dialog.targetClassGroup)
      : service.changeSchedule({
        studentId: dialog.studentId,
        sourceEnrollmentId: dialog.actionType === 'move' ? dialog.sourceEnrollmentId : null,
        targetWeekday: dialog.targetWeekday,
        targetTimeSlot: dialog.targetTime,
        targetClassGroup: dialog.targetClassGroup,
        effectiveDate: dialog.effectiveDate,
        changeType: dialog.actionType,
        allowWait: true
      }));
    if (!result) return;
    const student = studentById(dialog.studentId);
    if (dialog.actionType === 'makeup') notify(`${student.name} 학생의 보강을 등록했어요.`);
    else if (result.result === 'waitlisted') notify(`${student.name} 학생을 대기로 등록했어요.`);
    else if (result.result === 'scheduled') notify(`${student.name} 학생의 시간표 변경을 예약했어요.`);
    else notify(`${student.name} 학생의 시간표를 변경했어요.`);
  }

  async function withOpenDialogSaving(task) {
    if (state.saving) return null;
    state.saving = true;
    const layoutButtons = document.querySelectorAll('#olliTtDialog [data-tt-split-kinder-class], #olliTtDialog [data-tt-merge-kinder-class]');
    layoutButtons.forEach((button) => { button.disabled = true; });
    try {
      const result = await task();
      const requestedWeek = dateKey(state.weekStart);
      const requestedAcademyId = typeof service.currentAcademyId === 'function' ? service.currentAcademyId() : '';
      const data = await service.loadWeek(requestedWeek);
      state.data = data;
      state.dataWeek = requestedWeek;
      state.dataAcademyId = requestedAcademyId;
      state.loading = false;
      state.loadingWeek = '';
      state.saving = false;
      renderTimetable();
      renderSidebar();
      refreshOpenStudentInfoPanel();
      renderDialog();
      return result;
    } catch (error) {
      state.saving = false;
      renderDialog();
      alert(error && (error.message || error) || '시간표 저장에 실패했습니다.');
      return null;
    }
  }

  async function splitClass() {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== 'add' || dialog.division !== 'elementary') return;
    if (!confirm(`${weekdayLabel(dialog.weekday)}요일 ${timeLabel(dialog.time)} 수업을 A반·B반으로 분리할까요?\n기존 학생은 A반에 그대로 유지됩니다.`)) return;
    const result = await withSaving(() => service.splitClass(dialog.weekday, dialog.time));
    if (result) notify(`${weekdayLabel(dialog.weekday)}요일 ${timeLabel(dialog.time)} 수업을 위·아래 두 반으로 분리했어요.`);
  }

  async function mergeClass() {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== 'add' || dialog.division !== 'elementary') return;
    if (!confirm(`${weekdayLabel(dialog.weekday)}요일 ${timeLabel(dialog.time)} 수업을 하나의 칸으로 통합할까요?`)) return;
    const result = await withSaving(() => service.mergeClass(dialog.weekday, dialog.time));
    if (result) notify(`${weekdayLabel(dialog.weekday)}요일 ${timeLabel(dialog.time)} 수업을 통합했어요.`);
  }

  async function splitKinderClass() {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== 'add' || dialog.division !== 'kinder') return;
    if (!confirm(`${weekdayLabel(dialog.weekday)}요일 ${timeLabel(dialog.time)} 유치부 수업을 A반·B반으로 다시 분반할까요?`)) return;
    dialog.targetClassGroup = 'A';
    const result = await withOpenDialogSaving(() => service.splitKinderClass(dialog.weekday, dialog.time));
    if (result) notify(`${weekdayLabel(dialog.weekday)}요일 ${timeLabel(dialog.time)} 유치부 수업을 A반·B반으로 분반했어요.`);
  }

  async function mergeKinderClass() {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== 'add' || dialog.division !== 'kinder') return;
    if (!confirm(`${weekdayLabel(dialog.weekday)}요일 ${timeLabel(dialog.time)} 유치부 A반·B반을 합반할까요?\n기존 A반·B반 학생은 그대로 유지되며 한 칸에 함께 표시됩니다.`)) return;
    dialog.targetClassGroup = 'A';
    const result = await withOpenDialogSaving(() => service.mergeKinderClass(dialog.weekday, dialog.time));
    if (result) notify(`${weekdayLabel(dialog.weekday)}요일 ${timeLabel(dialog.time)} 유치부 수업을 합반했어요.`);
  }

  async function persistDialogCellMemo(dialog) {
    if (!dialog || dialog.kind !== 'add') return null;
    return saveCellMemoText(dialog.division, dialog.date, dialog.time, dialog.note);
  }

  async function deleteCellMemo() {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== 'memoManage') return;
    const result = await withSaving(() => saveCellMemoText(dialog.division, dialog.date, dialog.time, ''));
    if (result) notify('시간표 메모를 삭제했어요.');
  }

  async function saveAdd() {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== 'add') return;
    const hasStudent = Boolean(dialog.studentId);
    const note = clean(dialog.note);
    const hadMemo = Boolean(clean(dialog.originalNote));
    if (!hasStudent && !note && !hadMemo) return;

    if (!hasStudent) {
      const memoResult = await withSaving(() => persistDialogCellMemo(dialog));
      if (memoResult) notify(note ? '시간표 메모를 저장했어요.' : '시간표 메모를 삭제했어요.');
      return;
    }

    if (dialog.date < todayKey()) {
      alert('지난 날짜에는 학생을 추가할 수 없습니다.');
      return;
    }

    const combined = await withSaving(async () => {
      const actionResult = dialog.addType === 'makeup'
        ? await service.addMakeup(dialog.studentId, dialog.date, dialog.time, note, dialog.targetClassGroup)
        : await service.addWaitlist({
          studentId: dialog.studentId,
          targetWeekday: dialog.weekday,
          targetTimeSlot: dialog.time,
          targetClassGroup: dialog.targetClassGroup,
          effectiveDate: dialog.date
        });

      let memoError = '';
      try {
        await persistDialogCellMemo(dialog);
      } catch (error) {
        memoError = clean(error && (error.message || error)) || '메모 저장 실패';
      }
      return { actionResult, memoError };
    });

    if (!combined || !combined.actionResult) return;
    const result = combined.actionResult;
    const student = studentById(dialog.studentId);
    if (dialog.addType === 'makeup') notify(`${student.name} 학생의 보강을 등록했어요.`);
    else notify(`${student.name} 학생을 대기로 등록했어요.`);
    if (combined.memoError) {
      alert(`학생 등록은 완료됐지만 시간표 메모는 저장하지 못했습니다.\n${combined.memoError}`);
    }
  }

  async function savePickup() {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== 'pickupAdd') return;
    const root = document.getElementById('olliTtDialog');
    dialog.pickupLabel = clean(root && root.querySelector('[data-tt-pickup-label]')?.value || dialog.pickupLabel);
    dialog.pickupTime = clean(root && root.querySelector('[data-tt-pickup-time]')?.value || dialog.pickupTime);
    if (!dialog.studentId) { alert('픽업할 학생을 선택해 주세요.'); return; }
    if (!dialog.pickupLabel) { alert('픽업 장소를 입력해 주세요.'); return; }
    if (!dialog.pickupTime) { alert('픽업 시간을 입력해 주세요.'); return; }
    const student = studentById(dialog.studentId);
    const result = await withSaving(() => service.savePickup({
      studentId: dialog.studentId,
      weekday: dialog.weekday,
      classTime: dialog.classTime,
      pickupLabel: dialog.pickupLabel,
      pickupTime: dialog.pickupTime,
      effectiveDate: dialog.date
    }));
    if (result) notify(`${student.name} 학생의 픽업을 등록했어요.`);
  }

  async function removePickup() {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== 'pickupManage') return;
    const item = pickups().find((row) => clean(row.id) === clean(dialog.pickupId));
    if (!item) return;
    if (!global.confirm(`${item.student_name} 학생의 픽업 일정을 ${koreanDate(dialog.effectiveDate, true)}부터 삭제할까요?`)) return;
    const result = await withSaving(() => service.removePickup(dialog.pickupId, dialog.effectiveDate));
    if (result) notify(`${item.student_name} 학생의 픽업 일정을 삭제했어요.`);
  }

  async function resolveWait(action) {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== 'wait') return;
    const item = waitlist().find((row) => clean(row.id) === clean(dialog.waitlistId));
    const result = await withSaving(() => service.resolveWaitlist(dialog.waitlistId, action, dialog.effectiveDate));
    if (result) notify(action === 'accept' ? `${item.student_name} 학생을 수업에 입장시켰어요.` : `${item.student_name} 학생의 대기를 취소했어요.`);
  }

  async function cancelMakeupSession() {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== 'makeup') return;
    const item = oneTimeSessions().find((row) => clean(row.id) === clean(dialog.makeupId));
    const result = await withSaving(() => service.cancelMakeup(dialog.makeupId));
    if (result) notify(`${item.student_name} 학생의 보강을 취소했어요.`);
  }

  async function cancelScheduledChange(changeId) {
    const item = changes().find((row) => clean(row.id) === clean(changeId));
    if (!item) return;
    const result = await withSaving(() => service.cancelChange(changeId));
    if (result) notify(`${item.student_name} 학생의 시간표 변경 예약을 취소했어요.`);
  }

  async function removeSelectedEnrollment(enrollmentId) {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== 'move') return;
    const selectedEnrollmentId = clean(enrollmentId || dialog.sourceEnrollmentId);
    if (!selectedEnrollmentId) return;
    const student = studentById(dialog.studentId);
    const source = studentEnrollments(dialog.studentId).find((item) => clean(item.id) === selectedEnrollmentId);
    if (!student || !source || !enrollmentEffectiveOn(source, new Date())) {
      alert('현재 이용 중인 수업을 선택해 주세요.');
      return;
    }
    const schedule = `${weekdayLabel(source.weekday)}요일 ${timeLabel(source.time_slot)}`;
    const dateText = koreanDate(dialog.effectiveDate, true);
    if (!global.confirm(`${student.name} 학생의 ${schedule} 수업을 ${dateText}부터 삭제할까요?\n주간 수업 횟수가 1회 줄어듭니다.`)) return;
    const result = await withSaving(() => service.removeEnrollment(
      dialog.studentId,
      selectedEnrollmentId,
      dialog.effectiveDate
    ));
    if (!result) return;
    notify(result.result === 'scheduled'
      ? `${student.name} 학생의 ${schedule} 수업 삭제를 예약했어요.`
      : `${student.name} 학생의 ${schedule} 수업을 삭제했어요.`);
  }

  function studentInfoPanelHtml(student) {
    const rows = studentEnrollments(student.id).filter((item) => enrollmentEffectiveOn(item, new Date()));
    const waits = waitlist().filter((item) => clean(item.student_id) === clean(student.id));
    const scheduled = changes().filter((item) => clean(item.student_id) === clean(student.id) && item.status === 'scheduled');
    const regularText = rows.length ? rows.map((item) => `${weekdayLabel(item.weekday)}요일 ${timeLabel(item.time_slot)}`).join(' · ') : studentScheduleText(student.id) || '등록된 수업 없음';
    const statusRows = [
      `<div><strong>정규 수업</strong>　${esc(regularText)}</div>`,
      waits.length ? `<div><strong>대기</strong>　${waits.map((item) => `${weekdayLabel(item.target_weekday)} ${timeLabel(item.target_time_slot)}`).join(' · ')}</div>` : '',
      scheduled.length ? `<div><strong>변경 예약</strong>　${scheduled.map((item) => `${shortDate(item.effective_date)} ${item.change_type === 'remove' ? '삭제' : '적용'}`).join(' · ')}</div>` : ''
    ].filter(Boolean).join('');
    return `<div class="olliTtStudentInfoPanel" data-tt-info-student="${esc(student.id)}"><div class="olliTtStudentInfoPanelHead"><div class="olliTtStudentInfoPanelTitle">수업 시간표</div><button type="button" class="olliTtStudentInfoManage">수업·대기 설정</button></div><div class="olliTtStudentInfoRows">${statusRows}</div></div>`;
  }

  function injectStudentInfoPanel(student) {
    if (!student || !state.data) return;
    const modalId = divisionOf(student) === 'kinder' ? 'kinderInfoModal' : 'elementaryInfoModal';
    const card = document.querySelector(`#${modalId} .modalCard`);
    const actions = card && card.querySelector('.modalActions');
    if (!card || !actions) return;
    const legacyScheduleIds = divisionOf(student) === 'kinder'
      ? ['kinderLessonDayToggleRow', 'kinderLessonTimeToggleRow']
      : ['elementaryLessonDayToggleRow', 'elementaryLessonTimeToggleRow'];
    legacyScheduleIds.forEach((id) => {
      const control = document.getElementById(id);
      const field = control && control.closest('.kinderInfoModalField');
      if (field) field.hidden = true;
    });
    const old = card.querySelector('.olliTtStudentInfoPanel');
    if (old) old.remove();
    actions.insertAdjacentHTML('beforebegin', studentInfoPanelHtml(student));
    const panel = card.querySelector('.olliTtStudentInfoPanel');
    const button = panel && panel.querySelector('.olliTtStudentInfoManage');
    if (button) button.addEventListener('click', () => openMove(student.id));
  }

  function refreshOpenStudentInfoPanel() {
    const target = typeof global.studentInfoModalTarget !== 'undefined' ? global.studentInfoModalTarget : null;
    if (target) injectStudentInfoPanel(target);
  }

  function installStudentInfoBridge() {
    const original = global.olliPrepareInfoExtra;
    if (typeof original !== 'function' || original.__olliTimetableWrapped) return;

const wrapped = function(type, student) {
      const result = original.apply(this, arguments);
      if (state.data) setTimeout(() => injectStudentInfoPanel(student), 0);
      else {
        service.loadWeek(dateKey(mondayOf(new Date()))).then((data) => {
          state.data = data;
          injectStudentInfoPanel(student);
        }).catch((error) => console.warn('학생정보 시간표를 불러오지 못했습니다:', error));
      }
      return result;
    };
    wrapped.__olliTimetableWrapped = true;
    global.olliPrepareInfoExtra = wrapped;
  }

  async function refreshScheduleFromServer() {
    state.data = null;
    state.dataWeek = '';
    state.dataAcademyId = '';
    if (state.active && state.view === 'schedule' && state.pane === 'schedule') await loadWeek();
  }

  function install() {
    ensureUi();
    installStudentInfoBridge();
    const shell = document.getElementById('olliPcShell');
    if (shell && !shell.__olliTimetableObserver) {
      shell.__olliTimetableObserver = new MutationObserver(syncAttendanceActive);
      shell.__olliTimetableObserver.observe(shell, { attributes: true, attributeFilter: ['data-pc-section'] });
    }
    const originalSearch = global.pcHandleTopSearch;
    if (typeof originalSearch === 'function' && !originalSearch.__olliTimetableWrapped) {
      const wrappedSearch = function(value) {
        if (state.active && state.view === 'schedule') {
          state.sidebarQuery = clean(value);
          renderSidebar();
          if (state.pane === 'attendance') renderAttendanceRegister();
          return;
        }
        return originalSearch.apply(this, arguments);
      };
      wrappedSearch.__olliTimetableWrapped = true;
      global.pcHandleTopSearch = wrappedSearch;
    }
    global.olliPcSetAttendanceView = setView;
    global.olliTtRenderScheduleHeader = renderWorkspaceHeader;
    global.olliTtOpenStudentSchedule = openMove;
    global.olliTtRefreshSchedule = refreshScheduleFromServer;
    syncAttendanceActive();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(window);

