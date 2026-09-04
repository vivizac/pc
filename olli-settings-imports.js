function getStudentManagementActiveTab() {
  return ['bulk', 'feedback', 'photo'].includes(studentManagementActiveTab) ? studentManagementActiveTab : 'bulk';
}
function setStudentManagementTab(tab) {
  studentManagementActiveTab = ['bulk', 'feedback', 'photo'].includes(tab) ? tab : 'bulk';
  refreshSettingsAttendancePhotoImportDetail();
}
function renderStudentManagementTabs() {
  const active = getStudentManagementActiveTab();
  const tab = (key, label) => '<button type="button" class="studentManagementTabBtn' + (active === key ? ' active' : '') + '" onclick="setStudentManagementTab(\'' + key + '\')">' + label + '</button>';
  return '<div class="studentManagementTabRow">'
    + tab('bulk', '요일·시간 업로드')
    + tab('feedback', '기존 피드백')
    + tab('photo', '출석부 사진')
    + '</div>';
}

function getAttendancePhotoImportTodayValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function getAttendancePhotoImportTodayParts() {
  const value = getAttendancePhotoImportTodayValue();
  const [year, month, day] = value.split('-');
  return { year: Number(year), month, day, enrolled_at: value };
}

function normalizeAttendancePhotoDivision(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (/유치|kinder|kindergarten|5세|6세|7세/.test(raw)) return 'kinder';
  return 'elementary';
}

function getAttendancePhotoDivisionLabel(value) {
  return normalizeAttendancePhotoDivision(value) === 'kinder' ? '유치부' : '초등부';
}

function normalizeAttendancePhotoGroup(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const upper = raw.toUpperCase().replace(/그룹|GROUP|반/g, '').replace(/\s+/g, '').trim();
  const match = upper.match(/^[A-F]$/);
  return match ? match[0] : '';
}

function getAttendancePhotoGroupInternalValue(value) {
  const group = normalizeAttendancePhotoGroup(value);
  const map = { A: '1', B: '2', C: '3', D: '4', E: '5', F: '6' };
  return map[group] || '';
}

