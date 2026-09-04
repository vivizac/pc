function settingsGetCurrentYearMonthValue() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return yyyy + '-' + mm;
}

function settingsGetAttendanceYearMonth() {
  const value = String(settingsAttendancePrintState.yearMonth || settingsGetCurrentYearMonthValue()).trim();
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    const fallback = settingsGetCurrentYearMonthValue().match(/^(\d{4})-(\d{2})$/);
    return { value: settingsGetCurrentYearMonthValue(), year: Number(fallback[1]), month: Number(fallback[2]) };
  }
  return { value, year: Number(match[1]), month: Number(match[2]) };
}

function settingsGetDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function settingsAttendanceGetDivisionLabel(division) {
  if (division === 'combined') return '유치부/초등부';
  return division === 'kinder' ? '유치부' : '초등부';
}

function settingsAttendanceGetStudentDivision(student, fallbackDivision) {
  const value = String(student?._attendanceDivision || fallbackDivision || settingsAttendancePrintState.division || 'elementary').trim();
  return value === 'kinder' ? 'kinder' : 'elementary';
}

function settingsAttendanceNormalizeNumber(value) {
  const m = String(value || '').match(/\d+/);
  return m ? Number(m[0]) : 9999;
}

function settingsAttendanceNormalizeDay(value) {
  return String(value || '')
    .replace(/요일/g, '')
    .replace(/[\s,，/]+/g, '')
    .trim();
}

function settingsAttendanceIsActiveStudent(student) {
  if (!student) return false;
  if (typeof getStudentStatus === 'function' && getStudentStatus(student) !== 'active') return false;
  const raw = String(student.status || '').trim().toLowerCase();
  if (['paused','pause','rest','휴원','휴원생','withdrawn','withdraw','quit','퇴원','퇴원생','inactive','deleted','removed','삭제'].includes(raw)) return false;
  if (student.is_deleted === true || String(student.is_deleted || '').toLowerCase() === 'true') return false;
  return true;
}

function settingsGetAttendanceRosterStudentsByDivision(division) {
  const safeDivision = division === 'kinder' ? 'kinder' : 'elementary';
  const all = (typeof getStudentsByType === 'function') ? getStudentsByType(safeDivision) : [];
  return all.filter(settingsAttendanceIsActiveStudent).map(student => Object.assign({}, student, { _attendanceDivision: safeDivision }));
}

function settingsGetAttendanceRosterStudents() {
  const selectedDivision = settingsAttendancePrintState.division === 'combined'
    ? 'combined'
    : (settingsAttendancePrintState.division === 'kinder' ? 'kinder' : 'elementary');
  const students = selectedDivision === 'combined'
    ? settingsGetAttendanceRosterStudentsByDivision('kinder').concat(settingsGetAttendanceRosterStudentsByDivision('elementary'))
    : settingsGetAttendanceRosterStudentsByDivision(selectedDivision);
  const sortMode = settingsAttendancePrintState.sort === 'name' ? 'name' : 'grade';
  return students.slice().sort((a, b) => {
    const ad = settingsAttendanceGetStudentDivision(a, selectedDivision);
    const bd = settingsAttendanceGetStudentDivision(b, selectedDivision);
    if (sortMode === 'name') {
      return String(a.name || '').localeCompare(String(b.name || ''), 'ko')
        || (ad === bd ? 0 : (ad === 'kinder' ? -1 : 1))
        || settingsAttendanceNormalizeNumber(a.grade || a.age) - settingsAttendanceNormalizeNumber(b.grade || b.age);
    }
    if (ad !== bd) return ad === 'kinder' ? -1 : 1;
    const av = ad === 'kinder' ? settingsAttendanceNormalizeNumber(a.age) : settingsAttendanceNormalizeNumber(a.grade);
    const bv = bd === 'kinder' ? settingsAttendanceNormalizeNumber(b.age) : settingsAttendanceNormalizeNumber(b.grade);
    return (av - bv) || String(a.name || '').localeCompare(String(b.name || ''), 'ko');
  });
}

function settingsAttendanceShortenSchoolName(value) {
  let text = String(value || '').trim();
  if (!text) return '';
  text = text.replace(/\s+/g, '');
  text = text.replace(/초등학교/g, '초');
  text = text.replace(/초등/g, '초');
  text = text.replace(/등학교/g, '');
  return text;
}

function settingsAttendanceShortenKindergartenName(value) {
  let text = String(value || '').trim();
  if (!text) return '';
  text = text.replace(/\s+/g, '');
  text = text.replace(/유치원/g, '');
  return text;
}

