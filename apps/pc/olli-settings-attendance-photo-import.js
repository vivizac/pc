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


