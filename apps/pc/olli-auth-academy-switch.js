function getOlliMultiAcademyState() {
  const core = window.OlliStorageCore;
  return {
    accountId: localStorage.getItem(OLLI_ACCOUNT_ID_KEY) || '',
    accountName: localStorage.getItem(OLLI_ACCOUNT_NAME_KEY) || '',
    sessionActive: !!localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY),
    currentAcademy: core?.AcademyContext?.getCurrent
      ? core.AcademyContext.getCurrent()
      : {
          academyId: localStorage.getItem('olli_current_academy_id') || '',
          academyCode: localStorage.getItem('olli_current_academy_code') || '',
          role: localStorage.getItem('olli_current_member_role') || ''
        },
    academies: core?.AcademyContext?.getAccessible
      ? core.AcademyContext.getAccessible()
      : readOlliCachedAccountAcademies()
  };
}

let olliAcademySwitchInProgress = false;
let olliAcademySwitchSequence = 0;

function setOlliAcademySwitchOverlay(visible, academyName, description) {
  const overlay = document.getElementById('olliAcademySwitchOverlay');
  const title = document.getElementById('olliAcademySwitchOverlayTitle');
  const desc = document.getElementById('olliAcademySwitchOverlayDesc');
  if (!overlay) return;
  if (title) title.textContent = visible
    ? `${academyName || '선택한 학원'}으로 전환하고 있습니다`
    : '학원을 전환하고 있습니다';
  if (desc) desc.textContent = description || '이전 학원의 화면을 정리하고 새 학원 데이터를 불러옵니다.';
  overlay.classList.toggle('show', !!visible);
  overlay.setAttribute('aria-busy', visible ? 'true' : 'false');
}

function getOlliAccessibleAcademyById(academyId) {
  const targetId = String(academyId || '').trim();
  const academies = getOlliMultiAcademyState().academies || [];
  return academies.find(item => String(item?.academyId || item?.academy_id || item?.id || '').trim() === targetId) || null;
}

function clearOlliAcademyViewState() {
  const core = window.OlliStorageCore;
  if (core?.AcademyContext?.clearRuntime) core.AcademyContext.clearRuntime('academy_switch');
  if (typeof selectedStudentIds !== 'undefined' && selectedStudentIds?.clear) selectedStudentIds.clear();
  if (typeof studentSelectionMode !== 'undefined') studentSelectionMode = false;
  if (typeof currentMemoStudent !== 'undefined') currentMemoStudent = null;
  if (typeof studentInfoModalTarget !== 'undefined') studentInfoModalTarget = null;
  if (typeof selectedStudentActionId !== 'undefined') selectedStudentActionId = '';
  if (typeof currentFeedbackToSave !== 'undefined') currentFeedbackToSave = '';
  if (typeof currentStudentId !== 'undefined') currentStudentId = '';
  if (typeof currentTeacherId !== 'undefined') currentTeacherId = '';
  if (typeof olliSettingsState !== 'undefined' && olliSettingsState) {
    olliSettingsState.academy = null;
    olliSettingsState.members = [];
    olliSettingsState.approvalRequests = [];
    olliSettingsState.academyAccessRequests = [];
    olliSettingsState.academyAccountMemberships = [];
    olliSettingsState.lastError = '';
  }
  const recordList = document.getElementById('recordList');
  if (recordList) recordList.innerHTML = '';
  const dashboard = document.getElementById('recordAcademyDashboard');
  if (dashboard) dashboard.innerHTML = '';
  const search = document.getElementById('searchName');
  if (search) search.value = '';
  if (typeof closeSettingsSheet === 'function') closeSettingsSheet();
}

function renderOlliAcademyCachedView() {
  try {
    if (typeof updateRecordHeaderUI === 'function') updateRecordHeaderUI();
    if (typeof currentRecordView !== 'undefined' && currentRecordView === 'academy' && typeof renderRecordAcademyManagementDashboard === 'function') {
      renderRecordAcademyManagementDashboard();
    } else if (typeof currentRecordView !== 'undefined' && currentRecordView === 'kinder' && typeof renderKinderRecords === 'function') {
      renderKinderRecords('');
    } else if (typeof renderElementaryRecords === 'function') {
      renderElementaryRecords('');
    }
    if (typeof settingsApplyStateToUI === 'function') settingsApplyStateToUI();
    
  } catch (error) {
    console.warn('학원 전환 캐시 화면 표시 보류:', error);
  }
}

async function preserveOlliAcademyPendingDataBeforeSwitch() {
  try {
    if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
  } catch (_) {}
  const tasks = [];
  if (typeof flushPendingStudentStatuses === 'function') tasks.push(Promise.resolve().then(() => flushPendingStudentStatuses()));
  if (!tasks.length) return;
  await Promise.race([
    Promise.allSettled(tasks),
    new Promise(resolve => setTimeout(resolve, 2200))
  ]);
}

