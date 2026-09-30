function clearRecordInteractionState() {
  const screen = document.getElementById('recordRoomScreen');
  const pill = document.getElementById('recordSearchPill');
  const input = document.getElementById('searchName');
  const overlay = document.getElementById('studentActionOverlay');
  const controls = document.getElementById('recordSelectionControls');

  if (screen) screen.classList.remove('record-search-open');
  if (pill) pill.classList.remove('active');
  if (input) input.value = '';
  if (overlay) overlay.classList.remove('show');
  if (controls) controls.classList.remove('show');
  studentSelectionMode = false;
  selectedStudentIds.clear();
  selectedStudentActionId = '';
  suppressNextStudentClick = false;
  closeRecordAddMenu();
  updateRecordHeaderUI();
}

function closeRecordAddMenu() {
  const menu = document.getElementById('recordAddMenu');
  const btn = document.getElementById('studentAddBtn');
  if (menu) {
    menu.classList.remove('show');
    menu.setAttribute('aria-hidden', 'true');
  }
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function toggleRecordAddMenu(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const menu = document.getElementById('recordAddMenu');
  const btn = document.getElementById('studentAddBtn');
  if (!menu) return;
  const wasOpen = menu.classList.contains('show');
  clearRecordInteractionState();
  if (wasOpen) {
    if (btn) btn.setAttribute('aria-expanded', 'false');
    return;
  }
  menu.classList.add('show');
  menu.setAttribute('aria-hidden', 'false');
  if (btn) btn.setAttribute('aria-expanded', 'true');
}

function openStudentAddFromRecordMenu(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  closeRecordAddMenu();
  clearRecordInteractionState();
  openStudentModal();
}

function openKinderChatFeedbackFromRecordMenu(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  closeRecordAddMenu();
  clearRecordInteractionState();
  if (typeof openKinderChatFeedbackPage === 'function') {
    const division = currentRecordView === 'kinder' ? 'kinder' : 'elementary';
    openKinderChatFeedbackPage({ division });
  }
}

function handleStudentAddButton(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  closeRecordAddMenu();
  clearRecordInteractionState();
  openStudentModal();
}

function bindStudentAddButton() {
  const btn = document.getElementById('studentAddBtn');
  if (!btn || btn.dataset.bound === '1') return;
  btn.dataset.bound = '1';
}
if (!window.__olliStudentAddDelegatedBound) {
  window.__olliStudentAddDelegatedBound = true;
  document.addEventListener('click', function(event) {
    const btn = event.target && event.target.closest ? event.target.closest('#studentAddBtn') : null;
    if (!btn) return;
    handleStudentAddButton(event);
  }, true);
}
if (!window.__olliRecordAddMenuCloseBound) {
  window.__olliRecordAddMenuCloseBound = true;
  document.addEventListener('click', function(event) {
    const insideMenu = event.target && event.target.closest ? event.target.closest('#recordAddMenu') : null;
    const addBtn = event.target && event.target.closest ? event.target.closest('#studentAddBtn') : null;
    if (!insideMenu && !addBtn) closeRecordAddMenu();
  });
}


let feedbackLoadingTimer = null;
let feedbackLoadingTypingTimer = null;
let feedbackLoadingStep = 0;
function getFeedbackLoadingSteps(type) {
  return [
    ['선생님의 관찰 기록을 바탕으로', '아이의 수업 상황을 시뮬레이션 중입니다.'],
    ['선생님의 관찰 기록을 바탕으로', '아이의 실패 / 막힘 / 감정변화를 성장의 흐름으로 정리하고 있습니다.'],
    ['선생님의 관찰 기록이', '부모님께 잘 전달 될수 있도록 키워드 요소를 분석 중입니다.']
  ];
}
function typeFeedbackLoadingText(el, text, done) {
  if (!el) { if (done) done(); return; }
  if (feedbackLoadingTypingTimer) {
    clearInterval(feedbackLoadingTypingTimer);
    feedbackLoadingTypingTimer = null;
  }
  let i = 0;
  el.innerHTML = '<span class="feedbackLoadingCursor"></span>';
  feedbackLoadingTypingTimer = setInterval(() => {
    i += 1;
    el.innerHTML = escapeHtml(text.slice(0, i)) + '<span class="feedbackLoadingCursor"></span>';
    if (i >= text.length) {
      clearInterval(feedbackLoadingTypingTimer);
      feedbackLoadingTypingTimer = null;
      if (done) done();
    }
  }, 42);
}
function renderFeedbackLoadingStep(steps) {
  const title = document.getElementById('feedbackLoadingTitle');
  const body = document.getElementById('feedbackLoadingText');
  const step = steps[feedbackLoadingStep];
  if (!step) return;
  typeFeedbackLoadingText(title, step[0], () => {
    typeFeedbackLoadingText(body, step[1]);
  });
}
function showFeedbackLoading(type='class') {
  hideFeedbackLoading();
  const steps = getFeedbackLoadingSteps(type);
  feedbackLoadingStep = 0;
  const overlay = document.createElement('div');
  overlay.id = 'feedbackLoadingOverlay';
  overlay.className = 'feedbackLoadingOverlay';
  overlay.innerHTML = `<div class="feedbackLoadingCard">
    <div class="feedbackLoadingKicker">피드백 문장 정리 중</div>
    <div class="feedbackLoadingTitle" id="feedbackLoadingTitle"></div>
    <div class="feedbackLoadingText" id="feedbackLoadingText"></div>
    <div class="feedbackLoadingDots"><span></span><span></span><span></span></div>
  </div>`;
  document.body.appendChild(overlay);
  renderFeedbackLoadingStep(steps);
  feedbackLoadingTimer = setInterval(() => {
    const nextStep = feedbackLoadingStep + 1;
    if (nextStep >= steps.length) {
      clearInterval(feedbackLoadingTimer);
      feedbackLoadingTimer = null;
      return;
    }
    feedbackLoadingStep = nextStep;
    renderFeedbackLoadingStep(steps);
  }, 9750);
}
function hideFeedbackLoading() {
  if (feedbackLoadingTimer) {
    clearInterval(feedbackLoadingTimer);
    feedbackLoadingTimer = null;
  }
  if (feedbackLoadingTypingTimer) {
    clearInterval(feedbackLoadingTypingTimer);
    feedbackLoadingTypingTimer = null;
  }
  document.querySelectorAll('#feedbackLoadingOverlay, .feedbackLoadingOverlay').forEach(overlay => overlay.remove());
}

function notifyObservationMemoFeedbackClearFailure(error) {
  console.error('피드백 저장 후 관찰노트 초기화 실패:', error?.message || error);
  try { if (typeof setMemoSaveStatus === 'function') setMemoSaveStatus('메모 유지 · 동기화 확인 필요'); } catch (_) {}
  const message = error?.code === 'REVISION_CONFLICT'
    ? '피드백은 저장됐지만 다른 기기에서 관찰노트가 변경되어 메모를 지우지 않았어요. 최신 내용을 확인해 주세요.'
    : '피드백은 저장됐지만 관찰노트 초기화를 완료하지 못했어요. 수업 메모는 그대로 보존했습니다.';
  try {
    if (typeof showPushToast === 'function') showPushToast(message);
    else alert(message);
  } catch (_) {}
}

function resetObservationMemoViewportAfterFeedbackSave(memo) {
  const editor = memo || document.getElementById('memoEditor');
  const page = document.querySelector('#studentMemoScreen .memoPageInner');

  const reset = () => {
    if (editor) {
      try { editor.setSelectionRange(0, 0); } catch (_) {}
      try { editor.scrollTop = 0; } catch (_) {}
    }
    if (typeof resizeObservationMemoEditorToContent === 'function') {
      try { resizeObservationMemoEditorToContent(); } catch (_) {}
    }
    if (page) page.scrollTop = 0;
  };

  reset();
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(reset);
  setTimeout(reset, 80);
}

async function resetElementaryMemoAfterFeedbackSave(feedbackText, explicitDirection = '', options = {}) {
  if (!currentMemoStudent || !['elementary', 'kinder'].includes(currentMemoType)) {
    return { state: 'skipped', student: null, error: null };
  }

  const studentSnapshot = { ...currentMemoStudent };
  const memoType = currentMemoType;
  const studentDivision = memoType === 'kinder' ? 'kinder' : 'elementary';
  let serverRow;

  try {
    const clearCore = window.ObservationMemoFeedbackClearCore;
    if (!clearCore || typeof clearCore.clearAfterFeedback !== 'function') {
      const error = new Error('관찰노트 서버 초기화 Core가 준비되지 않았습니다.');
      error.code = 'SERVER_UNAVAILABLE';
      throw error;
    }
    serverRow = await clearCore.clearAfterFeedback(studentSnapshot, 'elementary_observation');
  } catch (error) {
    notifyObservationMemoFeedbackClearFailure(error);
    return { state: 'clear_failed', student: studentSnapshot, error };
  }

  const stillCurrent = currentMemoStudent &&
    String(currentMemoStudent.id || '') === String(studentSnapshot.id || '') &&
    currentMemoType === memoType;

  const previousMemo = getMemoByStudent(studentSnapshot, 'elementary_observation');
  if (studentDivision === 'elementary' && String(previousMemo || '').trim()) {
    const analysis = stillCurrent
      ? elementaryAnalysisDraft
      : (typeof getElementaryAnalysisByStudent === 'function' ? getElementaryAnalysisByStudent(studentSnapshot) : null);
    archiveCurrentElementaryMemoRecord(studentSnapshot, previousMemo, analysis);
  }
  if (!options.skipArchive) {
    addMemoFeedbackArchiveItem(studentSnapshot, feedbackText);
  }

  clearMemoByStudent(studentSnapshot, 'elementary_observation');

  if (!stillCurrent) {
    if (studentDivision === 'elementary' && typeof clearElementaryAnalysisByStudent === 'function') {
      clearElementaryAnalysisByStudent(studentSnapshot);
    }
    return {
      state: 'cleared',
      student: studentSnapshot,
      revision: Number(serverRow?.revision || 0),
      syncedAt: String(serverRow?.updated_at || ''),
      intentionalClear: true
    };
  }

  currentMemoStudent = { ...currentMemoStudent, memoUpdatedAt: '' };
  updateMemoStudentMetaDisplay(currentMemoStudent, '');
  if (studentDivision === 'elementary') {
    clearElementaryAnalysisByStudent(currentMemoStudent);
    elementaryAnalysisDraft = getEmptyElementaryAnalysisState();
    selectedElementaryAnalysisHistoryId = '';
  }
  const memo = document.getElementById('memoEditor');
  if (memo && !(studentDivision === 'elementary' && viewingArchivedElementaryRecord)) {
    memo.readOnly = false;
    memo.value = '';
    resetObservationMemoViewportAfterFeedbackSave(memo);
  }
  if (studentDivision === 'elementary') {
    renderElementaryAnalysisSummaryCard(getEmptyElementaryAnalysisState(), { title: '분석 결과', createdAt: '' });
    renderElementaryAnalysisHistoryCards(currentMemoStudent);
  }
  renderElementaryRecordsMenu().catch(err => console.warn('관찰노트 보관함 갱신 실패:', err));
  setMemoSaveStatus('자동 저장');
  if (typeof markObservationMemoEditorClean === 'function') markObservationMemoEditorClean();
  if (typeof refreshMemoStudentSelectPopupIfOpen === 'function') refreshMemoStudentSelectPopupIfOpen();

  return {
    state: 'cleared',
    student: currentMemoStudent,
    revision: Number(serverRow?.revision || 0),
    syncedAt: String(serverRow?.updated_at || ''),
    intentionalClear: true
  };
}

function getCurrentMemoStudentName() {
  return currentMemoStudent?.name || document.getElementById('memoStudentName')?.textContent?.trim() || '';
}
async function autoSaveMemoFeedback(text, futureDirection = '') {
  const name = getCurrentMemoStudentName();
  const content = String(text || '').trim();
  if (!name) { alert('학생 이름을 찾지 못했어요.'); return; }
  if (!content) { alert('저장할 피드백 내용이 비어 있어요.'); return; }

  let archiveStudent = currentMemoStudent && currentMemoStudent.id && currentMemoStudent.type === 'elementary' ? currentMemoStudent : null;
  if (!archiveStudent) {
    const matches = getAllStudents().filter(student =>
      (student.type || 'elementary') === 'elementary' &&
      String(student.name || '').trim() === String(name || '').trim()
    );
    if (matches.length === 1) archiveStudent = matches[0];
    else if (matches.length > 1) {
      alert('같은 이름의 학생이 여러 명 있습니다. 학생 목록에서 해당 학생을 다시 선택해 주세요.');
      return;
    }
  }

  if (!archiveStudent) {
    alert('관찰노트 보관함에 저장할 학생 정보를 찾지 못했어요.');
    return;
  }

  const year = new Date().getFullYear();
  const date = new Date().toLocaleDateString('ko-KR');

  addMemoFeedbackArchiveItem(archiveStudent, content);

  try {
    const memoFeedbackPayload = addOlliAcademyToPayload({
      student_id: archiveStudent.id,
      student_name: archiveStudent.name || name,
      content,
      feedback_type: 'class',
      future_direction: futureDirection || null,
      year,
      date
    }, '초등부 관찰노트 피드백 저장');
    await saveFeedbackRowVerified('feedbacks', memoFeedbackPayload, '초등부 관찰노트 피드백 저장');

    if (typeof refreshRecordsAfterFeedbackSave === 'function') {
      await refreshRecordsAfterFeedbackSave();
    } else {
      const recordRoomScreen = document.getElementById('recordRoomScreen');
      const recordVisible = recordRoomScreen && recordRoomScreen.style.display !== 'none';
      if (recordVisible && typeof loadRecords === 'function') await loadRecords('');
    }

    if (currentMemoStudent && String(currentMemoStudent.id || '') === String(archiveStudent.id || '')) {
      resetElementaryMemoAfterFeedbackSave(content, futureDirection, { skipArchive: true });
      loadMemoFeedbackArchiveItemsFromSupabase(archiveStudent)
        .then(() => renderElementaryRecordsMenu())
        .catch(err => console.warn('관찰노트 보관함 동기화 실패:', err));
    } else {
      loadMemoFeedbackArchiveItemsFromSupabase(archiveStudent)
        .then(() => renderElementaryRecordsMenu())
        .catch(err => console.warn('관찰노트 보관함 동기화 실패:', err));
    }

    closeMemoFeedbackPopup();
    showPushToast('피드백 보관함과 기록실에 저장했어요.');
  } catch (err) {
    console.error('초등부 관찰노트 피드백 저장 오류:', err);

    if (!currentMemoStudent || String(currentMemoStudent.id || '') !== String(archiveStudent.id || '')) {
      renderElementaryRecordsMenu().catch(err => console.warn('관찰노트 보관함 갱신 실패:', err));
    }

    closeMemoFeedbackPopup();
    alert(`피드백 보관함에는 저장했지만, 서버 저장 중 오류가 발생했어요.\n\n${err.message || '알 수 없는 오류입니다.'}`);
  }
}
function closeMemoFeedbackPopup() {
  const overlay = document.getElementById('memoFeedbackPopupOverlay');
  if (overlay) overlay.remove();
}
function enterMemoFeedbackEdit(btn) {
  const card = btn.closest('.memoFeedbackPopupCard');
  if (!card) return;
  const textEl = card.querySelector('.memoFeedbackPopupText');
  const current = textEl ? textEl.textContent : '';
  card.classList.add('open');
  card.classList.add('editing');
  if (textEl) {
    textEl.outerHTML = `<textarea class="memoFeedbackEditBox">${escapeHtml(current)}</textarea>`;
    const box = card.querySelector('.memoFeedbackEditBox');
    if (box) {
      box.focus();
      box.selectionStart = box.selectionEnd = box.value.length;
    }
  }
}
function finishMemoFeedbackEdit(btn) {
  const card = btn.closest('.memoFeedbackPopupCard');
  if (!card) return;
  const box = card.querySelector('.memoFeedbackEditBox');
  const edited = box ? box.value.trim() : '';
  if (!edited) { alert('피드백 내용이 비어 있어요.'); return; }
  card._feedbackText = edited;
  card._futureDirection = extractFutureDirectionFromFeedback(edited, card._futureDirection || '');
  if (box) {
    box.outerHTML = `<div class="memoFeedbackPopupText">${escapeHtml(edited)}</div>`;
  }
  card.classList.remove('editing');
}

function openMemoFeedbackReviewPopup(text, options = {}) {
  const content = String(text || '').trim();
  if (!content) return false;

  closeMemoFeedbackPopup();

  const studentName = normalizeTodayFeedbackStudentName(options.studentName || currentMemoStudent?.name || '');
  const studentDivision = options.studentDivision === 'kinder' ? 'kinder' : 'elementary';
  const feedbackType = String(options.feedbackType || 'growth').trim().toLowerCase() || 'growth';
  const label = feedbackType === 'growth' || feedbackType === 'fail'
    ? '성장 피드백'
    : '피드백';

  const overlay = document.createElement('div');
  overlay.id = 'memoFeedbackPopupOverlay';
  overlay.className = 'memoFeedbackPopupOverlay';
  overlay.innerHTML = `<div class="memoFeedbackPopupCard">
    <div class="memoFeedbackPopupLabel">${escapeHtml(studentName ? `${studentName} · ${label}` : label)}</div>
    <div class="memoFeedbackPopupText">${escapeHtml(content)}</div>
    <div class="memoFeedbackPopupActions">
      <div class="memoFeedbackLeftActions">
        <button class="memoFeedbackIconBtn" onclick="enterMemoFeedbackEdit(this)" title="수정" aria-label="수정" type="button">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg>
        </button>
        <button class="memoFeedbackIconBtn memoFeedbackEditSaveBtn" onclick="finishMemoFeedbackEdit(this)" title="수정 완료" aria-label="수정 완료" type="button">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"></path></svg>
        </button>
      </div>
      <div class="memoFeedbackRightActions">
        <button class="memoFeedbackActionBtn" onclick="closeMemoFeedbackPopup()" type="button">닫기</button>
        <button class="memoFeedbackActionBtn primary" onclick="saveMemoFeedbackReviewFromPopup(this)" type="button">저장</button>
      </div>
    </div>
  </div>`;

  document.body.appendChild(overlay);

  const card = overlay.querySelector('.memoFeedbackPopupCard');
  if (!card) {
    overlay.remove();
    return false;
  }

  card._feedbackText = content;
  card._futureDirection = String(options.futureDirection || '').trim();
  card._studentId = String(options.studentId || '').trim();
  card._studentName = studentName;
  card._studentDivision = studentDivision;
  card._feedbackType = feedbackType;
  card._feedbackMonth = String(options.feedbackMonth || '').trim();
  card._feedbackMonthNumber = Number(options.feedbackMonthNumber || 0) || 0;
  return true;
}

async function saveMemoFeedbackReviewFromPopup(btn) {
  const card = btn?.closest?.('.memoFeedbackPopupCard');
  if (!card) return false;
  if (card.classList.contains('editing')) {
    alert('수정을 완료한 뒤 저장해 주세요.');
    return false;
  }

  const content = String(card._feedbackText || '').trim();
  if (!content) {
    alert('저장할 피드백 내용이 비어 있어요.');
    return false;
  }

  const originalText = btn?.textContent || '저장';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '저장 중...';
  }

  try {
    const saved = await saveElementaryFeedbackDirectlyToArchive(content, {
      studentName: card._studentName || '',
      studentId: card._studentId || '',
      studentDivision: card._studentDivision || 'elementary',
      feedbackType: card._feedbackType || 'growth',
      feedbackMonth: card._feedbackMonth || '',
      feedbackMonthNumber: Number(card._feedbackMonthNumber || 0) || 0,
      futureDirection: card._futureDirection || ''
    });

    closeMemoFeedbackPopup();
    showPushToast(`${card._studentName || '학생'} 피드백을 저장했어요.`);
    return saved || true;
  } catch (err) {
    console.error('관찰노트 피드백 저장 오류:', err);
    alert(`피드백 저장 중 오류가 발생했어요.\n\n${err.message || '알 수 없는 오류입니다.'}`);
    return false;
  } finally {
    if (btn && btn.isConnected) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}
async function saveElementaryFeedbackDirectlyToArchive(text, options = {}) {
  const content = String(text || '').trim();
  if (!content) throw new Error('저장할 피드백 내용이 비어 있습니다.');
  const studentDivision = options.studentDivision === 'kinder' || currentMemoStudent?.type === 'kinder' ? 'kinder' : 'elementary';
  const studentName = normalizeTodayFeedbackStudentName(options.studentName || currentMemoStudent?.name || '');
  if (!studentName) throw new Error('아이 이름을 찾지 못했습니다.');
  const selectedStudentId = options.studentId || currentMemoStudent?.id || '';
  const savedStudent = await getOrCreateStudentForSupabaseSave(studentName, studentDivision, selectedStudentId);
  const rawType = options.feedbackType || 'growth';
  const tableName = getFeedbackTableNameByType(rawType);
  const feedbackType = tableName === 'fail_feedbacks' ? 'fail' : String(rawType || 'class').toLowerCase();
  const now = new Date();
  const year = now.getFullYear();
  const date = now.toLocaleDateString('ko-KR');
  const feedbackMonth = String(options.feedbackMonth || getFeedbackMonthLabel(now)).trim();
  const feedbackMonthNumber = Number(options.feedbackMonthNumber || getFeedbackMonthNumber(now));
  const payload = addOlliAcademyToPayload({
    student_id: savedStudent.id,
    student_name: savedStudent.name || studentName,
    content,
    feedback_type: feedbackType,
    year,
    date
  }, tableName === 'fail_feedbacks' ? '실패-성장 피드백 저장' : '성장 피드백 저장');
  const savedRow = await saveFeedbackRowVerified(tableName, payload, tableName === 'fail_feedbacks' ? '실패-성장 피드백 저장' : '성장 피드백 저장');
  const row = { ...savedRow, source_table: tableName };
  const archiveStudent = currentMemoStudent && String(currentMemoStudent.id || '') === String(savedStudent.id || '') ? currentMemoStudent : savedStudent;
  addMemoFeedbackArchiveItem(archiveStudent, content, {
    id: row.id,
    row,
    sourceTable: tableName,
    feedbackType,
    feedbackMonth,
    feedbackMonthNumber,
    createdAt: row.created_at || row.updated_at || now.toISOString()
  });
  await refreshRecordsAfterFeedbackSave();
  if (tableName === 'feedbacks' && currentMemoStudent && String(currentMemoStudent.id || '') === String(archiveStudent.id || '')) {
    resetElementaryMemoAfterFeedbackSave(content, options.futureDirection || '', { skipArchive: true });
  }
  if (tableName === 'fail_feedbacks' && typeof resetGrowthFeedbackAfterSuccessfulSave === 'function') {
    resetGrowthFeedbackAfterSuccessfulSave(studentDivision);
  }
  try {
    await loadMemoFeedbackArchiveItemsFromSupabase(archiveStudent);
  } catch (err) {
    console.warn('성장 피드백 보관함 동기화 실패:', err.message || err);
  }
  return { student: archiveStudent, row, tableName };
}

let observationFeedbackLoading = false;

async function requestSceneCardFeedbackFromElementary(studentName, text, analysisPromptText, options = {}) {
  if (observationFeedbackLoading) return;

  const studentDivision = options.studentDivision === 'kinder' || currentMemoStudent?.type === 'kinder' ? 'kinder' : 'elementary';
  const requestStudentId = String(options.studentId || currentMemoStudent?.id || '').trim();
  const requestStudentName = normalizeTodayFeedbackStudentName(studentName);
  const divisionLabel = studentDivision === 'kinder' ? '유치부' : '초등부';
  const normalizedText = String(text || '').trim();
  const normalizedAnalysisPromptText = studentDivision === 'elementary' ? String(analysisPromptText || '').trim() : '';
  const hasExplicitAnalysisPrompt = !!normalizedAnalysisPromptText && !/^\[초등부 분석 선택 데이터\]\s*$/.test(normalizedAnalysisPromptText);
  if (!normalizedText && !hasExplicitAnalysisPrompt) {
    alert('수업 내용이 부족합니다.');
    return;
  }

  const feedbackMonth = String(options.feedbackMonth || getFeedbackMonthLabel()).trim();
  const feedbackMonthNumber = Number(options.feedbackMonthNumber || getFeedbackMonthNumber());
  const combined = `${studentName} ${divisionLabel} 성장 피드백 기록
피드백 기준 월: ${feedbackMonth}

${normalizedText}${normalizedAnalysisPromptText ? `

[초등부 분석 데이터]
${normalizedAnalysisPromptText}` : ''}`;
  const userText = buildSceneCardUserText(combined);

  const btn = document.getElementById('memoFeedbackBtn');
  observationFeedbackLoading = true;
  showFeedbackLoading('elementary');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '작성 중...';
  }

  try {
    const res = await fetch('/api/chat', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({
        promptType: options.promptType || 'elementary',
        studentId: requestStudentId,
        studentName: requestStudentName,
        studentDivision,
        feedbackMonth,
        feedbackMonthNumber,
        messages:[{ role:'user', content: buildTodayFeedbackRequestContent(userText, studentName, feedbackMonth, studentDivision) }]
      })
    });
    const rawText = await res.text();
    let data;
    try { data = rawText ? JSON.parse(rawText) : {}; } catch { data = { raw: rawText }; }
    if (!res.ok) throw new Error(getApiErrorMessage(res.status, data));
    const rawReply = String(data.reply || '').trim();
    if (!rawReply) throw new Error('응답 본문이 비어 있습니다.');
    const parsed = parseReplyType(rawReply);
    const cleanText = parsed.cleanText || rawReply;
    hideFeedbackLoading();
    const futureDirection = getFutureDirectionFromApiData(data, cleanText);
    const opened = openMemoFeedbackReviewPopup(cleanText, {
      studentName: requestStudentName,
      studentId: requestStudentId,
      studentDivision,
      feedbackType: options.feedbackType || 'growth',
      feedbackMonth,
      feedbackMonthNumber,
      futureDirection
    });
    if (!opened) throw new Error('피드백 검토 창을 열지 못했습니다.');
  } catch (err) {
    hideFeedbackLoading();
    console.error('성장 피드백 생성/저장 오류:', err);
    alert(`성장 피드백 생성 또는 저장 중 오류가 발생했어요.\n\n${err.message || '알 수 없는 오류입니다.'}`);
  } finally {
    observationFeedbackLoading = false;

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 19V5"></path><path d="M5 12l7-7 7 7"></path></svg>';
    }
  }
}

