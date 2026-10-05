(function olliTeamTalkAgentRouteClassifierCommon(global) {
  'use strict';

  if (global.OlliTeamTalkAgentRouteClassifier) return;

  const VERSION = '2026-10-05-agent-route-sot-2';

  const ROUTE_KEYS = Object.freeze([
    'attendance_status',
    'attendance_read',
    'pickup_read',
  ]);

  const ROUTE_MODES = Object.freeze({
    attendance_status:'attendance_status_prepare',
    attendance_read:'attendance_read',
    pickup_read:'pickup_read',
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

  function classify(commandText, options) {
    const text=clean(commandText);
    const router=options && options.router
      ? options.router
      : global.OlliCommandRouter;
    if (!text || !router) return null;

    const attendance=safeParse(router,'parseAttendanceStatusMutationIntent',text);
    if (clean(attendance && attendance.intent)==='set_attendance_status') {
      return route('attendance_status',attendance);
    }

    if (isStudentAttendanceReadCandidate(text)) {
      return route('attendance_read',null,{intent:'get_attendance'});
    }

    if (isStudentPickupReadCandidate(text)) {
      return route('pickup_read',null,{intent:'get_pickups'});
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
  });
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports=globalThis.OlliTeamTalkAgentRouteClassifier;
}
