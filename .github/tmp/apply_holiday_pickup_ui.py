from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'anchor not found: {path}: {old[:100]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

js = 'pc-timetable.js'

replace_once(js,
"  function pickups() { return Array.isArray(state.data && state.data.pickups) ? state.data.pickups : []; }\n  function classSplits()",
"  function pickups() { return Array.isArray(state.data && state.data.pickups) ? state.data.pickups : []; }\n  function calendarDays() { return Array.isArray(state.data && state.data.calendar_days) ? state.data.calendar_days : []; }\n  function calendarInfo(value) {\n    const key = value instanceof Date ? dateKey(value) : clean(value).slice(0, 10);\n    return calendarDays().find((item) => clean(item && item.session_date).slice(0, 10) === key) || null;\n  }\n  function isHolidayDate(value) { const info = calendarInfo(value); return !!(info && info.is_holiday === true); }\n  function holidayName(value) { return clean(calendarInfo(value)?.name); }\n  function classSplits()")

replace_once(js,
"  function pickupTimeLabel(value) {\n    const match = clean(value).match(/^(\\d{1,2}):(\\d{2})/);\n    if (!match) return clean(value);\n    const hour = Number(match[1]);\n    return `${hour > 12 ? hour - 12 : hour}:${match[2]}`;\n  }",
"  function pickupTimeLabel(value) {\n    const match = clean(value).match(/^(\\d{1,2}):(\\d{2})/);\n    if (!match) return clean(value);\n    const hour = Number(match[1]);\n    return `${hour > 12 ? hour - 12 : hour}:${match[2]}`;\n  }\n  function pickupTimeInputValue(value) {\n    const match = clean(value).match(/^(\\d{1,2}):(\\d{2})/);\n    if (!match) return '';\n    return `${pad(Number(match[1]))}:${match[2]}`;\n  }")

replace_once(js,
'''  function cellHtml(division, date, displayTime) {
    if (division === 'elementary' && date.getDay() === 6 && Number(displayTime) > 3) {
      return '<div class="olliTtCell saturdayUnavailable" aria-hidden="true"></div>';
    }
    const time = storedTimeForCell(division, date, displayTime);
    const attrs = `data-tt-cell="1" data-division="${division}" data-date="${dateKey(date)}" data-weekday="${date.getDay()}" data-time="${time}"`;
    const memo = cellMemoText(division, date, time);
    if (!isClassSplit(division, date.getDay(), time)) {
      const mergedClassHead = division === 'kinder'
        ? '<div class="olliTtClassLaneHead olliTtMergedClassHead"><strong>A반</strong></div>'
        : '';
      return `<div class="olliTtCell${division === 'kinder' ? ' kinder merged' : ''}" ${attrs}>${mergedClassHead}${cellContentsHtml(division, date, time, '', memo)}</div>`;
    }
    const heads = division === 'kinder';
    const counts = {
      A: slotEntryCount(division, date, time, 'A'),
      B: slotEntryCount(division, date, time, 'B')
    };
    const memoGroup = counts.A <= counts.B ? 'A' : 'B';
    return `<div class="olliTtCell ${division} split" ${attrs}><div class="olliTtClassLanes ${division}">${['A', 'B'].map((group) => `<div class="olliTtClassLane ${division}" ${attrs} data-class-group="${group}">${heads ? `<div class="olliTtClassLaneHead"><strong>${group}반</strong></div>` : ''}${cellContentsHtml(division, date, time, group, memo && group === memoGroup ? memo : '')}</div>`).join('')}</div></div>`;
  }''',
'''  function cellHtml(division, date, displayTime) {
    if (division === 'elementary' && date.getDay() === 6 && Number(displayTime) > 3) {
      return '<div class="olliTtCell saturdayUnavailable" aria-hidden="true"></div>';
    }
    const time = storedTimeForCell(division, date, displayTime);
    const holiday = isHolidayDate(date);
    const attrs = `data-tt-cell="1" data-division="${division}" data-date="${dateKey(date)}" data-weekday="${date.getDay()}" data-time="${time}"${holiday ? ' data-holiday="1" aria-disabled="true"' : ''}`;
    const memo = cellMemoText(division, date, time);
    if (!isClassSplit(division, date.getDay(), time)) {
      const mergedClassHead = division === 'kinder'
        ? '<div class="olliTtClassLaneHead olliTtMergedClassHead"><strong>A반</strong></div>'
        : '';
      return `<div class="olliTtCell${division === 'kinder' ? ' kinder merged' : ''}${holiday ? ' holiday' : ''}" ${attrs}>${mergedClassHead}${cellContentsHtml(division, date, time, '', memo)}</div>`;
    }
    const heads = division === 'kinder';
    const counts = {
      A: slotEntryCount(division, date, time, 'A'),
      B: slotEntryCount(division, date, time, 'B')
    };
    const memoGroup = counts.A <= counts.B ? 'A' : 'B';
    return `<div class="olliTtCell ${division} split${holiday ? ' holiday' : ''}" ${attrs}><div class="olliTtClassLanes ${division}">${['A', 'B'].map((group) => `<div class="olliTtClassLane ${division}" ${attrs} data-class-group="${group}">${heads ? `<div class="olliTtClassLaneHead"><strong>${group}반</strong></div>` : ''}${cellContentsHtml(division, date, time, group, memo && group === memoGroup ? memo : '')}</div>`).join('')}</div></div>`;
  }''')

