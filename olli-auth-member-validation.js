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
  const opts = Object.assign({
    silent: false,
    sessionRestore: null,
    refresh: true
  }, options || {});

  if (olliMemberValidationPromise) return olliMemberValidationPromise;

  olliMemberValidationPromise = (async () => {
    const sessionToken = String(localStorage.getItem('olli_account_session_token_v1') || '').trim();
    if (!sessionToken) {
      return { valid: false, blocked: true, reason: 'NO_ACCOUNT_SESSION' };
    }

    let restored = opts.sessionRestore || null;
    if (restored?.degraded === true) {
      return { valid: false, blocked: false, degraded: true, reason: restored.reason || 'TEMPORARY_RESTORE_FAILURE' };
    }

    if ((!restored || restored.authoritative !== true) && opts.refresh !== false) {
      if (typeof restoreOlliAccountSession !== 'function') {
        return { valid: false, blocked: false, reason: 'SESSION_VALIDATOR_UNAVAILABLE' };
      }
      restored = await restoreOlliAccountSession({
        silent: true,
        allowCachedFallback: false
      });
    }

    if (restored?.degraded === true) {
      return { valid: false, blocked: false, degraded: true, reason: restored.reason || 'TEMPORARY_RESTORE_FAILURE' };
    }

    if (!restored || restored.restored !== true || restored.authoritative !== true) {
      return {
        valid: false,
        blocked: restored?.blocked === true,
        reason: restored?.reason || 'SESSION_NOT_AUTHORITATIVE'
      };
    }

    const academies = Array.isArray(restored.academies) ? restored.academies : [];
    const currentAcademyId = String(localStorage.getItem('olli_current_academy_id') || '').trim();
    const currentAcademyCode = String(localStorage.getItem('olli_current_academy_code') || '').trim().toUpperCase();

    const matched = academies.find(item => {
      const academyId = String(item?.academy_id || item?.academyId || '').trim();
      const academyCode = String(item?.academy_code || item?.academyCode || '').trim().toUpperCase();
      return (currentAcademyId && academyId === currentAcademyId)
        || (currentAcademyCode && academyCode === currentAcademyCode);
    }) || restored.selected || null;

    if (!matched) {
      return { valid: false, blocked: true, reason: 'MEMBERSHIP_NOT_FOUND' };
    }

    const membershipStatus = String(
      matched.membership_status || matched.member_status || matched.status || 'active'
    ).trim().toLowerCase();
    if (membershipStatus !== 'active') {
      return { valid: false, blocked: true, reason: 'MEMBERSHIP_INACTIVE' };
    }

    const memberId = String(matched.member_id || matched.memberId || '').trim();
    const role = String(matched.role || matched.member_role || '').trim();

    if (typeof saveOlliAcademyLoginState === 'function') {
      try { saveOlliAcademyLoginState(matched, { accountLogin: true }); } catch (_) {}
    }

    olliMemberAccessBlocked = false;
    clearOlliTeacherAccessStateForReapproval();
    return {
      valid: true,
      blocked: false,
      authoritative: true,
      academyId: String(matched.academy_id || matched.academyId || '').trim(),
      memberId,
      role
    };
  })();

  try {
    const result = await olliMemberValidationPromise;
    olliMemberAccessBlocked = result?.blocked === true;
    if (olliMemberAccessBlocked && !opts.silent) {
      showOlliMemberAccessBlocked('현재 계정의 학원 멤버십을 확인하지 못했습니다.');
    }
    return result;
  } finally {
    olliMemberValidationPromise = null;
  }
}

function bindOlliMemberAccessValidation() {
  olliMemberValidationBound = true;
}

window.validateOlliCurrentMemberAccess = validateOlliCurrentMemberAccess;
window.bindOlliMemberAccessValidation = bindOlliMemberAccessValidation;
bindOlliMemberAccessValidation();
