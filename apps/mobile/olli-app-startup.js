const OLLI_BOOT_MIN_DURATION = 1500;
const OLLI_BOOT_FADE_OUT_DURATION = 720;
const OLLI_PHONE_RESUME_STATE_PREFIX = 'olli_phone_resume_state_v1';
let olliBootStartedAt = Date.now();

function getOlliPersistentSessionToken() {
  try { return String(localStorage.getItem('olli_account_session_token_v1') || '').trim(); }
  catch (_) { return ''; }
}

function hasOlliPersistentPhoneSession() {
  return !!getOlliPersistentSessionToken();
}

function getOlliPhoneResumeSessionFingerprint() {
  const token = getOlliPersistentSessionToken();
  if (!token) return '';
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getOlliPhoneResumeStateKey() {
  const fingerprint = getOlliPhoneResumeSessionFingerprint();
  if (!fingerprint) return '';
  let academyId = '';
  try {
    academyId = String(
      (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '')
      || localStorage.getItem('olli_current_academy_id')
      || ''
    ).trim();
  } catch (_) {}
  return `${OLLI_PHONE_RESUME_STATE_PREFIX}_${fingerprint}_${academyId || 'academy'}`;
}

function isOlliPageVisibleForResume(screen) {
  if (!screen) return false;
  try { return getComputedStyle(screen).display !== 'none' && getComputedStyle(screen).visibility !== 'hidden'; }
  catch (_) { return screen.style.display !== 'none'; }
}

function getOlliVisibleResumePageId() {
  const priority = [
    'settingsDetailScreen',
    'settingsPageScreen',
    'olliTalkArchiveScreen',
    'olliTalkBetaScreen',
    'studentMemoScreen',
    'observationRosterScreen',
    'kinderChatFeedbackScreen',
    'recordRoomScreen'
  ];
  return priority.find(id => isOlliPageVisibleForResume(document.getElementById(id))) || '';
}

function captureOlliPhoneResumeState() {
  if (!hasOlliPersistentPhoneSession()) return false;
  const key = getOlliPhoneResumeStateKey();
  const pageId = getOlliVisibleResumePageId();
  if (!key || !pageId) return false;

  let division = 'elementary';
  let recordView = '';
  let memoStudentId = '';
  let settingsDetailType = '';
  try {
    const view = String(
      (typeof currentObservationView !== 'undefined' && currentObservationView)
      || (typeof currentRecordView !== 'undefined' && currentRecordView)
      || ''
    ).trim();
    division = view === 'kinder' ? 'kinder' : 'elementary';
  } catch (_) {}
  try { recordView = String(typeof currentRecordView !== 'undefined' ? currentRecordView : '').trim(); } catch (_) {}
  try { memoStudentId = String(typeof currentMemoStudent !== 'undefined' && currentMemoStudent?.id ? currentMemoStudent.id : '').trim(); } catch (_) {}
  try { settingsDetailType = String(typeof settingsCurrentDetailType !== 'undefined' ? settingsCurrentDetailType : '').trim(); } catch (_) {}

  const activeArchiveTab = document.querySelector('#olliTalkArchiveScreen [data-archive-tab].active')?.dataset?.archiveTab || '';
  const state = {
    pageId,
    academyId: String(localStorage.getItem('olli_current_academy_id') || '').trim(),
    division,
    recordView,
    memoStudentId,
    settingsDetailType,
    archiveTab: String(activeArchiveTab || '').trim(),
    savedAt: Date.now()
  };
  try {
    localStorage.setItem(key, JSON.stringify(state));
    return true;
  } catch (_) {
    return false;
  }
}

function readOlliPhoneResumeState() {
  const key = getOlliPhoneResumeStateKey();
  if (!key) return null;
  try {
    const state = JSON.parse(localStorage.getItem(key) || 'null');
    if (!state || typeof state !== 'object' || !state.pageId) return null;
    const currentAcademyId = String(localStorage.getItem('olli_current_academy_id') || '').trim();
    if (state.academyId && currentAcademyId && String(state.academyId) !== currentAcademyId) return null;
    return state;
  } catch (_) {
    return null;
  }
}

async function restoreOlliPhoneResumeState() {
  const state = readOlliPhoneResumeState();
  if (!state) return false;

  const division = state.division === 'kinder' ? 'kinder' : 'elementary';
  try {
    if (typeof currentObservationView !== 'undefined') currentObservationView = division;
    if (typeof currentRecordView !== 'undefined' && state.recordView) currentRecordView = state.recordView;
  } catch (_) {}

  switch (state.pageId) {
    case 'studentMemoScreen':
      if (state.memoStudentId && typeof openStudentMemoPageById === 'function') {
        const localStudent = typeof findStudentById === 'function' ? findStudentById(state.memoStudentId) : null;
        if (!localStudent) break;
        document.querySelectorAll('.pageScreen').forEach(screen => { if (screen.id !== 'studentMemoScreen') screen.style.display = 'none'; });
        openStudentMemoPageById(state.memoStudentId);
        if (typeof window.setObservationPersistentNavVisible === 'function') window.setObservationPersistentNavVisible(true);
        return true;
      }
      break;
    case 'observationRosterScreen':
      if (typeof openObservationNoteFromRecord === 'function') {
        return openObservationNoteFromRecord({ division }) !== false;
      }
      break;
    case 'kinderChatFeedbackScreen':
      if (typeof window.openKinderChatFeedbackPage === 'function') {
        window.openKinderChatFeedbackPage({ division });
        return true;
      }
      break;
    case 'olliTalkBetaScreen':
      if (typeof window.openOlliTalkBetaPage === 'function') {
        window.openOlliTalkBetaPage();
        return true;
      }
      break;
    case 'olliTalkArchiveScreen':
      if (typeof window.openOlliTalkBetaPage === 'function' && typeof window.openOlliTalkArchivePage === 'function') {
        window.openOlliTalkBetaPage();
        window.openOlliTalkArchivePage(null, { tab: state.archiveTab });
        return true;
      }
      break;
    case 'settingsDetailScreen':
      if (typeof window.openPhoneSettingsPage === 'function') window.openPhoneSettingsPage();
      if (state.settingsDetailType && typeof window.openPhoneSettingsDetail === 'function') {
        window.openPhoneSettingsDetail(state.settingsDetailType);
      }
      return true;
    case 'settingsPageScreen':
      if (typeof window.openPhoneSettingsPage === 'function') {
        window.openPhoneSettingsPage();
        return true;
      }
      break;
    case 'recordRoomScreen':
      if (state.recordView === 'academy') {
        try { if (typeof currentRecordView !== 'undefined') currentRecordView = 'academy'; } catch (_) {}
      } else {
        try { if (typeof currentRecordView !== 'undefined') currentRecordView = division; } catch (_) {}
      }
      if (typeof showRecordRoom === 'function') {
        try {
          const recordOpen = showRecordRoom({ localOnly: true });
          if (recordOpen && typeof recordOpen.catch === 'function') {
            recordOpen.catch(error => console.warn('재접속 기록실 로컬 복원 갱신 실패:', error?.message || error));
          }
        } catch (error) {
          console.warn('재접속 기록실 로컬 복원 실패:', error?.message || error);
          return false;
        }
        return true;
      }
      break;
  }
  return false;
}

function bindOlliPhoneResumeStatePersistence() {
  if (window.__olliPhoneResumeStateBound) return;
  window.__olliPhoneResumeStateBound = true;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    try { captureOlliPhoneResumeState(); } catch (_) {}
    try { if (typeof flushMemoAutoSave === 'function') flushMemoAutoSave(); } catch (_) {}
  });
  window.addEventListener('pagehide', captureOlliPhoneResumeState);
  window.addEventListener('beforeunload', captureOlliPhoneResumeState);
}