function getStudentModeEntries(records, mode) {
  if (mode === 'summary') return records.filter(r => String(r.source_table || '').toLowerCase() === 'summary_feedbacks');
  return records.filter(r => String(r.feedback_type || 'class').toLowerCase() === mode);
}
function buildStudentShareText(studentName, records, mode) {
  const label = getRecordModeLabel(mode);
  const entries = getStudentModeEntries(records, mode).sort((a, b) => (parseDateSafe(b.date)?.getTime() || 0) - (parseDateSafe(a.date)?.getTime() || 0)).map(item => `${item.date || ''}\n${item.content || ''}`);
  return `${studentName} ${label}\n\n${entries.join('\n')}`.trim();
}
function copyStudentFeedback(btn, studentName, encodedRecords) {
  const records = JSON.parse(decodeURIComponent(encodedRecords));
  const text = buildStudentShareText(studentName, records, currentRecordMode);
  cp(btn, text);
}
async function shareStudentFeedback(studentName, encodedRecords) {
  const records = JSON.parse(decodeURIComponent(encodedRecords));
  const text = buildStudentShareText(studentName, records, currentRecordMode);
  await shareText(text);
}

function setObservationButtonSide(view, animate = true) {
  const modeButton = document.getElementById('recordModeToggleBtn');
  if (!modeButton) return;
  const inner = modeButton.querySelector('.flipInner');
  const shouldFlip = view === 'kinder';

  if (!animate && inner) {
    inner.classList.add('noTransition');
    modeButton.classList.toggle('flipped', shouldFlip);
    void inner.offsetWidth;
    inner.classList.remove('noTransition');
    return;
  }

  modeButton.classList.toggle('flipped', shouldFlip);
}