function settingsAttendanceGetStudentSchool(student, division) {
  const studentDivision = settingsAttendanceGetStudentDivision(student, division);
  if (studentDivision === 'kinder') return settingsAttendanceShortenKindergartenName(student.kindergarten || student.school || '');
  return settingsAttendanceShortenSchoolName(student.school || '');
}

function settingsAttendanceGetStudentGrade(student, division) {
  const studentDivision = settingsAttendanceGetStudentDivision(student, division);
  return studentDivision === 'kinder'
    ? String(student.age || '').trim()
    : String(student.grade || '').trim();
}

function settingsAttendanceShortenGradeText(value, division) {
  let text = String(value || '').trim().replace(/\s+/g, '');
  if (!text) return '';
  const m = text.match(/\d+/);
  if (m) return m[0];
  if (division === 'elementary') return text.replace(/학년/g, '');
  return text.replace(/세|살/g, '');
}

function settingsAttendanceGetStudentSchoolGrade(student, division) {
  const studentDivision = settingsAttendanceGetStudentDivision(student, division);
  const school = settingsAttendanceGetStudentSchool(student, studentDivision);
  const grade = settingsAttendanceShortenGradeText(settingsAttendanceGetStudentGrade(student, studentDivision), studentDivision);
  return (String(school || '') + String(grade || '')).trim();
}

function settingsAttendanceGetAcademyName() {
  if (typeof getOlliCurrentAcademyName === 'function' && getOlliCurrentAcademyName()) return getOlliCurrentAcademyName();
  return String(localStorage.getItem('olli_current_academy_name') || (olliSettingsState.academy && olliSettingsState.academy.academy_name) || '비비작 아이성향 미술학원').trim();
}

function settingsAttendanceDayClass(year, month, day) {
  const dow = new Date(year, month - 1, day).getDay();
  if (dow === 0) return 'daySun';
  if (dow === 6) return 'daySat';
  return '';
}

function settingsAttendancePrintInlineStyle(type, forPrint) {
  if (!forPrint) return '';
  const exact = '-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact;border:0.5px solid #777777!important;border-color:#777777!important;';
  if (type === 'header') return ' style="background-color:#2f6f9f!important;color:#ffffff!important;' + exact + '"';
  if (type === 'daySat') return ' style="background-color:#fff7c8!important;color:#111111!important;' + exact + '"';
  if (type === 'daySun') return ' style="background-color:#ffd9df!important;color:#111111!important;' + exact + '"';
  return '';
}

