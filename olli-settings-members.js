function getOlliTeacherAdminSessionToken() {
  return String(localStorage.getItem('olli_account_session_token_v1') || '').trim();
}

function getSettingsMemberId(member) {
  return getSettingsMemberTextValue(member, [
    'id',
    'member_id',
    'memberId',
    'membership_id',
    'membershipId',
    'account_membership_id',
    'accountMembershipId',
    'academy_member_id',
    'academyMemberId'
  ]);
}

function getSettingsMemberStatus(member) {
  const value = String((member && (member.status || member.membership_status || member.member_status || member.access_status)) || 'active').trim().toLowerCase();
  return ['disabled', 'inactive', 'removed', 'deleted'].includes(value) ? 'disabled' : 'active';
}

function getSettingsMemberRole(member) {
  const value = normalizeOlliMemberRoleValue(getSettingsMemberTextValue(member, [
    'role',
    'member_role',
    'membership_role',
    'role_name',
    'account_role',
    'permission_role',
    'requested_role'
  ]), 'teacher') || 'teacher';
  return value === 'owner' ? 'owner' : (value === 'manager' ? 'manager' : 'teacher');
}

function getSettingsMemberDeviceLabel(member) {
  if (getSettingsMemberStatus(member) === 'disabled') return '사용 중지';
  if (isSettingsAccountMembershipMember(member)) return '연결됨';
  const value = String((member && member.device_status) || '').trim().toLowerCase();
  if (value === 'registered' || value === 'account_connected') return '연결됨';
  if (value === 'not_registered' || value === 'unregistered' || !value) return '미연결';
  return String(member.device_status || '미연결');
}

function canManageSettingsMember(member) {
  return typeof isOlliOwner === 'function'
    && isOlliOwner()
    && getSettingsMemberRole(member) !== 'owner';
}

function findSettingsMember(memberId) {
  const id = String(memberId || '').trim();
  return (olliSettingsState.members || []).find(member => getSettingsMemberId(member) === id) || null;
}

function renderSettingsMembers() {
  const rows = Array.isArray(olliSettingsState.members)
    ? olliSettingsState.members.slice()
    : [];

  if (!rows.length) {
    return renderSettingsErrorIfNeeded()
      + '<div class="settingsEmptyBox">등록된 선생님 계정이 없습니다.<div class="settingsMiniText">승인된 선생님은 이 목록에 표시됩니다.</div></div>';
  }

  return renderSettingsErrorIfNeeded() + rows.map(member => {
    const id = getSettingsMemberId(member);
    const status = getSettingsMemberStatus(member);
    const disabled = status === 'disabled';
    const role = getSettingsMemberRole(member);
    const name = member.display_name || member.member_name || member.teacher_name || member.account_name || member.name || '선생님';
    const busy = olliTeacherMutationIds.has(id);
    const accountMembership = isSettingsAccountMembershipMember(member);
    const roleLabel = getOlliRoleLabel(role);
    const roleHtml = role === 'owner'
      ? '<span class="settingsOwnerRoleBadge">원장</span>'
      : '<button class="settingsRoleSelectBtn" type="button" '
        + (busy ? 'disabled ' : '')
        + 'onclick="openSettingsRoleTogglePopup(\'' + settingsEscapeAttr(id) + '\', \'' + settingsEscapeAttr(role) + '\')">'
        + settingsEscapeHtml(roleLabel) + ' ▾</button>';

    const canAssignOtherAcademy = !accountMembership
      && canManageSettingsMember(member)
      && getOlliAssignableManagerAcademies().length > 0;
    const actions = canManageSettingsMember(member)
      ? '<div class="settingsActionGrid">'
        + (accountMembership ? '' : ('<button class="settingsActionBtn memberDisableBtn" type="button" '
          + (busy ? 'disabled ' : '')
          + 'onclick="toggleSettingsMemberActive(\'' + settingsEscapeAttr(id) + '\')">'
          + (busy ? '처리 중...' : (disabled ? '활성화' : '비활성화')) + '</button>'))
        + '<button class="settingsActionBtn" type="button" '
        + (busy ? 'disabled ' : '')
        + 'onclick="resetSettingsMemberDevice(\'' + settingsEscapeAttr(id) + '\')">학원 연결 해제</button>'
        + (canAssignOtherAcademy
          ? '<button class="settingsActionBtn settingsCrossAcademyManagerBtn" type="button" '
            + (busy ? 'disabled ' : '')
            + 'onclick="openSettingsCrossAcademyManagerPopup(\'' + settingsEscapeAttr(id) + '\')">다른 학원 관리 권한</button>'
          : '')
        + '</div>'
      : '';

    return '<div class="settingsTeacherCard" data-member-id="' + settingsEscapeAttr(id) + '">'
      + '<div class="settingsTeacherTop"><div class="settingsTeacherName">' + settingsEscapeHtml(name) + '</div>'
      + '<span class="settingsStatusBadge' + (disabled ? ' disabled' : '') + '">' + (disabled ? '비활성화됨' : '활성화') + '</span></div>'
      + '<div class="settingsTeacherMeta"><div>권한: ' + roleHtml + '</div>'
      + '<div>연결 상태: ' + settingsEscapeHtml(getSettingsMemberDeviceLabel(member)) + '</div>'
      + '<div>생성 방식: ' + (accountMembership ? '계정 승인 연결' : '승인 시 자동 생성') + '</div></div>'
      + actions
      + '</div>';
  }).join('');
}