const OLLI_RECORD_LAST_DIVISION_STORAGE_KEY = 'olli_record_last_division_v1';

function getOlliRecordLastDivisionStorageKey() {
  let academyId = '';
  try {
    academyId = String(typeof getOlliCurrentAcademyId === 'function' ? (getOlliCurrentAcademyId() || '') : '').trim();
  } catch (_) {}
  return academyId ? `${OLLI_RECORD_LAST_DIVISION_STORAGE_KEY}:${academyId}` : OLLI_RECORD_LAST_DIVISION_STORAGE_KEY;
}

function getOlliLastRecordDivisionView() {
  try {
    const saved = String(localStorage.getItem(getOlliRecordLastDivisionStorageKey()) || '').trim();
    if (saved === 'elementary' || saved === 'kinder') return saved;
  } catch (_) {}
  return currentObservationView === 'kinder' ? 'kinder' : 'elementary';
}

function saveOlliLastRecordDivisionView(view) {
  const normalized = view === 'kinder' ? 'kinder' : (view === 'elementary' ? 'elementary' : '');
  if (!normalized) return false;
  try {
    localStorage.setItem(getOlliRecordLastDivisionStorageKey(), normalized);
    return true;
  } catch (_) {
    return false;
  }
}

window.getOlliLastRecordDivisionView = getOlliLastRecordDivisionView;
window.saveOlliLastRecordDivisionView = saveOlliLastRecordDivisionView;

