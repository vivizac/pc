function resetOneMinuteFeedbackBeforeLeaving() {
  const main = document.getElementById('mainPageScreen');
  if (!main) return;
  const style = window.getComputedStyle(main);
  const isVisible = style.display !== 'none' && main.offsetParent !== null;
  if (isVisible) resetOneMinuteFeedback();
}

function wrapOneMinuteLeaveFunction(fnName) {
  const original = window[fnName];
  if (typeof original !== 'function' || original.__oneMinuteWrapped) return;
  const wrapped = function(...args) {
    resetOneMinuteFeedbackBeforeLeaving();
    return original.apply(this, args);
  };
  wrapped.__oneMinuteWrapped = true;
  window[fnName] = wrapped;
}

document.addEventListener('DOMContentLoaded', function() {
  ['showRecordRoom','showStudentMemoScreen','openStudentMemo',].forEach(wrapOneMinuteLeaveFunction);
});


let currentKinderSceneInfoId = null;

function handleKinderSceneCardTap(event, id) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (!selectedSceneIds.has(id)) {
    selectedSceneIds.add(id);
    try { insertSceneMemoLabel(id); } catch (err) {}
    closeKinderSceneInfo();
    renderSceneInput();
    return;
  }

  openKinderSceneInfo(id);
}

function toggleKinderSceneMarker(event, id) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (selectedSceneIds.has(id)) {
    selectedSceneIds.delete(id);
    try { removeSceneMemoLabel(id); } catch (err) {}
    if (currentKinderSceneInfoId === id) {
      const marker = document.getElementById('kinderSceneInfoMarker');
      if (marker) marker.dataset.selected = 'false';
    }
  } else {
    selectedSceneIds.add(id);
    try { insertSceneMemoLabel(id); } catch (err) {}
    if (currentKinderSceneInfoId === id) {
      const marker = document.getElementById('kinderSceneInfoMarker');
      if (marker) marker.dataset.selected = 'true';
    }
  }

  renderSceneInput();
}

function openKinderSceneInfo(id) {
  const item = getSceneById(id);
  const overlay = document.getElementById('kinderSceneInfoOverlay');
  if (!item || !overlay) return;

  currentKinderSceneInfoId = id;

  const marker = document.getElementById('kinderSceneInfoMarker');
  const noText = document.getElementById('kinderSceneInfoNumText');
  const titleEl = document.getElementById('kinderSceneInfoTitle');
  const mainEl = document.getElementById('kinderSceneInfoMain');
  const subEl = document.getElementById('kinderSceneInfoSub');
  const keyEl = document.getElementById('kinderSceneInfoKeywords');

  if (marker) marker.dataset.selected = selectedSceneIds.has(id) ? 'true' : 'false';
  if (noText) noText.textContent = item.no;
  if (titleEl) titleEl.textContent = item.title;
  if (mainEl) mainEl.textContent = item.main;
  if (subEl) subEl.textContent = item.sub;
  if (keyEl) keyEl.innerHTML = item.keywords.map(k => `<span>${escapeHtml(k)}</span>`).join('');

  overlay.classList.add('show');
}

function toggleKinderSceneInfoSelection(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (!currentKinderSceneInfoId) return;

  if (selectedSceneIds.has(currentKinderSceneInfoId)) {
    selectedSceneIds.delete(currentKinderSceneInfoId);
    try { removeSceneMemoLabel(currentKinderSceneInfoId); } catch (err) {}
  } else {
    selectedSceneIds.add(currentKinderSceneInfoId);
    try { insertSceneMemoLabel(currentKinderSceneInfoId); } catch (err) {}
  }

  const marker = document.getElementById('kinderSceneInfoMarker');
  if (marker) marker.dataset.selected = selectedSceneIds.has(currentKinderSceneInfoId) ? 'true' : 'false';
  renderSceneInput();
}

function closeKinderSceneInfo() {
  const overlay = document.getElementById('kinderSceneInfoOverlay');
  if (overlay) overlay.classList.remove('show');
}

