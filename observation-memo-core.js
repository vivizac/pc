/* v-fix: 선생님/관리자 계정에서도 초등부 관찰노트 상단·하단 버튼 강제 복구 */
function forceStudentMemoControlsVisible() {
  const screen = document.getElementById('studentMemoScreen');
  if (!screen) return;
  const screenVisible = screen.style.display !== 'none';
  if (!screenVisible) return;

  const showInlineFlex = [
    '#memoRecordRoomBtn',
    '#memoRecordsBtn',
    '#memoStudentListBtn',
    '#memoBottomAnalysisBtn',
    '#memoFeedbackBtn'
  ];
  const showFlex = [
    '#studentMemoScreen .memoHeaderActions',
    '#studentMemoScreen .memoBottomBar'
  ];
  const showBlock = [
    '#memoStudentSelectWrap'
  ];

  showInlineFlex.forEach(selector => {
    const el = document.querySelector(selector);
    if (!el) return;
    el.hidden = false;
    el.removeAttribute('hidden');
    el.removeAttribute('aria-hidden');
    el.style.visibility = 'visible';
    el.style.opacity = '1';
    el.style.pointerEvents = 'auto';
    el.style.display = 'inline-flex';
  });

  showFlex.forEach(selector => {
    const el = document.querySelector(selector);
    if (!el) return;
    el.hidden = false;
    el.removeAttribute('hidden');
    el.removeAttribute('aria-hidden');
    el.style.visibility = 'visible';
    el.style.opacity = '1';
    el.style.pointerEvents = 'auto';
    el.style.display = 'flex';
  });

  showBlock.forEach(selector => {
    const el = document.querySelector(selector);
    if (!el) return;
    el.hidden = false;
    el.removeAttribute('hidden');
    el.removeAttribute('aria-hidden');
    el.style.visibility = 'visible';
    el.style.opacity = '1';
    el.style.pointerEvents = 'auto';
    el.style.display = '';
  });
}

