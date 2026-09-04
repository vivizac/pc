/* 2026-06 계정 기반 로그인 3차: 이미지 제거 + 학원 찾기/승인/자동입장 정리 */
/* v40-fix-14: 테스트용 학원 ID / 비밀번호 원장 로그인 */
function getOlliAuthAccessToken() {
  // 계정 기반 로그인에서는 Supabase RPC가 세션 토큰을 직접 검증합니다.
  return '';
}

function hideOlliLoginScreens() {
  if (typeof stopOlliApprovalAutoCheck === 'function') stopOlliApprovalAutoCheck();
  [
    'olliLoginEntryScreen',
    'olliOwnerLoginScreen',
    'olliAccountCreateScreen',
    'olliAcademyConnectChoiceScreen',
    'olliAcademyCreateScreen',
    'olliOwnerExistingConnectScreen',
    'olliTeacherRequestScreen',
    'olliApprovalWaitingScreen',
    'olliStartPageSetupScreen'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove('olliLoginShow');
      el.style.display = 'none';
      el.style.opacity = '';
      el.style.transform = '';
      el.style.pointerEvents = '';
    }
  });
  document.body.classList.remove('olli-login-open');
}


/* PC 시작 페이지 설정은 pc-start-page.js가 담당합니다. */

function showOlliLoginScreenById(id) {
  if (id !== 'olliApprovalWaitingScreen' && typeof stopOlliApprovalAutoCheck === 'function') stopOlliApprovalAutoCheck();
  [
    'olliLoginEntryScreen',
    'olliOwnerLoginScreen',
    'olliAccountCreateScreen',
    'olliAcademyConnectChoiceScreen',
    'olliAcademyCreateScreen',
    'olliOwnerExistingConnectScreen',
    'olliTeacherRequestScreen',
    'olliApprovalWaitingScreen',
    'olliStartPageSetupScreen'
  ].forEach(screenId => {
    const el = document.getElementById(screenId);
    if (!el) return;
    if (screenId === id) {
      el.style.display = 'block';
      el.style.opacity = '1';
      el.style.transform = 'translateX(0)';
      el.style.pointerEvents = 'auto';
      el.classList.add('olliLoginShow');
    } else {
      el.classList.remove('olliLoginShow');
      el.style.display = 'none';
    }
  });
  document.body.classList.add('olli-login-open');
}

function showOlliLoginEntry() {
  if (typeof hideOlliAcademyAccessBlocked === 'function') hideOlliAcademyAccessBlocked();
  const sheet = document.getElementById('settingsSheetOverlay');
  if (sheet) sheet.classList.remove('show');

  const detail = document.getElementById('settingsDetailScreen');
  if (detail) detail.style.display = 'none';

  showOlliLoginScreenById('olliLoginEntryScreen');
}

function showOlliOwnerLogin() {
  showOlliLoginScreenById('olliOwnerLoginScreen');

  const loginId = document.getElementById('olliOwnerAcademyCodeInput');
  if (loginId && !loginId.value) loginId.value = localStorage.getItem(OLLI_ACCOUNT_LOGIN_ID_KEY) || '';
}

function showOlliAccountCreate() {
  showOlliLoginScreenById('olliAccountCreateScreen');
  const loginId = document.getElementById('olliAccountCreateLoginIdInput');
  if (loginId && !loginId.value) loginId.focus();
}

function showOlliAcademyConnectChoice() {
  if (!localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY)) {
    alert('학원 연결은 개인계정 로그인 후 사용할 수 있습니다. 먼저 계정으로 로그인해 주세요.');
    showOlliOwnerLogin();
    return;
  }
  showOlliLoginScreenById('olliAcademyConnectChoiceScreen');
}

function showOlliAcademyCreate() {
  if (!localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY)) {
    alert('학원 생성은 개인계정 로그인 후 사용할 수 있습니다. 먼저 계정으로 로그인해 주세요.');
    showOlliOwnerLogin();
    return;
  }
  showOlliLoginScreenById('olliAcademyCreateScreen');
}

function showOlliOwnerExistingConnect() {
  if (!localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY)) {
    alert('기존 학원 연결은 개인계정 로그인 후 사용할 수 있습니다. 먼저 계정으로 로그인해 주세요.');
    showOlliOwnerLogin();
    return;
  }
  showOlliLoginScreenById('olliOwnerExistingConnectScreen');

  const code = document.getElementById('olliOwnerExistingAcademyCodeInput');
  if (code) {
    code.value = localStorage.getItem('olli_pending_academy_code') || '';
    setTimeout(() => code.focus(), 0);
  }
  clearOlliOwnerExistingAcademyLookupResult();
}

function showOlliTeacherRequest() {
  if (!localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY)) {
    alert('학원 찾기는 개인계정 로그인 후 사용할 수 있습니다. 먼저 계정으로 로그인해 주세요.');
    showOlliOwnerLogin();
    return;
  }
  showOlliLoginScreenById('olliTeacherRequestScreen');

  const code = document.getElementById('olliTeacherAcademyCodeInput');
  if (code) {
    code.value = localStorage.getItem('olli_pending_academy_code') || '';
    setTimeout(() => code.focus(), 0);
  }
  clearOlliAcademyLookupResult();
}

function syncOlliTeacherEntryInputs() {
  const entryCode = document.getElementById('olliEntryTeacherAcademyCodeInput')?.value.trim() || '';
  const entryName = document.getElementById('olliEntryTeacherNameInput')?.value.trim() || '';

  const teacherCode = document.getElementById('olliTeacherAcademyCodeInput');
  const teacherName = document.getElementById('olliTeacherNameInput');

  if (teacherCode) teacherCode.value = entryCode;
  if (teacherName) teacherName.value = entryName;

  return { academyCode: entryCode, teacherName: entryName };
}

function submitOlliTeacherApprovalRequestFromEntry() {
  const values = syncOlliTeacherEntryInputs();
  if (!values.academyCode) {
    alert('학원 ID를 입력해 주세요.');
    return;
  }
  if (!localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY)) {
    alert('개인계정 로그인 후 승인 요청을 보낼 수 있습니다. 먼저 계정으로 로그인해 주세요.');
    showOlliOwnerLogin();
    return;
  }
  return submitOlliTeacherApprovalRequest();
}