function showOlliBootScreen() {
  olliBootStartedAt = Date.now();
  const boot = document.getElementById('olliBootScreen');
  if (!boot) return;
  boot.style.display = 'flex';
  boot.classList.remove('hide');
}

function waitOlli(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms || 0)));
}

async function hideOlliBootScreen() {
  const boot = document.getElementById('olliBootScreen');
  if (!boot) return;

  const elapsed = Date.now() - olliBootStartedAt;
  const remain = OLLI_BOOT_MIN_DURATION - elapsed;
  if (remain > 0) await waitOlli(remain);

  boot.classList.add('hide');
  await waitOlli(OLLI_BOOT_FADE_OUT_DURATION);
  if (boot.classList.contains('hide')) {
    boot.style.display = 'none';
  }
}

function refreshOlliVisibleViewsAfterStudentServerRefresh() {
  const safeCall = (fn) => { try { if (typeof fn === 'function') fn(); } catch (error) { console.warn('local-first view refresh skipped:', error); } };
  safeCall(typeof updateRecordHeaderUI === 'function' ? updateRecordHeaderUI : null);
  safeCall(typeof renderObservationMemoRoster === 'function' ? renderObservationMemoRoster : null);
  safeCall(typeof refreshKinderChatFeedbackStudentManagePopupIfOpen === 'function' ? refreshKinderChatFeedbackStudentManagePopupIfOpen : null);
  safeCall(typeof renderCurrentRecordList === 'function' ? renderCurrentRecordList : null);
  try {
    window.dispatchEvent(new CustomEvent('olli:local-first-server-refreshed', { detail:{ resource:'students' } }));
  } catch (_) {}
}