function settingsBuildAttendanceRegisterHtml(options = {}) {
  const forPrint = options.forPrint !== false;
  const division = settingsAttendancePrintState.division === 'combined'
    ? 'combined'
    : (settingsAttendancePrintState.division === 'kinder' ? 'kinder' : 'elementary');
  const ym = settingsGetAttendanceYearMonth();
  const days = settingsGetDaysInMonth(ym.year, ym.month);
  const students = Array.isArray(options.students) ? options.students : settingsGetAttendanceRosterStudents();
  const attendanceRows = Array.isArray(options.attendanceRows) ? options.attendanceRows : [];
  const attendanceKeys = new Set(attendanceRows.map(row => String(row?.student_id || '') + '|' + String(row?.session_date || '').slice(0, 10)));
  const academyName = settingsAttendanceGetAcademyName();
  const divisionLabel = settingsAttendanceGetDivisionLabel(division);
  const tableClass = forPrint ? 'attendancePrintTable' : 'settingsAttendancePreviewTable';
  const sheetClass = forPrint ? 'attendancePrintSheet' : '';
  const schoolGradeHeader = division === 'combined' ? '소속' : (division === 'kinder' ? '유치원/나이' : '학교/학년');
  const showDivisionCol = false;
  const staticColWidth = (showDivisionCol ? 25 : 0) + 20 + 42 + 51 + 20;
  const dateColWidth = 'calc((100% - ' + staticColWidth + 'px) / ' + days + ')';
  const tableStyle = ' style="--attendance-static-col-width:' + staticColWidth + 'px;--attendance-date-col-count:' + days + ';--attendance-date-col-width:' + dateColWidth + ';"';
  const colGroup = '<colgroup><col class="noCol">'
    + (showDivisionCol ? '<col class="divisionCol">' : '')
    + '<col class="nameCol"><col class="schoolGradeCol"><col class="personalityCol">'
    + Array.from({ length: days }, () => '<col class="dateCol">').join('')
    + '</colgroup>';
  const rowsPerPage = forPrint ? SETTINGS_ATTENDANCE_PRINT_ROWS_PER_PAGE : Math.max(students.length || 1, SETTINGS_ATTENDANCE_PRINT_ROWS_PER_PAGE);
  const totalPages = Math.max(1, Math.ceil((students.length || 1) / rowsPerPage));
  const headerStyle = settingsAttendancePrintInlineStyle('header', forPrint);
  const dayHeaders = Array.from({ length: days }, (_, i) => {
    const day = i + 1;
    const cls = settingsAttendanceDayClass(ym.year, ym.month, day);
    const dayStyle = settingsAttendancePrintInlineStyle(cls, forPrint) || headerStyle;
    return '<th class="dateCol ' + cls + '"' + dayStyle + '>' + day + '</th>';
  }).join('');
  const headerCells = '<th class="noCol"' + headerStyle + '></th>'
    + (showDivisionCol ? '<th class="divisionCol"' + headerStyle + '>구분</th>' : '')
    + '<th class="nameCol"' + headerStyle + '>이름</th><th class="schoolGradeCol"' + headerStyle + '>' + schoolGradeHeader + '</th><th class="personalityCol"' + headerStyle + '>성향</th>'
    + dayHeaders;
  const buildRow = (student, globalIndex) => {
    const studentDivision = settingsAttendanceGetStudentDivision(student, division);
    const dateCells = Array.from({ length: days }, (_, i) => {
      const day = i + 1;
      const cls = settingsAttendanceDayClass(ym.year, ym.month, day);
      const dateKey = ym.year + '-' + String(ym.month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      const marked = attendanceKeys.has(String(student.id || '') + '|' + dateKey);
      return '<td class="dateCol ' + cls + (marked ? ' attendanceLinkedMark' : '') + '"' + settingsAttendancePrintInlineStyle(cls, forPrint) + '>' + (marked ? '<span aria-label="출석">✓</span>' : '') + '</td>';
    }).join('');
    return '<tr>'
      + '<td class="noCol">' + (globalIndex + 1) + '</td>'
      + (showDivisionCol ? '<td class="divisionCol">' + settingsEscapeHtml(settingsAttendanceGetDivisionLabel(studentDivision)) + '</td>' : '')
      + '<td class="nameCol">' + settingsEscapeHtml(student.name || '') + '</td>'
      + '<td class="schoolGradeCol">' + settingsEscapeHtml(settingsAttendanceGetStudentSchoolGrade(student, studentDivision)) + '</td>'
      + '<td class="personalityCol">' + settingsEscapeHtml(student.personality || '') + '</td>'
      + dateCells
      + '</tr>';
  };
  const buildBlankRow = (globalIndex) => {
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
      + '<div class="attendancePrintHeader">'
      + '<div class="attendancePrintAcademy">' + settingsEscapeHtml(academyName) + ' (' + divisionLabel + ')</div>'
      + '<div class="attendancePrintMonth">' + ym.year + '년 ' + ym.month + '월</div>'
      + '</div>'
      + '<table class="' + tableClass + '"' + tableStyle + '>'
      + colGroup + '<thead><tr>' + headerCells + '</tr></thead><tbody>' + rows + blankRows + '</tbody></table>'
      + '</div>';
  };
  const pages = [];
  if (students.length) {
    for (let i = 0; i < students.length; i += rowsPerPage) pages.push(buildPage(students.slice(i, i + rowsPerPage), Math.floor(i / rowsPerPage)));
  } else {
    pages.push(buildPage([], 0));
  }
  return '<div class="' + sheetClass + '">' + pages.join('') + '</div>';
}

window.olliBuildLinkedAttendanceRegisterHtml = function(options = {}) {
  const previous = { division: settingsAttendancePrintState.division, sort: settingsAttendancePrintState.sort, yearMonth: settingsAttendancePrintState.yearMonth };
  settingsAttendancePrintState.division = options.division === 'combined' ? 'combined' : (options.division === 'kinder' ? 'kinder' : 'elementary');
  settingsAttendancePrintState.sort = options.sort === 'name' ? 'name' : 'grade';
  settingsAttendancePrintState.yearMonth = /^\d{4}-\d{2}$/.test(String(options.yearMonth || '')) ? String(options.yearMonth) : settingsGetCurrentYearMonthValue();
  try {
    const requestedIds = Array.isArray(options.students) ? new Set(options.students.map(student => String(student?.id || ''))) : null;
    const students = requestedIds ? settingsGetAttendanceRosterStudents().filter(student => requestedIds.has(String(student?.id || ''))) : undefined;
    return settingsBuildAttendanceRegisterHtml({ forPrint: false, attendanceRows: options.attendanceRows || [], students });
  }
  finally { settingsAttendancePrintState.division = previous.division; settingsAttendancePrintState.sort = previous.sort; settingsAttendancePrintState.yearMonth = previous.yearMonth; }
};


function settingsAttendanceFitTextCells(root) {
  const scope = root && root.querySelectorAll ? root : document;
  const cells = scope.querySelectorAll('.settingsAttendancePreviewTable tbody td.nameCol, .settingsAttendancePreviewTable tbody td.schoolGradeCol, .settingsAttendancePreviewTable tbody td.personalityCol, .attendancePrintTable tbody td.nameCol, .attendancePrintTable tbody td.schoolGradeCol, .attendancePrintTable tbody td.personalityCol');
  cells.forEach(cell => {
    if (!cell || !String(cell.textContent || '').trim()) return;
    cell.style.whiteSpace = 'nowrap';
    cell.style.overflow = 'hidden';
    cell.style.textOverflow = 'clip';
    cell.style.fontSize = '';

    // 행 높이(26px) 때문에 scrollHeight가 1~2px 크게 잡히면,
    // 글자가 충분히 들어가도 모든 셀이 과하게 작아지는 문제가 생긴다.
    // 그래서 자동 축소는 "가로 폭이 실제로 넘칠 때"만 적용한다.
    const availableWidth = Math.max(0, cell.clientWidth - 1);
    if (availableWidth <= 4) return;
    if (cell.scrollWidth <= availableWidth + 1) return;

    const computed = window.getComputedStyle(cell);
    let size = parseFloat(computed.fontSize) || 10;
    const table = cell.closest('.attendancePrintTable');
    const minSize = table ? 10.2 : 11.2;
    let loop = 0;
    while (cell.scrollWidth > availableWidth + 1 && size > minSize && loop < 12) {
      size = Math.max(minSize, size - 0.3);
      cell.style.fontSize = size.toFixed(1) + 'px';
      loop += 1;
    }
  });
}
window.settingsAttendanceFitTextCells = settingsAttendanceFitTextCells;
function settingsAttendanceScheduleFitText(root) {
  const target = root && root.querySelectorAll ? root : document;
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => settingsAttendanceFitTextCells(target));
  } else {
    setTimeout(() => settingsAttendanceFitTextCells(target), 0);
  }
}
window.settingsAttendanceScheduleFitText = settingsAttendanceScheduleFitText;

