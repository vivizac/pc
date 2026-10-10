(function (global) {
  'use strict';

  const VERSION = '1.0.0';

  const ROUTE_ORDER = Object.freeze([
    'attendance_status_prepare',
    'timetable_admin_prepare',
    'batch_prepare',
    'memo_prepare',
    'trial_cancel_prepare',
    'makeup_cancel_prepare',
    'absence_prepare',
    'trial_add_prepare',
    'trial_update_prepare',
    'waitlist_add_prepare',
    'waitlist_update_prepare',
    'waitlist_cancel_prepare',
    'pickup_cancel_prepare',
    'pickup_update_prepare',
    'pickup_prepare',
    'makeup_update_prepare',
    'makeup_prepare',
    'class_once_prepare',
    'move_prepare',
    'move_cancel_prepare',
    'timetable_read',
    'attendance_read',
    'pickup_read',
    'schedule_read',
  ]);

  const PLATFORM_ADAPTERS = Object.freeze({
    pc: Object.freeze([]),
    mobile: Object.freeze([
      'makeup_add_draft_prompt',
      'student_info_lookup',
    ]),
  });

  const LEGACY_BRIDGES = Object.freeze({
    trial_cancel_reason: 'legacy_reason_bridge:cancel_trial',
    makeup_cancel_reason: 'legacy_reason_bridge:cancel_makeup',
    absence_reason: 'legacy_reason_bridge:mark_absent',
    trial_department: 'legacy_department_bridge:add_trial',
  });

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function safeCall(router, name, text) {
    if (!router || typeof router[name] !== 'function') return null;
    try {
      return router[name](text) || null;
    } catch (_) {
      return null;
    }
  }

  function agentResult(route, candidate) {
    return Object.freeze({
      kind: 'agent',
      route,
      mode: route,
      candidate: candidate || null,
      legacyBridge: '',
    });
  }

  function bridgeResult(code, candidate) {
    return Object.freeze({
      kind: 'legacy_bridge',
      route: '',
      mode: '',
      candidate: candidate || null,
      legacyBridge: code,
    });
  }

  function noneResult() {
    return Object.freeze({
      kind: 'none',
      route: '',
      mode: '',
      candidate: null,
      legacyBridge: '',
    });
  }

  function parseTimetableAdmin(router, text) {
    for (const name of [
      'parseClassLayoutMutationIntent',
      'parseTeacherAssignmentMutationIntent',
      'parseSessionOrderMutationIntent',
      'parseNormalClassDayMutationIntent',
    ]) {
      const parsed = safeCall(router, name, text);
      if (parsed) return parsed;
    }
    return null;
  }

  function parseMemo(router, text) {
    const deleted = safeCall(router, 'parseTimetableMemoDeleteMutationIntent', text);
    if (clean(deleted?.intent) === 'delete_timetable_memo') return deleted;
    const added = safeCall(router, 'parseTimetableMemoAddMutationIntent', text);
    return clean(added?.intent) === 'add_timetable_memo' ? added : null;
  }

  function isStudentAttendanceRead(text) {
    const compact = clean(text).replace(/\s+/g, '');
    if (!compact) return false;
    return /(?:출결|출석(?:기록|현황|내역)?|결석(?:기록|현황|내역|횟수))/.test(compact)
      && /(?:알려|보여|확인|조회|기록|현황|내역|횟수|몇번|몇회|했어|했나|있어|어때)/.test(compact);
  }

  function isStudentPickupRead(text) {
    const compact = clean(text).replace(/\s+/g, '');
    return !!compact && (
      /(?:픽업|하원).*(?:일정|시간|어디|몇시|확인|알려|보여|조회)/.test(compact)
      || /(?:일정|시간|어디|몇시).*(?:픽업|하원)/.test(compact)
    );
  }

  function isStudentScheduleRead(text) {
    const compact = clean(text).replace(/\s+/g, '');
    return !!compact && (
      /시간표/.test(compact)
      || /수업.*(?:언제|요일|몇시|시간|스케줄)/.test(compact)
      || /(?:언제|요일|몇시|시간|스케줄).*수업/.test(compact)
    );
  }

  function classify(text, router) {
    const commandText = clean(text);
    if (!commandText || !router) return noneResult();

    const attendance = safeCall(router, 'parseAttendanceStatusMutationIntent', commandText);
    if (attendance) return agentResult('attendance_status_prepare', attendance);

    const admin = parseTimetableAdmin(router, commandText);
    if (admin) return agentResult('timetable_admin_prepare', admin);

    const batch = safeCall(router, 'parseMultiWriteIntent', commandText);
    if (clean(batch?.intent) === 'batch_write' && Array.isArray(batch?.commands)) {
      return agentResult('batch_prepare', batch);
    }

    const memo = parseMemo(router, commandText);
    if (memo) return agentResult('memo_prepare', memo);

    const trialCancel = safeCall(router, 'parseTrialCancelMutationIntent', commandText);
    if (clean(trialCancel?.intent) === 'cancel_trial') {
      if (clean(trialCancel?.reason)) return agentResult('trial_cancel_prepare', trialCancel);
      return bridgeResult(LEGACY_BRIDGES.trial_cancel_reason, trialCancel);
    }

    const makeupCancel = safeCall(router, 'parseMakeupCancelMutationIntent', commandText);
    if (clean(makeupCancel?.intent) === 'cancel_makeup') {
      if (clean(makeupCancel?.reason)) return agentResult('makeup_cancel_prepare', makeupCancel);
      return bridgeResult(LEGACY_BRIDGES.makeup_cancel_reason, makeupCancel);
    }

    const absence = safeCall(router, 'parseAbsenceMutationIntent', commandText);
    if (clean(absence?.intent) === 'mark_absent' && clean(absence?.studentName)) {
      if (clean(absence?.reason)) return agentResult('absence_prepare', absence);
      return bridgeResult(LEGACY_BRIDGES.absence_reason, absence);
    }

    const trialAdd = safeCall(router, 'parseTrialMutationIntent', commandText);
    if (clean(trialAdd?.intent) === 'add_trial') {
      const division = clean(trialAdd?.division).toLowerCase();
      if (division === 'elementary' || division === 'kinder') {
        return agentResult('trial_add_prepare', trialAdd);
      }
      return bridgeResult(LEGACY_BRIDGES.trial_department, trialAdd);
    }

    const trialUpdate = safeCall(router, 'parseTrialUpdateMutationIntent', commandText);
    if (clean(trialUpdate?.intent) === 'update_trial') return agentResult('trial_update_prepare', trialUpdate);

    const waitAdd = safeCall(router, 'parseWaitlistMutationIntent', commandText);
    if (clean(waitAdd?.intent) === 'add_waitlist') return agentResult('waitlist_add_prepare', waitAdd);

    const waitUpdate = safeCall(router, 'parseWaitlistUpdateMutationIntent', commandText);
    if (clean(waitUpdate?.intent) === 'update_waitlist') return agentResult('waitlist_update_prepare', waitUpdate);

    const waitCancel = safeCall(router, 'parseWaitlistCancelMutationIntent', commandText);
    if (clean(waitCancel?.intent) === 'cancel_waitlist') return agentResult('waitlist_cancel_prepare', waitCancel);

    const pickupCancel = safeCall(router, 'parsePickupCancelMutationIntent', commandText);
    if (clean(pickupCancel?.intent) === 'cancel_pickup') return agentResult('pickup_cancel_prepare', pickupCancel);

    const pickupUpdate = safeCall(router, 'parsePickupUpdateMutationIntent', commandText);
    if (clean(pickupUpdate?.intent) === 'update_pickup') return agentResult('pickup_update_prepare', pickupUpdate);

    const pickupAdd = safeCall(router, 'parsePickupMutationIntent', commandText);
    if (clean(pickupAdd?.intent) === 'add_pickup') return agentResult('pickup_prepare', pickupAdd);

    const makeupUpdate = safeCall(router, 'parseMakeupUpdateMutationIntent', commandText);
    if (clean(makeupUpdate?.intent) === 'update_makeup') return agentResult('makeup_update_prepare', makeupUpdate);

    const makeupAdd = safeCall(router, 'parseMakeupMutationIntent', commandText);
    if (clean(makeupAdd?.intent) === 'add_makeup') return agentResult('makeup_prepare', makeupAdd);

    const classOnce = safeCall(router, 'parseClassMutationIntent', commandText);
    if (clean(classOnce?.intent) === 'add_class_once') return agentResult('class_once_prepare', classOnce);

    const move = safeCall(router, 'parseScheduleMoveMutationIntent', commandText);
    if (clean(move?.intent) === 'move_class') return agentResult('move_prepare', move);

    const moveCancel = safeCall(router, 'parseMoveCancelMutationIntent', commandText);
    if (clean(moveCancel?.intent) === 'cancel_move') return agentResult('move_cancel_prepare', moveCancel);

    const timetableRead = safeCall(router, 'parseQueryIntent', commandText);
    if (
      timetableRead &&
      ['find_available_slots', 'find_roster_entries', 'find_pickups', 'multi_read_query'].includes(clean(timetableRead.intent))
    ) {
      return agentResult('timetable_read', timetableRead);
    }

    if (isStudentAttendanceRead(commandText)) return agentResult('attendance_read', null);
    if (isStudentPickupRead(commandText)) return agentResult('pickup_read', null);
    if (isStudentScheduleRead(commandText)) return agentResult('schedule_read', null);

    return noneResult();
  }

  const api = Object.freeze({
    VERSION,
    ROUTE_ORDER,
    PLATFORM_ADAPTERS,
    LEGACY_BRIDGES,
    classify,
    isStudentAttendanceRead,
    isStudentPickupRead,
    isStudentScheduleRead,
  });

  global.OlliAgentRouting = api;
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.OlliAgentRouting;
}
