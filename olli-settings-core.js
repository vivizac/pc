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

async function downloadSettingsBackup() {
  try {
    const academyId = settingsGetAcademyId();
    if (!academyId) throw new Error('academy_id가 없습니다.');

    const [students, feedbacks, summaries, members] = await Promise.all([
      supabase('GET', `students?select=*&academy_id=eq.${encodeURIComponent(academyId)}`),
      supabase('GET', `feedbacks?select=*&academy_id=eq.${encodeURIComponent(academyId)}`),
      supabase('GET', `summary_feedbacks?select=*&academy_id=eq.${encodeURIComponent(academyId)}`),
      supabase('GET', `academy_members?select=*&academy_id=eq.${encodeURIComponent(academyId)}`)
    ]);

    const backup = {
      exported_at: new Date().toISOString(),
      academy: olliSettingsState.academy,
      members,
      students,
      feedbacks,
      summary_feedbacks: summaries,
};

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0,10);
    a.href = url;
    a.download = 'olli-backup-' + date + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('백업 생성 실패\n' + (err.message || err));
  }
}


function olliStorageDiagnosticsEscape(value) {
  if (typeof settingsEscapeHtml === 'function') return settingsEscapeHtml(value);
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function getOlliStorageDiagnosticsSnapshotSafe() {
  const academyId = (typeof settingsGetAcademyId === 'function' && settingsGetAcademyId())
    || localStorage.getItem('olli_current_academy_id')
    || '';
  const core = window.OlliStorageCore;
  if (!core || !core.Diagnostics || typeof core.Diagnostics.snapshot !== 'function') {
    return {
      foundationVersion: 'not_ready',
      academyId,
      context: { academyId, role: typeof getOlliCurrentRole === 'function' ? getOlliCurrentRole() : '' },
      features: [],
      syncQueue: [],
      issues: [],
      createdAt: new Date().toISOString(),
      notReady: true
    };
  }
  try {
    return core.Diagnostics.snapshot(academyId);
  } catch (err) {
    return {
      foundationVersion: core.foundationVersion || 'unknown',
      academyId,
      context: core.AcademyContext && typeof core.AcademyContext.getCurrent === 'function' ? core.AcademyContext.getCurrent() : {},
      features: core.Diagnostics.registrySnapshot ? core.Diagnostics.registrySnapshot() : [],
      syncQueue: [],
      issues: [{ feature: 'storage_diagnostics', operation: 'snapshot', error_code: 'SNAPSHOT_FAILED', error_message: String(err && (err.message || err) || ''), created_at: new Date().toISOString() }],
      createdAt: new Date().toISOString()
    };
  }
}
function olliStorageDiagnosticsStatusLabel(status) {
  const value = String(status || '').trim();
  if (value === 'blocked') return '점검 필요';
  if (value === 'pending') return '재전송 대기';
  if (value === 'synced') return '동기화 완료';
  if (value === 'failed') return '실패';
  return value || '대기';
}
function olliFormatDiagnosticsDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    }).format(date);
  } catch (_) {
    return date.toLocaleString('ko-KR');
  }
}
function renderOlliStorageDiagnosticsFeatureList(features) {
  const rows = Array.isArray(features) ? features : [];
  if (!rows.length) return '<div class="settingsEmptyBox">등록된 공통 저장 기능을 아직 읽지 못했습니다.</div>';
  return '<div class="settingsInfoCard">'
    + '<div class="settingsInfoHead">등록된 저장 기능</div>'
    + rows.map(item => {
      const label = item.label || item.feature || '';
      const meta = [item.feature, item.table ? ('테이블 ' + item.table) : '', item.scope, item.persistence].filter(Boolean).join(' · ');
      const mode = item.mode || 'legacy';
      return '<div class="settingsInfoItem"><strong>' + olliStorageDiagnosticsEscape(label) + '</strong><br><span class="settingsMiniText">'
        + olliStorageDiagnosticsEscape(meta) + '</span><br><span class="settingsBadge ' + (mode === 'common' ? '' : 'warn') + '">' + olliStorageDiagnosticsEscape(mode) + '</span></div>';
    }).join('')
    + '</div>';
}
function renderOlliStorageDiagnosticsQueue(queue) {
  const rows = Array.isArray(queue) ? queue : [];
  if (!rows.length) return '<div class="settingsInfoCard"><div class="settingsInfoHead">재전송 대기열</div><div class="settingsInfoItem">현재 학원에 재전송 대기 항목이 없습니다.</div></div>';
  return '<div class="settingsInfoCard">'
    + '<div class="settingsInfoHead">재전송 대기열</div>'
    + rows.slice(0, 30).map(item => {
      const status = olliStorageDiagnosticsStatusLabel(item.status);
      const meta = [item.operation, item.student_id ? ('학생 ' + item.student_id) : '', item.record_id ? ('기록 ' + item.record_id) : '', item.file_id ? ('파일 ' + item.file_id) : '', item.created_at ? ('생성 ' + olliFormatDiagnosticsDate(item.created_at)) : '', item.last_attempt_at ? ('마지막 시도 ' + olliFormatDiagnosticsDate(item.last_attempt_at)) : ''].filter(Boolean).join(' · ');
      const err = item.error_message ? '<div class="settingsMiniText">' + olliStorageDiagnosticsEscape(item.error_message).slice(0, 160) + '</div>' : '';
      return '<div class="settingsRequestCard"><div class="settingsRequestTop"><div class="settingsRequestName">'
        + olliStorageDiagnosticsEscape(item.feature || 'unknown')
        + '</div><span class="settingsStatusBadge waiting">' + olliStorageDiagnosticsEscape(status) + '</span></div>'
        + '<div class="settingsRequestMeta"><div>' + olliStorageDiagnosticsEscape(meta || '작업 정보 없음') + '</div><div>시도 횟수: '
        + olliStorageDiagnosticsEscape(item.retry_count || 0) + '</div></div>' + err + '</div>';
    }).join('')
    + (rows.length > 30 ? '<div class="settingsMiniText">외 ' + (rows.length - 30) + '건은 진단 파일 내보내기에서 확인할 수 있습니다.</div>' : '')
    + '</div>';
}
function renderOlliStorageDiagnosticsIssues(issues) {
  const rows = Array.isArray(issues) ? issues : [];
  if (!rows.length) return '<div class="settingsInfoCard"><div class="settingsInfoHead">최근 오류</div><div class="settingsInfoItem">현재 학원에 기록된 저장 오류가 없습니다.</div></div>';
  return '<div class="settingsInfoCard">'
    + '<div class="settingsInfoHead">최근 오류</div>'
    + rows.slice(0, 30).map(item => {
      const meta = [item.resource, item.operation, item.error_code, olliFormatDiagnosticsDate(item.created_at)].filter(Boolean).join(' · ');
      return '<div class="settingsRequestCard"><div class="settingsRequestTop"><div class="settingsRequestName">'
        + olliStorageDiagnosticsEscape(item.feature || 'unknown')
        + '</div><span class="settingsStatusBadge waiting">오류</span></div>'
        + '<div class="settingsRequestMeta"><div>' + olliStorageDiagnosticsEscape(meta || '오류 정보 없음') + '</div></div>'
        + '<div class="settingsMiniText">' + olliStorageDiagnosticsEscape(item.error_message || item.message || '').slice(0, 220) + '</div></div>';
    }).join('')
    + (rows.length > 30 ? '<div class="settingsMiniText">외 ' + (rows.length - 30) + '건은 진단 파일 내보내기에서 확인할 수 있습니다.</div>' : '')
    + '</div>';
}
function renderOlliStorageDiagnostics() {
  const snapshot = getOlliStorageDiagnosticsSnapshotSafe();
  const features = Array.isArray(snapshot.features) ? snapshot.features : [];
  const queue = Array.isArray(snapshot.syncQueue) ? snapshot.syncQueue : [];
  const issues = Array.isArray(snapshot.issues) ? snapshot.issues : [];
  const retryableBlockedCount = queue.filter(item => String(item.status || '') === 'blocked' && String(item.feature || '') === 'student_soft_delete').length;
  const blockedCount = queue.filter(item => String(item.status || '') === 'blocked' && String(item.feature || '') !== 'student_soft_delete').length;
  const pendingCount = queue.filter(item => String(item.status || '') !== 'blocked').length + retryableBlockedCount;
  const currentRole = (snapshot.context && snapshot.context.role) || (typeof getOlliCurrentRole === 'function' ? getOlliCurrentRole() : '');
  const header = '<div class="settingsDetailIntro">'
    + '<div class="settingsDetailTitle">저장 상태를<br>점검합니다.</div>'
    + '<div class="settingsMiniText">현재 학원 기준으로 공통 저장 기능, 재전송 대기열, 최근 오류를 확인합니다.</div>'
    + '<div class="settingsMiniText">학원 ID: <strong>' + olliStorageDiagnosticsEscape(snapshot.academyId || '없음') + '</strong> · 역할: <strong>' + olliStorageDiagnosticsEscape(currentRole || '확인 안 됨') + '</strong></div>'
    + '<div class="settingsActionGrid"><button class="settingsActionBtn" type="button" onclick="refreshOlliStorageDiagnostics()">새로고침</button><button class="settingsActionBtn primary" type="button" onclick="retryOlliStorageQueue()">재전송 실행</button><button class="settingsActionBtn" type="button" onclick="downloadOlliStorageDiagnostics()">진단 파일 내보내기</button></div>'
    + '<div class="settingsActionGrid" style="margin-top:8px;"><button class="settingsActionBtn primary" type="button" onclick="openOlliTestApprovalManager()">승인관리</button></div>'
    + '</div>';
  const summary = '<div class="settingsCard">'
    + '<div class="settingsRow"><div class="settingsRowLeft"><span class="settingsRowTitle">등록된 저장 기능</span></div><span class="settingsBadge">' + features.length + '개</span></div>'
    + '<div class="settingsRow"><div class="settingsRowLeft"><span class="settingsRowTitle">재전송 대기</span></div><span class="settingsBadge ' + (pendingCount ? 'warn' : '') + '">' + pendingCount + '건</span></div>'
    + '<div class="settingsRow"><div class="settingsRowLeft"><span class="settingsRowTitle">점검 필요</span></div><span class="settingsBadge ' + (blockedCount ? 'warn' : '') + '">' + blockedCount + '건</span></div>'
    + '<div class="settingsRow"><div class="settingsRowLeft"><span class="settingsRowTitle">최근 오류</span></div><span class="settingsBadge ' + (issues.length ? 'warn' : '') + '">' + issues.length + '건</span></div>'
    + '</div>';
  const notReady = snapshot.notReady ? '<div class="settingsErrorBox">공통 저장 기반이 아직 준비되지 않았습니다. 앱을 새로고침한 뒤 다시 확인해 주세요.</div>' : '';
  return header + notReady + summary + renderOlliStorageDiagnosticsQueue(queue) + renderOlliStorageDiagnosticsIssues(issues) + renderOlliStorageDiagnosticsFeatureList(features);
}
function refreshOlliStorageDiagnostics() {
  const body = document.getElementById('settingsDetailBody');
  if (body) body.innerHTML = renderOlliStorageDiagnostics();
  const value = document.getElementById('settingsStorageDiagnosticsValue');
  if (value) {
    const snapshot = getOlliStorageDiagnosticsSnapshotSafe();
    const queueCount = Array.isArray(snapshot.syncQueue) ? snapshot.syncQueue.length : 0;
    const issueCount = Array.isArray(snapshot.issues) ? snapshot.issues.length : 0;
    value.textContent = (queueCount || issueCount) ? `${queueCount + issueCount}건` : '정상';
  }
}
function downloadOlliStorageDiagnostics() {
  try {
    const snapshot = getOlliStorageDiagnosticsSnapshotSafe();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const academy = String(snapshot.academyId || 'academy').replace(/[^a-zA-Z0-9_-]+/g, '_');
    const date = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `olli-storage-diagnostics-${academy}-${date}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('저장 진단 파일을 만들지 못했습니다.\n' + (err.message || err));
  }
}


async function retryOlliStorageQueue() {
  const core = window.OlliStorageCore;
  const academyId = (typeof settingsGetAcademyId === 'function' && settingsGetAcademyId())
    || localStorage.getItem('olli_current_academy_id')
    || '';
  if (!core || !core.SyncQueue || !core.FeatureRegistry) {
    alert('공통 저장 기반이 아직 준비되지 않았습니다. 앱을 새로고침한 뒤 다시 시도해 주세요.');
    return;
  }
  if (!academyId) {
    alert('현재 학원 ID를 확인할 수 없습니다. 학원을 다시 선택한 뒤 시도해 주세요.');
    return;
  }
  if (navigator && navigator.onLine === false) {
    alert('인터넷 연결 후 재전송을 실행해 주세요.');
    return;
  }

  const queue = core.SyncQueue.read(academyId).filter(item => {
    const status = String(item.status || 'pending');
    if (status !== 'blocked') return true;
    // 이전 버전에서 CHECK_CONSTRAINT_FAILED로 blocked 처리된 학생 삭제 항목은
    // 이번 버전에서 payload를 정규화해 다시 전송할 수 있게 합니다.
    return String(item.feature || '') === 'student_soft_delete';
  });
  if (!queue.length) {
    alert('재전송할 대기 항목이 없습니다.');
    refreshOlliStorageDiagnostics();
    return;
  }

  let success = 0;
  let failed = 0;
  let skipped = 0;
  const max = Math.min(queue.length, 20);
  for (let i = 0; i < max; i++) {
    const item = queue[i];
    const queueId = item.queue_id;
    const feature = String(item.feature || '').trim();
    const operation = String(item.operation || '').trim().toLowerCase();
    if (!feature || !core.FeatureRegistry.has(feature)) {
      failed++;
      core.SyncQueue.update(academyId, queueId, {
        status: 'blocked',
        last_attempt_at: new Date().toISOString(),
        retry_count: Number(item.retry_count || 0) + 1,
        error_code: 'FEATURE_NOT_REGISTERED',
        error_message: '등록되지 않은 저장 기능입니다: ' + feature
      });
      continue;
    }
    if (operation === 'upload') {
      skipped++;
      core.SyncQueue.update(academyId, queueId, {
        status: 'blocked',
        last_attempt_at: new Date().toISOString(),
        retry_count: Number(item.retry_count || 0) + 1,
        error_code: 'FILE_RETRY_NEEDS_INDEXEDDB',
        error_message: '사진 파일 업로드 재전송은 IndexedDB 파일 보관 구조가 필요합니다.'
      });
      continue;
    }

    core.SyncQueue.update(academyId, queueId, {
      last_attempt_at: new Date().toISOString(),
      retry_count: Number(item.retry_count || 0) + 1,
      status: 'pending'
    });

    const request = {
      academyId: item.academy_id || academyId,
      studentId: item.student_id || undefined,
      memberId: item.member_id || undefined,
      recordId: item.record_id || undefined,
      fileId: item.file_id || undefined,
      noteType: item.note_type || undefined,
      localRecordId: item.local_record_id || undefined,
      data: item.payload || {},
      clientMutationId: item.client_mutation_id || undefined,
      forceCommon: true,
      suppressQueue: true
    };
    if (feature === 'student_soft_delete') {
      const p = item.payload && typeof item.payload === 'object' ? item.payload : {};
      const retryAt = new Date().toISOString();
      request.data = {
        is_deleted: true,
        deleted_at: p.deleted_at || retryAt,
        deleted_by: p.deleted_by || localStorage.getItem('olli_current_member_id') || localStorage.getItem('olli_current_user_id') || '',
        delete_reason: p.delete_reason || p.reason || 'student_deleted'
      };
    }

    try {
      let result;
      if (operation === 'delete' || operation === 'soft_delete') {
        result = await deleteOlliData(feature, Object.assign({}, request, {
          deleteMode: (item.payload && item.payload.deleteMode) || 'soft',
          reason: (item.payload && item.payload.reason) || 'retry'
        }));
      } else {
        result = await saveOlliData(feature, request);
      }
      if ((result && result.serverSaved) || (result && result.deleted)) {
        core.SyncQueue.remove(academyId, queueId);
        success++;
      } else if (result && result.ok && result.pending) {
        failed++;
        core.SyncQueue.update(academyId, queueId, {
          status: 'pending',
          error_code: result.errorCode || 'SERVER_WRITE_PENDING',
          error_message: String(result.error && (result.error.message || result.error) || '서버 저장이 아직 완료되지 않았습니다.')
        });
      } else {
        failed++;
        core.SyncQueue.update(academyId, queueId, {
          status: 'pending',
          error_code: (result && result.errorCode) || 'RETRY_FAILED',
          error_message: String(result && result.error && (result.error.message || result.error) || (result && result.reason) || '재전송에 실패했습니다.')
        });
      }
    } catch (err) {
      failed++;
      core.SyncQueue.update(academyId, queueId, {
        status: 'pending',
        error_code: (err && err.code) || 'RETRY_FAILED',
        error_message: String(err && (err.message || err) || '')
      });
      if (core.Diagnostics && typeof core.Diagnostics.record === 'function') {
        core.Diagnostics.record({
          feature,
          resource: '',
          operation: 'retry',
          academy_id: academyId,
          student_id: item.student_id || null,
          error_code: (err && err.code) || 'RETRY_FAILED',
          error_message: String(err && (err.message || err) || '')
        });
      }
    }
  }

  refreshOlliStorageDiagnostics();
  alert('재전송 처리 결과\n성공: ' + success + '건\n실패: ' + failed + '건' + (skipped ? '\n보류: ' + skipped + '건' : ''));
}


let attendancePhotoImportState = {
  imageName: '',
  imageDataUrl: '',
  imageItems: [],
  analyzing: false,
  analysisProgress: '',
  importRunning: false,
  candidates: [],
  errorMessage: '',
  rawReply: ''
};


let studentBulkImportState = {
  division: 'elementary',
  rawText: '',
  candidates: [],
  importRunning: false,
  errorMessage: ''
};

let existingFeedbackImportState = {
  fileName: '',
  fileSize: 0,
  fileType: '',
  fileText: '',
  fileDataUrl: '',
  analyzing: false,
  importRunning: false,
  statusMessage: '',
  errorMessage: '',
  rawReply: '',
  candidates: []
};

let studentManagementActiveTab = 'bulk';
function getStudentManagementActiveTab() {
  return ['bulk', 'feedback', 'photo'].includes(studentManagementActiveTab) ? studentManagementActiveTab : 'bulk';
}
function setStudentManagementTab(tab) {
  studentManagementActiveTab = ['bulk', 'feedback', 'photo'].includes(tab) ? tab : 'bulk';
  refreshSettingsAttendancePhotoImportDetail();
}
function renderStudentManagementTabs() {
  const active = getStudentManagementActiveTab();
  const tab = (key, label) => '<button type="button" class="studentManagementTabBtn' + (active === key ? ' active' : '') + '" onclick="setStudentManagementTab(\'' + key + '\')">' + label + '</button>';
  return '<div class="studentManagementTabRow">'
    + tab('bulk', '요일·시간 업로드')
    + tab('feedback', '기존 피드백')
    + tab('photo', '출석부 사진')
    + '</div>';
}

function getAttendancePhotoImportTodayValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function getAttendancePhotoImportTodayParts() {
  const value = getAttendancePhotoImportTodayValue();
  const [year, month, day] = value.split('-');
  return { year: Number(year), month, day, enrolled_at: value };
}

function normalizeAttendancePhotoDivision(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (/유치|kinder|kindergarten|5세|6세|7세/.test(raw)) return 'kinder';
  return 'elementary';
}

function getAttendancePhotoDivisionLabel(value) {
  return normalizeAttendancePhotoDivision(value) === 'kinder' ? '유치부' : '초등부';
}

function normalizeAttendancePhotoGroup(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const upper = raw.toUpperCase().replace(/그룹|GROUP|반/g, '').replace(/\s+/g, '').trim();
  const match = upper.match(/^[A-F]$/);
  return match ? match[0] : '';
}

function getAttendancePhotoGroupInternalValue(value) {
  const group = normalizeAttendancePhotoGroup(value);
  const map = { A: '1', B: '2', C: '3', D: '4', E: '5', F: '6' };
  return map[group] || '';
}

function normalizeAttendancePhotoLessonDay(value) {
  return String(value || '')
    .replace(/[\[\](){}]/g, ' ')
    .replace(/요일/g, '')
    .replace(/,/g, '·')
    .replace(/\//g, '·')
    .replace(/\s+/g, '')
    .replace(/([월화수목금토일])(?=[월화수목금토일])/g, '$1·')
    .replace(/·+/g, '·')
    .replace(/^·|·$/g, '');
}

function normalizeAttendancePhotoImportCandidate(item = {}, index = 0) {
  const division = normalizeAttendancePhotoDivision(item.division || item.type || item.section || item.category || 'elementary');
  const enrolled = normalizeStudentDateInputValue(item.enrolled_at || item.registration_date || item.registered_at || '');
  const name = String(item.name || item.student_name || '').trim();
  const confidence = Number(item.confidence || item.score || 0);
  return {
    id: item.id || `photo_candidate_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
    selected: item.selected !== false,
    name,
    division,
    school: String(item.school || item.school_name || '').trim(),
    kindergarten: String(item.kindergarten || item.kindergarten_name || '').trim(),
    grade: String(item.grade || item.school_grade || '').replace(/학년|초/g, '').trim(),
    className: String(item.className || item.class_no || item.class || '').replace(/반/g, '').trim(),
    age: String(item.age || '').replace(/세/g, '').trim(),
    lesson_day: normalizeAttendancePhotoLessonDay(item.lesson_day || item.lessonDay || item.days || item.weekdays || ''),
    class_time: normalizeLessonTimeDisplay(item.class_time || item.time || item.lesson_time || item.lessonTime || ''),
    group: normalizeAttendancePhotoGroup(item.group || item.group_no || item.groupName || ''),
    teacher: String(item.teacher || item.teacher_name || item.homeroom_teacher || '').trim(),
    enrolled_at: enrolled ? enrolled.enrolled_at : '',
    year: enrolled ? enrolled.year : '',
    month: enrolled ? enrolled.month : '',
    day: enrolled ? enrolled.day : '',
    note: String(item.note || item.memo || item.reason || '').trim(),
    confidence: Number.isFinite(confidence) ? confidence : 0
  };
}

function getAttendancePhotoDuplicateInfo(candidate) {
  const name = String(candidate?.name || '').trim();
  if (!name) return { type: 'warn', label: '이름 확인 필요' };
  const division = normalizeAttendancePhotoDivision(candidate?.division);
  const found = getAllStudents().find(student => {
    if (getStudentStatus(student) !== 'active') return false;
    return String(student.name || '').trim() === name && normalizeAttendancePhotoDivision(student.type) === division;
  });
  if (found) return { type: 'dup', label: '기존 학생 수정' };
  if (candidate.confidence && candidate.confidence < 0.72) return { type: 'warn', label: '확인 필요' };
  return { type: '', label: '등록 가능' };
}

function buildAttendancePhotoImportPrompt() {
  return `종이 출석부 사진을 보고 원생 등록 후보를 추출해 주세요.\n\n반드시 JSON만 응답하세요. 설명 문장은 쓰지 마세요.\n\n응답 형식:\n{\n  "students": [\n    {\n      "name": "학생 이름",\n      "division": "elementary 또는 kinder",\n      "school": "초등학생 학교명. 없으면 빈 문자열",\n      "grade": "초등 학년 숫자. 없으면 빈 문자열",\n      "class_no": "초등 반 숫자. 없으면 빈 문자열",\n      "kindergarten": "유치부 유치원명. 없으면 빈 문자열",\n      "age": "유치부 나이 숫자. 없으면 빈 문자열",\n      "lesson_day": "수업 요일. 예: 월·수",\n      "class_time": "수업 시간. 예: 4시",\n      "group": "초등 그룹. A, B, C, D, E, F 중 하나. 사진에 없으면 빈 문자열",\n      "teacher": "담임/담당 선생님. 없으면 빈 문자열",\n      "enrolled_at": "등록일 YYYY-MM-DD. 사진에 등록일 정보가 없으면 반드시 빈 문자열",\n      "confidence": 0.0,\n      "note": "확인이 필요한 내용"\n    }\n  ]\n}\n\n분석 규칙:\n- 학원마다 출석부 양식이 다를 수 있으므로, 표의 열 제목과 주변 문맥을 보고 이름/학년/요일/시간/그룹을 추론합니다.\n- 초1, 초2, 1학년처럼 초등 학년이 보이면 division은 elementary입니다.\n- 5세, 6세, 7세, 유치원명이 중심이면 division은 kinder입니다.\n- 등록일은 사진에 실제 등록일 항목이 있을 때만 입력하고, 오늘 날짜나 사진 업로드 날짜를 추정해서 넣지 마세요.\n- 초등 그룹은 A~F 문자만 사용합니다. 그룹 정보가 사진에 명확히 없으면 빈 문자열로 둡니다. 숫자 1~6은 학년/반/시간일 수 있으므로 그룹으로 추정하지 마세요.\n- 확실하지 않은 칸은 빈 문자열로 두고 note에 확인 필요라고 적습니다.\n- 같은 학생이 중복으로 보이면 한 번만 넣습니다.\n- 사진에서 읽을 수 없는 정보는 절대 지어내지 마세요.`;
}

function extractJsonTextFromAttendancePhotoReply(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const firstObject = raw.indexOf('{');
  const lastObject = raw.lastIndexOf('}');
  if (firstObject >= 0 && lastObject > firstObject) return raw.slice(firstObject, lastObject + 1).trim();
  const firstArray = raw.indexOf('[');
  const lastArray = raw.lastIndexOf(']');
  if (firstArray >= 0 && lastArray > firstArray) return raw.slice(firstArray, lastArray + 1).trim();
  return raw;
}

function parseAttendancePhotoAnalysisData(data) {
  if (data && Array.isArray(data.students)) return data.students;
  if (data && data.result && Array.isArray(data.result.students)) return data.result.students;
  if (data && Array.isArray(data.result)) return data.result;
  if (data && Array.isArray(data.items)) return data.items;
  const reply = String((data && (data.reply || data.text || data.raw)) || '').trim();
  if (!reply) return [];
  const jsonText = extractJsonTextFromAttendancePhotoReply(reply);
  const parsed = JSON.parse(jsonText);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.students)) return parsed.students;
  return [];
}

function renderAttendancePhotoCandidateField(index, field, label, value, options = {}) {
  const safeValue = settingsEscapeAttr(value || '');
  const full = options.full ? ' full' : '';
  if (options.type === 'select') {
    const selectedElementary = normalizeAttendancePhotoDivision(value) === 'elementary' ? ' selected' : '';
    const selectedKinder = normalizeAttendancePhotoDivision(value) === 'kinder' ? ' selected' : '';
    return '<div class="attendancePhotoCandidateField' + full + '"><div class="attendancePhotoCandidateLabel">' + label + '</div>'
      + '<select class="attendancePhotoCandidateSelect" onchange="updateAttendancePhotoCandidateField(' + index + ',\'' + field + '\',this.value)">'
      + '<option value="elementary"' + selectedElementary + '>초등부</option>'
      + '<option value="kinder"' + selectedKinder + '>유치부</option>'
      + '</select></div>';
  }
  return '<div class="attendancePhotoCandidateField' + full + '"><div class="attendancePhotoCandidateLabel">' + label + '</div>'
    + '<input class="attendancePhotoCandidateInput" value="' + safeValue + '" oninput="updateAttendancePhotoCandidateField(' + index + ',\'' + field + '\',this.value)" placeholder="' + settingsEscapeAttr(options.placeholder || '') + '">'
    + '</div>';
}

