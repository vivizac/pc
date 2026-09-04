/* ── 유치부 대화형 1분 피드백 페이지 v1 ── */
const KCF_DRAFT_KEY = 'olli_kinder_chat_feedback_draft_v1';
function getKinderChatFeedbackDraftKey(){
  const academyId = (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || 'unscoped';
  return `${KCF_DRAFT_KEY}_${academyId}`;
}
const KCF_INBOX_RETENTION_MS = 12 * 60 * 60 * 1000;
let kcfActiveKeyword = '';
let kcfKeepInputFocusUntil = 0;
let kcfPendingPhoto = null;
const kcfKeywordQuestions = {
  transition: { title:'망설임→전환', questions:['아이가 처음 망설인 장면은 무엇이었나요?', '어떤 도움을 받고 다시 시도했나요?', '다시 시도한 뒤 모습은 어땠나요?'] },
  thought: { title:'생각 표현', questions:['아이가 직접 말한 생각은 무엇이었나요?', '그 생각이 그림에서 어떻게 표현되었나요?', '특별히 인상 깊었던 말은 무엇인가요?'] },
  confidence: { title:'자신감', questions:['아이가 스스로 해보려 한 장면은 무엇이었나요?', '완성 후 표정이나 말은 어땠나요?', '이전보다 자신감이 보인 부분은 무엇인가요?'] },
  help: { title:'도움 요청', questions:['아이가 어떤 순간에 도움을 요청했나요?', '도움을 받은 뒤 다시 시도했나요?', '그 과정에서 성장으로 보인 부분은 무엇인가요?'] },
  material: { title:'재료 탐색', questions:['아이가 어떤 재료에 관심을 보였나요?', '재료를 어떻게 사용해 보았나요?', '새로운 표현으로 이어진 부분이 있었나요?'] },
  joy: { title:'즐겁게 참여', questions:['아이가 즐거워한 장면은 언제였나요?', '웃거나 말로 표현한 반응이 있었나요?', '활동에 몰입한 모습은 어땠나요?'] },
  friend: { title:'친구와 협력', questions:['친구와 어떤 상호작용이 있었나요?', '양보하거나 도와준 장면이 있었나요?', '협력 후 아이의 반응은 어땠나요?'] },
  focus: { title:'집중', questions:['아이가 집중한 장면은 무엇이었나요?', '얼마나 오래 이어가려 했나요?', '집중이 표현으로 이어진 부분은 무엇인가요?'] }
};
function updateKinderChatFeedbackKeyboardOffset() {
  const screen = document.getElementById('kinderChatFeedbackScreen');
  const input = document.getElementById('kcfInput');
  if (!screen) return;
  const isFocused = (document.activeElement === input) || (Date.now() < kcfKeepInputFocusUntil);
  const vv = window.visualViewport;
  let rawOffset = 0;
  if (vv) {
    const layoutHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
    rawOffset = Math.max(0, layoutHeight - vv.height - vv.offsetTop);
  }
  const adjustedOffset = isFocused ? Math.max(0, rawOffset - 44) : 0;
  screen.style.setProperty('--kcf-keyboard-offset', adjustedOffset + 'px');
  screen.classList.toggle('kcfKeyboardOpen', isFocused && adjustedOffset > 0);
}
function bindKinderChatFeedbackKeyboardOffset() {
  if (window.__kcfKeyboardOffsetBound) return;
  window.__kcfKeyboardOffsetBound = true;
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateKinderChatFeedbackKeyboardOffset);
    window.visualViewport.addEventListener('scroll', updateKinderChatFeedbackKeyboardOffset);
  }
  window.addEventListener('resize', updateKinderChatFeedbackKeyboardOffset);
}
function toggleKinderChatFeedbackModeMenu(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('kcfModeMenu');
  if (menu) menu.classList.toggle('show');
}
function closeKinderChatFeedbackModeMenu() {
  const menu = document.getElementById('kcfModeMenu');
  if (menu) menu.classList.remove('show');
}
function switchKinderChatFeedbackMode(mode, event) {
  if (event) event.stopPropagation();
  closeKinderChatFeedbackModeMenu();
  if (mode === 'growth') {
    saveKinderChatFeedbackDraft();
    openKinderChatFeedbackGrowthSheet();
    return;
  }
  if (mode === 'elementaryMemo') {
    saveKinderChatFeedbackDraft();
    const page = document.getElementById('kinderChatFeedbackScreen');
    if (page) page.style.display = 'none';
    const openFn = window.openObservationNoteFromRecord || (typeof openObservationNoteFromRecord === 'function' ? openObservationNoteFromRecord : null);
    if (openFn) {
      openFn();
      return;
    }
    const elementaryStudents = (typeof getStudentsByType === 'function') ? getStudentsByType('elementary') : [];
    const targetStudent = elementaryStudents && elementaryStudents.length ? elementaryStudents[0] : null;
    if (targetStudent && typeof openStudentMemoPageById === 'function') {
      openStudentMemoPageById(targetStudent.id);
      return;
    }
    alert('초등부 관찰노트를 열 수 없습니다.');
  }
}
function openKinderChatFeedbackPage() {
  const screens = document.querySelectorAll('.pageScreen');
  screens.forEach(screen => { if (screen.id !== 'kinderChatFeedbackScreen') screen.style.display = 'none'; });
  const page = document.getElementById('kinderChatFeedbackScreen');
  if (page) page.style.display = 'flex';
  bindKinderChatFeedbackKeyboardOffset();
  loadKinderChatFeedbackDraft();
  updateKinderChatFeedbackBadge();
  updateKinderChatFeedbackKeyboardOffset();
  setTimeout(() => {
    const input = document.getElementById('kcfInput');
    if (input) autoResizeKinderChatFeedbackInput(input);
  }, 0);
}
async function closeKinderChatFeedbackPage() {
  saveKinderChatFeedbackDraft();
  const page = document.getElementById('kinderChatFeedbackScreen');
  if (page) page.style.display = 'none';
  if (typeof showRecordRoom === 'function') await showRecordRoom();
}
function isKinderChatFeedbackQueueItem(item) {
  return !!item && (
    item.sourcePage === 'kinderChatFeedback' ||
    item.label === '유치부 1분 피드백' ||
    item.label === '유치부 성장 피드백'
  );
}

function pruneExpiredKinderChatFeedbackItems() {
  const now = Date.now();
  const list = getTodayFeedbackItemsRaw();
  let changed = false;
  const next = list.filter(item => {
    if (!isKinderChatFeedbackQueueItem(item)) return true;
    const baseTime = new Date(item.createdAt || item.updatedAt || 0).getTime();
    if (!baseTime || Number.isNaN(baseTime)) return true;
    const keep = now - baseTime < KCF_INBOX_RETENTION_MS;
    if (!keep) changed = true;
    return keep;
  });

  if (changed) {
    try {
      setTodayFeedbackItemsRaw(next);
    } catch(e) {}
    try { updateNotificationButtons(); } catch(e) {}
    try { renderTodayFeedbackPage(); } catch(e) {}
  }

  return changed;
}

