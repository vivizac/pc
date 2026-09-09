(function pcStudentClassRouting(global) {
  'use strict';
  if (global.__OLLI_PC_CLASS_ROUTING_V1__) return;
  global.__OLLI_PC_CLASS_ROUTING_V1__ = true;

  const DAYS = ['월','화','수','목','금','토'];
  const DAY_NUM = Object.freeze({ 월:1, 화:2, 수:3, 목:4, 금:5, 토:6 });
  const NUM_DAY = Object.freeze({ 1:'월', 2:'화', 3:'수', 4:'목', 5:'금', 6:'토' });
  const SESSION_KEY = 'olli_account_session_token_v1';
  const registration = {
    division: 'elementary',
    selected: [],
    options: [],
    loading: false,
    loadToken: 0,
    saving: false,
    installed: false
  };
  let teacherAssignmentsCache = { academyId:'', at:0, rows:[] };
  let teacherRenderTimer = 0;
  let bypassStudentScheduleSaveGuard = false;

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function esc(value) {
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(clean(value));
    return clean(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function academyId() {
    try { if (typeof global.getOlliCurrentAcademyId === 'function') return clean(global.getOlliCurrentAcademyId()); } catch (_) {}
    return clean(localStorage.getItem('olli_current_academy_id'));
  }
  function sessionToken() { return clean(localStorage.getItem(SESSION_KEY)); }
  function unwrapRpc(value) { return Array.isArray(value) && value.length === 1 ? value[0] : value; }
  async function scheduleRpc(name, payload) {
    if (typeof global.supabase !== 'function') throw new Error('시간표 서버 연결을 찾지 못했습니다.');
    const aid = academyId();
    const token = sessionToken();
    if (!aid) throw new Error('현재 학원 정보를 찾지 못했습니다. 다시 로그인해 주세요.');
    if (!token) throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
    const result = unwrapRpc(await global.supabase('POST', `rpc/${name}`, Object.assign({
      p_session_token: token,
      p_academy_id: aid
    }, payload || {}))) || {};
    if (result && result.ok === false) throw new Error(result.message || '시간표 요청을 처리하지 못했습니다.');
    return result;
  }
  function notify(message) {
    if (typeof global.showPushToast === 'function') global.showPushToast(message);
    else alert(message);
  }
  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }
  function parseDateKey(value) {
    const m = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
    return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2])-1 && d.getDate() === Number(m[3]) ? d : null;
  }
  function mondayKey(value) {
    const date = value instanceof Date ? new Date(value) : parseDateKey(value);
    if (!date) return '';
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - day + 1);
    return dateKey(date);
  }
  function registrationDate() {
    const year = Number(document.getElementById('studentYearBadge')?.value || 0);
    const month = Number(document.getElementById('studentMonthInput')?.value || 0);
    const day = Number(document.getElementById('studentDayInput')?.value || 0);
    if (!year || year < 1900 || year > 2100 || !month || month < 1 || month > 12 || !day || day < 1 || day > 31) return '';
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return '';
    return dateKey(d);
  }
  function teacherDisplay(value) {
    const name = clean(value);
    if (!name) return '';
    return /T$/i.test(name) ? name : `${name}T`;
  }
  function classKey(item) { return `${item.weekday}|${item.time_slot}|${item.class_group || 'A'}`; }
  function pairTimeKey(item) { return `${item.weekday}|${item.time_slot}`; }
  function normalizeGroup(value) { return clean(value).toUpperCase() === 'B' ? 'B' : 'A'; }
  function enrollmentEffectiveOn(item, effectiveDate) {
    const from = clean(item && item.effective_from);
    const to = clean(item && item.effective_to);
    const status = clean(item && item.status).toLowerCase();
    if (status && status !== 'active') return false;
    return (!from || from <= effectiveDate) && (!to || to >= effectiveDate);
  }
  function isElementarySplit(data, weekday, timeSlot) {
    return (Array.isArray(data && data.class_splits) ? data.class_splits : []).some((row) =>
      Number(row && row.weekday) === Number(weekday) && Number(row && row.time_slot) === Number(timeSlot));
  }
  function isKinderMerged(data, weekday, timeSlot) {
    return (Array.isArray(data && data.kinder_class_merges) ? data.kinder_class_merges : []).some((row) =>
      Number(row && row.weekday) === Number(weekday) && Number(row && row.time_slot) === Number(timeSlot));
  }
  function capacityFor(data, division) {
    const raw = division === 'kinder' ? Number(data && data.kinder_capacity) : Number(data && data.elementary_capacity);
    return Number.isFinite(raw) && raw > 0 ? raw : 5;
  }
  function optionLabel(option) {
    if (option.division === 'kinder' && option.merged) return '합반';
    if (!option.split && option.division === 'elementary') return '기본 클래스';
    return `${option.class_group}반`;
  }

  async function loadWeekForRegistration(effectiveDate) {
    const service = global.OlliTimetableService;
    if (!service || typeof service.loadWeek !== 'function') throw new Error('시간표 서비스를 불러오지 못했습니다.');
    const monday = mondayKey(effectiveDate);
    if (!monday) throw new Error('등록 날짜를 먼저 입력해 주세요.');
    return service.loadWeek(monday);
  }

  function buildRegistrationOptions(data, division, effectiveDate) {
    const enrollments = Array.isArray(data && data.enrollments) ? data.enrollments : [];
    const assignments = Array.isArray(data && data.class_teachers) ? data.class_teachers : [];
    const slotMap = new Map();
    const addSlot = (weekday, timeSlot) => {
      const w = Number(weekday), t = Number(timeSlot);
      if (!Number.isFinite(w) || w < 1 || w > 6 || !Number.isFinite(t) || t < 1 || t > 12) return;
      slotMap.set(`${w}|${t}`, { weekday:w, time_slot:t });
    };
    assignments.filter((row) => clean(row && row.division) === division).forEach((row) => addSlot(row.weekday, row.time_slot));
    enrollments.filter((row) => clean(row && row.division) === division && enrollmentEffectiveOn(row, effectiveDate)).forEach((row) => addSlot(row.weekday, row.time_slot));
    if (division === 'elementary') {
      (Array.isArray(data && data.class_splits) ? data.class_splits : []).forEach((row) => addSlot(row.weekday, row.time_slot));
      // 담임/기존 학생이 없어도 시간표의 기본 수업칸은 학생 등록에서 선택할 수 있습니다.
      for (let weekday = 1; weekday <= 5; weekday += 1) {
        for (let timeSlot = 1; timeSlot <= 6; timeSlot += 1) addSlot(weekday, timeSlot);
      }
      [10, 11, 12].forEach((timeSlot) => addSlot(6, timeSlot));
    } else {
      (Array.isArray(data && data.kinder_class_merges) ? data.kinder_class_merges : []).forEach((row) => addSlot(row.weekday, row.time_slot));
      for (let weekday = 1; weekday <= 6; weekday += 1) {
        [4, 5].forEach((timeSlot) => addSlot(weekday, timeSlot));
      }
    }

    const capacity = capacityFor(data, division);
    const options = [];
    Array.from(slotMap.values()).sort((a,b) => a.weekday-b.weekday || a.time_slot-b.time_slot).forEach((slot) => {
      const split = division === 'kinder' ? !isKinderMerged(data, slot.weekday, slot.time_slot) : isElementarySplit(data, slot.weekday, slot.time_slot);
      const merged = division === 'kinder' && !split;
      const groups = split ? ['A','B'] : ['A'];
      groups.forEach((group) => {
        const teacher = assignments.find((row) => clean(row && row.division) === division
          && Number(row.weekday) === slot.weekday
          && Number(row.time_slot) === slot.time_slot
          && normalizeGroup(row.class_group) === group);
        const count = enrollments.filter((row) => clean(row && row.division) === division
          && Number(row.weekday) === slot.weekday
          && Number(row.time_slot) === slot.time_slot
          && normalizeGroup(row.class_group) === group
          && enrollmentEffectiveOn(row, effectiveDate)).length;
        const teacherName = teacherDisplay(teacher && teacher.teacher_name);
        options.push({
          division, weekday:slot.weekday, time_slot:slot.time_slot, class_group:group,
          split, merged, teacher_name:teacherName, count, capacity,
          remaining: Math.max(capacity - count, 0),
          full: count >= capacity,
          selectable: count < capacity
        });
      });
    });
    return options;
  }

  function ensureRegistrationPickerHost() {
    const modal = document.getElementById('studentModal');
    const card = modal && modal.querySelector('.modalCard');
    if (!card) return null;

    ['elementaryStudentTeacherField','studentTeacherField'].forEach((id) => {
      const el = document.getElementById(id); if (el) el.style.display = 'none';
    });
    ['elementaryStudentLessonDayField'].forEach((id) => {
      const el = document.getElementById(id); if (el) el.style.display = 'none';
    });
    ['elementaryStudentLessonTimeToggleRow','studentLessonTimeToggleRow','studentLessonDayToggleRow'].forEach((id) => {
      const el = document.getElementById(id);
      const field = el && (el.closest('.kinderInfoModalField') || el.parentElement);
      if (field) field.style.display = 'none';
    });
    const kinderExtra = document.getElementById('kinderExtraFields');
    if (kinderExtra) kinderExtra.style.display = 'none';
    const group = document.getElementById('elementaryStudentGroupToggleRow');
    const groupField = group && (group.closest('.kinderInfoModalField') || group.parentElement);
    const groupLabel = groupField && groupField.querySelector('.modalLabel');
    if (groupLabel) groupLabel.textContent = '피드백 그룹';

    let host = document.getElementById('pcStudentRegistrationClassPicker');
    if (!host) {
      host = document.createElement('div');
      host.id = 'pcStudentRegistrationClassPicker';
      host.className = 'pcStudentRegistrationClassPicker';
      const dateRow = card.querySelector('.studentPopupDateOnlyRow');
      const elementaryFields = document.getElementById('studentElementaryFields');
      if (elementaryFields && elementaryFields.parentElement === card) card.insertBefore(host, elementaryFields);
      else if (dateRow && dateRow.nextSibling) card.insertBefore(host, dateRow.nextSibling);
      else card.appendChild(host);
      host.addEventListener('click', onRegistrationClassClick);
    }
    return host;
  }

  function renderRegistrationPicker() {
    const host = ensureRegistrationPickerHost();
    if (!host) return;
    const selectedKeys = new Set(registration.selected.map(classKey));
    const selectedCount = registration.selected.length;
    const header = `<div class="pcStudentRegistrationClassHead"><div><strong>수업 클래스</strong><span>시간표에 설정된 클래스만 선택할 수 있습니다.</span></div><b>${selectedCount} / 2</b></div>`;
    if (registration.loading) {
      host.innerHTML = header + '<div class="pcStudentRegistrationClassState">시간표의 클래스와 정원을 확인하고 있어요.</div>';
      return;
    }
    const effectiveDate = registrationDate();
    if (!effectiveDate) {
      host.innerHTML = header + '<div class="pcStudentRegistrationClassState">등록 날짜를 입력하면 선택 가능한 수업을 확인할 수 있어요.</div>';
      return;
    }
    if (!registration.options.length) {
      host.innerHTML = header + '<div class="pcStudentRegistrationClassState">선택 가능한 수업이 없습니다.</div>';
      return;
    }
    const grouped = new Map();
    registration.options.forEach((option) => {
      const key = pairTimeKey(option);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(option);
    });
    const body = Array.from(grouped.values()).map((rows) => {
      const first = rows[0];
      const day = NUM_DAY[first.weekday] || '';
      const classCount = rows.length;
      const buttons = rows.map((option) => {
        const key = classKey(option);
        const selected = selectedKeys.has(key);
        const disabled = !option.selectable && !selected;
        const stateText = option.full ? '정원 마감' : `${option.count}/${option.capacity} · ${option.remaining}자리`;
        return `<button type="button" class="pcStudentRegistrationClassBtn ${selected ? 'active' : ''} ${disabled ? 'disabled' : ''}" data-registration-class="${esc(key)}" ${disabled ? 'disabled' : ''}>`
          + `<span><strong>${esc(optionLabel(option))}</strong><em>${esc(option.teacher_name || '담임 미지정')}</em></span><small>${esc(stateText)}</small></button>`;
      }).join('');
      return `<section class="pcStudentRegistrationSlot"><div class="pcStudentRegistrationSlotHead"><strong>${esc(day)}요일 ${first.time_slot}시</strong><span>${classCount}개 클래스</span></div><div class="pcStudentRegistrationClassGrid">${buttons}</div></section>`;
    }).join('');
    host.innerHTML = header + body + '<div class="pcStudentRegistrationClassGuide">수업을 아직 정하지 않았다면 선택하지 않고 학생 정보만 등록할 수 있습니다.</div>';
  }

  async function refreshRegistrationOptions() {
    const token = ++registration.loadToken;
    const effectiveDate = registrationDate();
    if (!effectiveDate) {
      registration.options = [];
      registration.loading = false;
      renderRegistrationPicker();
      return;
    }
    registration.loading = true;
    renderRegistrationPicker();
    try {
      const data = await loadWeekForRegistration(effectiveDate);
      if (token !== registration.loadToken) return;
      registration.options = buildRegistrationOptions(data, registration.division, effectiveDate);
      const validKeys = new Set(registration.options.map(classKey));
      registration.selected = registration.selected.filter((row) => validKeys.has(classKey(row)));
    } catch (error) {
      if (token !== registration.loadToken) return;
      registration.options = [];
      console.warn('학생 등록 클래스 조회 실패:', error && (error.message || error));
    } finally {
      if (token === registration.loadToken) {
        registration.loading = false;
        renderRegistrationPicker();
      }
    }
  }

  function onRegistrationClassClick(event) {
    const button = event.target.closest('[data-registration-class]');
    if (!button || button.disabled) return;
    const option = registration.options.find((row) => classKey(row) === clean(button.dataset.registrationClass));
    if (!option) return;
    const key = classKey(option);
    const existingIndex = registration.selected.findIndex((row) => classKey(row) === key);
    if (existingIndex >= 0) {
      registration.selected.splice(existingIndex, 1);
      renderRegistrationPicker();
      return;
    }
    const sameTimeIndex = registration.selected.findIndex((row) => pairTimeKey(row) === pairTimeKey(option));
    if (sameTimeIndex >= 0) registration.selected.splice(sameTimeIndex, 1);
    if (registration.selected.length >= 2) {
      notify('수업은 주 2회까지 선택할 수 있어요.');
      return;
    }
    registration.selected.push({
      weekday: option.weekday,
      time_slot: option.time_slot,
      class_group: option.class_group,
      division: option.division
    });
    registration.selected.sort((a,b) => a.weekday-b.weekday || a.time_slot-b.time_slot || a.class_group.localeCompare(b.class_group));
    renderRegistrationPicker();
  }

  async function validateRegistrationSelection() {
    if (!registration.selected.length) return true;
    const effectiveDate = registrationDate();
    if (!effectiveDate) throw new Error('등록 날짜를 먼저 입력해 주세요.');
    const data = await loadWeekForRegistration(effectiveDate);
    const fresh = buildRegistrationOptions(data, registration.division, effectiveDate);
    const freshMap = new Map(fresh.map((row) => [classKey(row), row]));
    for (const selected of registration.selected) {
      const option = freshMap.get(classKey(selected));
      if (!option) throw new Error('선택한 클래스가 시간표에서 변경되었습니다. 다시 선택해 주세요.');
      if (option.full) throw new Error(`${NUM_DAY[option.weekday]}요일 ${option.time_slot}시 ${optionLabel(option)}의 정원이 마감되었습니다.`);
    }
    registration.options = fresh;
    return true;
  }

  async function setRegistrationSchedule(studentId, pairs, effectiveDate) {
    const normalized = (Array.isArray(pairs) ? pairs : []).slice(0,2).map((pair) => ({
      weekday: Number(pair.weekday),
      time_slot: Number(pair.time_slot),
      class_group: normalizeGroup(pair.class_group)
    }));
    const result = await scheduleRpc('olli_schedule_set_student_weekly_schedule', {
      p_student_id: studentId,
      p_pairs: normalized,
      p_effective_date: effectiveDate
    });
    try {
      global.dispatchEvent(new CustomEvent('olli:schedule-changed', { detail:{ studentId:clean(studentId), source:'student_registration_class_picker' } }));
    } catch (_) {}
    return result;
  }

  function hideLegacyRegistrationScheduleFields() {
    ensureRegistrationPickerHost();
  }

  function installRegistrationRouting() {
    if (registration.installed) return;
    registration.installed = true;

    const basePrepare = global.olliPrepareStudentAddExtra;
    global.olliPrepareStudentAddExtra = function classBasedStudentAddPrepare(type) {
      const result = typeof basePrepare === 'function' ? basePrepare.apply(this, arguments) : undefined;
      registration.division = type === 'kinder' ? 'kinder' : 'elementary';
      registration.selected = [];
      registration.options = [];
      hideLegacyRegistrationScheduleFields();
      setTimeout(refreshRegistrationOptions, 0);
      return result;
    };

    const baseGetExtra = global.olliGetStudentAddExtra;
    global.olliGetStudentAddExtra = function classBasedStudentAddExtra(type) {
      const base = typeof baseGetExtra === 'function' ? (baseGetExtra.apply(this, arguments) || {}) : {};
      const next = Object.assign({}, base, { lesson_day:'', lesson_time:'', class_time:'' });
      delete next.teacher;
      delete next.homeroom_teacher;
      return next;
    };

    // 기존 학생등록 연결기가 요일/시간을 다시 저장하지 않도록 비워 두고,
    // 실제 클래스 배정은 아래의 단일 weekly-schedule RPC에서 처리합니다.
    global.olliGetStudentAddSchedulePairs = function() { return []; };

    const originalConfirm = global.confirmStudent;
    if (typeof originalConfirm === 'function' && !originalConfirm.__olliClassRoutingLinked) {
      const wrapped = async function confirmStudentWithClassRouting() {
        if (registration.saving) return;
        const type = (() => { try { return currentRecordView === 'kinder' ? 'kinder' : 'elementary'; } catch (_) { return registration.division; } })();
        registration.division = type;
        const name = clean(document.getElementById('studentNameInput')?.value);
        const effectiveDate = registrationDate();
        const pairs = registration.selected.map((row) => ({ weekday:row.weekday, time_slot:row.time_slot, class_group:row.class_group }));
        if (pairs.length) {
          try { await validateRegistrationSelection(); }
          catch (error) { alert(error.message || error); renderRegistrationPicker(); return; }
        }
        const beforeIds = new Set((typeof global.getAllStudents === 'function' ? global.getAllStudents() : []).map((s) => String(s.id || '')));
        registration.saving = true;
        try {
          const result = await originalConfirm.apply(this, arguments);
          if (!name || !effectiveDate) return result;
          const students = typeof global.getStudentsByType === 'function' ? global.getStudentsByType(type) : [];
          const created = students.find((s) => !beforeIds.has(String(s.id || '')) && clean(s.name) === name);
          if (!created || !created.id) return result;
          if (pairs.length) {
            try {
              await setRegistrationSchedule(created.id, pairs, effectiveDate);
              if (typeof global.loadStudentsFromSupabase === 'function') await global.loadStudentsFromSupabase();
              if (global.OlliPcAttendance && typeof global.OlliPcAttendance.renderList === 'function') global.OlliPcAttendance.renderList();
              notify('학생 등록과 수업 클래스를 저장했어요.');
            } catch (error) {
              alert(`학생은 등록되었지만 수업 클래스 저장에 실패했어요.\n\n${error.message || error}\n\n시간표에서 해당 학생의 수업을 확인해 주세요.`);
            }
          }
          return result;
        } finally {
          registration.saving = false;
        }
      };
      wrapped.__olliClassRoutingLinked = true;
      wrapped.__olliScheduleLinked = true;
      global.confirmStudent = wrapped;
    }

    let dateTimer = 0;
    document.addEventListener('input', (event) => {
      if (!event.target || !['studentYearBadge','studentMonthInput','studentDayInput'].includes(event.target.id)) return;
      clearTimeout(dateTimer);
      dateTimer = setTimeout(refreshRegistrationOptions, 180);
    });
  }

  async function loadTeacherAssignments(force) {
    const aid = academyId();
    const now = Date.now();
    if (!force && teacherAssignmentsCache.academyId === aid && now - teacherAssignmentsCache.at < 10000) return teacherAssignmentsCache.rows;
    const result = await scheduleRpc('olli_schedule_class_teacher_context');
    const rows = Array.isArray(result.assignments) ? result.assignments : [];
    teacherAssignmentsCache = { academyId:aid, at:now, rows };
    return rows;
  }
  function timetableMoveTarget(dialog) {
    if (!dialog || !dialog.classList.contains('olliTtMoveDialog')) return null;
    const sub = clean(dialog.querySelector('.olliTtDialogSub')?.textContent);
    const division = sub.startsWith('유치부') ? 'kinder' : (sub.startsWith('초등부') ? 'elementary' : '');
    const day = dialog.querySelector('[data-tt-target-day].active');
    const time = dialog.querySelector('[data-tt-target-time].active');
    if (!division || !day || !time) return null;
    const group = dialog.querySelector('[data-tt-target-class].active');
    return { division, weekday:Number(day.dataset.ttTargetDay), time_slot:Number(time.dataset.ttTargetTime), class_group:normalizeGroup(group ? group.dataset.ttTargetClass : 'A') };
  }
  function teacherForTarget(assignments, target) {
    if (!target) return '';
    const row = (Array.isArray(assignments) ? assignments : []).find((item) => clean(item && item.division) === target.division
      && Number(item && item.weekday) === target.weekday
      && Number(item && item.time_slot) === target.time_slot
      && normalizeGroup(item && item.class_group) === target.class_group);
    return teacherDisplay(row && row.teacher_name);
  }
  async function renderLockedStudentTeacher() {
    const dialog = document.getElementById('olliTtDialog');
    if (!dialog || !dialog.classList.contains('olliTtMoveDialog')) return;
    const target = timetableMoveTarget(dialog);
    if (!target) return;
    let host = dialog.querySelector('#olliStudentScheduleTeacherLock');
    if (!host) {
      host = document.createElement('div');
      host.id = 'olliStudentScheduleTeacherLock';
      host.className = 'olliTtField olliStudentScheduleTeacherLock';
      const actions = dialog.querySelector('.olliTtDialogActions');
      if (actions) actions.parentElement.insertBefore(host, actions);
      else dialog.querySelector('.olliTtDialogBody')?.appendChild(host);
    }
    host.innerHTML = '<div class="olliTtFieldHead"><span>담임</span><small>학생은 선택한 클래스의 담임만 배정됩니다.</small></div><div class="olliStudentScheduleTeacherValue loading">확인 중...</div>';
    try {
      const assignments = await loadTeacherAssignments(false);
      if (!host.isConnected) return;
      const latest = timetableMoveTarget(dialog);
      if (!latest || classKey(latest) !== classKey(target)) { scheduleTeacherRender(); return; }
      const teacher = teacherForTarget(assignments, target);
      host.innerHTML = '<div class="olliTtFieldHead"><span>담임</span><small>담임 변경은 시간표 설정에서만 가능합니다.</small></div>'
        + `<div class="olliStudentScheduleTeacherValue ${teacher ? '' : 'empty'}">${esc(teacher || '담임 미지정')}</div>`;
    } catch (error) {
      if (host.isConnected) host.innerHTML = '<div class="olliTtFieldHead"><span>담임</span></div><div class="olliStudentScheduleTeacherValue empty">담임 정보를 불러오지 못했습니다.</div>';
    }
  }
  function scheduleTeacherRender() {
    clearTimeout(teacherRenderTimer);
    teacherRenderTimer = setTimeout(renderLockedStudentTeacher, 30);
  }
  function installStudentScheduleTeacherLock() {
    const attach = () => {
      const dialog = document.getElementById('olliTtDialog');
      if (!dialog || dialog.dataset.olliStudentTeacherLockObserved === '1') return false;
      dialog.dataset.olliStudentTeacherLockObserved = '1';
      const observer = new MutationObserver(scheduleTeacherRender);
      observer.observe(dialog, { childList:true, subtree:true, attributes:true, attributeFilter:['class'] });
      scheduleTeacherRender();
      return true;
    };
    if (!attach()) {
      const bodyObserver = new MutationObserver(() => { if (attach()) bodyObserver.disconnect(); });
      bodyObserver.observe(document.body, { childList:true, subtree:true });
    }
    document.addEventListener('click', (event) => {
      const choice = event.target.closest('[data-tt-target-day],[data-tt-target-time],[data-tt-target-class],[data-tt-action-type]');
      if (choice) scheduleTeacherRender();
      const save = event.target.closest('[data-tt-save-move]');
      if (!save || bypassStudentScheduleSaveGuard) return;
      const dialog = document.getElementById('olliTtDialog');
      if (!dialog || !dialog.classList.contains('olliTtMoveDialog')) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      (async () => {
        try {
          const target = timetableMoveTarget(dialog);
          if (!target) throw new Error('선택한 수업 클래스를 확인해 주세요.');
          const assignments = await loadTeacherAssignments(true);
          const teacher = teacherForTarget(assignments, target);
          if (!teacher) throw new Error(`${NUM_DAY[target.weekday]}요일 ${target.time_slot}시 ${target.class_group}반은 담임이 지정되지 않았습니다.\n시간표 설정에서 담임을 먼저 지정해 주세요.`);
          bypassStudentScheduleSaveGuard = true;
          save.click();
          setTimeout(() => { bypassStudentScheduleSaveGuard = false; }, 0);
        } catch (error) {
          alert(error.message || error);
        }
      })();
    }, true);
  }

  function installStyles() {
    if (document.getElementById('olliPcStudentClassRoutingStyle')) return;
    const style = document.createElement('style');
    style.id = 'olliPcStudentClassRoutingStyle';
    style.textContent = `
      #studentModal .pcStudentRegistrationClassPicker{margin:13px 0 14px;padding:14px;border:1px solid #eceef1;border-radius:18px;background:#fafbfc;}
      #studentModal .pcStudentRegistrationClassHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:11px;}
      #studentModal .pcStudentRegistrationClassHead>div{display:grid;gap:3px;}
      #studentModal .pcStudentRegistrationClassHead strong{font-size:12px;font-weight:800;color:#31353a;}
      #studentModal .pcStudentRegistrationClassHead span{font-size:10.5px;font-weight:600;color:#9aa0a8;}
      #studentModal .pcStudentRegistrationClassHead b{min-width:42px;height:24px;padding:0 8px;border-radius:999px;background:#eef1f4;color:#5f6670;font-size:10.5px;font-weight:800;display:flex;align-items:center;justify-content:center;box-sizing:border-box;}
      #studentModal .pcStudentRegistrationClassState{min-height:62px;border-radius:13px;background:#f2f4f6;color:#9298a0;font-size:11px;line-height:1.55;display:flex;align-items:center;justify-content:center;text-align:center;padding:10px;box-sizing:border-box;}
      #studentModal .pcStudentRegistrationSlot{padding:11px 0;border-top:1px solid #eef0f2;}
      #studentModal .pcStudentRegistrationSlot:first-of-type{border-top:0;padding-top:2px;}
      #studentModal .pcStudentRegistrationSlotHead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:7px;}
      #studentModal .pcStudentRegistrationSlotHead strong{font-size:11.5px;font-weight:780;color:#4b5158;}
      #studentModal .pcStudentRegistrationSlotHead span{font-size:10px;font-weight:650;color:#a0a5ad;}
      #studentModal .pcStudentRegistrationClassGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;}
      #studentModal .pcStudentRegistrationClassBtn{min-height:52px;border:1px solid #e4e7ea;border-radius:13px;background:#fff;padding:8px 10px;color:#4d535b;font:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px;}
      #studentModal .pcStudentRegistrationClassBtn>span{min-width:0;display:grid;gap:3px;}
      #studentModal .pcStudentRegistrationClassBtn strong{font-size:11px;font-weight:800;color:inherit;}
      #studentModal .pcStudentRegistrationClassBtn em{font-style:normal;font-size:10px;font-weight:650;color:#858b93;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      #studentModal .pcStudentRegistrationClassBtn small{flex:0 0 auto;font-size:9.5px;font-weight:720;color:#8d939b;white-space:nowrap;}
      #studentModal .pcStudentRegistrationClassBtn.active{border-color:#1687ff;background:#edf6ff;color:#0a73dc;box-shadow:inset 0 0 0 1px rgba(22,135,255,.12);}
      #studentModal .pcStudentRegistrationClassBtn.active em,#studentModal .pcStudentRegistrationClassBtn.active small{color:#4e8ecb;}
      #studentModal .pcStudentRegistrationClassBtn.disabled{background:#f4f5f6;color:#a4a8ae;cursor:not-allowed;opacity:.82;}
      #studentModal .pcStudentRegistrationClassGuide{margin-top:7px;color:#a0a5ad;font-size:9.8px;font-weight:600;line-height:1.45;}
      #olliTtDialog .olliStudentScheduleTeacherValue{height:48px;border:1px solid #dce6f1;border-radius:15px;background:#f5f9fd;color:#35658f;font-size:13px;font-weight:800;display:flex;align-items:center;padding:0 14px;box-sizing:border-box;}
      #olliTtDialog .olliStudentScheduleTeacherValue.empty{border-color:#e4e6e9;background:#f4f5f6;color:#9a9fa6;font-weight:650;}
      #olliTtDialog .olliStudentScheduleTeacherValue.loading{color:#9aa0a8;font-weight:650;}
    `;
    document.head.appendChild(style);
  }

  function installWhenReady(attempt) {
    const linked = typeof global.confirmStudent === 'function' && global.confirmStudent.__olliScheduleLinked;
    if (!linked || typeof global.olliPrepareStudentAddExtra !== 'function') {
      if ((attempt || 0) < 100) setTimeout(() => installWhenReady((attempt || 0) + 1), 80);
      return;
    }
    installStyles();
    installRegistrationRouting();
    installStudentScheduleTeacherLock();
    hideLegacyRegistrationScheduleFields();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => installWhenReady(0), { once:true });
  else installWhenReady(0);
})(window);