function renderAttendancePhotoCandidateCard(candidate, index) {
  const dup = getAttendancePhotoDuplicateInfo(candidate);
  const badgeClass = dup.type ? ' ' + dup.type : '';
  const division = normalizeAttendancePhotoDivision(candidate.division);
  const isKinder = division === 'kinder';
  const metaFields = isKinder
    ? renderAttendancePhotoCandidateField(index, 'kindergarten', '유치원', candidate.kindergarten)
      + renderAttendancePhotoCandidateField(index, 'age', '나이', candidate.age)
    : renderAttendancePhotoCandidateField(index, 'school', '학교', candidate.school)
      + renderAttendancePhotoCandidateField(index, 'grade', '학년', candidate.grade)
      + renderAttendancePhotoCandidateField(index, 'className', '반', candidate.className)
      + renderAttendancePhotoCandidateField(index, 'group', '그룹', candidate.group);
  return '<div class="attendancePhotoCandidateCard">'
    + '<div class="attendancePhotoCandidateTop">'
    + '<label class="attendancePhotoCandidateCheck"><input type="checkbox" ' + (candidate.selected ? 'checked' : '') + ' onchange="toggleAttendancePhotoImportCandidate(' + index + ',this.checked)">확인 완료</label>'
    + '<span class="attendancePhotoCandidateBadge' + badgeClass + '">' + settingsEscapeHtml(dup.label) + '</span>'
    + '</div>'
    + '<div class="attendancePhotoCandidateGrid">'
    + renderAttendancePhotoCandidateField(index, 'name', '이름', candidate.name)
    + renderAttendancePhotoCandidateField(index, 'division', '구분', candidate.division, { type: 'select' })
    + metaFields
    + renderAttendancePhotoCandidateField(index, 'lesson_day', '요일', candidate.lesson_day)
    + renderAttendancePhotoCandidateField(index, 'class_time', '시간', candidate.class_time)
    + renderAttendancePhotoCandidateField(index, 'teacher', '담임', candidate.teacher)
    + renderAttendancePhotoCandidateField(index, 'enrolled_at', '등록일', candidate.enrolled_at)
    + '</div>'
    + '</div>';
}

function renderAttendancePhotoImportResults() {
  const list = attendancePhotoImportState.candidates || [];
  if (!list.length && !attendancePhotoImportState.errorMessage && !attendancePhotoImportState.rawReply) return '';
  const selectedCount = list.filter(item => item.selected && String(item.name || '').trim()).length;
  const cards = list.length
    ? '<div class="settingsInfoCard"><div class="settingsInfoHead">분석 결과 확인</div>'
      + '<div class="attendancePhotoResultSummary"><span class="attendancePhotoResultCount">후보 ' + list.length + '명 · 반영 선택 ' + selectedCount + '명</span><button class="settingsActionBtn" type="button" onclick="setAllAttendancePhotoImportCandidatesChecked(true)">전체 선택</button></div>'
      + '<div class="attendancePhotoCandidateList">' + list.map(renderAttendancePhotoCandidateCard).join('') + '</div>'
      + '<div class="attendancePhotoActionGrid single"><button class="settingsActionBtn primary" type="button" onclick="importAttendancePhotoCandidates()">선택한 학생 출석부에 등록</button></div>'
      + '</div>'
    : '';
  const error = attendancePhotoImportState.errorMessage
    ? '<div class="attendancePhotoStatusBox error">' + settingsEscapeHtml(attendancePhotoImportState.errorMessage) + '</div>'
    : '';
  const raw = (!list.length && attendancePhotoImportState.rawReply)
    ? '<div class="attendancePhotoStatusBox">AI 응답을 학생 목록으로 읽지 못했어요.\n' + settingsEscapeHtml(attendancePhotoImportState.rawReply.slice(0, 600)) + '</div>'
    : '';
  return error + raw + cards;
}

function getAttendancePhotoImportImages() {
  if (Array.isArray(attendancePhotoImportState.imageItems) && attendancePhotoImportState.imageItems.length) {
    return attendancePhotoImportState.imageItems.filter(item => item && item.dataUrl);
  }
  if (attendancePhotoImportState.imageDataUrl) {
    return [{ name: attendancePhotoImportState.imageName || '출석부 사진', dataUrl: attendancePhotoImportState.imageDataUrl }];
  }
  return [];
}

function readAttendancePhotoImportFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('사진을 읽지 못했어요.'));
    reader.readAsDataURL(file);
  });
}

function loadAttendancePhotoImportImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('사진을 불러오지 못했어요.'));
    img.src = dataUrl;
  });
}

async function compressAttendancePhotoImportFile(file) {
  const originalDataUrl = await readAttendancePhotoImportFileAsDataUrl(file);
  try {
    const img = await loadAttendancePhotoImportImage(originalDataUrl);
    const attempts = [
      { max: 1100, quality: 0.68 },
      { max: 900, quality: 0.6 },
      { max: 760, quality: 0.54 },
      { max: 640, quality: 0.48 }
    ];
    let bestDataUrl = originalDataUrl;
    for (const attempt of attempts) {
      const sourceWidth = img.naturalWidth || img.width || 1;
      const sourceHeight = img.naturalHeight || img.height || 1;
      const scale = Math.min(1, attempt.max / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) break;
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', attempt.quality);
      if (!bestDataUrl || dataUrl.length < bestDataUrl.length) bestDataUrl = dataUrl;
      if (dataUrl.length <= 650000) {
        bestDataUrl = dataUrl;
        break;
      }
    }
    return { name: file.name || '출석부 사진', dataUrl: bestDataUrl, originalSize: file.size || 0, compressedSize: bestDataUrl.length };
  } catch (err) {
    return { name: file.name || '출석부 사진', dataUrl: originalDataUrl, originalSize: file.size || 0, compressedSize: originalDataUrl.length };
  }
}


function getStudentBulkImportPlaceholder() {
  if (studentBulkImportState.division === 'kinder') {
    return '예시\n김민준\n이서윤, 6세, 월·수, 박T\n박하윤 / 유치부 / 하늘유치원 / 5세 / 화목 / 이T / 2026-03-02';
  }
  return '예시\n김민준\n이서윤, 초2, 월·수, A그룹, 박T\n박하윤 / 초등부 / 햇살초 / 3학년 / 2반 / 화목 / B / 이T / 2026-03-02';
}

function setStudentBulkImportDivision(division) {
  studentBulkImportState.division = normalizeAttendancePhotoDivision(division || 'elementary');
  studentBulkImportState.candidates = [];
  studentBulkImportState.errorMessage = '';
  refreshSettingsAttendancePhotoImportDetail();
}

function updateStudentBulkImportText(value) {
  studentBulkImportState.rawText = String(value || '');
}

function clearStudentBulkImportText() {
  studentBulkImportState.rawText = '';
  studentBulkImportState.candidates = [];
  studentBulkImportState.errorMessage = '';
  refreshSettingsAttendancePhotoImportDetail();
}

