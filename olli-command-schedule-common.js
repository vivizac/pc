(function olliCommandScheduleCommon(global) {
  'use strict';

  if (global.OlliCommandSchedule) return;

  const VERSION = '2026-09-18-availability-baseline-1';

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

  function regularAbsenceCount(data, division, dateKey, weekday, timeSlot, group) {
    const regularStudentIds = new Set(
      arrays(data, 'enrollments')
        .filter(row =>
          clean(row && row.division) === division
          && Number(row && row.weekday) === Number(weekday)
          && Number(row && row.time_slot) === Number(timeSlot)
          && classGroup(row && row.class_group) === group
          && rowEffectiveOn(row, dateKey)
          && clean(row && row.student_id)
        )
        .map(row => clean(row && row.student_id))
    );
    if (!regularStudentIds.size) return 0;
    const absentStudentIds = new Set();
    arrays(data, 'attendance_overrides').forEach(row => {
      const studentId = clean(row && row.student_id);
      if (!studentId || !regularStudentIds.has(studentId)) return;
      if (clean(row && row.session_date).slice(0, 10) !== dateKey) return;
      if (Number(row && row.time_slot) !== Number(timeSlot)) return;
      if (classGroup(row && row.class_group) !== group) return;
      if (clean(row && (row.register_session_kind || row.session_kind)).toLowerCase() !== 'regular') return;
      if (clean(row && row.register_status).toLowerCase() !== 'absent') return;
      absentStudentIds.add(studentId);
    });
    return absentStudentIds.size;
  }

  function oneTimeBreakdown(data, division, dateKey, timeSlot, group) {
    let makeupCount = 0;
    let trialCount = 0;
    arrays(data, 'one_time_sessions').forEach(row => {
      if (clean(row && row.division) !== division) return;
      if (clean(row && row.session_date).slice(0, 10) !== dateKey) return;
      if (Number(row && row.time_slot) !== Number(timeSlot)) return;
      if (classGroup(row && row.class_group) !== group) return;
      if (clean(row && row.status).toLowerCase() === 'cancelled') return;
      if (clean(row && row.session_type).toLowerCase() === 'trial') trialCount += 1;
      else makeupCount += 1;
    });
    return {
      makeupCount,
      trialCount,
      oneTimeCount:makeupCount + trialCount
    };
  }

  function oneTimeCount(data, division, dateKey, timeSlot, group) {
    return oneTimeBreakdown(data, division, dateKey, timeSlot, group).oneTimeCount;
  }

  function slotSnapshot(data, division, dateKey, weekday, timeSlot, group, grouped) {
    const capacity = capacityFor(data, division);
    const regular = regularCount(data, division, dateKey, weekday, timeSlot, group);
    const absent = regularAbsenceCount(data, division, dateKey, weekday, timeSlot, group);
    const oneTime = oneTimeBreakdown(data, division, dateKey, timeSlot, group);
    const effectiveRegular = Math.max(0, regular - absent);
    const occupancy = effectiveRegular + oneTime.oneTimeCount;
    return {
      division,
      date:dateKey,
      weekday,
      timeSlot:Number(timeSlot),
      classGroup:classGroup(group),
      grouped:!!grouped,
      regularCount:regular,
      absentCount:absent,
      effectiveRegularCount:effectiveRegular,
      makeupCount:oneTime.makeupCount,
      trialCount:oneTime.trialCount,
      oneTimeCount:oneTime.oneTimeCount,
      occupancy,
      capacity,
      remaining:Math.max(0, capacity - occupancy)
    };
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
    const regular = regularCount(data, division, dateKey, weekday, timeSlot, group);
    const absent = regularAbsenceCount(data, division, dateKey, weekday, timeSlot, group);
    return Math.max(0, regular - absent)
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

  function calendarDayFor(data, dateKey) {
    return arrays(data, 'calendar_days').find(row =>
      clean(row && row.session_date).slice(0, 10) === clean(dateKey)
    ) || null;
  }

  function filterDisplaySlots(allSlots, availableSlots, options) {
    const opts = options || {};
    const timeSlot = Number(opts.timeSlot || 0);
    const wantedGroup = requestedGroup(opts.classGroup);
    const useAll = clean(opts.viewMode) === 'schedule' || !!timeSlot || !!wantedGroup;
    return (useAll ? allSlots : availableSlots).filter(slot => {
      if (timeSlot && Number(slot && slot.timeSlot) !== timeSlot) return false;
      if (wantedGroup && classGroup(slot && slot.classGroup) !== wantedGroup) return false;
      return true;
    });
  }

  function buildDateAvailabilityFromData(data, dateKey, options) {
    const opts = options || {};
    const weekday = isoWeekday(dateKey);
    const requestedDivision = normalizeDivision(opts.division);

    if (weekday === 7) {
      return {
        date:dateKey,
        purpose:clean(opts.purpose) || 'unknown',
        division:requestedDivision,
        dateLabel:clean(opts.dateLabel),
        viewMode:clean(opts.viewMode) || 'availability',
        closedDay:true,
        closedReason:'일요일',
        allSlots:[],
        slots:[],
        displaySlots:[]
      };
    }

    const calendar = calendarDayFor(data, dateKey);
    if (calendar && calendar.is_holiday === true) {
      return {
        date:dateKey,
        purpose:clean(opts.purpose) || 'unknown',
        division:requestedDivision,
        dateLabel:clean(opts.dateLabel),
        viewMode:clean(opts.viewMode) || 'availability',
        closedDay:true,
        closedReason:clean(calendar.name) || '휴원일',
        allSlots:[],
        slots:[],
        displaySlots:[]
      };
    }

    const divisions = requestedDivision ? [requestedDivision] : ['elementary', 'kinder'];
    const allSlots = [];

    divisions.forEach(division => {
      validTimes(division, weekday).forEach(timeSlot => {
        const groups = classGroups(data, division, weekday, timeSlot);
        groups.forEach(group => {
          if (!classIsOperating(data, division, dateKey, weekday, timeSlot, group)) return;
          allSlots.push(slotSnapshot(data, division, dateKey, weekday, timeSlot, group, groups.length > 1));
        });
      });
    });

    const slots = allSlots.filter(slot => Number(slot.remaining) > 0);
    return {
      date:dateKey,
      purpose:clean(opts.purpose) || 'unknown',
      division:requestedDivision,
      dateLabel:clean(opts.dateLabel),
      viewMode:clean(opts.viewMode) || 'availability',
      closedDay:false,
      closedReason:'',
      allSlots,
      slots,
      displaySlots:filterDisplaySlots(allSlots, slots, opts)
    };
  }

  async function findAvailableSlots(options) {
    const opts = options || {};
    const dateKey = localDateKey(opts.date || new Date());
    if (!dateKey) throw new Error('조회 날짜를 확인해 주세요.');

    if (isoWeekday(dateKey) === 7) {
      return buildDateAvailabilityFromData({}, dateKey, opts);
    }

    const weekData = await loadFreshWeek(dateKey);
    const calendar = await loadCalendarDay(dateKey, weekData);
    if (calendar) {
      weekData.calendar_days = arrays(weekData, 'calendar_days').filter(row =>
        clean(row && row.session_date).slice(0, 10) !== dateKey
      ).concat([calendar]);
    }
    return buildDateAvailabilityFromData(weekData, dateKey, opts);
  }

  async function loadAvailabilityHorizon(startDate, endDate) {
    const start = localDateKey(startDate);
    const end = localDateKey(endDate);
    if (!start || !end) throw new Error('시간표 조회 기간을 확인해 주세요.');

    const pc = global.OlliTimetableService;
    const phone = global.OlliPhoneStudentScheduleService;

    let dataPromise;
    let calendarPromise;

    if (pc && typeof pc.loadAvailabilityHorizon === 'function') {
      dataPromise = pc.loadAvailabilityHorizon(start, end);
      calendarPromise = typeof pc.loadCalendarRange === 'function'
        ? pc.loadCalendarRange(start, end)
        : Promise.resolve([]);
    } else if (phone && typeof phone.request === 'function') {
      dataPromise = phone.request('olli_schedule_availability_horizon', {
        p_start_date:start,
        p_end_date:end
      });
      calendarPromise = phone.request('olli_schedule_calendar_range', {
        p_start_date:start,
        p_end_date:end
      }).then(result => Array.isArray(result && result.days) ? result.days : []);
    } else {
      throw new Error('시간표 조회 기능을 아직 불러오지 못했습니다.');
    }

    const values = await Promise.all([dataPromise, calendarPromise]);
    const data = values[0] || {};
    data.calendar_days = Array.isArray(values[1]) ? values[1] : [];
    return data;
  }

  function weekStartKey(value, offsetWeeks) {
    const date = parseLocalDate(localDateKey(value));
    if (!date) return '';
    const weekday = date.getDay() || 7;
    date.setDate(date.getDate() - (weekday - 1) + (Number(offsetWeeks || 0) * 7));
    return localDateKey(date);
  }

  async function findWeekAvailability(options) {
    const opts = options || {};
    const start = weekStartKey(opts.date || new Date(), opts.weekOffset || 0);
    const end = addDaysKey(start, 5);
    const data = await loadAvailabilityHorizon(start, end);
    const days = [];

    for (let i = 0; i < 6; i += 1) {
      const dateKey = addDaysKey(start, i);
      days.push(buildDateAvailabilityFromData(data, dateKey, Object.assign({}, opts, {
        dateLabel:fallbackDateLabel(dateKey)
      })));
    }

    return {
      scope:'week',
      startDate:start,
      endDate:end,
      label:clean(opts.dateLabel) || (Number(opts.weekOffset || 0) ? '다음 주' : '이번 주'),
      purpose:clean(opts.purpose) || 'unknown',
      division:normalizeDivision(opts.division),
      viewMode:clean(opts.viewMode) || 'availability',
      timeSlot:Number(opts.timeSlot || 0),
      classGroup:requestedGroup(opts.classGroup),
      days
    };
  }

  function candidateRecurringSlots(data, options) {
    const opts = options || {};
    const requestedDivision = normalizeDivision(opts.division);
    const requestedWeekday = Number(opts.weekday || 0);
    const requestedTime = Number(opts.timeSlot || 0);
    const requestedClassGroup = requestedGroup(opts.classGroup);
    const map = new Map();

    function add(division, weekday, timeSlot, group) {
      const d = normalizeDivision(division);
      const w = Number(weekday || 0);
      const t = Number(timeSlot || 0);
      const g = classGroup(group);
      if (!d || !w || !t) return;
      if (requestedDivision && d !== requestedDivision) return;
      if (requestedWeekday && w !== requestedWeekday) return;
      if (requestedTime && t !== requestedTime) return;
      if (requestedClassGroup && g !== requestedClassGroup) return;
      const key = [d,w,t,g].join('|');
      if (!map.has(key)) map.set(key, { division:d, weekday:w, timeSlot:t, classGroup:g });
    }

    arrays(data, 'class_teachers').forEach(row =>
      add(row && row.division, row && row.weekday, row && row.time_slot, row && row.class_group)
    );
    arrays(data, 'enrollments').forEach(row =>
      add(row && row.division, row && row.weekday, row && row.time_slot, row && row.class_group)
    );

    return Array.from(map.values()).sort((a,b) =>
      a.weekday - b.weekday
      || a.timeSlot - b.timeSlot
      || a.division.localeCompare(b.division)
      || a.classGroup.localeCompare(b.classGroup)
    );
  }

  function nextWeekdayKey(startDate, weekday) {
    const start = parseLocalDate(startDate);
    if (!start) return '';
    const current = isoWeekday(startDate);
    const target = Number(weekday || 0);
    if (!current || target < 1 || target > 6) return '';
    start.setDate(start.getDate() + ((target - current + 7) % 7));
    return localDateKey(start);
  }

  function recurringBaselineSlot(data, candidate, startDate) {
    const date = nextWeekdayKey(startDate, candidate.weekday);
    const groups = classGroups(data, candidate.division, candidate.weekday, candidate.timeSlot);
    const grouped = groups.length > 1;
    const capacity = capacityFor(data, candidate.division);
    const regular = regularCount(
      data,
      candidate.division,
      date,
      candidate.weekday,
      candidate.timeSlot,
      candidate.classGroup
    );
    return {
      division:candidate.division,
      date,
      weekday:candidate.weekday,
      timeSlot:candidate.timeSlot,
      classGroup:candidate.classGroup,
      grouped,
      regularCount:regular,
      makeupCount:0,
      trialCount:0,
      oneTimeCount:0,
      occupancy:regular,
      capacity,
      remaining:Math.max(0, capacity - regular)
    };
  }

  function regularChangePoints(data, baseline, startDate, endDate) {
    const changes = [];
    let date = nextWeekdayKey(startDate, baseline.weekday);
    let previousCount = Number(baseline.regularCount || 0);

    while (date && date <= endDate) {
      const count = regularCount(
        data,
        baseline.division,
        date,
        baseline.weekday,
        baseline.timeSlot,
        baseline.classGroup
      );
      if (count !== previousCount) {
        changes.push({
          division:baseline.division,
          date,
          weekday:baseline.weekday,
          timeSlot:baseline.timeSlot,
          classGroup:baseline.classGroup,
          grouped:baseline.grouped,
          regularCount:count,
          capacity:baseline.capacity,
          remaining:Math.max(0, baseline.capacity - count)
        });
        previousCount = count;
      }
      date = addDaysKey(date, 7);
    }
    return changes;
  }

  function oneTimeExceptionSlots(data, candidates, startDate, endDate) {
    const candidateKeys = new Set(candidates.map(item =>
      [item.division,item.weekday,item.timeSlot,item.classGroup].join('|')
    ));
    const grouped = new Map();

    arrays(data, 'one_time_sessions').forEach(row => {
      const date = clean(row && row.session_date).slice(0, 10);
      if (!date || date < startDate || date > endDate) return;
      if (clean(row && row.status).toLowerCase() === 'cancelled') return;
      const division = normalizeDivision(row && row.division);
      const weekday = isoWeekday(date);
      const timeSlot = Number(row && row.time_slot || 0);
      const group = classGroup(row && row.class_group);
      const candidateKey = [division,weekday,timeSlot,group].join('|');
      if (!candidateKeys.has(candidateKey)) return;
      grouped.set([date,candidateKey].join('|'), { date, division, weekday, timeSlot, classGroup:group });
    });

    return Array.from(grouped.values()).map(item => {
      const groups = classGroups(data, item.division, item.weekday, item.timeSlot);
      return slotSnapshot(
        data,
        item.division,
        item.date,
        item.weekday,
        item.timeSlot,
        item.classGroup,
        groups.length > 1
      );
    }).sort((a,b) =>
      a.date.localeCompare(b.date)
      || a.timeSlot - b.timeSlot
      || a.division.localeCompare(b.division)
      || a.classGroup.localeCompare(b.classGroup)
    );
  }

  function slotKey(slot) {
    return [slot && slot.division,slot && slot.weekday,slot && slot.timeSlot,slot && slot.classGroup].join('|');
  }

  function recurringBookingState(data, slot, startDate, endDate) {
    let date = nextWeekdayKey(startDate, slot && slot.weekday);
    while (date && date <= endDate) {
      const calendar = calendarDayFor(data, date);
      if (!(calendar && calendar.is_holiday === true)) {
        const snapshot = slotSnapshot(
          data,
          slot.division,
          date,
          slot.weekday,
          slot.timeSlot,
          slot.classGroup,
          slot.grouped
        );
        if (Number(snapshot.remaining || 0) > 0) {
          return { available:true, firstDate:date };
        }
      }
      date = addDaysKey(date, 7);
    }
    return { available:false, firstDate:'' };
  }

  async function findRecurringAvailability(options) {
    const opts = options || {};
    const start = localDateKey(opts.date || new Date());
    const end = addDaysKey(start, 365);
    const data = await loadAvailabilityHorizon(start, end);
    const candidates = candidateRecurringSlots(data, opts);
    const baselineSlots = candidates.map(candidate => recurringBaselineSlot(data, candidate, start));
    const regularChanges = [];
    baselineSlots.forEach(slot => {
      regularChanges.push.apply(regularChanges, regularChangePoints(data, slot, start, end));
    });

    const allBaselineSlots = baselineSlots.map(slot => {
      const key = slotKey(slot);
      const changes = regularChanges.filter(item => slotKey(item) === key);
      const safeRegularRemaining = changes.reduce(
        (minimum, item) => Math.min(minimum, Number(item.remaining || 0)),
        Number(slot.remaining || 0)
      );
      const booking = recurringBookingState(data, slot, start, end);
      return Object.assign({}, slot, {
        safeRegularRemaining,
        regularAdmissionAvailable:safeRegularRemaining > 0,
        bookingAvailable:booking.available,
        firstBookingDate:booking.firstDate
      });
    });

    const purpose = clean(opts.purpose) || 'unknown';
    const availabilitySlots = allBaselineSlots.filter(slot => {
      if (purpose === 'makeup' || purpose === 'trial') return slot.bookingAvailable === true;
      return slot.regularAdmissionAvailable === true;
    });

    const oneTimeExceptions = oneTimeExceptionSlots(data, candidates, start, end);
    const displaySlots = filterDisplaySlots(allBaselineSlots, availabilitySlots, opts);

    return {
      scope:'recurring',
      startDate:start,
      endDate:end,
      purpose,
      division:normalizeDivision(opts.division),
      viewMode:clean(opts.viewMode) || 'availability',
      weekday:Number(opts.weekday || 0),
      timeSlot:Number(opts.timeSlot || 0),
      classGroup:requestedGroup(opts.classGroup),
      allSlots:allBaselineSlots,
      slots:availabilitySlots,
      displaySlots,
      regularChanges,
      oneTimeExceptions
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

  function slotCountText(slot) {
    const parts = ['정규 ' + Number(slot && slot.regularCount || 0) + '명'];
    if (Number(slot && slot.absentCount || 0) > 0) parts.push('결석 ' + Number(slot.absentCount) + '명');
    if (Number(slot && slot.makeupCount || 0) > 0) parts.push('보강 ' + Number(slot.makeupCount) + '명');
    if (Number(slot && slot.trialCount || 0) > 0) parts.push('체험 ' + Number(slot.trialCount) + '명');
    return parts.join(' + ');
  }

  function slotLabel(slot) {
    const group = slot && slot.grouped ? ' ' + classGroup(slot.classGroup) + '반' : '';
    const status = Number(slot && slot.remaining || 0) > 0
      ? Number(slot.remaining) + '자리'
      : '마감';
    return String(Number(slot && slot.timeSlot || 0)) + '시' + group
      + ' · ' + slotCountText(slot)
      + ' · 총 ' + Number(slot && slot.occupancy || slot && slot.regularCount || 0)
      + '/' + Number(slot && slot.capacity || 0)
      + ' · ' + status;
  }

  function compactAvailabilitySlotLabel(slot) {
    const group = slot && slot.grouped ? ' ' + classGroup(slot.classGroup) + '반' : '';
    const parts = [
      String(Number(slot && slot.timeSlot || 0)) + '시' + group,
      '정규 ' + Number(slot && slot.regularCount || 0) + '명'
    ];
    if (Number(slot && slot.absentCount || 0) > 0) {
      parts.push(Number(slot.absentCount) + '결석');
    }
    if (Number(slot && slot.makeupCount || 0) > 0) {
      parts.push(Number(slot.makeupCount) + '보강');
    }
    if (Number(slot && slot.trialCount || 0) > 0) {
      parts.push(Number(slot.trialCount) + '체험');
    }
    const status = Number(slot && slot.remaining || 0) > 0
      ? Number(slot.remaining) + '자리'
      : '마감';
    return parts.join(' · ') + ' (' + status + ')';
  }

  function recurringSlotLabel(slot) {
    const group = slot && slot.grouped ? ' ' + classGroup(slot.classGroup) + '반' : '';
    const status = Number(slot && slot.remaining || 0) > 0
      ? Number(slot.remaining) + '자리'
      : '마감';
    return weekdayLabel(slot && slot.weekday) + ' ' + Number(slot && slot.timeSlot || 0) + '시' + group
      + ' · 정규 ' + Number(slot && slot.regularCount || 0) + '명'
      + ' · ' + status;
  }

  function describeAvailableSlots(result) {
    const data = result || {};
    const purpose = clean(data.purpose) || 'unknown';
    const purposeText = purposeLabel(purpose);
    const dateLabel = resultDateLabel(data);
    if (data.closedDay) {
      return dateLabel + '은 ' + (data.closedReason || '휴원일') + '이라 정상 수업이 없어요.';
    }

    const slots = Array.isArray(data.displaySlots) ? data.displaySlots : (Array.isArray(data.slots) ? data.slots : []);
    const operating = Array.isArray(data.allSlots) ? data.allSlots : [];
    const isSchedule = clean(data.viewMode) === 'schedule';
    const hasOpenSeat = slots.some(slot => Number(slot && slot.remaining || 0) > 0);

    if (isSchedule) {
      if (!slots.length) return dateLabel + ' 확인할 수업이 없어요.';
      const divisions = data.division ? [data.division] : ['elementary', 'kinder'];
      const lines = divisions.map(division => {
        const rows = slots.filter(slot => slot.division === division);
        if (!rows.length) return '';
        return divisionLabel(division) + ': ' + rows.map(slotLabel).join(' · ');
      }).filter(Boolean);
      return [dateLabel + ' 시간표예요.'].concat(lines).join('\n');
    }

    let intro = '';
    if (purpose === 'makeup') {
      intro = dateLabel + (hasOpenSeat ? ' 보강 가능합니다.' : ' 보강 자리가 없습니다.');
    } else if (purpose === 'trial') {
      intro = dateLabel + (hasOpenSeat ? ' 체험 예약 가능합니다.' : ' 체험 자리가 없습니다.');
    } else if (purpose === 'new_enrollment') {
      intro = dateLabel + (hasOpenSeat ? ' 신규등록 가능합니다.' : ' 신규등록 자리가 없습니다.');
    } else if (purpose === 'schedule_move') {
      intro = dateLabel + (hasOpenSeat ? ' 수업 이동 가능합니다.' : ' 수업 이동 가능한 자리가 없습니다.');
    } else {
      intro = dateLabel + (hasOpenSeat ? ' 자리 있습니다.' : ' 빈자리가 없습니다.');
    }

    if (!slots.length) {
      if (!operating.length && purpose === 'unknown') {
        return dateLabel + ' 운영 수업이 없어요.';
      }
      return intro;
    }

    const divisions = data.division ? [data.division] : ['elementary', 'kinder'];
    const lines = divisions.map(division => {
      const rows = slots.filter(slot => slot.division === division);
      if (!rows.length) return '';
      return divisionLabel(division) + ': ' + rows.map(compactAvailabilitySlotLabel).join(' · ');
    }).filter(Boolean);

    return [intro].concat(lines).join('\n');
  }

  function describeWeekAvailability(result) {
    const data = result || {};
    const lines = [];
    (Array.isArray(data.days) ? data.days : []).forEach(day => {
      const dateLabel = fallbackDateLabel(day && day.date);
      if (day && day.closedDay) {
        if (clean(data.viewMode) === 'schedule') {
          lines.push(dateLabel + ' · ' + (day.closedReason || '휴원일'));
        }
        return;
      }
      const rows = Array.isArray(day && day.displaySlots) ? day.displaySlots : [];
      if (!rows.length) return;
      const byDivision = data.division ? [data.division] : ['elementary', 'kinder'];
      byDivision.forEach(division => {
        const items = rows.filter(slot => slot.division === division);
        if (!items.length) return;
        lines.push(dateLabel + ' ' + divisionLabel(division) + ': ' + items.map(slotLabel).join(' · '));
      });
    });

    if (!lines.length) {
      return (data.label || '이번 주') + (clean(data.viewMode) === 'schedule'
        ? ' 확인할 수업이 없어요.'
        : ' 정규·보강·체험을 포함해 빈자리가 없어요.');
    }

    const intro = (data.label || '이번 주')
      + (clean(data.viewMode) === 'schedule'
        ? ' 시간표예요. 정규·보강·체험 인원을 따로 표시했어요.'
        : ' 빈자리예요. 정규·보강·체험 인원을 따로 계산했어요.');
    return [intro].concat(lines).join('\n');
  }

  function describeRecurringAvailability(result) {
    const data = result || {};
    const display = Array.isArray(data.displaySlots) ? data.displaySlots : [];
    const allSlots = Array.isArray(data.allSlots) ? data.allSlots : [];
    const lines = [];
    const relevantKeys = new Set(allSlots.map(slot => slotKey(slot)));
    const singleSlot = allSlots.length === 1;
    const baselineByKey = new Map(allSlots.map(slot => [slotKey(slot), slot]));

    function className(slot, includeDivision) {
      const group = slot && slot.grouped ? ' ' + classGroup(slot.classGroup) + '반' : '';
      const prefix = includeDivision ? divisionLabel(slot && slot.division) + ' ' : '';
      return prefix + weekdayLabel(slot && slot.weekday) + ' ' + Number(slot && slot.timeSlot || 0) + '시' + group;
    }

    function currentDetail(slot) {
      const group = slot && slot.grouped ? ' ' + classGroup(slot.classGroup) + '반' : '';
      const status = Number(slot && slot.remaining || 0) > 0
        ? Number(slot.remaining) + '자리'
        : '마감';
      return divisionLabel(slot && slot.division) + ': '
        + Number(slot && slot.timeSlot || 0) + '시' + group
        + ' · 정규 ' + Number(slot && slot.regularCount || 0) + '명'
        + ' (' + status + ')';
    }

    function shortDateLabel(value) {
      const date = parseLocalDate(value);
      if (!date) return '해당 날짜';
      return (date.getMonth() + 1) + '월 ' + date.getDate() + '일';
    }

    function oneTimeReservationText(slot) {
      const makeup = Number(slot && slot.makeupCount || 0);
      const trial = Number(slot && slot.trialCount || 0);
      if (makeup > 0 && trial > 0) return '보강 ' + makeup + '명과 체험 ' + trial + '명';
      if (makeup > 0) return '보강 ' + makeup + '명';
      if (trial > 0) return '체험 ' + trial + '명';
      return '';
    }

    const regularChanges = (Array.isArray(data.regularChanges) ? data.regularChanges : [])
      .filter(item => relevantKeys.has(slotKey(item)));
    const exceptions = (Array.isArray(data.oneTimeExceptions) ? data.oneTimeExceptions : [])
      .filter(item => relevantKeys.has(slotKey(item)));

    if (!display.length && !allSlots.length) {
      lines.push('확인할 정규수업이 없어요.');
    } else {
      const rows = display.length ? display : allSlots.filter(slot => {
        if (data.timeSlot || data.classGroup || data.weekday) return true;
        return false;
      });

      if (!rows.length && clean(data.purpose) !== 'makeup' && clean(data.purpose) !== 'trial') {
        lines.push('정규수업 기준 빈자리가 없습니다.');
      }

      rows.forEach((slot, index) => {
        const includeDivision = !data.division && rows.length > 1;
        const label = className(slot, includeDivision);
        const safeRemaining = Number(
          slot && slot.safeRegularRemaining != null
            ? slot.safeRegularRemaining
            : slot && slot.remaining || 0
        );

        if (index > 0 && lines.length) lines.push('');
        if (safeRemaining > 0) {
          lines.push(label + '는 정규수업 기준 ' + safeRemaining + '자리 있습니다.');
        } else {
          lines.push(label + '는 정규수업 기준 마감되었습니다.');
        }
        lines.push(currentDetail(slot));

        const key = slotKey(slot);
        regularChanges
          .filter(item => slotKey(item) === key)
          .slice(0, 12)
          .forEach(item => {
            const status = Number(item.remaining || 0) > 0
              ? Number(item.remaining) + '자리'
              : '마감';
            lines.push(
              shortDateLabel(item.date) + '부터 정규 '
              + Number(item.regularCount || 0) + '명 / ' + status
            );
          });

        exceptions
          .filter(item => slotKey(item) === key)
          .slice(0, 12)
          .forEach(item => {
            const reservation = oneTimeReservationText(item);
            if (!reservation) return;
            if (Number(item.remaining || 0) > 0) {
              lines.push(
                shortDateLabel(item.date) + '은 ' + reservation
                + '이 예약되어 있어 ' + Number(item.remaining) + '자리 있습니다.'
              );
            } else {
              lines.push(
                shortDateLabel(item.date) + '은 ' + reservation
                + '이 예약되어 있어 해당 날짜도 마감입니다.'
              );
            }
          });
      });
    }

    const purpose = clean(data.purpose) || 'unknown';
    if (purpose === 'makeup' || purpose === 'trial') {
      const relevant = (display.length ? display : allSlots);
      const canBook = relevant.some(slot => slot && slot.bookingAvailable === true);
      if (purpose === 'makeup') {
        lines.push(canBook ? '보강 예약 가능합니다.' : '보강 자리가 없습니다.');
      } else {
        lines.push(canBook ? '체험 예약 가능합니다.' : '체험 자리가 없습니다.');
      }
    }

    return lines.filter((line, index, arr) => line !== '' || (index > 0 && arr[index - 1] !== '')).join('\n');
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

  function operatingGroupsForTarget(weekData, division, dateKey, timeSlot) {
    const weekday = isoWeekday(dateKey);
    if (!weekday || weekday > 6) return [];
    return classGroups(weekData, division, weekday, timeSlot).filter(group =>
      classIsOperating(weekData, division, dateKey, weekday, timeSlot, group)
    );
  }

  function chooseTargetGroup(weekData, division, dateKey, timeSlot, requested) {
    const groups = operatingGroupsForTarget(weekData, division, dateKey, timeSlot);
    const wanted = requestedGroup(requested);
    if (!groups.length) {
      return { ok:false, message:Number(timeSlot) + '시는 현재 운영하지 않는 클래스예요.' };
    }
    if (wanted) {
      if (groups.includes(wanted)) return { ok:true, classGroup:wanted };
      return { ok:false, message:Number(timeSlot) + '시 ' + wanted + '반은 현재 운영하지 않는 클래스예요.' };
    }
    if (groups.length === 1) return { ok:true, classGroup:groups[0] };
    return {
      ok:false,
      message:Number(timeSlot) + '시는 A반과 B반으로 나뉘어 있어요. 대기할 반을 같이 적어 주세요.'
    };
  }

  function duplicateWaitlist(weekData, options) {
    const opts = options || {};
    return arrays(weekData, 'waitlist').some(row => {
      if (Number(row && row.target_weekday) !== Number(opts.targetWeekday)) return false;
      if (Number(row && row.target_time_slot) !== Number(opts.targetTimeSlot)) return false;
      if (classGroup(row && row.target_class_group) !== classGroup(opts.classGroup)) return false;
      if (clean(row && row.status).toLowerCase() === 'cancelled') return false;
      if (opts.studentId) return clean(row && row.student_id) === clean(opts.studentId);
      return row && row.is_guest === true && clean(row.student_name) === clean(opts.guestName);
    });
  }

  function duplicateTrial(weekData, guestName, sessionDate, timeSlot, group) {
    return arrays(weekData, 'one_time_sessions').some(row =>
      row && row.is_guest === true
      && clean(row.student_name) === clean(guestName)
      && clean(row.session_type).toLowerCase() === 'trial'
      && clean(row.session_date).slice(0, 10) === clean(sessionDate)
      && Number(row.time_slot) === Number(timeSlot)
      && classGroup(row.class_group) === classGroup(group)
      && clean(row.status).toLowerCase() !== 'cancelled'
    );
  }

  function rowDateLabel(row) {
    return fallbackDateLabel(clean(row && row.session_date).slice(0, 10));
  }

  function commandRequiresReason(command) {
    const intent = clean(command && command.intent);
    return intent === 'mark_absent' || intent === 'cancel_makeup' || intent === 'cancel_trial';
  }

  function writeReasonPrompt(command) {
    const item = command || {};
    const name = clean(item.studentName || item.guestName) || '학생';
    if (item.intent === 'mark_absent') return name + ' 학생의 결석 사유를 알려주세요.';
    if (item.intent === 'cancel_makeup') return name + ' 학생의 보강 취소 사유를 알려주세요.';
    if (item.intent === 'cancel_trial') return name + ' 학생의 체험 취소 사유를 알려주세요.';
    return '사유를 알려주세요.';
  }

  function writeConfirmationMessage(command) {
    const item = command || {};
    const reason = clean(item.reason);
    if (item.intent === 'mark_absent') {
      return clean(item.studentName) + ' · ' + fallbackDateLabel(item.sessionDate) + ' ' + Number(item.timeSlot) + '시'
        + '\n결석 사유: ' + reason
        + '\n결석 처리할까요?';
    }
    if (item.intent === 'cancel_makeup') {
      return clean(item.studentName) + ' · ' + fallbackDateLabel(item.sessionDate) + ' ' + Number(item.timeSlot) + '시'
        + '\n보강 취소 사유: ' + reason
        + '\n이 보강을 취소할까요?';
    }
    if (item.intent === 'cancel_trial') {
      return clean(item.guestName || item.studentName) + ' · ' + fallbackDateLabel(item.sessionDate) + ' ' + Number(item.timeSlot) + '시'
        + '\n체험 취소 사유: ' + reason
        + '\n이 체험수업을 취소할까요?';
    }
    return '';
  }

  function changeSourceEnrollment(weekData, change) {
    return arrays(weekData, 'enrollments').find(row =>
      clean(row && row.id) === clean(change && change.source_enrollment_id)
    ) || null;
  }

  function changeTargetEnrollment(weekData, change) {
    return arrays(weekData, 'enrollments').find(row =>
      clean(row && row.id) === clean(change && change.target_enrollment_id)
    ) || null;
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

  async function prepareWaitlistCommand(options) {
    const opts = options || {};
    const sessionDate = localDateKey(opts.date);
    const targetWeekday = isoWeekday(sessionDate);
    const targetTimeSlot = Number(opts.timeSlot || 0);
    const requestedDivision = normalizeDivision(opts.division);
    const requestedName = clean(opts.studentName);
    const selected = opts.selectedStudent && clean(opts.selectedStudent.id) ? opts.selectedStudent : null;

    if (!sessionDate || !targetWeekday || targetWeekday > 6 || !targetTimeSlot) {
      return { ok:false, message:'대기할 날짜와 시간을 확인해 주세요.' };
    }

    let student = null;
    let guestName = '';
    if (requestedName) {
      if (selected && clean(selected.name) === requestedName) {
        student = selected;
      } else {
        const candidates = findStudentsByExactName(requestedName);
        if (candidates.length > 1) {
          return { ok:false, message:requestedName + ' 학생이 여러 명 있어요. 학생 목록에서 먼저 학생을 선택한 뒤 다시 명령해 주세요.' };
        }
        if (candidates.length === 1) student = candidates[0];
        else guestName = requestedName;
      }
    } else if (selected) {
      student = selected;
    } else {
      return { ok:false, message:'대기할 학생 이름을 입력해 주세요.' };
    }

    const division = student ? normalizeStudentDivision(student) : requestedDivision;
    if (!division) {
      return { ok:false, message:(guestName || requestedName || '학생') + ' 대기는 유치부인지 초등부인지 함께 적어 주세요.' };
    }
    if (student && requestedDivision && requestedDivision !== division) {
      return { ok:false, message:clean(student.name) + ' 학생의 수업 구분과 입력한 유치부·초등부 정보가 달라요.' };
    }

    const weekData = await loadFreshWeek(sessionDate);
    const groupResult = chooseTargetGroup(weekData, division, sessionDate, targetTimeSlot, opts.classGroup);
    if (!groupResult.ok) return groupResult;

    const studentId = clean(student && student.id);
    const studentName = clean(student && student.name) || guestName;
    if (duplicateWaitlist(weekData, {
      studentId,
      guestName,
      targetWeekday,
      targetTimeSlot,
      classGroup:groupResult.classGroup
    })) {
      return { ok:false, message:studentName + ' 학생은 이미 ' + weekdayLabel(targetWeekday) + ' ' + targetTimeSlot + '시 대기에 등록되어 있어요.' };
    }

    const groupText = operatingGroupsForTarget(weekData, division, sessionDate, targetTimeSlot).length > 1
      ? ' ' + groupResult.classGroup + '반'
      : '';

    return {
      ok:true,
      command:{
        intent:'add_waitlist',
        studentId,
        studentName,
        guestName,
        isGuest:!studentId,
        division,
        effectiveDate:sessionDate,
        sessionDate,
        targetWeekday,
        targetTimeSlot,
        targetClassGroup:groupResult.classGroup
      },
      message:
        studentName + (studentId ? '' : ' (비재원)') + ' · '
        + weekdayLabel(targetWeekday) + ' ' + targetTimeSlot + '시' + groupText
        + '\n대기로 등록할까요?'
    };
  }

  async function prepareTrialCommand(options) {
    const opts = options || {};
    const guestName = clean(opts.guestName || opts.studentName);
    const sessionDate = localDateKey(opts.date);
    const timeSlot = Number(opts.timeSlot || 0);
    let division = normalizeDivision(opts.division);

    if (!guestName) return { ok:false, message:'체험할 학생 이름을 입력해 주세요.' };
    if (!sessionDate || !timeSlot) return { ok:false, message:'체험 날짜와 시간을 확인해 주세요.' };

    if (!division) {
      const candidates = findStudentsByExactName(guestName);
      if (candidates.length === 1) division = normalizeStudentDivision(candidates[0]);
    }
    if (!division) {
      return { ok:false, message:guestName + ' 체험은 유치부인지 초등부인지 함께 적어 주세요.' };
    }

    const weekData = await loadFreshWeek(sessionDate);
    const availability = await findAvailableSlots({
      date:sessionDate,
      dateLabel:clean(opts.dateLabel),
      division,
      purpose:'trial'
    });
    if (availability.closedDay) return { ok:false, message:describeAvailableSlots(availability) };

    const target = chooseOpenSlot(availability, timeSlot, opts.classGroup, '');
    if (!target.ok) return target;
    const slot = target.slot;

    if (duplicateTrial(weekData, guestName, sessionDate, timeSlot, slot.classGroup)) {
      return { ok:false, message:guestName + ' 학생의 ' + fallbackDateLabel(sessionDate) + ' ' + timeSlot + '시 체험은 이미 등록되어 있어요.' };
    }

    const groupText = slot.grouped ? ' ' + classGroup(slot.classGroup) + '반' : '';
    return {
      ok:true,
      command:{
        intent:'add_trial',
        guestName,
        studentName:guestName,
        division,
        sessionDate,
        timeSlot,
        classGroup:classGroup(slot.classGroup)
      },
      message:
        guestName + ' · ' + fallbackDateLabel(sessionDate) + ' ' + timeSlot + '시' + groupText
        + '\n체험수업으로 등록할까요?'
    };
  }

  async function prepareAbsenceCommand(options) {
    const opts = options || {};
    const resolved = resolveCommandStudent(opts.studentName, opts.selectedStudent);
    if (!resolved.ok) return resolved;

    const student = resolved.student;
    const studentId = clean(student && student.id);
    const division = normalizeStudentDivision(student);
    const sessionDate = localDateKey(opts.date || opts.effectiveDate || new Date());
    const weekday = isoWeekday(sessionDate);
    const timeSlot = Number(opts.timeSlot || 0);
    const wantedGroup = requestedGroup(opts.classGroup);

    if (!studentId || !division) return { ok:false, message:'학생의 수업 구분을 확인하지 못했어요.' };
    if (!sessionDate || !weekday || weekday > 6) return { ok:false, message:'결석 처리할 수업 날짜를 확인해 주세요.' };

    const weekData = await loadFreshWeek(sessionDate);
    let rows = activeStudentEnrollments(weekData, studentId, sessionDate)
      .filter(row => Number(row && row.weekday) === weekday);

    if (timeSlot) rows = rows.filter(row => Number(row && row.time_slot) === timeSlot);
    if (wantedGroup) rows = rows.filter(row => classGroup(row && row.class_group) === wantedGroup);
    rows.sort((a,b) => Number(a && a.time_slot) - Number(b && b.time_slot));

    if (!rows.length) {
      const detail = fallbackDateLabel(sessionDate) + (timeSlot ? ' ' + timeSlot + '시' : '');
      return { ok:false, message:clean(student.name) + ' 학생의 ' + detail + ' 정규수업을 찾지 못했어요.' };
    }
    if (rows.length > 1) {
      const choices = rows.map(row => Number(row.time_slot) + '시'
        + (wantedGroup ? ' ' + classGroup(row.class_group) + '반' : '')).join(' · ');
      return {
        ok:false,
        message:clean(student.name) + ' 학생은 ' + fallbackDateLabel(sessionDate) + ' 수업이 여러 개 있어요: ' + choices
          + '\n결석 처리할 시간을 함께 적어 주세요.'
      };
    }

    const item = rows[0];
    return {
      ok:true,
      command:{
        intent:'mark_absent',
        studentId,
        studentName:clean(student.name),
        division,
        sessionDate,
        timeSlot:Number(item.time_slot),
        classGroup:classGroup(item.class_group),
        reason:clean(opts.reason)
      },
      message:clean(student.name) + ' · ' + fallbackDateLabel(sessionDate) + ' ' + Number(item.time_slot) + '시'
    };
  }

  async function prepareCancelMakeupCommand(options) {
    const opts = options || {};
    const resolved = resolveCommandStudent(opts.studentName, opts.selectedStudent);
    if (!resolved.ok) return resolved;

    const student = resolved.student;
    const studentId = clean(student && student.id);
    const baseDate = localDateKey(opts.date || opts.effectiveDate || new Date());
    const explicitDate = !!opts.date;
    const timeSlot = Number(opts.timeSlot || 0);
    const wantedGroup = requestedGroup(opts.classGroup);
    const weekData = await loadFreshWeek(baseDate);

    let rows = arrays(weekData, 'one_time_sessions').filter(row =>
      clean(row && row.student_id) === studentId
      && clean(row && row.status).toLowerCase() !== 'cancelled'
      && clean(row && row.session_type).toLowerCase() !== 'trial'
    );

    if (explicitDate) rows = rows.filter(row => clean(row && row.session_date).slice(0, 10) === baseDate);
    else rows = rows.filter(row => clean(row && row.session_date).slice(0, 10) >= baseDate);
    if (timeSlot) rows = rows.filter(row => Number(row && row.time_slot) === timeSlot);
    if (wantedGroup) rows = rows.filter(row => classGroup(row && row.class_group) === wantedGroup);

    rows.sort((a,b) =>
      clean(a && a.session_date).localeCompare(clean(b && b.session_date))
      || Number(a && a.time_slot) - Number(b && b.time_slot)
    );

    if (!rows.length) {
      const detail = explicitDate ? fallbackDateLabel(baseDate) + (timeSlot ? ' ' + timeSlot + '시' : '') : '이번 주 남은 일정';
      return { ok:false, message:clean(student.name) + ' 학생의 ' + detail + ' 보강을 찾지 못했어요.' };
    }
    if (rows.length > 1) {
      const choices = rows.slice(0, 6).map(row =>
        rowDateLabel(row) + ' ' + Number(row.time_slot) + '시'
        + (requestedGroup(row.class_group) ? ' ' + classGroup(row.class_group) + '반' : '')
      ).join(' · ');
      return {
        ok:false,
        message:clean(student.name) + ' 학생의 취소 가능한 보강이 여러 개 있어요: ' + choices
          + '\n취소할 날짜와 시간을 함께 적어 주세요.'
      };
    }

    const item = rows[0];
    return {
      ok:true,
      command:{
        intent:'cancel_makeup',
        studentId,
        studentName:clean(student.name),
        division:normalizeDivision(item.division) || normalizeStudentDivision(student),
        oneTimeSessionId:clean(item.id),
        sessionDate:clean(item.session_date).slice(0, 10),
        timeSlot:Number(item.time_slot),
        classGroup:classGroup(item.class_group),
        reason:clean(opts.reason)
      },
      message:
        clean(student.name) + ' · ' + rowDateLabel(item) + ' ' + Number(item.time_slot) + '시'
        + '\n이 보강을 취소할까요?'
    };
  }

  async function prepareCancelTrialCommand(options) {
    const opts = options || {};
    const guestName = clean(opts.guestName || opts.studentName);
    if (!guestName) return { ok:false, message:'취소할 체험 학생 이름을 입력해 주세요.' };

    const baseDate = localDateKey(opts.date || opts.effectiveDate || new Date());
    const explicitDate = !!opts.date;
    const timeSlot = Number(opts.timeSlot || 0);
    const wantedGroup = requestedGroup(opts.classGroup);
    const weekData = await loadFreshWeek(baseDate);

    let rows = arrays(weekData, 'one_time_sessions').filter(row =>
      row && row.is_guest === true
      && clean(row.student_name) === guestName
      && clean(row.session_type).toLowerCase() === 'trial'
      && clean(row.status).toLowerCase() !== 'cancelled'
    );

    if (explicitDate) rows = rows.filter(row => clean(row.session_date).slice(0, 10) === baseDate);
    else rows = rows.filter(row => clean(row.session_date).slice(0, 10) >= baseDate);
    if (timeSlot) rows = rows.filter(row => Number(row.time_slot) === timeSlot);
    if (wantedGroup) rows = rows.filter(row => classGroup(row.class_group) === wantedGroup);

    rows.sort((a,b) =>
      clean(a && a.session_date).localeCompare(clean(b && b.session_date))
      || Number(a && a.time_slot) - Number(b && b.time_slot)
    );

    if (!rows.length) {
      const detail = explicitDate ? fallbackDateLabel(baseDate) + (timeSlot ? ' ' + timeSlot + '시' : '') : '이번 주 남은 일정';
      return { ok:false, message:guestName + ' 학생의 ' + detail + ' 체험수업을 찾지 못했어요.' };
    }
    if (rows.length > 1) {
      const choices = rows.slice(0, 6).map(row =>
        rowDateLabel(row) + ' ' + Number(row.time_slot) + '시'
        + (requestedGroup(row.class_group) ? ' ' + classGroup(row.class_group) + '반' : '')
      ).join(' · ');
      return {
        ok:false,
        message:guestName + ' 학생의 취소 가능한 체험수업이 여러 개 있어요: ' + choices
          + '\n취소할 날짜와 시간을 함께 적어 주세요.'
      };
    }

    const item = rows[0];
    return {
      ok:true,
      command:{
        intent:'cancel_trial',
        guestName,
        studentName:guestName,
        division:normalizeDivision(item.division),
        oneTimeSessionId:clean(item.id),
        sessionDate:clean(item.session_date).slice(0, 10),
        timeSlot:Number(item.time_slot),
        classGroup:classGroup(item.class_group),
        reason:clean(opts.reason)
      },
      message:guestName + ' · ' + rowDateLabel(item) + ' ' + Number(item.time_slot) + '시'
    };
  }

  async function prepareCancelMoveCommand(options) {
    const opts = options || {};
    const resolved = resolveCommandStudent(opts.studentName, opts.selectedStudent);
    if (!resolved.ok) return resolved;

    const student = resolved.student;
    const studentId = clean(student && student.id);
    const referenceDate = localDateKey(opts.effectiveDate || new Date());
    const sourceWeekday = Number(opts.sourceWeekday || 0);
    const sourceTimeSlot = Number(opts.sourceTimeSlot || 0);
    const weekData = await loadFreshWeek(referenceDate);

    let rows = arrays(weekData, 'changes').filter(row =>
      clean(row && row.student_id) === studentId
      && clean(row && row.status).toLowerCase() === 'scheduled'
      && clean(row && row.change_type).toLowerCase() === 'move'
    );

    if (sourceWeekday || sourceTimeSlot) {
      rows = rows.filter(row => {
        const source = changeSourceEnrollment(weekData, row);
        if (!source) return false;
        if (sourceWeekday && Number(source.weekday) !== sourceWeekday) return false;
        if (sourceTimeSlot && Number(source.time_slot) !== sourceTimeSlot) return false;
        return true;
      });
    }

    if (!rows.length) {
      return { ok:false, message:clean(student.name) + ' 학생의 취소 가능한 수업 이동 예약을 찾지 못했어요.' };
    }
    if (rows.length > 1) {
      const choices = rows.slice(0, 6).map(row => {
        const source = changeSourceEnrollment(weekData, row);
        const target = changeTargetEnrollment(weekData, row);
        const sourceText = source ? weekdayLabel(source.weekday) + ' ' + Number(source.time_slot) + '시' : '기존 수업';
        const targetText = target ? weekdayLabel(target.weekday) + ' ' + Number(target.time_slot) + '시' : '변경 수업';
        return fallbackDateLabel(row.effective_date) + ' · ' + sourceText + ' → ' + targetText;
      }).join(' · ');
      return {
        ok:false,
        message:clean(student.name) + ' 학생의 수업 이동 예약이 여러 개 있어요: ' + choices
          + '\n기존 수업 요일과 시간을 함께 적어 주세요.'
      };
    }

    const item = rows[0];
    const source = changeSourceEnrollment(weekData, item);
    const target = changeTargetEnrollment(weekData, item);
    const sourceText = source ? weekdayLabel(source.weekday) + ' ' + Number(source.time_slot) + '시' : '기존 수업';
    const targetText = target ? weekdayLabel(target.weekday) + ' ' + Number(target.time_slot) + '시' : '변경 수업';

    return {
      ok:true,
      command:{
        intent:'cancel_move',
        studentId,
        studentName:clean(student.name),
        changeId:clean(item.id),
        effectiveDate:clean(item.effective_date).slice(0, 10),
        sourceWeekday:source ? Number(source.weekday) : 0,
        sourceTimeSlot:source ? Number(source.time_slot) : 0,
        targetWeekday:target ? Number(target.weekday) : 0,
        targetTimeSlot:target ? Number(target.time_slot) : 0
      },
      message:
        clean(student.name) + ' · ' + sourceText + ' → ' + targetText
        + '\n예약된 수업 이동을 취소할까요?'
    };
  }

  async function prepareWriteCommand(intent, options) {
    if (intent === 'mark_absent') return prepareAbsenceCommand(options);
    if (intent === 'add_makeup') return prepareMakeupCommand(options);
    if (intent === 'move_class') return prepareMoveCommand(options);
    if (intent === 'add_waitlist') return prepareWaitlistCommand(options);
    if (intent === 'add_trial') return prepareTrialCommand(options);
    if (intent === 'cancel_makeup') return prepareCancelMakeupCommand(options);
    if (intent === 'cancel_trial') return prepareCancelTrialCommand(options);
    if (intent === 'cancel_move') return prepareCancelMoveCommand(options);
    return { ok:false, message:'아직 지원하지 않는 쓰기 명령이에요.' };
  }

  async function executePreparedWrite(command) {
    const item = command || {};
    const intent = clean(item.intent);
    let result;
    let memoError = null;

    const pc = global.OlliTimetableService;
    const phone = global.OlliPhoneStudentScheduleService;

    if (commandRequiresReason(item) && !clean(item.reason)) {
      throw new Error(writeReasonPrompt(item));
    }

    async function saveStatusMemo(tag) {
      const note = '[' + clean(item.studentName || item.guestName) + '][' + tag + '] : ' + clean(item.reason);
      if (pc && typeof pc.saveCellMemo === 'function') {
        return pc.saveCellMemo(
          normalizeDivision(item.division),
          item.sessionDate,
          Number(item.timeSlot),
          note,
          item.classGroup || 'A',
          null
        );
      }
      if (phone && typeof phone.request === 'function') {
        return phone.request('olli_schedule_save_cell_memo_v3', {
          p_division:normalizeDivision(item.division),
          p_session_date:item.sessionDate,
          p_time_slot:Number(item.timeSlot),
          p_note:note,
          p_class_group:item.classGroup || 'A',
          p_memo_id:null
        });
      }
      throw new Error('사유 메모 저장 기능을 아직 불러오지 못했습니다.');
    }

    if (intent === 'mark_absent') {
      if (pc && typeof pc.setAttendanceSessionStatus === 'function') {
        result = await pc.setAttendanceSessionStatus({
          studentId:item.studentId,
          sessionDate:item.sessionDate,
          sessionKind:'regular',
          timeSlot:Number(item.timeSlot),
          classGroup:item.classGroup || 'A',
          status:'absent'
        });
      } else if (phone && typeof phone.request === 'function') {
        result = await phone.request('olli_schedule_set_attendance_session_status_v2', {
          p_student_id:item.studentId,
          p_session_date:item.sessionDate,
          p_session_kind:'regular',
          p_time_slot:Number(item.timeSlot),
          p_class_group:item.classGroup || 'A',
          p_status:'absent'
        });
      } else {
        throw new Error('결석 저장 기능을 아직 불러오지 못했습니다.');
      }
      try { await saveStatusMemo('결석'); }
      catch (error) { memoError = error; }
    } else if (intent === 'add_makeup') {
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
    } else if (intent === 'add_waitlist') {
      if (item.isGuest) {
        if (pc && typeof pc.addGuestEntry === 'function') {
          result = await pc.addGuestEntry({
            guestName:item.guestName || item.studentName,
            division:item.division,
            entryType:'wait',
            sessionDate:item.sessionDate || item.effectiveDate,
            timeSlot:Number(item.targetTimeSlot),
            classGroup:item.targetClassGroup || 'A'
          });
        } else if (phone && typeof phone.request === 'function') {
          result = await phone.request('olli_schedule_add_guest_entry', {
            p_guest_name:item.guestName || item.studentName,
            p_division:item.division,
            p_entry_type:'wait',
            p_session_date:item.sessionDate || item.effectiveDate,
            p_time_slot:Number(item.targetTimeSlot),
            p_class_group:item.targetClassGroup || 'A'
          });
        } else {
          throw new Error('시간표 저장 기능을 아직 불러오지 못했습니다.');
        }
      } else if (pc && typeof pc.addWaitlist === 'function') {
        result = await pc.addWaitlist({
          studentId:item.studentId,
          targetWeekday:Number(item.targetWeekday),
          targetTimeSlot:Number(item.targetTimeSlot),
          targetClassGroup:item.targetClassGroup || 'A',
          effectiveDate:item.effectiveDate
        });
      } else if (phone && typeof phone.request === 'function') {
        result = await phone.request('olli_schedule_execute', {
          p_action:'add_waitlist',
          p_params:{
            student_id:item.studentId,
            target_weekday:Number(item.targetWeekday),
            target_time_slot:Number(item.targetTimeSlot),
            target_class_group:item.targetClassGroup || 'A',
            effective_date:item.effectiveDate
          }
        });
      } else {
        throw new Error('시간표 저장 기능을 아직 불러오지 못했습니다.');
      }
    } else if (intent === 'add_trial') {
      const trialAvailability = await findAvailableSlots({
        date:item.sessionDate,
        dateLabel:fallbackDateLabel(item.sessionDate),
        division:item.division,
        purpose:'trial'
      });
      const trialTarget = chooseOpenSlot(
        trialAvailability,
        item.timeSlot,
        item.classGroup,
        item.classGroup
      );
      if (!trialTarget.ok) {
        throw new Error('확인하는 동안 체험수업 자리가 변경되었어요. 다시 조회해 주세요.');
      }

      if (pc && typeof pc.addGuestEntry === 'function') {
        result = await pc.addGuestEntry({
          guestName:item.guestName,
          division:item.division,
          entryType:'trial',
          sessionDate:item.sessionDate,
          timeSlot:Number(item.timeSlot),
          classGroup:item.classGroup || 'A'
        });
      } else if (phone && typeof phone.request === 'function') {
        result = await phone.request('olli_schedule_add_guest_entry', {
          p_guest_name:item.guestName,
          p_division:item.division,
          p_entry_type:'trial',
          p_session_date:item.sessionDate,
          p_time_slot:Number(item.timeSlot),
          p_class_group:item.classGroup || 'A'
        });
      } else {
        throw new Error('시간표 저장 기능을 아직 불러오지 못했습니다.');
      }
    } else if (intent === 'cancel_makeup' || intent === 'cancel_trial') {
      if (pc && typeof pc.cancelMakeup === 'function') {
        result = await pc.cancelMakeup(item.oneTimeSessionId);
      } else if (phone && typeof phone.request === 'function') {
        result = await phone.request('olli_schedule_execute', {
          p_action:'cancel_one_time',
          p_params:{ one_time_session_id:item.oneTimeSessionId }
        });
      } else {
        throw new Error('시간표 저장 기능을 아직 불러오지 못했습니다.');
      }
      try { await saveStatusMemo('취소'); }
      catch (error) { memoError = error; }
    } else if (intent === 'cancel_move') {
      if (pc && typeof pc.cancelChange === 'function') {
        result = await pc.cancelChange(item.changeId);
      } else if (phone && typeof phone.request === 'function') {
        result = await phone.request('olli_schedule_execute', {
          p_action:'cancel_change',
          p_params:{ change_id:item.changeId }
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

    if (memoError) {
      const actionLabel = intent === 'mark_absent' ? '결석 처리는' : '취소는';
      const error = new Error(actionLabel + ' 완료됐지만 사유 메모를 저장하지 못했어요. ' + clean(memoError && (memoError.message || memoError)));
      error.primaryCompleted = true;
      throw error;
    }

    return result || {};
  }

  function writeSuccessMessage(command, result) {
    const item = command || {};
    if (item.intent === 'mark_absent') {
      return clean(item.studentName) + ' 학생의 ' + fallbackDateLabel(item.sessionDate) + ' '
        + Number(item.timeSlot) + '시 수업을 결석 처리했고 사유를 메모에 남겼어요.';
    }
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
    if (item.intent === 'add_waitlist') {
      return clean(item.studentName) + (item.isGuest ? ' (비재원)' : ' 학생') + '을 '
        + weekdayLabel(item.targetWeekday) + ' ' + Number(item.targetTimeSlot) + '시 대기에 등록했어요.';
    }
    if (item.intent === 'add_trial') {
      return clean(item.guestName) + ' 학생의 ' + fallbackDateLabel(item.sessionDate) + ' '
        + Number(item.timeSlot) + '시 체험수업을 등록했어요.';
    }
    if (item.intent === 'cancel_makeup') {
      return clean(item.studentName) + ' 학생의 ' + fallbackDateLabel(item.sessionDate) + ' '
        + Number(item.timeSlot) + '시 보강을 취소했고 사유를 메모에 남겼어요.';
    }
    if (item.intent === 'cancel_trial') {
      return clean(item.guestName || item.studentName) + ' 학생의 ' + fallbackDateLabel(item.sessionDate) + ' '
        + Number(item.timeSlot) + '시 체험수업을 취소했고 사유를 메모에 남겼어요.';
    }
    if (item.intent === 'cancel_move') {
      return clean(item.studentName) + ' 학생의 예약된 수업 이동을 취소했어요.';
    }
    return '시간표 작업을 완료했어요.';
  }

  global.OlliCommandSchedule = Object.freeze({
    VERSION,
    findAvailableSlots,
    findWeekAvailability,
    findRecurringAvailability,
    describeAvailableSlots,
    describeWeekAvailability,
    describeRecurringAvailability,
    prepareWriteCommand,
    executePreparedWrite,
    writeReasonPrompt,
    writeConfirmationMessage,
    writeSuccessMessage
  });
})(window);