function checkOlliTeacherApprovalStatusFromEntry() {
  const values = syncOlliTeacherEntryInputs();
  if (!values.academyCode) {
    alert('학원 ID를 입력해 주세요.');
    return;
  }
  return checkOlliTeacherApprovalStatus();
}

function showOlliApprovalWaiting(message) {
  const desc = document.getElementById('olliApprovalWaitingDesc');
  if (desc) desc.textContent = message || '원장님의 승인을 기다리고 있어요. 승인되면 자동으로 들어갑니다.';

  showOlliLoginScreenById('olliApprovalWaitingScreen');
  if (typeof startOlliApprovalAutoCheck === 'function') startOlliApprovalAutoCheck();
}

async function callOlliTestRpc(functionName, payload) {
  if (String(functionName || '') === 'olli_account_login' && payload && typeof payload === 'object') {
    const rpcPayload = { ...payload };
    if (Object.prototype.hasOwnProperty.call(rpcPayload, 'p_account_name')) {
      rpcPayload.p_device_name = rpcPayload.p_device_name || rpcPayload.p_account_name || getOlliDeviceName();
      delete rpcPayload.p_account_name;
    }
    payload = rpcPayload;
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    },
    body: JSON.stringify(payload || {})
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const message = data && typeof data === 'object'
      ? [data.message, data.details, data.hint, data.code].filter(Boolean).join('\n')
      : String(data || '요청 실패');
    throw new Error(message);
  }

  return data;
}

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

async function submitOlliOwnerIdLogin() {
  const loginInput = document.getElementById('olliOwnerAcademyCodeInput');
  const passwordInput = document.getElementById('olliOwnerPasswordInput');
  const btn = document.getElementById('olliOwnerLoginBtn');

  const loginId = loginInput?.value.trim();
  const password = passwordInput?.value.trim();

  if (!loginId) {
    alert('개인계정 아이디를 입력해 주세요.');
    return;
  }
  if (!password) {
    alert('개인계정 비밀번호를 입력해 주세요.');
    return;
  }

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = '로그인 중...';
    }

    const accountResult = await loginOlliAccount(loginId, password);
    const academy = await handleOlliAccountLoginResult(accountResult, loginId);

    if (!academy) {
      alert('계정 로그인 완료\n아직 연결된 학원이 없습니다. 원장님은 학원을 만들고, 선생님은 학원 찾기로 승인 요청을 보내 주세요.');
      showOlliAcademyConnectChoice();
      return;
    }

    if (typeof settingsRefreshAll === 'function') await settingsRefreshAll();
    await enterOlliAfterLoginOrSetup();

    const academyCount = getOlliMultiAcademyState().academies.length;
    alert('계정 로그인 완료: ' + (academy.academy_name || '학원') + (academyCount > 1 ? `\n연결된 학원 ${academyCount}개` : ''));
  } catch (err) {
    alert('계정 로그인 실패\n' + (err.message || err));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '계정 로그인';
    }
  }
}

async function createOlliAcademyWithOwnerMember(name, region, password) {
  const payload = {
    p_academy_name: name,
    p_region: region || null,
    p_owner_password: password
  };

  let academy = null;

  try {
    const created = await callOlliTestRpc('olli_create_academy_with_password_and_owner', payload);
    academy = Array.isArray(created) ? created[0] : created;
  } catch (primaryError) {
    const message = String(primaryError?.message || primaryError || '');
    const missingRpc = /could not find|not found|schema cache|undefined|404|PGRST202/i.test(message);
    if (missingRpc) {
      throw new Error(
        'owner member id까지 생성하는 RPC가 Supabase에 없습니다.\n' +
        'olli_create_academy_with_password_and_owner SQL을 먼저 실행해야 합니다.\n' +
        '이제는 test_create_academy_with_password로 학원만 생성하는 fallback을 사용하지 않습니다.\n\n' +
        message
      );
    }
    throw primaryError;
  }

  if (!academy || !(academy.id || academy.academy_id)) {
    throw new Error('학원 생성 결과를 확인하지 못했습니다.');
  }

  let ownerMemberId = getOlliOwnerMemberIdFromAcademy(academy);
  if (!ownerMemberId) {
    try {
      academy = await ensureOlliOwnerMemberAfterLegacyAcademyCreate(academy);
      ownerMemberId = getOlliOwnerMemberIdFromAcademy(academy);
    } catch (fallbackError) {
      const academyName = String(academy?.academy_name || name || '').trim();
      throw new Error(
        '학원 row는 생성됐지만 owner member id 생성/연결에 실패했습니다.\n' +
        (academyName ? '학원명: ' + academyName + '\n' : '') +
        '원인: olli_ensure_owner_member_for_academy RPC 실행 실패 또는 멤버 테이블/컬럼 불일치\n' +
        '이 상태를 학원 생성 성공으로 처리하지 않도록 차단했습니다.\n\n' +
        (fallbackError?.message || fallbackError)
      );
    }
  }

  ownerMemberId = getOlliOwnerMemberIdFromAcademy(academy);
  if (!ownerMemberId) {
    throw new Error(
      '학원은 생성됐지만 owner member id를 확인하지 못했습니다.\n' +
      'RPC 응답에 owner_member_id 또는 owner_members_id가 포함되어야 합니다.\n' +
      '이 상태를 학원 생성 성공으로 처리하지 않도록 차단했습니다.'
    );
  }

  academy.member_id = ownerMemberId;
  academy.owner_member_id = academy.owner_member_id || ownerMemberId;
  academy.owner_members_id = academy.owner_members_id || ownerMemberId;
  academy.role = 'owner';
  academy.member_name = academy.member_name || '원장';
  academy.membership_status = 'active';

  return academy;
}

