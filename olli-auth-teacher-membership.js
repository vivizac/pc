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

