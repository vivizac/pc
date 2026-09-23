(function olliCommandRouterCommon(global) {
  'use strict';

  if (global.OlliCommandRouter) return;

  const VERSION = '2026-09-23-write-actions-2';
  let pendingWriteCommand = null;
  let pendingReasonCommand = null;

  function cleanText(value) {
    return String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim();
  }

  function compactText(value) {
    return cleanText(value).replace(/\s+/g, '');
  }

  function parseStudentInfoLookupIntent(value) {
    const raw = cleanText(value);
    if (!raw) return null;

    const match = raw.match(/^([가-힣A-Za-z0-9·ㆍ]{1,30})\s*학생\s*정보(?:\s*(?:열어줘|열어|보여줘|보여|확인해줘|확인|조회해줘|조회))?\s*[?!.。！？]*$/i);
    if (!match) return null;

    const studentName = cleanText(match[1]);
    if (!studentName) return null;
    return {
      type:'ui_query',
      intent:'open_student_info',
      studentName,
      originalText:raw
    };
  }


  function olliReplyTemporalSignals(value) {
    const compact = compactText(value);
    const hasWeekday = /[월화수목금토]요일/.test(compact);
    const hasTime = /(?:오전|오후)?\d{1,2}시(?:\d{1,2}분)?/.test(compact);
    const hasExplicitDate =
      /(?:오늘|금일|내일)/.test(compact)
      || /\d{1,2}월\d{1,2}일/.test(compact)
      || /(?:^|[^\d월])\d{1,2}일(?!요일)/.test(compact);
    const hasScopedWeekDate = hasWeekday && /(?:이번주|이번주간|금주|다음주|차주|다다음주)/.test(compact);
    return {
      date:hasExplicitDate || hasScopedWeekDate,
      weekday:hasWeekday,
      time:hasTime
    };
  }

  function isOlliReplyScheduleInquiry(value) {
    const raw = cleanText(value);
    const compact = compactText(raw);
    if (!raw) return false;

    const hasScheduleTarget =
      /(?:자리|빈자리|여석|대기(?:자|명단|리스트)?|웨이팅(?:리스트)?|체험(?:수업|클래스)?|보강|보충(?:수업)?|(?:등원|하원)?픽업)/.test(compact);
    if (!hasScheduleTarget) return false;

    const asksForLookup =
      /[?？]/.test(raw)
      || /(?:있어|있나|있나요|있니|있을까|있습니까|가능|몇(?:자리|명)?|남는|남아|남았|비어|여유|어때|되나|되니|되나요|돼|될까|할수|받을수|확인|알려|보여|봐)/.test(compact);
    if (!asksForLookup) return false;

    const explicitWriteCommand =
      /(?:등록|추가|넣|예약|신청|배정|저장|취소|삭제|지워|지우|제거|빼|해제|없애|옮겨|변경|이동|바꿔|바꾸)(?:해줘|해주세요|해줄래|할래|줘|주세요|하자|해요|해)[.!。]?$/i.test(compact);
    return !explicitWriteCommand;
  }

  function isOlliReplyCandidate(value) {
    if (parseMultiQueryIntent(value) || parseRosterQueryIntent(value)) return true;
    const signals = olliReplyTemporalSignals(value);
    const temporalCount = [signals.date, signals.weekday, signals.time].filter(Boolean).length;
    if (temporalCount >= 2) return true;
    return temporalCount >= 1 && isOlliReplyScheduleInquiry(value);
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

  function hasAbsenceWord(value) {
    return /(?:결석)/.test(compactText(value));
  }

  function normalizeReasonReply(value) {
    return cleanText(value)
      .replace(/^(?:사유|이유)\s*(?:는|은)?\s*[:：-]?\s*/i, '')
      .replace(/[.!?]+$/g, '')
      .trim();
  }

  function extractExplicitReason(value) {
    const raw = cleanText(value);
    if (!raw) return { commandText:'', reason:'' };

    const explicit = raw.match(/(?:사유|이유)\s*(?:는|은)?\s*[:：-]?\s*(.+)$/i);
    if (explicit && cleanText(explicit[1])) {
      return {
        commandText:cleanText(raw.slice(0, explicit.index)),
        reason:normalizeReasonReply(explicit[1])
      };
    }

    const separated = raw.match(/(?:결석(?:\s*처리)?|(?:보강|보충(?:수업)?)\s*(?:취소|삭제)|(?:체험(?:\s*수업|\s*클래스)?)\s*(?:취소|삭제))\s*[,：:-]\s*(.+)$/i);
    if (separated && cleanText(separated[1])) {
      const reasonStart = raw.lastIndexOf(separated[1]);
      return {
        commandText:cleanText(raw.slice(0, reasonStart).replace(/[,：:-]\s*$/, '')),
        reason:normalizeReasonReply(separated[1])
      };
    }

    return { commandText:raw, reason:'' };
  }

  function hasAddAction(value) {
    return /(?:추가|넣|입력|기입|기재|등록|잡|예약|신청|배정|올려|만들|생성|기록|적|반영|저장|걸어)/.test(compactText(value));
  }

  function addActionPattern() {
    return /(?:(?:추가|입력|기입|기재|등록|예약|신청|배정|생성|기록|반영|저장)(?:\s*(?:좀|한번))?\s*(?:해)?(?:놔|놓아|둬|두어|둘래|둘)?(?:줘요|주세요|줘|줄래|해줘요|해주세요|해줘|해줄래|할래|해|요)?|(?:넣|잡|적|만들)(?:어|아)?(?:\s*(?:좀|한번))?\s*(?:놔|놓아|둬|두어|둘래|둘)?(?:줘요|주세요|줘|줄래|해줘요|해주세요|해줘|해줄래|할래|해|요)?|(?:올려|걸어)(?:\s*(?:좀|한번))?\s*(?:놔|놓아|둬|두어|둘래|둘)?(?:줘요|주세요|줘|줄래|해줘요|해주세요|해줘|해줄래|할래|해|요)?)/g;
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

  function pickupClockMentions(value) {
    const raw = cleanText(value);
    const pattern = /(오전|오후)?\s*(\d{1,2})\s*(?::\s*(\d{1,2})|시(?:\s*(\d{1,2})\s*분)?)/g;
    return Array.from(raw.matchAll(pattern)).map(match => ({
      period:cleanText(match[1]),
      hour:Number(match[2] || 0),
      minute:Number(match[3] || match[4] || 0),
      index:Number(match.index || 0),
      end:Number(match.index || 0) + String(match[0] || '').length,
      text:String(match[0] || '')
    }));
  }

  function normalizePickupClock(mention) {
    if (!mention) return '';
    let hour = Number(mention.hour || 0);
    const minute = Number(mention.minute || 0);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';

    const period = cleanText(mention.period);
    if (period === '오후' && hour < 12) hour += 12;
    else if (period === '오전' && hour === 12) hour = 0;
    else if (!period && hour >= 1 && hour <= 7) hour += 12;

    return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
  }

  function pickupStudentName(value) {
    const raw = removeDivisionWords(value);
    const match = raw.match(/^([가-힣A-Za-z0-9]{2,20})(?:\s*(?:학생|원생))?(?=\s|$)/);
    const name = cleanText(match && match[1]);
    if (!name) return '';
    if (/^(?:하원|픽업|등록|추가|입력|예약|저장|월요일|화요일|수요일|목요일|금요일|토요일|오늘|내일|금일)$/.test(name)) return '';
    return cleanupStudentName(name);
  }

  function pickupLabelFromText(value, studentName) {
    let stripped = removeDivisionWords(value);
    const name = cleanText(studentName);
    if (name && stripped.indexOf(name) === 0) stripped = stripped.slice(name.length);

    stripped = stripped
      .replace(/(?:오늘|금일|내일|매주|이번\s*주|다음\s*주|차주|다다음\s*주)?\s*[월화수목금토]\s*요일/g, ' ')
      .replace(/(오전|오후)?\s*\d{1,2}\s*(?::\s*\d{1,2}|시(?:\s*\d{1,2}\s*분)?)/g, ' ')
      .replace(/(?:하원\s*)?픽업(?:\s*(?:시간|장소))?/g, ' ')
      .replace(/(?:하원|수업|클래스|학생|원생|장소|시간)/g, ' ')
      .replace(addActionPattern(), ' ')
      .replace(/[,:;.!?()\-–—\/]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    stripped = stripped
      .replace(/^(?:에서|으로|로|에)\s*/g, '')
      .replace(/\s*(?:에서|으로|로|에)$/g, '')
      .trim();
    return stripped;
  }

  function stripCommonCommandParts(value) {
    return removeDivisionWords(value)
      .replace(/[.!?,]/g, ' ')
      .replace(/(?:오늘|금일|내일|(?:(?:이번\s*주|금주|다다음\s*주|다음\s*주|차주)\s*)?[월화수목금토]요일)/g, ' ')
      .replace(/\d{1,2}\s*월\s*\d{1,2}\s*일/g, ' ')
      .replace(/(?:^|\s)\d{1,2}\s*일(?=\s|$)/g, ' ')
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

    const monthDay = compact.match(/(\d{1,2})월(\d{1,2})일/);
    if (monthDay) {
      return {
        mode:'month_day',
        month:Number(monthDay[1]),
        day:Number(monthDay[2]),
        label:Number(monthDay[1]) + '월 ' + Number(monthDay[2]) + '일'
      };
    }

    const dayOnly = compact.match(/(?:^|[^\d월])(\d{1,2})일(?!요일)/);
    if (dayOnly) {
      return {
        mode:'day_of_month',
        day:Number(dayOnly[1]),
        label:Number(dayOnly[1]) + '일'
      };
    }

    const weekdayMatch = compact.match(/(다다음주|이번주|이번주간|금주|다음주|차주)?([월화수목금토])요일/);
    if (!weekdayMatch) return null;

    const scope = weekdayMatch[1] || '';
    const weekday = WEEKDAY_MAP[weekdayMatch[2]] || 0;
    if (!weekday) return null;

    const afterNextScope = scope === '다다음주';
    const nextScope = scope === '다음주' || scope === '차주';
    const thisScope = scope === '이번주' || scope === '이번주간' || scope === '금주';
    const label = afterNextScope
      ? '다다음 주 ' + weekdayMatch[2] + '요일'
      : (nextScope
        ? '다음 주 ' + weekdayMatch[2] + '요일'
        : (thisScope ? '이번 주 ' + weekdayMatch[2] + '요일' : weekdayMatch[2] + '요일'));

    return {
      mode: afterNextScope
        ? 'week_after_next_weekday'
        : (nextScope ? 'next_weekday' : (thisScope ? 'this_weekday' : 'upcoming_weekday')),
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

    if (spec.mode === 'month_day') {
      const year = base.getFullYear();
      const month = Number(spec.month || 0);
      const day = Number(spec.day || 0);
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      const exact = new Date(year, month - 1, day, 12, 0, 0, 0);
      if (exact.getMonth() !== month - 1 || exact.getDate() !== day) return null;
      if (exact.getTime() < base.getTime()) {
        const nextYear = new Date(year + 1, month - 1, day, 12, 0, 0, 0);
        return nextYear.getMonth() === month - 1 && nextYear.getDate() === day ? nextYear : null;
      }
      return exact;
    }

    if (spec.mode === 'day_of_month') {
      const day = Number(spec.day || 0);
      if (day < 1 || day > 31) return null;
      let exact = new Date(base.getFullYear(), base.getMonth(), day, 12, 0, 0, 0);
      if (exact.getMonth() !== base.getMonth() || exact.getDate() !== day || exact.getTime() < base.getTime()) {
        exact = new Date(base.getFullYear(), base.getMonth() + 1, day, 12, 0, 0, 0);
      }
      return exact.getDate() === day ? exact : null;
    }

    const targetWeekday = Number(spec.weekday || 0);
    if (!targetWeekday) return null;

    const currentWeekday = isoWeekdayOf(base);
    if (spec.mode === 'upcoming_weekday') {
      return addDays(base, (targetWeekday - currentWeekday + 7) % 7);
    }

    const monday = addDays(base, -(currentWeekday - 1));
    if (!monday) return null;
    const weekOffset = spec.mode === 'week_after_next_weekday'
      ? 14
      : (spec.mode === 'next_weekday' ? 7 : 0);
    return addDays(monday, weekOffset + targetWeekday - 1);
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
      addActionPattern()
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
      addActionPattern()
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
      addActionPattern()
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
    const reasonInfo = extractExplicitReason(text);
    const raw = reasonInfo.commandText;
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
      reason:reasonInfo.reason,
      originalText:cleanText(text)
    };
  }

  function parseTrialCancelMutationIntent(text) {
    const reasonInfo = extractExplicitReason(text);
    const raw = reasonInfo.commandText;
    const compact = compactText(raw);
    if (!raw || !hasTrialWord(compact) || !hasRemoveAction(compact)) return null;

    const dateSpec = parseDateExpression(compact);
    const guestName = extractStudentName(
      raw,
      /(?:체험\s*클래스|체험\s*수업|체험)(?:을|를)?/g,
      /(?:취소|삭제|지워|지우|제거|빼|해제|없애)(?:해줘요|해주세요|해줘|해줄래|할래|해|줘|주세요)?/g
    );
    if (!guestName) return null;

    return {
      type:'mutation',
      intent:'cancel_trial',
      guestName,
      studentName:guestName,
      dateSpec,
      dateLabel:dateSpec ? dateSpec.label : '',
      timeSlot:firstTimeSlot(raw),
      classGroup:firstClassGroup(raw),
      reason:reasonInfo.reason,
      originalText:cleanText(text)
    };
  }

  function parseAbsenceMutationIntent(text) {
    const reasonInfo = extractExplicitReason(text);
    const raw = reasonInfo.commandText;
    const compact = compactText(raw);
    if (!raw || !hasAbsenceWord(compact)) return null;

    const dateSpec = parseDateExpression(compact);
    const studentName = extractStudentName(
      raw,
      /(?:결석)(?:\s*처리)?/g,
      /(?:처리(?:해줘요|해주세요|해줘|해줄래|할래|해|줘|주세요)?|해줘요|해주세요|해줘|해줄래|할래|해|줘|주세요)/g
    );

    return {
      type:'mutation',
      intent:'mark_absent',
      studentName,
      dateSpec,
      dateLabel:dateSpec ? dateSpec.label : '오늘',
      timeSlot:firstTimeSlot(raw),
      classGroup:firstClassGroup(raw),
      reason:reasonInfo.reason,
      originalText:cleanText(text)
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


  function parseWaitlistCancelMutationIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    if (!raw || !hasWaitlistWord(compact) || !hasRemoveAction(compact)) return null;
    const studentName = extractStudentName(
      raw,
      /(?:대기(?:자|명단|리스트)?|웨이팅(?:리스트)?)(?:을|를|에서)?/g,
      /(?:취소|삭제|지워|지우|제거|빼|해제|없애)(?:해줘요|해주세요|해줘|해줄래|할래|해|줘|주세요)?/g
    );
    if (!studentName) return null;
    const dateSpec = parseDateExpression(compact);
    return {
      type:'mutation', intent:'cancel_waitlist', studentName,
      dateSpec, dateLabel:dateSpec ? dateSpec.label : '',
      timeSlot:firstTimeSlot(raw), classGroup:firstClassGroup(raw), originalText:raw
    };
  }

  function pickupClassTarget(value) {
    const raw = cleanText(value);
    const compact = compactText(raw);
    const weekdayMatch = compact.match(/([월화수목금토])요일/);
    const weekday = weekdayMatch ? (WEEKDAY_MAP[weekdayMatch[1]] || 0) : 0;
    const explicitClass = raw.match(/(\d{1,2})\s*시\s*(?:수업|클래스)/);
    const weekdayClass = raw.match(/[월화수목금토]\s*요일\s*(\d{1,2})\s*시/);
    return { weekday, classTime:Number((explicitClass || weekdayClass)?.[1] || 0) };
  }

  function pickupEditLabel(value, studentName) {
    return pickupLabelFromText(value, studentName)
      .replace(/(?:수정|변경|바꿔|바꾸어|바꿔줘|바꿔주세요|고쳐|고쳐줘|고쳐주세요)(?:해줘요|해주세요|해줘|해줄래|할래|해|줘|주세요)?/g, ' ')
      .replace(/^(?:을|를|은|는)\s*/g, '')
      .replace(/\s*(?:으로|로)$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parsePickupCancelMutationIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    if (!raw || !/픽업/.test(compact) || !hasRemoveAction(compact)) return null;
    const studentName = pickupStudentName(raw);
    if (!studentName) return null;
    const target = pickupClassTarget(raw);
    return {
      type:'mutation', intent:'cancel_pickup', studentName,
      weekday:target.weekday, classTime:target.classTime,
      pickupKind:/하원/.test(compact) ? 'dropoff' : 'all',
      originalText:raw
    };
  }

  function parsePickupUpdateMutationIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    if (!raw || !/픽업/.test(compact) || hasRemoveAction(compact)) return null;
    if (!/(?:수정|변경|바꿔|바꾸|고쳐)/.test(compact)) return null;
    const studentName = pickupStudentName(raw);
    if (!studentName) return null;
    const target = pickupClassTarget(raw);
    const clocks = pickupClockMentions(raw);
    let classClock = null;
    if (target.classTime) classClock = clocks.find(item => Number(item.hour) === target.classTime) || null;
    const pickupClock = clocks.filter(item => item !== classClock).slice(-1)[0] || null;
    return {
      type:'mutation', intent:'update_pickup', studentName,
      weekday:target.weekday, classTime:target.classTime,
      pickupKind:/하원/.test(compact) ? 'dropoff' : 'arrival',
      pickupLabel:pickupEditLabel(raw, studentName),
      pickupTime:normalizePickupClock(pickupClock),
      originalText:raw
    };
  }


  function parsePickupMutationIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    if (!raw || !/픽업/.test(compact) || hasRemoveAction(compact) || !hasAddAction(compact)) return null;

    const passiveRegistrationQuery =
      /(?:등록된|등록되어있는|등록되어있|등록돼있는|등록돼있)/.test(compact)
      && /(?:누구|학생|명단|몇명|있어|있나|있나요|알려|보여|확인|조회)/.test(compact);
    if (passiveRegistrationQuery) return null;

    const target = pickupClassTarget(raw);
    const weekday = target.weekday;
    const classTime = target.classTime;
    const clocks = pickupClockMentions(raw);

    let classClock = null;
    if (classTime) {
      classClock = clocks.find(item => Number(item.hour) === classTime) || null;
    }
    const pickupClock = clocks.filter(item => item !== classClock).slice(-1)[0] || null;

    const studentName = pickupStudentName(raw);
    const pickupLabel = pickupLabelFromText(raw, studentName);

    return {
      type:'mutation',
      intent:'add_pickup',
      studentName,
      weekday,
      classTime,
      pickupLabel,
      pickupTime:normalizePickupClock(pickupClock),
      isDropoff:/하원/.test(compact),
      originalText:raw
    };
  }


  function parseClassMutationIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    if (!raw || !hasAddAction(compact) || hasRemoveAction(compact)) return null;
    if (!/(?:수업|클래스)/.test(compact)) return null;
    if (/(?:신규|신입|새학생|새원생|신규등록|처음등록)/.test(compact)) return null;
    if (hasMakeupWord(compact) || hasWaitlistWord(compact) || hasTrialWord(compact) || hasAbsenceWord(compact) || hasMoveAction(compact)) return null;

    const dateSpec = parseDateExpression(compact);
    const timeSlot = firstTimeSlot(raw);
    const studentName = extractStudentName(
      raw,
      /(?:정규\s*)?(?:수업|클래스)(?:으로|에|을|를)?/g,
      addActionPattern()
    );
    if (!studentName || !dateSpec || !timeSlot) return null;

    return {
      type:'mutation',
      intent:'add_class_once',
      studentName,
      division:detectDivision(compact),
      dateSpec,
      dateLabel:dateSpec.label,
      timeSlot,
      classGroup:firstClassGroup(raw),
      originalText:raw
    };
  }

  function parseSingleWriteIntent(text) {
    const normalizedText = cleanText(text);
    return parseAbsenceMutationIntent(normalizedText)
      || parseTrialCancelMutationIntent(normalizedText)
      || parseMakeupCancelMutationIntent(normalizedText)
      || parseMoveCancelMutationIntent(normalizedText)
      || parseWaitlistCancelMutationIntent(normalizedText)
      || parsePickupCancelMutationIntent(normalizedText)
      || parsePickupUpdateMutationIntent(normalizedText)
      || parsePickupMutationIntent(normalizedText)
      || parseWaitlistMutationIntent(normalizedText)
      || parseTrialMutationIntent(normalizedText)
      || parseScheduleMoveMutationIntent(normalizedText)
      || parseMakeupMutationIntent(normalizedText)
      || parseClassMutationIntent(normalizedText);
  }

  function parseMultiWriteIntent(text) {
    const raw = cleanText(text);
    if (!raw) return null;
    const parts = raw.split(/\s*(?:;|그리고|그다음|그 다음|\n)\s*/g).map(cleanText).filter(Boolean);
    if (parts.length < 2 || parts.length > 3) return null;
    const commands = parts.map(parseSingleWriteIntent);
    if (commands.some(item => !item)) return null;
    return { type:'mutation', intent:'batch_write', commands, originalText:raw };
  }

  function parseWriteIntent(text) {
    const normalizedText = cleanText(text);
    return parseMultiWriteIntent(normalizedText) || parseSingleWriteIntent(normalizedText);
  }

  function isConfirmCommand(text) {
    return /^(확인|확인해|확인해줘|진행|진행해|진행해줘|실행|실행해|실행해줘)$/i.test(compactText(text));
  }

  function isCancelCommand(text) {
    return /^(취소|취소해|취소해줘|취소할게|중단|중단해|안할래|하지마|아니|아니야)$/i.test(compactText(text));
  }

  function commandRequiresReason(command) {
    const intent = cleanText(command && command.intent);
    return intent === 'mark_absent' || intent === 'cancel_makeup' || intent === 'cancel_trial';
  }

  function reasonPrompt(command, schedule) {
    if (schedule && typeof schedule.writeReasonPrompt === 'function') {
      return schedule.writeReasonPrompt(command);
    }
    return '사유를 알려주세요.';
  }

  function confirmationMessage(command, schedule, fallback) {
    if (schedule && typeof schedule.writeConfirmationMessage === 'function') {
      const message = cleanText(schedule.writeConfirmationMessage(command));
      if (message) return message;
    }
    return cleanText(fallback) || '이 작업을 진행할까요?';
  }

  function multiWeekdayTimeMentions(value) {
    const raw = cleanText(value);
    const pattern = /(?:(다다음\s*주|다음\s*주|차주|이번\s*주|금주)\s*)?([월화수목금토])요일\s*(\d{1,2})\s*시(?:\s*([AaBb])\s*반)?/g;
    return Array.from(raw.matchAll(pattern)).map(match => ({
      scope:cleanText(match[1]).replace(/\s+/g, ''),
      weekdayText:match[2] + '요일',
      weekday:WEEKDAY_MAP[match[2]] || 0,
      timeSlot:Number(match[3] || 0),
      classGroup:cleanText(match[4]).toUpperCase(),
      index:Number(match.index || 0),
      text:String(match[0] || '')
    })).filter(item => item.weekday && item.timeSlot);
  }

  function parseMultiQueryIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    if (!raw) return null;

    const mentions = multiWeekdayTimeMentions(raw);
    if (mentions.length < 2 || mentions.length > 3) return null;

    const explicitWriteCommand =
      /(?:등록|추가|넣|예약|신청|배정|저장|취소|삭제|지워|지우|제거|빼|해제|없애|변경|이동|옮겨|바꿔|바꾸)(?:해줘|해주세요|해줄래|할래|줘|주세요|하자|해요|해)[.!。]?$/i.test(compact);
    if (explicitWriteCommand) return null;

    const division = detectDivision(compact);
    const inheritedScope = mentions.find(item => item.scope)?.scope || '';
    const asksForRoster =
      /(?:누구|누가|학생|원생|명단|목록|리스트|몇명|몇명이|인원|예약자|대기자)/.test(compact);
    const hasPickup = /(?:등원|하원)?픽업/.test(compact);
    const hasAbsence = /결석/.test(compact);
    const hasMakeup = /(?:보강|보충(?:수업)?)/.test(compact);
    const hasTrial = /(?:체험(?:수업|클래스)?)/.test(compact);
    const hasWaitlist = /(?:대기(?:자|명단|리스트)?|웨이팅(?:리스트)?)/.test(compact);
    const hasMove = /(?:수업이동예약|수업이동|이동예약|변경예약)/.test(compact);
    const hasSeatMeaning = /(?:자리|빈자리|여석|빈곳|빈시간|몇자리)/.test(compact);
    const hasAvailabilityQuestion =
      /(?:가능|남는|남아|남았|있어|있나|있나요|있니|있을까|여유|비어|몇자리)/.test(compact);

    let sharedSuffix = '';
    if (hasPickup) {
      sharedSuffix = /하원/.test(compact)
        ? '하원 픽업 누구 있어?'
        : (/(?:등원|픽업만)/.test(compact) ? '등원 픽업 누구 있어?' : '픽업 누구 있어?');
    } else if (hasMove && asksForRoster && !hasAvailabilityQuestion) {
      sharedSuffix = '수업 이동 예약 학생 누구야?';
    } else if (hasAbsence && asksForRoster) {
      sharedSuffix = '결석 학생 누구야?';
    } else if (hasMakeup && asksForRoster && !hasAvailabilityQuestion) {
      sharedSuffix = '보강 학생 누구야?';
    } else if (hasTrial && asksForRoster && !hasAvailabilityQuestion) {
      sharedSuffix = '체험 학생 누구야?';
    } else if (hasWaitlist && asksForRoster && !hasAvailabilityQuestion) {
      sharedSuffix = '대기 학생 누구야?';
    } else if (hasSeatMeaning || hasAvailabilityQuestion || hasMakeup || hasTrial || hasWaitlist || hasMove) {
      if (hasMakeup) sharedSuffix = '보강 가능해?';
      else if (hasTrial) sharedSuffix = '체험 가능해?';
      else if (hasWaitlist) sharedSuffix = '대기 가능해?';
      else if (hasMove) sharedSuffix = '수업 이동 가능해?';
      else sharedSuffix = '자리 있어?';
    } else {
      return null;
    }

    const divisionText = division === 'elementary' ? '초등부 ' : (division === 'kinder' ? '유치부 ' : '');
    const queries = mentions.map(item => {
      const scopeText = item.scope || inheritedScope;
      const scopedWeekday = (scopeText ? scopeText + ' ' : '') + item.weekdayText;
      const groupText = item.classGroup ? ' ' + item.classGroup + '반' : '';
      const queryText = divisionText + scopedWeekday + ' ' + item.timeSlot + '시' + groupText + ' ' + sharedSuffix;
      return parseRosterQueryIntent(queryText)
        || parsePickupQueryIntent(queryText)
        || parseAvailableSlotsIntent(queryText);
    }).filter(Boolean);

    if (queries.length !== mentions.length) return null;

    return {
      type:'query',
      intent:'multi_read_query',
      queries,
      originalText:raw
    };
  }


  function parseAvailableSlotsIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    if (!raw) return null;

    const hasDirectScheduleShorthand =
      /^(?:(?:초등부?|유치부?|유치원|유치|유아)\s*)?[월화수목금토]요일\s*\d{1,2}\s*시(?:\s*[AaBb]\s*반)?(?:\s*[?!.。])?$/.test(raw);

    const hasScheduleMeaning =
      /시간표/.test(compact)
      || /수업시간/.test(compact)
      || /몇시/.test(compact)
      || /시간(?:을|은|이)?(?:알려|보여|확인|체크|봐|조회)/.test(compact);

    const purposeForAvailability = detectPurpose(compact);
    const hasDirectPossibleQuestion =
      purposeForAvailability !== 'unknown'
      && /(?:가능해|가능한가|가능한지|가능할까|가능할까요|가능하니|가능한)/.test(compact);

    const hasAvailabilityMeaning =
      /빈자리|빈곳|빈시간|여석/.test(compact)
      || /자리/.test(compact)
      || /자리.{0,10}(?:남|있|여유|가능|몇)/.test(compact)
      || /(?:남는|남아있는|여유있는|비어있는)클래스/.test(compact)
      || /(?:여유|비어)(?:있는)?(?:시간|자리|클래스|수업|반)/.test(compact)
      || /가능(?:한)?(?:시간|자리|클래스|수업|반)/.test(compact)
      || /할수있는(?:시간|자리|클래스|수업|반)/.test(compact)
      || /들어갈수있는(?:반|시간|자리|클래스|수업)/.test(compact)
      || /받을수있는(?:반|시간|자리|클래스|수업)/.test(compact)
      || /몇자리/.test(compact)
      || hasDirectPossibleQuestion;

    const asksForLookup =
      /알려|찾아|보여|확인|체크|봐줘|봐|조회/.test(compact)
      || /있어|있나|있나요|있니|있을까|있습니까/.test(compact)
      || /가능해|가능한|가능한가|가능한지|가능할까|가능할까요|가능하니/.test(compact)
      || /남는|남아|남았/.test(compact)
      || /여유|비어|몇자리|몇명|몇시/.test(compact);

    if (
      (!hasAvailabilityMeaning && !hasScheduleMeaning && !hasDirectScheduleShorthand)
      || (!asksForLookup && !hasDirectScheduleShorthand)
    ) return null;

    const viewMode = (hasDirectScheduleShorthand || (hasScheduleMeaning && !hasAvailabilityMeaning))
      ? 'schedule'
      : 'availability';
    const division = detectDivision(compact);
    const purpose = purposeForAvailability;
    const timeSlot = firstTimeSlot(raw);
    const classGroup = firstClassGroup(raw);

    const isThisWeek = /(?:이번주|이번주간|금주)/.test(compact);
    const isWeekAfterNext = /(?:다다음주)/.test(compact);
    const isNextWeek = !isWeekAfterNext && /(?:다음주|차주)/.test(compact);
    const weekdayMatch = compact.match(/([월화수목금토])요일/);
    const hasScopedWeekday = !!weekdayMatch && (isThisWeek || isNextWeek || isWeekAfterNext);
    const hasTodayOrTomorrow = /(?:오늘|금일|내일)/.test(compact);
    const hasNumericDate = /(\d{1,2})월(\d{1,2})일/.test(compact) || /(?:^|[^\d월])(\d{1,2})일(?!요일)/.test(compact);

    let scope = 'recurring';
    let dateSpec = null;
    let weekOffset = 0;
    let weekday = weekdayMatch ? WEEKDAY_MAP[weekdayMatch[1]] || 0 : 0;
    let dateLabel = '';

    if (hasTodayOrTomorrow || hasNumericDate || hasScopedWeekday) {
      scope = 'date';
      dateSpec = parseDateExpression(compact);
      if (!dateSpec) return null;
      dateLabel = dateSpec.label;
    } else if ((isThisWeek || isNextWeek || isWeekAfterNext) && !weekdayMatch) {
      scope = 'week';
      weekOffset = isWeekAfterNext ? 2 : (isNextWeek ? 1 : 0);
      dateLabel = isWeekAfterNext ? '다다음 주' : (isNextWeek ? '다음 주' : '이번 주');
    } else if (weekdayMatch) {
      scope = 'recurring';
      dateLabel = weekdayMatch[1] + '요일';
    }

    return {
      type:'query',
      intent:'find_available_slots',
      scope,
      viewMode,
      date:dateSpec ? dateSpec.mode : '',
      dateSpec,
      dateLabel,
      weekOffset,
      weekday,
      division,
      purpose,
      timeSlot,
      classGroup,
      originalText:raw
    };
  }


  function parseRosterQueryIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    if (!raw) return null;

    const explicitWriteCommand =
      /(?:등록|추가|넣|예약|신청|배정|저장|취소|삭제|지워|지우|제거|빼|해제|없애|변경|이동|옮겨|바꿔|바꾸)(?:해줘|해주세요|해줄래|할래|줘|주세요|하자|해요|해)[.!。]?$/i.test(compact);
    if (explicitWriteCommand) return null;

    let rosterKind = '';
    if (/(?:수업이동예약|수업이동|이동예약|변경예약)/.test(compact)) rosterKind = 'move';
    else if (/결석/.test(compact)) rosterKind = 'absence';
    else if (/(?:보강|보충(?:수업)?)/.test(compact)) rosterKind = 'makeup';
    else if (/(?:체험(?:수업|클래스)?)/.test(compact)) rosterKind = 'trial';
    else if (/(?:대기(?:자|명단|리스트)?|웨이팅(?:리스트)?)/.test(compact)) rosterKind = 'waitlist';
    else if (/(?:수업|클래스)/.test(compact)) rosterKind = 'class_roster';
    if (!rosterKind) return null;

    const asksForRoster =
      /(?:누구|누가|학생|원생|명단|목록|리스트|몇명|몇명이|인원|예약자|대기자)/.test(compact);
    if (!asksForRoster) return null;

    if (
      rosterKind === 'class_roster'
      && /(?:자리|빈자리|여석|가능|남는|남아|비어|여유)/.test(compact)
    ) return null;

    const explicitDateSpec = parseDateExpression(compact);
    const isThisWeek = /(?:이번주|이번주간|금주)/.test(compact);
    const isWeekAfterNext = /다다음주/.test(compact);
    const isNextWeek = !isWeekAfterNext && /(?:다음주|차주)/.test(compact);
    const weekdayMatch = compact.match(/([월화수목금토])요일/);

    let scope = 'date';
    let dateSpec = explicitDateSpec;
    let dateLabel = explicitDateSpec ? explicitDateSpec.label : '';
    let weekOffset = 0;

    if (!explicitDateSpec && (isThisWeek || isNextWeek || isWeekAfterNext)) {
      scope = 'week';
      weekOffset = isWeekAfterNext ? 2 : (isNextWeek ? 1 : 0);
      dateLabel = isWeekAfterNext ? '다다음 주' : (isNextWeek ? '다음 주' : '이번 주');
    } else if (!explicitDateSpec && (rosterKind === 'waitlist' || rosterKind === 'move')) {
      scope = 'all';
      dateLabel = '현재';
    } else if (!explicitDateSpec) {
      dateSpec = { mode:'today', label:'오늘' };
      dateLabel = '오늘';
    }

    return {
      type:'query',
      intent:'find_roster_entries',
      rosterKind,
      scope,
      dateSpec,
      dateLabel,
      weekOffset,
      weekday:weekdayMatch ? WEEKDAY_MAP[weekdayMatch[1]] || 0 : 0,
      division:detectDivision(compact),
      timeSlot:firstTimeSlot(raw),
      classGroup:firstClassGroup(raw),
      originalText:raw
    };
  }


  function parsePickupQueryIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    if (!raw || !/(?:픽업|하원)/.test(compact)) return null;

    const explicitMutation =
      /(?:픽업|하원).{0,18}(?:등록|추가|넣|예약)(?:해|해줘|해주세요|해줄래|할래|줘|주세요|하자|해요)/.test(compact)
      || /(?:등록|추가|넣|예약).{0,18}(?:픽업|하원)(?:해|해줘|해주세요|해줄래|할래|줘|주세요|하자|해요)/.test(compact);
    if (explicitMutation) return null;

    const explicitDateSpec = parseDateExpression(compact);
    const explicitClassTimeMatch = raw.match(/(\d{1,2})\s*시\s*(?:수업|클래스)/);
    const shorthandTimeBeforePickup = raw.match(/(\d{1,2})\s*시(?!\s*\d+\s*분)\s*(?=(?:등원\s*|하원\s*)?픽업)/);
    const shorthandTimeAfterPickup = raw.match(/(?:등원\s*|하원\s*)?픽업\s*(\d{1,2})\s*시(?!\s*\d+\s*분)/);
    const classTime = Number(
      explicitClassTimeMatch && explicitClassTimeMatch[1]
      || shorthandTimeBeforePickup && shorthandTimeBeforePickup[1]
      || shorthandTimeAfterPickup && shorthandTimeAfterPickup[1]
      || 0
    );

    const asksForLookup =
      /(?:누구|학생|명단|몇명|몇명이|있어|있나|있나요|있니|있을까|알려|찾아|보여|확인|체크|조회|어디|시간)/.test(compact);
    const shorthandLookup =
      /픽업/.test(compact)
      && (!!explicitDateSpec || classTime > 0);
    if (!asksForLookup && !shorthandLookup) return null;

    const dateSpec = explicitDateSpec || { mode:'today', label:'오늘' };
    const kind = /하원/.test(compact)
      ? 'dropoff'
      : (/(?:등원|픽업만)/.test(compact) ? 'pickup' : 'all');

    return {
      type:'query',
      intent:'find_pickups',
      dateSpec,
      dateLabel:dateSpec.label,
      classTime,
      kind,
      originalText:raw
    };
  }

  function parseQueryIntent(text) {
    const normalizedText = cleanText(text);
    return parseMultiQueryIntent(normalizedText)
      || parseRosterQueryIntent(normalizedText)
      || parsePickupQueryIntent(normalizedText)
      || parseAvailableSlotsIntent(normalizedText);
  }

  function classifyRequest(text) {
    const normalizedText = cleanText(text);
    const writeIntent = parseWriteIntent(normalizedText);
    if (writeIntent) {
      return {
        type:'mutation',
        intent:writeIntent.intent,
        parsed:writeIntent
      };
    }

    const queryIntent = parseQueryIntent(normalizedText);
    if (queryIntent) {
      return {
        type:'query',
        intent:queryIntent.intent,
        parsed:queryIntent
      };
    }

    return {
      type:'other',
      intent:'',
      parsed:null
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


  async function runQuery(text, context) {
    const normalizedText = cleanText(text);
    const schedule = global.OlliCommandSchedule;
    const queryIntent = parseQueryIntent(normalizedText);

    if (!queryIntent) {
      return {
        handled:false,
        kind:'pass_through',
        intent:'',
        text:normalizedText,
        message:'',
        clearInput:false,
        payload:null
      };
    }

    if (!schedule) {
      return {
        handled:true,
        kind:'command_result',
        intent:queryIntent.intent,
        text:normalizedText,
        message:'학원 조회 기능을 아직 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
        clearInput:true,
        payload:queryIntent
      };
    }

    if (queryIntent.intent === 'multi_read_query') {
      const results = [];
      for (const subQuery of queryIntent.queries) {
        const subResult = await runQuery(subQuery.originalText, context);
        if (!subResult || subResult.handled !== true) continue;
        results.push(subResult);
      }

      if (!results.length) {
        return {
          handled:true,
          kind:'command_result',
          intent:queryIntent.intent,
          text:normalizedText,
          message:'요청한 항목들을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
          clearInput:true,
          payload:queryIntent
        };
      }

      return {
        handled:true,
        kind:'command_result',
        intent:queryIntent.intent,
        text:normalizedText,
        message:results.map(item => cleanText(item.message)).filter(Boolean).join('\n\n'),
        clearInput:true,
        payload:Object.assign({}, queryIntent, { results })
      };
    }

    if (queryIntent.intent === 'find_roster_entries') {
      if (typeof schedule.findRosterEntries !== 'function') {
        return {
          handled:true,
          kind:'command_result',
          intent:queryIntent.intent,
          text:normalizedText,
          message:'학생 명단 조회 기능을 아직 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
          clearInput:true,
          payload:queryIntent
        };
      }

      try {
        let referenceDate = new Date();
        if (queryIntent.scope === 'date') {
          referenceDate = resolveDateExpression(queryIntent.dateSpec, new Date());
          if (!referenceDate) throw new Error('조회 날짜를 해석하지 못했습니다.');
        } else if (queryIntent.scope === 'week') {
          referenceDate = addDays(new Date(), Number(queryIntent.weekOffset || 0) * 7);
        }

        const result = await schedule.findRosterEntries({
          kind:queryIntent.rosterKind,
          scope:queryIntent.scope,
          date:referenceDate,
          dateLabel:queryIntent.dateLabel,
          division:queryIntent.division,
          timeSlot:queryIntent.timeSlot,
          classGroup:queryIntent.classGroup,
          weekday:queryIntent.weekday
        });
        const message = typeof schedule.describeRosterEntries === 'function'
          ? schedule.describeRosterEntries(result)
          : '학생 명단을 확인했어요.';
        return {
          handled:true,
          kind:'command_result',
          intent:queryIntent.intent,
          text:normalizedText,
          message,
          clearInput:true,
          payload:Object.assign({}, queryIntent, { result })
        };
      } catch (error) {
        console.warn('올리 학생 명단 조회 실패:', error);
        return {
          handled:true,
          kind:'command_result',
          intent:queryIntent.intent,
          text:normalizedText,
          message:'학생 명단을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
          clearInput:true,
          payload:queryIntent
        };
      }
    }

    if (queryIntent.intent === 'find_pickups') {
      if (typeof schedule.findPickups !== 'function') {
        return {
          handled:true,
          kind:'command_result',
          intent:queryIntent.intent,
          text:normalizedText,
          message:'픽업 조회 기능을 아직 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
          clearInput:true,
          payload:queryIntent
        };
      }

      try {
        const targetDate = resolveDateExpression(queryIntent.dateSpec, new Date());
        if (!targetDate) throw new Error('조회 날짜를 해석하지 못했습니다.');
        const result = await schedule.findPickups({
          date:targetDate,
          dateLabel:queryIntent.dateLabel,
          classTime:queryIntent.classTime,
          kind:queryIntent.kind
        });
        const message = typeof schedule.describePickups === 'function'
          ? schedule.describePickups(result)
          : '픽업 일정을 확인했어요.';
        return {
          handled:true,
          kind:'command_result',
          intent:queryIntent.intent,
          text:normalizedText,
          message,
          clearInput:true,
          payload:Object.assign({}, queryIntent, { result })
        };
      } catch (error) {
        console.warn('올리 픽업 조회 실패:', error);
        return {
          handled:true,
          kind:'command_result',
          intent:queryIntent.intent,
          text:normalizedText,
          message:'픽업 일정을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
          clearInput:true,
          payload:queryIntent
        };
      }
    }

    const availableSlots = queryIntent;
    if (typeof schedule.findAvailableSlots !== 'function') {
      return {
        handled:true,
        kind:'command_result',
        intent:availableSlots.intent,
        text:normalizedText,
        message:'시간표 조회 기능을 아직 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
        clearInput:true,
        payload:availableSlots
      };
    }

    try {
      let result;
      let message;

      if (availableSlots.scope === 'week') {
        if (typeof schedule.findWeekAvailability !== 'function') {
          throw new Error('주간 시간표 조회 기능을 아직 불러오지 못했어요.');
        }
        result = await schedule.findWeekAvailability({
          date:new Date(),
          weekOffset:availableSlots.weekOffset,
          dateLabel:availableSlots.dateLabel,
          division:availableSlots.division,
          purpose:availableSlots.purpose,
          viewMode:availableSlots.viewMode,
          timeSlot:availableSlots.timeSlot,
          classGroup:availableSlots.classGroup
        });
        message = typeof schedule.describeWeekAvailability === 'function'
          ? schedule.describeWeekAvailability(result)
          : '주간 시간표를 확인했어요.';
      } else if (availableSlots.scope === 'recurring') {
        if (typeof schedule.findRecurringAvailability !== 'function') {
          throw new Error('정규수업 기준 빈자리 조회 기능을 아직 불러오지 못했어요.');
        }
        result = await schedule.findRecurringAvailability({
          date:new Date(),
          weekday:availableSlots.weekday,
          division:availableSlots.division,
          purpose:availableSlots.purpose,
          viewMode:availableSlots.viewMode,
          timeSlot:availableSlots.timeSlot,
          classGroup:availableSlots.classGroup
        });
        message = typeof schedule.describeRecurringAvailability === 'function'
          ? schedule.describeRecurringAvailability(result)
          : '정규수업 기준 빈자리를 확인했어요.';
      } else {
        const targetDate = resolveDateExpression(availableSlots.dateSpec, new Date());
        if (!targetDate) throw new Error('조회 날짜를 해석하지 못했습니다.');
        result = await schedule.findAvailableSlots({
          date:targetDate,
          dateLabel:availableSlots.dateLabel,
          division:availableSlots.division,
          purpose:availableSlots.purpose,
          viewMode:availableSlots.viewMode,
          timeSlot:availableSlots.timeSlot,
          classGroup:availableSlots.classGroup
        });
        message = typeof schedule.describeAvailableSlots === 'function'
          ? schedule.describeAvailableSlots(result)
          : '시간표 빈자리를 확인했어요.';
      }

      return {
        handled:true,
        kind:'command_result',
        intent:availableSlots.intent,
        text:normalizedText,
        message,
        clearInput:true,
        payload:Object.assign({}, availableSlots, { result })
      };
    } catch (error) {
      console.warn('올리 시간표 조회 실패:', error);
      return {
        handled:true,
        kind:'command_result',
        intent:availableSlots.intent,
        text:normalizedText,
        message:'시간표 빈자리를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
        clearInput:true,
        payload:availableSlots
      };
    }
  }

  async function runSuggestedQuery(text, context) {
    const normalizedText = cleanText(text);
    if (!isOlliReplyCandidate(normalizedText)) return passThrough(normalizedText);
    if (parseMultiQueryIntent(normalizedText) || parseRosterQueryIntent(normalizedText) || parsePickupQueryIntent(normalizedText)) {
      return runQuery(normalizedText, context);
    }
    return runQuery(normalizedText + ' 시간표 보여줘', context);
  }

  function resolveWriteIntentOptions(writeIntent, routeContext) {
    const options = resolveWriteIntentOptions(writeIntent, routeContext);
    if (writeIntent.intent === 'batch_write') {
      options.commands = (writeIntent.commands || []).map(item => resolveWriteIntentOptions(item, routeContext));
    }
    return options;
  }


  async function prepareAction(text, context) {
    const normalizedText = cleanText(text);
    const routeContext = normalizeContext(context);
    const schedule = global.OlliCommandSchedule;
    const writeIntent = parseWriteIntent(normalizedText);

    if (!writeIntent) {
      return {
        handled:false,
        kind:'pass_through',
        intent:'',
        text:normalizedText,
        message:'',
        clearInput:false,
        payload:null,
        action:null
      };
    }

    if (!schedule || typeof schedule.prepareWriteCommand !== 'function') {
      return {
        handled:true,
        kind:'action_rejected',
        intent:writeIntent.intent,
        text:normalizedText,
        message:'시간표 작업 준비 기능을 아직 불러오지 못했어요.',
        clearInput:true,
        payload:writeIntent,
        action:null
      };
    }

    try {
      const options = resolveWriteIntentOptions(writeIntent, routeContext);

      const prepared = await schedule.prepareWriteCommand(writeIntent.intent, options);
      if (!prepared || prepared.ok !== true || !prepared.command) {
        return {
          handled:true,
          kind:'action_rejected',
          intent:writeIntent.intent,
          text:normalizedText,
          message:String(prepared && prepared.message || '작업을 준비하지 못했어요.'),
          clearInput:true,
          payload:writeIntent,
          action:null
        };
      }

      const command = prepared.command;
      const requiresReason = commandRequiresReason(command) && !cleanText(command.reason);
      const message = requiresReason
        ? reasonPrompt(command, schedule)
        : confirmationMessage(command, schedule, prepared.message);

      return {
        handled:true,
        kind:requiresReason ? 'action_needs_reason' : 'action_pending',
        intent:command.intent || writeIntent.intent,
        text:normalizedText,
        message,
        clearInput:true,
        payload:command,
        action:{
          status:'pending',
          intent:command.intent || writeIntent.intent,
          command:Object.assign({}, command),
          requiresReason
        }
      };
    } catch (error) {
      console.warn('올리 액션 준비 실패:', error);
      return {
        handled:true,
        kind:'action_rejected',
        intent:writeIntent.intent,
        text:normalizedText,
        message:String(error && (error.message || error) || '작업을 준비하지 못했어요.'),
        clearInput:true,
        payload:writeIntent,
        action:null
      };
    }
  }

  async function route(text, context) {
    const normalizedText = cleanText(text);
    const routeContext = normalizeContext(context);
    const schedule = global.OlliCommandSchedule;

    if (isCancelCommand(normalizedText)) {
      const cancelled = pendingReasonCommand || pendingWriteCommand;
      pendingReasonCommand = null;
      pendingWriteCommand = null;
      if (!cancelled) {
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

    if (pendingReasonCommand) {
      if (isConfirmCommand(normalizedText)) {
        return {
          handled:true,
          kind:'command_result',
          intent:pendingReasonCommand.intent,
          text:normalizedText,
          message:reasonPrompt(pendingReasonCommand, schedule),
          clearInput:true,
          payload:pendingReasonCommand
        };
      }

      const reason = normalizeReasonReply(normalizedText);
      if (!reason) {
        return {
          handled:true,
          kind:'command_result',
          intent:pendingReasonCommand.intent,
          text:normalizedText,
          message:reasonPrompt(pendingReasonCommand, schedule),
          clearInput:true,
          payload:pendingReasonCommand
        };
      }

      const command = Object.assign({}, pendingReasonCommand, { reason });
      pendingReasonCommand = null;
      pendingWriteCommand = command;
      return {
        handled:true,
        kind:'command_confirmation',
        intent:command.intent,
        text:normalizedText,
        message:confirmationMessage(command, schedule, ''),
        clearInput:true,
        payload:command
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

    const writeIntent = parseWriteIntent(normalizedText);
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
        const options = resolveWriteIntentOptions(writeIntent, routeContext);
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

        if (commandRequiresReason(prepared.command) && !cleanText(prepared.command.reason)) {
          pendingReasonCommand = prepared.command;
          pendingWriteCommand = null;
          return {
            handled:true,
            kind:'command_result',
            intent:writeIntent.intent,
            text:normalizedText,
            message:reasonPrompt(prepared.command, schedule),
            clearInput:true,
            payload:prepared.command
          };
        }

        pendingReasonCommand = null;
        pendingWriteCommand = prepared.command;
        return {
          handled:true,
          kind:'command_confirmation',
          intent:writeIntent.intent,
          text:normalizedText,
          message:confirmationMessage(prepared.command, schedule, prepared.message),
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

    return runQuery(normalizedText, routeContext);
  }

  global.OlliCommandRouter = Object.freeze({
    VERSION,
    route,
    classifyRequest,
    runQuery,
    runSuggestedQuery,
    prepareAction,
    parseWriteIntent,
    parseQueryIntent,
    parseMultiQueryIntent,
    parseAvailableSlotsIntent,
    parseRosterQueryIntent,
    parsePickupQueryIntent,
    parseStudentInfoLookupIntent,
    olliReplyTemporalSignals,
    isOlliReplyCandidate,
    parseScheduleMoveMutationIntent,
    parseMakeupMutationIntent,
    parseWaitlistMutationIntent,
    parseTrialMutationIntent,
    parseAbsenceMutationIntent,
    parseMakeupCancelMutationIntent,
    parseTrialCancelMutationIntent,
    parseMoveCancelMutationIntent,
    parseWaitlistCancelMutationIntent,
    parsePickupCancelMutationIntent,
    parsePickupUpdateMutationIntent,
    parsePickupMutationIntent,
    parseMultiWriteIntent,
    parseClassMutationIntent,
    parseDateExpression,
    resolveDateExpression,
    getPendingWriteCommand() { return pendingWriteCommand ? Object.assign({}, pendingWriteCommand) : null; },
    getPendingReasonCommand() { return pendingReasonCommand ? Object.assign({}, pendingReasonCommand) : null; }
  });
})(window);
