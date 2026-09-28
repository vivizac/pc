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