async function ensureOlliOwnerMemberAfterLegacyAcademyCreate(academy) {
  const academyId = String(academy?.id || academy?.academy_id || '').trim();
  const academyCode = String(academy?.academy_code || academy?.academyCode || '').trim();
  const sessionToken = String(localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY) || '').trim();
  const ownerName = String(localStorage.getItem(OLLI_ACCOUNT_NAME_KEY) || academy?.member_name || '원장').trim() || '원장';
  if (!academyId && !academyCode) {
    throw new Error('owner member id 보정에 필요한 학원 ID 또는 학원 코드를 확인하지 못했습니다.');
  }

  const rpcAttempts = [];
  if (sessionToken) {
    rpcAttempts.push(
      {
        name: 'olli_ensure_account_owner_member_for_academy',
        payload: { p_session_token: sessionToken, p_academy_id: academyId || null, p_academy_code: academyCode || null }
      },
      {
        name: 'olli_ensure_owner_member_for_account_academy',
        payload: { p_session_token: sessionToken, p_academy_id: academyId || null, p_academy_code: academyCode || null }
      }
    );
  }
  rpcAttempts.push({
    name: 'olli_ensure_owner_member_for_academy',
    payload: {
      p_academy_id: academyId || null,
      p_academy_code: academyCode || null,
      p_owner_name: ownerName
    }
  });

  let lastError = null;
  for (const attempt of rpcAttempts) {
    try {
      const result = await callOlliTestRpc(attempt.name, attempt.payload);
      const fixed = Array.isArray(result) ? result[0] : result;
      const ownerMemberId = getOlliFirstTextValue(fixed || {}, ['owner_member_id', 'ownerMemberId', 'owner_members_id', 'ownerMembersId', 'member_id', 'memberId'])
        || getOlliOwnerMemberIdFromAcademy(academy);
      if (!ownerMemberId) {
        lastError = new Error(attempt.name + ' 응답에서 owner member id를 확인하지 못했습니다.');
        continue;
      }
      return {
        ...academy,
        ...(fixed && typeof fixed === 'object' ? fixed : {}),
        member_id: ownerMemberId,
        owner_member_id: ownerMemberId,
        owner_members_id: ownerMemberId,
        role: 'owner',
        member_name: academy.member_name || ownerName,
        membership_status: 'active'
      };
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error || '');
      const missingRpc = /could not find|not found|schema cache|undefined|404|PGRST202/i.test(message);
      if (!missingRpc) throw error;
    }
  }

  throw new Error(
    'owner member id 생성/보정 RPC가 준비되지 않았거나 응답에서 owner member id를 확인하지 못했습니다.\n' +
    '계정 기반 학원 생성은 owner_member_id 또는 owner_members_id가 있어야 완료됩니다.\n\n' +
    (lastError?.message || lastError || '')
  );
}

async function enterOlliAfterAcademyCreate(academy) {
  const ownerMemberId = getOlliOwnerMemberIdFromAcademy(academy);
  if (!ownerMemberId) {
    throw new Error('owner member id가 없어 생성된 학원으로 입장할 수 없습니다.');
  }
  const normalizedAcademy = {
    ...academy,
    id: academy.id || academy.academy_id,
    academy_id: academy.academy_id || academy.id,
    academy_code: academy.academy_code || academy.academyCode || '',
    academy_name: academy.academy_name || academy.academyName || '',
    member_id: ownerMemberId,
    owner_member_id: ownerMemberId,
    owner_members_id: ownerMemberId,
    role: 'owner',
    member_name: academy.member_name || '원장',
    membership_status: 'active'
  };

  const savedAcademy = saveOlliAcademyLoginState(normalizedAcademy, { accountLogin: false });
  if (!savedAcademy || !savedAcademy.academy_id) {
    throw new Error('생성된 학원 로그인 상태를 저장하지 못했습니다.');
  }
  applyOlliAccessibleAcademies([savedAcademy]);

  try {
    if (typeof settingsRefreshAll === 'function') await settingsRefreshAll();
  } catch (settingsError) {
    console.warn('학원 생성 후 설정 새로고침은 건너뜁니다.', settingsError);
  }

  try {
    await enterOlliAfterLoginOrSetup();
  } catch (enterError) {
    console.warn('학원 생성 후 자동 입장 실패. 시작 페이지 선택으로 이동합니다.', enterError);
    if (typeof showOlliStartPageSetup === 'function') {
      showOlliStartPageSetup();
      return;
    }
    throw enterError;
  }

  const createScreen = document.getElementById('olliAcademyCreateScreen');
  const stillOnCreate = createScreen && createScreen.style.display !== 'none';
  if (stillOnCreate && typeof showOlliStartPageSetup === 'function') {
    showOlliStartPageSetup();
  }
}

async function createOlliAcademyPreview() {
  const name = document.getElementById('olliAcademyNameInput')?.value.trim();
  const region = document.getElementById('olliAcademyRegionInput')?.value.trim();
  const result = document.getElementById('olliAcademyCreateResult');
  const btn = document.querySelector('#olliAcademyCreateScreen .olliPrimaryBtn');

  if (!name) {
    alert('학원명을 입력해 주세요.');
    return;
  }

  if (!localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY)) {
    alert('학원 생성은 개인계정 로그인 후 사용할 수 있습니다. 먼저 계정으로 로그인해 주세요.');
    showOlliOwnerLogin();
    return;
  }

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = '학원 생성 중...';
    }
    if (result) {
      result.style.display = 'block';
      result.innerHTML = '<div class="olliInfoHead">계정에 학원을 연결하는 중입니다...</div>';
    }

    const academy = await createOlliAcademyForCurrentAccount(name, region);
    const ownerMemberId = getOlliOwnerMemberIdFromAcademy(academy);
    const academyName = String(academy.academy_name || name).trim();
    const academyCode = String(academy.academy_code || '').trim();

    if (result) {
      result.style.display = 'block';
      result.innerHTML =
        '<div class="olliInfoHead">학원 생성 완료</div>' +
        '<div class="olliInfoItem">학원명: ' + settingsEscapeHtml(academyName) + '</div>' +
        (academyCode ? '<div class="olliInfoItem">학원 ID: <strong>' + settingsEscapeHtml(academyCode) + '</strong></div>' : '') +
        '<div class="olliInfoItem">원장 멤버 ID: <strong>' + settingsEscapeHtml(ownerMemberId) + '</strong></div>' +
        '<div class="olliSuccessBox">현재 개인계정에 원장 권한으로 연결했습니다.</div>';
    }

    if (typeof settingsRefreshAll === 'function') await settingsRefreshAll();
    await enterOlliAfterLoginOrSetup();
  } catch (err) {
    if (result) {
      result.style.display = 'block';
      result.innerHTML = '<div class="olliErrorBox">' + settingsEscapeHtml(err.message || err) + '</div>';
    } else {
      alert('학원 생성 실패\n' + (err.message || err));
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '학원 생성하기';
    }
  }
}

function normalizeOlliTeacherNameForMatch(value) {
  return String(value || '')
    .trim()
    .replace(/선생님|교사|teacher/gi, '')
    .replace(/\s*T$/i, '')
    .replace(/[\s·ㆍ._\-()\[\]{}]/g, '')
    .toLowerCase();
}

