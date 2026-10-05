(function olliCommandRouterCommon(global) {
  'use strict';

  if (global.OlliCommandRouter) return;

  const VERSION = '2026-10-03-structured-write-draft-core-1';
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

  function hasShortScheduleTarget(value) {
    return /(?:보강|대기|체험|체함|빈자리|여석|자리)/.test(compactText(value));
  }

  function isExplicitWriteCommand(value) {
    return /(?:등록|추가|넣|예약|신청|배정|저장|취소|삭제|지워|지우|제거|빼|해제|없애|옮겨|변경|이동|바꿔|바꾸)(?:해줘|해주세요|해줄래|할래|줘|주세요|하자|해요|해)[.!。]?$/i.test(compactText(value));
  }

  function isOlliReplyScheduleInquiry(value) {
    const raw = cleanText(value);
    const compact = compactText(raw);
    if (!raw || isExplicitWriteCommand(compact)) return false;

    const hasScheduleTarget =
      /(?:자리|빈자리|여석|대기(?:자|명단|리스트)?|웨이팅(?:리스트)?|체험|체함|체험(?:수업|클래스)?|보강|보충(?:수업)?|(?:등원|하원)?픽업)/.test(compact);
    if (!hasScheduleTarget) return false;

    const signals = olliReplyTemporalSignals(raw);
    const temporalCount = [signals.date, signals.weekday, signals.time].filter(Boolean).length;
    if (temporalCount >= 1 && hasShortScheduleTarget(compact)) return true;

    return /[?？]/.test(raw)
      || /(?:있어|있나|있나요|있니|있을까|있습니까|가능|몇(?:자리|명)?|남는|남아|남았|비어|여유|어때|되나|되니|되나요|돼|될까|할수|받을수|확인|알려|보여|봐)/.test(compact);
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
    if (/(?:체험|체함|체험수업|체험클래스)/.test(compact)) return 'trial';
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

  function firstTimeMinute(value) {
    const match = cleanText(value).match(/\d{1,2}\s*시(?:\s*(\d{1,2})\s*분)?/);
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
      .replace(/\d{1,2}\s*\/\s*\d{1,2}\s*일/g, ' ')
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

    const slashMonthDay = compact.match(/(?:^|[^\d])(\d{1,2})\/(\d{1,2})일(?!요일)/);
    if (slashMonthDay) {
      return {
        mode:'month_day',
        month:Number(slashMonthDay[1]),
        day:Number(slashMonthDay[2]),
        label:Number(slashMonthDay[1]) + '월 ' + Number(slashMonthDay[2]) + '일'
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
    if (!mentions.length) return null;

    const source = mentions.length >= 2 ? mentions[0] : {weekday:0,timeSlot:0};
    const target = mentions.length >= 2 ? mentions[1] : mentions[0];
    if (!target.weekday || !target.timeSlot) return null;

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
      sourceWeekday:Number(source.weekday || 0),
      sourceTimeSlot:Number(source.timeSlot || 0),
      targetWeekday:Number(target.weekday || 0),
      targetTimeSlot:Number(target.timeSlot || 0),
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
      /(?:보강|보충(?:수업)?)(?:수업)?(?:으로|에|을|를|도)?/g,
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

  function parseUpdateSides(text) {
    const raw=cleanText(text);
    const actionMatch=raw.match(/(?:수정|변경|옮겨|옮기|이동|바꿔|바꾸|고쳐|고치)/);
    const beforeAction=actionMatch ? raw.slice(0,actionMatch.index) : raw;
    let sourceText='';
    let targetText='';

    const fromIndex=beforeAction.lastIndexOf('에서');
    if(fromIndex>=0){
      sourceText=cleanText(beforeAction.slice(0,fromIndex));
      targetText=cleanText(beforeAction.slice(fromIndex+2));
    }else{
      const connectorMatches=Array.from(beforeAction.matchAll(/(?:을|를)\s+/g));
      const connector=connectorMatches.length ? connectorMatches[connectorMatches.length-1] : null;
      if(connector){
        sourceText=cleanText(beforeAction.slice(0,connector.index));
        targetText=cleanText(beforeAction.slice(Number(connector.index||0)+String(connector[0]||'').length));
      }else{
        sourceText=cleanText(beforeAction);
      }
    }

    targetText=targetText
      .replace(/(?:으로|로)\s*$/,'')
      .trim();

    const sourceDate=parseDateExpression(compactText(sourceText));
    const targetDate=parseDateExpression(compactText(targetText));
    const sourceMention=weekdayTimeMentions(sourceText)[0] || null;
    const targetMention=weekdayTimeMentions(targetText)[0] || null;
    return {
      sourceDateExpression:sourceDate ? sourceDate.label : '',
      sourceWeekday:Number(sourceMention?.weekday || sourceDate?.weekday || 0),
      sourceTimeSlot:firstTimeSlot(sourceText),
      sourceMinute:firstTimeMinute(sourceText),
      sourceClassGroup:firstClassGroup(sourceText),
      targetDateExpression:targetDate ? targetDate.label : '',
      targetWeekday:Number(targetMention?.weekday || targetDate?.weekday || 0),
      targetTimeSlot:firstTimeSlot(targetText),
      targetMinute:firstTimeMinute(targetText),
      targetClassGroup:firstClassGroup(targetText)
    };
  }

  function parseMakeupUpdateMutationIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    const hasUpdateAction = /(?:수정|변경|옮|이동|바꿔|바꾸|고쳐|고치)/.test(compact);
    if (!raw || !hasMakeupWord(compact) || hasRemoveAction(compact) || !hasUpdateAction) return null;

    const studentName = extractStudentName(
      raw,
      /(?:보강|보충(?:수업)?)(?:수업)?(?:에서|으로|에|을|를)?/g,
      /(?:수정|변경|옮겨|옮기|이동|바꿔|바꾸|고쳐|고치)(?:줘요|해주세요|해줘|해줄래|할래|해|줘|주세요|어줘|아줘|어요|아요|기)?/g
    );
    if (!studentName) return null;

    const sides=parseUpdateSides(raw);
    return {
      type:'mutation',
      intent:'update_makeup',
      studentName,
      division:detectDivision(compact),
      ...sides,
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

  function parseTrialUpdateMutationIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    const hasUpdateAction = /(?:수정|변경|옮|이동|바꿔|바꾸|고쳐|고치)/.test(compact);
    if (!raw || !hasTrialWord(compact) || hasRemoveAction(compact) || !hasUpdateAction) return null;

    const guestName = cleanupStudentName(
      extractStudentName(
        raw,
        /(?:체험\s*클래스|체험\s*수업|체험)(?:에서|으로|에|을|를)?/g,
        /(?:수정|변경|옮겨|옮기|이동|바꿔|바꾸|고쳐|고치)(?:줘요|해주세요|해줘|해줄래|할래|해|줘|주세요|어줘|아줘|어요|아요|기)?/g
      ).replace(/(?:^|\s)\d{1,2}\s*분(?=\s|$)/g, ' ')
    );
    if (!guestName) return null;

    const sides=parseUpdateSides(raw);
    return {
      type:'mutation',
      intent:'update_trial',
      guestName,
      studentName:guestName,
      division:detectDivision(compact),
      ...sides,
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


  function parseWaitlistUpdateMutationIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    const hasUpdateAction = /(?:수정|변경|옮|이동|바꿔|바꾸|고쳐|고치)/.test(compact);
    if (!raw || !hasWaitlistWord(compact) || hasRemoveAction(compact) || !hasUpdateAction) return null;

    const studentName = extractStudentName(
      raw,
      /(?:대기(?:자|명단|리스트)?|웨이팅(?:리스트)?)(?:에서|으로|에|을|를)?/g,
      /(?:수정|변경|옮겨|옮기|이동|바꿔|바꾸|고쳐|고치)(?:줘요|해주세요|해줘|해줄래|할래|해|줘|주세요|어줘|아줘|어요|아요|기)?/g
    );
    if (!studentName) return null;

    const sides=parseUpdateSides(raw);
    return {
      type:'mutation',
      intent:'update_waitlist',
      studentName,
      division:detectDivision(compact),
      ...sides,
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
    const explicitClass = raw.match(/(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?\s*(?:수업|클래스)/);
    const weekdayClass = raw.match(/[월화수목금토]\s*요일\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/);
    const match = explicitClass || weekdayClass;
    return {
      weekday,
      classTime:Number(match?.[1] || 0),
      classMinute:Number(match?.[2] || 0)
    };
  }

  function pickupEditLabel(value, studentName) {
    return pickupLabelFromText(value, studentName)
      .replace(/(?:수정|변경|바꿔|바꾸어|고쳐)(?:\s*(?:해줘요|해주세요|해줘|해줄래|할래|줘|주세요|해))?/g, ' ')
      .replace(/(?:해줘요|해주세요|해줘|해줄래|할래|줘|주세요)/g, ' ')
      .replace(/^(?:을|를|은|는)\s*/g, '')
      .replace(/(?:으로|로)(?=\s|$)/g, ' ')
      .replace(/^\s*(?:으로|로)\s*$/g, '')
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
      weekday:target.weekday, classTime:target.classTime, classMinute:target.classMinute,
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
    if (target.classTime) {
      classClock = clocks.find(item =>
        Number(item.hour) === target.classTime
        && Number(item.minute || 0) === Number(target.classMinute || 0)
      ) || null;
    }
    const pickupClock = clocks.filter(item => item !== classClock).slice(-1)[0] || null;
    return {
      type:'mutation', intent:'update_pickup', studentName,
      weekday:target.weekday, classTime:target.classTime, classMinute:target.classMinute,
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
      classClock = clocks.find(item =>
        Number(item.hour) === classTime
        && Number(item.minute || 0) === Number(target.classMinute || 0)
      ) || null;
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
      classMinute:target.classMinute,
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

  function quotedTimetableMemoNote(value) {
    const raw = cleanText(value);
    const match = raw.match(/(?:‘([^’]+)’|“([^”]+)”|"([^"]+)"|'([^']+)')/);
    if (!match) return '';
    return cleanText(match[1] || match[2] || match[3] || match[4]);
  }

  function stripTimetableMemoTargetParts(value) {
    return removeDivisionWords(value)
      .replace(/(?:‘[^’]+’|“[^”]+”|"[^"]+"|'[^']+')/g, ' ')
      .replace(/[.!?]/g, ' ')
      .replace(/(?:오늘|금일|내일|(?:(?:이번\s*주|금주|다다음\s*주|다음\s*주|차주)\s*)?[월화수목금토]요일)/g, ' ')
      .replace(/\d{1,2}\s*월\s*\d{1,2}\s*일/g, ' ')
      .replace(/\d{1,2}\s*\/\s*\d{1,2}\s*일/g, ' ')
      .replace(/(?:^|\s)\d{1,2}\s*일(?=\s|$)/g, ' ')
      .replace(/\d{1,2}\s*시(?:\s*\d{1,2}\s*분)?(?:에서|으로|에|로)?/g, ' ')
      .replace(/[AaBb]\s*반/g, ' ')
      .replace(/(?:이라고|라고|이라는|라는)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractTimetableMemoStudentName(value) {
    const raw = cleanText(value);
    const memoIndex = raw.search(/(?:시간표\s*)?메모/);
    if (memoIndex < 0) return '';
    let prefix = stripTimetableMemoTargetParts(raw.slice(0, memoIndex))
      .replace(/(?:내용|문구)\s*[:：-]?\s*/g, ' ')
      .replace(/(?:학생|원생)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleanupStudentName(prefix);
  }

  function extractTimetableMemoNote(value) {
    const quoted = quotedTimetableMemoNote(value);
    if (quoted) return quoted;

    const studentName = extractTimetableMemoStudentName(value);
    let stripped = removeDivisionWords(value)
      .replace(/[.!?]/g, ' ')
      .replace(/(?:오늘|금일|내일|(?:(?:이번\s*주|금주|다다음\s*주|다음\s*주|차주)\s*)?[월화수목금토]요일)/g, ' ')
      .replace(/\d{1,2}\s*월\s*\d{1,2}\s*일/g, ' ')
      .replace(/\d{1,2}\s*\/\s*\d{1,2}\s*일/g, ' ')
      .replace(/(?:^|\s)\d{1,2}\s*일(?=\s|$)/g, ' ')
      .replace(/\d{1,2}\s*시(?:\s*\d{1,2}\s*분)?(?:에서|으로|에|로)?/g, ' ')
      .replace(/[AaBb]\s*반/g, ' ')
      .replace(/(?:시간표\s*)?메모(?:\s*내용)?(?:에|로|를|을)?/g, ' ')
      .replace(/(?:내용|문구)\s*[:：-]?\s*/g, ' ')
      .replace(addActionPattern(), ' ')
      .replace(/(?:(?:취소|삭제|제거|해제|없애)(?:\s*(?:좀|한번))?\s*(?:해)?(?:줘요|주세요|줘|줄래|해줘요|해주세요|해줘|해줄래|할래|해|요)?|(?:지워|지우|빼)(?:\s*(?:좀|한번))?\s*(?:줘요|주세요|줘|줄래|해줘요|해주세요|해줘|해줄래|할래|해|요)?)/g, ' ')
      .replace(/(?:이라고|라고|이라는|라는)/g, ' ')
      .replace(/(?:전부|모두|전체)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (studentName && stripped.indexOf(studentName) === 0) {
      stripped = stripped.slice(studentName.length).trim();
    }

    stripped = stripped
      .replace(/^(?:에|로|를|을|좀|한번)\s*/g, '')
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
      .trim();
    return stripped;
  }

  function hasScopedDateSignal(value) {
    const compact=compactText(value);
    return /(?:오늘|금일|내일|이번주|이번주간|금주|다음주|차주|다다음주|\d{1,2}월\d{1,2}일|\d{1,2}\/\d{1,2}일|(?:^|[^\d월])\d{1,2}일(?!요일))/.test(compact);
  }

  function parseClassLayoutMutationIntent(text) {
    const raw=cleanText(text);
    const compact=compactText(raw);
    if(!raw) return null;
    if(!/(?:변경|바꿔|바꾸|설정|전환|해줘|해주세요|해줄래|분리해|합쳐|합치)/.test(compact)) return null;
    const split=/(?:분반|분리)/.test(compact);
    const merge=/(?:합반|통합|합쳐|합치)/.test(compact);
    if(split===merge) return null;
    const division=detectDivision(compact);
    const dateSpec=parseDateExpression(compact);
    const timeSlot=firstTimeSlot(raw);
    if(!division || !dateSpec || !timeSlot) return null;
    return {
      type:'mutation',
      intent:'set_class_layout',
      division,
      split,
      dateSpec,
      dateLabel:dateSpec.label,
      timeSlot,
      timeMinute:firstTimeMinute(raw),
      originalText:raw
    };
  }

  function normalizeTeacherTargetName(value) {
    const name=cleanText(value)
      .replace(/(?:으로|로)$/,'')
      .replace(/[을를이가은는]$/,'')
      .trim();
    if(!name || /^(?:담당|담임|선생님|쌤|수업|오늘|내일)$/.test(name)) return '';
    return name;
  }

  function extractTeacherTargetName(value) {
    const raw=cleanText(value);
    let match=raw.match(/(?:담당\s*)?(?:선생님|담임|쌤)\s*(?:을|를)?\s*[:：]?\s*([가-힣A-Za-z0-9·ㆍ_-]{1,30})(?:\s*(?:선생님|쌤))?(?:으로|로)?/);
    let name=normalizeTeacherTargetName(match&&match[1]);
    if(name) return name;

    match=raw.match(/([가-힣A-Za-z0-9·ㆍ_-]{1,30})\s*(?:선생님|쌤)(?:으로|로)?/);
    name=normalizeTeacherTargetName(match&&match[1]);
    if(/^(?:\d{1,2}시|[ABab]반)$/.test(name)) return '';
    return name;
  }

  function parseTeacherAssignmentMutationIntent(text) {
    const raw=cleanText(text);
    const compact=compactText(raw);
    if(!raw || !/(?:선생님|담임|담당|쌤)/.test(compact)) return null;
    if(!/(?:배정|지정|변경|바꿔|바꾸|교체|해줘|해주세요|해줄래)/.test(compact)) return null;
    const teacherName=extractTeacherTargetName(raw);
    const division=detectDivision(compact);
    const dateSpec=parseDateExpression(compact);
    const mention=weekdayTimeMentions(raw)[0]||null;
    const weekday=Number(mention?.weekday || dateSpec?.weekday || 0);
    const timeSlot=firstTimeSlot(raw);
    const dateSpecific=hasScopedDateSignal(raw);
    if(!teacherName || !division || !timeSlot || (!dateSpecific && !weekday)) return null;
    return {
      type:'mutation',
      intent:dateSpecific?'set_teacher_override':'set_class_teacher',
      teacherName,
      division,
      weekday,
      dateSpec:dateSpecific?dateSpec:null,
      dateLabel:dateSpecific&&dateSpec?dateSpec.label:'',
      timeSlot,
      timeMinute:firstTimeMinute(raw),
      classGroup:firstClassGroup(raw),
      originalText:raw
    };
  }

  function parseSessionOrderMutationIntent(text) {
    const raw=cleanText(text);
    const compact=compactText(raw);
    if(!raw || !/(?:수업순서|순서|회차)/.test(compact)) return null;
    if(!/(?:변경|바꿔|바꾸|지정|설정|교체)/.test(compact)) return null;
    const orderMatch=raw.match(/([12])\s*(?:회차|번(?:째)?)/);
    const sessionOrder=Number(orderMatch&&orderMatch[1]||0);
    const mention=weekdayTimeMentions(raw)[0]||null;
    const dateSpec=parseDateExpression(compact);
    const weekday=Number(mention?.weekday || dateSpec?.weekday || 0);
    if(!sessionOrder || !weekday) return null;

    let stripped=stripCommonCommandParts(raw)
      .replace(/[12]\s*(?:회차|번(?:째)?)(?:으로|로)?/g,' ')
      .replace(/(?:수업\s*)?(?:순서|회차)/g,' ')
      .replace(/(?:변경|바꿔|바꾸|지정|설정|교체)(?:해줘요|해주세요|해줘|해줄래|할래|해|줘|주세요|어줘|아줘|어요|아요|기)?/g,' ')
      .replace(/(?:첫번째|두번째|첫째|둘째)/g,' ')
      .replace(/\s+/g,' ')
      .trim();
    const studentName=cleanupStudentName(stripped);
    if(!studentName) return null;
    return {
      type:'mutation',
      intent:'set_session_order',
      studentName,
      sessionOrder,
      weekday,
      timeSlot:firstTimeSlot(raw),
      timeMinute:firstTimeMinute(raw),
      classGroup:firstClassGroup(raw),
      dateSpec:hasScopedDateSignal(raw)?dateSpec:null,
      originalText:raw
    };
  }

  function parseNormalClassDayMutationIntent(text) {
    const raw=cleanText(text);
    const compact=compactText(raw);
    if(!raw || !hasScopedDateSignal(raw)) return null;
    const normal=/(?:정상수업|정상수업일|수업진행)/.test(compact);
    const holiday=/(?:휴원일|휴원|공휴일로|수업없음)/.test(compact);
    if(!normal && !holiday) return null;
    if(!/(?:변경|바꿔|바꾸|설정|전환|돌려|해줘|해주세요)/.test(compact)) return null;
    const dateSpec=parseDateExpression(compact);
    if(!dateSpec) return null;
    return {
      type:'mutation',
      intent:'set_normal_class_day',
      normalClass:normal,
      dateSpec,
      dateLabel:dateSpec.label,
      originalText:raw
    };
  }

  function parseTimetableMemoAddMutationIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    if (!raw || !/(?:시간표)?메모/.test(compact)) return null;
    if (!hasAddAction(compact) || hasRemoveAction(compact)) return null;

    const dateSpec = parseDateExpression(compact);
    return {
      type:'mutation',
      intent:'add_timetable_memo',
      division:detectDivision(compact),
      dateSpec,
      dateLabel:dateSpec ? dateSpec.label : '',
      timeSlot:firstTimeSlot(raw),
      timeMinute:firstTimeMinute(raw),
      classGroup:firstClassGroup(raw),
      studentName:extractTimetableMemoStudentName(raw),
      memoNote:extractTimetableMemoNote(raw),
      originalText:raw
    };
  }

  function parseTimetableMemoDeleteMutationIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    if (!raw || !/(?:시간표)?메모/.test(compact)) return null;
    if (!hasRemoveAction(compact)) return null;

    const dateSpec = parseDateExpression(compact);
    return {
      type:'mutation',
      intent:'delete_timetable_memo',
      division:detectDivision(compact),
      dateSpec,
      dateLabel:dateSpec ? dateSpec.label : '',
      timeSlot:firstTimeSlot(raw),
      timeMinute:firstTimeMinute(raw),
      classGroup:firstClassGroup(raw),
      studentName:extractTimetableMemoStudentName(raw),
      memoNote:extractTimetableMemoNote(raw),
      originalText:raw
    };
  }

  function parseAttendanceStatusMutationIntent(text) {
    const raw = cleanText(text);
    const compact = compactText(raw);
    if (!raw) return null;

    const hasAttendanceContext = /(?:출석부|출결부|출결상태|출석상태|출석체크)/.test(compact);
    if (!hasAttendanceContext) return null;

    const hasWriteAction = /(?:표시|변경|수정|바꿔|바꾸|체크|처리|기록|입력|저장|초기화|지워|지우|삭제|해제)/.test(compact);
    if (!hasWriteAction) return null;

    const stripped = compact
      .replace(/(?:출석부|출결부|출결상태|출석상태)/g, '');

    let status = '';
    if (/(?:빈칸|공란)/.test(stripped)
      || /(?:상태|표시).*(?:초기화|지워|지우|삭제|해제)/.test(stripped)
      || /(?:출석|결석|보강).*(?:지워|지우|삭제|해제)/.test(stripped)) {
      status = 'blank';
    } else if (/결석/.test(stripped)) {
      status = 'absent';
    } else if (/보강/.test(stripped)) {
      status = 'makeup';
    } else if (/(?:출석체크|출석)/.test(stripped)) {
      status = 'present';
    }
    if (!status) return null;

    const sessionKind = status === 'makeup'
      ? 'makeup'
      : (status === 'present' || status === 'absent'
        ? 'regular'
        : (/(?:보강|보충)/.test(stripped) ? 'makeup' : (/(?:정규|본수업)/.test(stripped) ? 'regular' : 'AUTO')));

    const dateSpec = parseDateExpression(compact);
    return {
      type:'mutation',
      intent:'set_attendance_status',
      status,
      sessionKind,
      dateSpec,
      dateLabel:dateSpec ? dateSpec.label : '',
      classHour:firstTimeSlot(raw),
      classMinute:/\d{1,2}\s*시\s*반/.test(raw)?30:firstTimeMinute(raw),
      classGroup:firstClassGroup(raw),
      originalText:raw
    };
  }

  function parseBatchDraftWriteIntent(text) {
    const raw=cleanText(text);
    if(!raw) return null;

    for(const intent of ['add_makeup','add_trial','add_waitlist']){
      const draft=parseCanonicalAddDraft(raw,intent);
      if(!draft) continue;
      return Object.assign({},draft,{
        batchDraft:true,
        missingBatchFields:[
          !draft.dateSpec ? 'date' : '',
          !Number(draft.timeSlot || 0) ? 'time' : ''
        ].filter(Boolean)
      });
    }

    return null;
  }

  function parseSingleWriteIntent(text) {
    const normalizedText = cleanText(text);
    return parseTimetableMemoDeleteMutationIntent(normalizedText)
      || parseTimetableMemoAddMutationIntent(normalizedText)
      || parseAbsenceMutationIntent(normalizedText)
      || parseTrialCancelMutationIntent(normalizedText)
      || parseMakeupCancelMutationIntent(normalizedText)
      || parseMoveCancelMutationIntent(normalizedText)
      || parseWaitlistCancelMutationIntent(normalizedText)
      || parsePickupCancelMutationIntent(normalizedText)
      || parsePickupUpdateMutationIntent(normalizedText)
      || parsePickupMutationIntent(normalizedText)
      || parseWaitlistUpdateMutationIntent(normalizedText)
      || parseTrialUpdateMutationIntent(normalizedText)
      || parseMakeupUpdateMutationIntent(normalizedText)
      || parseClassMutationIntent(normalizedText)
      || parseWaitlistMutationIntent(normalizedText)
      || parseTrialMutationIntent(normalizedText)
      || parseScheduleMoveMutationIntent(normalizedText)
      || parseMakeupMutationIntent(normalizedText);
  }

  function parseMultiWriteIntent(text) {
    const raw = cleanText(text);
    if (!raw) return null;
    const parts = raw.split(/\s*(?:;|그리고|그다음|그 다음|하고|\n)\s*[,，]?\s*/g).map(cleanText).filter(Boolean);
    if (parts.length < 2 || parts.length > 3) return null;
    const commands = parts.map(part => parseSingleWriteIntent(part) || parseBatchDraftWriteIntent(part));
    if (commands.some(item => !item)) return null;
    return { type:'mutation', intent:'batch_write', commands, originalText:raw };
  }

  function parseCanonicalAddDraft(text, intent) {
    const raw=cleanText(text);
    const compact=compactText(raw);
    const key=cleanText(intent);
    let targetPattern=null;
    if(key==='add_makeup' && hasMakeupWord(compact)){
      targetPattern=/(?:보강|보충(?:수업)?)(?:수업)?(?:으로|에|을|를|도)?/g;
    }else if(key==='add_trial' && hasTrialWord(compact)){
      targetPattern=/(?:체험\s*클래스|체험\s*수업|체험)(?:으로|에|을|를)?/g;
    }else if(key==='add_waitlist' && hasWaitlistWord(compact)){
      targetPattern=/(?:대기(?:자|명단|리스트)?|웨이팅(?:리스트)?)(?:에|로|을|를)?/g;
    }else{
      return null;
    }
    if(!hasAddAction(compact) || hasRemoveAction(compact)) return null;
    const studentName=extractStudentName(raw,targetPattern,addActionPattern());
    if(!studentName) return null;
    const dateSpec=parseDateExpression(compact);
    return {
      type:'mutation',
      intent:key,
      studentName,
      guestName:key==='add_trial' ? studentName : '',
      division:detectDivision(compact),
      dateSpec,
      dateLabel:dateSpec ? dateSpec.label : '',
      timeSlot:firstTimeSlot(raw),
      classGroup:firstClassGroup(raw),
      originalText:raw,
      canonicalDraft:true
    };
  }

  function interpretedIntentToStructuredCommand(intent, text) {
    const key=cleanText(intent);
    const raw=cleanText(text);
    if(!key || !raw) return null;
    const parsed=parseSingleWriteIntent(raw)
      || parseCanonicalAddDraft(raw,key);
    if(!parsed || cleanText(parsed.intent)!==key) return null;
    const dateExpression=cleanText(parsed.dateLabel || parsed.dateSpec?.label);
    return {
      action:key,
      studentName:cleanText(parsed.studentName || parsed.guestName),
      division:cleanText(parsed.division),
      dateExpression,
      timeSlot:Number(parsed.timeSlot || 0),
      classGroup:cleanText(parsed.classGroup).toUpperCase(),
      weekday:Number(parsed.weekday || 0),
      classTime:Number(parsed.classTime || 0),
      classMinute:Number(parsed.classMinute || parsed.timeMinute || 0),
      pickupKind:cleanText(parsed.pickupKind || (parsed.isDropoff ? 'dropoff' : '')),
      pickupLabel:cleanText(parsed.pickupLabel),
      pickupTime:cleanText(parsed.pickupTime),
      sourceDateExpression:cleanText(parsed.sourceDateExpression),
      sourceWeekday:Number(parsed.sourceWeekday || 0),
      sourceTimeSlot:Number(parsed.sourceTimeSlot || 0),
      sourceMinute:Number(parsed.sourceMinute || 0),
      sourceClassGroup:cleanText(parsed.sourceClassGroup).toUpperCase(),
      targetDateExpression:cleanText(parsed.targetDateExpression),
      targetWeekday:Number(parsed.targetWeekday || 0),
      targetTimeSlot:Number(parsed.targetTimeSlot || 0),
      targetMinute:Number(parsed.targetMinute || 0),
      targetClassGroup:cleanText(parsed.targetClassGroup).toUpperCase(),
      reason:cleanText(parsed.reason),
      memoNote:cleanText(parsed.memoNote)
    };
  }

  async function prepareInterpretedAction(intent, text, context) {
    const structured=interpretedIntentToStructuredCommand(intent,text);
    if(!structured) return {handled:false,kind:'pass_through',intent:cleanText(intent),payload:null};
    return prepareStructuredAction(structured,context);
  }

  function parseWriteIntent(text) {
    const normalizedText = cleanText(text);
    return parseMultiWriteIntent(normalizedText) || parseSingleWriteIntent(normalizedText);
  }

  const STRUCTURED_WRITE_DRAFT_REQUIRED_FIELDS = Object.freeze({
    add_makeup:Object.freeze(['student','date','time']),
    add_trial:Object.freeze(['student','date','time']),
    add_waitlist:Object.freeze(['student','date','time'])
  });

  function createStructuredWriteDraft(systemCommand) {
    const source = systemCommand && typeof systemCommand === 'object'
      ? systemCommand
      : {};
    const classGroup = cleanText(source.classGroup || source.class_group).toUpperCase();

    const sourceClassGroup=cleanText(source.sourceClassGroup || source.source_class_group).toUpperCase();
    const targetClassGroup=cleanText(source.targetClassGroup || source.target_class_group).toUpperCase();
    return Object.assign({}, source, {
      action:cleanText(source.action || source.targetIntent || source.intent),
      studentName:cleanText(source.studentName || source.student_name),
      division:cleanText(source.division),
      dateExpression:cleanText(source.dateExpression || source.date_expression),
      timeSlot:Number(source.timeSlot || source.time_slot || 0),
      classGroup:/^[AB]$/.test(classGroup) ? classGroup : '',
      oneTimeSessionId:cleanText(source.oneTimeSessionId || source.one_time_session_id),
      sourceDateExpression:cleanText(source.sourceDateExpression || source.source_date_expression),
      sourceTimeSlot:Number(source.sourceTimeSlot || source.source_time_slot || 0),
      sourceMinute:Number(source.sourceMinute || source.source_minute || 0),
      sourceClassGroup:/^[AB]$/.test(sourceClassGroup) ? sourceClassGroup : '',
      targetDateExpression:cleanText(source.targetDateExpression || source.target_date_expression),
      targetTimeSlot:Number(source.targetTimeSlot || source.target_time_slot || 0),
      targetMinute:Number(source.targetMinute || source.target_minute || 0),
      targetClassGroup:/^[AB]$/.test(targetClassGroup) ? targetClassGroup : '',
      targetTimeStored:source.targetTimeStored===true,
      reason:cleanText(source.reason)
    });
  }

  function hasStructuredWriteDraftField(draft, field) {
    if (!draft || typeof draft !== 'object') return false;
    if (field === 'student') return !!cleanText(draft.studentName);
    if (field === 'date') return !!cleanText(draft.dateExpression);
    if (field === 'time') return Number(draft.timeSlot || 0) > 0;
    if (field === 'class_group') return /^[AB]$/.test(cleanText(draft.classGroup).toUpperCase());
    if (field === 'division') return !!cleanText(draft.division);
    if (field === 'reason') return !!cleanText(draft.reason);
    return false;
  }

  function getStructuredWriteDraftState(systemCommand) {
    const draft = createStructuredWriteDraft(systemCommand);
    const requiredFields = STRUCTURED_WRITE_DRAFT_REQUIRED_FIELDS[draft.action] || null;
    if (!requiredFields) {
      return {
        supported:false,
        draft,
        requiredFields:[],
        missingFields:[],
        nextField:'',
        complete:false
      };
    }

    const missingFields = requiredFields.filter(field => !hasStructuredWriteDraftField(draft, field));
    return {
      supported:true,
      draft,
      requiredFields:requiredFields.slice(),
      missingFields,
      nextField:missingFields[0] || '',
      complete:missingFields.length === 0
    };
  }

  function updateStructuredWriteDraft(systemCommand, field, value) {
    const draft = createStructuredWriteDraft(systemCommand);
    const key = cleanText(field);

    if (key === 'student') draft.studentName = cleanText(value);
    else if (key === 'date') draft.dateExpression = cleanText(value);
    else if (key === 'time') draft.timeSlot = Number(value || 0);
    else if (key === 'class_group') {
      const classGroup = cleanText(value).toUpperCase();
      draft.classGroup = /^[AB]$/.test(classGroup) ? classGroup : '';
    } else if (key === 'division') draft.division = cleanText(value);
    else if (key === 'reason') draft.reason = cleanText(value);

    return createStructuredWriteDraft(draft);
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

  function structuredTargetChoiceResult(action, command, prepared) {
    const choices=Array.isArray(prepared && prepared.choices)
      ? prepared.choices
        .map(item=>({
          id:cleanText(item && item.id),
          label:cleanText(item && item.label)
        }))
        .filter(item=>item.id && item.label)
      : [];
    if(choices.length<2) return null;
    const draft=createStructuredWriteDraft(command);
    const payload={
      type:'structured_write_draft',
      targetIntent:action,
      field:'target_choice',
      missingFields:['target_choice'],
      draft,
      choices,
      choiceKey:cleanText(prepared && prepared.choiceKey)
    };
    return {
      handled:true,
      kind:'action_needs_field',
      intent:action,
      text:'',
      message:String(prepared && prepared.message || '대상을 선택해 주세요.'),
      clearInput:true,
      payload,
      action:{
        status:'pending_fields',
        intent:action,
        field:'target_choice',
        missingFields:['target_choice'],
        command:Object.assign({},draft),
        choices:choices.map(item=>Object.assign({},item)),
        requiresReason:false
      }
    };
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
    if (!raw || isExplicitWriteCommand(compact)) return null;

    const signals = olliReplyTemporalSignals(raw);
    const temporalCount = [signals.date, signals.weekday, signals.time].filter(Boolean).length;
    const hasShortAvailabilityCombination = temporalCount >= 1 && hasShortScheduleTarget(compact);

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
      || hasDirectPossibleQuestion
      || hasShortAvailabilityCombination;

    const asksForLookup =
      /알려|찾아|보여|확인|체크|봐줘|봐|조회/.test(compact)
      || /있어|있나|있나요|있니|있을까|있습니까/.test(compact)
      || /가능해|가능한|가능한가|가능한지|가능할까|가능할까요|가능하니/.test(compact)
      || /남는|남아|남았/.test(compact)
      || /여유|비어|몇자리|몇명|몇시/.test(compact);

    if (
      (!hasAvailabilityMeaning && !hasScheduleMeaning && !hasDirectScheduleShorthand)
      || (!asksForLookup && !hasDirectScheduleShorthand && !hasShortAvailabilityCombination)
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


  function parseStudentSchedulePeriodSpec(text) {
    const compact=compactText(text);
    if(/(?:지난주|저번주|전주)/.test(compact)) return {mode:'previous_week',label:'지난주'};
    if(/(?:다다음주)/.test(compact)) return {mode:'week_after_next',label:'다다음 주'};
    if(/(?:다음주|차주)/.test(compact)) return {mode:'next_week',label:'다음 주'};
    if(/(?:이번주|이번주간|금주)/.test(compact)) return {mode:'current_week',label:'이번 주'};
    return parseDateExpression(compact);
  }

  function resolveStudentScheduleReferenceDate(spec, baseDate) {
    const base=baseDate instanceof Date ? new Date(baseDate.getTime()) : new Date(baseDate || Date.now());
    if(Number.isNaN(base.getTime())) return null;
    base.setHours(12,0,0,0);
    if(!spec) return base;
    if(spec.mode==='previous_week') return addDays(base,-7);
    if(spec.mode==='current_week') return base;
    if(spec.mode==='next_week') return addDays(base,7);
    if(spec.mode==='week_after_next') return addDays(base,14);
    return resolveDateExpression(spec,base);
  }

  function parseStudentScheduleQueryIntent(text) {
    const raw=cleanText(text);
    const compact=compactText(raw);
    if(!raw || isExplicitWriteCommand(raw)) return null;

    const asksSchedule=
      /시간표/.test(compact)
      || /(?:정규)?수업.*(?:언제|요일|몇시|시간|스케줄|알려|보여|확인|조회)/.test(compact)
      || /(?:언제|요일|몇시|시간|스케줄|알려|보여|확인|조회).*(?:정규)?수업/.test(compact);
    if(!asksSchedule) return null;

    const withoutPeriod=raw
      .replace(/(?:지난|저번|이번|다음|다다음|전)\s*주(?:간)?/g,' ')
      .replace(/\s+/g,' ')
      .trim();
    let studentName=extractStudentName(
      withoutPeriod,
      /(?:정규\s*)?수업(?:시간|요일|스케줄)?|시간표|스케줄/g,
      /(?:알려(?:줘|주세요|줄래|줘요)?|보여(?:줘|주세요|줄래|줘요)?|확인(?:해줘|해주세요|해|해요)?|조회(?:해줘|해주세요|해|해요)?|언제(?:야|예요|인가요)?|몇\s*시(?:야|예요|인가요)?)/g
    );
    studentName=cleanText(studentName)
      .replace(/(?:님|님의)$/,'')
      .trim();
    if(!studentName) return null;

    const dateSpec=parseStudentSchedulePeriodSpec(raw);
    return {
      type:'query',
      intent:'get_student_schedule',
      studentName,
      dateSpec,
      dateLabel:dateSpec ? cleanText(dateSpec.label) : '현재',
      originalText:raw,
    };
  }

  function parseQueryIntent(text) {
    const normalizedText = cleanText(text);
    return parseStudentScheduleQueryIntent(normalizedText)
      || parseMultiQueryIntent(normalizedText)
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
    const routeContext = normalizeContext(context);
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


    if (queryIntent.intent === 'get_student_schedule') {
      if (
        typeof schedule.findStudentSchedule !== 'function'
        || typeof schedule.describeStudentSchedule !== 'function'
      ) {
        return {
          handled:true,
          kind:'command_result',
          intent:queryIntent.intent,
          text:normalizedText,
          message:'학생 시간표 조회 기능을 아직 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
          clearInput:true,
          payload:queryIntent
        };
      }

      try {
        const referenceDate=resolveStudentScheduleReferenceDate(queryIntent.dateSpec,new Date());
        if(!referenceDate) throw new Error('시간표 기준 날짜를 해석하지 못했습니다.');
        const result=await schedule.findStudentSchedule({
          studentName:queryIntent.studentName,
          selectedStudent:routeContext.selectedStudent,
          referenceDate,
          dateLabel:queryIntent.dateLabel || '현재',
        });
        return {
          handled:true,
          kind:'command_result',
          intent:queryIntent.intent,
          text:normalizedText,
          message:schedule.describeStudentSchedule(result),
          clearInput:true,
          payload:Object.assign({},queryIntent,{result})
        };
      } catch (error) {
        console.warn('올리 학생 시간표 조회 실패:',error);
        return {
          handled:true,
          kind:'command_result',
          intent:queryIntent.intent,
          text:normalizedText,
          message:'학생 시간표를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
          clearInput:true,
          payload:queryIntent
        };
      }
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


  function structuredReadMatchesParsed(command,parsed){
    const action=cleanText(command?.action);
    if(!parsed||action!==cleanText(parsed.intent)) return false;

    const division=cleanText(command?.division);
    const parsedDivision=cleanText(parsed?.division);
    if(division!==parsedDivision) return false;

    const classGroup=cleanText(command?.class_group || command?.classGroup).toUpperCase();
    const parsedGroup=cleanText(parsed?.classGroup).toUpperCase();
    if(classGroup!==parsedGroup) return false;

    if(action==='find_available_slots'){
      if(Number(command?.weekday||0)!==Number(parsed?.weekday||0)) return false;
      if(Number(command?.time_slot||command?.timeSlot||0)!==Number(parsed?.timeSlot||0)) return false;
      const purpose=cleanText(command?.availability_purpose || command?.availabilityPurpose) || 'unknown';
      if(purpose!==(cleanText(parsed?.purpose)||'unknown')) return false;
      const hasDate=!!cleanText(command?.date_expression || command?.dateExpression);
      if((parsed?.scope==='date'||parsed?.scope==='week')!==hasDate) return false;
      return true;
    }

    if(action==='find_roster_entries'){
      if(cleanText(command?.roster_kind || command?.rosterKind)!==cleanText(parsed?.rosterKind)) return false;
      if(Number(command?.weekday||0)!==Number(parsed?.weekday||0)) return false;
      if(Number(command?.time_slot||command?.timeSlot||0)!==Number(parsed?.timeSlot||0)) return false;
      const hasDate=!!cleanText(command?.date_expression || command?.dateExpression);
      if(parsed?.scope==='date'&&!hasDate) return false;
      if(parsed?.scope==='all'&&hasDate) return false;
      return true;
    }

    if(action==='find_pickups'){
      if(Number(command?.class_time||command?.classTime||0)!==Number(parsed?.classTime||0)) return false;
      const kind=cleanText(command?.pickup_kind || command?.pickupKind);
      const expectedKind=parsed?.kind==='dropoff'?'dropoff':(parsed?.kind==='pickup'?'arrival':'');
      if(kind!==expectedKind) return false;
      return !!cleanText(command?.date_expression || command?.dateExpression);
    }

    return false;
  }

  async function runStructuredMultiQuery(systemCommands,sourceText,context){
    const commands=Array.isArray(systemCommands)?systemCommands.slice(0,3):[];
    const parsed=parseQueryIntent(sourceText);
    const queries=parsed?.intent==='multi_read_query'&&Array.isArray(parsed.queries)
      ? parsed.queries
      : [];

    if(commands.length<2||commands.length>3||queries.length!==commands.length){
      return {
        handled:true,
        kind:'command_result',
        intent:'multi_read_query',
        text:'',
        message:'복합 조회 구조가 원문과 일치하지 않아 실행하지 않았어요. 요청을 조금 더 구체적으로 알려 주세요.',
        clearInput:true,
        payload:{commands}
      };
    }

    for(let index=0;index<commands.length;index+=1){
      if(!structuredReadMatchesParsed(commands[index],queries[index])){
        return {
          handled:true,
          kind:'command_result',
          intent:'multi_read_query',
          text:'',
          message:'복합 조회 구조가 원문과 일치하지 않아 실행하지 않았어요. 요청을 조금 더 구체적으로 알려 주세요.',
          clearInput:true,
          payload:{commands}
        };
      }
    }

    const results=[];
    for(const command of commands){
      const result=await runStructuredQuery(command,context);
      if(!result||result.handled!==true){
        return {
          handled:true,
          kind:'command_result',
          intent:'multi_read_query',
          text:'',
          message:'요청한 조회 항목을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
          clearInput:true,
          payload:{commands,results}
        };
      }
      results.push(result);
    }

    return {
      handled:true,
      kind:'command_result',
      intent:'multi_read_query',
      text:'',
      message:results.map(item=>cleanText(item.message)).filter(Boolean).join('\n\n'),
      clearInput:true,
      payload:{commands,results}
    };
  }

  async function runSuggestedQuery(text, context) {
    const normalizedText = cleanText(text);
    if (!isOlliReplyCandidate(normalizedText)) return passThrough(normalizedText);
    if (parseQueryIntent(normalizedText)) {
      return runQuery(normalizedText, context);
    }
    return runQuery(normalizedText + ' 시간표 보여줘', context);
  }

  function resolveWriteIntentOptions(writeIntent, routeContext) {
    const options = Object.assign({}, writeIntent, {
      selectedStudent:routeContext.selectedStudent || null,
      effectiveDate:new Date()
    });
    if (writeIntent.dateSpec) {
      options.date = resolveDateExpression(writeIntent.dateSpec, new Date());
      if (!options.date) throw new Error('날짜를 해석하지 못했습니다.');
    }
    if (writeIntent.intent === 'batch_write') {
      options.commands = (writeIntent.commands || []).map(item => resolveWriteIntentOptions(item, routeContext));
    }
    return options;
  }


  async function runStructuredQuery(systemCommand, context) {
    const command=systemCommand && typeof systemCommand==='object' ? systemCommand : {};
    const action=cleanText(command.action);
    const supported=new Set(['get_student_schedule','find_available_slots','find_roster_entries','find_pickups']);
    if(!supported.has(action)){
      return {
        handled:false,
        kind:'pass_through',
        intent:action,
        text:'',
        message:'',
        clearInput:false,
        payload:null
      };
    }

    const routeContext=normalizeContext(context);
    const schedule=global.OlliCommandSchedule;

    if(action==='find_pickups'){
      if(
        !schedule
        || typeof schedule.findPickups!=='function'
        || typeof schedule.describePickups!=='function'
      ){
        return {
          handled:true,
          kind:'command_result',
          intent:'find_pickups',
          text:'',
          message:'픽업 조회 기능을 아직 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
          clearInput:true,
          payload:command
        };
      }

      const studentName=cleanText(command.student_name || command.studentName);
      const dateExpression=cleanText(command.date_expression || command.dateExpression);
      const classTime=Number(command.class_time || command.classTime || 0);
      const pickupKind=cleanText(command.pickup_kind || command.pickupKind);
      const kind=pickupKind==='dropoff' ? 'dropoff' : (pickupKind==='arrival' ? 'pickup' : 'all');

      try{
        const dateSpec=dateExpression
          ? parseDateExpression(compactText(dateExpression))
          : {mode:'today',label:'오늘'};
        if(!dateSpec) throw new Error('조회 날짜를 해석하지 못했습니다.');
        const targetDate=resolveDateExpression(dateSpec,new Date());
        if(!targetDate) throw new Error('조회 날짜를 해석하지 못했습니다.');
        const dateLabel=cleanText(dateSpec.label) || (dateExpression || '오늘');

        const result=await schedule.findPickups({
          date:targetDate,
          dateLabel,
          studentName,
          classTime,
          kind
        });
        return {
          handled:true,
          kind:'command_result',
          intent:'find_pickups',
          text:'',
          message:schedule.describePickups(result),
          clearInput:true,
          payload:{
            action:'find_pickups',
            studentName,
            dateExpression,
            dateLabel,
            classTime,
            pickupKind,
            kind,
            result
          }
        };
      }catch(error){
        console.warn('올리 구조화 픽업 조회 실패:',error);
        return {
          handled:true,
          kind:'command_result',
          intent:'find_pickups',
          text:'',
          message:'픽업 일정을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
          clearInput:true,
          payload:command
        };
      }
    }

    if(action==='find_roster_entries'){
      if(
        !schedule
        || typeof schedule.findRosterEntries!=='function'
        || typeof schedule.describeRosterEntries!=='function'
      ){
        return {
          handled:true,
          kind:'command_result',
          intent:'find_roster_entries',
          text:'',
          message:'학생 명단 조회 기능을 아직 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
          clearInput:true,
          payload:command
        };
      }

      const rosterKind=cleanText(command.roster_kind || command.rosterKind);
      const allowedKinds=['class_roster','absence','makeup','trial','waitlist','move'];
      if(!allowedKinds.includes(rosterKind)){
        return {
          handled:true,
          kind:'command_result',
          intent:'find_roster_entries',
          text:'',
          message:'확인할 명단 종류를 알려주세요.',
          clearInput:true,
          payload:command
        };
      }

      const dateExpression=cleanText(command.date_expression || command.dateExpression);
      const division=cleanText(command.division);
      const weekday=Number(command.weekday || 0);
      const timeSlot=Number(command.time_slot || command.timeSlot || 0);
      const classGroup=cleanText(command.class_group || command.classGroup).toUpperCase();

      try{
        const compact=compactText(dateExpression);
        const weekOnly=/^(?:이번주|이번주간|금주|다음주|차주|다다음주)$/.test(compact);
        let scope='date';
        let dateLabel='오늘';
        let weekOffset=0;
        let referenceDate=new Date();

        if(weekOnly){
          scope='week';
          weekOffset=/다다음주/.test(compact) ? 2 : (/(?:다음주|차주)/.test(compact) ? 1 : 0);
          dateLabel=weekOffset===2 ? '다다음 주' : (weekOffset===1 ? '다음 주' : '이번 주');
          referenceDate=addDays(new Date(),weekOffset*7);
        }else if(dateExpression){
          const dateSpec=parseDateExpression(compact);
          if(!dateSpec) throw new Error('조회 날짜를 해석하지 못했습니다.');
          referenceDate=resolveDateExpression(dateSpec,new Date());
          if(!referenceDate) throw new Error('조회 날짜를 해석하지 못했습니다.');
          scope='date';
          dateLabel=cleanText(dateSpec.label) || dateExpression;
        }else if(rosterKind==='waitlist' || rosterKind==='move'){
          scope='all';
          dateLabel='현재';
        }else if(weekday){
          const weekdayNames=['','월요일','화요일','수요일','목요일','금요일','토요일'];
          const dateSpec=parseDateExpression(weekdayNames[weekday] || '');
          referenceDate=resolveDateExpression(dateSpec,new Date());
          if(!referenceDate) throw new Error('조회 요일을 해석하지 못했습니다.');
          scope='date';
          dateLabel=weekdayNames[weekday];
        }

        const result=await schedule.findRosterEntries({
          kind:rosterKind,
          scope,
          date:referenceDate,
          dateLabel,
          division,
          timeSlot,
          classGroup:/^[AB]$/.test(classGroup) ? classGroup : '',
          weekday
        });
        return {
          handled:true,
          kind:'command_result',
          intent:'find_roster_entries',
          text:'',
          message:schedule.describeRosterEntries(result),
          clearInput:true,
          payload:{
            action:'find_roster_entries',
            rosterKind,
            scope,
            dateExpression,
            dateLabel,
            weekOffset,
            weekday,
            division,
            timeSlot,
            classGroup:/^[AB]$/.test(classGroup) ? classGroup : '',
            result
          }
        };
      }catch(error){
        console.warn('올리 구조화 학생 명단 조회 실패:',error);
        return {
          handled:true,
          kind:'command_result',
          intent:'find_roster_entries',
          text:'',
          message:'학생 명단을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
          clearInput:true,
          payload:command
        };
      }
    }

    if(action==='find_available_slots'){
      if(
        !schedule
        || typeof schedule.findAvailableSlots!=='function'
        || typeof schedule.findWeekAvailability!=='function'
        || typeof schedule.findRecurringAvailability!=='function'
      ){
        return {
          handled:true,
          kind:'command_result',
          intent:'find_available_slots',
          text:'',
          message:'시간표 빈자리 조회 기능을 아직 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
          clearInput:true,
          payload:command
        };
      }

      const dateExpression=cleanText(command.date_expression || command.dateExpression);
      const division=cleanText(command.division);
      const weekday=Number(command.weekday || 0);
      const timeSlot=Number(command.time_slot || command.timeSlot || 0);
      const classGroup=cleanText(command.class_group || command.classGroup).toUpperCase();
      const purposeRaw=cleanText(command.availability_purpose || command.availabilityPurpose);
      const purpose=['makeup','trial','schedule_move','new_enrollment'].includes(purposeRaw)
        ? purposeRaw
        : 'unknown';

      try{
        const compact=compactText(dateExpression);
        const weekOnly=/^(?:이번주|이번주간|금주|다음주|차주|다다음주)$/.test(compact);
        let result;
        let message;
        let scope='recurring';
        let dateLabel='';
        let weekOffset=0;

        if(weekOnly){
          scope='week';
          weekOffset=/다다음주/.test(compact) ? 2 : (/(?:다음주|차주)/.test(compact) ? 1 : 0);
          dateLabel=weekOffset===2 ? '다다음 주' : (weekOffset===1 ? '다음 주' : '이번 주');
          result=await schedule.findWeekAvailability({
            date:new Date(),
            weekOffset,
            dateLabel,
            division,
            purpose,
            viewMode:'availability',
            timeSlot,
            classGroup:/^[AB]$/.test(classGroup) ? classGroup : ''
          });
          message=typeof schedule.describeWeekAvailability==='function'
            ? schedule.describeWeekAvailability(result)
            : '주간 빈자리를 확인했어요.';
        }else if(dateExpression){
          scope='date';
          const dateSpec=parseDateExpression(compact);
          if(!dateSpec) throw new Error('조회 날짜를 해석하지 못했습니다.');
          const targetDate=resolveDateExpression(dateSpec,new Date());
          if(!targetDate) throw new Error('조회 날짜를 해석하지 못했습니다.');
          dateLabel=cleanText(dateSpec.label);
          result=await schedule.findAvailableSlots({
            date:targetDate,
            dateLabel,
            division,
            purpose,
            viewMode:'availability',
            timeSlot,
            classGroup:/^[AB]$/.test(classGroup) ? classGroup : ''
          });
          message=typeof schedule.describeAvailableSlots==='function'
            ? schedule.describeAvailableSlots(result)
            : '시간표 빈자리를 확인했어요.';
        }else{
          scope='recurring';
          const weekdayNames=['','월요일','화요일','수요일','목요일','금요일','토요일'];
          dateLabel=weekday>=1 && weekday<=6 ? weekdayNames[weekday] : '';
          result=await schedule.findRecurringAvailability({
            date:new Date(),
            weekday,
            division,
            purpose,
            viewMode:'availability',
            timeSlot,
            classGroup:/^[AB]$/.test(classGroup) ? classGroup : ''
          });
          message=typeof schedule.describeRecurringAvailability==='function'
            ? schedule.describeRecurringAvailability(result)
            : '정규수업 기준 빈자리를 확인했어요.';
        }

        return {
          handled:true,
          kind:'command_result',
          intent:'find_available_slots',
          text:'',
          message,
          clearInput:true,
          payload:{
            action:'find_available_slots',
            scope,
            dateExpression,
            dateLabel,
            weekOffset,
            weekday,
            division,
            purpose,
            timeSlot,
            classGroup:/^[AB]$/.test(classGroup) ? classGroup : '',
            result
          }
        };
      }catch(error){
        console.warn('올리 구조화 빈자리 조회 실패:',error);
        return {
          handled:true,
          kind:'command_result',
          intent:'find_available_slots',
          text:'',
          message:'시간표 빈자리를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
          clearInput:true,
          payload:command
        };
      }
    }

    const studentName=cleanText(command.student_name || command.studentName);
    const dateExpression=cleanText(command.date_expression || command.dateExpression);
    if(!studentName){
      return {
        handled:true,
        kind:'command_result',
        intent:'get_student_schedule',
        text:'',
        message:'시간표를 확인할 학생 이름을 알려주세요.',
        clearInput:true,
        payload:command
      };
    }
    if(
      !schedule
      || typeof schedule.findStudentSchedule!=='function'
      || typeof schedule.describeStudentSchedule!=='function'
    ){
      return {
        handled:true,
        kind:'command_result',
        intent:'get_student_schedule',
        text:'',
        message:'학생 시간표 조회 기능을 아직 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
        clearInput:true,
        payload:command
      };
    }

    try{
      const dateSpec=dateExpression ? parseStudentSchedulePeriodSpec(dateExpression) : null;
      const referenceDate=resolveStudentScheduleReferenceDate(dateSpec,new Date());
      if(!referenceDate) throw new Error('시간표 기준 날짜를 해석하지 못했습니다.');
      const result=await schedule.findStudentSchedule({
        studentName,
        selectedStudent:routeContext.selectedStudent || null,
        referenceDate,
        dateLabel:dateSpec ? cleanText(dateSpec.label) : '현재'
      });
      return {
        handled:true,
        kind:'command_result',
        intent:'get_student_schedule',
        text:'',
        message:schedule.describeStudentSchedule(result),
        clearInput:true,
        payload:{
          action:'get_student_schedule',
          studentName,
          dateExpression,
          result
        }
      };
    }catch(error){
      console.warn('올리 구조화 학생 시간표 조회 실패:',error);
      return {
        handled:true,
        kind:'command_result',
        intent:'get_student_schedule',
        text:'',
        message:'학생 시간표를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
        clearInput:true,
        payload:command
      };
    }
  }


  async function prepareStructuredAction(systemCommand, context) {
    let command = systemCommand && typeof systemCommand === 'object'
      ? Object.assign({},systemCommand)
      : {};
    const action = cleanText(command.action);
    const routeContext = normalizeContext(context);
    const schedule = global.OlliCommandSchedule;
    const supported = new Set(['add_makeup','update_makeup','add_trial','update_trial','add_waitlist','cancel_waitlist','add_pickup','update_pickup','cancel_pickup','move_class','mark_absent']);

    if (!supported.has(action)) {
      return {
        handled:false,
        kind:'pass_through',
        intent:action,
        text:'',
        message:'',
        clearInput:false,
        payload:null,
        action:null
      };
    }

    let writeDraftState = getStructuredWriteDraftState(command);
    if (
      (writeDraftState.supported || ['update_makeup','cancel_waitlist','update_pickup','cancel_pickup'].includes(action))
      && cleanText(writeDraftState.draft.studentName)
      && schedule
      && typeof schedule.resolveStructuredStudentReference === 'function'
    ) {
      const studentReference=await schedule.resolveStructuredStudentReference({
        action,
        studentName:writeDraftState.draft.studentName,
        division:writeDraftState.draft.division,
        selectedStudent:routeContext.selectedStudent || null
      });

      if(studentReference?.code==='student_choice_required'){
        const choices=Array.isArray(studentReference.choices)
          ? studentReference.choices.map(item=>Object.assign({},item))
          : [];
        const payload={
          type:'structured_write_draft',
          targetIntent:action,
          field:'student_choice',
          missingFields:['student_choice'].concat(writeDraftState.missingFields.slice()),
          draft:Object.assign({},writeDraftState.draft),
          choices
        };
        return {
          handled:true,
          kind:'action_needs_field',
          intent:action,
          text:'',
          message:String(studentReference.message || writeDraftState.draft.studentName+' 학생이 여러 명 있어요. 학생을 선택해 주세요.'),
          clearInput:true,
          payload,
          action:{
            status:'pending_fields',
            intent:action,
            field:'student_choice',
            missingFields:payload.missingFields.slice(),
            command:Object.assign({},writeDraftState.draft),
            choices:choices.map(item=>Object.assign({},item)),
            requiresReason:false
          }
        };
      }

      if(studentReference?.ok===false){
        return {
          handled:true,
          kind:'action_rejected',
          intent:action,
          text:'',
          message:String(studentReference.message || '학생 정보를 확인하지 못했어요.'),
          clearInput:true,
          payload:command,
          action:null
        };
      }

      if(studentReference?.ok===true && studentReference?.matched===true){
        let resolvedDraft=updateStructuredWriteDraft(
          writeDraftState.draft,
          'student',
          studentReference.studentName
        );
        if(cleanText(studentReference.division)){
          resolvedDraft=updateStructuredWriteDraft(resolvedDraft,'division',studentReference.division);
        }
        command=Object.assign({},command,resolvedDraft,{
          student_name:resolvedDraft.studentName,
          date_expression:resolvedDraft.dateExpression,
          time_slot:resolvedDraft.timeSlot,
          class_group:resolvedDraft.classGroup
        });
        writeDraftState=getStructuredWriteDraftState(command);
      }
    }

    if (writeDraftState.supported && !writeDraftState.complete) {
      let field = writeDraftState.nextField;
      const noun = action === 'add_trial'
        ? '체험 등록'
        : (action === 'add_waitlist' ? '대기 등록' : '보강 등록');
      let draft=Object.assign({},writeDraftState.draft);
      let choices=[];
      let message = field === 'student'
        ? noun + '할 학생을 알려주세요.'
        : (field === 'date'
          ? noun + '할 날짜를 선택해 주세요.'
          : (field === 'time'
            ? noun + '할 시간을 선택해 주세요.'
            : noun + '에 필요한 정보를 알려주세요.'));

      if(field==='time'){
        if(!schedule || typeof schedule.prepareStructuredTimeChoices!=='function'){
          return {
            handled:true,
            kind:'action_rejected',
            intent:action,
            text:'',
            message:'시간표 시간 선택 기능을 아직 불러오지 못했어요.',
            clearInput:true,
            payload:command,
            action:null
          };
        }
        const dateSpec=parseDateExpression(compactText(draft.dateExpression));
        const date=dateSpec ? resolveDateExpression(dateSpec,new Date()) : null;
        if(!date){
          return {
            handled:true,
            kind:'action_rejected',
            intent:action,
            text:'',
            message:'선택한 날짜를 해석하지 못했어요. 날짜를 다시 선택해 주세요.',
            clearInput:true,
            payload:command,
            action:null
          };
        }
        const timeChoices=await schedule.prepareStructuredTimeChoices({
          action,
          studentName:draft.studentName,
          division:draft.division,
          date,
          dateLabel:cleanText(dateSpec.label),
          selectedStudent:routeContext.selectedStudent || null
        });
        if(!timeChoices?.ok){
          if(timeChoices?.code==='division_required'){
            if(action==='add_makeup'){
              return {
                handled:true,
                kind:'action_rejected',
                intent:action,
                text:'',
                message:draft.studentName+' 학생정보에서 유치부·초등부 구분을 확인하지 못했어요. 학생정보를 확인해 주세요.',
                clearInput:true,
                payload:command,
                action:null
              };
            }
            field='division';
            choices=Array.isArray(timeChoices.choices) ? timeChoices.choices.slice() : ['kinder','elementary'];
            message=String(timeChoices.message || draft.studentName+' 학생은 유치부인지 초등부인지 선택해 주세요.');
          }else{
            return {
              handled:true,
              kind:'action_rejected',
              intent:action,
              text:'',
              message:String(timeChoices?.message || '선택 가능한 수업 시간을 확인하지 못했어요.'),
              clearInput:true,
              payload:command,
              action:null
            };
          }
        }else{
          const absoluteDateExpression=(date.getMonth()+1)+'월 '+date.getDate()+'일';
          draft=updateStructuredWriteDraft(draft,'date',absoluteDateExpression);
          draft=updateStructuredWriteDraft(draft,'division',timeChoices.division);
          choices=Array.isArray(timeChoices.choices)
            ? timeChoices.choices.map(item=>Object.assign({},item))
            : [];
          message=String(timeChoices.message || noun+'할 시간을 선택해 주세요.');
        }
      }

      const dynamicMissingFields=field==='division'
        ? ['division'].concat(writeDraftState.missingFields.filter(item=>item!=='division'))
        : writeDraftState.missingFields.slice();
      const payload = {
        type:'structured_write_draft',
        targetIntent:action,
        field,
        missingFields:dynamicMissingFields,
        draft,
        choices
      };

      return {
        handled:true,
        kind:'action_needs_field',
        intent:action,
        text:'',
        message,
        clearInput:true,
        payload,
        action:{
          status:'pending_fields',
          intent:action,
          field,
          missingFields:dynamicMissingFields.slice(),
          command:Object.assign({},draft),
          choices:choices.map(item=>typeof item==='object' ? Object.assign({},item) : item),
          requiresReason:false
        }
      };
    }

    if (action === 'move_class') {
      const studentName=cleanText(command.student_name || command.studentName);
      const sourceWeekday=Number(command.source_weekday || command.sourceWeekday || 0);
      const sourceTimeSlot=Number(command.source_time_slot || command.sourceTimeSlot || 0);
      const sourceEnrollmentId=cleanText(command.source_enrollment_id || command.sourceEnrollmentId);
      const targetWeekday=Number(command.target_weekday || command.targetWeekday || 0);
      const targetTimeSlot=Number(command.target_time_slot || command.targetTimeSlot || 0);
      const classGroup=cleanText(command.class_group || command.classGroup).toUpperCase();

      if (!schedule || typeof schedule.prepareWriteCommand !== 'function') {
        return {
          handled:true, kind:'action_rejected', intent:'move_class', text:'',
          message:'시간표 작업 준비 기능을 아직 불러오지 못했어요.',
          clearInput:true, payload:command, action:null
        };
      }

      try {
        const prepared=await schedule.prepareWriteCommand('move_class',{
          type:'mutation',
          intent:'move_class',
          studentName,
          sourceWeekday,
          sourceTimeSlot,
          sourceEnrollmentId,
          targetWeekday,
          targetTimeSlot,
          classGroup:/^[AB]$/.test(classGroup) ? classGroup : '',
          selectedStudent:routeContext.selectedStudent || null,
          effectiveDate:new Date(),
          originalText:''
        });

        if (prepared?.code === 'target_choice_required') {
          const choiceResult=structuredTargetChoiceResult('move_class',command,prepared);
          if(choiceResult) return choiceResult;
        }

        if (prepared?.code === 'class_group_required' && prepared?.commandDraft) {
          const choicePayload=Object.assign({},prepared.commandDraft,{
            intent:'choose_move_group',
            targetIntent:'move_class'
          });
          return {
            handled:true,
            kind:'action_choice',
            intent:'choose_move_group',
            text:'',
            message:String(prepared.message || '이동할 반을 선택해 주세요.'),
            clearInput:true,
            payload:choicePayload,
            action:{
              status:'pending_choice',
              intent:'choose_move_group',
              command:Object.assign({},choicePayload),
              choices:Array.isArray(prepared.choices) ? prepared.choices.slice() : ['A','B'],
              requiresReason:false
            }
          };
        }

        if (!prepared || prepared.ok !== true || !prepared.command) {
          return {
            handled:true, kind:'action_rejected', intent:'move_class', text:'',
            message:String(prepared && prepared.message || '작업을 준비하지 못했어요.'),
            clearInput:true, payload:command, action:null
          };
        }

        return {
          handled:true,
          kind:'action_pending',
          intent:'move_class',
          text:'',
          message:confirmationMessage(prepared.command,schedule,prepared.message),
          clearInput:true,
          payload:prepared.command,
          action:{
            status:'pending',
            intent:'move_class',
            command:Object.assign({},prepared.command),
            requiresReason:false
          }
        };
      } catch(error) {
        console.warn('올리 구조화 수업 이동 준비 실패:',error);
        return {
          handled:true, kind:'action_rejected', intent:'move_class', text:'',
          message:String(error && (error.message || error) || '작업을 준비하지 못했어요.'),
          clearInput:true, payload:command, action:null
        };
      }
    }

    if (action === 'mark_absent') {
      const studentName=cleanText(command.student_name || command.studentName);
      const dateExpression=cleanText(command.date_expression || command.dateExpression);
      const timeSlot=Number(command.time_slot || command.timeSlot || 0);
      const classGroup=cleanText(command.class_group || command.classGroup).toUpperCase();
      const reason=cleanText(command.reason);
      const dateSpec=dateExpression ? parseDateExpression(compactText(dateExpression)) : null;
      const date=dateSpec ? resolveDateExpression(dateSpec,new Date()) : new Date();

      if (!studentName) {
        return {
          handled:true, kind:'action_rejected', intent:'mark_absent', text:'',
          message:'결석 처리할 학생을 알려주세요.',
          clearInput:true, payload:command, action:null
        };
      }
      if (!schedule || typeof schedule.prepareWriteCommand !== 'function') {
        return {
          handled:true, kind:'action_rejected', intent:'mark_absent', text:'',
          message:'시간표 작업 준비 기능을 아직 불러오지 못했어요.',
          clearInput:true, payload:command, action:null
        };
      }

      try {
        const prepared=await schedule.prepareWriteCommand('mark_absent',{
          type:'mutation',
          intent:'mark_absent',
          studentName,
          dateSpec,
          dateLabel:dateSpec ? dateSpec.label : '오늘',
          date,
          timeSlot,
          classGroup:/^[AB]$/.test(classGroup) ? classGroup : '',
          reason,
          selectedStudent:routeContext.selectedStudent || null,
          effectiveDate:new Date(),
          originalText:''
        });

        if (!prepared || prepared.ok !== true || !prepared.command) {
          return {
            handled:true, kind:'action_rejected', intent:'mark_absent', text:'',
            message:String(prepared && prepared.message || '작업을 준비하지 못했어요.'),
            clearInput:true, payload:command, action:null
          };
        }

        const preparedCommand=Object.assign({},prepared.command);
        if(reason && !cleanText(preparedCommand.reason)) preparedCommand.reason=reason;
        const requiresReason=commandRequiresReason(preparedCommand) && !cleanText(preparedCommand.reason);
        return {
          handled:true,
          kind:requiresReason ? 'action_needs_reason' : 'action_pending',
          intent:'mark_absent',
          text:'',
          message:requiresReason
            ? reasonPrompt(preparedCommand,schedule)
            : confirmationMessage(preparedCommand,schedule,prepared.message),
          clearInput:true,
          payload:preparedCommand,
          action:{
            status:'pending',
            intent:'mark_absent',
            command:Object.assign({},preparedCommand),
            requiresReason
          }
        };
      } catch(error) {
        console.warn('올리 구조화 결석 준비 실패:',error);
        return {
          handled:true, kind:'action_rejected', intent:'mark_absent', text:'',
          message:String(error && (error.message || error) || '작업을 준비하지 못했어요.'),
          clearInput:true, payload:command, action:null
        };
      }
    }

    if (action === 'update_trial') {
      const guestName=cleanText(command.guest_name || command.guestName || command.student_name || command.studentName);
      const sourceDateExpression=cleanText(command.source_date_expression || command.sourceDateExpression);
      const targetDateExpression=cleanText(command.target_date_expression || command.targetDateExpression);
      const sourceDateSpec=sourceDateExpression ? parseDateExpression(compactText(sourceDateExpression)) : null;
      const targetDateSpec=targetDateExpression ? parseDateExpression(compactText(targetDateExpression)) : null;
      const sourceDate=sourceDateSpec ? resolveDateExpression(sourceDateSpec,new Date()) : null;
      const targetDate=targetDateSpec ? resolveDateExpression(targetDateSpec,new Date()) : null;

      if(!guestName){
        return {
          handled:true,kind:'action_rejected',intent:'update_trial',text:'',
          message:'체험을 변경할 학생 이름을 알려주세요.',
          clearInput:true,payload:command,action:null
        };
      }
      if(sourceDateExpression && !sourceDate){
        return {
          handled:true,kind:'action_rejected',intent:'update_trial',text:'',
          message:'기존 체험 날짜를 해석하지 못했어요.',
          clearInput:true,payload:command,action:null
        };
      }
      if(targetDateExpression && !targetDate){
        return {
          handled:true,kind:'action_rejected',intent:'update_trial',text:'',
          message:'변경할 체험 날짜를 해석하지 못했어요.',
          clearInput:true,payload:command,action:null
        };
      }
      if(!schedule || typeof schedule.prepareWriteCommand!=='function'){
        return {
          handled:true,kind:'action_rejected',intent:'update_trial',text:'',
          message:'시간표 작업 준비 기능을 아직 불러오지 못했어요.',
          clearInput:true,payload:command,action:null
        };
      }

      try{
        const prepared=await schedule.prepareWriteCommand('update_trial',{
          type:'mutation',
          intent:'update_trial',
          guestName,
          studentName:guestName,
          division:cleanText(command.division),
          oneTimeSessionId:cleanText(command.one_time_session_id || command.oneTimeSessionId),
          sourceDate,
          sourceTimeSlot:Number(command.source_time_slot || command.sourceTimeSlot || 0),
          sourceMinute:Number(command.source_minute || command.sourceMinute || 0),
          sourceClassGroup:cleanText(command.source_class_group || command.sourceClassGroup),
          targetDate,
          targetTimeSlot:Number(command.target_time_slot || command.targetTimeSlot || 0),
          targetMinute:Number(command.target_minute || command.targetMinute || 0),
          targetClassGroup:cleanText(command.target_class_group || command.targetClassGroup),
          targetTimeStored:command.targetTimeStored===true,
          effectiveDate:new Date(),
          originalText:''
        });

        if(prepared?.code==='target_choice_required'){
          const choiceResult=structuredTargetChoiceResult('update_trial',command,prepared);
          if(choiceResult) return choiceResult;
        }

        if(prepared?.code==='target_date_required'){
          const draft=createStructuredWriteDraft(command);
          draft.guestName=guestName;
          draft.studentName=guestName;
          draft.oneTimeSessionId=cleanText(prepared?.source?.oneTimeSessionId) || draft.oneTimeSessionId;
          draft.division=cleanText(prepared?.source?.division) || draft.division;
          const payload={
            type:'structured_write_draft',
            targetIntent:'update_trial',
            field:'target_date',
            missingFields:['target_date'],
            draft
          };
          return {
            handled:true,kind:'action_needs_field',intent:'update_trial',text:'',
            message:String(prepared.message || '변경할 날짜를 선택해 주세요.'),
            clearInput:true,payload,
            action:{
              status:'pending_fields',intent:'update_trial',field:'target_date',
              missingFields:['target_date'],command:Object.assign({},draft),requiresReason:false
            }
          };
        }

        if(prepared?.code==='target_time_required'){
          const draft=createStructuredWriteDraft(command);
          draft.guestName=guestName;
          draft.studentName=guestName;
          draft.oneTimeSessionId=cleanText(prepared?.source?.oneTimeSessionId) || draft.oneTimeSessionId;
          draft.division=cleanText(prepared?.source?.division) || draft.division;
          draft.targetDateExpression=targetDateExpression;
          const timeChoices=await schedule.prepareStructuredTimeChoices({
            action:'update_trial',
            studentName:guestName,
            division:draft.division,
            date:targetDate,
            dateLabel:targetDateExpression || ''
          });
          if(!timeChoices?.ok){
            return {
              handled:true,kind:'action_rejected',intent:'update_trial',text:'',
              message:String(timeChoices?.message || '변경할 시간을 확인하지 못했어요.'),
              clearInput:true,payload:command,action:null
            };
          }
          const payload={
            type:'structured_write_draft',
            targetIntent:'update_trial',
            field:'target_time',
            missingFields:['target_time'],
            draft,
            choices:Array.isArray(timeChoices.choices) ? timeChoices.choices.map(item=>Object.assign({},item)) : []
          };
          return {
            handled:true,kind:'action_needs_field',intent:'update_trial',text:'',
            message:String(timeChoices.message || prepared.message || '변경할 시간을 선택해 주세요.'),
            clearInput:true,payload,
            action:{
              status:'pending_fields',intent:'update_trial',field:'target_time',
              missingFields:['target_time'],command:Object.assign({},draft),
              choices:payload.choices.map(item=>Object.assign({},item)),requiresReason:false
            }
          };
        }

        if(!prepared || prepared.ok!==true || !prepared.command){
          return {
            handled:true,kind:'action_rejected',intent:'update_trial',text:'',
            message:String(prepared && prepared.message || '체험 변경 작업을 준비하지 못했어요.'),
            clearInput:true,payload:command,action:null
          };
        }

        return {
          handled:true,
          kind:'action_pending',
          intent:'update_trial',
          text:'',
          message:confirmationMessage(prepared.command,schedule,prepared.message),
          clearInput:true,
          payload:prepared.command,
          action:{
            status:'pending',
            intent:'update_trial',
            command:Object.assign({},prepared.command),
            requiresReason:false
          }
        };
      }catch(error){
        console.warn('올리 구조화 체험 변경 준비 실패:',error);
        return {
          handled:true,kind:'action_rejected',intent:'update_trial',text:'',
          message:String(error && (error.message || error) || '체험 변경 작업을 준비하지 못했어요.'),
          clearInput:true,payload:command,action:null
        };
      }
    }

    if (action === 'update_makeup') {
      const studentName=cleanText(command.student_name || command.studentName);
      const sourceDateExpression=cleanText(command.source_date_expression || command.sourceDateExpression);
      const targetDateExpression=cleanText(command.target_date_expression || command.targetDateExpression);
      const sourceDateSpec=sourceDateExpression ? parseDateExpression(compactText(sourceDateExpression)) : null;
      const targetDateSpec=targetDateExpression ? parseDateExpression(compactText(targetDateExpression)) : null;
      const sourceDate=sourceDateSpec ? resolveDateExpression(sourceDateSpec,new Date()) : null;
      const targetDate=targetDateSpec ? resolveDateExpression(targetDateSpec,new Date()) : null;

      if(!studentName){
        return {
          handled:true,kind:'action_rejected',intent:'update_makeup',text:'',
          message:'보강을 변경할 학생을 알려주세요.',
          clearInput:true,payload:command,action:null
        };
      }
      if(sourceDateExpression && !sourceDate){
        return {
          handled:true,kind:'action_rejected',intent:'update_makeup',text:'',
          message:'기존 보강 날짜를 해석하지 못했어요.',
          clearInput:true,payload:command,action:null
        };
      }
      if(targetDateExpression && !targetDate){
        return {
          handled:true,kind:'action_rejected',intent:'update_makeup',text:'',
          message:'변경할 보강 날짜를 해석하지 못했어요.',
          clearInput:true,payload:command,action:null
        };
      }
      if(!schedule || typeof schedule.prepareWriteCommand!=='function'){
        return {
          handled:true,kind:'action_rejected',intent:'update_makeup',text:'',
          message:'시간표 작업 준비 기능을 아직 불러오지 못했어요.',
          clearInput:true,payload:command,action:null
        };
      }

      try{
        const prepared=await schedule.prepareWriteCommand('update_makeup',{
          type:'mutation',
          intent:'update_makeup',
          studentName,
          oneTimeSessionId:cleanText(command.one_time_session_id || command.oneTimeSessionId),
          sourceDate,
          sourceTimeSlot:Number(command.source_time_slot || command.sourceTimeSlot || 0),
          sourceMinute:Number(command.source_minute || command.sourceMinute || 0),
          sourceClassGroup:cleanText(command.source_class_group || command.sourceClassGroup),
          targetDate,
          targetTimeSlot:Number(command.target_time_slot || command.targetTimeSlot || 0),
          targetMinute:Number(command.target_minute || command.targetMinute || 0),
          targetClassGroup:cleanText(command.target_class_group || command.targetClassGroup),
          targetTimeStored:command.targetTimeStored===true,
          selectedStudent:routeContext.selectedStudent || null,
          effectiveDate:new Date(),
          originalText:''
        });

        if(prepared?.code==='target_choice_required'){
          const choiceResult=structuredTargetChoiceResult('update_makeup',command,prepared);
          if(choiceResult) return choiceResult;
        }

        if(prepared?.code==='target_date_required'){
          const draft=createStructuredWriteDraft(command);
          draft.oneTimeSessionId=cleanText(prepared?.source?.oneTimeSessionId) || draft.oneTimeSessionId;
          const payload={
            type:'structured_write_draft',
            targetIntent:'update_makeup',
            field:'target_date',
            missingFields:['target_date'],
            draft
          };
          return {
            handled:true,kind:'action_needs_field',intent:'update_makeup',text:'',
            message:String(prepared.message || '변경할 날짜를 선택해 주세요.'),
            clearInput:true,payload,
            action:{
              status:'pending_fields',intent:'update_makeup',field:'target_date',
              missingFields:['target_date'],command:Object.assign({},draft),requiresReason:false
            }
          };
        }

        if(prepared?.code==='target_time_required'){
          const draft=createStructuredWriteDraft(command);
          draft.oneTimeSessionId=cleanText(prepared?.source?.oneTimeSessionId) || draft.oneTimeSessionId;
          draft.targetDateExpression=targetDateExpression;
          const timeChoices=await schedule.prepareStructuredTimeChoices({
            action:'update_makeup',
            studentName,
            selectedStudent:routeContext.selectedStudent || null,
            division:cleanText(command.division),
            date:targetDate,
            dateLabel:targetDateExpression || '',
          });
          if(!timeChoices?.ok){
            return {
              handled:true,kind:'action_rejected',intent:'update_makeup',text:'',
              message:String(timeChoices?.message || '변경할 시간을 확인하지 못했어요.'),
              clearInput:true,payload:command,action:null
            };
          }
          const payload={
            type:'structured_write_draft',
            targetIntent:'update_makeup',
            field:'target_time',
            missingFields:['target_time'],
            draft,
            choices:Array.isArray(timeChoices.choices) ? timeChoices.choices.map(item=>Object.assign({},item)) : []
          };
          return {
            handled:true,kind:'action_needs_field',intent:'update_makeup',text:'',
            message:String(timeChoices.message || prepared.message || '변경할 시간을 선택해 주세요.'),
            clearInput:true,payload,
            action:{
              status:'pending_fields',intent:'update_makeup',field:'target_time',
              missingFields:['target_time'],command:Object.assign({},draft),
              choices:payload.choices.map(item=>Object.assign({},item)),requiresReason:false
            }
          };
        }

        if(!prepared || prepared.ok!==true || !prepared.command){
          return {
            handled:true,kind:'action_rejected',intent:'update_makeup',text:'',
            message:String(prepared && prepared.message || '보강 변경 작업을 준비하지 못했어요.'),
            clearInput:true,payload:command,action:null
          };
        }

        return {
          handled:true,
          kind:'action_pending',
          intent:'update_makeup',
          text:'',
          message:confirmationMessage(prepared.command,schedule,prepared.message),
          clearInput:true,
          payload:prepared.command,
          action:{
            status:'pending',
            intent:'update_makeup',
            command:Object.assign({},prepared.command),
            requiresReason:false
          }
        };
      }catch(error){
        console.warn('올리 구조화 보강 변경 준비 실패:',error);
        return {
          handled:true,kind:'action_rejected',intent:'update_makeup',text:'',
          message:String(error && (error.message || error) || '보강 변경 작업을 준비하지 못했어요.'),
          clearInput:true,payload:command,action:null
        };
      }
    }

    if (action === 'cancel_waitlist') {
      const studentName=cleanText(command.student_name || command.studentName);
      const dateExpression=cleanText(command.date_expression || command.dateExpression);
      const visibleHour=Number(command.time_slot || command.timeSlot || 0);
      const classMinute=Number(command.class_minute || command.classMinute || 0);
      const classGroup=cleanText(command.class_group || command.classGroup).toUpperCase();
      const dateSpec=dateExpression ? parseDateExpression(compactText(dateExpression)) : null;
      const date=dateSpec ? resolveDateExpression(dateSpec,new Date()) : null;

      if(!studentName){
        return {
          handled:true,kind:'action_rejected',intent:'cancel_waitlist',text:'',
          message:'대기를 취소할 학생을 알려주세요.',
          clearInput:true,payload:command,action:null
        };
      }
      if(dateExpression && !date){
        return {
          handled:true,kind:'action_rejected',intent:'cancel_waitlist',text:'',
          message:'취소할 대기 날짜를 해석하지 못했어요.',
          clearInput:true,payload:command,action:null
        };
      }
      if(!schedule || typeof schedule.prepareWriteCommand!=='function'){
        return {
          handled:true,kind:'action_rejected',intent:'cancel_waitlist',text:'',
          message:'시간표 작업 준비 기능을 아직 불러오지 못했어요.',
          clearInput:true,payload:command,action:null
        };
      }

      try{
        const prepared=await schedule.prepareWriteCommand('cancel_waitlist',{
          type:'mutation',
          intent:'cancel_waitlist',
          studentName,
          division:cleanText(command.division),
          date,
          classHour:visibleHour,
          classMinute,
          classGroup:/^[AB]$/.test(classGroup) ? classGroup : '',
          waitlistId:cleanText(command.waitlist_id || command.waitlistId),
          selectedStudent:routeContext.selectedStudent || null,
          effectiveDate:new Date(),
          originalText:''
        });

        if(prepared?.code==='target_choice_required'){
          const choiceResult=structuredTargetChoiceResult('cancel_waitlist',command,prepared);
          if(choiceResult) return choiceResult;
        }
        if(!prepared || prepared.ok!==true || !prepared.command){
          return {
            handled:true,kind:'action_rejected',intent:'cancel_waitlist',text:'',
            message:String(prepared && prepared.message || '대기 취소 작업을 준비하지 못했어요.'),
            clearInput:true,payload:command,action:null
          };
        }

        return {
          handled:true,
          kind:'action_pending',
          intent:'cancel_waitlist',
          text:'',
          message:confirmationMessage(prepared.command,schedule,prepared.message),
          clearInput:true,
          payload:prepared.command,
          action:{
            status:'pending',
            intent:'cancel_waitlist',
            command:Object.assign({},prepared.command),
            requiresReason:false
          }
        };
      }catch(error){
        console.warn('올리 구조화 대기 취소 준비 실패:',error);
        return {
          handled:true,kind:'action_rejected',intent:'cancel_waitlist',text:'',
          message:String(error && (error.message || error) || '대기 취소 작업을 준비하지 못했어요.'),
          clearInput:true,payload:command,action:null
        };
      }
    }

    if (action === 'cancel_pickup') {
      const studentName=cleanText(command.student_name || command.studentName);
      const weekday=Number(command.weekday || 0);
      const classTime=Number(command.class_time || command.classTime || 0);
      const classMinute=Number(command.class_minute || command.classMinute || 0);
      const pickupKind=cleanText(command.pickup_kind || command.pickupKind).toLowerCase();

      if(!studentName){
        return {
          handled:true,kind:'action_rejected',intent:'cancel_pickup',text:'',
          message:'픽업을 삭제할 학생을 알려주세요.',
          clearInput:true,payload:command,action:null
        };
      }
      if(!schedule || typeof schedule.prepareWriteCommand!=='function'){
        return {
          handled:true,kind:'action_rejected',intent:'cancel_pickup',text:'',
          message:'시간표 작업 준비 기능을 아직 불러오지 못했어요.',
          clearInput:true,payload:command,action:null
        };
      }

      try{
        const prepared=await schedule.prepareWriteCommand('cancel_pickup',{
          type:'mutation',
          intent:'cancel_pickup',
          studentName,
          weekday,
          classTime,
          classMinute,
          pickupKind:pickupKind==='dropoff' ? 'dropoff' : 'all',
          pickupId:cleanText(command.pickup_id || command.pickupId),
          selectedStudent:routeContext.selectedStudent || null,
          effectiveDate:new Date(),
          originalText:''
        });

        if(prepared?.code==='target_choice_required'){
          const choiceResult=structuredTargetChoiceResult('cancel_pickup',command,prepared);
          if(choiceResult) return choiceResult;
        }
        if(!prepared || prepared.ok!==true || !prepared.command){
          return {
            handled:true,kind:'action_rejected',intent:'cancel_pickup',text:'',
            message:String(prepared && prepared.message || '픽업 삭제 작업을 준비하지 못했어요.'),
            clearInput:true,payload:command,action:null
          };
        }

        const preparedIntent=cleanText(prepared.command.intent);
        if(!['cancel_pickup','cancel_pickup_dropoff'].includes(preparedIntent)){
          return {
            handled:true,kind:'action_rejected',intent:'cancel_pickup',text:'',
            message:'픽업 삭제 작업 종류를 확인하지 못했어요.',
            clearInput:true,payload:command,action:null
          };
        }

        return {
          handled:true,
          kind:'action_pending',
          intent:preparedIntent,
          text:'',
          message:confirmationMessage(prepared.command,schedule,prepared.message),
          clearInput:true,
          payload:prepared.command,
          action:{
            status:'pending',
            intent:preparedIntent,
            command:Object.assign({},prepared.command),
            requiresReason:false
          }
        };
      }catch(error){
        console.warn('올리 구조화 픽업 삭제 준비 실패:',error);
        return {
          handled:true,kind:'action_rejected',intent:'cancel_pickup',text:'',
          message:String(error && (error.message || error) || '픽업 삭제 작업을 준비하지 못했어요.'),
          clearInput:true,payload:command,action:null
        };
      }
    }

    if (action === 'update_pickup') {
      const studentName=cleanText(command.student_name || command.studentName);
      const weekday=Number(command.weekday || 0);
      const classTime=Number(command.class_time || command.classTime || 0);
      const classMinute=Number(command.class_minute || command.classMinute || 0);
      const pickupKind=cleanText(command.pickup_kind || command.pickupKind).toLowerCase();
      const pickupLabel=cleanText(command.pickup_label || command.pickupLabel);
      const pickupTime=cleanText(command.pickup_time || command.pickupTime);

      if(!studentName){
        return {
          handled:true,kind:'action_rejected',intent:'update_pickup',text:'',
          message:'픽업을 수정할 학생을 알려주세요.',
          clearInput:true,payload:command,action:null
        };
      }
      if(!schedule || typeof schedule.prepareWriteCommand!=='function'){
        return {
          handled:true,kind:'action_rejected',intent:'update_pickup',text:'',
          message:'시간표 작업 준비 기능을 아직 불러오지 못했어요.',
          clearInput:true,payload:command,action:null
        };
      }

      try{
        const prepared=await schedule.prepareWriteCommand('update_pickup',{
          type:'mutation',
          intent:'update_pickup',
          studentName,
          weekday,
          classTime,
          classMinute,
          pickupKind:pickupKind==='dropoff' ? 'dropoff' : 'arrival',
          pickupLabel,
          pickupTime,
          pickupId:cleanText(command.pickup_id || command.pickupId),
          selectedStudent:routeContext.selectedStudent || null,
          effectiveDate:new Date(),
          originalText:''
        });

        if(prepared?.code==='target_choice_required'){
          const choiceResult=structuredTargetChoiceResult('update_pickup',command,prepared);
          if(choiceResult) return choiceResult;
        }
        if(!prepared || prepared.ok!==true || !prepared.command){
          return {
            handled:true,kind:'action_rejected',intent:'update_pickup',text:'',
            message:String(prepared && prepared.message || '픽업 수정 작업을 준비하지 못했어요.'),
            clearInput:true,payload:command,action:null
          };
        }

        const preparedIntent=cleanText(prepared.command.intent);
        if(!['update_pickup_arrival','update_pickup_dropoff'].includes(preparedIntent)){
          return {
            handled:true,kind:'action_rejected',intent:'update_pickup',text:'',
            message:'픽업 수정 작업 종류를 확인하지 못했어요.',
            clearInput:true,payload:command,action:null
          };
        }

        return {
          handled:true,
          kind:'action_pending',
          intent:preparedIntent,
          text:'',
          message:confirmationMessage(prepared.command,schedule,prepared.message),
          clearInput:true,
          payload:prepared.command,
          action:{
            status:'pending',
            intent:preparedIntent,
            command:Object.assign({},prepared.command),
            requiresReason:false
          }
        };
      }catch(error){
        console.warn('올리 구조화 픽업 수정 준비 실패:',error);
        return {
          handled:true,kind:'action_rejected',intent:'update_pickup',text:'',
          message:String(error && (error.message || error) || '픽업 수정 작업을 준비하지 못했어요.'),
          clearInput:true,payload:command,action:null
        };
      }
    }

    if (action === 'add_pickup') {
      const studentName = cleanText(command.student_name || command.studentName);
      const weekday = Number(command.weekday || 0);
      const classTime = Number(command.class_time || command.classTime || 0);
      const classMinute = Number(command.class_minute || command.classMinute || 0);
      const pickupKind = cleanText(command.pickup_kind || command.pickupKind);
      const pickupLabel = cleanText(command.pickup_label || command.pickupLabel);
      const pickupTime = cleanText(command.pickup_time || command.pickupTime);

      if (!schedule || typeof schedule.prepareWriteCommand !== 'function') {
        return {
          handled:true,
          kind:'action_rejected',
          intent:'add_pickup',
          text:'',
          message:'시간표 작업 준비 기능을 아직 불러오지 못했어요.',
          clearInput:true,
          payload:command,
          action:null
        };
      }

      try {
        const prepared = await schedule.prepareWriteCommand('add_pickup', {
          type:'mutation',
          intent:'add_pickup',
          studentName,
          weekday,
          classTime,
          classMinute,
          pickupLabel,
          pickupTime,
          sourceEnrollmentId:cleanText(command.source_enrollment_id || command.sourceEnrollmentId),
          isDropoff:pickupKind === 'dropoff',
          selectedStudent:routeContext.selectedStudent || null,
          effectiveDate:new Date(),
          originalText:''
        });

        if (prepared?.code === 'target_choice_required') {
          const choiceResult=structuredTargetChoiceResult('add_pickup',command,prepared);
          if(choiceResult) return choiceResult;
        }

        if (!prepared || prepared.ok !== true || !prepared.command) {
          return {
            handled:true,
            kind:'action_rejected',
            intent:'add_pickup',
            text:'',
            message:String(prepared && prepared.message || '작업을 준비하지 못했어요.'),
            clearInput:true,
            payload:command,
            action:null
          };
        }

        const preparedIntent=cleanText(prepared.command.intent) || 'add_pickup';
        return {
          handled:true,
          kind:'action_pending',
          intent:preparedIntent,
          text:'',
          message:confirmationMessage(prepared.command, schedule, prepared.message),
          clearInput:true,
          payload:prepared.command,
          action:{
            status:'pending',
            intent:preparedIntent,
            command:Object.assign({},prepared.command),
            requiresReason:false
          }
        };
      } catch (error) {
        console.warn('올리 구조화 픽업 명령 준비 실패:',error);
        return {
          handled:true,
          kind:'action_rejected',
          intent:'add_pickup',
          text:'',
          message:String(error && (error.message || error) || '작업을 준비하지 못했어요.'),
          clearInput:true,
          payload:command,
          action:null
        };
      }
    }

    const studentName = cleanText(command.student_name || command.studentName);
    const division = cleanText(command.division);
    const dateExpression = cleanText(command.date_expression || command.dateExpression);
    const timeSlot = Number(command.time_slot || command.timeSlot || 0);
    const classGroup = cleanText(command.class_group || command.classGroup).toUpperCase();
    const dateSpec = dateExpression ? parseDateExpression(compactText(dateExpression)) : null;
    const noun = action === 'add_trial' ? '체험 등록' : action === 'add_waitlist' ? '대기 등록' : '보강 등록';

    if (!studentName || !dateSpec || !timeSlot) {
      return {
        handled:true,
        kind:'action_rejected',
        intent:action,
        text:'',
        message:noun + '에는 학생, 날짜, 시간이 필요해요.',
        clearInput:true,
        payload:command,
        action:null
      };
    }

    if (!schedule || typeof schedule.prepareWriteCommand !== 'function') {
      return {
        handled:true,
        kind:'action_rejected',
        intent:action,
        text:'',
        message:'시간표 작업 준비 기능을 아직 불러오지 못했어요.',
        clearInput:true,
        payload:command,
        action:null
      };
    }

    const options = {
      type:'mutation',
      intent:action,
      studentName,
      guestName:action === 'add_trial' ? studentName : '',
      division,
      dateSpec,
      dateLabel:dateSpec.label,
      date:resolveDateExpression(dateSpec,new Date()),
      timeSlot,
      classGroup:/^[AB]$/.test(classGroup) ? classGroup : '',
      selectedStudent:routeContext.selectedStudent || null,
      effectiveDate:new Date(),
      originalText:''
    };

    if (!options.date) {
      return {
        handled:true,
        kind:'action_rejected',
        intent:action,
        text:'',
        message:(action === 'add_trial' ? '체험' : action === 'add_waitlist' ? '대기' : '보강') + ' 날짜를 해석하지 못했어요.',
        clearInput:true,
        payload:command,
        action:null
      };
    }

    try {
      const prepared = await schedule.prepareWriteCommand(action, options);
      if (prepared?.code === 'class_group_required' && prepared?.commandDraft) {
        if (
          ['add_makeup','add_trial','add_waitlist'].includes(action)
          && command?.batchStructured === true
          && Number.isInteger(Number(command?.batchCommandIndex))
          && Number(command.batchCommandIndex) >= 0
        ) {
          const batchChoiceDraft=Object.assign({},command,prepared.commandDraft,{
            action,
            batchStructured:true,
            batchCommandIndex:Number(command.batchCommandIndex)
          });
          const choiceResult=structuredTargetChoiceResult(action,batchChoiceDraft,{
            choiceKey:'classGroup',
            choices:(Array.isArray(prepared.choices) ? prepared.choices : ['A','B'])
              .map(group=>({id:cleanText(group).toUpperCase(),label:cleanText(group).toUpperCase()+'반'})),
            message:String(prepared.message || '반을 선택해 주세요.')
          });
          if(choiceResult) return choiceResult;
        }
        const choiceIntent = action === 'add_trial' ? 'choose_trial_group' : action === 'add_waitlist' ? 'choose_waitlist_group' : 'choose_makeup_group';
        const choicePayload = Object.assign({},prepared.commandDraft,{ intent:choiceIntent,targetIntent:action });
        return {
          handled:true,
          kind:'action_choice',
          intent:choiceIntent,
          text:'',
          message:String(prepared.message || '반을 선택해 주세요.'),
          clearInput:true,
          payload:choicePayload,
          action:{
            status:'pending_choice',
            intent:choiceIntent,
            command:Object.assign({},choicePayload),
            choices:Array.isArray(prepared.choices) ? prepared.choices.slice() : ['A','B'],
            requiresReason:false
          }
        };
      }

      if (!prepared || prepared.ok !== true || !prepared.command) {
        return {
          handled:true,
          kind:'action_rejected',
          intent:action,
          text:'',
          message:String(prepared && prepared.message || '작업을 준비하지 못했어요.'),
          clearInput:true,
          payload:command,
          action:null
        };
      }

      return {
        handled:true,
        kind:'action_pending',
        intent:action,
        text:'',
        message:confirmationMessage(prepared.command, schedule, prepared.message),
        clearInput:true,
        payload:prepared.command,
        action:{
          status:'pending',
          intent:action,
          command:Object.assign({},prepared.command),
          requiresReason:false
        }
      };
    } catch (error) {
      console.warn('올리 구조화 명령 준비 실패:',error);
      return {
        handled:true,
        kind:'action_rejected',
        intent:action,
        text:'',
        message:String(error && (error.message || error) || '작업을 준비하지 못했어요.'),
        clearInput:true,
        payload:command,
        action:null
      };
    }
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
    runStructuredQuery,
    runStructuredMultiQuery,
    prepareStructuredAction,
    prepareAction,
    prepareInterpretedAction,
    interpretedIntentToStructuredCommand,
    parseWriteIntent,
    createStructuredWriteDraft,
    getStructuredWriteDraftState,
    updateStructuredWriteDraft,
    parseQueryIntent,
    parseStudentScheduleQueryIntent,
    parseMultiQueryIntent,
    parseAvailableSlotsIntent,
    parseRosterQueryIntent,
    parsePickupQueryIntent,
    parseStudentInfoLookupIntent,
    olliReplyTemporalSignals,
    isOlliReplyCandidate,
    parseScheduleMoveMutationIntent,
    parseMakeupMutationIntent,
    parseMakeupUpdateMutationIntent,
    parseWaitlistMutationIntent,
    parseWaitlistUpdateMutationIntent,
    parseTrialMutationIntent,
    parseTrialUpdateMutationIntent,
    parseAbsenceMutationIntent,
    parseMakeupCancelMutationIntent,
    parseTrialCancelMutationIntent,
    parseMoveCancelMutationIntent,
    parseWaitlistCancelMutationIntent,
    parsePickupCancelMutationIntent,
    parsePickupUpdateMutationIntent,
    parsePickupMutationIntent,
    parseTimetableMemoAddMutationIntent,
    parseTimetableMemoDeleteMutationIntent,
    parseClassLayoutMutationIntent,
    parseTeacherAssignmentMutationIntent,
    parseSessionOrderMutationIntent,
    parseNormalClassDayMutationIntent,
    parseAttendanceStatusMutationIntent,
    parseMultiWriteIntent,
    parseBatchDraftWriteIntent,
    parseClassMutationIntent,
    parseDateExpression,
    resolveDateExpression,
    getPendingWriteCommand() { return pendingWriteCommand ? Object.assign({}, pendingWriteCommand) : null; },
    getPendingReasonCommand() { return pendingReasonCommand ? Object.assign({}, pendingReasonCommand) : null; }
  });
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.OlliCommandRouter;
}
