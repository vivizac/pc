from pathlib import Path

path = Path('pc-attendance.js')
text = path.read_text(encoding='utf-8')

old = """    const query = String(searchValue ?? app.state.searchValues.attendance ?? '').trim();
    const elementary = studentsForSortMode(app, 'elementary').filter((student) => studentMatchesPcAttendanceSearch(student, query));
    const kinder = studentsForSortMode(app, 'kinder').filter((student) => studentMatchesPcAttendanceSearch(student, query));
    let html = '';
    if (app.state.attendanceDivision === 'all' || app.state.attendanceDivision === 'elementary') {
      html += renderStudentsForSortMode(elementary, 'elementary');
    }
    if (app.state.attendanceDivision === 'all' || app.state.attendanceDivision === 'kinder') {
      html += renderStudentsForSortMode(kinder, 'kinder');
    }
"""

new = """    const query = String(searchValue ?? app.state.searchValues.attendance ?? '').trim();
    const studentsForDisplay = (type) => {
      if (!query) return studentsForSortMode(app, type);
      const all = typeof global.getStudentsByType === 'function' ? global.getStudentsByType(type) : [];
      return all.filter((student) => {
        try {
          const status = typeof global.getStudentStatus === 'function'
            ? global.getStudentStatus(student)
            : String(student?.status || 'active');
          return status === 'active' || status === 'paused' || status === 'withdrawn';
        } catch (_) {
          return false;
        }
      });
    };
    const elementary = studentsForDisplay('elementary').filter((student) => studentMatchesPcAttendanceSearch(student, query));
    const kinder = studentsForDisplay('kinder').filter((student) => studentMatchesPcAttendanceSearch(student, query));
    let html = '';
    if (app.state.attendanceDivision === 'all' || app.state.attendanceDivision === 'elementary') {
      html += query
        ? renderPlainRows(elementary.slice().sort(compareStudentsByName), 'elementary')
        : renderStudentsForSortMode(elementary, 'elementary');
    }
    if (app.state.attendanceDivision === 'all' || app.state.attendanceDivision === 'kinder') {
      html += query
        ? renderPlainRows(kinder.slice().sort(compareStudentsByName), 'kinder')
        : renderStudentsForSortMode(kinder, 'kinder');
    }
"""

if old not in text:
    raise SystemExit('PC attendance renderList target block not found')

text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')

required = [
    "if (!query) return studentsForSortMode(app, type);",
    "status === 'active' || status === 'paused' || status === 'withdrawn'",
    "? renderPlainRows(elementary.slice().sort(compareStudentsByName), 'elementary')",
    "? renderPlainRows(kinder.slice().sort(compareStudentsByName), 'kinder')",
]
for marker in required:
    if marker not in text:
        raise SystemExit(f'missing marker: {marker}')
