(function olliCommandRouterCommon(global) {
  'use strict';

  if (global.OlliCommandRouter) return;

  const VERSION = '2026-09-18-write-commands-2';
  let pendingWriteCommand = null;

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

  function removeDivisionWords(value) {
    return cleanText(value)
      .replace(/(?:초등부|초등|유치부|유치원|유치|유아)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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

    const match = raw.match(/^\s*(.*?)\s*([월화수목금토])요일(?:\s*(\d{1,2})시)?\s*수업(?:을|에서)?\s*([월화수목금토])요일\s*(\d{1,2})시(?:\s*([AaBb])반)?(?:로)?\s*(?:변경|옮겨(?:줘)?|이동(?:시켜|해)?|바꿔(?:줘)?)\s*[.!?]?\s*$/);
    if (!match) return null;

    const studentName = cleanText(match[1]);
    const sourceWeekday = WEEKDAY_MAP[match[2]] || 0;
    const sourceTimeSlot = Number(match[3] || 0);
    const targetWeekday = WEEKDAY_MAP[match[4]] || 0;
    const targetTimeSlot = Number(match[5] || 0);
    const classGroup = cleanText(match[6]).toUpperCase();
    if (!sourceWeekday || !targetWeekday || !targetTimeSlot) return null;

    return {
      type: 'mutation',
      intent: 'move_class',
      studentName,
      sourceWeekday,
      sourceTimeSlot,
      targetWeekday,
      targetTimeSlot,
      classGroup,
      originalText: raw
    };
  }

  function parseMakeupMutationIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    if (!raw || !/보강/.test(compact) || !/(?:넣어|등록|잡아|추가)/.test(compact)) return null;

    const match = raw.match(/^\s*(.*?)\s*(오늘|내일|(?:(?:이번\s*주|다음\s*주)\s*)?[월화수목금토]요일)\s*(\d{1,2})시(?:에)?(?:\s*([AaBb])반)?\s*보강(?:으로)?\s*(?:넣어(?:줘)?|등록(?:해줘|해|해줘요)?|잡아(?:줘)?|추가(?:해줘|해)?)\s*[.!?]?\s*$/);
    if (!match) return null;

    const studentName = cleanText(match[1]);
    const dateSpec = parseDateExpression(compactText(match[2]));
    const timeSlot = Number(match[3] || 0);
    const classGroup = cleanText(match[4]).toUpperCase();
    if (!dateSpec || !timeSlot) return null;

    return {
      type:'mutation',
      intent:'add_makeup',
      studentName,
      dateSpec,
      dateLabel:dateSpec.label,
      timeSlot,
      classGroup,
      originalText:raw
    };
  }

  function parseWaitlistMutationIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    if (!raw || !/대기/.test(compact) || /취소/.test(compact) || !/(?:넣어|등록|추가|잡아)/.test(compact)) return null;

    const division = detectDivision(compact);
    const normalized = removeDivisionWords(raw);
    const match = normalized.match(/^\s*(.*?)\s*(오늘|내일|(?:(?:이번\s*주|다음\s*주)\s*)?[월화수목금토]요일)\s*(\d{1,2})시(?:에)?(?:\s*([AaBb])반)?\s*(?:대기(?:에|로)?|대기자(?:로)?)\s*(?:넣어(?:줘)?|등록(?:해줘|해|해줘요)?|추가(?:해줘|해)?|잡아(?:줘)?)\s*[.!?]?\s*$/);
    if (!match) return null;

    const studentName = cleanText(match[1]);
    const dateSpec = parseDateExpression(compactText(match[2]));
    const timeSlot = Number(match[3] || 0);
    const classGroup = cleanText(match[4]).toUpperCase();
    if (!dateSpec || !timeSlot) return null;

    return {
      type:'mutation',
      intent:'add_waitlist',
      studentName,
      division,
      dateSpec,
      dateLabel:dateSpec.label,
      timeSlot,
      classGroup,
      originalText:raw
    };
  }

  function parseTrialMutationIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    if (!raw || !/체험/.test(compact) || /취소/.test(compact) || !/(?:넣어|등록|추가|잡아)/.test(compact)) return null;

    const division = detectDivision(compact);
    const normalized = removeDivisionWords(raw);
    const match = normalized.match(/^\s*(.*?)\s*(오늘|내일|(?:(?:이번\s*주|다음\s*주)\s*)?[월화수목금토]요일)\s*(\d{1,2})시(?:에)?(?:\s*([AaBb])반)?\s*체험(?:수업)?(?:으로)?\s*(?:넣어(?:줘)?|등록(?:해줘|해|해줘요)?|추가(?:해줘|해)?|잡아(?:줘)?)\s*[.!?]?\s*$/);
    if (!match) return null;

    const guestName = cleanText(match[1]);
    const dateSpec = parseDateExpression(compactText(match[2]));
    const timeSlot = Number(match[3] || 0);
    const classGroup = cleanText(match[4]).toUpperCase();
    if (!guestName || !dateSpec || !timeSlot) return null;

    return {
      type:'mutation',
      intent:'add_trial',
      guestName,
      division,
      dateSpec,
      dateLabel:dateSpec.label,
      timeSlot,
      classGroup,
      originalText:raw
    };
  }

  function parseMakeupCancelMutationIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    if (!raw || !/보강/.test(compact) || !/취소/.test(compact)) return null;

    const match = raw.match(/^\s*(.*?)\s*(?:(오늘|내일|(?:(?:이번\s*주|다음\s*주)\s*)?[월화수목금토]요일)\s*)?(?:(\d{1,2})시(?:에)?\s*)?(?:([AaBb])반\s*)?보강(?:수업)?(?:을)?\s*취소(?:해줘|해|해줘요|할래|해줄래)?\s*[.!?]?\s*$/);
    if (!match) return null;

    const dateSpec = match[2] ? parseDateExpression(compactText(match[2])) : null;
    return {
      type:'mutation',
      intent:'cancel_makeup',
      studentName:cleanText(match[1]),
      dateSpec,
      dateLabel:dateSpec ? dateSpec.label : '',
      timeSlot:Number(match[3] || 0),
      classGroup:cleanText(match[4]).toUpperCase(),
      originalText:raw
    };
  }

  function parseMoveCancelMutationIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    if (!raw || !/(?:수업|시간표)?(?:이동|변경)/.test(compact) || !/취소/.test(compact)) return null;

    let match = raw.match(/^\s*(.*?)\s*([월화수목금토])요일(?:\s*(\d{1,2})시)?\s*(?:수업|시간표)?\s*(?:이동|변경)(?:\s*예약)?(?:을)?\s*취소(?:해줘|해|해줘요|할래|해줄래)?\s*[.!?]?\s*$/);
    if (match) {
      return {
        type:'mutation',
        intent:'cancel_move',
        studentName:cleanText(match[1]),
        sourceWeekday:WEEKDAY_MAP[match[2]] || 0,
        sourceTimeSlot:Number(match[3] || 0),
        originalText:raw
      };
    }

    match = raw.match(/^\s*(.*?)\s*(?:수업|시간표)?\s*(?:이동|변경)(?:\s*예약)?(?:을)?\s*취소(?:해줘|해|해줘요|할래|해줄래)?\s*[.!?]?\s*$/);
    if (!match) return null;
    return {
      type:'mutation',
      intent:'cancel_move',
      studentName:cleanText(match[1]),
      sourceWeekday:0,
      sourceTimeSlot:0,
      originalText:raw
    };
  }

  function isConfirmCommand(text) {
    return /^(확인|진행|등록|변경|실행|해줘|진행해줘)$/i.test(compactText(text));
  }

  function isCancelCommand(text) {
    return /^(취소|취소해|취소해줘|아니|아니야)$/i.test(compactText(text));
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
    const routeContext = normalizeContext(context);
    const schedule = global.OlliCommandSchedule;

    if (isCancelCommand(normalizedText)) {
      if (!pendingWriteCommand) {
        return {
          handled:true,
          kind:'command_result',
          intent:'cancel',
          text:normalizedText,
          message:'취소할 시간표 작업이 없어요.',
          clearInput:true,
          payload:null
        };
      }
      const cancelled = pendingWriteCommand;
      pendingWriteCommand = null;
      return {
        handled:true,
        kind:'command_result',
        intent:'cancel',
        text:normalizedText,
        message:'시간표 작업을 취소했어요.',
        clearInput:true,
        payload:cancelled
      };
    }

    if (isConfirmCommand(normalizedText)) {
      if (!pendingWriteCommand) {
        return {
          handled:true,
          kind:'command_result',
          intent:'confirm',
          text:normalizedText,
          message:'확인할 시간표 작업이 없어요.',
          clearInput:true,
          payload:null
        };
      }
      if (!schedule || typeof schedule.executePreparedWrite !== 'function') {
        pendingWriteCommand = null;
        return {
          handled:true,
          kind:'command_result',
          intent:'confirm',
          text:normalizedText,
          message:'시간표 저장 기능을 아직 불러오지 못했어요. 다시 명령해 주세요.',
          clearInput:true,
          payload:null
        };
      }

      const command = pendingWriteCommand;
      pendingWriteCommand = null;
      try {
        const result = await schedule.executePreparedWrite(command);
        const message = typeof schedule.writeSuccessMessage === 'function'
          ? schedule.writeSuccessMessage(command, result)
          : '시간표 작업을 완료했어요.';
        return {
          handled:true,
          kind:'command_result',
          intent:command.intent,
          text:normalizedText,
          message,
          clearInput:true,
          payload:{ command, result }
        };
      } catch (error) {
        console.warn('올리 쓰기 명령 실행 실패:', error);
        return {
          handled:true,
          kind:'command_result',
          intent:command.intent,
          text:normalizedText,
          message:String(error && (error.message || error) || '시간표 작업을 저장하지 못했어요.'),
          clearInput:true,
          payload:{ command, error:true }
        };
      }
    }

    if (pendingWriteCommand) pendingWriteCommand = null;

    const makeupCancel = parseMakeupCancelMutationIntent(normalizedText);
    const moveCancel = parseMoveCancelMutationIntent(normalizedText);
    const waitlistWrite = parseWaitlistMutationIntent(normalizedText);
    const trialWrite = parseTrialMutationIntent(normalizedText);
    const scheduleMove = parseScheduleMoveMutationIntent(normalizedText);
    const makeupWrite = parseMakeupMutationIntent(normalizedText);
    const writeIntent = makeupCancel || moveCancel || waitlistWrite || trialWrite || scheduleMove || makeupWrite;
    if (writeIntent) {
      if (!schedule || typeof schedule.prepareWriteCommand !== 'function') {
        return {
          handled:true,
          kind:'command_result',
          intent:writeIntent.intent,
          text:normalizedText,
          message:'시간표 쓰기 기능을 아직 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
          clearInput:true,
          payload:writeIntent
        };
      }

      try {
        const options = Object.assign({}, writeIntent, {
          selectedStudent:routeContext.selectedStudent || null,
          effectiveDate:new Date()
        });
        if (writeIntent.dateSpec) {
          options.date = resolveDateExpression(writeIntent.dateSpec, new Date());
          if (!options.date) throw new Error('날짜를 해석하지 못했습니다.');
        }
        const prepared = await schedule.prepareWriteCommand(writeIntent.intent, options);
        if (!prepared || prepared.ok !== true) {
          return {
            handled:true,
            kind:'command_result',
            intent:writeIntent.intent,
            text:normalizedText,
            message:String(prepared && prepared.message || '시간표 작업을 준비하지 못했어요.'),
            clearInput:true,
            payload:writeIntent
          };
        }

        pendingWriteCommand = prepared.command;
        return {
          handled:true,
          kind:'command_confirmation',
          intent:writeIntent.intent,
          text:normalizedText,
          message:String(prepared.message || '이 작업을 진행할까요?'),
          clearInput:true,
          payload:prepared.command
        };
      } catch (error) {
        console.warn('올리 쓰기 명령 준비 실패:', error);
        return {
          handled:true,
          kind:'command_result',
          intent:writeIntent.intent,
          text:normalizedText,
          message:String(error && (error.message || error) || '시간표 작업을 준비하지 못했어요.'),
          clearInput:true,
          payload:writeIntent
        };
      }
    }

    const availableSlots = parseAvailableSlotsIntent(normalizedText);
    if (!availableSlots) return passThrough(normalizedText);

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
    parseMakeupMutationIntent,
    parseWaitlistMutationIntent,
    parseTrialMutationIntent,
    parseMakeupCancelMutationIntent,
    parseMoveCancelMutationIntent,
    parseDateExpression,
    resolveDateExpression,
    getPendingWriteCommand() { return pendingWriteCommand ? Object.assign({}, pendingWriteCommand) : null; }
  });
})(window);