replace_once(js,
'''  function pickupCellHtml(date, classTime) {
    const rows = slotPickups(date, classTime);
    const cards = rows.map((item) => `<div class="olliTtPickupCard" data-tt-pickup-manage="${esc(item.id)}"><strong>${esc(item.student_name)}</strong><span>${esc(item.pickup_label)} ${esc(pickupTimeLabel(item.pickup_time))}</span></div>`).join('');
    return `<div class="olliTtPickupCell" data-tt-pickup-cell="1" data-date="${dateKey(date)}" data-weekday="${date.getDay()}" data-class-time="${classTime}"><div class="olliTtPickupEntries">${cards}</div></div>`;
  }''',
'''  function pickupCellHtml(date, classTime) {
    const rows = slotPickups(date, classTime);
    const holiday = isHolidayDate(date);
    const cards = rows.map((item) => `<div class="olliTtPickupCard" data-tt-pickup-manage="${esc(item.id)}"><strong>${esc(item.student_name)}</strong><span>${esc(item.pickup_label)} ${esc(pickupTimeLabel(item.pickup_time))}</span></div>`).join('');
    return `<div class="olliTtPickupCell${holiday ? ' holiday' : ''}" data-tt-pickup-cell="1" data-date="${dateKey(date)}" data-weekday="${date.getDay()}" data-class-time="${classTime}"${holiday ? ' data-holiday="1" aria-disabled="true"' : ''}><div class="olliTtPickupEntries">${cards}</div></div>`;
  }''')

replace_once(js,
'''    dates.forEach((date, index) => {
      grid += `<div class="olliTtDay ${isToday(date) ? 'today' : ''}"><strong>${DAYS[index]}요일</strong><span>${date.getMonth() + 1}월 ${date.getDate()}일${isToday(date) ? ' · 오늘' : ''}</span></div>`;
    });''',
'''    dates.forEach((date, index) => {
      const info = calendarInfo(date);
      const holiday = !!(info && info.is_holiday === true);
      const defaultHoliday = !!(info && info.default_holiday === true);
      const toggle = defaultHoliday
        ? `<button type="button" class="olliTtNormalClassBtn${holiday ? '' : ' active'}" data-tt-normal-class-date="${dateKey(date)}" data-tt-make-normal="${holiday ? '1' : '0'}">${holiday ? '정상수업' : '공휴일'}</button>`
        : '';
      grid += `<div class="olliTtDay ${isToday(date) ? 'today ' : ''}${holiday ? 'holiday' : ''}"${holidayName(date) ? ` title="${esc(holidayName(date))}"` : ''}><strong>${DAYS[index]}요일</strong><span>${date.getMonth() + 1}월 ${date.getDate()}일${isToday(date) ? ' · 오늘' : ''}</span>${toggle}</div>`;
    });''')

replace_once(js,
"  function handleScheduleControl(event) {\n    const attendanceDivision = event.target.closest('[data-tt-attendance-division]');",
"  function handleScheduleControl(event) {\n    const normalClassButton = event.target.closest('[data-tt-normal-class-date]');\n    if (normalClassButton) {\n      const sessionDate = normalClassButton.dataset.ttNormalClassDate;\n      const makeNormal = normalClassButton.dataset.ttMakeNormal === '1';\n      normalClassButton.disabled = true;\n      service.setNormalClassDay(sessionDate, makeNormal).then(async () => {\n        state.data = null;\n        state.dataWeek = '';\n        state.attendanceCalendarMonth = '';\n        state.attendanceCalendarDays = [];\n        await loadWeek();\n        notify(makeNormal ? '공휴일을 정상수업일로 변경했어요.' : '다시 공휴일로 설정했어요.');\n      }).catch((error) => {\n        normalClassButton.disabled = false;\n        notify(error && (error.message || error) || '수업일 설정을 변경하지 못했습니다.');\n      });\n      return true;\n    }\n    const attendanceDivision = event.target.closest('[data-tt-attendance-division]');")

