const OLLI_ACCOUNT_SESSION_TOKEN_KEY = 'olli_account_session_token_v1';
const OLLI_ACCOUNT_LOGIN_ID_KEY = 'olli_account_login_id_v1';
const OLLI_ACCOUNT_ID_KEY = 'olli_account_id_v1';
const OLLI_ACCOUNT_NAME_KEY = 'olli_account_name_v1';
const OLLI_ACCOUNT_ACADEMIES_KEY = 'olli_account_academies_v1';
const OLLI_ACCOUNT_DEVICE_ID_KEY = 'olli_account_device_id_v1';

function getOlliFirstTextValue(source, keys) {
  if (!source || typeof source !== 'object') return '';
  for (const key of keys || []) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}


function getOlliOwnerMemberIdFromAcademy(academy) {
  return getOlliFirstTextValue(academy, [
    'owner_member_id',
    'ownerMemberId',
    'owner_members_id',
    'ownerMembersId',
    'member_id',
    'memberId',
    'membership_id',
    'membershipId',
    'academy_member_id',
    'academyMemberId',
    'account_membership_id',
    'accountMembershipId'
  ]);
}

function normalizeOlliRoleValue(value, fallback) {
  const role = String(value || '').trim();
  return ['owner', 'manager', 'teacher', 'super_admin'].includes(role) ? role : (fallback || 'teacher');
}

function normalizeOlliAccountAcademies(list) {
  return (Array.isArray(list) ? list : []).map(item => {
    const academyId = getOlliFirstTextValue(item, ['academy_id', 'academyId', 'academy_uuid', 'academyUuid', 'id']);
    const memberId = getOlliFirstTextValue(item, [
      'member_id',
      'memberId',
      'membership_id',
      'membershipId',
      'academy_member_id',
      'academyMemberId',
      'account_membership_id',
      'accountMembershipId',
      'owner_member_id',
      'ownerMemberId',
      'owner_members_id',
      'ownerMembersId',
      'teacher_member_id',
      'teacherMemberId'
    ]);
    const roleValue = getOlliFirstTextValue(item, [
      'role',
      'member_role',
      'membership_role',
      'role_name',
      'account_role',
      'permission_role'
    ]);
    return {
      academy_id: academyId,
      academy_code: getOlliFirstTextValue(item, ['academy_code', 'academyCode', 'code']),
      academy_name: getOlliFirstTextValue(item, ['academy_name', 'academyName', 'name']),
      region: getOlliFirstTextValue(item, ['region', 'academy_region', 'academyRegion']),
      member_id: memberId,
      member_name: getOlliFirstTextValue(item, ['member_name', 'memberName', 'display_name', 'displayName', 'teacher_name', 'teacherName', 'owner_name', 'ownerName', 'account_name', 'accountName']),
      role: normalizeOlliRoleValue(roleValue, 'teacher'),
      membership_status: getOlliFirstTextValue(item, ['membership_status', 'member_status', 'membershipStatus', 'memberStatus']) || 'active',
      plan_type: getOlliFirstTextValue(item, ['plan_type', 'academy_plan_type', 'planType', 'academyPlanType']),
      access_status: getOlliFirstTextValue(item, ['access_status', 'academy_access_status', 'accessStatus', 'academyAccessStatus', 'status']) || 'active',
      trial_started_at: getOlliFirstTextValue(item, ['trial_started_at', 'academy_trial_started_at', 'trialStartedAt', 'academyTrialStartedAt']),
      trial_expires_at: getOlliFirstTextValue(item, ['trial_expires_at', 'academy_trial_expires_at', 'trialExpiresAt', 'academyTrialExpiresAt']),
      default_start_page: getOlliFirstTextValue(item, ['default_start_page', 'defaultStartPage', 'member_default_start_page', 'start_page', 'startPage'])
    };
  }).filter(item => item.academy_id && String(item.membership_status || 'active').trim() === 'active');
}

function readOlliCachedAccountAcademies() {
  try {
    return normalizeOlliAccountAcademies(JSON.parse(localStorage.getItem(OLLI_ACCOUNT_ACADEMIES_KEY) || '[]'));
  } catch (error) {
    console.warn('다학원 목록 캐시를 읽지 못했습니다.', error);
    return [];
  }
}

