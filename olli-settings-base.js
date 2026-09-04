/* 2026-04-26 v40-fix-5: 설정 페이지 Supabase 1차 연결 */
const OLLI_TEST_ACADEMY_CODE = '';
const OLLI_SETTINGS_LOCAL_KEY = 'olli_settings_cache_v2';
function getOlliSettingsLocalKey() {
  const academyId = (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || 'unscoped';
  return `${OLLI_SETTINGS_LOCAL_KEY}_${academyId}`;
}

let olliSettingsState = {
  academy: null,
  members: [],
  approvalRequests: [],
  academyAccessRequests: [],
  academyAccountMemberships: [],
  notificationEnabled: true,
  lastError: ''
};

function settingsEscapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}
function settingsEscapeAttr(value) {
  return settingsEscapeHtml(value).replace(/`/g, '&#96;');
}

function renderAcademyMiniIcon() {
  return '<svg class="academySettingsIcon" viewBox="0 0 24 24" aria-hidden="true">'
    + '<path d="M4 7h5.1"></path>'
    + '<circle cx="12" cy="7" r="2.2"></circle>'
    + '<path d="M14.9 7H20"></path>'
    + '<path d="M4 17h8.1"></path>'
    + '<circle cx="15" cy="17" r="2.2"></circle>'
    + '<path d="M17.9 17H20"></path>'
    + '</svg>';
}

function normalizeOlliMemberRoleValue(value) {
  const raw = String(value || '').trim();
  const lower = raw.toLowerCase();
  if (['super_admin', 'owner', 'manager', 'teacher'].includes(lower)) return lower;
  if (['academy_owner', 'admin_owner', 'principal', 'director', '원장'].includes(lower)) return 'owner';
  if (['admin', 'academy_manager', '관리자'].includes(lower)) return 'manager';
  if (['instructor', 'staff', '선생님', '교사'].includes(lower)) return 'teacher';
  return '';
}

function getOlliCurrentAcademyRoleFromCache() {
  try {
    const context = window.OlliStorageCore?.AcademyContext?.getCurrent?.();
    const contextRole = normalizeOlliMemberRoleValue(context?.role);
    const currentAcademyId = String(localStorage.getItem('olli_current_academy_id') || context?.academyId || '').trim();
    const currentAcademyCode = String(localStorage.getItem('olli_current_academy_code') || context?.academyCode || '').trim().toUpperCase();
    if (contextRole && (!currentAcademyId || String(context?.academyId || '').trim() === currentAcademyId)) return contextRole;

    const rawList = JSON.parse(localStorage.getItem('olli_account_academies_v1') || '[]');
    const list = Array.isArray(rawList) ? rawList : [];
    const matched = list.find(item => {
      const id = String(item?.academy_id || item?.academyId || item?.id || '').trim();
      const code = String(item?.academy_code || item?.academyCode || '').trim().toUpperCase();
      return (currentAcademyId && id === currentAcademyId) || (currentAcademyCode && code === currentAcademyCode);
    });
    return normalizeOlliMemberRoleValue(matched?.role || matched?.member_role || matched?.membership_role || matched?.role_name || matched?.account_role);
  } catch (err) {
    return '';
  }
}

function getOlliCurrentRole() {
  const explicitRole = normalizeOlliMemberRoleValue(localStorage.getItem('olli_current_member_role') || '');
  const cachedAcademyRole = getOlliCurrentAcademyRoleFromCache();
  const hasAccountSession = !!localStorage.getItem('olli_account_session_token_v1');

  if (hasAccountSession) {
    if (cachedAcademyRole) {
      if (explicitRole !== cachedAcademyRole) localStorage.setItem('olli_current_member_role', cachedAcademyRole);
      return cachedAcademyRole;
    }
    if (explicitRole) return explicitRole;
  }

  if (localStorage.getItem('olli_owner_logged_in') === 'true') return 'owner';
  if (cachedAcademyRole) return cachedAcademyRole;
  if (explicitRole) return explicitRole;
  return 'teacher';
}

function getOlliRoleLabel(role) {
  if (role === 'super_admin') return '서버 관리자';
  if (role === 'owner') return '원장';
  if (role === 'manager') return '관리자';
  if (role === 'teacher') return '선생님';
  return '선생님';
}

function isOlliOwner() {
  return getOlliCurrentRole() === 'owner';
}

function isOlliManager() {
  return getOlliCurrentRole() === 'manager';
}

function canEditDirectorNote() {
  const role = getOlliCurrentRole();
  return role === 'owner' || role === 'manager';
}

function canUseOlliDevTestTools() {
  const role = getOlliCurrentRole();
  const currentAcademyName = String(localStorage.getItem('olli_current_academy_name') || olliSettingsState.academy?.academy_name || '').trim();
  const currentAcademyCode = String(localStorage.getItem('olli_current_academy_code') || olliSettingsState.academy?.academy_code || localStorage.getItem('olli_current_academy_id') || '').trim().toUpperCase();
  return role === 'owner' && (currentAcademyName === '비비작아이성향미술학원' || currentAcademyCode === 'VIVI-5578');
}

function normalizeOlliAcademyNameForBetaFeature(name) {
  return String(name || '').replace(/\s+/g, '').trim();
}

function canShowRecordAttendanceBetaTab() {
  const settingsAcademy = (typeof olliSettingsState !== 'undefined' && olliSettingsState && olliSettingsState.academy) ? olliSettingsState.academy : null;
  const currentAcademyName = normalizeOlliAcademyNameForBetaFeature(
    (typeof getOlliCurrentAcademyName === 'function' ? getOlliCurrentAcademyName() : '') ||
    localStorage.getItem('olli_current_academy_name') ||
    (settingsAcademy ? settingsAcademy.academy_name : '')
  );
  const currentAcademyCode = String(
    localStorage.getItem('olli_current_academy_code') ||
    (settingsAcademy ? settingsAcademy.academy_code : '') ||
    localStorage.getItem('olli_current_academy_id') ||
    ''
  ).trim().toUpperCase();
  return currentAcademyName === '비비작아이성향미술학원' || currentAcademyCode === 'VIVI-5578';
}

function getOlliCurrentAccountLoginText() {
  const values = [];
  try { if (typeof OLLI_ACCOUNT_LOGIN_ID_KEY !== 'undefined') values.push(localStorage.getItem(OLLI_ACCOUNT_LOGIN_ID_KEY)); } catch (_) {}
  values.push(
    localStorage.getItem('olli_account_login_id_v1'),
    localStorage.getItem('olli_account_name_v1'),
    localStorage.getItem('olli_account_id_v1')
  );
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function canUseOlliPlatformAdmin() {
  // 올리 관리는 임시로 VIVI-5578 관리용 계정에서만 사용합니다.
  // 실제 로그인 ID는 세션 복구 과정에서 로컬스토리지에 남지 않는 경우가 있어,
  // 1차 조건은 "현재 접속 학원이 VIVI-5578인지"와 "현재 계정이 관리 권한인지"로 판단합니다.
  const settingsAcademy = (typeof olliSettingsState !== 'undefined' && olliSettingsState && olliSettingsState.academy) ? olliSettingsState.academy : null;
  const context = (() => {
    try { return window.OlliStorageCore?.AcademyContext?.getCurrent?.() || null; } catch (_) { return null; }
  })();

  const currentAcademyId = String(
    localStorage.getItem('olli_current_academy_id') ||
    context?.academyId ||
    (settingsAcademy ? settingsAcademy.id : '') ||
    ''
  ).trim();

  let currentAcademyCode = String(
    localStorage.getItem('olli_current_academy_code') ||
    context?.academyCode ||
    (settingsAcademy ? settingsAcademy.academy_code : '') ||
    ''
  ).trim().toUpperCase();

  let currentAcademyName = normalizeOlliAcademyNameForBetaFeature(
    (typeof getOlliCurrentAcademyName === 'function' ? getOlliCurrentAcademyName() : '') ||
    localStorage.getItem('olli_current_academy_name') ||
    context?.academyName ||
    (settingsAcademy ? settingsAcademy.academy_name : '') ||
    ''
  );

  let matchedAcademyRole = '';
  try {
    const list = JSON.parse(localStorage.getItem('olli_account_academies_v1') || '[]');
    const academies = Array.isArray(list) ? list : [];
    const matched = academies.find(item => {
      const id = String(item?.academy_id || item?.academyId || item?.id || '').trim();
      const code = String(item?.academy_code || item?.academyCode || '').trim().toUpperCase();
      const name = normalizeOlliAcademyNameForBetaFeature(item?.academy_name || item?.academyName || '');
      return (currentAcademyId && id && id === currentAcademyId)
        || (currentAcademyCode && code && code === currentAcademyCode)
        || (currentAcademyName && name && name === currentAcademyName);
    }) || academies.find(item => String(item?.academy_code || item?.academyCode || '').trim().toUpperCase() === 'VIVI-5578');

    if (matched) {
      currentAcademyCode = currentAcademyCode || String(matched.academy_code || matched.academyCode || '').trim().toUpperCase();
      currentAcademyName = currentAcademyName || normalizeOlliAcademyNameForBetaFeature(matched.academy_name || matched.academyName || '');
      matchedAcademyRole = normalizeOlliMemberRoleValue(
        matched.role || matched.member_role || matched.membership_role || matched.role_name || matched.account_role
      );
    }
  } catch (_) {}

  let role = (typeof getOlliCurrentRole === 'function') ? getOlliCurrentRole() : '';
  if (matchedAcademyRole) role = matchedAcademyRole;
  const isManagementRole = role === 'owner' || role === 'manager' || role === 'super_admin';
  const isVivizacAcademy = currentAcademyCode === 'VIVI-5578' || currentAcademyName === '비비작아이성향미술학원';

  const identityValues = [];
  try { if (typeof OLLI_ACCOUNT_LOGIN_ID_KEY !== 'undefined') identityValues.push(localStorage.getItem(OLLI_ACCOUNT_LOGIN_ID_KEY)); } catch (_) {}
  identityValues.push(
    localStorage.getItem('olli_account_login_id_v1'),
    localStorage.getItem('olli_account_name_v1'),
    localStorage.getItem('olli_account_id_v1'),
    localStorage.getItem('olli_current_member_name')
  );
  const accountIdentity = identityValues
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
  const isVivizacAccount = accountIdentity.includes('vivizac') || accountIdentity.includes('비비작');

  // 실제 테스트에서 계정 세션 복구 후 role/login_id가 비어 있거나 teacher로 남는 경우가 있었습니다.
  // 그래서 올리 관리는 우선 현재 접속 학원이 VIVI-5578인지로 확실히 노출하고,
  // 나중에 관리앱을 분리할 때 계정 단위 관리자 권한으로 다시 제한합니다.
  if (isVivizacAcademy) return true;
  return isVivizacAcademy && isManagementRole && (isVivizacAccount || role === 'super_admin');
}

function applySettingsPermissionUI() {
  const role = getOlliCurrentRole();
  const currentAcademyName = String(localStorage.getItem('olli_current_academy_name') || olliSettingsState.academy?.academy_name || '').trim();
  const currentAcademyCode = String(localStorage.getItem('olli_current_academy_code') || olliSettingsState.academy?.academy_code || localStorage.getItem('olli_current_academy_id') || '').trim().toUpperCase();

  // 설정 페이지는 원장 외에는 알림 설정만 가능.
  const restricted = role !== 'owner';

  document.querySelectorAll('[data-owner-only="true"]').forEach(el => {
    if (el && el.id === 'settingsAcademySwitchRow') {
      el.style.display = restricted ? 'none' : 'flex';
    } else {
      el.style.display = restricted ? 'none' : '';
    }
  });

  document.querySelectorAll('[data-teacher-only="true"]').forEach(el => {
    el.style.display = (role === 'teacher' || role === 'manager') ? '' : 'none';
  });

  document.querySelectorAll('[data-owner-manager-only="true"]').forEach(el => {
    el.style.display = (role === 'owner' || role === 'manager' || role === 'super_admin') ? '' : 'none';
  });

  const canViewDevTestEntry = canUseOlliDevTestTools();
  document.querySelectorAll('.settingsDevSection').forEach(el => {
    el.style.display = canViewDevTestEntry ? '' : 'none';
  });

  const canViewPlatformAdmin = canUseOlliPlatformAdmin();
  document.querySelectorAll('[data-platform-admin-only="true"]').forEach(el => {
    el.style.display = canViewPlatformAdmin ? '' : 'none';
  });

  const canViewAcademyManagement = role === 'owner' || role === 'manager' || role === 'super_admin';
  document.querySelectorAll('[data-academy-management="true"]').forEach(el => {
    el.style.display = canViewAcademyManagement ? '' : 'none';
  });

  document.querySelectorAll('[data-role-value]').forEach(el => {
    el.textContent = getOlliRoleLabel(role);
  });
}


function refreshOlliRoleBasedVisibilityUI() {
  const role = (typeof getOlliCurrentRole === 'function')
    ? getOlliCurrentRole()
    : String(localStorage.getItem('olli_current_member_role') || '').trim();
  const canUseAcademyManagement = role === 'owner' || role === 'manager' || role === 'super_admin';

  document.querySelectorAll('[data-academy-management="true"]').forEach(el => {
    el.style.display = canUseAcademyManagement ? '' : 'none';
  });

  const ownerOnlyVisible = role === 'owner' || role === 'super_admin';
  document.querySelectorAll('[data-owner-only="true"]').forEach(el => {
    if (el && el.id === 'settingsAcademySwitchRow') {
      el.style.display = ownerOnlyVisible ? 'flex' : 'none';
    } else {
      el.style.display = ownerOnlyVisible ? '' : 'none';
    }
  });

  document.querySelectorAll('[data-teacher-only="true"]').forEach(el => {
    el.style.display = (role === 'teacher' || role === 'manager') ? '' : 'none';
  });

  document.querySelectorAll('[data-owner-manager-only="true"]').forEach(el => {
    el.style.display = canUseAcademyManagement ? '' : 'none';
  });

  const canViewPlatformAdmin = (typeof canUseOlliPlatformAdmin === 'function') ? canUseOlliPlatformAdmin() : false;
  document.querySelectorAll('[data-platform-admin-only="true"]').forEach(el => {
    el.style.display = canViewPlatformAdmin ? '' : 'none';
  });

  document.querySelectorAll('[data-role-value]').forEach(el => {
    if (typeof getOlliRoleLabel === 'function') el.textContent = getOlliRoleLabel(role);
  });
}

function settingsGetAcademyId() {
  return olliSettingsState.academy?.id || localStorage.getItem('olli_current_academy_id') || '';
}
function settingsSetCachedAcademy(academy) {
  if (!academy) return;
  localStorage.setItem('olli_current_academy_id', academy.id);
  localStorage.setItem('olli_current_academy_code', academy.academy_code || '');
  localStorage.setItem('olli_current_academy_name', academy.academy_name || '');
}
function settingsGetCachedState() {
  try {
    return JSON.parse(localStorage.getItem(getOlliSettingsLocalKey()) || '{}');
  } catch {
    return {};
  }
}
function settingsSaveCachePatch(patch) {
  const old = settingsGetCachedState();
  const next = { ...old, ...(patch || {}) };

  // 프로필 사진 원본 dataURL은 localStorage 용량 초과의 주원인입니다.
  // 미리보기는 메모리 변수로만 쓰고, 저장값에는 Supabase public URL만 남깁니다.
  if (typeof next.profileImageDataUrl === 'string' && next.profileImageDataUrl.startsWith('data:')) {
    delete next.profileImageDataUrl;
  }

  try {
    localStorage.setItem(getOlliSettingsLocalKey(), JSON.stringify(next));
  } catch (err) {
    // 기존 캐시에 큰 이미지 dataURL이 남아 있으면 제거 후 한 번 더 저장합니다.
    try {
      delete next.profileImageDataUrl;
      localStorage.setItem(getOlliSettingsLocalKey(), JSON.stringify(next));
    } catch (err2) {
      throw err2;
    }
  }
}

function isOlliAcademyRequestCurrent(academyId, academyCode) {
  const expectedId = String(academyId || '').trim();
  const expectedCode = String(academyCode || '').trim().toUpperCase();
  const currentId = String(localStorage.getItem('olli_current_academy_id') || '').trim();
  const currentCode = String(localStorage.getItem('olli_current_academy_code') || '').trim().toUpperCase();
  if (expectedId && currentId) return expectedId === currentId;
  if (expectedCode && currentCode) return expectedCode === currentCode;
  return !expectedId && !expectedCode;
}

function getSettingsMemberSource(member) {
  return String((member && (member._olli_member_source || member.source_type || member.member_source)) || '').trim();
}

function isSettingsAccountMembershipMember(member) {
  return getSettingsMemberSource(member) === 'account_membership'
    || String((member && (member.account_id || member.account_name || member.login_id || member.account_login_id)) || '').trim() !== '';
}

function getSettingsMemberTextValue(member, keys) {
  if (!member || typeof member !== 'object') return '';
  for (const key of keys || []) {
    const value = member[key];
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function normalizeSettingsAccountMembership(member) {
  const memberId = getSettingsMemberTextValue(member, [
    'member_id',
    'memberId',
    'membership_id',
    'membershipId',
    'account_membership_id',
    'accountMembershipId',
    'academy_member_id',
    'academyMemberId',
    'id'
  ]);
  const name = getSettingsMemberTextValue(member, [
    'member_name',
    'memberName',
    'display_name',
    'displayName',
    'teacher_name',
    'teacherName',
    'account_name',
    'accountName',
    'requester_name',
    'name',
    'login_id',
    'account_login_id',
    'username'
  ]);
  const roleValue = getSettingsMemberTextValue(member, [
    'role',
    'member_role',
    'membership_role',
    'role_name',
    'account_role',
    'permission_role',
    'requested_role'
  ]);
  const statusValue = getSettingsMemberTextValue(member, [
    'status',
    'member_status',
    'membership_status',
    'memberStatus',
    'membershipStatus',
    'access_status'
  ]) || 'active';

  return {
    ...(member || {}),
    id: memberId,
    member_id: memberId,
    display_name: name || '선생님',
    member_name: name || '선생님',
    role: normalizeOlliMemberRoleValue(roleValue, 'teacher') || 'teacher',
    status: statusValue,
    device_status: getSettingsMemberTextValue(member, ['device_status', 'deviceStatus']) || 'account_connected',
    _olli_member_source: 'account_membership'
  };
}

function getSettingsTeacherMemberMergeKey(member) {
  const id = getSettingsMemberId(member);
  if (id) return 'id:' + id;
  const name = String(member?.display_name || member?.member_name || member?.teacher_name || member?.account_name || member?.name || '').trim();
  const role = getSettingsMemberRole(member);
  return name ? 'name:' + role + ':' + name : 'row:' + JSON.stringify(member || {});
}

function mergeSettingsTeacherManagementRows(legacyRows, accountRows) {
  const map = new Map();

  (Array.isArray(legacyRows) ? legacyRows : []).forEach(row => {
    if (!row) return;
    const normalized = { ...row, _olli_member_source: row._olli_member_source || 'legacy_member' };
    map.set(getSettingsTeacherMemberMergeKey(normalized), normalized);
  });

  (Array.isArray(accountRows) ? accountRows : []).forEach(row => {
    if (!row) return;
    const normalized = normalizeSettingsAccountMembership(row);
    const key = getSettingsTeacherMemberMergeKey(normalized);
    const previous = map.get(key);
    map.set(key, previous ? { ...previous, ...normalized, _olli_member_source: 'account_membership' } : normalized);
  });

  return Array.from(map.values()).filter(row => {
    const role = getSettingsMemberRole(row);
    const status = String((row && (row.status || row.membership_status || row.member_status || 'active')) || 'active').trim().toLowerCase();
    return role && !['deleted', 'removed', 'rejected', 'pending', 'waiting', 'approval_pending', '승인대기', '승인 대기', '거절됨'].includes(status);
  });
}

async function settingsLoadTeacherManagementMembers() {
  const errors = [];
  const results = await Promise.allSettled([
    settingsLoadMembers(),
    (typeof loadOlliAcademyAccountMemberships === 'function' ? loadOlliAcademyAccountMemberships() : Promise.resolve([]))
  ]);

  if (results[0].status === 'rejected') {
    errors.push(results[0].reason?.message || String(results[0].reason || '선생님 목록을 불러오지 못했습니다.'));
  }
  if (results[1].status === 'rejected') {
    errors.push(results[1].reason?.message || String(results[1].reason || '계정 연결 목록을 불러오지 못했습니다.'));
  }

  const legacyRows = results[0].status === 'fulfilled'
    ? (Array.isArray(results[0].value) ? results[0].value : (olliSettingsState.members || []))
    : (olliSettingsState.members || []);
  const accountRows = results[1].status === 'fulfilled'
    ? (Array.isArray(results[1].value) ? results[1].value : (olliSettingsState.academyAccountMemberships || []))
    : (olliSettingsState.academyAccountMemberships || []);

  olliSettingsState.members = mergeSettingsTeacherManagementRows(legacyRows, accountRows);
  if (olliSettingsState.members.length) {
    olliSettingsState.lastError = '';
  } else if (errors.length) {
    olliSettingsState.lastError = errors.join(' / ');
  }

  if (typeof window.cacheTeacherOptions === 'function') window.cacheTeacherOptions();
  if (typeof window.refreshAllTeacherDropdowns === 'function') window.refreshAllTeacherDropdowns();
  return olliSettingsState.members;
}


function getOlliAcademiesForSettings() {
  const state = typeof window.getOlliMultiAcademyState === 'function'
    ? window.getOlliMultiAcademyState()
    : null;
  const list = state && Array.isArray(state.academies) ? state.academies : [];
  const academies = list.map(item => ({
    academyId: String(item?.academyId || item?.academy_id || item?.id || '').trim(),
    academyCode: String(item?.academyCode || item?.academy_code || '').trim(),
    academyName: String(item?.academyName || item?.academy_name || item?.name || '').trim(),
    memberId: String(item?.memberId || item?.member_id || '').trim(),
    memberName: String(item?.memberName || item?.member_name || '').trim(),
    role: String(item?.role || 'teacher').trim()
  })).filter(item => item.academyId);

  if (!academies.length) {
    const currentAcademyId = String(localStorage.getItem('olli_current_academy_id') || '').trim();
    if (currentAcademyId) {
      academies.push({
        academyId: currentAcademyId,
        academyCode: String(localStorage.getItem('olli_current_academy_code') || '').trim(),
        academyName: String(localStorage.getItem('olli_current_academy_name') || olliSettingsState.academy?.academy_name || '현재 학원').trim(),
        memberId: String(localStorage.getItem('olli_current_member_id') || '').trim(),
        memberName: String(localStorage.getItem('olli_current_member_name') || '').trim(),
        role: typeof getOlliCurrentRole === 'function' ? getOlliCurrentRole() : 'teacher'
      });
    }
  }

  return academies;
}

function updateOlliAcademySwitchUI() {
  const row = document.getElementById('settingsAcademySwitchRow');
  const value = document.getElementById('settingsAcademySwitchValue');
  const academies = getOlliAcademiesForSettings();
  const currentRole = typeof getOlliCurrentRole === 'function'
    ? getOlliCurrentRole()
    : String(localStorage.getItem('olli_current_member_role') || '').trim();
  const canShow = currentRole === 'owner' || currentRole === 'super_admin';
  if (row) row.style.display = canShow ? 'flex' : 'none';
  if (value) {
    const currentId = String(localStorage.getItem('olli_current_academy_id') || '').trim();
    const current = academies.find(item => item.academyId === currentId);
    value.textContent = current?.academyName || (academies.length ? `${academies.length}개 학원` : '');
  }
}

function getOlliAcademyRoleLabel(role) {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'owner') return '원장';
  if (value === 'manager') return '관리자';
  return '선생님';
}

function renderOlliAcademyAccountMemberships() {
  const currentRole = typeof getOlliCurrentRole === 'function' ? getOlliCurrentRole() : '';
  if (currentRole !== 'owner' && currentRole !== 'super_admin') return '';

  const rows = Array.isArray(olliSettingsState.academyAccountMemberships)
    ? olliSettingsState.academyAccountMemberships
    : [];
  const sessionActive = !!getOlliTeacherAdminSessionToken();
  const cards = rows.map(member => {
    const memberId = String(member?.member_id || '').trim();
    const role = String(member?.role || 'teacher').trim();
    const current = member?.is_current_account === true;
    const primary = member?.is_primary_owner === true;
    const name = String(member?.account_name || member?.display_name || '연결 계정').trim();
    const badges = [getOlliAcademyRoleLabel(role), primary ? '대표 원장' : '', current ? '현재 계정' : ''].filter(Boolean).join(' · ');
    const transferAction = (!current && role !== 'owner')
      ? '<button class="settingsActionBtn primary" type="button" onclick="transferOlliAcademyOwner(\'' + settingsEscapeAttr(memberId) + '\',\'' + settingsEscapeAttr(name) + '\')">원장권한 넘기기</button>'
      : '';
    const actions = current ? '' : '<div class="settingsActionGrid">'
      + transferAction
      + '<button class="settingsActionBtn" type="button" onclick="openOlliAcademyMembershipRoleSheet(\'' + settingsEscapeAttr(memberId) + '\',\'' + settingsEscapeAttr(role) + '\')">권한 변경</button>'
      + '<button class="settingsActionBtn red" type="button" onclick="removeOlliAcademyAccountMembership(\'' + settingsEscapeAttr(memberId) + '\')">연결 해제</button>'
      + '</div>';
    return '<div class="settingsTeacherCard">'
      + '<div class="settingsTeacherTop"><div class="settingsTeacherName">' + settingsEscapeHtml(name) + '</div><span class="settingsStatusBadge">' + settingsEscapeHtml(getOlliAcademyRoleLabel(role)) + '</span></div>'
      + '<div class="settingsTeacherMeta"><div>' + settingsEscapeHtml(badges) + '</div><div>학원별 권한은 다른 학원에 영향을 주지 않습니다.</div></div>'
      + actions + '</div>';
  }).join('');

  const content = !sessionActive
    ? '<div class="settingsInfoItem">계정 권한을 불러오려면 원장 비밀번호 재확인이 필요합니다.</div>'
    : (cards || '<div class="settingsInfoItem">연결된 계정 권한을 불러오지 못했습니다. 새로고침해 주세요.</div>');

  return '<div class="settingsInfoCard" style="margin-top:14px;">'
    + '<div class="settingsInfoHead">현재 학원의 계정 권한</div>'
    + '<div class="settingsMiniText">원장·관리자·선생님 권한은 현재 학원에만 적용됩니다.</div>'
    + content + '</div>';
}

function renderOlliAcademySwitchOptions() {
  const academies = getOlliAcademiesForSettings();
  const currentId = String(localStorage.getItem('olli_current_academy_id') || '').trim();
  const cards = academies.map(item => {
    const current = item.academyId === currentId;
    const roleLabel = typeof getOlliRoleLabel === 'function' ? getOlliRoleLabel(item.role) : item.role;
    const name = item.academyName || item.academyCode || '학원';
    const accessState = getOlliCurrentAcademyAccessState(item);
    const accessLabel = getOlliAcademyAccessLabel(accessState);
    const meta = [item.academyCode ? `학원 ID ${item.academyCode}` : '', roleLabel, accessLabel].filter(Boolean).join(' · ');
    return '<div class="olliAcademyOption ' + (current ? 'current' : '') + '">'
      + '<div class="olliAcademyOptionMain"><div class="olliAcademyOptionName">' + settingsEscapeHtml(name) + '</div>'
      + '<div class="olliAcademyOptionMeta">' + settingsEscapeHtml(meta) + '</div></div>'
      + '<button class="olliAcademyOptionAction" type="button" '
      + (current ? 'disabled>현재 학원' : 'onclick="switchOlliAcademy(\'' + settingsEscapeAttr(item.academyId) + '\')">전환')
      + '</button></div>';
  }).join('');

  const listHtml = cards
    ? '<div class="olliAcademyOptionList">' + cards + '</div>'
    : '<div class="settingsInfoCard"><div class="settingsInfoHead">연결된 학원이 없습니다.</div><div class="settingsInfoItem">다른 학원 찾기에서 기존 학원을 연결하거나 새 학원을 만들어 주세요.</div></div>';

  return '<div class="olliAcademySwitchIntro">현재 계정에 연결된 학원을 선택해 로그아웃 없이 전환할 수 있습니다.</div>'
    + listHtml
    + '<button class="olliAcademyRefreshBtn" type="button" onclick="refreshOlliAcademySwitchList()">학원 목록·권한 새로고침</button>';
}

function renderOlliOwnerOtherAcademyFindOptions() {
  const state = typeof window.getOlliMultiAcademyState === 'function'
    ? window.getOlliMultiAcademyState()
    : null;
  const hasAccountSession = !!state?.sessionActive || !!getOlliTeacherAdminSessionToken();
  const currentRole = typeof getOlliCurrentRole === 'function'
    ? getOlliCurrentRole()
    : String(localStorage.getItem('olli_current_member_role') || '').trim();
  const canCreateAcademy = currentRole === 'owner' || currentRole === 'super_admin';
  const hasAccountSessionForCreate = !!getOlliTeacherAdminSessionToken();
  const canReauthForCreate = !!String(localStorage.getItem('olli_current_academy_code') || '').trim();

  const createHtml = canCreateAcademy
    ? '<div class="settingsInfoCard" style="margin-top:14px;">'
      + '<div class="settingsInfoHead">다른 학원 생성하기</div>'
      + (hasAccountSessionForCreate
        ? '<div class="settingsInfoItem">현재 원장 계정에 새 학원을 만들고 자동으로 원장 권한을 연결합니다.</div>'
        : (canReauthForCreate
          ? '<div class="settingsInfoItem">계정 세션이 만료된 경우 다시 로그인한 뒤 새 학원을 만들 수 있습니다.</div>'
          : '<div class="settingsInfoItem">현재 학원 ID를 확인하지 못해 새 학원을 추가할 수 없습니다. 다시 로그인해 주세요.</div>'))
      + '<button class="settingsExportBtn" type="button" onclick="openOlliNewAcademySheet()">다른 학원 생성하기</button>'
      + '</div>'
    : '';

  const connectHtml = hasAccountSession
    ? '<div class="settingsInfoCard" style="margin-top:14px;">'
      + '<div class="settingsInfoHead">기존 학원 연결</div>'
      + '<div class="settingsInfoItem">이미 만들어져 있는 학원 ID로 학원을 찾고, 원장 연결을 요청합니다.</div>'
      + '<button class="settingsExportBtn" type="button" onclick="openOlliConnectAcademySheet()">기존 학원 연결</button>'
      + '</div>'
    : '<div class="settingsInfoCard" style="margin-top:14px;"><div class="settingsInfoHead">계정 로그인이 필요합니다.</div><div class="settingsInfoItem">다른 학원 찾기는 개인계정 로그인 후 사용할 수 있습니다.</div></div>';

  return '<div class="settingsDetailIntro"><div class="settingsDetailTitle">다른 학원을<br>찾거나 새로 만들 수 있습니다.</div></div>'
    + createHtml
    + connectHtml;
}

function openOlliNewAcademySheet() {
  const state = typeof window.getOlliMultiAcademyState === 'function'
    ? window.getOlliMultiAcademyState()
    : null;
  const role = typeof getOlliCurrentRole === 'function'
    ? getOlliCurrentRole()
    : String(localStorage.getItem('olli_current_member_role') || '').trim();
  if (!getOlliTeacherAdminSessionToken()) {
    alert('새 학원 만들기는 개인계정 로그인 후 사용할 수 있습니다. 다시 계정으로 로그인해 주세요.');
    showOlliOwnerLogin();
    return;
  }
  if (role && role !== 'owner' && role !== 'super_admin' && role !== 'manager') {
    alert('새 학원은 원장 또는 관리자 계정에서만 만들 수 있습니다.');
    return;
  }
  if (typeof window.openSettingsSheet === 'function') window.openSettingsSheet('newAcademy');
  else if (typeof openSettingsSheet === 'function') openSettingsSheet('newAcademy');
  setTimeout(() => {
    const saveBtn = document.querySelector('#settingsSheetOverlay .settingsSheetBtn.primary');
    if (saveBtn) saveBtn.textContent = '학원 생성';
    const nameInput = document.getElementById('settingsNewAcademyNameInput');
    if (nameInput) nameInput.focus();
  }, 0);
}

async function createOlliAcademyFromSettings() {
  const name = String(document.getElementById('settingsNewAcademyNameInput')?.value || '').trim();
  const region = String(document.getElementById('settingsNewAcademyRegionInput')?.value || '').trim();

  if (name.length < 2) throw new Error('학원 이름을 2자 이상 입력해 주세요.');

  // 2차 계정 기반 생성: 설정 안의 새 학원도 처음 학원 생성과 같은 함수만 사용합니다.
  // 학원 row만 만들어진 상태를 성공으로 보지 않고, owner member id까지 확인된 뒤 성공 처리합니다.
  const academy = await createOlliAcademyForCurrentAccount(name, region);
  const ownerMemberId = getOlliOwnerMemberIdFromAcademy(academy);
  if (!ownerMemberId) {
    throw new Error('새 학원은 생성됐지만 owner member id를 확인하지 못해 성공 처리하지 않았습니다.');
  }

  await restoreOlliAccountSession({ silent: true });
  const cachedAcademies = readOlliCachedAccountAcademies();
  const exists = cachedAcademies.some(item => String(item.academy_id || '') === String(academy.academy_id || ''));
  if (!exists) applyOlliAccessibleAcademies([ ...cachedAcademies, academy ]);
  updateOlliAcademySwitchUI();

  const body = document.getElementById('settingsDetailBody');
  if (body) body.innerHTML = renderOlliAcademySwitchOptions();

  const academyName = String(academy.academy_name || name).trim();
  const academyCode = String(academy.academy_code || '').trim();
  const shouldSwitch = confirm(
    `${academyName} 학원이 생성되었습니다.` +
    (academyCode ? `\n학원 ID: ${academyCode}` : '') +
    `\n원장 멤버 ID: ${ownerMemberId}` +
    '\n\n새 학원으로 바로 전환할까요?'
  );

  if (shouldSwitch) {
    await switchOlliAcademy(String(academy.academy_id));
  }

  return { ok: true, academy };
}

window.openOlliNewAcademySheet = openOlliNewAcademySheet;
window.createOlliAcademyFromSettings = createOlliAcademyFromSettings;

function openOlliConnectAcademySheet() {
  if (!getOlliTeacherAdminSessionToken()) {
    ensureOlliTeacherAdminSessionToken(false).then(() => openSettingsSheet('connectAcademy')).catch(error => alert(error.message || error));
    return;
  }
  openSettingsSheet('connectAcademy');
  setTimeout(() => document.getElementById('settingsConnectAcademyCodeInput')?.focus(), 0);
}

function clearSettingsConnectAcademyLookupResult() {
  const box = document.getElementById('settingsConnectAcademyLookupResult');
  if (!box) return;
  box.style.display = 'none';
  box.innerHTML = '';
  box.removeAttribute('data-academy-id');
  box.removeAttribute('data-academy-code');
  box.removeAttribute('data-academy-name');
}

function renderSettingsConnectAcademyLookupResult(academy, options = {}) {
  const box = document.getElementById('settingsConnectAcademyLookupResult');
  if (!box) return;
  box.style.display = 'block';
  if (academy) {
    box.setAttribute('data-academy-id', academy.academy_id || '');
    box.setAttribute('data-academy-code', academy.academy_code || '');
    box.setAttribute('data-academy-name', academy.academy_name || '');
    box.innerHTML = '<div class="olliInfoHead">학원 선택 완료</div>'
      + '<div class="olliInfoItem">학원명: <strong>' + settingsEscapeHtml(academy.academy_name || '이름 없음') + '</strong></div>'
      + '<div class="olliInfoItem">학원 아이디: <strong>' + settingsEscapeHtml(academy.academy_code || '') + '</strong></div>'
      + '<div class="olliSuccessBox">이 학원으로 연결 요청을 보낼 수 있습니다.</div>';
    return;
  }
  box.removeAttribute('data-academy-id');
  box.removeAttribute('data-academy-code');
  box.removeAttribute('data-academy-name');
  box.innerHTML = '<div class="olliErrorBox">' + settingsEscapeHtml(options.message || '학원 확인에 실패했습니다.') + '</div>';
}

function selectSettingsConnectAcademyLookupResult(academyId, academyCode, academyName) {
  const academy = {
    academy_id: String(academyId || '').trim(),
    academy_code: String(academyCode || '').trim(),
    academy_name: String(academyName || '').trim()
  };
  const input = document.getElementById('settingsConnectAcademyCodeInput');
  if (input) input.value = academy.academy_code || academy.academy_name || '';
  renderSettingsConnectAcademyLookupResult(academy);
  localStorage.setItem('olli_pending_academy_code', academy.academy_code || '');
  return academy;
}
window.selectSettingsConnectAcademyLookupResult = selectSettingsConnectAcademyLookupResult;

function renderSettingsConnectAcademyLookupResults(list, query) {
  const box = document.getElementById('settingsConnectAcademyLookupResult');
  if (!box) return;
  const results = Array.isArray(list) ? list : [];
  if (results.length === 1) {
    renderSettingsConnectAcademyLookupResult(results[0]);
    return;
  }
  box.style.display = 'block';
  box.removeAttribute('data-academy-id');
  box.removeAttribute('data-academy-code');
  box.removeAttribute('data-academy-name');
  const items = results.map(academy => {
    const id = settingsEscapeAttr(academy.academy_id || '');
    const code = settingsEscapeAttr(academy.academy_code || '');
    const name = settingsEscapeAttr(academy.academy_name || '');
    return '<button class="olliLookupResultBtn" type="button" onclick="selectSettingsConnectAcademyLookupResult(\'' + id + '\',\'' + code + '\',\'' + name + '\')">'
      + '<span class="olliLookupResultName">' + settingsEscapeHtml(academy.academy_name || '이름 없음') + '</span>'
      + '<span class="olliLookupResultCode">학원 아이디 ' + settingsEscapeHtml(academy.academy_code || '') + '</span>'
      + '</button>';
  }).join('');
  box.innerHTML = '<div class="olliInfoHead">검색 결과를 선택해 주세요</div>'
    + '<div class="olliInfoItem">' + settingsEscapeHtml(query || '입력한 검색어') + '가 포함된 학원을 모두 표시했습니다. 학원 아이디를 확인하고 선택해 주세요.</div>'
    + '<div class="olliLookupResultList">' + items + '</div>';
}

async function lookupSettingsConnectAcademy(event) {
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
  const input = document.getElementById('settingsConnectAcademyCodeInput');
  const query = String(input?.value || '').trim();
  if (!query) { alert('학원 아이디 또는 학원명을 입력해 주세요.'); return null; }
  try {
    const academies = await findOlliAcademiesByQueryForAccountAccess(query);
    renderSettingsConnectAcademyLookupResults(academies, query);
    if (academies.length === 1) {
      localStorage.setItem('olli_pending_academy_code', academies[0].academy_code || query);
      return academies[0];
    }
    return null;
  } catch (error) {
    renderSettingsConnectAcademyLookupResult(null, { message: error?.message || error });
    return null;
  }
}
window.lookupSettingsConnectAcademy = lookupSettingsConnectAcademy;

async function requestOlliAcademyAccessFromSettings() {
  const academyQuery = String(document.getElementById('settingsConnectAcademyCodeInput')?.value || '').trim();
  const requestedRole = String(document.getElementById('settingsConnectAcademyRoleInput')?.value || 'manager').trim();
  if (!academyQuery) throw new Error('연결할 학원 아이디 또는 학원명을 입력해 주세요.');

  const lookupBox = document.getElementById('settingsConnectAcademyLookupResult');
  const selectedCode = String(lookupBox?.getAttribute('data-academy-code') || '').trim();
  const selectedId = String(lookupBox?.getAttribute('data-academy-id') || '').trim();
  let academy = null;
  if (selectedCode || selectedId) {
    academy = {
      academy_id: selectedId,
      academy_code: selectedCode,
      academy_name: lookupBox?.getAttribute('data-academy-name') || ''
    };
  } else {
    academy = await findOlliAcademyByCodeForAccountAccess(academyQuery);
    renderSettingsConnectAcademyLookupResult(academy);
  }

  if (!academy?.academy_code) throw new Error('선택한 학원의 학원 아이디를 확인하지 못했습니다. 검색 결과에서 학원을 다시 선택해 주세요.');
  if (requestedRole === 'owner' && !confirm('원장 권한을 요청하면 승인 후 해당 학원의 전체 설정과 권한을 관리할 수 있습니다. 계속할까요?')) {
    throw new Error('원장 권한 요청이 취소되었습니다.');
  }
  const sessionToken = await ensureOlliTeacherAdminSessionToken(false);
  const result = await callOlliRpc('olli_request_academy_access', {
    p_session_token: sessionToken,
    p_academy_code: academy.academy_code,
    p_requested_role: requestedRole
  });
  if (!result || result.ok !== true) throw new Error((result && result.message) || '학원 연결 요청을 저장하지 못했습니다.');
  alert((result.academy_name || academy.academy_name || academy.academy_code || academyQuery) + ' 학원에 ' + getOlliAcademyRoleLabel(result.requested_role) + ' 권한 연결을 요청했습니다.\n해당 학원의 원장이 승인하면 학원 목록에 추가됩니다.');
}

async function loadOlliAcademyAccessRequests() {
  const role = typeof getOlliCurrentRole === 'function' ? getOlliCurrentRole() : '';
  const academyId = settingsGetAcademyId();
  const sessionToken = getOlliTeacherAdminSessionToken();
  if (!['owner', 'manager', 'super_admin'].includes(role) || !academyId || !sessionToken) {
    olliSettingsState.academyAccessRequests = [];
    return [];
  }
  const result = await callOlliRpc('olli_list_academy_access_requests', {
    p_session_token: sessionToken,
    p_academy_id: academyId
  });
  if (!result || result.ok !== true) throw new Error((result && result.message) || '학원 연결 요청을 불러오지 못했습니다.');
  olliSettingsState.academyAccessRequests = Array.isArray(result.requests) ? result.requests : [];
  return olliSettingsState.academyAccessRequests;
}

async function loadOlliAcademyAccountMemberships() {
  const role = typeof getOlliCurrentRole === 'function' ? getOlliCurrentRole() : '';
  const academyId = settingsGetAcademyId();
  const sessionToken = getOlliTeacherAdminSessionToken();
  if ((role !== 'owner' && role !== 'super_admin') || !academyId || !sessionToken) {
    olliSettingsState.academyAccountMemberships = [];
    return [];
  }
  const result = await callOlliRpc('olli_list_academy_account_memberships', {
    p_session_token: sessionToken,
    p_academy_id: academyId
  });
  if (!result || result.ok !== true) throw new Error((result && result.message) || '학원 계정 권한을 불러오지 못했습니다.');
  olliSettingsState.academyAccountMemberships = Array.isArray(result.members) ? result.members : [];
  return olliSettingsState.academyAccountMemberships;
}

async function loadOlliAcademyManagementData() {
  const results = await Promise.allSettled([
    loadOlliAcademyAccountMemberships(),
    loadOlliAcademyAccessRequests()
  ]);
  const failed = results.find(item => item.status === 'rejected');
  if (failed) console.warn('학원 관리 부가 정보 불러오기 실패:', failed.reason);
}

async function settingsLoadAllApprovalRequests() {
  const results = await Promise.allSettled([
    settingsLoadApprovalRequests(),
    loadOlliAcademyAccessRequests()
  ]);
  const rejected = results.find(item => item.status === 'rejected');
  if (rejected) console.warn('승인 요청 일부 불러오기 실패:', rejected.reason);
  return {
    teacherRequests: olliSettingsState.approvalRequests || [],
    academyRequests: olliSettingsState.academyAccessRequests || []
  };
}

async function approveOlliAcademyAccessRequest(requestId, requestedRole) {
  const role = String(requestedRole || 'manager').trim();
  const label = getOlliAcademyRoleLabel(role);
  if (role === 'owner' && !confirm('이 계정에 원장 권한을 부여하면 학원 전체 설정과 권한을 관리할 수 있습니다. 원장으로 승인할까요?')) return;
  if (role !== 'owner' && !confirm(label + ' 권한으로 학원 연결을 승인할까요?')) return;
  try {
    const result = await callOlliTeacherAdminRpc('olli_approve_academy_access_request', {
      p_request_id: String(requestId || '').trim(),
      p_role: role
    });
    if (!result || result.ok !== true) throw new Error((result && result.message) || '학원 연결 승인에 실패했습니다.');
    await Promise.all([loadOlliAcademyAccessRequests(), loadOlliAcademyAccountMemberships(), settingsLoadMembers()]);
    const body = document.getElementById('settingsDetailBody');
    if (body) body.innerHTML = renderSettingsApprovalRequests();
  } catch (error) {
    alert('학원 연결 승인 실패\n' + (error.message || error));
  }
}

async function rejectOlliAcademyAccessRequest(requestId) {
  if (!confirm('이 학원 연결 요청을 거절할까요?')) return;
  try {
    const result = await callOlliTeacherAdminRpc('olli_reject_academy_access_request', {
      p_request_id: String(requestId || '').trim()
    });
    if (!result || result.ok !== true) throw new Error((result && result.message) || '학원 연결 요청 거절에 실패했습니다.');
    await loadOlliAcademyAccessRequests();
    const body = document.getElementById('settingsDetailBody');
    if (body) body.innerHTML = renderSettingsApprovalRequests();
  } catch (error) {
    alert('학원 연결 요청 거절 실패\n' + (error.message || error));
  }
}

function openOlliAcademyMembershipRoleSheet(memberId, currentRole) {
  olliAcademyMembershipRoleTargetId = String(memberId || '').trim();
  olliAcademyMembershipRoleSelectedRole = String(currentRole || 'teacher').trim();
  openSettingsSheet('academyMembershipRole');
  setTimeout(() => {
    const select = document.getElementById('settingsAcademyMembershipRoleInput');
    if (select) select.value = olliAcademyMembershipRoleSelectedRole;
  }, 0);
}

async function saveOlliAcademyMembershipRole() {
  const memberId = olliAcademyMembershipRoleTargetId;
  const role = String(document.getElementById('settingsAcademyMembershipRoleInput')?.value || 'teacher').trim();
  if (!memberId) throw new Error('변경할 계정 연결을 찾지 못했습니다.');
  if (role === 'owner' && !confirm('원장 권한을 부여하면 학원 전체 설정과 권한을 관리할 수 있습니다. 계속할까요?')) {
    throw new Error('원장 권한 변경이 취소되었습니다.');
  }
  const result = await callOlliTeacherAdminRpc('olli_set_account_membership_role', {
    p_member_id: memberId,
    p_role: role
  });
  if (!result || result.ok !== true) throw new Error((result && result.message) || '학원별 권한 변경에 실패했습니다.');
  await loadOlliAcademyAccountMemberships();
  const body = document.getElementById('settingsDetailBody');
  if (body) body.innerHTML = renderOlliAcademySwitchOptions();
}

async function transferOlliAcademyOwner(memberId, accountName) {
  const id = String(memberId || '').trim();
  const name = String(accountName || '선택한 계정').trim();
  const academyName = String(localStorage.getItem('olli_current_academy_name') || olliSettingsState.academy?.academy_name || '현재 학원').trim();
  if (!id) {
    alert('원장권한을 넘길 계정을 찾지 못했습니다.');
    return;
  }
  const message = academyName + '의 원장 권한을 ' + name + ' 계정으로 넘길까요?\n\n'
    + '진행하면 선택한 계정은 원장(owner)이 되고, 현재 계정은 관리자(manager)로 변경됩니다.\n'
    + '테스트 기간 동안 원장님 계정은 소유권을 갖고, vivi-5578은 관리 지원만 할 수 있는 구조가 됩니다.';
  if (!confirm(message)) return;

  try {
    const result = await callOlliTeacherAdminRpc('olli_transfer_academy_owner', {
      p_target_member_id: id,
      p_keep_current_as: 'manager'
    });
    if (!result || result.ok !== true) {
      throw new Error((result && result.message) || '원장권한 넘기기 결과를 확인하지 못했습니다.');
    }

    localStorage.setItem('olli_current_member_role', String(result.current_role || 'manager'));
    if (typeof restoreOlliAccountSession === 'function') {
      try { await restoreOlliAccountSession({ silent: true }); } catch (restoreError) { console.warn(restoreError); }
    }
    await Promise.allSettled([loadOlliAcademyAccountMemberships(), settingsLoadMembers()]);
    const body = document.getElementById('settingsDetailBody');
    if (body) body.innerHTML = renderOlliAcademySwitchOptions();
    if (typeof applySettingsPermissionUI === 'function') applySettingsPermissionUI();
    alert('원장권한 넘기기가 완료되었습니다.\n현재 계정은 관리자 권한으로 남아 테스트 기간 동안 설정을 도울 수 있습니다.');
  } catch (error) {
    alert('원장권한 넘기기 실패\nSupabase에 olli_transfer_academy_owner RPC가 필요합니다.\n' + (error.message || error));
  }
}

async function removeOlliAcademyAccountMembership(memberId) {
  const id = String(memberId || '').trim();
  if (!id || !confirm('이 계정의 현재 학원 연결을 해제할까요?\n다른 학원 연결과 데이터는 유지됩니다.')) return;
  try {
    const result = await callOlliTeacherAdminRpc('olli_remove_account_membership', { p_member_id: id });
    if (!result || result.ok !== true) throw new Error((result && result.message) || '학원 계정 연결 해제에 실패했습니다.');
    await Promise.all([loadOlliAcademyAccountMemberships(), settingsLoadMembers()]);
    const body = document.getElementById('settingsDetailBody');
    if (body) body.innerHTML = renderOlliAcademySwitchOptions();
  } catch (error) {
    alert('학원 계정 연결 해제 실패\n' + (error.message || error));
  }
}

window.openOlliConnectAcademySheet = openOlliConnectAcademySheet;
window.requestOlliAcademyAccessFromSettings = requestOlliAcademyAccessFromSettings;
window.approveOlliAcademyAccessRequest = approveOlliAcademyAccessRequest;
window.rejectOlliAcademyAccessRequest = rejectOlliAcademyAccessRequest;
window.openOlliAcademyMembershipRoleSheet = openOlliAcademyMembershipRoleSheet;
window.transferOlliAcademyOwner = transferOlliAcademyOwner;
window.removeOlliAcademyAccountMembership = removeOlliAcademyAccountMembership;

async function callOlliRpc(functionName, payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${getOlliAuthAccessToken ? (getOlliAuthAccessToken() || SUPABASE_KEY) : SUPABASE_KEY}`
    },
    body: JSON.stringify(payload || {})
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const message = data && typeof data === 'object'
      ? [data.message, data.details, data.hint, data.code].filter(Boolean).join('\n')
      : String(data || 'RPC 실패');
    throw new Error(message);
  }

  return data ?? [];
}

