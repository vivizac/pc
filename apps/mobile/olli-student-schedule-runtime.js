(function initPhoneStudentScheduleService(global) {
  'use strict';
  if (global.__OLLI_PHONE_STUDENT_SCHEDULE_SERVICE_V2__) return;
  global.__OLLI_PHONE_STUDENT_SCHEDULE_SERVICE_V2__ = true;

  const DAYS = ['월','화','수','목','금','토'];
  const CACHE_PREFIX = 'olli_phone_student_info_local_v1';
  const state = {
    context: null,
    pending: new Map(),
    weekCache: new Map(),
    uiSequence: { elementary: 0, kinder: 0 },
    listeners: new Set()
  };

  const clean = value => String(value == null ? '' : value).trim();
  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  const dateKey = value => clean(value).slice(0, 10);
  const mondayKey = value => {
    const raw = dateKey(value) || todayKey();
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };

  function academyIdFor(student) {
    const direct = clean(student && student.academy_id);
    if (direct) return direct;
    try {
      if (typeof global.getOlliCurrentAcademyId === 'function') {
        const value = clean(global.getOlliCurrentAcademyId());
        if (value) return value;
      }
    } catch (_) {}
    return clean(localStorage.getItem('olli_current_academy_id'));
  }

  function sessionToken() {
    return clean(localStorage.getItem('olli_account_session_token_v1'));
  }

  async function request(name, payload = {}) {
    if (typeof global.supabase !== 'function') throw new Error('시간표 서버 연결을 찾지 못했습니다.');
    const academyId = clean(payload.p_academy_id) || academyIdFor(null);
    const token = sessionToken();
    if (!academyId) throw new Error('현재 학원 정보를 찾지 못했습니다. 다시 로그인해 주세요.');
    if (!token) throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
    const body = Object.assign({ p_session_token: token, p_academy_id: academyId }, payload || {});
    const raw = await global.supabase('POST', `rpc/${name}`, body);
    const result = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
    if (result && result.ok === false) throw new Error(result.message || '시간표 요청을 처리하지 못했습니다.');
    return result || {};
  }

  function primaryEnrollment(rows) {
    return (Array.isArray(rows) ? rows : []).slice().sort((a,b) => {
      const ao = Number(a && a.session_order) || 999;
      const bo = Number(b && b.session_order) || 999;
      return ao - bo || Number(a && a.weekday) - Number(b && b.weekday) || Number(a && a.time_slot) - Number(b && b.time_slot);
    })[0] || null;
  }

  function lessonFields(rows) {
    const list = (Array.isArray(rows) ? rows : []).slice().sort((a,b) => Number(a.weekday)-Number(b.weekday) || Number(a.time_slot)-Number(b.time_slot));
    const days = [];
    const times = [];
    list.forEach(row => {
      const day = DAYS[Number(row && row.weekday) - 1] || '';
      const time = Number(row && row.time_slot);
      if (!day || !time) return;
      if (!days.includes(day)) days.push(day);
      times.push(`${day} ${time}시`);
    });
    return { lesson_day: days.join(' · '), lesson_time: times.join(' · '), class_time: times.join(' · ') };
  }

  function teacherNameFor(division, enrollments, assignments) {
    const first = primaryEnrollment(enrollments);
    if (!first) return '';
    const direct = clean(first.teacher_name);
    if (direct) return direct;
    const group = clean(first.class_group || 'A').toUpperCase() || 'A';
    const match = (Array.isArray(assignments) ? assignments : []).find(row =>
      clean(row && row.division) === division
      && Number(row && row.weekday) === Number(first.weekday)
      && Number(row && row.time_slot) === Number(first.time_slot)
      && (clean(row && row.class_group).toUpperCase() || 'A') === group
    );
    return clean(match && match.teacher_name);
  }

  function cacheKey(studentId, division, academyId) {
    return `${CACHE_PREFIX}:${clean(academyId) || 'unscoped'}:${division}:${clean(studentId)}`;
  }

  function readLocal(student, division) {
    const studentId = clean(student && student.id);
    if (!studentId) return null;
    try {
      const raw = localStorage.getItem(cacheKey(studentId, division, academyIdFor(student)));
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || parsed.loaded !== true || clean(parsed.studentId) !== studentId || parsed.division !== division) return null;
      return Object.assign({}, parsed, {
        enrollments: Array.isArray(parsed.enrollments) ? parsed.enrollments.filter(Boolean) : [],
        pickups: Array.isArray(parsed.pickups) ? parsed.pickups.filter(Boolean) : [],
        assignments: Array.isArray(parsed.assignments) ? parsed.assignments.filter(Boolean) : [],
        teachers: Array.isArray(parsed.teachers) ? parsed.teachers.filter(Boolean) : [],
        fields: parsed.fields || {}
      });
    } catch (_) {
      return null;
    }
  }

  function writeLocal(context) {
    if (!context || !context.studentId || !context.division) return null;
    const payload = {
      studentId: clean(context.studentId),
      division: context.division,
      academyId: clean(context.academyId),
      referenceDate: dateKey(context.referenceDate) || todayKey(),
      enrollments: Array.isArray(context.enrollments) ? context.enrollments : [],
      pickups: Array.isArray(context.pickups) ? context.pickups : [],
      assignments: Array.isArray(context.assignments) ? context.assignments : [],
      teachers: Array.isArray(context.teachers) ? context.teachers : [],
      fields: context.fields || lessonFields(context.enrollments),
      teacherName: clean(context.teacherName),
      loaded: true,
      cachedAt: new Date().toISOString()
    };
    try {
      localStorage.setItem(cacheKey(payload.studentId, payload.division, payload.academyId), JSON.stringify(payload));
    } catch (_) {}
    return payload;
  }

  function rememberRows(student, division, rows, context = {}) {
    const studentId = clean(student && student.id);
    if (!studentId) return null;
    return writeLocal({
      studentId,
      division,
      academyId: academyIdFor(student),
      referenceDate: todayKey(),
      enrollments: Array.isArray(rows) ? rows.filter(Boolean) : [],
      pickups: Array.isArray(context.pickups) ? context.pickups : [],
      assignments: Array.isArray(context.assignments) ? context.assignments : [],
      teachers: Array.isArray(context.teachers) ? context.teachers : [],
      fields: lessonFields(rows),
      teacherName: clean(context.teacherName),
      loaded: true
    });
  }

  function contextMatches(context, student, division, referenceDate) {
    return !!context
      && context.loaded === true
      && clean(context.studentId) === clean(student && student.id)
      && context.division === division
      && dateKey(context.referenceDate) === dateKey(referenceDate);
  }

  async function fetchContext(student, division, referenceDate) {
    const studentId = clean(student && student.id);
    if (!studentId) throw new Error('학생코드를 찾지 못했습니다.');
    const academyId = academyIdFor(student);
    const payload = {
      p_student_id: studentId,
      p_reference_date: dateKey(referenceDate) || todayKey()
    };
    if (academyId) payload.p_academy_id = academyId;
    const schedule = await request('olli_schedule_student_enrollments', payload);
    const enrollments = Array.isArray(schedule.enrollments) ? schedule.enrollments.filter(Boolean) : [];
    const pickups = Array.isArray(schedule.pickups) ? schedule.pickups.filter(Boolean) : [];
    let assignments = [];
    let teachers = [];
    let teacherName = teacherNameFor(division, enrollments, []);
    if (!teacherName && enrollments.length) {
      try {
        const teacherContext = await request('olli_schedule_class_teacher_context', academyId ? { p_academy_id: academyId } : {});
        assignments = Array.isArray(teacherContext.assignments) ? teacherContext.assignments.filter(Boolean) : [];
        teachers = Array.isArray(teacherContext.teachers) ? teacherContext.teachers.filter(Boolean) : [];
        teacherName = teacherNameFor(division, enrollments, assignments);
      } catch (error) {
        console.warn('폰 학생정보 담임 보조 조회 실패:', error && (error.message || error));
      }
    }
    return {
      studentId,
      division,
      academyId,
      referenceDate: dateKey(referenceDate) || todayKey(),
      enrollments,
      pickups,
      assignments,
      teachers,
      fields: lessonFields(enrollments),
      teacherName,
      loaded: true
    };
  }

  function pendingKey(student, division, referenceDate) {
    return `${academyIdFor(student)}|${clean(student && student.id)}|${division}|${dateKey(referenceDate) || todayKey()}`;
  }

  function emit(context, source) {
    state.listeners.forEach(listener => {
      try { listener(context, source || 'refresh'); } catch (error) { console.warn('학생 시간표 listener 오류:', error); }
    });
  }

  async function loadContext(student, division, referenceDate = todayKey(), options = {}) {
    const refDate = dateKey(referenceDate) || todayKey();
    const key = pendingKey(student, division, refDate);
    if (state.pending.has(key)) return state.pending.get(key);
    if (!options.force && contextMatches(state.context, student, division, refDate)) return state.context;
    const promise = fetchContext(student, division, refDate);
    state.pending.set(key, promise);
    try {
      const context = await promise;
      if (refDate === todayKey()) {
        state.context = context;
        writeLocal(context);
      }
      emit(context, options.source || 'refresh');
      return context;
    } finally {
      if (state.pending.get(key) === promise) state.pending.delete(key);
    }
  }

  function ensureContext(student, division) {
    return loadContext(student, division, todayKey(), { force: false, source: 'ensure' });
  }

  function normalizeClassLayoutData(data) {
    if (!data || typeof data !== 'object') return data || {};
    if (!Array.isArray(data.class_split_periods)) {
      const legacy = Array.isArray(data.class_splits) ? data.class_splits : [];
      data.class_split_periods = legacy.map(row => ({
        weekday:Number(row && row.weekday),
        time_slot:Number(row && row.time_slot),
        effective_from:'0001-01-01',
        effective_to:null
      }));
      data.class_layout_version = Number(data.class_layout_version || 1);
    }
    return data;
  }

  async function loadWeek(referenceDate = todayKey(), academyId = '') {
    const refDate = dateKey(referenceDate) || todayKey();
    const id = clean(academyId) || academyIdFor(null);
    const weekStart = mondayKey(refDate);
    const key = `${id}|${weekStart}`;
    if (state.weekCache.has(key)) return state.weekCache.get(key);
    const promise = (async () => {
      const contextPayload = id ? { p_academy_id: id } : {};
      await request('olli_schedule_apply_due', contextPayload);
      const [week, kinderLayout] = await Promise.all([
        request('olli_schedule_week', Object.assign({}, contextPayload, { p_week_start: weekStart })),
        request('olli_schedule_kinder_class_layouts', contextPayload)
      ]);
      let teacherContext = {};
      try { teacherContext = await request('olli_schedule_class_teacher_context', contextPayload); }
      catch (error) { console.warn('폰 수업시간 설정 담임 조회 실패:', error && (error.message || error)); }
      const data = normalizeClassLayoutData(week && typeof week === 'object' ? Object.assign({}, week) : {});
      data.kinder_class_merges = Array.isArray(kinderLayout && kinderLayout.merged_slots) ? kinderLayout.merged_slots : [];
      data.class_teachers = Array.isArray(teacherContext && teacherContext.assignments) ? teacherContext.assignments : [];
      data.teacher_members = Array.isArray(teacherContext && teacherContext.teachers) ? teacherContext.teachers : [];
      return data;
    })();
    state.weekCache.set(key, promise);
    try { return await promise; }
    catch (error) { state.weekCache.delete(key); throw error; }
  }

  async function saveSchedule(student, division, pairs, effectiveDate) {
    const studentId = clean(student && student.id);
    if (!studentId) throw new Error('학생코드를 찾지 못했습니다.');
    const academyId = academyIdFor(student);
    const payload = {
      p_student_id: studentId,
      p_pairs: Array.isArray(pairs) ? pairs : [],
      p_effective_date: dateKey(effectiveDate) || todayKey()
    };
    if (academyId) payload.p_academy_id = academyId;
    const result = await request('olli_schedule_set_student_weekly_schedule', payload);
    state.weekCache.clear();
    try {
      global.dispatchEvent(new CustomEvent('olli:schedule-changed', {
        detail: { studentId, source: 'phone_student_info_schedule_editor', effectiveDate: payload.p_effective_date }
      }));
    } catch (_) {}
    const context = payload.p_effective_date <= todayKey()
      ? await loadContext(student, division, todayKey(), { force: true, source: 'save' })
      : null;
    return { result, context };
  }

  function setTeacherDisplay(division, teacherName, noSchedule) {
    const id = division === 'kinder' ? 'kinderInfoTeacherReadonly' : 'elementaryInfoTeacherReadonly';
    const el = document.getElementById(id);
    if (!el) return;
    const name = clean(teacherName);
    if (!name) {
      el.textContent = noSchedule ? '담임' : '담임 미지정';
      el.classList.add('isEmpty');
      return;
    }
    const label = typeof global.formatTeacherNameWithT === 'function' ? global.formatTeacherNameWithT(name) : name;
    el.textContent = label;
    el.classList.remove('isEmpty');
  }

  function renderPickup(division, pickups) {
    if (division !== 'kinder') return;
    const el = document.getElementById('kinderInfoPickupReadonly');
    if (!el) return;
    const text = (Array.isArray(pickups) ? pickups : []).map(row => {
      const day = DAYS[Number(row && row.weekday) - 1] || '';
      const classTime = Number(row && row.class_time);
      const label = clean(row && row.pickup_label);
      const raw = clean(row && row.pickup_time);
      const match = raw.match(/^(\d{1,2}):(\d{2})/);
      let time = raw;
      if (match) {
        const h24 = Number(match[1]);
        time = `${h24 > 12 ? h24 - 12 : h24}:${match[2]}`;
      }
      return [day && `${day}요일`, classTime ? `${classTime}시` : '', label, time].filter(Boolean).join(' · ');
    }).filter(Boolean).join(' / ');
    el.textContent = text || '등록된 픽업 없음';
    el.classList.toggle('isEmpty', !text);
  }

  function editor() {
    return global.OlliPhoneStudentScheduleEditor || null;
  }

  function applyCardContext(student, division, context) {
    if (!context) return false;
    setTeacherDisplay(division, context.teacherName, !context.enrollments.length);
    renderPickup(division, context.pickups);
    const ui = editor();
    if (ui && typeof ui.applyContext === 'function') ui.applyContext(division, student, context);
    return true;
  }

  function renderLocal(student, division) {
    const cached = readLocal(student, division);
    const ui = editor();
    if (!cached) {
      if (ui && typeof ui.mount === 'function') ui.mount(division, student, null, { loading: true });
      return false;
    }
    state.context = cached;
    setTeacherDisplay(division, cached.teacherName, !cached.enrollments.length);
    renderPickup(division, cached.pickups);
    if (ui && typeof ui.mount === 'function') ui.mount(division, student, cached);
    return true;
  }

  async function refreshAuthoritative(student, division) {
    const seq = ++state.uiSequence[division];
    const context = await loadContext(student, division, todayKey(), { force: true, source: 'authoritative' });
    if (seq !== state.uiSequence[division]) return Object.assign({}, context, { stale: true });
    const modal = document.getElementById(division === 'kinder' ? 'kinderInfoModal' : 'elementaryInfoModal');
    const target = typeof global.getStudentInfoModalTarget === 'function' ? global.getStudentInfoModalTarget(division) : null;
    if (!modal || modal.style.display !== 'flex' || clean(target && target.id) !== clean(student && student.id)) {
      return Object.assign({}, context, { stale: true });
    }
    applyCardContext(student, division, context);
    return context;
  }

  function cancel(division) {
    if (state.uiSequence[division] != null) state.uiSequence[division] += 1;
  }

  function getExtra(type) {
    let extra = {};
    try { extra = typeof global.olliGetInfoExtra === 'function' ? (global.olliGetInfoExtra(type) || {}) : {}; }
    catch (_) { extra = {}; }
    delete extra.teacher;
    delete extra.homeroom_teacher;
    delete extra.lesson_day;
    delete extra.lesson_time;
    delete extra.class_time;
    return extra;
  }

  function openDivision() {
    const elementary = document.getElementById('elementaryInfoModal');
    if (elementary && elementary.style.display === 'flex') return 'elementary';
    const kinder = document.getElementById('kinderInfoModal');
    if (kinder && kinder.style.display === 'flex') return 'kinder';
    return '';
  }

  async function refreshOpenFromRealtime(context) {
    state.weekCache.clear();
    const division = openDivision();
    if (!division) return true;
    const modal = document.getElementById(division === 'kinder' ? 'kinderInfoModal' : 'elementaryInfoModal');
    if (modal && modal.querySelector('.pcStudentInfoCard.olliPhoneScheduleMode')) return false;
    const student = typeof global.getStudentInfoModalTarget === 'function' ? global.getStudentInfoModalTarget(division) : null;
    if (!student || !clean(student.id)) return true;
    if (context && typeof context.isCurrent === 'function' && !context.isCurrent()) return false;
    try {
      await refreshAuthoritative(student, division);
      return true;
    } catch (error) {
      console.warn('폰 학생정보 Realtime 최신본 확인 실패:', error && (error.message || error));
      return false;
    }
  }

  function installRealtime() {
    if (global.__OLLI_PHONE_STUDENT_INFO_REALTIME_V2__) return true;
    if (!global.OlliRealtime || typeof global.OlliRealtime.watchDomain !== 'function') return false;
    global.__OLLI_PHONE_STUDENT_INFO_REALTIME_V2__ = true;
    global.OlliRealtime.watchDomain('schedule', refreshOpenFromRealtime);
    return true;
  }

  const service = Object.freeze({
    request,
    todayKey,
    readLocal,
    writeLocal,
    rememberRows,
    loadContext,
    ensureContext,
    loadWeek,
    saveSchedule,
    getContext() { return state.context ? Object.assign({}, state.context) : null; },
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
    clearWeekCache() { state.weekCache.clear(); }
  });

  global.OlliPhoneStudentScheduleService = service;
  global.phoneStudentInfoScheduleRpc = request;
  global.phoneStudentInfoReadLocalContext = readLocal;
  global.phoneStudentInfoRememberLocalRows = rememberRows;
  global.phoneStudentInfoRenderLocal = renderLocal;
  global.phoneStudentInfoRefreshAuthoritative = refreshAuthoritative;
  global.phoneStudentInfoCancelAuthoritative = cancel;
  global.phoneStudentInfoLoadScheduleSource = (student, division, referenceDate) => loadContext(student, division, referenceDate || todayKey(), { force: true, source: 'direct' });
  global.phoneStudentInfoLoadAuthoritative = global.phoneStudentInfoLoadScheduleSource;
  global.phoneStudentInfoGetExtra = getExtra;
  global.phoneStudentInfoRenderPickup = renderPickup;
  global.olliSetPhoneInfoScheduleLoading = division => {
    const ui = editor();
    const student = typeof global.getStudentInfoModalTarget === 'function' ? global.getStudentInfoModalTarget(division) : null;
    if (ui && typeof ui.mount === 'function') ui.mount(division, student, null, { loading: true });
  };
  global.olliSetPhoneInfoScheduleError = (division, message) => {
    const ui = editor();
    if (ui && typeof ui.showError === 'function') ui.showError(division, message);
  };
  global.OlliPhoneStudentInfoSchedule = Object.freeze({
    ensureContext,
    getContext() { return service.getContext(); }
  });

  if (!installRealtime()) global.addEventListener('olli:realtime-status', installRealtime);
})(window);
