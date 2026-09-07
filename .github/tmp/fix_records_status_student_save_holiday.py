from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'{label}: target not found')
    if text.count(old) != 1:
        raise SystemExit(f'{label}: target count={text.count(old)}')
    return text.replace(old, new, 1)

# 1) 성향기록부: 휴원별 / 퇴원별 추가
path = Path('pc-attendance.js')
text = path.read_text(encoding='utf-8')
text = replace_once(
    text,
    "const PC_SORT_MODES = Object.freeze({ DAY: 'day', GROUP: 'group', GRADE: 'grade' });",
    "const PC_SORT_MODES = Object.freeze({ DAY: 'day', GROUP: 'group', GRADE: 'grade', PAUSED: 'paused', WITHDRAWN: 'withdrawn' });",
    'sort modes'
)
old = """  function normalizeSortMode(mode) {\n    return Object.values(PC_SORT_MODES).includes(mode) ? mode : PC_SORT_MODES.DAY;\n  }\n"""
new = """  function normalizeSortMode(mode) {\n    return Object.values(PC_SORT_MODES).includes(mode) ? mode : PC_SORT_MODES.DAY;\n  }\n\n  function statusForSortMode(mode) {\n    if (mode === PC_SORT_MODES.PAUSED) return 'paused';\n    if (mode === PC_SORT_MODES.WITHDRAWN) return 'withdrawn';\n    return '';\n  }\n\n  function studentsForSortMode(app, type) {\n    const status = statusForSortMode(normalizeSortMode(state.sortMode));\n    if (!status) return app.activeStudents(type);\n    const all = typeof global.getStudentsByType === 'function' ? global.getStudentsByType(type) : [];\n    return all.filter((student) => {\n      try {\n        const current = typeof global.getStudentStatus === 'function' ? global.getStudentStatus(student) : String(student?.status || 'active');\n        return current === status;\n      } catch (_) {\n        return false;\n      }\n    });\n  }\n"""
text = replace_once(text, old, new, 'status helpers')
old = """    if (!students.length) return '';\n\n    if (mode === PC_SORT_MODES.DAY) {\n"""
new = """    if (!students.length) return '';\n\n    if (mode === PC_SORT_MODES.PAUSED || mode === PC_SORT_MODES.WITHDRAWN) {\n      return renderPlainRows(students.slice().sort(compareStudentsByName), division);\n    }\n\n    if (mode === PC_SORT_MODES.DAY) {\n"""
text = replace_once(text, old, new, 'status render')
old = """      [PC_SORT_MODES.DAY, '요일별'],\n      [PC_SORT_MODES.GROUP, '그룹별'],\n      [PC_SORT_MODES.GRADE, '학년별']\n"""
new = """      [PC_SORT_MODES.DAY, '요일별'],\n      [PC_SORT_MODES.GROUP, '그룹별'],\n      [PC_SORT_MODES.GRADE, '학년별'],\n      [PC_SORT_MODES.PAUSED, '휴원별'],\n      [PC_SORT_MODES.WITHDRAWN, '퇴원별']\n"""
text = replace_once(text, old, new, 'sidebar buttons')
old = """    const elementary = app.activeStudents('elementary').filter((student) => studentMatchesPcAttendanceSearch(student, query));\n    const kinder = app.activeStudents('kinder').filter((student) => studentMatchesPcAttendanceSearch(student, query));\n"""
new = """    const elementary = studentsForSortMode(app, 'elementary').filter((student) => studentMatchesPcAttendanceSearch(student, query));\n    const kinder = studentsForSortMode(app, 'kinder').filter((student) => studentMatchesPcAttendanceSearch(student, query));\n"""
text = replace_once(text, old, new, 'list source')
path.write_text(text.rstrip() + '\n', encoding='utf-8')