async function settingsLoadAcademy() {
  const savedId = localStorage.getItem('olli_current_academy_id') || '';
  const savedCode = localStorage.getItem('olli_current_academy_code') || '';
  const savedName = localStorage.getItem('olli_current_academy_name') || '';
  const requestAcademyId = savedId;
  const requestAcademyCode = savedCode;

  if (!isSupabaseConfigured()) {
    const cachedAcademy = {
      id: savedId,
      academy_code: savedCode,
      academy_name: savedName || '현재 학원'
    };
    olliSettingsState.academy = cachedAcademy;
    return cachedAcademy;
  }

  // 실제 학원 코드가 없을 때 TEST-0001로 자동 전환되면 다른 학원 데이터가 보일 수 있어 기본값을 쓰지 않는다.
  const code = savedCode || (olliSettingsState.academy && olliSettingsState.academy.academy_code) || '';

  if (code) {
    try {
      const rows = await supabase('GET', `academies?select=*&academy_code=eq.${encodeURIComponent(code)}&limit=1`);
      if (Array.isArray(rows) && rows.length) {
        if (!isOlliAcademyRequestCurrent(requestAcademyId, requestAcademyCode)) return null;
        olliSettingsState.academy = rows[0];
        settingsSetCachedAcademy(rows[0]);
        return rows[0];
      }
    } catch (err) {
      console.warn('academy direct load skipped:', err.message || err);
    }
  }

  const fallbackAcademy = {
    id: savedId,
    academy_code: code,
    academy_name: savedName || '현재 학원'
  };
  if (!isOlliAcademyRequestCurrent(requestAcademyId, requestAcademyCode)) return null;
  olliSettingsState.academy = fallbackAcademy;
  return fallbackAcademy;
}


