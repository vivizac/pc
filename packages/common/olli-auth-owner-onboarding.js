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