function updateRecordHeaderUI() {
  // 출석부 요약 탭은 삭제되었습니다. 과거 값이 남아 있으면 현재 부서 화면으로 되돌립니다.
  if (currentRecordView === 'attendance') {
    currentRecordView = currentObservationView === 'kinder' ? 'kinder' : 'elementary';
  }
  try { window.currentRecordView = currentRecordView; } catch(err) {}
  const elementaryToggle = document.getElementById('recordElementaryToggle');
  const kinderToggle = document.getElementById('recordKinderToggle');
  if (elementaryToggle) elementaryToggle.classList.toggle('active', currentRecordView === 'elementary');
  if (kinderToggle) kinderToggle.classList.toggle('active', currentRecordView === 'kinder');

  const isObservationView = currentRecordView === 'elementary' || currentRecordView === 'kinder';
  const isAcademyManagementView = currentRecordView === 'academy';
  const screen = document.getElementById('recordRoomScreen');
  if (screen) screen.classList.toggle('record-academy-management-mode', isAcademyManagementView);
  if (typeof refreshOlliRoleBasedVisibilityUI === 'function') refreshOlliRoleBasedVisibilityUI();
  const academyManageBtn = document.getElementById('recordAcademyManageBtn');
  if (academyManageBtn) academyManageBtn.classList.toggle('active', isAcademyManagementView);
  const attendanceDashboardBtn = document.getElementById('recordAttendanceDashboardBtn');
  if (attendanceDashboardBtn) attendanceDashboardBtn.classList.toggle('active', isObservationView);
  const modeLabelRow = document.querySelector('#recordRoomScreen .recordModeLabelRow');
  if (modeLabelRow) modeLabelRow.style.display = isAcademyManagementView ? 'none' : '';
  const academyDashboard = document.getElementById('recordAcademyDashboard');
  if (academyDashboard) academyDashboard.classList.toggle('show', isAcademyManagementView);
  const recordList = document.getElementById('recordList');
  if (recordList) recordList.style.display = isAcademyManagementView ? 'none' : '';

  const addBtn = document.getElementById('studentAddBtn');
  if (addBtn) {
    if (isObservationView && !studentSelectionMode) addBtn.classList.add('show');
    else {
      addBtn.classList.remove('show');
      closeRecordAddMenu();
    }
  }

  const selectionControls = document.getElementById('recordSelectionControls');
  if (selectionControls) {
    if (isObservationView && studentSelectionMode) selectionControls.classList.add('show');
    else selectionControls.classList.remove('show');
  }
}

function restoreRecordSearchFocus() {
  const screen = document.getElementById('recordRoomScreen');
  const input = document.getElementById('searchName');
  if (!screen || !screen.classList.contains('record-search-open') || !input) return;
  try { input.focus({ preventScroll:true }); } catch(err) { input.focus(); }
  try { input.setSelectionRange(input.value.length, input.value.length); } catch(err) {}
  if (typeof window.setRecordKeyboardOffset === 'function') window.setRecordKeyboardOffset();
}

function handleRecordViewTogglePress(event, targetView) {
  const screen = document.getElementById('recordRoomScreen');
  if (screen && screen.classList.contains('record-search-open')) {
    if (event) event.preventDefault();
    window.__recordViewToggleHandledUntil = Date.now() + 500;
    toggleRecordViewMode(targetView);
    restoreRecordSearchFocus();
    setTimeout(restoreRecordSearchFocus, 60);
    return;
  }
  toggleRecordViewMode(targetView);
}

function handleRecordViewToggleClick(event, targetView) {
  if (Date.now() < (window.__recordViewToggleHandledUntil || 0)) {
    if (event) event.preventDefault();
    return;
  }
  toggleRecordViewMode(targetView);
}

async function toggleRecordViewMode(targetView) {
  studentSelectionMode = false;
  selectedStudentIds.clear();

  // 삭제된 출석부 요약 탭으로 들어오려는 호출은 현재 부서 화면으로 되돌립니다.
  if (targetView === 'attendance') {
    targetView = currentObservationView === 'kinder' ? 'kinder' : 'elementary';
  }

  const nextView = targetView === 'kinder'
    ? 'kinder'
    : (targetView === 'elementary' ? 'elementary' : (currentObservationView === 'elementary' ? 'kinder' : 'elementary'));
  if (nextView === 'elementary' || nextView === 'kinder') {
    currentObservationView = nextView;
    saveOlliLastRecordDivisionView(nextView);
  }
  currentRecordView = nextView;

  const screen = document.getElementById('recordRoomScreen');
  const input = document.getElementById('searchName');
  const pill = document.getElementById('recordSearchPill');
  const searchValue = input ? input.value.trim() : '';
  const keepSearchOpen = !!(screen && screen.classList.contains('record-search-open'));

  updateRecordHeaderUI();
  if (typeof window.refreshRecordSortPopup === 'function') setTimeout(window.refreshRecordSortPopup, 0);

  if (keepSearchOpen) {
    if (screen) {
      screen.classList.add('record-search-open');
      screen.classList.toggle('record-search-has-query', !!searchValue);
    }
    if (pill) pill.classList.add('active');

    const restoreSearchFocus = () => {
      if (!input) return;
      try { input.focus({ preventScroll:true }); } catch(err) { input.focus(); }
      try { input.setSelectionRange(input.value.length, input.value.length); } catch(err) {}
      if (typeof window.setRecordKeyboardOffset === 'function') window.setRecordKeyboardOffset();
    };

    restoreSearchFocus();
    await loadRecords(searchValue);
    restoreSearchFocus();
    setTimeout(restoreSearchFocus, 20);
    setTimeout(restoreSearchFocus, 120);
    setTimeout(restoreSearchFocus, 260);
  } else {
    await loadRecords('');
  }
}


async function toggleRecordMode() {
  studentSelectionMode = false;
  selectedStudentIds.clear();
  if (currentRecordView === 'elementary' || currentRecordView === 'kinder') {
    currentObservationView = currentRecordView;
    currentRecordView = 'saved';
    recordStorageRotation += 90;
    const switchIcon = document.querySelector('#recordStorageToggleBtn svg');
    if (switchIcon) switchIcon.style.transform = `rotate(${recordStorageRotation}deg)`;
    updateRecordHeaderUI();
    await loadRecords('');
    return;
  }

  const currentIndex = RECORD_MODE_ORDER.indexOf(currentRecordMode);
  currentRecordMode = RECORD_MODE_ORDER[(currentIndex + 1) % RECORD_MODE_ORDER.length];
  recordStorageRotation += 90;
  const modeIcon = document.querySelector('#recordStorageToggleBtn svg');
  if (modeIcon) modeIcon.style.transform = `rotate(${recordStorageRotation}deg)`;
  updateRecordHeaderUI();

  const screen = document.getElementById('recordRoomScreen');
  const input = document.getElementById('searchName');
  if (screen && screen.classList.contains('record-search-open')) {
    const name = input.value.trim();
    if (!name) {
      document.getElementById('recordList').innerHTML = '<div class="recordEmpty">학생 이름을 검색해 주세요.</div>';
      return;
    }
    await loadRecords(name);
    return;
  }
  await loadRecords('');
}

async function showRecordRoom(options = {}) {
  const localOnly = options?.localOnly === true;
  if (window.OlliOneMinuteFeedbackLifecycle && typeof window.OlliOneMinuteFeedbackLifecycle.beforeLeave === 'function') {
    window.OlliOneMinuteFeedbackLifecycle.beforeLeave();
  }
  setFeedbackPageBackgroundActive(false);
  const memo = document.getElementById('studentMemoScreen');
  const card = document.getElementById('mainPageScreen');
  const record = document.getElementById('recordRoomScreen');

  const isVisible = element => {
    if (!element) return false;
    try { return getComputedStyle(element).display !== 'none'; }
    catch (_) { return element.style.display !== 'none'; }
  };
  const memoVisible = isVisible(memo);
  const cardVisible = isVisible(card);
  previousScreenBeforeRecordRoom = memoVisible ? 'studentMemo' : (cardVisible ? 'mainPage' : 'recordRoom');

  const resetRecordSearchUi = () => {
    const pill = document.getElementById('recordSearchPill');
    const input = document.getElementById('searchName');
    if (record) record.classList.remove('record-search-open');
    if (pill) pill.classList.remove('active');
    if (input) input.value = '';
  };

  // 관찰노트 -> 기록실 전환은 화면을 먼저 즉시 바꾸고 데이터 갱신은 다음 프레임에서 진행한다.
  // late runtime wrapper 대신 원본 showRecordRoom이 이 동작을 직접 소유한다.
  if (memoVisible && record) {
    memo.classList.remove('vivizac-slide-in', 'vivizac-slide-out');
    record.classList.remove('vivizac-slide-in', 'vivizac-slide-out');
    memo.style.display = 'none';
    if (card) card.style.display = 'none';
    record.style.display = 'flex';
    resetRecordSearchUi();
    updateRecordHeaderUI();
    requestAnimationFrame(() => {
      try {
        const result = loadRecords('', { localOnly });
        if (result && typeof result.catch === 'function') {
          result.catch(error => console.warn('기록실 백그라운드 갱신 실패:', error?.message || error));
        }
      } catch (error) {
        console.warn('기록실 즉시 전환 후 갱신 실패:', error?.message || error);
      }
    });
    return;
  }

  const current = vivizacGetVisibleNotePage();
  if (record) record.style.display = 'flex';
  const finishRecordOpen = async () => {
    if (memo) memo.style.display = 'none';
    if (card) card.style.display = 'none';
    if (record) record.style.display = 'flex';
    resetRecordSearchUi();
    updateRecordHeaderUI();
    await loadRecords('', { localOnly });
  };
  if (current && current.id !== 'recordRoomScreen') {
    vivizacSlideOutPageToRecord(current, () => { finishRecordOpen(); });
    return;
  }
  await finishRecordOpen();
}
function hideRecordRoom() {
  document.getElementById('studentMemoScreen').style.display = 'none';
  document.getElementById('recordRoomScreen').style.display = 'none';
  const card = document.getElementById('mainPageScreen');

  if (previousScreenBeforeRecordRoom === 'studentMemo' && currentMemoStudent) {
    if (card) card.style.display = 'none';
    const memo = document.getElementById('studentMemoScreen');
    if (memo) { memo.style.display = 'flex'; vivizacSlideInPage(memo); }
  } else {
    const record = document.getElementById('recordRoomScreen');
    if (record) record.style.display = 'flex';
  }
}
function toggleStudentBlock(el) {
  const block = el.closest('.recordStudentBlock');
  if (!block) return;
  block.classList.toggle('open');
}
function parseDateSafe(dateStr) {
  if (!dateStr) return null;
  const cleaned = String(dateStr).replace(/\./g, '-').replace(/\s/g, '');
  const d = new Date(cleaned);
  return isNaN(d.getTime()) ? null : d;
}
function getCutoffDate(months) { const d = new Date(); d.setMonth(d.getMonth() - months); return d; }