function normalizeAttendancePhotoLessonDay(value) {
  return String(value || '')
    .replace(/[\[\](){}]/g, ' ')
    .replace(/요일/g, '')
    .replace(/,/g, '·')
    .replace(/\//g, '·')
    .replace(/\s+/g, '')
    .replace(/([월화수목금토일])(?=[월화수목금토일])/g, '$1·')
    .replace(/·+/g, '·')
    .replace(/^·|·$/g, '');
}

function normalizeAttendancePhotoImportCandidate(item = {}, index = 0) {
  const division = normalizeAttendancePhotoDivision(item.division || item.type || item.section || item.category || 'elementary');
  const enrolled = normalizeStudentDateInputValue(item.enrolled_at || item.registration_date || item.registered_at || '');
  const name = String(item.name || item.student_name || '').trim();
  const confidence = Number(item.confidence || item.score || 0);
  return {
    id: item.id || `photo_candidate_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
    selected: item.selected !== false,
    name,
    division,
    school: String(item.school || item.school_name || '').trim(),
    kindergarten: String(item.kindergarten || item.kindergarten_name || '').trim(),
    grade: String(item.grade || item.school_grade || '').replace(/학년|초/g, '').trim(),
    className: String(item.className || item.class_no || item.class || '').replace(/반/g, '').trim(),
    age: String(item.age || '').replace(/세/g, '').trim(),
    lesson_day: normalizeAttendancePhotoLessonDay(item.lesson_day || item.lessonDay || item.days || item.weekdays || ''),
    class_time: normalizeLessonTimeDisplay(item.class_time || item.time || item.lesson_time || item.lessonTime || ''),
    group: normalizeAttendancePhotoGroup(item.group || item.group_no || item.groupName || ''),
    teacher: String(item.teacher || item.teacher_name || item.homeroom_teacher || '').trim(),
    enrolled_at: enrolled ? enrolled.enrolled_at : '',
    year: enrolled ? enrolled.year : '',
    month: enrolled ? enrolled.month : '',
    day: enrolled ? enrolled.day : '',
    note: String(item.note || item.memo || item.reason || '').trim(),
    confidence: Number.isFinite(confidence) ? confidence : 0
  };
}

function getAttendancePhotoDuplicateInfo(candidate) {
  const name = String(candidate?.name || '').trim();
  if (!name) return { type: 'warn', label: '이름 확인 필요' };
  const division = normalizeAttendancePhotoDivision(candidate?.division);
  const found = getAllStudents().find(student => {
    if (getStudentStatus(student) !== 'active') return false;
    return String(student.name || '').trim() === name && normalizeAttendancePhotoDivision(student.type) === division;
  });
  if (found) return { type: 'dup', label: '기존 학생 수정' };
  if (candidate.confidence && candidate.confidence < 0.72) return { type: 'warn', label: '확인 필요' };
  return { type: '', label: '등록 가능' };
}

function buildAttendancePhotoImportPrompt() {
  return `종이 출석부 사진을 보고 원생 등록 후보를 추출해 주세요.\n\n반드시 JSON만 응답하세요. 설명 문장은 쓰지 마세요.\n\n응답 형식:\n{\n  "students": [\n    {\n      "name": "학생 이름",\n      "division": "elementary 또는 kinder",\n      "school": "초등학생 학교명. 없으면 빈 문자열",\n      "grade": "초등 학년 숫자. 없으면 빈 문자열",\n      "class_no": "초등 반 숫자. 없으면 빈 문자열",\n      "kindergarten": "유치부 유치원명. 없으면 빈 문자열",\n      "age": "유치부 나이 숫자. 없으면 빈 문자열",\n      "lesson_day": "수업 요일. 예: 월·수",\n      "class_time": "수업 시간. 예: 4시",\n      "group": "초등 그룹. A, B, C, D, E, F 중 하나. 사진에 없으면 빈 문자열",\n      "teacher": "담임/담당 선생님. 없으면 빈 문자열",\n      "enrolled_at": "등록일 YYYY-MM-DD. 사진에 등록일 정보가 없으면 반드시 빈 문자열",\n      "confidence": 0.0,\n      "note": "확인이 필요한 내용"\n    }\n  ]\n}\n\n분석 규칙:\n- 학원마다 출석부 양식이 다를 수 있으므로, 표의 열 제목과 주변 문맥을 보고 이름/학년/요일/시간/그룹을 추론합니다.\n- 초1, 초2, 1학년처럼 초등 학년이 보이면 division은 elementary입니다.\n- 5세, 6세, 7세, 유치원명이 중심이면 division은 kinder입니다.\n- 등록일은 사진에 실제 등록일 항목이 있을 때만 입력하고, 오늘 날짜나 사진 업로드 날짜를 추정해서 넣지 마세요.\n- 초등 그룹은 A~F 문자만 사용합니다. 그룹 정보가 사진에 명확히 없으면 빈 문자열로 둡니다. 숫자 1~6은 학년/반/시간일 수 있으므로 그룹으로 추정하지 마세요.\n- 확실하지 않은 칸은 빈 문자열로 두고 note에 확인 필요라고 적습니다.\n- 같은 학생이 중복으로 보이면 한 번만 넣습니다.\n- 사진에서 읽을 수 없는 정보는 절대 지어내지 마세요.`;
}

function extractJsonTextFromAttendancePhotoReply(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const firstObject = raw.indexOf('{');
  const lastObject = raw.lastIndexOf('}');
  if (firstObject >= 0 && lastObject > firstObject) return raw.slice(firstObject, lastObject + 1).trim();
  const firstArray = raw.indexOf('[');
  const lastArray = raw.lastIndexOf(']');
  if (firstArray >= 0 && lastArray > firstArray) return raw.slice(firstArray, lastArray + 1).trim();
  return raw;
}

function parseAttendancePhotoAnalysisData(data) {
  if (data && Array.isArray(data.students)) return data.students;
  if (data && data.result && Array.isArray(data.result.students)) return data.result.students;
  if (data && Array.isArray(data.result)) return data.result;
  if (data && Array.isArray(data.items)) return data.items;
  const reply = String((data && (data.reply || data.text || data.raw)) || '').trim();
  if (!reply) return [];
  const jsonText = extractJsonTextFromAttendancePhotoReply(reply);
  const parsed = JSON.parse(jsonText);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.students)) return parsed.students;
  return [];
}

function renderAttendancePhotoCandidateField(index, field, label, value, options = {}) {
  const safeValue = settingsEscapeAttr(value || '');
  const full = options.full ? ' full' : '';
  if (options.type === 'select') {
    const selectedElementary = normalizeAttendancePhotoDivision(value) === 'elementary' ? ' selected' : '';
    const selectedKinder = normalizeAttendancePhotoDivision(value) === 'kinder' ? ' selected' : '';
    return '<div class="attendancePhotoCandidateField' + full + '"><div class="attendancePhotoCandidateLabel">' + label + '</div>'
      + '<select class="attendancePhotoCandidateSelect" onchange="updateAttendancePhotoCandidateField(' + index + ',\'' + field + '\',this.value)">'
      + '<option value="elementary"' + selectedElementary + '>초등부</option>'
      + '<option value="kinder"' + selectedKinder + '>유치부</option>'
      + '</select></div>';
  }
  return '<div class="attendancePhotoCandidateField' + full + '"><div class="attendancePhotoCandidateLabel">' + label + '</div>'
    + '<input class="attendancePhotoCandidateInput" value="' + safeValue + '" oninput="updateAttendancePhotoCandidateField(' + index + ',\'' + field + '\',this.value)" placeholder="' + settingsEscapeAttr(options.placeholder || '') + '">'
    + '</div>';
}

function renderAttendancePhotoCandidateCard(candidate, index) {
  const dup = getAttendancePhotoDuplicateInfo(candidate);
  const badgeClass = dup.type ? ' ' + dup.type : '';
  const division = normalizeAttendancePhotoDivision(candidate.division);
  const isKinder = division === 'kinder';
  const metaFields = isKinder
    ? renderAttendancePhotoCandidateField(index, 'kindergarten', '유치원', candidate.kindergarten)
      + renderAttendancePhotoCandidateField(index, 'age', '나이', candidate.age)
    : renderAttendancePhotoCandidateField(index, 'school', '학교', candidate.school)
      + renderAttendancePhotoCandidateField(index, 'grade', '학년', candidate.grade)
      + renderAttendancePhotoCandidateField(index, 'className', '반', candidate.className)
      + renderAttendancePhotoCandidateField(index, 'group', '그룹', candidate.group);
  return '<div class="attendancePhotoCandidateCard">'
    + '<div class="attendancePhotoCandidateTop">'
    + '<label class="attendancePhotoCandidateCheck"><input type="checkbox" ' + (candidate.selected ? 'checked' : '') + ' onchange="toggleAttendancePhotoImportCandidate(' + index + ',this.checked)">확인 완료</label>'
    + '<span class="attendancePhotoCandidateBadge' + badgeClass + '">' + settingsEscapeHtml(dup.label) + '</span>'
    + '</div>'
    + '<div class="attendancePhotoCandidateGrid">'
    + renderAttendancePhotoCandidateField(index, 'name', '이름', candidate.name)
    + renderAttendancePhotoCandidateField(index, 'division', '구분', candidate.division, { type: 'select' })
    + metaFields
    + renderAttendancePhotoCandidateField(index, 'lesson_day', '요일', candidate.lesson_day)
    + renderAttendancePhotoCandidateField(index, 'class_time', '시간', candidate.class_time)
    + renderAttendancePhotoCandidateField(index, 'teacher', '담임', candidate.teacher)
    + renderAttendancePhotoCandidateField(index, 'enrolled_at', '등록일', candidate.enrolled_at)
    + '</div>'
    + '</div>';
}

function renderAttendancePhotoImportResults() {
  const list = attendancePhotoImportState.candidates || [];
  if (!list.length && !attendancePhotoImportState.errorMessage && !attendancePhotoImportState.rawReply) return '';
  const selectedCount = list.filter(item => item.selected && String(item.name || '').trim()).length;
  const cards = list.length
    ? '<div class="settingsInfoCard"><div class="settingsInfoHead">분석 결과 확인</div>'
      + '<div class="attendancePhotoResultSummary"><span class="attendancePhotoResultCount">후보 ' + list.length + '명 · 반영 선택 ' + selectedCount + '명</span><button class="settingsActionBtn" type="button" onclick="setAllAttendancePhotoImportCandidatesChecked(true)">전체 선택</button></div>'
      + '<div class="attendancePhotoCandidateList">' + list.map(renderAttendancePhotoCandidateCard).join('') + '</div>'
      + '<div class="attendancePhotoActionGrid single"><button class="settingsActionBtn primary" type="button" onclick="importAttendancePhotoCandidates()">선택한 학생 출석부에 등록</button></div>'
      + '</div>'
    : '';
  const error = attendancePhotoImportState.errorMessage
    ? '<div class="attendancePhotoStatusBox error">' + settingsEscapeHtml(attendancePhotoImportState.errorMessage) + '</div>'
    : '';
  const raw = (!list.length && attendancePhotoImportState.rawReply)
    ? '<div class="attendancePhotoStatusBox">AI 응답을 학생 목록으로 읽지 못했어요.\n' + settingsEscapeHtml(attendancePhotoImportState.rawReply.slice(0, 600)) + '</div>'
    : '';
  return error + raw + cards;
}

function getAttendancePhotoImportImages() {
  if (Array.isArray(attendancePhotoImportState.imageItems) && attendancePhotoImportState.imageItems.length) {
    return attendancePhotoImportState.imageItems.filter(item => item && item.dataUrl);
  }
  if (attendancePhotoImportState.imageDataUrl) {
    return [{ name: attendancePhotoImportState.imageName || '출석부 사진', dataUrl: attendancePhotoImportState.imageDataUrl }];
  }
  return [];
}

function readAttendancePhotoImportFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('사진을 읽지 못했어요.'));
    reader.readAsDataURL(file);
  });
}

function loadAttendancePhotoImportImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('사진을 불러오지 못했어요.'));
    img.src = dataUrl;
  });
}

async function compressAttendancePhotoImportFile(file) {
  const originalDataUrl = await readAttendancePhotoImportFileAsDataUrl(file);
  try {
    const img = await loadAttendancePhotoImportImage(originalDataUrl);
    const attempts = [
      { max: 1100, quality: 0.68 },
      { max: 900, quality: 0.6 },
      { max: 760, quality: 0.54 },
      { max: 640, quality: 0.48 }
    ];
    let bestDataUrl = originalDataUrl;
    for (const attempt of attempts) {
      const sourceWidth = img.naturalWidth || img.width || 1;
      const sourceHeight = img.naturalHeight || img.height || 1;
      const scale = Math.min(1, attempt.max / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) break;
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', attempt.quality);
      if (!bestDataUrl || dataUrl.length < bestDataUrl.length) bestDataUrl = dataUrl;
      if (dataUrl.length <= 650000) {
        bestDataUrl = dataUrl;
        break;
      }
    }
    return { name: file.name || '출석부 사진', dataUrl: bestDataUrl, originalSize: file.size || 0, compressedSize: bestDataUrl.length };
  } catch (err) {
    return { name: file.name || '출석부 사진', dataUrl: originalDataUrl, originalSize: file.size || 0, compressedSize: originalDataUrl.length };
  }
}


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


function formatExistingFeedbackImportFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (!size) return '';
  if (size < 1024) return size + 'B';
  if (size < 1024 * 1024) return Math.round(size / 1024) + 'KB';
  return (size / 1024 / 1024).toFixed(1) + 'MB';
}

function openExistingFeedbackImportPicker() {
  const input = document.getElementById('existingFeedbackImportInput');
  if (input) input.click();
}

function isExistingFeedbackTextReadableFile(file) {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  return type.startsWith('text/') || /\.(txt|md|csv|json)$/i.test(name);
}


function isExistingFeedbackDocxFile(file) {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  return /\.docx$/i.test(name) || type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

function readFileAsArrayBufferForExistingFeedback(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('파일을 읽지 못했습니다.'));
    reader.readAsArrayBuffer(file);
  });
}

function decodeExistingFeedbackXmlEntities(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function extractExistingFeedbackTextFromDocxXml(xmlText) {
  const xml = String(xmlText || '');
  const paragraphs = xml.match(/<w:p[\s\S]*?<\/w:p>/g) || [];
  const lines = paragraphs.map(paragraph => {
    const chunks = [];
    paragraph.replace(/<w:tab\s*\/?\s*>/g, '\t')
      .replace(/<w:br\s*\/?\s*>/g, '\n')
      .replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g, (_, value) => {
        chunks.push(decodeExistingFeedbackXmlEntities(value));
        return '';
      });
    return chunks.join('').trim();
  }).filter(Boolean);

  if (lines.length) return lines.join('\n');

  return decodeExistingFeedbackXmlEntities(
    xml
      .replace(/<w:tab\s*\/?\s*>/g, '\t')
      .replace(/<w:br\s*\/?\s*>/g, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

async function inflateExistingFeedbackZipEntry(bytes, method) {
  if (method === 0) return bytes;
  if (method !== 8) throw new Error('지원하지 않는 docx 압축 방식입니다.');
  if (typeof DecompressionStream !== 'function') {
    throw new Error('이 브라우저에서는 docx 압축 해제가 지원되지 않습니다. txt로 저장해 다시 업로드해 주세요.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

function findExistingFeedbackZipEndOfCentralDirectory(view) {
  const minOffset = Math.max(0, view.byteLength - 66000);
  for (let offset = view.byteLength - 22; offset >= minOffset; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  return -1;
}


let existingFeedbackJSZipLoadPromise = null;
function loadExistingFeedbackJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (existingFeedbackJSZipLoadPromise) return existingFeedbackJSZipLoadPromise;
  existingFeedbackJSZipLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    script.async = true;
    script.onload = () => window.JSZip ? resolve(window.JSZip) : reject(new Error('JSZip 로드에 실패했습니다.'));
    script.onerror = () => reject(new Error('JSZip 라이브러리를 불러오지 못했습니다.'));
    document.head.appendChild(script);
  });
  return existingFeedbackJSZipLoadPromise;
}

async function extractDocxTextWithJSZipForExistingFeedback(file) {
  const JSZipLib = await loadExistingFeedbackJSZip();
  const buffer = await readFileAsArrayBufferForExistingFeedback(file);
  const zip = await JSZipLib.loadAsync(buffer);
  const xmlNames = Object.keys(zip.files || {}).filter(name => {
    return /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/i.test(name);
  });
  const orderedNames = [
    'word/document.xml',
    ...xmlNames.filter(name => name !== 'word/document.xml').sort()
  ].filter((name, index, arr) => zip.files[name] && arr.indexOf(name) === index);
  if (!orderedNames.length) throw new Error('docx 안에서 본문 XML을 찾지 못했습니다.');
  const parts = [];
  for (const name of orderedNames) {
    const xml = await zip.files[name].async('text');
    const extracted = extractExistingFeedbackTextFromDocxXml(xml).trim();
    if (extracted) parts.push(extracted);
  }
  const text = parts.join('\n\n')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) throw new Error('docx에서 텍스트를 찾지 못했습니다.');
  return text;
}

async function extractDocxTextForExistingFeedback(file) {
  try {
    return await extractDocxTextWithJSZipForExistingFeedback(file);
  } catch (jsZipErr) {
    console.warn('JSZip docx 추출 실패, 기본 추출로 재시도:', jsZipErr && (jsZipErr.message || jsZipErr));
  }
  const buffer = await readFileAsArrayBufferForExistingFeedback(file);
  const view = new DataView(buffer);
  const eocdOffset = findExistingFeedbackZipEndOfCentralDirectory(view);
  if (eocdOffset < 0) throw new Error('docx 파일 구조를 읽지 못했습니다. 파일이 손상되었거나 docx 형식이 아닙니다.');

  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  let offset = centralOffset;
  const decoder = new TextDecoder('utf-8');
  const preferredNames = new Set(['word/document.xml', 'word/header1.xml', 'word/footer1.xml']);
  const entries = [];

  for (let i = 0; i < entryCount && offset + 46 <= view.byteLength; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameBytes = new Uint8Array(buffer, offset + 46, nameLength);
    const name = decoder.decode(nameBytes);
    if (preferredNames.has(name)) {
      entries.push({ name, method, compressedSize, localHeaderOffset });
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }

  const documentEntry = entries.find(entry => entry.name === 'word/document.xml') || entries[0];
  if (!documentEntry) throw new Error('docx 안에서 본문 XML을 찾지 못했습니다.');

  const localOffset = documentEntry.localHeaderOffset;
  if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('docx 본문 위치를 읽지 못했습니다.');
  const localNameLength = view.getUint16(localOffset + 26, true);
  const localExtraLength = view.getUint16(localOffset + 28, true);
  const dataStart = localOffset + 30 + localNameLength + localExtraLength;
  const compressed = new Uint8Array(buffer, dataStart, documentEntry.compressedSize);
  const inflated = await inflateExistingFeedbackZipEntry(compressed, documentEntry.method);
  const xmlText = decoder.decode(inflated);
  const text = extractExistingFeedbackTextFromDocxXml(xmlText)
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!text) throw new Error('docx에서 텍스트를 찾지 못했습니다.');
  return text;
}

function readFileAsTextForExistingFeedback(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('파일을 읽지 못했습니다.'));
    reader.readAsText(file, 'utf-8');
  });
}

function readFileAsDataUrlForExistingFeedback(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('파일을 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });
}

async function handleExistingFeedbackImportChange(event) {
  const file = event?.target?.files && event.target.files[0] ? event.target.files[0] : null;
  if (!file) return;
  existingFeedbackImportState.fileName = file.name || '기존 피드백 파일';
  existingFeedbackImportState.fileSize = file.size || 0;
  existingFeedbackImportState.fileType = file.type || '';
  existingFeedbackImportState.fileText = '';
  existingFeedbackImportState.fileDataUrl = '';
  existingFeedbackImportState.rawReply = '';
  existingFeedbackImportState.candidates = [];
  existingFeedbackImportState.errorMessage = '';
  existingFeedbackImportState.statusMessage = '파일을 준비하고 있어요.';
  refreshSettingsAttendancePhotoImportDetail();
  try {
    if (isExistingFeedbackTextReadableFile(file)) {
      existingFeedbackImportState.fileText = await readFileAsTextForExistingFeedback(file);
      existingFeedbackImportState.statusMessage = '파일을 읽었습니다. 피드백 분석하기를 누르면 AI가 학생별 기록으로 정리합니다.';
    } else if (isExistingFeedbackDocxFile(file)) {
      try {
        existingFeedbackImportState.fileText = await extractDocxTextForExistingFeedback(file);
        existingFeedbackImportState.fileDataUrl = '';
        existingFeedbackImportState.statusMessage = 'docx에서 텍스트를 추출했습니다. 피드백 분석하기를 누르면 AI가 학생별 기록으로 정리합니다.';
      } catch (docxErr) {
        existingFeedbackImportState.fileText = '';
        existingFeedbackImportState.fileDataUrl = '';
        existingFeedbackImportState.statusMessage = '';
        existingFeedbackImportState.errorMessage = 'docx 본문 텍스트를 읽지 못했습니다. 파일을 다시 선택하거나, Google Docs에서 txt로 내려받아 업로드해 주세요. (' + String(docxErr && (docxErr.message || docxErr) || 'docx 텍스트 추출 실패') + ')';
      }
    } else {
      existingFeedbackImportState.fileDataUrl = await readFileAsDataUrlForExistingFeedback(file);
      existingFeedbackImportState.statusMessage = '문서 파일을 준비했습니다. 피드백 분석하기를 누르면 API로 문서를 보내 분석합니다.';
    }
  } catch (err) {
    existingFeedbackImportState.errorMessage = String(err && (err.message || err) || '파일을 읽지 못했어요.');
    existingFeedbackImportState.statusMessage = '';
  } finally {
    refreshSettingsAttendancePhotoImportDetail();
    if (event?.target) event.target.value = '';
  }
}

function clearExistingFeedbackImportFile() {
  existingFeedbackImportState.fileName = '';
  existingFeedbackImportState.fileSize = 0;
  existingFeedbackImportState.fileType = '';
  existingFeedbackImportState.fileText = '';
  existingFeedbackImportState.fileDataUrl = '';
  existingFeedbackImportState.rawReply = '';
  existingFeedbackImportState.candidates = [];
  existingFeedbackImportState.statusMessage = '';
  existingFeedbackImportState.errorMessage = '';
  existingFeedbackImportState.analyzing = false;
  existingFeedbackImportState.importRunning = false;
  refreshSettingsAttendancePhotoImportDetail();
}

function buildExistingFeedbackImportPromptText() {
  return '기존 피드백 파일을 학생별, 날짜별, 피드백별로 분리해 주세요.\n\n'
    + '반드시 JSON만 응답하세요. 설명 문장은 쓰지 마세요.\n\n'
    + '응답 형식:\n'
    + '{\n'
    + '  "feedbacks": [\n'
    + '    {\n'
    + '      "student_name": "학생 이름",\n'
    + '      "division": "elementary 또는 kinder. 알 수 없으면 빈 문자열",\n'
    + '      "date": "YYYY-MM-DD. 날짜가 없으면 빈 문자열",\n'
    + '      "date_label": "원문에 적힌 날짜/주차 표현",\n'
    + '      "feedback_type": "general",\n'
    + '      "content": "피드백 본문",\n'
    + '      "note": "확인이 필요한 내용"\n'
    + '    }\n'
    + '  ]\n'
    + '}\n\n'
    + '규칙:\n'
    + '- 학생 이름 단위로 묶인 기존 피드백을 각각 분리합니다.\n'
    + '- 날짜가 명확하면 YYYY-MM-DD로 변환합니다. 날짜가 불명확하면 date는 빈 문자열로 두고 date_label에 원문 표현을 남깁니다.\n'
    + '- 매주 작성된 일반 피드백은 feedback_type을 general로 둡니다.\n'
    + '- 학생 이름이 불확실하거나 날짜가 불확실하면 note에 확인 필요라고 적습니다.\n'
    + '- 피드백 본문은 원문 의미를 바꾸지 말고 그대로 유지합니다.\n'
    + '- 한 학생에게 여러 개의 피드백이 있으면 feedbacks 배열에 각각 따로 넣습니다.';
}

function normalizeExistingFeedbackDivision(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (/유치|kinder|kindergarten|5세|6세|7세/.test(raw)) return 'kinder';
  if (/초등|elementary|초\s*\d|\d\s*학년|학년/.test(raw)) return 'elementary';
  return '';
}

function normalizeExistingFeedbackDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const direct = raw.match(/(20\d{2})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2})/);
  if (direct) {
    const year = Number(direct[1]);
    const month = Number(direct[2]);
    const day = Number(direct[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return raw;
}

function extractExistingFeedbackJsonText(raw) {
  let text = String(raw || '').trim();
  if (!text) return '';
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) text = fenced[1].trim();
  const firstObject = text.indexOf('{');
  const lastObject = text.lastIndexOf('}');
  if (firstObject !== -1 && lastObject !== -1 && lastObject > firstObject) {
    return text.slice(firstObject, lastObject + 1);
  }
  const firstArray = text.indexOf('[');
  const lastArray = text.lastIndexOf(']');
  if (firstArray !== -1 && lastArray !== -1 && lastArray > firstArray) {
    return text.slice(firstArray, lastArray + 1);
  }
  return text;
}

function parseExistingFeedbackImportReply(raw) {
  const jsonText = extractExistingFeedbackJsonText(raw);
  if (!jsonText) return [];
  let parsed = null;
  try { parsed = JSON.parse(jsonText); } catch (err) {
    console.warn('기존 피드백 JSON 파싱 실패:', err);
    return [];
  }
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.feedbacks)) return parsed.feedbacks;
  if (Array.isArray(parsed.items)) return parsed.items;
  if (Array.isArray(parsed.results)) return parsed.results;
  return [];
}

function getExistingFeedbackActiveStudents() {
  return getAllStudents().filter(student => getStudentStatus(student) === 'active');
}

function findExistingFeedbackMatchedStudent(candidate) {
  const name = String(candidate?.student_name || '').trim();
  if (!name) return null;
  const division = normalizeExistingFeedbackDivision(candidate?.division || '');
  let matches = getExistingFeedbackActiveStudents().filter(student => String(student.name || '').trim() === name);
  if (division) matches = matches.filter(student => normalizeAttendancePhotoDivision(student.type) === division);
  return matches.length === 1 ? matches[0] : null;
}

function getExistingFeedbackStudentOptionLabel(student) {
  const division = normalizeAttendancePhotoDivision(student?.type) === 'kinder' ? '유치부' : '초등부';
  const meta = normalizeAttendancePhotoDivision(student?.type) === 'kinder'
    ? [student?.kindergarten, student?.age ? String(student.age).replace(/세$/, '') + '세' : ''].filter(Boolean).join(' · ')
    : [student?.school, student?.grade ? String(student.grade).replace(/학년$/, '') + '학년' : '', student?.group ? String(student.group).replace(/^([1-6])$/, function(_, g) { return ['','A','B','C','D','E','F'][Number(g)] || g; }) : ''].filter(Boolean).join(' · ');
  return `${student?.name || '이름 없음'} · ${division}${meta ? ' · ' + meta : ''}`;
}

function normalizeExistingFeedbackCandidate(item = {}, index = 0) {
  const studentName = String(item.student_name || item.name || item.student || '').trim();
  const division = normalizeExistingFeedbackDivision(item.division || item.type || item.student_type || item.category || '');
  const candidate = {
    id: item.id || `existing_feedback_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
    selected: item.selected !== false,
    student_id: String(item.student_id || '').trim(),
    student_name: studentName,
    division,
    date: normalizeExistingFeedbackDate(item.date || item.feedback_date || item.created_at || ''),
    date_label: String(item.date_label || item.week_label || item.original_date || '').trim(),
    feedback_type: String(item.feedback_type || item.type_label || 'general').trim() || 'general',
    content: String(item.content || item.feedback || item.text || item.body || '').trim(),
    note: String(item.note || item.memo || item.warning || '').trim()
  };
  if (!candidate.student_id) {
    const matched = findExistingFeedbackMatchedStudent(candidate);
    if (matched?.id) {
      candidate.student_id = matched.id;
      candidate.division = normalizeAttendancePhotoDivision(matched.type);
      candidate.student_name = matched.name || candidate.student_name;
    }
  }
  return candidate;
}

function normalizeExistingFeedbackCandidates(list) {
  return (Array.isArray(list) ? list : [])
    .map((item, index) => normalizeExistingFeedbackCandidate(item, index))
    .filter(item => item.student_name || item.content);
}

const EXISTING_FEEDBACK_IMPORT_CHUNK_CHAR_LIMIT = 6500;

function splitExistingFeedbackImportText(text, limit = EXISTING_FEEDBACK_IMPORT_CHUNK_CHAR_LIMIT) {
  const source = String(text || '').replace(/\r/g, '').trim();
  if (!source) return [];
  if (source.length <= limit) return [source];

  const chunks = [];
  let cursor = 0;
  while (cursor < source.length) {
    let end = Math.min(source.length, cursor + limit);
    if (end < source.length) {
      const paragraphBreak = source.lastIndexOf('\n\n', end);
      const lineBreak = source.lastIndexOf('\n', end);
      const breakPoint = paragraphBreak > cursor + Math.floor(limit * 0.45)
        ? paragraphBreak
        : (lineBreak > cursor + Math.floor(limit * 0.45) ? lineBreak : end);
      end = breakPoint;
    }
    const chunk = source.slice(cursor, end).trim();
    if (chunk) chunks.push(chunk);
    cursor = end;
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
  }
  return chunks;
}


function normalizeExistingFeedbackStudentNameMatchText(value) {
  return String(value || '')
    .replace(/[\s\u00a0]+/g, '')
    .replace(/[\[\]\(\){}<>〈〉《》『』「」“”\"'‘’·•\-_:：|]/g, '')
    .trim();
}

function cleanExistingFeedbackPotentialHeadingLine(value) {
  return String(value || '')
    .replace(/^\s*[\-–—*•·●○◎◇◆□■▶▷▸▹①-⑳0-9.\)\]]+\s*/, '')
    .replace(/\s*(학생|원생|어린이|아동|유치부|초등부|피드백|기록|상담)\s*[:：\-–—]?\s*$/g, '')
    .replace(/^\s*(학생|원생|이름)\s*[:：]\s*/g, '')
    .trim();
}

function getExistingFeedbackStudentNameEntries() {
  const map = new Map();
  getExistingFeedbackActiveStudents().forEach(student => {
    const name = String(student?.name || '').trim();
    if (!name) return;
    const normalized = normalizeExistingFeedbackStudentNameMatchText(name);
    if (!normalized) return;
    if (!map.has(normalized)) map.set(normalized, []);
    map.get(normalized).push(student);
  });
  return Array.from(map.entries()).map(([normalized, students]) => ({
    normalized,
    name: String(students[0]?.name || '').trim(),
    students,
    student: students.length === 1 ? students[0] : null
  })).sort((a, b) => b.normalized.length - a.normalized.length);
}

function findExistingFeedbackStudentHeading(line, entries) {
  const raw = String(line || '').trim();
  if (!raw) return null;
  if (raw.length > 36) return null;
  const cleaned = cleanExistingFeedbackPotentialHeadingLine(raw);
  if (!cleaned || cleaned.length > 24) return null;
  const normalized = normalizeExistingFeedbackStudentNameMatchText(cleaned);
  if (!normalized) return null;
  return entries.find(entry => entry.normalized === normalized) || null;
}

function splitExistingFeedbackImportTextByStudent(text) {
  const source = String(text || '').replace(/\r/g, '').trim();
  if (!source) return [];
  const entries = getExistingFeedbackStudentNameEntries();
  if (!entries.length) return [];
  const lines = source.split('\n');
  const sections = [];
  let current = null;
  let introLines = [];
  lines.forEach((line) => {
    const heading = findExistingFeedbackStudentHeading(line, entries);
    if (heading) {
      if (current && current.lines.join('\n').trim()) sections.push(current);
      current = {
        id: 'student_section_' + sections.length + '_' + Math.random().toString(36).slice(2, 7),
        student_name: heading.name,
        student_id: heading.student?.id || '',
        division: heading.student ? normalizeAttendancePhotoDivision(heading.student.type) : '',
        duplicateName: heading.students.length > 1,
        headingLine: String(line || '').trim(),
        lines: []
      };
      return;
    }
    if (current) current.lines.push(line);
    else introLines.push(line);
  });
  if (current && current.lines.join('\n').trim()) sections.push(current);
  const cleaned = sections.map(section => {
    const content = section.lines.join('\n').replace(/^\s+|\s+$/g, '').replace(/\n{4,}/g, '\n\n\n');
    return { ...section, content, length: content.length };
  }).filter(section => section.content.trim().length >= 12);
  const intro = introLines.join('\n').trim();
  if (intro && cleaned.length) {
    cleaned[0].content = intro + '\n\n' + cleaned[0].content;
    cleaned[0].length = cleaned[0].content.length;
  }
  return cleaned;
}

function buildExistingFeedbackStudentSectionText(section, index = 0, total = 0) {
  const name = String(section?.student_name || '').trim();
  const divisionLabel = section?.division === 'kinder' ? '유치부' : (section?.division === 'elementary' ? '초등부' : '미확인');
  return '[학생별 원문 구간' + (total ? ' ' + index + '/' + total : '') + ']\n'
    + '학생명: ' + name + '\n'
    + '구분: ' + divisionLabel + '\n'
    + (section?.student_id ? '앱 학생ID: ' + section.student_id + '\n' : '')
    + (section?.duplicateName ? '동명이인 가능: 있음. 앱 저장 전 학생 연결을 반드시 확인해야 합니다.\n' : '')
    + '\n[원문]\n'
    + String(section?.content || '').trim();
}

function buildExistingFeedbackStudentAnalysisUnits(fullText) {
  const sections = splitExistingFeedbackImportTextByStudent(fullText);
  if (sections.length < 2) return [];
  const units = [];
  let currentSections = [];
  let currentLength = 0;
  const total = sections.length;
  const limit = EXISTING_FEEDBACK_IMPORT_CHUNK_CHAR_LIMIT;
  sections.forEach((section, index) => {
    const sectionText = buildExistingFeedbackStudentSectionText(section, index + 1, total);
    if (sectionText.length > limit) {
      if (currentSections.length) {
        units.push({
          type: 'student_batch',
          sections: currentSections,
          text: currentSections.map(item => item.text).join('\n\n---\n\n'),
          studentNames: currentSections.map(item => item.section.student_name).filter(Boolean)
        });
        currentSections = [];
        currentLength = 0;
      }
      const splitChunks = splitExistingFeedbackImportText(section.content, Math.max(3600, Math.floor(limit * 0.72)));
      splitChunks.forEach((chunk, chunkIndex) => {
        units.push({
          type: 'student_split',
          sections: [section],
          text: buildExistingFeedbackStudentSectionText({ ...section, content: chunk }, chunkIndex + 1, splitChunks.length),
          studentNames: [section.student_name].filter(Boolean),
          studentName: section.student_name,
          studentId: section.student_id || '',
          chunkPart: chunkIndex + 1,
          chunkPartTotal: splitChunks.length
        });
      });
      return;
    }
    const nextLength = currentLength + (currentSections.length ? 8 : 0) + sectionText.length;
    if (currentSections.length && nextLength > limit) {
      units.push({
        type: 'student_batch',
        sections: currentSections,
        text: currentSections.map(item => item.text).join('\n\n---\n\n'),
        studentNames: currentSections.map(item => item.section.student_name).filter(Boolean)
      });
      currentSections = [];
      currentLength = 0;
    }
    currentSections.push({ section, text: sectionText });
    currentLength += (currentLength ? 8 : 0) + sectionText.length;
  });
  if (currentSections.length) {
    units.push({
      type: 'student_batch',
      sections: currentSections,
      text: currentSections.map(item => item.text).join('\n\n---\n\n'),
      studentNames: currentSections.map(item => item.section.student_name).filter(Boolean)
    });
  }
  return units;
}

function buildExistingFeedbackFallbackAnalysisUnits(fullText) {
  return splitExistingFeedbackImportText(fullText).map((chunk, index, arr) => ({
    type: 'text_chunk',
    text: chunk,
    studentNames: [],
    chunkPart: index + 1,
    chunkPartTotal: arr.length
  }));
}

function getExistingFeedbackImportAnalysisUnits(fullText) {
  const source = String(fullText || '').trim();
  if (!source) return [];
  const studentUnits = buildExistingFeedbackStudentAnalysisUnits(source);
  if (studentUnits.length) return studentUnits;
  return buildExistingFeedbackFallbackAnalysisUnits(source);
}

async function analyzeExistingFeedbackImportUnit(unit, index, total) {
  const chunkInfo = {
    index,
    total,
    type: unit?.type || 'text_chunk',
    studentNames: Array.isArray(unit?.studentNames) ? unit.studentNames : [],
    studentName: unit?.studentName || '',
    studentId: unit?.studentId || '',
    chunkPart: unit?.chunkPart || 0,
    chunkPartTotal: unit?.chunkPartTotal || 0
  };
  const result = await requestExistingFeedbackImportPayloads(buildExistingFeedbackImportPayloads(unit?.text || '', chunkInfo));
  const parsed = parseExistingFeedbackImportReply(result.reply);
  return { reply: result.reply, candidates: normalizeExistingFeedbackCandidates(parsed) };
}

async function analyzeExistingFeedbackImportUnitWithFallback(unit, index, total) {
  try {
    return await analyzeExistingFeedbackImportUnit(unit, index, total);
  } catch (err) {
    if (Number(err?.status) !== 413) throw err;
    const text = String(unit?.text || '').trim();
    const subChunks = splitExistingFeedbackImportText(text, 3600);
    if (subChunks.length <= 1) throw err;
    const replies = [];
    const candidates = [];
    for (let i = 0; i < subChunks.length; i++) {
      existingFeedbackImportState.statusMessage = '한 학생 구간이 길어서 더 작게 나누어 분석하고 있어요. ' + (i + 1) + '/' + subChunks.length;
      refreshSettingsAttendancePhotoImportDetail();
      const subUnit = { ...unit, text: subChunks[i], type: (unit?.type || 'student_batch') + '_small', chunkPart: i + 1, chunkPartTotal: subChunks.length };
      const subResult = await analyzeExistingFeedbackImportUnit(subUnit, i + 1, subChunks.length);
      replies.push('[SUB CHUNK ' + (i + 1) + '/' + subChunks.length + ']\n' + subResult.reply);
      candidates.push(...subResult.candidates);
    }
    return { reply: replies.join('\n\n---\n\n'), candidates };
  }
}

function buildExistingFeedbackImportPayloads(textOverride = null, chunkInfo = null) {
  const prompt = buildExistingFeedbackImportPromptText();
  const fileName = existingFeedbackImportState.fileName || '';
  const fileType = existingFeedbackImportState.fileType || '';
  const hasTextOverride = textOverride !== null && textOverride !== undefined;
  const fileText = String(hasTextOverride ? textOverride : existingFeedbackImportState.fileText || '').trim();
  const fileDataUrl = hasTextOverride ? '' : String(existingFeedbackImportState.fileDataUrl || '').trim();
  const studentNames = Array.isArray(chunkInfo?.studentNames) ? chunkInfo.studentNames.filter(Boolean) : [];
  const studentHint = studentNames.length
    ? '\n\n[학생 구간 안내]\n이 요청에는 다음 학생 구간이 포함되어 있습니다: ' + studentNames.join(', ') + '\n각 피드백의 student_name은 해당 학생 이름으로 작성하세요. 다른 학생의 기록을 섞지 마세요.'
    : (chunkInfo?.studentName ? '\n\n[학생 구간 안내]\n이 요청은 ' + chunkInfo.studentName + ' 학생의 긴 구간 중 일부입니다. student_name은 반드시 ' + chunkInfo.studentName + '으로 작성하세요.' : '');
  const chunkGuide = chunkInfo && chunkInfo.total > 1
    ? '\n\n[분할 분석 안내]\n이 문서는 용량 제한 때문에 여러 조각으로 나누어 분석합니다. 현재 조각은 ' + chunkInfo.index + '/' + chunkInfo.total + '입니다. 이 조각 안에서 확인 가능한 피드백만 JSON으로 반환하세요. 같은 피드백을 반복해서 만들지 마세요.' + studentHint
    : studentHint;
  const textContent = fileText
    ? prompt + chunkGuide + '\n\n[파일명]\n' + fileName + '\n\n[기존 피드백 원문' + (chunkInfo && chunkInfo.total > 1 ? ' ' + chunkInfo.index + '/' + chunkInfo.total : '') + ']\n' + fileText
    : prompt + '\n\n[파일명]\n' + fileName + '\n\n[문서 파일 안내]\n첨부된 fileDataUrl 또는 files 배열의 문서 내용을 읽고 기존 피드백을 학생별·날짜별로 분리해 주세요.';
  const basePayload = {
    feature: 'existingFeedbackImport',
    fileName,
    fileType,
    fileSize: existingFeedbackImportState.fileSize || 0,
    chunkIndex: chunkInfo ? chunkInfo.index : null,
    chunkTotal: chunkInfo ? chunkInfo.total : null,
    messages: [{ role: 'user', content: textContent }]
  };
  if (fileDataUrl) {
    basePayload.fileDataUrl = fileDataUrl;
    basePayload.file = { name: fileName, type: fileType, dataUrl: fileDataUrl };
    basePayload.files = [{ name: fileName, type: fileType, dataUrl: fileDataUrl }];
  }
  return [
    { ...basePayload, promptType: 'existing_feedback_import' },
    { ...basePayload, promptType: 'summary' }
  ];
}

async function requestExistingFeedbackImportPayloads(payloads) {
  let result = null;
  let lastError = null;
  for (const payload of payloads) {
    try {
      result = await postExistingFeedbackImportPayload(payload);
      break;
    } catch (err) {
      lastError = err;
      if (err.status && err.status !== 400 && err.status !== 415) break;
    }
  }
  if (!result) throw lastError || new Error('기존 피드백 분석 요청에 실패했어요.');
  return result;
}

function getExistingFeedbackCandidateDedupeKey(candidate) {
  const name = String(candidate?.student_name || '').replace(/\s+/g, '');
  const date = String(candidate?.date || candidate?.date_label || '').replace(/\s+/g, '');
  const content = String(candidate?.content || '').replace(/\s+/g, '').slice(0, 120);
  return [name, date, content].join('|');
}

function dedupeExistingFeedbackCandidates(candidates) {
  const seen = new Set();
  const result = [];
  (Array.isArray(candidates) ? candidates : []).forEach(candidate => {
    const key = getExistingFeedbackCandidateDedupeKey(candidate);
    if (!key.replace(/\|/g, '')) return;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(candidate);
  });
  return result;
}

async function postExistingFeedbackImportPayload(payload) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const raw = await res.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { reply: raw, raw }; }
  if (!res.ok) {
    const error = new Error((data && (data.message || data.error || data.details)) || getApiErrorMessage?.(res.status, data) || ('분석 요청 실패 (' + res.status + ')'));
    error.status = res.status;
    error.data = data;
    throw error;
  }
  const reply = String(data?.reply || data?.content || data?.raw || raw || '').trim();
  return { data, raw, reply };
}

