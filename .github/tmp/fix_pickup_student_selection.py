from pathlib import Path
import re

path = Path('pc-timetable.js')
text = path.read_text(encoding='utf-8')

new_picker = '''  function pickupPickerHtml(dialog) {
    const query = clean(dialog.query);
    const students = service.activeStudents().filter((student) => divisionOf(student) === 'kinder' && (!query || clean(student.name).includes(query)));
    if (!clean(dialog.studentId) && query) {
      const exactMatches = students.filter((student) => clean(student.name) === query);
      if (exactMatches.length === 1) dialog.studentId = clean(exactMatches[0].id);
    }
    return students.length ? students.map((student) => `<button type="button" class="olliTtPickerStudent ${clean(student.id) === clean(dialog.studentId) ? 'active' : ''}" data-tt-pickup-student="${esc(student.id)}"><strong>${esc(student.name)}</strong><span>${esc(studentScheduleText(student.id)) || '수업 없음'}</span></button>`).join('') : '<div class="olliTtQuickEmpty">학생을 찾지 못했습니다.</div>';
  }
'''

if 'const exactMatches = students.filter((student) => clean(student.name) === query);' not in text:
    pattern = re.compile(r"  function pickupPickerHtml\(dialog\) \{\n.*?\n  \}\n\n  function renderPickupPickerResults", re.S)
    text, count = pattern.subn(new_picker + '\n  function renderPickupPickerResults', text, count=1)
    if count != 1:
        raise SystemExit('pickupPickerHtml target not found')

old_save = '''    dialog.pickupLabel = clean(root && root.querySelector('[data-tt-pickup-label]')?.value || dialog.pickupLabel);
    dialog.pickupTime = clean(root && root.querySelector('[data-tt-pickup-time]')?.value || dialog.pickupTime);
    if (!dialog.studentId) { alert('픽업할 학생을 선택해 주세요.'); return; }
'''

new_save = '''    dialog.pickupLabel = clean(root && root.querySelector('[data-tt-pickup-label]')?.value || dialog.pickupLabel);
    dialog.pickupTime = clean(root && root.querySelector('[data-tt-pickup-time]')?.value || dialog.pickupTime);
    if (!clean(dialog.studentId)) {
      const activeButton = root && root.querySelector('[data-tt-pickup-student].active');
      if (activeButton) dialog.studentId = clean(activeButton.dataset.ttPickupStudent);
    }
    if (!clean(dialog.studentId)) {
      const visibleButtons = root ? Array.from(root.querySelectorAll('[data-tt-pickup-student]')) : [];
      if (visibleButtons.length === 1) dialog.studentId = clean(visibleButtons[0].dataset.ttPickupStudent);
    }
    if (!clean(dialog.studentId)) {
      const query = clean(root && root.querySelector('[data-tt-pickup-search]')?.value || dialog.query);
      const exactMatches = service.activeStudents().filter((student) => divisionOf(student) === 'kinder' && clean(student.name) === query);
      if (exactMatches.length === 1) dialog.studentId = clean(exactMatches[0].id);
    }
    if (!clean(dialog.studentId)) { alert('픽업할 학생을 선택해 주세요.'); return; }
'''

if 'visibleButtons.length === 1' not in text:
    if old_save not in text:
        raise SystemExit('savePickup target not found')
    text = text.replace(old_save, new_save, 1)

path.write_text(text, encoding='utf-8')
print('Pickup student selection patch applied.')