async function settingsLoadMembers() {
  const academyId = settingsGetAcademyId();
  const code = localStorage.getItem('olli_current_academy_code') || (olliSettingsState.academy && olliSettingsState.academy.academy_code) || '';
  const requestAcademyId = academyId;
  const requestAcademyCode = code;
  const merged = [];
  const seen = new Set();

  function addRows(rows) {
    (Array.isArray(rows) ? rows : []).forEach(row => {
      if (!row) return;
      const key = String(row.id || row.member_id || row.teacher_name || row.display_name || JSON.stringify(row));
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(row);
    });
  }

  if (isSupabaseConfigured()) {
    if (academyId) {
      try {
        const rowsById = await supabase('GET', `academy_members?select=*&academy_id=eq.${encodeURIComponent(academyId)}&order=created_at.asc`);
        addRows(rowsById);
      } catch (err) {
        console.warn('academy_members academy_id query failed:', err);
      }
    }

    if (code) {
      try {
        const rowsByCode = await supabase('GET', `academy_members?select=*&academy_code=eq.${encodeURIComponent(code)}&order=created_at.asc`);
        addRows(rowsByCode);
      } catch (err) {
        console.warn('academy_members academy_code query failed:', err);
      }
    }
  }

  if (!merged.length && code) {
    try {
      const rows = await callOlliRpc('test_list_academy_members', { p_academy_code: code });
      addRows(rows);
    } catch (err) {
      console.warn('test members rpc failed:', err);
      if (!academyId && !code) olliSettingsState.lastError = '현재 학원 ID를 찾지 못했습니다.';
      else olliSettingsState.lastError = err.message || String(err);
    }
  }

  if (!isOlliAcademyRequestCurrent(requestAcademyId, requestAcademyCode)) return [];
  olliSettingsState.members = merged;
  if (merged.length) olliSettingsState.lastError = '';
  if (!academyId && !code) olliSettingsState.lastError = '현재 학원 ID를 찾지 못했습니다.';
  if (typeof window.cacheTeacherOptions === 'function') window.cacheTeacherOptions();
  if (typeof window.refreshAllTeacherDropdowns === 'function') window.refreshAllTeacherDropdowns();
  return olliSettingsState.members;
}