function openStudentMemoPageById(studentId) {
  const student = findStudentById(studentId);
  if (!student) return;

  currentMemoStudent = student;
  currentMemoType = student.type === 'kinder' ? 'kinder' : 'elementary';
  if (currentMemoType === 'elementary') setLastElementaryMemoStudent(student);
  closeMemoModeMenu();
  closeElementaryRecordsMenu();
  closeMemoStudentSelectPopup();
  viewingArchivedElementaryRecord = false;

  const recordRoomScreen = document.getElementById('recordRoomScreen');
  const studentMemoScreenEl = document.getElementById('studentMemoScreen');
  const kinderRiskMemoScreenEl = document.getElementById('kinderRiskMemoScreen');
  if (recordRoomScreen) recordRoomScreen.style.display = 'none';

  if (currentMemoType === 'kinder') {
    if (studentMemoScreenEl) studentMemoScreenEl.style.display = 'none';
    if (kinderRiskMemoScreenEl) { kinderRiskMemoScreenEl.style.display = 'flex'; vivizacSlideInPage(kinderRiskMemoScreenEl); }

    const nameEl = document.getElementById('kinderObservationNoteTitle');
    if (nameEl) nameEl.textContent = `${student.name || '유치부'}의 노트`;
    document.getElementById('kinderMemoBox1').value = student.memo1 || '';
    document.getElementById('kinderMemoBox2').value = student.memo2 || '';
    document.getElementById('kinderMemoBox3').value = student.memo3 || '';
    document.getElementById('kinderMemoBox4').value = student.memo4 || '';
    const kinderMemoBox5 = document.getElementById('kinderMemoBox5');
    if (kinderMemoBox5) kinderMemoBox5.value = student.memo5 || '';
    const kinderSceneMemoInput = document.getElementById('kinderSceneMemoInput');
    if (kinderSceneMemoInput) kinderSceneMemoInput.value = student.sceneMemo || student.kinderSceneMemo || '';
    if (typeof setKinderCombinedMode === 'function') setKinderCombinedMode('risk');
    selectedElementaryAnalysisHistoryId = '';
    renderElementaryAnalysisSummaryCard({});
    renderElementaryAnalysisHistoryCards(null);
    updateMemoSignalCircle(student);
    setMemoSaveStatus('자동 저장');
    setTimeout(autoResizeKinderMemoBoxes, 0);
    return;
  }

  if (kinderRiskMemoScreenEl) kinderRiskMemoScreenEl.style.display = 'none';
  if (studentMemoScreenEl) {
    studentMemoScreenEl.classList.remove('vivizac-slide-page', 'vivizac-slide-in', 'vivizac-slide-out');
    studentMemoScreenEl.style.animation = '';
    studentMemoScreenEl.style.transform = '';
    studentMemoScreenEl.style.display = 'flex';
    studentMemoScreenEl.setAttribute('data-current-memo-type', 'elementary');
  }

  forceStudentMemoControlsVisible();
  requestAnimationFrame(forceStudentMemoControlsVisible);
  setTimeout(forceStudentMemoControlsVisible, 120);

  setMemoModePillLabel(student.name || '학생 이름');
  updateMemoStudentMetaDisplay(student);
  const memoNameBtn = document.getElementById('memoStudentNameBtn');
  if (memoNameBtn) {
    memoNameBtn.onclick = toggleMemoModeMenu;
    memoNameBtn.title = '메모 유형 선택';
    memoNameBtn.setAttribute('aria-label', '메모 유형 선택');
  }

  const feedbackBtn = document.getElementById('memoFeedbackBtn');
  const analysisBtn = document.getElementById('memoBottomAnalysisBtn') || document.getElementById('memoAnalysisBtn');
  const elementaryWrap = document.getElementById('elementaryMemoWrap');

  if (feedbackBtn) {
    feedbackBtn.style.display = 'inline-flex';
    feedbackBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"></path><path d="M5 12l7-7 7 7"></path></svg>피드백 생성';
  }
  if (analysisBtn) analysisBtn.style.display = 'inline-flex';
  if (elementaryWrap) elementaryWrap.style.display = 'block';
  forceStudentMemoControlsVisible();

  const memoEditor = document.getElementById('memoEditor');
  if (memoEditor) {
    memoEditor.readOnly = false;
    const localEntry = getMemoEntryByStudent(student);
    memoEditor.value = localEntry.content || '';

    // 관찰노트는 로컬 캐시를 먼저 표시해 화면 깜박임을 막고,
    // Supabase 최신 확인은 화면 뒤에서 조용히 처리한다.
    loadStudentNoteDraftFromSupabase(student, 'elementary_observation')
      .then(row => {
        if (!row || !row.content) return;
        const remoteText = row.content || '';
        const remoteUpdatedAt = row.updated_at || '';
        const latestLocalEntry = getMemoEntryByStudent(student);
        const shouldAdoptRemote = isRemoteMemoNewerThanLocal(remoteUpdatedAt, latestLocalEntry.updatedAt || '');
        if (!shouldAdoptRemote) return;

        const isSameMemoPage = currentMemoStudent && currentMemoStudent.id === student.id && currentMemoType === 'elementary';
        const currentEditorText = isSameMemoPage ? (memoEditor.value || '') : '';
        const hasVisibleLocalText = currentEditorText.trim().length > 0;

        setMemoByStudent(student, remoteText, {
          updatedAt: remoteUpdatedAt || new Date().toISOString(),
          lastSyncedAt: remoteUpdatedAt || new Date().toISOString(),
          syncStatus: 'synced'
        });

        // 이미 로컬 내용이 보이는 상태에서는 화면을 덮어쓰지 않는다.
        // 로컬이 비어 있는 첫 진입일 때만 서버 내용을 조용히 채운다.
        if (isSameMemoPage && !hasVisibleLocalText) {
          memoEditor.value = remoteText;
          updateMemoStudentMetaDisplay(student, remoteUpdatedAt);
        }
      })
      .catch(err => {
        console.warn('student_note_drafts 불러오기 실패:', err.message || err);
      });
  }
  const __studentAnalysis = getPrimaryElementaryAnalysisDisplay(student); selectedElementaryAnalysisHistoryId = '';
renderElementaryAnalysisSummaryCard(__studentAnalysis.data || {}, { title: '분석 결과', createdAt: __studentAnalysis.createdAt || '' }); renderElementaryAnalysisHistoryCards(student); 
  updateMemoSignalCircle(student);
  setMemoSaveStatus('자동 저장');
}