function syncStudentModalDrawerFadeState() {
  if (document.hidden) return false;

  const modal = document.getElementById('studentModal');
  const modalOpen = !!(
    modal &&
    (modal.style.display === 'flex' || window.getComputedStyle(modal).display !== 'none')
  );

  if (typeof window.setOlliMainSubpageDrawerCompanionFaded === 'function') {
    window.setOlliMainSubpageDrawerCompanionFaded(modalOpen);
  }
  return modalOpen;
}

function restoreStudentModalDrawerFadeAfterAppReturn() {
  if (document.hidden) return;
  syncStudentModalDrawerFadeState();
  requestAnimationFrame(syncStudentModalDrawerFadeState);
  window.setTimeout(syncStudentModalDrawerFadeState, 80);
}

document.addEventListener('visibilitychange', restoreStudentModalDrawerFadeAfterAppReturn);
window.addEventListener('pageshow', restoreStudentModalDrawerFadeAfterAppReturn);

function openStudentModal() {
  if (typeof window.setOlliMainSubpageDrawerCompanionFaded === 'function') {
    window.setOlliMainSubpageDrawerCompanionFaded(true);
  }

  const targetView = (currentRecordView === 'elementary' || currentRecordView === 'kinder')
    ? currentRecordView
    : ((currentObservationView === 'elementary' || currentObservationView === 'kinder') ? currentObservationView : 'elementary');
  currentRecordView = targetView;
  currentObservationView = targetView;

  if (typeof window.olliPatchStudentModalMarkup === 'function') window.olliPatchStudentModalMarkup();

  document.getElementById('studentModal').style.display = 'flex';
  document.getElementById('studentModalTitle').textContent = targetView === 'elementary' ? '초등 학생 등록' : '유치부 학생 등록';
  const yearInput = document.getElementById('studentYearBadge');
  if (yearInput) {
    const currentYear = String(getCurrentYear());
    yearInput.value = currentYear;
    yearInput.defaultValue = currentYear;
  }

  const nameInput = document.getElementById('studentNameInput');
  const monthInput = document.getElementById('studentMonthInput');
  const dayInput = document.getElementById('studentDayInput');
  const kindergartenInput = document.getElementById('studentKindergartenInput');
  const ageInput = document.getElementById('studentAgeInput');
  const kinderExtraFields = document.getElementById('kinderExtraFields');

  const todayForStudentModal = new Date();
  nameInput.value = '';
  monthInput.value = String(todayForStudentModal.getMonth() + 1);
  dayInput.value = String(todayForStudentModal.getDate());
  if (kindergartenInput) kindergartenInput.value = '';
  if (ageInput) ageInput.value = '';
  if (kinderExtraFields) kinderExtraFields.style.display = targetView === 'kinder' ? 'block' : 'none';
  if (typeof window.olliPrepareStudentAddExtra === 'function') window.olliPrepareStudentAddExtra(targetView);

  setTimeout(() => nameInput.focus(), 50);
}
function closeStudentModal() {
  hideModalOnly('studentModal');
  syncStudentModalDrawerFadeState();
}
async function confirmStudent() {
  const name = document.getElementById('studentNameInput').value.trim();
  const year = Number(document.getElementById('studentYearBadge')?.value || getCurrentYear());
  const month = Number(document.getElementById('studentMonthInput').value);
  const day = Number(document.getElementById('studentDayInput').value);
  const kindergarten = document.getElementById('studentKindergartenInput')?.value.trim() || '';
  const age = document.getElementById('studentAgeInput')?.value.trim() || '';

  if (!name) {
    alert('학생 이름을 입력해 주세요.');
    return;
  }
  if (!year || year < 1900 || year > 2100) {
    alert('등록 연도를 올바르게 입력해 주세요.');
    return;
  }
  if (!month || month < 1 || month > 12) {
    alert('등록 월을 올바르게 입력해 주세요.');
    return;
  }
  if (!day || day < 1 || day > 31) {
    alert('등록 일을 올바르게 입력해 주세요.');
    return;
  }

  const type = currentRecordView === 'kinder' ? 'kinder' : 'elementary';
  const list = getStudentsByType(type);
  const duplicate = list.some(student => student.name === name && String(student.year) === String(year) && String(student.month) === String(month) && String(student.day) === String(day));
  if (duplicate) {
    alert('같은 이름과 등록일의 학생이 이미 등록되어 있습니다.');
    return;
  }

  const extraInfo = typeof window.olliGetStudentAddExtra === 'function' ? window.olliGetStudentAddExtra(type) : {};
  const selectedGroup = type === 'elementary' ? (extraInfo.group || '') : '';
  const selectedGroupMonths = type === 'elementary' ? elementaryGroupMonthsToText(extraInfo.group_months || extraInfo.feedback_months || getElementaryGroupFeedbackMonths(selectedGroup)) : '';

  const newStudent = {
    id: uid(),
    type,
    name,
    year,
    month: String(month),
    day: String(day),
    enrolled_at: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    kindergarten: type === 'kinder' ? kindergarten : '',
    age: type === 'kinder' ? age : (type === 'elementary' ? getElementaryAgeFromGrade(extraInfo.grade || '') : ''),
    birth_year: type === 'kinder' ? inferOlliBirthYearFromAge(age) : '',
    school_entry_year: type === 'elementary' ? inferOlliSchoolEntryYearFromGrade(extraInfo.grade || '') : '',
    previous_division: '',
    division_changed_at: '',
    group: selectedGroup, group_months: selectedGroupMonths, feedback_months: selectedGroupMonths, personality: extraInfo.personality || '', school: type === 'elementary' ? (extraInfo.school || '') : '', grade: type === 'elementary' ? (extraInfo.grade || '') : '', className: '',
    memoUpdatedAt: '',
    status: 'active'
  };

  try {
    const savedStudent = await ensureStudentSavedToSupabase(newStudent);
    let scheduleError = null;
    const schedulePairs = Array.isArray(extraInfo.schedule_pairs) ? extraInfo.schedule_pairs.filter(Boolean) : [];

    if (schedulePairs.length) {
      try {
        const service = window.OlliPhoneStudentScheduleService;
        if (!service?.saveSchedule) throw new Error('시간표 저장 기능을 찾지 못했습니다.');
        const now = new Date();
        const scheduleDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        await service.saveSchedule(savedStudent, type, schedulePairs, scheduleDate);
      } catch (error) {
        scheduleError = error;
        console.warn('학생 등록 후 수업시간 저장 실패:', error?.message || error);
      }
    }

    closeStudentModal();
    await loadRecords('');

    if (scheduleError) {
      alert(`${savedStudent.name} 학생은 등록되었지만 수업시간 저장에 실패했어요.\n\n${scheduleError.message || scheduleError}`);
    } else {
      showPushToast(`${savedStudent.name} 학생이 저장되었습니다.`);
    }
  } catch (err) {
    alert(`학생 저장에 실패했어요.\n\n${err.message || err}`);
  }
}

function autoResizeTextarea(el) {
  if (!el) return;
  const minHeight = Number(el.dataset.minHeight || 140);
  el.style.height = 'auto';
  el.style.height = Math.max(el.scrollHeight, minHeight) + 'px';
}

function markObservationMemoEditorClean() {
  const core = window.ObservationMemoEditStateCore;
  if (!core || typeof core.markClean !== 'function') return false;
  const memoEditor = document.getElementById('memoEditor');
  return core.markClean({
    studentId: currentMemoStudent?.id || '',
    currentType: currentMemoType,
    text: memoEditor?.value || ''
  });
}

async function saveObservationMemoServerSnapshot(options = {}) {
  if (!currentMemoStudent || !['elementary', 'kinder'].includes(currentMemoType)) return null;
  const editor = document.getElementById('memoEditor');
  if (!editor) return null;

  // A read-only visit must never become a write. Only an actual input event marks
  // the edit session dirty. Blur, Done and page close are flush triggers, not save
  // triggers by themselves.
  if (options.force !== true && !hasObservationMemoDirtyChanges()) {
    return getObservationMemoUnchangedResult();
  }

  if (window.__olliObservationMemoServerSavePromise) {
    return window.__olliObservationMemoServerSavePromise;
  }

  const studentId = String(currentMemoStudent.id || '');
  const textAtStart = String(editor.value || '');
  let savePromise;
  savePromise = (async () => {
    try {
      const result = await saveCurrentMemo({
        silent: true,
        status: options.status === true
      });
      const stillSameDraft =
        currentMemoStudent &&
        String(currentMemoStudent.id || '') === studentId &&
        String(document.getElementById('memoEditor')?.value || '') === textAtStart;
      if (
        stillSameDraft &&
        result &&
        (result.state === 'synced' || result.state === 'cleared' || result.state === 'unchanged') &&
        result.superseded !== true
      ) {
        markObservationMemoEditorClean();
      }
      return result;
    } catch (error) {
      console.warn('관찰노트 서버 자동저장 실패:', error?.message || error);
      return null;
    } finally {
      if (window.__olliObservationMemoServerSavePromise === savePromise) {
        window.__olliObservationMemoServerSavePromise = null;
      }
    }
  })();

  window.__olliObservationMemoServerSavePromise = savePromise;
  return savePromise;
}

function applyReconciledObservationMemoDraft(student, memoEditor, result) {
  if (!student || !memoEditor || !result) {
    return { applied: false, reason: 'no-remote-update' };
  }

  const isSameMemoPage =
    currentMemoStudent &&
    String(currentMemoStudent.id || '') === String(student.id || '') &&
    ['elementary', 'kinder'].includes(currentMemoType);

  if (!isSameMemoPage) {
    return { applied: false, reason: 'stale-session' };
  }

  const state = getObservationMemoEditState();
  if (state && isObservationMemoEditStateCurrent(student) && state.dirty) {
    return { applied: false, reason: 'user-edited-during-sync' };
  }

  if (!result.adoptedRemote) {
    const metadataOnly =
      result.conflictDetected !== true &&
      !!result.remoteRow &&
      ['remote-confirmed-local', 'remote-equivalent-local'].includes(String(result.source || ''));
    if (metadataOnly) {
      if (state && isObservationMemoEditStateCurrent(student)) {
        state.baselineText = String(result.content ?? memoEditor.value ?? '');
        state.dirty = false;
      }
      if (typeof updateMemoStudentMetaDisplay === 'function') {
        updateMemoStudentMetaDisplay(student, result.updatedAt || '');
      }
      return { applied: false, metadataUpdated: true, reason: 'remote-metadata-normalized' };
    }
    return { applied: false, reason: 'no-remote-update' };
  }

  memoEditor.value = String(result.content || '');
  autoResizeTextarea(memoEditor);
  if (state && isObservationMemoEditStateCurrent(student)) {
    state.baselineText = String(result.content || '');
    state.dirty = false;
  }
  if (typeof updateMemoStudentMetaDisplay === 'function') {
    updateMemoStudentMetaDisplay(student, result.updatedAt || '');
  }

  return { applied: true, reason: 'remote-applied' };
}

