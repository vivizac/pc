function getStudentBulkImportPlaceholder() {
  if (studentBulkImportState.division === 'kinder') {
    return '예시\n김민준\n이서윤, 6세, 월·수, 박T\n박하윤 / 유치부 / 하늘유치원 / 5세 / 화목 / 이T / 2026-03-02';
  }
  return '예시\n김민준\n이서윤, 초2, 월·수, A그룹, 박T\n박하윤 / 초등부 / 햇살초 / 3학년 / 2반 / 화목 / B / 이T / 2026-03-02';
}

function setStudentBulkImportDivision(division) {
  studentBulkImportState.division = normalizeAttendancePhotoDivision(division || 'elementary');
  studentBulkImportState.candidates = [];
  studentBulkImportState.errorMessage = '';
  refreshSettingsAttendancePhotoImportDetail();
}

function updateStudentBulkImportText(value) {
  studentBulkImportState.rawText = String(value || '');
}

function clearStudentBulkImportText() {
  studentBulkImportState.rawText = '';
  studentBulkImportState.candidates = [];
  studentBulkImportState.errorMessage = '';
  refreshSettingsAttendancePhotoImportDetail();
}

function normalizeStudentBulkImportToken(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function splitStudentBulkImportLine(line) {
  const raw = String(line || '').trim();
  if (!raw) return [];
  const hasStrongDelimiter = /[\t,\/|]/.test(raw);
  const tokens = hasStrongDelimiter
    ? raw.split(/[\t,\/|]+/)
    : raw.split(/\s+/);
  return tokens.map(normalizeStudentBulkImportToken).filter(Boolean);
}

function getStudentBulkImportDivisionFromTokens(tokens, fallbackDivision) {
  const joined = tokens.join(' ');
  if (/유치|유아|kinder/i.test(joined)) return 'kinder';
  if (/(^|\s)(5|6|7)\s*세/.test(joined) || /유치원/.test(joined)) return 'kinder';
  if (/초등|초\s*[1-6]|[1-6]\s*학년|초등학교|초교|elementary/i.test(joined)) return 'elementary';
  return normalizeAttendancePhotoDivision(fallbackDivision || 'elementary');
}

function findStudentBulkImportDate(tokens) {
  for (const token of tokens) {
    const text = String(token || '').trim();
    const match = text.match(/(20\d{2}|19\d{2})[.\-/년\s]*(\d{1,2})[.\-/월\s]*(\d{1,2})/);
    if (match) {
      const parsed = normalizeStudentDateInputValue(`${match[1]}-${match[2]}-${match[3]}`);
      if (parsed) return parsed;
    }
  }
  return null;
}

function getStudentBulkImportName(tokens) {
  const skipPattern = /(초등|유치|유아|학년|반|세|그룹|group|월|화|수|목|금|토|일|요일|담임|선생|T$|t$|20\d{2}|19\d{2}|학교|유치원)/;
  const first = tokens.find(token => token && !skipPattern.test(token));
  return String(first || tokens[0] || '').replace(/[:：]/g, '').trim();
}

function parseStudentBulkImportLine(line, index) {
  const tokens = splitStudentBulkImportLine(line);
  if (!tokens.length) return null;
  const division = getStudentBulkImportDivisionFromTokens(tokens, studentBulkImportState.division);
  const name = getStudentBulkImportName(tokens);
  const enrolled = findStudentBulkImportDate(tokens);
  const candidate = normalizeAttendancePhotoImportCandidate({
    id: `bulk_candidate_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
    selected: !!name,
    name,
    division,
    confidence: name ? 1 : 0,
    note: ''
  }, index);

  tokens.forEach(token => {
    const text = String(token || '').trim();
    if (!text || text === name) return;
    const dateParsed = findStudentBulkImportDate([text]);
    if (dateParsed) {
      candidate.year = dateParsed.year;
      candidate.month = dateParsed.month;
      candidate.day = dateParsed.day;
      candidate.enrolled_at = dateParsed.enrolled_at;
      return;
    }
    const timeText = normalizeLessonTimeDisplay(text);
    if (timeText && /(?:[1-7]\s*(?:시|:00)|오후\s*[1-7])/.test(text)) {
      candidate.class_time = [candidate.class_time, timeText].filter(Boolean).join('·').replace(/·+/g, '·').replace(/^·|·$/g, '');
    }
    const daySource = text.replace(/(?:오후\s*)?[1-7]\s*(?:시|:00)?/g, '');
    const dayText = normalizeAttendancePhotoLessonDay(daySource || text);
    if (/[월화수목금토일]/.test(dayText) && !/월\s*\d|\d\s*월/.test(daySource)) {
      candidate.lesson_day = [candidate.lesson_day, dayText].filter(Boolean).join('·').replace(/·+/g, '·').replace(/^·|·$/g, '');
      return;
    }
    if (timeText && /(?:[1-7]\s*(?:시|:00)|오후\s*[1-7])/.test(text)) return;
    const teacherMatch = text.match(/^(.+?)(?:선생님|선생|담임|T|t)$/);
    if (teacherMatch && teacherMatch[1]) {
      candidate.teacher = teacherMatch[1].trim();
      return;
    }
    if (/^[가-힣]{1,4}T$/i.test(text)) {
      candidate.teacher = text.replace(/T$/i, '').trim();
      return;
    }
    const ageMatch = text.match(/([5-7])\s*세/);
    if (ageMatch) {
      candidate.age = ageMatch[1];
      candidate.division = 'kinder';
      return;
    }
    const gradeMatch = text.match(/(?:초\s*)?([1-6])\s*학년|초\s*([1-6])/);
    if (gradeMatch) {
      candidate.grade = gradeMatch[1] || gradeMatch[2] || '';
      candidate.division = 'elementary';
      return;
    }
    const classMatch = text.match(/([1-9]|1\d|20)\s*반/);
    if (classMatch && !/[A-Fa-f]/.test(text)) {
      candidate.className = classMatch[1];
      return;
    }
    const group = normalizeAttendancePhotoGroup(text);
    if (group) {
      candidate.group = group;
      candidate.division = 'elementary';
      return;
    }
    if (/유치원/.test(text)) {
      candidate.kindergarten = text.replace(/유치원명|유치원[:：]?/g, '').trim();
      candidate.division = 'kinder';
      return;
    }
    if (/학교|초등학교|초교/.test(text)) {
      candidate.school = text.replace(/학교명|학교[:：]?/g, '').trim();
      candidate.division = 'elementary';
    }
  });

  if (!candidate.name) {
    candidate.note = '이름 확인 필요';
    candidate.selected = false;
  }
  return candidate;
}

function parseStudentBulkImportText() {
  const rows = String(studentBulkImportState.rawText || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  if (!rows.length) {
    studentBulkImportState.candidates = [];
    studentBulkImportState.errorMessage = '등록할 학생 이름을 한 줄에 한 명씩 입력해 주세요.';
    refreshSettingsAttendancePhotoImportDetail();
    return;
  }
  const candidates = rows
    .map((line, index) => parseStudentBulkImportLine(line, index))
    .filter(Boolean);
  studentBulkImportState.candidates = mergeAttendancePhotoImportCandidates(candidates);
  studentBulkImportState.errorMessage = studentBulkImportState.candidates.length ? '' : '등록할 학생 정보를 찾지 못했어요.';
  refreshSettingsAttendancePhotoImportDetail();
}

function renderStudentBulkCandidateField(index, field, label, value, options = {}) {
  const safeValue = settingsEscapeAttr(value || '');
  const full = options.full ? ' full' : '';
  if (options.type === 'select') {
    const selectedElementary = normalizeAttendancePhotoDivision(value) === 'elementary' ? ' selected' : '';
    const selectedKinder = normalizeAttendancePhotoDivision(value) === 'kinder' ? ' selected' : '';
    return '<div class="studentBulkCandidateField' + full + '"><div class="studentBulkCandidateLabel">' + label + '</div>'
      + '<select class="studentBulkCandidateSelect" onchange="updateStudentBulkCandidateField(' + index + ',\'' + field + '\',this.value)">'
      + '<option value="elementary"' + selectedElementary + '>초등부</option>'
      + '<option value="kinder"' + selectedKinder + '>유치부</option>'
      + '</select></div>';
  }
  return '<div class="studentBulkCandidateField' + full + '"><div class="studentBulkCandidateLabel">' + label + '</div>'
    + '<input class="studentBulkCandidateInput" value="' + safeValue + '" oninput="updateStudentBulkCandidateField(' + index + ',\'' + field + '\',this.value)" placeholder="' + settingsEscapeAttr(options.placeholder || '') + '">'
    + '</div>';
}

function renderStudentBulkCandidateCard(candidate, index) {
  const dup = getAttendancePhotoDuplicateInfo(candidate);
  const badgeClass = dup.type ? ' ' + dup.type : '';
  const division = normalizeAttendancePhotoDivision(candidate.division);
  const isKinder = division === 'kinder';
  const metaFields = isKinder
    ? renderStudentBulkCandidateField(index, 'kindergarten', '유치원', candidate.kindergarten)
      + renderStudentBulkCandidateField(index, 'age', '나이', candidate.age)
    : renderStudentBulkCandidateField(index, 'school', '학교', candidate.school)
      + renderStudentBulkCandidateField(index, 'grade', '학년', candidate.grade)
      + renderStudentBulkCandidateField(index, 'className', '반', candidate.className)
      + renderStudentBulkCandidateField(index, 'group', '그룹', candidate.group);
  return '<div class="studentBulkCandidateCard">'
    + '<div class="studentBulkCandidateTop">'
    + '<label class="studentBulkCandidateCheck"><input type="checkbox" ' + (candidate.selected ? 'checked' : '') + ' onchange="toggleStudentBulkCandidate(' + index + ',this.checked)">등록 선택</label>'
    + '<span class="studentBulkCandidateTopRight"><span class="attendancePhotoCandidateBadge' + badgeClass + '">' + settingsEscapeHtml(dup.label) + '</span><button class="studentBulkCandidateDeleteBtn danger" type="button" onclick="removeStudentBulkCandidate(' + index + ')">삭제</button></span>'
    + '</div>'
    + '<div class="studentBulkCandidateGrid">'
    + renderStudentBulkCandidateField(index, 'name', '이름', candidate.name)
    + renderStudentBulkCandidateField(index, 'division', '구분', candidate.division, { type: 'select' })
    + metaFields
    + renderStudentBulkCandidateField(index, 'lesson_day', '요일', candidate.lesson_day)
    + renderStudentBulkCandidateField(index, 'class_time', '시간', candidate.class_time)
    + renderStudentBulkCandidateField(index, 'teacher', '담임', candidate.teacher)
    + renderStudentBulkCandidateField(index, 'enrolled_at', '등록일', candidate.enrolled_at)
    + '</div>'
    + '</div>';
}

function renderStudentBulkImportResults() {
  const list = studentBulkImportState.candidates || [];
  const error = studentBulkImportState.errorMessage
    ? '<div class="attendancePhotoStatusBox error">' + settingsEscapeHtml(studentBulkImportState.errorMessage) + '</div>'
    : '';
  if (!list.length) return error;
  const selectedCount = list.filter(item => item.selected && String(item.name || '').trim()).length;
  return error
    + '<div class="settingsInfoCard"><div class="settingsInfoHead">수정 후보 확인</div>'
    + '<div class="attendancePhotoResultSummary"><span class="attendancePhotoResultCount">후보 ' + list.length + '명 · 반영 선택 ' + selectedCount + '명</span><span class="studentBulkCandidateTopRight"><button class="settingsActionBtn" type="button" onclick="setAllStudentBulkCandidatesChecked(true)">전체 선택</button><button class="settingsActionBtn" type="button" onclick="removeSelectedStudentBulkCandidates()">선택 삭제</button><button class="settingsActionBtn" type="button" onclick="clearStudentBulkCandidates()">전체 삭제</button></span></div>'
    + '<div class="studentBulkCandidateList">' + list.map(renderStudentBulkCandidateCard).join('') + '</div>'
    + '<div class="attendancePhotoActionGrid single"><button class="settingsActionBtn primary" type="button" onclick="importStudentBulkCandidates()"' + (studentBulkImportState.importRunning ? ' disabled' : '') + '>' + (studentBulkImportState.importRunning ? '반영 중...' : '선택한 학생정보 반영') + '</button></div>'
    + '</div>';
}

function renderSettingsStudentBulkImport() {
  const division = normalizeAttendancePhotoDivision(studentBulkImportState.division || 'elementary');
  const elementaryActive = division === 'elementary' ? ' active' : '';
  const kinderActive = division === 'kinder' ? ' active' : '';
  return '<div class="settingsInfoCard studentBulkImportPanel">'
    + '<div class="settingsInfoHead">요일·시간 일괄 수정</div>'
    + '<div class="studentBulkImportModeRow">'
    + '<button class="studentBulkImportModeBtn' + elementaryActive + '" type="button" onclick="setStudentBulkImportDivision(\'elementary\')">초등부 기준</button>'
    + '<button class="studentBulkImportModeBtn' + kinderActive + '" type="button" onclick="setStudentBulkImportDivision(\'kinder\')">유치부 기준</button>'
    + '</div>'
    + '<textarea id="studentBulkImportText" class="studentBulkImportTextarea" oninput="updateStudentBulkImportText(this.value)" placeholder="' + settingsEscapeAttr(getStudentBulkImportPlaceholder()) + '">' + settingsEscapeHtml(studentBulkImportState.rawText || '') + '</textarea>'
    + '<div class="studentBulkImportGuide">독스(docx), txt, csv 파일을 올리면 이름·요일·시간을 읽어 수정 후보를 만듭니다. 기존 학생은 학생정보를 수정하고, 없는 학생은 신규 후보로 표시합니다.</div>'
    + '<div class="attendancePhotoActionGrid"><button class="settingsActionBtn" type="button" onclick="openStudentBulkImportFilePicker()">독스 파일 업로드</button><button class="settingsActionBtn primary" type="button" onclick="parseStudentBulkImportText()">수정 후보 만들기</button><button class="settingsActionBtn" type="button" onclick="clearStudentBulkImportText()">입력 지우기</button></div>'
    + '</div>'
    + renderStudentBulkImportResults();
}

function updateStudentBulkCandidateField(index, field, value) {
  const item = studentBulkImportState.candidates[index];
  if (!item) return;
  if (field === 'division') item[field] = normalizeAttendancePhotoDivision(value);
  else if (field === 'lesson_day') item[field] = normalizeAttendancePhotoLessonDay(value);
  else if (field === 'group') item[field] = normalizeAttendancePhotoGroup(value);
  else item[field] = String(value || '').trim();
  if (field === 'enrolled_at') {
    const parsed = normalizeStudentDateInputValue(value);
    if (parsed) {
      item.year = parsed.year;
      item.month = parsed.month;
      item.day = parsed.day;
      item.enrolled_at = parsed.enrolled_at;
    } else {
      item.enrolled_at = String(value || '').trim();
    }
  }
}

function toggleStudentBulkCandidate(index, checked) {
  const item = studentBulkImportState.candidates[index];
  if (!item) return;
  item.selected = !!checked;
}

function removeStudentBulkCandidate(index) {
  if (!Array.isArray(studentBulkImportState.candidates)) return;
  const safeIndex = Number(index);
  if (!Number.isFinite(safeIndex) || safeIndex < 0 || safeIndex >= studentBulkImportState.candidates.length) return;
  studentBulkImportState.candidates.splice(safeIndex, 1);
  refreshSettingsAttendancePhotoImportDetail();
}

function removeSelectedStudentBulkCandidates() {
  const before = Array.isArray(studentBulkImportState.candidates) ? studentBulkImportState.candidates.length : 0;
  if (!before) return;
  const next = studentBulkImportState.candidates.filter(item => !item.selected);
  if (next.length === before) {
    if (typeof showPushToast === 'function') showPushToast('삭제할 등록 후보를 선택해 주세요.');
    else alert('삭제할 등록 후보를 선택해 주세요.');
    return;
  }
  studentBulkImportState.candidates = next;
  refreshSettingsAttendancePhotoImportDetail();
}

function clearStudentBulkCandidates() {
  if (!Array.isArray(studentBulkImportState.candidates) || !studentBulkImportState.candidates.length) {
    if (typeof showPushToast === 'function') showPushToast('삭제할 등록 후보가 없습니다.');
    else alert('삭제할 등록 후보가 없습니다.');
    return;
  }
  const ok = confirm('등록 후보를 모두 삭제할까요?');
  if (!ok) return;
  studentBulkImportState.candidates = [];
  studentBulkImportState.errorMessage = '';
  refreshSettingsAttendancePhotoImportDetail();
}

function setAllStudentBulkCandidatesChecked(checked) {
  studentBulkImportState.candidates.forEach(item => { item.selected = !!checked; });
  refreshSettingsAttendancePhotoImportDetail();
}


function ensureStudentBulkApplyOverlay() {
  let overlay = document.getElementById('studentBulkApplyOverlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'studentBulkApplyOverlay';
  overlay.className = 'studentBulkApplyOverlay';
  overlay.setAttribute('aria-live', 'polite');
  overlay.innerHTML = '<div class="studentBulkApplyCard" role="status" aria-label="학생정보 반영 중">'
    + '<div class="studentBulkApplyIcon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"></path></svg></div>'
    + '<div id="studentBulkApplyTitle" class="studentBulkApplyTitle">학생정보 반영 중<span class="studentBulkApplyDots"><span></span><span></span><span></span></span></div>'
    + '<div id="studentBulkApplyText" class="studentBulkApplyText">선택한 학생정보를 저장하고 있어요.</div>'
    + '</div>';
  document.body.appendChild(overlay);
  return overlay;
}

function showStudentBulkApplyOverlay(text = '') {
  const overlay = ensureStudentBulkApplyOverlay();
  const messageEl = document.getElementById('studentBulkApplyText');
  if (messageEl && text) messageEl.textContent = text;
  overlay.classList.add('show');
}

function hideStudentBulkApplyOverlay() {
  const overlay = document.getElementById('studentBulkApplyOverlay');
  if (overlay) overlay.classList.remove('show');
}

function waitStudentBulkApplyPaint() {
  return new Promise(resolve => {
    const raf = window.requestAnimationFrame || function(cb) { return setTimeout(cb, 16); };
    raf(() => raf(resolve));
  });
}

async function importStudentBulkCandidates() {
  if (studentBulkImportState.importRunning) return;
  const selected = studentBulkImportState.candidates.filter(item => item.selected && String(item.name || '').trim());
  if (!selected.length) {
    if (typeof showPushToast === 'function') showPushToast('등록할 학생을 선택해 주세요.');
    else alert('등록할 학생을 선택해 주세요.');
    return;
  }
  studentBulkImportState.importRunning = true;
  showStudentBulkApplyOverlay(`선택한 학생정보 ${selected.length}명을 반영하고 있어요.`);
  refreshSettingsAttendancePhotoImportDetail();
  await waitStudentBulkApplyPaint();
  try {
    let savedCount = 0;
    let updatedCount = 0;
    let processedCount = 0;
    for (const candidate of selected) {
      processedCount += 1;
      showStudentBulkApplyOverlay(`학생정보 반영 중 ${processedCount} / ${selected.length}`);
      const student = buildStudentFromAttendancePhotoCandidate(candidate);
      if (!student.name) continue;
      const existing = getAllStudents().find(item => getStudentStatus(item) === 'active'
        && String(item.name || '').trim() === String(student.name || '').trim()
        && normalizeAttendancePhotoDivision(item.type) === normalizeAttendancePhotoDivision(student.type));
      if (existing) {
        const next = {
          ...existing,
          lesson_day: student.lesson_day || existing.lesson_day || '',
          lesson_time: student.lesson_time || student.class_time || existing.lesson_time || existing.class_time || '',
          class_time: student.class_time || student.lesson_time || existing.class_time || existing.lesson_time || '',
          teacher: student.teacher || existing.teacher || '',
          homeroom_teacher: student.homeroom_teacher || existing.homeroom_teacher || student.teacher || existing.teacher || '',
          school: student.school || existing.school || '',
          grade: student.grade || existing.grade || '',
          className: student.className || existing.className || '',
          kindergarten: student.kindergarten || existing.kindergarten || '',
          age: student.age || existing.age || ''
        };
        await ensureStudentSavedToSupabase(next);
        updatedCount += 1;
      } else {
        await ensureStudentSavedToSupabase(student);
        savedCount += 1;
      }
    }
    try { await loadStudentsFromSupabase(); } catch(e) {}
    try {
      const searchValue = document.getElementById('searchName')?.value?.trim() || '';
      if (typeof loadRecords === 'function') await loadRecords(searchValue);
    } catch(e) {}
    try { if (typeof refreshMemoStudentSelectPopupIfOpen === 'function') refreshMemoStudentSelectPopupIfOpen(); } catch(e) {}
    try { if (typeof refreshKinderChatFeedbackStudentManagePopupIfOpen === 'function') refreshKinderChatFeedbackStudentManagePopupIfOpen(); } catch(e) {}
    studentBulkImportState.candidates = studentBulkImportState.candidates.filter(item => !selected.includes(item));
    studentBulkImportState.errorMessage = '';
    if (typeof showPushToast === 'function') showPushToast(`신규 ${savedCount}명 · 수정 ${updatedCount}명 처리했어요.`);
    else alert(`신규 ${savedCount}명 · 수정 ${updatedCount}명 처리했어요.`);
  } catch (err) {
    studentBulkImportState.errorMessage = String(err && (err.message || err) || '학생 등록에 실패했어요.');
  } finally {
    studentBulkImportState.importRunning = false;
    refreshSettingsAttendancePhotoImportDetail();
    hideStudentBulkApplyOverlay();
  }
}


