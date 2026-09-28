from pathlib import Path

css_path = Path('pc-timetable.css')
attendance_path = Path('pc-attendance.js')

css = css_path.read_text(encoding='utf-8')
attendance = attendance_path.read_text(encoding='utf-8')

# 1) Make kinder split lanes use the exact same 50:50 grid geometry as elementary.
old_css = r'''/* 분반 박스 부모칸 50:50 꽉채움 */
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
}'''
new_css = r'''/* 분반 박스 부모칸 50:50 꽉채움 */
#recordRoomScreen .olliTtCell.split .olliTtClassLanes.elementary,
#recordRoomScreen .olliTtCell.split .olliTtClassLanes.kinder {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: repeat(2, minmax(0, 1fr));
  gap: 0;
}
#recordRoomScreen .olliTtCell.split .olliTtClassLane.elementary,
#recordRoomScreen .olliTtCell.split .olliTtClassLane.kinder {
  min-height: 0;
  height: auto;
  align-self: stretch;
  padding: 4px 2px;
  border: 0;
  border-radius: 0;
  box-sizing: border-box;
  overflow-y: auto;
}
#recordRoomScreen .olliTtCell.split .olliTtClassLane.kinder + .olliTtClassLane.kinder {
  border-left: 0;
  border-top: 1px solid #dfe4e9;
}'''
if old_css in css:
    css = css.replace(old_css, new_css, 1)
elif new_css not in css:
    raise SystemExit('split fill CSS anchor not found')

# 2) Stop roster scroll jumps at the cause: block mouse focus-scroll on row press,
#    restore once immediately after selection starts, and once after async loading ends.
#    Remove the previous microtask/rAF/timer restoration chain that caused visible bouncing.
old_js = """  function bindRosterClicks() {\n    const list = document.getElementById('recordList');\n    if (!list || list.__olliPcAttendanceClickBound) return;\n    list.__olliPcAttendanceClickBound = true;\n\n    let pointerScroll = null;\n    const captureRosterScroll = (event) => {\n      if (!isPcAttendance() || event.target.closest('.recordAttendanceLeadBtn')) return;\n      const row = event.target.closest('.elementaryStudentRow,.kinderStudentRow');\n      if (!row || !list.contains(row)) return;\n      pointerScroll = { top: list.scrollTop, left: list.scrollLeft };\n    };\n    const restoreRosterScroll = (saved) => {\n      if (!saved || !list.isConnected) return;\n      list.scrollTop = saved.top;\n      list.scrollLeft = saved.left;\n    };\n\n    // Save the position before the button receives browser focus. This prevents\n    // focus/editor replacement from snapping the roster back to the top.\n    list.addEventListener('pointerdown', captureRosterScroll, true);\n    list.addEventListener('click', (event) => {\n      if (!isPcAttendance() || event.target.closest('.recordAttendanceLeadBtn')) return;\n      const row = event.target.closest('.elementaryStudentRow,.kinderStudentRow');\n      if (!row || !list.contains(row)) return;\n      const studentId = extractRowStudentId(row);\n      if (!studentId) return;\n      const saved = pointerScroll || { top: list.scrollTop, left: list.scrollLeft };\n      pointerScroll = null;\n      event.preventDefault();\n      event.stopPropagation();\n      event.stopImmediatePropagation();\n      selectStudent(studentId);\n      try { row.blur(); } catch (_) {}\n      restoreRosterScroll(saved);\n      queueMicrotask(() => restoreRosterScroll(saved));\n      requestAnimationFrame(() => restoreRosterScroll(saved));\n      setTimeout(() => restoreRosterScroll(saved), 40);\n    }, true);\n  }\n"""
new_js = """  function bindRosterClicks() {\n    const list = document.getElementById('recordList');\n    if (!list || list.__olliPcAttendanceClickBound) return;\n    list.__olliPcAttendanceClickBound = true;\n\n    let pointerScroll = null;\n    const rosterRowFromEvent = (event) => {\n      if (!isPcAttendance() || event.target.closest('.recordAttendanceLeadBtn')) return null;\n      const row = event.target.closest('.elementaryStudentRow,.kinderStudentRow');\n      return row && list.contains(row) ? row : null;\n    };\n    const restoreRosterScroll = (saved) => {\n      if (!saved || !list.isConnected) return;\n      if (list.scrollTop !== saved.top) list.scrollTop = saved.top;\n      if (list.scrollLeft !== saved.left) list.scrollLeft = saved.left;\n    };\n\n    // Capture before focus can move. On desktop, cancelling mousedown's default\n    // keeps the roster button from receiving focus and scrolling itself into view.\n    list.addEventListener('pointerdown', (event) => {\n      const row = rosterRowFromEvent(event);\n      if (!row) return;\n      pointerScroll = { top: list.scrollTop, left: list.scrollLeft };\n    }, true);\n    list.addEventListener('mousedown', (event) => {\n      if (rosterRowFromEvent(event)) event.preventDefault();\n    }, true);\n\n    list.addEventListener('click', (event) => {\n      const row = rosterRowFromEvent(event);\n      if (!row) return;\n      const studentId = extractRowStudentId(row);\n      if (!studentId) return;\n      const saved = pointerScroll || { top: list.scrollTop, left: list.scrollLeft };\n      pointerScroll = null;\n      event.preventDefault();\n      event.stopPropagation();\n      event.stopImmediatePropagation();\n\n      const selection = selectStudent(studentId);\n      restoreRosterScroll(saved);\n      Promise.resolve(selection).then(\n        () => restoreRosterScroll(saved),\n        () => restoreRosterScroll(saved)\n      );\n    }, true);\n  }\n"""
if old_js in attendance:
    attendance = attendance.replace(old_js, new_js, 1)
elif "const rosterRowFromEvent = (event) =>" not in attendance:
    raise SystemExit('bindRosterClicks current anchor not found')

css_path.write_text(css, encoding='utf-8')
attendance_path.write_text(attendance, encoding='utf-8')
print('Kinder split geometry and stable roster scroll patch applied.')