function renderSettingsAttendancePrintPreview() {
  const students = settingsGetAttendanceRosterStudents();
  const ym = settingsGetAttendanceYearMonth();
  const divisionLabel = settingsAttendanceGetDivisionLabel(settingsAttendancePrintState.division);
  const meta = students.length + '명 · ' + settingsGetDaysInMonth(ym.year, ym.month) + '일';
  const preview = settingsBuildAttendanceRegisterHtml({ forPrint: false });
  return '<div class="settingsAttendancePreviewCard">'
    + '<div class="settingsAttendancePreviewHead"><div class="settingsAttendancePreviewTitle">' + ym.year + '년 ' + ym.month + '월 ' + divisionLabel + ' 출석부</div><div class="settingsAttendancePreviewMeta">' + meta + '</div></div>'
    + '<div class="settingsAttendancePreviewScroll">' + preview + '</div>'
    + '</div>';
}

function renderSettingsAttendancePrint() {
  if (!settingsAttendancePrintState.yearMonth) settingsAttendancePrintState.yearMonth = settingsGetCurrentYearMonthValue();
  const division = settingsAttendancePrintState.division === 'combined'
    ? 'combined'
    : (settingsAttendancePrintState.division === 'kinder' ? 'kinder' : 'elementary');
  const sort = settingsAttendancePrintState.sort === 'name' ? 'name' : 'grade';
  const ym = settingsGetAttendanceYearMonth();
  const students = settingsGetAttendanceRosterStudents();
  const disabled = students.length ? '' : ' disabled';
  return '<div class="settingsDetailIntro"><div class="settingsDetailTitle">등록된 재원생으로<br>출석부 PDF를 만듭니다.</div></div>'
    + '<div class="settingsAttendanceControlCard">'
    + '<div class="settingsAttendanceFieldLabel">부서 선택</div>'
    + '<div class="settingsAttendanceSegment divisionSegment">'
    + '<button type="button" class="settingsAttendanceSegmentBtn ' + (division === 'elementary' ? 'active' : '') + '" onclick="settingsAttendanceSetDivision(\'elementary\')">초등부</button>'
    + '<button type="button" class="settingsAttendanceSegmentBtn ' + (division === 'kinder' ? 'active' : '') + '" onclick="settingsAttendanceSetDivision(\'kinder\')">유치부</button>'
    + '<button type="button" class="settingsAttendanceSegmentBtn ' + (division === 'combined' ? 'active' : '') + '" onclick="settingsAttendanceSetDivision(\'combined\')">통합</button>'
    + '</div>'
    + '<div class="settingsAttendanceFieldLabel">월 선택</div>'
    + '<input class="settingsAttendanceMonthInput" type="month" value="' + settingsEscapeAttr(ym.value) + '" onchange="settingsAttendanceSetMonth(this.value)">'
    + '<div class="settingsAttendanceFieldLabel">정렬 기준</div>'
    + '<div class="settingsAttendanceSegment">'
    + '<button type="button" class="settingsAttendanceSegmentBtn ' + (sort === 'grade' ? 'active' : '') + '" onclick="settingsAttendanceSetSort(\'grade\')">학년순</button>'
    + '<button type="button" class="settingsAttendanceSegmentBtn ' + (sort === 'name' ? 'active' : '') + '" onclick="settingsAttendanceSetSort(\'name\')">이름순</button>'
    + '</div>'
    + '<div class="settingsAttendanceGuide">출력 대상은 재원생만 포함됩니다. 통합은 유치부와 초등부가 한 출석부에 함께 표시됩니다. PDF는 1페이지당 최대 ' + SETTINGS_ATTENDANCE_PRINT_ROWS_PER_PAGE + '명씩 나뉘고 번호는 다음 페이지로 이어집니다.</div>'
    + '<div class="settingsAttendanceActionGrid">'
    + '<button type="button" class="settingsAttendanceActionBtn" onclick="openSettingsAttendanceRegisterPrint()"' + disabled + '>인쇄 화면</button>'
    + '<button type="button" class="settingsAttendanceActionBtn primary" onclick="downloadSettingsAttendanceRegisterPdf()"' + disabled + '>PDF 다운로드</button>'
    + '</div>'
    + '</div>'
    + renderSettingsAttendancePrintPreview();
}