async function settingsLoadApprovalRequests() {
  const requestAcademyId = settingsGetAcademyId();
  const code =
    localStorage.getItem('olli_current_academy_code') ||
    olliSettingsState.academy?.academy_code ||
    OLLI_TEST_ACADEMY_CODE;
  const requestAcademyCode = code;

  olliSettingsState.lastApprovalQueryCode = code;

  if (!code) {
    olliSettingsState.approvalRequests = [];
    olliSettingsState.lastError = '현재 학원 ID를 찾지 못했습니다.';
    return [];
  }

  // 1순위: 테스트/개발용 RPC로 학원 ID 기준 pending 요청 조회
  // 이 함수는 Supabase SQL의 stage4 test rpc가 실행되어 있어야 작동합니다.
  try {
    const rows = await callOlliRpc('test_list_teacher_approval_requests', {
      p_academy_code: code
    });

    if (!isOlliAcademyRequestCurrent(requestAcademyId, requestAcademyCode)) return [];
    olliSettingsState.approvalRequests = Array.isArray(rows) ? rows : [];
    olliSettingsState.lastError = '';
    return olliSettingsState.approvalRequests;
  } catch (err) {
    if (!isOlliAcademyRequestCurrent(requestAcademyId, requestAcademyCode)) return [];
    console.warn('test approval rpc failed:', err);
    olliSettingsState.lastError =
      '승인 요청 조회 실패: test_list_teacher_approval_requests RPC가 없거나 실행되지 않았습니다. ' +
      (err.message || err);
  }

  // 2순위: 직접 테이블 조회
  // 로그인/RLS 연결 전에는 막힐 수 있음.
  try {
    const academyId = requestAcademyId;
    if (!academyId) return [];

    const rows = await supabase(
      'GET',
      `teacher_approval_requests?select=*&academy_id=eq.${encodeURIComponent(academyId)}&status=eq.pending&order=created_at.desc`
    );

    if (!isOlliAcademyRequestCurrent(requestAcademyId, requestAcademyCode)) return [];
    olliSettingsState.approvalRequests = Array.isArray(rows) ? rows : [];
    return olliSettingsState.approvalRequests;
  } catch (err) {
    if (!isOlliAcademyRequestCurrent(requestAcademyId, requestAcademyCode)) return [];
    console.warn('direct approval query failed:', err);
    olliSettingsState.approvalRequests = [];
    olliSettingsState.lastError =
      '승인 요청 직접 조회도 실패했습니다. 현재 학원 ID: ' + code + ' / ' + (err.message || err);
    return [];
  }
}