async function requestExistingFeedbackImportAnalysis() {
  if (existingFeedbackImportState.analyzing) return;
  if (!existingFeedbackImportState.fileName) {
    if (typeof showPushToast === 'function') showPushToast('먼저 기존 피드백 파일을 선택해 주세요.');
    else alert('먼저 기존 피드백 파일을 선택해 주세요.');
    return;
  }
  if (!String(existingFeedbackImportState.fileText || '').trim() && !String(existingFeedbackImportState.fileDataUrl || '').trim()) {
    existingFeedbackImportState.errorMessage = '분석할 파일 내용이 없습니다. 파일을 다시 선택해 주세요.';
    refreshSettingsAttendancePhotoImportDetail();
    return;
  }
  if (isExistingFeedbackDocxFile({ name: existingFeedbackImportState.fileName, type: existingFeedbackImportState.fileType }) && !String(existingFeedbackImportState.fileText || '').trim()) {
    existingFeedbackImportState.errorMessage = 'docx 본문 텍스트를 아직 읽지 못했습니다. 파일을 다시 선택하거나, Google Docs에서 txt로 내려받아 업로드해 주세요.';
    refreshSettingsAttendancePhotoImportDetail();
    return;
  }
  existingFeedbackImportState.analyzing = true;
  existingFeedbackImportState.errorMessage = '';
  existingFeedbackImportState.rawReply = '';
  existingFeedbackImportState.candidates = [];
  existingFeedbackImportState.statusMessage = '원생 이름 기준으로 문서를 나눈 뒤 AI가 학생별·날짜별로 정리하고 있어요.';
  refreshSettingsAttendancePhotoImportDetail();
  try {
    const fullText = String(existingFeedbackImportState.fileText || '').trim();
    if (fullText) {
      const units = getExistingFeedbackImportAnalysisUnits(fullText);
      const allCandidates = [];
      const rawReplies = [];
      const studentSectionCount = splitExistingFeedbackImportTextByStudent(fullText).length;
      for (let i = 0; i < units.length; i++) {
        const unit = units[i];
        const names = Array.isArray(unit.studentNames) && unit.studentNames.length ? ` (${unit.studentNames.join(', ')})` : '';
        existingFeedbackImportState.statusMessage = studentSectionCount >= 2
          ? `학생별로 나누어 분석하고 있어요. ${i + 1}/${units.length}번째${names}`
          : `파일이 커서 나누어 분석하고 있어요. ${i + 1}/${units.length}번째`;
        refreshSettingsAttendancePhotoImportDetail();
        const result = await analyzeExistingFeedbackImportUnitWithFallback(unit, i + 1, units.length);
        rawReplies.push(`[UNIT ${i + 1}/${units.length}${names}]\n` + result.reply);
        allCandidates.push(...result.candidates);
      }
      existingFeedbackImportState.rawReply = rawReplies.join('\n\n---\n\n');
      existingFeedbackImportState.candidates = dedupeExistingFeedbackCandidates(allCandidates);
    } else {
      const result = await requestExistingFeedbackImportPayloads(buildExistingFeedbackImportPayloads());
      existingFeedbackImportState.rawReply = result.reply;
      const parsed = parseExistingFeedbackImportReply(result.reply);
      existingFeedbackImportState.candidates = normalizeExistingFeedbackCandidates(parsed);
    }
    existingFeedbackImportState.statusMessage = existingFeedbackImportState.candidates.length
      ? `분석 결과 ${existingFeedbackImportState.candidates.length}개의 피드백 후보를 찾았습니다. 검수 후 저장해 주세요.`
      : '분석 결과를 받았지만 피드백 후보를 찾지 못했습니다. 원문 형식이나 서버 응답을 확인해 주세요.';
  } catch (err) {
    const status = Number(err && err.status);
    existingFeedbackImportState.errorMessage = status === 413
      ? '요청 용량이 너무 큽니다. 앱에서 파일을 더 작게 나누어 보내도록 수정했지만, 이 메시지가 계속 나오면 원본을 학생별 또는 월별로 나누어 업로드해 주세요.'
      : String(err && (err.message || err) || '기존 피드백 분석에 실패했어요.');
    existingFeedbackImportState.statusMessage = '';
  } finally {
    existingFeedbackImportState.analyzing = false;
    refreshSettingsAttendancePhotoImportDetail();
  }
}