function isObservationMemoScreenActive() {
  const screen = document.getElementById('studentMemoScreen');
  return !!(
    screen &&
    screen.style.display !== 'none' &&
    currentMemoStudent &&
    ['elementary', 'kinder'].includes(currentMemoType)
  );
}

async function refreshCurrentObservationMemoFromServer() {
  if (!isObservationMemoScreenActive()) return null;
  if (hasObservationMemoDirtyChanges()) return null;
  if (isObservationMemoAutoSaveBlocked()) return null;

  const student = currentMemoStudent ? { ...currentMemoStudent } : null;
  const editor = document.getElementById('memoEditor');
  if (!student?.id || !editor) return null;

  try {
    const state = getObservationMemoEditState();
    const noteType = String(state?.noteType || 'elementary_observation');
    if (typeof window.getObservationMemoRequestGuardState === 'function') {
      const guard = window.getObservationMemoRequestGuardState(student, noteType);
      if (guard?.inFlight) return null;
    }
    const result = await reconcileObservationMemoDraft(student, noteType);
    applyReconciledObservationMemoDraft(student, editor, result);
    return result;
  } catch (error) {
    console.warn('관찰노트 서버 최신본 확인 실패:', error?.message || error);
    return null;
  }
}


function requestObservationMemoCrossDeviceRefresh() {
  if (window.__olliObservationMemoRemoteRefreshPending) return;
  window.__olliObservationMemoRemoteRefreshPending = true;
  setTimeout(async () => {
    try {
      await refreshCurrentObservationMemoFromServer();
    } finally {
      window.__olliObservationMemoRemoteRefreshPending = false;
    }
  }, 0);
}

function returnFromObservationMemoScreen(onReturned) {
  const current = vivizacGetVisibleNotePage();
  if (current && current.id === 'studentMemoScreen') {
    vivizacSlideOutPageToRecord(current, () => {
      if (typeof onReturned === 'function') onReturned();
    });
    return true;
  }

  const studentMemoScreen = document.getElementById('studentMemoScreen');
  if (studentMemoScreen) studentMemoScreen.style.display = 'none';
  const recordRoom = document.getElementById('recordRoomScreen');
  if (recordRoom) recordRoom.style.display = 'flex';
  if (typeof onReturned === 'function') onReturned();
  return false;
}

function setMemoModePillLabel(label = '학생 이름', modeLabel = '관찰 모드') {
  const el = document.getElementById('memoStudentName');
  const sub = document.getElementById('memoModeSub');
  if (el) el.textContent = '관찰 노트';
  if (sub) sub.textContent = modeLabel || '관찰 모드';
}
function formatMemoUpdatedDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}.${m}.${d} ${hh}:${mm}`;
}
function updateMemoStudentMetaDisplay(student, updatedAt = '') {
  const nameEl = document.getElementById('memoPageStudentName');
  const dateEl = document.getElementById('memoStudentUpdatedDate');
  if (nameEl) nameEl.textContent = student?.name || '학생 이름';
  if (dateEl) {
    const activeNoteType = String(getObservationMemoEditState()?.noteType || 'elementary_observation');
    const localEntry = getMemoEntryByStudent(student, activeNoteType);
    const hasMemoContent = String(localEntry.content || '').trim().length > 0;
    const dateSource = updatedAt || (hasMemoContent ? localEntry.updatedAt : '');
    const dateText = formatMemoUpdatedDate(dateSource || '');
    if (dateText) {
      dateEl.hidden = false;
      dateEl.style.display = 'flex';
      dateEl.innerHTML = `<span>마지막 수정</span><span>${escapeHtml(dateText)}</span>`;
    } else {
      dateEl.hidden = true;
      dateEl.style.display = 'none';
      dateEl.innerHTML = '';
    }
  }
}
function forceObservationMemoControlsVisible(options = {}) {
  const screen = document.getElementById('studentMemoScreen');
  if (!screen) return false;
  if (screen.style.display === 'none') return false;

  const extraInlineFlex = Array.isArray(options.extraInlineFlex) ? options.extraInlineFlex : [];
  const showInlineFlex = [
    '#memoRecordRoomBtn',
    '#memoStudentListBtn',
    ...(currentMemoType === 'elementary' ? ['#memoBottomAnalysisBtn'] : []),
    '#memoFeedbackBtn',
    ...extraInlineFlex
  ];
  const showFlex = ['#studentMemoScreen .memoBottomBar'];
  const showBlock = ['#memoStudentSelectWrap'];

  const reveal = (selector, display) => {
    const el = document.querySelector(selector);
    if (!el) return;
    el.hidden = false;
    el.removeAttribute('hidden');
    el.removeAttribute('aria-hidden');
    el.style.visibility = 'visible';
    el.style.opacity = '1';
    el.style.pointerEvents = 'auto';
    el.style.display = display;
  };

  [...new Set(showInlineFlex)].forEach(selector => reveal(selector, 'inline-flex'));
  showFlex.forEach(selector => reveal(selector, 'flex'));
  showBlock.forEach(selector => reveal(selector, ''));
  return true;
}
function renderMemoModeMenu() {
  const menu = document.getElementById('memoModeDropup');
  if (!menu) return;
  const checkSvg = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"></path></svg>';
  const option = (active, title, guide, action) => `
    <button type="button" class="memoRecordOption ${active ? 'active' : ''}" onclick="${action}">
      <span class="memoModeCheck" aria-hidden="true">${active ? checkSvg : ''}</span>
      <span class="memoModeOptionText">
        <span class="memoModeOptionTitle">${title}</span>
        <span class="memoModeOptionGuide">${guide}</span>
      </span>
    </button>`;
  const division = currentMemoType === 'kinder' ? 'kinder' : 'elementary';
  menu.innerHTML = `
    ${option(false, '1분 피드백', '수업기록을 빠르게 수업 피드백으로 정리', `closeMemoModeMenu(); openKinderChatFeedbackPage({ division: '${division}' });`)}
    ${option(false, '실패-성장 피드백', '막힘·전환 장면을 깊게 정리', "openMemoFailGrowthMode(event);")}
    ${option(true, '관찰 노트', '관찰메모로 성장 피드백 작성', "closeMemoModeMenu(); openMemoObservationMode(event);")}
  `;
}
function closeMemoModeMenu() { const menu = document.getElementById('memoModeDropup'); if (menu) menu.classList.remove('show'); }
function toggleMemoModeMenu(event) {
  if (event) event.stopPropagation();
  renderMemoModeMenu();
  const menu = document.getElementById('memoModeDropup');
  if (menu) menu.classList.toggle('show');
}
function openMemoObservationMode(event) { if (event) event.stopPropagation(); closeMemoModeMenu(); const memo = document.getElementById('studentMemoScreen'); if (memo) memo.style.display = 'flex'; if (typeof forceStudentMemoControlsVisible === 'function') { forceStudentMemoControlsVisible(); requestAnimationFrame(forceStudentMemoControlsVisible); } }
function openMemoFailGrowthMode(event) {
  if (event) event.stopPropagation();
  closeMemoModeMenu();
  if (currentMemoType === 'kinder' && typeof openKinderChatFeedbackGrowthSheet === 'function') {
    openKinderChatFeedbackGrowthSheet();
    return;
  }
  if (currentMemoType === 'elementary' && typeof openElementaryGrowthFeedbackSheet === 'function') {
    openElementaryGrowthFeedbackSheet();
    return;
  }
  alert('실패-성장 피드백을 열 수 없습니다.');
}
document.addEventListener('click', (event) => { const wrap = document.getElementById('memoModeWrap'); if (wrap && !wrap.contains(event.target)) closeMemoModeMenu(); });

function openObservationMemoScreenShell(session) {
  if (!session || !['elementary', 'kinder'].includes(session.type)) return false;

  const recordRoomScreen = document.getElementById('recordRoomScreen');
  const studentMemoScreenEl = document.getElementById('studentMemoScreen');
  if (recordRoomScreen) recordRoomScreen.style.display = 'none';

  if (studentMemoScreenEl) {
    studentMemoScreenEl.classList.remove('vivizac-slide-page', 'vivizac-slide-in', 'vivizac-slide-out');
    studentMemoScreenEl.style.animation = '';
    studentMemoScreenEl.style.transform = '';
    studentMemoScreenEl.style.display = 'flex';
    studentMemoScreenEl.setAttribute('data-current-memo-type', session.type);
  }

  return !!studentMemoScreenEl;
}

function renderObservationMemoScreenChrome(session) {
  if (!session || !['elementary', 'kinder'].includes(session.type) || !session.student) return false;
  const student = session.student;

  if (typeof forceStudentMemoControlsVisible === 'function') {
    forceStudentMemoControlsVisible();
    requestAnimationFrame(forceStudentMemoControlsVisible);
    setTimeout(forceStudentMemoControlsVisible, 120);
  }

  if (typeof setMemoModePillLabel === 'function') {
    setMemoModePillLabel(student.name || '학생 이름');
  }
  if (typeof updateMemoStudentMetaDisplay === 'function') {
    updateMemoStudentMetaDisplay(student);
  }

  const memoNameBtn = document.getElementById('memoStudentNameBtn');
  if (memoNameBtn) {
    if (typeof toggleMemoModeMenu === 'function') memoNameBtn.onclick = toggleMemoModeMenu;
    memoNameBtn.title = '메모 유형 선택';
    memoNameBtn.setAttribute('aria-label', '메모 유형 선택');
  }

  const feedbackBtn = document.getElementById('memoFeedbackBtn');
  const analysisBtn = document.getElementById('memoBottomAnalysisBtn') || document.getElementById('memoAnalysisBtn');
  const elementaryWrap = document.getElementById('elementaryMemoWrap');

  if (feedbackBtn) {
    feedbackBtn.style.display = 'inline-flex';
    feedbackBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"></path><path d="M5 12l7-7 7 7"></path></svg>성장 피드백 생성';
  }
  if (analysisBtn) analysisBtn.style.display = session.type === 'elementary' ? 'inline-flex' : 'none';
  if (elementaryWrap) elementaryWrap.style.display = 'block';

  if (typeof forceStudentMemoControlsVisible === 'function') {
    forceStudentMemoControlsVisible();
  }
  return true;
}

function renderObservationMemoInitialView(session) {
  const view = typeof prepareObservationMemoInitialView === 'function'
    ? prepareObservationMemoInitialView(session)
    : null;
  if (!view) return null;

  const memoEditor = document.getElementById('memoEditor');
  if (memoEditor) {
    memoEditor.readOnly = false;
    beginObservationMemoEditSession(view.student, view.noteType, view.memoText || '');
    memoEditor.value = view.memoText || '';

    reconcileObservationMemoDraft(view.student, view.noteType)
      .then(result => {
        applyReconciledObservationMemoDraft(view.student, memoEditor, result);
      })
      .catch(err => {
        console.warn('student_note_drafts 불러오기 실패:', err.message || err);
      });
  }

  if (session.type === 'elementary') {
    renderElementaryAnalysisSummaryCard(view.analysis.data || {}, {
      title: '분석 결과',
      createdAt: view.analysis.createdAt || ''
    });
    renderElementaryAnalysisHistoryCards(view.student);
  }
  setMemoSaveStatus('자동 저장');

  return view;
}

function setMemoSaveStatus(text) {
  const el = document.getElementById('memoSaveStatus');
  if (!el) return;
  el.textContent = '';
}

function showMemoSaveCheck() {
  setMemoSaveStatus('');
}

function handleMemoHeaderAction() {
  if (typeof requestGrowthFeedback === 'function') requestGrowthFeedback();
  else requestElementaryFeedback();
}

function showPushToast(message) {
  let toast = document.getElementById('pushToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'pushToast';
    toast.className = 'pushToast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(window.__pushToastTimer);
  window.__pushToastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2200);
}

function openMoreMenuPlaceholder() {
  showPushToast('준비 중입니다.');
}

function forceStudentMemoControlsVisible() {
  return forceObservationMemoControlsVisible();
}

function openStudentMemoPageById(studentId) {
  if (window.OlliOneMinuteFeedbackLifecycle && typeof window.OlliOneMinuteFeedbackLifecycle.beforeLeave === 'function') {
    try { window.OlliOneMinuteFeedbackLifecycle.beforeLeave(); }
    catch (error) { console.warn('관찰노트 진입 전 피드백 정리 실패:', error?.message || error); }
  }

  let session = null;
  try {
    session = beginObservationMemoSession(studentId);
  } catch (error) {
    console.error('관찰노트 메모 세션 생성 실패:', error?.message || error);
    return false;
  }
  if (!session) return false;

  try { closeMemoModeMenu(); } catch (_) {}
  try { closeMemoStudentSelectPopup(); } catch (_) {}
  viewingArchivedElementaryRecord = false;

  // 화면 소유권은 메모/분석 초기화보다 먼저 확정한다.
  // 부가 데이터 하나가 실패해도 학생 메모 화면 자체가 열리지 않는 상태를 만들지 않는다.
  const shellOpened = openObservationMemoScreenShell(session);
  if (!shellOpened) return false;

  try {
    renderObservationMemoScreenChrome(session);
  } catch (error) {
    console.warn('관찰노트 메모 화면 UI 초기화 실패:', error?.message || error);
  }

  try {
    renderObservationMemoInitialView(session);
  } catch (error) {
    console.warn('관찰노트 메모 초기 데이터 표시 실패:', error?.message || error);
  }

  return true;
}



function closeMemoPage() {
  prepareObservationMemoPageClose();
  returnFromObservationMemoScreen(() => loadRecords(''));
}





async function saveCurrentMemo(options = {}) {
  if (!currentMemoStudent || !['elementary', 'kinder'].includes(currentMemoType)) return;
  if (currentMemoType === 'elementary' && viewingArchivedElementaryRecord) return;

  const savingStudent = { ...currentMemoStudent };
  const savingType = currentMemoType;
  const isStillCurrentMemoStudent = () =>
    currentMemoStudent &&
    String(currentMemoStudent.id || '') === String(savingStudent.id || '') &&
    currentMemoType === savingType;

  const memoText = document.getElementById('memoEditor')?.value || '';
  if (['elementary', 'kinder'].includes(savingType) && typeof window.ensureOlliObservationMemoWritableSession === 'function') {
    const writable = await window.ensureOlliObservationMemoWritableSession();
    if (!writable && navigator.onLine !== false) {
      const entry = typeof getMemoEntryByStudent === 'function' ? (getMemoEntryByStudent(savingStudent, 'elementary_observation') || {}) : {};
      return {
        state: 'pending',
        student: savingStudent,
        error: null,
        revision: Number(entry.revision || 0),
        sessionRequired: true
      };
    }
  }
  const result = await persistObservationMemoDraft(savingStudent, memoText, {
    noteType: 'elementary_observation'
  });

  if (result?.state === 'pending' && result.error) {
    console.warn('관찰노트 Supabase 저장 실패:', result.error.message || result.error);
  }

  if (isStillCurrentMemoStudent() && result?.student) {
    currentMemoStudent = result.student;
    if (result.state === 'cleared') updateMemoStudentMetaDisplay(result.student, '');
  }

  if (options.status) setMemoSaveStatus('');
  if (result?.state !== 'cleared' && (!options.silent || options.status)) showMemoSaveCheck();
  return result;
}

















function formatNotificationDate(value) {
  try {
    const d = value ? new Date(value) : new Date();
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${y}.${m}.${day} ${hh}:${mm}`;
  } catch {
    return '';
  }
}