function handleKinderSceneInfoOverlayClick(event) {
  if (event && event.target && event.target.id === 'kinderSceneInfoOverlay') closeKinderSceneInfo();
}

function unselectKinderSceneFromInfo() {
  if (!currentKinderSceneInfoId) return;
  selectedSceneIds.delete(currentKinderSceneInfoId);
  try { removeSceneMemoLabel(currentKinderSceneInfoId); } catch (err) {}
  const marker = document.getElementById('kinderSceneInfoMarker');
  if (marker) marker.dataset.selected = 'false';
  renderSceneInput();
}

function resetOneMinuteFeedback() {
  try {
    selectedSceneIds.clear();
    if (typeof flippedSceneIds !== 'undefined') flippedSceneIds.clear();
    currentKinderSceneInfoId = null;
    const memo = document.getElementById('sceneMemoInput');
    if (memo) {
      memo.value = '';
      delete memo.dataset.userFocusedOnce;
      memo.style.height = '';
      memo.scrollTop = 0;
      memo.scrollLeft = 0;
    }
    const result = document.getElementById('sceneResultArea');
    if (result) result.innerHTML = '';
    closeKinderSceneInfo();
    const modal = document.getElementById('sceneCardModalOverlay');
    if (modal) modal.classList.remove('show');
    document.body.classList.remove('modalOpen');
    try { updateSceneMemoPlaceholder(); } catch (err) {}
    renderSceneInput();
  } catch (err) {
    console.warn('resetOneMinuteFeedback skipped:', err);
  }
}

function resetOneMinuteFeedbackBeforeLeaving() {
  const main = document.getElementById('mainPageScreen');
  if (!main) return;
  const style = window.getComputedStyle(main);
  const isVisible = style.display !== 'none';
  if (isVisible) resetOneMinuteFeedback();
}

function wrapOneMinuteLeaveFunction(fnName) {
  const original = window[fnName];
  if (typeof original !== 'function' || original.__oneMinuteWrapped) return;
  const wrapped = function(...args) {
    resetOneMinuteFeedbackBeforeLeaving();
    return original.apply(this, args);
  };
  wrapped.__oneMinuteWrapped = true;
  window[fnName] = wrapped;
}

document.addEventListener('DOMContentLoaded', function() {
  ['showRecordRoom','showStudentMemoScreen','openStudentMemo',].forEach(wrapOneMinuteLeaveFunction);
});


function setSceneMemoCursorAfterFirstLine(textarea) {
  if (!textarea) return;
  const value = textarea.value || '';
  if (!value.trim()) return;

  const firstLineEnd = value.indexOf('\n') >= 0 ? value.indexOf('\n') : value.length;

  try {
    textarea.setSelectionRange(firstLineEnd, firstLineEnd);
  } catch (err) {}

  requestAnimationFrame(() => {
    try {
      textarea.setSelectionRange(firstLineEnd, firstLineEnd);
    } catch (err) {}
  });
}

document.addEventListener('focusin', function(event) {
  if (!event.target || event.target.id !== 'sceneMemoInput') return;
  const textarea = event.target;

  // 카드 선택으로 자동 포커스가 생기지 않도록 카드 선택에서는 focus()를 호출하지 않습니다.
  // 사용자가 메모장을 처음 터치해 포커스가 들어온 순간에만 첫 줄 텍스트 바로 뒤로 이동합니다.
  if (!textarea.dataset.userFocusedOnce && (textarea.value || '').trim()) {
    textarea.dataset.userFocusedOnce = '1';
    setSceneMemoCursorAfterFirstLine(textarea);
  }
});

document.addEventListener('blur', function(event) {
  if (event.target && event.target.id === 'sceneMemoInput') {
    delete event.target.dataset.userFocusedOnce;
  }
}, true);