function refreshSettingsTeacherPanel() {
  const body = document.getElementById('settingsDetailBody');
  if (body) body.innerHTML = renderSettingsMembers();
  if (typeof window.cacheTeacherOptions === 'function') window.cacheTeacherOptions();
  if (typeof window.refreshAllTeacherDropdowns === 'function') window.refreshAllTeacherDropdowns();
  if (typeof settingsApplyStateToUI === 'function') settingsApplyStateToUI();
}

async function ensureOlliTeacherAdminSessionToken(forceReauth) {
  let sessionToken = getOlliTeacherAdminSessionToken();
  if (sessionToken && forceReauth !== true) return sessionToken;

  const ownerLoggedIn = localStorage.getItem('olli_owner_logged_in') === 'true';
  const ownerRole = String(localStorage.getItem('olli_current_member_role') || '').trim();
  if (!ownerLoggedIn && ownerRole !== 'owner' && ownerRole !== 'super_admin') {
    throw new Error('원장 권한으로 로그인되어 있지 않습니다.');
  }

  const accountLoginId = String(localStorage.getItem(OLLI_ACCOUNT_LOGIN_ID_KEY) || '').trim();
  const academyCode = String(localStorage.getItem('olli_current_academy_code') || '').trim();
  const loginCandidates = [];
  [accountLoginId, academyCode].forEach(value => {
    const id = String(value || '').trim();
    if (id && !loginCandidates.some(item => item.toLowerCase() === id.toLowerCase())) loginCandidates.push(id);
  });

  if (!loginCandidates.length) {
    throw new Error('현재 계정 또는 학원 ID를 확인하지 못했습니다. 다시 로그인한 뒤 새 학원 만들기를 사용해 주세요.');
  }

  const label = accountLoginId || academyCode;
  const password = window.prompt('보안 확인을 위해 원장 비밀번호를 한 번만 다시 입력해 주세요.' + (label ? '\n확인 ID: ' + label : ''));
  if (password === null) throw new Error('원장 비밀번호 확인이 취소되었습니다.');
  if (!String(password).trim()) throw new Error('원장 비밀번호를 입력해 주세요.');

  const errors = [];
  for (const loginId of loginCandidates) {
    try {
      const accountResult = await loginOlliAccount(loginId, String(password).trim());
      saveOlliAccountLoginState(accountResult, loginId);
      sessionToken = getOlliTeacherAdminSessionToken();
      if (sessionToken) return sessionToken;
      errors.push(loginId + ': 세션 토큰 없음');
    } catch (error) {
      errors.push(loginId + ': ' + (error?.message || error));
    }
  }

  throw new Error('로그인 ID 또는 비밀번호가 맞지 않습니다.' + (errors.length ? '\n' + errors.join('\n') : ''));
}

async function callOlliTeacherAdminRpc(functionName, payload) {
  const academyId = getOlliScopedAcademyId('선생님 관리');
  if (!academyId) throw new Error('현재 학원 ID를 확인하지 못했습니다.');

  let sessionToken = await ensureOlliTeacherAdminSessionToken(false);
  let result = await callOlliRpc(functionName, {
    p_session_token: sessionToken,
    p_academy_id: academyId,
    ...(payload || {})
  });

  const resultMessage = String((result && result.message) || '');
  if (result && result.ok === false && /세션.*(만료|올바르지|없습니다)|원장 계정 세션/i.test(resultMessage)) {
    try { localStorage.removeItem('olli_account_session_token_v1'); } catch (error) {}
    sessionToken = await ensureOlliTeacherAdminSessionToken(true);
    result = await callOlliRpc(functionName, {
      p_session_token: sessionToken,
      p_academy_id: academyId,
      ...(payload || {})
    });
  }

  return result;
}

async function reloadAndVerifySettingsMember(memberId, expectedStatus) {
  await settingsLoadTeacherManagementMembers();
  const member = findSettingsMember(memberId);
  if (!member) throw new Error('변경 후 선생님 정보를 다시 불러오지 못했습니다.');
  if (expectedStatus && !isSettingsAccountMembershipMember(member) && getSettingsMemberStatus(member) !== expectedStatus) {
    throw new Error('서버에 저장된 선생님 상태가 요청한 값과 다릅니다.');
  }
  return member;
}

async function toggleSettingsMemberActive(memberId) {
  const id = String(memberId || '').trim();
  const member = findSettingsMember(id);
  if (!id || !member || getSettingsMemberRole(member) === 'owner' || olliTeacherMutationIds.has(id)) return;
  if (isSettingsAccountMembershipMember(member)) {
    alert('개인계정으로 연결된 선생님은 권한 변경 또는 학원 연결 해제로 관리해 주세요.');
    return;
  }

  const nextStatus = getSettingsMemberStatus(member) === 'active' ? 'disabled' : 'active';
  olliTeacherMutationIds.add(id);
  refreshSettingsTeacherPanel();

  try {
    const result = await callOlliTeacherAdminRpc('olli_set_member_status', {
      p_member_id: id,
      p_status: nextStatus
    });
    if (!result || result.ok !== true || String(result.status || '') !== nextStatus) {
      throw new Error((result && result.message) || '선생님 상태 저장 결과를 확인하지 못했습니다.');
    }
    await reloadAndVerifySettingsMember(id, nextStatus);
  } catch (err) {
    alert('상태 변경 실패\n' + (err.message || err));
    try { await settingsLoadTeacherManagementMembers(); } catch (reloadError) { console.warn(reloadError); }
  } finally {
    olliTeacherMutationIds.delete(id);
    refreshSettingsTeacherPanel();
  }
}

async function disableSettingsMember(memberId) {
  return toggleSettingsMemberActive(memberId);
}

