(function olliCommandRouterCommon(global) {
  'use strict';

  if (global.OlliCommandRouter) return;

  const VERSION = '2026-09-18-write-commands-4';
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
    if (/(?:체험|체험수업|체험클래스)/.test(compact)) return 'trial';
    if (/(?:보강|보충수업|보충)/.test(compact)) return 'makeup';
    if (/(?:수업|시간표)?(?:이동|변경)|옮길|옮기는|옮겨|바꿀|바꾸는|이동가능|변경가능/.test(compact)) return 'schedule_move';
    if (/신규|신입|새학생|새원생|신규등록|처음등록/.test(compact)) return 'new_enrollment';
    return 'unknown';
  }

  function removeDivisionWords(value) {
    return cleanText(value)
      .replace(/(?:초등부|초등|유치부|유치원|유치|유아)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function hasMakeupWord(value) {
    return /(?:보강|보충(?:수업)?)/.test(compactText(value));
  }

  function hasWaitlistWord(value) {
    return /(?:대기(?:자|명단|리스트)?|웨이팅(?:리스트)?)/.test(compactText(value));
  }

  function hasTrialWord(value) {
    return /(?:체험클래스|체험수업|체험)/.test(compactText(value));
  }

  function hasAddAction(value) {
    return /(?:넣|등록|추가|잡|예약|배정|신청|걸어)/.test(compactText(value));
  }

  function hasRemoveAction(value) {
    return /(?:취소|삭제|지워|지우|제거|빼|해제|없애)/.test(compactText(value));
  }

  function hasMoveAction(value) {
    return /(?:변경|옮|이동|바꿔|바꾸)/.test(compactText(value));
  }

  function firstTimeSlot(value) {
    const match = cleanText(value).match(/(\d{1,2})\s*시/);
    return Number(match && match[1] || 0);
  }

  function firstClassGroup(value) {
    const match = cleanText(value).match(/([AaBb])\s*반/i);
    return cleanText(match && match[1]).toUpperCase();
  }

  function weekdayTimeMentions(value) {
    return Array.from(cleanText(value).matchAll(/([월화수목금토])요일(?:\s*(\d{1,2})\s*시)?/g)).map(match => ({
      weekday:WEEKDAY_MAP[match[1]] || 0,
      timeSlot:Number(match[2] || 0)
    }));
  }

  function stripCommonCommandParts(value) {
    return removeDivisionWords(value)
      .replace(/[.!?,]/g, ' ')
      .replace(/(?:오늘|금일|내일|(?:(?:이번\s*주|금주|다음\s*주|차주)\s*)?[월화수목금토]요일)/g, ' ')
      .replace(/\d{1,2}\s*시(?:에서|으로|에|로)?/g, ' ')
      .replace(/[AaBb]\s*반/g, ' ')
      .replace(/(?:타임|시간대)/g, ' ')
      .replace(/(?:잡혀\s*있는|잡혀있는|잡혀\s*있던|등록되어\s*있는|등록되어있는|등록된|예약되어\s*있는|예약되어있는|예약된|예정된)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cleanupStudentName(value) {
    return cleanText(value)
      .replace(/^(?:학생|원생)\s*/, '')
      .replace(/\s*(?:학생|원생)$/, '')
      .replace(/(?:의|꺼|것)$/, '')
      .replace(/^(?:의|꺼|것)\s*/, '')
      .replace(/(?:^|\s)(?:에서|으로|로|을|를|에|에게|한테|좀|한번)(?=\s|$)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractStudentName(value, domainPattern, actionPattern) {
    let stripped = stripCommonCommandParts(value);
    if (domainPattern) stripped = stripped.replace(domainPattern, ' ');
    if (actionPattern) stripped = stripped.replace(actionPattern, ' ');
    return cleanupStudentName(stripped);
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
    if (/(?:오늘|금일)/.test(compact)) return { mode:'today', label:'오늘' };
    if (/내일/.test(compact)) return { mode:'tomorrow', label:'내일' };

    const weekdayMatch = compact.match(/(이번주|이번주간|금주|다음주|차주)?([월화수목금토])요일/);
    if (!weekdayMatch) return null;

    const scope = weekdayMatch[1] || '';
    const weekday = WEEKDAY_MAP[weekdayMatch[2]] || 0;
    if (!weekday) return null;

    const nextScope = scope === '다음주' || scope === '차주';
    const thisScope = scope === '이번주' || scope === '이번주간' || scope === '금주';
    const label = nextScope
      ? '다음 주 ' + weekdayMatch[2] + '요일'
      : (thisScope ? '이번 주 ' + weekdayMatch[2] + '요일' : weekdayMatch[2] + '요일');

    return {
      mode: nextScope ? 'next_weekday' : (thisScope ? 'this_weekday' : 'upcoming_weekday'),
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
    if (!raw || !hasMoveAction(compact) || hasRemoveAction(compact)) return null;

    const mentions = weekdayTimeMentions(raw);
    if (mentions.length < 2) return null;

    const source = mentions[0];
    const target = mentions[1];
    if (!source.weekday || !target.weekday || !target.timeSlot) return null;

    const studentName = extractStudentName(
      raw,
      /(?:정규\s*)?수업(?:시간)?|시간표/g,
      /(?:변경|옮겨(?:줘|주세요|줄래)?|옮기(?:고|기|자)?|이동(?:시켜|해|해줘|해주세요|할래)?|바꿔(?:줘|주세요)?|바꾸(?:어|고|자|기)?)(?:줘|주세요|해줘|해주세요)?/g
    );
    if (!studentName) return null;

    return {
      type:'mutation',
      intent:'move_class',
      studentName,
      sourceWeekday:source.weekday,
      sourceTimeSlot:source.timeSlot,
      targetWeekday:target.weekday,
      targetTimeSlot:target.timeSlot,
      classGroup:firstClassGroup(raw),
      originalText:raw
    };
  }

  function parseMakeupMutationIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    if (!raw || !hasMakeupWord(compact) || hasRemoveAction(compact) || !hasAddAction(compact)) return null;

    const dateSpec = parseDateExpression(compact);
    const timeSlot = firstTimeSlot(raw);
    const studentName = extractStudentName(
      raw,
      /(?:보강|보충(?:수업)?)(?:수업)?(?:으로|에|을|를)?/g,
      /(?:넣어?|등록|추가|잡아?|예약|배정|신청)(?:해줘요|해주세요|해줘|해줄래|할래|해|줘|주세요)?/g
    );
    if (!studentName || !dateSpec || !timeSlot) return null;

    return {
      type:'mutation',
      intent:'add_makeup',
      studentName,
      dateSpec,
      dateLabel:dateSpec.label,
      timeSlot,
      classGroup:firstClassGroup(raw),
      originalText:raw
    };
  }

  function parseWaitlistMutationIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    if (!raw || !hasWaitlistWord(compact) || hasRemoveAction(compact) || !hasAddAction(compact)) return null;

    const dateSpec = parseDateExpression(compact);
    const timeSlot = firstTimeSlot(raw);
    const studentName = extractStudentName(
      raw,
      /(?:대기(?:자|명단|리스트)?|웨이팅(?:리스트)?)(?:에|로|을|를)?/g,
      /(?:넣어?|등록|추가|잡아?|예약|배정|신청|걸어)(?:해줘요|해주세요|해줘|해줄래|할래|해|줘|주세요)?/g
    );
    if (!studentName || !dateSpec || !timeSlot) return null;

    return {
      type:'mutation',
      intent:'add_waitlist',
      studentName,
      division:detectDivision(compact),
      dateSpec,
      dateLabel:dateSpec.label,
      timeSlot,
      classGroup:firstClassGroup(raw),
      originalText:raw
    };
  }

  function parseTrialMutationIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    if (!raw || !hasTrialWord(compact) || hasRemoveAction(compact) || !hasAddAction(compact)) return null;

    const dateSpec = parseDateExpression(compact);
    const timeSlot = firstTimeSlot(raw);
    const guestName = extractStudentName(
      raw,
      /(?:체험\s*클래스|체험\s*수업|체험)(?:으로|에|을|를)?/g,
      /(?:넣어?|등록|추가|잡아?|예약|배정|신청)(?:해줘요|해주세요|해줘|해줄래|할래|해|줘|주세요)?/g
    );
    if (!guestName || !dateSpec || !timeSlot) return null;

    return {
      type:'mutation',
      intent:'add_trial',
      guestName,
      division:detectDivision(compact),
      dateSpec,
      dateLabel:dateSpec.label,
      timeSlot,
      classGroup:firstClassGroup(raw),
      originalText:raw
    };
  }

  function parseMakeupCancelMutationIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    if (!raw || !hasMakeupWord(compact) || !hasRemoveAction(compact)) return null;

    const dateSpec = parseDateExpression(compact);
    const studentName = extractStudentName(
      raw,
      /(?:보강|보충(?:수업)?)(?:수업)?(?:을|를)?/g,
      /(?:취소|삭제|지워|지우|제거|빼|해제|없애)(?:해줘요|해주세요|해줘|해줄래|할래|해|줘|주세요)?/g
    );
    if (!studentName) return null;

    return {
      type:'mutation',
      intent:'cancel_makeup',
      studentName,
      dateSpec,
      dateLabel:dateSpec ? dateSpec.label : '',
      timeSlot:firstTimeSlot(raw),
      classGroup:firstClassGroup(raw),
      originalText:raw
    };
  }

  function parseMoveCancelMutationIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    if (!raw || !hasMoveAction(compact) || !hasRemoveAction(compact)) return null;

    const mentions = weekdayTimeMentions(raw);
    const source = mentions[0] || { weekday:0, timeSlot:0 };
    const studentName = extractStudentName(
      raw,
      /(?:정규\s*)?수업(?:시간)?|시간표|(?:이동|변경)(?:\s*예약)?/g,
      /(?:취소|삭제|지워|지우|제거|빼|해제|없애)(?:해줘요|해주세요|해줘|해줄래|할래|해|줘|주세요)?/g
    );
    if (!studentName) return null;

    return {
      type:'mutation',
      intent:'cancel_move',
      studentName,
      sourceWeekday:source.weekday,
      sourceTimeSlot:source.timeSlot,
      originalText:raw
    };
  }

  function isConfirmCommand(text) {
    return /^(확인|확인해|확인해줘|진행|진행해|진행해줘|실행|실행해|실행해줘)$/i.test(compactText(text));
  }

  function isCancelCommand(text) {
    return /^(취소|취소해|취소해줘|취소할게|중단|중단해|안할래|하지마|아니|아니야)$/i.test(compactText(text));
  }

  function parseAvailableSlotsIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    if (!raw) return null;
    const dateSpec = parseDateExpression(compact);
    if (!dateSpec) return null;

    const hasAvailabilityMeaning =
      /빈자리|빈곳|여석/.test(compact)
      || /자리.{0,10}(?:남|있|여유|가능|몇)/.test(compact)
      || /(?:남는|남아있는|여유있는|비어있는)클래스/.test(compact)
      || /(?:여유|비어)(?:있는)?(?:시간|자리|클래스|수업|반)/.test(compact)
      || /가능(?:한)?(?:시간|자리|클래스|수업|반)/.test(compact)
      || /할수있는(?:시간|자리|클래스|수업|반)/.test(compact)
      || /들어갈수있는(?:반|시간|자리|클래스|수업)/.test(compact)
      || /받을수있는(?:반|시간|자리|클래스|수업)/.test(compact)
      || /몇자리/.test(compact);

    const asksForLookup =
      /알려|찾아|보여|확인|체크|봐줘|봐|조회/.test(compact)
      || /있어|있나|있나요|있니|있을까|있습니까/.test(compact)
      || /가능해|가능한|가능할까/.test(compact)
      || /남는|남아|남았/.test(compact)
      || /여유|비어|몇자리|몇명/.test(compact);

    if (!hasAvailabilityMeaning || !asksForLookup) return null;

    return {
      type:'query',
      intent:'find_available_slots',
      date:dateSpec.mode,
      dateSpec,
      dateLabel:dateSpec.label,
      division:detectDivision(compact),
      purpose:detectPurpose(compact),
      originalText:raw
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
