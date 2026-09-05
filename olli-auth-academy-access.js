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