async function olliRemoveMemberRegistration(memberId) {
  const id = String(memberId || '').trim();
  if (!id) throw new Error('연결 해제할 선생님 ID가 없습니다.');
  const result = await callOlliTeacherAdminRpc('olli_remove_member_registration', {
    p_member_id: id
  });
  if (!result || result.ok !== true || result.member_removed !== true) {
    throw new Error((result && result.message) || '선생님 계정 삭제 결과를 확인하지 못했습니다.');
  }
  return result;
}
window.olliRemoveMemberRegistration = olliRemoveMemberRegistration;

async function resetSettingsMemberDevice(memberId) {
  const id = String(memberId || '').trim();
  const member = findSettingsMember(id);
  if (!id || !member || getSettingsMemberRole(member) === 'owner' || olliTeacherMutationIds.has(id)) return;

  const accountMembership = isSettingsAccountMembershipMember(member);
  const confirmMessage = accountMembership
    ? '이 선생님을 현재 학원에서 연결 해제할까요?\n다른 학원 연결과 개인계정은 유지됩니다.'
    : '이 선생님을 현재 학원에서 연결 해제할까요? 연결 해제 후에는 다시 학원 찾기와 승인 요청이 필요합니다.';
  if (!confirm(confirmMessage)) return;

  olliTeacherMutationIds.add(id);
  refreshSettingsTeacherPanel();
  try {
    if (accountMembership) {
      const result = await callOlliTeacherAdminRpc('olli_remove_account_membership', { p_member_id: id });
      if (!result || result.ok !== true) {
        throw new Error((result && result.message) || '학원 계정 연결 해제 결과를 확인하지 못했습니다.');
      }
    } else {
      await olliRemoveMemberRegistration(id);
    }
    olliSettingsState.members = (olliSettingsState.members || []).filter(item => getSettingsMemberId(item) !== id);
    await settingsLoadTeacherManagementMembers();
    if (findSettingsMember(id)) throw new Error('연결 해제 후에도 선생님 계정이 서버에 남아 있습니다.');
  } catch (err) {
    alert('학원 연결 해제 실패\n' + (err.message || err));
    try { await settingsLoadTeacherManagementMembers(); } catch (reloadError) { console.warn(reloadError); }
  } finally {
    olliTeacherMutationIds.delete(id);
    refreshSettingsTeacherPanel();
  }
}

function ensureSettingsRoleTogglePopup() {
  let overlay = document.getElementById('settingsRoleToggleOverlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'settingsRoleToggleOverlay';
  overlay.className = 'settingsRoleToggleOverlay';
  overlay.innerHTML = '<div class="settingsRoleToggleCard">'
    + '<div class="settingsRoleToggleTitle">권한 설정</div>'
    + '<div class="settingsRoleToggleDesc">선생님의 권한을 선택해 주세요.</div>'
    + '<div class="settingsRoleToggleGrid">'
    + '<button id="settingsRoleManagerOption" class="settingsRoleToggleOption" type="button" onclick="selectSettingsRoleToggle(\'manager\')">관리자</button>'
    + '<button id="settingsRoleTeacherOption" class="settingsRoleToggleOption" type="button" onclick="selectSettingsRoleToggle(\'teacher\')">선생님</button>'
    + '</div><div class="settingsRoleToggleActions">'
    + '<button class="settingsRoleToggleBtn" type="button" onclick="closeSettingsRoleTogglePopup()">취소</button>'
    + '<button class="settingsRoleToggleBtn primary" type="button" onclick="saveSettingsRoleTogglePopup()">저장</button>'
    + '</div></div>';
  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeSettingsRoleTogglePopup();
  });
  document.body.appendChild(overlay);
  return overlay;
}

function paintSettingsRoleTogglePopup() {
  const manager = document.getElementById('settingsRoleManagerOption');
  const teacher = document.getElementById('settingsRoleTeacherOption');
  if (manager) manager.classList.toggle('active', settingsRolePopupSelectedRole === 'manager');
  if (teacher) teacher.classList.toggle('active', settingsRolePopupSelectedRole === 'teacher');
}

function openSettingsRoleTogglePopup(memberId, currentRole) {
  settingsRolePopupMemberId = String(memberId || '').trim();
  settingsRolePopupSelectedRole = currentRole === 'manager' ? 'manager' : 'teacher';
  ensureSettingsRoleTogglePopup().classList.add('show');
  paintSettingsRoleTogglePopup();
}

function selectSettingsRoleToggle(role) {
  settingsRolePopupSelectedRole = role === 'manager' ? 'manager' : 'teacher';
  paintSettingsRoleTogglePopup();
}

function closeSettingsRoleTogglePopup() {
  const overlay = document.getElementById('settingsRoleToggleOverlay');
  if (overlay) overlay.classList.remove('show');
}

async function saveSettingsRoleTogglePopup() {
  const id = settingsRolePopupMemberId;
  const member = findSettingsMember(id);
  const role = settingsRolePopupSelectedRole === 'manager' ? 'manager' : 'teacher';
  if (!id || !member || getSettingsMemberRole(member) === 'owner' || olliTeacherMutationIds.has(id)) return;

  closeSettingsRoleTogglePopup();
  olliTeacherMutationIds.add(id);
  refreshSettingsTeacherPanel();
  try {
    const rpcName = isSettingsAccountMembershipMember(member)
      ? 'olli_set_account_membership_role'
      : 'olli_set_member_role';
    const result = await callOlliTeacherAdminRpc(rpcName, {
      p_member_id: id,
      p_role: role
    });
    if (!result || result.ok !== true || (result.role && String(result.role || '') !== role)) {
      throw new Error((result && result.message) || '선생님 권한 저장 결과를 확인하지 못했습니다.');
    }
    await settingsLoadTeacherManagementMembers();
    const loaded = findSettingsMember(id);
    if (!loaded || getSettingsMemberRole(loaded) !== role) {
      throw new Error('서버에 저장된 선생님 권한이 요청한 값과 다릅니다.');
    }
  } catch (err) {
    alert('권한 변경 실패\n' + (err.message || err));
    try { await settingsLoadTeacherManagementMembers(); } catch (reloadError) { console.warn(reloadError); }
  } finally {
    olliTeacherMutationIds.delete(id);
    refreshSettingsTeacherPanel();
  }
}