function isOlliDeletedAcademyStatus(value) {
  return ['deleted', 'removed', 'inactive', 'disabled', 'archived', '삭제', '삭제됨', '비활성'].includes(String(value || '').trim().toLowerCase());
}

function isOlliAcademyDeletedLikeInfo(academy = {}) {
  return isOlliDeletedAcademyStatus(academy.access_status || academy.accessStatus)
    || isOlliDeletedAcademyStatus(academy.academy_access_status)
    || isOlliDeletedAcademyStatus(academy.status || academy.academy_status);
}

function mergeOlliAcademyServerInfo(localAcademy = {}, serverAcademy = {}) {
  if (!serverAcademy || typeof serverAcademy !== 'object') return localAcademy || {};
  return {
    ...localAcademy,
    ...serverAcademy,
    academy_id: String(localAcademy.academy_id || localAcademy.academyId || serverAcademy.id || serverAcademy.academy_id || '').trim(),
    academyId: String(localAcademy.academyId || localAcademy.academy_id || serverAcademy.id || serverAcademy.academy_id || '').trim(),
    academy_code: String(serverAcademy.academy_code || localAcademy.academy_code || localAcademy.academyCode || '').trim(),
    academyCode: String(serverAcademy.academy_code || localAcademy.academyCode || localAcademy.academy_code || '').trim(),
    academy_name: String(serverAcademy.academy_name || localAcademy.academy_name || localAcademy.academyName || '').trim(),
    academyName: String(serverAcademy.academy_name || localAcademy.academyName || localAcademy.academy_name || '').trim(),
    region: String(serverAcademy.region || serverAcademy.academy_region || localAcademy.region || '').trim(),
    plan_type: String(serverAcademy.plan_type || localAcademy.plan_type || localAcademy.academy_plan_type || '').trim(),
    access_status: String(serverAcademy.access_status || localAcademy.access_status || localAcademy.accessStatus || 'active').trim(),
    trial_started_at: String(serverAcademy.trial_started_at || localAcademy.trial_started_at || '').trim(),
    trial_expires_at: String(serverAcademy.trial_expires_at || localAcademy.trial_expires_at || '').trim()
  };
}

async function fetchOlliAcademyRowByIdentity(academy = {}) {
  const academyId = String(academy?.academy_id || academy?.academyId || academy?.id || '').trim();
  const academyCode = String(academy?.academy_code || academy?.academyCode || '').trim();
  if (!isSupabaseConfigured()) return { exists: true, unchecked: true, row: academy };

  try {
    let rows = [];
    if (academyId) {
      rows = await supabase('GET', `academies?select=*&id=eq.${encodeURIComponent(academyId)}&limit=1`);
    }
    if ((!Array.isArray(rows) || !rows.length) && academyCode) {
      rows = await supabase('GET', `academies?select=*&academy_code=eq.${encodeURIComponent(academyCode)}&limit=1`);
    }
    const row = Array.isArray(rows) && rows.length ? rows[0] : null;
    // 주의: Supabase RLS/컬럼 차이/예전 학원 ID 로그인 결과 때문에
    // academies 직접 조회가 빈 배열로 돌아오는 경우가 있습니다.
    // 이 값을 곧바로 삭제된 학원으로 판단하면 정상 학원까지 모두 차단됩니다.
    // 따라서 명시적인 deleted/inactive 상태가 확인된 경우만 차단하고,
    // 조회 결과가 없을 때는 로그인/RPC 결과를 우선 신뢰합니다.
    if (!row) return { exists: true, unchecked: true, row: academy, notFoundButTrusted: true };
    if (isOlliAcademyDeletedLikeInfo(row)) return { exists: false, row, deletedStatus: true };
    return { exists: true, row };
  } catch (error) {
    // 네트워크/RLS 문제만으로 정상 학원을 로그아웃시키지 않기 위해 조회 실패는 차단하지 않습니다.
    console.warn('학원 존재 여부 확인 실패:', error);
    return { exists: true, unchecked: true, row: academy, error };
  }
}