function normalizeStudentBulkImportToken(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function splitStudentBulkImportLine(line) {
  const raw = String(line || '').trim();
  if (!raw) return [];
  const hasStrongDelimiter = /[\t,\/|]/.test(raw);
  const tokens = hasStrongDelimiter
    ? raw.split(/[\t,\/|]+/)
    : raw.split(/\s+/);
  return tokens.map(normalizeStudentBulkImportToken).filter(Boolean);
}

function getStudentBulkImportDivisionFromTokens(tokens, fallbackDivision) {
  const joined = tokens.join(' ');
  if (/유치|유아|kinder/i.test(joined)) return 'kinder';
  if (/(^|\s)(5|6|7)\s*세/.test(joined) || /유치원/.test(joined)) return 'kinder';
  if (/초등|초\s*[1-6]|[1-6]\s*학년|초등학교|초교|elementary/i.test(joined)) return 'elementary';
  return normalizeAttendancePhotoDivision(fallbackDivision || 'elementary');
}

function findStudentBulkImportDate(tokens) {
  for (const token of tokens) {
    const text = String(token || '').trim();
    const match = text.match(/(20\d{2}|19\d{2})[.\-/년\s]*(\d{1,2})[.\-/월\s]*(\d{1,2})/);
    if (match) {
      const parsed = normalizeStudentDateInputValue(`${match[1]}-${match[2]}-${match[3]}`);
      if (parsed) return parsed;
    }
  }
  return null;
}

function getStudentBulkImportName(tokens) {
  const skipPattern = /(초등|유치|유아|학년|반|세|그룹|group|월|화|수|목|금|토|일|요일|담임|선생|T$|t$|20\d{2}|19\d{2}|학교|유치원)/;
  const first = tokens.find(token => token && !skipPattern.test(token));
  return String(first || tokens[0] || '').replace(/[:：]/g, '').trim();
}

function parseStudentBulkImportLine(line, index) {
  const tokens = splitStudentBulkImportLine(line);
  if (!tokens.length) return null;
  const division = getStudentBulkImportDivisionFromTokens(tokens, studentBulkImportState.division);
  const name = getStudentBulkImportName(tokens);
  const enrolled = findStudentBulkImportDate(tokens);
  const candidate = normalizeAttendancePhotoImportCandidate({
    id: `bulk_candidate_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
    selected: !!name,
    name,
    division,
    confidence: name ? 1 : 0,
    note: ''
  }, index);

  tokens.forEach(token => {
    const text = String(token || '').trim();
    if (!text || text === name) return;
    const dateParsed = findStudentBulkImportDate([text]);
    if (dateParsed) {
      candidate.year = dateParsed.year;
      candidate.month = dateParsed.month;
      candidate.day = dateParsed.day;
      candidate.enrolled_at = dateParsed.enrolled_at;
      return;
    }
    const timeText = normalizeLessonTimeDisplay(text);
    if (timeText && /(?:[1-7]\s*(?:시|:00)|오후\s*[1-7])/.test(text)) {
      candidate.class_time = [candidate.class_time, timeText].filter(Boolean).join('·').replace(/·+/g, '·').replace(/^·|·$/g, '');
    }
    const daySource = text.replace(/(?:오후\s*)?[1-7]\s*(?:시|:00)?/g, '');
    const dayText = normalizeAttendancePhotoLessonDay(daySource || text);
    if (/[월화수목금토일]/.test(dayText) && !/월\s*\d|\d\s*월/.test(daySource)) {
      candidate.lesson_day = [candidate.lesson_day, dayText].filter(Boolean).join('·').replace(/·+/g, '·').replace(/^·|·$/g, '');
      return;
    }
    if (timeText && /(?:[1-7]\s*(?:시|:00)|오후\s*[1-7])/.test(text)) return;
    const teacherMatch = text.match(/^(.+?)(?:선생님|선생|담임|T|t)$/);
    if (teacherMatch && teacherMatch[1]) {
      candidate.teacher = teacherMatch[1].trim();
      return;
    }
    if (/^[가-힣]{1,4}T$/i.test(text)) {
      candidate.teacher = text.replace(/T$/i, '').trim();
      return;
    }
    const ageMatch = text.match(/([5-7])\s*세/);
    if (ageMatch) {
      candidate.age = ageMatch[1];
      candidate.division = 'kinder';
      return;
    }
    const gradeMatch = text.match(/(?:초\s*)?([1-6])\s*학년|초\s*([1-6])/);
    if (gradeMatch) {
      candidate.grade = gradeMatch[1] || gradeMatch[2] || '';
      candidate.division = 'elementary';
      return;
    }
    const classMatch = text.match(/([1-9]|1\d|20)\s*반/);
    if (classMatch && !/[A-Fa-f]/.test(text)) {
      candidate.className = classMatch[1];
      return;
    }
    const group = normalizeAttendancePhotoGroup(text);
    if (group) {
      candidate.group = group;
      candidate.division = 'elementary';
      return;
    }
    if (/유치원/.test(text)) {
      candidate.kindergarten = text.replace(/유치원명|유치원[:：]?/g, '').trim();
      candidate.division = 'kinder';
      return;
    }
    if (/학교|초등학교|초교/.test(text)) {
      candidate.school = text.replace(/학교명|학교[:：]?/g, '').trim();
      candidate.division = 'elementary';
    }
  });

  if (!candidate.name) {
    candidate.note = '이름 확인 필요';
    candidate.selected = false;
  }
  return candidate;
}

function parseStudentBulkImportText() {
  const rows = String(studentBulkImportState.rawText || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  if (!rows.length) {
    studentBulkImportState.candidates = [];
    studentBulkImportState.errorMessage = '등록할 학생 이름을 한 줄에 한 명씩 입력해 주세요.';
    refreshSettingsAttendancePhotoImportDetail();
    return;
  }
  const candidates = rows
    .map((line, index) => parseStudentBulkImportLine(line, index))
    .filter(Boolean);
  studentBulkImportState.candidates = mergeAttendancePhotoImportCandidates(candidates);
  studentBulkImportState.errorMessage = studentBulkImportState.candidates.length ? '' : '등록할 학생 정보를 찾지 못했어요.';
  refreshSettingsAttendancePhotoImportDetail();
}

function renderStudentBulkCandidateField(index, field, label, value, options = {}) {
  const safeValue = settingsEscapeAttr(value || '');
  const full = options.full ? ' full' : '';
  if (options.type === 'select') {
    const selectedElementary = normalizeAttendancePhotoDivision(value) === 'elementary' ? ' selected' : '';
    const selectedKinder = normalizeAttendancePhotoDivision(value) === 'kinder' ? ' selected' : '';
    return '<div class="studentBulkCandidateField' + full + '"><div class="studentBulkCandidateLabel">' + label + '</div>'
      + '<select class="studentBulkCandidateSelect" onchange="updateStudentBulkCandidateField(' + index + ',\'' + field + '\',this.value)">'
      + '<option value="elementary"' + selectedElementary + '>초등부</option>'
      + '<option value="kinder"' + selectedKinder + '>유치부</option>'
      + '</select></div>';
  }
  return '<div class="studentBulkCandidateField' + full + '"><div class="studentBulkCandidateLabel">' + label + '</div>'
    + '<input class="studentBulkCandidateInput" value="' + safeValue + '" oninput="updateStudentBulkCandidateField(' + index + ',\'' + field + '\',this.value)" placeholder="' + settingsEscapeAttr(options.placeholder || '') + '">'
    + '</div>';
}

function renderStudentBulkCandidateCard(candidate, index) {
  const dup = getAttendancePhotoDuplicateInfo(candidate);
  const badgeClass = dup.type ? ' ' + dup.type : '';
  const division = normalizeAttendancePhotoDivision(candidate.division);
  const isKinder = division === 'kinder';
  const metaFields = isKinder
    ? renderStudentBulkCandidateField(index, 'kindergarten', '유치원', candidate.kindergarten)
      + renderStudentBulkCandidateField(index, 'age', '나이', candidate.age)
    : renderStudentBulkCandidateField(index, 'school', '학교', candidate.school)
      + renderStudentBulkCandidateField(index, 'grade', '학년', candidate.grade)
      + renderStudentBulkCandidateField(index, 'className', '반', candidate.className)
      + renderStudentBulkCandidateField(index, 'group', '그룹', candidate.group);
  return '<div class="studentBulkCandidateCard">'
    + '<div class="studentBulkCandidateTop">'
    + '<label class="studentBulkCandidateCheck"><input type="checkbox" ' + (candidate.selected ? 'checked' : '') + ' onchange="toggleStudentBulkCandidate(' + index + ',this.checked)">등록 선택</label>'
    + '<span class="studentBulkCandidateTopRight"><span class="attendancePhotoCandidateBadge' + badgeClass + '">' + settingsEscapeHtml(dup.label) + '</span><button class="studentBulkCandidateDeleteBtn danger" type="button" onclick="removeStudentBulkCandidate(' + index + ')">삭제</button></span>'
    + '</div>'
    + '<div class="studentBulkCandidateGrid">'
    + renderStudentBulkCandidateField(index, 'name', '이름', candidate.name)
    + renderStudentBulkCandidateField(index, 'division', '구분', candidate.division, { type: 'select' })
    + metaFields
    + renderStudentBulkCandidateField(index, 'lesson_day', '요일', candidate.lesson_day)
    + renderStudentBulkCandidateField(index, 'class_time', '시간', candidate.class_time)
    + renderStudentBulkCandidateField(index, 'teacher', '담임', candidate.teacher)
    + renderStudentBulkCandidateField(index, 'enrolled_at', '등록일', candidate.enrolled_at)
    + '</div>'
    + '</div>';
}

function renderStudentBulkImportResults() {
  const list = studentBulkImportState.candidates || [];
  const error = studentBulkImportState.errorMessage
    ? '<div class="attendancePhotoStatusBox error">' + settingsEscapeHtml(studentBulkImportState.errorMessage) + '</div>'
    : '';
  if (!list.length) return error;
  const selectedCount = list.filter(item => item.selected && String(item.name || '').trim()).length;
  return error
    + '<div class="settingsInfoCard"><div class="settingsInfoHead">수정 후보 확인</div>'
    + '<div class="attendancePhotoResultSummary"><span class="attendancePhotoResultCount">후보 ' + list.length + '명 · 반영 선택 ' + selectedCount + '명</span><span class="studentBulkCandidateTopRight"><button class="settingsActionBtn" type="button" onclick="setAllStudentBulkCandidatesChecked(true)">전체 선택</button><button class="settingsActionBtn" type="button" onclick="removeSelectedStudentBulkCandidates()">선택 삭제</button><button class="settingsActionBtn" type="button" onclick="clearStudentBulkCandidates()">전체 삭제</button></span></div>'
    + '<div class="studentBulkCandidateList">' + list.map(renderStudentBulkCandidateCard).join('') + '</div>'
    + '<div class="attendancePhotoActionGrid single"><button class="settingsActionBtn primary" type="button" onclick="importStudentBulkCandidates()"' + (studentBulkImportState.importRunning ? ' disabled' : '') + '>' + (studentBulkImportState.importRunning ? '반영 중...' : '선택한 학생정보 반영') + '</button></div>'
    + '</div>';
}

function renderSettingsStudentBulkImport() {
  const division = normalizeAttendancePhotoDivision(studentBulkImportState.division || 'elementary');
  const elementaryActive = division === 'elementary' ? ' active' : '';
  const kinderActive = division === 'kinder' ? ' active' : '';
  return '<div class="settingsInfoCard studentBulkImportPanel">'
    + '<div class="settingsInfoHead">요일·시간 일괄 수정</div>'
    + '<div class="studentBulkImportModeRow">'
    + '<button class="studentBulkImportModeBtn' + elementaryActive + '" type="button" onclick="setStudentBulkImportDivision(\'elementary\')">초등부 기준</button>'
    + '<button class="studentBulkImportModeBtn' + kinderActive + '" type="button" onclick="setStudentBulkImportDivision(\'kinder\')">유치부 기준</button>'
    + '</div>'
    + '<textarea id="studentBulkImportText" class="studentBulkImportTextarea" oninput="updateStudentBulkImportText(this.value)" placeholder="' + settingsEscapeAttr(getStudentBulkImportPlaceholder()) + '">' + settingsEscapeHtml(studentBulkImportState.rawText || '') + '</textarea>'
    + '<div class="studentBulkImportGuide">독스(docx), txt, csv 파일을 올리면 이름·요일·시간을 읽어 수정 후보를 만듭니다. 기존 학생은 학생정보를 수정하고, 없는 학생은 신규 후보로 표시합니다.</div>'
    + '<div class="attendancePhotoActionGrid"><button class="settingsActionBtn" type="button" onclick="openStudentBulkImportFilePicker()">독스 파일 업로드</button><button class="settingsActionBtn primary" type="button" onclick="parseStudentBulkImportText()">수정 후보 만들기</button><button class="settingsActionBtn" type="button" onclick="clearStudentBulkImportText()">입력 지우기</button></div>'
    + '</div>'
    + renderStudentBulkImportResults();
}

function updateStudentBulkCandidateField(index, field, value) {
  const item = studentBulkImportState.candidates[index];
  if (!item) return;
  if (field === 'division') item[field] = normalizeAttendancePhotoDivision(value);
  else if (field === 'lesson_day') item[field] = normalizeAttendancePhotoLessonDay(value);
  else if (field === 'group') item[field] = normalizeAttendancePhotoGroup(value);
  else item[field] = String(value || '').trim();
  if (field === 'enrolled_at') {
    const parsed = normalizeStudentDateInputValue(value);
    if (parsed) {
      item.year = parsed.year;
      item.month = parsed.month;
      item.day = parsed.day;
      item.enrolled_at = parsed.enrolled_at;
    } else {
      item.enrolled_at = String(value || '').trim();
    }
  }
}

function toggleStudentBulkCandidate(index, checked) {
  const item = studentBulkImportState.candidates[index];
  if (!item) return;
  item.selected = !!checked;
}

function removeStudentBulkCandidate(index) {
  if (!Array.isArray(studentBulkImportState.candidates)) return;
  const safeIndex = Number(index);
  if (!Number.isFinite(safeIndex) || safeIndex < 0 || safeIndex >= studentBulkImportState.candidates.length) return;
  studentBulkImportState.candidates.splice(safeIndex, 1);
  refreshSettingsAttendancePhotoImportDetail();
}

function removeSelectedStudentBulkCandidates() {
  const before = Array.isArray(studentBulkImportState.candidates) ? studentBulkImportState.candidates.length : 0;
  if (!before) return;
  const next = studentBulkImportState.candidates.filter(item => !item.selected);
  if (next.length === before) {
    if (typeof showPushToast === 'function') showPushToast('삭제할 등록 후보를 선택해 주세요.');
    else alert('삭제할 등록 후보를 선택해 주세요.');
    return;
  }
  studentBulkImportState.candidates = next;
  refreshSettingsAttendancePhotoImportDetail();
}

function clearStudentBulkCandidates() {
  if (!Array.isArray(studentBulkImportState.candidates) || !studentBulkImportState.candidates.length) {
    if (typeof showPushToast === 'function') showPushToast('삭제할 등록 후보가 없습니다.');
    else alert('삭제할 등록 후보가 없습니다.');
    return;
  }
  const ok = confirm('등록 후보를 모두 삭제할까요?');
  if (!ok) return;
  studentBulkImportState.candidates = [];
  studentBulkImportState.errorMessage = '';
  refreshSettingsAttendancePhotoImportDetail();
}

function setAllStudentBulkCandidatesChecked(checked) {
  studentBulkImportState.candidates.forEach(item => { item.selected = !!checked; });
  refreshSettingsAttendancePhotoImportDetail();
}


function ensureStudentBulkApplyOverlay() {
  let overlay = document.getElementById('studentBulkApplyOverlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'studentBulkApplyOverlay';
  overlay.className = 'studentBulkApplyOverlay';
  overlay.setAttribute('aria-live', 'polite');
  overlay.innerHTML = '<div class="studentBulkApplyCard" role="status" aria-label="학생정보 반영 중">'
    + '<div class="studentBulkApplyIcon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"></path></svg></div>'
    + '<div id="studentBulkApplyTitle" class="studentBulkApplyTitle">학생정보 반영 중<span class="studentBulkApplyDots"><span></span><span></span><span></span></span></div>'
    + '<div id="studentBulkApplyText" class="studentBulkApplyText">선택한 학생정보를 저장하고 있어요.</div>'
    + '</div>';
  document.body.appendChild(overlay);
  return overlay;
}

function showStudentBulkApplyOverlay(text = '') {
  const overlay = ensureStudentBulkApplyOverlay();
  const messageEl = document.getElementById('studentBulkApplyText');
  if (messageEl && text) messageEl.textContent = text;
  overlay.classList.add('show');
}

function hideStudentBulkApplyOverlay() {
  const overlay = document.getElementById('studentBulkApplyOverlay');
  if (overlay) overlay.classList.remove('show');
}

function waitStudentBulkApplyPaint() {
  return new Promise(resolve => {
    const raf = window.requestAnimationFrame || function(cb) { return setTimeout(cb, 16); };
    raf(() => raf(resolve));
  });
}

async function importStudentBulkCandidates() {
  if (studentBulkImportState.importRunning) return;
  const selected = studentBulkImportState.candidates.filter(item => item.selected && String(item.name || '').trim());
  if (!selected.length) {
    if (typeof showPushToast === 'function') showPushToast('등록할 학생을 선택해 주세요.');
    else alert('등록할 학생을 선택해 주세요.');
    return;
  }
  studentBulkImportState.importRunning = true;
  showStudentBulkApplyOverlay(`선택한 학생정보 ${selected.length}명을 반영하고 있어요.`);
  refreshSettingsAttendancePhotoImportDetail();
  await waitStudentBulkApplyPaint();
  try {
    let savedCount = 0;
    let updatedCount = 0;
    let processedCount = 0;
    for (const candidate of selected) {
      processedCount += 1;
      showStudentBulkApplyOverlay(`학생정보 반영 중 ${processedCount} / ${selected.length}`);
      const student = buildStudentFromAttendancePhotoCandidate(candidate);
      if (!student.name) continue;
      const existing = getAllStudents().find(item => getStudentStatus(item) === 'active'
        && String(item.name || '').trim() === String(student.name || '').trim()
        && normalizeAttendancePhotoDivision(item.type) === normalizeAttendancePhotoDivision(student.type));
      if (existing) {
        const next = {
          ...existing,
          lesson_day: student.lesson_day || existing.lesson_day || '',
          lesson_time: student.lesson_time || student.class_time || existing.lesson_time || existing.class_time || '',
          class_time: student.class_time || student.lesson_time || existing.class_time || existing.lesson_time || '',
          teacher: student.teacher || existing.teacher || '',
          homeroom_teacher: student.homeroom_teacher || existing.homeroom_teacher || student.teacher || existing.teacher || '',
          school: student.school || existing.school || '',
          grade: student.grade || existing.grade || '',
          className: student.className || existing.className || '',
          kindergarten: student.kindergarten || existing.kindergarten || '',
          age: student.age || existing.age || ''
        };
        await ensureStudentSavedToSupabase(next);
        updatedCount += 1;
      } else {
        await ensureStudentSavedToSupabase(student);
        savedCount += 1;
      }
    }
    try { await loadStudentsFromSupabase(); } catch(e) {}
    try {
      const searchValue = document.getElementById('searchName')?.value?.trim() || '';
      if (typeof loadRecords === 'function') await loadRecords(searchValue);
    } catch(e) {}
    try { if (typeof refreshMemoStudentSelectPopupIfOpen === 'function') refreshMemoStudentSelectPopupIfOpen(); } catch(e) {}
    try { if (typeof refreshKinderChatFeedbackStudentManagePopupIfOpen === 'function') refreshKinderChatFeedbackStudentManagePopupIfOpen(); } catch(e) {}
    studentBulkImportState.candidates = studentBulkImportState.candidates.filter(item => !selected.includes(item));
    studentBulkImportState.errorMessage = '';
    if (typeof showPushToast === 'function') showPushToast(`신규 ${savedCount}명 · 수정 ${updatedCount}명 처리했어요.`);
    else alert(`신규 ${savedCount}명 · 수정 ${updatedCount}명 처리했어요.`);
  } catch (err) {
    studentBulkImportState.errorMessage = String(err && (err.message || err) || '학생 등록에 실패했어요.');
  } finally {
    studentBulkImportState.importRunning = false;
    refreshSettingsAttendancePhotoImportDetail();
    hideStudentBulkApplyOverlay();
  }
}


function formatExistingFeedbackImportFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (!size) return '';
  if (size < 1024) return size + 'B';
  if (size < 1024 * 1024) return Math.round(size / 1024) + 'KB';
  return (size / 1024 / 1024).toFixed(1) + 'MB';
}

function openExistingFeedbackImportPicker() {
  const input = document.getElementById('existingFeedbackImportInput');
  if (input) input.click();
}

function isExistingFeedbackTextReadableFile(file) {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  return type.startsWith('text/') || /\.(txt|md|csv|json)$/i.test(name);
}


function isExistingFeedbackDocxFile(file) {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  return /\.docx$/i.test(name) || type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

function readFileAsArrayBufferForExistingFeedback(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('파일을 읽지 못했습니다.'));
    reader.readAsArrayBuffer(file);
  });
}

function decodeExistingFeedbackXmlEntities(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function extractExistingFeedbackTextFromDocxXml(xmlText) {
  const xml = String(xmlText || '');
  const paragraphs = xml.match(/<w:p[\s\S]*?<\/w:p>/g) || [];
  const lines = paragraphs.map(paragraph => {
    const chunks = [];
    paragraph.replace(/<w:tab\s*\/?\s*>/g, '\t')
      .replace(/<w:br\s*\/?\s*>/g, '\n')
      .replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g, (_, value) => {
        chunks.push(decodeExistingFeedbackXmlEntities(value));
        return '';
      });
    return chunks.join('').trim();
  }).filter(Boolean);

  if (lines.length) return lines.join('\n');

  return decodeExistingFeedbackXmlEntities(
    xml
      .replace(/<w:tab\s*\/?\s*>/g, '\t')
      .replace(/<w:br\s*\/?\s*>/g, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

async function inflateExistingFeedbackZipEntry(bytes, method) {
  if (method === 0) return bytes;
  if (method !== 8) throw new Error('지원하지 않는 docx 압축 방식입니다.');
  if (typeof DecompressionStream !== 'function') {
    throw new Error('이 브라우저에서는 docx 압축 해제가 지원되지 않습니다. txt로 저장해 다시 업로드해 주세요.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

function findExistingFeedbackZipEndOfCentralDirectory(view) {
  const minOffset = Math.max(0, view.byteLength - 66000);
  for (let offset = view.byteLength - 22; offset >= minOffset; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  return -1;
}


let existingFeedbackJSZipLoadPromise = null;
function loadExistingFeedbackJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (existingFeedbackJSZipLoadPromise) return existingFeedbackJSZipLoadPromise;
  existingFeedbackJSZipLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    script.async = true;
    script.onload = () => window.JSZip ? resolve(window.JSZip) : reject(new Error('JSZip 로드에 실패했습니다.'));
    script.onerror = () => reject(new Error('JSZip 라이브러리를 불러오지 못했습니다.'));
    document.head.appendChild(script);
  });
  return existingFeedbackJSZipLoadPromise;
}

async function extractDocxTextWithJSZipForExistingFeedback(file) {
  const JSZipLib = await loadExistingFeedbackJSZip();
  const buffer = await readFileAsArrayBufferForExistingFeedback(file);
  const zip = await JSZipLib.loadAsync(buffer);
  const xmlNames = Object.keys(zip.files || {}).filter(name => {
    return /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/i.test(name);
  });
  const orderedNames = [
    'word/document.xml',
    ...xmlNames.filter(name => name !== 'word/document.xml').sort()
  ].filter((name, index, arr) => zip.files[name] && arr.indexOf(name) === index);
  if (!orderedNames.length) throw new Error('docx 안에서 본문 XML을 찾지 못했습니다.');
  const parts = [];
  for (const name of orderedNames) {
    const xml = await zip.files[name].async('text');
    const extracted = extractExistingFeedbackTextFromDocxXml(xml).trim();
    if (extracted) parts.push(extracted);
  }
  const text = parts.join('\n\n')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) throw new Error('docx에서 텍스트를 찾지 못했습니다.');
  return text;
}

async function extractDocxTextForExistingFeedback(file) {
  try {
    return await extractDocxTextWithJSZipForExistingFeedback(file);
  } catch (jsZipErr) {
    console.warn('JSZip docx 추출 실패, 기본 추출로 재시도:', jsZipErr && (jsZipErr.message || jsZipErr));
  }
  const buffer = await readFileAsArrayBufferForExistingFeedback(file);
  const view = new DataView(buffer);
  const eocdOffset = findExistingFeedbackZipEndOfCentralDirectory(view);
  if (eocdOffset < 0) throw new Error('docx 파일 구조를 읽지 못했습니다. 파일이 손상되었거나 docx 형식이 아닙니다.');

  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  let offset = centralOffset;
  const decoder = new TextDecoder('utf-8');
  const preferredNames = new Set(['word/document.xml', 'word/header1.xml', 'word/footer1.xml']);
  const entries = [];

  for (let i = 0; i < entryCount && offset + 46 <= view.byteLength; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameBytes = new Uint8Array(buffer, offset + 46, nameLength);
    const name = decoder.decode(nameBytes);
    if (preferredNames.has(name)) {
      entries.push({ name, method, compressedSize, localHeaderOffset });
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }

  const documentEntry = entries.find(entry => entry.name === 'word/document.xml') || entries[0];
  if (!documentEntry) throw new Error('docx 안에서 본문 XML을 찾지 못했습니다.');

  const localOffset = documentEntry.localHeaderOffset;
  if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('docx 본문 위치를 읽지 못했습니다.');
  const localNameLength = view.getUint16(localOffset + 26, true);
  const localExtraLength = view.getUint16(localOffset + 28, true);
  const dataStart = localOffset + 30 + localNameLength + localExtraLength;
  const compressed = new Uint8Array(buffer, dataStart, documentEntry.compressedSize);
  const inflated = await inflateExistingFeedbackZipEntry(compressed, documentEntry.method);
  const xmlText = decoder.decode(inflated);
  const text = extractExistingFeedbackTextFromDocxXml(xmlText)
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!text) throw new Error('docx에서 텍스트를 찾지 못했습니다.');
  return text;
}

function readFileAsTextForExistingFeedback(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('파일을 읽지 못했습니다.'));
    reader.readAsText(file, 'utf-8');
  });
}

function readFileAsDataUrlForExistingFeedback(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('파일을 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });
}

async function handleExistingFeedbackImportChange(event) {
  const file = event?.target?.files && event.target.files[0] ? event.target.files[0] : null;
  if (!file) return;
  existingFeedbackImportState.fileName = file.name || '기존 피드백 파일';
  existingFeedbackImportState.fileSize = file.size || 0;
  existingFeedbackImportState.fileType = file.type || '';
  existingFeedbackImportState.fileText = '';
  existingFeedbackImportState.fileDataUrl = '';
  existingFeedbackImportState.rawReply = '';
  existingFeedbackImportState.candidates = [];
  existingFeedbackImportState.errorMessage = '';
  existingFeedbackImportState.statusMessage = '파일을 준비하고 있어요.';
  refreshSettingsAttendancePhotoImportDetail();
  try {
    if (isExistingFeedbackTextReadableFile(file)) {
      existingFeedbackImportState.fileText = await readFileAsTextForExistingFeedback(file);
      existingFeedbackImportState.statusMessage = '파일을 읽었습니다. 피드백 분석하기를 누르면 AI가 학생별 기록으로 정리합니다.';
    } else if (isExistingFeedbackDocxFile(file)) {
      try {
        existingFeedbackImportState.fileText = await extractDocxTextForExistingFeedback(file);
        existingFeedbackImportState.fileDataUrl = '';
        existingFeedbackImportState.statusMessage = 'docx에서 텍스트를 추출했습니다. 피드백 분석하기를 누르면 AI가 학생별 기록으로 정리합니다.';
      } catch (docxErr) {
        existingFeedbackImportState.fileText = '';
        existingFeedbackImportState.fileDataUrl = '';
        existingFeedbackImportState.statusMessage = '';
        existingFeedbackImportState.errorMessage = 'docx 본문 텍스트를 읽지 못했습니다. 파일을 다시 선택하거나, Google Docs에서 txt로 내려받아 업로드해 주세요. (' + String(docxErr && (docxErr.message || docxErr) || 'docx 텍스트 추출 실패') + ')';
      }
    } else {
      existingFeedbackImportState.fileDataUrl = await readFileAsDataUrlForExistingFeedback(file);
      existingFeedbackImportState.statusMessage = '문서 파일을 준비했습니다. 피드백 분석하기를 누르면 API로 문서를 보내 분석합니다.';
    }
  } catch (err) {
    existingFeedbackImportState.errorMessage = String(err && (err.message || err) || '파일을 읽지 못했어요.');
    existingFeedbackImportState.statusMessage = '';
  } finally {
    refreshSettingsAttendancePhotoImportDetail();
    if (event?.target) event.target.value = '';
  }
}

function clearExistingFeedbackImportFile() {
  existingFeedbackImportState.fileName = '';
  existingFeedbackImportState.fileSize = 0;
  existingFeedbackImportState.fileType = '';
  existingFeedbackImportState.fileText = '';
  existingFeedbackImportState.fileDataUrl = '';
  existingFeedbackImportState.rawReply = '';
  existingFeedbackImportState.candidates = [];
  existingFeedbackImportState.statusMessage = '';
  existingFeedbackImportState.errorMessage = '';
  existingFeedbackImportState.analyzing = false;
  existingFeedbackImportState.importRunning = false;
  refreshSettingsAttendancePhotoImportDetail();
}

function buildExistingFeedbackImportPromptText() {
  return '기존 피드백 파일을 학생별, 날짜별, 피드백별로 분리해 주세요.\n\n'
    + '반드시 JSON만 응답하세요. 설명 문장은 쓰지 마세요.\n\n'
    + '응답 형식:\n'
    + '{\n'
    + '  "feedbacks": [\n'
    + '    {\n'
    + '      "student_name": "학생 이름",\n'
    + '      "division": "elementary 또는 kinder. 알 수 없으면 빈 문자열",\n'
    + '      "date": "YYYY-MM-DD. 날짜가 없으면 빈 문자열",\n'
    + '      "date_label": "원문에 적힌 날짜/주차 표현",\n'
    + '      "feedback_type": "general",\n'
    + '      "content": "피드백 본문",\n'
    + '      "note": "확인이 필요한 내용"\n'
    + '    }\n'
    + '  ]\n'
    + '}\n\n'
    + '규칙:\n'
    + '- 학생 이름 단위로 묶인 기존 피드백을 각각 분리합니다.\n'
    + '- 날짜가 명확하면 YYYY-MM-DD로 변환합니다. 날짜가 불명확하면 date는 빈 문자열로 두고 date_label에 원문 표현을 남깁니다.\n'
    + '- 매주 작성된 일반 피드백은 feedback_type을 general로 둡니다.\n'
    + '- 학생 이름이 불확실하거나 날짜가 불확실하면 note에 확인 필요라고 적습니다.\n'
    + '- 피드백 본문은 원문 의미를 바꾸지 말고 그대로 유지합니다.\n'
    + '- 한 학생에게 여러 개의 피드백이 있으면 feedbacks 배열에 각각 따로 넣습니다.';
}

function normalizeExistingFeedbackDivision(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (/유치|kinder|kindergarten|5세|6세|7세/.test(raw)) return 'kinder';
  if (/초등|elementary|초\s*\d|\d\s*학년|학년/.test(raw)) return 'elementary';
  return '';
}

function normalizeExistingFeedbackDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const direct = raw.match(/(20\d{2})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2})/);
  if (direct) {
    const year = Number(direct[1]);
    const month = Number(direct[2]);
    const day = Number(direct[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return raw;
}

function extractExistingFeedbackJsonText(raw) {
  let text = String(raw || '').trim();
  if (!text) return '';
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) text = fenced[1].trim();
  const firstObject = text.indexOf('{');
  const lastObject = text.lastIndexOf('}');
  if (firstObject !== -1 && lastObject !== -1 && lastObject > firstObject) {
    return text.slice(firstObject, lastObject + 1);
  }
  const firstArray = text.indexOf('[');
  const lastArray = text.lastIndexOf(']');
  if (firstArray !== -1 && lastArray !== -1 && lastArray > firstArray) {
    return text.slice(firstArray, lastArray + 1);
  }
  return text;
}

function parseExistingFeedbackImportReply(raw) {
  const jsonText = extractExistingFeedbackJsonText(raw);
  if (!jsonText) return [];
  let parsed = null;
  try { parsed = JSON.parse(jsonText); } catch (err) {
    console.warn('기존 피드백 JSON 파싱 실패:', err);
    return [];
  }
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.feedbacks)) return parsed.feedbacks;
  if (Array.isArray(parsed.items)) return parsed.items;
  if (Array.isArray(parsed.results)) return parsed.results;
  return [];
}

function getExistingFeedbackActiveStudents() {
  return getAllStudents().filter(student => getStudentStatus(student) === 'active');
}

function findExistingFeedbackMatchedStudent(candidate) {
  const name = String(candidate?.student_name || '').trim();
  if (!name) return null;
  const division = normalizeExistingFeedbackDivision(candidate?.division || '');
  let matches = getExistingFeedbackActiveStudents().filter(student => String(student.name || '').trim() === name);
  if (division) matches = matches.filter(student => normalizeAttendancePhotoDivision(student.type) === division);
  return matches.length === 1 ? matches[0] : null;
}

function getExistingFeedbackStudentOptionLabel(student) {
  const division = normalizeAttendancePhotoDivision(student?.type) === 'kinder' ? '유치부' : '초등부';
  const meta = normalizeAttendancePhotoDivision(student?.type) === 'kinder'
    ? [student?.kindergarten, student?.age ? String(student.age).replace(/세$/, '') + '세' : ''].filter(Boolean).join(' · ')
    : [student?.school, student?.grade ? String(student.grade).replace(/학년$/, '') + '학년' : '', student?.group ? String(student.group).replace(/^([1-6])$/, function(_, g) { return ['','A','B','C','D','E','F'][Number(g)] || g; }) : ''].filter(Boolean).join(' · ');
  return `${student?.name || '이름 없음'} · ${division}${meta ? ' · ' + meta : ''}`;
}

function normalizeExistingFeedbackCandidate(item = {}, index = 0) {
  const studentName = String(item.student_name || item.name || item.student || '').trim();
  const division = normalizeExistingFeedbackDivision(item.division || item.type || item.student_type || item.category || '');
  const candidate = {
    id: item.id || `existing_feedback_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
    selected: item.selected !== false,
    student_id: String(item.student_id || '').trim(),
    student_name: studentName,
    division,
    date: normalizeExistingFeedbackDate(item.date || item.feedback_date || item.created_at || ''),
    date_label: String(item.date_label || item.week_label || item.original_date || '').trim(),
    feedback_type: String(item.feedback_type || item.type_label || 'general').trim() || 'general',
    content: String(item.content || item.feedback || item.text || item.body || '').trim(),
    note: String(item.note || item.memo || item.warning || '').trim()
  };
  if (!candidate.student_id) {
    const matched = findExistingFeedbackMatchedStudent(candidate);
    if (matched?.id) {
      candidate.student_id = matched.id;
      candidate.division = normalizeAttendancePhotoDivision(matched.type);
      candidate.student_name = matched.name || candidate.student_name;
    }
  }
  return candidate;
}

function normalizeExistingFeedbackCandidates(list) {
  return (Array.isArray(list) ? list : [])
    .map((item, index) => normalizeExistingFeedbackCandidate(item, index))
    .filter(item => item.student_name || item.content);
}

const EXISTING_FEEDBACK_IMPORT_CHUNK_CHAR_LIMIT = 6500;

function splitExistingFeedbackImportText(text, limit = EXISTING_FEEDBACK_IMPORT_CHUNK_CHAR_LIMIT) {
  const source = String(text || '').replace(/\r/g, '').trim();
  if (!source) return [];
  if (source.length <= limit) return [source];

  const chunks = [];
  let cursor = 0;
  while (cursor < source.length) {
    let end = Math.min(source.length, cursor + limit);
    if (end < source.length) {
      const paragraphBreak = source.lastIndexOf('\n\n', end);
      const lineBreak = source.lastIndexOf('\n', end);
      const breakPoint = paragraphBreak > cursor + Math.floor(limit * 0.45)
        ? paragraphBreak
        : (lineBreak > cursor + Math.floor(limit * 0.45) ? lineBreak : end);
      end = breakPoint;
    }
    const chunk = source.slice(cursor, end).trim();
    if (chunk) chunks.push(chunk);
    cursor = end;
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
  }
  return chunks;
}


function normalizeExistingFeedbackStudentNameMatchText(value) {
  return String(value || '')
    .replace(/[\s\u00a0]+/g, '')
    .replace(/[\[\]\(\){}<>〈〉《》『』「」“”\"'‘’·•\-_:：|]/g, '')
    .trim();
}

function cleanExistingFeedbackPotentialHeadingLine(value) {
  return String(value || '')
    .replace(/^\s*[\-–—*•·●○◎◇◆□■▶▷▸▹①-⑳0-9.\)\]]+\s*/, '')
    .replace(/\s*(학생|원생|어린이|아동|유치부|초등부|피드백|기록|상담)\s*[:：\-–—]?\s*$/g, '')
    .replace(/^\s*(학생|원생|이름)\s*[:：]\s*/g, '')
    .trim();
}

function getExistingFeedbackStudentNameEntries() {
  const map = new Map();
  getExistingFeedbackActiveStudents().forEach(student => {
    const name = String(student?.name || '').trim();
    if (!name) return;
    const normalized = normalizeExistingFeedbackStudentNameMatchText(name);
    if (!normalized) return;
    if (!map.has(normalized)) map.set(normalized, []);
    map.get(normalized).push(student);
  });
  return Array.from(map.entries()).map(([normalized, students]) => ({
    normalized,
    name: String(students[0]?.name || '').trim(),
    students,
    student: students.length === 1 ? students[0] : null
  })).sort((a, b) => b.normalized.length - a.normalized.length);
}

function findExistingFeedbackStudentHeading(line, entries) {
  const raw = String(line || '').trim();
  if (!raw) return null;
  if (raw.length > 36) return null;
  const cleaned = cleanExistingFeedbackPotentialHeadingLine(raw);
  if (!cleaned || cleaned.length > 24) return null;
  const normalized = normalizeExistingFeedbackStudentNameMatchText(cleaned);
  if (!normalized) return null;
  return entries.find(entry => entry.normalized === normalized) || null;
}

function splitExistingFeedbackImportTextByStudent(text) {
  const source = String(text || '').replace(/\r/g, '').trim();
  if (!source) return [];
  const entries = getExistingFeedbackStudentNameEntries();
  if (!entries.length) return [];
  const lines = source.split('\n');
  const sections = [];
  let current = null;
  let introLines = [];
  lines.forEach((line) => {
    const heading = findExistingFeedbackStudentHeading(line, entries);
    if (heading) {
      if (current && current.lines.join('\n').trim()) sections.push(current);
      current = {
        id: 'student_section_' + sections.length + '_' + Math.random().toString(36).slice(2, 7),
        student_name: heading.name,
        student_id: heading.student?.id || '',
        division: heading.student ? normalizeAttendancePhotoDivision(heading.student.type) : '',
        duplicateName: heading.students.length > 1,
        headingLine: String(line || '').trim(),
        lines: []
      };
      return;
    }
    if (current) current.lines.push(line);
    else introLines.push(line);
  });
  if (current && current.lines.join('\n').trim()) sections.push(current);
  const cleaned = sections.map(section => {
    const content = section.lines.join('\n').replace(/^\s+|\s+$/g, '').replace(/\n{4,}/g, '\n\n\n');
    return { ...section, content, length: content.length };
  }).filter(section => section.content.trim().length >= 12);
  const intro = introLines.join('\n').trim();
  if (intro && cleaned.length) {
    cleaned[0].content = intro + '\n\n' + cleaned[0].content;
    cleaned[0].length = cleaned[0].content.length;
  }
  return cleaned;
}

function buildExistingFeedbackStudentSectionText(section, index = 0, total = 0) {
  const name = String(section?.student_name || '').trim();
  const divisionLabel = section?.division === 'kinder' ? '유치부' : (section?.division === 'elementary' ? '초등부' : '미확인');
  return '[학생별 원문 구간' + (total ? ' ' + index + '/' + total : '') + ']\n'
    + '학생명: ' + name + '\n'
    + '구분: ' + divisionLabel + '\n'
    + (section?.student_id ? '앱 학생ID: ' + section.student_id + '\n' : '')
    + (section?.duplicateName ? '동명이인 가능: 있음. 앱 저장 전 학생 연결을 반드시 확인해야 합니다.\n' : '')
    + '\n[원문]\n'
    + String(section?.content || '').trim();
}

function buildExistingFeedbackStudentAnalysisUnits(fullText) {
  const sections = splitExistingFeedbackImportTextByStudent(fullText);
  if (sections.length < 2) return [];
  const units = [];
  let currentSections = [];
  let currentLength = 0;
  const total = sections.length;
  const limit = EXISTING_FEEDBACK_IMPORT_CHUNK_CHAR_LIMIT;
  sections.forEach((section, index) => {
    const sectionText = buildExistingFeedbackStudentSectionText(section, index + 1, total);
    if (sectionText.length > limit) {
      if (currentSections.length) {
        units.push({
          type: 'student_batch',
          sections: currentSections,
          text: currentSections.map(item => item.text).join('\n\n---\n\n'),
          studentNames: currentSections.map(item => item.section.student_name).filter(Boolean)
        });
        currentSections = [];
        currentLength = 0;
      }
      const splitChunks = splitExistingFeedbackImportText(section.content, Math.max(3600, Math.floor(limit * 0.72)));
      splitChunks.forEach((chunk, chunkIndex) => {
        units.push({
          type: 'student_split',
          sections: [section],
          text: buildExistingFeedbackStudentSectionText({ ...section, content: chunk }, chunkIndex + 1, splitChunks.length),
          studentNames: [section.student_name].filter(Boolean),
          studentName: section.student_name,
          studentId: section.student_id || '',
          chunkPart: chunkIndex + 1,
          chunkPartTotal: splitChunks.length
        });
      });
      return;
    }
    const nextLength = currentLength + (currentSections.length ? 8 : 0) + sectionText.length;
    if (currentSections.length && nextLength > limit) {
      units.push({
        type: 'student_batch',
        sections: currentSections,
        text: currentSections.map(item => item.text).join('\n\n---\n\n'),
        studentNames: currentSections.map(item => item.section.student_name).filter(Boolean)
      });
      currentSections = [];
      currentLength = 0;
    }
    currentSections.push({ section, text: sectionText });
    currentLength += (currentLength ? 8 : 0) + sectionText.length;
  });
  if (currentSections.length) {
    units.push({
      type: 'student_batch',
      sections: currentSections,
      text: currentSections.map(item => item.text).join('\n\n---\n\n'),
      studentNames: currentSections.map(item => item.section.student_name).filter(Boolean)
    });
  }
  return units;
}

function buildExistingFeedbackFallbackAnalysisUnits(fullText) {
  return splitExistingFeedbackImportText(fullText).map((chunk, index, arr) => ({
    type: 'text_chunk',
    text: chunk,
    studentNames: [],
    chunkPart: index + 1,
    chunkPartTotal: arr.length
  }));
}

function getExistingFeedbackImportAnalysisUnits(fullText) {
  const source = String(fullText || '').trim();
  if (!source) return [];
  const studentUnits = buildExistingFeedbackStudentAnalysisUnits(source);
  if (studentUnits.length) return studentUnits;
  return buildExistingFeedbackFallbackAnalysisUnits(source);
}

async function analyzeExistingFeedbackImportUnit(unit, index, total) {
  const chunkInfo = {
    index,
    total,
    type: unit?.type || 'text_chunk',
    studentNames: Array.isArray(unit?.studentNames) ? unit.studentNames : [],
    studentName: unit?.studentName || '',
    studentId: unit?.studentId || '',
    chunkPart: unit?.chunkPart || 0,
    chunkPartTotal: unit?.chunkPartTotal || 0
  };
  const result = await requestExistingFeedbackImportPayloads(buildExistingFeedbackImportPayloads(unit?.text || '', chunkInfo));
  const parsed = parseExistingFeedbackImportReply(result.reply);
  return { reply: result.reply, candidates: normalizeExistingFeedbackCandidates(parsed) };
}

async function analyzeExistingFeedbackImportUnitWithFallback(unit, index, total) {
  try {
    return await analyzeExistingFeedbackImportUnit(unit, index, total);
  } catch (err) {
    if (Number(err?.status) !== 413) throw err;
    const text = String(unit?.text || '').trim();
    const subChunks = splitExistingFeedbackImportText(text, 3600);
    if (subChunks.length <= 1) throw err;
    const replies = [];
    const candidates = [];
    for (let i = 0; i < subChunks.length; i++) {
      existingFeedbackImportState.statusMessage = '한 학생 구간이 길어서 더 작게 나누어 분석하고 있어요. ' + (i + 1) + '/' + subChunks.length;
      refreshSettingsAttendancePhotoImportDetail();
      const subUnit = { ...unit, text: subChunks[i], type: (unit?.type || 'student_batch') + '_small', chunkPart: i + 1, chunkPartTotal: subChunks.length };
      const subResult = await analyzeExistingFeedbackImportUnit(subUnit, i + 1, subChunks.length);
      replies.push('[SUB CHUNK ' + (i + 1) + '/' + subChunks.length + ']\n' + subResult.reply);
      candidates.push(...subResult.candidates);
    }
    return { reply: replies.join('\n\n---\n\n'), candidates };
  }
}

function buildExistingFeedbackImportPayloads(textOverride = null, chunkInfo = null) {
  const prompt = buildExistingFeedbackImportPromptText();
  const fileName = existingFeedbackImportState.fileName || '';
  const fileType = existingFeedbackImportState.fileType || '';
  const hasTextOverride = textOverride !== null && textOverride !== undefined;
  const fileText = String(hasTextOverride ? textOverride : existingFeedbackImportState.fileText || '').trim();
  const fileDataUrl = hasTextOverride ? '' : String(existingFeedbackImportState.fileDataUrl || '').trim();
  const studentNames = Array.isArray(chunkInfo?.studentNames) ? chunkInfo.studentNames.filter(Boolean) : [];
  const studentHint = studentNames.length
    ? '\n\n[학생 구간 안내]\n이 요청에는 다음 학생 구간이 포함되어 있습니다: ' + studentNames.join(', ') + '\n각 피드백의 student_name은 해당 학생 이름으로 작성하세요. 다른 학생의 기록을 섞지 마세요.'
    : (chunkInfo?.studentName ? '\n\n[학생 구간 안내]\n이 요청은 ' + chunkInfo.studentName + ' 학생의 긴 구간 중 일부입니다. student_name은 반드시 ' + chunkInfo.studentName + '으로 작성하세요.' : '');
  const chunkGuide = chunkInfo && chunkInfo.total > 1
    ? '\n\n[분할 분석 안내]\n이 문서는 용량 제한 때문에 여러 조각으로 나누어 분석합니다. 현재 조각은 ' + chunkInfo.index + '/' + chunkInfo.total + '입니다. 이 조각 안에서 확인 가능한 피드백만 JSON으로 반환하세요. 같은 피드백을 반복해서 만들지 마세요.' + studentHint
    : studentHint;
  const textContent = fileText
    ? prompt + chunkGuide + '\n\n[파일명]\n' + fileName + '\n\n[기존 피드백 원문' + (chunkInfo && chunkInfo.total > 1 ? ' ' + chunkInfo.index + '/' + chunkInfo.total : '') + ']\n' + fileText
    : prompt + '\n\n[파일명]\n' + fileName + '\n\n[문서 파일 안내]\n첨부된 fileDataUrl 또는 files 배열의 문서 내용을 읽고 기존 피드백을 학생별·날짜별로 분리해 주세요.';
  const basePayload = {
    feature: 'existingFeedbackImport',
    fileName,
    fileType,
    fileSize: existingFeedbackImportState.fileSize || 0,
    chunkIndex: chunkInfo ? chunkInfo.index : null,
    chunkTotal: chunkInfo ? chunkInfo.total : null,
    messages: [{ role: 'user', content: textContent }]
  };
  if (fileDataUrl) {
    basePayload.fileDataUrl = fileDataUrl;
    basePayload.file = { name: fileName, type: fileType, dataUrl: fileDataUrl };
    basePayload.files = [{ name: fileName, type: fileType, dataUrl: fileDataUrl }];
  }
  return [
    { ...basePayload, promptType: 'existing_feedback_import' },
    { ...basePayload, promptType: 'summary' }
  ];
}

async function requestExistingFeedbackImportPayloads(payloads) {
  let result = null;
  let lastError = null;
  for (const payload of payloads) {
    try {
      result = await postExistingFeedbackImportPayload(payload);
      break;
    } catch (err) {
      lastError = err;
      if (err.status && err.status !== 400 && err.status !== 415) break;
    }
  }
  if (!result) throw lastError || new Error('기존 피드백 분석 요청에 실패했어요.');
  return result;
}

function getExistingFeedbackCandidateDedupeKey(candidate) {
  const name = String(candidate?.student_name || '').replace(/\s+/g, '');
  const date = String(candidate?.date || candidate?.date_label || '').replace(/\s+/g, '');
  const content = String(candidate?.content || '').replace(/\s+/g, '').slice(0, 120);
  return [name, date, content].join('|');
}

function dedupeExistingFeedbackCandidates(candidates) {
  const seen = new Set();
  const result = [];
  (Array.isArray(candidates) ? candidates : []).forEach(candidate => {
    const key = getExistingFeedbackCandidateDedupeKey(candidate);
    if (!key.replace(/\|/g, '')) return;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(candidate);
  });
  return result;
}

async function postExistingFeedbackImportPayload(payload) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const raw = await res.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { reply: raw, raw }; }
  if (!res.ok) {
    const error = new Error((data && (data.message || data.error || data.details)) || getApiErrorMessage?.(res.status, data) || ('분석 요청 실패 (' + res.status + ')'));
    error.status = res.status;
    error.data = data;
    throw error;
  }
  const reply = String(data?.reply || data?.content || data?.raw || raw || '').trim();
  return { data, raw, reply };
}

