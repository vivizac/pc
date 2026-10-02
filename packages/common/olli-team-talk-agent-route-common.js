(function olliTeamTalkAgentRouteClassifierCommon(global) {
  'use strict';

  if (global.OlliTeamTalkAgentRouteClassifier) return;

  const VERSION = '2026-10-02-agent-route-sot-1';

  const ROUTE_KEYS = Object.freeze([
    'attendance_status',
    'timetable_admin',
    'batch_write',
    'timetable_memo',
    'trial_cancel',
    'makeup_cancel',
    'absence',
    'trial_add',
    'trial_update',
    'waitlist_cancel',
    'waitlist_update',
    'waitlist_add',
    'pickup_cancel',
    'pickup_update',
    'pickup_add',
    'makeup_update',
    'makeup_add',
    'move_cancel',
    'move',
    'class_once',
    'timetable_read',
    'attendance_read',
    'pickup_read',
    'schedule_read',
  ]);

  const ROUTE_MODES = Object.freeze({
    attendance_status:'attendance_status_prepare',
    timetable_admin:'timetable_admin_prepare',
    batch_write:'batch_prepare',
    timetable_memo:'memo_prepare',
    trial_cancel:'trial_cancel_prepare',
    makeup_cancel:'makeup_cancel_prepare',
    absence:'absence_prepare',
    trial_add:'trial_add_prepare',
    trial_update:'trial_update_prepare',
    waitlist_cancel:'waitlist_cancel_prepare',
    waitlist_update:'waitlist_update_prepare',
    waitlist_add:'waitlist_add_prepare',
    pickup_cancel:'pickup_cancel_prepare',
    pickup_update:'pickup_update_prepare',
    pickup_add:'pickup_prepare',
    makeup_update:'makeup_update_prepare',
    makeup_add:'makeup_prepare',
    move_cancel:'move_cancel_prepare',
    move:'move_prepare',
    class_once:'class_once_prepare',
    timetable_read:'timetable_read',
    attendance_read:'attendance_read',
    pickup_read:'pickup_read',
    schedule_read:'schedule_read',
  });

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function compact(value) {
    return clean(value).replace(/\s+/g, '');
  }

  function safeParse(router, parserName, commandText) {
    if (!router || typeof router[parserName] !== 'function') return null;
    try {
      return router[parserName](commandText) || null;
    } catch (_) {
      return null;
    }
  }

  function route(key, parsed, extra) {
    return Object.freeze(Object.assign({
      matched:true,
      key,
      mode:ROUTE_MODES[key] || '',
      intent:clean(parsed && parsed.intent),
      parsed:parsed || null,
    }, extra || {}));
  }

  function isStudentAttendanceReadCandidate(commandText) {
    const value=compact(commandText);
    if (!value) return false;
    return /(?:출결|출석(?:기록|현황|내역)?|결석(?:기록|현황|내역|횟수))/.test(value)
      && /(?:알려|보여|확인|조회|기록|현황|내역|횟수|몇번|몇회|했어|했나|있어|어때)/.test(value);
  }

  function isStudentPickupReadCandidate(commandText) {
    const value=compact(commandText);
    return !!value && (
      /(?:픽업|하원).*(?:일정|시간|어디|몇시|확인|알려|보여|조회)/.test(value)
      || /(?:일정|시간|어디|몇시).*(?:픽업|하원)/.test(value)
    );
  }

  function isStudentScheduleReadCandidate(commandText) {
    const value=compact(commandText);
    return !!value && (
      /시간표/.test(value)
      || /수업.*(?:언제|요일|몇시|시간|스케줄)/.test(value)
      || /(?:언제|요일|몇시|시간|스케줄).*수업/.test(value)
    );
  }

  function classify(commandText, options) {
    const text=clean(commandText);
    const router=options && options.router
      ? options.router
      : global.OlliCommandRouter;
    if (!text || !router) return null;

    let parsed=safeParse(router,'parseAttendanceStatusMutationIntent',text);
    if (clean(parsed && parsed.intent)==='set_attendance_status') {
      return route('attendance_status',parsed);
    }

    for (const parserName of [
      'parseClassLayoutMutationIntent',
      'parseTeacherAssignmentMutationIntent',
      'parseSessionOrderMutationIntent',
      'parseNormalClassDayMutationIntent',
    ]) {
      parsed=safeParse(router,parserName,text);
      if (parsed) return route('timetable_admin',parsed,{parserName});
    }

    parsed=safeParse(router,'parseMultiWriteIntent',text);
    if (clean(parsed && parsed.intent)==='batch_write' && Array.isArray(parsed && parsed.commands)) {
      return route('batch_write',parsed);
    }

    parsed=safeParse(router,'parseTimetableMemoDeleteMutationIntent',text);
    if (clean(parsed && parsed.intent)==='delete_timetable_memo') {
      return route('timetable_memo',parsed);
    }
    parsed=safeParse(router,'parseTimetableMemoAddMutationIntent',text);
    if (clean(parsed && parsed.intent)==='add_timetable_memo') {
      return route('timetable_memo',parsed);
    }

    parsed=safeParse(router,'parseTrialCancelMutationIntent',text);
    if (clean(parsed && parsed.intent)==='cancel_trial') return route('trial_cancel',parsed);

    parsed=safeParse(router,'parseMakeupCancelMutationIntent',text);
    if (clean(parsed && parsed.intent)==='cancel_makeup') return route('makeup_cancel',parsed);

    parsed=safeParse(router,'parseAbsenceMutationIntent',text);
    if (clean(parsed && parsed.intent)==='mark_absent' && clean(parsed && parsed.studentName)) {
      return route('absence',parsed);
    }

    parsed=safeParse(router,'parseTrialMutationIntent',text);
    if (
      clean(parsed && parsed.intent)==='add_trial'
      && ['elementary','kinder'].includes(clean(parsed && parsed.division).toLowerCase())
    ) {
      return route('trial_add',parsed);
    }

    parsed=safeParse(router,'parseTrialUpdateMutationIntent',text);
    if (clean(parsed && parsed.intent)==='update_trial') return route('trial_update',parsed);

    parsed=safeParse(router,'parseWaitlistCancelMutationIntent',text);
    if (clean(parsed && parsed.intent)==='cancel_waitlist') return route('waitlist_cancel',parsed);

    parsed=safeParse(router,'parseWaitlistUpdateMutationIntent',text);
    if (clean(parsed && parsed.intent)==='update_waitlist') return route('waitlist_update',parsed);

    parsed=safeParse(router,'parseWaitlistMutationIntent',text);
    if (clean(parsed && parsed.intent)==='add_waitlist') return route('waitlist_add',parsed);

    parsed=safeParse(router,'parsePickupCancelMutationIntent',text);
    if (clean(parsed && parsed.intent)==='cancel_pickup') return route('pickup_cancel',parsed);

    parsed=safeParse(router,'parsePickupUpdateMutationIntent',text);
    if (clean(parsed && parsed.intent)==='update_pickup') return route('pickup_update',parsed);

    parsed=safeParse(router,'parsePickupMutationIntent',text);
    if (clean(parsed && parsed.intent)==='add_pickup') return route('pickup_add',parsed);

    parsed=safeParse(router,'parseMakeupUpdateMutationIntent',text);
    if (clean(parsed && parsed.intent)==='update_makeup') return route('makeup_update',parsed);

    parsed=safeParse(router,'parseMakeupMutationIntent',text);
    if (clean(parsed && parsed.intent)==='add_makeup') return route('makeup_add',parsed);

    parsed=safeParse(router,'parseMoveCancelMutationIntent',text);
    if (clean(parsed && parsed.intent)==='cancel_move') return route('move_cancel',parsed);

    parsed=safeParse(router,'parseScheduleMoveMutationIntent',text);
    if (clean(parsed && parsed.intent)==='move_class') return route('move',parsed);

    parsed=safeParse(router,'parseClassMutationIntent',text);
    if (clean(parsed && parsed.intent)==='add_class_once') return route('class_once',parsed);

    parsed=safeParse(router,'parseQueryIntent',text);
    if (
      parsed
      && ['find_available_slots','find_roster_entries','find_pickups','multi_read_query']
        .includes(clean(parsed.intent))
    ) {
      return route('timetable_read',parsed);
    }

    if (isStudentAttendanceReadCandidate(text)) {
      return route('attendance_read',null,{intent:'get_attendance'});
    }

    if (isStudentPickupReadCandidate(text)) {
      return route('pickup_read',null,{intent:'get_pickups'});
    }

    if (isStudentScheduleReadCandidate(text)) {
      return route('schedule_read',null,{intent:'get_student_schedule'});
    }

    return null;
  }

  global.OlliTeamTalkAgentRouteClassifier=Object.freeze({
    VERSION,
    ROUTE_KEYS,
    ROUTE_MODES,
    classify,
    isStudentAttendanceReadCandidate,
    isStudentPickupReadCandidate,
    isStudentScheduleReadCandidate,
  });
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports=globalThis.OlliTeamTalkAgentRouteClassifier;
}