function getKinderChatFeedbackItems() {
  try {
    pruneExpiredKinderChatFeedbackItems();
    return getTodayFeedbackItemsRaw()
      .filter(item => isKinderChatFeedbackQueueItem(item))
      .sort((a, b) => {
        const bt = new Date(b.updatedAt || b.createdAt || 0).getTime();
        const at = new Date(a.updatedAt || a.createdAt || 0).getTime();
        return bt - at;
      });
  } catch(e) {
    return [];
  }
}
function getKinderChatFeedbackCounts() {
  const items = getKinderChatFeedbackItems();
  return {
    generating: items.filter(item => item.status === 'generating').length,
    ready: items.filter(item => (item.status === 'done' || item.status === 'review') && !item.reviewed && !item.saved).length,
    error: items.filter(item => item.status === 'error').length,
    saved: items.filter(item => item.saved || item.reviewed).length
  };
}
function updateKinderChatFeedbackBadge() {
  const badge = document.getElementById('kcfInboxBadge');
  if (!badge) return;
  const counts = getKinderChatFeedbackCounts();
  if (counts.ready > 0) {
    badge.textContent = counts.ready > 99 ? '99+' : String(counts.ready);
    badge.classList.add('show');
  } else {
    badge.textContent = '';
    badge.classList.remove('show');
  }
}
function autoResizeKinderChatFeedbackInput(input) {
  if (!input) return;
  const min = 34;
  const max = Math.max(160, Math.floor(window.innerHeight * 0.38));
  if (!String(input.value || '').trim()) {
    input.style.height = `${min}px`;
    input.style.overflowY = 'hidden';
    return;
  }
  input.style.height = 'auto';
  const next = Math.max(min, Math.min(input.scrollHeight, max));
  input.style.height = `${next}px`;
  input.style.overflowY = input.scrollHeight > max ? 'auto' : 'hidden';
}
function focusKinderChatFeedbackInput() {
  const input = document.getElementById('kcfInput');
  if (!input) return;
  input.focus();
}
function openKinderChatFeedbackPhotoPicker(event) {
  if (event) event.stopPropagation();
  const input = document.getElementById('kcfPhotoInput');
  if (!input) return;
  input.value = '';
  input.click();
}
function loadKinderChatFeedbackImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('사진을 불러오지 못했습니다.'));
    };
    img.src = url;
  });
}
function canvasToKinderChatFeedbackBlob(canvas, type, quality) {
  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob), type || 'image/jpeg', quality || 0.78);
  });
}
async function resizeKinderChatFeedbackPhoto(file, maxSide, quality, namePrefix) {
  const img = await loadKinderChatFeedbackImageFromFile(file);
  const originalWidth = img.naturalWidth || img.width || 0;
  const originalHeight = img.naturalHeight || img.height || 0;
  const sourceMax = Math.max(originalWidth, originalHeight) || maxSide;
  const scale = Math.min(1, maxSide / sourceMax);
  const width = Math.max(1, Math.round(originalWidth * scale));
  const height = Math.max(1, Math.round(originalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('사진 처리 환경을 사용할 수 없습니다.');
  ctx.drawImage(img, 0, 0, width, height);
  const type = 'image/jpeg';
  const blob = await canvasToKinderChatFeedbackBlob(canvas, type, quality);
  if (!blob) throw new Error('사진 압축에 실패했습니다.');
  const baseName = String(file.name || namePrefix || 'photo').replace(/\.[^.]+$/, '').replace(/[^가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9_-]+/g, '_').slice(0, 40) || namePrefix || 'photo';
  const resizedFile = new File([blob], `${baseName}_${namePrefix || 'photo'}.jpg`, { type, lastModified: Date.now() });
  const dataUrl = canvas.toDataURL(type, quality || 0.78);
  return { file: resizedFile, dataUrl, width, height, fileSize: resizedFile.size, mimeType: type };
}

const KCF_PHOTO_BUCKET = 'student_feedback_photos';
const KCF_PHOTO_COMMON_FEATURE = 'feedback_photo';
function writeFeedbackPhotoCommonLocal(payload, syncStatus, phase) {
  try {
    if (typeof window.writeOlliLocal !== 'function') return null;
    const academyId = String(payload?.academy_id || getCurrentOlliAcademyId() || '').trim();
    const photoId = String(payload?.id || payload?.photo_id || '').trim();
    if (!academyId || !photoId) return null;
    let previousData = null;
    if (typeof window.readOlliLocal === 'function') {
      try {
        const previous = window.readOlliLocal(KCF_PHOTO_COMMON_FEATURE, { academyId, fileId: photoId }, { fallback: null });
        if (previous && typeof previous === 'object' && !Array.isArray(previous)) previousData = previous;
      } catch (_) {}
    }
    const mergedPayload = Object.assign({}, previousData || {}, payload, {
      storage_phase: phase || payload.storage_phase || (previousData && previousData.storage_phase) || 'metadata',
      local_recorded_at: new Date().toISOString()
    });
    return window.writeOlliLocal(KCF_PHOTO_COMMON_FEATURE, {
      academyId,
      fileId: photoId
    }, mergedPayload, {
      syncStatus: syncStatus || 'pending'
    });
  } catch (err) {
    console.warn('feedback photo common local write failed:', err);
    return null;
  }
}
function enqueueFeedbackPhotoCommonSync(payload, operation, err) {
  try {
    const core = window.OlliStorageCore;
    if (!core || !core.SyncQueue || typeof core.SyncQueue.enqueue !== 'function') return null;
    const academyId = String(payload?.academy_id || getCurrentOlliAcademyId() || '').trim();
    const photoId = String(payload?.id || payload?.photo_id || '').trim();
    if (!academyId || !photoId) return null;
    return core.SyncQueue.enqueue({
      feature: KCF_PHOTO_COMMON_FEATURE,
      operation: operation || 'upload',
      academy_id: academyId,
      student_id: payload?.student_id || null,
      file_id: photoId,
      payload: Object.assign({}, payload, {
        imageFile: undefined,
        thumbnailFile: undefined,
        localPreviewUrl: undefined
      }),
      status: operation === 'upload' ? 'blocked' : 'pending',
      error_code: err && err.code ? err.code : (operation === 'upload' ? 'FILE_UPLOAD_FAILED' : 'SERVER_WRITE_FAILED'),
      error_message: String(err && (err.message || err) || '')
    }, { coalesce: operation !== 'upload' });
  } catch (queueErr) {
    console.warn('feedback photo sync queue failed:', queueErr);
    return null;
  }
}
async function uploadOlliStorageFile(bucket, objectPath, file) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${getOlliAuthAccessToken ? (getOlliAuthAccessToken() || SUPABASE_KEY) : SUPABASE_KEY}`,
      'Content-Type': file.type || 'image/jpeg',
      'Cache-Control': '3600',
      'x-upsert': 'true'
    },
    body: file
  });
  const responseText = await res.text();
  if (!res.ok) throw new Error(responseText || `Storage 업로드 실패 (${res.status})`);
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${objectPath}`;
}

async function saveFeedbackPhotoMetadataViaCommonStorage(payload, label = '수업사진 메타데이터 저장') {
  if (typeof saveOlliData !== 'function') {
    const error = new Error('수업사진 공통 저장 함수가 준비되지 않았습니다.');
    recordOlliStorageIssue({ feature: KCF_PHOTO_COMMON_FEATURE, resource: 'feedback_photos', operation: 'save', message: error.message, student_id: payload?.student_id || '' });
    throw error;
  }
  const academyId = String(payload?.academy_id || '').trim();
  const photoId = String(payload?.id || payload?.photo_id || '').trim();
  if (!academyId || !photoId) {
    const error = new Error(`${label} 식별값이 없습니다.`);
    recordOlliStorageIssue({ feature: KCF_PHOTO_COMMON_FEATURE, resource: 'feedback_photos', operation: 'save', message: error.message, student_id: payload?.student_id || '' });
    throw error;
  }
  const result = await saveOlliData(KCF_PHOTO_COMMON_FEATURE, {
    academyId,
    fileId: photoId,
    forceCommon: true,
    data: payload
  });
  if (!result || !result.serverSaved || !result.verified) {
    const error = result && result.error
      ? result.error
      : new Error(`${label} 서버 저장이 완료되지 않았습니다.${result && result.pending ? ' 재전송 대기열에 기록되었습니다.' : ''}`);
    recordOlliStorageIssue({ feature: KCF_PHOTO_COMMON_FEATURE, resource: 'feedback_photos', operation: 'save', message: String(error && (error.message || error) || ''), student_id: payload?.student_id || '' });
    throw error;
  }
  const row = result.serverRow || (Array.isArray(result.serverRows) ? result.serverRows[0] : result.serverRows) || null;
  if (!row || typeof row !== 'object') {
    const error = new Error(`${label} 서버 저장 행을 확인하지 못했습니다.`);
    recordOlliStorageIssue({ feature: KCF_PHOTO_COMMON_FEATURE, resource: 'feedback_photos', operation: 'verify', message: error.message, student_id: payload?.student_id || '' });
    throw error;
  }
  writeFeedbackPhotoCommonLocal(Object.assign({}, payload, row), 'synced', 'metadata_saved');
  return row;
}

async function linkFeedbackPhotoToStudentViaCommonStorage(linkPayload, label = '수업사진 학생 연결') {
  if (typeof saveOlliData !== 'function') {
    const error = new Error('수업사진 학생 연결 공통 저장 함수가 준비되지 않았습니다.');
    recordOlliStorageIssue({ feature: 'feedback_photo_student_link', resource: 'feedback_photos', operation: 'link', message: error.message, student_id: linkPayload?.student_id || '' });
    throw error;
  }
  const academyId = String(linkPayload?.academy_id || '').trim();
  const photoId = String(linkPayload?.id || linkPayload?.photo_id || '').trim();
  const studentId = String(linkPayload?.student_id || '').trim();
  if (!academyId || !photoId || !studentId) {
    const error = new Error(`${label} 식별값이 없습니다.`);
    recordOlliStorageIssue({ feature: 'feedback_photo_student_link', resource: 'feedback_photos', operation: 'link', message: error.message, student_id: studentId });
    throw error;
  }
  const result = await saveOlliData('feedback_photo_student_link', {
    academyId,
    fileId: photoId,
    forceCommon: true,
    data: {
      student_id: studentId,
      updated_at: linkPayload.updated_at || new Date().toISOString()
    },
    serverOptions: { operation: 'patch' }
  });
  if (!result || !result.serverSaved || !result.verified) {
    const error = result && result.error
      ? result.error
      : new Error(`${label} 서버 저장이 완료되지 않았습니다.${result && result.pending ? ' 재전송 대기열에 기록되었습니다.' : ''}`);
    recordOlliStorageIssue({ feature: 'feedback_photo_student_link', resource: 'feedback_photos', operation: 'link', message: String(error && (error.message || error) || ''), student_id: studentId });
    throw error;
  }
  const row = result.serverRow || (Array.isArray(result.serverRows) ? result.serverRows[0] : result.serverRows) || null;
  writeFeedbackPhotoCommonLocal(Object.assign({}, linkPayload, row || {}), 'synced', 'student_linked');
  return row;
}
async function uploadKinderChatFeedbackPhotoToSupabase(photo, feedbackJobId, studentName) {
  if (!photo?.imageFile || !photo?.thumbnailFile) return null;
  const academyId = requireOlliAcademyId('수업사진 저장');
  const photoId = `photo_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const monthKey = String(photo.monthKey || getTodayFeedbackDateKey().slice(0, 7));
  const safeMonth = monthKey.replace(/[^0-9-]/g, '') || getTodayFeedbackDateKey().slice(0, 7);
  const basePath = `${academyId}/${safeMonth}/${photoId}`;
  const pendingPayload = {
    id: photoId,
    academy_id: academyId,
    student_id: null,
    student_name: String(studentName || ''),
    feedback_job_id: feedbackJobId,
    image_path: `${basePath}/image.jpg`,
    thumbnail_path: `${basePath}/thumb.jpg`,
    image_width: Number(photo.imageWidth || 0),
    image_height: Number(photo.imageHeight || 0),
    file_size: Number(photo.fileSize || 0),
    mime_type: photo.mimeType || 'image/jpeg',
    month_key: safeMonth,
    image_order: Number(photo.imageOrder || 1),
    is_deleted: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  writeFeedbackPhotoCommonLocal(pendingPayload, 'pending', 'uploading');
  try {
    const [imageUrl, thumbnailUrl] = await Promise.all([
      uploadOlliStorageFile(KCF_PHOTO_BUCKET, `${basePath}/image.jpg`, photo.imageFile),
      uploadOlliStorageFile(KCF_PHOTO_BUCKET, `${basePath}/thumb.jpg`, photo.thumbnailFile)
    ]);
    const payload = Object.assign({}, pendingPayload, {
      image_url: imageUrl,
      thumbnail_url: thumbnailUrl,
      updated_at: new Date().toISOString()
    });
    const row = await saveFeedbackPhotoMetadataViaCommonStorage(payload, '수업사진 메타데이터 저장');
    writeFeedbackPhotoCommonLocal(Object.assign({}, payload, row || {}), 'synced', 'metadata_saved');
    return {
      photo_id: photoId,
      originalName: photo.originalName || '작품사진',
      previewUrl: imageUrl,
      thumbnailUrl,
      imageWidth: payload.image_width,
      imageHeight: payload.image_height,
      fileSize: payload.file_size,
      mimeType: payload.mime_type,
      imageOrder: payload.image_order,
      feedbackType: photo.feedbackType || 'class',
      lessonTitle: photo.lessonTitle || '',
      monthKey: safeMonth,
      uploadStatus: 'uploaded',
      isDeleted: false
    };
  } catch (err) {
    writeFeedbackPhotoCommonLocal(pendingPayload, 'pending', 'upload_failed');
    enqueueFeedbackPhotoCommonSync(pendingPayload, 'upload', err);
    recordOlliStorageIssue({ feature: '수업사진', resource: `${KCF_PHOTO_BUCKET}/feedback_photos`, operation: 'upload', message: err.message || err });
    throw new Error(`수업사진을 Supabase에 저장하지 못했습니다. ${err.message || ''}`.trim());
  }
}
async function linkFeedbackPhotosToStudent(item, studentId) {
  const academyId = requireOlliAcademyId('수업사진 학생 연결');
  const attachments = Array.isArray(item?.attachments) ? item.attachments : [];
  for (const attachment of attachments) {
    const photoId = String(attachment?.photo_id || '').trim();
    if (!photoId) continue;
    const linkPayload = {
      id: photoId,
      academy_id: academyId,
      student_id: studentId,
      updated_at: new Date().toISOString()
    };
    writeFeedbackPhotoCommonLocal(linkPayload, 'pending', 'linking_student');
    try {
      const row = await linkFeedbackPhotoToStudentViaCommonStorage(linkPayload, '수업사진 학생 연결');
      writeFeedbackPhotoCommonLocal(Object.assign({}, linkPayload, row || {}), 'synced', 'student_linked');
    } catch (err) {
      enqueueFeedbackPhotoCommonSync(linkPayload, 'update', err);
      writeFeedbackPhotoCommonLocal(linkPayload, 'pending', 'student_link_failed');
      throw err;
    }
  }
}
async function handleKinderChatFeedbackPhotoChange(event) {
  const input = event && event.target ? event.target : document.getElementById('kcfPhotoInput');
  const file = input && input.files && input.files[0] ? input.files[0] : null;
  if (!file) return;
  if (file.type && !String(file.type).startsWith('image/')) {
    setKinderChatFeedbackWarning('사진 파일만 추가할 수 있어요.');
    if (input) input.value = '';
    return;
  }
  try {
    setKinderChatFeedbackWarning('');
    const image = await resizeKinderChatFeedbackPhoto(file, 1200, 0.78, 'feedback');
    const thumb = await resizeKinderChatFeedbackPhoto(file, 320, 0.72, 'thumb');
    kcfPendingPhoto = {
      originalName: file.name || '작품사진',
      imageFile: image.file,
      thumbnailFile: thumb.file,
      previewUrl: image.dataUrl,
      thumbnailUrl: thumb.dataUrl,
      imageWidth: image.width,
      imageHeight: image.height,
      fileSize: image.fileSize,
      mimeType: image.mimeType,
      imageOrder: 1,
      feedbackType: 'class',
      lessonTitle: '',
      monthKey: getTodayFeedbackDateKey().slice(0, 7),
      uploadStatus: 'pending',
      isDeleted: false
    };
    renderKinderChatFeedbackPhotoPreview();
    const textInput = document.getElementById('kcfInput');
    if (textInput) textInput.focus();
  } catch(err) {
    console.error('1분 피드백 사진 처리 오류:', err);
    setKinderChatFeedbackWarning(err.message || '사진을 추가하지 못했습니다.');
    clearKinderChatFeedbackPhoto();
  }
}
function clearKinderChatFeedbackPhoto() {
  kcfPendingPhoto = null;
  const input = document.getElementById('kcfPhotoInput');
  if (input) input.value = '';
  renderKinderChatFeedbackPhotoPreview();
}
function renderKinderChatFeedbackPhotoPreview() {
  const box = document.getElementById('kcfPhotoPreview');
  if (!box) return;
  if (!kcfPendingPhoto || !kcfPendingPhoto.thumbnailUrl) {
    box.classList.remove('show');
    box.innerHTML = '';
    return;
  }
  const name = kcfPendingPhoto.originalName || '작품사진';
  box.innerHTML = `<div class="kcfPhotoThumbWrap"><img src="${escapeHtml(kcfPendingPhoto.thumbnailUrl)}" alt="첨부 사진 미리보기"><button type="button" class="kcfPhotoRemoveBtn" onclick="clearKinderChatFeedbackPhoto()" aria-label="첨부 사진 삭제">×</button></div><div class="kcfPhotoMetaText">${escapeHtml(name)}</div>`;
  box.classList.add('show');
}
function getKinderChatFeedbackPhotoSnapshot() {
  if (!kcfPendingPhoto) return null;
  return {
    originalName: kcfPendingPhoto.originalName || '작품사진',
    thumbnailUrl: kcfPendingPhoto.thumbnailUrl || '',
    previewUrl: kcfPendingPhoto.previewUrl || '',
    imageWidth: kcfPendingPhoto.imageWidth || 0,
    imageHeight: kcfPendingPhoto.imageHeight || 0,
    fileSize: kcfPendingPhoto.fileSize || 0,
    mimeType: kcfPendingPhoto.mimeType || 'image/jpeg',
    imageOrder: kcfPendingPhoto.imageOrder || 1,
    feedbackType: kcfPendingPhoto.feedbackType || 'class',
    lessonTitle: kcfPendingPhoto.lessonTitle || '',
    monthKey: kcfPendingPhoto.monthKey || getTodayFeedbackDateKey().slice(0, 7),
    uploadStatus: kcfPendingPhoto.uploadStatus || 'pending',
    isDeleted: false
  };
}
function saveKinderChatFeedbackDraft() {
  const input = document.getElementById('kcfInput');
  if (!input) return;
  try {
    const value = String(input.value || '');
    if (value.trim()) localStorage.setItem(getKinderChatFeedbackDraftKey(), value);
    else localStorage.removeItem(getKinderChatFeedbackDraftKey());
  } catch(e) {}
}
function loadKinderChatFeedbackDraft() {
  const input = document.getElementById('kcfInput');
  if (!input) return;
  try {
    const saved = localStorage.getItem(getKinderChatFeedbackDraftKey()) || '';
    if (String(saved || '').trim()) input.value = saved;
    else {
      localStorage.removeItem(getKinderChatFeedbackDraftKey());
      if (!String(input.value || '').trim()) input.value = '';
    }
  } catch(e) {}
  autoResizeKinderChatFeedbackInput(input);
}
function clearKinderChatFeedbackDraft() {
  try { localStorage.removeItem(getKinderChatFeedbackDraftKey()); } catch(e) {}
}
function setKinderChatFeedbackWarning(message) {
  const el = document.getElementById('kcfInputWarning');
  if (!el) return;
  const text = String(message || '').trim();
  el.textContent = text;
  el.classList.toggle('show', !!text);
}
function parseKinderChatFeedbackInput(text) {
  const lines = String(text || '').split(/\n+/).map(v => v.trim()).filter(Boolean);
  const studentName = normalizeTodayFeedbackStudentName(lines[0] || '');
  const body = lines.slice(1).join('\n').trim();
  return { studentName, body, lines };
}
function typeKinderChatFeedbackBotMessage(bubble, messageText, area) {
  if (!bubble) return;
  const fullText = String(messageText || '');
  bubble.textContent = '';
  if (!fullText) return;
  let index = 0;
  const speed = fullText.length > 90 ? 14 : 20;
  const step = fullText.length > 90 ? 2 : 1;
  function drawNext() {
    index = Math.min(fullText.length, index + step);
    bubble.textContent = fullText.slice(0, index);
    if (area) area.scrollTop = area.scrollHeight;
    if (index < fullText.length) {
      setTimeout(drawNext, speed);
    }
  }
  drawNext();
}
function addKinderChatMessage(role, text) {
  const area = document.getElementById('kcfChatArea');
  if (!area) return;
  const intro = document.getElementById('kcfCenterIntro');
  if (intro) intro.classList.add('hidden');
  const row = document.createElement('div');
  row.className = `kcfMsgRow ${role === 'user' ? 'user' : 'bot'}`;
  const bubble = document.createElement('div');
  bubble.className = 'kcfBubble';
  const messageText = role === 'user' ? String(text || '') : String(text || '').replace(/^\s*(?:올리로그|올리)\s*\n?/, '').trim();
  if (role === 'user') {
    bubble.textContent = messageText;
  }
  row.appendChild(bubble);
  area.appendChild(row);
  if (role === 'user') {
    requestAnimationFrame(() => { area.scrollTop = area.scrollHeight; });
  } else {
    requestAnimationFrame(() => {
      area.scrollTop = area.scrollHeight;
      typeKinderChatFeedbackBotMessage(bubble, messageText, area);
    });
  }
}
async function copyKinderChatSourceCardText(btn, text) {
  const copyText = String(text || '').trim();
  if (!copyText) {
    showPushToast('복사할 내용이 없어요.');
    return;
  }

  const oldText = btn ? btn.textContent : '';
  let copied = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(copyText);
      copied = true;
    }
  } catch(e) {
    copied = false;
  }

  if (!copied) {
    try {
      const temp = document.createElement('textarea');
      temp.value = copyText;
      temp.setAttribute('readonly', '');
      temp.style.position = 'fixed';
      temp.style.left = '-9999px';
      temp.style.top = '0';
      document.body.appendChild(temp);
      temp.focus();
      temp.select();
      document.execCommand('copy');
      document.body.removeChild(temp);
      copied = true;
    } catch(e) {
      copied = false;
    }
  }

  if (copied) {
    if (btn) showOlliCopySuccess(btn, { restoreHtml: oldText || '복사하기', restoreDisabled: false });
  } else {
    showPushToast('복사에 실패했어요.');
  }
}

function addKinderChatDocumentMessage(title, subtitle, bodyText = '', variant = '', photoMeta = null) {
  const area = document.getElementById('kcfChatArea');
  if (!area) return;
  const intro = document.getElementById('kcfCenterIntro');
  if (intro) intro.classList.add('hidden');

  const row = document.createElement('div');
  row.className = 'kcfMsgRow user';

  const card = document.createElement('div');
  card.className = `kcfDocumentCard ${variant === 'growth' ? 'growth' : ''}`.trim();

  const cleanTitle = String(title || '아이 이름').trim();
  const cleanSubtitle = String(subtitle || '1분 피드백').trim();

  const photoThumbUrl = photoMeta && photoMeta.thumbnailUrl ? String(photoMeta.thumbnailUrl) : '';
  const iconHtml = photoThumbUrl
    ? `<span class="kcfDocumentIcon hasPhoto" aria-hidden="true"><img class="kcfDocumentPhotoThumb" src="${escapeHtml(photoThumbUrl)}" alt=""></span>`
    : `<span class="kcfDocumentIcon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 3.8h7.2L18 7.6V20a1.2 1.2 0 0 1-1.2 1.2H7.2A1.2 1.2 0 0 1 6 20V5a1.2 1.2 0 0 1 1-1.2z"></path><path d="M14 4v4h4"></path><path d="M9 12h6"></path><path d="M9 15h6"></path></svg></span>`;

  card.innerHTML = `${iconHtml}<span class="kcfDocumentText"><span class="kcfDocumentTitle">${escapeHtml(cleanTitle)}</span><span class="kcfDocumentSub">${escapeHtml(cleanSubtitle)}</span></span>`;

  row.appendChild(card);
  area.appendChild(row);
  requestAnimationFrame(() => { area.scrollTop = area.scrollHeight; });
}
function renderKinderChatFeedbackGuide(key) {
  const guide = document.getElementById('kcfQuestionGuide');
  if (!guide) return;
  const data = kcfKeywordQuestions[key];
  if (!data) {
    guide.innerHTML = '';
    guide.classList.remove('show');
    return;
  }
  const icon = '<svg class="kcfQuestionIcon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5"></circle><path d="M15 15l4 4"></path></svg>';
  guide.innerHTML = `<ul class="kcfQuestionList">${data.questions.map(q => `<li>${icon}<span class="kcfQuestionText">${escapeHtml(q)}</span></li>`).join('')}</ul>`;
  guide.classList.add('show');
}
function toggleKinderChatFeedbackKeyword(key, button) {
  const buttons = document.querySelectorAll('.kcfKeywordBtn');
  if (kcfActiveKeyword === key) {
    kcfActiveKeyword = '';
    buttons.forEach(btn => btn.classList.remove('active'));
    renderKinderChatFeedbackGuide('');
    return;
  }
  kcfActiveKeyword = key;
  buttons.forEach(btn => btn.classList.toggle('active', btn === button));
  renderKinderChatFeedbackGuide(key);
}
function clearKinderChatFeedbackKeyword() {
  kcfActiveKeyword = '';
  document.querySelectorAll('.kcfKeywordBtn').forEach(btn => btn.classList.remove('active'));
  renderKinderChatFeedbackGuide('');
}
async function submitKinderChatFeedback() {
  const input = document.getElementById('kcfInput');
  if (!input) return;
  const text = String(input.value || '').trim();
  if (!text) {
    setKinderChatFeedbackWarning('학생 이름과 관찰 내용을 적어주세요.');
    return;
  }
  const parsed = parseKinderChatFeedbackInput(text);
  if (!parsed.studentName || parsed.lines.length < 2) {
    setKinderChatFeedbackWarning('첫 줄에는 학생 이름을, 아래에는 관찰 내용을 적어주세요.');
    return;
  }
  setKinderChatFeedbackWarning('');
  const feedbackJobId = `fbjob_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let photoSnapshot = null;
  if (kcfPendingPhoto) {
    setKinderChatFeedbackWarning('사진을 저장하고 있어요.');
    try {
      photoSnapshot = await uploadKinderChatFeedbackPhotoToSupabase(kcfPendingPhoto, feedbackJobId, parsed.studentName);
      setKinderChatFeedbackWarning('');
    } catch (err) {
      setKinderChatFeedbackWarning(err.message || '사진을 저장하지 못했습니다.');
      return;
    }
  }
  addKinderChatDocumentMessage(parsed.studentName, '1분 피드백', parsed.body || text, 'minute', photoSnapshot);
  addKinderChatMessage('bot', '관찰 내용을 부모님께 잘 전달될 수 있도록 정리해둘게요.\n다음 학생 기록을 이어서 작성해 주세요.');
  startTodayFeedbackRequest({
    id: feedbackJobId,
    promptType:'class',
    userText: parsed.body || text,
    studentName: parsed.studentName,
    studentDivision:'kinder',
    feedbackType:'class',
    label:'유치부 1분 피드백',
    sourcePage:'kinderChatFeedback',
    silent:true,
    attachments: photoSnapshot ? [photoSnapshot] : []
  });
  input.value = '';
  clearKinderChatFeedbackPhoto();
  autoResizeKinderChatFeedbackInput(input);
  clearKinderChatFeedbackDraft();
  clearKinderChatFeedbackKeyword();
  updateKinderChatFeedbackBadge();
}
function getKinderChatFeedbackStatusLabel(status) {
  if (status === 'generating') return '정리 중';
  if (status === 'error') return '오류';
  if (status === 'review') return '확인 필요';
  return '도착';
}
function getKinderChatFeedbackAvatarSeed(item, fallbackName = '') {
  if (item && typeof item === 'object') {
    return String(item.id || item.createdAt || item.updatedAt || item.studentId || item.studentName || fallbackName || 'olli');
  }
  return String(item || fallbackName || 'olli');
}
function getKinderChatFeedbackAvatarHash(seed) {
  const text = String(seed || 'olli');
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i) * (i + 7)) % 1000003;
  }
  return Math.abs(hash);
}
function getKinderChatFeedbackAvatarIcon(item) {
  const seed = getKinderChatFeedbackAvatarSeed(item);
  const hash = getKinderChatFeedbackAvatarHash(seed);

  // 미술용품 전용 아이콘만 사용합니다.
  // 순서: 붓, 팔레트, 물감튜브, 크레파스, 연필, 지우개
  const icons = [
    // 붓
    `<svg viewBox="0 0 24 24" aria-hidden="true" class="artAvatarIcon artAvatarBrush">
      <path d="M14.7 4.6l4.7 4.7"></path>
      <path d="M5.4 18.8c1.9.3 3.7-.2 5-1.5l8.1-8.1-3.7-3.7-8.1 8.1c-1.3 1.3-1.8 3.1-1.3 5.2z"></path>
      <path d="M5.1 19l4.1-1.2"></path>
    </svg>`,

    // 팔레트
    `<svg viewBox="0 0 24 24" aria-hidden="true" class="artAvatarIcon artAvatarPalette">
      <path d="M12.1 4.7c-4.4 0-7.8 2.9-7.8 6.6 0 3.5 2.9 6 6.8 6.4.7.1 1.1.5 1.1 1.2 0 .8.7 1.3 1.6 1.1 3.6-.8 6-3.5 6-7.1 0-4.5-3.3-8.2-7.7-8.2z"></path>
      <circle cx="8.1" cy="10.4" r="1"></circle>
      <circle cx="11.3" cy="8.6" r="1"></circle>
      <circle cx="14.8" cy="10.2" r="1"></circle>
      <path d="M15.2 15.1h2.1"></path>
    </svg>`,

    // 물감 튜브
    `<svg viewBox="0 0 24 24" aria-hidden="true" class="artAvatarIcon artAvatarPaintTube">
      <path d="M8.4 5.2h7.2"></path>
      <path d="M9.1 5.2v2.4h5.8V5.2"></path>
      <path d="M8.7 7.6h6.6l2.4 9.1c.3 1.2-.6 2.3-1.8 2.3H8.1c-1.2 0-2.1-1.1-1.8-2.3l2.4-9.1z"></path>
      <path d="M8.2 14.2h7.6"></path>
      <path d="M10.2 16.6h3.6"></path>
    </svg>`,

    // 크레파스
    `<svg viewBox="0 0 24 24" aria-hidden="true" class="artAvatarIcon artAvatarCrayon">
      <path d="M6.1 8.7l2.6-2.6c.6-.6 1.6-.6 2.2 0l7 7c.6.6.6 1.6 0 2.2l-2.6 2.6c-.6.6-1.6.6-2.2 0l-7-7c-.6-.6-.6-1.6 0-2.2z"></path>
      <path d="M8.5 6.3l-1.9-1 1 1.9"></path>
      <path d="M10.2 9.6l4.2 4.2"></path>
      <path d="M12.4 7.4l4.2 4.2"></path>
    </svg>`,

    // 연필
    `<svg viewBox="0 0 24 24" aria-hidden="true" class="artAvatarIcon artAvatarPencil">
      <path d="M5.5 18.5l1.1-4.4 8.6-8.6 3.3 3.3-8.6 8.6-4.4 1.1z"></path>
      <path d="M14.1 6.6l3.3 3.3"></path>
      <path d="M6.6 14.1l3.3 3.3"></path>
      <path d="M5.5 18.5l2.6-.7-1.9-1.9-.7 2.6z"></path>
    </svg>`,

    // 지우개
    `<svg viewBox="0 0 24 24" aria-hidden="true" class="artAvatarIcon artAvatarEraser">
      <path d="M6.2 13.2l5.7-5.7c.8-.8 2-.8 2.8 0l3 3c.8.8.8 2 0 2.8L12 19H6.2v-5.8z"></path>
      <path d="M10.8 8.6l6.1 6.1"></path>
      <path d="M12 19h6.2"></path>
    </svg>`
  ];

  return icons[hash % icons.length];
}
function getKinderChatFeedbackAvatarColor(item) {
  const palette = ['#9BE7E8', '#FFD3B8', '#FFC5DB', '#9DDEF2', '#BFD9FF', '#E8B8FF', '#D7F3C8', '#FFE4A8'];
  const seed = getKinderChatFeedbackAvatarSeed(item);
  const hash = getKinderChatFeedbackAvatarHash(seed);
  return palette[hash % palette.length];
}
function getKinderChatFeedbackAvatarIconColor(item) {
  const colors = ['#1D6F73', '#9A5B24', '#A2446A', '#1B7790', '#2D6EA8', '#9D31C9', '#4C8440', '#9A6A12'];
  const seed = getKinderChatFeedbackAvatarSeed(item);
  const hash = getKinderChatFeedbackAvatarHash(seed);
  return colors[hash % colors.length];
}
function buildKinderChatFeedbackInboxCard(item) {
  const status = item.status || 'done';
  const text = status === 'generating'
    ? '올리가 피드백을 정리하고 있어요.'
    : (status === 'error' ? (item.errorMessage || '피드백 생성 중 오류가 발생했습니다.') : (item.resultText || ''));
  const canEdit = status === 'done' || status === 'review';
  const canDelete = true;
  const isLoadFail = isTodayFeedbackLoadFailItem(item);
  const canSave = status === 'done' && !isLoadFail && !getSuspiciousFeedbackSegments(item.resultText || '').length;
  const canCopy = canSave;
  const name = item.studentName || '학생';
  const avatarIcon = getKinderChatFeedbackAvatarIcon(item);
  const avatarColor = getKinderChatFeedbackAvatarColor(item);
  const avatarIconColor = getKinderChatFeedbackAvatarIconColor(item);
  const dateText = formatNotificationDate(item.updatedAt || item.createdAt);
  const labelText = String(item.label || '유치부 1분 피드백').replace(/^유치부\s*/, '') || '1분 피드백';
  const openMetaText = dateText ? `${labelText} · ${dateText}` : labelText;
  const renderedText = status === 'done' || status === 'review' ? renderSuspiciousFeedbackText(text) : escapeHtml(text);
  return `<div class="kcfInboxCard" data-kcf-feedback-id="${escapeHtml(item.id)}" onclick="toggleKinderChatFeedbackInboxItem('${escapeHtml(item.id)}')">
    <div class="kcfInboxTop">
      <div class="kcfInboxAvatar" style="background:${escapeHtml(avatarColor)}; color:${escapeHtml(avatarIconColor)};">${avatarIcon}</div>
      <div class="kcfInboxMain">
        <div class="kcfInboxMetaRow">
          <div class="kcfInboxName">${escapeHtml(name)}</div>
          <div class="kcfInboxStatus ${escapeHtml(status)}">${escapeHtml(getKinderChatFeedbackStatusLabel(status))}</div>
        </div>
        <div class="kcfInboxText" data-kcf-open-meta="${escapeHtml(openMetaText)}">${escapeHtml(openMetaText || getKinderChatFeedbackStatusLabel(status))}</div>
      </div>
    </div>
    <div class="kcfInboxFullText">${renderedText}</div>
    <textarea class="kcfInboxEditArea" onclick="event.stopPropagation()">${escapeHtml(item.resultText || '')}</textarea>
    ${buildTodayFeedbackIssueHtml(status === 'done' || status === 'review' ? getSuspiciousFeedbackSegments(item.resultText || '') : [])}
    <div class="kcfInboxActions" onclick="event.stopPropagation()">
      <div class="kcfInboxActionsLeft">
        <button type="button" class="todayFeedbackActionBtn kcfInboxActionBtn kcfInboxDeleteBtn" onclick="deleteKinderChatFeedbackInboxItem('${escapeHtml(item.id)}')"${canDelete ? '' : ' disabled'}>삭제</button>
      </div>
      <div class="kcfInboxActionsRight">
        <button type="button" class="todayFeedbackActionBtn kcfInboxActionBtn kcfInboxEditBtn" onclick="editKinderChatFeedbackInboxItem('${escapeHtml(item.id)}')"${canEdit ? '' : ' disabled'}>수정</button>
        <button type="button" class="todayFeedbackActionBtn kcfInboxActionBtn kcfInboxCopyBtn" onclick="copyAndSaveKinderChatFeedback('${escapeHtml(item.id)}', this)"${canCopy ? '' : ' disabled'}>복사 + 저장</button>
        <button type="button" class="todayFeedbackActionBtn kcfInboxActionBtn kcfInboxEditCancelBtn" onclick="cancelKinderChatFeedbackInboxEdit('${escapeHtml(item.id)}')" style="display:none;">취소</button>
        <button type="button" class="todayFeedbackActionBtn primary kcfInboxActionBtn kcfInboxEditDoneBtn" onclick="confirmKinderChatFeedbackInboxEdit('${escapeHtml(item.id)}')" style="display:none;">수정 완료</button>
      </div>
    </div>
  </div>`;
}
function toggleKinderChatFeedbackInboxItem(id) {
  const card = document.querySelector(`[data-kcf-feedback-id="${CSS.escape(id)}"]`);
  if (!card || card.classList.contains('editing')) return;
  const nextOpen = !card.classList.contains('open');
  card.classList.toggle('open', nextOpen);
}
function renderKinderChatFeedbackInbox() {
  const body = document.getElementById('kcfInboxBody');
  if (!body) return;
  const items = getKinderChatFeedbackItems();
  if (!items.length) {
    body.innerHTML = '<div class="kcfInboxEmpty">아직 받은 피드백이 없습니다.<br>관찰 내용을 보내면 이곳에 정리해둘게요.</div>';
    updateKinderChatFeedbackBadge();
    return;
  }
  const generating = items.filter(item => item.status === 'generating');
  const ready = items.filter(item => (item.status === 'done' || item.status === 'review') && !item.reviewed && !item.saved);
  const error = items.filter(item => item.status === 'error');
  const saved = items.filter(item => item.saved || item.reviewed);
  let html = '';
  if (generating.length) html += `<div class="kcfInboxSectionTitle">생성 중 ${generating.length}</div>` + generating.map(buildKinderChatFeedbackInboxCard).join('');
  if (ready.length) html += ready.map(buildKinderChatFeedbackInboxCard).join('');
  if (error.length) html += `<div class="kcfInboxSectionTitle">오류 ${error.length}</div>` + error.map(buildKinderChatFeedbackInboxCard).join('');
  if (saved.length) html += `<div class="kcfInboxSectionTitle">저장완료 ${saved.length}</div>` + saved.map(buildKinderChatFeedbackInboxCard).join('');
  body.innerHTML = html;
  updateKinderChatFeedbackBadge();
}
function openKinderChatFeedbackInbox() {
  renderKinderChatFeedbackInbox();
  const overlay = document.getElementById('kcfInboxOverlay');
  if (overlay) overlay.classList.add('show');
  saveKinderChatFeedbackDraft();
}
function closeKinderChatFeedbackInbox(event) {
  if (event && event.target && event.target.id !== 'kcfInboxOverlay') return;
  const overlay = document.getElementById('kcfInboxOverlay');
  if (overlay) overlay.classList.remove('show');
}
function editKinderChatFeedbackInboxItem(id) {
  const card = document.querySelector(`[data-kcf-feedback-id="${CSS.escape(id)}"]`);
  if (!card) return;
  card.classList.add('editing', 'open');
  const editBtn = card.querySelector('.kcfInboxEditBtn');
  const doneBtn = card.querySelector('.kcfInboxEditDoneBtn');
  const cancelBtn = card.querySelector('.kcfInboxEditCancelBtn');
  const deleteBtn = card.querySelector('.kcfInboxDeleteBtn');
  const copyBtn = card.querySelector('.kcfInboxCopyBtn');
  const saveBtn = card.querySelector('.kcfInboxSaveBtn');
  if (editBtn) editBtn.style.display = 'none';
  if (deleteBtn) deleteBtn.style.display = 'none';
  if (doneBtn) doneBtn.style.display = 'inline-flex';
  if (cancelBtn) cancelBtn.style.display = 'inline-flex';
  if (copyBtn) copyBtn.style.display = 'none';
  if (saveBtn) saveBtn.style.display = 'none';
  const textarea = card.querySelector('.kcfInboxEditArea');
  if (textarea) {
    const fitEditArea = () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    requestAnimationFrame(fitEditArea);
    textarea.oninput = fitEditArea;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }
}
function cancelKinderChatFeedbackInboxEdit(id) {
  renderKinderChatFeedbackInbox();
}
function deleteKinderChatFeedbackInboxItem(id) {
  const item = getTodayFeedbackItemById(id);
  const name = String(item?.studentName || '이 피드백').trim();
  const ok = window.confirm(`${name} 피드백을 정말 삭제할까요?\n삭제하면 임시 보관함에서 사라집니다.`);
  if (!ok) return;

  const list = getTodayFeedbackItemsRaw().filter(item => !(item && item.id === id));
  setTodayFeedbackItemsRaw(list);
  renderKinderChatFeedbackInbox();
  updateKinderChatFeedbackBadge();
  try { showPushToast('피드백을 삭제했어요.'); } catch(e) {}
}
async function writeKinderChatFeedbackClipboard(text) {
  const content = String(text || '').trim();
  if (!content) return false;

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(content);
      return true;
    }
  } catch(e) {}

  try {
    const temp = document.createElement('textarea');
    temp.value = content;
    temp.setAttribute('readonly', '');
    temp.style.position = 'fixed';
    temp.style.left = '-9999px';
    temp.style.top = '0';
    document.body.appendChild(temp);
    temp.focus();
    temp.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(temp);
    return !!ok;
  } catch(e) {
    return false;
  }
}