let memoAutoSaveTimer = null;

function autoResizeTextarea(el) {
  if (!el) return;
  const minHeight = Number(el.dataset.minHeight || 140);
  el.style.height = 'auto';
  el.style.height = Math.max(el.scrollHeight, minHeight) + 'px';
}

function autoResizeKinderMemoBoxes() {
  ['kinderMemoBox1', 'kinderMemoBox2', 'kinderMemoBox3', 'kinderMemoBox4', 'kinderMemoBox5', 'kinderSceneMemoInput'].forEach(id => {
    autoResizeTextarea(document.getElementById(id));
  });
}

function scheduleMemoAutoSave() {
  if (!currentMemoStudent) return;
  if (currentMemoType === 'elementary' && viewingArchivedElementaryRecord) return;

  setMemoSaveStatus('작성 중...');
  if (memoAutoSaveTimer) clearTimeout(memoAutoSaveTimer);

  memoAutoSaveTimer = setTimeout(() => {
    memoAutoSaveTimer = null;
    saveCurrentMemo({ silent: true, status: true });
  }, MEMO_AUTOSAVE_DELAY);
}

function flushMemoAutoSave() {
  if (!currentMemoStudent) return;
  if (memoAutoSaveTimer) {
    clearTimeout(memoAutoSaveTimer);
    memoAutoSaveTimer = null;
    saveCurrentMemo({ silent: true, status: true });
  }
}

function getMemoInputTypeFromTarget(target) {
  if (!target || !target.id) return '';
  if (target.id === 'memoEditor') return 'elementary';
  if (['kinderMemoBox1', 'kinderMemoBox2', 'kinderMemoBox3', 'kinderMemoBox4', 'kinderMemoBox5', 'kinderSceneMemoInput'].includes(target.id)) return 'kinder';
  return '';
}

function handleMemoPauseAutoSaveInput(target) {
  const inputType = getMemoInputTypeFromTarget(target);
  if (!inputType || !currentMemoStudent || currentMemoType !== inputType) return;
  if (inputType === 'elementary' && viewingArchivedElementaryRecord) return;

  if (inputType === 'kinder') {
    autoResizeTextarea(target);
    updateMemoSignalCircle(currentMemoStudent);
    requestAnimationFrame(() => {
      autoResizeTextarea(target);
      updateMemoSignalCircle(currentMemoStudent);
    });
  }

  scheduleMemoAutoSave();
}

function handleMemoPauseAutoSaveBlur(target) {
  const inputType = getMemoInputTypeFromTarget(target);
  if (!inputType || currentMemoType !== inputType) return;
  flushMemoAutoSave();
  if (inputType === 'kinder') {
    setTimeout(() => updateMemoSignalCircle(currentMemoStudent), 0);
  }
}

function setupMemoPauseAutoSaveBindings() {
  if (window.__memoPauseAutoSaveDelegated === true) return;
  window.__memoPauseAutoSaveDelegated = true;

  document.addEventListener('input', event => {
    handleMemoPauseAutoSaveInput(event.target);
  });

  document.addEventListener('focus', event => {
    if (getMemoInputTypeFromTarget(event.target) === 'kinder' && currentMemoType === 'kinder') {
      autoResizeTextarea(event.target);
      updateMemoSignalCircle(currentMemoStudent);
    }
  }, true);

  document.addEventListener('blur', event => {
    handleMemoPauseAutoSaveBlur(event.target);
  }, true);
}

function bindPauseAutoSaveForMemoInput(el, options = {}) {
  // 기존 개별 바인딩 방식은 초기화 중 오류가 나면 누락될 수 있어,
  // 실제 자동저장은 setupMemoPauseAutoSaveBindings()의 이벤트 위임으로 처리합니다.
  setupMemoPauseAutoSaveBindings();
}

