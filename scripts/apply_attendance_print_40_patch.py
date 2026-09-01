from pathlib import Path

path = Path('index.html')
s = path.read_text(encoding='utf-8')
changed = False

def replace_once(old, new, label):
    global s, changed
    if new in s:
        return
    if old not in s:
        raise SystemExit(f'{label} 위치를 찾지 못했습니다.')
    s = s.replace(old, new, 1)
    changed = True

replace_once(
    'const SETTINGS_ATTENDANCE_PRINT_ROWS_PER_PAGE = 30;',
    'const SETTINGS_ATTENDANCE_PRINT_ROWS_PER_PAGE = 40;',
    '페이지당 출석부 행 수'
)

replace_once(
    'border: 1px solid #b4b4b4;',
    'border: 0.6px solid #b4b4b4;',
    '출석부 미리보기 표 선'
)

replace_once(
    'border: 1px solid #777777;\n  height: 26px;',
    'border: 0.6px solid #777777;\n  height: 26px;',
    '출석부 인쇄 표 선'
)

replace_once(
    '/* 2026-07-03: 출석부 출력 30명 1페이지 맞춤 보정',
    '/* 2026-09-01: 출석부 출력 40명 1페이지 맞춤 보정',
    '출석부 인쇄 보정 주석'
)

replace_once(
    '   30명 표가 다음 페이지로 밀리는 문제를 줄이기 위해 출력 전용 상하 높이를 재조정합니다. */',
    '   40명 표가 다음 페이지로 밀리는 문제를 줄이기 위해 출력 전용 상하 높이를 재조정합니다. */',
    '출석부 인쇄 보정 설명'
)

replace_once(
    '.attendancePrintHeader {\n  margin-bottom: 5px;\n}',
    '.attendancePrintHeader {\n  padding-top: 8px;\n  margin-bottom: 5px;\n}',
    '학원명 위 여백'
)

replace_once(
    '.attendancePrintTable th,\n.attendancePrintTable td {\n  height: 22px;',
    '.attendancePrintTable th,\n.attendancePrintTable td {\n  height: 20px;',
    '40행 인쇄 높이'
)

replace_once(
    'border:1px solid #777777!important;border-color:#777777!important;',
    'border:0.6px solid #777777!important;border-color:#777777!important;',
    '인쇄 셀 인라인 선'
)

old_page_block = '''  const buildPage = (pageStudents, pageIndex) => {
    const startIndex = pageIndex * rowsPerPage;
    const rows = pageStudents.map((student, index) => buildRow(student, startIndex + index)).join('');
    const emptyRow = students.length ? '' : '<tr><td colspan="' + (baseColumnCount + days) + '">재원생이 없습니다.</td></tr>';
    return '<div class="attendancePrintPage">'
'''
new_page_block = '''  const buildBlankRow = (globalIndex) => {
    const dateCells = Array.from({ length: days }, (_, i) => {
      const day = i + 1;
      const cls = settingsAttendanceDayClass(ym.year, ym.month, day);
      return '<td class="dateCol ' + cls + '"' + settingsAttendancePrintInlineStyle(cls, forPrint) + '></td>';
    }).join('');
    return '<tr class="attendanceBlankRow">'
      + '<td class="noCol">' + (globalIndex + 1) + '</td>'
      + (showDivisionCol ? '<td class="divisionCol"></td>' : '')
      + '<td class="nameCol"></td>'
      + '<td class="schoolGradeCol"></td>'
      + '<td class="personalityCol"></td>'
      + dateCells
      + '</tr>';
  };
  const buildPage = (pageStudents, pageIndex) => {
    const startIndex = pageIndex * rowsPerPage;
    const rows = pageStudents.map((student, index) => buildRow(student, startIndex + index)).join('');
    const blankRowCount = Math.max(0, rowsPerPage - pageStudents.length);
    const blankRows = Array.from({ length: blankRowCount }, (_, index) => buildBlankRow(startIndex + pageStudents.length + index)).join('');
    return '<div class="attendancePrintPage">'
'''
if 'const buildBlankRow = (globalIndex) =>' not in s:
    if old_page_block not in s:
        raise SystemExit('출석부 페이지 행 생성 위치를 찾지 못했습니다.')
    s = s.replace(old_page_block, new_page_block, 1)
    changed = True

replace_once(
    "+ colGroup + '<thead><tr>' + headerCells + '</tr></thead><tbody>' + rows + emptyRow + '</tbody></table>'",
    "+ colGroup + '<thead><tr>' + headerCells + '</tr></thead><tbody>' + rows + blankRows + '</tbody></table>'",
    '출석부 빈 행 연결'
)

# 빈 행 도입 후 더 이상 사용하지 않는 열 개수 계산 제거
if '  const baseColumnCount = showDivisionCol ? 5 : 4;\n' in s:
    s = s.replace('  const baseColumnCount = showDivisionCol ? 5 : 4;\n', '', 1)
    changed = True

replace_once(
    '.attendancePrintHeader{margin-bottom:5px}',
    '.attendancePrintHeader{padding-top:8px;margin-bottom:5px}',
    '독립 인쇄 화면 학원명 위 여백'
)

replace_once(
    '.attendancePrintTable th,.attendancePrintTable td{border:1px solid #777777;height:22px;',
    '.attendancePrintTable th,.attendancePrintTable td{border:0.6px solid #777777;height:20px;',
    '독립 인쇄 화면 표 선과 행 높이'
)

replace_once(
    "cell.style.border = '1px solid #777777';",
    "cell.style.border = '0.6px solid #777777';",
    'PDF 렌더링 표 선'
)

if changed:
    path.write_text(s, encoding='utf-8')
    print('attendance print 40-row patch applied')
else:
    print('attendance print 40-row patch already applied')