async function filterOlliExistingAcademies(list) {
  const normalized = normalizeOlliAccountAcademies(list).filter(item => !isOlliAcademyDeletedLikeInfo(item));
  if (!isSupabaseConfigured()) return normalized;
  const kept = [];
  for (const item of normalized) {
    const check = await fetchOlliAcademyRowByIdentity(item);
    if (check.exists) kept.push(mergeOlliAcademyServerInfo(item, check.row || {}));
  }
  return kept;
}

function purgeOlliAcademyFromLocalState(academyId, academyCode) {
  const targetId = String(academyId || '').trim();
  const targetCode = String(academyCode || '').trim().toUpperCase();
  const core = window.OlliStorageCore;
  let context = null;
  try { context = core?.AcademyContext?.getCurrent ? core.AcademyContext.getCurrent() : null; } catch (_) { context = null; }

  const currentId = String(localStorage.getItem('olli_current_academy_id') || context?.academyId || '').trim();
  const currentCode = String(localStorage.getItem('olli_current_academy_code') || context?.academyCode || '').trim().toUpperCase();
  const isCurrent = (targetId && currentId === targetId) || (targetCode && currentCode === targetCode);

  const filtered = readOlliCachedAccountAcademies().filter(item => {
    const id = String(item.academy_id || item.academyId || '').trim();
    const code = String(item.academy_code || item.academyCode || '').trim().toUpperCase();
    return !((targetId && id === targetId) || (targetCode && code === targetCode));
  });
  applyOlliAccessibleAcademies(filtered);

  if (isCurrent) {
    [
      'olli_owner_logged_in',
      'olli_teacher_logged_in',
      'olli_current_member_role',
      'olli_current_member_name',
      'olli_current_member_id',
      'olli_owner_login_at',
      'olli_teacher_login_at',
      'olli_current_academy_id',
      'olli_current_academy_code',
      'olli_current_academy_name',
      'olli_current_academy_region',
      'olli_current_academy_plan_type',
      'olli_current_academy_access_status',
      'olli_current_academy_trial_started_at',
      'olli_current_academy_trial_expires_at'
    ].forEach(key => localStorage.removeItem(key));

    // AcademyContext.setCurrent()는 academyId가 비어 있으면 예외를 던진다.
    // 삭제 직후에는 현재 학원이 없는 상태가 정상일 수 있으므로 빈 컨텍스트를 setCurrent로 넣지 않는다.
    try { if (core?.AcademyContext?.clearRuntime) core.AcademyContext.clearRuntime('academy_deleted'); } catch (_) {}

    const next = filtered[0];
    if (next && core?.AcademyContext?.setCurrent) {
      try {
        core.AcademyContext.setCurrent({
          academyId: next.academy_id || next.academyId || next.id || '',
          academyCode: next.academy_code || next.academyCode || '',
          academyName: next.academy_name || next.academyName || next.name || '',
          memberId: next.member_id || next.memberId || '',
          memberName: next.member_name || next.memberName || '',
          role: next.role || next.member_role || ''
        });
      } catch (err) {
        console.warn('deleted academy context fallback failed:', err);
      }
    }
  }
}

async function validateOlliCurrentAcademyStillExists(options = {}) {
  const opts = Object.assign({ silent: false }, options || {});
  const academyId = String(localStorage.getItem('olli_current_academy_id') || '').trim();
  const academyCode = String(localStorage.getItem('olli_current_academy_code') || '').trim();
  if (!academyId && !academyCode) return { ok: true, reason: 'NO_CURRENT_ACADEMY' };

  const check = await fetchOlliAcademyRowByIdentity({ academy_id: academyId, academy_code: academyCode });
  if (check.exists) {
    if (check.row && !check.unchecked) {
      const merged = mergeOlliAcademyServerInfo({
        academy_id: academyId,
        academy_code: academyCode,
        academy_name: localStorage.getItem('olli_current_academy_name') || '',
        region: localStorage.getItem('olli_current_academy_region') || '',
        role: localStorage.getItem('olli_current_member_role') || 'owner',
        member_id: localStorage.getItem('olli_current_member_id') || '',
        member_name: localStorage.getItem('olli_current_member_name') || ''
      }, check.row);
      saveOlliAcademyLoginState(merged, { accountLogin: !!localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY) });
    }
    return { ok: true, academy: check.row || null };
  }

  purgeOlliAcademyFromLocalState(academyId, academyCode);

  if (localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY)) {
    try {
      const restored = await restoreOlliAccountSession({ silent: true });
      if (restored?.restored) return { ok: true, restored: true };
    } catch (restoreError) {
      console.warn('삭제된 학원 제거 후 계정 세션 복구 실패:', restoreError);
    }
  }

  if (!opts.silent) {
    alert('삭제되었거나 사용할 수 없는 학원입니다. 로그인 정보를 정리했습니다.');
  }
  if (typeof showOlliLoginEntry === 'function') showOlliLoginEntry();
  return { ok: false, blocked: true, reason: 'ACADEMY_NOT_FOUND' };
}