async function reloadOlliAcademyAfterSwitch(sequence, academyId) {
  renderOlliAcademyCachedView();
  const tasks = [];
  if (typeof loadStudentsFromSupabase === 'function') tasks.push(Promise.resolve().then(() => loadStudentsFromSupabase()));
  if (typeof settingsRefreshAll === 'function') tasks.push(Promise.resolve().then(() => settingsRefreshAll()));
  if (typeof hydrateTeacherOptionsFromSupabase === 'function') tasks.push(Promise.resolve().then(() => hydrateTeacherOptionsFromSupabase()));
  await Promise.allSettled(tasks);
  if (sequence !== olliAcademySwitchSequence) return false;
  if (String(localStorage.getItem('olli_current_academy_id') || '') !== String(academyId || '')) return false;
  renderOlliAcademyCachedView();
  return true;
}

async function switchOlliAcademy(academyId) {
  const targetId = String(academyId || '').trim();
  if (!targetId || olliAcademySwitchInProgress) return;
  const target = getOlliAccessibleAcademyById(targetId);
  if (!target) {
    alert('현재 계정에서 접근할 수 있는 학원이 아닙니다. 학원 목록을 새로고침해 주세요.');
    return;
  }
  if (isOlliAcademyAccessBlockedInfo(target)) {
    showOlliAcademyAccessBlocked(getOlliCurrentAcademyAccessState(target));
    return;
  }
  const currentId = String(localStorage.getItem('olli_current_academy_id') || '').trim();
  if (currentId === targetId) {
    if (typeof closeSettingsDetail === 'function') closeSettingsDetail();
    return;
  }
  if (!localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY)) {
    alert('학원 전환에는 공통 계정 로그인이 필요합니다. 원장 계정으로 다시 로그인해 주세요.');
    return;
  }

  const sequence = ++olliAcademySwitchSequence;
  const targetName = String(target?.academyName || target?.academy_name || target?.academyCode || target?.academy_code || '선택한 학원').trim();
  olliAcademySwitchInProgress = true;
  setOlliAcademySwitchOverlay(true, targetName, '미전송 기록을 보존하고 이전 학원의 화면을 정리하고 있습니다.');

  try {
    const targetAcademyCheck = await fetchOlliAcademyRowByIdentity(target);
    if (!targetAcademyCheck.exists) {
      purgeOlliAcademyFromLocalState(targetId, target?.academy_code || target?.academyCode);
      updateOlliAcademySwitchUI();
      alert('삭제되었거나 사용할 수 없는 학원입니다. 학원 목록에서 제거했습니다.');
      return;
    }
    const activeTarget = mergeOlliAcademyServerInfo(target, targetAcademyCheck.row || {});
    await preserveOlliAcademyPendingDataBeforeSwitch();
    if (sequence !== olliAcademySwitchSequence) return;
    clearOlliAcademyViewState();
    saveOlliAcademyLoginState(activeTarget, { accountLogin: true });
    updateOlliAcademySwitchUI();
    setOlliAcademySwitchOverlay(true, targetName, '새 학원의 학생·설정·권한을 불러오고 있습니다.');
    const loaded = await reloadOlliAcademyAfterSwitch(sequence, targetId);
    if (!loaded) return;
    if (typeof closeSettingsDetail === 'function') closeSettingsDetail();
    if (typeof closeSettingsPage === 'function') closeSettingsPage();
    if (typeof enterOlliAfterLoginOrSetup === 'function') await enterOlliAfterLoginOrSetup();
  } catch (error) {
    console.error('학원 전환 실패:', error);
    alert('학원 전환에 실패했습니다.\n' + (error?.message || error));
  } finally {
    if (sequence === olliAcademySwitchSequence) {
      olliAcademySwitchInProgress = false;
      setOlliAcademySwitchOverlay(false);
    }
  }
}

async function refreshOlliAcademySwitchList() {
  const body = document.getElementById('settingsDetailBody');
  if (body) body.innerHTML = '<div class="settingsLoadingText">연결된 학원과 권한을 확인하고 있습니다...</div>';
  try {
    await restoreOlliAccountSession({ silent: false });
    await loadOlliAcademyManagementData();
    updateOlliAcademySwitchUI();
    if (body) body.innerHTML = renderOlliAcademySwitchOptions();
  } catch (error) {
    if (body) body.innerHTML = '<div class="settingsInfoCard"><div class="settingsInfoHead">학원 목록을 불러오지 못했습니다.</div><div class="settingsInfoItem">' + settingsEscapeHtml(error?.message || error) + '</div></div>';
  }
}

window.restoreOlliAccountSession = restoreOlliAccountSession;
window.refreshOlliMyAcademies = restoreOlliAccountSession;
window.recoverOlliCurrentAcademyFromCachedList = recoverOlliCurrentAcademyFromCachedList;
window.recoverOlliCurrentMemberContextFromCache = recoverOlliCurrentMemberContextFromCache;
window.validateOlliCurrentAcademyStillExists = validateOlliCurrentAcademyStillExists;
window.getOlliMultiAcademyState = getOlliMultiAcademyState;
window.switchOlliAcademy = switchOlliAcademy;
window.refreshOlliAcademySwitchList = refreshOlliAcademySwitchList;
window.revokeOlliAccountSessionBestEffort = revokeOlliAccountSessionBestEffort;

