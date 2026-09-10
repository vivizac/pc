from pathlib import Path

css_path = Path('pc-timetable.css')
attendance_path = Path('pc-attendance.js')

css = css_path.read_text(encoding='utf-8')
attendance = attendance_path.read_text(encoding='utf-8')

# 1) Split timetable lanes must fill the parent cell exactly.
marker = '/* 분반 박스 부모칸 50:50 꽉채움 */'
if marker not in css:
    css += r'''

/* 분반 박스 부모칸 50:50 꽉채움 */
#recordRoomScreen .olliTtCell.split .olliTtClassLanes.elementary {
  width: 100%;
  height: 100%;
  grid-template-rows: repeat(2, minmax(0, 1fr));
  gap: 0;
}
#recordRoomScreen .olliTtCell.split .olliTtClassLane.elementary {
  min-height: 0;
  height: 100%;
  box-sizing: border-box;
  overflow-y: auto;
}
#recordRoomScreen .olliTtCell.split .olliTtClassLanes.kinder {
  width: 100%;
  height: 100%;
  gap: 0;
}
#recordRoomScreen .olliTtCell.split .olliTtClassLane.kinder {
  min-height: 0;
  flex: 1 1 50%;
  box-sizing: border-box;
}
'''

# 2) Preserve observation/personality-record student roster scroll from pointerdown
#    through the synchronous editor/student selection work.
old = """  function bindRosterClicks() {\n    const list = document.getElementById('recordList');\n    if (!list || list.__olliPcAttendanceClickBound) return;\n    list.__olliPcAttendanceClickBound = true;\n    list.addEventListener('click', (event) => {\n      if (!isPcAttendance() || event.target.closest('.recordAttendanceLeadBtn')) return;\n      const row = event.target.closest('.elementaryStudentRow,.kinderStudentRow');\n      if (!row || !list.contains(row)) return;\n      const studentId = extractRowStudentId(row);\n      if (!studentId) return;\n      event.preventDefault();\n      event.stopPropagation();\n      event.stopImmediatePropagation();\n      selectStudent(studentId);\n    }, true);\n  }\n"""
new = """  function bindRosterClicks() {\n    const list = document.getElementById('recordList');\n    if (!list || list.__olliPcAttendanceClickBound) return;\n    list.__olliPcAttendanceClickBound = true;\n\n    let pointerScroll = null;\n    const captureRosterScroll = (event) => {\n      if (!isPcAttendance() || event.target.closest('.recordAttendanceLeadBtn')) return;\n      const row = event.target.closest('.elementaryStudentRow,.kinderStudentRow');\n      if (!row || !list.contains(row)) return;\n      pointerScroll = { top: list.scrollTop, left: list.scrollLeft };\n    };\n    const restoreRosterScroll = (saved) => {\n      if (!saved || !list.isConnected) return;\n      list.scrollTop = saved.top;\n      list.scrollLeft = saved.left;\n    };\n\n    // Save the position before the button receives browser focus. This prevents\n    // focus/editor replacement from snapping the roster back to the top.\n    list.addEventListener('pointerdown', captureRosterScroll, true);\n    list.addEventListener('click', (event) => {\n      if (!isPcAttendance() || event.target.closest('.recordAttendanceLeadBtn')) return;\n      const row = event.target.closest('.elementaryStudentRow,.kinderStudentRow');\n      if (!row || !list.contains(row)) return;\n      const studentId = extractRowStudentId(row);\n      if (!studentId) return;\n      const saved = pointerScroll || { top: list.scrollTop, left: list.scrollLeft };\n      pointerScroll = null;\n      event.preventDefault();\n      event.stopPropagation();\n      event.stopImmediatePropagation();\n      selectStudent(studentId);\n      try { row.blur(); } catch (_) {}\n      restoreRosterScroll(saved);\n      queueMicrotask(() => restoreRosterScroll(saved));\n      requestAnimationFrame(() => restoreRosterScroll(saved));\n      setTimeout(() => restoreRosterScroll(saved), 40);\n    }, true);\n  }\n"""
if old in attendance:
    attendance = attendance.replace(old, new, 1)
elif 'let pointerScroll = null;' not in attendance:
    raise SystemExit('bindRosterClicks anchor not found')

css_path.write_text(css, encoding='utf-8')
attendance_path.write_text(attendance, encoding='utf-8')
print('Split boxes and observation roster scroll patch applied.')
