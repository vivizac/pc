from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old in text:
        p.write_text(text.replace(old, new, 1), encoding='utf-8')
        print(f'[ok] {label}')
        return
    if new in text:
        print(f'[skip] {label}: already applied')
        return
    raise SystemExit(f'[error] {label}: target text not found in {path}')


routing = 'pc-student-class-routing.js'

replace_once(
    routing,
    """    if (division === 'elementary') {\n      (Array.isArray(data && data.class_splits) ? data.class_splits : []).forEach((row) => addSlot(row.weekday, row.time_slot));\n    } else {\n      (Array.isArray(data && data.kinder_class_merges) ? data.kinder_class_merges : []).forEach((row) => addSlot(row.weekday, row.time_slot));\n    }\n\n    const capacity = capacityFor(data, division);""",
    """    if (division === 'elementary') {\n      (Array.isArray(data && data.class_splits) ? data.class_splits : []).forEach((row) => addSlot(row.weekday, row.time_slot));\n      // 담임/기존 학생이 없어도 시간표의 기본 수업칸은 학생 등록에서 선택할 수 있습니다.\n      for (let weekday = 1; weekday <= 5; weekday += 1) {\n        for (let timeSlot = 1; timeSlot <= 6; timeSlot += 1) addSlot(weekday, timeSlot);\n      }\n      [10, 11, 12].forEach((timeSlot) => addSlot(6, timeSlot));\n    } else {\n      (Array.isArray(data && data.kinder_class_merges) ? data.kinder_class_merges : []).forEach((row) => addSlot(row.weekday, row.time_slot));\n      for (let weekday = 1; weekday <= 6; weekday += 1) {\n        [4, 5].forEach((timeSlot) => addSlot(weekday, timeSlot));\n      }\n    }\n\n    const capacity = capacityFor(data, division);""",
    'include unassigned default timetable slots'
)

replace_once(
    routing,
    """        const teacherName = teacherDisplay(teacher && teacher.teacher_name);\n        const configured = !!teacher || count > 0 || split || merged;\n        if (!configured) return;\n        options.push({""",
    """        const teacherName = teacherDisplay(teacher && teacher.teacher_name);\n        options.push({""",
    'do not require teacher/configured state for option creation'
)

replace_once(
    routing,
    """          full: count >= capacity,\n          selectable: !!teacherName && count < capacity""",
    """          full: count >= capacity,\n          selectable: count < capacity""",
    'allow unassigned teacher class selection'
)

replace_once(
    routing,
    """      host.innerHTML = header + '<div class=\"pcStudentRegistrationClassState\">선택 가능한 클래스가 없습니다.<br>시간표 설정에서 클래스 담임을 먼저 지정해 주세요.</div>';""",
    """      host.innerHTML = header + '<div class=\"pcStudentRegistrationClassState\">선택 가능한 수업이 없습니다.</div>';""",
    'remove teacher-required empty-state guide'
)

replace_once(
    routing,
    """        const stateText = !option.teacher_name ? '담임 미지정' : (option.full ? '정원 마감' : `${option.count}/${option.capacity} · ${option.remaining}자리`);""",
    """        const stateText = option.full ? '정원 마감' : `${option.count}/${option.capacity} · ${option.remaining}자리`;""",
    'show capacity independently from teacher assignment'
)

replace_once(
    routing,
    """      if (!option.teacher_name) throw new Error(`${NUM_DAY[option.weekday]}요일 ${option.time_slot}시 ${optionLabel(option)}의 담임이 지정되지 않았습니다.`);\n      if (option.full) throw new Error(`${NUM_DAY[option.weekday]}요일 ${option.time_slot}시 ${optionLabel(option)}의 정원이 마감되었습니다.`);""",
    """      if (option.full) throw new Error(`${NUM_DAY[option.weekday]}요일 ${option.time_slot}시 ${optionLabel(option)}의 정원이 마감되었습니다.`);""",
    'remove teacher requirement from final registration validation'
)

replace_once(
    routing,
    """  let teacherRenderTimer = 0;\n  let bypassStudentScheduleSaveGuard = false;""",
    """  let teacherRenderTimer = 0;""",
    'remove obsolete timetable teacher save guard state'
)

replace_once(
    routing,
    """    document.addEventListener('click', (event) => {\n      const choice = event.target.closest('[data-tt-target-day],[data-tt-target-time],[data-tt-target-class],[data-tt-action-type]');\n      if (choice) scheduleTeacherRender();\n      const save = event.target.closest('[data-tt-save-move]');\n      if (!save || bypassStudentScheduleSaveGuard) return;\n      const dialog = document.getElementById('olliTtDialog');\n      if (!dialog || !dialog.classList.contains('olliTtMoveDialog')) return;\n      event.preventDefault();\n      event.stopPropagation();\n      if (event.stopImmediatePropagation) event.stopImmediatePropagation();\n      (async () => {\n        try {\n          const target = timetableMoveTarget(dialog);\n          if (!target) throw new Error('선택한 수업 클래스를 확인해 주세요.');\n          const assignments = await loadTeacherAssignments(true);\n          const teacher = teacherForTarget(assignments, target);\n          if (!teacher) throw new Error(`${NUM_DAY[target.weekday]}요일 ${target.time_slot}시 ${target.class_group}반은 담임이 지정되지 않았습니다.\\n시간표 설정에서 담임을 먼저 지정해 주세요.`);\n          bypassStudentScheduleSaveGuard = true;\n          save.click();\n          setTimeout(() => { bypassStudentScheduleSaveGuard = false; }, 0);\n        } catch (error) {\n          alert(error.message || error);\n        }\n      })();\n    }, true);""",
    """    document.addEventListener('click', (event) => {\n      const choice = event.target.closest('[data-tt-target-day],[data-tt-target-time],[data-tt-target-class],[data-tt-action-type]');\n      if (choice) scheduleTeacherRender();\n    }, true);""",
    'allow timetable add and move when teacher is unassigned'
)

replace_once(
    'pc-timetable.css',
    ".olliTtChoice.full:not(.active) { color: #7c65c6; background: #f1edff; }",
    ".olliTtChoice.full:not(.active) { color: #d64a4a; background: #fff0f0; border-color: #f1c7c7; }",
    'change full timetable option from purple to red'
)

replace_once(
    'pc-attendance.css',
    """body.olliPcApp #recordRoomScreen .pcAttendanceSortDivider{\n  display:flex;align-items:center;gap:10px;width:100%;margin:15px 0 10px;color:#8a9099;font-size:11px;font-weight:820;line-height:1;letter-spacing:-.02em;box-sizing:border-box;\n}\nbody.olliPcApp #recordRoomScreen .pcAttendanceSortDivider::before,\nbody.olliPcApp #recordRoomScreen .pcAttendanceSortDivider::after{\n  content:\"\";height:1px;flex:1;min-width:12px;background:#e2e5e9;\n}""",
    """body.olliPcApp #recordRoomScreen .pcAttendanceSortDivider{\n  display:flex;align-items:center;gap:10px;width:100%;margin:15px 0 10px;color:#555b63;font-size:11px;font-weight:820;line-height:1;letter-spacing:-.02em;box-sizing:border-box;\n}\nbody.olliPcApp #recordRoomScreen .pcAttendanceSortDivider::before,\nbody.olliPcApp #recordRoomScreen .pcAttendanceSortDivider::after{\n  content:\"\";height:1px;flex:1;min-width:12px;background:#666b72;\n}""",
    'darken attendance group divider text and lines'
)

print('All requested UI/routing patches completed.')
