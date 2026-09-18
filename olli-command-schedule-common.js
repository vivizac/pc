(function olliCommandScheduleCommon(global) {
  'use strict';

  if (global.OlliCommandSchedule) return;

  const VERSION = '2026-09-18-available-slots-1';

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
      closedDay: false,
      closedReason: '',
      slots
    };
  }

  function divisionLabel(value) {
    return value === 'kinder' ? '유치부' : '초등부';
  }

  function purposeLabel(value) {
    if (value === 'makeup') return '보강 가능한';
    if (value === 'trial') return '체험수업 가능한';
    if (value === 'new_enrollment') return '신규등록 가능한';
    return '자리가 남은';
  }

  function slotLabel(slot) {
    const group = slot && slot.grouped ? ' ' + classGroup(slot.classGroup) + '반' : '';
    return String(Number(slot && slot.timeSlot || 0)) + '시' + group + ' ' + Number(slot && slot.remaining || 0) + '자리';
  }

  function describeAvailableSlots(result) {
    const data = result || {};
    const purpose = purposeLabel(data.purpose);
    if (data.closedDay) {
      return '오늘은 ' + (data.closedReason || '휴원일') + '이라 정상 수업이 없어요.';
    }

    const slots = Array.isArray(data.slots) ? data.slots : [];
    if (!slots.length) {
      const prefix = data.division ? divisionLabel(data.division) + ' ' : '';
      return '오늘 ' + prefix + purpose + ' 운영 클래스가 없어요.';
    }

    const intro = data.purpose === 'unknown'
      ? '오늘 자리가 남은 클래스예요.'
      : '오늘 ' + purpose + ' 클래스예요.';

    const divisions = data.division ? [data.division] : ['elementary', 'kinder'];
    const lines = divisions.map(division => {
      const rows = slots.filter(slot => slot.division === division);
      if (!rows.length) return '';
      return divisionLabel(division) + ': ' + rows.map(slotLabel).join(' · ');
    }).filter(Boolean);

    return [intro].concat(lines).join('\n');
  }

  global.OlliCommandSchedule = Object.freeze({
    VERSION,
    findAvailableSlots,
    describeAvailableSlots
  });
})(window);