async function requestExistingFeedbackImportAnalysis() {
  if (existingFeedbackImportState.analyzing) return;
  if (!existingFeedbackImportState.fileName) {
    if (typeof showPushToast === 'function') showPushToast('먼저 기존 피드백 파일을 선택해 주세요.');
    else alert('먼저 기존 피드백 파일을 선택해 주세요.');
    return;
  }
  if (!String(existingFeedbackImportState.fileText || '').trim() && !String(existingFeedbackImportState.fileDataUrl || '').trim()) {
    existingFeedbackImportState.errorMessage = '분석할 파일 내용이 없습니다. 파일을 다시 선택해 주세요.';
    refreshSettingsAttendancePhotoImportDetail();
    return;
  }
  if (isExistingFeedbackDocxFile({ name: existingFeedbackImportState.fileName, type: existingFeedbackImportState.fileType }) && !String(existingFeedbackImportState.fileText || '').trim()) {
    existingFeedbackImportState.errorMessage = 'docx 본문 텍스트를 아직 읽지 못했습니다. 파일을 다시 선택하거나, Google Docs에서 txt로 내려받아 업로드해 주세요.';
    refreshSettingsAttendancePhotoImportDetail();
    return;
  }
  existingFeedbackImportState.analyzing = true;
  existingFeedbackImportState.errorMessage = '';
  existingFeedbackImportState.rawReply = '';
  existingFeedbackImportState.candidates = [];
  existingFeedbackImportState.statusMessage = '원생 이름 기준으로 문서를 나눈 뒤 AI가 학생별·날짜별로 정리하고 있어요.';
  refreshSettingsAttendancePhotoImportDetail();
  try {
    const fullText = String(existingFeedbackImportState.fileText || '').trim();
    if (fullText) {
      const units = getExistingFeedbackImportAnalysisUnits(fullText);
      const allCandidates = [];
      const rawReplies = [];
      const studentSectionCount = splitExistingFeedbackImportTextByStudent(fullText).length;
      for (let i = 0; i < units.length; i++) {
        const unit = units[i];
        const names = Array.isArray(unit.studentNames) && unit.studentNames.length ? ` (${unit.studentNames.join(', ')})` : '';
        existingFeedbackImportState.statusMessage = studentSectionCount >= 2
          ? `학생별로 나누어 분석하고 있어요. ${i + 1}/${units.length}번째${names}`
          : `파일이 커서 나누어 분석하고 있어요. ${i + 1}/${units.length}번째`;
        refreshSettingsAttendancePhotoImportDetail();
        const result = await analyzeExistingFeedbackImportUnitWithFallback(unit, i + 1, units.length);
        rawReplies.push(`[UNIT ${i + 1}/${units.length}${names}]\n` + result.reply);
        allCandidates.push(...result.candidates);
      }
      existingFeedbackImportState.rawReply = rawReplies.join('\n\n---\n\n');
      existingFeedbackImportState.candidates = dedupeExistingFeedbackCandidates(allCandidates);
    } else {
      const result = await requestExistingFeedbackImportPayloads(buildExistingFeedbackImportPayloads());
      existingFeedbackImportState.rawReply = result.reply;
      const parsed = parseExistingFeedbackImportReply(result.reply);
      existingFeedbackImportState.candidates = normalizeExistingFeedbackCandidates(parsed);
    }
    existingFeedbackImportState.statusMessage = existingFeedbackImportState.candidates.length
      ? `분석 결과 ${existingFeedbackImportState.candidates.length}개의 피드백 후보를 찾았습니다. 검수 후 저장해 주세요.`
      : '분석 결과를 받았지만 피드백 후보를 찾지 못했습니다. 원문 형식이나 서버 응답을 확인해 주세요.';
  } catch (err) {
    const status = Number(err && err.status);
    existingFeedbackImportState.errorMessage = status === 413
      ? '요청 용량이 너무 큽니다. 앱에서 파일을 더 작게 나누어 보내도록 수정했지만, 이 메시지가 계속 나오면 원본을 학생별 또는 월별로 나누어 업로드해 주세요.'
      : String(err && (err.message || err) || '기존 피드백 분석에 실패했어요.');
    existingFeedbackImportState.statusMessage = '';
  } finally {
    existingFeedbackImportState.analyzing = false;
    refreshSettingsAttendancePhotoImportDetail();
  }
}

function renderExistingFeedbackCandidateStudentSelect(candidate, index) {
  const students = getExistingFeedbackActiveStudents().slice().sort((a, b) => {
    const sameNameA = String(a.name || '').trim() === String(candidate.student_name || '').trim() ? 0 : 1;
    const sameNameB = String(b.name || '').trim() === String(candidate.student_name || '').trim() ? 0 : 1;
    if (sameNameA !== sameNameB) return sameNameA - sameNameB;
    const divA = normalizeAttendancePhotoDivision(a.type) === normalizeExistingFeedbackDivision(candidate.division) ? 0 : 1;
    const divB = normalizeAttendancePhotoDivision(b.type) === normalizeExistingFeedbackDivision(candidate.division) ? 0 : 1;
    if (divA !== divB) return divA - divB;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
  });
  const options = ['<option value="">학생 선택 필요</option>'].concat(students.map(student => {
    const selected = String(candidate.student_id || '') === String(student.id || '') ? ' selected' : '';
    return '<option value="' + settingsEscapeAttr(student.id || '') + '"' + selected + '>' + settingsEscapeHtml(getExistingFeedbackStudentOptionLabel(student)) + '</option>';
  })).join('');
  return '<div class="studentBulkCandidateField full"><div class="studentBulkCandidateLabel">앱 원생 연결</div>'
    + '<select class="existingFeedbackCandidateStudentSelect" onchange="updateExistingFeedbackCandidateField(' + index + ',\'student_id\',this.value)">' + options + '</select></div>';
}

function renderExistingFeedbackCandidateField(index, field, label, value, options = {}) {
  const safeValue = settingsEscapeAttr(value || '');
  const full = options.full ? ' full' : '';
  if (options.type === 'select') {
    const selectedElementary = normalizeExistingFeedbackDivision(value) === 'elementary' ? ' selected' : '';
    const selectedKinder = normalizeExistingFeedbackDivision(value) === 'kinder' ? ' selected' : '';
    const selectedUnknown = normalizeExistingFeedbackDivision(value) ? '' : ' selected';
    return '<div class="studentBulkCandidateField' + full + '"><div class="studentBulkCandidateLabel">' + label + '</div>'
      + '<select class="studentBulkCandidateSelect" onchange="updateExistingFeedbackCandidateField(' + index + ',\'' + field + '\',this.value)">'
      + '<option value=""' + selectedUnknown + '>미확인</option>'
      + '<option value="elementary"' + selectedElementary + '>초등부</option>'
      + '<option value="kinder"' + selectedKinder + '>유치부</option>'
      + '</select></div>';
  }
  if (options.type === 'textarea') {
    return '<div class="studentBulkCandidateField' + full + '"><div class="studentBulkCandidateLabel">' + label + '</div>'
      + '<textarea class="existingFeedbackCandidateTextArea" oninput="updateExistingFeedbackCandidateField(' + index + ',\'' + field + '\',this.value)" placeholder="' + settingsEscapeAttr(options.placeholder || '') + '">' + settingsEscapeHtml(value || '') + '</textarea></div>';
  }
  return '<div class="studentBulkCandidateField' + full + '"><div class="studentBulkCandidateLabel">' + label + '</div>'
    + '<input class="studentBulkCandidateInput" value="' + safeValue + '" oninput="updateExistingFeedbackCandidateField(' + index + ',\'' + field + '\',this.value)" placeholder="' + settingsEscapeAttr(options.placeholder || '') + '">'
    + '</div>';
}

function getExistingFeedbackCandidateStatus(candidate) {
  if (!String(candidate?.student_name || '').trim()) return { type: 'warn', label: '이름 확인' };
  if (!String(candidate?.student_id || '').trim()) return { type: 'warn', label: '학생 연결 필요' };
  if (!String(candidate?.date || '').trim()) return { type: 'warn', label: '날짜 확인' };
  if (!String(candidate?.content || '').trim()) return { type: 'warn', label: '내용 없음' };
  return { type: '', label: '저장 가능' };
}

function renderExistingFeedbackCandidateCard(candidate, index) {
  const status = getExistingFeedbackCandidateStatus(candidate);
  const badgeClass = status.type ? ' ' + status.type : '';
  return '<div class="studentBulkCandidateCard">'
    + '<div class="studentBulkCandidateTop">'
    + '<label class="studentBulkCandidateCheck"><input type="checkbox" ' + (candidate.selected ? 'checked' : '') + ' onchange="toggleExistingFeedbackCandidate(' + index + ',this.checked)">저장 선택</label>'
    + '<span class="studentBulkCandidateTopRight"><span class="attendancePhotoCandidateBadge' + badgeClass + '">' + settingsEscapeHtml(status.label) + '</span><button class="studentBulkCandidateDeleteBtn danger" type="button" onclick="removeExistingFeedbackCandidate(' + index + ')">삭제</button></span>'
    + '</div>'
    + '<div class="studentBulkCandidateGrid">'
    + renderExistingFeedbackCandidateStudentSelect(candidate, index)
    + renderExistingFeedbackCandidateField(index, 'student_name', '학생명', candidate.student_name)
    + renderExistingFeedbackCandidateField(index, 'division', '구분', candidate.division, { type: 'select' })
    + renderExistingFeedbackCandidateField(index, 'date', '날짜', candidate.date, { placeholder: 'YYYY-MM-DD' })
    + renderExistingFeedbackCandidateField(index, 'date_label', '원문 날짜', candidate.date_label)
    + renderExistingFeedbackCandidateField(index, 'content', '피드백 내용', candidate.content, { type: 'textarea', full: true })
    + renderExistingFeedbackCandidateField(index, 'note', '확인 메모', candidate.note, { full: true })
    + '</div>'
    + '</div>';
}

function renderExistingFeedbackImportResults() {
  const list = existingFeedbackImportState.candidates || [];
  if (!list.length) return '';
  const selectedCount = list.filter(item => item.selected && String(item.content || '').trim()).length;
  return '<div class="settingsInfoCard"><div class="settingsInfoHead">피드백 후보 확인</div>'
    + '<div class="attendancePhotoResultSummary"><span class="attendancePhotoResultCount">후보 ' + list.length + '개 · 저장 선택 ' + selectedCount + '개</span><span class="studentBulkCandidateTopRight"><button class="settingsActionBtn" type="button" onclick="setAllExistingFeedbackCandidatesChecked(true)">전체 선택</button><button class="settingsActionBtn" type="button" onclick="removeSelectedExistingFeedbackCandidates()">선택 삭제</button><button class="settingsActionBtn" type="button" onclick="clearExistingFeedbackCandidates()">전체 삭제</button></span></div>'
    + '<div class="studentBulkCandidateList">' + list.map(renderExistingFeedbackCandidateCard).join('') + '</div>'
    + '<div class="attendancePhotoActionGrid single"><button class="settingsActionBtn primary" type="button" onclick="importExistingFeedbackCandidates()">선택한 피드백 앱에 저장</button></div>'
    + '</div>';
}

function updateExistingFeedbackCandidateField(index, field, value) {
  const item = existingFeedbackImportState.candidates[index];
  if (!item) return;
  if (field === 'division') item[field] = normalizeExistingFeedbackDivision(value);
  else if (field === 'date') item[field] = normalizeExistingFeedbackDate(value);
  else item[field] = String(value || '').trim();
  if (field === 'student_id') {
    const student = getAllStudents().find(s => String(s.id || '') === String(value || '')) || null;
    if (student) {
      item.student_name = student.name || item.student_name;
      item.division = normalizeAttendancePhotoDivision(student.type);
    }
  } else if (field === 'student_name' || field === 'division') {
    if (!item.student_id) {
      const matched = findExistingFeedbackMatchedStudent(item);
      if (matched?.id) item.student_id = matched.id;
    }
  }
  refreshSettingsAttendancePhotoImportDetail();
}

function toggleExistingFeedbackCandidate(index, checked) {
  const item = existingFeedbackImportState.candidates[index];
  if (!item) return;
  item.selected = !!checked;
}

function setAllExistingFeedbackCandidatesChecked(checked) {
  existingFeedbackImportState.candidates.forEach(item => { item.selected = !!checked; });
  refreshSettingsAttendancePhotoImportDetail();
}

function removeExistingFeedbackCandidate(index) {
  if (!Array.isArray(existingFeedbackImportState.candidates)) return;
  const safeIndex = Number(index);
  if (!Number.isFinite(safeIndex) || safeIndex < 0 || safeIndex >= existingFeedbackImportState.candidates.length) return;
  existingFeedbackImportState.candidates.splice(safeIndex, 1);
  refreshSettingsAttendancePhotoImportDetail();
}

function removeSelectedExistingFeedbackCandidates() {
  const before = Array.isArray(existingFeedbackImportState.candidates) ? existingFeedbackImportState.candidates.length : 0;
  if (!before) return;
  const next = existingFeedbackImportState.candidates.filter(item => !item.selected);
  if (next.length === before) {
    if (typeof showPushToast === 'function') showPushToast('삭제할 피드백 후보를 선택해 주세요.');
    else alert('삭제할 피드백 후보를 선택해 주세요.');
    return;
  }
  existingFeedbackImportState.candidates = next;
  refreshSettingsAttendancePhotoImportDetail();
}

function clearExistingFeedbackCandidates() {
  if (!Array.isArray(existingFeedbackImportState.candidates) || !existingFeedbackImportState.candidates.length) {
    if (typeof showPushToast === 'function') showPushToast('삭제할 피드백 후보가 없습니다.');
    else alert('삭제할 피드백 후보가 없습니다.');
    return;
  }
  const ok = confirm('피드백 후보를 모두 삭제할까요?');
  if (!ok) return;
  existingFeedbackImportState.candidates = [];
  existingFeedbackImportState.errorMessage = '';
  refreshSettingsAttendancePhotoImportDetail();
}

function getExistingFeedbackCandidateSaveDate(candidate) {
  const raw = String(candidate?.date || '').trim();
  if (!raw) return '';
  return normalizeExistingFeedbackDate(raw);
}

function getExistingFeedbackCandidateSaveYear(candidate) {
  const date = getExistingFeedbackCandidateSaveDate(candidate);
  const match = String(date || '').match(/(20\d{2})/);
  return match ? Number(match[1]) : new Date().getFullYear();
}

async function importExistingFeedbackCandidates() {
  if (existingFeedbackImportState.importRunning) return;
  const selected = existingFeedbackImportState.candidates.filter(item => item.selected);
  if (!selected.length) {
    if (typeof showPushToast === 'function') showPushToast('저장할 피드백을 선택해 주세요.');
    else alert('저장할 피드백을 선택해 주세요.');
    return;
  }
  const invalid = selected.filter(item => {
    const status = getExistingFeedbackCandidateStatus(item);
    return status.label !== '저장 가능';
  });
  if (invalid.length) {
    existingFeedbackImportState.errorMessage = '학생 연결, 날짜, 피드백 내용이 빠진 후보가 있습니다. 검수 후 다시 저장해 주세요.';
    refreshSettingsAttendancePhotoImportDetail();
    return;
  }
  existingFeedbackImportState.importRunning = true;
  existingFeedbackImportState.errorMessage = '';
  existingFeedbackImportState.statusMessage = '기존 피드백을 앱에 저장하고 있어요.';
  refreshSettingsAttendancePhotoImportDetail();
  const savedIds = new Set();
  const errors = [];
  try {
    for (const candidate of selected) {
      try {
        const student = getAllStudents().find(item => String(item.id || '') === String(candidate.student_id || ''));
        if (!student) throw new Error(`${candidate.student_name || '학생'} 원생 연결을 찾지 못했습니다.`);
        const content = String(candidate.content || '').trim();
        const date = getExistingFeedbackCandidateSaveDate(candidate);
        const payload = addOlliAcademyToPayload({
          student_id: student.id,
          student_name: student.name || candidate.student_name,
          content,
          feedback_type: 'general',
          year: getExistingFeedbackCandidateSaveYear(candidate),
          date
        }, '기존 피드백 가져오기');
        await saveFeedbackRowVerified('feedbacks', payload, '기존 피드백 가져오기');
        savedIds.add(candidate.id);
      } catch (err) {
        errors.push((candidate.student_name || '이름 없음') + ': ' + String(err && (err.message || err) || '저장 실패'));
      }
    }
    existingFeedbackImportState.candidates = existingFeedbackImportState.candidates.filter(item => !savedIds.has(item.id));
    try { await loadStudentsFromSupabase(); } catch(e) {}
    try {
      const searchValue = document.getElementById('searchName')?.value?.trim() || '';
      if (typeof loadRecords === 'function') await loadRecords(searchValue);
    } catch(e) {}
    
    existingFeedbackImportState.statusMessage = savedIds.size
      ? `${savedIds.size}개의 기존 피드백을 앱에 저장했습니다.`
      : '';
    existingFeedbackImportState.errorMessage = errors.length ? errors.slice(0, 5).join('\n') + (errors.length > 5 ? '\n...' : '') : '';
    if (savedIds.size && typeof showPushToast === 'function') showPushToast(`${savedIds.size}개의 피드백을 저장했어요.`);
  } finally {
    existingFeedbackImportState.importRunning = false;
    refreshSettingsAttendancePhotoImportDetail();
  }
}

function renderSettingsExistingFeedbackImport() {
  const hasFile = !!existingFeedbackImportState.fileName;
  const fileSize = formatExistingFeedbackImportFileSize(existingFeedbackImportState.fileSize);
  const title = hasFile ? existingFeedbackImportState.fileName : '기존 피드백 파일 업로드';
  const extractedTextLength = String(existingFeedbackImportState.fileText || '').trim().length;
  const desc = hasFile
    ? ((fileSize ? fileSize + ' · ' : '') + (extractedTextLength ? ('본문 ' + extractedTextLength.toLocaleString('ko-KR') + '자 추출됨') : '기존 피드백 파일입니다.'))
    : '학생별로 정리해둔 기존 피드백 문서나 텍스트 파일을 올릴 수 있어요.';
  const status = existingFeedbackImportState.statusMessage
    ? '<div class="attendancePhotoStatusBox">' + settingsEscapeHtml(existingFeedbackImportState.statusMessage) + '</div>'
    : '';
  const error = existingFeedbackImportState.errorMessage
    ? '<div class="attendancePhotoStatusBox error">' + settingsEscapeHtml(existingFeedbackImportState.errorMessage) + '</div>'
    : '';
  const preview = existingFeedbackImportState.rawReply && !(existingFeedbackImportState.candidates || []).length
    ? '<div class="existingFeedbackPreviewBox">' + settingsEscapeHtml(existingFeedbackImportState.rawReply.slice(0, 1800)) + (existingFeedbackImportState.rawReply.length > 1800 ? '\n...' : '') + '</div>'
    : '';
  const analyzeLabel = existingFeedbackImportState.analyzing ? '분석 중...' : '피드백 분석하기';
  const clearLabel = existingFeedbackImportState.candidates && existingFeedbackImportState.candidates.length ? '파일/후보 지우기' : '파일 지우기';
  return '<div class="settingsInfoCard"><div class="settingsInfoHead">기존 피드백 가져오기</div></div>'
    + '<div class="existingFeedbackImportBox" onclick="openExistingFeedbackImportPicker()" role="button">'
    + '<div class="existingFeedbackImportIcon"><svg viewBox="0 0 24 24"><path d="M7 3.8h7.2L19 8.6V20a1.7 1.7 0 0 1-1.7 1.7H7A1.7 1.7 0 0 1 5.3 20V5.5A1.7 1.7 0 0 1 7 3.8z"></path><path d="M14 4v5h5"></path><path d="M8.6 13h6.8"></path><path d="M8.6 16.5h4.5"></path></svg></div>'
    + '<div class="existingFeedbackImportTitle">' + settingsEscapeHtml(title) + '</div>'
    + '<div class="existingFeedbackImportDesc">' + settingsEscapeHtml(desc) + '</div>'
    + '</div>'
    + '<div class="attendancePhotoActionGrid"><button class="settingsActionBtn primary" type="button" onclick="requestExistingFeedbackImportAnalysis()"' + (existingFeedbackImportState.analyzing ? ' disabled' : '') + '>' + analyzeLabel + '</button><button class="settingsActionBtn" type="button" onclick="clearExistingFeedbackImportFile()">' + clearLabel + '</button></div>'
    + status + error + preview + renderExistingFeedbackImportResults();
}

function renderSettingsAttendancePhotoImportOnly() {
  const images = getAttendancePhotoImportImages();
  const hasImage = images.length > 0;
  const imageName = images.length > 1
    ? settingsEscapeHtml(images.length + '장 선택됨')
    : settingsEscapeHtml((images[0] && images[0].name) || attendancePhotoImportState.imageName || '선택한 사진');
  const previewHtml = images.length > 1
    ? '<div class="attendancePhotoPreviewGrid">' + images.slice(0, 4).map(item => '<img class="attendancePhotoPreviewThumb" src="' + item.dataUrl + '" alt="출석부 사진 미리보기">').join('') + '</div>'
    : (hasImage ? '<img class="attendancePhotoPreview" src="' + images[0].dataUrl + '" alt="출석부 사진 미리보기">' : '');
  const progressText = attendancePhotoImportState.analysisProgress ? ' ' + attendancePhotoImportState.analysisProgress : '';
  const uploadTitle = attendancePhotoImportState.analyzing ? '사진 분석 중...' + progressText : (hasImage ? imageName : '출석부 사진 업로드');
  const uploadDesc = attendancePhotoImportState.analyzing
    ? 'AI가 출석부 사진을 읽고 있어요.'
    : (hasImage ? '다른 사진으로 변경하려면 이 영역을 눌러주세요.' : '종이 출석부를 촬영한 사진을 여러 장 올릴 수 있어요.');
  const analyzeStatus = attendancePhotoImportState.analyzing
    ? '<div class="attendancePhotoStatusBox">AI가 사진을 분석하고 있어요.' + settingsEscapeHtml(progressText) + '</div>'
    : '';
  const importResults = renderAttendancePhotoImportResults();

  return '<div class="settingsInfoCard"><div class="settingsInfoHead">출석부 사진 등록</div></div>'
    + '<div class="attendancePhotoUploadBox" onclick="openAttendancePhotoImportPicker()" role="button">'
    + '<div class="attendancePhotoUploadIcon"><svg viewBox="0 0 24 24"><path d="M4.5 8.2A2.2 2.2 0 0 1 6.7 6h10.6a2.2 2.2 0 0 1 2.2 2.2v8.6a2.2 2.2 0 0 1-2.2 2.2H6.7a2.2 2.2 0 0 1-2.2-2.2z"></path><path d="M8 15l2.2-2.2a1.3 1.3 0 0 1 1.8 0L16 16.8"></path><path d="M15.5 10h.01"></path></svg></div>'
    + '<div class="attendancePhotoUploadTitle">' + uploadTitle + '</div>'
    + '<div class="attendancePhotoUploadDesc">' + uploadDesc + '</div>'
    + previewHtml
    + '</div>'
    + analyzeStatus
    + importResults;
}

function renderSettingsAttendancePhotoImport() {
  const active = getStudentManagementActiveTab();
  let activeHtml = '';
  if (active === 'feedback') activeHtml = renderSettingsExistingFeedbackImport();
  else if (active === 'photo') activeHtml = renderSettingsAttendancePhotoImportOnly();
  else activeHtml = renderSettingsStudentBulkImport();

  return '<div class="settingsDetailIntro"><div class="settingsDetailTitle attendancePhotoImportTitle">학생정보를 한 번에 수정합니다.</div></div>'
    + renderStudentManagementTabs()
    + activeHtml;
}

function refreshSettingsAttendancePhotoImportDetail() {
  const detail = document.getElementById('settingsDetailScreen');
  const title = document.getElementById('settingsDetailTitlePill');
  const body = document.getElementById('settingsDetailBody');
  if (!detail || !title || !body) return;
  if (detail.style.display === 'flex' && (title.textContent === '출석부 사진 등록' || title.textContent === '원생 관리' || title.textContent === '학생정보 일괄 수정')) {
    body.innerHTML = renderSettingsAttendancePhotoImport();
  }
}

function openAttendancePhotoImportPicker() {
  const input = document.getElementById('attendancePhotoImportInput');
  if (input) input.click();
}

async function handleAttendancePhotoImportChange(event) {
  const files = event && event.target && event.target.files ? Array.from(event.target.files) : [];
  if (!files.length) return;
  const imageFiles = files.filter(file => String(file.type || '').startsWith('image/'));
  if (!imageFiles.length) {
    if (typeof showPushToast === 'function') showPushToast('이미지 파일만 업로드할 수 있어요.');
    else alert('이미지 파일만 업로드할 수 있어요.');
    event.target.value = '';
    return;
  }
  attendancePhotoImportState.analyzing = true;
  attendancePhotoImportState.analysisProgress = '준비 중';
  attendancePhotoImportState.imageName = imageFiles.length > 1 ? imageFiles.length + '장 선택됨' : (imageFiles[0].name || '출석부 사진');
  attendancePhotoImportState.imageDataUrl = '';
  attendancePhotoImportState.imageItems = [];
  attendancePhotoImportState.candidates = [];
  attendancePhotoImportState.errorMessage = '';
  attendancePhotoImportState.rawReply = '';
  refreshSettingsAttendancePhotoImportDetail();
  try {
    const compressed = [];
    for (let i = 0; i < imageFiles.length; i += 1) {
      attendancePhotoImportState.analysisProgress = '압축 ' + (i + 1) + '/' + imageFiles.length;
      refreshSettingsAttendancePhotoImportDetail();
      compressed.push(await compressAttendancePhotoImportFile(imageFiles[i]));
    }
    attendancePhotoImportState.imageItems = compressed;
    attendancePhotoImportState.imageDataUrl = compressed[0]?.dataUrl || '';
    attendancePhotoImportState.imageName = compressed.length > 1 ? compressed.length + '장 선택됨' : (compressed[0]?.name || '출석부 사진');
    attendancePhotoImportState.analyzing = false;
    attendancePhotoImportState.analysisProgress = '';
    refreshSettingsAttendancePhotoImportDetail();
    setTimeout(requestAttendancePhotoAnalysis, 80);
  } catch (err) {
    attendancePhotoImportState.analyzing = false;
    attendancePhotoImportState.analysisProgress = '';
    attendancePhotoImportState.errorMessage = String(err && (err.message || err) || '사진을 준비하지 못했어요.');
    refreshSettingsAttendancePhotoImportDetail();
  }
}