async function settingsRefreshAll() {
  const requestAcademyId = settingsGetAcademyId();
  const requestAcademyCode = localStorage.getItem('olli_current_academy_code') || '';
  const errors = [];

  try {
    await settingsLoadAcademy();
    await Promise.all([
      loadOlliSharedSettingsFromServer(),
      loadOlliConsultationRulesFromServer({ force: true })
    ]);
  } catch (err) {
    errors.push(err.message || String(err));
    console.warn('settings academy load failed:', err);
  }

  try {
    await settingsLoadMembers();
  } catch (err) {
    errors.push(err.message || String(err));
    console.warn('settings members load failed:', err);
  }

  try {
    await settingsLoadAllApprovalRequests();
  } catch (err) {
    errors.push(err.message || String(err));
    console.warn('settings approval load failed:', err);
  }

  if (!isOlliAcademyRequestCurrent(requestAcademyId, requestAcademyCode)) return;
  olliSettingsState.lastError = errors.length ? errors.join(' / ') : '';
  settingsApplyStateToUI();
}


function settingsApplyStateToUI() {
  const cached = settingsGetCachedState();
  const academyName =
    olliSettingsState.academy?.academy_name ||
    localStorage.getItem('olli_current_academy_name') ||
    cached.academyName ||
    '비비작아이성향미술학원';

  document.querySelectorAll('.settingsProfileName').forEach(el => {
    el.textContent = academyName;
  });

  const imageUrl = olliSettingsState.academy?.profile_image_url || cached.profileImageDataUrl || '';
  document.querySelectorAll('.settingsProfileImage').forEach(el => {
    if (imageUrl) {
      el.innerHTML = '<img src="' + settingsEscapeAttr(imageUrl) + '" alt="학원 프로필">';
    } else {
      el.textContent = 'V';
    }
  });

  document.querySelectorAll('.recordAcademyMiniIcon').forEach(el => {
    el.innerHTML = renderAcademyMiniIcon();
  });

  const toggle = document.getElementById('settingsNotificationToggle');
  if (toggle) {
    const enabled = cached.notificationEnabled !== undefined ? cached.notificationEnabled : true;
    toggle.classList.toggle('on', !!enabled);
  }

  document.querySelectorAll('.settingsApprovalBadge').forEach(badge => {
    const count = olliSettingsState.approvalRequests.length;
    badge.textContent = count + '건';
  });

  updateOlliStartPageSettingUI();
  updateOlliTextSizeSettingUI();
  updateOlliConsultationSettingUI();
  updateSettingsGroupFeedbackMonthsValue();
  updateOlliAcademyAccessSettingUI();
  applySettingsPermissionUI();
  updateOlliAcademySwitchUI();
}