function insertTemplate(text) {
  const input = document.getElementById('sceneMemoInput');
  if (!input) return;
  const current = (input.value || '').trim();
  input.value = current ? `${current}
${text}` : text;
  autoResizeSceneMemoInput(input);
  updateSceneMemoPlaceholder();
  try { input.focus(); } catch (err) {}
}
function autoResizeSceneMemoInput(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.max(el.scrollHeight, 162) + 'px';
}
document.addEventListener('input', function(event) {
  if (event.target && event.target.id === 'sceneMemoInput') {
    autoResizeSceneMemoInput(event.target);
  }
});
document.addEventListener('DOMContentLoaded', function() {
  const textarea = document.getElementById('sceneMemoInput');
  if (textarea) autoResizeSceneMemoInput(textarea);
  renderKinderFeedbackSceneGrid();
  updateSceneCardModalMeta();
});


/* v40-64: 모든 피드백 생성/전송 버튼 입력값 없을 때 차단 */
(function(){
  if (window.__feedbackInputGuardV64) return;
  window.__feedbackInputGuardV64 = true;

  const EMPTY_FEEDBACK_MESSAGE = '수업 내용이 부족합니다.';

  function notifyFeedbackInputRequired() {
    alert(EMPTY_FEEDBACK_MESSAGE);
  }

  function textValue(id) {
    const el = document.getElementById(id);
    return el && 'value' in el ? String(el.value || '').trim() : '';
  }

  function hasSceneCardFeedbackInput(customText) {
    if (typeof customText === 'string' && customText.trim()) return true;
    const memo = textValue('sceneMemoInput');
    const hasSelectedCards = !!(window.selectedSceneIds && window.selectedSceneIds.size > 0);
    return !!memo || hasSelectedCards;
  }

  function hasCurrentElementaryAnalysisContentSafe() {
    try {
      if (!currentMemoStudent) return false;
      if (typeof getElementaryAnalysisByStudent !== 'function') return false;
      const analysisData = getElementaryAnalysisByStudent(currentMemoStudent);
      if (typeof elementaryAnalysisHasContent === 'function') {
        return !!elementaryAnalysisHasContent(analysisData);
      }
      return false;
    } catch (err) {
      return false;
    }
  }

  function hasElementaryMemoFeedbackInput(text, analysisPromptText) {
    const memoText = typeof text === 'string' ? text.trim() : textValue('memoEditor');
    const analysisText = typeof analysisPromptText === 'string' ? analysisPromptText.trim() : '';
    const hasExplicitAnalysisPrompt = !!analysisText && !/^\[초등부 분석 선택 데이터\]\s*$/.test(analysisText);
    return !!memoText || hasCurrentElementaryAnalysisContentSafe() || hasExplicitAnalysisPrompt;
  }


  function wrapFunction(name, validator) {
    const original = window[name];
    if (typeof original !== 'function') return false;
    if (original.__feedbackInputGuardWrapped) return true;

    const wrapped = function(...args) {
      if (!validator(...args)) {
        notifyFeedbackInputRequired();
        return;
      }
      return original.apply(this, args);
    };

    wrapped.__feedbackInputGuardWrapped = true;
    wrapped.__originalFeedbackFunction = original;
    window[name] = wrapped;
    return true;
  }

  function installFeedbackInputGuards() {
    wrapFunction('requestSceneCardFeedback', function(customText) {
      return hasSceneCardFeedbackInput(customText);
    });

    wrapFunction('requestElementaryFeedback', function() {
      return hasElementaryMemoFeedbackInput();
    });

    wrapFunction('requestSceneCardFeedbackFromElementary', function(studentName, text, analysisPromptText) {
      return hasElementaryMemoFeedbackInput(text, analysisPromptText);
    });
}

  installFeedbackInputGuards();

  document.addEventListener('DOMContentLoaded', installFeedbackInputGuards);

  /* onclick보다 먼저 막아야 하는 버튼은 capture 단계에서도 한 번 더 방어 */
  document.addEventListener('click', function(event) {
    const btn = event.target && event.target.closest
      ? event.target.closest('button')
      : null;
    if (!btn) return;

    const id = btn.id || '';
    const cls = btn.className || '';
    const text = String(btn.textContent || '').trim();

    const isFeedbackButton =
      id === 'cardGenerateBtn' ||
      id === 'memoFeedbackBtn' ||
      id === 'failGrowthGenerateBtn' ||
      id === 'elementaryFailGrowthGenerateBtn' ||
      String(cls).includes('kinderGenerateBtn') ||
      String(cls).includes('memoFeedbackBottomBtn') ||
      String(cls).includes('growthGenerateBtn') ||
      (text.includes('피드백') && (text.includes('생성') || text.includes('만들기') || text.includes('받기')));

    if (!isFeedbackButton) return;

    let ok = true;

    if (id === 'cardGenerateBtn' || String(cls).includes('kinderGenerateBtn')) {
      ok = hasSceneCardFeedbackInput();
    } else if (id === 'memoFeedbackBtn' || String(cls).includes('memoFeedbackBottomBtn')) {
      ok = hasElementaryMemoFeedbackInput();
    } else if (id === 'failGrowthGenerateBtn') {
      ok = hasFailGrowthInput();
    } else if (id === 'elementaryFailGrowthGenerateBtn') {
      ok = hasElementaryFailGrowthInput();
    }

    if (!ok) {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      notifyFeedbackInputRequired();
    }
  }, true);

  window.installFeedbackInputGuards = installFeedbackInputGuards;
})();


