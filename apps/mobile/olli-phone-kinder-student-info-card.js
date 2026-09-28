/* Phone kindergarten student info card ported from the current PC student-info card.
   Profile fields use the existing student Supabase save path.
   Weekday/time + homeroom teacher use the same authoritative timetable RPCs as PC. */
(function phoneKinderStudentInfoCard(global) {
  'use strict';
  if (global.__OLLI_PHONE_KINDER_STUDENT_INFO_CARD_V1__) return;
  global.__OLLI_PHONE_KINDER_STUDENT_INFO_CARD_V1__ = true;

  const clean = (value) => String(value == null ? '' : value).trim();
  const esc = (value) => clean(value).replace(/[&<>"']/g, (ch) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[ch]);

  let activeStudentId = '';
  let saving = false;

  function targetStudent() {
    try {
      if (typeof getStudentInfoModalTarget === 'function') return getStudentInfoModalTarget('kinder');
    } catch (_) {}
    try {
      if (typeof studentInfoModalTarget !== 'undefined' && studentInfoModalTarget && studentInfoModalTarget.type === 'kinder') return studentInfoModalTarget;
    } catch (_) {}
    return null;
  }

  function installStyle() {
    if (document.getElementById('olliPhoneKinderPcInfoStyle')) return;
    const style = document.createElement('style');
    style.id = 'olliPhoneKinderPcInfoStyle';
    style.textContent = `
      #kinderInfoModal.phonePcStudentInfoOverlay{position:fixed;inset:0;z-index:2147481200;display:none;align-items:flex-end;justify-content:center;padding:0;background:rgba(18,20,24,.24);box-sizing:border-box;backdrop-filter:blur(7px) saturate(1.03);-webkit-backdrop-filter:blur(7px) saturate(1.03);}
      #kinderInfoModal .phonePcStudentInfoShell{width:100%;max-width:860px;height:calc(100vh - 75px);max-height:calc(100vh - 75px);overflow:auto;-webkit-overflow-scrolling:touch;background:#fff;border-radius:28px 28px 0 0;padding:14px 18px calc(20px + env(safe-area-inset-bottom, 0px));box-sizing:border-box;box-shadow:0 -18px 44px rgba(0,0,0,.13),0 -4px 14px rgba(0,0,0,.06);overscroll-behavior:contain;animation:olliStudentBottomSheetIn .24s cubic-bezier(.22,.61,.36,1) both;}
      #kinderInfoModal .phonePcStudentInfoShell::before{content:'';display:block;width:42px;height:5px;border-radius:999px;background:#e5e5e5;margin:0 auto 16px;}
      #kinderInfoModal .pcStudentInfoCard{width:100%;margin:0 auto;box-sizing:border-box;}
      #kinderInfoModal .pcStudentInfoCardIntro{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin:0 0 16px;padding:0 1px 13px;border-bottom:1px solid #f0f1f3;}
      #kinderInfoModal .pcStudentInfoCardIntro strong{font-size:17px;font-weight:820;color:#25282d;letter-spacing:-.035em;}
      #kinderInfoModal .pcStudentInfoCardIntro span{font-size:10px;font-weight:600;color:#a0a5ad;text-align:right;line-height:1.3;}
      #kinderInfoModal .pcStudentInfoForm{display:grid;gap:13px;}
      #kinderInfoModal .pcStudentInfoGrid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;}
      #kinderInfoModal .pcStudentInfoGrid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;}
      #kinderInfoModal .pcStudentInfoField{min-width:0;}
      #kinderInfoModal .pcStudentInfoField .modalInput{width:100%;height:42px;min-width:0;border:1px solid #e4e6e9;border-radius:12px;background:#fff;padding:0 10px;font:inherit;font-size:13px;box-sizing:border-box;outline:none;color:#222;}
      #kinderInfoModal .pcStudentInfoField .modalInput:focus{border-color:#b8d6f7;box-shadow:0 0 0 3px rgba(22,135,255,.06);}
      #kinderInfoModal .pcStudentInfoTeacherReadonly{width:100%;height:42px;min-height:42px;border:1px solid #e4e6e9;border-radius:12px;background:#fff;padding:0 10px;box-sizing:border-box;display:flex;align-items:center;justify-content:flex-start;color:#222;font-size:13px;font-weight:400;text-align:left;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
      #kinderInfoModal .pcStudentInfoTeacherReadonly.isEmpty{color:#aaa;font-weight:400;}
      #kinderInfoModal .pcStudentInfoSchedule{padding:13px;border-radius:16px;background:#fafbfc;border:1px solid #eef0f3;}
      #kinderInfoModal .pcStudentInfoScheduleTitle{margin:0 0 9px 1px;color:#686e76;font-size:11px;font-weight:760;letter-spacing:-.03em;}
      #kinderInfoModal .infoDayToggleRow,#kinderInfoModal .infoTimeToggleRow{display:flex;flex-wrap:wrap;gap:6px;width:100%;}
      #kinderInfoModal .infoDayToggleRow{margin-bottom:8px;}
      #kinderInfoModal .infoDayBtn,#kinderInfoModal .infoTimeBtn{min-width:38px;height:34px;border:1px solid #e3e5e8;border-radius:10px;background:#fff;color:#555;font:inherit;font-size:12px;font-weight:700;padding:0 9px;box-sizing:border-box;}
      #kinderInfoModal .infoDayBtn.active,#kinderInfoModal .infoTimeBtn.active{background:#24272b;color:#fff;border-color:#24272b;}
      #kinderInfoModal .infoDayBtn.activeDayForTime{box-shadow:0 0 0 2px rgba(36,39,43,.12);}
      #kinderInfoModal .infoTimeHint{font-size:11px;color:#9aa0a7;padding:7px 2px;}
      #kinderInfoModal #kinderPersonalityToggleRow{min-height:42px;width:100%;}
      #kinderInfoModal .phonePcPersonalityFallback{width:100%;height:42px;border:1px solid #e4e6e9;border-radius:12px;background:#fafbfc;display:flex;align-items:center;justify-content:center;padding:0 8px;box-sizing:border-box;color:#666;font-size:11.5px;font-weight:720;text-align:center;}
      #kinderInfoModal .phonePcPersonalityFallback.isEmpty{color:#aaa;font-weight:600;}
      #kinderInfoModal .pcStudentInfoActions{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding-top:1px;}
      #kinderInfoModal .pcStudentInfoActionBtn{height:44px;border:0;border-radius:13px;background:#f1f2f4;color:#4e535a;font:inherit;font-size:13px;font-weight:780;}
      #kinderInfoModal .pcStudentInfoActionBtn.primary{background:#24272b;color:#fff;}
      #kinderInfoModal .pcStudentInfoActionBtn:disabled{opacity:.55;}
      @media (max-width:390px){
        #kinderInfoModal.phonePcStudentInfoOverlay{padding:0;}
        #kinderInfoModal .phonePcStudentInfoShell{border-radius:26px 26px 0 0;padding:14px 16px calc(20px + env(safe-area-inset-bottom, 0px));}
        #kinderInfoModal .pcStudentInfoGrid3{gap:6px;}
        #kinderInfoModal .pcStudentInfoField .modalInput{padding:0 7px;font-size:12px;}
        #kinderInfoModal .pcStudentInfoTeacherReadonly{padding:0 7px;font-size:12px;}
      }
    `;
    document.head.appendChild(style);
  }

  function cardHtml(student) {
    return `<div class="phonePcStudentInfoShell" onclick="event.stopPropagation()"><div class="pcStudentInfoCard" data-division="kinder" data-source="pc-student-info-card">
      <div class="pcStudentInfoCardIntro"><strong>${esc(student && student.name || '학생')} 학생정보</strong><span>요일·시간은 시간표 기준으로 저장됩니다.</span></div>
      <div class="pcStudentInfoForm">
        <div class="pcStudentInfoGrid3">
          <div class="pcStudentInfoField"><input class="modalInput" id="kinderInfoNameInput" placeholder="학생이름"></div>
          <div class="pcStudentInfoField"><div id="kinderPersonalityToggleRow" class="infoTeacherToggleRow infoPersonalityToggleRow"></div></div>
          <div class="pcStudentInfoField"><div id="kinderInfoTeacherReadonly" class="pcStudentInfoTeacherReadonly isEmpty">담임</div></div>
        </div>
        <div class="pcStudentInfoGrid2">
          <div class="pcStudentInfoField"><input class="modalInput" id="kinderKindergartenInput" placeholder="유치원"></div>
          <div class="pcStudentInfoField"><input class="modalInput" id="kinderAgeInput" type="number" min="1" max="8" placeholder="나이"></div>
        </div>
        <div class="pcStudentInfoGrid3">
          <div class="pcStudentInfoField"><input class="modalInput" id="kinderInfoYearInput" type="number" min="1900" max="2100" placeholder="등록년"></div>
          <div class="pcStudentInfoField"><input class="modalInput" id="kinderInfoMonthInput" type="number" min="1" max="12" placeholder="월"></div>
          <div class="pcStudentInfoField"><input class="modalInput" id="kinderInfoDayInput" type="number" min="1" max="31" placeholder="일"></div>
        </div>
        <div class="pcStudentInfoSchedule"><div class="olliPhoneScheduleEmpty">시간표에서 불러오는 중...</div></div>
        <div class="pcStudentInfoField"><div class="modalLabel">픽업</div><div id="kinderInfoPickupReadonly" class="pcStudentInfoTeacherReadonly isEmpty">등록된 픽업 없음</div></div>
        <div class="pcStudentInfoActions"><button type="button" class="pcStudentInfoActionBtn" onclick="closeKinderInfoModal()">취소</button><button type="button" class="pcStudentInfoActionBtn primary" id="phoneKinderInfoSaveBtn" onclick="saveKinderInfo()">저장</button></div>
      </div>
    </div></div>`;
  }

  function ensureModal(student) {
    installStyle();
    let modal = document.getElementById('kinderInfoModal');
    if (!modal || modal.dataset.pcStudentInfoPort !== '1') {
      if (modal) modal.remove();
      modal = document.createElement('div');
      modal.id = 'kinderInfoModal';
      modal.className = 'modalOverlay phonePcStudentInfoOverlay';
      modal.dataset.pcStudentInfoPort = '1';
      modal.addEventListener('click', function(event) {
        if (event.target === modal) global.closeKinderInfoModal();
      });
      document.body.appendChild(modal);
    }
    modal.innerHTML = cardHtml(student || {});
    return modal;
  }

  function setDate(student) {
    try {
      if (typeof setStudentInfoDateInput === 'function') {
        setStudentInfoDateInput('kinderInfoEnrolledAtInput', student || {});
        return;
      }
    } catch (_) {}
    const raw = clean(student && student.enrolled_at);
    const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    const values = match ? [match[1], String(Number(match[2])), String(Number(match[3]))] : [student && student.year || '', student && student.month || '', student && student.day || ''];
    const ids = ['kinderInfoYearInput','kinderInfoMonthInput','kinderInfoDayInput'];
    ids.forEach((id, i) => { const el = document.getElementById(id); if (el) el.value = values[i] || ''; });
  }

  function readDate(student) {
    try {
      if (typeof readStudentInfoDateInput === 'function') {
        const value = readStudentInfoDateInput('kinderInfoEnrolledAtInput', student || {});
        if (value) return value;
      }
    } catch (_) {}
    const year = Number(document.getElementById('kinderInfoYearInput')?.value || 0);
    const month = Number(document.getElementById('kinderInfoMonthInput')?.value || 0);
    const day = Number(document.getElementById('kinderInfoDayInput')?.value || 0);
    if (!year || !month || !day) throw new Error('등록 날짜를 확인해 주세요.');
    const test = new Date(year, month - 1, day);
    if (test.getFullYear() !== year || test.getMonth() !== month - 1 || test.getDate() !== day) throw new Error('등록 날짜를 확인해 주세요.');
    return { year, month: String(month), day: String(day), enrolled_at: `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}` };
  }

  function renderPersonalityFallback(student) {
    const row = document.getElementById('kinderPersonalityToggleRow');
    if (!row || row.children.length) return;
    const value = clean(student && student.personality);
    row.innerHTML = `<div class="phonePcPersonalityFallback ${value ? '' : 'isEmpty'}">${esc(value || '미지정')}</div>`;
  }

  function applyStudentProfile(student) {
    if (!student) return;
    const name = document.getElementById('kinderInfoNameInput');
    const kindergarten = document.getElementById('kinderKindergartenInput');
    const age = document.getElementById('kinderAgeInput');
    if (name) name.value = student.name || '';
    if (kindergarten) kindergarten.value = student.kindergarten || '';
    if (age) age.value = student.age || '';
    setDate(student);
    renderPersonalityFallback(student);
  }

  async function openKinderInfoModal() {
    const student = targetStudent();
    if (!student) return;
    activeStudentId = clean(student.id);
    if (typeof global.olliStudentInfoResetDirty === 'function') global.olliStudentInfoResetDirty();
    const modal = ensureModal(student);
    document.getElementById('kinderInfoNameInput').value = student.name || '';
    document.getElementById('kinderKindergartenInput').value = student.kindergarten || '';
    document.getElementById('kinderAgeInput').value = student.age || '';
    setDate(student);
    const hiddenDay = document.getElementById('kinderLessonDayInput');
    if (hiddenDay) hiddenDay.value = student.lesson_day || '';
    modal.style.display = 'flex';
    document.body.classList.add('olliStudentInfoModalOpen');

    if (typeof global.olliPrepareInfoExtra === 'function') {
      try { global.olliPrepareInfoExtra('kinder', student); } catch (_) {}
    }
    renderPersonalityFallback(student);

    const renderedLocalSchedule = typeof global.phoneStudentInfoRenderLocal === 'function'
      ? global.phoneStudentInfoRenderLocal(student, 'kinder')
      : false;
    if (!renderedLocalSchedule && typeof global.olliSetPhoneInfoScheduleLoading === 'function') {
      try { global.olliSetPhoneInfoScheduleLoading('kinder'); } catch (_) {}
    }
    if (typeof global.phoneStudentInfoRefreshAuthoritative === 'function') {
      try {
        const context = await global.phoneStudentInfoRefreshAuthoritative(student, 'kinder');
        if (clean(activeStudentId) !== clean(student.id) || modal.style.display !== 'flex') return;
        const current = targetStudent() || student;
        renderPersonalityFallback(current);
        return context;
      } catch (error) {
        console.warn('유치부 학생정보 PC 원본 연결 실패:', error && (error.message || error));
      }
    }
  }

  function closeKinderInfoModal() {
    activeStudentId = '';
    if (typeof global.olliStudentInfoResetDirty === 'function') global.olliStudentInfoResetDirty();
    if (typeof global.phoneStudentInfoCancelAuthoritative === 'function') {
      try { global.phoneStudentInfoCancelAuthoritative('kinder'); } catch (_) {}
    }
    const modal = document.getElementById('kinderInfoModal');
    if (modal) modal.style.display = 'none';
    document.body.classList.remove('olliStudentInfoModalOpen');
    try { studentInfoModalTarget = null; } catch (_) {}
  }

  async function saveKinderInfo() {
    if (saving) return false;
    const originalTarget = targetStudent();
    if (!originalTarget) return false;
    const name = clean(document.getElementById('kinderInfoNameInput')?.value);
    if (!name) { alert('학생 이름을 입력해 주세요.'); return false; }

    const originalName = clean(originalTarget.name);
    try {
      const duplicate = name !== originalName && typeof getStudentsByType === 'function' && getStudentsByType('kinder').some((student) => clean(student && student.id) !== clean(originalTarget.id) && clean(student && student.name) === name);
      if (duplicate) { alert('이미 등록된 학생 이름입니다.'); return false; }
    } catch (_) {}

    const saveBtn = document.getElementById('phoneKinderInfoSaveBtn');
    saving = true;
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '저장 중...'; }
    try {
      const dateInfo = readDate(originalTarget);
      const latestTarget = targetStudent() || originalTarget;
      let extra = {};
      if (typeof global.phoneStudentInfoGetExtra === 'function') {
        try { extra = global.phoneStudentInfoGetExtra('kinder') || {}; } catch (_) {}
      } else if (typeof global.olliGetInfoExtra === 'function') {
        try { extra = global.olliGetInfoExtra('kinder') || {}; } catch (_) {}
      }

      const profileBase = Object.assign({}, latestTarget);
      delete profileBase.__olli_timetable_teacher;
      delete profileBase.__olli_authoritative_enrollments;
      delete profileBase.__olli_authoritative_pickups;
      const age = clean(document.getElementById('kinderAgeInput')?.value);
      const profile = Object.assign({}, profileBase, dateInfo, {
        name,
        kindergarten: clean(document.getElementById('kinderKindergartenInput')?.value),
        age,
        birth_year: typeof global.inferOlliBirthYearFromAge === 'function' ? global.inferOlliBirthYearFromAge(age) : (latestTarget.birth_year || ''),
        personality: Object.prototype.hasOwnProperty.call(extra, 'personality') ? extra.personality : (latestTarget.personality || ''),
        lesson_day: latestTarget.lesson_day || '',
        lesson_time: latestTarget.lesson_time || latestTarget.class_time || '',
        class_time: latestTarget.lesson_time || latestTarget.class_time || ''
      });

      if (typeof global.ensureStudentSavedToSupabase !== 'function') throw new Error('학생정보 저장 기능을 찾지 못했습니다.');

      const saved = await global.ensureStudentSavedToSupabase(profile, { requireServer: true });
      if (typeof global.loadStudentsFromSupabase === 'function') await global.loadStudentsFromSupabase({ skipLifecycleSync: true });
      const refreshed = typeof global.findStudentById === 'function' ? (global.findStudentById(saved.id) || saved) : saved;
      try {
        if (currentMemoStudent && clean(currentMemoStudent.id) === clean(saved.id)) currentMemoStudent = refreshed;
      } catch (_) {}
      global.closeKinderInfoModal();
      if (typeof global.loadRecords === 'function') await global.loadRecords('');
      return true;
    } catch (error) {
      alert(`학생 정보 저장에 실패했어요.\n\n${error && (error.message || error) || '알 수 없는 오류입니다.'}`);
      return false;
    } finally {
      saving = false;
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '저장'; }
    }
  }

  global.olliPhoneKinderApplyStudentProfile = applyStudentProfile;
  global.openKinderInfoModal = openKinderInfoModal;
  global.closeKinderInfoModal = closeKinderInfoModal;
  global.saveKinderInfo = saveKinderInfo;

  installStyle();
})(window);