async function copyAndSaveKinderChatFeedback(id, btn, selectedStudentId = '') {
  const item = getTodayFeedbackItemById(id);
  if (!item || !item.resultText) return false;

  const reason = getTodayFeedbackExportBlockReason(item);
  if (reason) {
    showPushToast(reason);
    return false;
  }

  const oldText = btn ? (btn.textContent || '복사 + 저장') : '복사 + 저장';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '복사 중...';
  }

  const copied = await writeKinderChatFeedbackClipboard(item.resultText);
  if (!copied) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = oldText;
    }
    showPushToast('복사에 실패했어요.');
    return false;
  }

  if (item.saved || item.reviewed) {
    if (btn) showOlliCopySuccess(btn, { restoreHtml: '저장완료', restoreDisabled: false });
    showPushToast('이미 기록실에 저장된 피드백입니다.');
    return true;
  }

  if (btn) btn.textContent = '저장 중...';
  const saved = await saveTodayFeedbackItem(id, btn || null, selectedStudentId);

  if (btn) {
    btn.disabled = false;
    btn.textContent = saved === true ? '저장완료' : oldText;
  }

  if (saved === true) {
    if (btn) showOlliCopySuccess(btn, { restoreHtml: '저장완료', restoreDisabled: false });
    showPushToast('피드백을 저장했어요.');
  } else if (saved === null) {
    if (btn) showOlliCopySuccess(btn, { restoreHtml: oldText, restoreDisabled: false });
    showPushToast('피드백을 복사했어요. 저장할 학생을 선택해 주세요.');
  } else {
    if (btn) showOlliCopySuccess(btn, { restoreHtml: oldText, restoreDisabled: false });
    showPushToast('피드백은 복사했지만 기록실 저장은 확인이 필요해요.');
  }

  return saved;
}