function renderExistingFeedbackCandidateStudentSelect(candidate, index) {
  const students = getExistingFeedbackActiveStudents().slice().sort((a, b) => {
    const sameNameA = String(a.name || '').trim() === String(candidate.student_name || '').trim() ? 0 : 1;
    const sameNameB = String(b.name || '').trim() === String(candidate.student_name || '').trim() ? 0 : 1;
    if (sameNameA !== sameNameB) return sameNameA - sameNameB;
    const divA = normalizeAttendancePhotoDivision(a.type) === normalizeExistingFeedbackDivision(candidate.division) ? 0 : 1;
    const divB = normalizeAttendancePhotoDivision(b.type) === normalizeExistingFeedbackDivision(candidate.division) ? 0 : 1;
    if (divA !== divB) return divA - divB;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
  });
  const options = ['<option value="">학생 선택 필요</option>'].concat(students.map(student => {
    const selected = String(candidate.student_id || '') === String(student.id || '') ? ' selected' : '';
    return '<option value="' + settingsEscapeAttr(student.id || '') + '"' + selected + '>' + settingsEscapeHtml(getExistingFeedbackStudentOptionLabel(student)) + '</option>';
  })).join('');
  return '<div class="studentBulkCandidateField full"><div class="studentBulkCandidateLabel">앱 원생 연결</div>'
    + '<select class="existingFeedbackCandidateStudentSelect" onchange="updateExistingFeedbackCandidateField(' + index + ',\'student_id\',this.value)">' + options + '</select></div>';
}