function isOlliApprovedTeacherMemberRow(row) {
  if (!row || typeof row !== 'object') return false;
  const role = normalizeOlliMemberRoleValue(row.role || row.member_role || row.membership_role || row.role_name || row.account_role || 'teacher') || 'teacher';
  if (!['teacher', 'manager'].includes(role)) return false;
  if (row.is_deleted === true || String(row.is_deleted || '').toLowerCase() === 'true') return false;
  const status = String(row.status || row.member_status || row.membership_status || row.approval_status || '').trim().toLowerCase();
  if (['disabled', 'inactive', 'deleted', 'removed', 'rejected', 'suspended', 'blocked'].includes(status)) return false;
  if (status && !['active', 'approved', 'enabled'].includes(status)) return false;
  return true;
}

function normalizeOlliApprovedTeacherResult(row, academy = null, fallbackCode = '', fallbackName = '') {
  const memberId = String(row?.member_id || row?.id || '').trim();
  const memberName = String(row?.member_name || row?.display_name || row?.teacher_name || row?.name || fallbackName || '').trim();
  const role = normalizeOlliMemberRoleValue(row?.role || row?.member_role || row?.membership_role || row?.role_name || row?.account_role || 'teacher') || 'teacher';
  const academyId = String(row?.academy_id || academy?.id || academy?.academy_id || '').trim();
  const academyCode = String(row?.academy_code || academy?.academy_code || fallbackCode || '').trim();
  const academyName = String(row?.academy_name || academy?.academy_name || academy?.name || '').trim();
  return {
    academy_id: academyId,
    academy_code: academyCode,
    academy_name: academyName,
    member_id: memberId,
    member_name: memberName,
    role
  };
}

async function findOlliApprovedTeacherMembership(academyCode, teacherName) {
  const code = String(academyCode || '').trim();
  const name = String(teacherName || '').trim();
  const normalizedName = normalizeOlliTeacherNameForMatch(name);
  if (!code || !name || !normalizedName) return null;


  let academy = null;
  try {
    const academyRows = await supabase('GET', `academies?select=*&academy_code=eq.${encodeURIComponent(code)}&limit=1`);
    academy = Array.isArray(academyRows) ? academyRows[0] : academyRows;
  } catch (err) {
    console.warn('학원 ID 직접 조회 실패:', err && (err.message || err));
  }

  const memberRows = [];
  const seen = new Set();
  async function addMemberRows(path) {
    try {
      const rows = await supabase('GET', path);
      (Array.isArray(rows) ? rows : []).forEach(row => {
        const key = String(row?.id || row?.member_id || JSON.stringify(row));
        if (seen.has(key)) return;
        seen.add(key);
        memberRows.push(row);
      });
    } catch (err) {
      console.warn('선생님 멤버십 조회 실패:', err && (err.message || err));
    }
  }

  const academyId = String(academy?.id || academy?.academy_id || '').trim();
  if (academyId) await addMemberRows(`academy_members?select=*&academy_id=eq.${encodeURIComponent(academyId)}&limit=500`);
  await addMemberRows(`academy_members?select=*&academy_code=eq.${encodeURIComponent(code)}&limit=500`);

  const matched = memberRows.filter(row => {
    if (!isOlliApprovedTeacherMemberRow(row)) return false;
    const rowName = normalizeOlliTeacherNameForMatch(row.member_name || row.display_name || row.teacher_name || row.name || '');
    return rowName && rowName === normalizedName;
  });

  if (!matched.length) return null;
  if (matched.length > 1) {
    const exact = matched.filter(row => String(row.member_name || row.display_name || row.teacher_name || row.name || '').trim() === name);
    if (exact.length === 1) return normalizeOlliApprovedTeacherResult(exact[0], academy, code, name);
    throw new Error('같은 이름의 승인된 선생님이 여러 명 있습니다. 원장에게 선생님 이름을 구분해 달라고 요청해 주세요.');
  }
  return normalizeOlliApprovedTeacherResult(matched[0], academy, code, name);
}

async function enterOlliApprovedTeacher(academyCode, teacherName, buttonId = '') {
  const code = String(academyCode || '').trim();
  const name = String(teacherName || '').trim();
  if (!code) {
    alert('학원 ID를 입력해 주세요.');
    return false;
  }
  if (!name) {
    alert('선생님 이름을 입력해 주세요.');
    return false;
  }
  if (!isSupabaseConfigured()) {
    alert('Supabase 설정이 필요합니다.');
    return false;
  }
  if (!localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY)) {
    alert('선생님 입장은 개인계정 로그인 후 사용할 수 있습니다. 먼저 계정으로 로그인해 주세요.');
    showOlliOwnerLogin();
    return false;
  }

  const btn = buttonId ? document.getElementById(buttonId) : null;
  try {
    if (btn) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent || '입장하기';
      btn.textContent = '승인 확인 중...';
    }

    rememberOlliTeacherApprovalContext(code, name);
    const approved = await findOlliApprovedTeacherMembership(code, name);
    if (!approved || !approved.member_id) {
      alert('승인된 선생님 정보를 찾지 못했습니다.\n처음 입장하는 선생님이라면 원장에게 승인 요청을 보내 주세요.');
      return false;
    }

    localStorage.setItem('olli_current_academy_id', approved.academy_id || '');
    localStorage.setItem('olli_current_academy_code', approved.academy_code || code);
    localStorage.setItem('olli_current_academy_name', approved.academy_name || '');
    localStorage.setItem('olli_current_member_id', approved.member_id || '');
    localStorage.setItem('olli_current_member_name', approved.member_name || name);
    localStorage.setItem('olli_current_member_role', approved.role || 'teacher');
    localStorage.setItem('olli_teacher_logged_in', ['teacher', 'manager'].includes(approved.role) ? 'true' : 'false');
    localStorage.setItem('olli_owner_logged_in', ['owner', 'super_admin'].includes(approved.role) ? 'true' : 'false');
    localStorage.setItem('olli_teacher_login_at', new Date().toISOString());

    await establishOlliTeacherAccountSession(approved);

    localStorage.removeItem('olli_pending_academy_code');
    localStorage.removeItem('olli_pending_teacher_name');
    clearOlliTeacherInviteParamsFromUrl();

    if (typeof settingsRefreshAll === 'function') await settingsRefreshAll();
    await enterOlliAfterLoginOrSetup();
    return true;
  } catch (err) {
    console.error('선생님 입장 확인 실패:', err);
    alert('선생님 입장 확인 중 오류가 발생했습니다.\n\n' + (err.message || err));
    return false;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || '입장하기';
      delete btn.dataset.originalText;
    }
  }
}