async function confirmKinderChatFeedbackInboxEdit(id) {
  const card = document.querySelector(`[data-kcf-feedback-id="${CSS.escape(id)}"]`);
  const textarea = card?.querySelector?.('.kcfInboxEditArea');
  if (!textarea) return;
  const nextText = String(textarea.value || '').trim();
  if (!nextText) {
    setKinderChatFeedbackWarning('수정할 피드백 내용이 비어 있어요.');
    return;
  }
  const segments = getSuspiciousFeedbackSegments(nextText);
  const nextStatus = segments.length ? 'review' : 'done';
  const originalItem = getTodayFeedbackItemById(id);
  const wasServerSaved = !!(originalItem && (originalItem.saved || originalItem.reviewed));
  const savedRecordId = getTodayFeedbackSavedRowId(originalItem || {});
  let patchedSavedRow = null;
  if (wasServerSaved) {
    if (!savedRecordId) {
      setKinderChatFeedbackWarning('이미 저장된 피드백의 서버 ID를 찾지 못해 수정 저장을 할 수 없습니다.');
      return;
    }
    try {
      patchedSavedRow = await patchSavedTodayFeedbackItem(originalItem, nextText);
    } catch (err) {
      console.error('저장된 1분 피드백 수정 오류:', err);
      setKinderChatFeedbackWarning(`수정 저장 중 오류가 발생했어요. ${err.message || ''}`.trim());
      return;
    }
  }
  const list = getTodayFeedbackItemsRaw();
  let updatedItem = null;
  let changed = false;
  const now = new Date().toISOString();
  const nextList = list.map(item => {
    if (!item || item.id !== id) return item;
    changed = true;
    updatedItem = {
      ...item,
      resultText: nextText,
      suspiciousSegments: segments,
      status: nextStatus,
      reviewed: wasServerSaved ? true : false,
      saved: wasServerSaved ? true : false,
      savedRowId: wasServerSaved ? (savedRecordId || item.savedRowId || '') : (item.savedRowId || ''),
      savedSourceTable: wasServerSaved ? getTodayFeedbackSavedSourceTable(item) : (item.savedSourceTable || ''),
      savedStudentId: wasServerSaved ? (item.savedStudentId || item.studentId || '') : (item.savedStudentId || ''),
      savedAcademyId: wasServerSaved ? (item.savedAcademyId || (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '')) : (item.savedAcademyId || ''),
      savedRow: wasServerSaved ? { ...(item.savedRow || {}), ...(patchedSavedRow || {}), content: nextText } : item.savedRow,
      updatedAt: now
    };
    return updatedItem;
  });
  if (!changed) return;
  setTodayFeedbackItemsRaw(nextList);
  try { updateNotificationButtons(); } catch(e) {}
  try { renderTodayFeedbackPage(); } catch(e) {}
  try { updateKinderChatFeedbackBadge(); } catch(e) {}
  if (card) {
    card.classList.remove('editing');
    card.classList.add('open');
    const avatarEl = card.querySelector('.kcfInboxAvatar');
    const preview = card.querySelector('.kcfInboxText');
    const full = card.querySelector('.kcfInboxFullText');
    const statusEl = card.querySelector('.kcfInboxStatus');
    const issueBox = card.querySelector('.todayFeedbackIssueBox');
    const actions = card.querySelector('.kcfInboxActions');
    const editBtn = card.querySelector('.kcfInboxEditBtn');
    const doneBtn = card.querySelector('.kcfInboxEditDoneBtn');
    const cancelBtn = card.querySelector('.kcfInboxEditCancelBtn');
    const deleteBtn = card.querySelector('.kcfInboxDeleteBtn');
    const copyBtn = card.querySelector('.kcfInboxCopyBtn');
    const saveBtn = card.querySelector('.kcfInboxSaveBtn');
    const labelText = String(updatedItem?.label || '유치부 1분 피드백').replace(/^유치부\s*/, '') || '1분 피드백';
    const dateText = formatNotificationDate(updatedItem?.updatedAt || updatedItem?.createdAt);
    const openMetaText = dateText ? `${labelText} · ${dateText}` : labelText;
    if (avatarEl) avatarEl.style.display = 'none';
    if (preview) {
      preview.dataset.kcfPreviewText = nextText;
      preview.dataset.kcfOpenMeta = openMetaText;
      preview.textContent = openMetaText;
      preview.style.fontSize = 'calc(12px * var(--olli-text-scale))';
      preview.style.lineHeight = '1.35';
      preview.style.color = '#999';
    }
    if (full) full.innerHTML = renderSuspiciousFeedbackText(nextText);
    if (textarea) textarea.value = nextText;
    if (statusEl) {
      statusEl.className = `kcfInboxStatus ${nextStatus}`;
      statusEl.textContent = getKinderChatFeedbackStatusLabel(nextStatus);
    }
    if (issueBox) issueBox.remove();
    const issueHtml = buildTodayFeedbackIssueHtml(segments);
    if (issueHtml && actions) actions.insertAdjacentHTML('beforebegin', issueHtml);
    if (editBtn) editBtn.style.display = 'inline-flex';
    if (deleteBtn) deleteBtn.style.display = 'inline-flex';
    if (doneBtn) doneBtn.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (copyBtn) {
      copyBtn.style.display = 'inline-flex';
      copyBtn.disabled = !!segments.length;
    }
    if (saveBtn) {
      saveBtn.style.display = 'inline-flex';
      saveBtn.disabled = !!segments.length;
    }
  }
}