function changeSettingsMemberRole(memberId, currentRole) {
  openSettingsRoleTogglePopup(memberId, currentRole);
}

function getOlliAssignableManagerAcademies() {
  const currentAcademyId = String(localStorage.getItem('olli_current_academy_id') || '').trim();
  const state = typeof getOlliMultiAcademyState === 'function' ? getOlliMultiAcademyState() : null;
  return normalizeOlliAccountAcademies(state?.academies || [])
    .filter(item => item.academy_id !== currentAcademyId && item.role === 'owner');
}

function ensureSettingsCrossAcademyManagerPopup() {
  let overlay = document.getElementById('settingsCrossAcademyManagerOverlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'settingsCrossAcademyManagerOverlay';
  overlay.className = 'settingsRoleToggleOverlay';
  overlay.innerHTML = '<div class="settingsRoleToggleCard settingsCrossAcademyManagerCard">'
    + '<div class="settingsRoleToggleTitle">다른 학원 관리 권한</div>'
    + '<div id="settingsCrossAcademyManagerDesc" class="settingsRoleToggleDesc">관리자로 접근할 학원을 선택해 주세요.</div>'
    + '<div id="settingsCrossAcademyManagerList" class="settingsCrossAcademyManagerList"></div>'
    + '<div class="settingsRoleToggleActions">'
    + '<button class="settingsRoleToggleBtn" type="button" onclick="closeSettingsCrossAcademyManagerPopup()">취소</button>'
    + '<button id="settingsCrossAcademyManagerSaveBtn" class="settingsRoleToggleBtn primary" type="button" onclick="saveSettingsCrossAcademyManagerPopup()">저장</button>'
    + '</div></div>';
  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeSettingsCrossAcademyManagerPopup();
  });
  document.body.appendChild(overlay);
  return overlay;
}

function renderSettingsCrossAcademyManagerPopup() {
  const list = document.getElementById('settingsCrossAcademyManagerList');
  const desc = document.getElementById('settingsCrossAcademyManagerDesc');
  const saveBtn = document.getElementById('settingsCrossAcademyManagerSaveBtn');
  const member = findSettingsMember(settingsCrossAcademyManagerMemberId);
  const academies = getOlliAssignableManagerAcademies();
  if (desc) {
    const name = member?.display_name || member?.member_name || member?.teacher_name || '선생님';
    desc.textContent = settingsCrossAcademyManagerLoading
      ? `${name} 선생님의 현재 권한을 확인하고 있습니다.`
      : `${name} 선생님이 관리자로 접근할 학원을 선택해 주세요.`;
  }
  if (saveBtn) saveBtn.disabled = settingsCrossAcademyManagerLoading;
  if (!list) return;
  if (settingsCrossAcademyManagerLoading) {
    list.innerHTML = '<div class="settingsLoadingText">권한을 불러오는 중입니다...</div>';
    return;
  }
  if (!academies.length) {
    list.innerHTML = '<div class="settingsEmptyBox">현재 원장 계정에 연결된 다른 학원이 없습니다.</div>';
    return;
  }
  list.innerHTML = academies.map(academy => {
    const active = settingsCrossAcademyManagerSelectedIds.has(academy.academy_id);
    const meta = [academy.academy_code ? `학원 ID ${academy.academy_code}` : '', '관리자 권한'].filter(Boolean).join(' · ');
    return '<button class="settingsCrossAcademyManagerOption ' + (active ? 'active' : '') + '" type="button" onclick="toggleSettingsCrossAcademyManagerAcademy(\'' + settingsEscapeAttr(academy.academy_id) + '\')">'
      + '<span><strong>' + settingsEscapeHtml(academy.academy_name || academy.academy_code || '학원') + '</strong><small>' + settingsEscapeHtml(meta) + '</small></span>'
      + '<span class="settingsCrossAcademyManagerCheck">' + (active ? '✓' : '') + '</span>'
      + '</button>';
  }).join('');
}

async function openSettingsCrossAcademyManagerPopup(memberId) {
  const id = String(memberId || '').trim();
  const member = findSettingsMember(id);
  if (!id || !member || !canManageSettingsMember(member)) return;
  if (!getOlliAssignableManagerAcademies().length) {
    alert('현재 원장 계정에 연결된 다른 학원이 없습니다.');
    return;
  }

  settingsCrossAcademyManagerMemberId = id;
  settingsCrossAcademyManagerSelectedIds = new Set();
  settingsCrossAcademyManagerLoading = true;
  const overlay = ensureSettingsCrossAcademyManagerPopup();
  overlay.classList.add('show');
  renderSettingsCrossAcademyManagerPopup();

  try {
    const result = await callOlliTeacherAdminRpc('olli_get_teacher_managed_academies', {
      p_member_id: id
    });
    if (!result || result.ok !== true) {
      throw new Error((result && result.message) || '다른 학원 관리 권한을 불러오지 못했습니다.');
    }
    settingsCrossAcademyManagerSelectedIds = new Set(
      (Array.isArray(result.selected_academy_ids) ? result.selected_academy_ids : [])
        .map(value => String(value || '').trim())
        .filter(Boolean)
    );
  } catch (error) {
    closeSettingsCrossAcademyManagerPopup();
    alert('다른 학원 관리 권한 조회 실패\n' + (error.message || error));
  } finally {
    settingsCrossAcademyManagerLoading = false;
    renderSettingsCrossAcademyManagerPopup();
  }
}