function settingsAttendanceRefreshDetail() {
  if (settingsCurrentDetailType !== 'attendancePrint') return;
  const body = document.getElementById('settingsDetailBody');
  if (body) {
    body.innerHTML = renderSettingsAttendancePrint();
    settingsAttendanceScheduleFitText(body);
  }
}

function settingsAttendanceSetDivision(division) {
  settingsAttendancePrintState.division = division === 'combined' ? 'combined' : (division === 'kinder' ? 'kinder' : 'elementary');
  settingsAttendanceRefreshDetail();
}
window.settingsAttendanceSetDivision = settingsAttendanceSetDivision;

function settingsAttendanceSetSort(sort) {
  settingsAttendancePrintState.sort = sort === 'name' ? 'name' : 'grade';
  settingsAttendanceRefreshDetail();
}
window.settingsAttendanceSetSort = settingsAttendanceSetSort;

function settingsAttendanceSetMonth(value) {
  const safeValue = String(value || '').match(/^\d{4}-\d{2}$/) ? String(value) : settingsGetCurrentYearMonthValue();
  settingsAttendancePrintState.yearMonth = safeValue;
  settingsAttendanceRefreshDetail();
}
window.settingsAttendanceSetMonth = settingsAttendanceSetMonth;

function settingsAttendanceBuildStandaloneHtml() {
  const html = settingsBuildAttendanceRegisterHtml({ forPrint: true });
  return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>출석부 출력</title>'
    + '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/pretendard.css">'
    + '<style>html,body{margin:0;padding:0;background:#fff;font-family:\'Pretendard\',-apple-system,BlinkMacSystemFont,sans-serif;color:#111;}body{padding:4mm 5mm;}@page{size:A4 portrait;margin:4mm 5mm;}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important;}'
    + '.attendancePrintSheet{width:100%;background:#fff;color:#111;font-family:\'Pretendard\',-apple-system,BlinkMacSystemFont,sans-serif}.attendancePrintPage{width:100%;page-break-after:always;break-after:page;page-break-inside:avoid;break-inside:avoid}.attendancePrintPage:last-child{page-break-after:auto;break-after:auto}.attendancePrintHeader{padding-top:10px;margin-bottom:5px}.attendancePrintAcademy{font-size:15px;line-height:1.05;font-weight:760;color:#1f4776;letter-spacing:-.035em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.attendancePrintMonth{margin-top:1px;font-size:31px;line-height:.98;font-weight:900;color:#1f4776;letter-spacing:-.055em}.attendancePrintTable{width:100%;border-collapse:collapse;border-spacing:0;table-layout:fixed;color:#111}.attendancePrintTable th,.attendancePrintTable td{border:0.5px solid #777777;height:23px;padding:.5px 1.5px;text-align:center;vertical-align:middle;overflow:hidden;white-space:nowrap;text-overflow:clip}.attendancePrintTable th{background:#2f6f9f!important;background-color:#2f6f9f!important;color:#fff!important;font-size:8.4px;font-weight:760;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}.attendancePrintTable tbody td{font-size:10.6px;font-weight:560}.attendancePrintTable tbody td.nameCol,.attendancePrintTable tbody td.schoolGradeCol,.attendancePrintTable tbody td.personalityCol{line-height:1.05}.attendancePrintTable tbody td.nameCol{font-size:12px;font-weight:700}.attendancePrintTable tbody td.schoolGradeCol{font-size:11.6px;font-weight:600}.attendancePrintTable tbody td.personalityCol{font-size:11.4px;font-weight:600}.attendancePrintTable .noCol{width:20px;padding-left:0!important;padding-right:0!important}.attendancePrintTable .divisionCol{width:25px}.attendancePrintTable .nameCol{width:43px;padding-left:0!important;padding-right:0!important;text-align:center;font-weight:780}.attendancePrintTable .schoolGradeCol{width:52px;padding-left:0!important;padding-right:0!important;text-align:center;font-weight:660}.attendancePrintTable .personalityCol{width:20px;padding-left:0!important;padding-right:0!important}.attendancePrintTable .dateCol,.attendancePrintTable col.dateCol{width:var(--attendance-date-col-width,14px);padding-left:0!important;padding-right:0!important}.attendancePrintTable th.daySat,.attendancePrintTable td.daySat{background:#fff7c8!important;background-color:#fff7c8!important;color:#111!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}.attendancePrintTable th.daySun,.attendancePrintTable td.daySun{background:#ffd9df!important;background-color:#ffd9df!important;color:#111!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}body{padding:0}}'
    + '</style>'
    + '</head><body>' + html + '<script>(function(){function fitTextCells(){var cells=document.querySelectorAll(".attendancePrintTable tbody td.nameCol,.attendancePrintTable tbody td.schoolGradeCol,.attendancePrintTable tbody td.personalityCol");cells.forEach(function(cell){if(!cell||!String(cell.textContent||"").trim())return;cell.style.whiteSpace="nowrap";cell.style.overflow="hidden";cell.style.textOverflow="clip";cell.style.fontSize="";var availableWidth=Math.max(0,cell.clientWidth-1);if(availableWidth<=4)return;if(cell.scrollWidth<=availableWidth+1)return;var cs=window.getComputedStyle(cell);var size=parseFloat(cs.fontSize)||10;var min=10.2;var loop=0;while(cell.scrollWidth>availableWidth+1&&size>min&&loop<12){size=Math.max(min,size-0.3);cell.style.fontSize=size.toFixed(1)+"px";loop++}})};var didPrint=false;var closeTimer=null;var printStartedAt=0;function backToApp(){if(closeTimer)return;closeTimer=setTimeout(function(){try{if(window.opener&&!window.opener.closed){window.opener.focus();}}catch(e){}try{window.close();}catch(e){}},120);}window.addEventListener("afterprint",backToApp);window.addEventListener("focus",function(){if(didPrint&&Date.now()-printStartedAt>900){setTimeout(backToApp,450);}});setTimeout(function(){fitTextCells();didPrint=true;printStartedAt=Date.now();window.focus();setTimeout(function(){window.print();},80);},350);})();<\/script></body></html>';
}
function openSettingsAttendanceRegisterPrint() {
  const students = settingsGetAttendanceRosterStudents();
  if (!students.length) { alert('출력할 재원생이 없습니다.'); return; }
  const popup = window.open('', '_blank');
  if (!popup) {
    alert('팝업이 차단되어 인쇄 화면을 열 수 없습니다. 브라우저 팝업 허용 후 다시 시도해 주세요.');
    return;
  }
  popup.document.open();
  popup.document.write(settingsAttendanceBuildStandaloneHtml());
  popup.document.close();
}
window.openSettingsAttendanceRegisterPrint = openSettingsAttendanceRegisterPrint;