function renderExistingFeedbackCandidateField(index, field, label, value, options = {}) {
  const safeValue = settingsEscapeAttr(value || '');
  const full = options.full ? ' full' : '';
  if (options.type === 'select') {
    const selectedElementary = normalizeExistingFeedbackDivision(value) === 'elementary' ? ' selected' : '';
    const selectedKinder = normalizeExistingFeedbackDivision(value) === 'kinder' ? ' selected' : '';
    const selectedUnknown = normalizeExistingFeedbackDivision(value) ? '' : ' selected';
    return '<div class="studentBulkCandidateField' + full + '"><div class="studentBulkCandidateLabel">' + label + '</div>'
      + '<select class="studentBulkCandidateSelect" onchange="updateExistingFeedbackCandidateField(' + index + ',\'' + field + '\',this.value)">'
      + '<option value=""' + selectedUnknown + '>미확인</option>'
      + '<option value="elementary"' + selectedElementary + '>초등부</option>'
      + '<option value="kinder"' + selectedKinder + '>유치부</option>'
      + '</select></div>';
  }
  if (options.type === 'textarea') {
    return '<div class="studentBulkCandidateField' + full + '"><div class="studentBulkCandidateLabel">' + label + '</div>'
      + '<textarea class="existingFeedbackCandidateTextArea" oninput="updateExistingFeedbackCandidateField(' + index + ',\'' + field + '\',this.value)" placeholder="' + settingsEscapeAttr(options.placeholder || '') + '">' + settingsEscapeHtml(value || '') + '</textarea></div>';
  }
  return '<div class="studentBulkCandidateField' + full + '"><div class="studentBulkCandidateLabel">' + label + '</div>'
    + '<input class="studentBulkCandidateInput" value="' + safeValue + '" oninput="updateExistingFeedbackCandidateField(' + index + ',\'' + field + '\',this.value)" placeholder="' + settingsEscapeAttr(options.placeholder || '') + '">'
    + '</div>';
}

function getExistingFeedbackCandidateStatus(candidate) {
  if (!String(candidate?.student_name || '').trim()) return { type: 'warn', label: '이름 확인' };
  if (!String(candidate?.student_id || '').trim()) return { type: 'warn', label: '학생 연결 필요' };
  if (!String(candidate?.date || '').trim()) return { type: 'warn', label: '날짜 확인' };
  if (!String(candidate?.content || '').trim()) return { type: 'warn', label: '내용 없음' };
  return { type: '', label: '저장 가능' };
}

function renderExistingFeedbackCandidateCard(candidate, index) {
  const status = getExistingFeedbackCandidateStatus(candidate);
  const badgeClass = status.type ? ' ' + status.type : '';
  return '<div class="studentBulkCandidateCard">'
    + '<div class="studentBulkCandidateTop">'
    + '<label class="studentBulkCandidateCheck"><input type="checkbox" ' + (candidate.selected ? 'checked' : '') + ' onchange="toggleExistingFeedbackCandidate(' + index + ',this.checked)">저장 선택</label>'
    + '<span class="studentBulkCandidateTopRight"><span class="attendancePhotoCandidateBadge' + badgeClass + '">' + settingsEscapeHtml(status.label) + '</span><button class="studentBulkCandidateDeleteBtn danger" type="button" onclick="removeExistingFeedbackCandidate(' + index + ')">삭제</button></span>'
    + '</div>'
    + '<div class="studentBulkCandidateGrid">'
    + renderExistingFeedbackCandidateStudentSelect(candidate, index)
    + renderExistingFeedbackCandidateField(index, 'student_name', '학생명', candidate.student_name)
    + renderExistingFeedbackCandidateField(index, 'division', '구분', candidate.division, { type: 'select' })
    + renderExistingFeedbackCandidateField(index, 'date', '날짜', candidate.date, { placeholder: 'YYYY-MM-DD' })
    + renderExistingFeedbackCandidateField(index, 'date_label', '원문 날짜', candidate.date_label)
    + renderExistingFeedbackCandidateField(index, 'content', '피드백 내용', candidate.content, { type: 'textarea', full: true })
    + renderExistingFeedbackCandidateField(index, 'note', '확인 메모', candidate.note, { full: true })
    + '</div>'
    + '</div>';
}

function renderExistingFeedbackImportResults() {
  const list = existingFeedbackImportState.candidates || [];
  if (!list.length) return '';
  const selectedCount = list.filter(item => item.selected && String(item.content || '').trim()).length;
  return '<div class="settingsInfoCard"><div class="settingsInfoHead">피드백 후보 확인</div>'
    + '<div class="attendancePhotoResultSummary"><span class="attendancePhotoResultCount">후보 ' + list.length + '개 · 저장 선택 ' + selectedCount + '개</span><span class="studentBulkCandidateTopRight"><button class="settingsActionBtn" type="button" onclick="setAllExistingFeedbackCandidatesChecked(true)">전체 선택</button><button class="settingsActionBtn" type="button" onclick="removeSelectedExistingFeedbackCandidates()">선택 삭제</button><button class="settingsActionBtn" type="button" onclick="clearExistingFeedbackCandidates()">전체 삭제</button></span></div>'
    + '<div class="studentBulkCandidateList">' + list.map(renderExistingFeedbackCandidateCard).join('') + '</div>'
    + '<div class="attendancePhotoActionGrid single"><button class="settingsActionBtn primary" type="button" onclick="importExistingFeedbackCandidates()">선택한 피드백 앱에 저장</button></div>'
    + '</div>';
}

function updateExistingFeedbackCandidateField(index, field, value) {
  const item = existingFeedbackImportState.candidates[index];
  if (!item) return;
  if (field === 'division') item[field] = normalizeExistingFeedbackDivision(value);
  else if (field === 'date') item[field] = normalizeExistingFeedbackDate(value);
  else item[field] = String(value || '').trim();
  if (field === 'student_id') {
    const student = getAllStudents().find(s => String(s.id || '') === String(value || '')) || null;
    if (student) {
      item.student_name = student.name || item.student_name;
      item.division = normalizeAttendancePhotoDivision(student.type);
    }
  } else if (field === 'student_name' || field === 'division') {
    if (!item.student_id) {
      const matched = findExistingFeedbackMatchedStudent(item);
      if (matched?.id) item.student_id = matched.id;
    }
  }
  refreshSettingsAttendancePhotoImportDetail();
}

function toggleExistingFeedbackCandidate(index, checked) {
  const item = existingFeedbackImportState.candidates[index];
  if (!item) return;
  item.selected = !!checked;
}

function setAllExistingFeedbackCandidatesChecked(checked) {
  existingFeedbackImportState.candidates.forEach(item => { item.selected = !!checked; });
  refreshSettingsAttendancePhotoImportDetail();
}

function removeExistingFeedbackCandidate(index) {
  if (!Array.isArray(existingFeedbackImportState.candidates)) return;
  const safeIndex = Number(index);
  if (!Number.isFinite(safeIndex) || safeIndex < 0 || safeIndex >= existingFeedbackImportState.candidates.length) return;
  existingFeedbackImportState.candidates.splice(safeIndex, 1);
  refreshSettingsAttendancePhotoImportDetail();
}