function closeMemoPage() {
  flushMemoAutoSave();
  saveCurrentMemo({ silent: true });

  const current = vivizacGetVisibleNotePage();
  if (current && (current.id === 'studentMemoScreen' || current.id === 'kinderRiskMemoScreen')) {
    vivizacSlideOutPageToRecord(current, () => {
      loadRecords('');
    });
    return;
  }

  const studentMemoScreen = document.getElementById('studentMemoScreen');
  const kinderRiskMemoScreen = document.getElementById('kinderRiskMemoScreen');
  if (studentMemoScreen) studentMemoScreen.style.display = 'none';
  if (kinderRiskMemoScreen) kinderRiskMemoScreen.style.display = 'none';
  document.getElementById('recordRoomScreen').style.display = 'flex';
  loadRecords('');
}

function setMemoSaveStatus(text) {
  const el = document.getElementById('memoSaveStatus');
  if (!el) return;
  // 로컬 저장/서버 동기화 상태는 사용자 화면에 노출하지 않고 내부에서만 관리한다.
  el.textContent = '';
}

function showMemoSaveCheck() {
  setMemoSaveStatus('');
}

async function saveCurrentMemo(options = {}) {
  if (!currentMemoStudent) return;

  const savingStudent = { ...currentMemoStudent };
  const savingType = currentMemoType;
  const isStillCurrentMemoStudent = () =>
    currentMemoStudent &&
    String(currentMemoStudent.id || '') === String(savingStudent.id || '') &&
    currentMemoType === savingType;

  if (savingType === 'kinder') {
    const student = { ...savingStudent };
    student.memo1 = document.getElementById('kinderMemoBox1').value;
    student.memo2 = document.getElementById('kinderMemoBox2').value;
    student.memo3 = document.getElementById('kinderMemoBox3').value;
    student.memo4 = document.getElementById('kinderMemoBox4')?.value || '';
    student.memo5 = document.getElementById('kinderMemoBox5')?.value || '';
    student.sceneMemo = document.getElementById('kinderSceneMemoInput')?.value || '';
    student.memoUpdatedAt = new Date().toISOString();
    await saveStudent(student);
    if (isStillCurrentMemoStudent()) {
      currentMemoStudent = student;
      updateMemoSignalCircle(student);
    }
    updateNotificationButtons();
  } else {
    if (viewingArchivedElementaryRecord) return;
    const memoText = document.getElementById('memoEditor')?.value || '';
    const hasMemoText = String(memoText || '').trim().length > 0;
    if (!hasMemoText) {
      clearMemoByStudent(savingStudent);
      const clearedStudent = { ...savingStudent, memoUpdatedAt: '' };
      clearStudentNoteDraftFromSupabase(clearedStudent, 'elementary_observation').catch(err => console.warn('빈 관찰노트 초안 삭제 실패:', err.message || err));
      await saveStudent(clearedStudent, { skipRemote: true });
      if (isStillCurrentMemoStudent()) {
        currentMemoStudent = clearedStudent;
        updateMemoStudentMetaDisplay(clearedStudent, '');
      }
      if (options.status) setMemoSaveStatus('');
      return;
    }

    const studentToSave = { ...savingStudent, memoUpdatedAt: new Date().toISOString() };
    setMemoByStudent(studentToSave, memoText, { syncStatus: 'pending' });

    try {
      const savedStudent = await ensureStudentSavedToSupabase(studentToSave);
      const stableStudent = {
        ...studentToSave,
        id: savedStudent.id,
        academy_id: savedStudent.academy_id || studentToSave.academy_id
      };
      const draftRows = await saveStudentNoteDraftToSupabase(stableStudent, memoText, 'elementary_observation');
      const finalStudent = Array.isArray(draftRows) && draftRows.length
        ? {
            ...stableStudent,
            id: draftRows[0].student_id || stableStudent.id,
            academy_id: draftRows[0].academy_id || stableStudent.academy_id
          }
        : stableStudent;

      await saveStudent(finalStudent, { skipRemote: true });
      setMemoByStudent(finalStudent, memoText, {
        updatedAt: studentToSave.memoUpdatedAt,
        lastSyncedAt: new Date().toISOString(),
        syncStatus: 'synced'
      });

      if (isStillCurrentMemoStudent()) {
        currentMemoStudent = finalStudent;
      }
      if (options.status) setMemoSaveStatus('');
    } catch (err) {
      console.warn('초등부 관찰노트 Supabase 저장 실패:', err.message || err);
      setMemoSyncStateByStudent(studentToSave, { syncStatus: 'pending' });
      if (isStillCurrentMemoStudent()) {
        currentMemoStudent = studentToSave;
      }
      if (options.status) setMemoSaveStatus('');
    }
  }

  if (!options.silent || options.status) showMemoSaveCheck();
}

