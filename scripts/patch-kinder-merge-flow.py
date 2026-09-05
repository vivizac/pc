from pathlib import Path

js_path = Path('pc-timetable.js')
js = js_path.read_text()

repls = [
("query: '', note: existingMemo, originalNote: existingMemo, addType: 'wait', targetClassGroup\n", "query: '', note: existingMemo, originalNote: existingMemo, addType: 'wait', targetClassGroup, pendingKinderMerge: false\n"),
("const selected = classGroupOf({ class_group: selectedGroup });\n\n    if (division === 'kinder' && includeKinderLayoutControl) {", "const selected = classGroupOf({ class_group: selectedGroup });\n    const pendingKinderMerge = Boolean(state.dialog && state.dialog.kind === 'add' && state.dialog.division === 'kinder' && state.dialog.pendingKinderMerge);\n\n    if (division === 'kinder' && includeKinderLayoutControl) {"),
("['A', 'B'].map((group) => `<button type=\"button\" class=\"olliTtChoice ${selected === group ? 'active' : ''}\" data-tt-target-class=\"${group}\">${group}반</button>`).join('')\n        + '<button type=\"button\" class=\"olliTtChoice olliTtKinderMergeChoice\" data-tt-merge-kinder-class>클래스 합반</button>'", "['A', 'B'].map((group) => `<button type=\"button\" class=\"olliTtChoice ${!pendingKinderMerge && selected === group ? 'active' : ''}\" data-tt-target-class=\"${group}\">${group}반</button>`).join('')\n        + `<button type=\"button\" class=\"olliTtChoice olliTtKinderMergeChoice ${pendingKinderMerge ? 'active' : ''}\" data-tt-merge-kinder-class>클래스 합반</button>`"),
("const canRegister = Boolean(selected || note || hadMemo);\n    const primaryLabel = selected ? '등록' : (note ? '메모 저장' : (hadMemo ? '메모 삭제' : '등록'));", "const canRegister = Boolean(selected || note || hadMemo || dialog.pendingKinderMerge);\n    const primaryLabel = dialog.pendingKinderMerge ? '등록' : (selected ? '등록' : (note ? '메모 저장' : (hadMemo ? '메모 삭제' : '등록')));"),
("dialog.querySelectorAll('[data-tt-target-class]').forEach((button) => button.addEventListener('click', () => { state.dialog.targetClassGroup = button.dataset.ttTargetClass; renderDialog(); }));", "dialog.querySelectorAll('[data-tt-target-class]').forEach((button) => button.addEventListener('click', () => { state.dialog.targetClassGroup = button.dataset.ttTargetClass; if (state.dialog.kind === 'add') state.dialog.pendingKinderMerge = false; renderDialog(); }));"),
("const hasSelectedStudent = Boolean(state.dialog.studentId);\n        const hasNote = Boolean(clean(state.dialog.note));\n        const hadMemo = Boolean(clean(state.dialog.originalNote));\n        saveButton.disabled = !(hasSelectedStudent || hasNote || hadMemo);\n        saveButton.textContent = hasSelectedStudent ? '등록' : (hasNote ? '메모 저장' : (hadMemo ? '메모 삭제' : '등록'));", "const hasSelectedStudent = Boolean(state.dialog.studentId);\n        const hasNote = Boolean(clean(state.dialog.note));\n        const hadMemo = Boolean(clean(state.dialog.originalNote));\n        const pendingKinderMerge = Boolean(state.dialog.pendingKinderMerge);\n        saveButton.disabled = !(hasSelectedStudent || hasNote || hadMemo || pendingKinderMerge);\n        saveButton.textContent = pendingKinderMerge ? '등록' : (hasSelectedStudent ? '등록' : (hasNote ? '메모 저장' : (hadMemo ? '메모 삭제' : '등록')));"),
]
for old, new in repls:
    if old not in js:
        raise SystemExit('missing JS anchor: ' + old[:80])
    js = js.replace(old, new, 1)

