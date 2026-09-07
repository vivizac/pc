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
  const session = beginObservationMemoSession(studentId);
  if (!session) return;
  const { student } = session;
  if (session.type === 'kinder') {
    if (typeof openKinderChatFeedbackPage === 'function') openKinderChatFeedbackPage();
    return;
  }
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
  const localEntry = session.localEntry || { content: '' };
  memoEditor.value = localEntry.content || '';

  // 로컬 캐시는 즉시 표시하고, 서버 최신판 판정/로컬 캐시 갱신은 공통 세션 코어가 담당합니다.
  reconcileObservationMemoDraft(student, session.noteType)
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
  const __studentAnalysis = session.analysisDisplay || { data: {}, createdAt: '' };
renderElementaryAnalysisSummaryCard(__studentAnalysis.data || {}, { title: '분석 결과', createdAt: __studentAnalysis.createdAt || '' }); renderElementaryAnalysisHistoryCards(student); 
setMemoSaveStatus('자동 저장');
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
  const result = await persistObservationMemoDraft(savingStudent, memoText, {
    noteType: 'elementary_observation'
  });

  if (result?.state === 'pending' && result.error) {
    console.warn('초등부 관찰노트 Supabase 저장 실패:', result.error.message || result.error);
  }

  if (isStillCurrentMemoStudent() && result?.student) {
    currentMemoStudent = result.student;
    if (result.state === 'cleared') updateMemoStudentMetaDisplay(result.student, '');
  }

  if (options.status) setMemoSaveStatus('');
  if (result?.state === 'cleared') return;
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