function handleMemoHeaderAction() {
  if (currentMemoType === 'kinder') {
    sendKinderRiskPush();
    return;
  }
  requestElementaryFeedback();
}

function getRiskNotifications() {
  try {
    const raw = localStorage.getItem(getRiskNotificationsStorageKey());
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function setRiskNotifications(list) {
  localStorage.setItem(getRiskNotificationsStorageKey(), JSON.stringify(Array.isArray(list) ? list.slice(0, 200) : []));
  updateNotificationButtons();
}

function normalizeRiskSignalRow(row) {
  return {
    id: String(row?.id || ''),
    type: 'risk_signal',
    academy_id: String(row?.academy_id || ''),
    student_id: String(row?.student_id || ''),
    student_name: String(row?.student_name || ''),
    message: String(row?.message || '위험신호를 확인하세요'),
    created_at: row?.created_at || new Date().toISOString(),
    read_by: Array.isArray(row?.read_by) ? row.read_by : [],
    handled: !!row?.handled
  };
}
async function loadRiskNotificationsFromSupabase() {
  if (!isSupabaseConfigured()) return getRiskNotifications();
  const academyId = requireOlliAcademyId('위험신호 불러오기');
  try {
    const rows = await supabase('GET', `risk_signals?select=*&academy_id=eq.${encodeURIComponent(academyId)}&order=created_at.desc&limit=200`);
    const normalized = (Array.isArray(rows) ? rows : []).map(normalizeRiskSignalRow).filter(item => item.id);
    setRiskNotifications(normalized);
    return normalized;
  } catch (err) {
    recordOlliStorageIssue({ feature: '위험신호', resource: 'risk_signals', operation: 'load', message: err.message || err });
    console.warn('위험신호 서버 불러오기 실패:', err.message || err);
    return getRiskNotifications();
  }
}
async function saveRiskNotificationToSupabase(item) {
  const academyId = requireOlliAcademyId('위험신호 저장');
  const payload = {
    id: item.id,
    academy_id: academyId,
    student_id: item.student_id,
    student_name: item.student_name,
    message: item.message,
    read_by: item.read_by || [],
    handled: !!item.handled,
    created_at: item.created_at,
    updated_at: new Date().toISOString()
  };
  if (typeof saveOlliData !== 'function') throw new Error('공통 저장 함수가 준비되지 않았습니다: risk_signal');
  const result = await saveOlliData('risk_signal', {
    academyId,
    recordId: item.id,
    studentId: item.student_id,
    data: payload,
    forceCommon: true
  });
  if (!result || !result.ok || !result.serverSaved) {
    throw (result && result.error) || new Error('위험신호 서버 저장 검증에 실패했습니다.');
  }
  return result.serverRow || (Array.isArray(result.serverRows) ? result.serverRows[0] : null) || payload;
}
function saveRiskNotification(student) {
  const academyId = requireOlliAcademyId('위험신호 저장');
  const notifications = getRiskNotifications();
  const message = '위험신호를 확인하세요';
  const item = {
    id: `risk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'risk_signal',
    academy_id: academyId,
    student_id: String(student.id || ''),
    student_name: student.name,
    message,
    created_at: new Date().toISOString(),
    read_by: [],
    handled: false
  };
  notifications.unshift(item);
  setRiskNotifications(notifications.slice(0, 200));
  saveRiskNotificationToSupabase(item).catch(err => {
    recordOlliStorageIssue({ feature: '위험신호', resource: 'risk_signals', operation: 'save', student_id: item.student_id, message: err.message || err });
    console.warn('위험신호 서버 저장 대기:', err.message || err);
  });
  return item;
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

function updateNotificationButtons() {
  const notificationCount = getRiskNotifications().filter(item => !item.handled).length;
  const hasRiskMemo = hasAnyKinderRiskMemo();
  const recordBtn = document.querySelector('.btnMenu[aria-label="기록실"], .btnMenu[title="기록실"]');
  if (recordBtn) {
    if (hasRiskMemo) recordBtn.classList.add('hasRiskNotifications');
    else recordBtn.classList.remove('hasRiskNotifications');
    recordBtn.title = hasRiskMemo ? '기록실 · 관찰노트 메모 있음' : '기록실';
  }

  document.querySelectorAll('.recordNotifyBtn').forEach(btn => {
    btn.classList.toggle('hasNotifications', notificationCount > 0);
    btn.title = notificationCount > 0 ? `알림확인 · ${notificationCount}건` : '알림확인';
    const badge = btn.querySelector('.notificationDot');
    if (badge) badge.textContent = notificationCount > 0 ? String(Math.min(notificationCount, 9)) : '';
  });
}

function scheduleNotificationSync() {
  updateNotificationButtons();
  requestAnimationFrame(updateNotificationButtons);
  setTimeout(updateNotificationButtons, 80);
  setTimeout(updateNotificationButtons, 300);
}

function openMoreMenuPlaceholder() {
  showPushToast('준비 중입니다.');
}


function normalizeRiskNotificationMessage(message, studentName) {
  let text = String(message || '').trim();
  const name = String(studentName || '').trim();
  if (!text) return '위험신호를 확인하세요';
  if (name && text.indexOf(name + '의') === 0) {
    text = text.slice((name + '의').length).trim();
  } else if (name && text.indexOf(name + ' ') === 0) {
    text = text.slice(name.length).trim();
  }
  text = text.replace(/^위험\s*신호를/, '위험신호를');
  return text || '위험신호를 확인하세요';
}

function openNotificationInbox() {
  const overlay = document.getElementById('notificationInboxOverlay');
  const listEl = document.getElementById('notificationInboxList');
  if (!overlay || !listEl) return;

  if (overlay.style.display === 'flex') {
    closeNotificationInbox();
    return;
  }

  const notifyBtn = document.querySelector('#recordRoomScreen .recordNotifyBtn');
  if (notifyBtn) {
    const rect = notifyBtn.getBoundingClientRect();
    const top = Math.round(rect.bottom + 10);
    const right = Math.max(14, Math.round(window.innerWidth - rect.right));
    overlay.style.setProperty('--notification-inbox-top', top + 'px');
    overlay.style.setProperty('--notification-inbox-right', right + 'px');
  }

  const notifications = getRiskNotifications().filter(item => !item.handled);
  if (!notifications.length) {
    listEl.innerHTML = '<div class="notificationInboxEmpty">확인할 알림이 없습니다.</div>';
  } else {
    listEl.innerHTML = notifications.map(item => {
      const dateText = formatNotificationDate(item.created_at);
      const messageText = normalizeRiskNotificationMessage(item.message, item.student_name);
      return `<button type="button" class="notificationInboxItem unread" onclick="openRiskNotificationTarget('${item.id}')">
        <div class="notificationInboxTop">
          <div class="notificationInboxName">${escapeHtml(item.student_name || '학생')}</div>
          <div class="notificationInboxText">${escapeHtml(messageText)}</div>
        </div>
        <div class="notificationInboxDate">${escapeHtml(dateText)}</div>
      </button>`;
    }).join('');
  }

  overlay.style.display = 'flex';
}


function closeNotificationInbox(event) {
  if (event && event.target && event.target.id && event.target.id !== 'notificationInboxOverlay') return;
  const overlay = document.getElementById('notificationInboxOverlay');
  if (overlay) overlay.style.display = 'none';
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

function markRiskNotificationHandled(notificationId) {
  const notifications = getRiskNotifications();
  const target = notifications.find(item => item.id === notificationId);
  const targetStudentId = target?.student_id ? String(target.student_id) : '';
  let changed = false;
  const changedIds = [];
  const next = notifications.map(item => {
    const sameNotification = item.id === notificationId;
    const sameStudent = targetStudentId && String(item.student_id || '') === targetStudentId;
    if ((sameNotification || sameStudent) && !item.handled) {
      changed = true;
      changedIds.push(String(item.id || ''));
      return { ...item, handled: true };
    }
    return item;
  });
  if (changed) {
    setRiskNotifications(next);
    const academyId = requireOlliAcademyId('위험신호 확인 처리');
    changedIds.filter(Boolean).forEach(id => {
      if (typeof saveOlliData !== 'function') {
        recordOlliStorageIssue({ feature: '위험신호', resource: 'risk_signals', operation: 'update', message: '공통 저장 함수가 준비되지 않았습니다: risk_signal_handled', student_id: targetStudentId });
        return;
      }
      saveOlliData('risk_signal_handled', {
        academyId,
        recordId: id,
        studentId: targetStudentId,
        data: { handled: true, updated_at: new Date().toISOString() },
        forceCommon: true
      }).then(result => {
        if (!result || !result.ok || !result.serverSaved) throw (result && result.error) || new Error('위험신호 확인 처리 검증에 실패했습니다.');
        return result;
      }).catch(err => recordOlliStorageIssue({ feature: '위험신호', resource: 'risk_signals', operation: 'update', message: err.message || err, student_id: targetStudentId }));
    });
  }
}

function openRiskNotificationTarget(notificationId) {
  const notifications = getRiskNotifications();
  const item = notifications.find(entry => entry.id === notificationId);
  if (!item) return;
  markRiskNotificationHandled(notificationId);
  closeNotificationInbox();
  if (item.student_id) openStudentMemoPageById(item.student_id);
}

async function showBrowserNotification(message) {
  if (!('Notification' in window)) return false;

  try {
    if (Notification.permission === 'granted') {
      new Notification('올리', { body: message, tag: 'olli-risk-signal' });
      return true;
    }

    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        new Notification('올리', { body: message, tag: 'olli-risk-signal' });
        return true;
      }
    }
  } catch (err) {
    console.warn('browser notification failed:', err);
  }

  return false;
}

async function sendKinderRiskPush() {
  if (!currentMemoStudent || currentMemoType !== 'kinder') return;

  saveCurrentMemo({ silent: true });
  const notification = saveRiskNotification(currentMemoStudent);
  showPushToast(notification.message);
  updateNotificationButtons();
  await showBrowserNotification(notification.message);
}

window.addEventListener('online', () => { loadRiskNotificationsFromSupabase().catch(() => {}); });
window.addEventListener('focus', () => {
  if (getOlliCurrentAcademyId()) loadRiskNotificationsFromSupabase().catch(() => {});
});
setTimeout(() => {
  if (getOlliCurrentAcademyId()) loadRiskNotificationsFromSupabase().catch(() => {});
}, 700);

async function requestElementaryFeedback() {
  if (!currentMemoStudent || currentMemoType !== 'elementary') return;
  if (viewingArchivedElementaryRecord) { alert('과거 수업 기록은 읽기 전용입니다. 현재 기록을 선택한 뒤 피드백을 요청해 주세요.'); return; }

  const text = document.getElementById('memoEditor').value.trim();
  const analysisData = getElementaryAnalysisByStudent(currentMemoStudent);
  const hasAnalysisContent = (typeof elementaryAnalysisHasContent === 'function') ? elementaryAnalysisHasContent(analysisData) : false;
  const analysisPromptText = hasAnalysisContent ? buildElementaryAnalysisMemoText(analysisData, { forPrompt: true }) : '';

  if (!text && !hasAnalysisContent) {
    alert('수업 내용이 부족합니다.');
    return;
  }

  if (text) {
    setMemoByStudent(currentMemoStudent, text);
  }

  archiveCurrentElementaryMemoRecord(currentMemoStudent, text, analysisData);
  showMemoSaveCheck();

  await requestSceneCardFeedbackFromElementary(currentMemoStudent.name, text, analysisPromptText);
}