function clearAttendancePhotoImportImage() {
  attendancePhotoImportState.imageName = '';
  attendancePhotoImportState.imageDataUrl = '';
  attendancePhotoImportState.imageItems = [];
  attendancePhotoImportState.analysisProgress = '';
  attendancePhotoImportState.candidates = [];
  attendancePhotoImportState.errorMessage = '';
  attendancePhotoImportState.rawReply = '';
  const input = document.getElementById('attendancePhotoImportInput');
  if (input) input.value = '';
  refreshSettingsAttendancePhotoImportDetail();
}

function updateAttendancePhotoCandidateField(index, field, value) {
  const item = attendancePhotoImportState.candidates[index];
  if (!item) return;
  if (field === 'division') item[field] = normalizeAttendancePhotoDivision(value);
  else if (field === 'lesson_day') item[field] = normalizeAttendancePhotoLessonDay(value);
  else if (field === 'group') item[field] = normalizeAttendancePhotoGroup(value);
  else item[field] = String(value || '').trim();
  if (field === 'enrolled_at') {
    const parsed = normalizeStudentDateInputValue(value);
    if (parsed) {
      item.year = parsed.year;
      item.month = parsed.month;
      item.day = parsed.day;
      item.enrolled_at = parsed.enrolled_at;
    } else {
      item.enrolled_at = String(value || '').trim();
    }
  }
}

function toggleAttendancePhotoImportCandidate(index, checked) {
  const item = attendancePhotoImportState.candidates[index];
  if (!item) return;
  item.selected = !!checked;
}

function setAllAttendancePhotoImportCandidatesChecked(checked) {
  attendancePhotoImportState.candidates.forEach(item => { item.selected = !!checked; });
  refreshSettingsAttendancePhotoImportDetail();
}

function buildAttendancePhotoImportPayloads(imageItem, index, total) {
  const prompt = buildAttendancePhotoImportPrompt();
  const imageContent = { type: 'image_url', image_url: { url: imageItem.dataUrl, detail: 'low' } };
  const textContent = { type: 'text', text: prompt };
  const common = {
    feature: 'attendancePhotoImport',
    imageName: imageItem.name || '',
    imageIndex: index + 1,
    imageTotal: total
  };
  return [
    {
      ...common,
      promptType: 'summary',
      messages: [{ role: 'user', content: [textContent, imageContent] }]
    },
    {
      ...common,
      promptType: 'class',
      messages: [{ role: 'user', content: [textContent, imageContent] }]
    },
    {
      ...common,
      promptType: 'summary',
      imageDataUrl: imageItem.dataUrl,
      messages: [{ role: 'user', content: prompt }]
    }
  ];
}