let kcfPendingSaveStudentPicker = { itemId:'', selectedStudentId:'' };
function getKinderChatFeedbackSaveStudentCandidates(studentName, studentDivision = 'elementary') {
  const name = String(studentName || '').trim();
  const type = studentDivision === 'kinder' ? 'kinder' : 'elementary';
  if (!name || typeof getAllStudents !== 'function') return [];
  return getAllStudents().filter(student =>
    String(student.name || '').trim() === name &&
    (student.type || 'elementary') === type
  );
}
function getKinderChatFeedbackStudentMetaLine(student = {}) {
  const parts = [
    student.kindergarten || student.kindergartenName || student.school || student.kinder || '',
    student.age || student.studentAge || student.birthAge || '',
    student.teacher || student.homeroom_teacher || student.homeroomTeacher || student.teacherName || '',
    student.lesson_day || student.lessonDay || student.days || student.day || ''
  ].map(value => String(value || '').trim()).filter(Boolean);
  return parts.length ? parts.join(' · ') : '학생정보 없음';
}
function openKinderChatFeedbackSaveStudentPicker(itemId, candidates = []) {
  const overlay = document.getElementById('kcfSaveStudentPickerOverlay');
  const list = document.getElementById('kcfSaveStudentPickerList');
  if (!overlay || !list || !candidates.length) return;
  kcfPendingSaveStudentPicker = { itemId:String(itemId || ''), selectedStudentId:String(candidates[0].id || '') };
  list.innerHTML = candidates.map((student, index) => {
    const id = String(student.id || '');
    const active = index === 0 ? ' active' : '';
    return `<button type="button" class="kcfSaveStudentOption${active}" data-student-id="${escapeHtml(id)}" onclick="selectKinderChatFeedbackSaveStudent('${escapeHtml(id)}')">
      <span class="kcfSaveStudentCheck" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"></path></svg></span>
      <span><span class="kcfSaveStudentName">${escapeHtml(student.name || '')}</span><span class="kcfSaveStudentMeta">${escapeHtml(getKinderChatFeedbackStudentMetaLine(student))}</span></span>
    </button>`;
  }).join('');
  overlay.classList.add('show');
}
function selectKinderChatFeedbackSaveStudent(studentId) {
  kcfPendingSaveStudentPicker.selectedStudentId = String(studentId || '');
  document.querySelectorAll('#kcfSaveStudentPickerOverlay .kcfSaveStudentOption').forEach(btn => {
    btn.classList.toggle('active', String(btn.dataset.studentId || '') === String(studentId || ''));
  });
}
function closeKinderChatFeedbackSaveStudentPicker(event) {
  if (event && event.target && event.target.id !== 'kcfSaveStudentPickerOverlay') return;
  const overlay = document.getElementById('kcfSaveStudentPickerOverlay');
  if (overlay) overlay.classList.remove('show');
}
function confirmKinderChatFeedbackSaveStudentPicker() {
  const itemId = kcfPendingSaveStudentPicker.itemId;
  const selectedId = kcfPendingSaveStudentPicker.selectedStudentId;
  closeKinderChatFeedbackSaveStudentPicker();
  if (itemId && selectedId) saveTodayFeedbackItem(itemId, null, selectedId);
}