function submitOlliTeacherEnter() {
  const academyCode = document.getElementById('olliTeacherAcademyCodeInput')?.value.trim() || '';
  const teacherName = document.getElementById('olliTeacherNameInput')?.value.trim() || '';
  return enterOlliApprovedTeacher(academyCode, teacherName, 'olliTeacherEnterBtn');
}

function submitOlliTeacherEnterFromEntry() {
  const values = syncOlliTeacherEntryInputs();
  return enterOlliApprovedTeacher(values.academyCode, values.teacherName, 'olliEntryTeacherEnterBtn');
}

function clearOlliOwnerExistingAcademyLookupResult() {
  const box = document.getElementById('olliOwnerExistingAcademyLookupResult');
  if (box) {
    box.style.display = 'none';
    box.innerHTML = '';
    box.removeAttribute('data-academy-code');
    box.removeAttribute('data-academy-name');
    box.removeAttribute('data-academy-id');
  }
}

function renderOlliOwnerExistingAcademyLookupResult(academy, options) {
  const box = document.getElementById('olliOwnerExistingAcademyLookupResult');
  if (!box) return;
  const opts = options || {};
  box.style.display = 'block';
  if (academy) {
    box.setAttribute('data-academy-code', academy.academy_code || '');
    box.setAttribute('data-academy-name', academy.academy_name || '');
    box.setAttribute('data-academy-id', academy.academy_id || '');
    box.innerHTML = '<div class="olliInfoHead">기존 학원 선택 완료</div>'
      + '<div class="olliInfoItem">학원명: <strong>' + settingsEscapeHtml(academy.academy_name || '이름 없음') + '</strong></div>'
      + '<div class="olliInfoItem">학원 아이디: <strong>' + settingsEscapeHtml(academy.academy_code || '') + '</strong></div>'
      + '<div class="olliSuccessBox">이 학원에 원장 연결 요청을 보낼 수 있습니다.</div>';
    return;
  }
  box.removeAttribute('data-academy-code');
  box.removeAttribute('data-academy-name');
  box.removeAttribute('data-academy-id');
  box.innerHTML = '<div class="olliErrorBox">' + settingsEscapeHtml(opts.message || '기존 학원 확인에 실패했습니다.') + '</div>';
}

function selectOlliOwnerExistingAcademyLookupResult(academyId, academyCode, academyName) {
  const academy = {
    academy_id: String(academyId || '').trim(),
    academy_code: String(academyCode || '').trim(),
    academy_name: String(academyName || '').trim()
  };
  const input = document.getElementById('olliOwnerExistingAcademyCodeInput');
  if (input) input.value = academy.academy_code || academy.academy_name || '';
  renderOlliOwnerExistingAcademyLookupResult(academy);
  localStorage.setItem('olli_pending_academy_code', academy.academy_code || '');
  localStorage.setItem('olli_pending_academy_access_role', 'owner');
  return academy;
}
window.selectOlliOwnerExistingAcademyLookupResult = selectOlliOwnerExistingAcademyLookupResult;

function renderOlliOwnerExistingAcademyLookupResults(list, query) {
  const box = document.getElementById('olliOwnerExistingAcademyLookupResult');
  if (!box) return;
  const results = Array.isArray(list) ? list : [];
  if (results.length === 1) {
    renderOlliOwnerExistingAcademyLookupResult(results[0]);
    return;
  }
  box.style.display = 'block';
  box.removeAttribute('data-academy-code');
  box.removeAttribute('data-academy-name');
  box.removeAttribute('data-academy-id');
  const items = results.map(academy => {
    const id = settingsEscapeAttr(academy.academy_id || '');
    const code = settingsEscapeAttr(academy.academy_code || '');
    const name = settingsEscapeAttr(academy.academy_name || '');
    return '<button class="olliLookupResultBtn" type="button" onclick="selectOlliOwnerExistingAcademyLookupResult(\'' + id + '\',\'' + code + '\',\'' + name + '\')">'
      + '<span class="olliLookupResultName">' + settingsEscapeHtml(academy.academy_name || '이름 없음') + '</span>'
      + '<span class="olliLookupResultCode">학원 아이디 ' + settingsEscapeHtml(academy.academy_code || '') + '</span>'
      + '</button>';
  }).join('');
  box.innerHTML = '<div class="olliInfoHead">검색 결과를 선택해 주세요</div>'
    + '<div class="olliInfoItem">' + settingsEscapeHtml(query || '입력한 검색어') + '가 포함된 학원을 모두 표시했습니다. 학원 아이디를 확인하고 선택해 주세요.</div>'
    + '<div class="olliLookupResultList">' + items + '</div>';
}

async function lookupOlliOwnerExistingAcademy() {
  const codeInput = document.getElementById('olliOwnerExistingAcademyCodeInput');
  const btn = document.getElementById('olliOwnerExistingLookupBtn');
  const academyCode = String(codeInput?.value || '').trim();
  if (!academyCode) { alert('학원 아이디 또는 학원명을 입력해 주세요.'); return null; }
  if (!localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY)) {
    alert('개인계정 로그인 후 기존 학원을 찾을 수 있습니다. 먼저 계정으로 로그인해 주세요.');
    showOlliOwnerLogin();
    return null;
  }
  try {
    if (btn) { btn.disabled = true; btn.textContent = '확인 중...'; }
    const academies = await findOlliAcademiesByQueryForAccountAccess(academyCode);
    renderOlliOwnerExistingAcademyLookupResults(academies, academyCode);
    if (academies.length === 1) {
      localStorage.setItem('olli_pending_academy_code', academies[0].academy_code || academyCode);
      localStorage.setItem('olli_pending_academy_access_role', 'owner');
      return academies[0];
    }
    return null;
  } catch (error) {
    renderOlliOwnerExistingAcademyLookupResult(null, { message: error?.message || error });
    return null;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '학원 확인'; }
  }
}

