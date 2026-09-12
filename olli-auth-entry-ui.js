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
  const resetScreen = document.getElementById('olliPasswordResetScreen');
  if (resetScreen) {
    resetScreen.classList.remove('olliLoginShow');
    resetScreen.style.display = 'none';
  }
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
    'olliStartPageSetupScreen',
    'olliPasswordResetScreen'
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
  if (typeof window.olliAfterShowLoginEntry === 'function') window.olliAfterShowLoginEntry();
}

function showOlliOwnerLogin() {
  showOlliLoginScreenById('olliOwnerLoginScreen');

  const loginId = document.getElementById('olliOwnerAcademyCodeInput');
  if (loginId && !loginId.value) loginId.value = localStorage.getItem(OLLI_ACCOUNT_LOGIN_ID_KEY) || '';
  if (typeof window.olliAfterShowOwnerLogin === 'function') window.olliAfterShowOwnerLogin();
}

function showOlliAccountCreate() {
  showOlliLoginScreenById('olliAccountCreateScreen');
  const loginId = document.getElementById('olliAccountCreateLoginIdInput');
  if (loginId && !loginId.value) loginId.focus();
  if (typeof window.olliAfterShowAccountCreate === 'function') window.olliAfterShowAccountCreate();
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

/* 2026-09 비밀번호 찾기: 등록 기기 확인 + Supabase 1회용 재설정 토큰 */
let olliPasswordResetToken = '';
let olliPasswordResetLoginId = '';

function getOlliPasswordResetDeviceId() {
  try {
    if (typeof getOlliLoginDeviceId === 'function') {
      const existing = String(getOlliLoginDeviceId() || '').trim();
      if (existing) return existing;
    }
  } catch (_) {}

  const key = 'olli_account_device_id_v1';
  let deviceId = '';
  try { deviceId = String(localStorage.getItem(key) || '').trim(); } catch (_) {}
  if (deviceId) return deviceId;

  try {
    deviceId = 'web-' + (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint32Array(4))).map(v => v.toString(16)).join(''));
    localStorage.setItem(key, deviceId);
  } catch (_) {
    deviceId = 'web-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
    try { localStorage.setItem(key, deviceId); } catch (_) {}
  }
  return deviceId;
}

function setOlliPasswordResetMessage(message, kind) {
  const box = document.getElementById('olliPasswordResetMessage');
  if (!box) return;
  box.style.display = message ? 'block' : 'none';
  box.textContent = message || '';
  box.className = 'olliPasswordResetMessage' + (kind ? ' ' + kind : '');
}

function setOlliPasswordResetStep(step) {
  const requestStep = document.getElementById('olliPasswordResetRequestStep');
  const changeStep = document.getElementById('olliPasswordResetChangeStep');
  const successStep = document.getElementById('olliPasswordResetSuccessStep');
  if (requestStep) requestStep.style.display = step === 'request' ? 'block' : 'none';
  if (changeStep) changeStep.style.display = step === 'change' ? 'block' : 'none';
  if (successStep) successStep.style.display = step === 'success' ? 'block' : 'none';
}

function showOlliPasswordReset() {
  olliPasswordResetToken = '';
  olliPasswordResetLoginId = '';
  setOlliPasswordResetStep('request');
  setOlliPasswordResetMessage('', '');
  showOlliLoginScreenById('olliPasswordResetScreen');

  const loginInput = document.getElementById('olliPasswordResetLoginIdInput');
  const currentLoginId = String(document.getElementById('olliOwnerAcademyCodeInput')?.value || localStorage.getItem('olli_account_login_id_v1') || '').trim();
  if (loginInput) {
    loginInput.value = currentLoginId;
    setTimeout(() => loginInput.focus(), 0);
  }
}

function closeOlliPasswordReset() {
  olliPasswordResetToken = '';
  olliPasswordResetLoginId = '';
  showOlliOwnerLogin();
}

function useOlliOperatorResetCode() {
  olliPasswordResetToken = '';
  const codeWrap = document.getElementById('olliPasswordResetManualCodeWrap');
  if (codeWrap) codeWrap.style.display = 'block';
  setOlliPasswordResetStep('change');
  setOlliPasswordResetMessage('운영자에게 받은 인증번호를 입력한 뒤 새 비밀번호를 설정해 주세요.', 'info');
  setTimeout(() => document.getElementById('olliPasswordResetManualCodeInput')?.focus(), 0);
}