function startOlliStudentServerRefreshLocalFirst() {
  const refreshPromise = typeof loadStudentsFromSupabase === 'function'
    ? Promise.resolve().then(() => loadStudentsFromSupabase())
    : Promise.resolve(false);

  return refreshPromise
    .then((result) => {
      refreshOlliVisibleViewsAfterStudentServerRefresh();
      return result;
    })
    .catch((error) => {
      console.warn('학생 서버 백그라운드 갱신 실패:', error);
      return false;
    })
    .finally(() => {
      try {
        if (typeof startOlliStudentBackgroundSync === 'function') startOlliStudentBackgroundSync();
      } catch (error) {
        console.warn('학생 백그라운드 동기화 시작 실패:', error);
      }
    });
}

async function startOlliReconnectValidationInBackground(initialAcademyId = '') {
  try {
    let accountRestore = null;
    if (typeof restoreOlliAccountSession === 'function') {
      accountRestore = await restoreOlliAccountSession({ silent: true, allowCachedFallback: true });
    }

    if (!accountRestore || accountRestore.restored !== true) {
      const sessionStillExists = !!getOlliPersistentSessionToken();
      if (accountRestore?.blocked === true || !sessionStillExists) {
        try { hideOlliAppScreensForRoute(); } catch (_) {}
        if (typeof showOlliLoginEntry === 'function') showOlliLoginEntry();
      }
      return false;
    }

    // 일시적인 네트워크/서버 장애로 캐시 복구된 경우에는 로컬 화면만 유지하고
    // 권한 확인이 필요한 후속 서버 조회·동기화는 수행하지 않습니다.
    if (accountRestore.authoritative !== true || accountRestore.degraded === true) {
      return false;
    }

    if (typeof validateOlliCurrentMemberAccess === 'function') {
      const access = await validateOlliCurrentMemberAccess({
        silent: true,
        sessionRestore: accountRestore,
        refresh: false
      });
      if (!access || access.valid !== true) {
        if (access?.blocked === true) {
          try { hideOlliAppScreensForRoute(); } catch (_) {}
          if (typeof showOlliLoginEntry === 'function') showOlliLoginEntry();
        }
        return false;
      }
    }

    if (typeof ensureOlliCurrentAcademyAccessAllowed === 'function') {
      const allowed = await ensureOlliCurrentAcademyAccessAllowed({ refresh: true, autoPersistExpired: true });
      if (!allowed) return false;
    }

    const currentAcademyId = String(
      (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '')
      || localStorage.getItem('olli_current_academy_id')
      || ''
    ).trim();

    // 서버 검증 과정에서 현재 학원이 바뀐 경우 새 학원의 로컬 스냅샷으로 화면만 즉시 교체합니다.
    if (initialAcademyId && currentAcademyId && initialAcademyId !== currentAcademyId
      && typeof enterOlliAfterLoginOrSetup === 'function') {
      await enterOlliAfterLoginOrSetup({ localFirst: true });
    }

    const academyVisible = typeof currentRecordView !== 'undefined' && currentRecordView === 'academy';
    if (academyVisible && typeof window.refreshRecordAcademyManagementFromServer === 'function') {
      // 학원관리의 학생/상담 최신화는 record-room-navigation 한 곳이 소유합니다.
      void window.refreshRecordAcademyManagementFromServer({ force: true });
    } else {
      startOlliStudentServerRefreshLocalFirst();
    }

    return true;
  } catch (error) {
    console.warn('재접속 서버 검증 백그라운드 처리 실패:', error?.message || error);
    return false;
  }
}

