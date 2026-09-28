
/* 2026-06-29 OLLI: 학원 삭제는 학생 삭제와 같은 soft delete 원칙으로 처리 */
(function(){
  function getOlliActiveAcademyIdForDelete(){
    const candidates = [];
    try { if (typeof getOlliCurrentAcademyId === 'function') candidates.push(getOlliCurrentAcademyId()); } catch (_) {}
    try { if (typeof settingsGetAcademyId === 'function') candidates.push(settingsGetAcademyId()); } catch (_) {}
    try { candidates.push(window.OlliStorageCore?.AcademyContext?.getCurrent?.()?.academyId); } catch (_) {}
    try { candidates.push(olliSettingsState?.academy?.id, olliSettingsState?.academy?.academy_id); } catch (_) {}
    candidates.push(localStorage.getItem('olli_current_academy_id'));
    for (const candidate of candidates) {
      const value = String(candidate || '').trim();
      if (value) return value;
    }
    return '';
  }

  function getOlliActiveAcademyNameForDelete(){
    const candidates = [];
    try { candidates.push(window.OlliStorageCore?.AcademyContext?.getCurrent?.()?.academyName); } catch (_) {}
    try { candidates.push(olliSettingsState?.academy?.academy_name, olliSettingsState?.academy?.name); } catch (_) {}
    candidates.push(localStorage.getItem('olli_current_academy_name'));
    for (const candidate of candidates) {
      const value = String(candidate || '').trim();
      if (value) return value;
    }
    return '현재 학원';
  }

  function getOlliActiveRoleForDelete(){
    try {
      if (typeof getOlliCurrentRole === 'function') {
        const value = String(getOlliCurrentRole() || '').trim();
        if (value) return value;
      }
    } catch (_) {}
    return String(localStorage.getItem('olli_current_member_role') || '').trim();
  }


  function showOlliAcademyMoveAfterDeleteOverlay(academyName){
    const overlay = document.getElementById('olliAcademySwitchOverlay');
    const title = document.getElementById('olliAcademySwitchOverlayTitle');
    const desc = document.getElementById('olliAcademySwitchOverlayDesc');
    if (!overlay) return;
    const name = String(academyName || localStorage.getItem('olli_current_academy_name') || '다른 학원').trim();
    if (title) title.textContent = name + '으로 이동합니다.';
    if (desc) desc.textContent = '설정해둔 시작 페이지로 이동합니다.';
    overlay.classList.add('show');
    overlay.setAttribute('aria-busy','true');
  }

  function hideOlliAcademyMoveAfterDeleteOverlay(){
    const overlay = document.getElementById('olliAcademySwitchOverlay');
    if (!overlay) return;
    overlay.classList.remove('show');
    overlay.setAttribute('aria-busy','false');
  }

  function waitOlliAcademyMoveAfterDelete(ms){
    return new Promise(resolve => setTimeout(resolve, ms || 900));
  }

  async function doOlliAcademySoftDelete(){
    const academyId = getOlliActiveAcademyIdForDelete();
    let academyCode = String(localStorage.getItem('olli_current_academy_code') || '').trim();
    if (!academyCode) {
      try { academyCode = String(window.OlliStorageCore?.AcademyContext?.getCurrent?.()?.academyCode || '').trim(); } catch (_) {}
    }
    if (!academyCode) {
      try { academyCode = String(olliSettingsState?.academy?.academy_code || '').trim(); } catch (_) {}
    }
    const academyName = getOlliActiveAcademyNameForDelete();
    const role = getOlliActiveRoleForDelete();
    if (!academyId) {
      alert('삭제할 학원 정보를 확인하지 못했습니다. 다시 로그인 후 시도해 주세요.');
      return;
    }
    if (!['owner', 'super_admin'].includes(role)) {
      alert('학원 삭제는 원장 계정만 실행할 수 있습니다.');
      return;
    }
    const first = confirm(`${academyName}을(를) 삭제 처리할까요?\n\n학생 삭제와 같은 방식으로 Supabase에서는 실제 삭제하지 않고 soft delete 상태로 변경합니다.\n학생, 피드백, 사진 데이터는 서버에서 지우지 않습니다.`);
    if (!first) return;
    const second = confirm('정말 학원을 삭제 처리할까요?\n삭제 후 이 학원은 계정의 학원 목록과 로그인 진입에서 보이지 않습니다.');
    if (!second) return;

    const btn = document.querySelector('[data-academy-delete-btn]');
    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = '학원 삭제 처리 중...';
      }
      const sessionToken = String(localStorage.getItem('olli_account_session_token_v1') || '').trim();
      if (!sessionToken) throw new Error('개인계정 세션이 없습니다. 다시 로그인 후 삭제해 주세요.');
      const rpc = (typeof callOlliRpc === 'function') ? callOlliRpc : callOlliTestRpc;
      const result = await rpc('olli_soft_delete_academy', {
        p_session_token: sessionToken,
        p_academy_id: academyId,
        p_reason: 'academy_deleted_by_owner'
      });
      if (result && result.ok === false) throw new Error(result.message || '학원 삭제 처리에 실패했습니다.');

      if (typeof purgeOlliAcademyFromLocalState === 'function') {
        purgeOlliAcademyFromLocalState(academyId, academyCode);
      }
      let restored = null;
      if (typeof restoreOlliAccountSession === 'function') {
        restored = await restoreOlliAccountSession({ silent: true });
      }
      if (typeof updateOlliAcademySwitchUI === 'function') updateOlliAcademySwitchUI();
      if (typeof closeSettingsSheet === 'function') closeSettingsSheet();
      alert(`${academyName}이(가) 삭제 처리되었습니다.`);

      if (restored && restored.restored) {
        const nextAcademyName = String(restored.selected?.academy_name || restored.selected?.academyName || localStorage.getItem('olli_current_academy_name') || '다른 학원').trim();
        showOlliAcademyMoveAfterDeleteOverlay(nextAcademyName);
        await waitOlliAcademyMoveAfterDelete(900);
        if (typeof enterOlliAfterLoginOrSetup === 'function') await enterOlliAfterLoginOrSetup();
        hideOlliAcademyMoveAfterDeleteOverlay();
      } else if (typeof showOlliLoginEntry === 'function') {
        showOlliLoginEntry();
      }
    } catch (err) {
      alert('학원 삭제 실패\n' + String(err && (err.message || err) || '알 수 없는 오류'));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '학원 삭제';
      }
    }
  }

  window.doOlliAcademySoftDelete = doOlliAcademySoftDelete;

  function patchOlliLogoutSheetForAcademyDelete(){
    if (typeof settingsSheetData === 'undefined' || !settingsSheetData.logout) return;
    settingsSheetData.logout.title = '계정 로그아웃';
    settingsSheetData.logout.desc = '현재 기기의 계정 세션을 해제하거나 현재 학원을 삭제 처리합니다.';
    settingsSheetData.logout.html = '<div class="settingsInfoItem">계정 로그아웃은 이 기기의 자동 로그인만 해제합니다. 학원 삭제는 현재 선택된 학원을 Supabase에서 soft delete 상태로 변경합니다.</div>'
      + '<div class="settingsLogoutDangerBox">'
      + '<button class="settingsDangerFullBtn" data-account-logout-btn type="button" onclick="doOlliAccountLogout()">계정 로그아웃</button>'
      + '<button class="settingsDangerFullBtn red" data-academy-delete-btn type="button" onclick="doOlliAcademySoftDelete()">학원 삭제</button>'
      + '<button class="settingsDangerFullBtn light" type="button" onclick="closeSettingsSheet()">취소</button>'
      + '</div>';
    settingsSheetData.logout.onSave = null;
  }

  window.patchOlliLogoutSheetForAcademyDelete = patchOlliLogoutSheetForAcademyDelete;
  patchOlliLogoutSheetForAcademyDelete();
  document.addEventListener('DOMContentLoaded', patchOlliLogoutSheetForAcademyDelete);
})();
