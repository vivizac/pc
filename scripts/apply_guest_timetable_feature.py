from pathlib import Path
import re


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 exact match, got {count}')
    return text.replace(old, new, 1)


def replace_regex_once(text, pattern, replacement, label):
    next_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 regex match, got {count}')
    return next_text


# 1) Service: direct RPC method on the original timetable service.
path = Path('pc-timetable-service.js')
text = path.read_text()
old = """  async function addWaitlist(options) {
    return executeScheduleAction('add_waitlist', {
      student_id: options.studentId,
      target_weekday: Number(options.targetWeekday),
      target_time_slot: Number(options.targetTimeSlot),
      target_class_group: options.targetClassGroup || 'A',
      effective_date: options.effectiveDate
    });
  }
"""
new = old + """
  async function addGuestEntry(options) {
    return rpc('olli_schedule_add_guest_entry', contextPayload({
      p_guest_name: clean(options.guestName),
      p_division: clean(options.division),
      p_entry_type: clean(options.entryType),
      p_session_date: clean(options.sessionDate),
      p_time_slot: Number(options.timeSlot),
      p_class_group: options.classGroup || 'A'
    }));
  }
"""
text = replace_once(text, old, new, 'service addGuestEntry')
text = replace_once(text, "    addWaitlist,\n    cancelMakeup,", "    addWaitlist,\n    addGuestEntry,\n    cancelMakeup,", 'service export')
path.write_text(text)


# 2) UI: keep guest name in the original add-dialog state.
path = Path('pc-timetable.js')
text = path.read_text()
text = replace_once(
    text,
    "      query: '', note: existingMemo, originalNote: existingMemo, originalMemoGroup: existingMemoGroup, addType: 'wait', targetClassGroup,",
    "      query: '', guestName: '', note: existingMemo, originalNote: existingMemo, originalMemoGroup: existingMemoGroup, addType: 'wait', targetClassGroup,",
    'openAdd guestName state'
)

# Shared helpers live beside the original add picker; no runtime override.
marker = "  function addPickerHtml(dialog) {\n"
helpers = """  function isGuestAddType(addType) {
    return addType === 'guest_wait' || addType === 'trial';
  }

  function hasAddRegistrationTarget(dialog) {
    if (!dialog) return false;
    return isGuestAddType(dialog.addType) ? Boolean(clean(dialog.guestName)) : Boolean(dialog.studentId);
  }

"""
text = replace_once(text, marker, helpers + marker, 'add dialog helpers')