async function postAttendancePhotoImportPayload(payload) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const rawText = await res.text();
  let data;
  try { data = rawText ? JSON.parse(rawText) : {}; } catch { data = { raw: rawText, reply: rawText }; }
  if (!res.ok) {
    const error = new Error(getApiErrorMessage(res.status, data));
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function requestSingleAttendancePhotoAnalysis(imageItem, index, total) {
  const payloads = buildAttendancePhotoImportPayloads(imageItem, index, total);
  let lastError = null;
  for (const payload of payloads) {
    try {
      return await postAttendancePhotoImportPayload(payload);
    } catch (err) {
      lastError = err;
      if (err && err.status === 413) {
        throw new Error('사진 용량이 커서 분석 요청이 거절됐어요. 사진을 더 작게 촬영하거나 한 장씩 다시 시도해 주세요.');
      }
      if (!err || (err.status !== 400 && err.status !== 415)) throw err;
    }
  }
  const detail = String(lastError && (lastError.message || lastError) || '').trim();
  throw new Error('서버가 아직 출석부 사진 분석 요청 형식을 받지 못하고 있어요. 서버의 /api/chat에서 이미지 입력을 처리하도록 연결해야 합니다.' + (detail ? '\n' + detail : ''));
}

function mergeAttendancePhotoImportCandidates(list) {
  const map = new Map();
  list.forEach(item => {
    const key = [normalizeAttendancePhotoDivision(item.division), String(item.name || '').trim(), normalizeAttendancePhotoLessonDay(item.lesson_day || ''), String(item.class_time || '').trim()].join('|');
    if (!String(item.name || '').trim()) return;
    if (!map.has(key)) {
      map.set(key, item);
      return;
    }
    const existing = map.get(key);
    Object.keys(item).forEach(field => {
      if ((existing[field] === '' || existing[field] === null || existing[field] === undefined) && item[field]) existing[field] = item[field];
    });
    if (item.note && !String(existing.note || '').includes(item.note)) {
      existing.note = [existing.note, item.note].filter(Boolean).join(' / ');
    }
  });
  return Array.from(map.values());
}

async function requestAttendancePhotoAnalysis() {
  if (attendancePhotoImportState.analyzing) return;
  const images = getAttendancePhotoImportImages();
  if (!images.length) {
    if (typeof showPushToast === 'function') showPushToast('먼저 출석부 사진을 업로드해 주세요.');
    else alert('먼저 출석부 사진을 업로드해 주세요.');
    return;
  }
  attendancePhotoImportState.analyzing = true;
  attendancePhotoImportState.analysisProgress = '';
  attendancePhotoImportState.errorMessage = '';
  attendancePhotoImportState.rawReply = '';
  attendancePhotoImportState.candidates = [];
  refreshSettingsAttendancePhotoImportDetail();
  try {
    const allRows = [];
    const rawReplies = [];
    const errorMessages = [];
    for (let i = 0; i < images.length; i += 1) {
      attendancePhotoImportState.analysisProgress = (i + 1) + '/' + images.length;
      refreshSettingsAttendancePhotoImportDetail();
      try {
        const data = await requestSingleAttendancePhotoAnalysis(images[i], i, images.length);
        const rows = parseAttendancePhotoAnalysisData(data);
        rows.forEach(row => allRows.push(row));
        const rawReply = String(data.reply || data.raw || '').trim();
        if (rawReply) rawReplies.push(rawReply);
      } catch (err) {
        errorMessages.push((images[i].name || '사진 ' + (i + 1)) + ': ' + String(err && (err.message || err) || '분석 실패'));
      }
    }
    const normalized = mergeAttendancePhotoImportCandidates(allRows.map(normalizeAttendancePhotoImportCandidate).filter(item => String(item.name || '').trim()));
    attendancePhotoImportState.candidates = normalized;
    attendancePhotoImportState.rawReply = rawReplies.join('\n\n');
    if (errorMessages.length) {
      attendancePhotoImportState.errorMessage = errorMessages.join('\n');
    }
    if (!normalized.length && !attendancePhotoImportState.errorMessage) {
      attendancePhotoImportState.errorMessage = '사진에서 등록할 학생 정보를 찾지 못했어요. 더 선명한 사진으로 다시 시도해 주세요.';
    } else if (normalized.length && typeof showPushToast === 'function') {
      showPushToast(`학생 후보 ${normalized.length}명을 찾았어요.`);
    }
  } catch (err) {
    attendancePhotoImportState.candidates = [];
    attendancePhotoImportState.errorMessage = String(err && (err.message || err) || '사진 분석에 실패했어요.');
  } finally {
    attendancePhotoImportState.analyzing = false;
    attendancePhotoImportState.analysisProgress = '';
    refreshSettingsAttendancePhotoImportDetail();
  }
}

function buildStudentFromAttendancePhotoCandidate(candidate) {
  const division = normalizeAttendancePhotoDivision(candidate.division);
  const enrolled = normalizeStudentDateInputValue(candidate.enrolled_at || '');
  const base = {
    id: uid(),
    type: division,
    name: String(candidate.name || '').trim(),
    year: enrolled ? enrolled.year : '',
    month: enrolled ? String(Number(enrolled.month)) : '',
    day: enrolled ? String(Number(enrolled.day)) : '',
    enrolled_at: enrolled ? enrolled.enrolled_at : '',
    lesson_day: normalizeAttendancePhotoLessonDay(candidate.lesson_day || ''),
    lesson_time: normalizeLessonTimeDisplay(candidate.class_time || candidate.lesson_time || ''),
    class_time: normalizeLessonTimeDisplay(candidate.class_time || candidate.lesson_time || ''),
    teacher: formatTeacherNameWithT(candidate.teacher || ''),
    homeroom_teacher: formatTeacherNameWithT(candidate.teacher || ''),
    status: 'active',
    academy_id: getOlliCurrentAcademyId ? getOlliCurrentAcademyId() : ''
  };
  if (division === 'kinder') {
    return normalizeStudentObject({
      ...base,
      kindergarten: candidate.kindergarten || '',
      age: candidate.age || ''
    }, 'kinder');
  }
  return normalizeStudentObject({
    ...base,
    school: candidate.school || '',
    grade: candidate.grade || '',
    className: candidate.className || '',
    group: getAttendancePhotoGroupInternalValue(candidate.group || ''),
    group_months: '',
    feedback_months: ''
  }, 'elementary');
}

async function importAttendancePhotoCandidates() {
  if (attendancePhotoImportState.importRunning) return;
  const selected = attendancePhotoImportState.candidates.filter(item => item.selected && String(item.name || '').trim());
  if (!selected.length) {
    if (typeof showPushToast === 'function') showPushToast('등록할 학생을 선택해 주세요.');
    else alert('등록할 학생을 선택해 주세요.');
    return;
  }
  const duplicateNames = selected.filter(item => getAttendancePhotoDuplicateInfo(item).type === 'dup').map(item => item.name);
  if (duplicateNames.length) {
    const ok = confirm('중복 가능 학생이 포함되어 있어요.\n' + duplicateNames.join(', ') + '\n\n그래도 새 학생으로 등록할까요?');
    if (!ok) return;
  }
  attendancePhotoImportState.importRunning = true;
  try {
    let savedCount = 0;
    for (const candidate of selected) {
      const student = buildStudentFromAttendancePhotoCandidate(candidate);
      if (!student.name) continue;
      await saveStudent(student);
      savedCount += 1;
    }
    try { await loadStudentsFromSupabase(); } catch(e) {}
    try {
      const searchValue = document.getElementById('searchName')?.value?.trim() || '';
      if (typeof loadRecords === 'function') await loadRecords(searchValue);
    } catch(e) {}
    try { if (typeof refreshMemoStudentSelectPopupIfOpen === 'function') refreshMemoStudentSelectPopupIfOpen(); } catch(e) {}
    attendancePhotoImportState.candidates = attendancePhotoImportState.candidates.filter(item => !selected.includes(item));
    attendancePhotoImportState.errorMessage = '';
    if (typeof showPushToast === 'function') showPushToast(`${savedCount}명의 학생을 출석부에 등록했어요.`);
    else alert(`${savedCount}명의 학생을 출석부에 등록했어요.`);
  } catch (err) {
    attendancePhotoImportState.errorMessage = String(err && (err.message || err) || '학생 등록에 실패했어요.');
  } finally {
    attendancePhotoImportState.importRunning = false;
    refreshSettingsAttendancePhotoImportDetail();
  }
}


function showOlliTestResetMessage(message) {
  if (typeof showPushToast === 'function') showPushToast(message);
  else alert(message);
}

function guardOlliTestResetTool() {
  if (typeof canUseOlliDevTestTools !== 'function' || !canUseOlliDevTestTools()) {
    showOlliTestResetMessage('비비작아이성향미술학원 원장 계정에서만 사용할 수 있는 테스트 기능입니다.');
    return false;
  }
  return true;
}

function clearAcademyManagementRuntimeForTest() {
  if (academyConsultationAutoCheckTimer) {
    clearTimeout(academyConsultationAutoCheckTimer);
    academyConsultationAutoCheckTimer = null;
  }
  if (academyManagementDashboardRenderTimer) {
    clearTimeout(academyManagementDashboardRenderTimer);
    academyManagementDashboardRenderTimer = null;
  }
  academyConsultationSummaryState.running = false;
  academyConsultationSummaryState.items = {};
  academyConsultationSummaryState.expandedKey = '';
  try { localStorage.removeItem(getPendingStudentStatusStorageKey()); } catch (_) {}
}

async function resetAcademyManagementPageForTest() {
  if (!guardOlliTestResetTool()) return;
  const ok = confirm('학원관리 페이지의 임시 계산 상태를 리셋하고\n원생수, 상담, 등록, 퇴원 카운트를 다시 계산합니다.\n\n상담 예정 학생도 모두 다시 확인합니다.');
  if (!ok) return;
  clearAcademyManagementRuntimeForTest();
  try {
    if (typeof loadStudentsFromSupabase === 'function') await loadStudentsFromSupabase();
  } catch (err) {
    console.warn('학원관리 리셋 학생 재조회 실패:', err.message || err);
  }
  if (typeof renderRecordAcademyManagementDashboard === 'function') renderRecordAcademyManagementDashboard();
  if (currentRecordView === 'academy' && typeof scheduleAcademyConsultationSummaryAutoCheck === 'function') {
    scheduleAcademyConsultationSummaryAutoCheck(200);
  }
  showOlliTestResetMessage('학원관리 페이지를 다시 계산합니다.');
}

function removeLocalStorageKeysForStudentTestReset(student) {
  const id = String(student?.id || '').trim();
  if (!id) return;
  const academyId = (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || '';
  const safeId = id.replace(/[^a-zA-Z0-9._:-]/g, '_');
  const safeAcademyId = academyId.replace(/[^a-zA-Z0-9._:-]/g, '_');
  const directKeys = [
    ELEMENTARY_MEMO_PREFIX + id,
    ELEMENTARY_ANALYSIS_PREFIX + id,
    ELEMENTARY_RECORDS_PREFIX + id,
    KINDER_MEMO_PREFIX + id,
    MEMO_FEEDBACK_ARCHIVE_PREFIX + id
  ];
  directKeys.forEach(key => {
    try { localStorage.removeItem(key); } catch (_) {}
  });
  try {
    Object.keys(localStorage).forEach(key => {
      const isCommonStudentKey = key.startsWith('olli:v')
        && safeAcademyId
        && key.includes(':' + safeAcademyId + ':' + safeId + ':');
      const isLegacyStudentKey = key.includes(id) && (
        key.startsWith(ELEMENTARY_MEMO_PREFIX) ||
        key.startsWith(ELEMENTARY_ANALYSIS_PREFIX) ||
        key.startsWith(ELEMENTARY_RECORDS_PREFIX) ||
        key.startsWith(KINDER_MEMO_PREFIX) ||
        key.startsWith(MEMO_FEEDBACK_ARCHIVE_PREFIX)
      );
      if (isCommonStudentKey || isLegacyStudentKey) localStorage.removeItem(key);
    });
  } catch (err) {
    console.warn('학생별 로컬 데이터 정리 실패:', err);
  }
}

function clearStudentSyncQueueForTestReset(studentIds) {
  const academyId = (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || '';
  const idSet = new Set((studentIds || []).map(id => String(id || '').trim()).filter(Boolean));
  if (!academyId || !idSet.size) return;
  try {
    const core = window.OlliStorageCore;
    if (!core?.SyncQueue) return;
    const current = core.SyncQueue.read(academyId);
    const filtered = current.filter(item => !idSet.has(String(item.student_id || '').trim()));
    if (filtered.length !== current.length) core.SyncQueue.write(academyId, filtered);
  } catch (err) {
    console.warn('학생 리셋 동기화 큐 정리 실패:', err.message || err);
  }
}

async function deleteStudentFeedbackRowsForTestReset(student) {
  const academyId = requireOlliAcademyId('출석부 학생명단 리셋');
  const studentId = String(student?.id || '').trim();
  if (!studentId || typeof deleteOlliData !== 'function') return [];
  const failures = [];
  const features = [
    { feature: 'general_feedbacks_by_student_delete', label: '일반 피드백' },
    { feature: 'growth_feedbacks_by_student_delete', label: '성장 피드백' },
    { feature: 'summary_feedbacks_by_student_delete', label: '종합 피드백' }
  ];
  for (const item of features) {
    try {
      const result = await deleteOlliData(item.feature, {
        academyId,
        studentId,
        forceCommon: true,
        deleteMode: 'soft',
        reason: 'test_reset'
      });
      if (result && result.ok === false) {
        failures.push(item.label + ': 서버 삭제 대기 또는 실패');
      }
    } catch (err) {
      failures.push(item.label + ': ' + String(err && (err.message || err) || '삭제 실패'));
    }
  }
  return failures;
}

async function deleteStudentNoteRowsForTestReset(student) {
  if (!isSupabaseConfigured() || !student?.id) return [];
  const academyId = requireOlliAcademyId('출석부 학생 노트 리셋');
  const studentId = String(student.id || '').trim();
  const failures = [];
  try {
    await clearStudentNoteDraftFromSupabase(student, student.type === 'kinder' ? 'kinder_risk' : 'elementary_observation');
  } catch (err) {
    failures.push('노트 초안: ' + String(err && (err.message || err) || '삭제 실패'));
  }
  const encodedAcademyId = encodeURIComponent(academyId);
  const encodedStudentId = encodeURIComponent(studentId);
  const tables = ['student_note_drafts', 'student_note_archives'];
  for (const table of tables) {
    try {
      await supabase('DELETE', `${table}?academy_id=eq.${encodedAcademyId}&student_id=eq.${encodedStudentId}`);
    } catch (err) {
      failures.push(table + ': ' + String(err && (err.message || err) || '삭제 실패'));
    }
  }
  return failures;
}

async function softDeleteStudentForTestReset(student) {
  if (!isSupabaseConfigured()) return;
  if (typeof saveOlliData !== 'function') throw new Error('학생 삭제 공통 저장 함수가 준비되지 않았습니다.');
  const academyId = requireOlliAcademyId('출석부 학생명단 리셋');
  const studentId = String(student?.id || '').trim();
  if (!studentId) return;
  const deletedAt = new Date().toISOString();
  const deletedBy = getOlliSoftDeleteActorId();
  const result = await saveOlliData('student_soft_delete', {
    academyId,
    studentId,
    data: {
      is_deleted: true,
      deleted_at: deletedAt,
      deleted_by: deletedBy || null,
      delete_reason: 'test_reset'
    },
    forceCommon: true
  });
  if (result && result.serverSaved && result.verified) return;
  if (result && result.pending) throw new Error('학생 삭제가 서버에 반영되지 않아 재전송 대기열에 남았습니다.');
  throw new Error('학생 삭제 서버 반영을 확인하지 못했습니다.');
}

async function resetSingleStudentForTestReset(student) {
  const relatedFailures = [];
  relatedFailures.push(...await deleteStudentFeedbackRowsForTestReset(student));
  relatedFailures.push(...await deleteStudentNoteRowsForTestReset(student));
  await softDeleteStudentForTestReset(student);
  return relatedFailures;
}

async function resetAttendanceStudentRosterForTest() {
  if (!guardOlliTestResetTool()) return;
  const students = getAllStudents();
  if (!students.length) {
    clearAcademyManagementRuntimeForTest();
    renderRecordAcademyManagementDashboard();
    showOlliTestResetMessage('삭제할 등록 학생이 없습니다.');
    return;
  }
  const ok = confirm('현재 학원의 출석부 학생명단을 리셋합니다.\n\n등록된 학생, 학생별 관찰노트 메모, 분석 설문, 저장 피드백, 종합 피드백을 함께 삭제합니다.\n이 작업은 테스트용이며 되돌리기 어렵습니다.\n\n계속할까요?');
  if (!ok) return;

  const successIds = [];
  const failures = [];
  for (const student of students) {
    const studentId = String(student?.id || '').trim();
    try {
      const relatedFailures = await resetSingleStudentForTestReset(student);
      successIds.push(studentId);
      relatedFailures.forEach(message => failures.push((student.name || studentId) + ' / ' + message));
    } catch (err) {
      failures.push((student?.name || studentId || '학생') + ': ' + String(err && (err.message || err) || '삭제 실패'));
    }
  }

  if (successIds.length) {
    const successSet = new Set(successIds);
    students.forEach(student => {
      if (successSet.has(String(student.id || '').trim())) {
        backupAndRemoveStudentLocalData(student.id, student);
        removeLocalStorageKeysForStudentTestReset(student);
        unmarkDeletedStudentId(student.id);
      }
    });
    setAllStudents(getAllStudents().filter(student => !successSet.has(String(student.id || '').trim())));
    clearStudentSyncQueueForTestReset(successIds);
  }

  if (currentMemoStudent && successIds.includes(String(currentMemoStudent.id || '').trim())) {
    currentMemoStudent = null;
    const memoScreen = document.getElementById('studentMemoScreen');
    const recordScreen = document.getElementById('recordRoomScreen');
    if (memoScreen) memoScreen.style.display = 'none';
    if (recordScreen) recordScreen.style.display = 'flex';
  }

  if (typeof selectedStudentIds !== 'undefined' && selectedStudentIds?.clear) selectedStudentIds.clear();
  clearAcademyManagementRuntimeForTest();
  try { await loadStudentsFromSupabase(); } catch (err) { console.warn('학생명단 리셋 후 학생 재조회 실패:', err.message || err); }
  try {
    const searchValue = document.getElementById('searchName')?.value?.trim() || '';
    if (typeof loadRecords === 'function') await loadRecords(searchValue);
  } catch (err) {
    console.warn('학생명단 리셋 후 출석부 갱신 실패:', err.message || err);
  }
  if (typeof renderRecordAcademyManagementDashboard === 'function') renderRecordAcademyManagementDashboard();
  try { if (typeof refreshMemoStudentSelectPopupIfOpen === 'function') refreshMemoStudentSelectPopupIfOpen(); } catch (_) {}

  const baseMessage = successIds.length + '명의 학생을 출석부에서 리셋했습니다.';
  if (failures.length) {
    alert(baseMessage + '\n\n일부 서버 기록 정리에 실패했습니다. 저장 진단을 확인해 주세요.\n' + failures.slice(0, 5).join('\n'));
  } else {
    showOlliTestResetMessage(baseMessage);
  }
}


function getOlliTeacherInviteAcademyInfo() {
  const cached = typeof settingsGetCachedState === 'function' ? settingsGetCachedState() : {};
  const academy = (typeof olliSettingsState !== 'undefined' && olliSettingsState && olliSettingsState.academy) ? olliSettingsState.academy : {};
  const academyCode = String(
    academy.academy_code ||
    academy.academy_id ||
    localStorage.getItem('olli_current_academy_code') ||
    localStorage.getItem('olli_academy_code') ||
    ''
  ).trim();
  const academyName = String(
    academy.academy_name ||
    cached.academyName ||
    localStorage.getItem('olli_current_academy_name') ||
    ''
  ).trim();
  return { academyCode, academyName };
}

function buildOlliTeacherInviteUrl() {
  const info = getOlliTeacherInviteAcademyInfo();
  if (!info.academyCode) return '';
  const base = String(window.location.origin || '') + String(window.location.pathname || '');
  const params = new URLSearchParams();
  params.set('invite', 'teacher');
  params.set('academy_code', info.academyCode);
  if (info.academyName) params.set('academy_name', info.academyName);
  return base + '?' + params.toString();
}

function getOlliAppQrTargetUrl() {
  return 'https://vivizac-feedback.vercel.app/';
}

function buildOlliTeacherInviteMessage() {
  const info = getOlliTeacherInviteAcademyInfo();
  const inviteUrl = buildOlliTeacherInviteUrl();
  if (!info.academyCode) return '';
  return [
    '선생님 등록 링크입니다.',
    '이 링크로 들어가 이름을 입력하고 승인 요청해 주세요.',
    '학원코드: ' + info.academyCode,
    inviteUrl
  ].filter(Boolean).join('\n');
}

function renderSettingsTeacherInviteApprovalInline() {
  const teacherRows = olliSettingsState.approvalRequests || [];
  const academyRows = olliSettingsState.academyAccessRequests || [];
  const error = olliSettingsState.lastError
    ? '<div class="settingsErrorBox">' + settingsEscapeHtml(olliSettingsState.lastError) + '</div>'
    : '';
  const refreshButton = '<button class="settingsActionBtn" type="button" onclick="refreshSettingsTeacherInviteApprovalRequests()">새로고침</button>';

  const academySection = academyRows.length ? '<div class="settingsInfoCard">'
    + '<div class="settingsInfoHead">개인계정 학원 연결 요청</div>'
    + academyRows.map(r => {
      const role = String(r.requested_role || 'manager').trim();
      return '<div class="settingsRequestCard">'
        + '<div class="settingsRequestTop"><div class="settingsRequestName">' + settingsEscapeHtml(r.requester_name || '계정 사용자') + '</div><span class="settingsStatusBadge waiting">연결 대기</span></div>'
        + '<div class="settingsRequestMeta"><div>요청 권한: ' + settingsEscapeHtml(getOlliAcademyRoleLabel(role)) + '</div><div>요청 시간: ' + settingsEscapeHtml(String(r.created_at || '').slice(0, 19)) + '</div></div>'
        + '<div class="settingsActionGrid"><button class="settingsActionBtn red" type="button" onclick="rejectOlliAcademyAccessRequest(\'' + settingsEscapeAttr(r.id) + '\')">거절</button>'
        + '<button class="settingsActionBtn primary" type="button" onclick="approveOlliAcademyAccessRequest(\'' + settingsEscapeAttr(r.id) + '\',\'' + settingsEscapeAttr(role) + '\')">' + settingsEscapeHtml(getOlliAcademyRoleLabel(role)) + ' 승인</button></div>'
        + '</div>';
    }).join('') + '</div>' : '';

  const teacherSection = teacherRows.length ? '<div class="settingsInfoCard">'
    + '<div class="settingsInfoHead">선생님 승인 요청</div>'
    + teacherRows.map(r => '<div class="settingsRequestCard">'
      + '<div class="settingsRequestTop"><div class="settingsRequestName">' + settingsEscapeHtml(r.teacher_name) + '</div><span class="settingsStatusBadge waiting">승인 대기</span></div>'
      + '<div class="settingsRequestMeta"><div>요청 권한: ' + settingsEscapeHtml(r.requested_role || 'teacher') + '</div><div>요청 정보: ' + settingsEscapeHtml(r.requested_device_name || '미확인') + '</div><div>요청 시간: ' + settingsEscapeHtml(String(r.created_at || '').slice(0, 19)) + '</div></div>'
      + '<div class="settingsActionGrid"><button class="settingsActionBtn red" type="button" onclick="rejectSettingsRequest(\'' + settingsEscapeAttr(r.id) + '\')">거절</button><button class="settingsActionBtn primary" type="button" onclick="approveSettingsRequest(\'' + settingsEscapeAttr(r.id) + '\')">승인</button></div>'
      + '</div>').join('') + '</div>' : '';

  if (!academyRows.length && !teacherRows.length) {
    return '<div class="settingsInfoCard settingsTeacherInviteApprovalCard">'
      + '<div class="settingsInfoHead settingsTeacherInviteSectionTitle settingsTeacherInviteApprovalTitle">승인 요청</div>'
      + error
      + '<div class="settingsEmptyBox">대기 중인 승인 요청이 없습니다.</div>'
      + '<div class="settingsActionGrid single">' + refreshButton + '</div>'
      + '</div>';
  }

  return '<div class="settingsTeacherInviteApprovalWrap">'
    + '<div class="settingsInfoHead settingsTeacherInviteSectionTitle settingsTeacherInviteApprovalTitle">승인 요청</div>'
    + error
    + teacherSection
    + academySection
    + '<div class="settingsActionGrid single">' + refreshButton + '</div>'
    + '</div>';
}

async function refreshSettingsTeacherInviteApprovalRequests() {
  await settingsLoadAllApprovalRequests();
  const target = document.getElementById('settingsTeacherInviteApprovalWrap');
  if (target) target.innerHTML = renderSettingsTeacherInviteApprovalInline();
  settingsApplyStateToUI();
}

function renderSettingsTeacherInvite() {
  const info = getOlliTeacherInviteAcademyInfo();
  if (!info.academyCode) {
    return '<div class="settingsDetailIntro"><div class="settingsDetailTitle">초대할 학원 정보를<br>확인하지 못했습니다.</div></div>'
      + '<div class="settingsInfoCard"><div class="settingsInfoItem">원장 계정으로 로그인한 뒤 다시 시도해 주세요.</div></div>';
  }
  const qrTargetUrl = getOlliAppQrTargetUrl();
  const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent(qrTargetUrl);
  return '<div class="settingsInfoCard"><div class="settingsTeacherInvitePlainList">'
    + '<div class="settingsTeacherInvitePlainLine">학원명: ' + settingsEscapeHtml(info.academyName || '현재 학원') + '</div>'
    + '<div class="settingsTeacherInvitePlainLine">학원코드: <strong>' + settingsEscapeHtml(info.academyCode) + '</strong></div></div></div>'
    + '<div class="settingsInfoCard settingsTeacherInviteQrCard"><img class="settingsInviteQrImage" src="' + settingsEscapeAttr(qrUrl) + '" alt="선생님 초대 QR"></div>'
    + '<div class="settingsInviteActionGrid settingsInviteActionGridOutside"><button class="settingsExportBtn" type="button" onclick="copyOlliTeacherInviteMessage(this)">초대 링크 복사</button></div>'
    + '<div id="settingsTeacherInviteApprovalWrap" class="settingsTeacherInviteApprovalMount">' + renderSettingsTeacherInviteApprovalInline() + '</div>';
}

async function copyOlliTeacherInviteMessage(btn) {
  const text = buildOlliTeacherInviteMessage();
  if (!text) { alert('초대 링크를 만들 수 없습니다. 학원코드를 확인해 주세요.'); return; }
  let copied = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch (err) {
    copied = false;
  }
  if (!copied) {
    try {
      const temp = document.createElement('textarea');
      temp.value = text;
      temp.setAttribute('readonly', '');
      temp.style.position = 'fixed';
      temp.style.left = '-9999px';
      temp.style.top = '0';
      document.body.appendChild(temp);
      temp.focus();
      temp.select();
      document.execCommand('copy');
      document.body.removeChild(temp);
      copied = true;
    } catch (err) {
      copied = false;
    }
  }
  if (!copied) {
    alert('복사에 실패했습니다. 링크를 직접 선택해서 복사해 주세요.');
    return;
  }
  if (btn) showOlliCopySuccess(btn);
}


function clearOlliTeacherInviteParamsFromUrl() {
  try {
    const url = new URL(window.location.href);
    let changed = false;
    ['invite', 'olli_invite', 'academy_code', 'academy', 'code', 'academy_name'].forEach(key => {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    });
    if (changed && window.history && window.history.replaceState) {
      const next = url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '') + url.hash;
      window.history.replaceState({}, document.title || '올리', next || url.pathname);
    }
  } catch (err) {
    console.warn('초대 링크 주소 정리 건너뜀:', err);
  }
}

function isOlliAlreadyLoggedIntoInviteAcademy(academyCode) {
  const code = String(academyCode || '').trim();
  if (!code) return false;
  const currentCode = String(localStorage.getItem('olli_current_academy_code') || localStorage.getItem('olli_academy_code') || '').trim();
  const logged = localStorage.getItem('olli_teacher_logged_in') === 'true' || localStorage.getItem('olli_owner_logged_in') === 'true';
  return !!logged && !!currentCode && currentCode === code;
}

function rememberOlliTeacherApprovalContext(academyCode, teacherName) {
  const code = String(academyCode || '').trim();
  const name = String(teacherName || '').trim();
  if (code) localStorage.setItem('olli_pending_academy_code', code);
  if (name) localStorage.setItem('olli_pending_teacher_name', name);
}

function getOlliTeacherInviteParamsFromUrl() {
  let params;
  try { params = new URLSearchParams(window.location.search || ''); } catch (err) { return null; }
  const invite = String(params.get('invite') || params.get('olli_invite') || '').trim().toLowerCase();
  const academyCode = String(params.get('academy_code') || params.get('academy') || params.get('code') || '').trim();
  if (invite !== 'teacher' && !academyCode) return null;
  if (!academyCode) return null;
  return {
    academyCode,
    academyName: String(params.get('academy_name') || '').trim()
  };
}

function applyOlliTeacherInviteFromUrl() {
  const invite = getOlliTeacherInviteParamsFromUrl();
  if (!invite || !invite.academyCode) return false;

  if (isOlliAlreadyLoggedIntoInviteAcademy(invite.academyCode)) {
    clearOlliTeacherInviteParamsFromUrl();
    return false;
  }

  localStorage.setItem('olli_pending_academy_code', invite.academyCode);
  if (invite.academyName) localStorage.setItem('olli_pending_academy_name', invite.academyName);

  const entryCode = document.getElementById('olliEntryTeacherAcademyCodeInput');
  const requestCode = document.getElementById('olliTeacherAcademyCodeInput');
  if (entryCode) entryCode.value = invite.academyCode;
  if (requestCode) requestCode.value = invite.academyCode;

  // 초대 링크로 한 번 들어온 뒤에는 주소에서 초대 파라미터를 제거합니다.
  // 홈 화면에 추가한 앱이 매번 승인 요청 화면으로 열리는 문제를 막기 위한 처리입니다.
  clearOlliTeacherInviteParamsFromUrl();
  showOlliTeacherRequest();
  return true;
}

let olliApprovalWaitingTimer = null;
let olliApprovalWaitingBusy = false;

function stopOlliApprovalAutoCheck() {
  if (olliApprovalWaitingTimer) {
    clearInterval(olliApprovalWaitingTimer);
    olliApprovalWaitingTimer = null;
  }
  olliApprovalWaitingBusy = false;
}

function startOlliApprovalAutoCheck() {
  stopOlliApprovalAutoCheck();
  const tick = async function() {
    if (olliApprovalWaitingBusy) return;
    olliApprovalWaitingBusy = true;
    try {
      const approved = await checkOlliTeacherApprovalStatus({ silent: true, auto: true });
      if (approved) stopOlliApprovalAutoCheck();
    } catch (err) {
      console.warn('approval auto check failed', err);
    } finally {
      olliApprovalWaitingBusy = false;
    }
  };
  olliApprovalWaitingTimer = setInterval(tick, 3000);
  setTimeout(tick, 900);
}


/* 2026-06-25: 샘플 학원 체험 기간 / 접속 차단 시스템 */
const OLLI_ACADEMY_ACCESS_LOCAL_KEY = 'olli_academy_access_state_v1';
function getOlliAcademyAccessLocalKey(academyId = '') {
  const id = String(academyId || (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || 'unscoped').trim() || 'unscoped';
  return `${OLLI_ACADEMY_ACCESS_LOCAL_KEY}_${id}`;
}
function normalizeOlliIsoDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const date = new Date(text);
  if (isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}
function addOlliDays(date, days) {
  const d = date instanceof Date && !isNaN(date.getTime()) ? new Date(date.getTime()) : new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}
function readOlliAcademyAccessLocal(academyId = '') {
  try {
    const parsed = JSON.parse(localStorage.getItem(getOlliAcademyAccessLocalKey(academyId)) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}
function saveOlliAcademyAccessLocal(patch = {}, academyId = '') {
  const id = String(academyId || (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || '').trim();
  const current = readOlliAcademyAccessLocal(id);
  const next = { ...current, ...(patch || {}), updated_at: new Date().toISOString() };
  try { localStorage.setItem(getOlliAcademyAccessLocalKey(id), JSON.stringify(next)); } catch (err) { console.warn('학원 사용 상태 로컬 저장 실패:', err); }
  return next;
}
function getOlliCurrentAcademyAccessState(academy = null) {
  const academyId = String(academy?.id || academy?.academy_id || (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || '').trim();
  const local = readOlliAcademyAccessLocal(academyId);
  const source = { ...(academy || {}), ...local };
  const planType = String(source.plan_type || source.planType || '').trim() || 'active';
  let accessStatus = String(source.access_status || source.accessStatus || '').trim() || 'active';
  const trialStartedAt = normalizeOlliIsoDate(source.trial_started_at || source.trialStartedAt || '');
  const trialExpiresAt = normalizeOlliIsoDate(source.trial_expires_at || source.trialExpiresAt || '');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expires = trialExpiresAt ? new Date(`${trialExpiresAt}T23:59:59`) : null;
  const autoExpired = planType === 'trial' && expires && !isNaN(expires.getTime()) && today > expires;
  if (autoExpired && accessStatus === 'active') accessStatus = 'expired';
  const blocked = accessStatus === 'expired' || accessStatus === 'suspended' || accessStatus === 'disabled';
  return { academyId, planType, accessStatus, trialStartedAt, trialExpiresAt, autoExpired, blocked };
}
function getOlliAcademyAccessLabel(state = null) {
  const s = state || getOlliCurrentAcademyAccessState(olliSettingsState?.academy || null);
  if (s.accessStatus === 'expired') return '체험 종료';
  if (s.accessStatus === 'suspended' || s.accessStatus === 'disabled') return '사용 정지';
  if (s.planType === 'trial') return '체험 중';
  return '정상 사용';
}
function getOlliAcademyAccessDaysLeft(state = null) {
  const s = state || getOlliCurrentAcademyAccessState(olliSettingsState?.academy || null);
  if (!s.trialExpiresAt) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(`${s.trialExpiresAt}T00:00:00`);
  if (isNaN(end.getTime())) return null;
  return Math.ceil((end.getTime() - today.getTime()) / 86400000);
}
function updateOlliAcademyAccessSettingUI() {
  const value = document.getElementById('settingsAcademyAccessValue');
  if (!value) return;
  const state = getOlliCurrentAcademyAccessState(olliSettingsState?.academy || null);
  const daysLeft = getOlliAcademyAccessDaysLeft(state);
  value.textContent = state.planType === 'trial' && state.accessStatus === 'active' && daysLeft !== null
    ? `${getOlliAcademyAccessLabel(state)} · ${Math.max(0, daysLeft)}일`
    : getOlliAcademyAccessLabel(state);
}
async function persistOlliAcademyAccessState(patch = {}) {
  const academyId = settingsGetAcademyId ? settingsGetAcademyId() : (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '');
  if (!academyId) throw new Error('현재 학원 ID가 없습니다.');
  const normalized = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'plan_type') || Object.prototype.hasOwnProperty.call(patch, 'planType')) {
    normalized.plan_type = String(patch.plan_type ?? patch.planType ?? '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'access_status') || Object.prototype.hasOwnProperty.call(patch, 'accessStatus')) {
    normalized.access_status = String(patch.access_status ?? patch.accessStatus ?? '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'trial_started_at') || Object.prototype.hasOwnProperty.call(patch, 'trialStartedAt')) {
    normalized.trial_started_at = normalizeOlliIsoDate(patch.trial_started_at ?? patch.trialStartedAt ?? '') || '';
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'trial_expires_at') || Object.prototype.hasOwnProperty.call(patch, 'trialExpiresAt')) {
    normalized.trial_expires_at = normalizeOlliIsoDate(patch.trial_expires_at ?? patch.trialExpiresAt ?? '') || '';
  }
  saveOlliAcademyAccessLocal(normalized, academyId);
  if (olliSettingsState?.academy) Object.assign(olliSettingsState.academy, normalized);
  const mergedState = getOlliCurrentAcademyAccessState(olliSettingsState?.academy || normalized);
  localStorage.setItem('olli_current_academy_plan_type', mergedState.planType || '');
  localStorage.setItem('olli_current_academy_access_status', mergedState.accessStatus || 'active');
  localStorage.setItem('olli_current_academy_trial_started_at', mergedState.trialStartedAt || '');
  localStorage.setItem('olli_current_academy_trial_expires_at', mergedState.trialExpiresAt || '');

  const remotePayload = { ...normalized };
  if (Object.prototype.hasOwnProperty.call(remotePayload, 'trial_started_at') && !remotePayload.trial_started_at) remotePayload.trial_started_at = null;
  if (Object.prototype.hasOwnProperty.call(remotePayload, 'trial_expires_at') && !remotePayload.trial_expires_at) remotePayload.trial_expires_at = null;

  if (isSupabaseConfigured() && Object.keys(remotePayload).length) {
    try {
      await supabase('PATCH', `academies?id=eq.${encodeURIComponent(academyId)}`, remotePayload);
    } catch (err) {
      console.warn('학원 사용 상태 서버 저장 실패. 로컬에는 저장되었습니다:', err);
      alert('앱에는 반영했지만 서버 저장은 실패했습니다. Supabase academies 테이블에 plan_type, access_status, trial_started_at, trial_expires_at 컬럼이 있는지 확인해 주세요.\n\n' + (err.message || err));
    }
  }
  updateOlliAcademyAccessSettingUI();
  return normalized;
}
function renderOlliAcademyAccessSettings() {
  const academy = olliSettingsState?.academy || {};
  const state = getOlliCurrentAcademyAccessState(academy);
  const daysLeft = getOlliAcademyAccessDaysLeft(state);
  const badgeClass = state.accessStatus === 'active' && state.planType === 'trial' ? 'trial' : (state.blocked ? state.accessStatus : '');
  const today = new Date();
  const defaultStart = state.trialStartedAt || today.toISOString().slice(0, 10);
  const defaultEnd = state.trialExpiresAt || addOlliDays(today, 30).toISOString().slice(0, 10);
  const statusText = state.planType === 'trial' && state.trialExpiresAt
    ? `체험 종료일 ${state.trialExpiresAt}${daysLeft !== null ? ` · ${Math.max(0, daysLeft)}일 남음` : ''}`
    : '체험 기간이 설정되지 않았습니다.';
  return '<div class="settingsDetailIntro"><div class="settingsDetailTitle">샘플 학원 사용 기간을<br>관리합니다.</div></div>'
    + '<div class="settingsTrialStatusCard">'
    + '<div class="settingsTrialStatusTop"><div class="settingsTrialStatusTitle">현재 상태</div><span class="settingsTrialBadge ' + settingsEscapeAttr(badgeClass) + '">' + settingsEscapeHtml(getOlliAcademyAccessLabel(state)) + '</span></div>'
    + '<div class="settingsTrialInfoGrid">'
    + '<div class="settingsTrialInfoItem">' + settingsEscapeHtml(statusText) + '</div>'
    + '<div class="settingsTrialInfoItem">체험 종료 또는 사용 정지 상태가 되면 이 학원 공간에는 들어갈 수 없고, 저장된 데이터는 삭제하지 않습니다.</div>'
    + '</div>'
    + '<div class="settingsTrialInputRow">'
    + '<div class="settingsInputGroup"><div class="settingsInputLabel">체험 시작일</div><input id="academyTrialStartInput" class="settingsInput" type="date" value="' + settingsEscapeAttr(defaultStart) + '"></div>'
    + '<div class="settingsInputGroup"><div class="settingsInputLabel">체험 종료일</div><input id="academyTrialEndInput" class="settingsInput" type="date" value="' + settingsEscapeAttr(defaultEnd) + '"></div>'
    + '</div>'
    + '<div class="settingsActionGrid">'
    + '<button class="settingsActionBtn primary" type="button" onclick="startOlliAcademyTrialFromSettings(30)">30일 체험 시작</button>'
    + '<button class="settingsActionBtn" type="button" onclick="saveOlliAcademyTrialDatesFromSettings()">날짜 저장</button>'
    + '<button class="settingsActionBtn" type="button" onclick="activateOlliAcademyFromSettings()">정상 사용 전환</button>'
    + '<button class="settingsActionBtn red" type="button" onclick="expireOlliAcademyFromSettings()">체험 종료</button>'
    + '<button class="settingsActionBtn red" type="button" onclick="suspendOlliAcademyFromSettings()">사용 정지</button>'
    + '</div></div>';
}
async function startOlliAcademyTrialFromSettings(days = 30) {
  const start = new Date();
  const end = addOlliDays(start, Number(days) || 30);
  await persistOlliAcademyAccessState({ plan_type: 'trial', access_status: 'active', trial_started_at: start.toISOString().slice(0, 10), trial_expires_at: end.toISOString().slice(0, 10) });
  openSettingsDetail('academyAccess');
}
async function saveOlliAcademyTrialDatesFromSettings() {
  const start = document.getElementById('academyTrialStartInput')?.value || new Date().toISOString().slice(0, 10);
  const end = document.getElementById('academyTrialEndInput')?.value || addOlliDays(new Date(), 30).toISOString().slice(0, 10);
  await persistOlliAcademyAccessState({ plan_type: 'trial', access_status: 'active', trial_started_at: start, trial_expires_at: end });
  openSettingsDetail('academyAccess');
}
async function activateOlliAcademyFromSettings() {
  await persistOlliAcademyAccessState({ plan_type: 'active', access_status: 'active', trial_started_at: '', trial_expires_at: '' });
  openSettingsDetail('academyAccess');
}
async function expireOlliAcademyFromSettings() {
  if (!confirm('이 학원의 체험을 종료하고 접속을 차단할까요? 저장된 데이터는 삭제되지 않습니다.')) return;
  await persistOlliAcademyAccessState({ access_status: 'expired' });
  openSettingsDetail('academyAccess');
}
async function suspendOlliAcademyFromSettings() {
  if (!confirm('이 학원의 접속을 정지할까요? 저장된 데이터는 삭제되지 않습니다.')) return;
  await persistOlliAcademyAccessState({ access_status: 'suspended' });
  openSettingsDetail('academyAccess');
}
function showOlliAcademyAccessBlocked(state = null) {
  const s = state || getOlliCurrentAcademyAccessState(olliSettingsState?.academy || null);
  const title = s.accessStatus === 'suspended' ? '올리 사용이 정지되었습니다.' : '올리 체험 기간이 종료되었습니다.';
  const text = s.accessStatus === 'suspended'
    ? '현재 학원 공간은 관리자에 의해 사용 정지 상태입니다. 계속 사용하려면 올리로그 관리자에게 문의해 주세요.'
    : '샘플 사용 기간이 끝났습니다. 계속 사용하려면 올리로그 관리자에게 문의해 주세요. 기존 데이터는 삭제되지 않고 보관됩니다.';
  let overlay = document.getElementById('academyAccessBlockedOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'academyAccessBlockedOverlay';
    overlay.className = 'academyAccessBlockedOverlay';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = '<div class="academyAccessBlockedCard">'
    + '<div class="academyAccessBlockedTitle">' + settingsEscapeHtml(title) + '</div>'
    + '<div class="academyAccessBlockedText">' + settingsEscapeHtml(text) + '</div>'
    + '<div class="academyAccessBlockedActions">'
    + '<button class="academyAccessBlockedBtn" type="button" onclick="showOlliLoginEntry()">로그인 화면으로 이동</button>'
    + '<button class="academyAccessBlockedBtn secondary" type="button" onclick="refreshOlliAcademySwitchList && refreshOlliAcademySwitchList()">학원 목록 새로고침</button>'
    + '</div></div>';
  overlay.style.display = 'flex';
  document.body.classList.add('olli-login-open');
}
function hideOlliAcademyAccessBlocked() {
  const overlay = document.getElementById('academyAccessBlockedOverlay');
  if (overlay) overlay.style.display = 'none';
}
async function ensureOlliCurrentAcademyAccessAllowed(options = {}) {
  const opts = Object.assign({ refresh: true, autoPersistExpired: true }, options || {});
  if (opts.refresh && typeof settingsLoadAcademy === 'function') {
    try { await settingsLoadAcademy(); } catch (err) { console.warn('학원 사용 상태 새로고침 보류:', err); }
  }
  const state = getOlliCurrentAcademyAccessState(olliSettingsState?.academy || null);
  if (state.autoExpired && opts.autoPersistExpired) {
    try { await persistOlliAcademyAccessState({ access_status: 'expired' }); } catch (err) { console.warn('체험 자동 종료 상태 저장 실패:', err); }
  }
  if (state.blocked) {
    showOlliAcademyAccessBlocked(state);
    return false;
  }
  hideOlliAcademyAccessBlocked();
  return true;
}
function isOlliAcademyAccessBlockedInfo(academy = {}) {
  return getOlliCurrentAcademyAccessState(academy).blocked;
}
window.ensureOlliCurrentAcademyAccessAllowed = ensureOlliCurrentAcademyAccessAllowed;

let olliPlatformAdminAcademies = [];
let olliPlatformAdminListNotice = '';

function normalizeOlliPlatformAdminAcademy(item = {}) {
  const academyId = String(item.academy_id || item.id || '').trim();
  return {
    academy_id: academyId,
    academy_code: String(item.academy_code || item.code || '').trim(),
    academy_name: String(item.academy_name || item.name || '학원').trim(),
    region: String(item.region || item.academy_region || '').trim(),
    plan_type: String(item.plan_type || '').trim(),
    access_status: String(item.access_status || 'active').trim(),
    trial_started_at: String(item.trial_started_at || '').trim(),
    trial_expires_at: String(item.trial_expires_at || '').trim()
  };
}

function getOlliPlatformAdminFallbackAcademies() {
  const map = new Map();
  const add = academy => {
    const normalized = normalizeOlliPlatformAdminAcademy(academy);
    if (normalized.academy_id) map.set(normalized.academy_id, normalized);
  };
  try { readOlliCachedAccountAcademies().forEach(add); } catch (_) {}
  if (olliSettingsState?.academy) add(olliSettingsState.academy);
  const currentId = String(localStorage.getItem('olli_current_academy_id') || '').trim();
  if (currentId && !map.has(currentId)) {
    add({
      academy_id: currentId,
      academy_code: localStorage.getItem('olli_current_academy_code') || '',
      academy_name: localStorage.getItem('olli_current_academy_name') || '현재 학원',
      plan_type: localStorage.getItem('olli_current_academy_plan_type') || '',
      access_status: localStorage.getItem('olli_current_academy_access_status') || 'active',
      trial_started_at: localStorage.getItem('olli_current_academy_trial_started_at') || '',
      trial_expires_at: localStorage.getItem('olli_current_academy_trial_expires_at') || ''
    });
  }
  return Array.from(map.values());
}

async function fetchOlliPlatformAdminAcademiesDirect() {
  if (!isSupabaseConfigured()) return [];
  const fullSelect = 'id,academy_code,academy_name,region,status,plan_type,access_status,trial_started_at,trial_expires_at';
  const safeSelect = 'id,academy_code,academy_name,region,status';
  const attempts = [fullSelect, safeSelect];
  let lastError = null;

  for (const columns of attempts) {
    try {
      const rows = await supabase('GET', `academies?select=${columns}&order=academy_name.asc`);
      if (Array.isArray(rows)) return rows;
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error || '');
      const missingTrialColumns = /plan_type|access_status|trial_started_at|trial_expires_at|schema cache|PGRST204/i.test(message);
      if (!missingTrialColumns && columns === fullSelect) break;
    }
  }

  if (lastError) console.warn('올리 관리 직접 학원 목록 조회 실패:', lastError);
  return [];
}

async function loadOlliPlatformAdminAcademies() {
  olliPlatformAdminListNotice = '';
  if (!canUseOlliPlatformAdmin()) {
    olliPlatformAdminAcademies = [];
    return [];
  }

  const sessionToken = String(localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY) || '').trim();
  let rpcFailed = false;
  let rpcErrorMessage = '';

  if (sessionToken && typeof callOlliRpc === 'function') {
    try {
      const result = await callOlliRpc('olli_admin_list_academies', { p_session_token: sessionToken });
      const rows = Array.isArray(result?.academies) ? result.academies : (Array.isArray(result) ? result : []);
      if (rows.length) {
        olliPlatformAdminAcademies = rows.map(normalizeOlliPlatformAdminAcademy).filter(item => item.academy_id);
        return olliPlatformAdminAcademies;
      }
      rpcFailed = true;
      rpcErrorMessage = '관리자 RPC가 빈 목록을 반환했습니다.';
    } catch (err) {
      rpcFailed = true;
      rpcErrorMessage = err?.message || String(err || '');
      console.warn('올리 관리 RPC 목록 조회 실패, academies 직접 조회를 시도합니다:', err);
    }
  } else {
    rpcFailed = true;
    rpcErrorMessage = '개인계정 세션 또는 RPC 호출 함수가 준비되지 않았습니다.';
  }

  const directRows = await fetchOlliPlatformAdminAcademiesDirect();
  if (directRows.length) {
    olliPlatformAdminAcademies = directRows.map(normalizeOlliPlatformAdminAcademy).filter(item => item.academy_id);
    if (rpcFailed) {
      olliPlatformAdminListNotice = '현재 보이는 목록은 Supabase RLS 때문에 현재 계정에 연결된 학원만 보일 수 있습니다. 모든 학원을 보려면 관리자 RPC(olli_admin_list_academies)를 Supabase SQL Editor에서 생성해 주세요.' + (rpcErrorMessage ? '\n' + rpcErrorMessage : '');
    }
    return olliPlatformAdminAcademies;
  }

  olliPlatformAdminAcademies = getOlliPlatformAdminFallbackAcademies();
  if (rpcFailed) {
    olliPlatformAdminListNotice = '전체 학원 목록을 불러오려면 관리자 RPC(olli_admin_list_academies)가 필요합니다.' + (rpcErrorMessage ? '\n' + rpcErrorMessage : '');
  }
  return olliPlatformAdminAcademies;
}

function getOlliPlatformAdminAcademy(academyId) {
  const id = String(academyId || '').trim();
  return olliPlatformAdminAcademies.find(item => String(item.academy_id || '').trim() === id)
    || getOlliPlatformAdminFallbackAcademies().find(item => String(item.academy_id || '').trim() === id)
    || null;
}

async function persistOlliPlatformAcademyAccessState(academyId, patch = {}) {
  if (!canUseOlliPlatformAdmin()) throw new Error('올리 서버 관리자만 사용할 수 있습니다.');
  const targetId = String(academyId || '').trim();
  if (!targetId) throw new Error('관리할 학원 ID가 없습니다.');

  const normalized = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'plan_type') || Object.prototype.hasOwnProperty.call(patch, 'planType')) {
    normalized.plan_type = String(patch.plan_type ?? patch.planType ?? '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'access_status') || Object.prototype.hasOwnProperty.call(patch, 'accessStatus')) {
    normalized.access_status = String(patch.access_status ?? patch.accessStatus ?? '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'trial_started_at') || Object.prototype.hasOwnProperty.call(patch, 'trialStartedAt')) {
    normalized.trial_started_at = normalizeOlliIsoDate(patch.trial_started_at ?? patch.trialStartedAt ?? '') || '';
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'trial_expires_at') || Object.prototype.hasOwnProperty.call(patch, 'trialExpiresAt')) {
    normalized.trial_expires_at = normalizeOlliIsoDate(patch.trial_expires_at ?? patch.trialExpiresAt ?? '') || '';
  }

  saveOlliAcademyAccessLocal(normalized, targetId);
  const currentId = typeof getOlliCurrentAcademyId === 'function' ? String(getOlliCurrentAcademyId() || '').trim() : '';
  if (targetId === currentId) {
    await persistOlliAcademyAccessState(normalized);
  } else if (isSupabaseConfigured() && Object.keys(normalized).length) {
    const sessionToken = String(localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY) || '').trim();
    let savedByRpc = false;
    if (sessionToken && typeof callOlliRpc === 'function') {
      try {
        const result = await callOlliRpc('olli_admin_set_academy_access', {
          p_session_token: sessionToken,
          p_academy_id: targetId,
          p_plan_type: normalized.plan_type ?? null,
          p_access_status: normalized.access_status ?? null,
          p_trial_started_at: normalized.trial_started_at || null,
          p_trial_expires_at: normalized.trial_expires_at || null
        });
        if (result?.ok === true || result === true) savedByRpc = true;
      } catch (err) {
        console.warn('올리 관리 RPC 저장 실패, 직접 저장을 시도합니다:', err);
      }
    }
    if (!savedByRpc) {
      const remotePayload = { ...normalized };
      if (Object.prototype.hasOwnProperty.call(remotePayload, 'trial_started_at') && !remotePayload.trial_started_at) remotePayload.trial_started_at = null;
      if (Object.prototype.hasOwnProperty.call(remotePayload, 'trial_expires_at') && !remotePayload.trial_expires_at) remotePayload.trial_expires_at = null;
      try {
        await supabase('PATCH', `academies?id=eq.${encodeURIComponent(targetId)}`, remotePayload);
      } catch (err) {
        console.warn('올리 관리 서버 저장 실패. 로컬에는 저장되었습니다:', err);
        alert('앱에는 반영했지만 서버 저장은 실패했습니다. 서버 관리자 RPC 또는 academies 컬럼/RLS 설정을 확인해 주세요.\n\n' + (err.message || err));
      }
    }
  }
  olliPlatformAdminAcademies = olliPlatformAdminAcademies.map(item => item.academy_id === targetId ? { ...item, ...normalized } : item);
  return normalized;
}

function renderOlliPlatformAdminSettings() {
  if (!canUseOlliPlatformAdmin()) {
    return '<div class="settingsDetailIntro"><div class="settingsDetailTitle">올리 서버 관리자만<br>사용할 수 있습니다.</div></div>';
  }
  const rows = Array.isArray(olliPlatformAdminAcademies) && olliPlatformAdminAcademies.length
    ? olliPlatformAdminAcademies
    : getOlliPlatformAdminFallbackAcademies();
  const list = rows.map(academy => {
    const state = getOlliCurrentAcademyAccessState(academy);
    const daysLeft = getOlliAcademyAccessDaysLeft(state);
    const badgeClass = state.accessStatus === 'active' && state.planType === 'trial' ? 'trial' : (state.blocked ? state.accessStatus : '');
    const meta = [academy.academy_code ? `학원 ID ${academy.academy_code}` : '', academy.region || '', state.planType === 'trial' && state.trialExpiresAt ? `종료일 ${state.trialExpiresAt}` : ''].filter(Boolean).join(' · ');
    return '<div class="settingsRoleCard olliPlatformAcademyCard">'
      + '<div class="settingsRoleTop"><div class="settingsRoleName">' + settingsEscapeHtml(academy.academy_name || '학원') + '</div><span class="settingsTrialBadge ' + settingsEscapeAttr(badgeClass) + '">' + settingsEscapeHtml(getOlliAcademyAccessLabel(state)) + (daysLeft !== null && state.planType === 'trial' && state.accessStatus === 'active' ? ' · ' + Math.max(0, daysLeft) + '일' : '') + '</span></div>'
      + '<div class="settingsRoleList"><div class="settingsRoleItem">' + settingsEscapeHtml(meta || '학원 정보 없음') + '</div></div>'
      + '<div class="settingsTrialInputRow">'
      + '<div class="settingsInputGroup"><div class="settingsInputLabel">체험 시작일</div><input id="olliAdminStart_' + settingsEscapeAttr(academy.academy_id) + '" class="settingsInput" type="date" value="' + settingsEscapeAttr(state.trialStartedAt || new Date().toISOString().slice(0, 10)) + '"></div>'
      + '<div class="settingsInputGroup"><div class="settingsInputLabel">체험 종료일</div><input id="olliAdminEnd_' + settingsEscapeAttr(academy.academy_id) + '" class="settingsInput" type="date" value="' + settingsEscapeAttr(state.trialExpiresAt || addOlliDays(new Date(), 30).toISOString().slice(0, 10)) + '"></div>'
      + '</div>'
      + '<div class="settingsActionGrid">'
      + '<button class="settingsActionBtn primary" type="button" onclick="startOlliPlatformAcademyTrial(\'' + settingsEscapeAttr(academy.academy_id) + '\')">30일 체험</button>'
      + '<button class="settingsActionBtn" type="button" onclick="saveOlliPlatformAcademyTrialDates(\'' + settingsEscapeAttr(academy.academy_id) + '\')">날짜 저장</button>'
      + '<button class="settingsActionBtn" type="button" onclick="activateOlliPlatformAcademy(\'' + settingsEscapeAttr(academy.academy_id) + '\')">정상 사용</button>'
      + '<button class="settingsActionBtn red" type="button" onclick="expireOlliPlatformAcademy(\'' + settingsEscapeAttr(academy.academy_id) + '\')">체험 종료</button>'
      + '<button class="settingsActionBtn red" type="button" onclick="suspendOlliPlatformAcademy(\'' + settingsEscapeAttr(academy.academy_id) + '\')">사용 정지</button>'
      + '</div></div>';
  }).join('');
  const noticeHtml = olliPlatformAdminListNotice
    ? '<div class="settingsInfoCard" style="margin-bottom:14px;"><div class="settingsInfoHead">전체 학원 목록 확인 필요</div><div class="settingsInfoItem" style="white-space:pre-wrap;">' + settingsEscapeHtml(olliPlatformAdminListNotice) + '</div></div>'
    : '';
  return '<div class="settingsDetailIntro"><div class="settingsDetailTitle">올리 서버 관리에서만<br>체험 기간을 설정합니다.</div></div>'
    + noticeHtml
    + (list || '<div class="settingsEmptyBox">관리할 학원을 불러오지 못했습니다.</div>');
}

async function refreshOlliPlatformAdminSettings() {
  await loadOlliPlatformAdminAcademies();
  const body = document.getElementById('settingsDetailBody');
  if (body) body.innerHTML = renderOlliPlatformAdminSettings();
}
async function startOlliPlatformAcademyTrial(academyId, days = 30) {
  const start = new Date();
  const end = addOlliDays(start, Number(days) || 30);
  await persistOlliPlatformAcademyAccessState(academyId, { plan_type: 'trial', access_status: 'active', trial_started_at: start.toISOString().slice(0, 10), trial_expires_at: end.toISOString().slice(0, 10) });
  await refreshOlliPlatformAdminSettings();
}
async function saveOlliPlatformAcademyTrialDates(academyId) {
  const start = document.getElementById('olliAdminStart_' + academyId)?.value || new Date().toISOString().slice(0, 10);
  const end = document.getElementById('olliAdminEnd_' + academyId)?.value || addOlliDays(new Date(), 30).toISOString().slice(0, 10);
  await persistOlliPlatformAcademyAccessState(academyId, { plan_type: 'trial', access_status: 'active', trial_started_at: start, trial_expires_at: end });
  await refreshOlliPlatformAdminSettings();
}
async function activateOlliPlatformAcademy(academyId) {
  await persistOlliPlatformAcademyAccessState(academyId, { plan_type: 'active', access_status: 'active', trial_started_at: '', trial_expires_at: '' });
  const startInput = document.getElementById('olliAdminStart_' + academyId);
  const endInput = document.getElementById('olliAdminEnd_' + academyId);
  if (startInput) startInput.value = '';
  if (endInput) endInput.value = '';
  await refreshOlliPlatformAdminSettings();
}
async function expireOlliPlatformAcademy(academyId) {
  const academy = getOlliPlatformAdminAcademy(academyId);
  if (!confirm((academy?.academy_name || '이 학원') + '의 체험을 종료하고 접속을 차단할까요?')) return;
  await persistOlliPlatformAcademyAccessState(academyId, { access_status: 'expired' });
  await refreshOlliPlatformAdminSettings();
}
async function suspendOlliPlatformAcademy(academyId) {
  const academy = getOlliPlatformAdminAcademy(academyId);
  if (!confirm((academy?.academy_name || '이 학원') + '의 사용을 정지할까요?')) return;
  await persistOlliPlatformAcademyAccessState(academyId, { access_status: 'suspended' });
  await refreshOlliPlatformAdminSettings();
}


function renderSettingsTeacherMyAcademies() {
  const academies = getOlliAcademiesForSettings();
  const currentId = String(localStorage.getItem('olli_current_academy_id') || '').trim();
  const cards = academies.map(item => {
    const academyId = String(item.academyId || '').trim();
    const current = academyId && academyId === currentId;
    const name = item.academyName || item.academyCode || '학원';
    const roleLabel = typeof getOlliRoleLabel === 'function' ? getOlliRoleLabel(item.role) : (item.role || '선생님');
    const meta = [item.academyCode ? '학원 ID ' + item.academyCode : '', roleLabel].filter(Boolean).join(' · ');
    return '<div class="olliAcademyOption ' + (current ? 'current' : '') + '">'
      + '<div class="olliAcademyOptionMain"><div class="olliAcademyOptionName">' + settingsEscapeHtml(name) + '</div>'
      + '<div class="olliAcademyOptionMeta">' + settingsEscapeHtml(meta) + '</div></div>'
      + '<button class="olliAcademyOptionAction" type="button" '
      + (current ? 'disabled>현재 학원' : 'onclick="switchOlliAcademy(\'' + settingsEscapeAttr(academyId) + '\')">전환')
      + '</button></div>';
  }).join('');
  return '<div class="settingsDetailIntro"><div class="settingsDetailTitle">승인된 학원을<br>바로 전환합니다.</div></div>'
    + (cards ? '<div class="olliAcademyOptionList">' + cards + '</div>' : '<div class="settingsInfoCard"><div class="settingsInfoHead">연결된 학원이 없습니다.</div><div class="settingsInfoItem">다른 학원 찾기에서 승인 요청을 보내 주세요.</div></div>')
    + '<button class="settingsExportBtn" type="button" onclick="refreshSettingsTeacherMyAcademies()">내 학원 목록 새로고침</button>';
}

async function refreshSettingsTeacherMyAcademies() {
  try {
    if (typeof restoreOlliAccountSession === 'function') await restoreOlliAccountSession({ silent: true });
    const body = document.getElementById('settingsDetailBody');
    if (body) body.innerHTML = renderSettingsTeacherMyAcademies();
  } catch (error) {
    alert('내 학원 목록을 새로고침하지 못했습니다.\n' + (error?.message || error));
  }
}
window.refreshSettingsTeacherMyAcademies = refreshSettingsTeacherMyAcademies;

function renderSettingsTeacherAcademyFind() {
  return '<div class="settingsDetailIntro"><div class="settingsDetailTitle">학원 아이디나 이름 일부로<br>학원을 찾습니다.</div></div>'
    + '<div class="settingsInputGroup"><div class="settingsInputLabel">학원 아이디 또는 학원명</div><input id="settingsTeacherAcademyLookupInput" class="settingsInput" maxlength="60" autocomplete="off" placeholder="예: VIVI-5535 또는 비벼먹는"></div>'
    + '<button id="settingsTeacherAcademyLookupBtn" class="settingsExportBtn" type="button" onclick="lookupSettingsTeacherAcademy()">학원 확인</button>'
    + '<div id="settingsTeacherAcademyLookupResult" class="olliInfoBox" style="display:none;margin-top:14px;"></div>'
    + '<button id="settingsTeacherAcademyRequestBtn" class="settingsExportBtn" type="button" onclick="submitSettingsTeacherAcademyRequest()" style="margin-top:12px;">승인 요청</button>'
    + '<div class="settingsMiniText">승인 요청 후 원장님이 승인하면 내가 속한 학원 목록에 추가됩니다. 같은 학원명이 여러 개일 수 있으니 학원 아이디를 함께 확인해 주세요.</div>';
}

function renderSettingsTeacherAcademyLookupResult(academy, options) {
  const box = document.getElementById('settingsTeacherAcademyLookupResult');
  if (!box) return;
  const opts = options || {};
  box.style.display = 'block';
  if (academy) {
    box.setAttribute('data-academy-id', academy.academy_id || '');
    box.setAttribute('data-academy-code', academy.academy_code || '');
    box.setAttribute('data-academy-name', academy.academy_name || '');
    box.innerHTML = '<div class="olliInfoHead">학원 확인 완료</div>'
      + '<div class="olliInfoItem">학원명: <strong>' + settingsEscapeHtml(academy.academy_name || '이름 없음') + '</strong></div>'
      + '<div class="olliInfoItem">학원 아이디: <strong>' + settingsEscapeHtml(academy.academy_code || '') + '</strong></div>'
      + '<div class="olliSuccessBox">이 학원으로 승인 요청을 보낼 수 있습니다.</div>';
    return;
  }
  box.removeAttribute('data-academy-id');
  box.removeAttribute('data-academy-code');
  box.removeAttribute('data-academy-name');
  box.innerHTML = '<div class="olliErrorBox">' + settingsEscapeHtml(opts.message || '학원 확인에 실패했습니다.') + '</div>';
}

function selectSettingsTeacherAcademyLookupResult(academyId, academyCode, academyName) {
  const academy = {
    academy_id: String(academyId || '').trim(),
    academy_code: String(academyCode || '').trim(),
    academy_name: String(academyName || '').trim()
  };
  const input = document.getElementById('settingsTeacherAcademyLookupInput');
  if (input) input.value = academy.academy_code || academy.academy_name || '';
  renderSettingsTeacherAcademyLookupResult(academy);
  localStorage.setItem('olli_pending_academy_code', academy.academy_code || '');
  return academy;
}
window.selectSettingsTeacherAcademyLookupResult = selectSettingsTeacherAcademyLookupResult;

function renderSettingsTeacherAcademyLookupResults(list, query) {
  const box = document.getElementById('settingsTeacherAcademyLookupResult');
  if (!box) return;
  const results = Array.isArray(list) ? list : [];
  if (results.length === 1) {
    renderSettingsTeacherAcademyLookupResult(results[0]);
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
    return '<button class="olliLookupResultBtn" type="button" onclick="selectSettingsTeacherAcademyLookupResult(\'' + id + '\',\'' + code + '\',\'' + name + '\')">'
      + '<span class="olliLookupResultName">' + settingsEscapeHtml(academy.academy_name || '이름 없음') + '</span>'
      + '<span class="olliLookupResultCode">학원 아이디 ' + settingsEscapeHtml(academy.academy_code || '') + '</span>'
      + '</button>';
  }).join('');
  box.innerHTML = '<div class="olliInfoHead">검색 결과를 선택해 주세요</div>'
    + '<div class="olliInfoItem">' + settingsEscapeHtml(query || '입력한 검색어') + ' 가 포함된 학원을 모두 표시했습니다. 학원 아이디를 확인하고 선택해 주세요.</div>'
    + '<div class="olliLookupResultList">' + items + '</div>';
}

async function lookupSettingsTeacherAcademy() {
  const input = document.getElementById('settingsTeacherAcademyLookupInput');
  const btn = document.getElementById('settingsTeacherAcademyLookupBtn');
  const query = String(input?.value || '').trim();
  if (!query) { alert('학원 아이디 또는 학원명을 입력해 주세요.'); return null; }
  if (!localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY)) {
    alert('개인계정 로그인 후 학원을 찾을 수 있습니다. 먼저 계정으로 로그인해 주세요.');
    showOlliOwnerLogin();
    return null;
  }
  try {
    if (btn) { btn.disabled = true; btn.textContent = '확인 중...'; }
    const academies = await findOlliAcademiesByQueryForAccountAccess(query);
    renderSettingsTeacherAcademyLookupResults(academies, query);
    if (academies.length === 1) {
      localStorage.setItem('olli_pending_academy_code', academies[0].academy_code || query);
      return academies[0];
    }
    return null;
  } catch (error) {
    renderSettingsTeacherAcademyLookupResult(null, { message: error?.message || error });
    return null;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '학원 확인'; }
  }
}
window.lookupSettingsTeacherAcademy = lookupSettingsTeacherAcademy;