function applyOlliAccessibleAcademies(list) {
  const academies = normalizeOlliAccountAcademies(list).filter(item => !isOlliAcademyDeletedLikeInfo(item));
  localStorage.setItem(OLLI_ACCOUNT_ACADEMIES_KEY, JSON.stringify(academies));
  const core = window.OlliStorageCore;
  if (core?.AcademyContext?.setAccessible) {
    core.AcademyContext.setAccessible(academies);
  }
  return academies;
}

function chooseOlliCurrentAcademy(academies, preferredAcademyCode) {
  const list = normalizeOlliAccountAcademies(academies);
  if (!list.length) return null;

  const preferredCode = String(preferredAcademyCode || '').trim().toUpperCase();
  const storedAcademyId = String(localStorage.getItem('olli_current_academy_id') || '').trim();

  const available = list.filter(item => !isOlliAcademyAccessBlockedInfo(item));
  const searchList = available.length ? available : list;
  return searchList.find(item => preferredCode && item.academy_code.toUpperCase() === preferredCode)
    || searchList.find(item => storedAcademyId && item.academy_id === storedAcademyId)
    || searchList[0];
}

function recoverOlliCurrentAcademyFromCachedList(reason) {
  const currentId = String(localStorage.getItem('olli_current_academy_id') || '').trim();
  const currentCode = String(localStorage.getItem('olli_current_academy_code') || '').trim();
  const cached = readOlliCachedAccountAcademies();
  if (!cached.length) return null;

  const matched = cached.find(item => currentId && String(item.academy_id || item.academyId || '').trim() === currentId)
    || cached.find(item => currentCode && String(item.academy_code || item.academyCode || '').trim().toUpperCase() === currentCode.toUpperCase())
    || (!currentId && !currentCode ? cached[0] : null);
  if (!matched) return null;

  const restored = saveOlliAcademyLoginState(matched, { accountLogin: !!localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY), restoreReason: reason || 'cached_recovery' });
  if (restored && typeof updateOlliAcademySwitchUI === 'function') updateOlliAcademySwitchUI();
  return restored;
}

function recoverOlliCurrentMemberContextFromCache() {
  const academyId = String(localStorage.getItem('olli_current_academy_id') || '').trim();
  const academyCode = String(localStorage.getItem('olli_current_academy_code') || '').trim().toUpperCase();
  if (!academyId && !academyCode) return null;
  const cached = readOlliCachedAccountAcademies();
  const matched = cached.find(item => academyId && String(item.academy_id || item.academyId || '').trim() === academyId)
    || cached.find(item => academyCode && String(item.academy_code || item.academyCode || '').trim().toUpperCase() === academyCode);
  if (!matched) return null;

  const memberId = String(matched.member_id || matched.memberId || '').trim();
  const role = normalizeOlliRoleValue(matched.role, localStorage.getItem('olli_current_member_role') || 'teacher');
  if (memberId) localStorage.setItem('olli_current_member_id', memberId);
  if (role) localStorage.setItem('olli_current_member_role', role);
  if (matched.member_name || matched.memberName) localStorage.setItem('olli_current_member_name', String(matched.member_name || matched.memberName || '').trim());
  localStorage.setItem('olli_owner_logged_in', (role === 'owner' || role === 'super_admin' || role === 'manager') ? 'true' : 'false');
  localStorage.setItem('olli_teacher_logged_in', role === 'teacher' ? 'true' : 'false');
  return matched;
}

