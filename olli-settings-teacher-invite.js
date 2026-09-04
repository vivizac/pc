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
