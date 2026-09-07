/* v-fix: 선생님/관리자 계정에서도 초등부 관찰노트 상단·하단 버튼 강제 복구 */
function forceStudentMemoControlsVisible() {
  const screen = document.getElementById('studentMemoScreen');
  if (!screen) return;
  const screenVisible = screen.style.display !== 'none';
  if (!screenVisible) return;

  const showInlineFlex = [
    '#memoRecordRoomBtn',
    '#memoStudentListBtn',
    '#memoBottomAnalysisBtn',
    '#memoFeedbackBtn'
  ];
  const showFlex = [
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
  if (student.type === 'kinder') {
    currentMemoStudent = student;
    currentMemoType = 'kinder';
    if (typeof openKinderChatFeedbackPage === 'function') openKinderChatFeedbackPage();
    return;
  }

  currentMemoStudent = student;
  currentMemoType = 'elementary';
  if (currentMemoType === 'elementary') setLastElementaryMemoStudent(student);
  closeMemoModeMenu();
  closeMemoStudentSelectPopup();

  const recordRoomScreen = document.getElementById('recordRoomScreen');
  const studentMemoScreenEl = document.getElementById('studentMemoScreen');
if (recordRoomScreen) recordRoomScreen.style.display = 'none';
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
  const localEntry = getObservationMemoLocalSnapshot(student);
  memoEditor.value = localEntry.content || '';

  // 로컬 캐시는 즉시 표시하고, 서버 최신판 판정/로컬 캐시 갱신은 공통 세션 코어가 담당합니다.
  reconcileObservationMemoDraft(student, 'elementary_observation')
    .then(result => {
      if (!result || !result.adoptedRemote || !result.content) return;

      const isSameMemoPage = currentMemoStudent && currentMemoStudent.id === student.id && currentMemoType === 'elementary';
      const currentEditorText = isSameMemoPage ? (memoEditor.value || '') : '';
      const hasVisibleLocalText = currentEditorText.trim().length > 0;

      // 이미 로컬 내용이 보이는 상태에서는 화면을 덮어쓰지 않는다.
      // 로컬이 비어 있는 첫 진입일 때만 서버 내용을 조용히 채운다.
      if (isSameMemoPage && !hasVisibleLocalText) {
        memoEditor.value = result.content;
        updateMemoStudentMetaDisplay(student, result.updatedAt || '');
      }
    })
    .catch(err => {
      console.warn('student_note_drafts 불러오기 실패:', err.message || err);
    });
}
  const __studentAnalysis = getPrimaryElementaryAnalysisDisplay(student); selectedElementaryAnalysisHistoryId = '';
renderElementaryAnalysisSummaryCard(__studentAnalysis.data || {}, { title: '분석 결과', createdAt: __studentAnalysis.createdAt || '' }); renderElementaryAnalysisHistoryCards(student); 
setMemoSaveStatus('자동 저장');
}

let memoAutoSaveTimer = null;




function scheduleMemoAutoSave() {
  if (!currentMemoStudent) return;

  setMemoSaveStatus('작성 중...');
  if (memoAutoSaveTimer) clearTimeout(memoAutoSaveTimer);

  memoAutoSaveTimer = setTimeout(() => {
    memoAutoSaveTimer = null;
    saveCurrentMemo({ silent: true, status: true });
  }, MEMO_AUTOSAVE_DELAY);
}



function getMemoInputTypeFromTarget(target) {
  if (!target || !target.id) return '';
  if (target.id === 'memoEditor') return 'elementary';
return '';
}

function handleMemoPauseAutoSaveInput(target) {
  const inputType = getMemoInputTypeFromTarget(target);
  if (!inputType || !currentMemoStudent || currentMemoType !== inputType) return;


  scheduleMemoAutoSave();
}







function closeMemoPage() {
  flushMemoAutoSave();
  saveCurrentMemo({ silent: true });

  const current = vivizacGetVisibleNotePage();
  if (current && current.id === 'studentMemoScreen') {
    vivizacSlideOutPageToRecord(current, () => {
      loadRecords('');
    });
    return;
  }

  const studentMemoScreen = document.getElementById('studentMemoScreen');
if (studentMemoScreen) studentMemoScreen.style.display = 'none';
document.getElementById('recordRoomScreen').style.display = 'flex';
  loadRecords('');
}





async function saveCurrentMemo(options = {}) {
  if (!currentMemoStudent) return;
  if (currentMemoType === 'kinder') {
    if (typeof saveKinderChatFeedbackDraft === 'function') saveKinderChatFeedbackDraft();
    return;
  }

  const savingStudent = { ...currentMemoStudent };
  const savingType = currentMemoType;
  const isStillCurrentMemoStudent = () =>
    currentMemoStudent &&
    String(currentMemoStudent.id || '') === String(savingStudent.id || '') &&
    currentMemoType === savingType;


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
  

  if (!options.silent || options.status) showMemoSaveCheck();
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


window.addEventListener('focus', () => {
});
setTimeout(() => {
}, 700);

async function requestElementaryFeedback() {
  if (!currentMemoStudent || currentMemoType !== 'elementary') return;

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

  showMemoSaveCheck();

  await requestSceneCardFeedbackFromElementary(currentMemoStudent.name, text, analysisPromptText);
}
