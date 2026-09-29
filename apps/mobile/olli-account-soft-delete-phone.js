
/* 2026-06-29: 계정 입력값 리셋 + 계정 소프트 삭제 */
(function(){
  const ACCOUNT_AUTH_INPUT_IDS = [
    'olliOwnerAcademyCodeInput',
    'olliOwnerPasswordInput',
    'olliAccountCreateLoginIdInput',
    'olliAccountCreateNameInput',
    'olliAccountCreatePasswordInput',
    'olliAccountCreatePasswordConfirmInput'
  ];

  function resetOlliAccountAuthInputs(target) {
    const resetAll = !target || target === 'all';
    const loginIds = ['olliOwnerAcademyCodeInput', 'olliOwnerPasswordInput'];
    const createIds = [
      'olliAccountCreateLoginIdInput',
      'olliAccountCreateNameInput',
      'olliAccountCreatePasswordInput',
      'olliAccountCreatePasswordConfirmInput'
    ];
    const ids = resetAll ? ACCOUNT_AUTH_INPUT_IDS : (target === 'login' ? loginIds : createIds);
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = '';
      el.defaultValue = '';
      el.setAttribute('autocomplete', 'off');
      el.setAttribute('autocapitalize', 'none');
      el.setAttribute('autocorrect', 'off');
      el.setAttribute('spellcheck', 'false');
      if (!el.getAttribute('name')) el.setAttribute('name', id + '_' + Date.now());
    });
    const resultBox = document.getElementById('olliAccountCreateResult');
    if (resultBox && (resetAll || target === 'create')) {
      resultBox.style.display = 'none';
      resultBox.innerHTML = '';
    }
  }

  function prepareOlliAccountAuthInputs() {
    ACCOUNT_AUTH_INPUT_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.setAttribute('autocomplete', 'off');
      el.setAttribute('autocapitalize', 'none');
      el.setAttribute('autocorrect', 'off');
      el.setAttribute('spellcheck', 'false');
      el.setAttribute('name', id + '_fresh');
    });
  }

  window.resetOlliAccountAuthInputs = resetOlliAccountAuthInputs;

  window.olliAfterShowLoginEntry = function() {
    resetOlliAccountAuthInputs('all');
  };

  window.olliAfterShowOwnerLogin = function() {
    resetOlliAccountAuthInputs('login');
    const loginId = document.getElementById('olliOwnerAcademyCodeInput');
    if (loginId) loginId.focus();
  };

  window.olliAfterShowAccountCreate = function() {
    resetOlliAccountAuthInputs('create');
    const loginId = document.getElementById('olliAccountCreateLoginIdInput');
    if (loginId) loginId.focus();
  };

  async function doOlliAccountSoftDelete() {
    const first = confirm('현재 개인계정을 삭제할까요?\n\nSupabase 데이터는 즉시 지우지 않고 soft delete 상태로 변경됩니다. 연결된 학원 데이터와 학생 기록은 삭제하지 않습니다.');
    if (!first) return;
    const second = confirm('정말 삭제할까요?\n삭제 후 이 계정으로는 다시 로그인할 수 없습니다.');
    if (!second) return;

    const btn = document.querySelector('[data-account-delete-btn]');
    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = '삭제 처리 중...';
      }
      const sessionToken = String(localStorage.getItem('olli_account_session_token_v1') || '').trim();
      if (!sessionToken) throw new Error('계정 세션이 없습니다. 다시 로그인 후 삭제해 주세요.');
      const result = await callOlliRpc('olli_soft_delete_account', {
        p_session_token: sessionToken,
        p_reason: 'user_requested_account_delete'
      });
      if (result && result.ok === false) throw new Error(result.message || '계정 삭제 처리에 실패했습니다.');
      if (typeof clearOlliAccountLogoutLocalState === 'function') clearOlliAccountLogoutLocalState();
      else {
        ['olli_owner_logged_in','olli_teacher_logged_in','olli_current_member_role','olli_current_member_name','olli_current_member_id','olli_current_academy_id','olli_current_academy_code','olli_current_academy_name','olli_account_session_token_v1','olli_account_login_id_v1','olli_account_id_v1','olli_account_name_v1','olli_account_academies_v1','olli_account_device_id_v1'].forEach(k => localStorage.removeItem(k));
      }
      closeSettingsSheet();
      alert('계정이 삭제 처리되었습니다.');
      showOlliLoginEntry();
    } catch (err) {
      alert('계정 삭제 실패\n' + (err && (err.message || err) || '알 수 없는 오류'));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '계정 삭제';
      }
    }
  }

  window.doOlliAccountSoftDelete = doOlliAccountSoftDelete;

  function patchOlliLogoutSheetForDelete() {
    if (typeof settingsSheetData === 'undefined' || !settingsSheetData.logout) return;
    settingsSheetData.logout.title = '계정 로그아웃';
    settingsSheetData.logout.desc = '현재 기기에서 개인계정 세션을 해제하거나 계정을 삭제합니다.';
    settingsSheetData.logout.html = '<div class="settingsInfoItem">계정 로그아웃을 하면 이 기기의 자동 로그인이 해제됩니다. 학원 데이터와 선생님 승인 정보는 삭제되지 않습니다.</div>'
      + '<div class="settingsLogoutDangerBox">'
      + '<button class="settingsDangerFullBtn" data-account-logout-btn type="button" onclick="doOlliAccountLogout()">계정 로그아웃</button>'
      + '<button class="settingsDangerFullBtn red" data-account-delete-btn type="button" onclick="doOlliAccountSoftDelete()">계정 삭제</button>'
      + '<button class="settingsDangerFullBtn light" type="button" onclick="closeSettingsSheet()">취소</button>'
      + '</div>';
    settingsSheetData.logout.onSave = null;
  }

  document.addEventListener('DOMContentLoaded', function() {
    prepareOlliAccountAuthInputs();
    patchOlliLogoutSheetForDelete();
  });
  patchOlliLogoutSheetForDelete();
})();
