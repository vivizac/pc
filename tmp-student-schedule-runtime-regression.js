(function () {
  'use strict';
  const out = { checks: [], errors: [] };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const check = (condition, message, detail) => {
    if (!condition) throw new Error(message + (detail ? ` :: ${JSON.stringify(detail)}` : ''));
    out.checks.push(message);
  };
  const setGlobal = (name, value) => {
    window[name] = value;
    try { (0, eval)(`${name} = window[${JSON.stringify(name)}]`); } catch (_) {}
  };
  const setRecordView = (value) => {
    try { (0, eval)(`currentRecordView = ${JSON.stringify(value)}`); } catch (error) { throw new Error(`currentRecordView 설정 실패: ${error.message}`); }
  };
  const setValue = (id, value) => {
    const el = document.getElementById(id);
    check(!!el, `DOM 존재: #${id}`);
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const waitFor = async (predicate, label, timeout = 8000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      try { if (predicate()) return; } catch (_) {}
      await sleep(50);
    }
    throw new Error(`대기 실패: ${label}`);
  };
  const loadScript = (src) => new Promise((resolve, reject) => {
    const existing = Array.from(document.scripts).find((s) => (s.getAttribute('src') || '').split('?')[0].endsWith(src));
    if (existing) { resolve(); return; }
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`스크립트 로드 실패: ${src}`));
    document.head.appendChild(script);
  });
  function renderResult(ok) {
    let pre = document.getElementById('runtimeRegressionResult');
    if (!pre) {
      pre = document.createElement('pre');
      pre.id = 'runtimeRegressionResult';
      document.body.appendChild(pre);
    }
    pre.textContent = `${ok ? 'REGRESSION_PASS' : 'REGRESSION_FAIL'}\n${JSON.stringify(out, null, 2)}`;
    document.documentElement.setAttribute('data-runtime-regression', ok ? 'pass' : 'fail');
  }

  async function ensureCoreLoaded() {
    await waitFor(() => typeof window.olliPrepareStudentAddExtra === 'function' && typeof window.confirmStudent === 'function', 'canonical student modal functions');
    if (typeof window.olliPcAuthoritativeScheduleAfterPrepareStudentAdd !== 'function') await loadScript('pc-student-info-card-runtime.js');
    if (typeof window.olliPcClassRoutingAfterPrepareStudentAdd !== 'function') await loadScript('pc-student-class-routing.js');
    await waitFor(() => typeof window.olliPcAuthoritativeScheduleAfterPrepareStudentAdd === 'function'
      && typeof window.olliPcClassRoutingAfterPrepareStudentAdd === 'function'
      && typeof window.olliGetStudentAddSchedulePairs === 'function'
      && typeof window.olliGetInfoSchedulePairs === 'function'
      && typeof window.openOlliPcStudentInfoCard === 'function'
      && typeof window.saveOlliPcStudentInfoCard === 'function', 'PC student schedule hooks');
  }

  function ensureAttendanceShell() {
    let shell = document.getElementById('olliPcShell');
    if (!shell) {
      shell = document.createElement('div');
      shell.id = 'olliPcShell';
      document.body.appendChild(shell);
    }
    shell.dataset.pcSection = 'attendance';
    let panel = document.getElementById('pcAttendanceDetailPanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'pcAttendanceDetailPanel';
      shell.appendChild(panel);
    }
    return panel;
  }

  async function testModalMarkupAndHooks() {
    if (typeof window.olliPatchStudentModalMarkup === 'function') window.olliPatchStudentModalMarkup();
    ['studentLessonTimeToggleRow','elementaryStudentLessonTimeToggleRow','elementaryLessonTimeToggleRow','kinderLessonTimeToggleRow'].forEach((id) => {
      check(!!document.getElementById(id), `원본 시간 UI 존재: #${id}`);
    });
    check(typeof window.olliPcAuthoritativeScheduleAfterPrepareStudentAdd === 'function', 'authoritative 신규등록 훅 존재');
    check(typeof window.olliPcAuthoritativeScheduleAugmentStudentAddExtra === 'function', 'authoritative 신규등록 값 훅 존재');
    check(typeof window.olliPcAuthoritativeScheduleAfterPrepareInfo === 'function', 'authoritative 기존학생 훅 존재');
    check(typeof window.olliPcAuthoritativeScheduleAugmentInfoExtra === 'function', 'authoritative 기존학생 값 훅 존재');
    check(typeof window.olliPcClassRoutingAfterPrepareStudentAdd === 'function', 'class-routing 준비 훅 존재');
    check(typeof window.olliPcClassRoutingFinalizeStudentAddExtra === 'function', 'class-routing 최종값 훅 존재');

    window.olliPrepareStudentAddExtra('elementary');
    window.toggleStudentModalDay('월');
    window.toggleStudentModalTime('1시');
    const pairs = window.olliGetStudentAddSchedulePairs();
    check(Array.isArray(pairs) && pairs.some((p) => Number(p.weekday) === 1 && Number(p.time_slot) === 1), 'authoritative 신규등록 시간 선택 상태 생성', pairs);
    const finalExtra = window.olliGetStudentAddExtra('elementary');
    check(finalExtra.lesson_day === '' && finalExtra.lesson_time === '' && finalExtra.class_time === '', 'class-routing 최종값이 legacy 시간 필드를 비움', finalExtra);
  }

  async function testNewStudent(type, suffix) {
    setRecordView(type);
    window.openStudentModal(type);
    await sleep(100);
    setValue('studentNameInput', `회귀${suffix}`);
    setValue('studentYearBadge', '2026');
    setValue('studentMonthInput', '9');
    setValue('studentDayInput', type === 'kinder' ? '15' : '14');
    if (type === 'kinder') {
      setValue('studentKindergartenInput', '테스트유치원');
      setValue('studentAgeInput', '6');
    } else {
      setValue('studentSchoolInput', '테스트초');
      setValue('studentGradeInput', '1');
    }

    const calls = { profile: [], commit: [], release: 0, fallback: 0 };
    setGlobal('getStudentsByType', () => []);
    setGlobal('ensureStudentSavedToSupabase', async (profile) => {
      calls.profile.push(JSON.parse(JSON.stringify(profile)));
      return Object.assign({}, profile, { id: `mock-${type}-${suffix}` });
    });
    setGlobal('loadRecords', async () => {});
    setGlobal('showPushToast', () => {});
    setGlobal('closeStudentModal', () => {});
    window.olliPrepareStudentRegistrationRouting = async () => ({ handled: true, effectiveDate: '2026-09-13', pairs: [] });
    window.olliCommitStudentRegistrationRouting = async (student, context) => { calls.commit.push({ student, context }); };
    window.olliReleaseStudentRegistrationRouting = () => { calls.release += 1; };
    window.saveOlliStudentScheduleFromInfo = async () => { calls.fallback += 1; };

    await window.confirmStudent();
    check(calls.profile.length === 1, `${type} 신규학생 프로필 1회 저장`, calls);
    check(calls.commit.length === 1, `${type} 신규학생 routed commit 1회`, calls);
    check(calls.fallback === 0, `${type} 신규학생 routed 경로에서 fallback 미호출`, calls);
    check(calls.release === 1, `${type} 신규학생 routing release 1회`, calls);
    const profile = calls.profile[0];
    check(profile.type === type, `${type} 신규학생 division 유지`, profile);
    check((profile.lesson_day || '') === '' && (profile.lesson_time || '') === '' && (profile.class_time || '') === '', `${type} 신규학생 class-routing 시 legacy 시간 공란`, profile);
  }

  async function testRealClassRoutingCommit(realCommit) {
    check(typeof realCommit === 'function', '실제 class-routing commit 함수 확보');
    localStorage.setItem('olli_current_academy_id', 'mock-academy');
    localStorage.setItem('olli_account_session_token_v1', 'mock-session');
    const calls = [];
    window.supabase = async (method, path, payload) => {
      calls.push({ method, path, payload: JSON.parse(JSON.stringify(payload || {})) });
      return { ok: true };
    };
    window.loadStudentsFromSupabase = async () => {};
    window.OlliPcAttendance = { renderList() {}, unmountEditor() {} };
    window.olliTtRefreshSchedule = async () => {};
    window.showPushToast = () => {};
    await realCommit({ id: 'route-student-1' }, {
      handled: true,
      effectiveDate: '2026-09-13',
      pairs: [{ weekday: 1, time_slot: 2, class_group: 'A' }]
    });
    const rpc = calls.find((c) => c.path === 'rpc/olli_schedule_set_student_weekly_schedule');
    check(!!rpc, 'class-routing 실제 weekly-schedule RPC 1회 호출', calls);
    check(rpc.payload.p_student_id === 'route-student-1', 'class-routing RPC student id 정확');
    check(rpc.payload.p_effective_date === '2026-09-13', 'class-routing RPC effective date 정확');
    check(Array.isArray(rpc.payload.p_pairs) && rpc.payload.p_pairs.length === 1 && rpc.payload.p_pairs[0].weekday === 1 && rpc.payload.p_pairs[0].time_slot === 2, 'class-routing RPC pairs 정확', rpc.payload);
  }

  async function testExistingStudent(type, changed) {
    ensureAttendanceShell().innerHTML = '';
    localStorage.setItem('olli_current_academy_id', 'mock-academy');
    localStorage.setItem('olli_account_session_token_v1', 'mock-session');
    const isKinder = type === 'kinder';
    const student = {
      id: `existing-${type}-${changed ? 'changed' : 'same'}`,
      type,
      name: isKinder ? '유치기존' : '초등기존',
      year: 2026,
      month: '9',
      day: '1',
      enrolled_at: '2026-09-01',
      kindergarten: isKinder ? '기존유치원' : '',
      age: isKinder ? '6' : '8',
      school: isKinder ? '' : '기존초',
      grade: isKinder ? '' : '1',
      group: isKinder ? '' : '1',
      personality: '테스트',
      teacher: '기존T',
      homeroom_teacher: '기존T',
      className: 'LEGACY-KEEP',
      lesson_day: isKinder ? '목' : '월',
      lesson_time: isKinder ? '목 4시' : '월 1시',
      class_time: isKinder ? '목 4시' : '월 1시',
      status: 'active'
    };
    const basePair = isKinder
      ? { weekday: 4, time_slot: 4, class_group: 'A', teacher_name: '기존T' }
      : { weekday: 1, time_slot: 1, class_group: 'A', teacher_name: '기존T' };
    const order = [];
    const rpcCalls = [];
    window.findStudentById = (id) => id === student.id ? student : null;
    window.getStudentsByType = () => [student];
    window.loadStudentsFromSupabase = async () => {};
    window.pcSelectAttendanceStudent = async () => {};
    window.pcOpenSection = async () => {};
    window.OlliPcAttendance = { renderList() {}, unmountEditor() {} };
    window.showPushToast = () => {};
    window.supabase = async (method, path, payload) => {
      if (path === 'rpc/olli_schedule_student_enrollments') {
        return { enrollments: [basePair], pickups: [] };
      }
      if (path === 'rpc/olli_schedule_class_teacher_context') return { assignments: [] };
      if (path === 'rpc/olli_schedule_set_student_weekly_schedule') {
        order.push('schedule');
        rpcCalls.push(JSON.parse(JSON.stringify(payload || {})));
        return { ok: true };
      }
      return { ok: true };
    };
    const savedProfiles = [];
    window.ensureStudentSavedToSupabase = async (profile) => {
      order.push('profile');
      savedProfiles.push(JSON.parse(JSON.stringify(profile)));
      return Object.assign({}, profile, { id: student.id });
    };

    await window.openOlliPcStudentInfoCard(student.id);
    await sleep(50);
    check(!!document.querySelector('.pcStudentInfoCard'), `${type} 기존학생 카드 렌더링`);
    if (changed) {
      if (isKinder) window.toggleKinderInfoTime('5시');
      else window.toggleElementaryInfoTime('2시');
    }
    await window.saveOlliPcStudentInfoCard();
    check(savedProfiles.length === 1, `${type} 기존학생 프로필 1회 저장`, savedProfiles);
    check(savedProfiles[0].className === 'LEGACY-KEEP', `${type} 기존 className 보존`, savedProfiles[0]);
    check(order[0] === 'profile', `${type} 기존학생 프로필 저장이 시간표보다 먼저`, order);
    if (changed) {
      check(rpcCalls.length === 1, `${type} 시간표 변경 시 RPC 1회`, rpcCalls);
      check(order.join('>') === 'profile>schedule', `${type} 변경 저장 순서 profile→schedule`, order);
    } else {
      check(rpcCalls.length === 0, `${type} 시간표 미변경 시 RPC 미호출`, rpcCalls);
      check(order.join('>') === 'profile', `${type} 미변경 저장은 profile만`, order);
    }
  }

  async function run() {
    window.alert = (message) => { out.errors.push(`ALERT:${String(message)}`); };
    await ensureCoreLoaded();
    const realCommit = window.olliCommitStudentRegistrationRouting;
    const realPrepare = window.olliPrepareStudentRegistrationRouting;
    const realRelease = window.olliReleaseStudentRegistrationRouting;

    await testModalMarkupAndHooks();
    await testNewStudent('elementary', '초등');
    await testNewStudent('kinder', '유치');

    window.olliCommitStudentRegistrationRouting = realCommit;
    window.olliPrepareStudentRegistrationRouting = realPrepare;
    window.olliReleaseStudentRegistrationRouting = realRelease;
    await testRealClassRoutingCommit(realCommit);

    await testExistingStudent('elementary', true);
    await testExistingStudent('elementary', false);
    await testExistingStudent('kinder', true);
    await testExistingStudent('kinder', false);

    check(!out.errors.some((x) => x.startsWith('ALERT:')), '회귀검사 중 사용자 경고 없음', out.errors);
    renderResult(true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(() => run().catch((error) => { out.errors.push(error.stack || error.message || String(error)); renderResult(false); }), 300), { once: true });
  } else {
    setTimeout(() => run().catch((error) => { out.errors.push(error.stack || error.message || String(error)); renderResult(false); }), 300);
  }
})();