function toggleSettingsCrossAcademyManagerAcademy(academyId) {
  if (settingsCrossAcademyManagerLoading) return;
  const id = String(academyId || '').trim();
  if (!id) return;
  if (settingsCrossAcademyManagerSelectedIds.has(id)) settingsCrossAcademyManagerSelectedIds.delete(id);
  else settingsCrossAcademyManagerSelectedIds.add(id);
  renderSettingsCrossAcademyManagerPopup();
}

function closeSettingsCrossAcademyManagerPopup() {
  const overlay = document.getElementById('settingsCrossAcademyManagerOverlay');
  if (overlay) overlay.classList.remove('show');
  settingsCrossAcademyManagerLoading = false;
}

async function saveSettingsCrossAcademyManagerPopup() {
  const id = settingsCrossAcademyManagerMemberId;
  const member = findSettingsMember(id);
  if (!id || !member || !canManageSettingsMember(member) || settingsCrossAcademyManagerLoading) return;

  settingsCrossAcademyManagerLoading = true;
  renderSettingsCrossAcademyManagerPopup();
  try {
    const result = await callOlliTeacherAdminRpc('olli_set_teacher_managed_academies', {
      p_member_id: id,
      p_target_academy_ids: Array.from(settingsCrossAcademyManagerSelectedIds)
    });
    if (!result || result.ok !== true) {
      throw new Error((result && (result.message || result.details)) || '다른 학원 관리 권한을 저장하지 못했습니다.');
    }
    settingsCrossAcademyManagerSelectedIds = new Set(
      (Array.isArray(result.selected_academy_ids) ? result.selected_academy_ids : [])
        .map(value => String(value || '').trim())
        .filter(Boolean)
    );
    closeSettingsCrossAcademyManagerPopup();
    alert('다른 학원 관리 권한이 저장되었습니다. 선생님 기기에서 앱을 다시 열거나 화면으로 돌아오면 학원 목록이 갱신됩니다.');
  } catch (error) {
    alert('다른 학원 관리 권한 저장 실패\n' + (error.message || error));
  } finally {
    settingsCrossAcademyManagerLoading = false;
    renderSettingsCrossAcademyManagerPopup();
  }
}

function renderSettingsApprovalRequests() {
  const teacherRows = olliSettingsState.approvalRequests || [];
  const academyRows = olliSettingsState.academyAccessRequests || [];
  const code = olliSettingsState.lastApprovalQueryCode
    || localStorage.getItem('olli_current_academy_code')
    || olliSettingsState.academy?.academy_code
    || OLLI_TEST_ACADEMY_CODE;

  const header = '<div class="settingsDetailIntro">'
    + '<div class="settingsDetailTitle">승인 요청을<br>확인합니다.</div>'
    + '<div class="settingsMiniText">조회 중인 학원 ID: <strong>' + settingsEscapeHtml(code || '없음') + '</strong></div>'
    + '<button class="settingsExportBtn" type="button" onclick="refreshSettingsApprovalRequests()">승인 요청 새로고침</button>'
    + '</div>';

  const academySection = academyRows.length ? '<div class="settingsInfoCard">'
    + '<div class="settingsInfoHead">개인계정 학원 연결 요청</div>'
    + academyRows.map(r => {
      const role = String(r.requested_role || 'teacher').trim();
      const requesterName = String(r.requester_name || r.account_name || r.display_name || r.member_name || r.name || '계정 사용자').trim();
      const requesterId = String(r.requester_login_id || r.login_id || r.account_login_id || r.username || '').trim();
      return '<div class="settingsRequestCard">'
        + '<div class="settingsRequestTop"><div class="settingsRequestName">' + settingsEscapeHtml(requesterName) + '</div><span class="settingsStatusBadge waiting">연결 대기</span></div>'
        + '<div class="settingsRequestMeta"><div>요청 권한: ' + settingsEscapeHtml(getOlliAcademyRoleLabel(role)) + '</div>'
        + (requesterId ? '<div>계정 아이디: ' + settingsEscapeHtml(requesterId) + '</div>' : '')
        + '<div>요청 시간: ' + settingsEscapeHtml(String(r.created_at || '').slice(0, 19)) + '</div></div>'
        + '<div class="settingsActionGrid"><button class="settingsActionBtn red" type="button" onclick="rejectOlliAcademyAccessRequest(\'' + settingsEscapeAttr(r.id) + '\')">거절</button>'
        + '<button class="settingsActionBtn primary" type="button" onclick="approveOlliAcademyAccessRequest(\'' + settingsEscapeAttr(r.id) + '\',\'' + settingsEscapeAttr(role) + '\')">' + settingsEscapeHtml(getOlliAcademyRoleLabel(role)) + ' 승인</button></div>'
        + '</div>';
    }).join('') + '</div>' : '';

  const teacherSection = teacherRows.length ? '<div class="settingsInfoCard" style="margin-top:14px;">'
    + '<div class="settingsInfoHead">기존 승인 요청</div>'
    + teacherRows.map(r => '<div class="settingsRequestCard">'
      + '<div class="settingsRequestTop"><div class="settingsRequestName">' + settingsEscapeHtml(r.teacher_name) + '</div><span class="settingsStatusBadge waiting">승인 대기</span></div>'
      + '<div class="settingsRequestMeta"><div>요청 권한: ' + settingsEscapeHtml(r.requested_role || 'teacher') + '</div><div>요청 정보: ' + settingsEscapeHtml(r.requested_device_name || '미확인') + '</div><div>요청 시간: ' + settingsEscapeHtml(String(r.created_at || '').slice(0, 19)) + '</div></div>'
      + '<div class="settingsActionGrid"><button class="settingsActionBtn red" type="button" onclick="rejectSettingsRequest(\'' + settingsEscapeAttr(r.id) + '\')">거절</button><button class="settingsActionBtn primary" type="button" onclick="approveSettingsRequest(\'' + settingsEscapeAttr(r.id) + '\')">승인</button></div>'
      + '</div>').join('') + '</div>' : '';

  if (!academyRows.length && !teacherRows.length) {
    const error = olliSettingsState.lastError
      ? '<div class="settingsErrorBox">' + settingsEscapeHtml(olliSettingsState.lastError) + '</div>'
      : '';
    return header + error + '<div class="settingsEmptyBox">대기 중인 승인 요청이 없습니다.</div>';
  }

  return header + academySection + teacherSection;
}

