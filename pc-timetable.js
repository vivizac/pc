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
    view: 'schedule',
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
    attendanceSavingCount: 0,
    dialog: null,
    saving: false,
    historyLoadToken: 0,
    syncRevision: 0,
    syncAcademyId: '',
    syncChecking: false
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
  async function refreshStudentsFromServer(options = {}) {
    if (typeof global.loadStudentsFromSupabase === 'function') {
      try { await global.loadStudentsFromSupabase(options); } catch (error) { console.warn('담임 학생정보 동기화 실패:', error); }
    }
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

  let timetableMemoHoverPreview = null;

  function hideTimetableMemoHoverPreview() {
    if (timetableMemoHoverPreview) timetableMemoHoverPreview.remove();
    timetableMemoHoverPreview = null;
  }

  function showTimetableMemoHoverPreview(card) {
    if (!card || !card.isConnected) return;
    const host = card.closest('.olliTtClassLane, .olliTtCell');
    if (!host) return;
    const cardRect = card.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const isClipped = cardRect.bottom > hostRect.bottom + 1 || cardRect.top < hostRect.top - 1;
    if (!isClipped) return;
    const text = clean(card.querySelector('strong')?.textContent);
    if (!text) return;

    hideTimetableMemoHoverPreview();
    const preview = document.createElement('div');
    preview.className = 'olliTtMemoHoverPreview';
    preview.innerHTML = `<span aria-hidden="true">📝</span><strong>${esc(text)}</strong>`;
    document.body.appendChild(preview);
    timetableMemoHoverPreview = preview;

    const width = Math.min(Math.max(cardRect.width, 190), Math.max(190, window.innerWidth - 24));
    preview.style.width = `${width}px`;
    const previewRect = preview.getBoundingClientRect();
    let left = cardRect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - previewRect.width - 8));
    let top = cardRect.top - previewRect.height - 6;
    if (top < 8) top = Math.min(window.innerHeight - previewRect.height - 8, cardRect.bottom + 6);
    preview.style.left = `${left}px`;
    preview.style.top = `${Math.max(8, top)}px`;
  }

  function bindTimetableMemoHoverPreview(root) {
    if (!root || root.__olliMemoHoverPreviewBound) return;
    root.__olliMemoHoverPreviewBound = true;
    root.addEventListener('pointerover', (event) => {
      const card = event.target.closest('.olliTtCellMemoCard');
      if (!card || !root.contains(card)) return;
      if (event.relatedTarget && card.contains(event.relatedTarget)) return;
      showTimetableMemoHoverPreview(card);
    });
    root.addEventListener('pointerout', (event) => {
      const card = event.target.closest('.olliTtCellMemoCard');
      if (!card || !root.contains(card)) return;
      if (event.relatedTarget && card.contains(event.relatedTarget)) return;
      hideTimetableMemoHoverPreview();
    });
    root.addEventListener('scroll', hideTimetableMemoHoverPreview, true);
  }

  function ensureUi() {
    const host = document.getElementById('recordBodyNew');
    if (!host) return null;
    const legacyTabs = document.getElementById('olliTtTabs');
    if (legacyTabs) legacyTabs.remove();
    let root = document.getElementById('olliTtRoot');
    if (!root) {
      root = document.createElement('div');
      root.id = 'olliTtRoot';
      root.className = 'olliTtRoot';
      root.setAttribute('aria-live', 'polite');
      host.insertBefore(root, document.getElementById('pcAcademyDetailPanel'));
      root.addEventListener('click', onTimetableClick);
    }
    bindTimetableMemoHoverPreview(root);
    ensureDialog();
    return { host, root };
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

  function setView() {
    state.view = 'schedule';
    const ui = ensureUi();
    if (!ui) return;
    const screen = document.getElementById('recordRoomScreen');
    if (screen) screen.classList.toggle('olliPcAttendanceScheduleView', state.active);
    ui.root.classList.toggle('show', state.active);

    if (!state.active) return;
    renderWorkspaceHeader();
    renderSidebar();
    if (state.pane === 'attendance') loadAttendanceRegister();
    else loadWeek();
  }

  function syncAttendanceActive() {
    const shell = document.getElementById('olliPcShell');
    const section = shell ? clean(shell.dataset.pcSection) : '';
    state.active = section === 'schedule';
    const ui = ensureUi();
    if (!ui) return;
    if (!state.active) {
      ui.root.classList.remove('show');
      const screen = document.getElementById('recordRoomScreen');
      if (screen) screen.classList.remove('olliPcAttendanceScheduleView');
      closeDialog();
      return;
    }
    setView();
  }


  function currentSyncAcademyId() {
    return typeof service.currentAcademyId === 'function' ? clean(service.currentAcademyId()) : '';
  }

  function scheduleEditorOpen() {
    return !!state.dialog || Array.from(document.querySelectorAll('.modalOverlay')).some(el => el.getClientRects().length)
      || !!document.activeElement?.matches('input, textarea, select, [contenteditable="true"]');
  }

  async function refreshActiveSchedulePane(realtimeContext) {
    if (!state.active || state.view !== 'schedule') return false;
    // 시간표/출석부 Realtime 갱신은 학생 정보를 읽기만 합니다.
    // 연령/학년 자동 보정 저장은 앱 시작 시 별도 경로에서만 수행합니다.
    await refreshStudentsFromServer({ skipLifecycleSync: true });
    if (realtimeContext && (!realtimeContext.isCurrent() || state.saving || scheduleEditorOpen())) return false;
    if (state.pane === 'attendance') return loadAttendanceRegister(realtimeContext);
    return loadWeek(realtimeContext);
  }

  async function readScheduleSyncRevision() {
    if (typeof service.loadSyncRevision !== 'function') return 0;
    const info = await service.loadSyncRevision();
    return Number(info && info.version || 0);
  }

  async function checkLiveScheduleSync(forceRefresh, realtimeContext) {
    if (!state.active || state.view !== 'schedule' || state.saving || state.syncChecking
      || state.loading
      || (state.pane === 'attendance' && state.attendanceLoading)
      || Number(state.attendanceSavingCount || 0) > 0
      || scheduleEditorOpen()) return false;
    if (!forceRefresh && typeof document !== 'undefined' && document.hidden) return false;
    const academyId = currentSyncAcademyId();
    if (!academyId) return false;
    const sessionToken = localStorage.getItem('olli_account_session_token_v1');
    const pane = state.pane;
    const week = dateKey(state.weekStart);
    const month = state.attendanceMonth;
    const isCurrent = () => academyId === currentSyncAcademyId()
      && sessionToken === localStorage.getItem('olli_account_session_token_v1')
      && pane === state.pane && week === dateKey(state.weekStart) && month === state.attendanceMonth
      && (!realtimeContext || realtimeContext.isCurrent());
    if (state.syncAcademyId !== academyId) {
      state.syncAcademyId = academyId;
      state.syncRevision = 0;
    }

    state.syncChecking = true;
    try {
      const version = await readScheduleSyncRevision();
      if (!version || !isCurrent() || state.saving || scheduleEditorOpen()) return false;
      const previous = Number(state.syncRevision || 0);
      const shouldRefresh = (previous > 0 && version !== previous) || (!!realtimeContext && !previous);
      if (shouldRefresh) {
        if (await refreshActiveSchedulePane({ isCurrent }) === false) return false;
      }
      if (!isCurrent()) return false;
      state.syncRevision = version;
      return true;
    } catch (error) {
      console.warn('시간표 실시간 동기화 확인 실패:', error);
      return false;
    } finally {
      state.syncChecking = false;
    }
  }

  async function syncBeforeScheduleMutation() {
    if (typeof service.loadSyncRevision !== 'function') return;
    const academyId = currentSyncAcademyId();
    if (!academyId) return;
    if (state.syncAcademyId !== academyId) {
      state.syncAcademyId = academyId;
      state.syncRevision = 0;
    }
    try {
      const version = await readScheduleSyncRevision();
      if (!version) return;
      const previous = Number(state.syncRevision || 0);
      if (!previous || version !== previous) {
        state.syncRevision = version;
        await refreshActiveSchedulePane();
      }
    } catch (error) {
      console.warn('저장 전 시간표 최신 확인 실패:', error);
    }
  }

  if (!global.__OLLI_TIMETABLE_LIVE_SYNC_V1__) {
    global.__OLLI_TIMETABLE_LIVE_SYNC_V1__ = true;
    // 시간표와 출석부 모두 Supabase Realtime을 사용합니다.
    // 포커스/화면 복귀 때만 revision을 한 번 확인해 연결 공백을 보완합니다.
    global.addEventListener('focus', () => { checkLiveScheduleSync(true); });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) checkLiveScheduleSync(true);
    });
  }

  if (typeof global.OlliRealtime?.watchDomain === 'function') {
    global.OlliRealtime.watchDomain('schedule', (context) => {
      // 시간표와 출석부는 같은 schedule revision 신호를 기준으로
      // 현재 열려 있는 pane의 서버 원본을 다시 읽습니다.
      if (!state.active || state.view !== 'schedule') return false;
      if (state.pane !== 'schedule' && state.pane !== 'attendance') return false;
      return checkLiveScheduleSync(true, context);
    });
  }

  async function loadWeek(realtimeContext) {
    if (!state.active || state.view !== 'schedule' || state.pane !== 'schedule') return false;
    const requestedWeek = dateKey(state.weekStart);
    const requestedAcademyId = typeof service.currentAcademyId === 'function' ? service.currentAcademyId() : '';
    const requestedSession = localStorage.getItem('olli_account_session_token_v1');
    const wasShowingRequestedWeek = state.dataWeek === requestedWeek && state.dataAcademyId === requestedAcademyId;
    if (state.loading && state.loadingWeek === requestedWeek && state.dataAcademyId === requestedAcademyId) return false;
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
    const hasRenderedGrid = !!document.querySelector('#olliTtRoot .olliTtGrid');
    if (!wasShowingRequestedWeek || !hasRenderedGrid) renderTimetable();
    try {
      const data = await service.loadWeek(requestedWeek);
      if (token !== state.loadToken) return false;
      if (requestedAcademyId !== currentSyncAcademyId()
        || requestedSession !== localStorage.getItem('olli_account_session_token_v1')
        || requestedWeek !== dateKey(state.weekStart)
        || (realtimeContext && (!realtimeContext.isCurrent() || state.saving || scheduleEditorOpen()))) {
        state.loading = false;
        state.loadingWeek = '';
        return false;
      }
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
      return true;
    } catch (error) {
      if (token !== state.loadToken) return false;
      state.loading = false;
      state.loadingWeek = '';
      if (requestedAcademyId !== currentSyncAcademyId()
        || requestedSession !== localStorage.getItem('olli_account_session_token_v1')
        || (realtimeContext && !realtimeContext.isCurrent())) return false;
      if (!state.data || state.dataWeek !== requestedWeek || state.dataAcademyId !== requestedAcademyId) {
        state.data = { error: error && (error.message || error) || '시간표를 불러오지 못했습니다.' };
        state.dataWeek = requestedWeek;
        state.dataAcademyId = requestedAcademyId;
        renderTimetable();
      }
      return false;
    }
  }

  function enrollments() { return Array.isArray(state.data && state.data.enrollments) ? state.data.enrollments : []; }
  function waitlist() { return Array.isArray(state.data && state.data.waitlist) ? state.data.waitlist : []; }
  function oneTimeSessions() { return Array.isArray(state.data && state.data.one_time_sessions) ? state.data.one_time_sessions : []; }
  function changes() { return Array.isArray(state.data && state.data.changes) ? state.data.changes : []; }
  function attendanceMarks() { return Array.isArray(state.data && state.data.attendance) ? state.data.attendance : []; }
  function pickups() { return Array.isArray(state.data && state.data.pickups) ? state.data.pickups : []; }
  function calendarDays() { return Array.isArray(state.data && state.data.calendar_days) ? state.data.calendar_days : []; }
  function calendarInfo(value) {
    const key = value instanceof Date ? dateKey(value) : clean(value).slice(0, 10);
    return calendarDays().find((item) => clean(item && item.session_date).slice(0, 10) === key) || null;
  }
  function isHolidayDate(value) { const info = calendarInfo(value); return !!(info && info.is_holiday === true); }
  function holidayName(value) { return clean(calendarInfo(value)?.name); }
  function classSplits() { return Array.isArray(state.data && state.data.class_splits) ? state.data.class_splits : []; }
  function kinderClassMerges() { return Array.isArray(state.data && state.data.kinder_class_merges) ? state.data.kinder_class_merges : []; }
  function cellMemos() { return Array.isArray(state.data && state.data.cell_memos) ? state.data.cell_memos : []; }
  function classTeachers() { return Array.isArray(state.data && state.data.class_teachers) ? state.data.class_teachers : []; }
  function teacherMembers() { return Array.isArray(state.data && state.data.teacher_members) ? state.data.teacher_members : []; }
  function teacherDisplayName(value) {
    const name = clean(value);
    if (!name) return '';
    return /T$/i.test(name) ? name : `${name}T`;
  }
  function teacherMemberById(memberId) {
    const id = clean(memberId);
    return teacherMembers().find((item) => clean(item && item.id) === id) || null;
  }
  function classTeacherFor(division, weekday, time, classGroup) {
    const group = classGroupOf({ class_group: classGroup });
    return classTeachers().find((item) => clean(item && item.division) === clean(division)
      && Number(item.weekday) === Number(weekday)
      && Number(item.time_slot) === Number(time)
      && classGroupOf(item) === group) || null;
  }
  function classTeacherLabel(division, weekday, time, classGroup) {
    const item = classTeacherFor(division, weekday, time, classGroup);
    return item ? teacherDisplayName(item.teacher_name) : '';
  }
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
    await refreshStudentsFromServer();
    state.data = null;
    await loadWeek();
    return true;
  }

  function cellMemoInfo(division, date, time) {
    const keyDate = date instanceof Date ? dateKey(date) : clean(date);
    return cellMemos().find((item) => clean(item.division) === clean(division)
      && clean(item.session_date) === keyDate
      && Number(item.time_slot) === Number(time)) || null;
  }

  function cellMemoText(division, date, time) {
    return clean(cellMemoInfo(division, date, time)?.note);
  }

  function cellMemoClassGroup(division, date, time) {
    const raw = clean(cellMemoInfo(division, date, time)?.class_group).toUpperCase();
    return raw === 'B' ? 'B' : 'A';
  }

  async function saveCellMemoText(division, date, time, note, classGroup) {
    if (typeof service.saveCellMemo !== 'function') throw new Error('시간표 메모 서버 연결을 찾지 못했습니다.');
    const keyDate = date instanceof Date ? dateKey(date) : clean(date);
    return service.saveCellMemo(clean(division), keyDate, Number(time), clean(note), classGroupOf({ class_group: classGroup }));
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
  function pickupTimeInputValue(value) {
    const match = clean(value).match(/^(\d{1,2}):(\d{2})/);
    if (!match) return '';
    return `${pad(Number(match[1]))}:${match[2]}`;
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

  let attendanceRegisterRuntime = null;
  function attendanceRegisterRuntimeApi() {
    if (!attendanceRegisterRuntime) {
      const module = global.OlliTimetableAttendanceRegisterModule;
      if (!module || typeof module.create !== 'function') throw new Error('시간표 출석부 모듈을 불러오지 못했습니다.');
      attendanceRegisterRuntime = module.create({
        state, service, clean, pad, divisionOf, esc, todayKey,
        notify, divisionLabel, ensureUi, renderAttendanceHeader
      });
    }
    return attendanceRegisterRuntime;
  }

  function monthLabel(value) { return attendanceRegisterRuntimeApi().monthLabel(value); }
  function shiftAttendanceMonth(amount) { return attendanceRegisterRuntimeApi().shiftAttendanceMonth(amount); }
  async function loadAttendanceRegister(realtimeContext) { return attendanceRegisterRuntimeApi().loadAttendanceRegister(realtimeContext); }
  function attendanceStudents() { return attendanceRegisterRuntimeApi().attendanceStudents(); }
  function attendanceRosterMeta(student) { return attendanceRegisterRuntimeApi().attendanceRosterMeta(student); }
  function sortedAttendanceStudents() { return attendanceRegisterRuntimeApi().sortedAttendanceStudents(); }
  function linkedAttendanceRegisterHtml() { return attendanceRegisterRuntimeApi().linkedAttendanceRegisterHtml(); }
  function renderAttendanceRegister() { return attendanceRegisterRuntimeApi().renderAttendanceRegister(); }

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
    const waitHtml = waits.map((item) => {
      const displayName = `${item.student_name}${item.is_guest === true ? ' (비)' : ''}`;
      return `<div class="olliTtStudent wait"><button type="button" class="olliTtAttendanceBtn" data-tt-entry="wait" data-waitlist-id="${esc(item.id)}">${esc(displayName)}</button><button type="button" class="olliTtStudentTag" data-tt-entry="wait" data-waitlist-id="${esc(item.id)}">대기</button></div>`;
    }).join('');
    const makeupHtml = makeups.map((item) => {
      const trial = clean(item.session_type) === 'trial';
      const displayName = `${item.student_name}${item.is_guest === true ? ' (비)' : ''}`;
      const attendanceTime = Number(item.time_slot);
      const entryClassGroup = classGroup ? classGroupOf({ class_group: classGroup }) : classGroupOf(item);
      if (trial) {
        return `<div class="olliTtStudent trial"><button type="button" class="olliTtAttendanceBtn" data-tt-entry="makeup" data-makeup-id="${esc(item.id)}">${esc(displayName)}</button><button type="button" class="olliTtStudentTag" data-tt-entry="makeup" data-makeup-id="${esc(item.id)}">체험</button></div>`;
      }
      const attended = isToday(date) && attendanceMarked(item.student_id, date, attendanceTime, entryClassGroup, 'makeup');
      return `<div class="olliTtStudent makeup${attended ? ' attended' : ''}"><button type="button" class="olliTtAttendanceBtn" data-tt-attendance="makeup" data-student-id="${esc(item.student_id)}" data-session-date="${dateKey(date)}" data-time="${attendanceTime}" data-class-group="${esc(entryClassGroup)}">${esc(displayName)}</button><button type="button" class="olliTtStudentTag" data-tt-entry="makeup" data-makeup-id="${esc(item.id)}">보강</button></div>`;
    }).join('');
    const memo = clean(memoText);
    const memoHtml = memo ? `<button type="button" class="olliTtCellMemoCard" data-tt-memo-card="1" data-division="${esc(division)}" data-date="${dateKey(date)}" data-time="${Number(time)}" data-class-group="${esc(classGroupOf({ class_group: classGroup }))}" aria-label="시간표 메모 관리"><span aria-hidden="true">📝</span><strong>${esc(memo)}</strong></button>` : '';
    return `<div class="olliTtEntries">${regularHtml}${waitHtml}${makeupHtml}${memoHtml}</div>`;
  }

  function cellHtml(division, date, displayTime) {
    if (division === 'elementary' && date.getDay() === 6 && Number(displayTime) > 3) {
      return '<div class="olliTtCell saturdayUnavailable" aria-hidden="true"></div>';
    }
    const time = storedTimeForCell(division, date, displayTime);
    const holiday = isHolidayDate(date);
    const attrs = `data-tt-cell="1" data-division="${division}" data-date="${dateKey(date)}" data-weekday="${date.getDay()}" data-time="${time}"${holiday ? ' data-holiday="1" aria-disabled="true"' : ''}`;
    const memo = cellMemoText(division, date, time);
    if (!isClassSplit(division, date.getDay(), time)) {
      const teacherLabel = classTeacherLabel(division, date.getDay(), time, 'A');
      const mergedLabel = teacherLabel || (division === 'kinder' ? 'A반' : '');
      const mergedClassHead = mergedLabel
        ? `<div class="olliTtClassLaneHead olliTtMergedClassHead"><strong>${esc(mergedLabel)}</strong></div>`
        : '';
      return `<div class="olliTtCell${division === 'kinder' ? ' kinder merged' : ''}${holiday ? ' holiday' : ''}" ${attrs}>${mergedClassHead}${cellContentsHtml(division, date, time, '', memo)}</div>`;
    }
    const memoGroup = cellMemoClassGroup(division, date, time);
    return `<div class="olliTtCell ${division} split${holiday ? ' holiday' : ''}" ${attrs}><div class="olliTtClassLanes ${division}">${['A', 'B'].map((group) => {
      const teacherLabel = classTeacherLabel(division, date.getDay(), time, group);
      const laneLabel = teacherLabel || (division === 'kinder' ? `${group}반` : '');
      const laneHead = laneLabel ? `<div class="olliTtClassLaneHead"><strong>${esc(laneLabel)}</strong></div>` : '';
      return `<div class="olliTtClassLane ${division}" ${attrs} data-class-group="${group}">${laneHead}${cellContentsHtml(division, date, time, group, memo && group === memoGroup ? memo : '')}</div>`;
    }).join('')}</div></div>`;
  }

  function pickupCellHtml(date, classTime) {
    const rows = slotPickups(date, classTime);
    const holiday = isHolidayDate(date);
    const cards = rows.map((item) => `<div class="olliTtPickupCard" data-tt-pickup-manage="${esc(item.id)}" data-tt-pickup-date="${dateKey(date)}"><strong>${esc(item.student_name)}</strong><span>${esc(item.pickup_label)} ${esc(pickupTimeLabel(item.pickup_time))}</span></div>`).join('');
    return `<div class="olliTtPickupCell${holiday ? ' holiday' : ''}" data-tt-pickup-cell="1" data-date="${dateKey(date)}" data-weekday="${date.getDay()}" data-class-time="${classTime}"${holiday ? ' data-holiday="1" aria-disabled="true"' : ''}><div class="olliTtPickupEntries">${cards}</div></div>`;
  }

  function pickupGridHtml(dates) {
    let grid = '<div class="olliTtPickupGrid"><div class="olliTtPickupTitle">픽업 시간표</div>';
    [4, 5].forEach((classTime) => {
      grid += `<div class="olliTtPickupTime">${classTime}시</div>`;
      dates.forEach((date) => { grid += pickupCellHtml(date, classTime); });
    });
    return `${grid}</div>`;
  }

  function elementaryAdaptiveEdgeRowHeight(displayTime, dates) {
    let required = 64;
    dates.forEach((date) => {
      if (date.getDay() === 6 && Number(displayTime) > 3) return;
      const storedTime = storedTimeForCell('elementary', date, displayTime);
      const hasMemo = !!cellMemoText('elementary', date, storedTime);
      let contentRows = 0;
      let headerHeight = 0;

      if (isClassSplit('elementary', date.getDay(), storedTime)) {
        contentRows = Math.ceil(slotEntryCount('elementary', date, storedTime, 'A') / 2)
          + Math.ceil(slotEntryCount('elementary', date, storedTime, 'B') / 2);
        if (classTeacherLabel('elementary', date.getDay(), storedTime, 'A')) headerHeight += 14;
        if (classTeacherLabel('elementary', date.getDay(), storedTime, 'B')) headerHeight += 14;
      } else {
        contentRows = Math.ceil(slotEntryCount('elementary', date, storedTime, '') / 2);
        if (classTeacherLabel('elementary', date.getDay(), storedTime, 'A')) headerHeight += 14;
      }

      const memoHeight = hasMemo ? 41 : 0;
      required = Math.max(required, 18 + headerHeight + (contentRows * 27) + memoHeight);
    });
    return Math.max(64, Math.min(220, Math.ceil(required)));
  }

  function sectionHtml(division) {
    const times = TIME_SLOTS[division];
    const dates = DAYS.map((_, index) => addDays(state.weekStart, index));
    const adaptiveClass = division === 'elementary' ? ' olliTtAdaptiveEdgeRows' : '';
    const adaptiveVars = division === 'elementary'
      ? `;--olli-tt-edge-row-1:${elementaryAdaptiveEdgeRowHeight(1, dates)}px;--olli-tt-edge-row-6:${elementaryAdaptiveEdgeRowHeight(6, dates)}px`
      : '';
    let grid = `<div class="olliTtGrid${adaptiveClass}" style="--olli-tt-rows:${times.length}${adaptiveVars}"><div class="olliTtCorner"></div>`;
    dates.forEach((date, index) => {
      const info = calendarInfo(date);
      const holiday = !!(info && info.is_holiday === true);
      const defaultHoliday = !!(info && info.default_holiday === true);
      const toggle = defaultHoliday
        ? `<button type="button" class="olliTtNormalClassBtn${holiday ? '' : ' active'}" data-tt-normal-class-date="${dateKey(date)}" data-tt-make-normal="${holiday ? '1' : '0'}">${holiday ? '정상수업' : '공휴일'}</button>`
        : '';
      grid += `<div class="olliTtDay ${isToday(date) ? 'today ' : ''}${holiday ? 'holiday' : ''}"${holidayName(date) ? ` title="${esc(holidayName(date))}"` : ''}><strong>${DAYS[index]}요일</strong><span>${date.getMonth() + 1}월 ${date.getDate()}일${isToday(date) ? ' · 오늘' : ''}</span>${toggle}</div>`;
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
    const normalClassButton = event.target.closest('[data-tt-normal-class-date]');
    if (normalClassButton) {
      const sessionDate = normalClassButton.dataset.ttNormalClassDate;
      const makeNormal = normalClassButton.dataset.ttMakeNormal === '1';
      normalClassButton.disabled = true;
      service.setNormalClassDay(sessionDate, makeNormal).then(async () => {
        state.data = null;
        state.dataWeek = '';
        state.attendanceCalendarMonth = '';
        state.attendanceCalendarDays = [];
        await loadWeek();
        notify(makeNormal ? '공휴일을 정상수업일로 변경했어요.' : '다시 공휴일로 설정했어요.');
      }).catch((error) => {
        normalClassButton.disabled = false;
        notify(error && (error.message || error) || '수업일 설정을 변경하지 못했습니다.');
      });
      return true;
    }
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
    const holidayTarget = event.target.closest('[data-holiday="1"]');
    if (holidayTarget) {
      event.preventDefault();
      event.stopPropagation();
      notify(`${holidayName(holidayTarget.dataset.date) || '공휴일'}에는 시간표 작업을 할 수 없습니다. 정상수업으로 변경한 뒤 이용해 주세요.`);
      return;
    }
    const attendanceButton = event.target.closest('[data-tt-attendance]');
    if (attendanceButton) {
      event.stopPropagation();
      toggleAttendance(attendanceButton);
      return;
    }
    const pickupManage = event.target.closest('[data-tt-pickup-manage]');
    if (pickupManage) {
      event.stopPropagation();
      openPickupManage(pickupManage.dataset.ttPickupManage, pickupManage.dataset.ttPickupDate);
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
    // 탭/헤더 상태를 먼저 반영하고, 큰 시간표·출석부 DOM 생성은 다음 프레임에서 실행합니다.
    // 클릭 이벤트 안에서 표 전체를 만들지 않아 버튼 피드백이 즉시 보입니다.
    renderSidebar();
    renderWorkspaceHeader();
    requestAnimationFrame(() => {
      if (!state.active || state.pane !== next) return;
      if (next === 'attendance') loadAttendanceRegister();
      else loadWeek();
    });
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
    const existingMemoGroup = existingMemo ? cellMemoClassGroup(division, targetDate, time) : '';
    const teacher = classTeacherFor(division, Number(dataset.weekday), time, targetClassGroup);
    const teacherMemberId = clean(teacher && teacher.teacher_member_id);
    state.dialog = {
      kind: 'add', division, date: targetDate,
      weekday: Number(dataset.weekday), time, studentId: '',
      query: '', guestName: '', note: existingMemo, originalNote: existingMemo, originalMemoGroup: existingMemoGroup, addType: 'wait', targetClassGroup,
      teacherMemberId, originalTeacherMemberId: teacherMemberId,
      pendingKinderMerge: false, pendingKinderSplit: false
    };
    openOverlay();
  }

  function openMemoManage(dataset) {
    const division = clean(dataset && dataset.division);
    const date = clean(dataset && dataset.date);
    const time = Number(dataset && dataset.time);
    const memo = cellMemoText(division, date, time);
    if (!division || !date || !time || !memo) return;
    state.dialog = { kind: 'memoManage', division, date, time, classGroup: classGroupOf({ class_group: dataset.classGroup }), memo, originalMemo: memo };
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

  function openPickupManage(pickupId, clickedDate) {
    const item = pickups().find((row) => clean(row.id) === clean(pickupId));
    if (!item) return;
    const tomorrowKey = dateKey(addDays(new Date(), 1));
    const requestedDate = clean(clickedDate);
    const initialEffectiveDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && requestedDate > todayKey()
      ? requestedDate
      : tomorrowKey;
    state.dialog = { kind: 'pickupManage', pickupId: clean(pickupId), pickupTime: pickupTimeInputValue(item.pickup_time), effectiveDate: initialEffectiveDate };
    openOverlay();
  }

  function dialogHead(icon, title, sub) {
    const subHtml = clean(sub) ? `<div class="olliTtDialogSub">${esc(sub)}</div>` : '';
    return `<div class="olliTtDialogHead"><div class="olliTtDialogIcon" aria-hidden="true">${icon}</div><div><div class="olliTtDialogTitle" id="olliTtDialogTitle">${esc(title)}</div>${subHtml}</div><button type="button" class="olliTtDialogClose" data-tt-dialog-close aria-label="닫기">×</button></div>`;
  }

  function classGroupChoiceHtml(division, selectedGroup, weekday, time, hideGuide, includeKinderLayoutControl) {
    const split = isClassSplit(division, weekday, time);
    const selected = classGroupOf({ class_group: selectedGroup });
    const pendingKinderMerge = Boolean(state.dialog && state.dialog.kind === 'add' && state.dialog.division === 'kinder' && state.dialog.pendingKinderMerge);
    const pendingKinderSplit = Boolean(state.dialog && state.dialog.kind === 'add' && state.dialog.division === 'kinder' && state.dialog.pendingKinderSplit);

    if (division === 'kinder' && includeKinderLayoutControl) {
      if (!split) {
        return '<div class="olliTtField"><div class="olliTtFieldHead"><span>수업 반</span><small>현재 A반·B반을 합반으로 운영하고 있습니다.</small></div>'
          + `<button type="button" class="olliTtSplitClassBtn ${pendingKinderSplit ? 'active' : ''}" data-tt-split-kinder-class>${pendingKinderSplit ? '클래스 분반 선택됨' : '클래스 분반'}</button></div>`;
      }
      return '<div class="olliTtField"><div class="olliTtFieldHead"><span>수업 반</span><small>반을 선택하거나 두 반을 합반할 수 있습니다.</small></div>'
        + '<div class="olliTtClassChoiceGrid kinderLayout">'
        + ['A', 'B'].map((group) => `<button type="button" class="olliTtChoice ${!pendingKinderMerge && selected === group ? 'active' : ''}" data-tt-target-class="${group}">${group}반</button>`).join('')
        + `<button type="button" class="olliTtChoice olliTtKinderMergeChoice ${pendingKinderMerge ? 'active' : ''}" data-tt-merge-kinder-class>클래스 합반</button>`
        + '</div></div>';
    }

    if (!split) return '';
    const guide = division === 'kinder' ? '유치부는 시간별로 A반·B반을 운영합니다.' : '분리된 수업의 반을 선택합니다.';
    return `<div class="olliTtField"><div class="olliTtFieldHead"><span>수업 반</span>${hideGuide ? '' : `<small>${guide}</small>`}</div><div class="olliTtClassChoiceGrid">`
      + ['A', 'B'].map((group) => `<button type="button" class="olliTtChoice ${selected === group ? 'active' : ''}" data-tt-target-class="${group}">${group}반</button>`).join('')
      + '</div></div>';
  }

  function teacherChoiceHtml(dialog) {
    const selected = clean(dialog.teacherMemberId);
    const teachers = teacherMembers();
    const group = classGroupOf({ class_group: dialog.targetClassGroup });
    const groupLabel = isClassSplit(dialog.division, dialog.weekday, dialog.time) || dialog.division === 'kinder' ? `${group}반` : '이 수업';
    if (!teachers.length) {
      return '<div class="olliTtField"><div class="olliTtFieldHead"><span>담임</span><small>설정에 등록된 선생님이 없습니다.</small></div></div>';
    }
    return `<div class="olliTtField"><div class="olliTtFieldHead"><span>담임</span><small>${esc(groupLabel)} 담당 선생님</small></div><div class="olliTtClassChoiceGrid olliTtTeacherChoiceGrid">`
      + `<button type="button" class="olliTtChoice ${selected ? '' : 'active'}" data-tt-class-teacher="">미지정</button>`
      + teachers.map((teacher) => `<button type="button" class="olliTtChoice ${selected === clean(teacher.id) ? 'active' : ''}" data-tt-class-teacher="${esc(teacher.id)}">${esc(teacherDisplayName(teacher.display_name))}</button>`).join('')
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

  function isGuestAddType(addType) {
    return addType === 'guest_wait' || addType === 'trial';
  }

  function hasAddRegistrationTarget(dialog) {
    if (!dialog) return false;
    return isGuestAddType(dialog.addType) ? Boolean(clean(dialog.guestName)) : Boolean(dialog.studentId);
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
    const guestMode = isGuestAddType(dialog.addType);
    const guestName = clean(dialog.guestName);
    const hasRegistrationTarget = guestMode ? Boolean(guestName) : Boolean(selected);
    const note = clean(dialog.note);
    const hadMemo = Boolean(clean(dialog.originalNote));
    const teacherChanged = clean(dialog.teacherMemberId) !== clean(dialog.originalTeacherMemberId);
    const canRegister = Boolean(hasRegistrationTarget || note || hadMemo || dialog.pendingKinderMerge || dialog.pendingKinderSplit || teacherChanged);
    const primaryLabel = (dialog.pendingKinderMerge || dialog.pendingKinderSplit)
      ? '등록'
      : (hasRegistrationTarget ? '등록' : (note ? '메모 저장' : (hadMemo ? '메모 삭제' : (teacherChanged ? '담임 저장' : '등록'))));
    const studentField = guestMode
      ? '<div class="olliTtField"><div class="olliTtFieldHead"><span>학생 이름</span><small>학생명단에 등록되지 않은 학생 이름을 직접 입력하세요.</small></div>'
        + `<input type="text" class="olliTtStudentSearch" data-tt-add-guest-name maxlength="60" value="${esc(dialog.guestName)}" placeholder="학생 이름 입력"></div>`
      : '<div class="olliTtField"><div class="olliTtFieldHead"><span>학생 선택</span></div>'
        + `<input type="search" class="olliTtStudentSearch" data-tt-add-search value="${esc(dialog.query)}" placeholder="학생 검색"><div class="olliTtPickerList" data-tt-add-picker>`
        + addPickerHtml(dialog)
        + '</div></div>';
    return dialogHead('+', '이 시간에 학생 추가', '')
      + '<div class="olliTtDialogBody">'
      + `<label class="olliTtAddMemo"><span>메모</span><textarea data-tt-add-note maxlength="500" placeholder="메모를 입력하세요">${esc(dialog.note)}</textarea></label>`
      + '<div class="olliTtField"><div class="olliTtFieldHead"><span>추가 유형</span></div><div class="olliTtTypeGrid">'
      + `<button type="button" class="olliTtTypeBtn ${dialog.addType === 'wait' ? 'active' : ''}" data-tt-add-type="wait">대기 등록</button>`
      + `<button type="button" class="olliTtTypeBtn ${dialog.addType === 'makeup' ? 'active' : ''}" data-tt-add-type="makeup">보강 등록</button>`
      + `<button type="button" class="olliTtTypeBtn ${dialog.addType === 'guest_wait' ? 'active' : ''}" data-tt-add-type="guest_wait">대기등록(비재원)</button>`
      + `<button type="button" class="olliTtTypeBtn ${dialog.addType === 'trial' ? 'active' : ''}" data-tt-add-type="trial">체험수업</button></div></div>`
      + studentField
      + (division === 'elementary' ? `<div class="olliTtField olliTtSplitClassField"><div class="olliTtFieldHead"><span>클래스 운영</span><small>${isClassSplit(division, dialog.weekday, dialog.time) ? '분리된 A반·B반을 하나의 칸으로 통합합니다.' : '현재 칸을 위·아래 A반·B반으로 나눕니다.'}</small></div><button type="button" class="olliTtSplitClassBtn" ${isClassSplit(division, dialog.weekday, dialog.time) ? 'data-tt-merge-class' : 'data-tt-split-class'}>${isClassSplit(division, dialog.weekday, dialog.time) ? '클래스 통합' : '클래스 분리'}</button></div>` : '')
      + classGroupChoiceHtml(division, dialog.targetClassGroup, dialog.weekday, dialog.time, false, true)
      + teacherChoiceHtml(dialog)
      + `<div class="olliTtDialogActions"><button type="button" class="olliTtDialogCancel" data-tt-dialog-close>취소</button><button type="button" class="olliTtDialogPrimary" data-tt-save-add ${canRegister ? '' : 'disabled'}>${primaryLabel}</button></div></div>`;
  }

  function memoManageDialogHtml(dialog) {
    const date = parseDate(dialog.date);
    const day = weekdayLabel(date.getDay());
    return dialogHead('📝', '메모 관리', `${koreanDate(date, true)} ${day}요일 · ${timeLabel(dialog.time)}`)
      + '<div class="olliTtDialogBody">'
      + `<label class="olliTtAddMemo"><span>메모</span><textarea data-tt-memo-edit maxlength="500" placeholder="메모를 입력하세요">${esc(dialog.memo)}</textarea></label>`
      + '<div class="olliTtStatusNotice">메모 내용을 수정한 뒤 저장하거나, 더 이상 필요하지 않으면 삭제할 수 있습니다.</div>'
      + '<div class="olliTtDialogActions"><button type="button" class="olliTtDialogPrimary" data-tt-save-memo>저장</button><button type="button" class="olliTtDialogPrimary danger" data-tt-delete-memo>메모 삭제</button></div></div>';
  }

  function waitDialogHtml(dialog) {
    const item = waitlist().find((row) => clean(row.id) === clean(dialog.waitlistId));
    if (!item) return '';
    const guest = item.is_guest === true;
    const displayName = `${item.student_name}${guest ? ' (비)' : ''}`;
    const capacity = capacityFor(clean(item.division));
    const occupied = countAt(clean(item.division), item.target_weekday, item.target_time_slot, dialog.effectiveDate, item.target_class_group);
    const canEnter = !guest && (!capacity || occupied < capacity);
    if (guest) {
      return dialogHead('⌛', `${displayName} 대기 관리`, `${weekdayLabel(item.target_weekday)}요일 · ${timeLabel(item.target_time_slot)}${classGroupLabel(clean(item.division), item.target_class_group) ? ` · ${classGroupLabel(clean(item.division), item.target_class_group)}` : ''}`)
        + '<div class="olliTtDialogBody">'
        + '<div class="olliTtCurrentBox"><strong>비재원 학생 대기입니다.</strong>현재 학생명단에는 등록하지 않고 대기 이름만 시간표에 보관합니다.</div>'
        + '<div class="olliTtDialogActions"><button type="button" class="olliTtDialogCancel" data-tt-dialog-close>닫기</button><button type="button" class="olliTtDialogPrimary danger" data-tt-cancel-wait>대기 취소</button></div></div>';
    }
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
    const trial = clean(item.session_type) === 'trial';
    const displayName = `${item.student_name}${item.is_guest === true ? ' (비)' : ''}`;
    const typeLabel = trial ? '체험' : '보강';
    return dialogHead(trial ? '★' : '✓', `${displayName} ${typeLabel}`, `${koreanDate(date)} ${DAYS[date.getDay() - 1]}요일 · ${timeLabel(item.time_slot)}`)
      + `<div class="olliTtDialogBody"><div class="olliTtCurrentBox"><strong>이 날짜에만 등록된 ${trial ? '체험수업' : '보강 수업'}입니다.</strong>${trial ? '비재원 학생의 체험 일정입니다.' : '정규 수업 시간은 변경되지 않습니다.'}</div>`
      + `<div class="olliTtDialogActions"><button type="button" class="olliTtDialogCancel" data-tt-dialog-close>닫기</button><button type="button" class="olliTtDialogPrimary danger" data-tt-cancel-makeup>${typeLabel} 취소</button></div></div>`;
  }

  function pickupPickerHtml(dialog) {
    const query = clean(dialog.query);
    const students = service.activeStudents().filter((student) => divisionOf(student) === 'kinder' && (!query || clean(student.name).includes(query)));
    if (!clean(dialog.studentId) && query) {
      const exactMatches = students.filter((student) => clean(student.name) === query);
      if (exactMatches.length === 1) dialog.studentId = clean(exactMatches[0].id);
    }
    return students.length ? students.map((student) => `<button type="button" class="olliTtPickerStudent ${clean(student.id) === clean(dialog.studentId) ? 'active' : ''}" data-tt-pickup-student="${esc(student.id)}"><strong>${esc(student.name)}</strong><span>${esc(studentScheduleText(student.id)) || '수업 없음'}</span></button>`).join('') : '<div class="olliTtQuickEmpty">학생을 찾지 못했습니다.</div>';
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
      + `<div class="olliTtCurrentBox"><strong>${esc(item.pickup_label)} ${esc(pickupTimeLabel(item.pickup_time))}</strong>현재 적용 중인 픽업 일정입니다.</div>`
      + '<div class="olliTtField"><div class="olliTtFieldHead"><span>픽업시간 수정</span><small>잘못 입력한 현재 시간을 바로 고칩니다.</small></div>'
      + `<input type="time" class="olliTtDateInput" data-tt-pickup-edit-time value="${esc(dialog.pickupTime)}"></div>`
      + `<div class="olliTtField"><div class="olliTtFieldHead"><span>변경 예약 적용일</span><small>선택한 날짜부터 위 시간이 적용됩니다.</small></div><input type="date" class="olliTtDateInput" data-tt-pickup-effective-date min="${dateKey(addDays(new Date(), 1))}" value="${esc(dialog.effectiveDate)}"></div>`
      + '<div class="olliTtPickupManageActions"><button type="button" class="olliTtDialogPrimary secondary" data-tt-update-pickup>현재 시간 수정</button><button type="button" class="olliTtDialogPrimary" data-tt-schedule-pickup>변경 예약</button></div>'
      + '<div class="olliTtDialogActions olliTtPickupDeleteActions"><button type="button" class="olliTtDialogCancel" data-tt-dialog-close>닫기</button><button type="button" class="olliTtDialogPrimary danger" data-tt-remove-pickup>픽업 삭제</button></div></div>';
  }

  let timetableHistoryRuntime = null;
  function timetableHistoryRuntimeApi() {
    if (!timetableHistoryRuntime) {
      const module = global.OlliTimetableHistoryModule;
      if (!module || typeof module.create !== 'function') throw new Error('시간표 변경 이력 모듈을 불러오지 못했습니다.');
      timetableHistoryRuntime = module.create({
        state, service, clean, weekdayLabel, timeLabel, shortDate, esc,
        dialogHead, openOverlay, renderDialog, loadWeek, notify
      });
    }
    return timetableHistoryRuntime;
  }

  function historyActionLabel(item) { return timetableHistoryRuntimeApi().historyActionLabel(item); }
  function historyStatusLabel(data, tableName) { return timetableHistoryRuntimeApi().historyStatusLabel(data, tableName); }
  function historyPoint(data, tableName) { return timetableHistoryRuntimeApi().historyPoint(data, tableName); }
  function historyComparison(item) { return timetableHistoryRuntimeApi().historyComparison(item); }
  function historyDateTime(value) { return timetableHistoryRuntimeApi().historyDateTime(value); }
  function historyItemHtml(item) { return timetableHistoryRuntimeApi().historyItemHtml(item); }
  function historyDialogHtml(dialog) { return timetableHistoryRuntimeApi().historyDialogHtml(dialog); }
  function restoreConfirmDialogHtml(dialog) { return timetableHistoryRuntimeApi().restoreConfirmDialogHtml(dialog); }
  function openHistory() { return timetableHistoryRuntimeApi().openHistory(); }
  async function loadHistoryIntoDialog() { return timetableHistoryRuntimeApi().loadHistoryIntoDialog(); }
  function prepareHistoryRestore(transactionId) { return timetableHistoryRuntimeApi().prepareHistoryRestore(transactionId); }
  function backToHistory() { return timetableHistoryRuntimeApi().backToHistory(); }
  async function restoreHistoryAction() { return timetableHistoryRuntimeApi().restoreHistoryAction(); }

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
    dialog.querySelectorAll('[data-tt-target-class]').forEach((button) => button.addEventListener('click', () => {
      state.dialog.targetClassGroup = button.dataset.ttTargetClass;
      if (state.dialog.kind === 'add') {
        state.dialog.pendingKinderMerge = false;
        state.dialog.pendingKinderSplit = false;
        const teacher = classTeacherFor(state.dialog.division, state.dialog.weekday, state.dialog.time, state.dialog.targetClassGroup);
        const teacherMemberId = clean(teacher && teacher.teacher_member_id);
        state.dialog.teacherMemberId = teacherMemberId;
        state.dialog.originalTeacherMemberId = teacherMemberId;
      }
      renderDialog();
    }));
    dialog.querySelectorAll('[data-tt-class-teacher]').forEach((button) => button.addEventListener('click', () => {
      if (!state.dialog || state.dialog.kind !== 'add') return;
      state.dialog.teacherMemberId = clean(button.dataset.ttClassTeacher);
      renderDialog();
    }));
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
    dialog.querySelectorAll('[data-tt-add-type]').forEach((button) => button.addEventListener('click', () => {
      if (!state.dialog || state.dialog.kind !== 'add') return;
      const previousGuestMode = isGuestAddType(state.dialog.addType);
      const nextType = button.dataset.ttAddType;
      const nextGuestMode = isGuestAddType(nextType);
      state.dialog.addType = nextType;
      if (nextGuestMode && !previousGuestMode) {
        state.dialog.studentId = '';
        state.dialog.query = '';
      } else if (!nextGuestMode && previousGuestMode) {
        state.dialog.guestName = '';
      }
      renderDialog();
    }));
    const guestNameInput = dialog.querySelector('[data-tt-add-guest-name]');
    if (guestNameInput) guestNameInput.addEventListener('input', () => {
      if (!state.dialog || state.dialog.kind !== 'add') return;
      state.dialog.guestName = guestNameInput.value;
      const saveButton = dialog.querySelector('[data-tt-save-add]');
      if (saveButton) {
        const canSave = hasAddRegistrationTarget(state.dialog)
          || Boolean(clean(state.dialog.note))
          || Boolean(clean(state.dialog.originalNote))
          || Boolean(state.dialog.pendingKinderMerge)
          || Boolean(state.dialog.pendingKinderSplit)
          || clean(state.dialog.teacherMemberId) !== clean(state.dialog.originalTeacherMemberId);
        saveButton.disabled = !canSave;
        if (hasAddRegistrationTarget(state.dialog)) saveButton.textContent = '등록';
      }
    });
    const addNote = dialog.querySelector('[data-tt-add-note]');
    if (addNote) addNote.addEventListener('input', () => {
      if (!state.dialog || state.dialog.kind !== 'add') return;
      state.dialog.note = addNote.value;
      const saveButton = dialog.querySelector('[data-tt-save-add]');
      if (saveButton) {
        const hasSelectedStudent = hasAddRegistrationTarget(state.dialog);
        const hasNote = Boolean(clean(state.dialog.note));
        const hadMemo = Boolean(clean(state.dialog.originalNote));
        const pendingKinderMerge = Boolean(state.dialog.pendingKinderMerge);
        const pendingKinderSplit = Boolean(state.dialog.pendingKinderSplit);
        const teacherChanged = clean(state.dialog.teacherMemberId) !== clean(state.dialog.originalTeacherMemberId);
        saveButton.disabled = !(hasSelectedStudent || hasNote || hadMemo || pendingKinderMerge || pendingKinderSplit || teacherChanged);
        saveButton.textContent = (pendingKinderMerge || pendingKinderSplit) ? '등록' : (hasSelectedStudent ? '등록' : (hasNote ? '메모 저장' : (hadMemo ? '메모 삭제' : (teacherChanged ? '담임 저장' : '등록'))));
      }
    });
    bindImeSafeSearch(
      dialog.querySelector('[data-tt-pickup-search]'),
      (value) => { if (state.dialog && state.dialog.kind === 'pickupAdd') state.dialog.query = value; },
      () => renderPickupPickerResults(dialog),
      null
    );
    if (!dialog.__olliPickupPointerBound) {
      dialog.__olliPickupPointerBound = true;
      dialog.addEventListener('pointerdown', (event) => {
        const button = event.target.closest('[data-tt-pickup-student]');
        if (!button || !state.dialog || state.dialog.kind !== 'pickupAdd') return;
        // 한글 검색창이 blur/compositionend로 결과 목록을 다시 그리기 전에 학생 ID를 먼저 보존합니다.
        state.dialog.studentId = clean(button.dataset.ttPickupStudent);
      }, true);
    }
    dialog.querySelectorAll('[data-tt-pickup-student]').forEach((button) => button.addEventListener('click', () => { state.dialog.studentId = button.dataset.ttPickupStudent; renderDialog(); }));
    const pickupLabel = dialog.querySelector('[data-tt-pickup-label]');
    if (pickupLabel) pickupLabel.addEventListener('input', () => { if (state.dialog && state.dialog.kind === 'pickupAdd') state.dialog.pickupLabel = pickupLabel.value; });
    const pickupTime = dialog.querySelector('[data-tt-pickup-time]');
    if (pickupTime) pickupTime.addEventListener('change', () => { if (state.dialog && state.dialog.kind === 'pickupAdd') state.dialog.pickupTime = pickupTime.value; });
    const pickupEditTime = dialog.querySelector('[data-tt-pickup-edit-time]');
    if (pickupEditTime) pickupEditTime.addEventListener('change', () => { if (state.dialog && state.dialog.kind === 'pickupManage') state.dialog.pickupTime = pickupEditTime.value; });
    const pickupEffectiveDate = dialog.querySelector('[data-tt-pickup-effective-date]');
    if (pickupEffectiveDate) pickupEffectiveDate.addEventListener('change', () => { if (state.dialog && state.dialog.kind === 'pickupManage') state.dialog.effectiveDate = pickupEffectiveDate.value || dateKey(addDays(new Date(), 1)); });
    const waitDate = dialog.querySelector('[data-tt-wait-date]');
    if (waitDate) waitDate.addEventListener('change', () => { state.dialog.effectiveDate = waitDate.value || todayKey(); renderDialog(); });
    const saveMoveButton = dialog.querySelector('[data-tt-save-move]');
    if (saveMoveButton) saveMoveButton.addEventListener('click', saveMove);
    const memoEdit = dialog.querySelector('[data-tt-memo-edit]');
    if (memoEdit) memoEdit.addEventListener('input', () => { if (state.dialog && state.dialog.kind === 'memoManage') state.dialog.memo = memoEdit.value; });
    const saveMemoButton = dialog.querySelector('[data-tt-save-memo]');
    if (saveMemoButton) saveMemoButton.addEventListener('click', saveManagedMemo);
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
    const updatePickupButton = dialog.querySelector('[data-tt-update-pickup]');
    if (updatePickupButton) updatePickupButton.addEventListener('click', updatePickupNow);
    const schedulePickupButton = dialog.querySelector('[data-tt-schedule-pickup]');
    if (schedulePickupButton) schedulePickupButton.addEventListener('click', schedulePickupChange);
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
      if (typeof service.setAttendance !== 'function') {
        throw new Error('출석 안전 저장 모듈을 찾지 못했습니다. 페이지를 새로고침해 주세요.');
      }
      const result = await service.setAttendance({
        studentId: button.dataset.studentId,
        sessionDate,
        timeSlot: Number(button.dataset.time),
        classGroup: button.dataset.classGroup,
        sessionKind: button.dataset.ttAttendance,
        present: !wasAttended
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
      await syncBeforeScheduleMutation();
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
    const result = await withSaving(async () => {
      const actionResult = dialog.actionType === 'makeup'
        ? await service.addMakeup(dialog.studentId, dialog.effectiveDate, dialog.targetTime, '', dialog.targetClassGroup)
        : await service.changeSchedule({
          studentId: dialog.studentId,
          sourceEnrollmentId: dialog.actionType === 'move' ? dialog.sourceEnrollmentId : null,
          targetWeekday: dialog.targetWeekday,
          targetTimeSlot: dialog.targetTime,
          targetClassGroup: dialog.targetClassGroup,
          effectiveDate: dialog.effectiveDate,
          changeType: dialog.actionType,
          allowWait: true
        });
      if (dialog.actionType !== 'makeup' && actionResult && actionResult.result !== 'scheduled' && actionResult.result !== 'waitlisted') {
        await refreshStudentsFromServer();
      }
      return actionResult;
    });
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
      await syncBeforeScheduleMutation();
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
    dialog.targetClassGroup = 'A';
    dialog.pendingKinderMerge = false;
    dialog.pendingKinderSplit = true;
    renderDialog();
  }

  async function mergeKinderClass() {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== 'add' || dialog.division !== 'kinder') return;
    dialog.targetClassGroup = 'A';
    dialog.pendingKinderSplit = false;
    dialog.pendingKinderMerge = true;
    renderDialog();
  }

  async function persistDialogCellMemo(dialog) {
    if (!dialog || dialog.kind !== 'add') return null;
    const unchanged = clean(dialog.note) === clean(dialog.originalNote);
    const classGroup = unchanged && clean(dialog.originalMemoGroup)
      ? dialog.originalMemoGroup
      : dialog.targetClassGroup;
    return saveCellMemoText(dialog.division, dialog.date, dialog.time, dialog.note, classGroup);
  }

  async function saveManagedMemo() {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== 'memoManage') return;
    const memo = clean(dialog.memo);
    if (!memo) {
      alert('메모 내용을 입력해 주세요. 삭제하려면 메모 삭제 버튼을 이용해 주세요.');
      return;
    }
    const result = await withSaving(() => saveCellMemoText(dialog.division, dialog.date, dialog.time, dialog.memo, dialog.classGroup));
    if (result) notify(memo === clean(dialog.originalMemo) ? '메모를 저장했어요.' : '메모 수정 내용을 저장했어요.');
  }

  async function deleteCellMemo() {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== 'memoManage') return;
    const result = await withSaving(() => saveCellMemoText(dialog.division, dialog.date, dialog.time, '', dialog.classGroup));
    if (result) notify('시간표 메모를 삭제했어요.');
  }

  async function saveAdd() {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== 'add') return;
    const guestMode = isGuestAddType(dialog.addType);
    const guestName = clean(dialog.guestName);
    const hasStudent = Boolean(dialog.studentId);
    const hasRegistrationTarget = guestMode ? Boolean(guestName) : hasStudent;
    const note = clean(dialog.note);
    const hadMemo = Boolean(clean(dialog.originalNote));
    const pendingKinderMerge = Boolean(dialog.pendingKinderMerge && dialog.division === 'kinder');
    const pendingKinderSplit = Boolean(dialog.pendingKinderSplit && dialog.division === 'kinder');
    const teacherChanged = clean(dialog.teacherMemberId) !== clean(dialog.originalTeacherMemberId);
    if (!hasRegistrationTarget && !note && !hadMemo && !pendingKinderMerge && !pendingKinderSplit && !teacherChanged) return;

    if (!hasRegistrationTarget) {
      const result = await withSaving(async () => {
        if (pendingKinderMerge) await service.mergeKinderClass(dialog.weekday, dialog.time);
        if (pendingKinderSplit) await service.splitKinderClass(dialog.weekday, dialog.time);
        if (teacherChanged) await service.setClassTeacher(dialog.division, dialog.weekday, dialog.time, dialog.targetClassGroup, dialog.teacherMemberId);
        if (note || hadMemo) await persistDialogCellMemo(dialog);
        if (teacherChanged) await refreshStudentsFromServer();
        return { merged: pendingKinderMerge, split: pendingKinderSplit, memoChanged: note || hadMemo, teacherChanged };
      });
      if (result) {
        if (pendingKinderMerge) notify(`${weekdayLabel(dialog.weekday)}요일 ${timeLabel(dialog.time)} 유치부 수업을 합반했어요.`);
        else if (pendingKinderSplit) notify(`${weekdayLabel(dialog.weekday)}요일 ${timeLabel(dialog.time)} 유치부 수업을 A반·B반으로 분반했어요.`);
        else if (teacherChanged) {
          const teacher = teacherMemberById(dialog.teacherMemberId);
          notify(teacher ? `${teacherDisplayName(teacher.display_name)} 담임으로 설정했어요.` : '담임 지정을 해제했어요.');
        }
        else notify(note ? '시간표 메모를 저장했어요.' : '시간표 메모를 삭제했어요.');
      }
      return;
    }

    if (dialog.date < todayKey()) {
      alert('지난 날짜에는 학생을 추가할 수 없습니다.');
      return;
    }

    const combined = await withSaving(async () => {
      if (pendingKinderMerge) await service.mergeKinderClass(dialog.weekday, dialog.time);
      if (pendingKinderSplit) await service.splitKinderClass(dialog.weekday, dialog.time);
      if (teacherChanged) await service.setClassTeacher(dialog.division, dialog.weekday, dialog.time, dialog.targetClassGroup, dialog.teacherMemberId);
      let actionResult;
      if (guestMode) {
        actionResult = await service.addGuestEntry({
          guestName,
          division: dialog.division,
          entryType: dialog.addType === 'trial' ? 'trial' : 'wait',
          sessionDate: dialog.date,
          timeSlot: dialog.time,
          classGroup: dialog.targetClassGroup
        });
      } else if (dialog.addType === 'makeup') {
        actionResult = await service.addMakeup(dialog.studentId, dialog.date, dialog.time, note, dialog.targetClassGroup);
      } else {
        actionResult = await service.addWaitlist({
          studentId: dialog.studentId,
          targetWeekday: dialog.weekday,
          targetTimeSlot: dialog.time,
          targetClassGroup: dialog.targetClassGroup,
          effectiveDate: dialog.date
        });
      }

      let memoError = '';
      try {
        await persistDialogCellMemo(dialog);
      } catch (error) {
        memoError = clean(error && (error.message || error)) || '메모 저장 실패';
      }
      if (teacherChanged) await refreshStudentsFromServer();
      return { actionResult, memoError };
    });

    if (!combined || !combined.actionResult) return;
    if (guestMode) {
      notify(dialog.addType === 'trial'
        ? `${guestName} (비) 체험수업을 등록했어요.`
        : `${guestName} (비) 학생을 대기로 등록했어요.`);
    } else {
      const student = studentById(dialog.studentId);
      if (dialog.addType === 'makeup') notify(`${student.name} 학생의 보강을 등록했어요.`);
      else notify(`${student.name} 학생을 대기로 등록했어요.`);
    }
    if (combined.memoError) {
      alert(`학생 등록은 완료됐지만 시간표 메모는 저장하지 못했습니다.
${combined.memoError}`);
    }
  }

  async function savePickup() {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== 'pickupAdd') return;
    const root = document.getElementById('olliTtDialog');
    dialog.pickupLabel = clean(root && root.querySelector('[data-tt-pickup-label]')?.value || dialog.pickupLabel);
    dialog.pickupTime = clean(root && root.querySelector('[data-tt-pickup-time]')?.value || dialog.pickupTime);
    if (!clean(dialog.studentId)) {
      const activeButton = root && root.querySelector('[data-tt-pickup-student].active');
      if (activeButton) dialog.studentId = clean(activeButton.dataset.ttPickupStudent);
    }
    if (!clean(dialog.studentId)) {
      const visibleButtons = root ? Array.from(root.querySelectorAll('[data-tt-pickup-student]')) : [];
      if (visibleButtons.length === 1) dialog.studentId = clean(visibleButtons[0].dataset.ttPickupStudent);
    }
    if (!clean(dialog.studentId)) {
      const query = clean(root && root.querySelector('[data-tt-pickup-search]')?.value || dialog.query);
      const exactMatches = service.activeStudents().filter((student) => divisionOf(student) === 'kinder' && clean(student.name) === query);
      if (exactMatches.length === 1) dialog.studentId = clean(exactMatches[0].id);
    }
    if (!clean(dialog.studentId)) { alert('픽업할 학생을 선택해 주세요.'); return; }
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

  async function updatePickupNow() {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== 'pickupManage') return;
    const item = pickups().find((row) => clean(row.id) === clean(dialog.pickupId));
    if (!item) return;
    if (!clean(dialog.pickupTime)) { alert('수정할 픽업 시간을 입력해 주세요.'); return; }
    const result = await withSaving(() => service.updatePickup(dialog.pickupId, dialog.pickupTime, todayKey(), 'edit'));
    if (result) notify(`${item.student_name} 학생의 픽업 시간을 수정했어요.`);
  }

  async function schedulePickupChange() {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== 'pickupManage') return;
    const item = pickups().find((row) => clean(row.id) === clean(dialog.pickupId));
    if (!item) return;
    if (!clean(dialog.pickupTime)) { alert('변경할 픽업 시간을 입력해 주세요.'); return; }
    if (!clean(dialog.effectiveDate) || dialog.effectiveDate <= todayKey()) { alert('변경 예약은 내일부터 설정할 수 있습니다.'); return; }
    const result = await withSaving(() => service.updatePickup(dialog.pickupId, dialog.pickupTime, dialog.effectiveDate, 'schedule'));
    if (result) notify(`${item.student_name} 학생의 픽업 시간 변경을 ${koreanDate(dialog.effectiveDate, true)}부터 예약했어요.`);
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
    if (result) notify(`${item.student_name}${item.is_guest === true ? ' (비)' : ''} 학생의 ${clean(item.session_type) === 'trial' ? '체험수업' : '보강'}을 취소했어요.`);
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

  function handlePreparedStudentInfo(type, student) {
    if (!student) return;
    if (state.data) setTimeout(() => injectStudentInfoPanel(student), 0);
    else {
      service.loadWeek(dateKey(mondayOf(new Date()))).then((data) => {
        state.data = data;
        injectStudentInfoPanel(student);
      }).catch((error) => console.warn('학생정보 시간표를 불러오지 못했습니다:', error));
    }
  }

  function installStudentInfoBridge() {
    global.olliTimetableAfterPrepareStudentInfo = handlePreparedStudentInfo;
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
