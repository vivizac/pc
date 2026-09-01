from pathlib import Path

path = Path('index.html')
s = path.read_text(encoding='utf-8')
changed = False

repls = [
    ('height: 21px;\n  padding-top: 0.5px;', 'height: 23px;\n  padding-top: 0.5px;', '출력 행 높이'),
    ('.attendancePrintTable .nameCol { width: 42px; padding-left: 0; padding-right: 0; text-align: center; font-weight: 780; }', '.attendancePrintTable .nameCol { width: 43px; padding-left: 0; padding-right: 0; text-align: center; font-weight: 780; }', '이름 열 너비'),
    ('.attendancePrintTable .schoolGradeCol { width: 51px; padding-left: 0; padding-right: 0; text-align: center; font-weight: 660; }', '.attendancePrintTable .schoolGradeCol { width: 52px; padding-left: 0; padding-right: 0; text-align: center; font-weight: 660; }', '학교/학년 열 너비'),
    ('.attendancePrintTable tbody td.nameCol { font-size: 11.8px; font-weight: 780; }', '.attendancePrintTable tbody td.nameCol { font-size: 11.8px; font-weight: 700; }', '이름 텍스트 굵기'),
    ('.attendancePrintTable tbody td.schoolGradeCol { font-size: 11.4px; font-weight: 680; }', '.attendancePrintTable tbody td.schoolGradeCol { font-size: 11.4px; font-weight: 600; }', '학교/학년 텍스트 굵기'),
    ('.attendancePrintTable tbody td.personalityCol { font-size: 11.2px; font-weight: 680; }', '.attendancePrintTable tbody td.personalityCol { font-size: 11.2px; font-weight: 600; }', '성향 텍스트 굵기'),
    ('.attendancePrintTable th,.attendancePrintTable td{border:0.5px solid #777777;height:21px;', '.attendancePrintTable th,.attendancePrintTable td{border:0.5px solid #777777;height:23px;', '독립 출력 행 높이'),
    ('.attendancePrintTable tbody td.nameCol{font-size:11.8px;font-weight:780}', '.attendancePrintTable tbody td.nameCol{font-size:11.8px;font-weight:700}', '독립 출력 이름 텍스트 굵기'),
    ('.attendancePrintTable tbody td.schoolGradeCol{font-size:11.4px;font-weight:680}', '.attendancePrintTable tbody td.schoolGradeCol{font-size:11.4px;font-weight:600}', '독립 출력 학교/학년 텍스트 굵기'),
    ('.attendancePrintTable tbody td.personalityCol{font-size:11.2px;font-weight:680}', '.attendancePrintTable tbody td.personalityCol{font-size:11.2px;font-weight:600}', '독립 출력 성향 텍스트 굵기'),
    ('.attendancePrintTable .nameCol{width:42px;padding-left:0!important;padding-right:0!important;text-align:center;font-weight:780}', '.attendancePrintTable .nameCol{width:43px;padding-left:0!important;padding-right:0!important;text-align:center;font-weight:780}', '독립 출력 이름 열 너비'),
    ('.attendancePrintTable .schoolGradeCol{width:51px;padding-left:0!important;padding-right:0!important;text-align:center;font-weight:660}', '.attendancePrintTable .schoolGradeCol{width:52px;padding-left:0!important;padding-right:0!important;text-align:center;font-weight:660}', '독립 출력 학교/학년 열 너비'),
]

for old, new, label in repls:
    if new in s:
        continue
    if old not in s:
        raise SystemExit(f'{label} 위치를 찾지 못했습니다.')
    s = s.replace(old, new, 1)
    changed = True

# 이번 조정의 예전 런타임 값이 남아 있으면 실패시켜 중복/덮어쓰기 누락을 잡습니다.
for stale in [
    'height: 21px;\n  padding-top: 0.5px;',
    '.attendancePrintTable .nameCol { width: 42px; padding-left: 0; padding-right: 0; text-align: center; font-weight: 780; }',
    '.attendancePrintTable .schoolGradeCol { width: 51px; padding-left: 0; padding-right: 0; text-align: center; font-weight: 660; }',
    '.attendancePrintTable tbody td.nameCol { font-size: 11.8px; font-weight: 780; }',
    '.attendancePrintTable tbody td.schoolGradeCol { font-size: 11.4px; font-weight: 680; }',
    '.attendancePrintTable tbody td.personalityCol { font-size: 11.2px; font-weight: 680; }',
    '.attendancePrintTable th,.attendancePrintTable td{border:0.5px solid #777777;height:21px;',
    '.attendancePrintTable tbody td.nameCol{font-size:11.8px;font-weight:780}',
    '.attendancePrintTable tbody td.schoolGradeCol{font-size:11.4px;font-weight:680}',
    '.attendancePrintTable tbody td.personalityCol{font-size:11.2px;font-weight:680}',
    '.attendancePrintTable .nameCol{width:42px;padding-left:0!important;padding-right:0!important;text-align:center;font-weight:780}',
    '.attendancePrintTable .schoolGradeCol{width:51px;padding-left:0!important;padding-right:0!important;text-align:center;font-weight:660}',
]:
    if stale in s:
        raise SystemExit(f'예전 출석부 출력 값이 남아 있습니다: {stale}')

if changed:
    path.write_text(s, encoding='utf-8')
    print('attendance print updated: 23px rows, +1px name/school columns, lighter student text')
else:
    print('attendance print values already current')