async function refreshSettingsApprovalRequests() {
  await settingsLoadAllApprovalRequests();
  const body = document.getElementById('settingsDetailBody');
  if (body) body.innerHTML = renderSettingsApprovalRequests();
  settingsApplyStateToUI();
}

async function approveSettingsRequest(requestId) {
  try {
    await ensureSettingsRequestBelongsToCurrentAcademy(requestId);
    // 실제 로그인/RLS 연결 전에는 RPC가 권한 체크에서 막힐 수 있습니다.
    // 우선 RPC를 시도하고, 실패 시 사용자에게 원인을 보여줍니다.
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/test_approve_teacher_request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${getOlliAuthAccessToken ? (getOlliAuthAccessToken() || SUPABASE_KEY) : SUPABASE_KEY}`
      },
      body: JSON.stringify({ p_request_id: requestId, p_academy_id: settingsGetAcademyId() })
    }).then(async res => {
      const text = await res.text();
      if (!res.ok) throw new Error(text || '승인 실패');
      return text ? JSON.parse(text) : null;
    });

    await settingsLoadApprovalRequests();
    await settingsLoadMembers();
    const body = document.getElementById('settingsDetailBody');
    if (body) body.innerHTML = renderSettingsApprovalRequests();
    settingsApplyStateToUI();
  } catch (err) {
    alert('승인 처리 중 오류가 발생했습니다.\nStage 4 테스트 RPC SQL이 실행되었는지 확인해 주세요.\n\n현재 오류:\n' + (err.message || err));
  }
}

async function rejectSettingsRequest(requestId) {
  try {
    await ensureSettingsRequestBelongsToCurrentAcademy(requestId);
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/test_reject_teacher_request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${getOlliAuthAccessToken ? (getOlliAuthAccessToken() || SUPABASE_KEY) : SUPABASE_KEY}`
      },
      body: JSON.stringify({ p_request_id: requestId, p_academy_id: settingsGetAcademyId() })
    }).then(async res => {
      const text = await res.text();
      if (!res.ok) throw new Error(text || '거절 실패');
      return text ? JSON.parse(text) : null;
    });

    await settingsLoadApprovalRequests();
    const body = document.getElementById('settingsDetailBody');
    if (body) body.innerHTML = renderSettingsApprovalRequests();
    settingsApplyStateToUI();
  } catch (err) {
    alert('거절 처리 중 오류가 발생했습니다.\nStage 4 테스트 RPC SQL이 실행되었는지 확인해 주세요.\n\n현재 오류:\n' + (err.message || err));
  }
}


function getOlliTestApprovalAcademyTargets() {
  const targets = [];
  const seen = new Set();
  function add(item) {
    if (!item) return;
    const academyId = String(item.academy_id || item.academyId || item.id || '').trim();
    const academyCode = String(item.academy_code || item.academyCode || '').trim();
    const key = academyId || academyCode.toUpperCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    targets.push({
      academy_id: academyId,
      academy_code: academyCode,
      academy_name: String(item.academy_name || item.academyName || item.name || '').trim(),
      role: String(item.role || item.member_role || item.account_role || '').trim()
    });
  }
  if (typeof readOlliCachedAccountAcademies === 'function') {
    readOlliCachedAccountAcademies().forEach(add);
  }
  (Array.isArray(olliSettingsState?.academyAccountMemberships) ? olliSettingsState.academyAccountMemberships : []).forEach(add);
  add({
    academy_id: typeof settingsGetAcademyId === 'function' ? settingsGetAcademyId() : getOlliCurrentAcademyId(),
    academy_code: getOlliCurrentAcademyCode(),
    academy_name: getOlliCurrentAcademyName(),
    role: typeof getOlliCurrentRole === 'function' ? getOlliCurrentRole() : ''
  });
  return targets;
}

function normalizeOlliTestApprovalRequest(row, academyInfo) {
  const academy = academyInfo || {};
  return {
    id: String(row?.id || row?.request_id || '').trim(),
    teacher_name: String(row?.teacher_name || row?.member_name || row?.display_name || row?.name || '').trim(),
    requested_role: String(row?.requested_role || row?.role || 'teacher').trim(),
    requested_device_name: String(row?.requested_device_name || row?.device_name || '').trim(),
    created_at: String(row?.created_at || row?.requested_at || '').trim(),
    academy_id: String(row?.academy_id || row?.target_academy_id || academy.academy_id || '').trim(),
    academy_code: String(row?.academy_code || row?.requested_academy_code || academy.academy_code || '').trim(),
    academy_name: String(row?.academy_name || academy.academy_name || '').trim()
  };
}