async function submitOlliOwnerExistingAcademyRequest() {
  const academyCodeInput = document.getElementById('olliOwnerExistingAcademyCodeInput');
  const btn = document.getElementById('olliOwnerExistingRequestBtn');
  const academyCode = String(academyCodeInput?.value || '').trim().toUpperCase();
  const sessionToken = String(localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY) || '').trim();

  if (!sessionToken) {
    alert('개인계정 로그인 후 원장 연결 요청을 보낼 수 있습니다. 먼저 계정으로 로그인해 주세요.');
    showOlliOwnerLogin();
    return;
  }
  if (!academyCode) {
    alert('학원 아이디 또는 학원명을 입력해 주세요.');
    return;
  }
  if (!isSupabaseConfigured()) {
    alert('Supabase 설정이 필요합니다.');
    return;
  }

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = '요청 보내는 중...';
    }

    let academy = null;
    const lookupBox = document.getElementById('olliOwnerExistingAcademyLookupResult');
    const selectedCode = String(lookupBox?.getAttribute('data-academy-code') || '').trim();
    const selectedId = String(lookupBox?.getAttribute('data-academy-id') || '').trim();
    if (selectedCode || selectedId) {
      academy = {
        academy_code: selectedCode || academyCode,
        academy_name: lookupBox.getAttribute('data-academy-name') || '',
        academy_id: selectedId
      };
    } else {
      academy = await findOlliAcademyByCodeForAccountAccess(academyCode);
      renderOlliOwnerExistingAcademyLookupResult(academy);
    }

    const result = await callOlliRpc('olli_request_academy_access', {
      p_session_token: sessionToken,
      p_academy_code: academy.academy_code || academyCode,
      p_requested_role: 'owner'
    });

    if (!result || result.ok !== true) {
      throw new Error((result && result.message) || '기존 학원 원장 연결 요청을 저장하지 못했습니다.');
    }

    localStorage.setItem('olli_pending_academy_code', academy.academy_code || academyCode);
    localStorage.setItem('olli_pending_academy_access_role', 'owner');
    localStorage.removeItem('olli_pending_teacher_name');

    showOlliApprovalWaiting((result.academy_name || academy.academy_name || academyCode) + ' 학원에 원장 연결 요청을 보냈습니다. 승인되면 이 개인계정에 원장 권한으로 연결됩니다.');
  } catch (err) {
    const message = String(err && (err.message || err) || '');
    const alreadyApproved = /이미.*승인|이미.*연결|already.*approved|already.*connected|duplicate|already exists/i.test(message);
    if (alreadyApproved) {
      const approved = await checkOlliAccountAcademyAccessApproval({ silent: true });
      if (approved) return;
      showOlliApprovalWaiting('이미 승인 요청이 있거나 승인된 계정입니다. 승인 상태를 확인하고 있습니다.');
      return;
    }
    alert('원장 연결 요청 실패\n' + (err.message || err));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '원장 연결 요청';
    }
  }
}

function clearOlliAcademyLookupResult() {
  const box = document.getElementById('olliTeacherAcademyLookupResult');
  if (box) {
    box.style.display = 'none';
    box.innerHTML = '';
    box.removeAttribute('data-academy-code');
    box.removeAttribute('data-academy-name');
    box.removeAttribute('data-academy-id');
  }
}

function normalizeOlliAcademyLookupRow(row, fallbackCode) {
  if (!row) return null;
  const academyId = String(row.academy_id || row.id || '').trim();
  const academyCode = String(row.academy_code || row.academyCode || row.code || fallbackCode || '').trim();
  const academyName = String(row.academy_name || row.academyName || row.name || '').trim();
  const status = String(row.status || row.access_status || row.academy_status || '').trim().toLowerCase();
  if (!academyCode && !academyId) return null;
  if (['deleted', 'inactive', 'disabled', 'removed'].includes(status)) {
    throw new Error('삭제되었거나 사용할 수 없는 학원입니다.');
  }
  return { academy_id: academyId, academy_code: academyCode, academy_name: academyName, status };
}

function normalizeOlliAcademyLookupQuery(value) {
  return String(value || '').trim();
}

function dedupeOlliAcademyLookupRows(rows, fallbackCode) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach(row => {
    const academy = normalizeOlliAcademyLookupRow(row, fallbackCode);
    if (!academy) return;
    const key = academy.academy_id || academy.academy_code || academy.academy_name;
    if (!key || map.has(key)) return;
    map.set(key, academy);
  });
  return Array.from(map.values());
}

function getOlliAcademyLookupRowsFromRpcResult(result) {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.academies)) return result.academies;
  if (Array.isArray(result.results)) return result.results;
  if (Array.isArray(result.rows)) return result.rows;
  if (result.academy) return [result.academy];
  if (result.academy_code || result.academy_name || result.academy_id || result.id) return [result];
  return [];
}

async function findOlliAcademiesByQueryForAccountAccess(query) {
  const rawQuery = normalizeOlliAcademyLookupQuery(query);
  if (!rawQuery) throw new Error('학원 아이디 또는 학원명을 입력해 주세요.');
  const upperQuery = rawQuery.toUpperCase();
  const sessionToken = String(localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY) || '').trim();
  let lastError = null;
  let results = [];

  // 1) RPC 검색. 학원 아이디 exact뿐 아니라 학원명 일부 검색 결과가 여러 개면 모두 받아옵니다.
  const rpcPayloads = [
    { name: 'olli_find_academy_by_code', payload: { p_academy_code: rawQuery, p_session_token: sessionToken || null } },
    { name: 'olli_lookup_academy_by_code', payload: { p_academy_code: rawQuery, p_session_token: sessionToken || null } }
  ];

  for (const item of rpcPayloads) {
    try {
      const result = await callOlliRpc(item.name, item.payload);
      const rpcRows = getOlliAcademyLookupRowsFromRpcResult(result);
      const rpcAcademies = dedupeOlliAcademyLookupRows(rpcRows, upperQuery);
      if (rpcAcademies.length) results = results.concat(rpcAcademies);
      break;
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error || '');
      const missingRpc = /could not find|not found|schema cache|undefined|404|PGRST202/i.test(message);
      if (!missingRpc) break;
    }
  }

  // 2) REST 직접 조회. academies에는 academy_id 컬럼이 없고 id / academy_code가 기준입니다.
  const selectColumns = 'id,academy_code,academy_name,status,region';
  const directQueries = [
    `academies?select=${selectColumns}&academy_code=eq.${encodeURIComponent(upperQuery)}&limit=30`,
    `academies?select=${selectColumns}&academy_code=ilike.*${encodeURIComponent(upperQuery)}*&limit=30`,
    `academies?select=${selectColumns}&academy_name=ilike.*${encodeURIComponent(rawQuery)}*&limit=30`
  ];

  for (const path of directQueries) {
    try {
      const rows = await supabase('GET', path);
      results = results.concat(dedupeOlliAcademyLookupRows(rows, upperQuery));
    } catch (error) {
      lastError = error;
      console.warn('학원 검색 직접 조회 실패:', error && (error.message || error));
    }
  }

  results = dedupeOlliAcademyLookupRows(results, upperQuery);
  if (!results.length) {
    throw new Error('해당 학원 아이디 또는 학원명을 찾지 못했습니다.' + (lastError ? '\n' + (lastError.message || lastError) : ''));
  }
  return results;
}