new_add_dialog = r'''  function addDialogHtml(dialog) {
    const division = dialog.division;
    const selected = studentById(dialog.studentId);
    const guestMode = isGuestAddType(dialog.addType);
    const guestName = clean(dialog.guestName);
    const hasRegistrationTarget = guestMode ? Boolean(guestName) : Boolean(selected);
    const note = clean(dialog.note);
    const hadMemo = Boolean(clean(dialog.originalNote));
    const teacherChanged = clean(dialog.teacherMemberId) !== clean(dialog.originalTeacherMemberId);
    const canRegister = Boolean(hasRegistrationTarget || note || hadMemo || dialog.pendingKinderMerge || dialog.pendingKinderSplit || teacherChanged);
    const primaryLabel = (dialog.pendingKinderMerge || dialog.pendingKinderSplit)
      ? '등록'
      : (hasRegistrationTarget ? '등록' : (note ? '메모 저장' : (hadMemo ? '메모 삭제' : (teacherChanged ? '담임 저장' : '등록'))));
    const studentField = guestMode
      ? '<div class="olliTtField"><div class="olliTtFieldHead"><span>학생 이름</span><small>학생명단에 등록되지 않은 학생 이름을 직접 입력하세요.</small></div>'
        + `<input type="text" class="olliTtStudentSearch" data-tt-add-guest-name maxlength="60" value="${esc(dialog.guestName)}" placeholder="학생 이름 입력"></div>`
      : '<div class="olliTtField"><div class="olliTtFieldHead"><span>학생 선택</span></div>'
        + `<input type="search" class="olliTtStudentSearch" data-tt-add-search value="${esc(dialog.query)}" placeholder="학생 검색"><div class="olliTtPickerList" data-tt-add-picker>`
        + addPickerHtml(dialog)
        + '</div></div>';
    return dialogHead('+', '이 시간에 학생 추가', '')
      + '<div class="olliTtDialogBody">'
      + `<label class="olliTtAddMemo"><span>메모</span><textarea data-tt-add-note maxlength="500" placeholder="메모를 입력하세요">${esc(dialog.note)}</textarea></label>`
      + '<div class="olliTtField"><div class="olliTtFieldHead"><span>추가 유형</span></div><div class="olliTtTypeGrid">'
      + `<button type="button" class="olliTtTypeBtn ${dialog.addType === 'wait' ? 'active' : ''}" data-tt-add-type="wait">대기 등록</button>`
      + `<button type="button" class="olliTtTypeBtn ${dialog.addType === 'makeup' ? 'active' : ''}" data-tt-add-type="makeup">보강 등록</button>`
      + `<button type="button" class="olliTtTypeBtn ${dialog.addType === 'guest_wait' ? 'active' : ''}" data-tt-add-type="guest_wait">대기등록(비재원)</button>`
      + `<button type="button" class="olliTtTypeBtn ${dialog.addType === 'trial' ? 'active' : ''}" data-tt-add-type="trial">체험수업</button></div></div>`
      + studentField
      + (division === 'elementary' ? `<div class="olliTtField olliTtSplitClassField"><div class="olliTtFieldHead"><span>클래스 운영</span><small>${isClassSplit(division, dialog.weekday, dialog.time) ? '분리된 A반·B반을 하나의 칸으로 통합합니다.' : '현재 칸을 위·아래 A반·B반으로 나눕니다.'}</small></div><button type="button" class="olliTtSplitClassBtn" ${isClassSplit(division, dialog.weekday, dialog.time) ? 'data-tt-merge-class' : 'data-tt-split-class'}>${isClassSplit(division, dialog.weekday, dialog.time) ? '클래스 통합' : '클래스 분리'}</button></div>` : '')
      + classGroupChoiceHtml(division, dialog.targetClassGroup, dialog.weekday, dialog.time, false, true)
      + teacherChoiceHtml(dialog)
      + `<div class="olliTtDialogActions"><button type="button" class="olliTtDialogCancel" data-tt-dialog-close>취소</button><button type="button" class="olliTtDialogPrimary" data-tt-save-add ${canRegister ? '' : 'disabled'}>${primaryLabel}</button></div></div>`;
  }
'''
text = replace_regex_once(
    text,
    r"  function addDialogHtml\(dialog\) \{.*?\n  \}\n\n  function memoManageDialogHtml",
    new_add_dialog + "\n  function memoManageDialogHtml",
    'addDialogHtml'
)

