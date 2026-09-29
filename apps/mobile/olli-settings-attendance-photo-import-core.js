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