function isOlliHardMemberBlockReason(reason) {
  const text = String(reason || '').trim().toUpperCase();
  return [
    'MEMBER_DISABLED',
    'MEMBER_REMOVED',
    'MEMBERSHIP_REMOVED',
    'MEMBER_REJECTED',
    'APPROVAL_REVOKED',
    'ACCESS_REVOKED',
    'REMOVED',
    'REJECTED',
    'DISABLED',
    'INACTIVE'
  ].includes(text);
}

function saveOlliAcademyLoginState(academy, options) {
  if (!academy) return null;
  const opts = Object.assign({ accountLogin: false }, options || {});
  let normalized = normalizeOlliAccountAcademies([academy])[0] || {
    academy_id: String(academy.id || '').trim(),
    academy_code: String(academy.academy_code || '').trim(),
    academy_name: String(academy.academy_name || '').trim(),
    region: String(academy.region || academy.academy_region || '').trim(),
    plan_type: String(academy.plan_type || '').trim(),
    access_status: String(academy.access_status || 'active').trim(),
    trial_started_at: String(academy.trial_started_at || '').trim(),
    trial_expires_at: String(academy.trial_expires_at || '').trim(),
    member_id: getOlliFirstTextValue(academy, ['member_id', 'memberId', 'membership_id', 'membershipId', 'academy_member_id', 'academyMemberId', 'account_membership_id', 'accountMembershipId', 'owner_member_id', 'ownerMemberId', 'owner_members_id', 'ownerMembersId']),
    member_name: getOlliFirstTextValue(academy, ['member_name', 'memberName', 'display_name', 'displayName', 'teacher_name', 'teacherName', 'owner_name', 'ownerName', 'account_name', 'accountName']),
    role: getOlliFirstTextValue(academy, ['role', 'member_role', 'membership_role', 'role_name', 'account_role']) || 'owner',
    membership_status: 'active'
  };
  const explicitAcademyRole = getOlliFirstTextValue(academy, ['role', 'member_role', 'membership_role', 'role_name', 'account_role', 'permission_role']);
  if (explicitAcademyRole && ['owner', 'manager', 'teacher', 'super_admin'].includes(explicitAcademyRole)) {
    normalized = { ...normalized, role: explicitAcademyRole };
  }
  if (!normalized.academy_id) return null;

  const role = ['owner', 'manager', 'teacher', 'super_admin'].includes(normalized.role)
    ? normalized.role
    : 'owner';
  const memberName = normalized.member_name || (role === 'owner' ? '원장' : (role === 'manager' ? '관리자' : '선생님'));

  localStorage.setItem('olli_current_academy_id', normalized.academy_id);
  localStorage.setItem('olli_current_academy_code', normalized.academy_code);
  localStorage.setItem('olli_current_academy_name', normalized.academy_name);
  localStorage.setItem('olli_current_academy_region', normalized.region);
  localStorage.setItem('olli_current_academy_plan_type', normalized.plan_type || '');
  localStorage.setItem('olli_current_academy_access_status', normalized.access_status || 'active');
  localStorage.setItem('olli_current_academy_trial_started_at', normalized.trial_started_at || '');
  localStorage.setItem('olli_current_academy_trial_expires_at', normalized.trial_expires_at || '');
  localStorage.setItem('olli_current_member_id', normalized.member_id);
  localStorage.setItem('olli_current_member_role', role);
  localStorage.setItem('olli_current_member_name', memberName);
  localStorage.setItem('olli_owner_logged_in', (role === 'owner' || role === 'super_admin' || role === 'manager') ? 'true' : 'false');
  localStorage.setItem('olli_teacher_logged_in', role === 'teacher' ? 'true' : 'false');
  localStorage.setItem('olli_owner_login_at', new Date().toISOString());

  const core = window.OlliStorageCore;
  if (core?.AcademyContext?.setCurrent) {
    core.AcademyContext.setCurrent({
      academyId: normalized.academy_id,
      academyCode: normalized.academy_code,
      academyName: normalized.academy_name,
      planType: normalized.plan_type || '',
      accessStatus: normalized.access_status || 'active',
      trialStartedAt: normalized.trial_started_at || '',
      trialExpiresAt: normalized.trial_expires_at || '',
      memberId: normalized.member_id,
      memberName,
      role
    }, { persistLegacyKeys: false });
  }
  if (typeof refreshOlliRoleBasedVisibilityUI === 'function') refreshOlliRoleBasedVisibilityUI();
  if (typeof applySettingsPermissionUI === 'function') applySettingsPermissionUI();
  if (typeof updateOlliStartPageSettingUI === 'function') updateOlliStartPageSettingUI();
  return normalized;
}