async function showBrowserNotification(message) {
  if (!('Notification' in window)) return false;

  try {
    if (Notification.permission === 'granted') {
      new Notification('올리', { body: message, tag: 'olli-notification' });
      return true;
    }

    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        new Notification('올리', { body: message, tag: 'olli-notification' });
        return true;
      }
    }
  } catch (err) {
    console.warn('browser notification failed:', err);
  }

  return false;
}



async function requestGrowthFeedback() {
  if (!currentMemoStudent || !['elementary', 'kinder'].includes(currentMemoType)) return;
  if (currentMemoType === 'elementary' && viewingArchivedElementaryRecord) {
    alert('과거 수업 기록은 읽기 전용입니다. 현재 기록을 선택한 뒤 피드백을 요청해 주세요.');
    return;
  }

  const text = String(document.getElementById('memoEditor')?.value || '').trim();
  const studentDivision = currentMemoType === 'kinder' ? 'kinder' : 'elementary';
  const isElementary = studentDivision === 'elementary';
  const analysisData = isElementary ? getElementaryAnalysisByStudent(currentMemoStudent) : null;
  const hasAnalysisContent = isElementary && (typeof elementaryAnalysisHasContent === 'function') ? elementaryAnalysisHasContent(analysisData) : false;
  const analysisPromptText = hasAnalysisContent ? buildElementaryAnalysisMemoText(analysisData, { forPrompt: true }) : '';

  if (!text && !hasAnalysisContent) {
    alert('수업 내용이 부족합니다.');
    return;
  }

  if (text) {
    const entry = typeof getMemoEntryByStudent === 'function'
      ? (getMemoEntryByStudent(currentMemoStudent, 'elementary_observation') || {})
      : {};
    setMemoByStudent(currentMemoStudent, text, {
      updatedAt: entry.updatedAt || new Date().toISOString(),
      lastSyncedAt: entry.lastSyncedAt || '',
      syncStatus: entry.syncStatus || 'local',
      revision: entry.revision || 0,
      mutationId: entry.mutationId || '',
      conflict: entry.conflict || null
    }, 'elementary_observation');
  }

  if (isElementary) {
    archiveCurrentElementaryMemoRecord(currentMemoStudent, text, analysisData);
  }
  showMemoSaveCheck();

  await requestSceneCardFeedbackFromElementary(currentMemoStudent.name, text, analysisPromptText, {
    studentDivision,
    promptType: 'elementary',
    feedbackType: 'growth'
  });
}

async function requestElementaryFeedback() {
  return requestGrowthFeedback();
}


const recordStatusSectionOpenState = {
  elementary: { paused: false, withdrawn: false },
  kinder: { paused: false, withdrawn: false }
};

function isWithdrawnVisibleInAttendance(student) {
  if (getStudentStatus(student) !== 'withdrawn') return false;
  const withdrawnDate = getStudentWithdrawalDateForStats(student);
  if (!withdrawnDate) return true;
  const elapsed = Date.now() - withdrawnDate.getTime();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  return elapsed >= 0 && elapsed <= thirtyDays;
}

function toggleRecordStatusSection(view, status) {
  if (!recordStatusSectionOpenState[view] || !(status in recordStatusSectionOpenState[view])) return;
  recordStatusSectionOpenState[view][status] = !recordStatusSectionOpenState[view][status];
  const searchValue = document.getElementById('searchName')?.value.trim() || '';
  if (view === 'elementary') renderElementaryRecords(searchValue);
  else if (view === 'kinder') renderKinderRecords(searchValue);
}

function renderRecordStatusSection(view, status, label, rowsHtml, emptyText) {
  const isOpen = !!recordStatusSectionOpenState[view]?.[status];
  const bodyHtml = rowsHtml || `<div class="recordStatusSectionEmpty">${escapeHtml(emptyText || '해당 학생이 없습니다.')}</div>`;
  return `<div class="recordStatusSection${isOpen ? ' open' : ''}">
    <button type="button" class="recordStatusSectionToggle" onclick="toggleRecordStatusSection('${view}','${status}')" aria-expanded="${isOpen ? 'true' : 'false'}">
      <span>${escapeHtml(label)}</span>
      <span class="recordStatusSectionTriangle" aria-hidden="true"></span>
    </button>
    <div class="recordStatusSectionBody">${bodyHtml}</div>
  </div>`;
}


