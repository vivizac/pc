(function olliCommandScheduleCommon(global) {
  'use strict';

  if (global.OlliCommandSchedule) return;

  const VERSION = '2026-09-18-write-commands-1';

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function localDateKey(value) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean(value))) return clean(value);
    const date = value instanceof Date ? value : new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return '';
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function parseLocalDate(value) {
    const key = localDateKey(value);
    const match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  function isoWeekday(value) {
    const date = parseLocalDate(value);
    if (!date) return 0;
    const day = date.getDay();
    return day === 0 ? 7 : day;
  }

  function mondayKey(value) {
    const date = parseLocalDate(value);
    if (!date) return '';
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - (day - 1));
    return localDateKey(date);
  }

  function normalizeDivision(value) {
    const raw = clean(value).toLowerCase();
    if (raw === 'elementary' || raw === '초등' || raw === '초등부') return 'elementary';
    if (raw === 'kinder' || raw === '유치' || raw === '유치부' || raw === '유아') return 'kinder';
    return '';
  }

  function classGroup(value) {
    return clean(value).toUpperCase() === 'B' ? 'B' : 'A';
  }

  function rowEffectiveOn(row, dateKey) {
    const from = clean(row && row.effective_from).slice(0, 10);
    const to = clean(row && row.effective_to).slice(0, 10);
    return (!from || from <= dateKey) && (!to || to >= dateKey);
  }

  function arrays(data, key) {
    return Array.isArray(data && data[key]) ? data[key] : [];
  }

  function isElementarySplit(data, weekday, timeSlot) {
    return arrays(data, 'class_splits').some(row =>
      Number(row && row.weekday) === Number(weekday)
      && Number(row && row.time_slot) === Number(timeSlot)
    );
  }

  function isKinderMerged(data, weekday, timeSlot) {
    return arrays(data, 'kinder_class_merges').some(row =>
      Number(row && row.weekday) === Number(weekday)
      && Number(row && row.time_slot) === Number(timeSlot)
    );
  }

  function classGroups(data, division, weekday, timeSlot) {
    if (division === 'kinder') return isKinderMerged(data, weekday, timeSlot) ? ['A'] : ['A', 'B'];
    return isElementarySplit(data, weekday, timeSlot) ? ['A', 'B'] : ['A'];
  }

  function validTimes(division, weekday) {
    if (weekday < 1 || weekday > 6) return [];
    if (division === 'kinder') return [4, 5];
    if (weekday === 6) return [10, 11, 12];
    return [1, 2, 3, 4, 5, 6];
  }

  function capacityFor(data, division) {
    const raw = division === 'kinder' ? data && data.kinder_capacity : data && data.elementary_capacity;
    const value = Number(raw || 5);
    return Number.isFinite(value) && value > 0 ? value : 5;
  }

  function regularCount(data, division, dateKey, weekday, timeSlot, group) {
    return arrays(data, 'enrollments').filter(row =>
      clean(row && row.division) === division
      && Number(row && row.weekday) === Number(weekday)
      && Number(row && row.time_slot) === Number(timeSlot)
      && classGroup(row && row.class_group) === group
      && rowEffectiveOn(row, dateKey)
    ).length;
  }

  function oneTimeCount(data, division, dateKey, timeSlot, group) {
    return arrays(data, 'one_time_sessions').filter(row =>
      clean(row && row.division) === division
      && clean(row && row.session_date).slice(0, 10) === dateKey
      && Number(row && row.time_slot) === Number(timeSlot)
      && classGroup(row && row.class_group) === group
      && clean(row && row.status).toLowerCase() !== 'cancelled'
    ).length;
  }

  function hasTeacher(data, division, weekday, timeSlot, group) {
    return arrays(data, 'class_teachers').some(row =>
      clean(row && row.division) === division
      && Number(row && row.weekday) === Number(weekday)
      && Number(row && row.time_slot) === Number(timeSlot)
      && classGroup(row && row.class_group) === group
    );
  }

  function classOccupancy(data, division, dateKey, weekday, timeSlot, group) {
    return regularCount(data, division, dateKey, weekday, timeSlot, group)
      + oneTimeCount(data, division, dateKey, timeSlot, group);
  }

  function classIsOperating(data, division, dateKey, weekday, timeSlot, group) {
    return classOccupancy(data, division, dateKey, weekday, timeSlot, group) > 0
      || hasTeacher(data, division, weekday, timeSlot, group);
  }

  async function loadFreshWeek(dateKey) {
    const pc = global.OlliTimetableService;
    if (pc && typeof pc.loadWeek === 'function') {
      return pc.loadWeek(mondayKey(dateKey));
    }

    const phone = global.OlliPhoneStudentScheduleService;
    if (phone && typeof phone.loadWeek === 'function') {
      if (typeof phone.clearWeekCache === 'function') phone.clearWeekCache();
      return phone.loadWeek(dateKey);
    }

    throw new Error('시간표 서비스를 아직 불러오지 못했습니다.');
  }

  async function loadCalendarDay(dateKey, weekData) {
    const cached = arrays(weekData, 'calendar_days').find(row =>
      clean(row && row.session_date).slice(0, 10) === dateKey
    );
    if (cached) return cached;

    const pc = global.OlliTimetableService;
    if (pc && typeof pc.loadCalendarRange === 'function') {
      const rows = await pc.loadCalendarRange(dateKey, dateKey);
      return (Array.isArray(rows) ? rows : []).find(row =>
        clean(row && row.session_date).slice(0, 10) === dateKey
      ) || null;
    }

    const phone = global.OlliPhoneStudentScheduleService;
    if (phone && typeof phone.request === 'function') {
      const data = await phone.request('olli_schedule_calendar_range', {
        p_start_date: dateKey,
        p_end_date: dateKey
      });
      const rows = Array.isArray(data && data.days) ? data.days : [];
      return rows.find(row => clean(row && row.session_date).slice(0, 10) === dateKey) || null;
    }

    return null;
  }

  async function findAvailableSlots(options) {
    const opts = options || {};
    const dateKey = localDateKey(opts.date || new Date());
    if (!dateKey) throw new Error('조회 날짜를 확인해 주세요.');

    const weekday = isoWeekday(dateKey);
    if (weekday === 7) {
      return {
        date: dateKey,
        purpose: clean(opts.purpose) || 'unknown',
        division: normalizeDivision(opts.division),
        dateLabel: clean(opts.dateLabel),
        closedDay: true,
        closedReason: '일요일',
        slots: []
      };
    }

    const weekData = await loadFreshWeek(dateKey);
    const calendar = await loadCalendarDay(dateKey, weekData);
    if (calendar && calendar.is_holiday === true) {
      return {
        date: dateKey,
        purpose: clean(opts.purpose) || 'unknown',
        division: normalizeDivision(opts.division),
        dateLabel: clean(opts.dateLabel),
        closedDay: true,
        closedReason: clean(calendar.name) || '휴원일',
        slots: []
      };
    }

    const requestedDivision = normalizeDivision(opts.division);
    const divisions = requestedDivision ? [requestedDivision] : ['elementary', 'kinder'];
    const slots = [];

    divisions.forEach(division => {
      const capacity = capacityFor(weekData, division);
      validTimes(division, weekday).forEach(timeSlot => {
        const groups = classGroups(weekData, division, weekday, timeSlot);
        groups.forEach(group => {
          if (!classIsOperating(weekData, division, dateKey, weekday, timeSlot, group)) return;
          const occupancy = classOccupancy(weekData, division, dateKey, weekday, timeSlot, group);
          const remaining = Math.max(0, capacity - occupancy);
          if (remaining < 1) return;
          slots.push({
            division,
            date: dateKey,
            weekday,
            timeSlot,
            classGroup: group,
            grouped: groups.length > 1,
            occupancy,
            capacity,
            remaining
          });
        });
      });
    });

    return {
      date: dateKey,
      purpose: clean(opts.purpose) || 'unknown',
      division: requestedDivision,
      dateLabel: clean(opts.dateLabel),
      closedDay: false,
      closedReason: '',
      slots
    };
  }

  function divisionLabel(value) {
    return value === 'kinder' ? '유치부' : '초등부';
  }

  const DAY_LABELS = Object.freeze(['일','월','화','수','목','금','토']);

  function fallbackDateLabel(value) {
    const date = parseLocalDate(value);
    if (!date) return '해당 날짜';
    return (date.getMonth() + 1) + '월 ' + date.getDate() + '일 ' + DAY_LABELS[date.getDay()] + '요일';
  }

  function resultDateLabel(data) {
    return clean(data && data.dateLabel) || fallbackDateLabel(data && data.date);
  }

  function purposeLabel(value) {
    if (value === 'makeup') return '보강 가능한';
    if (value === 'trial') return '체험수업 가능한';
    if (value === 'new_enrollment') return '신규등록 가능한';
    if (value === 'schedule_move') return '수업 이동 가능한';
    return '자리가 남은';
  }

  function slotLabel(slot) {
    const group = slot && slot.grouped ? ' ' + classGroup(slot.classGroup) + '반' : '';
    return String(Number(slot && slot.timeSlot || 0)) + '시' + group + ' ' + Number(slot && slot.remaining || 0) + '자리';
  }

  function describeAvailableSlots(result) {
    const data = result || {};
    const purpose = purposeLabel(data.purpose);
    const dateLabel = resultDateLabel(data);
    if (data.closedDay) {
      return dateLabel + '은 ' + (data.closedReason || '휴원일') + '이라 정상 수업이 없어요.';
    }

    const slots = Array.isArray(data.slots) ? data.slots : [];
    if (!slots.length) {
      const prefix = data.division ? divisionLabel(data.division) + ' ' : '';
      return dateLabel + ' ' + prefix + purpose + ' 운영 클래스가 없어요.';
    }

    const intro = data.purpose === 'unknown'
      ? dateLabel + ' 자리가 남은 클래스예요.'
      : dateLabel + ' ' + purpose + ' 클래스예요.';

    const divisions = data.division ? [data.division] : ['elementary', 'kinder'];
    const lines = divisions.map(division => {
      const rows = slots.filter(slot => slot.division === division);
      if (!rows.length) return '';
      return divisionLabel(division) + ': ' + rows.map(slotLabel).join(' · ');
    }).filter(Boolean);

    return [intro].concat(lines).join('\n');
  }


  function normalizeStudentDivision(student) {
    const raw = clean(
      student && (
        student.division
        || student.student_division
        || student.studentDivision
        || student.type
        || student.student_type
        || student.studentType
      )
    ).toLowerCase();
    if (/kinder|유치|유아/.test(raw)) return 'kinder';
    if (/elementary|초등/.test(raw)) return 'elementary';
    return '';
  }

  function findStudentsByExactName(name) {
    const studentName = clean(name);
    if (!studentName) return [];

    try {
      if (typeof global.getKinderChatFeedbackSaveStudentCandidates === 'function') {
        const rows = global.getKinderChatFeedbackSaveStudentCandidates(studentName) || [];
        if (Array.isArray(rows)) return rows.filter(Boolean);
      }
    } catch (_) {}

    try {
      const pc = global.OlliTimetableService;
      if (pc && typeof pc.activeStudents === 'function') {
        return pc.activeStudents().filter(student => clean(student && student.name) === studentName);
      }
    } catch (_) {}

    return [];
  }

  function resolveCommandStudent(studentName, selectedStudent) {
    const requestedName = clean(studentName);
    const selected = selectedStudent && clean(selectedStudent.id) ? selectedStudent : null;

    if (!requestedName) {
      if (selected) return { ok:true, student:selected };
      return { ok:false, message:'학생 이름을 입력하거나 학생을 먼저 선택해 주세요.' };
    }

    if (selected && clean(selected.name) === requestedName) {
      return { ok:true, student:selected };
    }

    const candidates = findStudentsByExactName(requestedName);
    if (candidates.length === 1) return { ok:true, student:candidates[0] };
    if (candidates.length > 1) {
      return {
        ok:false,
        message: requestedName + ' 학생이 여러 명 있어요. 학생 목록에서 먼저 학생을 선택한 뒤 다시 명령해 주세요.'
      };
    }
    return { ok:false, message: requestedName + ' 학생을 찾지 못했어요.' };
  }

  function addDaysKey(value, amount) {
    const date = parseLocalDate(value);
    if (!date) return '';
    date.setDate(date.getDate() + Number(amount || 0));
    return localDateKey(date);
  }

  function nextOccurrenceKey(value, weekday) {
    const key = localDateKey(value);
    const current = isoWeekday(key);
    const target = Number(weekday || 0);
    if (!key || !current || target < 1 || target > 6) return '';
    return addDaysKey(key, (target - current + 7) % 7);
  }

  function weekdayLabel(value) {
    const map = ['', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
    return map[Number(value)] || '';
  }

  function requestedGroup(value) {
    const raw = clean(value).toUpperCase();
    return raw === 'A' || raw === 'B' ? raw : '';
  }

  function chooseOpenSlot(result, timeSlot, group, preferredGroup) {
    const rows = (Array.isArray(result && result.slots) ? result.slots : [])
      .filter(slot => Number(slot && slot.timeSlot) === Number(timeSlot));
    const requested = requestedGroup(group);
    const preferred = requestedGroup(preferredGroup);

    if (requested) {
      const exact = rows.find(slot => classGroup(slot && slot.classGroup) === requested);
      if (exact) return { ok:true, slot:exact };
      return { ok:false, message:Number(timeSlot) + '시 ' + requested + '반은 현재 자리가 없어요.' };
    }

    if (!rows.length) {
      return { ok:false, message:Number(timeSlot) + '시는 현재 자리가 없거나 운영하지 않는 클래스예요.' };
    }

    if (rows.length === 1) return { ok:true, slot:rows[0] };

    if (preferred) {
      const sameGroup = rows.find(slot => classGroup(slot && slot.classGroup) === preferred);
      if (sameGroup) return { ok:true, slot:sameGroup };
    }

    const choices = rows.map(slot => classGroup(slot.classGroup) + '반 ' + Number(slot.remaining || 0) + '자리').join(' · ');
    return {
      ok:false,
      message:Number(timeSlot) + '시는 반이 나뉘어 있어요. ' + choices + '\nA반 또는 B반을 명령에 같이 적어 주세요.'
    };
  }

  function duplicateMakeup(weekData, studentId, sessionDate, timeSlot) {
    return arrays(weekData, 'one_time_sessions').some(row =>
      clean(row && row.student_id) === clean(studentId)
      && clean(row && row.session_date).slice(0, 10) === clean(sessionDate)
      && Number(row && row.time_slot) === Number(timeSlot)
      && clean(row && row.status).toLowerCase() !== 'cancelled'
    );
  }

  function activeStudentEnrollments(weekData, studentId, effectiveDate) {
    const dateKey = localDateKey(effectiveDate);
    return arrays(weekData, 'enrollments').filter(row =>
      clean(row && row.student_id) === clean(studentId)
      && rowEffectiveOn(row, dateKey)
    );
  }

  async function prepareMakeupCommand(options) {
    const opts = options || {};
    const resolved = resolveCommandStudent(opts.studentName, opts.selectedStudent);
    if (!resolved.ok) return resolved;

    const student = resolved.student;
    const studentId = clean(student && student.id);
    const division = normalizeStudentDivision(student);
    const sessionDate = localDateKey(opts.date);
    const timeSlot = Number(opts.timeSlot || 0);

    if (!studentId || !division) return { ok:false, message:'학생의 수업 구분을 확인하지 못했어요.' };
    if (!sessionDate || !timeSlot) return { ok:false, message:'보강 날짜와 시간을 확인해 주세요.' };

    const weekData = await loadFreshWeek(sessionDate);
    if (duplicateMakeup(weekData, studentId, sessionDate, timeSlot)) {
      return { ok:false, message:clean(student.name) + ' 학생은 이미 ' + fallbackDateLabel(sessionDate) + ' ' + timeSlot + '시 보강이 등록되어 있어요.' };
    }

    const availability = await findAvailableSlots({
      date: sessionDate,
      dateLabel: clean(opts.dateLabel),
      division,
      purpose:'makeup'
    });
    if (availability.closedDay) {
      return { ok:false, message:describeAvailableSlots(availability) };
    }

    const target = chooseOpenSlot(availability, timeSlot, opts.classGroup, '');
    if (!target.ok) return target;

    const slot = target.slot;
    const groupText = slot.grouped ? ' ' + classGroup(slot.classGroup) + '반' : '';
    return {
      ok:true,
      command:{
        intent:'add_makeup',
        studentId,
        studentName:clean(student.name),
        division,
        sessionDate,
        timeSlot,
        classGroup:classGroup(slot.classGroup)
      },
      message:
        clean(student.name) + ' · ' + fallbackDateLabel(sessionDate) + ' ' + timeSlot + '시' + groupText
        + '\n보강으로 등록할까요?\n\'확인\' 또는 \'취소\'라고 입력해 주세요.'
    };
  }

  async function prepareMoveCommand(options) {
    const opts = options || {};
    const resolved = resolveCommandStudent(opts.studentName, opts.selectedStudent);
    if (!resolved.ok) return resolved;

    const student = resolved.student;
    const studentId = clean(student && student.id);
    const division = normalizeStudentDivision(student);
    const effectiveDate = localDateKey(opts.effectiveDate || new Date());
    const sourceWeekday = Number(opts.sourceWeekday || 0);
    const sourceTimeSlot = Number(opts.sourceTimeSlot || 0);
    const targetWeekday = Number(opts.targetWeekday || 0);
    const targetTimeSlot = Number(opts.targetTimeSlot || 0);

    if (!studentId || !division) return { ok:false, message:'학생의 수업 구분을 확인하지 못했어요.' };
    if (!effectiveDate || !sourceWeekday || !targetWeekday || !targetTimeSlot) {
      return { ok:false, message:'이동할 요일과 시간을 확인해 주세요.' };
    }

    const currentWeek = await loadFreshWeek(effectiveDate);
    let sources = activeStudentEnrollments(currentWeek, studentId, effectiveDate)
      .filter(row => Number(row && row.weekday) === sourceWeekday);
    if (sourceTimeSlot) sources = sources.filter(row => Number(row && row.time_slot) === sourceTimeSlot);

    if (!sources.length) {
      const sourceText = weekdayLabel(sourceWeekday) + (sourceTimeSlot ? ' ' + sourceTimeSlot + '시' : '');
      return { ok:false, message:clean(student.name) + ' 학생의 ' + sourceText + ' 정규수업을 찾지 못했어요.' };
    }
    if (sources.length > 1) {
      const times = sources.map(row => Number(row.time_slot) + '시').join(' · ');
      return {
        ok:false,
        message:clean(student.name) + ' 학생은 ' + weekdayLabel(sourceWeekday) + ' 수업이 여러 개 있어요: ' + times
          + '\n이동할 기존 시간도 함께 적어 주세요.'
      };
    }

    const source = sources[0];
    if (Number(source.weekday) === targetWeekday && Number(source.time_slot) === targetTimeSlot) {
      return { ok:false, message:'현재 수업과 같은 요일·시간이에요.' };
    }

    const existingTarget = activeStudentEnrollments(currentWeek, studentId, effectiveDate).find(row =>
      clean(row && row.id) !== clean(source.id)
      && Number(row && row.weekday) === targetWeekday
      && Number(row && row.time_slot) === targetTimeSlot
    );
    if (existingTarget) {
      return { ok:false, message:clean(student.name) + ' 학생은 이미 ' + weekdayLabel(targetWeekday) + ' ' + targetTimeSlot + '시에 정규수업이 있어요.' };
    }

    const targetDate = nextOccurrenceKey(effectiveDate, targetWeekday);
    const availability = await findAvailableSlots({
      date: targetDate,
      dateLabel:weekdayLabel(targetWeekday),
      division,
      purpose:'schedule_move'
    });
    if (availability.closedDay) {
      return { ok:false, message:describeAvailableSlots(availability) };
    }

    const target = chooseOpenSlot(
      availability,
      targetTimeSlot,
      opts.classGroup,
      classGroup(source && source.class_group)
    );
    if (!target.ok) return target;

    const slot = target.slot;
    const sourceText = weekdayLabel(sourceWeekday) + ' ' + Number(source.time_slot) + '시';
    const groupText = slot.grouped ? ' ' + classGroup(slot.classGroup) + '반' : '';
    const targetText = weekdayLabel(targetWeekday) + ' ' + targetTimeSlot + '시' + groupText;

    return {
      ok:true,
      command:{
        intent:'move_class',
        studentId,
        studentName:clean(student.name),
        division,
        sourceEnrollmentId:clean(source.id),
        sourceWeekday,
        sourceTimeSlot:Number(source.time_slot),
        targetWeekday,
        targetTimeSlot,
        targetClassGroup:classGroup(slot.classGroup),
        targetCheckDate:targetDate,
        effectiveDate
      },
      message:
        clean(student.name) + ' · ' + sourceText + ' → ' + targetText
        + '\n정규수업 시간을 변경할까요?\n\'확인\' 또는 \'취소\'라고 입력해 주세요.'
    };
  }

  async function prepareWriteCommand(intent, options) {
    if (intent === 'add_makeup') return prepareMakeupCommand(options);
    if (intent === 'move_class') return prepareMoveCommand(options);
    return { ok:false, message:'아직 지원하지 않는 쓰기 명령이에요.' };
  }

  async function executePreparedWrite(command) {
    const item = command || {};
    const intent = clean(item.intent);
    let result;

    const pc = global.OlliTimetableService;
    const phone = global.OlliPhoneStudentScheduleService;

    if (intent === 'add_makeup') {
      if (pc && typeof pc.addMakeup === 'function') {
        result = await pc.addMakeup(item.studentId, item.sessionDate, item.timeSlot, '', item.classGroup || 'A');
      } else if (phone && typeof phone.request === 'function') {
        result = await phone.request('olli_schedule_execute', {
          p_action:'add_one_time',
          p_params:{
            student_id:item.studentId,
            session_date:item.sessionDate,
            time_slot:Number(item.timeSlot),
            class_group:item.classGroup || 'A',
            note:''
          }
        });
      } else {
        throw new Error('시간표 저장 기능을 아직 불러오지 못했습니다.');
      }
    } else if (intent === 'move_class') {
      const recheck = await findAvailableSlots({
        date:item.targetCheckDate || nextOccurrenceKey(item.effectiveDate, item.targetWeekday),
        dateLabel:weekdayLabel(item.targetWeekday),
        division:item.division,
        purpose:'schedule_move'
      });
      const recheckedTarget = chooseOpenSlot(
        recheck,
        item.targetTimeSlot,
        item.targetClassGroup,
        item.targetClassGroup
      );
      if (!recheckedTarget.ok) {
        throw new Error('확인하는 동안 목적지 수업의 자리가 변경되었어요. 다시 조회해 주세요.');
      }

      if (pc && typeof pc.changeSchedule === 'function') {
        result = await pc.changeSchedule({
          studentId:item.studentId,
          sourceEnrollmentId:item.sourceEnrollmentId,
          targetWeekday:Number(item.targetWeekday),
          targetTimeSlot:Number(item.targetTimeSlot),
          targetClassGroup:item.targetClassGroup || 'A',
          effectiveDate:item.effectiveDate,
          changeType:'move',
          allowWait:false
        });
      } else if (phone && typeof phone.request === 'function') {
        result = await phone.request('olli_schedule_execute', {
          p_action:'change',
          p_params:{
            student_id:item.studentId,
            source_enrollment_id:item.sourceEnrollmentId,
            target_weekday:Number(item.targetWeekday),
            target_time_slot:Number(item.targetTimeSlot),
            target_class_group:item.targetClassGroup || 'A',
            effective_date:item.effectiveDate,
            change_type:'move',
            allow_wait:false
          }
        });
      } else {
        throw new Error('시간표 저장 기능을 아직 불러오지 못했습니다.');
      }
    } else {
      throw new Error('지원하지 않는 쓰기 명령입니다.');
    }

    try {
      if (phone && typeof phone.clearWeekCache === 'function') phone.clearWeekCache();
    } catch (_) {}

    try {
      global.dispatchEvent(new CustomEvent('olli:schedule-changed', {
        detail:{
          studentId:clean(item.studentId),
          source:'olli_command',
          intent
        }
      }));
    } catch (_) {}

    try {
      if (typeof global.olliTtRefreshSchedule === 'function') await global.olliTtRefreshSchedule();
    } catch (error) {
      console.warn('명령 실행 후 PC 시간표 갱신 실패:', error);
    }

    return result || {};
  }

  function writeSuccessMessage(command, result) {
    const item = command || {};
    if (item.intent === 'add_makeup') {
      if (result && result.unchanged) {
        return clean(item.studentName) + ' 학생의 보강은 이미 등록되어 있었어요.';
      }
      return clean(item.studentName) + ' 학생의 ' + fallbackDateLabel(item.sessionDate) + ' ' + Number(item.timeSlot) + '시 보강을 등록했어요.';
    }
    if (item.intent === 'move_class') {
      return clean(item.studentName) + ' 학생의 수업을 '
        + weekdayLabel(item.sourceWeekday) + ' ' + Number(item.sourceTimeSlot) + '시에서 '
        + weekdayLabel(item.targetWeekday) + ' ' + Number(item.targetTimeSlot) + '시로 변경했어요.';
    }
    return '시간표 작업을 완료했어요.';
  }

  global.OlliCommandSchedule = Object.freeze({
    VERSION,
    findAvailableSlots,
    describeAvailableSlots,
    prepareWriteCommand,
    executePreparedWrite,
    writeSuccessMessage
  });
})(window);