if (!window.__kcfInboxRetentionTimer) {
  window.__kcfInboxRetentionTimer = setInterval(() => {
    if (typeof pruneExpiredKinderChatFeedbackItems === 'function' && pruneExpiredKinderChatFeedbackItems()) {
      try { renderKinderChatFeedbackInbox(); } catch(e) {}
      try { updateKinderChatFeedbackBadge(); } catch(e) {}
    }
  }, 15 * 60 * 1000);
}


function getEmptyElementaryGrowthFeedbackState() {
  return { A2:'', A2_1:'', A3:[], A4:[], A5:[], A6:[], A7:[], A8:[], A9:[], A10:'', A11:[], A12:'', A13:'' };
}
let elementaryGrowthState = getEmptyElementaryGrowthFeedbackState();
let elementaryGrowthRendered = false;
function buildElementaryGrowthFeedbackChip(field, value, label, multi=false) {
  return `<button type="button" class="kcfGrowthChip" data-elementary-growth-field="${escapeHtml(field)}" data-elementary-growth-value="${escapeHtml(value)}" onclick="${multi ? 'toggleElementaryGrowthFeedbackMulti' : 'selectElementaryGrowthFeedbackSingle'}('${escapeHtml(field)}','${escapeHtml(value)}')">${escapeHtml(value)}. ${escapeHtml(label)}</button>`;
}
function renderElementaryGrowthFeedbackOptions() {
  const multiFields = new Set(['A3','A4','A5','A6','A7','A8','A9','A11']);
  Object.keys(FAIL_SURVEY_OPTIONS || {}).forEach(field => {
    if (field === 'A2_1') return;
    const grid = document.getElementById('ecfg' + field + 'Grid');
    if (!grid) return;
    grid.innerHTML = FAIL_SURVEY_OPTIONS[field].map(([value, label]) => buildElementaryGrowthFeedbackChip(field, value, label, multiFields.has(field))).join('');
  });
  elementaryGrowthRendered = true;
  renderElementaryGrowthFeedbackSubOptions();
  syncElementaryGrowthFeedbackChips();
}
function renderElementaryGrowthFeedbackSubOptions() {
  const grid = document.getElementById('ecfgA2SubGrid');
  if (!grid) return;
  const options = (FAIL_SURVEY_OPTIONS.A2_1 || {})[elementaryGrowthState.A2] || [];
  grid.innerHTML = options.length ? options.map(([value, label]) => buildElementaryGrowthFeedbackChip('A2_1', value, label, false)).join('') : '<span style="font-size:calc(12px * var(--olli-text-scale));color:#aaa;">A2 활동을 먼저 선택해 주세요.</span>';
}
function syncElementaryGrowthFeedbackChips() {
  document.querySelectorAll('#elementaryGrowthOverlay .kcfGrowthChip').forEach(btn => {
    const field = btn.dataset.elementaryGrowthField;
    const value = btn.dataset.elementaryGrowthValue;
    const current = elementaryGrowthState[field];
    const active = Array.isArray(current) ? current.includes(value) : current === value;
    btn.classList.toggle('active', active);
  });
  syncElementaryGrowthFeedbackOtherInputs();
}
function selectElementaryGrowthFeedbackSingle(field, value) {
  elementaryGrowthState[field] = elementaryGrowthState[field] === value ? '' : value;
  if (field === 'A2') {
    elementaryGrowthState.A2_1 = '';
    renderElementaryGrowthFeedbackSubOptions();
  }
  syncElementaryGrowthFeedbackChips();
}
function toggleElementaryGrowthFeedbackMulti(field, value) {
  const max = FAIL_SURVEY_MULTI_MAX[field] || 3;
  const list = Array.isArray(elementaryGrowthState[field]) ? [...elementaryGrowthState[field]] : [];
  const idx = list.indexOf(value);
  if (idx >= 0) list.splice(idx, 1);
  else {
    if (list.length >= max) {
      showPushToast(`최대 ${max}개까지 선택할 수 있어요.`);
      return;
    }
    list.push(value);
  }
  elementaryGrowthState[field] = list;
  syncElementaryGrowthFeedbackChips();
}
function getElementaryGrowthFeedbackOptionLabel(field, value, state = elementaryGrowthState) {
  if (!value) return '';
  const options = field === 'A2_1' ? ((FAIL_SURVEY_OPTIONS.A2_1 || {})[state.A2] || []) : (FAIL_SURVEY_OPTIONS[field] || []);
  const found = Array.isArray(options) ? options.find(([v]) => String(v) === String(value)) : null;
  return found ? found[1] : '';
}
function elementaryGrowthFeedbackFieldHasOtherSelected(field) {
  const value = elementaryGrowthState[field];
  const selected = Array.isArray(value) ? value : (value ? [value] : []);
  return selected.some(v => String(getElementaryGrowthFeedbackOptionLabel(field, v, elementaryGrowthState)).includes('기타'));
}
function syncElementaryGrowthFeedbackOtherInputs() {
  ['A2','A2_1','A3','A4','A5','A6','A7','A8','A9','A10','A11','A12','A13'].forEach(field => {
    const input = document.getElementById(`ecfg${field}Other`);
    if (!input) return;
    const show = elementaryGrowthFeedbackFieldHasOtherSelected(field);
    input.classList.toggle('show', show);
    if (!show) input.value = '';
  });
}
function getElementaryGrowthFeedbackOutputValue(field) {
  const value = elementaryGrowthState[field];
  const base = Array.isArray(value)
    ? value.map(v => getElementaryGrowthFeedbackOptionLabel(field, v, elementaryGrowthState)).filter(Boolean).join(', ')
    : getElementaryGrowthFeedbackOptionLabel(field, value, elementaryGrowthState);
  const other = document.getElementById(`ecfg${field}Other`)?.value.trim() || '';
  if (other && elementaryGrowthFeedbackFieldHasOtherSelected(field)) return base ? `${base} / 기타: ${other}` : `기타: ${other}`;
  return base;
}
function buildElementaryGrowthFeedbackUserText() {
  const name = document.getElementById('ecfgA1')?.value.trim() || '';
  const memo = document.getElementById('ecfgA14')?.value.trim() || '없음';
  const fieldLabels = {
    A2:'활동', A2_1:'하위상황', A3:'실패유형', A4:'첫반응 - 몸', A5:'첫반응 - 말', A6:'첫반응 - 시선', A7:'실패원인', A8:'교사개입', A9:'회복전환', A10:'회복결과', A11:'다음목표', A12:'위험태그', A13:'수업후상태'
  };
  const lines = ['[초등부 성장피드백 설문 정리]'];
  if (name) lines.push('아이 이름: ' + name);
  lines.push('피드백 기준 월: ' + getFeedbackMonthLabel());
  Object.keys(fieldLabels).forEach(field => {
    const value = getElementaryGrowthFeedbackOutputValue(field);
    if (value) lines.push(`${fieldLabels[field]}: ${value}`);
  });
  lines.push('추가메모: ' + memo);
  return lines.join('\n');
}
function resetElementaryGrowthFeedbackSheet() {
  elementaryGrowthState = getEmptyElementaryGrowthFeedbackState();
  const nameInput = document.getElementById('ecfgA1');
  const memoInput = document.getElementById('ecfgA14');
  const body = document.getElementById('elementaryGrowthBody');
  if (nameInput) nameInput.value = '';
  if (memoInput) memoInput.value = '';
  document.querySelectorAll('#elementaryGrowthOverlay .kcfGrowthOtherInput').forEach(input => { input.value = ''; input.classList.remove('show'); });
  if (body) body.scrollTop = 0;
  renderElementaryGrowthFeedbackSubOptions();
  syncElementaryGrowthFeedbackChips();
}
function openElementaryGrowthFeedbackSheet() {
  if (!currentMemoStudent || currentMemoType !== 'elementary') return;
  if (!elementaryGrowthRendered) renderElementaryGrowthFeedbackOptions();
  const nameInput = document.getElementById('ecfgA1');
  const memoInput = document.getElementById('ecfgA14');
  if (nameInput) nameInput.value = currentMemoStudent.name || '';
  if (memoInput && !memoInput.value.trim()) {
    const memoText = document.getElementById('memoEditor')?.value.trim() || getMemoByStudent(currentMemoStudent).trim();
    if (memoText) memoInput.value = memoText;
  }
  const overlay = document.getElementById('elementaryGrowthOverlay');
  if (overlay) overlay.classList.add('show');
}
function closeElementaryGrowthFeedbackSheet(event) {
  if (event && event.target && event.target.id !== 'elementaryGrowthOverlay') return;
  const overlay = document.getElementById('elementaryGrowthOverlay');
  if (overlay) overlay.classList.remove('show');
  resetElementaryGrowthFeedbackSheet();
}
function submitElementaryGrowthFeedbackSheet() {
  try {
    const userText = buildElementaryGrowthFeedbackUserText();
    const hasMeaningful = userText.replace('[초등부 성장피드백 설문 정리]', '').replace(/추가메모:\s*없음/g, '').trim();
    if (!hasMeaningful) {
      showPushToast('성장피드백 내용을 먼저 선택하거나 입력해 주세요.');
      return;
    }
    const name = document.getElementById('ecfgA1')?.value.trim() || currentMemoStudent?.name || '';
    if (!name) {
      alert('아이 이름을 입력해 주세요.');
      return;
    }
    closeElementaryGrowthFeedbackSheet();
    requestSceneCardFeedbackFromElementary(name, userText, '', {
      promptType:'fail',
      feedbackType:'fail',
      feedbackMonth: getFeedbackMonthLabel(),
      feedbackMonthNumber: getFeedbackMonthNumber()
    });
  } catch (error) {
    console.error('submitElementaryGrowthFeedbackSheet failed', error);
    showPushToast('성장피드백 생성 중 오류가 생겼어요.');
  }
}