function saveOlliAccountLoginState(result, preferredAcademyCode) {
  const sessionToken = String(result?.session_token || '').trim();
  const accountId = String(result?.account_id || '').trim();
  const accountName = String(result?.account_name || '').trim();
  const deviceId = String(result?.device_id || getOlliLoginDeviceId() || '').trim();
  const academies = applyOlliAccessibleAcademies(result?.academies || []);

  if (!sessionToken || !accountId || !academies.length) {
    throw new Error('다학원 로그인 결과에 필요한 계정 또는 학원 정보가 없습니다.');
  }

  localStorage.setItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY, sessionToken);
  const accountLoginId = String(
    result?.login_id ||
    result?.account_login_id ||
    result?.owner_login_id ||
    result?.username ||
    preferredAcademyCode ||
    localStorage.getItem(OLLI_ACCOUNT_LOGIN_ID_KEY) ||
    ''
  ).trim();
  if (accountLoginId) localStorage.setItem(OLLI_ACCOUNT_LOGIN_ID_KEY, accountLoginId);
  localStorage.setItem(OLLI_ACCOUNT_ID_KEY, accountId);
  localStorage.setItem(OLLI_ACCOUNT_NAME_KEY, accountName);
  localStorage.setItem(OLLI_ACCOUNT_DEVICE_ID_KEY, deviceId);

  const selected = chooseOlliCurrentAcademy(academies, preferredAcademyCode);
  if (!selected) throw new Error('사용 가능한 학원을 선택하지 못했습니다.');
  return saveOlliAcademyLoginState(selected, { accountLogin: true });
}

async function loginOlliAccount(loginId, password) {
  return callOlliTestRpc('olli_account_login', {
    p_login_id: loginId,
    p_password: password,
    p_device_id: getOlliLoginDeviceId(),
    p_device_name: getOlliDeviceName()
  });
}


function saveOlliAccountOnlyLoginState(result, preferredLoginId) {
  const sessionToken = String(result?.session_token || '').trim();
  const accountId = String(result?.account_id || result?.id || '').trim();
  const accountName = String(result?.account_name || result?.display_name || result?.name || '').trim();
  const deviceId = String(result?.device_id || getOlliLoginDeviceId() || '').trim();
  if (!sessionToken || !accountId) {
    throw new Error('계정 로그인 결과에 필요한 세션 또는 계정 정보를 확인하지 못했습니다.');
  }
  localStorage.setItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY, sessionToken);
  const accountLoginId = String(
    result?.login_id || result?.account_login_id || result?.username || preferredLoginId || localStorage.getItem(OLLI_ACCOUNT_LOGIN_ID_KEY) || ''
  ).trim();
  if (accountLoginId) localStorage.setItem(OLLI_ACCOUNT_LOGIN_ID_KEY, accountLoginId);
  localStorage.setItem(OLLI_ACCOUNT_ID_KEY, accountId);
  localStorage.setItem(OLLI_ACCOUNT_NAME_KEY, accountName || accountLoginId || '계정');
  localStorage.setItem(OLLI_ACCOUNT_DEVICE_ID_KEY, deviceId);
  applyOlliAccessibleAcademies(result?.academies || []);
  return { sessionToken, accountId, accountName, accountLoginId };
}

function getOlliAccountAcademyListFromResult(result) {
  return normalizeOlliAccountAcademies(result?.academies || []);
}

async function handleOlliAccountLoginResult(result, loginId) {
  const academies = await filterOlliExistingAcademies(result?.academies || []);
  result = { ...result, academies };
  if (academies.length) {
    return saveOlliAccountLoginState(result, '');
  }
  saveOlliAccountOnlyLoginState(result, loginId);
  return null;
}

