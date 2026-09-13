from pathlib import Path

ui = Path('olli-record-sort-student-ui.js')
text = ui.read_text()

kinder_old = """      if (typeof window.olliStudentScheduleAfterPrepareInfo === 'function') window.olliStudentScheduleAfterPrepareInfo(type, student);\n      return;\n"""
kinder_new = """      if (typeof window.olliStudentScheduleAfterPrepareInfo === 'function') window.olliStudentScheduleAfterPrepareInfo(type, student);\n      if (typeof window.olliTimetableAfterPrepareStudentInfo === 'function') window.olliTimetableAfterPrepareStudentInfo(type, student);\n      return;\n"""
if text.count(kinder_old) != 1:
    raise SystemExit(f'kinder hook anchor mismatch: {text.count(kinder_old)}')
text = text.replace(kinder_old, kinder_new, 1)

elem_old = """      if (typeof window.olliStudentScheduleAfterPrepareInfo === 'function') window.olliStudentScheduleAfterPrepareInfo(type, student);\n    }\n  };\n  window.olliGetInfoExtra = function(type){\n"""
elem_new = """      if (typeof window.olliStudentScheduleAfterPrepareInfo === 'function') window.olliStudentScheduleAfterPrepareInfo(type, student);\n      if (typeof window.olliTimetableAfterPrepareStudentInfo === 'function') window.olliTimetableAfterPrepareStudentInfo(type, student);\n    }\n  };\n  window.olliGetInfoExtra = function(type){\n"""
if text.count(elem_old) != 1:
    raise SystemExit(f'elementary hook anchor mismatch: {text.count(elem_old)}')
text = text.replace(elem_old, elem_new, 1)
ui.write_text(text)

tt = Path('pc-timetable.js')
text = tt.read_text()
start = text.find('  function installStudentInfoBridge() {')
end = text.find('\n  async function refreshScheduleFromServer()', start)
if start < 0 or end < 0:
    raise SystemExit(f'timetable bridge block not found: start={start}, end={end}')
old_block = text[start:end]
for required in [
    'const original = global.olliPrepareInfoExtra;',
    'global.olliPrepareInfoExtra = wrapped;',
    'injectStudentInfoPanel(student)'
]:
    if required not in old_block:
        raise SystemExit(f'timetable bridge safeguard missing: {required}')
replacement = """  function handlePreparedStudentInfo(type, student) {
    if (!student) return;
    if (state.data) setTimeout(() => injectStudentInfoPanel(student), 0);
    else {
      service.loadWeek(dateKey(mondayOf(new Date()))).then((data) => {
        state.data = data;
        injectStudentInfoPanel(student);
      }).catch((error) => console.warn('학생정보 시간표를 불러오지 못했습니다:', error));
    }
  }

  function installStudentInfoBridge() {
    global.olliTimetableAfterPrepareStudentInfo = handlePreparedStudentInfo;
  }
"""
text = text[:start] + replacement + text[end:]
tt.write_text(text)