function removeSelectedExistingFeedbackCandidates() {
  const before = Array.isArray(existingFeedbackImportState.candidates) ? existingFeedbackImportState.candidates.length : 0;
  if (!before) return;
  const next = existingFeedbackImportState.candidates.filter(item => !item.selected);
  if (next.length === before) {
    if (typeof showPushToast === 'function') showPushToast('삭제할 피드백 후보를 선택해 주세요.');
    else alert('삭제할 피드백 후보를 선택해 주세요.');
    return;
  }
  existingFeedbackImportState.candidates = next;
  refreshSettingsAttendancePhotoImportDetail();
}

function clearExistingFeedbackCandidates() {
  if (!Array.isArray(existingFeedbackImportState.candidates) || !existingFeedbackImportState.candidates.length) {
    if (typeof showPushToast === 'function') showPushToast('삭제할 피드백 후보가 없습니다.');
    else alert('삭제할 피드백 후보가 없습니다.');
    return;
  }
  const ok = confirm('피드백 후보를 모두 삭제할까요?');
  if (!ok) return;
  existingFeedbackImportState.candidates = [];
  existingFeedbackImportState.errorMessage = '';
  refreshSettingsAttendancePhotoImportDetail();
}

function getExistingFeedbackCandidateSaveDate(candidate) {
  const raw = String(candidate?.date || '').trim();
  if (!raw) return '';
  return normalizeExistingFeedbackDate(raw);
}

function getExistingFeedbackCandidateSaveYear(candidate) {
  const date = getExistingFeedbackCandidateSaveDate(candidate);
  const match = String(date || '').match(/(20\d{2})/);
  return match ? Number(match[1]) : new Date().getFullYear();
}

async function importExistingFeedbackCandidates() {
  if (existingFeedbackImportState.importRunning) return;
  const selected = existingFeedbackImportState.candidates.filter(item => item.selected);
  if (!selected.length) {
    if (typeof showPushToast === 'function') showPushToast('저장할 피드백을 선택해 주세요.');
    else alert('저장할 피드백을 선택해 주세요.');
    return;
  }
  const invalid = selected.filter(item => {
    const status = getExistingFeedbackCandidateStatus(item);
    return status.label !== '저장 가능';
  });
  if (invalid.length) {
    existingFeedbackImportState.errorMessage = '학생 연결, 날짜, 피드백 내용이 빠진 후보가 있습니다. 검수 후 다시 저장해 주세요.';
    refreshSettingsAttendancePhotoImportDetail();
    return;
  }
  existingFeedbackImportState.importRunning = true;
  existingFeedbackImportState.errorMessage = '';
  existingFeedbackImportState.statusMessage = '기존 피드백을 앱에 저장하고 있어요.';
  refreshSettingsAttendancePhotoImportDetail();
  const savedIds = new Set();
  const errors = [];
  try {
    for (const candidate of selected) {
      try {
        const student = getAllStudents().find(item => String(item.id || '') === String(candidate.student_id || ''));
        if (!student) throw new Error(`${candidate.student_name || '학생'} 원생 연결을 찾지 못했습니다.`);
        const content = String(candidate.content || '').trim();
        const date = getExistingFeedbackCandidateSaveDate(candidate);
        const payload = addOlliAcademyToPayload({
          student_id: student.id,
          student_name: student.name || candidate.student_name,
          content,
          feedback_type: 'general',
          year: getExistingFeedbackCandidateSaveYear(candidate),
          date
        }, '기존 피드백 가져오기');
        await saveFeedbackRowVerified('feedbacks', payload, '기존 피드백 가져오기');
        savedIds.add(candidate.id);
      } catch (err) {
        errors.push((candidate.student_name || '이름 없음') + ': ' + String(err && (err.message || err) || '저장 실패'));
      }
    }
    existingFeedbackImportState.candidates = existingFeedbackImportState.candidates.filter(item => !savedIds.has(item.id));
    try { await loadStudentsFromSupabase(); } catch(e) {}
    try {
      const searchValue = document.getElementById('searchName')?.value?.trim() || '';
      if (typeof loadRecords === 'function') await loadRecords(searchValue);
    } catch(e) {}
    
    existingFeedbackImportState.statusMessage = savedIds.size
      ? `${savedIds.size}개의 기존 피드백을 앱에 저장했습니다.`
      : '';
    existingFeedbackImportState.errorMessage = errors.length ? errors.slice(0, 5).join('\n') + (errors.length > 5 ? '\n...' : '') : '';
    if (savedIds.size && typeof showPushToast === 'function') showPushToast(`${savedIds.size}개의 피드백을 저장했어요.`);
  } finally {
    existingFeedbackImportState.importRunning = false;
    refreshSettingsAttendancePhotoImportDetail();
  }
}

function renderSettingsExistingFeedbackImport() {
  const hasFile = !!existingFeedbackImportState.fileName;
  const fileSize = formatExistingFeedbackImportFileSize(existingFeedbackImportState.fileSize);
  const title = hasFile ? existingFeedbackImportState.fileName : '기존 피드백 파일 업로드';
  const extractedTextLength = String(existingFeedbackImportState.fileText || '').trim().length;
  const desc = hasFile
    ? ((fileSize ? fileSize + ' · ' : '') + (extractedTextLength ? ('본문 ' + extractedTextLength.toLocaleString('ko-KR') + '자 추출됨') : '기존 피드백 파일입니다.'))
    : '학생별로 정리해둔 기존 피드백 문서나 텍스트 파일을 올릴 수 있어요.';
  const status = existingFeedbackImportState.statusMessage
    ? '<div class="attendancePhotoStatusBox">' + settingsEscapeHtml(existingFeedbackImportState.statusMessage) + '</div>'
    : '';
  const error = existingFeedbackImportState.errorMessage
    ? '<div class="attendancePhotoStatusBox error">' + settingsEscapeHtml(existingFeedbackImportState.errorMessage) + '</div>'
    : '';
  const preview = existingFeedbackImportState.rawReply && !(existingFeedbackImportState.candidates || []).length
    ? '<div class="existingFeedbackPreviewBox">' + settingsEscapeHtml(existingFeedbackImportState.rawReply.slice(0, 1800)) + (existingFeedbackImportState.rawReply.length > 1800 ? '\n...' : '') + '</div>'
    : '';
  const analyzeLabel = existingFeedbackImportState.analyzing ? '분석 중...' : '피드백 분석하기';
  const clearLabel = existingFeedbackImportState.candidates && existingFeedbackImportState.candidates.length ? '파일/후보 지우기' : '파일 지우기';
  return '<div class="settingsInfoCard"><div class="settingsInfoHead">기존 피드백 가져오기</div></div>'
    + '<div class="existingFeedbackImportBox" onclick="openExistingFeedbackImportPicker()" role="button">'
    + '<div class="existingFeedbackImportIcon"><svg viewBox="0 0 24 24"><path d="M7 3.8h7.2L19 8.6V20a1.7 1.7 0 0 1-1.7 1.7H7A1.7 1.7 0 0 1 5.3 20V5.5A1.7 1.7 0 0 1 7 3.8z"></path><path d="M14 4v5h5"></path><path d="M8.6 13h6.8"></path><path d="M8.6 16.5h4.5"></path></svg></div>'
    + '<div class="existingFeedbackImportTitle">' + settingsEscapeHtml(title) + '</div>'
    + '<div class="existingFeedbackImportDesc">' + settingsEscapeHtml(desc) + '</div>'
    + '</div>'
    + '<div class="attendancePhotoActionGrid"><button class="settingsActionBtn primary" type="button" onclick="requestExistingFeedbackImportAnalysis()"' + (existingFeedbackImportState.analyzing ? ' disabled' : '') + '>' + analyzeLabel + '</button><button class="settingsActionBtn" type="button" onclick="clearExistingFeedbackImportFile()">' + clearLabel + '</button></div>'
    + status + error + preview + renderExistingFeedbackImportResults();
}

function renderSettingsAttendancePhotoImportOnly() {
  const images = getAttendancePhotoImportImages();
  const hasImage = images.length > 0;
  const imageName = images.length > 1
    ? settingsEscapeHtml(images.length + '장 선택됨')
    : settingsEscapeHtml((images[0] && images[0].name) || attendancePhotoImportState.imageName || '선택한 사진');
  const previewHtml = images.length > 1
    ? '<div class="attendancePhotoPreviewGrid">' + images.slice(0, 4).map(item => '<img class="attendancePhotoPreviewThumb" src="' + item.dataUrl + '" alt="출석부 사진 미리보기">').join('') + '</div>'
    : (hasImage ? '<img class="attendancePhotoPreview" src="' + images[0].dataUrl + '" alt="출석부 사진 미리보기">' : '');
  const progressText = attendancePhotoImportState.analysisProgress ? ' ' + attendancePhotoImportState.analysisProgress : '';
  const uploadTitle = attendancePhotoImportState.analyzing ? '사진 분석 중...' + progressText : (hasImage ? imageName : '출석부 사진 업로드');
  const uploadDesc = attendancePhotoImportState.analyzing
    ? 'AI가 출석부 사진을 읽고 있어요.'
    : (hasImage ? '다른 사진으로 변경하려면 이 영역을 눌러주세요.' : '종이 출석부를 촬영한 사진을 여러 장 올릴 수 있어요.');
  const analyzeStatus = attendancePhotoImportState.analyzing
    ? '<div class="attendancePhotoStatusBox">AI가 사진을 분석하고 있어요.' + settingsEscapeHtml(progressText) + '</div>'
    : '';
  const importResults = renderAttendancePhotoImportResults();

  return '<div class="settingsInfoCard"><div class="settingsInfoHead">출석부 사진 등록</div></div>'
    + '<div class="attendancePhotoUploadBox" onclick="openAttendancePhotoImportPicker()" role="button">'
    + '<div class="attendancePhotoUploadIcon"><svg viewBox="0 0 24 24"><path d="M4.5 8.2A2.2 2.2 0 0 1 6.7 6h10.6a2.2 2.2 0 0 1 2.2 2.2v8.6a2.2 2.2 0 0 1-2.2 2.2H6.7a2.2 2.2 0 0 1-2.2-2.2z"></path><path d="M8 15l2.2-2.2a1.3 1.3 0 0 1 1.8 0L16 16.8"></path><path d="M15.5 10h.01"></path></svg></div>'
    + '<div class="attendancePhotoUploadTitle">' + uploadTitle + '</div>'
    + '<div class="attendancePhotoUploadDesc">' + uploadDesc + '</div>'
    + previewHtml
    + '</div>'
    + analyzeStatus
    + importResults;
}

function renderSettingsAttendancePhotoImport() {
  const active = getStudentManagementActiveTab();
  let activeHtml = '';
  if (active === 'feedback') activeHtml = renderSettingsExistingFeedbackImport();
  else if (active === 'photo') activeHtml = renderSettingsAttendancePhotoImportOnly();
  else activeHtml = renderSettingsStudentBulkImport();

  return '<div class="settingsDetailIntro"><div class="settingsDetailTitle attendancePhotoImportTitle">학생정보를 한 번에 수정합니다.</div></div>'
    + renderStudentManagementTabs()
    + activeHtml;
}

function refreshSettingsAttendancePhotoImportDetail() {
  const detail = document.getElementById('settingsDetailScreen');
  const title = document.getElementById('settingsDetailTitlePill');
  const body = document.getElementById('settingsDetailBody');
  if (!detail || !title || !body) return;
  if (detail.style.display === 'flex' && (title.textContent === '출석부 사진 등록' || title.textContent === '원생 관리' || title.textContent === '학생정보 일괄 수정')) {
    body.innerHTML = renderSettingsAttendancePhotoImport();
  }
}

function openAttendancePhotoImportPicker() {
  const input = document.getElementById('attendancePhotoImportInput');
  if (input) input.click();
}