async function createOlliAccount(loginId, password, accountName) {
  const payload = {
    p_login_id: loginId,
    p_password: password,
    p_account_name: accountName || loginId,
    p_device_id: getOlliLoginDeviceId(),
    p_device_name: getOlliDeviceName()
  };
  const rpcNames = ['olli_create_account', 'olli_account_create', 'olli_register_account'];
  let lastError = null;
  for (const name of rpcNames) {
    try {
      return await callOlliTestRpc(name, payload);
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error || '');
      const missingRpc = /could not find|not found|schema cache|undefined|404|PGRST202/i.test(message);
      if (!missingRpc) throw error;
    }
  }
  throw new Error('계정 생성 RPC가 Supabase에 없습니다. olli_create_account 또는 olli_account_create SQL이 필요합니다.\n' + (lastError?.message || lastError || ''));
}

async function submitOlliAccountCreate() {
  const loginId = String(document.getElementById('olliAccountCreateLoginIdInput')?.value || '').trim();
  const accountName = String(document.getElementById('olliAccountCreateNameInput')?.value || '').trim();
  const password = String(document.getElementById('olliAccountCreatePasswordInput')?.value || '').trim();
  const passwordConfirm = String(document.getElementById('olliAccountCreatePasswordConfirmInput')?.value || '').trim();
  const btn = document.getElementById('olliAccountCreateBtn');
  const resultBox = document.getElementById('olliAccountCreateResult');

  if (!loginId) { alert('개인계정 아이디를 입력해 주세요.'); return; }
  if (!accountName) { alert('이름을 입력해 주세요.'); return; }
  if (!password || password.length < 4) { alert('비밀번호를 4자 이상 입력해 주세요.'); return; }
  if (password !== passwordConfirm) { alert('비밀번호 확인이 일치하지 않습니다.'); return; }

  try {
    if (btn) { btn.disabled = true; btn.textContent = '계정 생성 중...'; }
    if (resultBox) {
      resultBox.style.display = 'block';
      resultBox.innerHTML = '<div class="olliInfoHead">계정을 생성하는 중입니다...</div>';
    }
    const created = await createOlliAccount(loginId, password, accountName);
    const loginResult = created && created.session_token ? created : await loginOlliAccount(loginId, password);
    const academy = await handleOlliAccountLoginResult(loginResult, loginId);
    if (resultBox) {
      resultBox.style.display = 'block';
      resultBox.innerHTML = '<div class="olliInfoHead">계정 생성 완료</div>'
        + '<div class="olliInfoItem">개인계정: <strong>' + settingsEscapeHtml(loginId) + '</strong></div>'
        + '<div class="olliSuccessBox">이제 학원을 만들거나 연결 요청할 수 있습니다.</div>';
    }
    if (academy) {
      await enterOlliAfterLoginOrSetup();
    } else {
      setTimeout(showOlliAcademyConnectChoice, 350);
    }
  } catch (error) {
    if (resultBox) {
      resultBox.style.display = 'block';
      resultBox.innerHTML = '<div class="olliErrorBox">' + settingsEscapeHtml(error?.message || error) + '</div>';
    } else {
      alert('계정 생성 실패\n' + (error?.message || error));
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '계정 만들기'; }
  }
}