function getEmptyKinderChatFeedbackGrowthState() {
  return { A2:'', A2_1:'', A3:[], A4:[], A5:[], A6:[], A7:[], A8:[], A9:[], A10:'', A11:[], A12:'', A13:'' };
}
let kcfGrowthState = getEmptyKinderChatFeedbackGrowthState();
let kcfGrowthRendered = false;
function buildKinderChatFeedbackGrowthChip(field, value, label, multi=false) {
  return `<button type="button" class="kcfGrowthChip" data-kcf-growth-field="${escapeHtml(field)}" data-kcf-growth-value="${escapeHtml(value)}" onclick="${multi ? 'toggleKinderChatFeedbackGrowthMulti' : 'selectKinderChatFeedbackGrowthSingle'}('${escapeHtml(field)}','${escapeHtml(value)}')">${escapeHtml(value)}. ${escapeHtml(label)}</button>`;
}
function renderKinderChatFeedbackGrowthOptions() {
  const multiFields = new Set(['A3','A4','A5','A6','A7','A8','A9','A11']);
  Object.keys(FAIL_SURVEY_OPTIONS || {}).forEach(field => {
    if (field === 'A2_1') return;
    const grid = document.getElementById('kcfg' + field + 'Grid');
    if (!grid) return;
    grid.innerHTML = FAIL_SURVEY_OPTIONS[field].map(([value, label]) => buildKinderChatFeedbackGrowthChip(field, value, label, multiFields.has(field))).join('');
  });
  kcfGrowthRendered = true;
  renderKinderChatFeedbackGrowthSubOptions();
  syncKinderChatFeedbackGrowthChips();
}
function renderKinderChatFeedbackGrowthSubOptions() {
  const grid = document.getElementById('kcfgA2SubGrid');
  if (!grid) return;
  const options = (FAIL_SURVEY_OPTIONS.A2_1 || {})[kcfGrowthState.A2] || [];
  grid.innerHTML = options.length ? options.map(([value, label]) => buildKinderChatFeedbackGrowthChip('A2_1', value, label, false)).join('') : '<span style="font-size:calc(12px * var(--olli-text-scale));color:#aaa;">A2 활동을 먼저 선택해 주세요.</span>';
}
function syncKinderChatFeedbackGrowthChips() {
  document.querySelectorAll('.kcfGrowthOverlay .kcfGrowthChip').forEach(btn => {
    const field = btn.dataset.kcfGrowthField;
    const value = btn.dataset.kcfGrowthValue;
    const current = kcfGrowthState[field];
    const active = Array.isArray(current) ? current.includes(value) : current === value;
    btn.classList.toggle('active', active);
  });
  syncKinderChatFeedbackGrowthOtherInputs();
}
function selectKinderChatFeedbackGrowthSingle(field, value) {
  kcfGrowthState[field] = kcfGrowthState[field] === value ? '' : value;
  if (field === 'A2') {
    kcfGrowthState.A2_1 = '';
    renderKinderChatFeedbackGrowthSubOptions();
  }
  syncKinderChatFeedbackGrowthChips();
}
function toggleKinderChatFeedbackGrowthMulti(field, value) {
  const max = FAIL_SURVEY_MULTI_MAX[field] || 3;
  const list = Array.isArray(kcfGrowthState[field]) ? [...kcfGrowthState[field]] : [];
  const idx = list.indexOf(value);
  if (idx >= 0) list.splice(idx, 1);
  else {
    if (list.length >= max) list.shift();
    list.push(value);
  }
  kcfGrowthState[field] = list;
  syncKinderChatFeedbackGrowthChips();
}
function getKinderChatFeedbackGrowthOptionLabel(field, value, state = kcfGrowthState) {
  if (!value) return '';
  if (field === 'A2_1') {
    const parent = state?.A2 || kcfGrowthState.A2;
    const subOptions = (FAIL_SURVEY_OPTIONS.A2_1 || {})[parent] || [];
    const found = subOptions.find(([v]) => String(v) === String(value));
    return found ? found[1] : '';
  }
  const options = FAIL_SURVEY_OPTIONS[field] || [];
  const found = Array.isArray(options) ? options.find(([v]) => String(v) === String(value)) : null;
  return found ? found[1] : '';
}
function kinderChatFeedbackGrowthFieldHasOtherSelected(field) {
  const value = kcfGrowthState[field];
  const selected = Array.isArray(value) ? value : (value ? [value] : []);
  return selected.some(v => String(getKinderChatFeedbackGrowthOptionLabel(field, v, kcfGrowthState)).includes('기타'));
}
function syncKinderChatFeedbackGrowthOtherInputs() {
  ['A2','A2_1','A3','A4','A5','A6','A7','A8','A9','A10','A11','A12','A13'].forEach(field => {
    const input = document.getElementById(`kcfg${field}Other`);
    if (!input) return;
    const show = kinderChatFeedbackGrowthFieldHasOtherSelected(field);
    input.classList.toggle('show', show);
    if (!show) input.value = '';
  });
}
function getKinderChatFeedbackGrowthOutputValue(field) {
  const value = kcfGrowthState[field];
  const base = Array.isArray(value)
    ? value.map(v => getKinderChatFeedbackGrowthOptionLabel(field, v, kcfGrowthState)).filter(Boolean).join(', ')
    : getKinderChatFeedbackGrowthOptionLabel(field, value, kcfGrowthState);
  const other = document.getElementById(`kcfg${field}Other`)?.value.trim() || '';
  if (other && kinderChatFeedbackGrowthFieldHasOtherSelected(field)) return base ? `${base} / 기타: ${other}` : `기타: ${other}`;
  return base;
}
function buildKinderChatFeedbackGrowthUserText() {
  const name = document.getElementById('kcfgA1')?.value.trim() || '';
  const memo = document.getElementById('kcfgA14')?.value.trim() || '없음';
  const fieldLabels = {
    A2:'활동', A2_1:'하위상황', A3:'실패유형', A4:'첫반응 - 몸', A5:'첫반응 - 말', A6:'첫반응 - 시선', A7:'실패원인', A8:'교사개입', A9:'회복전환', A10:'회복결과', A11:'다음목표', A12:'위험태그', A13:'수업후상태'
  };
  const lines = ['[실패·성장 설문 정리]'];
  if (name) lines.push('아이 이름: ' + name);
  Object.keys(fieldLabels).forEach(field => {
    const value = getKinderChatFeedbackGrowthOutputValue(field);
    if (value) lines.push(`${fieldLabels[field]}: ${value}`);
  });
  lines.push('추가메모: ' + memo);
  return lines.join('\n');
}
function resetKinderChatFeedbackGrowthSheet() {
  kcfGrowthState = getEmptyKinderChatFeedbackGrowthState();
  const nameInput = document.getElementById('kcfgA1');
  const memoInput = document.getElementById('kcfgA14');
  const body = document.getElementById('kcfGrowthBody');
  if (nameInput) nameInput.value = '';
  if (memoInput) memoInput.value = '';
  document.querySelectorAll('.kcfGrowthOverlay .kcfGrowthOtherInput').forEach(input => { input.value = ''; input.classList.remove('show'); });
  if (body) body.scrollTop = 0;
  renderKinderChatFeedbackGrowthSubOptions();
  syncKinderChatFeedbackGrowthChips();
}
function openKinderChatFeedbackGrowthSheet() {
  if (!kcfGrowthRendered) renderKinderChatFeedbackGrowthOptions();
  const overlay = document.getElementById('kcfGrowthOverlay');
  if (overlay) overlay.classList.add('show');
  saveKinderChatFeedbackDraft();
}
function closeKinderChatFeedbackGrowthSheet(event) {
  if (event && event.target && event.target.id !== 'kcfGrowthOverlay') return;
  const overlay = document.getElementById('kcfGrowthOverlay');
  if (overlay) overlay.classList.remove('show');
  resetKinderChatFeedbackGrowthSheet();
}
function submitKinderChatFeedbackGrowthSheet() {
  try {
    const userText = buildKinderChatFeedbackGrowthUserText();
    const hasMeaningful = userText.replace('[실패·성장 설문 정리]', '').replace(/추가메모:\s*없음/g, '').trim();
    if (!hasMeaningful) {
      setKinderChatFeedbackWarning('성장 피드백 내용을 먼저 선택하거나 입력해 주세요.');
      return;
    }
    const name = document.getElementById('kcfgA1')?.value.trim() || '';
  if (!name) {
    alert('아이 이름을 입력해 주세요.');
    return;
  }
    closeKinderChatFeedbackGrowthSheet();
    addKinderChatDocumentMessage(name, '성장 피드백', '성장 피드백 설문', 'growth');
    addKinderChatMessage('bot', '성장 피드백 내용을 부모님께 잘 전달될 수 있도록 정리해둘게요.');
    startTodayFeedbackRequest({
      promptType:'fail',
      userText,
      studentName: normalizeTodayFeedbackStudentName(name),
      studentDivision:'kinder',
      feedbackType:'fail',
      label:'유치부 성장 피드백',
      sourcePage:'kinderChatFeedback',
      silent:true
    });
    resetKinderChatFeedbackGrowthSheet();
    updateKinderChatFeedbackBadge();
  } catch (error) {
    console.error('submitKinderChatFeedbackGrowthSheet failed', error);
    setKinderChatFeedbackWarning('성장 피드백 생성 중 오류가 생겼어요. 다시 확인해 주세요.');
    try { showPushToast('성장 피드백 생성 중 오류가 생겼어요.'); } catch(e) {}
  }
}
document.addEventListener('DOMContentLoaded', () => {
  bindKinderChatFeedbackKeyboardOffset();
  const input = document.getElementById('kcfInput');
  if (input) {
    loadKinderChatFeedbackDraft();
    input.addEventListener('focus', () => {
      requestAnimationFrame(updateKinderChatFeedbackKeyboardOffset);
      setTimeout(updateKinderChatFeedbackKeyboardOffset, 80);
      setTimeout(updateKinderChatFeedbackKeyboardOffset, 260);
    });
    input.addEventListener('blur', () => {
      if (Date.now() < kcfKeepInputFocusUntil) {
        setTimeout(() => {
          const currentInput = document.getElementById('kcfInput');
          if (currentInput) currentInput.focus({ preventScroll:true });
          updateKinderChatFeedbackKeyboardOffset();
        }, 0);
        return;
      }
      setTimeout(updateKinderChatFeedbackKeyboardOffset, 120);
    });
    input.addEventListener('input', () => {
      autoResizeKinderChatFeedbackInput(input);
      saveKinderChatFeedbackDraft();
      setKinderChatFeedbackWarning('');
    });
    input.addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        submitKinderChatFeedback();
      }
    });
  }
  document.querySelectorAll('.kcfKeywordBtn').forEach(btn => {
    btn.setAttribute('tabindex', '-1');
    const keepInputAlive = event => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      const currentInput = document.getElementById('kcfInput');
      if (currentInput && document.activeElement === currentInput) {
        kcfKeepInputFocusUntil = Date.now() + 1400;
        updateKinderChatFeedbackKeyboardOffset();
      }
    };
    const activateKeyword = event => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      const currentInput = document.getElementById('kcfInput');
      if (currentInput && document.activeElement === currentInput) {
        kcfKeepInputFocusUntil = Date.now() + 1400;
      }
      toggleKinderChatFeedbackKeyword(btn.getAttribute('data-kcf-keyword'), btn);
      requestAnimationFrame(updateKinderChatFeedbackKeyboardOffset);
      setTimeout(updateKinderChatFeedbackKeyboardOffset, 80);
      setTimeout(updateKinderChatFeedbackKeyboardOffset, 220);
    };
    btn.addEventListener('pointerdown', keepInputAlive);
    btn.addEventListener('click', activateKeyword);
  });
  document.addEventListener('click', event => {
    if (!event.target.closest || !event.target.closest('.kcfHeaderCenter')) closeKinderChatFeedbackModeMenu();
  });
  updateKinderChatFeedbackBadge();
});