function settingsLoadHtml2PdfLibrary() {
  return new Promise((resolve, reject) => {
    if (window.html2pdf) { resolve(window.html2pdf); return; }
    const existing = document.querySelector('script[data-olli-html2pdf="true"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.html2pdf), { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
    script.async = true;
    script.dataset.olliHtml2pdf = 'true';
    script.onload = () => resolve(window.html2pdf);
    script.onerror = () => reject(new Error('PDF 라이브러리를 불러오지 못했습니다.'));
    document.head.appendChild(script);
  });
}

async function downloadSettingsAttendanceRegisterPdf() {
  const students = settingsGetAttendanceRosterStudents();
  if (!students.length) { alert('출력할 재원생이 없습니다.'); return; }
  const btns = Array.from(document.querySelectorAll('.settingsAttendanceActionBtn'));
  btns.forEach(btn => { btn.disabled = true; });
  const ym = settingsGetAttendanceYearMonth();
  const divisionLabel = settingsAttendanceGetDivisionLabel(settingsAttendancePrintState.division);
  const academyName = settingsAttendanceGetAcademyName().replace(/[\\/:*?"<>|]/g, '').trim() || '학원';
  const safeDivisionLabel = String(divisionLabel || '').replace(/[\\/:*?"<>|]/g, '_');
  const filename = academyName + '_' + safeDivisionLabel + '_' + ym.year + '년_' + ym.month + '월_출석부.pdf';
  const wrap = document.createElement('div');
  wrap.style.position = 'fixed';
  wrap.style.left = '-10000px';
  wrap.style.top = '0';
  wrap.style.width = '198mm';
  wrap.style.background = '#fff';
  wrap.style.padding = '0';
  wrap.style.webkitPrintColorAdjust = 'exact';
  wrap.style.printColorAdjust = 'exact';
  wrap.style.colorAdjust = 'exact';
  wrap.innerHTML = settingsBuildAttendanceRegisterHtml({ forPrint: true });
  document.body.appendChild(wrap);
  settingsAttendanceFitTextCells(wrap);
  try {
    const html2pdf = await settingsLoadHtml2PdfLibrary();
    await html2pdf().set({
      margin: [8, 6, 8, 6],
      filename,
      image: { type: 'png', quality: 1 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        letterRendering: true,
        onclone: function(doc) {
          doc.querySelectorAll('.attendancePrintSheet, .attendancePrintSheet *, .attendancePrintTable, .attendancePrintTable *').forEach(function(el) {
            el.style.webkitPrintColorAdjust = 'exact';
            el.style.printColorAdjust = 'exact';
            el.style.colorAdjust = 'exact';
          });
          doc.querySelectorAll('.attendancePrintTable th, .attendancePrintTable td').forEach(function(cell) {
            cell.style.border = '0.5px solid #777777';
            cell.style.borderColor = '#777777';
          });
        }
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'] }
    }).from(wrap).save();
  } catch (err) {
    alert('PDF 다운로드를 바로 실행하지 못해 인쇄 화면으로 열겠습니다.\n브라우저에서 PDF 저장을 선택해 주세요.');
    openSettingsAttendanceRegisterPrint();
  } finally {
    wrap.remove();
    btns.forEach(btn => { btn.disabled = false; });
  }
}
window.downloadSettingsAttendanceRegisterPdf = downloadSettingsAttendanceRegisterPdf;

const settingsDetailData = {
  storageDiagnostics:{title:'저장 진단',html:renderOlliStorageDiagnostics},
  platformAdmin:{title:'올리 관리',html:renderOlliPlatformAdminSettings,beforeOpen:loadOlliPlatformAdminAcademies},
  academySwitch:{title:'학원 관리',html:renderOlliAcademySwitchOptions,instantRender:true,beforeOpen:async function(){ if (typeof restoreOlliAccountSession === 'function') await restoreOlliAccountSession({ silent: true }); if (typeof loadOlliAcademyManagementData === 'function') await loadOlliAcademyManagementData(); }},
  ownerOtherAcademyFind:{title:'다른 학원 찾기',html:renderOlliOwnerOtherAcademyFindOptions,instantRender:true,beforeOpen:async function(){ if (typeof restoreOlliAccountSession === 'function') await restoreOlliAccountSession({ silent: true }); }},
  teacherMyAcademies:{title:'내가 속한 학원',html:renderSettingsTeacherMyAcademies,instantRender:true,beforeOpen:async function(){ if (typeof restoreOlliAccountSession === 'function') await restoreOlliAccountSession({ silent: true }); }},
  teacherAcademyFind:{title:'다른 학원 찾기',html:renderSettingsTeacherAcademyFind,instantRender:true},
  academyAccess:{title:'사용 상태',html:renderOlliAcademyAccessSettings,beforeOpen:settingsLoadAcademy},
  attendancePhotoImport:{title:'학생정보 일괄 수정',html:renderSettingsAttendancePhotoImport},
  attendancePrint:{title:'출석부 출력',html:renderSettingsAttendancePrint,instantRender:true},
  roles:{title:'권한 설정',html:function(){return '<div class="settingsDetailIntro"><div class="settingsDetailTitle">역할에 맞는 권한으로<br/>학생 기록을 안전하게 관리합니다.</div></div><div class="settingsRoleCard"><div class="settingsRoleTop"><div class="settingsRoleName">원장</div><span class="settingsStatusBadge">전체 권한</span></div><div class="settingsRoleList"><div class="settingsRoleItem">전체 학생과 모든 피드백 확인</div><div class="settingsRoleItem">백업 / 내보내기 사용 가능</div><div class="settingsRoleItem">선생님 계정과 권한 관리</div></div></div><div class="settingsRoleCard"><div class="settingsRoleTop"><div class="settingsRoleName">관리자</div><span class="settingsStatusBadge">점검 권한</span></div><div class="settingsRoleList"><div class="settingsRoleItem">학생 기록과 피드백 흐름 점검</div><div class="settingsRoleItem">선생님 기록 상태 확인</div><div class="settingsRoleItem">백업/내보내기와 운영 판단은 제한</div></div></div><div class="settingsRoleCard"><div class="settingsRoleTop"><div class="settingsRoleName">선생님</div><span class="settingsStatusBadge">기록 권한</span></div><div class="settingsRoleList"><div class="settingsRoleItem">담당 학생 기록 작성</div><div class="settingsRoleItem">피드백 작성과 성장 피드백 입력</div><div class="settingsRoleItem">권한 변경과 데이터 내보내기는 제한</div></div></div>';}},
  teachers:{title:'선생님 관리',html:renderSettingsMembers,instantRender:true,beforeOpen:settingsLoadTeacherManagementMembers},
  teacherInvite:{title:'선생님 초대',html:renderSettingsTeacherInvite,instantRender:true,beforeOpen:settingsLoadAllApprovalRequests},
  approval:{title:'승인 요청',html:renderSettingsApprovalRequests, beforeOpen:settingsLoadAllApprovalRequests},
  backup:{title:'백업 / 내보내기',html:function(){return '<div class="settingsDetailIntro"><div class="settingsDetailTitle">백업과 내보내기는<br/>원장만 사용할 수 있습니다.</div></div><div class="settingsCard"><div class="settingsRow"><div class="settingsRowLeft"><span class="settingsRowTitle">전체 학생 데이터</span></div><span class="settingsBadge">JSON</span></div><div class="settingsRow"><div class="settingsRowLeft"><span class="settingsRowTitle">피드백 기록</span></div><span class="settingsBadge">JSON</span></div></div><button class="settingsExportBtn" onclick="downloadSettingsBackup()" type="button">전체 데이터 내보내기</button>';}},
  privacy:{title:'개인정보 처리방침',html:function(){return '<div class="settingsDetailIntro"><div class="settingsDetailTitle">학생 기록은<br/>안전하게 관리되어야 합니다.</div></div><div class="settingsInfoCard"><div class="settingsInfoHead">수집되는 정보</div><div class="settingsInfoList"><div class="settingsInfoItem">학생 이름, 등록일, 반 정보</div><div class="settingsInfoItem">수업 기록과 피드백 내용</div><div class="settingsInfoItem">선생님 계정 및 작성 기록</div></div></div><div class="settingsInfoCard"><div class="settingsInfoHead">AI 사용 안내</div><div class="settingsInfoList"><div class="settingsInfoItem">AI 생성 문구는 자동 발송되지 않습니다.</div><div class="settingsInfoItem">선생님 또는 원장의 검토 후 사용해야 합니다.</div></div></div>';}}
};

let settingsCurrentDetailType = '';