new_wait_dialog = r'''  function waitDialogHtml(dialog) {
    const item = waitlist().find((row) => clean(row.id) === clean(dialog.waitlistId));
    if (!item) return '';
    const guest = item.is_guest === true;
    const displayName = `${item.student_name}${guest ? ' (비)' : ''}`;
    const capacity = capacityFor(clean(item.division));
    const occupied = countAt(clean(item.division), item.target_weekday, item.target_time_slot, dialog.effectiveDate, item.target_class_group);
    const canEnter = !guest && (!capacity || occupied < capacity);
    if (guest) {
      return dialogHead('⌛', `${displayName} 대기 관리`, `${weekdayLabel(item.target_weekday)}요일 · ${timeLabel(item.target_time_slot)}${classGroupLabel(clean(item.division), item.target_class_group) ? ` · ${classGroupLabel(clean(item.division), item.target_class_group)}` : ''}`)
        + '<div class="olliTtDialogBody">'
        + '<div class="olliTtCurrentBox"><strong>비재원 학생 대기입니다.</strong>현재 학생명단에는 등록하지 않고 대기 이름만 시간표에 보관합니다.</div>'
        + '<div class="olliTtDialogActions"><button type="button" class="olliTtDialogCancel" data-tt-dialog-close>닫기</button><button type="button" class="olliTtDialogPrimary danger" data-tt-cancel-wait>대기 취소</button></div></div>';
    }
    return dialogHead('⌛', `${item.student_name} 대기 관리`, `${weekdayLabel(item.target_weekday)}요일 · ${timeLabel(item.target_time_slot)}${classGroupLabel(clean(item.division), item.target_class_group) ? ` · ${classGroupGroupLabel(clean(item.division), item.target_class_group)}` : ''}`)
      + '<div class="olliTtDialogBody">'
      + `<div class="olliTtCurrentBox"><strong>${canEnter ? '입장 가능한 자리가 있습니다.' : '아직 정원이 가득 찼습니다.'}</strong>${item.request_type === 'move' ? '기존 수업을 옮기기 위한 대기' : '주간 수업을 추가하기 위한 대기'} · 현재 ${occupied}/${capacity || '∞'}</div>`
      + `<div class="olliTtField"><div class="olliTtFieldHead"><span>입장 적용 날짜</span><small>자리가 있는 날짜를 선택하세요</small></div><input type="date" class="olliTtDateInput" data-tt-wait-date min="${todayKey()}" value="${esc(dialog.effectiveDate)}"></div>`
      + '<div class="olliTtStatusNotice">입장시키기 직전에 정원을 다시 확인합니다. 대기를 취소해도 기존 수업은 그대로 유지됩니다.</div>'
      + `<div class="olliTtDialogActions"><button type="button" class="olliTtDialogCancel" data-tt-cancel-wait>대기 취소</button><button type="button" class="olliTtDialogPrimary" data-tt-accept-wait ${canEnter ? '' : 'disabled'}>입장시키기</button></div></div>`;
  }
'''
# Deliberately build from current function after fixing a typo in the replacement below.
new_wait_dialog = new_wait_dialog.replace('classGroupGroupLabel', 'classGroupLabel')
text = replace_regex_once(
    text,
    r"  function waitDialogHtml\(dialog\) \{.*?\n  \}\n\n  function makeupDialogHtml",
    new_wait_dialog + "\n  function makeupDialogHtml",
    'waitDialogHtml'
)

new_makeup_dialog = r'''  function makeupDialogHtml(dialog) {
    const item = oneTimeSessions().find((row) => clean(row.id) === clean(dialog.makeupId));
    if (!item) return '';
    const date = parseDate(item.session_date);
    const trial = clean(item.session_type) === 'trial';
    const displayName = `${item.student_name}${item.is_guest === true ? ' (비)' : ''}`;
    const typeLabel = trial ? '체험' : '보강';
    return dialogHead(trial ? '★' : '✓', `${displayName} ${typeLabel}`, `${koreanDate(date)} ${DAYS[date.getDay() - 1]}요일 · ${timeLabel(item.time_slot)}`)
      + `<div class="olliTtDialogBody"><div class="olliTtCurrentBox"><strong>이 날짜에만 등록된 ${trial ? '체험수업' : '보강 수업'}입니다.</strong>${trial ? '비재원 학생의 체험 일정입니다.' : '정규 수업 시간은 변경되지 않습니다.'}</div>`
      + `<div class="olliTtDialogActions"><button type="button" class="olliTtDialogCancel" data-tt-dialog-close>닫기</button><button type="button" class="olliTtDialogPrimary danger" data-tt-cancel-makeup>${typeLabel} 취소</button></div></div>`;
  }
'''
text = replace_regex_once(
    text,
    r"  function makeupDialogHtml\(dialog\) \{.*?\n  \}\n\n  function pickupPickerHtml",
    new_makeup_dialog + "\n  function pickupPickerHtml",
    'makeupDialogHtml'
)