async function handleAttendancePhotoImportChange(event) {
  const files = event && event.target && event.target.files ? Array.from(event.target.files) : [];
  if (!files.length) return;
  const imageFiles = files.filter(file => String(file.type || '').startsWith('image/'));
  if (!imageFiles.length) {
    if (typeof showPushToast === 'function') showPushToast('이미지 파일만 업로드할 수 있어요.');
    else alert('이미지 파일만 업로드할 수 있어요.');
    event.target.value = '';
    return;
  }
  attendancePhotoImportState.analyzing = true;
  attendancePhotoImportState.analysisProgress = '준비 중';
  attendancePhotoImportState.imageName = imageFiles.length > 1 ? imageFiles.length + '장 선택됨' : (imageFiles[0].name || '출석부 사진');
  attendancePhotoImportState.imageDataUrl = '';
  attendancePhotoImportState.imageItems = [];
  attendancePhotoImportState.candidates = [];
  attendancePhotoImportState.errorMessage = '';
  attendancePhotoImportState.rawReply = '';
  refreshSettingsAttendancePhotoImportDetail();
  try {
    const compressed = [];
    for (let i = 0; i < imageFiles.length; i += 1) {
      attendancePhotoImportState.analysisProgress = '압축 ' + (i + 1) + '/' + imageFiles.length;
      refreshSettingsAttendancePhotoImportDetail();
      compressed.push(await compressAttendancePhotoImportFile(imageFiles[i]));
    }
    attendancePhotoImportState.imageItems = compressed;
    attendancePhotoImportState.imageDataUrl = compressed[0]?.dataUrl || '';
    attendancePhotoImportState.imageName = compressed.length > 1 ? compressed.length + '장 선택됨' : (compressed[0]?.name || '출석부 사진');
    attendancePhotoImportState.analyzing = false;
    attendancePhotoImportState.analysisProgress = '';
    refreshSettingsAttendancePhotoImportDetail();
    setTimeout(requestAttendancePhotoAnalysis, 80);
  } catch (err) {
    attendancePhotoImportState.analyzing = false;
    attendancePhotoImportState.analysisProgress = '';
    attendancePhotoImportState.errorMessage = String(err && (err.message || err) || '사진을 준비하지 못했어요.');
    refreshSettingsAttendancePhotoImportDetail();
  }
}

function clearAttendancePhotoImportImage() {
  attendancePhotoImportState.imageName = '';
  attendancePhotoImportState.imageDataUrl = '';
  attendancePhotoImportState.imageItems = [];
  attendancePhotoImportState.analysisProgress = '';
  attendancePhotoImportState.candidates = [];
  attendancePhotoImportState.errorMessage = '';
  attendancePhotoImportState.rawReply = '';
  const input = document.getElementById('attendancePhotoImportInput');
  if (input) input.value = '';
  refreshSettingsAttendancePhotoImportDetail();
}