# 2) 학생정보: 프로필 저장과 시간표 저장을 분리하고, 시간표 변경이 없으면 RPC 호출하지 않음
path = Path('pc-student-info-card-runtime.js')
text = path.read_text(encoding='utf-8')
marker = """  function pairsFromLessonFields(lessonDay, lessonTime) {\n"""
helper = """  function schedulePairsEqual(left, right) {\n    const normalizeForCompare = (rows) => normalizePairs(rows).map((pair) => ({\n      weekday: pair.weekday,\n      time_slot: pair.time_slot,\n      class_group: pair.class_group || null\n    }));\n    return JSON.stringify(normalizeForCompare(left)) === JSON.stringify(normalizeForCompare(right));\n  }\n\n"""
if helper not in text:
    text = replace_once(text, marker, helper + marker, 'schedule compare helper')
old = """    cardState.saveInFlight = true;\n    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '저장 중...'; }\n    try {\n"""
new = """    cardState.saveInFlight = true;\n    let saveStage = 'profile';\n    let profileSaved = false;\n    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '저장 중...'; }\n    try {\n"""
text = replace_once(text, old, new, 'save stage state')
old = """      if (typeof global.ensureStudentSavedToSupabase !== 'function') throw new Error('학생정보 저장 함수를 찾지 못했습니다.');\n      const savedStudent = await global.ensureStudentSavedToSupabase(profile);\n      await setAuthoritativeSchedule(savedStudent.id, pairs);\n      if (typeof global.loadStudentsFromSupabase === 'function') await global.loadStudentsFromSupabase();\n"""
new = """      if (typeof global.ensureStudentSavedToSupabase !== 'function') throw new Error('학생정보 저장 함수를 찾지 못했습니다.');\n      const scheduleChanged = !schedulePairsEqual(pairs, cardState.enrollments);\n      const savedStudent = await global.ensureStudentSavedToSupabase(profile);\n      profileSaved = true;\n      if (scheduleChanged) {\n        saveStage = 'schedule';\n        await setAuthoritativeSchedule(savedStudent.id, pairs);\n      }\n      saveStage = 'reload';\n      if (typeof global.loadStudentsFromSupabase === 'function') await global.loadStudentsFromSupabase();\n"""
text = replace_once(text, old, new, 'skip unchanged schedule')
old = """    } catch (error) {\n      alert(`학생정보 저장 중 오류가 발생했어요.\\n\\n${error.message || error}`);\n    } finally {\n"""
new = """    } catch (error) {\n      const message = error.message || error;\n      if (saveStage === 'schedule' && profileSaved) {\n        alert(`학생정보는 저장되었지만 시간표 저장에 실패했어요.\\n\\n${message}\\n\\n시간표 변경예약이 있다면 시간표 페이지에서 예약 내용을 먼저 확인해 주세요.`);\n      } else if (saveStage === 'reload' && profileSaved) {\n        alert(`학생정보는 저장되었지만 화면 새로고침 중 오류가 발생했어요.\\n\\n${message}`);\n      } else {\n        alert(`학생정보 서버 저장 중 오류가 발생했어요.\\n\\n${message}`);\n      }\n    } finally {\n"""
text = replace_once(text, old, new, 'specific save errors')
path.write_text(text.rstrip() + '\n', encoding='utf-8')

# 3) 공휴일 시간표: 셀/메모 영역은 흰색, 이름카드는 기존 회색 유지
path = Path('pc-timetable.css')
text = path.read_text(encoding='utf-8')
text = replace_once(
    text,
    "#recordRoomScreen .olliTtCell.holiday, #recordRoomScreen .olliTtCell.holiday:hover { background:#eceff1; box-shadow:none; cursor:not-allowed; }",
    "#recordRoomScreen .olliTtCell.holiday, #recordRoomScreen .olliTtCell.holiday:hover { background:#fff; box-shadow:none; cursor:not-allowed; }",
    'holiday cell background'
)
text = replace_once(
    text,
    "#recordRoomScreen .olliTtCell.holiday .olliTtCellMemoCard { color:#858b93; border-color:#d4d8dd; background:#dfe2e5; box-shadow:none; }",
    "#recordRoomScreen .olliTtCell.holiday .olliTtCellMemoCard { color:#858b93; border-color:#fff; background:#fff; box-shadow:none; }",
    'holiday memo background'
)
path.write_text(text.rstrip() + '\n', encoding='utf-8')