# Render guest wait and trial cards from the existing cell rendering function.
pattern = r"    const waitHtml = waits\.map\(\(item\) => .*?\n    const memo = clean\(memoText\);"
replacement = r'''    const waitHtml = waits.map((item) => {
      const displayName = `${item.student_name}${item.is_guest === true ? ' (비)' : ''}`;
      return `<div class="olliTtStudent wait"><button type="button" class="olliTtAttendanceBtn" data-tt-entry="wait" data-waitlist-id="${esc(item.id)}">${esc(displayName)}</button><button type="button" class="olliTtStudentTag" data-tt-entry="wait" data-waitlist-id="${esc(item.id)}">대기</button></div>`;
    }).join('');
    const makeupHtml = makeups.map((item) => {
      const trial = clean(item.session_type) === 'trial';
      const displayName = `${item.student_name}${item.is_guest === true ? ' (비)' : ''}`;
      const attendanceTime = Number(item.time_slot);
      const entryClassGroup = classGroup ? classGroupOf({ class_group: classGroup }) : classGroupOf(item);
      if (trial) {
        return `<div class="olliTtStudent trial"><button type="button" class="olliTtAttendanceBtn" data-tt-entry="makeup" data-makeup-id="${esc(item.id)}">${esc(displayName)}</button><button type="button" class="olliTtStudentTag" data-tt-entry="makeup" data-makeup-id="${esc(item.id)}">체험</button></div>`;
      }
      const attended = isToday(date) && attendanceMarked(item.student_id, date, attendanceTime, entryClassGroup, 'makeup');
      return `<div class="olliTtStudent makeup${attended ? ' attended' : ''}"><button type="button" class="olliTtAttendanceBtn" data-tt-attendance="makeup" data-student-id="${esc(item.student_id)}" data-session-date="${dateKey(date)}" data-time="${attendanceTime}" data-class-group="${esc(entryClassGroup)}">${esc(displayName)}</button><button type="button" class="olliTtStudentTag" data-tt-entry="makeup" data-makeup-id="${esc(item.id)}">보강</button></div>`;
    }).join('');
    const memo = clean(memoText);'''
text = replace_regex_once(text, pattern, replacement, 'cell guest/trial cards')

# Add-dialog bindings: free-name input for guest modes; registered modes keep IME-safe search.
old_search_bind = """    bindImeSafeSearch(
      dialog.querySelector('[data-tt-add-search]'),
      (value) => { if (state.dialog && state.dialog.kind === 'add') state.dialog.query = value; },
      () => renderAddPickerResults(dialog),
      null
    );
    dialog.querySelectorAll('[data-tt-add-student]').forEach((button) => button.addEventListener('click', () => { state.dialog.studentId = button.dataset.ttAddStudent; renderDialog(); }));
    dialog.querySelectorAll('[data-tt-add-type]').forEach((button) => button.addEventListener('click', () => { state.dialog.addType = button.dataset.ttAddType; renderDialog(); }));
"""
new_search_bind = """    bindImeSafeSearch(
      dialog.querySelector('[data-tt-add-search]'),
      (value) => { if (state.dialog && state.dialog.kind === 'add') state.dialog.query = value; },
      () => renderAddPickerResults(dialog),
      null
    );
    dialog.querySelectorAll('[data-tt-add-student]').forEach((button) => button.addEventListener('click', () => { state.dialog.studentId = button.dataset.ttAddStudent; renderDialog(); }));
    dialog.querySelectorAll('[data-tt-add-type]').forEach((button) => button.addEventListener('click', () => {
      if (!state.dialog || state.dialog.kind !== 'add') return;
      const previousGuestMode = isGuestAddType(state.dialog.addType);
      const nextType = button.dataset.ttAddType;
      const nextGuestMode = isGuestAddType(nextType);
      state.dialog.addType = nextType;
      if (nextGuestMode && !previousGuestMode) {
        state.dialog.studentId = '';
        state.dialog.query = '';
      } else if (!nextGuestMode && previousGuestMode) {
        state.dialog.guestName = '';
      }
      renderDialog();
    }));
    const guestNameInput = dialog.querySelector('[data-tt-add-guest-name]');
    if (guestNameInput) guestNameInput.addEventListener('input', () => {
      if (!state.dialog || state.dialog.kind !== 'add') return;
      state.dialog.guestName = guestNameInput.value;
      const saveButton = dialog.querySelector('[data-tt-save-add]');
      if (saveButton) {
        const canSave = hasAddRegistrationTarget(state.dialog)
          || Boolean(clean(state.dialog.note))
          || Boolean(clean(state.dialog.originalNote))
          || Boolean(state.dialog.pendingKinderMerge)
          || Boolean(state.dialog.pendingKinderSplit)
          || clean(state.dialog.teacherMemberId) !== clean(state.dialog.originalTeacherMemberId);
        saveButton.disabled = !canSave;
        if (hasAddRegistrationTarget(state.dialog)) saveButton.textContent = '등록';
      }
    });
"""
text = replace_once(text, old_search_bind, new_search_bind, 'add dialog bindings')
text = replace_once(
    text,
    "        const hasSelectedStudent = Boolean(state.dialog.studentId);\n        const hasNote = Boolean(clean(state.dialog.note));",
    "        const hasSelectedStudent = hasAddRegistrationTarget(state.dialog);\n        const hasNote = Boolean(clean(state.dialog.note));",
    'add note save target'
)

