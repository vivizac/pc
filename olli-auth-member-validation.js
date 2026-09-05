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