function openSettingsPage() {
  const settings = document.getElementById('settingsPageScreen');
  const detail = document.getElementById('settingsDetailScreen');
  const record = document.getElementById('recordRoomScreen');

  if (!settings) return;

  if (detail) detail.style.display = 'none';

  // 기존 슬라이드 함수와 충돌하지 않도록 설정 페이지는 독립 오버레이처럼 연다.
  settings.style.display = 'flex';
  settings.style.position = 'fixed';
  settings.style.inset = '0';
  settings.style.transform = 'translateX(0)';
  settings.style.opacity = '1';
  settings.style.pointerEvents = 'auto';
  settings.style.zIndex = '90000';

  if (record) record.style.display = 'flex';

  settingsApplyStateToUI();
  setTimeout(() => {
    try { if (typeof applySettingsPermissionUI === 'function') applySettingsPermissionUI(); } catch (_) {}
  }, 80);
  setTimeout(() => {
    try { if (typeof applySettingsPermissionUI === 'function') applySettingsPermissionUI(); } catch (_) {}
  }, 600);
  settingsRefreshAll();
}

function closeSettingsPage() {
  const settings = document.getElementById('settingsPageScreen');
  const detail = document.getElementById('settingsDetailScreen');
  const record = document.getElementById('recordRoomScreen');

  if (detail) detail.style.display = 'none';

  if (settings) {
    settings.style.display = 'none';
    settings.style.transform = '';
    settings.style.opacity = '';
    settings.style.pointerEvents = '';
  }

  if (record) record.style.display = 'flex';
}
function toggleSettingsNotification() {
  const cached = settingsGetCachedState();
  const next = !(cached.notificationEnabled !== undefined ? cached.notificationEnabled : true);
  settingsSaveCachePatch({ notificationEnabled: next });
  settingsApplyStateToUI();

  if (next && 'Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        try { new Notification('올리', { body: '알림 설정이 완료되었습니다.' }); } catch (err) {}
      }
    }).catch(() => {});
  }
}

