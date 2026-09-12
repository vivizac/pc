from pathlib import Path

p = Path('olli-data-record-list.js')
s = p.read_text(encoding='utf-8')
old_elem = "function compareElementaryByRecordSort(a,b) {\n  const criterion = getRecordSortCriteria('elementary');\n  let result = 0;\n"
new_elem = "function compareElementaryByRecordSort(a,b) {\n  const criterion = getRecordSortCriteria('elementary');\n  if (criterion === 'initial') return compareRecordSortName(a,b);\n  let result = 0;\n"
if s.count(old_elem) != 1:
    raise SystemExit(f'elementary comparator owner block count={s.count(old_elem)}')
s = s.replace(old_elem, new_elem, 1)
old_kinder = "function compareKinderByRecordSort(a,b) {\n  const criterion = getRecordSortCriteria('kinder');\n  let result = 0;\n"
new_kinder = "function compareKinderByRecordSort(a,b) {\n  const criterion = getRecordSortCriteria('kinder');\n  if (criterion === 'initial') return compareRecordSortName(a,b);\n  let result = 0;\n"
if s.count(old_kinder) != 1:
    raise SystemExit(f'kinder comparator owner block count={s.count(old_kinder)}')
p.write_text(s.replace(old_kinder, new_kinder, 1), encoding='utf-8')

p = Path('olli-settings-base.js')
s = p.read_text(encoding='utf-8')
marker = "  if (typeof window.olliApplySettingsAccountEnhancements === 'function') {\n    try { window.olliApplySettingsAccountEnhancements(); } catch (err) { console.warn('settings account UI extension skipped:', err); }\n  }\n"
replacement = marker + "  if (typeof window.olliApplyAttendancePolicySettings === 'function') {\n    try { window.olliApplyAttendancePolicySettings(); } catch (err) { console.warn('attendance policy settings extension skipped:', err); }\n  }\n"
if s.count(marker) != 1:
    raise SystemExit(f'settings extension marker count={s.count(marker)}')
p.write_text(s.replace(marker, replacement, 1), encoding='utf-8')