function updateAttendancePhotoCandidateField(index, field, value) {
  const item = attendancePhotoImportState.candidates[index];
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

function toggleAttendancePhotoImportCandidate(index, checked) {
  const item = attendancePhotoImportState.candidates[index];
  if (!item) return;
  item.selected = !!checked;
}

function setAllAttendancePhotoImportCandidatesChecked(checked) {
  attendancePhotoImportState.candidates.forEach(item => { item.selected = !!checked; });
  refreshSettingsAttendancePhotoImportDetail();
}

function buildAttendancePhotoImportPayloads(imageItem, index, total) {
  const prompt = buildAttendancePhotoImportPrompt();
  const imageContent = { type: 'image_url', image_url: { url: imageItem.dataUrl, detail: 'low' } };
  const textContent = { type: 'text', text: prompt };
  const common = {
    feature: 'attendancePhotoImport',
    imageName: imageItem.name || '',
    imageIndex: index + 1,
    imageTotal: total
  };
  return [
    {
      ...common,
      promptType: 'summary',
      messages: [{ role: 'user', content: [textContent, imageContent] }]
    },
    {
      ...common,
      promptType: 'class',
      messages: [{ role: 'user', content: [textContent, imageContent] }]
    },
    {
      ...common,
      promptType: 'summary',
      imageDataUrl: imageItem.dataUrl,
      messages: [{ role: 'user', content: prompt }]
    }
  ];
}

async function postAttendancePhotoImportPayload(payload) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const rawText = await res.text();
  let data;
  try { data = rawText ? JSON.parse(rawText) : {}; } catch { data = { raw: rawText, reply: rawText }; }
  if (!res.ok) {
    const error = new Error(getApiErrorMessage(res.status, data));
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function requestSingleAttendancePhotoAnalysis(imageItem, index, total) {
  const payloads = buildAttendancePhotoImportPayloads(imageItem, index, total);
  let lastError = null;
  for (const payload of payloads) {
    try {
      return await postAttendancePhotoImportPayload(payload);
    } catch (err) {
      lastError = err;
      if (err && err.status === 413) {
        throw new Error('사진 용량이 커서 분석 요청이 거절됐어요. 사진을 더 작게 촬영하거나 한 장씩 다시 시도해 주세요.');
      }
      if (!err || (err.status !== 400 && err.status !== 415)) throw err;
    }
  }
  const detail = String(lastError && (lastError.message || lastError) || '').trim();
  throw new Error('서버가 아직 출석부 사진 분석 요청 형식을 받지 못하고 있어요. 서버의 /api/chat에서 이미지 입력을 처리하도록 연결해야 합니다.' + (detail ? '\n' + detail : ''));
}

function mergeAttendancePhotoImportCandidates(list) {
  const map = new Map();
  list.forEach(item => {
    const key = [normalizeAttendancePhotoDivision(item.division), String(item.name || '').trim(), normalizeAttendancePhotoLessonDay(item.lesson_day || ''), String(item.class_time || '').trim()].join('|');
    if (!String(item.name || '').trim()) return;
    if (!map.has(key)) {
      map.set(key, item);
      return;
    }
    const existing = map.get(key);
    Object.keys(item).forEach(field => {
      if ((existing[field] === '' || existing[field] === null || existing[field] === undefined) && item[field]) existing[field] = item[field];
    });
    if (item.note && !String(existing.note || '').includes(item.note)) {
      existing.note = [existing.note, item.note].filter(Boolean).join(' / ');
    }
  });
  return Array.from(map.values());
}

async function requestAttendancePhotoAnalysis() {
  if (attendancePhotoImportState.analyzing) return;
  const images = getAttendancePhotoImportImages();
  if (!images.length) {
    if (typeof showPushToast === 'function') showPushToast('먼저 출석부 사진을 업로드해 주세요.');
    else alert('먼저 출석부 사진을 업로드해 주세요.');
    return;
  }
  attendancePhotoImportState.analyzing = true;
  attendancePhotoImportState.analysisProgress = '';
  attendancePhotoImportState.errorMessage = '';
  attendancePhotoImportState.rawReply = '';
  attendancePhotoImportState.candidates = [];
  refreshSettingsAttendancePhotoImportDetail();
  try {
    const allRows = [];
    const rawReplies = [];
    const errorMessages = [];
    for (let i = 0; i < images.length; i += 1) {
      attendancePhotoImportState.analysisProgress = (i + 1) + '/' + images.length;
      refreshSettingsAttendancePhotoImportDetail();
      try {
        const data = await requestSingleAttendancePhotoAnalysis(images[i], i, images.length);
        const rows = parseAttendancePhotoAnalysisData(data);
        rows.forEach(row => allRows.push(row));
        const rawReply = String(data.reply || data.raw || '').trim();
        if (rawReply) rawReplies.push(rawReply);
      } catch (err) {
        errorMessages.push((images[i].name || '사진 ' + (i + 1)) + ': ' + String(err && (err.message || err) || '분석 실패'));
      }
    }
    const normalized = mergeAttendancePhotoImportCandidates(allRows.map(normalizeAttendancePhotoImportCandidate).filter(item => String(item.name || '').trim()));
    attendancePhotoImportState.candidates = normalized;
    attendancePhotoImportState.rawReply = rawReplies.join('\n\n');
    if (errorMessages.length) {
      attendancePhotoImportState.errorMessage = errorMessages.join('\n');
    }
    if (!normalized.length && !attendancePhotoImportState.errorMessage) {
      attendancePhotoImportState.errorMessage = '사진에서 등록할 학생 정보를 찾지 못했어요. 더 선명한 사진으로 다시 시도해 주세요.';
    } else if (normalized.length && typeof showPushToast === 'function') {
      showPushToast(`학생 후보 ${normalized.length}명을 찾았어요.`);
    }
  } catch (err) {
    attendancePhotoImportState.candidates = [];
    attendancePhotoImportState.errorMessage = String(err && (err.message || err) || '사진 분석에 실패했어요.');
  } finally {
    attendancePhotoImportState.analyzing = false;
    attendancePhotoImportState.analysisProgress = '';
    refreshSettingsAttendancePhotoImportDetail();
  }
}

function buildStudentFromAttendancePhotoCandidate(candidate) {
  const division = normalizeAttendancePhotoDivision(candidate.division);
  const enrolled = normalizeStudentDateInputValue(candidate.enrolled_at || '');
  const base = {
    id: uid(),
    type: division,
    name: String(candidate.name || '').trim(),
    year: enrolled ? enrolled.year : '',
    month: enrolled ? String(Number(enrolled.month)) : '',
    day: enrolled ? String(Number(enrolled.day)) : '',
    enrolled_at: enrolled ? enrolled.enrolled_at : '',
    lesson_day: normalizeAttendancePhotoLessonDay(candidate.lesson_day || ''),
    lesson_time: normalizeLessonTimeDisplay(candidate.class_time || candidate.lesson_time || ''),
    class_time: normalizeLessonTimeDisplay(candidate.class_time || candidate.lesson_time || ''),
    teacher: formatTeacherNameWithT(candidate.teacher || ''),
    homeroom_teacher: formatTeacherNameWithT(candidate.teacher || ''),
    status: 'active',
    academy_id: getOlliCurrentAcademyId ? getOlliCurrentAcademyId() : ''
  };
  if (division === 'kinder') {
    return normalizeStudentObject({
      ...base,
      kindergarten: candidate.kindergarten || '',
      age: candidate.age || ''
    }, 'kinder');
  }
  return normalizeStudentObject({
    ...base,
    school: candidate.school || '',
    grade: candidate.grade || '',
    className: candidate.className || '',
    group: getAttendancePhotoGroupInternalValue(candidate.group || ''),
    group_months: '',
    feedback_months: ''
  }, 'elementary');
}

async function importAttendancePhotoCandidates() {
  if (attendancePhotoImportState.importRunning) return;
  const selected = attendancePhotoImportState.candidates.filter(item => item.selected && String(item.name || '').trim());
  if (!selected.length) {
    if (typeof showPushToast === 'function') showPushToast('등록할 학생을 선택해 주세요.');
    else alert('등록할 학생을 선택해 주세요.');
    return;
  }
  const duplicateNames = selected.filter(item => getAttendancePhotoDuplicateInfo(item).type === 'dup').map(item => item.name);
  if (duplicateNames.length) {
    const ok = confirm('중복 가능 학생이 포함되어 있어요.\n' + duplicateNames.join(', ') + '\n\n그래도 새 학생으로 등록할까요?');
    if (!ok) return;
  }
  attendancePhotoImportState.importRunning = true;
  try {
    let savedCount = 0;
    for (const candidate of selected) {
      const student = buildStudentFromAttendancePhotoCandidate(candidate);
      if (!student.name) continue;
      await saveStudent(student);
      savedCount += 1;
    }
    try { await loadStudentsFromSupabase(); } catch(e) {}
    try {
      const searchValue = document.getElementById('searchName')?.value?.trim() || '';
      if (typeof loadRecords === 'function') await loadRecords(searchValue);
    } catch(e) {}
    try { if (typeof refreshMemoStudentSelectPopupIfOpen === 'function') refreshMemoStudentSelectPopupIfOpen(); } catch(e) {}
    attendancePhotoImportState.candidates = attendancePhotoImportState.candidates.filter(item => !selected.includes(item));
    attendancePhotoImportState.errorMessage = '';
    if (typeof showPushToast === 'function') showPushToast(`${savedCount}명의 학생을 출석부에 등록했어요.`);
    else alert(`${savedCount}명의 학생을 출석부에 등록했어요.`);
  } catch (err) {
    attendancePhotoImportState.errorMessage = String(err && (err.message || err) || '학생 등록에 실패했어요.');
  } finally {
    attendancePhotoImportState.importRunning = false;
    refreshSettingsAttendancePhotoImportDetail();
  }
}


function showOlliTestResetMessage(message) {
  if (typeof showPushToast === 'function') showPushToast(message);
  else alert(message);
}

function guardOlliTestResetTool() {
  if (typeof canUseOlliDevTestTools !== 'function' || !canUseOlliDevTestTools()) {
    showOlliTestResetMessage('비비작아이성향미술학원 원장 계정에서만 사용할 수 있는 테스트 기능입니다.');
    return false;
  }
  return true;
}

function clearAcademyManagementRuntimeForTest() {
  if (academyConsultationAutoCheckTimer) {
    clearTimeout(academyConsultationAutoCheckTimer);
    academyConsultationAutoCheckTimer = null;
  }
  if (academyManagementDashboardRenderTimer) {
    clearTimeout(academyManagementDashboardRenderTimer);
    academyManagementDashboardRenderTimer = null;
  }
  academyConsultationSummaryState.running = false;
  academyConsultationSummaryState.items = {};
  academyConsultationSummaryState.expandedKey = '';
  try { localStorage.removeItem(getPendingStudentStatusStorageKey()); } catch (_) {}
}

async function resetAcademyManagementPageForTest() {
  if (!guardOlliTestResetTool()) return;
  const ok = confirm('학원관리 페이지의 임시 계산 상태를 리셋하고\n원생수, 상담, 등록, 퇴원 카운트를 다시 계산합니다.\n\n상담 예정 학생도 모두 다시 확인합니다.');
  if (!ok) return;
  clearAcademyManagementRuntimeForTest();
  try {
    if (typeof loadStudentsFromSupabase === 'function') await loadStudentsFromSupabase();
  } catch (err) {
    console.warn('학원관리 리셋 학생 재조회 실패:', err.message || err);
  }
  if (typeof renderRecordAcademyManagementDashboard === 'function') renderRecordAcademyManagementDashboard();
  if (currentRecordView === 'academy' && typeof scheduleAcademyConsultationSummaryAutoCheck === 'function') {
    scheduleAcademyConsultationSummaryAutoCheck(200);
  }
  showOlliTestResetMessage('학원관리 페이지를 다시 계산합니다.');
}

function removeLocalStorageKeysForStudentTestReset(student) {
  const id = String(student?.id || '').trim();
  if (!id) return;
  const academyId = (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || '';
  const safeId = id.replace(/[^a-zA-Z0-9._:-]/g, '_');
  const safeAcademyId = academyId.replace(/[^a-zA-Z0-9._:-]/g, '_');
  const directKeys = [
    ELEMENTARY_MEMO_PREFIX + id,
    ELEMENTARY_ANALYSIS_PREFIX + id,
    ELEMENTARY_RECORDS_PREFIX + id,
    KINDER_MEMO_PREFIX + id,
    MEMO_FEEDBACK_ARCHIVE_PREFIX + id
  ];
  directKeys.forEach(key => {
    try { localStorage.removeItem(key); } catch (_) {}
  });
  try {
    Object.keys(localStorage).forEach(key => {
      const isCommonStudentKey = key.startsWith('olli:v')
        && safeAcademyId
        && key.includes(':' + safeAcademyId + ':' + safeId + ':');
      const isLegacyStudentKey = key.includes(id) && (
        key.startsWith(ELEMENTARY_MEMO_PREFIX) ||
        key.startsWith(ELEMENTARY_ANALYSIS_PREFIX) ||
        key.startsWith(ELEMENTARY_RECORDS_PREFIX) ||
        key.startsWith(KINDER_MEMO_PREFIX) ||
        key.startsWith(MEMO_FEEDBACK_ARCHIVE_PREFIX)
      );
      if (isCommonStudentKey || isLegacyStudentKey) localStorage.removeItem(key);
    });
  } catch (err) {
    console.warn('학생별 로컬 데이터 정리 실패:', err);
  }
}

function clearStudentSyncQueueForTestReset(studentIds) {
  const academyId = (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || '';
  const idSet = new Set((studentIds || []).map(id => String(id || '').trim()).filter(Boolean));
  if (!academyId || !idSet.size) return;
  try {
    const core = window.OlliStorageCore;
    if (!core?.SyncQueue) return;
    const current = core.SyncQueue.read(academyId);
    const filtered = current.filter(item => !idSet.has(String(item.student_id || '').trim()));
    if (filtered.length !== current.length) core.SyncQueue.write(academyId, filtered);
  } catch (err) {
    console.warn('학생 리셋 동기화 큐 정리 실패:', err.message || err);
  }
}

async function deleteStudentFeedbackRowsForTestReset(student) {
  const academyId = requireOlliAcademyId('출석부 학생명단 리셋');
  const studentId = String(student?.id || '').trim();
  if (!studentId || typeof deleteOlliData !== 'function') return [];
  const failures = [];
  const features = [
    { feature: 'general_feedbacks_by_student_delete', label: '일반 피드백' },
    { feature: 'growth_feedbacks_by_student_delete', label: '성장 피드백' },
    { feature: 'summary_feedbacks_by_student_delete', label: '종합 피드백' }
  ];
  for (const item of features) {
    try {
      const result = await deleteOlliData(item.feature, {
        academyId,
        studentId,
        forceCommon: true,
        deleteMode: 'soft',
        reason: 'test_reset'
      });
      if (result && result.ok === false) {
        failures.push(item.label + ': 서버 삭제 대기 또는 실패');
      }
    } catch (err) {
      failures.push(item.label + ': ' + String(err && (err.message || err) || '삭제 실패'));
    }
  }
  return failures;
}

async function deleteStudentNoteRowsForTestReset(student) {
  if (!isSupabaseConfigured() || !student?.id) return [];
  const academyId = requireOlliAcademyId('출석부 학생 노트 리셋');
  const studentId = String(student.id || '').trim();
  const failures = [];
  try {
    await clearStudentNoteDraftFromSupabase(student, student.type === 'kinder' ? 'kinder_risk' : 'elementary_observation');
  } catch (err) {
    failures.push('노트 초안: ' + String(err && (err.message || err) || '삭제 실패'));
  }
  const encodedAcademyId = encodeURIComponent(academyId);
  const encodedStudentId = encodeURIComponent(studentId);
  const tables = ['student_note_drafts', 'student_note_archives'];
  for (const table of tables) {
    try {
      await supabase('DELETE', `${table}?academy_id=eq.${encodedAcademyId}&student_id=eq.${encodedStudentId}`);
    } catch (err) {
      failures.push(table + ': ' + String(err && (err.message || err) || '삭제 실패'));
    }
  }
  return failures;
}

async function softDeleteStudentForTestReset(student) {
  if (!isSupabaseConfigured()) return;
  if (typeof saveOlliData !== 'function') throw new Error('학생 삭제 공통 저장 함수가 준비되지 않았습니다.');
  const academyId = requireOlliAcademyId('출석부 학생명단 리셋');
  const studentId = String(student?.id || '').trim();
  if (!studentId) return;
  const deletedAt = new Date().toISOString();
  const deletedBy = getOlliSoftDeleteActorId();
  const result = await saveOlliData('student_soft_delete', {
    academyId,
    studentId,
    data: {
      is_deleted: true,
      deleted_at: deletedAt,
      deleted_by: deletedBy || null,
      delete_reason: 'test_reset'
    },
    forceCommon: true
  });
  if (result && result.serverSaved && result.verified) return;
  if (result && result.pending) throw new Error('학생 삭제가 서버에 반영되지 않아 재전송 대기열에 남았습니다.');
  throw new Error('학생 삭제 서버 반영을 확인하지 못했습니다.');
}

async function resetSingleStudentForTestReset(student) {
  const relatedFailures = [];
  relatedFailures.push(...await deleteStudentFeedbackRowsForTestReset(student));
  relatedFailures.push(...await deleteStudentNoteRowsForTestReset(student));
  await softDeleteStudentForTestReset(student);
  return relatedFailures;
}

async function resetAttendanceStudentRosterForTest() {
  if (!guardOlliTestResetTool()) return;
  const students = getAllStudents();
  if (!students.length) {
    clearAcademyManagementRuntimeForTest();
    renderRecordAcademyManagementDashboard();
    showOlliTestResetMessage('삭제할 등록 학생이 없습니다.');
    return;
  }
  const ok = confirm('현재 학원의 출석부 학생명단을 리셋합니다.\n\n등록된 학생, 학생별 관찰노트 메모, 분석 설문, 저장 피드백, 종합 피드백을 함께 삭제합니다.\n이 작업은 테스트용이며 되돌리기 어렵습니다.\n\n계속할까요?');
  if (!ok) return;

  const successIds = [];
  const failures = [];
  for (const student of students) {
    const studentId = String(student?.id || '').trim();
    try {
      const relatedFailures = await resetSingleStudentForTestReset(student);
      successIds.push(studentId);
      relatedFailures.forEach(message => failures.push((student.name || studentId) + ' / ' + message));
    } catch (err) {
      failures.push((student?.name || studentId || '학생') + ': ' + String(err && (err.message || err) || '삭제 실패'));
    }
  }

  if (successIds.length) {
    const successSet = new Set(successIds);
    students.forEach(student => {
      if (successSet.has(String(student.id || '').trim())) {
        backupAndRemoveStudentLocalData(student.id, student);
        removeLocalStorageKeysForStudentTestReset(student);
        unmarkDeletedStudentId(student.id);
      }
    });
    setAllStudents(getAllStudents().filter(student => !successSet.has(String(student.id || '').trim())));
    clearStudentSyncQueueForTestReset(successIds);
  }

  if (currentMemoStudent && successIds.includes(String(currentMemoStudent.id || '').trim())) {
    currentMemoStudent = null;
    const memoScreen = document.getElementById('studentMemoScreen');
    const recordScreen = document.getElementById('recordRoomScreen');
    if (memoScreen) memoScreen.style.display = 'none';
    if (recordScreen) recordScreen.style.display = 'flex';
  }

  if (typeof selectedStudentIds !== 'undefined' && selectedStudentIds?.clear) selectedStudentIds.clear();
  clearAcademyManagementRuntimeForTest();
  try { await loadStudentsFromSupabase(); } catch (err) { console.warn('학생명단 리셋 후 학생 재조회 실패:', err.message || err); }
  try {
    const searchValue = document.getElementById('searchName')?.value?.trim() || '';
    if (typeof loadRecords === 'function') await loadRecords(searchValue);
  } catch (err) {
    console.warn('학생명단 리셋 후 출석부 갱신 실패:', err.message || err);
  }
  if (typeof renderRecordAcademyManagementDashboard === 'function') renderRecordAcademyManagementDashboard();
  try { if (typeof refreshMemoStudentSelectPopupIfOpen === 'function') refreshMemoStudentSelectPopupIfOpen(); } catch (_) {}

  const baseMessage = successIds.length + '명의 학생을 출석부에서 리셋했습니다.';
  if (failures.length) {
    alert(baseMessage + '\n\n일부 서버 기록 정리에 실패했습니다. 저장 진단을 확인해 주세요.\n' + failures.slice(0, 5).join('\n'));
  } else {
    showOlliTestResetMessage(baseMessage);
  }
}