replace_once(js,
"  function onTimetableClick(event) {\n    if (handleScheduleControl(event)) return;\n    const attendanceButton = event.target.closest('[data-tt-attendance]');",
"  function onTimetableClick(event) {\n    if (handleScheduleControl(event)) return;\n    const holidayTarget = event.target.closest('[data-holiday=\"1\"]');\n    if (holidayTarget) {\n      event.preventDefault();\n      event.stopPropagation();\n      notify(`${holidayName(holidayTarget.dataset.date) || '공휴일'}에는 시간표 작업을 할 수 없습니다. 정상수업으로 변경한 뒤 이용해 주세요.`);\n      return;\n    }\n    const attendanceButton = event.target.closest('[data-tt-attendance]');")

replace_once(js,
'''  function openPickupManage(pickupId) {
    const item = pickups().find((row) => clean(row.id) === clean(pickupId));
    if (!item) return;
    state.dialog = { kind: 'pickupManage', pickupId: clean(pickupId), effectiveDate: todayKey() };
    openOverlay();
  }''',
'''  function openPickupManage(pickupId) {
    const item = pickups().find((row) => clean(row.id) === clean(pickupId));
    if (!item) return;
    const tomorrow = addDays(new Date(), 1);
    state.dialog = { kind: 'pickupManage', pickupId: clean(pickupId), pickupTime: pickupTimeInputValue(item.pickup_time), effectiveDate: dateKey(tomorrow) };
    openOverlay();
  }''')

replace_once(js,
'''  function pickupManageDialogHtml(dialog) {
    const item = pickups().find((row) => clean(row.id) === clean(dialog.pickupId));
    if (!item) return '';
    return dialogHead('↳', `${item.student_name} 픽업`, `${weekdayLabel(item.weekday)}요일 · ${item.class_time}시 수업`)
      + '<div class="olliTtDialogBody">'
      + `<div class="olliTtCurrentBox"><strong>${esc(item.pickup_label)} ${esc(pickupTimeLabel(item.pickup_time))}</strong>매주 반복되는 픽업 일정입니다.</div>`
      + `<div class="olliTtField"><div class="olliTtFieldHead"><span>삭제 적용 날짜</span><small>선택한 날짜부터 픽업 명단에서 제외됩니다.</small></div><input type="date" class="olliTtDateInput" data-tt-pickup-effective-date min="${todayKey()}" value="${esc(dialog.effectiveDate)}"></div>`
      + '<div class="olliTtDialogActions"><button type="button" class="olliTtDialogCancel" data-tt-dialog-close>닫기</button><button type="button" class="olliTtDialogPrimary danger" data-tt-remove-pickup>픽업 삭제</button></div></div>';
  }''',
'''  function pickupManageDialogHtml(dialog) {
    const item = pickups().find((row) => clean(row.id) === clean(dialog.pickupId));
    if (!item) return '';
    return dialogHead('↳', `${item.student_name} 픽업`, `${weekdayLabel(item.weekday)}요일 · ${item.class_time}시 수업`)
      + '<div class="olliTtDialogBody">'
      + `<div class="olliTtCurrentBox"><strong>${esc(item.pickup_label)} ${esc(pickupTimeLabel(item.pickup_time))}</strong>현재 적용 중인 픽업 일정입니다.</div>`
      + '<div class="olliTtField"><div class="olliTtFieldHead"><span>픽업시간 수정</span><small>잘못 입력한 현재 시간을 바로 고칩니다.</small></div>'
      + `<input type="time" class="olliTtDateInput" data-tt-pickup-edit-time value="${esc(dialog.pickupTime)}"></div>`
      + `<div class="olliTtField"><div class="olliTtFieldHead"><span>변경 예약 적용일</span><small>선택한 날짜부터 위 시간이 적용됩니다.</small></div><input type="date" class="olliTtDateInput" data-tt-pickup-effective-date min="${dateKey(addDays(new Date(), 1))}" value="${esc(dialog.effectiveDate)}"></div>`
      + '<div class="olliTtPickupManageActions"><button type="button" class="olliTtDialogPrimary secondary" data-tt-update-pickup>현재 시간 수정</button><button type="button" class="olliTtDialogPrimary" data-tt-schedule-pickup>변경 예약</button></div>'
      + '<div class="olliTtDialogActions olliTtPickupDeleteActions"><button type="button" class="olliTtDialogCancel" data-tt-dialog-close>닫기</button><button type="button" class="olliTtDialogPrimary danger" data-tt-remove-pickup>픽업 삭제</button></div></div>';
  }''')