async function loadOlliTestApprovalManagerRequests() {
  olliSettingsState.testApprovalManagerLoading = true;
  olliSettingsState.testApprovalManagerError = '';
  olliSettingsState.testApprovalRequests = [];
  const sessionToken = String(localStorage.getItem('olli_account_session_token_v1') || '').trim();
  const rows = [];
  const seen = new Set();
  function addRows(list, academyInfo) {
    (Array.isArray(list) ? list : []).forEach(row => {
      const normalized = normalizeOlliTestApprovalRequest(row, academyInfo);
      if (!normalized.id) return;
      if (seen.has(normalized.id)) return;
      seen.add(normalized.id);
      rows.push(normalized);
    });
  }

  if (!sessionToken) {
    olliSettingsState.testApprovalManagerLoading = false;
    olliSettingsState.testApprovalManagerError = '내 계정 세션이 없습니다. 전역 승인관리는 원장/관리자 계정으로 다시 로그인한 뒤 사용할 수 있습니다.';
    return [];
  }

  const rpcNames = [
    'olli_admin_list_all_teacher_approval_requests',
    'olli_list_all_teacher_approval_requests',
    'test_list_all_teacher_approval_requests'
  ];
  const errors = [];
  for (const rpcName of rpcNames) {
    try {
      const result = await callOlliRpc(rpcName, { p_session_token: sessionToken });
      if (result && result.ok === false) throw new Error(result.message || rpcName + ' 실행 실패');
      const list = Array.isArray(result) ? result : (Array.isArray(result?.requests) ? result.requests : []);
      addRows(list, null);
      olliSettingsState.testApprovalRequests = rows;
      olliSettingsState.testApprovalManagerLoading = false;
      olliSettingsState.testApprovalManagerError = '';
      return rows;
    } catch (err) {
      console.warn(rpcName + ' failed:', err && (err.message || err));
      errors.push(rpcName + ': ' + (err.message || err));
    }
  }

  olliSettingsState.testApprovalRequests = [];
  olliSettingsState.testApprovalManagerLoading = false;
  olliSettingsState.testApprovalManagerError =
    '다른 원장님 학원까지 포함한 전체 승인 요청을 보려면 Supabase에 전역 승인관리 RPC가 필요합니다.\n' +
    '현재 앱은 내 계정에 연결된 학원으로 우회 조회하지 않고, 전역 RPC만 호출하도록 되어 있습니다.\n' +
    errors.slice(0, 3).join('\n');
  return [];
}

async function callOlliTestApprovalAdminAttempt(attempts) {
  let lastError = null;
  for (const attempt of attempts) {
    try {
      if (attempt.mode === 'test') return await callOlliTestRpc(attempt.name, attempt.payload || {});
      return await callOlliRpc(attempt.name, attempt.payload || {});
    } catch (err) {
      lastError = err;
      console.warn((attempt.name || 'approval rpc') + ' failed:', err && (err.message || err));
    }
  }
  throw lastError || new Error('승인관리 RPC를 실행하지 못했습니다.');
}

function renderOlliTestApprovalManager() {
  const rows = Array.isArray(olliSettingsState.testApprovalRequests) ? olliSettingsState.testApprovalRequests : [];
  const loading = !!olliSettingsState.testApprovalManagerLoading;
  const error = String(olliSettingsState.testApprovalManagerError || '').trim();
  const header = '<div class="settingsDetailIntro">'
    + '<div class="settingsDetailTitle">승인 요청을<br>관리합니다.</div>'
    + '<div class="settingsMiniText">테스트 기간 동안 다른 원장님 학원까지 포함한 전체 선생님 승인 요청을 한 화면에서 확인합니다.</div>'
    + '<div class="settingsActionGrid"><button class="settingsActionBtn" type="button" onclick="refreshOlliTestApprovalManager()">새로고침</button><button class="settingsActionBtn" type="button" onclick="refreshOlliStorageDiagnostics()">저장진단으로 돌아가기</button></div>'
    + '</div>';
  if (loading) return header + '<div class="settingsEmptyBox">승인 요청을 불러오는 중입니다.</div>';
  if (!rows.length) {
    return header
      + (error ? '<div class="settingsErrorBox">' + settingsEscapeHtml(error) + '</div>' : '')
      + '<div class="settingsEmptyBox">대기 중인 승인 요청이 없습니다.</div>';
  }
  return header + '<div class="settingsInfoCard">'
    + '<div class="settingsInfoHead">전체 선생님 승인 요청</div>'
    + rows.map(r => {
      const academyLabel = [r.academy_name, r.academy_code].filter(Boolean).join(' · ') || r.academy_id || '학원 정보 없음';
      const requestMeta = [
        '학원: ' + academyLabel,
        '요청 권한: ' + (r.requested_role || 'teacher'),
        r.requested_device_name ? '요청 정보: ' + r.requested_device_name : '',
        r.created_at ? '요청 시간: ' + String(r.created_at).slice(0, 19) : ''
      ].filter(Boolean);
      return '<div class="settingsRequestCard">'
        + '<div class="settingsRequestTop"><div class="settingsRequestName">' + settingsEscapeHtml(r.teacher_name || '이름 없음') + '</div><span class="settingsStatusBadge waiting">승인 대기</span></div>'
        + '<div class="settingsRequestMeta">' + requestMeta.map(item => '<div>' + settingsEscapeHtml(item) + '</div>').join('') + '</div>'
        + '<div class="settingsActionGrid"><button class="settingsActionBtn red" type="button" onclick="rejectOlliTestApprovalRequest(\'' + settingsEscapeAttr(r.id) + '\')">거절</button><button class="settingsActionBtn primary" type="button" onclick="approveOlliTestApprovalRequest(\'' + settingsEscapeAttr(r.id) + '\')">승인</button></div>'
        + '</div>';
    }).join('')
    + '</div>';
}

