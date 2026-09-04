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

