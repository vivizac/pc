from pathlib import Path

# 1) Canonical student modal owner: establish deterministic hook order.
p = Path('olli-record-sort-student-ui.js')
text = p.read_text()

old = "    if (typeof window.olliStudentScheduleAfterPrepareStudentAdd === 'function') window.olliStudentScheduleAfterPrepareStudentAdd(targetView);\n"
new = old + "    if (typeof window.olliPcAuthoritativeScheduleAfterPrepareStudentAdd === 'function') window.olliPcAuthoritativeScheduleAfterPrepareStudentAdd(targetView);\n    if (typeof window.olliPcClassRoutingAfterPrepareStudentAdd === 'function') window.olliPcClassRoutingAfterPrepareStudentAdd(targetView);\n"
if text.count(old) != 1:
    raise SystemExit(f'prepare-add schedule hook anchor mismatch: {text.count(old)}')
text = text.replace(old, new, 1)

old = """    return typeof window.olliStudentScheduleAugmentStudentAddExtra === 'function'
      ? (window.olliStudentScheduleAugmentStudentAddExtra(type, extra) || extra)
      : extra;
  };
  window.olliPrepareInfoExtra = function(type, student){
"""
new = """    let result = extra;
    if (typeof window.olliStudentScheduleAugmentStudentAddExtra === 'function') {
      result = window.olliStudentScheduleAugmentStudentAddExtra(type, result) || result;
    }
    if (typeof window.olliPcAuthoritativeScheduleAugmentStudentAddExtra === 'function') {
      result = window.olliPcAuthoritativeScheduleAugmentStudentAddExtra(type, result) || result;
    }
    if (typeof window.olliPcClassRoutingFinalizeStudentAddExtra === 'function') {
      result = window.olliPcClassRoutingFinalizeStudentAddExtra(type, result) || result;
    }
    return result;
  };
  window.olliPrepareInfoExtra = function(type, student){
"""
if text.count(old) != 1:
    raise SystemExit(f'get-add return anchor mismatch: {text.count(old)}')
text = text.replace(old, new, 1)

old = """      if (typeof window.olliStudentScheduleAfterPrepareInfo === 'function') window.olliStudentScheduleAfterPrepareInfo(type, student);
      if (typeof window.olliTimetableAfterPrepareStudentInfo === 'function') window.olliTimetableAfterPrepareStudentInfo(type, student);
      return;
"""
new = """      if (typeof window.olliStudentScheduleAfterPrepareInfo === 'function') window.olliStudentScheduleAfterPrepareInfo(type, student);
      if (typeof window.olliPcAuthoritativeScheduleAfterPrepareInfo === 'function') window.olliPcAuthoritativeScheduleAfterPrepareInfo(type, student);
      if (typeof window.olliTimetableAfterPrepareStudentInfo === 'function') window.olliTimetableAfterPrepareStudentInfo(type, student);
      return;
"""
if text.count(old) != 1:
    raise SystemExit(f'kinder prepare-info hook anchor mismatch: {text.count(old)}')
text = text.replace(old, new, 1)

old = """      if (typeof window.olliStudentScheduleAfterPrepareInfo === 'function') window.olliStudentScheduleAfterPrepareInfo(type, student);
      if (typeof window.olliTimetableAfterPrepareStudentInfo === 'function') window.olliTimetableAfterPrepareStudentInfo(type, student);
    }
  };
"""
new = """      if (typeof window.olliStudentScheduleAfterPrepareInfo === 'function') window.olliStudentScheduleAfterPrepareInfo(type, student);
      if (typeof window.olliPcAuthoritativeScheduleAfterPrepareInfo === 'function') window.olliPcAuthoritativeScheduleAfterPrepareInfo(type, student);
      if (typeof window.olliTimetableAfterPrepareStudentInfo === 'function') window.olliTimetableAfterPrepareStudentInfo(type, student);
    }
  };
"""
if text.count(old) != 1:
    raise SystemExit(f'elementary prepare-info hook anchor mismatch: {text.count(old)}')
text = text.replace(old, new, 1)

old = """  return typeof window.olliStudentScheduleAugmentInfoExtra === 'function'
    ? (window.olliStudentScheduleAugmentInfoExtra(type, extra) || extra)
    : extra;
};
"""
new = """  let result = extra;
  if (typeof window.olliStudentScheduleAugmentInfoExtra === 'function') {
    result = window.olliStudentScheduleAugmentInfoExtra(type, result) || result;
  }
  if (typeof window.olliPcAuthoritativeScheduleAugmentInfoExtra === 'function') {
    result = window.olliPcAuthoritativeScheduleAugmentInfoExtra(type, result) || result;
  }
  return result;
};
"""
if text.count(old) != 1:
    raise SystemExit(f'get-info return anchor mismatch: {text.count(old)}')
text = text.replace(old, new, 1)

# Validate canonical hook placement before writing anything.
prepare_start = text.index('window.olliPrepareInfoExtra =')
prepare_end = text.index('window.olliGetInfoExtra =', prepare_start)
prepare_section = text[prepare_start:prepare_end]
if prepare_section.count('olliPcAuthoritativeScheduleAfterPrepareInfo') != 2:
    raise SystemExit(f'canonical authoritative prepare-info hook count mismatch: {prepare_section.count("olliPcAuthoritativeScheduleAfterPrepareInfo")}')