replace_once(js,
"    const pickupEffectiveDate = dialog.querySelector('[data-tt-pickup-effective-date]');\n    if (pickupEffectiveDate) pickupEffectiveDate.addEventListener('change', () => { if (state.dialog && state.dialog.kind === 'pickupManage') state.dialog.effectiveDate = pickupEffectiveDate.value || todayKey(); });",
"    const pickupEditTime = dialog.querySelector('[data-tt-pickup-edit-time]');\n    if (pickupEditTime) pickupEditTime.addEventListener('change', () => { if (state.dialog && state.dialog.kind === 'pickupManage') state.dialog.pickupTime = pickupEditTime.value; });\n    const pickupEffectiveDate = dialog.querySelector('[data-tt-pickup-effective-date]');\n    if (pickupEffectiveDate) pickupEffectiveDate.addEventListener('change', () => { if (state.dialog && state.dialog.kind === 'pickupManage') state.dialog.effectiveDate = pickupEffectiveDate.value || dateKey(addDays(new Date(), 1)); });")

replace_once(js,
"    const removePickupButton = dialog.querySelector('[data-tt-remove-pickup]');\n    if (removePickupButton) removePickupButton.addEventListener('click', removePickup);",
"    const updatePickupButton = dialog.querySelector('[data-tt-update-pickup]');\n    if (updatePickupButton) updatePickupButton.addEventListener('click', updatePickupNow);\n    const schedulePickupButton = dialog.querySelector('[data-tt-schedule-pickup]');\n    if (schedulePickupButton) schedulePickupButton.addEventListener('click', schedulePickupChange);\n    const removePickupButton = dialog.querySelector('[data-tt-remove-pickup]');\n    if (removePickupButton) removePickupButton.addEventListener('click', removePickup);")

replace_once(js,
"  async function removePickup() {\n    const dialog = state.dialog;",
"  async function updatePickupNow() {\n    const dialog = state.dialog;\n    if (!dialog || dialog.kind !== 'pickupManage') return;\n    const item = pickups().find((row) => clean(row.id) === clean(dialog.pickupId));\n    if (!item) return;\n    if (!clean(dialog.pickupTime)) { alert('수정할 픽업 시간을 입력해 주세요.'); return; }\n    const result = await withSaving(() => service.updatePickup(dialog.pickupId, dialog.pickupTime, todayKey(), 'edit'));\n    if (result) notify(`${item.student_name} 학생의 픽업 시간을 수정했어요.`);\n  }\n\n  async function schedulePickupChange() {\n    const dialog = state.dialog;\n    if (!dialog || dialog.kind !== 'pickupManage') return;\n    const item = pickups().find((row) => clean(row.id) === clean(dialog.pickupId));\n    if (!item) return;\n    if (!clean(dialog.pickupTime)) { alert('변경할 픽업 시간을 입력해 주세요.'); return; }\n    if (!clean(dialog.effectiveDate) || dialog.effectiveDate <= todayKey()) { alert('변경 예약은 내일부터 설정할 수 있습니다.'); return; }\n    const result = await withSaving(() => service.updatePickup(dialog.pickupId, dialog.pickupTime, dialog.effectiveDate, 'schedule'));\n    if (result) notify(`${item.student_name} 학생의 픽업 시간 변경을 ${koreanDate(dialog.effectiveDate, true)}부터 예약했어요.`);\n  }\n\n  async function removePickup() {\n    const dialog = state.dialog;")

css = 'pc-timetable.css'
replace_once(css,
"  border: 1px solid transparent;\n  border-radius: 8px;\n  display: flex;\n  align-items: center;\n  gap: 5px;\n  color: #544918;\n  background: #fff3a6;",
"  border: 1px solid #fff3a6;\n  border-radius: 8px;\n  display: flex;\n  align-items: center;\n  gap: 5px;\n  color: #544918;\n  background: #fff3a6;")
replace_once(css,
"#recordRoomScreen .olliTtCellMemoCard:hover { border-color: transparent; background: #ffed85; box-shadow: none; }",
"#recordRoomScreen .olliTtCellMemoCard:hover { border-color: #ffed85; background: #ffed85; box-shadow: none; }")