async function createOlliAcademyForCurrentAccount(name, region) {
  const sessionToken = String(localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY) || '').trim();
  if (!sessionToken) throw new Error('개인계정 세션이 없습니다. 계정으로 다시 로그인해 주세요.');

  const sourceAcademyId = String(localStorage.getItem('olli_current_academy_id') || '').trim();
  const payload = {
    p_session_token: sessionToken,
    p_academy_name: name,
    p_region: region || null
  };

  let result = null;
  if (sourceAcademyId) {
    result = await callOlliRpc('olli_create_academy_for_account', {
      ...payload,
      p_source_academy_id: sourceAcademyId
    });
  } else {
    result = await callOlliRpc('olli_create_first_academy_for_account', payload);
  }

  if (!result || result.ok !== true || !result.academy?.academy_id) {
    const message = (result && (result.message || result.details)) || '계정 기반 학원 생성 결과를 확인하지 못했습니다.';
    throw new Error(message);
  }

  let academy = result.academy;
  let ownerMemberId = getOlliOwnerMemberIdFromAcademy(academy);
  if (!ownerMemberId) {
    academy = await ensureOlliOwnerMemberAfterLegacyAcademyCreate(academy);
    ownerMemberId = getOlliOwnerMemberIdFromAcademy(academy);
  }
  if (!ownerMemberId) {
    throw new Error('학원은 생성됐지만 owner member id를 확인하지 못해 성공 처리하지 않았습니다.');
  }
  academy = {
    ...academy,
    member_id: ownerMemberId,
    owner_member_id: ownerMemberId,
    owner_members_id: ownerMemberId,
    role: 'owner',
    member_name: academy.member_name || localStorage.getItem(OLLI_ACCOUNT_NAME_KEY) || '원장',
    membership_status: 'active'
  };
  await restoreOlliAccountSession({ silent: true });
  const academies = readOlliCachedAccountAcademies();
  const exists = academies.some(item => String(item.academy_id) === String(academy.academy_id));
  if (!exists) applyOlliAccessibleAcademies([ ...academies, academy ]);
  saveOlliAcademyLoginState(academy, { accountLogin: true });
  return academy;
}

async function establishOlliTeacherAccountSession(context) {
  const sessionToken = String(localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY) || '').trim();
  if (!sessionToken) {
    throw new Error('개인계정 세션이 없습니다. 계정으로 다시 로그인해 주세요.');
  }
  const restored = await restoreOlliAccountSession({ silent: true });
  if (restored && restored.restored) return restored.selected || restored;
  throw new Error('개인계정에 연결된 학원을 확인하지 못했습니다. 승인 요청 상태를 다시 확인해 주세요.');
}

async function refreshOlliTeacherAcademyAccessAfterValidation(result) {
  return restoreOlliAccountSession({ silent: true });
}

async function restoreOlliAccountSession(options) {
  const opts = Object.assign({ silent: false }, options || {});
  const sessionToken = String(localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY) || '').trim();
  if (!sessionToken || !isSupabaseConfigured()) {
    const academies = applyOlliAccessibleAcademies(readOlliCachedAccountAcademies());
    const recovered = recoverOlliCurrentAcademyFromCachedList('no_account_session');
    return { restored: !!recovered, reason: 'NO_ACCOUNT_SESSION', academies, selected: recovered };
  }

  try {
    const result = await callOlliTestRpc('olli_get_my_academies', {
      p_session_token: sessionToken
    });
    const existingAcademies = await filterOlliExistingAcademies(result?.academies || []);
    const academies = applyOlliAccessibleAcademies(existingAcademies);
    if (!academies.length) throw new Error('현재 계정에서 사용할 수 있는 학원이 없습니다.');

    localStorage.setItem(OLLI_ACCOUNT_ID_KEY, String(result?.account_id || '').trim());
    localStorage.setItem(OLLI_ACCOUNT_NAME_KEY, String(result?.account_name || '').trim());
    const selected = chooseOlliCurrentAcademy(academies, '');
    saveOlliAcademyLoginState(selected, { accountLogin: true });
    if (typeof updateOlliAcademySwitchUI === 'function') updateOlliAcademySwitchUI();
    return { restored: true, academies, selected };
  } catch (error) {
    if (!opts.silent) throw error;
    console.warn('다학원 계정 세션 복구 실패:', error);
    const academies = applyOlliAccessibleAcademies(readOlliCachedAccountAcademies());
    const recovered = recoverOlliCurrentAcademyFromCachedList('session_restore_failed');
    return { restored: !!recovered, reason: 'SESSION_RESTORE_FAILED', error, academies, selected: recovered };
  }
}

async function revokeOlliAccountSessionBestEffort() {
  const sessionToken = String(localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY) || '').trim();
  if (!sessionToken || !isSupabaseConfigured()) return false;
  try {
    const rpcCaller = (typeof callOlliRpc === 'function') ? callOlliRpc : callOlliTestRpc;
    await rpcCaller('olli_account_logout', { p_session_token: sessionToken });
    return true;
  } catch (error) {
    console.warn('계정 세션 해제 실패:', error);
    return false;
  }
}