new_save_add = r'''  async function saveAdd() {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== 'add') return;
    const guestMode = isGuestAddType(dialog.addType);
    const guestName = clean(dialog.guestName);
    const hasStudent = Boolean(dialog.studentId);
    const hasRegistrationTarget = guestMode ? Boolean(guestName) : hasStudent;
    const note = clean(dialog.note);
    const hadMemo = Boolean(clean(dialog.originalNote));
    const pendingKinderMerge = Boolean(dialog.pendingKinderMerge && dialog.division === 'kinder');
    const pendingKinderSplit = Boolean(dialog.pendingKinderSplit && dialog.division === 'kinder');
    const teacherChanged = clean(dialog.teacherMemberId) !== clean(dialog.originalTeacherMemberId);
    if (!hasRegistrationTarget && !note && !hadMemo && !pendingKinderMerge && !pendingKinderSplit && !teacherChanged) return;

    if (!hasRegistrationTarget) {
      const result = await withSaving(async () => {
        if (pendingKinderMerge) await service.mergeKinderClass(dialog.weekday, dialog.time);
        if (pendingKinderSplit) await service.splitKinderClass(dialog.weekday, dialog.time);
        if (teacherChanged) await service.setClassTeacher(dialog.division, dialog.weekday, dialog.time, dialog.targetClassGroup, dialog.teacherMemberId);
        if (note || hadMemo) await persistDialogCellMemo(dialog);
        if (teacherChanged) await refreshStudentsFromServer();
        return { merged: pendingKinderMerge, split: pendingKinderSplit, memoChanged: note || hadMemo, teacherChanged };
      });
      if (result) {
        if (pendingKinderMerge) notify(`${weekdayLabel(dialog.weekday)}요일 ${timeLabel(dialog.time)} 유치부 수업을 합반했어요.`);
        else if (pendingKinderSplit) notify(`${weekdayLabel(dialog.weekday)}요일 ${timeLabel(dialog.time)} 유치부 수업을 A반·B반으로 분반했어요.`);
        else if (teacherChanged) {
          const teacher = teacherMemberById(dialog.teacherMemberId);
          notify(teacher ? `${teacherDisplayName(teacher.display_name)} 담임으로 설정했어요.` : '담임 지정을 해제했어요.');
        }
        else notify(note ? '시간표 메모를 저장했어요.' : '시간표 메모를 삭제했어요.');
      }
      return;
    }

    if (dialog.date < todayKey()) {
      alert('지난 날짜에는 학생을 추가할 수 없습니다.');
      return;
    }

    const combined = await withSaving(async () => {
      if (pendingKinderMerge) await service.mergeKinderClass(dialog.weekday, dialog.time);
      if (pendingKinderSplit) await service.splitKinderClass(dialog.weekday, dialog.time);
      if (teacherChanged) await service.setClassTeacher(dialog.division, dialog.weekday, dialog.time, dialog.targetClassGroup, dialog.teacherMemberId);
      let actionResult;
      if (guestMode) {
        actionResult = await service.addGuestEntry({
          guestName,
          division: dialog.division,
          entryType: dialog.addType === 'trial' ? 'trial' : 'wait',
          sessionDate: dialog.date,
          timeSlot: dialog.time,
          classGroup: dialog.targetClassGroup
        });
      } else if (dialog.addType === 'makeup') {
        actionResult = await service.addMakeup(dialog.studentId, dialog.date, dialog.time, note, dialog.targetClassGroup);
      } else {
        actionResult = await service.addWaitlist({
          studentId: dialog.studentId,
          targetWeekday: dialog.weekday,
          targetTimeSlot: dialog.time,
          targetClassGroup: dialog.targetClassGroup,
          effectiveDate: dialog.date
        });
      }

      let memoError = '';
      try {
        await persistDialogCellMemo(dialog);
      } catch (error) {
        memoError = clean(error && (error.message || error)) || '메모 저장 실패';
      }
      if (teacherChanged) await refreshStudentsFromServer();
      return { actionResult, memoError };
    });

    if (!combined || !combined.actionResult) return;
    if (guestMode) {
      notify(dialog.addType === 'trial'
        ? `${guestName} (비) 체험수업을 등록했어요.`
        : `${guestName} (비) 학생을 대기로 등록했어요.`);
    } else {
      const student = studentById(dialog.studentId);
      if (dialog.addType === 'makeup') notify(`${student.name} 학생의 보강을 등록했어요.`);
      else notify(`${student.name} 학생을 대기로 등록했어요.`);
    }
    if (combined.memoError) {
      alert(`학생 등록은 완료됐지만 시간표 메모는 저장하지 못했습니다.\n${combined.memoError}`);
    }
  }
'''
text = replace_regex_once(
    text,
    r"  async function saveAdd\(\) \{.*?\n  \}\n\n  async function savePickup",
    new_save_add + "\n  async function savePickup",
    'saveAdd'
)

