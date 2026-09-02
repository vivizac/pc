(function timetableUiModule(global) {
  'use strict';

  const service = global.OlliTimetableService;
  if (!service) {
    console.warn('OLLI 시간표 서비스를 불러오지 못했습니다.');
    return;
  }

  const DAYS = service.DAYS;
  const state = {
    active: false,
    view: 'list',
    weekStart: mondayOf(new Date()),
    data: null,
    loading: false,
    loadToken: 0,
    sidebarFilter: 'all',
    sidebarQuery: '',
    dialog: null,
    saving: false
  };

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function bindImeSafeSearch(input, updateValue, rerender, focusSelector) {
    if (!input) return;
    let composing = false;
    let skipNextInput = false;
    const applyValue = () => {
      updateValue(clean(input.value));
      rerender();
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
      renderSidebar();
      loadWeek();
    } else if (typeof global.pcRenderAttendanceList === 'function') {
      global.pcRenderAttendanceList();
    }
  }

  function syncAttendanceActive() {
    const shell = document.getElementById('olliPcShell');
    state.active = Boolean(shell && shell.dataset.pcSection === 'attendance');
    const ui = ensureUi();
    if (!ui) return;
    if (!state.active) {
      ui.root.classList.remove('show');
      const screen = document.getElementById('recordRoomScreen');
      if (screen) screen.classList.remove('olliPcAttendanceScheduleView');
      closeDialog();
      return;
    }
    setView(state.view);
  }

  async function loadWeek() {
    if (!state.active || state.view !== 'schedule') return;
    const token = ++state.loadToken;
    state.loading = true;
    renderTimetable();
    try {
      const data = await service.loadWeek(dateKey(state.weekStart));
      if (token !== state.loadToken) return;
      state.data = data;
      state.loading = false;
      renderTimetable();
      renderSidebar();
      refreshOpenStudentInfoPanel();
    } catch (error) {
      if (token !== state.loadToken) return;
      state.loading = false;
      state.data = { error: error && (error.message || error) || '시간표를 불러오지 못했습니다.' };
      renderTimetable();
    }
  }

  function enrollments() { return Array.isArray(state.data && state.data.enrollments) ? state.data.enrollments : []; }
  function waitlist() { return Array.isArray(state.data && state.data.waitlist) ? state.data.waitlist : []; }
  function oneTimeSessions() { return Array.isArray(state.data && state.data.one_time_sessions) ? state.data.one_time_sessions : []; }
  function changes() { return Array.isArray(state.data && state.data.changes) ? state.data.changes : []; }
  function enrollmentEffectiveOn(enrollment, date) {
    const key = dateKey(date);
    return clean(enrollment.effective_from) <= key
      && (!clean(enrollment.effective_to) || clean(enrollment.effective_to) >= key);
  }
  function enrollmentActiveOn(enrollment, date) {
    return Number(enrollment.weekday) === date.getDay() && enrollmentEffectiveOn(enrollment, date);
  }
  function slotRegulars(division, date, time) {
    return enrollments().filter((item) => clean(item.division) === division && Number(item.time_slot) === Number(time) && enrollmentActiveOn(item, date));
  }
  function slotWaitlist(division, weekday, time) {
    return waitlist().filter((item) => clean(item.division) === division && Number(item.target_weekday) === Number(weekday) && Number(item.target_time_slot) === Number(time));
  }
  function slotMakeups(division, date, time) {
    const key = dateKey(date);
    return oneTimeSessions().filter((item) => clean(item.division) === division && clean(item.session_date) === key && Number(item.time_slot) === Number(time));
  }
  function scheduledChangeForSource(enrollmentId) {
    return changes().find((item) => clean(item.source_enrollment_id) === clean(enrollmentId) && item.status === 'scheduled');
  }
  function capacityFor(division) { return division === 'elementary' ? Number(state.data && state.data.elementary_capacity || 5) : null; }
  function countAt(division, weekday, time, targetDate) {
    const date = parseDate(targetDate || todayKey());
    const wantedDay = Number(weekday);
    if (date.getDay() !== wantedDay) {
      const delta = (wantedDay - date.getDay() + 7) % 7;
      date.setDate(date.getDate() + delta);
    }
    return slotRegulars(division, date, time).length + slotMakeups(division, date, time).length;
  }

  function weekRangeText() {
    const end = addDays(state.weekStart, 5);
    if (state.weekStart.getMonth() === end.getMonth()) return `${state.weekStart.getMonth() + 1}월 ${state.weekStart.getDate()}일 – ${end.getDate()}일`;
    return `${state.weekStart.getMonth() + 1}월 ${state.weekStart.getDate()}일 – ${end.getMonth() + 1}월 ${end.getDate()}일`;
  }

  function cellHtml(division, date, time) {
    const regular = slotRegulars(division, date, time);
    const waits = slotWaitlist(division, date.getDay(), time);
    const makeups = slotMakeups(division, date, time);
    const capacity = capacityFor(division);
    const occupied = regular.length + makeups.length;
    const meta = capacity ? `<strong>${occupied}/${capacity}</strong><span>${occupied >= capacity ? '마감' : `${capacity - occupied}자리`}${waits.length ? ` · 대기 ${waits.length}` : ''}</span>` : `<strong>${occupied}명</strong><span>${makeups.length ? `보강 ${makeups.length}` : ''}</span>`;
    const regularHtml = regular.map((item) => {
      const scheduled = scheduledChangeForSource(item.id);
      const scheduleText = scheduled ? `<span class="olliTtReservation">◷ ${shortDate(scheduled.effective_date)} ${scheduled.change_type === 'remove' ? '삭제' : '이동'} 예정</span>` : '';
      return `<button type="button" class="olliTtStudent regular ${division}" data-tt-entry="regular" data-student-id="${esc(item.student_id)}" data-enrollment-id="${esc(item.id)}">${esc(item.student_name)}${scheduleText}</button>`;
    }).join('');
    const waitHtml = waits.map((item) => `<button type="button" class="olliTtStudent wait" data-tt-entry="wait" data-waitlist-id="${esc(item.id)}"><span class="olliTtStudentTag">대기</span>${esc(item.student_name)}</button>`).join('');
    const makeupHtml = makeups.map((item) => `<button type="button" class="olliTtStudent makeup" data-tt-entry="makeup" data-makeup-id="${esc(item.id)}"><span class="olliTtStudentTag">보강</span>${esc(item.student_name)}</button>`).join('');
    const empty = !regularHtml && !waitHtml && !makeupHtml ? '<span class="olliTtEmptyHint">눌러서 학생 추가</span>' : '';
    return `<div class="olliTtCell" data-tt-cell="1" data-division="${division}" data-date="${dateKey(date)}" data-weekday="${date.getDay()}" data-time="${time}"><div class="olliTtCellMeta">${meta}</div>${regularHtml}${waitHtml}${makeupHtml}${empty}</div>`;
  }

  function sectionHtml(division) {
    const times = division === 'kinder' ? [3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 7];
    const dates = DAYS.map((_, index) => addDays(state.weekStart, index));
    let grid = '<div class="olliTtGrid"><div class="olliTtCorner"></div>';
    dates.forEach((date, index) => {
      grid += `<div class="olliTtDay ${isToday(date) ? 'today' : ''}"><strong>${DAYS[index]}요일</strong><span>${date.getMonth() + 1}월 ${date.getDate()}일${isToday(date) ? ' · 오늘' : ''}</span></div>`;
    });
    times.forEach((time) => {
      grid += `<div class="olliTtTime">${time}시</div>`;
      dates.forEach((date) => { grid += cellHtml(division, date, time); });
    });
    grid += '</div>';
    const studentCount = service.activeStudents().filter((student) => divisionOf(student) === division).length;
    return `<section class="olliTtSection ${division}"><div class="olliTtSectionHead"><div class="olliTtSectionName"><span class="olliTtSectionDot"></span>${divisionLabel(division)}</div><div class="olliTtSectionCount">${studentCount}명</div></div><div class="olliTtScroll">${grid}</div></section>`;
  }

  function renderTimetable() {
    const ui = ensureUi();
    if (!ui || state.view !== 'schedule') return;
    if (state.loading && !state.data) {
      ui.root.innerHTML = '<div class="olliTtLoading">주간 시간표를 불러오고 있어요.</div>';
      return;
    }
    if (state.data && state.data.error) {
      ui.root.innerHTML = `<div class="olliTtError">${esc(state.data.error)}<br>로그인 상태를 확인한 후 다시 열어주세요.</div>`;
      return;
    }
    ui.root.innerHTML = '<div class="olliTtToolbar"><div><div class="olliTtTitle">주간 수업 시간표</div><div class="olliTtHelp">빈 공간은 학생 추가 · 이름은 해당 수업 이동</div></div>'
      + '<div class="olliTtWeekNav"><button type="button" class="olliTtWeekBtn icon" data-tt-week="prev" aria-label="이전 주">‹</button>'
      + `<button type="button" class="olliTtWeekBtn range">${weekRangeText()}</button>`
      + '<button type="button" class="olliTtWeekBtn icon" data-tt-week="next" aria-label="다음 주">›</button><button type="button" class="olliTtWeekBtn today" data-tt-week="today">이번 주</button></div></div>'
      + '<div class="olliTtLegend"><span class="olliTtLegendItem"><i class="olliTtLegendSwatch regular"></i>정규</span><span class="olliTtLegendItem"><i class="olliTtLegendSwatch wait"></i>대기</span><span class="olliTtLegendItem"><i class="olliTtLegendSwatch makeup"></i>보강</span><span>◷ 변경 예약</span></div>'
      + sectionHtml('elementary') + sectionHtml('kinder');
  }

  function onTimetableClick(event) {
    const weekButton = event.target.closest('[data-tt-week]');
    if (weekButton) {
      if (weekButton.dataset.ttWeek === 'prev') state.weekStart = addDays(state.weekStart, -7);
      if (weekButton.dataset.ttWeek === 'next') state.weekStart = addDays(state.weekStart, 7);
      if (weekButton.dataset.ttWeek === 'today') state.weekStart = mondayOf(new Date());
      state.data = null;
      loadWeek();
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
    const cell = event.target.closest('[data-tt-cell]');
    if (cell) openAdd(cell.dataset);
  }

  function studentScheduleText(studentId) {
    const rows = enrollments().filter((item) => clean(item.student_id) === clean(studentId) && enrollmentEffectiveOn(item, new Date()));
    if (!rows.length) {
      const student = studentById(studentId);
      return service.legacyPairs(student).map((pair) => `${weekdayLabel(pair.weekday)} ${timeLabel(pair.time_slot)}`).join(' · ');
    }
    return rows.sort((a, b) => Number(a.weekday) - Number(b.weekday) || Number(a.time_slot) - Number(b.time_slot))
      .map((item) => `${weekdayLabel(item.weekday)} ${timeLabel(item.time_slot)}`).join(' · ');
  }

  function renderSidebar() {
    if (!state.active || state.view !== 'schedule') return;
    const title = document.getElementById('olliPcContextTitle');
    const body = document.getElementById('olliPcContextBody');
    if (!title || !body) return;
    title.textContent = '빠른 보기';
    const students = service.activeStudents().filter((student) => {
      const division = divisionOf(student);
      return (state.sidebarFilter === 'all' || state.sidebarFilter === division)
        && (!state.sidebarQuery || clean(student.name).includes(state.sidebarQuery));
    });
    const elementary = students.filter((student) => divisionOf(student) === 'elementary');
    const kinder = students.filter((student) => divisionOf(student) === 'kinder');
    const groupHtml = (list, division) => list.length ? `<div class="olliTtQuickGroup"><div class="olliTtQuickGroupTitle">${divisionLabel(division)} · ${list.length}명</div>${list.map((student) => `<button type="button" class="olliTtQuickStudent" data-tt-sidebar-student="${esc(student.id)}"><span>${esc(student.name)}</span><span class="olliTtQuickStudentSchedule">${esc(studentScheduleText(student.id))}</span></button>`).join('')}</div>` : '';
    body.innerHTML = `<div class="olliTtQuickFilter"><button type="button" class="olliTtQuickFilterBtn ${state.sidebarFilter === 'all' ? 'active' : ''}" data-tt-filter="all">전체</button><button type="button" class="olliTtQuickFilterBtn ${state.sidebarFilter === 'elementary' ? 'active' : ''}" data-tt-filter="elementary">초등부</button><button type="button" class="olliTtQuickFilterBtn ${state.sidebarFilter === 'kinder' ? 'active' : ''}" data-tt-filter="kinder">유치부</button></div>`
      + `<input type="search" class="olliTtQuickSearch" id="olliTtQuickSearch" value="${esc(state.sidebarQuery)}" placeholder="학생 검색" aria-label="시간표 학생 검색">`
      + (students.length ? groupHtml(elementary, 'elementary') + groupHtml(kinder, 'kinder') : '<div class="olliTtQuickEmpty">조건에 맞는 학생이 없습니다.</div>');
    body.querySelectorAll('[data-tt-filter]').forEach((button) => button.addEventListener('click', () => { state.sidebarFilter = button.dataset.ttFilter; renderSidebar(); }));
    body.querySelectorAll('[data-tt-sidebar-student]').forEach((button) => button.addEventListener('click', () => openMove(button.dataset.ttSidebarStudent)));
    bindImeSafeSearch(
      document.getElementById('olliTtQuickSearch'),
      (value) => { state.sidebarQuery = value; },
      renderSidebar,
      '#olliTtQuickSearch'
    );
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

  function openMove(studentId, enrollmentId) {
    const student = studentById(studentId);
    if (!student) return;
    const rows = studentEnrollments(studentId);
    const source = rows.find((item) => clean(item.id) === clean(enrollmentId)) || rows.find((item) => enrollmentEffectiveOn(item, new Date())) || rows[0];
    state.dialog = {
      kind: 'move', studentId: clean(studentId), actionType: 'move',
      sourceEnrollmentId: source ? clean(source.id) : '',
      targetWeekday: source ? Number(source.weekday) : 1,
      targetTime: source ? Number(source.time_slot) : (divisionOf(student) === 'kinder' ? 3 : 1),
      effectiveDate: todayKey()
    };
    openOverlay();
  }

  function openAdd(dataset) {
    const targetDate = clean(dataset.date);
    state.dialog = {
      kind: 'add', division: clean(dataset.division), date: targetDate,
      weekday: Number(dataset.weekday), time: Number(dataset.time), studentId: '',
      query: '', addType: 'regular'
    };
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

  function dialogHead(icon, title, sub) {
    return `<div class="olliTtDialogHead"><div class="olliTtDialogIcon" aria-hidden="true">${icon}</div><div><div class="olliTtDialogTitle" id="olliTtDialogTitle">${esc(title)}</div><div class="olliTtDialogSub">${esc(sub)}</div></div><button type="button" class="olliTtDialogClose" data-tt-dialog-close aria-label="닫기">×</button></div>`;
  }

  function moveDialogHtml(dialog) {
    const student = studentById(dialog.studentId);
    const rows = studentEnrollments(dialog.studentId).sort((a, b) => Number(a.weekday) - Number(b.weekday) || Number(a.time_slot) - Number(b.time_slot));
    const scheduledRows = changes().filter((item) => clean(item.student_id) === clean(dialog.studentId) && item.status === 'scheduled');
    const source = rows.find((item) => clean(item.id) === clean(dialog.sourceEnrollmentId));
    const division = divisionOf(student);
    const timeOptions = division === 'kinder' ? [3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 7];
    const capacity = capacityFor(division);
    const sourceHtml = rows.length ? rows.map((item) => {
      const current = enrollmentEffectiveOn(item, new Date());
      const selected = clean(item.id) === clean(dialog.sourceEnrollmentId);
      const schedule = `${weekdayLabel(item.weekday)}요일 · ${timeLabel(item.time_slot)}`;
      return `<div class='olliTtEnrollmentRow'><button type='button' class='olliTtEnrollmentChoice ${selected ? 'active' : ''}' data-tt-source='${esc(item.id)}'><strong>${schedule}</strong><span>${clean(item.effective_from) > todayKey() ? `${shortDate(item.effective_from)}부터` : '정규 수업'}</span></button><button type='button' class='olliTtEnrollmentDelete' data-tt-remove-enrollment='${esc(item.id)}' ${current ? '' : 'disabled'} aria-label='${esc(schedule)} 삭제'>삭제</button></div>`;
    }).join('') : '<div class="olliTtStatusNotice">현재 등록된 정규 수업이 없습니다. ‘주간 수업 추가’를 선택해 주세요.</div>';
    const dayHtml = DAYS.map((day, index) => `<button type="button" class="olliTtChoice ${dialog.targetWeekday === index + 1 ? 'active' : ''}" data-tt-target-day="${index + 1}">${day}</button>`).join('');
    const timeHtml = timeOptions.map((time) => {
      const count = countAt(division, dialog.targetWeekday, time, dialog.effectiveDate);
      const full = capacity && count >= capacity;
      return `<button type="button" class="olliTtChoice ${dialog.targetTime === time ? 'active' : ''} ${full ? 'full' : ''}" data-tt-target-time="${time}">${time}시${capacity ? `<small>${count}/${capacity}${full ? ' · 대기' : ''}</small>` : ''}</button>`;
    }).join('');
    const sourceSummary = source ? `${weekdayLabel(source.weekday)}요일 ${timeLabel(source.time_slot)}` : '선택된 기존 수업 없음';
    const scheduledHtml = scheduledRows.length ? `<div class="olliTtField"><div class="olliTtFieldHead"><span>변경 예약</span><small>적용 전에는 취소할 수 있어요</small></div><div class="olliTtEnrollmentList">${scheduledRows.map((item) => {
      const scheduledSource = rows.find((row) => clean(row.id) === clean(item.source_enrollment_id));
      const target = rows.find((row) => clean(row.id) === clean(item.target_enrollment_id));
      const targetText = item.change_type === 'remove' && scheduledSource
        ? `${weekdayLabel(scheduledSource.weekday)}요일 ${timeLabel(scheduledSource.time_slot)} 삭제`
        : target ? `${weekdayLabel(target.weekday)}요일 ${timeLabel(target.time_slot)}` : '예약된 수업';
      return `<button type="button" class="olliTtEnrollmentChoice" data-tt-cancel-change="${esc(item.id)}"><strong>${shortDate(item.effective_date)}부터 · ${esc(targetText)}</strong><span>예약 취소</span></button>`;
    }).join('')}</div></div>` : '';
    return dialogHead('↗', `${student.name} 수업 설정`, '이동하거나 주간 수업을 추가합니다.')
      + '<div class="olliTtDialogBody">'
      + `<div class="olliTtCurrentBox"><strong>${esc(student.name)} · ${divisionLabel(division)}</strong>현재 수업 ${esc(studentScheduleText(student.id)) || '없음'}</div>`
      + '<div class="olliTtField"><div class="olliTtFieldHead"><span>설정 방식</span><small>연강도 같은 요일에 여러 시간 등록 가능</small></div><div class="olliTtTypeGrid">'
      + `<button type="button" class="olliTtTypeBtn ${dialog.actionType === 'move' ? 'active' : ''}" data-tt-action-type="move">수업 이동<small>선택한 기존 수업 하나를 옮깁니다.</small></button>`
      + `<button type="button" class="olliTtTypeBtn ${dialog.actionType === 'add' ? 'active' : ''}" data-tt-action-type="add">주간 수업 추가<small>기존 수업을 유지하고 새 시간을 더합니다.</small></button></div></div>`
      + (dialog.actionType === 'move' ? `<div class='olliTtField'><div class='olliTtFieldHead'><span>이동할 기존 수업</span><small>${source ? `선택: ${esc(sourceSummary)} · 삭제는 오른쪽 버튼` : '수업을 선택하거나 오른쪽 삭제 버튼을 눌러주세요'}</small></div><div class='olliTtEnrollmentList'>${sourceHtml}</div></div>` : '')
      + scheduledHtml
      + `<div class="olliTtField"><div class="olliTtFieldHead"><span>새 요일</span><small>같은 요일 중복 가능</small></div><div class="olliTtChoiceGrid">${dayHtml}</div></div>`
      + `<div class="olliTtField"><div class="olliTtFieldHead"><span>새 시간</span><small>마감된 시간은 대기로 등록</small></div><div class="olliTtChoiceGrid times">${timeHtml}</div></div>`
      + `<div class="olliTtField"><div class="olliTtFieldHead"><span>적용 날짜</span><small>미래 날짜를 선택하면 변경 예약</small></div><input type="date" class="olliTtDateInput" data-tt-effective-date min="${todayKey()}" value="${esc(dialog.effectiveDate)}"></div>`
      + '<div class="olliTtDialogActions"><button type="button" class="olliTtDialogCancel" data-tt-dialog-close>취소</button><button type="button" class="olliTtDialogPrimary" data-tt-save-move>저장</button></div></div>';
  }

  function addDialogHtml(dialog) {
    const division = dialog.division;
    const students = service.activeStudents().filter((student) => divisionOf(student) === division && (!dialog.query || clean(student.name).includes(dialog.query)));
    const capacity = capacityFor(division);
    const occupied = countAt(division, dialog.weekday, dialog.time, dialog.date);
    const selected = studentById(dialog.studentId);
    return dialogHead('+', '이 시간에 학생 추가', `${koreanDate(dialog.date)} ${weekdayLabel(dialog.weekday)}요일 · ${timeLabel(dialog.time)}`)
      + '<div class="olliTtDialogBody">'
      + `<div class="olliTtCurrentBox"><strong>${divisionLabel(division)} · ${weekdayLabel(dialog.weekday)}요일 ${timeLabel(dialog.time)}</strong>${capacity ? `현재 ${occupied}/${capacity} · ${occupied >= capacity ? '정원 마감, 정규 수업은 대기로 등록됩니다.' : `${capacity - occupied}자리 남음`}` : `현재 ${occupied}명`}</div>`
      + '<div class="olliTtField"><div class="olliTtFieldHead"><span>학생 선택</span><small>이름을 검색하세요</small></div>'
      + `<input type="search" class="olliTtStudentSearch" data-tt-add-search value="${esc(dialog.query)}" placeholder="학생 검색"><div class="olliTtPickerList">`
      + (students.length ? students.map((student) => `<button type="button" class="olliTtPickerStudent ${clean(student.id) === dialog.studentId ? 'active' : ''}" data-tt-add-student="${esc(student.id)}"><strong>${esc(student.name)}</strong><span>${esc(studentScheduleText(student.id)) || '수업 없음'}</span></button>`).join('') : '<div class="olliTtQuickEmpty">학생을 찾지 못했습니다.</div>')
      + '</div></div><div class="olliTtField"><div class="olliTtFieldHead"><span>추가 유형</span><small>정규 수업 또는 특정 날짜 보강</small></div><div class="olliTtTypeGrid">'
      + `<button type="button" class="olliTtTypeBtn ${dialog.addType === 'regular' ? 'active' : ''}" data-tt-add-type="regular">정규 수업 추가<small>이 날짜부터 매주 반복됩니다.</small></button>`
      + `<button type="button" class="olliTtTypeBtn ${dialog.addType === 'makeup' ? 'active' : ''}" data-tt-add-type="makeup">보강 추가<small>${shortDate(dialog.date)} 하루만 수업합니다.</small></button></div></div>`
      + (selected ? `<div class="olliTtStatusNotice">${esc(selected.name)} 학생을 ${dialog.addType === 'makeup' ? '보강으로' : occupied >= (capacity || 99999) ? '대기로' : '정규 수업으로'} 추가합니다.</div>` : '')
      + `<div class="olliTtDialogActions"><button type="button" class="olliTtDialogCancel" data-tt-dialog-close>취소</button><button type="button" class="olliTtDialogPrimary" data-tt-save-add ${selected ? '' : 'disabled'}>${dialog.addType === 'makeup' ? '보강 등록' : occupied >= (capacity || 99999) ? '대기 등록' : '학생 추가'}</button></div></div>`;
  }

  function waitDialogHtml(dialog) {
    const item = waitlist().find((row) => clean(row.id) === clean(dialog.waitlistId));
    if (!item) return '';
    const capacity = capacityFor(clean(item.division));
    const occupied = countAt(clean(item.division), item.target_weekday, item.target_time_slot, dialog.effectiveDate);
    const canEnter = !capacity || occupied < capacity;
    return dialogHead('⌛', `${item.student_name} 대기 관리`, `${weekdayLabel(item.target_weekday)}요일 · ${timeLabel(item.target_time_slot)}`)
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

  function renderDialog() {
    const dialog = document.getElementById('olliTtDialog');
    if (!dialog || !state.dialog) return;
    if (state.dialog.kind === 'move') dialog.innerHTML = moveDialogHtml(state.dialog);
    else if (state.dialog.kind === 'add') dialog.innerHTML = addDialogHtml(state.dialog);
    else if (state.dialog.kind === 'wait') dialog.innerHTML = waitDialogHtml(state.dialog);
    else dialog.innerHTML = makeupDialogHtml(state.dialog);
    bindDialog();
  }

  function bindDialog() {
    const dialog = document.getElementById('olliTtDialog');
    if (!dialog || !state.dialog) return;
    dialog.querySelectorAll('[data-tt-dialog-close]').forEach((button) => button.addEventListener('click', closeDialog));
    dialog.querySelectorAll('[data-tt-action-type]').forEach((button) => button.addEventListener('click', () => { state.dialog.actionType = button.dataset.ttActionType; renderDialog(); }));
    dialog.querySelectorAll('[data-tt-source]').forEach((button) => button.addEventListener('click', () => { state.dialog.sourceEnrollmentId = button.dataset.ttSource; renderDialog(); }));
    dialog.querySelectorAll('[data-tt-target-day]').forEach((button) => button.addEventListener('click', () => { state.dialog.targetWeekday = Number(button.dataset.ttTargetDay); renderDialog(); }));
    dialog.querySelectorAll('[data-tt-target-time]').forEach((button) => button.addEventListener('click', () => { state.dialog.targetTime = Number(button.dataset.ttTargetTime); renderDialog(); }));
    const effective = dialog.querySelector('[data-tt-effective-date]');
    if (effective) effective.addEventListener('change', () => { state.dialog.effectiveDate = effective.value || todayKey(); renderDialog(); });
    bindImeSafeSearch(
      dialog.querySelector('[data-tt-add-search]'),
      (value) => { if (state.dialog && state.dialog.kind === 'add') state.dialog.query = value; },
      renderDialog,
      '[data-tt-add-search]'
    );
    dialog.querySelectorAll('[data-tt-add-student]').forEach((button) => button.addEventListener('click', () => { state.dialog.studentId = button.dataset.ttAddStudent; renderDialog(); }));
    dialog.querySelectorAll('[data-tt-add-type]').forEach((button) => button.addEventListener('click', () => { state.dialog.addType = button.dataset.ttAddType; renderDialog(); }));
    const waitDate = dialog.querySelector('[data-tt-wait-date]');
    if (waitDate) waitDate.addEventListener('change', () => { state.dialog.effectiveDate = waitDate.value || todayKey(); renderDialog(); });
    const saveMoveButton = dialog.querySelector('[data-tt-save-move]');
    if (saveMoveButton) saveMoveButton.addEventListener('click', saveMove);
    const saveAddButton = dialog.querySelector('[data-tt-save-add]');
    if (saveAddButton) saveAddButton.addEventListener('click', saveAdd);
    const acceptWait = dialog.querySelector('[data-tt-accept-wait]');
    if (acceptWait) acceptWait.addEventListener('click', () => resolveWait('accept'));
    const cancelWait = dialog.querySelector('[data-tt-cancel-wait]');
    if (cancelWait) cancelWait.addEventListener('click', () => resolveWait('cancel'));
    const cancelMakeup = dialog.querySelector('[data-tt-cancel-makeup]');
    if (cancelMakeup) cancelMakeup.addEventListener('click', cancelMakeupSession);
    dialog.querySelectorAll('[data-tt-remove-enrollment]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      removeSelectedEnrollment(button.dataset.ttRemoveEnrollment);
    }));
    dialog.querySelectorAll('[data-tt-cancel-change]').forEach((button) => button.addEventListener('click', () => cancelScheduledChange(button.dataset.ttCancelChange)));
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
    const result = await withSaving(() => service.changeSchedule({
      studentId: dialog.studentId,
      sourceEnrollmentId: dialog.actionType === 'move' ? dialog.sourceEnrollmentId : null,
      targetWeekday: dialog.targetWeekday,
      targetTimeSlot: dialog.targetTime,
      effectiveDate: dialog.effectiveDate,
      changeType: dialog.actionType,
      allowWait: true
    }));
    if (!result) return;
    const student = studentById(dialog.studentId);
    if (result.result === 'waitlisted') notify(`${student.name} 학생을 대기로 등록했어요.`);
    else if (result.result === 'scheduled') notify(`${student.name} 학생의 시간표 변경을 예약했어요.`);
    else notify(`${student.name} 학생의 시간표를 변경했어요.`);
  }

  async function saveAdd() {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== 'add' || !dialog.studentId) return;
    if (dialog.date < todayKey()) {
      alert('지난 날짜에는 학생을 추가할 수 없습니다.');
      return;
    }
    let result;
    if (dialog.addType === 'makeup') {
      result = await withSaving(() => service.addMakeup(dialog.studentId, dialog.date, dialog.time, ''));
    } else {
      result = await withSaving(() => service.changeSchedule({
        studentId: dialog.studentId,
        sourceEnrollmentId: null,
        targetWeekday: dialog.weekday,
        targetTimeSlot: dialog.time,
        effectiveDate: dialog.date,
        changeType: 'add',
        allowWait: true
      }));
    }
    if (!result) return;
    const student = studentById(dialog.studentId);
    if (dialog.addType === 'makeup') notify(`${student.name} 학생의 보강을 등록했어요.`);
    else if (result.result === 'waitlisted') notify(`${student.name} 학생을 대기로 등록했어요.`);
    else if (result.result === 'scheduled') notify(`${student.name} 학생의 주간 수업 추가를 예약했어요.`);
    else notify(`${student.name} 학생의 주간 수업을 추가했어요.`);
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
          return;
        }
        return originalSearch.apply(this, arguments);
      };
      wrappedSearch.__olliTimetableWrapped = true;
      global.pcHandleTopSearch = wrappedSearch;
    }
    global.olliPcSetAttendanceView = setView;
    global.olliTtOpenStudentSchedule = openMove;
    syncAttendanceActive();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(window);