function openSettingsProfileImagePicker() {
  const input = document.getElementById('settingsProfileImageInput');
  if (input) input.click();
}

function handleSettingsProfileImageChange(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  // 원본 dataURL을 localStorage에 저장하면 iPhone Safari에서 QuotaExceededError가 날 수 있습니다.
  // 실제 저장은 아래 Supabase Storage 업로드 흐름에서 처리합니다.
  if (typeof window.handleSettingsProfileImageChange === 'function' && window.handleSettingsProfileImageChange !== handleSettingsProfileImageChange) {
    return window.handleSettingsProfileImageChange(event);
  }

  settingsSaveCachePatch({ profileImageDataUrl: '' });
  settingsApplyStateToUI();
  openSettingsSheet('profile');
}

let currentSettingsSheetType = null;
let olliAcademyMembershipRoleTargetId = '';
let olliAcademyMembershipRoleSelectedRole = 'teacher';

function canEditOlliConsultationSettings(){
  const role = typeof getOlliCurrentRole === 'function' ? getOlliCurrentRole() : '';
  return role === 'owner' || role === 'manager' || role === 'super_admin';
}

const OLLI_TEXT_SIZE_LOCAL_KEY = 'olli_text_size_v1';
function getOlliTextSizeSetting(){
  const value = String(localStorage.getItem(OLLI_TEXT_SIZE_LOCAL_KEY) || 'default').trim();
  if (value === 'large') return 'large';
  if (value === 'medium') return 'medium';
  return 'default';
}
function getOlliTextSizeLabel(value){
  if (value === 'large') return '크게';
  if (value === 'medium') return '중간';
  return '기본';
}
function getOlliTextSizeScale(value){
  if (value === 'large') return '1.30';
  if (value === 'medium') return '1.20';
  return '1.12';
}
function applyOlliTextSizeSetting(){
  const value = getOlliTextSizeSetting();
  const scale = getOlliTextSizeScale(value);
  if (document.documentElement) {
    document.documentElement.setAttribute('data-olli-text-size', value);
    document.documentElement.style.setProperty('--olli-text-scale', scale);
  }
  if (document.body) {
    document.body.setAttribute('data-olli-text-size', value);
    document.body.style.setProperty('--olli-text-scale', scale);
  }
  updateOlliTextSizeSettingUI();
}
function updateOlliTextSizeSettingUI(){
  const valueEl = document.getElementById('settingsTextSizeValue');
  if (valueEl) valueEl.textContent = getOlliTextSizeLabel(getOlliTextSizeSetting());
}
function selectSettingsTextSizeOption(value){
  const normalized = value === 'large' ? 'large' : (value === 'medium' ? 'medium' : 'default');
  document.querySelectorAll('[data-text-size-option]').forEach(btn => {
    const active = btn.getAttribute('data-text-size-option') === normalized;
    btn.classList.toggle('active', active);
    const check = btn.querySelector('.check');
    if (check) check.textContent = active ? '✓' : '';
  });
}
try { applyOlliTextSizeSetting(); } catch (error) { console.warn('텍스트 크기 설정 적용 실패:', error); }

const settingsSheetData = {
  profile: {
    title:'프로필 편집',
    desc:'학원 이름과 프로필 이미지를 설정합니다.',
    html:function(){
      const cached = settingsGetCachedState();
      const academy = olliSettingsState.academy || {};
      const academyName = academy.academy_name || cached.academyName || '비비작아이성향미술학원';
      const image = academy.profile_image_url || cached.profileImageDataUrl || '';
      const imageHtml = image ? '<img src="' + settingsEscapeAttr(image) + '" alt="학원 프로필">' : 'V';

      return '<div class="settingsProfileCard" style="box-shadow:none;background:#f7f7f5;margin-bottom:12px;">'
        + '<div class="settingsProfileImage editable" onclick="openSettingsProfileImagePicker()">' + imageHtml + '</div>'
        + '<div class="settingsProfileInfo"><div class="settingsProfileName">' + settingsEscapeHtml(academyName) + '</div><div class="settingsProfileEdit" onclick="openSettingsProfileImagePicker()">사진 변경</div></div></div>'
        + '<div class="settingsInputGroup"><div class="settingsInputLabel">학원 이름</div><input id="settingsAcademyNameInput" class="settingsInput" value="' + settingsEscapeAttr(academyName) + '"></div>'
        + '<div class="settingsMiniText">사진은 현재 이 기기 미리보기 저장 방식입니다. 실제 판매용에서는 Supabase Storage 연결이 필요합니다.</div>';
    },
    onSave: async function(){
      const input = document.getElementById('settingsAcademyNameInput');
      const newName = input && input.value.trim() ? input.value.trim() : '학원 이름';

      const academyId = settingsGetAcademyId();
      settingsSaveCachePatch({ academyName: newName });

      if (academyId && isSupabaseConfigured()) {
        try {
          const rows = await supabase('PATCH', `academies?id=eq.${encodeURIComponent(academyId)}`, { academy_name: newName });
          if (olliSettingsState.academy) olliSettingsState.academy.academy_name = newName;
          localStorage.setItem('olli_current_academy_name', newName);
        } catch (err) {
          alert('학원명 저장 중 오류가 발생했습니다.\n' + (err.message || err));
        }
      }

      settingsApplyStateToUI();
    }
  },
  ai: {
    title:'AI 사용 안내',
    desc:'AI가 생성한 문구는 자동 발송되지 않으며, 선생님 또는 원장이 검토한 뒤 사용합니다.',
    html:'<div class="settingsInfoItem">피드백 문구는 최종 검토 후 학부모에게 전달해야 합니다.</div>'
  },
  textSize: {
    title:'텍스트 크기',
    desc:'앱 안의 글자와 일부 버튼 크기를 조절합니다. OLLI 로고 크기는 그대로 유지됩니다.',
    html:function(){
      const current = getOlliTextSizeSetting();
      const option = function(value, label, guide){
        const active = current === value;
        return '<button type="button" class="settingsStartPageOption ' + (active ? 'active' : '') + '" data-text-size-option="' + value + '" onclick="selectSettingsTextSizeOption(&quot;' + value + '&quot;)"><span>' + label + '<span class="settingsTextSizeGuide">' + guide + '</span></span><span class="check">' + (active ? '✓' : '') + '</span></button>';
      };
      return '<div class="settingsInputGroup">'
        + option('default', '기본', '1.12배')
        + option('medium', '중간', '1.20배')
        + option('large', '크게', '1.30배')
        + '</div><div class="settingsMiniText">작은 글씨가 불편한 원장님은 중간 또는 크게를 선택하면 학생명, 입력창, 버튼 텍스트, 설정 메뉴가 함께 커집니다.</div>';
    },
    onSave: async function(){
      const selected = document.querySelector('[data-text-size-option].active')?.getAttribute('data-text-size-option') || 'default';
      localStorage.setItem(OLLI_TEXT_SIZE_LOCAL_KEY, selected === 'large' ? 'large' : (selected === 'medium' ? 'medium' : 'default'));
      applyOlliTextSizeSetting();
    }
  },
  startPage: {
    title:'시작 페이지',
    desc:'앱을 열었을 때 처음 보여줄 화면을 선택합니다. 계정 권한에 맞는 화면만 선택할 수 있습니다.',
    html:function(){
      const current = getOlliAllowedStartPage(getOlliDefaultStartPage() || 'elementary_attendance');
      const option = function(item){
        const value = item.value;
        const label = item.label;
        const active = normalizeOlliStartPage(value) === current;
        return '<button type="button" class="settingsStartPageOption ' + (active ? 'active' : '') + '" data-start-page-option="' + value + '" onclick="selectSettingsStartPageOption(\'' + value + '\')"><span>' + label + '</span><span class="check">' + (active ? '✓' : '') + '</span></button>';
      };
      const optionsHtml = getOlliStartPageOptionsForCurrentRole().map(option).join('');
      const guide = canAccessOlliStartPageAcademyManagement()
        ? '원장·관리자 계정은 관찰노트, 1분 피드백, 출석부, 학원관리를 시작 화면으로 선택할 수 있습니다.'
        : '선생님 계정은 관찰노트, 1분 피드백, 출석부를 시작 화면으로 선택할 수 있습니다.';
      return '<div class="settingsInputGroup">' + optionsHtml + '</div><div class="settingsMiniText">' + guide + '</div>';
    },
    onSave: async function(){
      const selected = document.querySelector('.settingsStartPageOption.active')?.getAttribute('data-start-page-option') || getOlliAllowedStartPage(getOlliDefaultStartPage() || 'elementary_attendance');
      await saveOlliDefaultStartPage(selected);
    }
  },
  consultationMonths: {
    title:'상담 기준',
    desc:'초등부와 유치부 상담 기준을 따로 선택합니다. 여러 개를 선택할 수 있습니다.',
    html:function(){
      const canEdit = canEditOlliConsultationSettings();
      const renderGroup = (type, title) => {
        const selected = new Set(getOlliConsultationRules(type));
        const buttons = getOlliConsultationRuleOptions().map(option => {
          return '<button type="button" class="settingsMonthOption ' + (selected.has(option.key) ? 'active' : '') + '" data-consultation-type="' + type + '" data-consultation-rule="' + option.key + '" ' + (canEdit ? 'onclick="toggleSettingsConsultationRuleOption(\'' + option.key + '\', \'' + type + '\')"' : 'disabled aria-disabled="true"') + '>' + option.label + '</button>';
        }).join('');
        return '<div class="settingsMiniText">' + title + '</div><div class="settingsMonthGrid">' + buttons + '</div>';
      };
      const guide = canEdit
        ? '초등부와 유치부의 상담 주기를 각각 저장합니다. 1개월 후, 3개월 후는 한 번만 표시되고 6개월마다, 12개월마다는 등록월 기준으로 반복 표시됩니다.'
        : '상담 기준은 원장 또는 관리자 계정에서만 변경할 수 있습니다. 현재 계정에서는 확인만 가능합니다.';
      return renderGroup('elementary', '초등부 상담 기준') + renderGroup('kinder', '유치부 상담 기준') + '<div class="settingsMiniText">' + guide + '</div>';
    },
    onSave: async function(){
      if (!canEditOlliConsultationSettings()) {
        alert('상담 기준은 원장 또는 관리자 계정에서만 변경할 수 있습니다.');
        return;
      }
      const collect = (type) => {
        const selected = Array.from(document.querySelectorAll(`[data-consultation-type="${type}"][data-consultation-rule].active`))
          .map(btn => btn.getAttribute('data-consultation-rule'))
          .filter(Boolean);
        return selected.length ? selected : getOlliDefaultConsultationRules(type);
      };
      await saveOlliConsultationRulesShared({ elementary: collect('elementary'), kinder: collect('kinder') });
      settingsApplyStateToUI();
      if (currentRecordView === 'academy' && typeof renderRecordAcademyManagementDashboard === 'function') renderRecordAcademyManagementDashboard();
    }
  },


  groupFeedbackMonths: {
    title:'그룹별 피드백 발송월',
    desc:'초등부 그룹별로 피드백을 발송할 월을 선택합니다. 모든 기기에서 같은 기준을 사용합니다.',
    html:function(){ return renderSettingsGroupFeedbackMonths(); },
    onSave: async function(){
      const map = readElementaryGroupFeedbackMonthsMap();
      await saveOlliSharedSettingToServer(OLLI_SHARED_SETTINGS_KEY_GROUP_MONTHS, map);
      updateSettingsGroupFeedbackMonthsValue();
      if (typeof window.refreshRecordSortPopup === 'function') window.refreshRecordSortPopup();
      if (currentRecordView === 'academy' && typeof renderRecordAcademyManagementDashboard === 'function') renderRecordAcademyManagementDashboard();
    }
  },
  newAcademy: {
    title:'새 학원 만들기',
    desc:'현재 원장 계정에 새 학원을 추가합니다. 생성된 학원은 다른 학원과 데이터가 완전히 분리됩니다.',
    html:function(){
      const accountName = String(localStorage.getItem('olli_account_name_v1') || '현재 원장 계정').trim();
      return '<div class="settingsInfoItem">연결 계정: ' + settingsEscapeHtml(accountName) + '</div>'
        + '<div class="settingsInputGroup" style="margin-top:12px;"><div class="settingsInputLabel">학원 이름</div><input id="settingsNewAcademyNameInput" class="settingsInput" maxlength="60" autocomplete="off" placeholder="예: 비비작 2호점"></div>'
        + '<div class="settingsInputGroup"><div class="settingsInputLabel">지역 또는 지점 설명</div><input id="settingsNewAcademyRegionInput" class="settingsInput" maxlength="80" autocomplete="off" placeholder="예: 대구 달서구 월성동"></div>'
        + '<div class="settingsMiniText">새 학원에는 현재 계정이 원장으로 자동 연결되고, 학생·설정·피드백 데이터는 기존 학원과 섞이지 않습니다.</div>';
    },
    onSave: async function(){
      await createOlliAcademyFromSettings();
    }
  },
  connectAcademy: {
    title:'기존 학원 연결 요청',
    desc:'학원 아이디 또는 학원명 일부로 검색한 뒤 연결을 요청합니다. 해당 학원의 원장이 승인해야 목록에 추가됩니다.',
    html:function(){
      return '<div class="settingsInputGroup"><div class="settingsInputLabel">연결할 학원 아이디 또는 학원명</div><input id="settingsConnectAcademyCodeInput" class="settingsInput" maxlength="60" autocomplete="off" placeholder="예: VIVI-5578 또는 비벼먹는" oninput="clearSettingsConnectAcademyLookupResult()"></div>'
        + '<button class="settingsSheetBtn" type="button" onclick="lookupSettingsConnectAcademy(event)" style="width:100%;margin:2px 0 12px;">학원 확인</button>'
        + '<div id="settingsConnectAcademyLookupResult" class="olliInfoBox" style="display:none;margin-bottom:12px;"></div>'
        + '<div class="settingsInputGroup"><div class="settingsInputLabel">요청 권한</div><select id="settingsConnectAcademyRoleInput" class="settingsInput"><option value="manager">관리자</option><option value="teacher">선생님</option><option value="owner">원장</option></select></div>'
        + '<div class="settingsMiniText">같은 검색어가 들어간 학원이 모두 표시됩니다. 학원 아이디를 확인하고 선택한 뒤 연결을 요청하세요.</div>';
    },
    onSave: async function(){
      await requestOlliAcademyAccessFromSettings();
    }
  },
  academyMembershipRole: {
    title:'학원별 권한 변경',
    desc:'선택한 계정의 현재 학원 권한만 변경합니다.',
    html:function(){
      return '<div class="settingsInputGroup"><div class="settingsInputLabel">변경할 권한</div><select id="settingsAcademyMembershipRoleInput" class="settingsInput"><option value="teacher">선생님</option><option value="manager">관리자</option><option value="owner">원장</option></select></div>'
        + '<div class="settingsMiniText">마지막 원장의 권한은 낮출 수 없습니다. 원장 권한을 추가할 때는 학원 전체 관리 권한이 부여됩니다.</div>';
    },
    onSave: async function(){
      await saveOlliAcademyMembershipRole();
    }
  },
  logout: {
    title:'계정 로그아웃',
    desc:'현재 기기에서 개인계정 세션을 해제합니다.',
    html:'<div class="settingsInfoItem">계정 로그아웃을 하면 이 기기의 자동 로그인이 해제됩니다. 학원 데이터와 선생님 승인은 삭제되지 않습니다.</div>'
  }
};