async function findOlliAcademyByCodeForAccountAccess(academyCode) {
  const list = await findOlliAcademiesByQueryForAccountAccess(academyCode);
  const query = normalizeOlliAcademyLookupQuery(academyCode).toUpperCase();
  const exact = list.filter(item => String(item.academy_code || '').trim().toUpperCase() === query);
  if (exact.length === 1) return exact[0];
  if (list.length === 1) return list[0];
  throw new Error('검색 결과가 여러 개입니다. 학원 이름과 학원 아이디를 확인해 하나를 선택해 주세요.');
}

function selectOlliAcademyLookupResult(academyId, academyCode, academyName) {
  const academy = {
    academy_id: String(academyId || '').trim(),
    academy_code: String(academyCode || '').trim(),
    academy_name: String(academyName || '').trim()
  };
  const input = document.getElementById('olliTeacherAcademyCodeInput');
  if (input) input.value = academy.academy_code || academy.academy_name || '';
  renderOlliAcademyLookupResult(academy);
  localStorage.setItem('olli_pending_academy_code', academy.academy_code || '');
  return academy;
}
window.selectOlliAcademyLookupResult = selectOlliAcademyLookupResult;

function renderOlliAcademyLookupResult(academy, options) {
  const box = document.getElementById('olliTeacherAcademyLookupResult');
  if (!box) return;
  const opts = options || {};
  box.style.display = 'block';
  if (academy) {
    box.setAttribute('data-academy-code', academy.academy_code || '');
    box.setAttribute('data-academy-name', academy.academy_name || '');
    box.setAttribute('data-academy-id', academy.academy_id || '');
    box.innerHTML = '<div class="olliInfoHead">학원 확인 완료</div>'
      + '<div class="olliInfoItem">학원명: <strong>' + settingsEscapeHtml(academy.academy_name || '이름 없음') + '</strong></div>'
      + '<div class="olliInfoItem">학원 아이디: <strong>' + settingsEscapeHtml(academy.academy_code || '') + '</strong></div>'
      + '<div class="olliSuccessBox">이 학원으로 승인 요청을 보낼 수 있습니다.</div>';
    return;
  }
  box.removeAttribute('data-academy-code');
  box.removeAttribute('data-academy-name');
  box.removeAttribute('data-academy-id');
  box.innerHTML = '<div class="olliErrorBox">' + settingsEscapeHtml(opts.message || '학원 확인에 실패했습니다.') + '</div>';
}

function renderOlliAcademyLookupResults(list, query) {
  const box = document.getElementById('olliTeacherAcademyLookupResult');
  if (!box) return;
  const results = Array.isArray(list) ? list : [];
  if (results.length === 1) {
    renderOlliAcademyLookupResult(results[0]);
    return;
  }
  box.style.display = 'block';
  box.removeAttribute('data-academy-code');
  box.removeAttribute('data-academy-name');
  box.removeAttribute('data-academy-id');
  const items = results.map(academy => {
    const id = settingsEscapeAttr(academy.academy_id || '');
    const code = settingsEscapeAttr(academy.academy_code || '');
    const name = settingsEscapeAttr(academy.academy_name || '');
    return '<button class="olliLookupResultBtn" type="button" onclick="selectOlliAcademyLookupResult(\'' + id + '\',\'' + code + '\',\'' + name + '\')">'
      + '<span class="olliLookupResultName">' + settingsEscapeHtml(academy.academy_name || '이름 없음') + '</span>'
      + '<span class="olliLookupResultCode">학원 아이디 ' + settingsEscapeHtml(academy.academy_code || '') + '</span>'
      + '</button>';
  }).join('');
  box.innerHTML = '<div class="olliInfoHead">검색 결과를 선택해 주세요</div>'
    + '<div class="olliInfoItem">' + settingsEscapeHtml(query || '입력한 검색어') + ' 가 포함된 학원을 모두 표시했습니다. 학원 아이디를 확인하고 선택해 주세요.</div>'
    + '<div class="olliLookupResultList">' + items + '</div>';
}

async function lookupOlliAcademyForAccountAccess() {
  const codeInput = document.getElementById('olliTeacherAcademyCodeInput');
  const btn = document.getElementById('olliTeacherLookupBtn');
  const academyQuery = String(codeInput?.value || '').trim();
  if (!academyQuery) { alert('학원 아이디 또는 학원명을 입력해 주세요.'); return null; }
  if (!localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY)) {
    alert('개인계정 로그인 후 학원을 찾을 수 있습니다. 먼저 계정으로 로그인해 주세요.');
    showOlliOwnerLogin();
    return null;
  }
  try {
    if (btn) { btn.disabled = true; btn.textContent = '확인 중...'; }
    const academies = await findOlliAcademiesByQueryForAccountAccess(academyQuery);
    renderOlliAcademyLookupResults(academies, academyQuery);
    if (academies.length === 1) {
      localStorage.setItem('olli_pending_academy_code', academies[0].academy_code || academyQuery);
      return academies[0];
    }
    return null;
  } catch (error) {
    renderOlliAcademyLookupResult(null, { message: error?.message || error });
    return null;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '학원 확인'; }
  }
}