if prepare_section.count('olliTimetableAfterPrepareStudentInfo') != 2:
    raise SystemExit(f'canonical timetable prepare-info hook count mismatch: {prepare_section.count("olliTimetableAfterPrepareStudentInfo")}')
for branch_marker in ["if (type === 'kinder')", "if (type === 'elementary')"]:
    branch_start = prepare_section.index(branch_marker)
    next_branch = prepare_section.find("if (type === '", branch_start + len(branch_marker))
    branch = prepare_section[branch_start: next_branch if next_branch >= 0 else len(prepare_section)]
    schedule_pos = branch.index('olliStudentScheduleAfterPrepareInfo')
    authoritative_pos = branch.index('olliPcAuthoritativeScheduleAfterPrepareInfo')
    timetable_pos = branch.index('olliTimetableAfterPrepareStudentInfo')
    if not (schedule_pos < authoritative_pos < timetable_pos):
        raise SystemExit(f'prepare-info hook order invalid for {branch_marker}: {schedule_pos}, {authoritative_pos}, {timetable_pos}')
p.write_text(text)

# 2) PC authoritative editor: expose hooks instead of replacing canonical globals.
p = Path('pc-student-info-card-runtime.js')
text = p.read_text()
start = text.find('    const basePrepareAdd = global.olliPrepareStudentAddExtra;')
end = text.find('\n    global.toggleStudentModalDay =', start)
if start < 0 or end < 0:
    raise SystemExit(f'authoritative wrapper block not found: start={start}, end={end}')
block = text[start:end]
for required in [
    'const baseGetAdd = global.olliGetStudentAddExtra;',
    'const basePrepareInfo = global.olliPrepareInfoExtra;',
    'const baseGetInfo = global.olliGetInfoExtra;',
    'delete result.teacher;',
    'delete result.homeroom_teacher;'
]:
    if required not in block:
        raise SystemExit(f'authoritative wrapper safeguard missing: {required}')
replacement = """    global.olliPcAuthoritativeScheduleAfterPrepareStudentAdd = function(type) {
      studentAddDivision = type === 'kinder' ? 'kinder' : 'elementary';
      scheduleStates.student = emptyScheduleState();
      renderSchedule('student');
    };
    global.olliPcAuthoritativeScheduleAugmentStudentAddExtra = function(type, base) {
      const fields = lessonFieldsFromState(scheduleStates.student);
      return Object.assign({}, base || {}, fields, { class_time: fields.lesson_time });
    };
    global.olliPcAuthoritativeScheduleAfterPrepareInfo = function(type, student) {
      const kind = type === 'kinder' ? 'kinder' : 'elementary';
      scheduleStates[kind] = stateFromStudent(student || {});
      renderSchedule(kind);
    };
    global.olliPcAuthoritativeScheduleAugmentInfoExtra = function(type, base) {
      const kind = type === 'kinder' ? 'kinder' : 'elementary';
      const fields = lessonFieldsFromState(scheduleStates[kind]);
      const result = Object.assign({}, base || {}, fields, { class_time: fields.lesson_time });
      // 학생정보에서는 담임을 수정하지 않습니다. 담임의 유일한 원본은 시간표 1회차 반입니다.
      delete result.teacher;
      delete result.homeroom_teacher;
      return result;
    };
"""
text = text[:start] + replacement + text[end:]
p.write_text(text)

# 3) PC class routing: final registration hook, no global wrapper and no schedule-pair override.
p = Path('pc-student-class-routing.js')
text = p.read_text()
start = text.find('    const basePrepare = global.olliPrepareStudentAddExtra;')
end = text.find('    global.olliPrepareStudentRegistrationRouting = async function(type) {', start)
if start < 0 or end < 0:
    raise SystemExit(f'class-routing wrapper block not found: start={start}, end={end}')
block = text[start:end]
for required in [
    'global.olliPrepareStudentAddExtra = function classBasedStudentAddPrepare(type)',
    'global.olliGetStudentAddExtra = function classBasedStudentAddExtra(type)',
    'global.olliGetStudentAddSchedulePairs = function() { return []; };'
]:
    if required not in block:
        raise SystemExit(f'class-routing wrapper safeguard missing: {required}')
replacement = """    global.olliPcClassRoutingAfterPrepareStudentAdd = function(type) {
      registration.division = type === 'kinder' ? 'kinder' : 'elementary';
      registration.selected = [];
      registration.options = [];
      hideLegacyRegistrationScheduleFields();
      setTimeout(refreshRegistrationOptions, 0);
    };

    global.olliPcClassRoutingFinalizeStudentAddExtra = function(type, base) {
      const next = Object.assign({}, base || {}, { lesson_day:'', lesson_time:'', class_time:'' });
      delete next.teacher;
      delete next.homeroom_teacher;
      return next;
    };

"""
text = text[:start] + replacement + text[end:]
p.write_text(text)