/* ── 내부 피드백 작업 보관함: 화면용 '오늘 피드백' 기능은 사용하지 않음 ── */
const FEEDBACK_JOB_QUEUE_KEY = 'olli_feedback_jobs_v2';
const TODAY_FEEDBACK_QUEUE_KEY = FEEDBACK_JOB_QUEUE_KEY;
function getFeedbackJobQueueStorageKey() {
  const academyId = (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || 'unscoped';
  return `${FEEDBACK_JOB_QUEUE_KEY}_${academyId}`;
}
try { localStorage.removeItem('olli_today_feedback_queue_v1'); } catch(e) {}

function getTodayFeedbackDateKey(dateValue) {
  const d = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0,10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function getTodayFeedbackItemsRaw() {
  try {
    const raw = localStorage.getItem(getFeedbackJobQueueStorageKey());
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
function setTodayFeedbackItemsRaw(list) {
  localStorage.setItem(getFeedbackJobQueueStorageKey(), JSON.stringify(Array.isArray(list) ? list.slice(0, 300) : []));
  
  try { updateKinderChatFeedbackBadge(); } catch(e) {}
  try { renderKinderChatFeedbackInbox(); } catch(e) {}
}
function getTodayFeedbackItems() {
  const today = getTodayFeedbackDateKey();
  return getTodayFeedbackItemsRaw().filter(item => item && item.dateKey === today);
}
function getTodayFeedbackCounts() {
  const items = getTodayFeedbackItems();
  return {
    generating: items.filter(item => item.status === 'generating').length,
    done: items.filter(item => item.status === 'done' && !item.reviewed).length,
    error: items.filter(item => item.status === 'error' || item.status === 'review').length,
    total: items.length
  };
}
function normalizeTodayFeedbackStudentName(name, fallback) {
  let value = String(name || fallback || '').trim();
  const bad = new Set(['학생 이름','아이 이름','성장 피드백','초등부','유치부','OLLI','오늘 피드백']);
  return bad.has(value) ? '' : value;
}

function getSuspiciousFeedbackSegments(text) {
  const source = String(text || '');
  if (!source) return [];
  const pattern = /[\u0900-\u097F]+|[\u3040-\u30FF]+|[\u3400-\u4DBF\u4E00-\u9FFF]+|[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+|[\u0E00-\u0E7F]+|[\u0400-\u04FF]+|[\u0590-\u05FF]+|[\u0370-\u03FF]+/gu;
  const found = source.match(pattern) || [];
  return Array.from(new Set(found.map(v => String(v || '').trim()).filter(Boolean))).slice(0, 20);
}
function hasSuspiciousFeedbackText(text) {
  return getSuspiciousFeedbackSegments(text).length > 0;
}
function renderSuspiciousFeedbackText(text) {
  const source = String(text || '');
  if (!source) return '';
  const pattern = /[\u0900-\u097F]+|[\u3040-\u30FF]+|[\u3400-\u4DBF\u4E00-\u9FFF]+|[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+|[\u0E00-\u0E7F]+|[\u0400-\u04FF]+|[\u0590-\u05FF]+|[\u0370-\u03FF]+/gu;
  let html = '';
  let lastIndex = 0;
  source.replace(pattern, (match, offset) => {
    html += escapeHtml(source.slice(lastIndex, offset));
    html += `<span class="todayFeedbackSuspiciousChar">${escapeHtml(match)}</span>`;
    lastIndex = offset + match.length;
    return match;
  });
  html += escapeHtml(source.slice(lastIndex));
  return html;
}
function buildTodayFeedbackIssueHtml(segments) {
  const list = Array.isArray(segments) ? segments.filter(Boolean) : [];
  if (!list.length) return '';
  return `<div class="todayFeedbackIssueBox">외국어 문자로 보이는 내용이 포함되어 있어요. 수정 후 복사/저장할 수 있습니다.<div class="todayFeedbackIssueChars">${list.map(v => `<span class="todayFeedbackIssueChar">${escapeHtml(v)}</span>`).join('')}</div></div>`;
}
function isTodayFeedbackLoadFailItem(item) {
  const text = [item?.label, item?.sourceText, item?.resultText, item?.errorMessage].map(value => String(value || '').toLowerCase()).join(' ');
  return /로드\s*페일|로드페일|load\s*fail|load\s*failed|failed\s*to\s*load/.test(text);
}
function getTodayFeedbackExportBlockReason(item) {
  if (isTodayFeedbackLoadFailItem(item)) return '로드페일 항목은 기록실에 저장하지 않습니다.';
  const segments = getSuspiciousFeedbackSegments(item?.resultText || '');
  if (!segments.length) return '';
  try { updateTodayFeedbackItem(item.id, { status:'review', suspiciousSegments:segments }); } catch(e) {}
  return `외국어 문자(${segments.join(', ')})가 남아 있어요. 수정 후 다시 시도해 주세요.`;
}
function showFeedbackQueueNotice(title, message) {
  const old = document.getElementById('feedbackQueueNotice');
  if (old) old.remove();
  const overlay = document.createElement('div');
  overlay.id = 'feedbackQueueNotice';
  overlay.className = 'feedbackQueueNotice';
  overlay.innerHTML = `<div class="feedbackQueueNoticeCard"><div class="feedbackQueueNoticeTitle">${escapeHtml(title || '')}</div><div class="feedbackQueueNoticeText">${escapeHtml(message || '')}</div></div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
  setTimeout(() => {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 220);
  }, 1700);
}
function getCurrentFeedbackStudentNameForToday(preferredDivision) {
  const candidates = [];
  if (currentMemoStudent && currentMemoStudent.name) candidates.push(currentMemoStudent.name);
  ['memoStudentName','kinderObservationNoteTitle'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    candidates.push(el.value || el.textContent || '');
  });
  if (preferredDivision === 'kinder') {
    const kinder = document.querySelector('.kinderStudentRow.studentRowSelected .studentTextWrap span:first-child, .kinderStudentRow .studentTextWrap span:first-child');
    if (kinder) candidates.push(kinder.textContent || '');
  }
  for (const name of candidates) {
    const normalized = normalizeTodayFeedbackStudentName(name);
    if (normalized) return normalized;
  }
  return '';
}
function inferFeedbackDivisionFromLabel(label) {
  const text = String(label || '');
  if (text.includes('유치')) return 'kinder';
  if (text.includes('초등')) return 'elementary';
  if (currentMemoType === 'kinder') return 'kinder';
  if (currentMemoType === 'elementary') return 'elementary';
  return 'elementary';
}
function createTodayFeedbackItem(options = {}) {
  const now = new Date().toISOString();
  const item = {
    id: options.id || `tf_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
    status: options.status || 'generating',
    studentName: normalizeTodayFeedbackStudentName(options.studentName) || '학생',
    studentDivision: options.studentDivision === 'kinder' ? 'kinder' : 'elementary',
    feedbackType: options.feedbackType || 'class',
    label: options.label || '피드백',
    sourcePage: String(options.sourcePage || ''),
    sourceText: String(options.sourceText || ''),
    attachments: Array.isArray(options.attachments) ? options.attachments : [],
    resultText: String(options.resultText || ''),
    errorMessage: String(options.errorMessage || ''),
    suspiciousSegments: Array.isArray(options.suspiciousSegments) ? options.suspiciousSegments : getSuspiciousFeedbackSegments(options.resultText || ''),
    createdAt: options.createdAt || now,
    updatedAt: now,
    dateKey: getTodayFeedbackDateKey(now),
    feedbackMonth: String(options.feedbackMonth || getFeedbackMonthLabel(now)),
    feedbackMonthNumber: Number(options.feedbackMonthNumber || getFeedbackMonthNumber(now)),
    reviewed: false,
    saved: false
  };
  const list = getTodayFeedbackItemsRaw();
  list.unshift(item);
  setTodayFeedbackItemsRaw(list);
  return item;
}
function updateTodayFeedbackItem(id, patch = {}) {
  const list = getTodayFeedbackItemsRaw();
  let changed = false;
  const next = list.map(item => {
    if (!item || item.id !== id) return item;
    changed = true;
    return { ...item, ...patch, updatedAt: new Date().toISOString() };
  });
  if (changed) setTodayFeedbackItemsRaw(next);
}
function addCompletedTodayFeedback(options = {}) {
  const text = String(options.resultText || options.text || '').trim();
  if (!text) return null;
  return createTodayFeedbackItem({ ...options, status:'done', resultText:text });
}
function getTodayFeedbackStatusLabel(status) {
  if (status === 'generating') return '생성 중';
  if (status === 'error' || status === 'review') return '확인 필요';
  return '생성 완료';
}
function renderTodayFeedbackPage() {}

function getTodayFeedbackItemById(id) {
  return getTodayFeedbackItemsRaw().find(item => item && item.id === id) || null;
}
function getTodayFeedbackSavedSourceTable(item = {}) {
  const explicitTable = String(item.savedSourceTable || item.sourceTable || item.serverTable || '').trim();
  if (explicitTable) return explicitTable;
  return getFeedbackTableNameByType(item.feedbackType || 'class');
}
function getTodayFeedbackSavedRowId(item = {}) {
  return String(item.savedRowId || item.serverRowId || item.feedbackRowId || item.rowId || item.row?.id || '').trim();
}
function getTodayFeedbackEditFeatureByTable(tableName) {
  const table = String(tableName || '').trim();
  if (table === 'feedbacks') return 'general_feedback_edit';
  if (table === 'fail_feedbacks') return 'growth_feedback_edit';
  if (table === 'summary_feedbacks') return 'summary_feedback_edit';
  return '';
}
async function patchSavedTodayFeedbackItem(item = {}, nextText = '') {
  const tableName = getTodayFeedbackSavedSourceTable(item);
  const feature = getTodayFeedbackEditFeatureByTable(tableName);
  const academyId = String(item.savedAcademyId || item.academy_id || (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || '').trim();
  const studentId = String(item.savedStudentId || item.studentId || item.student_id || '').trim();
  const recordId = getTodayFeedbackSavedRowId(item);
  const content = String(nextText || '').trim();
  if (!feature) throw new Error(`지원하지 않는 피드백 수정 테이블입니다: ${tableName || 'unknown'}`);
  if (!academyId || !studentId || !recordId) throw new Error('저장된 피드백의 서버 식별값을 찾지 못해 수정 저장을 할 수 없습니다.');
  if (typeof saveOlliData !== 'function') throw new Error('공통 저장 함수가 준비되지 않았습니다.');
  const patch = { content, updated_at: new Date().toISOString() };
  const result = await saveOlliData(feature, {
    academyId,
    studentId,
    recordId,
    data: patch,
    forceCommon: true
  });
  if (isOlliPendingCommonSaveResult(result)) {
    return { ...patch, id: recordId, academy_id: academyId, student_id: studentId, __pending_sync: true };
  }
  if (!result || !result.serverSaved || !result.verified) {
    const error = result && result.error ? result.error : new Error('저장된 피드백 수정 서버 저장이 완료되지 않았습니다.');
    throw error;
  }
  return result.serverRow || (Array.isArray(result.serverRows) ? result.serverRows[0] : result.serverRows) || { ...patch, id: recordId, academy_id: academyId, student_id: studentId };
}
async function saveTodayFeedbackItem(id, btn, selectedStudentId = '') {
  const item = getTodayFeedbackItemById(id);
  if (!item || !item.resultText) return false;
  const reason = getTodayFeedbackExportBlockReason(item);
  if (reason) {
    showPushToast(reason);
    return false;
  }
  const studentName = normalizeTodayFeedbackStudentName(item.studentName || '');
  const studentDivision = item.studentDivision || 'elementary';
  let finalStudentId = String(selectedStudentId || '');
  if (!finalStudentId) {
    const candidates = typeof getKinderChatFeedbackSaveStudentCandidates === 'function'
      ? getKinderChatFeedbackSaveStudentCandidates(studentName, studentDivision)
      : [];
    if (!candidates.length) {
      showPushToast(`${studentName || '입력한 이름'}로 등록된 학생 이름이 없습니다.`);
      return false;
    }
    if (candidates.length > 1 && typeof openKinderChatFeedbackSaveStudentPicker === 'function') {
      openKinderChatFeedbackSaveStudentPicker(id, candidates);
      return null;
    }
    finalStudentId = String(candidates[0]?.id || '');
  }
  const savedOk = await autoSaveGeneratedFeedback(item.resultText, {
    feedbackType: item.feedbackType || 'class',
    studentDivision,
    studentName,
    studentId: finalStudentId
  }, btn || null);
  if (savedOk === false) return false;
  try {
    await linkFeedbackPhotosToStudent(item, finalStudentId);
  } catch (err) {
    showPushToast('피드백은 저장됐지만 사진 연결을 다시 확인해야 해요.');
    recordOlliStorageIssue({ feature: '수업사진', resource: 'feedback_photos', operation: 'link', student_id: finalStudentId, message: err.message || err });
  }
  const savedRow = (savedOk && typeof savedOk === 'object') ? savedOk : null;
  const sourceTable = getFeedbackTableNameByType(item.feedbackType || 'class');
  const savedRowId = String(savedRow?.id || savedRow?.client_record_id || item.savedRowId || '').trim();
  updateTodayFeedbackItem(id, {
    saved:true,
    reviewed:true,
    savedRowId,
    savedSourceTable: sourceTable,
    savedStudentId: finalStudentId,
    savedAcademyId: (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : ''),
    savedAt: new Date().toISOString()
  });
  const kcfCard = document.querySelector(`[data-kcf-feedback-id="${CSS.escape(id)}"]`);
  if (kcfCard) {
    kcfCard.classList.add('open');
    const textEl = kcfCard.querySelector('.kcfInboxText');
    if (textEl) textEl.textContent = textEl.dataset.kcfOpenMeta || '';
    const saveBtn = kcfCard.querySelector('.kcfInboxSaveBtn');
    if (saveBtn) saveBtn.disabled = true;
    updateKinderChatFeedbackBadge();
  }
  return true;
}
function getFeedbackMonthNumber(dateValue) {
  const d = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().getMonth() + 1;
  return d.getMonth() + 1;
}
function getFeedbackMonthLabel(dateValue) {
  return `${getFeedbackMonthNumber(dateValue)}월`;
}
function buildTodayFeedbackRequestContent(userText, studentName, feedbackMonth) {
  const name = normalizeTodayFeedbackStudentName(studentName);
  const monthLabel = String(feedbackMonth || getFeedbackMonthLabel()).trim();
  const body = String(userText || '').trim();
  const lines = [];
  if (name && !/아이\s*이름\s*:|학생\s*이름\s*:/.test(body)) lines.push(`아이 이름: ${name}`);
  if (monthLabel && !/(피드백\s*기준\s*월|성장노트\s*월|월\s*정보)\s*[:：]/.test(body)) lines.push(`피드백 기준 월: ${monthLabel}`);
  if (body) lines.push(body);
  return lines.join('\n');
}
function startTodayFeedbackRequest(options = {}) {
  const feedbackMonth = String(options.feedbackMonth || getFeedbackMonthLabel()).trim();
  const feedbackMonthNumber = Number(options.feedbackMonthNumber || getFeedbackMonthNumber());
  const item = createTodayFeedbackItem({
    id: options.id,
    status:'generating',
    studentName: options.studentName,
    studentDivision: options.studentDivision,
    feedbackType: options.feedbackType,
    label: options.label,
    sourcePage: options.sourcePage,
    sourceText: options.userText,
    attachments: Array.isArray(options.attachments) ? options.attachments : [],
    feedbackMonth,
    feedbackMonthNumber
  });
  if (!options.silent) showFeedbackQueueNotice(`${item.studentName} 피드백을 정리하고 있어요.`, '이제 다음 아이 피드백을 작성해도 됩니다.');
  
  try { updateKinderChatFeedbackBadge(); } catch(e) {}

  fetch('/api/chat', {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({
      promptType: options.promptType || 'class',
      studentName: item.studentName,
      feedbackMonth,
      feedbackMonthNumber,
      messages:[{ role:'user', content: buildTodayFeedbackRequestContent(options.userText || '', item.studentName, feedbackMonth) }]
    })
  })
  .then(async res => {
    const rawText = await res.text();
    let data; try { data = rawText ? JSON.parse(rawText) : {}; } catch { data = { raw: rawText }; }
    if (!res.ok) throw new Error(getApiErrorMessage(res.status, data));
    const rawReply = String(data.reply || '').trim();
    if (!rawReply) throw new Error('응답 본문이 비어 있습니다.');
    const parsed = parseReplyType(rawReply);
    const suspiciousSegments = getSuspiciousFeedbackSegments(parsed.cleanText);
    updateTodayFeedbackItem(item.id, {
      status: suspiciousSegments.length ? 'review' : 'done',
      resultText: parsed.cleanText,
      suspiciousSegments,
      errorMessage:''
    });
    if (!options.silent) {
      showPushToast(suspiciousSegments.length ? `${item.studentName} 피드백 확인이 필요해요.` : `${item.studentName} 피드백이 완성됐어요.`);
      try { showBrowserNotification(`${item.studentName} 피드백이 완성됐어요.`); } catch(e) {}
    }
  })
  .catch(err => {
    updateTodayFeedbackItem(item.id, { status:'error', errorMessage: err.message || '알 수 없는 오류입니다.' });
    if (!options.silent) showPushToast(`${item.studentName} 피드백 확인이 필요해요.`);
  });

  return item;
}
function resetSceneFeedbackInputAfterQueue() {
  try { clearSceneSelections(); } catch(e) {}
  const memo = document.getElementById('sceneMemoInput');
  if (memo) {
    memo.value = '';
    try { autoResizeSceneMemoInput(memo); } catch(e) {}
    try { updateSceneMemoPlaceholder(); } catch(e) {}
  }
  const area = document.getElementById('kinderSceneResultArea');
  if (area) area.innerHTML = '';
}
function requestSceneCardFeedback(customText) {
  const memo = typeof customText === 'string' ? customText.trim() : (document.getElementById('sceneMemoInput')?.value || '').trim();
  if (!memo && selectedSceneIds.size === 0) { alert('장면카드를 선택하거나 메모를 먼저 입력해 주세요.'); return; }
  const userText = buildSceneCardUserText(memo);
  const isElementary = !!customText;
  const studentName = getCurrentFeedbackStudentNameForToday(isElementary ? 'elementary' : 'kinder');
  startTodayFeedbackRequest({ promptType:(isElementary ? 'elementary' : 'class'), userText, studentName, studentDivision:(isElementary ? 'elementary' : 'kinder'), feedbackType:'class', label:(isElementary ? '초등부 피드백' : '유치부 피드백') });
  resetSceneFeedbackInputAfterQueue();
}
window.saveTodayFeedbackItem = saveTodayFeedbackItem;
