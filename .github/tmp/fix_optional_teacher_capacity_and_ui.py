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


replace_once(
    'pc-student-class-routing.js',
    "    installStudentScheduleTeacherLock();",
    "    // 하단 담임 박스는 더 이상 생성하지 않습니다. 담임은 현재 정규수업 줄에만 표시합니다.",
    'disable legacy bottom teacher renderer'
)

replace_once(
    'pc-timetable.css',
    ".olliTtChoice.full:not(.active) { color: #d64a4a; background: #fff0f0; border-color: #f1c7c7; }",
    """#olliTtDialog .olliTtChoice.full,
#olliTtDialog .olliTtChoice.full.active,
#olliTtDialog .olliTtChoice.full:hover {
  color: #d64a4a !important;
  background: #fff0f0 !important;
  border-color: #f1c7c7 !important;
  box-shadow: none !important;
}
#olliTtDialog .olliTtChoice.full small { color: inherit !important; }""",
    'force every full timetable slot to red state'
)

print('Teacher flicker and full-slot color patches completed.')