function startOlliLegacyAccountSessionBootstrapInBackground(initialAcademyId = '') {
  if (hasOlliPersistentPhoneSession() || typeof bootstrapOlliPhoneAccountSession !== 'function') return false;

  Promise.resolve()
    .then(() => bootstrapOlliPhoneAccountSession())
    .then(async (restored) => {
      if (restored !== true || !isOlliLoggedInForStartPage()) return false;

      try {
        if (typeof clearOlliTeacherInviteParamsFromUrl === 'function') clearOlliTeacherInviteParamsFromUrl();
        await enterOlliAfterLoginOrSetup({ localFirst: true });

        const restoredAcademyId = String(
          (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '')
          || localStorage.getItem('olli_current_academy_id')
          || ''
        ).trim();
        void startOlliReconnectValidationInBackground(restoredAcademyId || initialAcademyId);
        return true;
      } catch (error) {
        console.warn('기존 승인기기 계정 세션 전환 후 로컬 진입 실패:', error?.message || error);
        return false;
      }
    })
    .catch((error) => {
      console.warn('기존 승인기기 계정 세션 백그라운드 전환 실패:', error?.message || error);
      return false;
    });

  return true;
}

document.addEventListener('DOMContentLoaded', async () => {
  showOlliBootScreen();
  // 부트 화면 닫힘은 화면 복원/세션 검증 Promise와 독립적으로 시작합니다.
  // 어떤 로컬 복원 함수가 지연되어도 OLLI 시작화면이 영구 대기하지 않게 합니다.
  const bootDismissPromise = hideOlliBootScreen();
  bindOlliPhoneResumeStatePersistence();
  let initialAcademyId = '';
  try {
    hideOlliAppScreensForRoute();

    // 재접속 첫 화면은 서버를 기다리지 않습니다. 현재 계정/학원 컨텍스트를 로컬에서만 복구합니다.
    try {
      const currentAcademyId = String(localStorage.getItem('olli_current_academy_id') || '').trim();
      if (!currentAcademyId && typeof recoverOlliCurrentAcademyFromCachedList === 'function') {
        recoverOlliCurrentAcademyFromCachedList('startup_local_first');
      }
      if (typeof recoverOlliCurrentMemberContextFromCache === 'function') {
        recoverOlliCurrentMemberContextFromCache();
      }
    } catch (_) {}

    initialAcademyId = String(
      (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '')
      || localStorage.getItem('olli_current_academy_id')
      || ''
    ).trim();

    migrateStudentStorageIfNeeded();
    initGroupChoiceIcons();
    purgeOldLocalMemos();
    updateRecordHeaderUI();
    if (typeof updateModeUI === 'function') updateModeUI();
    renderSceneInput();
    bindStudentAddButton();
    bindModalCloseEvents();
    const yearInput = document.getElementById('studentYearBadge');
    if (yearInput) {
      const currentYear = String(getCurrentYear());
      yearInput.value = currentYear;
      yearInput.defaultValue = currentYear;
    }
    if (typeof setupPillPressFeedback === 'function') setupPillPressFeedback();
    if (typeof scheduleNotificationSync === 'function') scheduleNotificationSync();
    window.addEventListener('beforeunload', flushMemoAutoSave);

    startOlliLegacyAccountSessionBootstrapInBackground(initialAcademyId);

    if (isOlliLoggedInForStartPage()) {
      if (typeof clearOlliTeacherInviteParamsFromUrl === 'function') clearOlliTeacherInviteParamsFromUrl();

      // 같은 로그인 세션이 유지되는 동안에는 iOS가 백그라운드 탭을 재생성해도
      // "재접속"으로 취급하지 않고 마지막 사용 화면을 로컬 상태로 복원합니다.
      const resumed = await restoreOlliPhoneResumeState();
      if (!resumed) {
        await enterOlliAfterLoginOrSetup({ localFirst: true });
      }

      // 화면이 준비된 뒤에만 계정/학원 검증과 서버 최신화가 백그라운드에서 시작됩니다.
      void startOlliReconnectValidationInBackground(initialAcademyId);
    } else if (!(typeof applyOlliTeacherInviteFromUrl === 'function' && applyOlliTeacherInviteFromUrl())) {
      showOlliLoginEntry();
    }

    // 부트 화면의 최소 노출 시간만 지키며, 네트워크 완료 여부와는 무관하게 첫 로컬 화면을 공개합니다.
    await bootDismissPromise;
  } catch (err) {
    console.error('startup init error:', err);
    if (isOlliLoggedInForStartPage()) {
      try {
        await enterOlliByStartPage(getOlliDefaultStartPage() || 'observation_note', { localFirst: true });
        void startOlliReconnectValidationInBackground(initialAcademyId);
      } catch (localError) {
        console.warn('재접속 로컬 화면 복구 실패:', localError?.message || localError);
      }
    } else if (!(typeof applyOlliTeacherInviteFromUrl === 'function' && applyOlliTeacherInviteFromUrl())) {
      showOlliLoginEntry();
    }
    await bootDismissPromise;
  }

  window.showRecordRoom = showRecordRoom;
  window.openRecordAttendanceDashboard = openRecordAttendanceDashboard;
  window.hideRecordRoom = hideRecordRoom;
  window.toggleRecordViewMode = toggleRecordViewMode;
  window.toggleRecordMode = toggleRecordMode;
  window.openStudentModal = openStudentModal;
  window.closeModalById = closeModalById;
  window.closeStudentModal = closeStudentModal;
  window.confirmStudent = confirmStudent;
  window.openStudentMemoPageById = openStudentMemoPageById;
  window.forceStudentMemoControlsVisible = forceStudentMemoControlsVisible;
  window.openObservationNoteFromRecord = openObservationNoteFromRecord;
  window.closeMemoPage = closeMemoPage;
  window.saveCurrentMemo = saveCurrentMemo;
  window.requestElementaryFeedback = requestElementaryFeedback;
window.toggleMemoModeMenu = toggleMemoModeMenu;
window.openMemoObservationMode = openMemoObservationMode;
  window.openMemoFailGrowthMode = openMemoFailGrowthMode;
  window.showOlliStartPageSetup = showOlliStartPageSetup;
  window.selectOlliStartPageAndEnter = selectOlliStartPageAndEnter;
  window.enterOlliByStartPage = enterOlliByStartPage;
  window.saveOlliDefaultStartPage = saveOlliDefaultStartPage;
  window.selectSettingsStartPageOption = selectSettingsStartPageOption;
  window.toggleSceneInputMode = toggleSceneInputMode;
  window.handleSceneCardBodyClick = handleSceneCardBodyClick;
  window.handleSceneNumberClick = handleSceneNumberClick;
  window.toggleSceneTag = toggleSceneTag;
  window.requestSceneCardFeedback = requestSceneCardFeedback;
  window.handleMemoHeaderAction = handleMemoHeaderAction;
  window.openElementaryAnalysisModal = openElementaryAnalysisModal;
  window.closeElementaryAnalysisModal = closeElementaryAnalysisModal;
  window.openElementaryAnalysisDetailModal = openElementaryAnalysisDetailModal;
  window.closeElementaryAnalysisDetailModal = closeElementaryAnalysisDetailModal;
  window.openElementaryAnalysisDetailFromCurrent = openElementaryAnalysisDetailFromCurrent;
  
function buildElementaryAnalysisDetailSections(state) {
  const normalized = normalizeElementaryAnalysisState(state);
  const sectionMap = [
    ['오늘 아이의 강점', normalized.strengths || [], normalized.extraTexts?.strengths || ''],
    ['오늘 가장 지도가 필요했던 부분', normalized.needs || [], normalized.extraTexts?.needs || ''],
    ['막힘이 생긴 수업 단계', normalized.blockedStages || [], ''],
    ['아이를 망설이게 한 성향 단서', normalized.tendencies || [], ''],
    ['핵심 지도 영역', normalized.guideAreas || [], normalized.extraTexts?.guideAreas || ''],
    ['오늘 적용한 지도 방식', normalized.teacherActions || [], normalized.extraTexts?.teacherActions || ''],
    ['앞으로의 지도 방향', normalized.futureDirections || [], normalized.extraTexts?.futureDirections || '']
  ];
  return sectionMap.filter(([title, list, extra]) => (Array.isArray(list) && list.length) || String(extra || '').trim());
}
function openElementaryAnalysisDetailModal(state, options = {}) {
  const modal = document.getElementById('elementaryAnalysisDetailModal');
  const body = document.getElementById('elementaryAnalysisDetailBody');
  const titleEl = document.getElementById('elementaryAnalysisDetailTitle');
  if (!modal || !body || !titleEl) {
    console.warn('분석내용 바텀시트 요소를 찾지 못했습니다.', { modal: !!modal, body: !!body, titleEl: !!titleEl });
    return;
  }
  const normalized = normalizeElementaryAnalysisState(state || {});
  titleEl.textContent = options.title || '분석 결과';
  const dateText = formatElementaryAnalysisSummaryDate(options.createdAt || normalized.updatedAt || new Date().toISOString());
  const sections = buildElementaryAnalysisDetailSections(normalized);
  body.innerHTML = `<div class="analysisResultSheetDate">${escapeHtml(dateText)}</div>${sections.map(([title, list, extra]) => `
    <div class="analysisResultSheetSection">
      <div class="analysisResultSheetSectionTitle">${escapeHtml(title)}</div>
      <div class="analysisResultSheetList">
        ${(Array.isArray(list) ? list : []).map(item => `<div class="analysisResultSheetItem">- ${escapeHtml(item)}</div>`).join('')}
        ${String(extra || '').trim() ? `<div class="analysisResultSheetItem">- 기타: ${escapeHtml(String(extra).trim())}</div>` : ''}
      </div>
    </div>`).join('')}`;
  try { body.scrollTop = 0; } catch(e) {}
  try {
    const panel = modal.querySelector('.analysisResultSheetPanel');
    if (panel) panel.scrollTop = 0;
  } catch(e) {}
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
}
function closeElementaryAnalysisDetailModal(event) {
  if (event && event.target && event.target.id !== 'elementaryAnalysisDetailModal') return;
  const modal = document.getElementById('elementaryAnalysisDetailModal');
  if (modal) {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  }
}
function openElementaryAnalysisDetailFromCurrent() {
  if (!currentMemoStudent || currentMemoType !== 'elementary') return;
  if (viewingArchivedElementaryRecord) {
    const record = getElementaryMemoRecords(currentMemoStudent).find(item => item.id === viewingArchivedElementaryRecord);
    if (record?.analysis) {
      openElementaryAnalysisDetailModal(record.analysis, { title: '분석 결과', createdAt: record.createdAt || '' });
    }
    return;
  }
  const displayState = (typeof getDisplayedElementaryAnalysisState === 'function')
    ? getDisplayedElementaryAnalysisState()
    : getPrimaryElementaryAnalysisDisplay(currentMemoStudent);
  const data = displayState?.data || getElementaryAnalysisByStudent(currentMemoStudent);
  const createdAt = displayState?.createdAt || data?.updatedAt || '';
  if (!elementaryAnalysisHasContent(data)) return;
  openElementaryAnalysisDetailModal(data, { title: '분석 결과', createdAt });
}

window.applyElementaryAnalysisToMemo = applyElementaryAnalysisToMemo;
  window.toggleElementaryAnalysisValue = toggleElementaryAnalysisValue;
  window.toggleElementaryTendencyValue = toggleElementaryTendencyValue;
  window.toggleElementaryTendencyGroup = toggleElementaryTendencyGroup;
  window.openCurrentElementaryMemoRecord = openCurrentElementaryMemoRecord;
  window.openArchivedElementaryMemoRecord = openArchivedElementaryMemoRecord;
  if (typeof applyFailSurveyToInput === 'function') window.applyFailSurveyToInput = applyFailSurveyToInput;
  if (typeof selectFailSurveySingle === 'function') window.selectFailSurveySingle = selectFailSurveySingle;
  if (typeof toggleFailSurveyMulti === 'function') window.toggleFailSurveyMulti = toggleFailSurveyMulti;

  window.closeSaveModal = closeSaveModal;
  window.confirmSave = confirmSave;
  window.openSaveModal = openSaveModal;
  window.cp = cp;
  window.copyStudentFeedback = copyStudentFeedback;
  window.shareStudentFeedback = shareStudentFeedback;
  window.requestSummaryFeedbackFromRecords = requestSummaryFeedbackFromRecords;
  window.toggleStudentBlock = toggleStudentBlock;
  window.openCurrentStudentInfoModal = openCurrentStudentInfoModal;
  window.openElementaryInfoModal = openElementaryInfoModal;
  window.closeElementaryInfoModal = closeElementaryInfoModal;
  window.saveElementaryInfo = saveElementaryInfo;
  window.selectElementaryGroup = selectElementaryGroup;
  window.selectElementaryPersonality = selectElementaryPersonality;
  window.openKinderInfoModal = openKinderInfoModal;
  window.closeKinderInfoModal = closeKinderInfoModal;
  window.saveKinderInfo = saveKinderInfo;
  window.handleStudentRowClick = handleStudentRowClick;
  window.openAttendanceStudentFeedbackSheet = openAttendanceStudentFeedbackSheet;
  window.closeAttendanceStudentFeedbackSheet = closeAttendanceStudentFeedbackSheet;
  window.toggleAttendanceFeedbackSheetCard = toggleAttendanceFeedbackSheetCard;
  window.closeStudentActionMenu = closeStudentActionMenu;
  window.confirmDeleteSelectedStudent = confirmDeleteSelectedStudent;
  window.enterStudentSelectionMode = enterStudentSelectionMode;
  window.setSelectedStudentStatus = setSelectedStudentStatus;
  window.deleteSelectedStudents = deleteSelectedStudents;
  window.exitStudentSelectionMode = exitStudentSelectionMode;
  window.openMoreMenuPlaceholder = openMoreMenuPlaceholder;
});


document.addEventListener('input', function(event) {
  if (event.target && event.target.id === 'sceneMemoInput') {
    updateSceneMemoPlaceholder();
  }
});
document.addEventListener('DOMContentLoaded', function() {
  updateSceneMemoPlaceholder();
});