const RECORD_DAILY_ATTENDANCE_KEY = 'olli_record_daily_attendance_v1';
function getRecordDailyAttendanceStorageKey() {
  const academyId = (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || 'unscoped';
  return `${RECORD_DAILY_ATTENDANCE_KEY}_${academyId}`;
}
function readRecordDailyAttendanceStore() {
  try {
    const raw = localStorage.getItem(getRecordDailyAttendanceStorageKey());
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch(e) {
    return {};
  }
}
function writeRecordDailyAttendanceStore(store) {
  try {
    localStorage.setItem(getRecordDailyAttendanceStorageKey(), JSON.stringify(store && typeof store === 'object' ? store : {}));
  } catch(e) {
    console.warn('출석 체크 로컬 저장 보류:', e);
  }
}
function formatRecordAttendanceDateKey(dateValue = new Date()) {
  const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function getRecordAttendanceDateFromKey(dateKey) {
  const parts = String(dateKey || '').split('-').map(Number);
  if (parts.length < 3) return null;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return Number.isNaN(d.getTime()) ? null : d;
}
function getRecordAttendanceStatus(studentId, dateKey = formatRecordAttendanceDateKey()) {
  if (!studentId || !dateKey) return '';
  const store = readRecordDailyAttendanceStore();
  const item = store?.[dateKey]?.[String(studentId)];
  const status = String(item?.status || '').toLowerCase();
  return (status === 'attended' || status === 'absent' || status === 'makeup') ? status : '';
}
function setRecordAttendanceStatus(student, dateKey, status) {
  if (!student || !student.id || !dateKey) return;
  const store = readRecordDailyAttendanceStore();
  if (!store[dateKey] || typeof store[dateKey] !== 'object') store[dateKey] = {};
  const studentId = String(student.id);
  if (status === 'attended' || status === 'makeup') {
    store[dateKey][studentId] = {
      student_id: studentId,
      student_name: student.name || '',
      division: student.type || '',
      status,
      date: dateKey,
      updated_at: new Date().toISOString()
    };
  } else {
    delete store[dateKey][studentId];
    if (!Object.keys(store[dateKey]).length) delete store[dateKey];
  }
  writeRecordDailyAttendanceStore(store);
}
function getRecordAttendanceKoreanDayName(dateValue = new Date()) {
  const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
  return RECORD_SORT_DAY_NAMES[d.getDay()] || '';
}
function isRecordStudentLessonDate(student, dateValue = new Date()) {
  const dayName = getRecordAttendanceKoreanDayName(dateValue);
  const lessonDays = parseRecordSortDays(student);
  return !!dayName && lessonDays.includes(dayName);
}
function getRecordAttendanceExpectedStatus(student, dateValue = new Date()) {
  return isRecordStudentLessonDate(student, dateValue) ? 'attended' : 'makeup';
}
function getRecordAttendanceStatusClass(status) {
  if (status === 'attended') return 'attended';
  if (status === 'makeup') return 'makeup';
  return '';
}
function getRecordAttendanceStatusTitle(status, student) {
  const lessonText = normalizeLessonDayDisplay(student?.lesson_day || student?.lessonDay || student?.class_day || student?.classDay || '');
  if (status === 'attended') return '출석 체크됨';
  if (status === 'makeup') return '보강 체크됨';
  return lessonText ? `오늘 체크하기 · 등원요일 ${lessonText}` : '오늘 체크하기';
}
function isRecordStudentEnrollmentDateMissing(student) {
  const value = (typeof getStudentInfoDateValue === 'function')
    ? getStudentInfoDateValue(student)
    : (typeof getEnrolledAtFromStudent === 'function' ? getEnrolledAtFromStudent(student) : '');
  return !String(value || '').trim();
}
function getMobileRecordSelectionCircleClass(student, baseClass) {
  const classes = [baseClass];
  if (studentSelectionMode) classes.push('selectionCircle');
  if (selectedStudentIds.has(student.id)) classes.push('selected');
  return classes.join(' ');
}
function renderPhoneKinderAttendanceLeadIcon(student) {
  if (studentSelectionMode) {
    return `<span class="${getMobileRecordSelectionCircleClass(student, 'kinderSignalCircle')}"></span>`;
  }
  return renderPhoneRecordAttendanceLeadIcon(student);
}
function renderPhoneElementaryAttendanceLeadIcon(student) {
  if (studentSelectionMode) {
    return `<span class="${getMobileRecordSelectionCircleClass(student, 'elementaryEmptyCircle')}"></span>`;
  }
  return renderPhoneRecordAttendanceLeadIcon(student);
}
function renderPhoneRecordAttendanceLeadIcon(student, requestedKind) {
  const adapter = window.OlliPhoneAttendanceAdapter;
  const adapterOwnsStatus = !!(adapter && typeof adapter.decorateLeadIcon === 'function');
  const status = adapterOwnsStatus ? '' : getRecordAttendanceStatus(student?.id);
  const missingEnrollment = isRecordStudentEnrollmentDateMissing(student);
  const stateClass = [adapterOwnsStatus ? '' : getRecordAttendanceStatusClass(status), missingEnrollment ? 'missingEnrollment' : ''].filter(Boolean).join(' ');
  const baseTitle = getRecordAttendanceStatusTitle(status, student);
  const title = missingEnrollment ? `${baseTitle} · 등록일 미입력` : baseTitle;
  let html = `<span class="recordAttendanceLeadBtn ${escapeHtml(stateClass)}" role="button" tabindex="0" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" onclick="toggleRecordTodayAttendance(event,'${escapeTemplateLiteral(student?.id || '')}')" onkeydown="handleRecordAttendanceLeadKeydown(event,'${escapeTemplateLiteral(student?.id || '')}')">
    <svg class="recordAttendanceLeadSvg" xmlns="http://www.w3.org/2000/svg" width="36" height="35" viewBox="0 0 36 35" aria-hidden="true">
      <polygon class="recordAttendanceLeadFill" points="20.5,5.5 31,11.7 31,23.8 20.5,30.5 10,23.8 10,11.7" fill="transparent" stroke="#8f8f8f" stroke-width="1.8" stroke-linejoin="round"/>
      <path class="recordAttendanceLeadLine" d="M10 11.7 L20.5 17.8 L31 11.7" fill="none" stroke="#8f8f8f" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      <path class="recordAttendanceLeadLine" d="M20.5 17.8 L20.5 30.5" fill="none" stroke="#8f8f8f" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </span>`;
  if (adapterOwnsStatus) html = adapter.decorateLeadIcon(html, student, requestedKind);
  return html;
}
function handleRecordAttendanceLeadKeydown(event, studentId, sessionKind, timeSlot, classGroup) {
  if (!event || (event.key !== 'Enter' && event.key !== ' ')) return;
  toggleRecordTodayAttendance(event, studentId, sessionKind, timeSlot, classGroup);
}
async function toggleRecordTodayAttendance(event, studentId, sessionKind, timeSlot, classGroup) {
  const adapter = window.OlliPhoneAttendanceAdapter;
  if (adapter && typeof adapter.toggleTodayAttendance === 'function') {
    return adapter.toggleTodayAttendance(event, studentId, sessionKind, timeSlot, classGroup);
  }
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (studentSelectionMode) return;
  const student = getAllStudents().find(item => String(item.id) === String(studentId));
  if (!student) return;
  const today = new Date();
  const dateKey = formatRecordAttendanceDateKey(today);
  const expectedStatus = getRecordAttendanceExpectedStatus(student, today);
  const currentStatus = getRecordAttendanceStatus(student.id, dateKey);
  const nextStatus = currentStatus === expectedStatus ? '' : expectedStatus;
  setRecordAttendanceStatus(student, dateKey, nextStatus);
  const searchValue = document.getElementById('searchName')?.value.trim() || '';
  if (currentRecordView === 'elementary') renderElementaryRecords(searchValue);
  else if (currentRecordView === 'kinder') renderKinderRecords(searchValue);
}
function getRecordAttendanceMonthRange(baseDate = new Date()) {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth() + 1;
  const lastDay = new Date(year, month, 0).getDate();
  return { year, month, lastDay };
}
function shouldCountRecordAttendanceDate(dateValue) {
  const policy = window.OlliAttendancePolicy;
  if (policy && typeof policy.shouldCountDate === 'function') return !!policy.shouldCountDate(dateValue);
  const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  const dKey = Number(formatRecordAttendanceDateKey(d).replace(/-/g, ''));
  const todayKey = Number(formatRecordAttendanceDateKey(today).replace(/-/g, ''));
  return dKey < todayKey;
}
function getRecordAttendanceStudentMonthSummary(student, baseDate = new Date()) {
  const { year, month, lastDay } = getRecordAttendanceMonthRange(baseDate);
  const store = readRecordDailyAttendanceStore();
  const attended = [];
  const absent = [];
  const makeup = [];
  for (let day = 1; day <= lastDay; day += 1) {
    const date = new Date(year, month - 1, day);
    const dateKey = formatRecordAttendanceDateKey(date);
    const status = String(store?.[dateKey]?.[String(student.id)]?.status || '');
    const isLessonDate = isRecordStudentLessonDate(student, date);
    const countable = shouldCountRecordAttendanceDate(date);
    if (status === 'attended') attended.push(day);
    if (status === 'makeup') makeup.push(day);
    if (isLessonDate && countable && status !== 'attended') absent.push(day);
  }
  let remainingMakeup = Math.max(absent.length - makeup.length, 0);
  const policy = window.OlliAttendancePolicy;
  if (policy && typeof policy.getCounts === 'function') {
    const policyCounts = policy.getCounts(student);
    if (policyCounts && Number.isFinite(Number(policyCounts.remainingMakeup))) remainingMakeup = Number(policyCounts.remainingMakeup);
  }
  return { attended, absent, makeup, remainingMakeup };
}
function formatRecordAttendanceDayList(days) {
  const list = Array.isArray(days) ? days.filter(v => Number(v) > 0).sort((a,b) => a - b) : [];
  return list.length ? list.map(day => `${day}일`).join(' ') : '-';
}
function renderRecordAttendanceSummary() {
  // 초등부/유치부 옆 출석부 요약 탭과 월별 출석부 내용은 삭제되었습니다.
  const list = document.getElementById('recordList');
  if (!list) return;
  currentRecordView = currentObservationView === 'kinder' ? 'kinder' : 'elementary';
  updateRecordHeaderUI();
  const searchValue = document.getElementById('searchName')?.value.trim() || '';
  if (currentRecordView === 'kinder') renderKinderRecords(searchValue);
  else renderElementaryRecords(searchValue);
}