async function submitSettingsTeacherAcademyRequest() {
  const input = document.getElementById('settingsTeacherAcademyLookupInput');
  const btn = document.getElementById('settingsTeacherAcademyRequestBtn');
  const query = String(input?.value || '').trim();
  const sessionToken = String(localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY) || '').trim();
  if (!sessionToken) {
    alert('개인계정 로그인 후 승인 요청을 보낼 수 있습니다. 먼저 계정으로 로그인해 주세요.');
    showOlliOwnerLogin();
    return;
  }
  if (!query) { alert('학원 아이디 또는 학원명을 입력해 주세요.'); return; }
  try {
    if (btn) { btn.disabled = true; btn.textContent = '요청 보내는 중...'; }
    const box = document.getElementById('settingsTeacherAcademyLookupResult');
    let academy = null;
    const selectedCode = String(box?.getAttribute('data-academy-code') || '').trim();
    const selectedId = String(box?.getAttribute('data-academy-id') || '').trim();
    if (selectedCode || selectedId) {
      academy = {
        academy_id: selectedId,
        academy_code: selectedCode,
        academy_name: box?.getAttribute('data-academy-name') || ''
      };
    } else {
      academy = await findOlliAcademyByCodeForAccountAccess(query);
      renderSettingsTeacherAcademyLookupResult(academy);
    }
    const result = await callOlliRpc('olli_request_academy_access', {
      p_session_token: sessionToken,
      p_academy_code: academy.academy_code || query,
      p_requested_role: 'teacher'
    });
    if (!result || result.ok !== true) throw new Error((result && result.message) || '학원 연결 승인 요청을 저장하지 못했습니다.');
    localStorage.setItem('olli_pending_academy_code', academy.academy_code || query);
    alert((result.academy_name || academy.academy_name || academy.academy_code || query) + ' 학원에 선생님 승인 요청을 보냈습니다.\n원장님이 승인하면 내가 속한 학원에 추가됩니다.');
  } catch (error) {
    alert('승인 요청 실패\n' + (error?.message || error));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '승인 요청'; }
  }
}
window.submitSettingsTeacherAcademyRequest = submitSettingsTeacherAcademyRequest;


let settingsAttendancePrintState = {
  division: 'elementary',
  sort: 'grade',
  yearMonth: ''
};

const SETTINGS_ATTENDANCE_PRINT_ROWS_PER_PAGE = 40;

function settingsGetCurrentYearMonthValue() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return yyyy + '-' + mm;
}

function settingsGetAttendanceYearMonth() {
  const value = String(settingsAttendancePrintState.yearMonth || settingsGetCurrentYearMonthValue()).trim();
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    const fallback = settingsGetCurrentYearMonthValue().match(/^(\d{4})-(\d{2})$/);
    return { value: settingsGetCurrentYearMonthValue(), year: Number(fallback[1]), month: Number(fallback[2]) };
  }
  return { value, year: Number(match[1]), month: Number(match[2]) };
}

function settingsGetDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function settingsAttendanceGetDivisionLabel(division) {
  if (division === 'combined') return '유치부/초등부';
  return division === 'kinder' ? '유치부' : '초등부';
}

function settingsAttendanceGetStudentDivision(student, fallbackDivision) {
  const value = String(student?._attendanceDivision || fallbackDivision || settingsAttendancePrintState.division || 'elementary').trim();
  return value === 'kinder' ? 'kinder' : 'elementary';
}

function settingsAttendanceNormalizeNumber(value) {
  const m = String(value || '').match(/\d+/);
  return m ? Number(m[0]) : 9999;
}

function settingsAttendanceNormalizeDay(value) {
  return String(value || '')
    .replace(/요일/g, '')
    .replace(/[\s,，/]+/g, '')
    .trim();
}

function settingsAttendanceIsActiveStudent(student) {
  if (!student) return false;
  if (typeof getStudentStatus === 'function' && getStudentStatus(student) !== 'active') return false;
  const raw = String(student.status || '').trim().toLowerCase();
  if (['paused','pause','rest','휴원','휴원생','withdrawn','withdraw','quit','퇴원','퇴원생','inactive','deleted','removed','삭제'].includes(raw)) return false;
  if (student.is_deleted === true || String(student.is_deleted || '').toLowerCase() === 'true') return false;
  return true;
}

function settingsGetAttendanceRosterStudentsByDivision(division) {
  const safeDivision = division === 'kinder' ? 'kinder' : 'elementary';
  const all = (typeof getStudentsByType === 'function') ? getStudentsByType(safeDivision) : [];
  return all.filter(settingsAttendanceIsActiveStudent).map(student => Object.assign({}, student, { _attendanceDivision: safeDivision }));
}

function settingsGetAttendanceRosterStudents() {
  const selectedDivision = settingsAttendancePrintState.division === 'combined'
    ? 'combined'
    : (settingsAttendancePrintState.division === 'kinder' ? 'kinder' : 'elementary');
  const students = selectedDivision === 'combined'
    ? settingsGetAttendanceRosterStudentsByDivision('kinder').concat(settingsGetAttendanceRosterStudentsByDivision('elementary'))
    : settingsGetAttendanceRosterStudentsByDivision(selectedDivision);
  const sortMode = settingsAttendancePrintState.sort === 'name' ? 'name' : 'grade';
  return students.slice().sort((a, b) => {
    const ad = settingsAttendanceGetStudentDivision(a, selectedDivision);
    const bd = settingsAttendanceGetStudentDivision(b, selectedDivision);
    if (sortMode === 'name') {
      return String(a.name || '').localeCompare(String(b.name || ''), 'ko')
        || (ad === bd ? 0 : (ad === 'kinder' ? -1 : 1))
        || settingsAttendanceNormalizeNumber(a.grade || a.age) - settingsAttendanceNormalizeNumber(b.grade || b.age);
    }
    if (ad !== bd) return ad === 'kinder' ? -1 : 1;
    const av = ad === 'kinder' ? settingsAttendanceNormalizeNumber(a.age) : settingsAttendanceNormalizeNumber(a.grade);
    const bv = bd === 'kinder' ? settingsAttendanceNormalizeNumber(b.age) : settingsAttendanceNormalizeNumber(b.grade);
    return (av - bv) || String(a.name || '').localeCompare(String(b.name || ''), 'ko');
  });
}

function settingsAttendanceShortenSchoolName(value) {
  let text = String(value || '').trim();
  if (!text) return '';
  text = text.replace(/\s+/g, '');
  text = text.replace(/초등학교/g, '초');
  text = text.replace(/초등/g, '초');
  text = text.replace(/등학교/g, '');
  return text;
}

function settingsAttendanceShortenKindergartenName(value) {
  let text = String(value || '').trim();
  if (!text) return '';
  text = text.replace(/\s+/g, '');
  text = text.replace(/유치원/g, '');
  return text;
}

function settingsAttendanceGetStudentSchool(student, division) {
  const studentDivision = settingsAttendanceGetStudentDivision(student, division);
  if (studentDivision === 'kinder') return settingsAttendanceShortenKindergartenName(student.kindergarten || student.school || '');
  return settingsAttendanceShortenSchoolName(student.school || '');
}

function settingsAttendanceGetStudentGrade(student, division) {
  const studentDivision = settingsAttendanceGetStudentDivision(student, division);
  return studentDivision === 'kinder'
    ? String(student.age || '').trim()
    : String(student.grade || '').trim();
}

function settingsAttendanceShortenGradeText(value, division) {
  let text = String(value || '').trim().replace(/\s+/g, '');
  if (!text) return '';
  const m = text.match(/\d+/);
  if (m) return m[0];
  if (division === 'elementary') return text.replace(/학년/g, '');
  return text.replace(/세|살/g, '');
}

function settingsAttendanceGetStudentSchoolGrade(student, division) {
  const studentDivision = settingsAttendanceGetStudentDivision(student, division);
  const school = settingsAttendanceGetStudentSchool(student, studentDivision);
  const grade = settingsAttendanceShortenGradeText(settingsAttendanceGetStudentGrade(student, studentDivision), studentDivision);
  return (String(school || '') + String(grade || '')).trim();
}

function settingsAttendanceGetAcademyName() {
  if (typeof getOlliCurrentAcademyName === 'function' && getOlliCurrentAcademyName()) return getOlliCurrentAcademyName();
  return String(localStorage.getItem('olli_current_academy_name') || (olliSettingsState.academy && olliSettingsState.academy.academy_name) || '비비작 아이성향 미술학원').trim();
}

function settingsAttendanceDayClass(year, month, day) {
  const dow = new Date(year, month - 1, day).getDay();
  if (dow === 0) return 'daySun';
  if (dow === 6) return 'daySat';
  return '';
}

function settingsAttendancePrintInlineStyle(type, forPrint) {
  if (!forPrint) return '';
  const exact = '-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact;border:0.5px solid #777777!important;border-color:#777777!important;';
  if (type === 'header') return ' style="background-color:#2f6f9f!important;color:#ffffff!important;' + exact + '"';
  if (type === 'daySat') return ' style="background-color:#fff7c8!important;color:#111111!important;' + exact + '"';
  if (type === 'daySun') return ' style="background-color:#ffd9df!important;color:#111111!important;' + exact + '"';
  return '';
}