async function openOlliTestApprovalManager() {
  const body = document.getElementById('settingsDetailBody');
  if (body) body.innerHTML = renderOlliTestApprovalManager();
  await loadOlliTestApprovalManagerRequests();
  if (body) body.innerHTML = renderOlliTestApprovalManager();
  if (typeof settingsApplyStateToUI === 'function') settingsApplyStateToUI();
}

async function refreshOlliTestApprovalManager() {
  const body = document.getElementById('settingsDetailBody');
  olliSettingsState.testApprovalManagerLoading = true;
  if (body) body.innerHTML = renderOlliTestApprovalManager();
  await loadOlliTestApprovalManagerRequests();
  if (body) body.innerHTML = renderOlliTestApprovalManager();
  if (typeof settingsApplyStateToUI === 'function') settingsApplyStateToUI();
}

function findOlliTestApprovalRequest(requestId) {
  const id = String(requestId || '').trim();
  return (Array.isArray(olliSettingsState.testApprovalRequests) ? olliSettingsState.testApprovalRequests : []).find(item => String(item.id || '') === id) || null;
}

async function approveOlliTestApprovalRequest(requestId) {
  const request = findOlliTestApprovalRequest(requestId);
  const academyId = String(request?.academy_id || '').trim();
  const sessionToken = String(localStorage.getItem('olli_account_session_token_v1') || '').trim();
  if (!request) {
    alert('승인할 요청을 찾지 못했습니다. 새로고침 후 다시 시도해 주세요.');
    return;
  }
  if (!sessionToken) {
    alert('내 계정 세션이 없습니다. 다시 로그인한 뒤 승인해 주세요.');
    return;
  }
  if (!confirm((request.academy_name || request.academy_code || '해당 학원') + '의 ' + (request.teacher_name || '선생님') + ' 승인 요청을 승인할까요?')) return;
  try {
    await callOlliTestApprovalAdminAttempt([
      {
        name: 'olli_admin_approve_teacher_approval_request',
        payload: { p_session_token: sessionToken, p_request_id: String(requestId || '').trim() }
      },
      {
        name: 'olli_approve_any_teacher_approval_request',
        payload: { p_session_token: sessionToken, p_request_id: String(requestId || '').trim() }
      },
      {
        name: 'test_admin_approve_teacher_request',
        payload: { p_session_token: sessionToken, p_request_id: String(requestId || '').trim() }
      },
      {
        name: 'test_approve_teacher_request',
        mode: 'test',
        payload: { p_request_id: String(requestId || '').trim(), p_academy_id: academyId }
      }
    ]);
    await refreshOlliTestApprovalManager();
  } catch (err) {
    alert('승인 처리 중 오류가 발생했습니다.\n다른 원장님 학원 승인까지 처리하려면 전역 승인관리 RPC가 Supabase에 필요합니다.\n' + (err.message || err));
  }
}

async function rejectOlliTestApprovalRequest(requestId) {
  const request = findOlliTestApprovalRequest(requestId);
  const academyId = String(request?.academy_id || '').trim();
  const sessionToken = String(localStorage.getItem('olli_account_session_token_v1') || '').trim();
  if (!request) {
    alert('거절할 요청을 찾지 못했습니다. 새로고침 후 다시 시도해 주세요.');
    return;
  }
  if (!sessionToken) {
    alert('내 계정 세션이 없습니다. 다시 로그인한 뒤 거절해 주세요.');
    return;
  }
  if (!confirm((request.academy_name || request.academy_code || '해당 학원') + '의 ' + (request.teacher_name || '선생님') + ' 승인 요청을 거절할까요?')) return;
  try {
    await callOlliTestApprovalAdminAttempt([
      {
        name: 'olli_admin_reject_teacher_approval_request',
        payload: { p_session_token: sessionToken, p_request_id: String(requestId || '').trim() }
      },
      {
        name: 'olli_reject_any_teacher_approval_request',
        payload: { p_session_token: sessionToken, p_request_id: String(requestId || '').trim() }
      },
      {
        name: 'test_admin_reject_teacher_request',
        payload: { p_session_token: sessionToken, p_request_id: String(requestId || '').trim() }
      },
      {
        name: 'test_reject_teacher_request',
        mode: 'test',
        payload: { p_request_id: String(requestId || '').trim(), p_academy_id: academyId }
      }
    ]);
    await refreshOlliTestApprovalManager();
  } catch (err) {
    alert('거절 처리 중 오류가 발생했습니다.\n다른 원장님 학원 승인까지 처리하려면 전역 승인관리 RPC가 Supabase에 필요합니다.\n' + (err.message || err));
  }
}

window.openOlliTestApprovalManager = openOlliTestApprovalManager;
window.refreshOlliTestApprovalManager = refreshOlliTestApprovalManager;
window.approveOlliTestApprovalRequest = approveOlliTestApprovalRequest;
window.rejectOlliTestApprovalRequest = rejectOlliTestApprovalRequest;

