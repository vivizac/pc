(function olliCommandRouterCommon(global) {
  'use strict';

  if (global.OlliCommandRouter) return;

  const VERSION = '2026-09-18-date-range-1';

  function cleanText(value) {
    return String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim();
  }

  function compactText(value) {
    return cleanText(value).replace(/\s+/g, '');
  }

  function normalizeContext(context) {
    const source = String(context && context.source || '').trim();
    return {
      source: source || 'unknown',
      selectedStudent: context && context.selectedStudent ? context.selectedStudent : null,
      autoSubmitContext: context && context.autoSubmitContext ? context.autoSubmitContext : null
    };
  }

  function detectDivision(compact) {
    if (/초등부|초등/.test(compact)) return 'elementary';
    if (/유치부|유치원|유치|유아/.test(compact)) return 'kinder';
    return '';
  }

  function detectPurpose(compact) {
    if (/체험/.test(compact)) return 'trial';
    if (/보강/.test(compact)) return 'makeup';
    if (/수업(?:이동|변경)|옮길|옮기는|옮겨|이동가능|변경가능/.test(compact)) return 'schedule_move';
    if (/신규|신입|새학생|새원생|신규등록/.test(compact)) return 'new_enrollment';
    return 'unknown';
  }

  const WEEKDAY_MAP = Object.freeze({ 월:1, 화:2, 수:3, 목:4, 금:5, 토:6 });

  function addDays(baseDate, amount) {
    const date = baseDate instanceof Date ? new Date(baseDate.getTime()) : new Date(baseDate || Date.now());
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + Number(amount || 0));
    return date;
  }

  function isoWeekdayOf(date) {
    const day = date.getDay();
    return day === 0 ? 7 : day;
  }

  function parseDateExpression(compact) {
    if (/오늘/.test(compact)) return { mode:'today', label:'오늘' };
    if (/내일/.test(compact)) return { mode:'tomorrow', label:'내일' };

    const weekdayMatch = compact.match(/(이번주|이번주간|다음주)?([월화수목금토])요일/);
    if (!weekdayMatch) return null;

    const scope = weekdayMatch[1] || '';
    const weekday = WEEKDAY_MAP[weekdayMatch[2]] || 0;
    if (!weekday) return null;

    const label = scope === '다음주'
      ? '다음 주 ' + weekdayMatch[2] + '요일'
      : (scope ? '이번 주 ' + weekdayMatch[2] + '요일' : weekdayMatch[2] + '요일');

    return {
      mode: scope === '다음주' ? 'next_weekday' : (scope ? 'this_weekday' : 'upcoming_weekday'),
      weekday,
      label
    };
  }

  function resolveDateExpression(spec, baseDate) {
    if (!spec) return null;
    const base = baseDate instanceof Date ? new Date(baseDate.getTime()) : new Date(baseDate || Date.now());
    if (Number.isNaN(base.getTime())) return null;
    base.setHours(12, 0, 0, 0);

    if (spec.mode === 'today') return base;
    if (spec.mode === 'tomorrow') return addDays(base, 1);

    const targetWeekday = Number(spec.weekday || 0);
    if (!targetWeekday) return null;

    const currentWeekday = isoWeekdayOf(base);
    if (spec.mode === 'upcoming_weekday') {
      return addDays(base, (targetWeekday - currentWeekday + 7) % 7);
    }

    const monday = addDays(base, -(currentWeekday - 1));
    if (!monday) return null;
    return addDays(monday, (spec.mode === 'next_weekday' ? 7 : 0) + targetWeekday - 1);
  }

  function parseScheduleMoveMutationIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    if (!raw || !/(?:변경|옮겨|옮길|이동시켜|이동해|바꿔)/.test(compact)) return null;

    const match = raw.match(/^\s*(.*?)\s*([월화수목금토])요일\s*수업(?:을|에서)?\s*([월화수목금토])요일\s*(\d{1,2})시(?:로)?\s*(?:변경|옮겨(?:줘)?|이동(?:시켜|해)?|바꿔(?:줘)?)\s*[.!?]?\s*$/);
    if (!match) return null;

    const studentName = cleanText(match[1]);
    const sourceWeekday = WEEKDAY_MAP[match[2]] || 0;
    const targetWeekday = WEEKDAY_MAP[match[3]] || 0;
    const targetTimeSlot = Number(match[4] || 0);
    if (!studentName || !sourceWeekday || !targetWeekday || !targetTimeSlot) return null;

    return {
      type: 'mutation',
      intent: 'move_class',
      status: 'reserved',
      studentName,
      sourceWeekday,
      targetWeekday,
      targetTimeSlot,
      originalText: raw
    };
  }

  function parseAvailableSlotsIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    if (!raw) return null;
    const dateSpec = parseDateExpression(compact);
    if (!dateSpec) return null;

    const hasAvailabilityMeaning =
      /빈자리/.test(compact)
      || /자리.{0,8}(?:남|있|여유)/.test(compact)
      || /(?:남는|남아있는|여유있는)클래스/.test(compact)
      || /가능한?(?:시간|자리|클래스|수업)/.test(compact)
      || /할수있는(?:시간|자리|클래스|수업)/.test(compact)
      || /들어갈수있는(?:반|시간|자리|클래스|수업)/.test(compact)
      || /받을수있는(?:반|시간|자리|클래스|수업)/.test(compact);

    const asksForLookup =
      /알려/.test(compact)
      || /찾아/.test(compact)
      || /보여/.test(compact)
      || /있어|있나|있나요|있니|있을까|있습니까/.test(compact)
      || /가능해|가능한/.test(compact)
      || /남는|남아/.test(compact)
      || /여유/.test(compact);

    if (!hasAvailabilityMeaning || !asksForLookup) return null;

    return {
      type: 'query',
      intent: 'find_available_slots',
      date: dateSpec.mode,
      dateSpec,
      dateLabel: dateSpec.label,
      division: detectDivision(compact),
      purpose: detectPurpose(compact),
      originalText: raw
    };
  }

  function passThrough(text) {
    return {
      handled: false,
      kind: 'feedback',
      intent: '',
      text: cleanText(text),
      message: '',
      clearInput: false,
      payload: null
    };
  }

  async function route(text, context) {
    const normalizedText = cleanText(text);
    normalizeContext(context);

    const scheduleMove = parseScheduleMoveMutationIntent(normalizedText);
    if (scheduleMove) {
      return {
        handled: true,
        kind: 'command_reserved',
        intent: scheduleMove.intent,
        text: normalizedText,
        message: '수업 이동 명령으로 이해했어요. 실제 시간표 변경은 쓰기 명령 단계에서 연결할게요.',
        clearInput: true,
        payload: scheduleMove
      };
    }

    const availableSlots = parseAvailableSlotsIntent(normalizedText);
    if (!availableSlots) return passThrough(normalizedText);

    const schedule = global.OlliCommandSchedule;
    if (!schedule || typeof schedule.findAvailableSlots !== 'function') {
      return {
        handled: true,
        kind: 'command_result',
        intent: availableSlots.intent,
        text: normalizedText,
        message: '시간표 조회 기능을 아직 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
        clearInput: true,
        payload: availableSlots
      };
    }

    try {
      const targetDate = resolveDateExpression(availableSlots.dateSpec, new Date());
      if (!targetDate) throw new Error('조회 날짜를 해석하지 못했습니다.');
      const result = await schedule.findAvailableSlots({
        date: targetDate,
        dateLabel: availableSlots.dateLabel,
        division: availableSlots.division,
        purpose: availableSlots.purpose
      });
      const message = typeof schedule.describeAvailableSlots === 'function'
        ? schedule.describeAvailableSlots(result)
        : '시간표 빈자리를 확인했어요.';
      return {
        handled: true,
        kind: 'command_result',
        intent: availableSlots.intent,
        text: normalizedText,
        message,
        clearInput: true,
        payload: Object.assign({}, availableSlots, { result })
      };
    } catch (error) {
      console.warn('올리 빈자리 조회 실패:', error);
      return {
        handled: true,
        kind: 'command_result',
        intent: availableSlots.intent,
        text: normalizedText,
        message: '시간표 빈자리를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
        clearInput: true,
        payload: availableSlots
      };
    }
  }

  global.OlliCommandRouter = Object.freeze({
    VERSION,
    route,
    parseAvailableSlotsIntent,
    parseScheduleMoveMutationIntent,
    parseDateExpression,
    resolveDateExpression
  });
})(window);