new_cancel = r'''  async function cancelMakeupSession() {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== 'makeup') return;
    const item = oneTimeSessions().find((row) => clean(row.id) === clean(dialog.makeupId));
    const result = await withSaving(() => service.cancelMakeup(dialog.makeupId));
    if (result) notify(`${item.student_name}${item.is_guest === true ? ' (비)' : ''} 학생의 ${clean(item.session_type) === 'trial' ? '체험수업' : '보강'}을 취소했어요.`);
  }
'''
text = replace_regex_once(
    text,
    r"  async function cancelMakeupSession\(\) \{.*?\n  \}\n\n  async function cancelScheduledChange",
    new_cancel + "\n  async function cancelScheduledChange",
    'cancelMakeupSession'
)

path.write_text(text)


# 3) Styles: trial gets its own color, wait remains identical.
path = Path('pc-timetable.css')
text = path.read_text()
text = replace_once(
    text,
    '#recordRoomScreen .olliTtCell.holiday .olliTtStudent, #recordRoomScreen .olliTtCell.holiday .olliTtStudent.regular.elementary, #recordRoomScreen .olliTtCell.holiday .olliTtStudent.regular.kinder, #recordRoomScreen .olliTtCell.holiday .olliTtStudent.makeup, #recordRoomScreen .olliTtCell.holiday .olliTtStudent.wait, #recordRoomScreen .olliTtCell.holiday .olliTtStudent.attended',
    '#recordRoomScreen .olliTtCell.holiday .olliTtStudent, #recordRoomScreen .olliTtCell.holiday .olliTtStudent.regular.elementary, #recordRoomScreen .olliTtCell.holiday .olliTtStudent.regular.kinder, #recordRoomScreen .olliTtCell.holiday .olliTtStudent.makeup, #recordRoomScreen .olliTtCell.holiday .olliTtStudent.trial, #recordRoomScreen .olliTtCell.holiday .olliTtStudent.wait, #recordRoomScreen .olliTtCell.holiday .olliTtStudent.attended',
    'holiday trial style'
)
text = replace_once(
    text,
    '#recordRoomScreen .olliTtStudent.makeup { border-color: #73b9a5; color: #267763; background: #e5f6f0; }',
    '#recordRoomScreen .olliTtStudent.makeup { border-color: #73b9a5; color: #267763; background: #e5f6f0; }\n#recordRoomScreen .olliTtStudent.trial { border-color: #e6b56e; color: #9a5a10; background: #fff1dc; }',
    'trial card style'
)
text = replace_once(
    text,
    '#recordRoomScreen .olliTtStudent.makeup .olliTtStudentTag { background: #338d74; }',
    '#recordRoomScreen .olliTtStudent.makeup .olliTtStudentTag { background: #338d74; }\n#recordRoomScreen .olliTtStudent.trial .olliTtStudentTag { background: #d98b28; }',
    'trial capsule style'
)
path.write_text(text)

print('guest timetable source edits prepared')