let currentSettingsGroupFeedbackGroup = '1';

function getSettingsGroupFeedbackGroups() {
  return [['1','A'], ['2','B'], ['3','C'], ['4','D'], ['5','E'], ['6','F']];
}

function renderSettingsGroupFeedbackMonths() {
  const groups = getSettingsGroupFeedbackGroups();
  if (!groups.some(([group]) => group === currentSettingsGroupFeedbackGroup)) currentSettingsGroupFeedbackGroup = '1';
  const currentGroup = currentSettingsGroupFeedbackGroup || '1';
  const currentLabel = (groups.find(([group]) => group === currentGroup) || ['1','A'])[1];
  const monthValues = (typeof ELEMENTARY_GROUP_MONTH_VALUES !== 'undefined') ? ELEMENTARY_GROUP_MONTH_VALUES : [1,2,3,4,5,6,7,8,9,10,11,12];
  const tabs = groups.map(([group,label]) => {
    return '<button type="button" class="settingsGroupFeedbackTab ' + (group === currentGroup ? 'active' : '') + '" data-settings-group-tab="' + group + '" onclick="selectSettingsGroupFeedbackGroup(\'' + group + '\')">' + label + '</button>';
  }).join('');
  const selected = new Set(getElementaryGroupFeedbackMonths(currentGroup));
  const months = monthValues.map(month => {
    return '<button type="button" class="settingsGroupFeedbackMonth ' + (selected.has(month) ? 'active' : '') + '" data-settings-group="' + currentGroup + '" data-settings-month="' + month + '" onclick="toggleSettingsGroupFeedbackMonth(\'' + currentGroup + '\',' + month + ')">' + month + '월</button>';
  }).join('');
  return '<div class="settingsGroupFeedbackBlock">'
    + '<div class="settingsGroupFeedbackTabs">' + tabs + '</div>'
    + '<div class="settingsGroupFeedbackHead"><div class="settingsGroupFeedbackTitle">' + currentLabel + '그룹 발송월</div></div>'
    + '<div class="settingsGroupFeedbackMonths">' + months + '</div>'
    + '</div>'
    + '<div class="settingsMiniText">A~F 그룹을 먼저 선택한 뒤, 아래에서 발송월을 선택합니다.</div>';
}

function refreshSettingsGroupFeedbackMonthsContent() {
  const content = document.getElementById('settingsSheetContent');
  if (content && currentSettingsSheetType === 'groupFeedbackMonths') content.innerHTML = renderSettingsGroupFeedbackMonths();
}

function selectSettingsGroupFeedbackGroup(group) {
  currentSettingsGroupFeedbackGroup = String(group || '1');
  refreshSettingsGroupFeedbackMonthsContent();
}

function toggleSettingsGroupFeedbackMonth(group, month) {
  toggleElementaryGroupFeedbackMonth(group, month);
  refreshSettingsGroupFeedbackMonthsContent();
  updateSettingsGroupFeedbackMonthsValue();
}

function updateSettingsGroupFeedbackMonthsValue() {
  const value = document.getElementById('settingsGroupFeedbackMonthsValue');
  if (!value) return;
  const map = readElementaryGroupFeedbackMonthsMap();
  const count = Object.values(map).filter(months => normalizeElementaryGroupMonths(months).length).length;
  value.textContent = count ? count + '개 그룹 설정' : '미설정';
}


function selectSettingsStartPageOption(page){
  const normalized = getOlliAllowedStartPage(page);
  document.querySelectorAll('.settingsStartPageOption').forEach(btn => {
    const active = normalizeOlliStartPage(btn.getAttribute('data-start-page-option')) === normalized;
    btn.classList.toggle('active', active);
    const check = btn.querySelector('.check');
    if (check) check.textContent = active ? '✓' : '';
  });
}

function openSettingsSheet(type) {
  const data = settingsSheetData[type] || settingsSheetData.ai;
  currentSettingsSheetType = type;
  const overlay = document.getElementById('settingsSheetOverlay');
  if (!overlay) return;

  document.getElementById('settingsSheetTitle').textContent = data.title;
  document.getElementById('settingsSheetDesc').textContent = data.desc;
  document.getElementById('settingsSheetContent').innerHTML = typeof data.html === 'function' ? data.html() : data.html;
  overlay.classList.add('show');
}

async function saveSettingsSheet() {
  const data = settingsSheetData[currentSettingsSheetType];
  if (data && typeof data.onSave === 'function') {
    await data.onSave();
  }
  closeSettingsSheet();
}

function closeSettingsSheet(event) {
  if (event && event.target && event.target.id !== 'settingsSheetOverlay') return;
  const overlay = document.getElementById('settingsSheetOverlay');
  if (overlay) overlay.classList.remove('show');
}

function renderSettingsErrorIfNeeded() {
  if (!olliSettingsState.lastError) return '';
  return '<div class="settingsErrorBox">' + settingsEscapeHtml(olliSettingsState.lastError) + '</div>';
}

const olliTeacherMutationIds = new Set();
let settingsRolePopupMemberId = '';
let settingsRolePopupSelectedRole = 'teacher';
let settingsCrossAcademyManagerMemberId = '';
let settingsCrossAcademyManagerSelectedIds = new Set();
let settingsCrossAcademyManagerLoading = false;