let kcfStudentManageMode = false;
let kcfStudentManageSortDay = '';
const KCF_STUDENT_MANAGE_DAYS = ['월','화','수','목','금','토','일'];

function isKinderChatFeedbackStudentManageMode() {
  return kcfStudentManageMode === true;
}

function getKinderChatFeedbackStudentManageStudents() {
  let students = typeof getStudentsByType === 'function' ? getStudentsByType('kinder') : [];
  if (kcfStudentManageSortDay) {
    students = students.filter(student => kinderChatFeedbackStudentMatchesDay(student, kcfStudentManageSortDay));
  }
  return [...students].sort((a, b) => {
    const ageA = Number(String(a.age || '').replace(/[^0-9]/g, '')) || 999;
    const ageB = Number(String(b.age || '').replace(/[^0-9]/g, '')) || 999;
    if (ageA !== ageB) return ageA - ageB;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
  });
}

function kinderChatFeedbackStudentMatchesDay(student, day) {
  const text = [student.lesson_day, student.lessonDay, student.days, student.day]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
  return !!day && text.includes(day);
}

function renderKinderChatFeedbackStudentManageHeader(title) {
  const manageMode = isKinderChatFeedbackStudentManageMode();
  return `<div class="memoStudentSelectHeader">
    <div class="memoStudentSelectTitle">${escapeHtml(title)}</div>
    <button type="button" class="memoStudentSettingsIconBtn ${manageMode ? 'active' : ''}" onclick="toggleKinderChatFeedbackStudentManageMode(event)" aria-label="원생 설정" title="원생 설정">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 0 1 7.1 4l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 0 1 19.9 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"></path></svg>
    </button>
  </div>`;
}

function renderKinderChatFeedbackStudentManageControls() {
  if (isKinderChatFeedbackStudentManageMode()) {
    return `<div class="memoStudentSortPanel memoStudentManagePanel">
      <div class="memoStudentSortManageRow">
        <button type="button" class="memoStudentManageChip memoStudentAddChip" onclick="openKinderChatFeedbackStudentAddFromManage(event)" aria-label="원생 등록">+</button>
      </div>
    </div>`;
  }
  const dayButtons = KCF_STUDENT_MANAGE_DAYS.map(day => {
    const active = kcfStudentManageSortDay === day;
    return `<button type="button" class="memoStudentSortChip memoStudentDaySortChip ${active ? 'active' : ''}" onclick="toggleKinderChatFeedbackStudentManageDay('${day}', event)">${day}</button>`;
  }).join('');
  return `<div class="memoStudentSortPanel"><div class="memoStudentSortDayRow">${dayButtons}</div></div>`;
}

function renderKinderChatFeedbackStudentManagePopup() {
  const popup = document.getElementById('kcfStudentManagePopup');
  if (!popup) return;
  const manageMode = isKinderChatFeedbackStudentManageMode();
  const title = manageMode ? '원생 설정' : '원생 목록';
  const students = getKinderChatFeedbackStudentManageStudents();
  if (!students.length) {
    const emptyText = kcfStudentManageSortDay && !manageMode ? `${kcfStudentManageSortDay}요일 등원 학생이 없습니다.` : '등록된 학생이 없습니다.';
    popup.innerHTML = `${renderKinderChatFeedbackStudentManageHeader(title)}<div class="memoStudentSelectList"><div class="memoStudentSelectEmpty">${escapeHtml(emptyText)}</div></div>${renderKinderChatFeedbackStudentManageControls()}`;
    return;
  }
  const rows = students.map(student => {
    const studentId = escapeHtml(String(student.id || ''));
    const meta = getKinderChatFeedbackStudentMetaLine(student);
    const textBlock = `<span class="memoStudentSelectName">${escapeHtml(student.name || '이름 없음')}</span>${meta ? `<span class="memoStudentSelectMeta">${escapeHtml(meta)}</span>` : ''}`;
    if (manageMode) {
      return `<div class="memoStudentSelectOption manageMode">
        <span class="memoStudentSelectTextBlock">${textBlock}</span>
        <button type="button" class="memoStudentInfoDotsBtn" onclick="openKinderChatFeedbackStudentInfoFromManage('${studentId}', event)" aria-label="학생정보 수정">•••</button>
      </div>`;
    }
    return `<div class="memoStudentSelectOption">
      <button type="button" class="memoStudentSelectNameBtn" onclick="selectKinderChatFeedbackStudentFromManage('${studentId}', event)">${textBlock}</button>
    </div>`;
  }).join('');
  popup.innerHTML = `${renderKinderChatFeedbackStudentManageHeader(title)}<div class="memoStudentSelectList">${rows}</div>${renderKinderChatFeedbackStudentManageControls()}`;
}

function toggleKinderChatFeedbackStudentManagePopup(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const popup = document.getElementById('kcfStudentManagePopup');
  if (!popup) return;
  renderKinderChatFeedbackStudentManagePopup();
  popup.classList.toggle('show');
}

function closeKinderChatFeedbackStudentManagePopup() {
  const popup = document.getElementById('kcfStudentManagePopup');
  if (popup) popup.classList.remove('show');
}

function refreshKinderChatFeedbackStudentManagePopupIfOpen() {
  const popup = document.getElementById('kcfStudentManagePopup');
  if (popup && popup.classList.contains('show')) renderKinderChatFeedbackStudentManagePopup();
}

function toggleKinderChatFeedbackStudentManageMode(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  kcfStudentManageMode = !kcfStudentManageMode;
  refreshKinderChatFeedbackStudentManagePopupIfOpen();
}

function toggleKinderChatFeedbackStudentManageDay(day, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  kcfStudentManageSortDay = kcfStudentManageSortDay === day ? '' : day;
  refreshKinderChatFeedbackStudentManagePopupIfOpen();
}

function selectKinderChatFeedbackStudentFromManage(studentId, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const student = typeof findStudentById === 'function' ? findStudentById(studentId) : null;
  if (!student) return;
  const input = document.getElementById('kcfInput');
  if (input) {
    const lines = String(input.value || '').split(/\n/);
    if (lines.length <= 1 && !String(lines[0] || '').trim()) {
      input.value = `${student.name || ''}\n`;
    } else {
      lines[0] = student.name || '';
      input.value = lines.join('\n');
    }
    autoResizeKinderChatFeedbackInput(input);
    saveKinderChatFeedbackDraft();
    input.focus();
  }
  closeKinderChatFeedbackStudentManagePopup();
}

function openKinderChatFeedbackStudentAddFromManage(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  currentRecordView = 'kinder';
  currentObservationView = 'kinder';
  openStudentModal();
}

function openKinderChatFeedbackStudentInfoFromManage(studentId, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const student = typeof findStudentById === 'function' ? findStudentById(studentId) : null;
  if (!student) return;
  studentInfoModalTarget = student;
  if ((student.type || 'kinder') === 'elementary') openElementaryInfoModal();
  else openKinderInfoModal();
}

function isKinderChatFeedbackStudentManageOutsideTarget(target) {
  const wrap = document.getElementById('kcfStudentManageWrap');
  if (!wrap || !target) return false;
  if (target.closest && target.closest('#studentModal, #elementaryInfoModal, #kinderInfoModal')) return false;
  return !wrap.contains(target);
}

document.addEventListener('click', event => {
  const popup = document.getElementById('kcfStudentManagePopup');
  if (!popup || !popup.classList.contains('show')) return;
  if (isKinderChatFeedbackStudentManageOutsideTarget(event.target)) closeKinderChatFeedbackStudentManagePopup();
});

window.openKinderChatFeedbackPage = openKinderChatFeedbackPage;
window.closeKinderChatFeedbackPage = closeKinderChatFeedbackPage;
window.submitKinderChatFeedback = submitKinderChatFeedback;
window.openKinderChatFeedbackInbox = openKinderChatFeedbackInbox;
window.closeKinderChatFeedbackInbox = closeKinderChatFeedbackInbox;
window.editKinderChatFeedbackInboxItem = editKinderChatFeedbackInboxItem;
window.cancelKinderChatFeedbackInboxEdit = cancelKinderChatFeedbackInboxEdit;
window.deleteKinderChatFeedbackInboxItem = deleteKinderChatFeedbackInboxItem;
window.confirmKinderChatFeedbackInboxEdit = confirmKinderChatFeedbackInboxEdit;
window.toggleKinderChatFeedbackInboxItem = toggleKinderChatFeedbackInboxItem;
window.updateKinderChatFeedbackBadge = updateKinderChatFeedbackBadge;
window.renderKinderChatFeedbackInbox = renderKinderChatFeedbackInbox;
window.updateKinderChatFeedbackKeyboardOffset = updateKinderChatFeedbackKeyboardOffset;
window.toggleKinderChatFeedbackModeMenu = toggleKinderChatFeedbackModeMenu;
window.switchKinderChatFeedbackMode = switchKinderChatFeedbackMode;
window.closeKinderChatFeedbackModeMenu = closeKinderChatFeedbackModeMenu;
window.openKinderChatFeedbackSaveStudentPicker = openKinderChatFeedbackSaveStudentPicker;
window.closeKinderChatFeedbackSaveStudentPicker = closeKinderChatFeedbackSaveStudentPicker;
window.selectKinderChatFeedbackSaveStudent = selectKinderChatFeedbackSaveStudent;
window.confirmKinderChatFeedbackSaveStudentPicker = confirmKinderChatFeedbackSaveStudentPicker;
window.toggleMemoFeedbackArchiveCard = toggleMemoFeedbackArchiveCard;
window.openElementaryGrowthFeedbackSheet = openElementaryGrowthFeedbackSheet;
window.closeElementaryGrowthFeedbackSheet = closeElementaryGrowthFeedbackSheet;
window.submitElementaryGrowthFeedbackSheet = submitElementaryGrowthFeedbackSheet;
window.selectElementaryGrowthFeedbackSingle = selectElementaryGrowthFeedbackSingle;
window.toggleElementaryGrowthFeedbackMulti = toggleElementaryGrowthFeedbackMulti;
window.openKinderChatFeedbackGrowthSheet = openKinderChatFeedbackGrowthSheet;
window.closeKinderChatFeedbackGrowthSheet = closeKinderChatFeedbackGrowthSheet;
window.submitKinderChatFeedbackGrowthSheet = submitKinderChatFeedbackGrowthSheet;
window.selectKinderChatFeedbackGrowthSingle = selectKinderChatFeedbackGrowthSingle;
window.toggleKinderChatFeedbackGrowthMulti = toggleKinderChatFeedbackGrowthMulti;
