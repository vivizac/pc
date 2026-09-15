from pathlib import Path

js_path = Path('pc-timetable-attendance-register.js')
css_path = Path('pc-timetable.css')
js = js_path.read_text(encoding='utf-8')
css = css_path.read_text(encoding='utf-8')

replacements = [
    (
        '#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment.attendanceLinkedMark{color:#249e58;background:#dcf4e5!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
        '#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment.attendanceLinkedMark{color:#249e58;background:#c9f0d8!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    ),
    (
        "    const schoolHeader = state.attendanceDivision === 'combined' ? '소속' : (state.attendanceDivision === 'kinder' ? '유치원/나이' : '학교/학년');\n    const header = `<thead><tr><th class=\"nameCol\">이름</th><th class=\"schoolGradeCol\">${schoolHeader}</th><th class=\"personalityCol\">성향</th>${dayHeaders}</tr></thead>`;",
        "    const schoolHeader = state.attendanceDivision === 'combined' ? '소속' : (state.attendanceDivision === 'kinder' ? '유치원<br>나이' : '학교<br>학년');\n    const header = `<thead><tr><th class=\"nameCol\">이름</th><th class=\"schoolGradeCol\">${schoolHeader}</th><th class=\"personalityCol\">성</th>${dayHeaders}</tr></thead>`;"
    ),
]
for old, new in replacements:
    if old not in js:
        raise SystemExit(f'expected JS source not found: {old[:100]}')
    js = js.replace(old, new, 1)

old_css = """#recordRoomScreen .olliTtAttendanceTable tbody td.nameCol {
  background: #fafbfc !important;
  color: #424a56;
  font-weight: 800;
}
"""
new_css = """#recordRoomScreen .olliTtAttendanceTable thead th.schoolGradeCol {
  line-height: 1.15;
}
#recordRoomScreen .olliTtAttendanceTable tbody td.nameCol {
  background: #fafbfc !important;
  color: #111318;
  font-weight: 800;
}
#recordRoomScreen .olliTtAttendanceTable tbody td.schoolGradeCol,
#recordRoomScreen .olliTtAttendanceTable tbody td.personalityCol {
  color: #7b8490;
  font-weight: 600;
}
"""
if old_css not in css:
    raise SystemExit('expected CSS name cell block not found')
css = css.replace(old_css, new_css, 1)

js_path.write_text(js, encoding='utf-8')
css_path.write_text(css, encoding='utf-8')