function settingsBuildAttendanceRegisterHtml(options = {}) {
  const forPrint = options.forPrint !== false;
  const division = settingsAttendancePrintState.division === 'combined'
    ? 'combined'
    : (settingsAttendancePrintState.division === 'kinder' ? 'kinder' : 'elementary');
  const ym = settingsGetAttendanceYearMonth();
  const days = settingsGetDaysInMonth(ym.year, ym.month);
  const students = Array.isArray(options.students) ? options.students : settingsGetAttendanceRosterStudents();
  const attendanceRows = Array.isArray(options.attendanceRows) ? options.attendanceRows : [];
  const attendanceKeys = new Set(attendanceRows.map(row => String(row?.student_id || '') + '|' + String(row?.session_date || '').slice(0, 10)));
  const academyName = settingsAttendanceGetAcademyName();
  const divisionLabel = settingsAttendanceGetDivisionLabel(division);
  const tableClass = forPrint ? 'attendancePrintTable' : 'settingsAttendancePreviewTable';
  const sheetClass = forPrint ? 'attendancePrintSheet' : '';
  const schoolGradeHeader = division === 'combined' ? '소속' : (division === 'kinder' ? '유치원/나이' : '학교/학년');
  const showDivisionCol = false;
  const staticColWidth = (showDivisionCol ? 25 : 0) + 20 + 42 + 51 + 20;
  const dateColWidth = 'calc((100% - ' + staticColWidth + 'px) / ' + days + ')';
  const tableStyle = ' style="--attendance-static-col-width:' + staticColWidth + 'px;--attendance-date-col-count:' + days + ';--attendance-date-col-width:' + dateColWidth + ';"';
  const colGroup = '<colgroup><col class="noCol">'
    + (showDivisionCol ? '<col class="divisionCol">' : '')
    + '<col class="nameCol"><col class="schoolGradeCol"><col class="personalityCol">'
    + Array.from({ length: days }, () => '<col class="dateCol">').join('')
    + '</colgroup>';
  const rowsPerPage = forPrint ? SETTINGS_ATTENDANCE_PRINT_ROWS_PER_PAGE : Math.max(students.length || 1, SETTINGS_ATTENDANCE_PRINT_ROWS_PER_PAGE);
  const totalPages = Math.max(1, Math.ceil((students.length || 1) / rowsPerPage));
  const headerStyle = settingsAttendancePrintInlineStyle('header', forPrint);
  const dayHeaders = Array.from({ length: days }, (_, i) => {
    const day = i + 1;
    const cls = settingsAttendanceDayClass(ym.year, ym.month, day);
    const dayStyle = settingsAttendancePrintInlineStyle(cls, forPrint) || headerStyle;
    return '<th class="dateCol ' + cls + '"' + dayStyle + '>' + day + '</th>';
  }).join('');
  const headerCells = '<th class="noCol"' + headerStyle + '></th>'
    + (showDivisionCol ? '<th class="divisionCol"' + headerStyle + '>구분</th>' : '')
    + '<th class="nameCol"' + headerStyle + '>이름</th><th class="schoolGradeCol"' + headerStyle + '>' + schoolGradeHeader + '</th><th class="personalityCol"' + headerStyle + '>성향</th>'
    + dayHeaders;
  const buildRow = (student, globalIndex) => {
    const studentDivision = settingsAttendanceGetStudentDivision(student, division);
    const dateCells = Array.from({ length: days }, (_, i) => {
      const day = i + 1;
      const cls = settingsAttendanceDayClass(ym.year, ym.month, day);
      const dateKey = ym.year + '-' + String(ym.month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      const marked = attendanceKeys.has(String(student.id || '') + '|' + dateKey);
      return '<td class="dateCol ' + cls + (marked ? ' attendanceLinkedMark' : '') + '"' + settingsAttendancePrintInlineStyle(cls, forPrint) + '>' + (marked ? '<span aria-label="출석">✓</span>' : '') + '</td>';
    }).join('');
    return '<tr>'
      + '<td class="noCol">' + (globalIndex + 1) + '</td>'
      + (showDivisionCol ? '<td class="divisionCol">' + settingsEscapeHtml(settingsAttendanceGetDivisionLabel(studentDivision)) + '</td>' : '')
      + '<td class="nameCol">' + settingsEscapeHtml(student.name || '') + '</td>'
      + '<td class="schoolGradeCol">' + settingsEscapeHtml(settingsAttendanceGetStudentSchoolGrade(student, studentDivision)) + '</td>'
      + '<td class="personalityCol">' + settingsEscapeHtml(student.personality || '') + '</td>'
      + dateCells
      + '</tr>';
  };
  const buildBlankRow = (globalIndex) => {
    const dateCells = Array.from({ length: days }, (_, i) => {
      const day = i + 1;
      const cls = settingsAttendanceDayClass(ym.year, ym.month, day);
      return '<td class="dateCol ' + cls + '"' + settingsAttendancePrintInlineStyle(cls, forPrint) + '></td>';
    }).join('');
    return '<tr class="attendanceBlankRow">'
      + '<td class="noCol">' + (globalIndex + 1) + '</td>'
      + (showDivisionCol ? '<td class="divisionCol"></td>' : '')
      + '<td class="nameCol"></td>'
      + '<td class="schoolGradeCol"></td>'
      + '<td class="personalityCol"></td>'
      + dateCells
      + '</tr>';
  };
  const buildPage = (pageStudents, pageIndex) => {
    const startIndex = pageIndex * rowsPerPage;
    const rows = pageStudents.map((student, index) => buildRow(student, startIndex + index)).join('');
    const blankRowCount = Math.max(0, rowsPerPage - pageStudents.length);
    const blankRows = Array.from({ length: blankRowCount }, (_, index) => buildBlankRow(startIndex + pageStudents.length + index)).join('');
    return '<div class="attendancePrintPage">'
      + '<div class="attendancePrintHeader">'
      + '<div class="attendancePrintAcademy">' + settingsEscapeHtml(academyName) + ' (' + divisionLabel + ')</div>'
      + '<div class="attendancePrintMonth">' + ym.year + '년 ' + ym.month + '월</div>'
      + '</div>'
      + '<table class="' + tableClass + '"' + tableStyle + '>'
      + colGroup + '<thead><tr>' + headerCells + '</tr></thead><tbody>' + rows + blankRows + '</tbody></table>'
      + '</div>';
  };
  const pages = [];
  if (students.length) {
    for (let i = 0; i < students.length; i += rowsPerPage) pages.push(buildPage(students.slice(i, i + rowsPerPage), Math.floor(i / rowsPerPage)));
  } else {
    pages.push(buildPage([], 0));
  }
  return '<div class="' + sheetClass + '">' + pages.join('') + '</div>';
}

window.olliBuildLinkedAttendanceRegisterHtml = function(options = {}) {
  const previous = { division: settingsAttendancePrintState.division, sort: settingsAttendancePrintState.sort, yearMonth: settingsAttendancePrintState.yearMonth };
  settingsAttendancePrintState.division = options.division === 'combined' ? 'combined' : (options.division === 'kinder' ? 'kinder' : 'elementary');
  settingsAttendancePrintState.sort = options.sort === 'name' ? 'name' : 'grade';
  settingsAttendancePrintState.yearMonth = /^\d{4}-\d{2}$/.test(String(options.yearMonth || '')) ? String(options.yearMonth) : settingsGetCurrentYearMonthValue();
  try {
    const requestedIds = Array.isArray(options.students) ? new Set(options.students.map(student => String(student?.id || ''))) : null;
    const students = requestedIds ? settingsGetAttendanceRosterStudents().filter(student => requestedIds.has(String(student?.id || ''))) : undefined;
    return settingsBuildAttendanceRegisterHtml({ forPrint: false, attendanceRows: options.attendanceRows || [], students });
  }
  finally { settingsAttendancePrintState.division = previous.division; settingsAttendancePrintState.sort = previous.sort; settingsAttendancePrintState.yearMonth = previous.yearMonth; }
};


function settingsAttendanceFitTextCells(root) {
  const scope = root && root.querySelectorAll ? root : document;
  const cells = scope.querySelectorAll('.settingsAttendancePreviewTable tbody td.nameCol, .settingsAttendancePreviewTable tbody td.schoolGradeCol, .settingsAttendancePreviewTable tbody td.personalityCol, .attendancePrintTable tbody td.nameCol, .attendancePrintTable tbody td.schoolGradeCol, .attendancePrintTable tbody td.personalityCol');
  cells.forEach(cell => {
    if (!cell || !String(cell.textContent || '').trim()) return;
    cell.style.whiteSpace = 'nowrap';
    cell.style.overflow = 'hidden';
    cell.style.textOverflow = 'clip';
    cell.style.fontSize = '';

    // 행 높이(26px) 때문에 scrollHeight가 1~2px 크게 잡히면,
    // 글자가 충분히 들어가도 모든 셀이 과하게 작아지는 문제가 생긴다.
    // 그래서 자동 축소는 "가로 폭이 실제로 넘칠 때"만 적용한다.
    const availableWidth = Math.max(0, cell.clientWidth - 1);
    if (availableWidth <= 4) return;
    if (cell.scrollWidth <= availableWidth + 1) return;

    const computed = window.getComputedStyle(cell);
    let size = parseFloat(computed.fontSize) || 10;
    const table = cell.closest('.attendancePrintTable');
    const minSize = table ? 10.2 : 11.2;
    let loop = 0;
    while (cell.scrollWidth > availableWidth + 1 && size > minSize && loop < 12) {
      size = Math.max(minSize, size - 0.3);
      cell.style.fontSize = size.toFixed(1) + 'px';
      loop += 1;
    }
  });
}
window.settingsAttendanceFitTextCells = settingsAttendanceFitTextCells;
function settingsAttendanceScheduleFitText(root) {
  const target = root && root.querySelectorAll ? root : document;
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => settingsAttendanceFitTextCells(target));
  } else {
    setTimeout(() => settingsAttendanceFitTextCells(target), 0);
  }
}
window.settingsAttendanceScheduleFitText = settingsAttendanceScheduleFitText;

function renderSettingsAttendancePrintPreview() {
  const students = settingsGetAttendanceRosterStudents();
  const ym = settingsGetAttendanceYearMonth();
  const divisionLabel = settingsAttendanceGetDivisionLabel(settingsAttendancePrintState.division);
  const meta = students.length + '명 · ' + settingsGetDaysInMonth(ym.year, ym.month) + '일';
  const preview = settingsBuildAttendanceRegisterHtml({ forPrint: false });
  return '<div class="settingsAttendancePreviewCard">'
    + '<div class="settingsAttendancePreviewHead"><div class="settingsAttendancePreviewTitle">' + ym.year + '년 ' + ym.month + '월 ' + divisionLabel + ' 출석부</div><div class="settingsAttendancePreviewMeta">' + meta + '</div></div>'
    + '<div class="settingsAttendancePreviewScroll">' + preview + '</div>'
    + '</div>';
}

function renderSettingsAttendancePrint() {
  if (!settingsAttendancePrintState.yearMonth) settingsAttendancePrintState.yearMonth = settingsGetCurrentYearMonthValue();
  const division = settingsAttendancePrintState.division === 'combined'
    ? 'combined'
    : (settingsAttendancePrintState.division === 'kinder' ? 'kinder' : 'elementary');
  const sort = settingsAttendancePrintState.sort === 'name' ? 'name' : 'grade';
  const ym = settingsGetAttendanceYearMonth();
  const students = settingsGetAttendanceRosterStudents();
  const disabled = students.length ? '' : ' disabled';
  return '<div class="settingsDetailIntro"><div class="settingsDetailTitle">등록된 재원생으로<br>출석부 PDF를 만듭니다.</div></div>'
    + '<div class="settingsAttendanceControlCard">'
    + '<div class="settingsAttendanceFieldLabel">부서 선택</div>'
    + '<div class="settingsAttendanceSegment divisionSegment">'
    + '<button type="button" class="settingsAttendanceSegmentBtn ' + (division === 'elementary' ? 'active' : '') + '" onclick="settingsAttendanceSetDivision(\'elementary\')">초등부</button>'
    + '<button type="button" class="settingsAttendanceSegmentBtn ' + (division === 'kinder' ? 'active' : '') + '" onclick="settingsAttendanceSetDivision(\'kinder\')">유치부</button>'
    + '<button type="button" class="settingsAttendanceSegmentBtn ' + (division === 'combined' ? 'active' : '') + '" onclick="settingsAttendanceSetDivision(\'combined\')">통합</button>'
    + '</div>'
    + '<div class="settingsAttendanceFieldLabel">월 선택</div>'
    + '<input class="settingsAttendanceMonthInput" type="month" value="' + settingsEscapeAttr(ym.value) + '" onchange="settingsAttendanceSetMonth(this.value)">'
    + '<div class="settingsAttendanceFieldLabel">정렬 기준</div>'
    + '<div class="settingsAttendanceSegment">'
    + '<button type="button" class="settingsAttendanceSegmentBtn ' + (sort === 'grade' ? 'active' : '') + '" onclick="settingsAttendanceSetSort(\'grade\')">학년순</button>'
    + '<button type="button" class="settingsAttendanceSegmentBtn ' + (sort === 'name' ? 'active' : '') + '" onclick="settingsAttendanceSetSort(\'name\')">이름순</button>'
    + '</div>'
    + '<div class="settingsAttendanceGuide">출력 대상은 재원생만 포함됩니다. 통합은 유치부와 초등부가 한 출석부에 함께 표시됩니다. PDF는 1페이지당 최대 ' + SETTINGS_ATTENDANCE_PRINT_ROWS_PER_PAGE + '명씩 나뉘고 번호는 다음 페이지로 이어집니다.</div>'
    + '<div class="settingsAttendanceActionGrid">'
    + '<button type="button" class="settingsAttendanceActionBtn" onclick="openSettingsAttendanceRegisterPrint()"' + disabled + '>인쇄 화면</button>'
    + '<button type="button" class="settingsAttendanceActionBtn primary" onclick="downloadSettingsAttendanceRegisterPdf()"' + disabled + '>PDF 다운로드</button>'
    + '</div>'
    + '</div>'
    + renderSettingsAttendancePrintPreview();
}

function settingsAttendanceRefreshDetail() {
  if (settingsCurrentDetailType !== 'attendancePrint') return;
  const body = document.getElementById('settingsDetailBody');
  if (body) {
    body.innerHTML = renderSettingsAttendancePrint();
    settingsAttendanceScheduleFitText(body);
  }
}

function settingsAttendanceSetDivision(division) {
  settingsAttendancePrintState.division = division === 'combined' ? 'combined' : (division === 'kinder' ? 'kinder' : 'elementary');
  settingsAttendanceRefreshDetail();
}
window.settingsAttendanceSetDivision = settingsAttendanceSetDivision;

function settingsAttendanceSetSort(sort) {
  settingsAttendancePrintState.sort = sort === 'name' ? 'name' : 'grade';
  settingsAttendanceRefreshDetail();
}
window.settingsAttendanceSetSort = settingsAttendanceSetSort;

function settingsAttendanceSetMonth(value) {
  const safeValue = String(value || '').match(/^\d{4}-\d{2}$/) ? String(value) : settingsGetCurrentYearMonthValue();
  settingsAttendancePrintState.yearMonth = safeValue;
  settingsAttendanceRefreshDetail();
}
window.settingsAttendanceSetMonth = settingsAttendanceSetMonth;

function settingsAttendanceBuildStandaloneHtml() {
  const html = settingsBuildAttendanceRegisterHtml({ forPrint: true });
  return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>출석부 출력</title>'
    + '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/pretendard.css">'
    + '<style>html,body{margin:0;padding:0;background:#fff;font-family:\'Pretendard\',-apple-system,BlinkMacSystemFont,sans-serif;color:#111;}body{padding:4mm 5mm;}@page{size:A4 portrait;margin:4mm 5mm;}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important;}'
    + '.attendancePrintSheet{width:100%;background:#fff;color:#111;font-family:\'Pretendard\',-apple-system,BlinkMacSystemFont,sans-serif}.attendancePrintPage{width:100%;page-break-after:always;break-after:page;page-break-inside:avoid;break-inside:avoid}.attendancePrintPage:last-child{page-break-after:auto;break-after:auto}.attendancePrintHeader{padding-top:10px;margin-bottom:5px}.attendancePrintAcademy{font-size:15px;line-height:1.05;font-weight:760;color:#1f4776;letter-spacing:-.035em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.attendancePrintMonth{margin-top:1px;font-size:31px;line-height:.98;font-weight:900;color:#1f4776;letter-spacing:-.055em}.attendancePrintTable{width:100%;border-collapse:collapse;border-spacing:0;table-layout:fixed;color:#111}.attendancePrintTable th,.attendancePrintTable td{border:0.5px solid #777777;height:23px;padding:.5px 1.5px;text-align:center;vertical-align:middle;overflow:hidden;white-space:nowrap;text-overflow:clip}.attendancePrintTable th{background:#2f6f9f!important;background-color:#2f6f9f!important;color:#fff!important;font-size:8.4px;font-weight:760;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}.attendancePrintTable tbody td{font-size:10.6px;font-weight:560}.attendancePrintTable tbody td.nameCol,.attendancePrintTable tbody td.schoolGradeCol,.attendancePrintTable tbody td.personalityCol{line-height:1.05}.attendancePrintTable tbody td.nameCol{font-size:12px;font-weight:700}.attendancePrintTable tbody td.schoolGradeCol{font-size:11.6px;font-weight:600}.attendancePrintTable tbody td.personalityCol{font-size:11.4px;font-weight:600}.attendancePrintTable .noCol{width:20px;padding-left:0!important;padding-right:0!important}.attendancePrintTable .divisionCol{width:25px}.attendancePrintTable .nameCol{width:43px;padding-left:0!important;padding-right:0!important;text-align:center;font-weight:780}.attendancePrintTable .schoolGradeCol{width:52px;padding-left:0!important;padding-right:0!important;text-align:center;font-weight:660}.attendancePrintTable .personalityCol{width:20px;padding-left:0!important;padding-right:0!important}.attendancePrintTable .dateCol,.attendancePrintTable col.dateCol{width:var(--attendance-date-col-width,14px);padding-left:0!important;padding-right:0!important}.attendancePrintTable th.daySat,.attendancePrintTable td.daySat{background:#fff7c8!important;background-color:#fff7c8!important;color:#111!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}.attendancePrintTable th.daySun,.attendancePrintTable td.daySun{background:#ffd9df!important;background-color:#ffd9df!important;color:#111!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}body{padding:0}}'
    + '</style>'
    + '</head><body>' + html + '<script>(function(){function fitTextCells(){var cells=document.querySelectorAll(".attendancePrintTable tbody td.nameCol,.attendancePrintTable tbody td.schoolGradeCol,.attendancePrintTable tbody td.personalityCol");cells.forEach(function(cell){if(!cell||!String(cell.textContent||"").trim())return;cell.style.whiteSpace="nowrap";cell.style.overflow="hidden";cell.style.textOverflow="clip";cell.style.fontSize="";var availableWidth=Math.max(0,cell.clientWidth-1);if(availableWidth<=4)return;if(cell.scrollWidth<=availableWidth+1)return;var cs=window.getComputedStyle(cell);var size=parseFloat(cs.fontSize)||10;var min=10.2;var loop=0;while(cell.scrollWidth>availableWidth+1&&size>min&&loop<12){size=Math.max(min,size-0.3);cell.style.fontSize=size.toFixed(1)+"px";loop++}})};var didPrint=false;var closeTimer=null;var printStartedAt=0;function backToApp(){if(closeTimer)return;closeTimer=setTimeout(function(){try{if(window.opener&&!window.opener.closed){window.opener.focus();}}catch(e){}try{window.close();}catch(e){}},120);}window.addEventListener("afterprint",backToApp);window.addEventListener("focus",function(){if(didPrint&&Date.now()-printStartedAt>900){setTimeout(backToApp,450);}});setTimeout(function(){fitTextCells();didPrint=true;printStartedAt=Date.now();window.focus();setTimeout(function(){window.print();},80);},350);})();<\/script></body></html>';
}
function openSettingsAttendanceRegisterPrint() {
  const students = settingsGetAttendanceRosterStudents();
  if (!students.length) { alert('출력할 재원생이 없습니다.'); return; }
  const popup = window.open('', '_blank');
  if (!popup) {
    alert('팝업이 차단되어 인쇄 화면을 열 수 없습니다. 브라우저 팝업 허용 후 다시 시도해 주세요.');
    return;
  }
  popup.document.open();
  popup.document.write(settingsAttendanceBuildStandaloneHtml());
  popup.document.close();
}
window.openSettingsAttendanceRegisterPrint = openSettingsAttendanceRegisterPrint;

function settingsLoadHtml2PdfLibrary() {
  return new Promise((resolve, reject) => {
    if (window.html2pdf) { resolve(window.html2pdf); return; }
    const existing = document.querySelector('script[data-olli-html2pdf="true"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.html2pdf), { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
    script.async = true;
    script.dataset.olliHtml2pdf = 'true';
    script.onload = () => resolve(window.html2pdf);
    script.onerror = () => reject(new Error('PDF 라이브러리를 불러오지 못했습니다.'));
    document.head.appendChild(script);
  });
}

async function downloadSettingsAttendanceRegisterPdf() {
  const students = settingsGetAttendanceRosterStudents();
  if (!students.length) { alert('출력할 재원생이 없습니다.'); return; }
  const btns = Array.from(document.querySelectorAll('.settingsAttendanceActionBtn'));
  btns.forEach(btn => { btn.disabled = true; });
  const ym = settingsGetAttendanceYearMonth();
  const divisionLabel = settingsAttendanceGetDivisionLabel(settingsAttendancePrintState.division);
  const academyName = settingsAttendanceGetAcademyName().replace(/[\\/:*?"<>|]/g, '').trim() || '학원';
  const safeDivisionLabel = String(divisionLabel || '').replace(/[\\/:*?"<>|]/g, '_');
  const filename = academyName + '_' + safeDivisionLabel + '_' + ym.year + '년_' + ym.month + '월_출석부.pdf';
  const wrap = document.createElement('div');
  wrap.style.position = 'fixed';
  wrap.style.left = '-10000px';
  wrap.style.top = '0';
  wrap.style.width = '198mm';
  wrap.style.background = '#fff';
  wrap.style.padding = '0';
  wrap.style.webkitPrintColorAdjust = 'exact';
  wrap.style.printColorAdjust = 'exact';
  wrap.style.colorAdjust = 'exact';
  wrap.innerHTML = settingsBuildAttendanceRegisterHtml({ forPrint: true });
  document.body.appendChild(wrap);
  settingsAttendanceFitTextCells(wrap);
  try {
    const html2pdf = await settingsLoadHtml2PdfLibrary();
    await html2pdf().set({
      margin: [8, 6, 8, 6],
      filename,
      image: { type: 'png', quality: 1 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        letterRendering: true,
        onclone: function(doc) {
          doc.querySelectorAll('.attendancePrintSheet, .attendancePrintSheet *, .attendancePrintTable, .attendancePrintTable *').forEach(function(el) {
            el.style.webkitPrintColorAdjust = 'exact';
            el.style.printColorAdjust = 'exact';
            el.style.colorAdjust = 'exact';
          });
          doc.querySelectorAll('.attendancePrintTable th, .attendancePrintTable td').forEach(function(cell) {
            cell.style.border = '0.5px solid #777777';
            cell.style.borderColor = '#777777';
          });
        }
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'] }
    }).from(wrap).save();
  } catch (err) {
    alert('PDF 다운로드를 바로 실행하지 못해 인쇄 화면으로 열겠습니다.\n브라우저에서 PDF 저장을 선택해 주세요.');
    openSettingsAttendanceRegisterPrint();
  } finally {
    wrap.remove();
    btns.forEach(btn => { btn.disabled = false; });
  }
}
window.downloadSettingsAttendanceRegisterPdf = downloadSettingsAttendanceRegisterPdf;

const settingsDetailData = {
  storageDiagnostics:{title:'저장 진단',html:renderOlliStorageDiagnostics},
  platformAdmin:{title:'올리 관리',html:renderOlliPlatformAdminSettings,beforeOpen:loadOlliPlatformAdminAcademies},
  academySwitch:{title:'학원 관리',html:renderOlliAcademySwitchOptions,instantRender:true,beforeOpen:async function(){ if (typeof restoreOlliAccountSession === 'function') await restoreOlliAccountSession({ silent: true }); if (typeof loadOlliAcademyManagementData === 'function') await loadOlliAcademyManagementData(); }},
  ownerOtherAcademyFind:{title:'다른 학원 찾기',html:renderOlliOwnerOtherAcademyFindOptions,instantRender:true,beforeOpen:async function(){ if (typeof restoreOlliAccountSession === 'function') await restoreOlliAccountSession({ silent: true }); }},
  teacherMyAcademies:{title:'내가 속한 학원',html:renderSettingsTeacherMyAcademies,instantRender:true,beforeOpen:async function(){ if (typeof restoreOlliAccountSession === 'function') await restoreOlliAccountSession({ silent: true }); }},
  teacherAcademyFind:{title:'다른 학원 찾기',html:renderSettingsTeacherAcademyFind,instantRender:true},
  academyAccess:{title:'사용 상태',html:renderOlliAcademyAccessSettings,beforeOpen:settingsLoadAcademy},
  attendancePhotoImport:{title:'학생정보 일괄 수정',html:renderSettingsAttendancePhotoImport},
  attendancePrint:{title:'출석부 출력',html:renderSettingsAttendancePrint,instantRender:true},
  roles:{title:'권한 설정',html:function(){return '<div class="settingsDetailIntro"><div class="settingsDetailTitle">역할에 맞는 권한으로<br/>학생 기록을 안전하게 관리합니다.</div></div><div class="settingsRoleCard"><div class="settingsRoleTop"><div class="settingsRoleName">원장</div><span class="settingsStatusBadge">전체 권한</span></div><div class="settingsRoleList"><div class="settingsRoleItem">전체 학생과 모든 피드백 확인</div><div class="settingsRoleItem">백업 / 내보내기 사용 가능</div><div class="settingsRoleItem">선생님 계정과 권한 관리</div></div></div><div class="settingsRoleCard"><div class="settingsRoleTop"><div class="settingsRoleName">관리자</div><span class="settingsStatusBadge">점검 권한</span></div><div class="settingsRoleList"><div class="settingsRoleItem">학생 기록과 피드백 흐름 점검</div><div class="settingsRoleItem">선생님 기록 상태 확인</div><div class="settingsRoleItem">백업/내보내기와 운영 판단은 제한</div></div></div><div class="settingsRoleCard"><div class="settingsRoleTop"><div class="settingsRoleName">선생님</div><span class="settingsStatusBadge">기록 권한</span></div><div class="settingsRoleList"><div class="settingsRoleItem">담당 학생 기록 작성</div><div class="settingsRoleItem">피드백 작성과 성장 피드백 입력</div><div class="settingsRoleItem">권한 변경과 데이터 내보내기는 제한</div></div></div>';}},
  teachers:{title:'선생님 관리',html:renderSettingsMembers,instantRender:true,beforeOpen:settingsLoadTeacherManagementMembers},
  teacherInvite:{title:'선생님 초대',html:renderSettingsTeacherInvite,instantRender:true,beforeOpen:settingsLoadAllApprovalRequests},
  approval:{title:'승인 요청',html:renderSettingsApprovalRequests, beforeOpen:settingsLoadAllApprovalRequests},
  backup:{title:'백업 / 내보내기',html:function(){return '<div class="settingsDetailIntro"><div class="settingsDetailTitle">백업과 내보내기는<br/>원장만 사용할 수 있습니다.</div></div><div class="settingsCard"><div class="settingsRow"><div class="settingsRowLeft"><span class="settingsRowTitle">전체 학생 데이터</span></div><span class="settingsBadge">JSON</span></div><div class="settingsRow"><div class="settingsRowLeft"><span class="settingsRowTitle">피드백 기록</span></div><span class="settingsBadge">JSON</span></div></div><button class="settingsExportBtn" onclick="downloadSettingsBackup()" type="button">전체 데이터 내보내기</button>';}},
  privacy:{title:'개인정보 처리방침',html:function(){return '<div class="settingsDetailIntro"><div class="settingsDetailTitle">학생 기록은<br/>안전하게 관리되어야 합니다.</div></div><div class="settingsInfoCard"><div class="settingsInfoHead">수집되는 정보</div><div class="settingsInfoList"><div class="settingsInfoItem">학생 이름, 등록일, 반 정보</div><div class="settingsInfoItem">수업 기록과 피드백 내용</div><div class="settingsInfoItem">선생님 계정 및 작성 기록</div></div></div><div class="settingsInfoCard"><div class="settingsInfoHead">AI 사용 안내</div><div class="settingsInfoList"><div class="settingsInfoItem">AI 생성 문구는 자동 발송되지 않습니다.</div><div class="settingsInfoItem">선생님 또는 원장의 검토 후 사용해야 합니다.</div></div></div>';}}
};

let settingsCurrentDetailType = '';

function renderSettingsDetailHtml(data) {
  return typeof data.html === 'function' ? data.html() : data.html;
}

async function openSettingsDetail(type){
  const data = settingsDetailData[type];
  if(!data) return;
  const detail = document.getElementById('settingsDetailScreen');
  const settings = document.getElementById('settingsPageScreen');
  const titlePill = document.getElementById('settingsDetailTitlePill');
  const body = document.getElementById('settingsDetailBody');
  if(!detail || !body) return;

  settingsCurrentDetailType = type;
  if (settings) settings.style.display = 'flex';
  if (titlePill) titlePill.textContent = data.title;

  // 데이터가 필요한 설정 페이지도 먼저 화면을 열고, 최신 데이터는 뒤에서 조용히 갱신합니다.
  try {
    body.innerHTML = data.instantRender ? renderSettingsDetailHtml(data) : '<div class="settingsLoadingText">불러오는 중입니다...</div>';
    if (type === 'attendancePrint') settingsAttendanceScheduleFitText(body);
  } catch (renderError) {
    body.innerHTML = '<div class="settingsLoadingText">화면을 준비하고 있습니다.</div>';
  }

  // 기존 슬라이드 함수와 충돌하지 않도록 설정 상세도 독립 오버레이로 표시
  detail.style.display = 'flex';
  detail.style.position = 'fixed';
  detail.style.inset = '0';
  detail.style.transform = 'translateX(0)';
  detail.style.opacity = '1';
  detail.style.pointerEvents = 'auto';
  detail.style.zIndex = '91000';

  try {
    if (typeof data.beforeOpen === 'function') await data.beforeOpen();
    if (settingsCurrentDetailType !== type || detail.style.display === 'none') return;
    body.innerHTML = renderSettingsDetailHtml(data);
    if (type === 'attendancePrint') settingsAttendanceScheduleFitText(body);
  } catch (err) {
    if (settingsCurrentDetailType !== type || detail.style.display === 'none') return;
    olliSettingsState.lastError = err.message || String(err);
    body.innerHTML = data.instantRender
      ? (renderSettingsErrorIfNeeded() + renderSettingsDetailHtml(data))
      : renderSettingsErrorIfNeeded();
  }
}

function closeSettingsDetail(){
  settingsCurrentDetailType = '';
  const detail = document.getElementById('settingsDetailScreen');
  const settings = document.getElementById('settingsPageScreen');

  if(detail) {
    detail.style.display = 'none';
    detail.style.transform = '';
    detail.style.opacity = '';
    detail.style.pointerEvents = '';
  }

  if(settings) settings.style.display = 'flex';
}

// 설정 상세 페이지 버튼은 기존 openSettingsDetail 함수를 전역에 명시적으로 노출합니다.
// 인라인 onclick이 전역 window에서 함수를 찾기 때문에, 이 연결이 끊기면 팝업 버튼은 살아 있어도
// 페이지 이동형 설정 버튼만 반응하지 않을 수 있습니다.
window.openSettingsDetail = openSettingsDetail;
window.closeSettingsDetail = closeSettingsDetail;

document.addEventListener('DOMContentLoaded', function(){
  settingsApplyStateToUI();
});