async function checkOlliAccountAcademyAccessApproval(options = {}) {
  const silent = !!options.silent;
  const sessionToken = String(localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY) || '').trim();
  const pendingCode = String(
    document.getElementById('olliTeacherAcademyCodeInput')?.value ||
    localStorage.getItem('olli_pending_academy_code') || ''
  ).trim().toUpperCase();
  if (!sessionToken || !pendingCode) return false;
  try {
    const result = await callOlliTestRpc('olli_get_my_academies', { p_session_token: sessionToken });
    const academies = await filterOlliExistingAcademies(result?.academies || []);
    if (!academies.length) {
      if (!silent) alert('아직 원장 승인이 완료되지 않았습니다.');
      return false;
    }
    const matched = academies.find(item => String(item.academy_code || item.academyCode || '').trim().toUpperCase() === pendingCode)
      || academies[0];
    if (!matched) {
      if (!silent) alert('아직 원장 승인이 완료되지 않았습니다.');
      return false;
    }
    applyOlliAccessibleAcademies(academies);
    saveOlliAcademyLoginState(matched, { accountLogin: true });
    localStorage.removeItem('olli_pending_academy_code');
    localStorage.removeItem('olli_pending_teacher_name');
    if (typeof settingsRefreshAll === 'function') await settingsRefreshAll();
    await enterOlliAfterLoginOrSetup();
    if (!silent) alert('승인 확인 완료! 학원으로 입장합니다.');
    return true;
  } catch (error) {
    if (!silent) alert('승인 확인 중 오류가 발생했습니다.\n' + (error?.message || error));
    return false;
  }
}

async function submitOlliTeacherApprovalRequest() {
  const academyCodeInput = document.getElementById('olliTeacherAcademyCodeInput');
  const btn = document.getElementById('olliTeacherRequestBtn');
  const academyCode = String(academyCodeInput?.value || '').trim().toUpperCase();
  const sessionToken = String(localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY) || '').trim();

  if (!sessionToken) {
    alert('개인계정 로그인 후 승인 요청을 보낼 수 있습니다. 먼저 계정으로 로그인해 주세요.');
    showOlliOwnerLogin();
    return;
  }
  if (!academyCode) {
    alert('학원 아이디 또는 학원명을 입력해 주세요.');
    return;
  }
  if (!isSupabaseConfigured()) {
    alert('Supabase 설정이 필요합니다.');
    return;
  }

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = '요청 보내는 중...';
    }

    let academy = null;
    const lookupBox = document.getElementById('olliTeacherAcademyLookupResult');
    const selectedCode = String(lookupBox?.getAttribute('data-academy-code') || '').trim();
    const selectedId = String(lookupBox?.getAttribute('data-academy-id') || '').trim();
    if (selectedCode || selectedId) {
      academy = {
        academy_code: selectedCode || academyCode,
        academy_name: lookupBox.getAttribute('data-academy-name') || '',
        academy_id: selectedId
      };
    } else {
      academy = await findOlliAcademyByCodeForAccountAccess(academyCode);
      renderOlliAcademyLookupResult(academy);
    }

    const result = await callOlliRpc('olli_request_academy_access', {
      p_session_token: sessionToken,
      p_academy_code: academy.academy_code || academyCode,
      p_requested_role: 'teacher'
    });

    if (!result || result.ok !== true) {
      throw new Error((result && result.message) || '학원 연결 승인 요청을 저장하지 못했습니다.');
    }

    localStorage.setItem('olli_pending_academy_code', academy.academy_code || academyCode);
    localStorage.removeItem('olli_pending_teacher_name');

    showOlliApprovalWaiting((result.academy_name || academy.academy_name || academyCode) + ' 학원에 승인 요청을 보냈습니다. 원장님이 승인하면 이 개인계정에 학원이 연결됩니다.');
  } catch (err) {
    const message = String(err && (err.message || err) || '');
    const alreadyApproved = /이미.*승인|이미.*연결|already.*approved|already.*connected|duplicate|already exists/i.test(message);
    if (alreadyApproved) {
      const approved = await checkOlliAccountAcademyAccessApproval({ silent: true });
      if (approved) return;
      showOlliApprovalWaiting('이미 승인 요청이 있거나 승인된 계정입니다. 승인 상태를 확인하고 있습니다.');
      return;
    }
    alert('승인 요청 실패\n' + (err.message || err));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '승인 요청';
    }
  }
}


async function checkOlliTeacherApprovalStatus(options = {}) {
  const silent = !!(options && options.silent);
  const sessionToken = String(localStorage.getItem(OLLI_ACCOUNT_SESSION_TOKEN_KEY) || '').trim();
  const pendingCode = String(
    document.getElementById('olliTeacherAcademyCodeInput')?.value ||
    localStorage.getItem('olli_pending_academy_code') ||
    ''
  ).trim().toUpperCase();

  if (!sessionToken) {
    if (!silent) {
      alert('승인 상태 확인은 개인계정 로그인 후 사용할 수 있습니다. 먼저 계정으로 로그인해 주세요.');
      showOlliOwnerLogin();
    }
    return false;
  }

  const accountApproved = await checkOlliAccountAcademyAccessApproval({ silent: true });
  if (accountApproved) return true;

  if (!silent) {
    alert(pendingCode ? '아직 원장 승인이 완료되지 않았습니다.' : '학원 승인 요청 정보를 확인하지 못했습니다. 학원 아이디로 다시 요청해 주세요.');
    if (!pendingCode) showOlliTeacherRequest();
  }
  return false;
}

function getOlliDeviceName() {
  const ua = navigator.userAgent || '';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Mac/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows';
  return 'Unknown device';
}

function getOlliLoginDeviceId() {
  const key = 'olli_device_id_v1';
  let id = localStorage.getItem(key);
  if (!id) {
    id = 'dev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(key, id);
  }
  return id;
}

let olliMemberValidationPromise = null;
let olliMemberAccessBlocked = false;
let olliMemberValidationBound = false;

function clearOlliTeacherAccessStateForReapproval() {
  // 개인계정 기반 연결에서는 학원 멤버십만 기준으로 확인합니다.
  ['olli_pending_academy_code', 'olli_pending_teacher_name'].forEach(key => {
    try { localStorage.removeItem(key); } catch (_) {}
  });
}

function showOlliMemberAccessBlocked(message) {
  console.warn(message || '계정 접근 상태 확인이 필요합니다.');
}

async function validateOlliCurrentMemberAccess(options) {
  return { valid: true, skipped: true, reason: 'ACCOUNT_SESSION_ONLY' };
}

function bindOlliMemberAccessValidation() {
  olliMemberValidationBound = true;
}

window.validateOlliCurrentMemberAccess = validateOlliCurrentMemberAccess;
window.bindOlliMemberAccessValidation = bindOlliMemberAccessValidation;
bindOlliMemberAccessValidation();