async function requestOlliPasswordReset() {
  const loginId = String(document.getElementById('olliPasswordResetLoginIdInput')?.value || '').trim();
  const btn = document.getElementById('olliPasswordResetRequestBtn');
  if (!loginId) {
    setOlliPasswordResetMessage('개인계정 아이디를 입력해 주세요.', 'error');
    return;
  }

  try {
    if (btn) { btn.disabled = true; btn.textContent = '확인 중...'; }
    setOlliPasswordResetMessage('계정과 등록 기기를 확인하고 있습니다.', 'info');
    const result = await callOlliTestRpc('olli_password_reset_request', {
      p_login_id: loginId,
      p_device_id: getOlliPasswordResetDeviceId()
    });

    olliPasswordResetLoginId = loginId;
    if (result?.ready === true && result?.reset_token) {
      olliPasswordResetToken = String(result.reset_token);
      const codeWrap = document.getElementById('olliPasswordResetManualCodeWrap');
      if (codeWrap) codeWrap.style.display = 'none';
      setOlliPasswordResetStep('change');
      setOlliPasswordResetMessage('등록된 기기가 확인되었습니다. 새 비밀번호를 입력해 주세요. 인증 토큰은 앱 내부에서만 처리됩니다.', 'success');
      setTimeout(() => document.getElementById('olliPasswordResetNewPasswordInput')?.focus(), 0);
      return;
    }

    setOlliPasswordResetMessage('이 기기에서는 자동 확인할 수 없습니다. 등록된 기기에서 다시 시도하거나 운영자에게 비밀번호 재설정을 요청해 주세요.', 'info');
    const fallbackBtn = document.getElementById('olliPasswordResetFallbackBtn');
    if (fallbackBtn) fallbackBtn.style.display = 'block';
  } catch (error) {
    setOlliPasswordResetMessage(error?.message || '비밀번호 재설정 요청 중 오류가 발생했습니다.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '계정 확인'; }
  }
}

async function confirmOlliPasswordReset() {
  const newPassword = String(document.getElementById('olliPasswordResetNewPasswordInput')?.value || '');
  const confirmPassword = String(document.getElementById('olliPasswordResetConfirmPasswordInput')?.value || '');
  const manualCode = String(document.getElementById('olliPasswordResetManualCodeInput')?.value || '').trim();
  const resetToken = olliPasswordResetToken || manualCode;
  const btn = document.getElementById('olliPasswordResetConfirmBtn');

  if (!olliPasswordResetLoginId) {
    setOlliPasswordResetMessage('아이디 확인부터 다시 진행해 주세요.', 'error');
    setOlliPasswordResetStep('request');
    return;
  }
  if (!resetToken) {
    setOlliPasswordResetMessage('인증 정보를 확인해 주세요.', 'error');
    return;
  }
  if (newPassword.length < 8) {
    setOlliPasswordResetMessage('새 비밀번호는 8자 이상 입력해 주세요.', 'error');
    return;
  }
  if (newPassword.length > 128) {
    setOlliPasswordResetMessage('새 비밀번호는 128자 이하로 입력해 주세요.', 'error');
    return;
  }
  if (newPassword !== confirmPassword) {
    setOlliPasswordResetMessage('새 비밀번호와 비밀번호 확인이 일치하지 않습니다.', 'error');
    return;
  }

  try {
    if (btn) { btn.disabled = true; btn.textContent = '변경 중...'; }
    const result = await callOlliTestRpc('olli_password_reset_confirm', {
      p_login_id: olliPasswordResetLoginId,
      p_reset_code: resetToken,
      p_new_password: newPassword
    });

    if (!result || result.ok !== true) throw new Error('비밀번호 변경 결과를 확인하지 못했습니다.');

    [
      'olli_account_session_token_v1',
      'olli_owner_logged_in',
      'olli_teacher_logged_in',
      'olli_owner_login_at',
      'olli_teacher_login_at'
    ].forEach(key => {
      try { localStorage.removeItem(key); } catch (_) {}
    });

    const ownerLoginId = document.getElementById('olliOwnerAcademyCodeInput');
    const ownerPassword = document.getElementById('olliOwnerPasswordInput');
    if (ownerLoginId) ownerLoginId.value = olliPasswordResetLoginId;
    if (ownerPassword) ownerPassword.value = '';

    document.getElementById('olliPasswordResetNewPasswordInput').value = '';
    document.getElementById('olliPasswordResetConfirmPasswordInput').value = '';
    const manualInput = document.getElementById('olliPasswordResetManualCodeInput');
    if (manualInput) manualInput.value = '';
    olliPasswordResetToken = '';
    setOlliPasswordResetStep('success');
    setOlliPasswordResetMessage('비밀번호가 변경되었습니다. 새 비밀번호로 다시 로그인해 주세요.', 'success');
  } catch (error) {
    setOlliPasswordResetMessage(error?.message || '비밀번호를 변경하지 못했습니다.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '비밀번호 변경'; }
  }
}

(function mountOlliPasswordResetUi() {
  if (document.getElementById('olliPasswordResetScreen')) return;

  const style = document.createElement('style');
  style.id = 'olliPasswordResetStyle';
  style.textContent = `
    .olliPasswordResetLink{width:100%;border:0;background:transparent;padding:10px 4px 2px;font:inherit;font-size:13px;color:#6b7280;text-align:center;cursor:pointer}
    .olliPasswordResetLink:hover{text-decoration:underline}
    .olliPasswordResetMessage{margin:12px 0 0;padding:12px 14px;border-radius:12px;font-size:13px;line-height:1.5;background:#f5f5f5;color:#4b5563}
    .olliPasswordResetMessage.error{background:#fff1f2;color:#be123c}
    .olliPasswordResetMessage.success{background:#ecfdf5;color:#047857}
    .olliPasswordResetMessage.info{background:#f8fafc;color:#475569}
    .olliPasswordResetGuide{margin-top:10px;font-size:12px;line-height:1.55;color:#8a8f98}
  `;
  document.head.appendChild(style);

  const loginCard = document.querySelector('#olliOwnerLoginScreen .olliInputCard');
  if (loginCard && !document.getElementById('olliForgotPasswordBtn')) {
    const forgotBtn = document.createElement('button');
    forgotBtn.id = 'olliForgotPasswordBtn';
    forgotBtn.type = 'button';
    forgotBtn.className = 'olliPasswordResetLink';
    forgotBtn.textContent = '비밀번호 찾기';
    forgotBtn.onclick = showOlliPasswordReset;
    loginCard.appendChild(forgotBtn);
  }

  const screen = document.createElement('div');
  screen.className = 'olliLoginScreen';
  screen.id = 'olliPasswordResetScreen';
  screen.style.display = 'none';
  screen.innerHTML = `
    <div class="olliLoginPageInner">
      <div class="olliLoginHeader">
        <button class="olliLoginBackBtn" onclick="closeOlliPasswordReset()" type="button" aria-label="로그인으로 돌아가기">
          <svg viewBox="0 0 24 24"><path d="M15.5 5l-7 7 7 7"></path></svg>
        </button>
        <button class="olliLoginTitlePill" type="button">비밀번호 찾기</button>
      </div>
      <div class="olliLoginBody">
        <div class="olliIntroCard">
          <div class="olliIntroTitle">본인 기기를 확인한 뒤<br/>새 비밀번호를 설정합니다.</div>
          <div class="olliLoginDesc" style="margin-top:10px;text-align:left;">등록된 기기에서는 Supabase가 1회용 인증 토큰을 앱에 안전하게 전달합니다. 토큰은 화면에 표시하지 않습니다.</div>
        </div>
        <div class="olliInputCard">
          <div id="olliPasswordResetRequestStep">
            <div class="olliInputGroup">
              <div class="olliInputLabel">개인계정 아이디</div>
              <input class="olliInput" id="olliPasswordResetLoginIdInput" autocomplete="username" placeholder="아이디" />
            </div>
            <button class="olliPrimaryBtn" id="olliPasswordResetRequestBtn" onclick="requestOlliPasswordReset()" type="button">계정 확인</button>
            <button class="olliSecondaryBtn" id="olliPasswordResetFallbackBtn" onclick="useOlliOperatorResetCode()" style="display:none;" type="button">운영자 인증번호 입력</button>
          </div>
          <div id="olliPasswordResetChangeStep" style="display:none;">
            <div class="olliInputGroup" id="olliPasswordResetManualCodeWrap" style="display:none;">
              <div class="olliInputLabel">운영자 인증번호</div>
              <input class="olliInput" id="olliPasswordResetManualCodeInput" inputmode="numeric" maxlength="128" placeholder="인증번호" />
            </div>
            <div class="olliInputGroup">
              <div class="olliInputLabel">새 비밀번호</div>
              <input class="olliInput" id="olliPasswordResetNewPasswordInput" autocomplete="new-password" placeholder="8자 이상" type="password" />
            </div>
            <div class="olliInputGroup">
              <div class="olliInputLabel">새 비밀번호 확인</div>
              <input class="olliInput" id="olliPasswordResetConfirmPasswordInput" autocomplete="new-password" placeholder="새 비밀번호 다시 입력" type="password" />
            </div>
            <button class="olliPrimaryBtn" id="olliPasswordResetConfirmBtn" onclick="confirmOlliPasswordReset()" type="button">비밀번호 변경</button>
            <div class="olliPasswordResetGuide">인증 정보는 10분 동안 한 번만 사용할 수 있습니다. 변경이 완료되면 기존 로그인 세션은 모두 종료됩니다.</div>
          </div>
          <div id="olliPasswordResetSuccessStep" style="display:none;">
            <button class="olliPrimaryBtn" onclick="closeOlliPasswordReset()" type="button">새 비밀번호로 로그인</button>
          </div>
          <div class="olliPasswordResetMessage" id="olliPasswordResetMessage" style="display:none;"></div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(screen);
})();