old_merge = """  async function mergeKinderClass() {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== 'add' || dialog.division !== 'kinder') return;
    if (!confirm(`${weekdayLabel(dialog.weekday)}요일 ${timeLabel(dialog.time)} 유치부 A반·B반을 합반할까요?\\n기존 A반·B반 학생은 그대로 유지되며 한 칸에 함께 표시됩니다.`)) return;
    dialog.targetClassGroup = 'A';
    const result = await withOpenDialogSaving(() => service.mergeKinderClass(dialog.weekday, dialog.time));
    if (result) notify(`${weekdayLabel(dialog.weekday)}요일 ${timeLabel(dialog.time)} 유치부 수업을 합반했어요.`);
  }
"""
new_merge = """  async function mergeKinderClass() {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== 'add' || dialog.division !== 'kinder') return;
    dialog.targetClassGroup = 'A';
    dialog.pendingKinderMerge = true;
    renderDialog();
  }
"""
if old_merge not in js:
    raise SystemExit('mergeKinderClass anchor not found')
js = js.replace(old_merge, new_merge, 1)

old_save = """    const hasStudent = Boolean(dialog.studentId);
    const note = clean(dialog.note);
    const hadMemo = Boolean(clean(dialog.originalNote));
    if (!hasStudent && !note && !hadMemo) return;

    if (!hasStudent) {
      const memoResult = await withSaving(() => persistDialogCellMemo(dialog));
      if (memoResult) notify(note ? '시간표 메모를 저장했어요.' : '시간표 메모를 삭제했어요.');
      return;
    }
"""
new_save = """    const hasStudent = Boolean(dialog.studentId);
    const note = clean(dialog.note);
    const hadMemo = Boolean(clean(dialog.originalNote));
    const pendingKinderMerge = Boolean(dialog.pendingKinderMerge && dialog.division === 'kinder');
    if (!hasStudent && !note && !hadMemo && !pendingKinderMerge) return;

    if (!hasStudent) {
      const result = await withSaving(async () => {
        if (pendingKinderMerge) await service.mergeKinderClass(dialog.weekday, dialog.time);
        if (note || hadMemo) await persistDialogCellMemo(dialog);
        return { merged: pendingKinderMerge, memoChanged: note || hadMemo };
      });
      if (result) {
        if (pendingKinderMerge) notify(`${weekdayLabel(dialog.weekday)}요일 ${timeLabel(dialog.time)} 유치부 수업을 합반했어요.`);
        else notify(note ? '시간표 메모를 저장했어요.' : '시간표 메모를 삭제했어요.');
      }
      return;
    }
"""
if old_save not in js:
    raise SystemExit('saveAdd head anchor not found')
js = js.replace(old_save, new_save, 1)
js = js.replace("const combined = await withSaving(async () => {\n      const actionResult = dialog.addType === 'makeup'", "const combined = await withSaving(async () => {\n      if (pendingKinderMerge) await service.mergeKinderClass(dialog.weekday, dialog.time);\n      const actionResult = dialog.addType === 'makeup'", 1)
js_path.write_text(js)

css_path = Path('pc-timetable.css')
css = css_path.read_text()
old_css = "#recordRoomScreen .olliTtMergedClassHead { margin-bottom: 5px; padding-bottom: 3px; border-bottom: 1px solid #eadc8a; }"
new_css = "#recordRoomScreen .olliTtMergedClassHead { margin-bottom: 5px; padding-bottom: 0; border-bottom: 0; }\n#recordRoomScreen .olliTtMergedClassHead strong { font-size: calc(9px * var(--olli-text-scale)); font-weight: 850; }"
if old_css not in css:
    raise SystemExit('merged class head css anchor not found')
css = css.replace(old_css, new_css, 1)
css_path.write_text(css)

index_path = Path('index.html')
index = index_path.read_text()
old_ver = 'pc-timetable.css?v=20260905-4'
new_ver = 'pc-timetable.css?v=20260905-5'
if new_ver not in index:
    if old_ver not in index:
        raise SystemExit('CSS version anchor not found')
    index = index.replace(old_ver, new_ver, 1)
index_path.write_text(index)