marker = "#recordRoomScreen .olliTtDay.today { background: #edf6ff; }\n#recordRoomScreen .olliTtDay.today strong,\n#recordRoomScreen .olliTtDay.today span { color: #0A73DC; }"
replace_once(css, marker, marker + "\n#recordRoomScreen .olliTtDay { position: relative; }\n#recordRoomScreen .olliTtDay.holiday { background: #e5484d; }\n#recordRoomScreen .olliTtDay.holiday strong, #recordRoomScreen .olliTtDay.holiday span { color: #fff; }\n#recordRoomScreen .olliTtNormalClassBtn { position:absolute; right:4px; top:50%; transform:translateY(-50%); height:24px; padding:0 7px; border:1px solid rgba(255,255,255,.7); border-radius:8px; color:#fff; background:rgba(120,0,0,.18); font:700 calc(8px * var(--olli-text-scale)) 'Pretendard',sans-serif; cursor:pointer; }\n#recordRoomScreen .olliTtNormalClassBtn.active { color:#c53d45; border-color:#efc4c7; background:#fff; }\n#recordRoomScreen .olliTtNormalClassBtn:disabled { opacity:.5; cursor:default; }")

marker = "#recordRoomScreen .olliTtCell:hover { background: #f5faff; box-shadow: inset 0 0 0 2px #c4e2ff; }"
replace_once(css, marker, marker + "\n#recordRoomScreen .olliTtCell.holiday, #recordRoomScreen .olliTtCell.holiday:hover { background:#eceff1; box-shadow:none; cursor:not-allowed; }\n#recordRoomScreen .olliTtCell.holiday .olliTtClassLane, #recordRoomScreen .olliTtCell.holiday .olliTtClassLane:hover { background:transparent; cursor:not-allowed; }\n#recordRoomScreen .olliTtCell.holiday .olliTtStudent, #recordRoomScreen .olliTtCell.holiday .olliTtStudent.regular.elementary, #recordRoomScreen .olliTtCell.holiday .olliTtStudent.regular.kinder, #recordRoomScreen .olliTtCell.holiday .olliTtStudent.makeup, #recordRoomScreen .olliTtCell.holiday .olliTtStudent.wait, #recordRoomScreen .olliTtCell.holiday .olliTtStudent.attended { color:#858b93; border-color:#d4d8dd; background:#dfe2e5; box-shadow:none; transform:none; }\n#recordRoomScreen .olliTtCell.holiday .olliTtAttendanceBtn, #recordRoomScreen .olliTtCell.holiday .olliTtStudentMore, #recordRoomScreen .olliTtCell.holiday .olliTtStudentTag { color:#858b93; pointer-events:none; }\n#recordRoomScreen .olliTtCell.holiday .olliTtCellMemoCard { color:#858b93; border-color:#d4d8dd; background:#dfe2e5; box-shadow:none; }")

marker = "#recordRoomScreen .olliTtPickupCell:hover { background: #f5faff; box-shadow: inset 0 0 0 2px #c4e2ff; }"
replace_once(css, marker, marker + "\n#recordRoomScreen .olliTtPickupCell.holiday, #recordRoomScreen .olliTtPickupCell.holiday:hover { background:#eceff1; box-shadow:none; cursor:not-allowed; }\n#recordRoomScreen .olliTtPickupCell.holiday .olliTtPickupCard { color:#858b93; border-color:#d4d8dd; background:#dfe2e5; pointer-events:none; }\n#recordRoomScreen .olliTtPickupCell.holiday .olliTtPickupCard span { color:#8f959d; }")

marker = "#recordRoomScreen .olliTtAttendanceRegisterScroll td.attendanceAbsentMark{color:#fff;background:#e5484d!important;font-weight:900;-webkit-print-color-adjust:exact;print-color-adjust:exact}"
replace_once(css, marker, marker + "\n#recordRoomScreen .olliTtAttendanceRegisterScroll th.attendanceHolidayHead{color:#fff!important;background:#e5484d!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}\n#recordRoomScreen .olliTtAttendanceRegisterScroll td.attendanceHolidayCell{background:#eceff1!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}")

marker = ".olliTtPickupForm input:focus { border-color: #80c2fb; box-shadow: 0 0 0 3px rgba(10,132,255,.09); }"
replace_once(css, marker, marker + "\n.olliTtPickupManageActions { display:grid; grid-template-columns:1fr 1fr; gap:9px; margin-top:18px; }\n.olliTtPickupManageActions button { height:48px; border:0; border-radius:14px; font:780 calc(12px * var(--olli-text-scale)) 'Pretendard',sans-serif; cursor:pointer; }\n.olliTtPickupDeleteActions { margin-top:14px; }")

print('patched original timetable files')
