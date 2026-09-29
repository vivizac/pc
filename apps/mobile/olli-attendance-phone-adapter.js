(function attendancePhoneAdapter(global) {
  'use strict';

  const REGISTER_STATUS_TO_LOCAL = Object.freeze({ present: 'attended', absent: 'absent', makeup: 'makeup', blank: '' });
  const LOCAL_STATUS_TO_REGISTER = Object.freeze({ attended: 'present', absent: 'absent', makeup: 'makeup', '': 'blank' });
  const todayScheduleState = { academyId: '', sessionToken: '', dateKey: '', loaded: false, loading: null, signature: '', regular: new Map(), regularSessions: new Map(), makeup: new Map() };
  let renderAttendanceStoreSnapshot = null;
  let renderAttendanceStoreDirty = false;

  function shared() { return global.OlliAttendanceData || null; }
  function readAttendanceStore() {
    if (renderAttendanceStoreSnapshot) return renderAttendanceStoreSnapshot;
    if (typeof global.readRecordDailyAttendanceStore !== 'function') return {};
    return global.readRecordDailyAttendanceStore();
  }
  function beginRecordListRender() {
    renderAttendanceStoreSnapshot = typeof global.readRecordDailyAttendanceStore === 'function'
      ? global.readRecordDailyAttendanceStore()
      : {};
    renderAttendanceStoreDirty = false;
    return renderAttendanceStoreSnapshot;
  }
  function endRecordListRender() {
    if (renderAttendanceStoreSnapshot && renderAttendanceStoreDirty
        && typeof global.writeRecordDailyAttendanceStore === 'function') {
      global.writeRecordDailyAttendanceStore(renderAttendanceStoreSnapshot);
    }
    renderAttendanceStoreSnapshot = null;
    renderAttendanceStoreDirty = false;
  }
  function afterNextPaint() {
    return new Promise(resolve => {
      if (typeof global.requestAnimationFrame === 'function') {
        global.requestAnimationFrame(() => resolve());
      } else {
        global.setTimeout(resolve, 0);
      }
    });
  }
  function clean(value) { return String(value == null ? '' : value).trim(); }
  function dateKey(value) {
    if (typeof global.formatRecordAttendanceDateKey === 'function') {
      const key = global.formatRecordAttendanceDateKey(value || new Date());
      if (key) return String(key).slice(0, 10);
    }
    const date = value instanceof Date ? value : new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function currentYearMonth(baseDate) { return dateKey(baseDate || new Date()).slice(0, 7); }
  function getIsoWeekday(value) {
    const key = dateKey(value);
    if (!key) return 0;
    const [year, month, day] = key.split('-').map(Number);
    const weekday = new Date(year, month - 1, day).getDay();
    return weekday === 0 ? 7 : weekday;
  }
  function isEnrollmentActiveOnDate(enrollment, value) {
    const key = dateKey(value);
    const from = clean(enrollment?.effective_from).slice(0, 10);
    const to = clean(enrollment?.effective_to).slice(0, 10);
    return (!from || from <= key) && (!to || to >= key);
  }
  function timeRank(value) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n * 60;
    const raw = clean(value).replace(/\s+/g, '');
    const match = raw.match(/^(오전|오후)?(\d{1,2})(?:(?::|시)(\d{1,2}))?/);
    if (!match) return 24 * 60 + 1;
    let hour = Number(match[2] || 0);
    const minute = Number(match[3] || 0);
    if (match[1] === '오후' && hour < 12) hour += 12;
    if (match[1] === '오전' && hour === 12) hour = 0;
    return hour * 60 + Math.min(Math.max(minute, 0), 59);
  }
  function getLegacyTodayTime(student, baseDate) {
    const data = shared();
    const weekday = getIsoWeekday(baseDate || new Date());
    if (!data || typeof data.legacyPairs !== 'function') return null;
    const pair = data.legacyPairs(student).find(item => Number(item?.weekday) === weekday) || null;
    return pair ? Number(pair.time_slot) : null;
  }
  function getCurrentRecordView() {
    try { if (typeof currentRecordView !== 'undefined') return currentRecordView; } catch (_) {}
    return global.currentRecordView || '';
  }
  function isStudentSelectionMode() {
    try { if (typeof studentSelectionMode !== 'undefined') return !!studentSelectionMode; } catch (_) {}
    return !!global.studentSelectionMode;
  }
  function renderCurrentRecordList() {
    const searchValue = global.document.getElementById('searchName')?.value?.trim() || '';
    const view = getCurrentRecordView();
    if (view === 'elementary' && typeof global.renderElementaryRecords === 'function') global.renderElementaryRecords(searchValue);
    else if (view === 'kinder' && typeof global.renderKinderRecords === 'function') global.renderKinderRecords(searchValue);
  }
  function cloneValue(value) {
    if (value == null) return value;
    try { return JSON.parse(JSON.stringify(value)); }
    catch (_) { return value && typeof value === 'object' ? Object.assign({}, value) : value; }
  }
  function normalizeSessionKind(value) {
    const kind = clean(value).toLowerCase();
    return kind === 'makeup' ? 'makeup' : 'regular';
  }
  function validSessionStatus(kind, status) {
    const value = clean(status);
    if (kind === 'makeup') return value === 'makeup' ? 'makeup' : '';
    return value === 'attended' || value === 'absent' ? value : '';
  }
  function sessionStorageKey(timeSlot, classGroup) {
    const slot = Number(timeSlot);
    if (!Number.isFinite(slot) || slot <= 0) return '';
    return `${slot}|${clean(classGroup) || 'A'}`;
  }
  function sessionBucketNodes(bucket) {
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) return [];
    if (Object.prototype.hasOwnProperty.call(bucket, 'status')) return [bucket];
    return Object.values(bucket).filter(node => node && typeof node === 'object' && !Array.isArray(node));
  }
  function ensureItemSessions(item, kind, timeSlot, classGroup) {
    if (!item.sessions || typeof item.sessions !== 'object' || Array.isArray(item.sessions)) item.sessions = {};
    const targetKind = normalizeSessionKind(kind);
    const exactKey = sessionStorageKey(timeSlot, classGroup);
    const current = item.sessions[targetKind];

    if (current && typeof current === 'object' && !Array.isArray(current)
        && Object.prototype.hasOwnProperty.call(current, 'status') && exactKey) {
      item.sessions[targetKind] = { [exactKey]: current };
    }

    if (!item.sessions[targetKind] && exactKey) {
      const legacyStatus = validSessionStatus(targetKind, item.status);
      item.sessions[targetKind] = {};
      if (legacyStatus) {
        item.sessions[targetKind][exactKey] = {
          status: legacyStatus,
          server_synced: item.server_synced === true,
          updated_at: item.updated_at || ''
        };
      }
    }
    return item.sessions;
  }
  function getSessionStatusFromItem(item, kind, timeSlot, classGroup) {
    if (!item || typeof item !== 'object') return '';
    const targetKind = normalizeSessionKind(kind);
    const exactKey = sessionStorageKey(timeSlot, classGroup);
    const sessions = item.sessions && typeof item.sessions === 'object' && !Array.isArray(item.sessions)
      ? item.sessions
      : null;
    const bucket = sessions?.[targetKind];

    if (bucket && typeof bucket === 'object' && !Array.isArray(bucket)) {
      if (Object.prototype.hasOwnProperty.call(bucket, 'status')) {
        return validSessionStatus(targetKind, bucket.status || '');
      }
      if (exactKey) {
        return validSessionStatus(targetKind, bucket?.[exactKey]?.status || '');
      }
      const nodes = sessionBucketNodes(bucket);
      if (nodes.length === 1) return validSessionStatus(targetKind, nodes[0]?.status || '');
      return '';
    }

    const legacy = clean(item.status);
    if (targetKind === 'makeup') return legacy === 'makeup' ? 'makeup' : '';
    return legacy === 'attended' || legacy === 'absent' ? legacy : '';
  }
  function refreshAggregateStatus(item) {
    if (!item || typeof item !== 'object') return;
    const sessions = item.sessions && typeof item.sessions === 'object' && !Array.isArray(item.sessions) ? item.sessions : {};
    const regularNodes = sessionBucketNodes(sessions.regular);
    const makeupNodes = sessionBucketNodes(sessions.makeup);
    const regular = regularNodes.map(node => validSessionStatus('regular', node?.status || '')).find(Boolean) || '';
    const makeup = makeupNodes.map(node => validSessionStatus('makeup', node?.status || '')).find(Boolean) || '';
    item.status = regular || makeup || '';
    const nodes = [...regularNodes, ...makeupNodes];
    item.server_synced = !!nodes.length && nodes.every(node => node?.server_synced === true);
  }
  function setStoreSessionStatus(store, student, targetDateKey, kind, status, serverSynced, timeSlot, classGroup) {
    if (!store || !targetDateKey) return;
    const studentId = clean(student?.id || student?.student_id);
    if (!studentId) return;
    if (!store[targetDateKey] || typeof store[targetDateKey] !== 'object') store[targetDateKey] = {};
    let item = store[targetDateKey][studentId];
    if (!item || typeof item !== 'object') {
      item = {
        student_id: studentId,
        student_name: student?.name || student?.student_name || '',
        division: student?.type || student?.division || '',
        date: targetDateKey,
        status: '',
        sessions: {}
      };
      store[targetDateKey][studentId] = item;
    }
    item.student_name = student?.name || student?.student_name || item.student_name || '';
    item.division = student?.type || student?.division || item.division || '';
    item.date = targetDateKey;
    const targetKind = normalizeSessionKind(kind);
    const exactKey = sessionStorageKey(timeSlot, classGroup);
    const sessions = ensureItemSessions(item, targetKind, timeSlot, classGroup);
    const nextStatus = validSessionStatus(targetKind, status);

    if (exactKey) {
      let bucket = sessions[targetKind];
      if (!bucket || Object.prototype.hasOwnProperty.call(bucket, 'status')) {
        bucket = {};
        sessions[targetKind] = bucket;
      }
      if (nextStatus) {
        bucket[exactKey] = {
          status: nextStatus,
          server_synced: serverSynced === true,
          updated_at: new Date().toISOString()
        };
      } else {
        delete bucket[exactKey];
        if (!Object.keys(bucket).length) delete sessions[targetKind];
      }
    } else if (nextStatus) {
      sessions[targetKind] = {
        status: nextStatus,
        server_synced: serverSynced === true,
        updated_at: new Date().toISOString()
      };
    } else {
      delete sessions[targetKind];
    }

    refreshAggregateStatus(item);
    item.updated_at = new Date().toISOString();
    if (!sessions.regular && !sessions.makeup) {
      delete store[targetDateKey][studentId];
      if (!Object.keys(store[targetDateKey]).length) delete store[targetDateKey];
    }
  }
  function writeLocalStatus(student, targetDateKey, kind, status, serverSynced, timeSlot, classGroup, storeOverride = null) {
    if (!student?.id || !targetDateKey || typeof global.writeRecordDailyAttendanceStore !== 'function') return;
    const store = storeOverride || (typeof global.readRecordDailyAttendanceStore === 'function' ? global.readRecordDailyAttendanceStore() : {});
    setStoreSessionStatus(store, student, targetDateKey, kind, status, serverSynced, timeSlot, classGroup);
    global.writeRecordDailyAttendanceStore(store);
  }
  function getLocalSessionSnapshot(studentId, targetDateKey, kind, timeSlot, classGroup, storeOverride = null) {
    if (!studentId || !targetDateKey) return null;
    const store = storeOverride || readAttendanceStore();
    const item = store?.[targetDateKey]?.[String(studentId)];
    if (!item || typeof item !== 'object') return null;
    const targetKind = normalizeSessionKind(kind);
    const exactKey = sessionStorageKey(timeSlot, classGroup);
    const bucket = item.sessions?.[targetKind];
    if (exactKey && bucket && typeof bucket === 'object' && !Object.prototype.hasOwnProperty.call(bucket, 'status')) {
      return cloneValue(bucket[exactKey] || null);
    }
    if (bucket && typeof bucket === 'object' && Object.prototype.hasOwnProperty.call(bucket, 'status')) return cloneValue(bucket);
    return null;
  }
  function restoreLocalSession(student, targetDateKey, kind, timeSlot, classGroup, snapshot) {
    if (!student?.id || !targetDateKey || typeof global.readRecordDailyAttendanceStore !== 'function' || typeof global.writeRecordDailyAttendanceStore !== 'function') return;
    const store = global.readRecordDailyAttendanceStore();
    const studentId = String(student.id);
    if (!store[targetDateKey] || typeof store[targetDateKey] !== 'object') store[targetDateKey] = {};
    let item = store[targetDateKey][studentId];
    if (!item || typeof item !== 'object') {
      item = {
        student_id: studentId,
        student_name: student?.name || '',
        division: student?.type || student?.division || '',
        date: targetDateKey,
        status: '',
        sessions: {}
      };
      store[targetDateKey][studentId] = item;
    }
    const targetKind = normalizeSessionKind(kind);
    const exactKey = sessionStorageKey(timeSlot, classGroup);
    const sessions = ensureItemSessions(item, targetKind, timeSlot, classGroup);

    if (exactKey) {
      let bucket = sessions[targetKind];
      if (!bucket || Object.prototype.hasOwnProperty.call(bucket, 'status')) {
        bucket = {};
        sessions[targetKind] = bucket;
      }
      if (snapshot && typeof snapshot === 'object') bucket[exactKey] = cloneValue(snapshot);
      else delete bucket[exactKey];
      if (!Object.keys(bucket).length) delete sessions[targetKind];
    } else if (snapshot && typeof snapshot === 'object') {
      sessions[targetKind] = cloneValue(snapshot);
    } else {
      delete sessions[targetKind];
    }

    refreshAggregateStatus(item);
    item.updated_at = new Date().toISOString();
    if (!sessions.regular && !sessions.makeup) {
      delete store[targetDateKey][studentId];
      if (!Object.keys(store[targetDateKey]).length) delete store[targetDateKey];
    }
    global.writeRecordDailyAttendanceStore(store);
  }
  function removeSyncedSessionNodes(item, kind) {
    const sessions = item?.sessions;
    if (!sessions || typeof sessions !== 'object' || Array.isArray(sessions)) return;
    const bucket = sessions[kind];
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) return;
    if (Object.prototype.hasOwnProperty.call(bucket, 'status')) {
      if (bucket.server_synced === true) delete sessions[kind];
      return;
    }
    Object.keys(bucket).forEach(key => {
      if (bucket[key]?.server_synced === true) delete bucket[key];
    });
    if (!Object.keys(bucket).length) delete sessions[kind];
  }
  function getAttendanceSessionStatus(studentId, targetDateKey, kind, timeSlot, classGroup, storeOverride = null) {
    if (!studentId || !targetDateKey) return '';
    const store = storeOverride || readAttendanceStore();
    const item = store?.[targetDateKey]?.[String(studentId)];
    if (!item || typeof item !== 'object') return '';
    const targetKind = normalizeSessionKind(kind);
    const exactKey = sessionStorageKey(timeSlot, classGroup);
    const bucket = item.sessions?.[targetKind];
    const legacyBucket = bucket && typeof bucket === 'object'
      && !Array.isArray(bucket)
      && Object.prototype.hasOwnProperty.call(bucket, 'status');
    const legacyItem = (!item.sessions || typeof item.sessions !== 'object' || Array.isArray(item.sessions))
      && !!validSessionStatus(targetKind, item.status);

    if (exactKey && (legacyBucket || legacyItem)) {
      ensureItemSessions(item, targetKind, timeSlot, classGroup);
      refreshAggregateStatus(item);
      if (store === renderAttendanceStoreSnapshot) {
        renderAttendanceStoreDirty = true;
      } else if (typeof global.writeRecordDailyAttendanceStore === 'function') {
        global.writeRecordDailyAttendanceStore(store);
      }
    }
    return getSessionStatusFromItem(item, targetKind, timeSlot, classGroup);
  }

  function mergeServerMonth(rows, yearMonth) {
    if (typeof global.readRecordDailyAttendanceStore !== 'function' || typeof global.writeRecordDailyAttendanceStore !== 'function') return false;
    const ym = String(yearMonth || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) return false;
    const store = global.readRecordDailyAttendanceStore();

    Object.keys(store).forEach(targetDateKey => {
      if (!String(targetDateKey).startsWith(ym + '-')) return;
      const dayStore = store[targetDateKey];
      if (!dayStore || typeof dayStore !== 'object') return;
      Object.keys(dayStore).forEach(studentId => {
        const item = dayStore[studentId];
        if (!item || typeof item !== 'object') return;
        if (item.sessions && typeof item.sessions === 'object') {
          ['regular', 'makeup'].forEach(kind => removeSyncedSessionNodes(item, kind));
          refreshAggregateStatus(item);
          if (!item.sessions.regular && !item.sessions.makeup) delete dayStore[studentId];
        } else if (item.server_synced === true) {
          delete dayStore[studentId];
        }
      });
      if (!Object.keys(dayStore).length) delete store[targetDateKey];
    });
    const students = typeof global.getAllStudents === 'function' ? global.getAllStudents() : [];
    const studentMap = new Map((Array.isArray(students) ? students : []).map(student => [String(student.id), student]));
    const overrideKeys = new Set();

    (Array.isArray(rows) ? rows : []).forEach(row => {
      if (clean(row?.session_kind) !== 'register_override') return;
      const studentId = clean(row?.student_id);
      const targetDateKey = clean(row?.session_date).slice(0, 10);
      const registerStatus = clean(row?.register_status).toLowerCase();
      if (!studentId || !targetDateKey || !targetDateKey.startsWith(ym + '-') || !(registerStatus in REGISTER_STATUS_TO_LOCAL)) return;
      const registerKind = clean(row?.register_session_kind).toLowerCase() === 'makeup'
        ? 'makeup'
        : (registerStatus === 'makeup' ? 'makeup' : 'regular');
      const timeSlot = Number(row?.time_slot) || 0;
      const classGroup = clean(row?.class_group) || 'A';
      const exactKey = sessionStorageKey(timeSlot, classGroup);
      overrideKeys.add(`${studentId}|${targetDateKey}|${registerKind}|${exactKey || '*'}`);
      const localStatus = REGISTER_STATUS_TO_LOCAL[registerStatus];
      const student = studentMap.get(studentId) || { id: studentId };
      setStoreSessionStatus(store, student, targetDateKey, registerKind, localStatus, true, timeSlot, classGroup);
    });

    (Array.isArray(rows) ? rows : []).forEach(row => {
      if (row?.attended === false) return;
      const kind = clean(row?.session_kind).toLowerCase();
      if (kind !== 'regular' && kind !== 'makeup') return;
      const studentId = clean(row?.student_id);
      const targetDateKey = clean(row?.session_date).slice(0, 10);
      if (!studentId || !targetDateKey || !targetDateKey.startsWith(ym + '-')) return;
      const timeSlot = Number(row?.time_slot) || 0;
      const classGroup = clean(row?.class_group) || 'A';
      const exactKey = sessionStorageKey(timeSlot, classGroup);
      if (
        overrideKeys.has(`${studentId}|${targetDateKey}|${kind}|*`)
        || overrideKeys.has(`${studentId}|${targetDateKey}|${kind}|${exactKey}`)
      ) return;
      const student = studentMap.get(studentId) || { id: studentId };
      setStoreSessionStatus(store, student, targetDateKey, kind, kind === 'makeup' ? 'makeup' : 'attended', true, timeSlot, classGroup);
    });

    global.writeRecordDailyAttendanceStore(store);
    return true;
  }

  function attendanceRowsSignature(rows) {
    return JSON.stringify((Array.isArray(rows) ? rows : []).map(row => ({
      student_id: clean(row?.student_id),
      session_date: clean(row?.session_date).slice(0, 10),
      session_kind: clean(row?.session_kind),
      time_slot: Number(row?.time_slot) || 0,
      class_group: clean(row?.class_group || 'A'),
      attended: row?.attended === false ? false : true,
      register_status: clean(row?.register_status).toLowerCase(),
      register_session_kind: clean(row?.register_session_kind).toLowerCase()
    })).sort((a, b) =>
      a.session_date.localeCompare(b.session_date)
      || a.student_id.localeCompare(b.student_id)
      || a.session_kind.localeCompare(b.session_kind)
      || a.time_slot - b.time_slot
      || a.class_group.localeCompare(b.class_group)
      || a.register_status.localeCompare(b.register_status)
    ));
  }

  function hydrateCurrentMonthFromLocal(baseDate, options = {}) {
    const data = shared();
    if (!data || typeof data.getCachedMonth !== 'function') return false;
    const yearMonth = currentYearMonth(baseDate || new Date());
    if (!yearMonth) return false;
    const cached = data.getCachedMonth(yearMonth);
    if (!Array.isArray(cached)) return false;
    mergeServerMonth(cached, yearMonth);
    if (options.render !== false) renderCurrentRecordList();
    return true;
  }

  async function syncCurrentMonth(baseDate, options = {}) {
    const data = shared();
    if (!data || typeof data.loadMonth !== 'function') return false;
    const yearMonth = currentYearMonth(baseDate || new Date());
    if (!yearMonth) return false;
    try {
      const cached = typeof data.getCachedMonth === 'function' ? data.getCachedMonth(yearMonth) : null;
      if (options.skipLocal !== true && Array.isArray(cached)) mergeServerMonth(cached, yearMonth);
      const before = attendanceRowsSignature(cached);
      const rows = await data.loadMonth(yearMonth);
      const changed = options.forceMerge === true || !Array.isArray(cached) || attendanceRowsSignature(rows) !== before;
      if (changed) {
        mergeServerMonth(rows, yearMonth);
        if (options.render !== false) renderCurrentRecordList();
      }
      return true;
    } catch (error) {
      console.warn('출석 서버 동기화 보류:', error?.message || error);
      return false;
    }
  }

  function setTodayScheduleFromWeek(week, baseDate) {
    const targetDateKey = dateKey(baseDate || new Date());
    const weekday = getIsoWeekday(targetDateKey);
    const regular = new Map();
    const regularSessions = new Map();
    const makeup = new Map();
    (Array.isArray(week?.enrollments) ? week.enrollments : []).forEach(row => {
      const studentId = clean(row?.student_id);
      if (!studentId || Number(row?.weekday) !== weekday || !isEnrollmentActiveOnDate(row, targetDateKey)) return;
      const item = { student_id: studentId, time_slot: Number(row?.time_slot), class_group: clean(row?.class_group) || 'A', source: 'server_regular' };
      const current = regular.get(studentId);
      if (!current || timeRank(item.time_slot) < timeRank(current.time_slot)) regular.set(studentId, item);

      const sessions = regularSessions.get(studentId) || [];
      const sameTimeExists = sessions.some(session => Number(session?.time_slot) === Number(item.time_slot));
      if (!sameTimeExists) sessions.push(item);
      sessions.sort((a, b) => timeRank(a?.time_slot) - timeRank(b?.time_slot));
      regularSessions.set(studentId, sessions);
    });
    (Array.isArray(week?.one_time_sessions) ? week.one_time_sessions : []).forEach(row => {
      const studentId = clean(row?.student_id);
      const sessionDate = clean(row?.session_date).slice(0, 10);
      if (!studentId || sessionDate !== targetDateKey || clean(row?.status).toLowerCase() === 'cancelled') return;
      const item = { student_id: studentId, time_slot: Number(row?.time_slot), class_group: clean(row?.class_group) || 'A', source: 'server_makeup' };
      const current = makeup.get(studentId);
      if (!current || timeRank(item.time_slot) < timeRank(current.time_slot)) makeup.set(studentId, item);
    });
    todayScheduleState.dateKey = targetDateKey;
    todayScheduleState.regular = regular;
    todayScheduleState.regularSessions = regularSessions;
    todayScheduleState.makeup = makeup;
    todayScheduleState.loaded = true;
    global.__olliTodayAttendanceSchedule = { dateKey: targetDateKey, regular, regularSessions, makeup, loaded: true };
  }

  function currentTodayScheduleSignature() {
    const regular = Array.from(todayScheduleState.regularSessions.entries()).flatMap(([studentId, sessions]) =>
      (Array.isArray(sessions) ? sessions : []).map(session => [String(studentId), Number(session?.time_slot) || 0, clean(session?.class_group || 'A')])
    ).sort();
    const makeup = Array.from(todayScheduleState.makeup.entries()).map(([studentId, session]) =>
      [String(studentId), Number(session?.time_slot) || 0, clean(session?.class_group || 'A')]
    ).sort();
    return JSON.stringify({ dateKey: todayScheduleState.dateKey, regular, makeup });
  }

  function hydrateTodayScheduleFromLocal(baseDate, options = {}) {
    const data = shared();
    const targetDateKey = dateKey(baseDate || new Date());
    if (!data || typeof data.getCachedWeek !== 'function' || !targetDateKey) return false;
    const academyId = clean(typeof data.currentAcademyId === 'function' ? data.currentAcademyId() : '');
    if (!academyId) return false;
    const cachedWeek = data.getCachedWeek(targetDateKey);
    if (!cachedWeek) return false;
    const sameSnapshotContext = todayScheduleState.loaded
      && todayScheduleState.academyId === academyId
      && todayScheduleState.dateKey === targetDateKey;
    const beforeSignature = sameSnapshotContext
      ? (todayScheduleState.signature || currentTodayScheduleSignature())
      : '';
    todayScheduleState.academyId = academyId;
    todayScheduleState.sessionToken = clean(typeof data.currentSessionToken === 'function' ? data.currentSessionToken() : '');
    todayScheduleState.dateKey = targetDateKey;
    setTodayScheduleFromWeek(cachedWeek, targetDateKey);
    const nextSignature = currentTodayScheduleSignature();
    const changed = !sameSnapshotContext || nextSignature !== beforeSignature;
    todayScheduleState.signature = nextSignature;
    if (changed && options.render !== false) renderCurrentRecordList();
    return true;
  }

  function hydrateLocalAttendanceSnapshot(baseDate, options = {}) {
    const monthHydrated = hydrateCurrentMonthFromLocal(baseDate, { render: false });
    const weekHydrated = hydrateTodayScheduleFromLocal(baseDate, { render: false });
    if ((monthHydrated || weekHydrated) && options.render !== false) renderCurrentRecordList();
    return monthHydrated || weekHydrated;
  }

  function hydrateLocalAttendanceNavigationSnapshot(baseDate, options = {}) {
    return hydrateTodayScheduleFromLocal(baseDate, { render: options.render });
  }

  async function syncTodaySchedule(baseDate, options = {}) {
    const data = shared();
    const targetDateKey = dateKey(baseDate || new Date());
    if (!data || typeof data.loadWeek !== 'function' || !targetDateKey) return false;
    const academyId = clean(data.currentAcademyId());
    const sessionToken = clean(data.currentSessionToken());
    if (!academyId) return false;
    if (options.skipLocal !== true) hydrateTodayScheduleFromLocal(targetDateKey, { render: options.render });
    if (!sessionToken) return todayScheduleState.loaded;
    const sameContext = todayScheduleState.academyId === academyId && todayScheduleState.sessionToken === sessionToken;
    if (todayScheduleState.loading && sameContext && todayScheduleState.dateKey === targetDateKey) return todayScheduleState.loading;
    if (!sameContext || todayScheduleState.dateKey !== targetDateKey) {
      todayScheduleState.loaded = false;
      todayScheduleState.signature = '';
      todayScheduleState.regular = new Map();
      todayScheduleState.regularSessions = new Map();
      todayScheduleState.makeup = new Map();
    }
    todayScheduleState.academyId = academyId;
    todayScheduleState.sessionToken = sessionToken;
    todayScheduleState.dateKey = targetDateKey;
    const isCurrent = () => academyId === clean(data.currentAcademyId())
      && sessionToken === clean(data.currentSessionToken())
      && todayScheduleState.dateKey === targetDateKey
      && todayScheduleState.loading === task
      && (!options?.isCurrent || options.isCurrent());
    const task = Promise.resolve().then(async () => {
      try {
        const week = await data.loadWeek(targetDateKey);
        if (!isCurrent()) return false;
        const beforeSignature = todayScheduleState.signature || currentTodayScheduleSignature();
        setTodayScheduleFromWeek(week || {}, targetDateKey);
        const nextSignature = currentTodayScheduleSignature();
        const changed = nextSignature !== beforeSignature;
        todayScheduleState.signature = nextSignature;
        if (changed && options.render !== false) renderCurrentRecordList();
        return true;
      } catch (error) {
        console.warn('오늘 시간표 동기화 보류:', error?.message || error);
        return false;
      } finally {
        if (todayScheduleState.loading === task) todayScheduleState.loading = null;
      }
    });
    todayScheduleState.loading = task;
    return task;
  }

  function getTodayScheduleEntry(studentId) {
    const id = clean(studentId);
    if (!id || todayScheduleState.academyId !== clean(shared()?.currentAcademyId())) return { regular: null, makeup: null };
    return { regular: todayScheduleState.regular.get(id) || null, makeup: todayScheduleState.makeup.get(id) || null };
  }
  function isRegularScheduledToday(student, baseDate) {
    const id = clean(student?.id);
    const targetDateKey = dateKey(baseDate || new Date());
    if (!id || !targetDateKey) return false;
    if (todayScheduleState.loaded && todayScheduleState.academyId === clean(shared()?.currentAcademyId()) && todayScheduleState.dateKey === targetDateKey) return todayScheduleState.regular.has(id);
    const legacyTime = getLegacyTodayTime(student, targetDateKey);
    if (legacyTime != null) return true;
    try {
      return typeof global.getRecordAttendanceExpectedStatus === 'function' && global.getRecordAttendanceExpectedStatus(student, new Date()) === 'attended';
    } catch (_) { return false; }
  }
  function getStudentTodayTimeRank(student, kind) {
    if (kind === 'regular' && Number.isFinite(Number(student?.__olliAttendanceRegularTimeSlot))) {
      return timeRank(student.__olliAttendanceRegularTimeSlot);
    }
    const entry = getTodayScheduleEntry(student?.id);
    const scheduleItem = kind === 'makeup' ? entry.makeup : entry.regular;
    if (scheduleItem && Number.isFinite(Number(scheduleItem.time_slot))) return timeRank(scheduleItem.time_slot);
    const legacyTime = getLegacyTodayTime(student, new Date());
    if (legacyTime != null) return timeRank(legacyTime);
    return timeRank(student?.lesson_time || student?.lessonTime || student?.class_time || student?.classTime || '');
  }
  function sortByTodayTime(students, kind) {
    return [...(students || [])].sort((a, b) => {
      const byTime = getStudentTodayTimeRank(a, kind) - getStudentTodayTimeRank(b, kind);
      return byTime !== 0 ? byTime : clean(a?.name).localeCompare(clean(b?.name), 'ko');
    });
  }
  function getTodayAttendanceSections(students) {
    const active = (Array.isArray(students) ? students : []).filter(student => {
      try { return typeof global.getStudentStatus !== 'function' || global.getStudentStatus(student) === 'active'; }
      catch (_) { return true; }
    });
    const byId = new Map(active.map(student => [String(student.id), student]));
    let regular = [];
    let makeup = [];
    if (todayScheduleState.loaded && todayScheduleState.academyId === clean(shared()?.currentAcademyId()) && todayScheduleState.dateKey === dateKey(new Date())) {
      /* 정규수업과 보강을 같은 날 모두 하는 학생은 양쪽 목록에 각각 표시한다.
         같은 날 정규수업이 여러 시간인 학생은 시간별 그룹에 각각 한 번씩 표시한다. */
      if (todayScheduleState.regularSessions instanceof Map && todayScheduleState.regularSessions.size) {
        regular = Array.from(todayScheduleState.regularSessions.entries()).flatMap(([id, sessions]) => {
          const student = byId.get(String(id));
          if (!student) return [];
          return (Array.isArray(sessions) ? sessions : []).map(session => ({
            ...student,
            __olliAttendanceRegularTimeSlot: Number(session?.time_slot),
            __olliAttendanceRegularClassGroup: clean(session?.class_group)
          }));
        });
      } else {
        regular = Array.from(todayScheduleState.regular.keys()).map(id => byId.get(String(id))).filter(Boolean);
      }
      makeup = Array.from(todayScheduleState.makeup.keys()).map(id => byId.get(String(id))).filter(Boolean);
    } else {
      regular = active.filter(student => isRegularScheduledToday(student, new Date()));
      const targetDateKey = dateKey(new Date());
      makeup = active.filter(student => getAttendanceSessionStatus(student.id, targetDateKey, 'makeup') === 'makeup');
    }
    return { regular: sortByTodayTime(regular, 'regular'), makeup: sortByTodayTime(makeup, 'makeup') };
  }

  function isDaySort(view) {
    try { return typeof global.getRecordSortCriteria === 'function' && global.getRecordSortCriteria(view) === 'lessonDay'; }
    catch (_) { return false; }
  }
  function escapeInlineText(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function renderSessionDivider(label) {
    return `<div class="recordTodaySessionDivider" style="display:flex;align-items:center;gap:10px;margin:13px 14px 8px;color:#8a8a8a;font-size:12px;font-weight:700;letter-spacing:-.02em;line-height:1.2;"><span aria-hidden="true" style="height:1px;background:#e9e9e9;flex:1 1 auto;"></span><span>${escapeInlineText(label)}</span><span aria-hidden="true" style="height:1px;background:#e9e9e9;flex:1 1 auto;"></span></div>`;
  }
  function stripLessonTimeFromMeta(html) {
    const source = String(html || '');
    if (!source || !global.document?.createElement) return source;
    const host = global.document.createElement('div');
    host.innerHTML = source;
    host.querySelectorAll('.studentMetaText').forEach(meta => {
      const parts = String(meta.textContent || '').split('|').map(part => part.trim()).filter(Boolean);
      const filtered = parts.filter(part => !/(?:오전|오후)?\s*\d{1,2}\s*시|\d{1,2}:\d{2}/.test(part));
      if (!filtered.length) meta.remove();
      else meta.textContent = filtered.join('\u00A0\u00A0|\u00A0\u00A0');
    });
    return host.innerHTML;
  }
  function renderRowsForSession(renderRows, students, kind, options) {
    const previousKind = global.__olliAttendanceRenderSessionKind;
    global.__olliAttendanceRenderSessionKind = kind;
    let html = '';
    try { html = renderRows(students); }
    finally { global.__olliAttendanceRenderSessionKind = previousKind; }
    if (options?.hideLessonTime) html = stripLessonTimeFromMeta(html);
    return html;
  }
  function getRegularTimeSlot(student) {
    if (Number.isFinite(Number(student?.__olliAttendanceRegularTimeSlot))) {
      return Number(student.__olliAttendanceRegularTimeSlot);
    }
    const entry = getTodayScheduleEntry(student?.id).regular;
    if (entry && Number.isFinite(Number(entry.time_slot))) return Number(entry.time_slot);
    const legacy = getLegacyTodayTime(student, new Date());
    return Number.isFinite(Number(legacy)) ? Number(legacy) : null;
  }
  function renderRegularTimeGroups(renderRows, students) {
    const groups = [];
    let currentKey = null;
    (students || []).forEach(student => {
      const slot = getRegularTimeSlot(student);
      const key = Number.isFinite(slot) ? String(slot) : 'unknown';
      if (!groups.length || currentKey !== key) {
        groups.push({ key, slot, students: [] });
        currentKey = key;
      }
      groups[groups.length - 1].students.push(student);
    });
    return groups.map(group => {
      const label = Number.isFinite(group.slot) ? `${group.slot}시` : '시간 미정';
      return `${renderSessionDivider(label)}${renderRowsForSession(renderRows, group.students, 'regular')}`;
    }).join('');
  }
  function renderTodayAttendanceList(view, name) {
    const list = global.document.getElementById('recordList');
    if (!list || typeof global.getStudentsByType !== 'function') return false;
    let students = global.getStudentsByType(view);
    const query = clean(name);
    if (query) students = students.filter(student => clean(student?.name).includes(query));
    const sections = getTodayAttendanceSections(students);
    const renderRows = view === 'kinder' ? global.renderKinderStudentRows : global.renderElementaryStudentRows;
    if (typeof renderRows !== 'function') return false;

    const regularHtml = renderRegularTimeGroups(renderRows, sections.regular);
    const makeupHtml = renderRowsForSession(renderRows, sections.makeup, 'makeup', { hideLessonTime: true });
    const regularEmpty = regularHtml ? '' : `<div class="recordEmpty recordTodayEmpty">${query ? '검색된 당일 등원 학생이 없습니다.' : '오늘 등원 예정인 학생이 없습니다.'}</div>`;
    const makeupSection = makeupHtml ? `${renderSessionDivider('보강')}${makeupHtml}` : '';
    list.innerHTML = `${regularHtml}${regularEmpty}${makeupSection}`;
    return true;
  }

  function renderRecordListOverride(view, name) {
    const query = clean(name);
    if (query || !isDaySort(view)) return false;
    return renderTodayAttendanceList(view, name);
  }

  function defaultSessionKindForStudent(student) {
    const entry = getTodayScheduleEntry(student?.id);
    if (entry.regular) return 'regular';
    if (entry.makeup) return 'makeup';
    return isRegularScheduledToday(student, new Date()) ? 'regular' : 'makeup';
  }
  function resolveAttendanceSessionTarget(student, kind, timeSlot, classGroup) {
    const requestedSlot = Number(timeSlot);
    if (Number.isFinite(requestedSlot) && requestedSlot > 0) {
      return { timeSlot: requestedSlot, classGroup: clean(classGroup) || 'A' };
    }
    const entry = getTodayScheduleEntry(student?.id);
    if (kind === 'makeup') {
      const slot = Number(entry.makeup?.time_slot);
      return {
        timeSlot: Number.isFinite(slot) && slot > 0 ? slot : 0,
        classGroup: clean(entry.makeup?.class_group) || 'A'
      };
    }
    const decoratedSlot = Number(student?.__olliAttendanceRegularTimeSlot);
    if (Number.isFinite(decoratedSlot) && decoratedSlot > 0) {
      return {
        timeSlot: decoratedSlot,
        classGroup: clean(student?.__olliAttendanceRegularClassGroup) || 'A'
      };
    }
    const scheduleSlot = Number(entry.regular?.time_slot);
    if (Number.isFinite(scheduleSlot) && scheduleSlot > 0) {
      return { timeSlot: scheduleSlot, classGroup: clean(entry.regular?.class_group) || 'A' };
    }
    const legacySlot = Number(getLegacyTodayTime(student, new Date()));
    return {
      timeSlot: Number.isFinite(legacySlot) && legacySlot > 0 ? legacySlot : 0,
      classGroup: 'A'
    };
  }
  function decorateLeadIcon(html, student, requestedKind) {
    const contextKind = clean(requestedKind || global.__olliAttendanceRenderSessionKind).toLowerCase();
    const kind = contextKind === 'regular' || contextKind === 'makeup' ? contextKind : defaultSessionKindForStudent(student);
    const target = resolveAttendanceSessionTarget(student, kind);
    let nextHtml = String(html || '');
    const targetDateKey = dateKey(new Date());
    const status = getAttendanceSessionStatus(student?.id, targetDateKey, kind, target.timeSlot, target.classGroup);
    const stateClass = status === 'absent' ? 'absent' : (status || '');
    const marker = `recordAttendanceLeadBtn${stateClass ? ` ${stateClass}` : ''}`;
    const safeGroup = (clean(target.classGroup) || 'A').replace(/[^A-Za-z0-9_-]/g, '') || 'A';
    if (nextHtml.includes('recordAttendanceLeadBtn')) {
      nextHtml = nextHtml.replace(/recordAttendanceLeadBtn(?:\s+attended|\s+makeup|\s+absent|\s+blank)?/, marker);
    }
    nextHtml = nextHtml.replace(/toggleRecordTodayAttendance\(event,'([^']*)'\)/g, function(_, id) {
      return `toggleRecordTodayAttendance(event,'${id}','${kind}',${Number(target.timeSlot) || 0},'${safeGroup}')`;
    });
    nextHtml = nextHtml.replace(/handleRecordAttendanceLeadKeydown\(event,'([^']*)'\)/g, function(_, id) {
      return `handleRecordAttendanceLeadKeydown(event,'${id}','${kind}',${Number(target.timeSlot) || 0},'${safeGroup}')`;
    });
    return nextHtml;
  }

  async function setAttendanceRegisterStatus(student, targetDateKey, sessionKind, localStatus, timeSlot, classGroup) {
    const data = shared();
    if (!data || typeof global.supabase !== 'function') throw new Error('출석 서버 연결을 찾지 못했습니다.');
    const academyId = clean(typeof data.currentAcademyId === 'function' ? data.currentAcademyId() : '');
    const sessionToken = clean(typeof data.currentSessionToken === 'function' ? data.currentSessionToken() : '');
    const kind = normalizeSessionKind(sessionKind);
    const targetSlot = Number(timeSlot);
    const targetGroup = clean(classGroup) || 'A';
    const serverStatus = kind === 'makeup'
      ? (localStatus === 'makeup' ? 'makeup' : 'blank')
      : (LOCAL_STATUS_TO_REGISTER[localStatus] || 'blank');
    if (!academyId) throw new Error('현재 학원 정보를 찾지 못했습니다. 다시 로그인해 주세요.');
    if (!sessionToken) throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
    if (!Number.isFinite(targetSlot) || targetSlot <= 0) throw new Error('출석 수업 시간을 확인할 수 없습니다. 시간표를 다시 불러와 주세요.');

    if (kind === 'makeup' && serverStatus === 'makeup' && typeof data.setAttendancePresent === 'function') {
      const activeStudents = typeof global.getAllStudents === 'function' ? global.getAllStudents().filter(item => {
        try { return typeof global.getStudentStatus !== 'function' || global.getStudentStatus(item) === 'active'; }
        catch (_) { return true; }
      }) : [];
      await data.setAttendancePresent({
        student,
        students: activeStudents,
        sessionDate: targetDateKey,
        sessionKind: 'makeup',
        timeSlot: targetSlot,
        classGroup: targetGroup,
        present: true
      });
      await syncTodaySchedule(targetDateKey, { render: false });
    }

    const rawResult = await global.supabase('POST', 'rpc/olli_schedule_set_attendance_session_status_v2', {
      p_session_token: sessionToken,
      p_academy_id: academyId,
      p_student_id: String(student.id),
      p_session_date: targetDateKey,
      p_session_kind: kind,
      p_time_slot: targetSlot,
      p_class_group: targetGroup,
      p_status: serverStatus
    });
    const result = Array.isArray(rawResult) && rawResult.length === 1 ? rawResult[0] : rawResult;
    if (result?.ok === false) throw new Error(result.message || '출석 저장에 실패했습니다.');
    if (typeof data.invalidateMonth === 'function') data.invalidateMonth(targetDateKey);
    if (typeof data.invalidateWeek === 'function') data.invalidateWeek(targetDateKey);
    return result;
  }

  async function toggleTodayAttendance(event, studentId, requestedKind, timeSlot, classGroup) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    if (isStudentSelectionMode() || typeof global.getAllStudents !== 'function') return;
    const student = global.getAllStudents().find(item => String(item.id) === String(studentId));
    if (!student) return;

    const today = new Date();
    const targetDateKey = dateKey(today);
    const requested = clean(requestedKind).toLowerCase();
    const pressedButton = event?.currentTarget?.classList?.contains('recordAttendanceLeadBtn')
      ? event.currentTarget
      : event?.target?.closest?.('.recordAttendanceLeadBtn');

    // Normal rendered controls already carry their exact session target.
    // Only hydrate the lightweight week snapshot when an old/undecorated control has no exact target.
    if (!(Number.isFinite(Number(timeSlot)) && Number(timeSlot) > 0)) {
      hydrateTodayScheduleFromLocal(today, { render: false });
    }

    const scheduleEntry = getTodayScheduleEntry(student.id);
    const kind = requested === 'regular' || requested === 'makeup'
      ? requested
      : (scheduleEntry.regular ? 'regular' : (scheduleEntry.makeup ? 'makeup' : (isRegularScheduledToday(student, today) ? 'regular' : 'makeup')));
    const target = resolveAttendanceSessionTarget(student, kind, timeSlot, classGroup);
    if (!Number.isFinite(Number(target.timeSlot)) || Number(target.timeSlot) <= 0) {
      const message = '출석 수업 시간을 확인할 수 없습니다. 시간표를 다시 불러와 주세요.';
      if (typeof global.showPushToast === 'function') global.showPushToast(message);
      else global.alert(message);
      return;
    }

    const buttonStatus = pressedButton?.classList?.contains('attended')
      ? 'attended'
      : (pressedButton?.classList?.contains('absent')
        ? 'absent'
        : (pressedButton?.classList?.contains('makeup') ? 'makeup' : ''));
    const currentStatus = pressedButton
      ? buttonStatus
      : getAttendanceSessionStatus(student.id, targetDateKey, kind, target.timeSlot, target.classGroup);

    let nextStatus = '';
    if (kind === 'makeup') {
      nextStatus = currentStatus === 'makeup' ? '' : 'makeup';
    } else if (currentStatus === 'attended') {
      nextStatus = 'absent';
    } else if (currentStatus === 'absent') {
      nextStatus = '';
    } else {
      nextStatus = 'attended';
    }

    if (pressedButton) {
      pressedButton.classList.remove('attended', 'absent', 'makeup', 'blank');
      if (nextStatus === 'attended' || nextStatus === 'absent' || nextStatus === 'makeup') {
        pressedButton.classList.add(nextStatus);
      } else {
        pressedButton.classList.add('blank');
      }
    }

    // Yield before local merge/storage work so iOS can paint the pressed state first.
    await afterNextPaint();

    const localStore = typeof global.readRecordDailyAttendanceStore === 'function'
      ? global.readRecordDailyAttendanceStore()
      : {};
    const beforeSession = getLocalSessionSnapshot(
      student.id, targetDateKey, kind, target.timeSlot, target.classGroup, localStore
    );
    writeLocalStatus(
      student, targetDateKey, kind, nextStatus, false, target.timeSlot, target.classGroup, localStore
    );

    try {
      await setAttendanceRegisterStatus(student, targetDateKey, kind, nextStatus, target.timeSlot, target.classGroup);
      writeLocalStatus(student, targetDateKey, kind, nextStatus, true, target.timeSlot, target.classGroup);

      // The pressed control already reflects the authoritative result.
      // Only the optional attendance-guide summary needs a full-row refresh here.
      if (global.OlliAttendanceGuideUI?.isActive?.()) renderCurrentRecordList();
    } catch (error) {
      restoreLocalSession(student, targetDateKey, kind, target.timeSlot, target.classGroup, beforeSession);
      if (pressedButton) {
        pressedButton.classList.remove('attended', 'absent', 'makeup', 'blank');
        if (currentStatus === 'attended' || currentStatus === 'absent' || currentStatus === 'makeup') {
          pressedButton.classList.add(currentStatus);
        } else {
          pressedButton.classList.add('blank');
        }
      } else {
        renderCurrentRecordList();
      }
      const message = String(error?.message || error || '출석 저장에 실패했습니다.');
      if (typeof global.showPushToast === 'function') global.showPushToast(message);
      else global.alert(message);
    }
  }

  function afterRecordListLoaded() {
    const view = getCurrentRecordView();
    if (view !== 'elementary' && view !== 'kinder') return false;
    Promise.all([
      syncCurrentMonth(new Date(), { render: false, skipLocal: true, forceMerge: true }),
      syncTodaySchedule(new Date(), { render: false, skipLocal: true })
    ]).then(() => {
      if (getCurrentRecordView() === view) renderCurrentRecordList();
    }).catch(error => console.warn('출석 백그라운드 최신화 실패:', error?.message || error));
    return true;
  }

  // Stage 2 refreshes today's schedule only. Attendance marks and profile editors
  // keep their existing save/reconciliation paths until their own migration stage.
  function canRefreshTodaySchedule() {
    const view = getCurrentRecordView();
    if (view !== 'elementary' && view !== 'kinder') return false;
    if (!global.document.getElementById('recordRoomScreen')?.getClientRects().length) return false;
    if (isStudentSelectionMode() || todayScheduleState.loading) return false;
    if (global.document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) return false;
    return !Array.from(global.document.querySelectorAll('.modalOverlay')).some(el => el.getClientRects().length);
  }

  let realtimeScheduleRevision = 0;
  let realtimeScheduleContext = '';
  let realtimeScheduleDate = '';
  if (typeof global.OlliRealtime?.watchDomain === 'function') {
    const watcher = global.OlliRealtime.watchDomain('schedule', async (context) => {
      if (!canRefreshTodaySchedule() || !context.isCurrent()) return false;
      const data = shared();
      if (!data || typeof global.supabase !== 'function') return false;
      const sessionToken = clean(data.currentSessionToken());
      const key = `${context.academyId}|${sessionToken}`;
      const targetDate = dateKey(new Date());
      const result = await global.supabase('POST', 'rpc/olli_schedule_sync_revision', {
        p_session_token: sessionToken, p_academy_id: context.academyId
      });
      const info = Array.isArray(result) ? result[0] : result;
      const revision = Number(info?.version || 0);
      if (info?.ok !== true || !revision) throw new Error('오늘 수업 변경 번호를 확인하지 못했습니다.');
      if (!context.isCurrent() || !canRefreshTodaySchedule()) return false;
      if (key === realtimeScheduleContext && targetDate === realtimeScheduleDate && revision === realtimeScheduleRevision) return true;
      const beforeSignature = todayScheduleState.signature || currentTodayScheduleSignature();
      const applied = await syncTodaySchedule(targetDate, {
        render: false,
        skipLocal: true,
        isCurrent: () => context.isCurrent() && targetDate === dateKey(new Date())
      });
      if (!applied || !context.isCurrent() || !canRefreshTodaySchedule()) return false;
      if ((todayScheduleState.signature || currentTodayScheduleSignature()) !== beforeSignature) renderCurrentRecordList();
      realtimeScheduleContext = key;
      realtimeScheduleDate = targetDate;
      realtimeScheduleRevision = revision;
      return true;
    });
    global.addEventListener('olli:schedule-changed', () => watcher.request());
  }

  global.OlliPhoneAttendanceAdapter = Object.freeze({
    renderRecordListOverride,
    decorateLeadIcon,
    toggleTodayAttendance,
    hydrateLocalAttendanceSnapshot,
    hydrateLocalAttendanceNavigationSnapshot,
    beginRecordListRender,
    endRecordListRender,
    afterRecordListLoaded
  });
  global.syncRecordAttendanceCurrentMonthFromServer = syncCurrentMonth;
  global.syncOlliTodayAttendanceSchedule = syncTodaySchedule;
  global.getOlliTodayScheduleEntry = getTodayScheduleEntry;
  global.getOlliTodayAttendanceSections = getTodayAttendanceSections;
  global.getOlliAttendanceSessionStatus = getAttendanceSessionStatus;
})(window);
