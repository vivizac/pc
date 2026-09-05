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

