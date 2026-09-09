from pathlib import Path

path = Path('pc-timetable.js')
text = path.read_text(encoding='utf-8')

old_picker = """  function pickupPickerHtml(dialog) {\n    const students = service.activeStudents().filter((student) => divisionOf(student) === 'kinder' && (!dialog.query || clean(student.name).includes(dialog.query)));\n    return students.length ? students.map((student) => `<button type=\\\"button\\\" class=\\\"olliTtPickerStudent ${clean(student.id) === dialog.studentId ? 'active' : ''}\\\" data-tt-pickup-student=\\\"${esc(student.id)}\\\"><strong>${esc(student.name)}</strong><span>${esc(studentScheduleText(student.id)) || '수업 없음'}</span></button>`).join('') : '<div class=\\\"olliTtQuickEmpty\\\">학생을 찾지 못했습니다.</div>';\n  }\n"""

new_picker = """  function pickupPickerHtml(dialog) {\n    const query = clean(dialog.query);\n    const students = service.activeStudents().filter((student) => divisionOf(student) === 'kinder' && (!query || clean(student.name).includes(query)));\n    if (!clean(dialog.studentId) && query) {\n      const exactMatches = students.filter((student) => clean(student.name) === query);\n      if (exactMatches.length === 1) dialog.studentId = clean(exactMatches[0].id);\n    }\n    return students.length ? students.map((student) => `<button type=\\\"button\\\" class=\\\"olliTtPickerStudent ${clean(student.id) === clean(dialog.studentId) ? 'active' : ''}\\\" data-tt-pickup-student=\\\"${esc(student.id)}\\\"><strong>${esc(student.name)}</strong><span>${esc(studentScheduleText(student.id)) || '수업 없음'}</span></button>`).join('') : '<div class=\\\"olliTtQuickEmpty\\\">학생을 찾지 못했습니다.</div>';\n  }\n"""

if old_picker in text:
    text = text.replace(old_picker, new_picker, 1)
elif new_picker not in text:
    raise SystemExit('pickupPickerHtml target not found')

old_save = """    dialog.pickupLabel = clean(root && root.querySelector('[data-tt-pickup-label]')?.value || dialog.pickupLabel);\n    dialog.pickupTime = clean(root && root.querySelector('[data-tt-pickup-time]')?.value || dialog.pickupTime);\n    if (!dialog.studentId) { alert('픽업할 학생을 선택해 주세요.'); return; }\n"""

new_save = """    dialog.pickupLabel = clean(root && root.querySelector('[data-tt-pickup-label]')?.value || dialog.pickupLabel);\n    dialog.pickupTime = clean(root && root.querySelector('[data-tt-pickup-time]')?.value || dialog.pickupTime);\n    if (!clean(dialog.studentId)) {\n      const activeButton = root && root.querySelector('[data-tt-pickup-student].active');\n      if (activeButton) dialog.studentId = clean(activeButton.dataset.ttPickupStudent);\n    }\n    if (!clean(dialog.studentId)) {\n      const visibleButtons = root ? Array.from(root.querySelectorAll('[data-tt-pickup-student]')) : [];\n      if (visibleButtons.length === 1) dialog.studentId = clean(visibleButtons[0].dataset.ttPickupStudent);\n    }\n    if (!clean(dialog.studentId)) {\n      const query = clean(root && root.querySelector('[data-tt-pickup-search]')?.value || dialog.query);\n      const exactMatches = service.activeStudents().filter((student) => divisionOf(student) === 'kinder' && clean(student.name) === query);\n      if (exactMatches.length === 1) dialog.studentId = clean(exactMatches[0].id);\n    }\n    if (!clean(dialog.studentId)) { alert('픽업할 학생을 선택해 주세요.'); return; }\n"""

if old_save in text:
    text = text.replace(old_save, new_save, 1)
elif new_save not in text:
    raise SystemExit('savePickup target not found')

path.write_text(text, encoding='utf-8')
print('Pickup student selection patch applied.')
