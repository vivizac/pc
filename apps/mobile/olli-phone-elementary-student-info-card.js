/* Phone elementary student-info card rebuilt from the current PC student-info card.
   Profile fields use the existing student Supabase save path.
   Weekday/time + homeroom teacher use the same authoritative timetable RPCs as PC. */
(function phoneElementaryStudentInfoCard(global) {
  'use strict';
  if (global.__OLLI_PHONE_ELEMENTARY_STUDENT_INFO_CARD_V1__) return;
  global.__OLLI_PHONE_ELEMENTARY_STUDENT_INFO_CARD_V1__ = true;

  const clean = (value) => String(value == null ? '' : value).trim();
  const esc = (value) => clean(value).replace(/[&<>"']/g, (ch) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[ch]);

  let activeStudentId = '';
  let saving = false;

  function targetStudent() {
    try {
      if (typeof getStudentInfoModalTarget === 'function') return getStudentInfoModalTarget('elementary');
    } catch (_) {}
    try {
      if (typeof studentInfoModalTarget !== 'undefined' && studentInfoModalTarget && studentInfoModalTarget.type === 'elementary') return studentInfoModalTarget;
    } catch (_) {}
    return null;
  }

  function installStyle() {
    if (document.getElementById('olliPhoneElementaryPcInfoStyle')) return;
    const style = document.createElement('style');
    style.id = 'olliPhoneElementaryPcInfoStyle';
    style.textContent = `
      #elementaryInfoModal.phonePcStudentInfoOverlay{position:fixed;inset:0;z-index:2147481200;display:none;align-items:flex-end;justify-content:center;padding:0;background:rgba(18,20,24,.24);box-sizing:border-box;backdrop-filter:blur(7px) saturate(1.03);-webkit-backdrop-filter:blur(7px) saturate(1.03);}
      #elementaryInfoModal .phonePcStudentInfoShell{width:100%;max-width:860px;height:calc(100vh - 75px);max-height:calc(100vh - 75px);overflow:auto;-webkit-overflow-scrolling:touch;background:#fff;border-radius:28px 28px 0 0;padding:14px 18px calc(20px + env(safe-area-inset-bottom, 0px));box-sizing:border-box;box-shadow:0 -18px 44px rgba(0,0,0,.13),0 -4px 14px rgba(0,0,0,.06);overscroll-behavior:contain;animation:olliStudentBottomSheetIn .24s cubic-bezier(.22,.61,.36,1) both;}
      #elementaryInfoModal .phonePcStudentInfoShell::before{content:'';display:block;width:42px;height:5px;border-radius:999px;background:#e5e5e5;margin:0 auto 16px;}
      #elementaryInfoModal .pcStudentInfoCard{width:100%;margin:0 auto;box-sizing:border-box;}
      #elementaryInfoModal .pcStudentInfoCardIntro{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin:0 0 16px;padding:0 1px 13px;border-bottom:1px solid #f0f1f3;}
      #elementaryInfoModal .pcStudentInfoCardIntro strong{font-size:17px;font-weight:820;color:#25282d;letter-spacing:-.035em;}
      #elementaryInfoModal .pcStudentInfoCardIntro span{font-size:10px;font-weight:600;color:#a0a5ad;text-align:right;line-height:1.3;}
      #elementaryInfoModal .pcStudentInfoForm{display:grid;gap:13px;}
      #elementaryInfoModal .pcStudentInfoGrid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;}
      #elementaryInfoModal .pcStudentInfoField{min-width:0;}
      #elementaryInfoModal .pcStudentInfoField .modalInput{width:100%;height:42px;min-width:0;border:1px solid #e4e6e9;border-radius:12px;background:#fff;padding:0 10px;font:inherit;font-size:13px;box-sizing:border-box;outline:none;color:#222;}
      #elementaryInfoModal .pcStudentInfoField .modalInput:focus{border-color:#b8d6f7;box-shadow:0 0 0 3px rgba(22,135,255,.06);}
      #elementaryInfoModal .pcStudentInfoField .modalInput[readonly]{background:#fafbfc;color:#666;}
      #elementaryInfoModal .pcStudentInfoTeacherReadonly{width:100%;height:42px;min-height:42px;border:1px solid #e4e6e9;border-radius:12px;background:#fff;padding:0 10px;box-sizing:border-box;display:flex;align-items:center;justify-content:flex-start;color:#222;font-size:13px;font-weight:400;text-align:left;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
      #elementaryInfoModal .pcStudentInfoTeacherReadonly.isEmpty{color:#aaa;font-weight:400;}
      #elementaryInfoModal .pcStudentInfoSchedule{padding:13px;border-radius:16px;background:#fafbfc;border:1px solid #eef0f3;}
      #elementaryInfoModal .pcStudentInfoScheduleTitle{margin:0 0 9px 1px;color:#686e76;font-size:11px;font-weight:760;letter-spacing:-.03em;}
      #elementaryInfoModal .infoDayToggleRow,#elementaryInfoModal .infoTimeToggleRow{display:flex;flex-wrap:wrap;gap:6px;width:100%;}
      #elementaryInfoModal .infoDayToggleRow{margin-bottom:8px;}
      #elementaryInfoModal .infoDayBtn,#elementaryInfoModal .infoTimeBtn{min-width:38px;height:34px;border:1px solid #e3e5e8;border-radius:10px;background:#fff;color:#555;font:inherit;font-size:12px;font-weight:700;padding:0 9px;box-sizing:border-box;}
      #elementaryInfoModal .infoDayBtn.active,#elementaryInfoModal .infoTimeBtn.active{background:#24272b;color:#fff;border-color:#24272b;}
      #elementaryInfoModal .infoDayBtn.activeDayForTime{box-shadow:0 0 0 2px rgba(36,39,43,.12);}
      #elementaryInfoModal .infoTimeHint{font-size:11px;color:#9aa0a7;padding:7px 2px;}
      #elementaryInfoModal #elementaryPersonalityToggleRow{min-height:42px;width:100%;}
      #elementaryInfoModal .phonePcPersonalityFallback{width:100%;height:42px;border:1px solid #e4e6e9;border-radius:12px;background:#fafbfc;display:flex;align-items:center;justify-content:center;padding:0 8px;box-sizing:border-box;color:#666;font-size:11.5px;font-weight:720;text-align:center;}
      #elementaryInfoModal .phonePcPersonalityFallback.isEmpty{color:#aaa;font-weight:600;}
      #elementaryInfoModal #elementaryGroupToggleRow{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px;}
      #elementaryInfoModal .infoToggleBtn.groupIconChoiceBtn{height:36px;border:0;border-radius:11px;background:#f0f2f4;color:#707780;font:inherit;font-size:11px;font-weight:720;padding:0;}
      #elementaryInfoModal .infoToggleBtn.groupIconChoiceBtn.active{background:#24272b;color:#fff;}
      #elementaryInfoModal .pcStudentInfoActions{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding-top:1px;}
      #elementaryInfoModal .pcStudentInfoActionBtn{height:44px;border:0;border-radius:13px;background:#f1f2f4;color:#4e535a;font:inherit;font-size:13px;font-weight:780;}
      #elementaryInfoModal .pcStudentInfoActionBtn.primary{background:#24272b;color:#fff;}
      #elementaryInfoModal .pcStudentInfoActionBtn:disabled{opacity:.55;}
      @media (max-width:390px){
        #elementaryInfoModal.phonePcStudentInfoOverlay{padding:0;}
        #elementaryInfoModal .phonePcStudentInfoShell{border-radius:26px 26px 0 0;padding:14px 16px calc(20px + env(safe-area-inset-bottom, 0px));}
        #elementaryInfoModal .pcStudentInfoGrid3{gap:6px;}
        #elementaryInfoModal .pcStudentInfoField .modalInput{padding:0 7px;font-size:12px;}
        #elementaryInfoModal .pcStudentInfoTeacherReadonly{padding:0 7px;font-size:12px;}
        #elementaryInfoModal #elementaryGroupToggleRow{gap:4px;}
      }
    `;
    document.head.appendChild(style);
  }

  function renderGroupButtons() {
    return ['1','2','3','4','5','6'].map((group, i) =>
      `<button type="button" class="infoToggleBtn groupIconChoiceBtn" data-group="${group}" onclick="selectElementaryGroup('${group}')">${String.fromCharCode(65 + i)}</button>`
    ).join('');
  }

  function cardHtml(student) {
    return `<div class="phonePcStudentInfoShell" onclick="event.stopPropagation()"><div class="pcStudentInfoCard" data-division="elementary" data-source="pc-student-info-card">
      <div class="pcStudentInfoCardIntro"><strong>${esc(student && student.name || '학생')} 학생정보</strong><span>요일·시간은 시간표 기준으로 저장됩니다.</span></div>
      <div class="pcStudentInfoForm">
        <div class="pcStudentInfoGrid3">
          <div class="pcStudentInfoField"><input class="modalInput" id="elementaryInfoNameInput" placeholder="학생이름"></div>
          <div class="pcStudentInfoField"><div id="elementaryPersonalityToggleRow" class="infoTeacherToggleRow infoPersonalityToggleRow"></div></div>
          <div class="pcStudentInfoField"><div id="elementaryInfoTeacherReadonly" class="pcStudentInfoTeacherReadonly isEmpty">담임</div></div>
        </div>
        <div class="pcStudentInfoGrid3">
          <div class="pcStudentInfoField"><input class="modalInput" id="elementarySchoolInput" placeholder="학교"></div>
          <div class="pcStudentInfoField"><input class="modalInput" id="elementaryGradeInput" inputmode="numeric" placeholder="학년" onfocus="if(window.focusElementaryGradeInput) focusElementaryGradeInput(this)" oninput="if(window.syncElementaryInfoAgeFromGrade) syncElementaryInfoAgeFromGrade()" onblur="if(window.blurElementaryInfoGradeInput) blurElementaryInfoGradeInput()"></div>
          <div class="pcStudentInfoField"><input class="modalInput" id="elementaryAgeInput" placeholder="나이" readonly></div>
        </div>
        <div class="pcStudentInfoGrid3">
          <div class="pcStudentInfoField"><input class="modalInput" id="elementaryInfoYearInput" type="number" min="1900" max="2100" placeholder="등록년"></div>
          <div class="pcStudentInfoField"><input class="modalInput" id="elementaryInfoMonthInput" type="number" min="1" max="12" placeholder="월"></div>
          <div class="pcStudentInfoField"><input class="modalInput" id="elementaryInfoDayInput" type="number" min="1" max="31" placeholder="일"></div>
        </div>
        <div class="pcStudentInfoSchedule"><div class="olliPhoneScheduleEmpty">시간표에서 불러오는 중...</div></div>
        <div class="pcStudentInfoField"><div class="modalLabel">그룹</div><div id="elementaryGroupToggleRow" class="infoToggleRow">${renderGroupButtons()}</div></div>
        <div class="pcStudentInfoActions"><button type="button" class="pcStudentInfoActionBtn" onclick="closeElementaryInfoModal()">취소</button><button type="button" class="pcStudentInfoActionBtn primary" id="phoneElementaryInfoSaveBtn" onclick="saveElementaryInfo()">저장</button></div>
      </div>
    </div></div>`;
  }

  function ensureModal(student) {
    installStyle();
    let modal = document.getElementById('elementaryInfoModal');
    if (!modal || modal.dataset.pcStudentInfoPort !== '1') {
      if (modal) modal.remove();
      modal = document.createElement('div');
      modal.id = 'elementaryInfoModal';
      modal.className = 'modalOverlay phonePcStudentInfoOverlay';
      modal.dataset.pcStudentInfoPort = '1';
      modal.addEventListener('click', function(event) {
        if (event.target === modal) global.closeElementaryInfoModal();
      });
      document.body.appendChild(modal);
    }
    modal.innerHTML = cardHtml(student || {});
    return modal;
  }

  function setDate(student) {
    const raw = clean(student && student.enrolled_at);
    const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    const values = match
      ? [match[1], String(Number(match[2])), String(Number(match[3]))]
      : [student && student.year || '', student && student.month || '', student && student.day || ''];
    ['elementaryInfoYearInput','elementaryInfoMonthInput','elementaryInfoDayInput'].forEach((id, i) => {
      const el = document.getElementById(id);
      if (el) el.value = values[i] || '';
    });
  }

  function readDate() {
    const year = Number(document.getElementById('elementaryInfoYearInput')?.value || 0);
    const month = Number(document.getElementById('elementaryInfoMonthInput')?.value || 0);
    const day = Number(document.getElementById('elementaryInfoDayInput')?.value || 0);
    if (!year || !month || !day) throw new Error('등록 날짜를 확인해 주세요.');
    const test = new Date(year, month - 1, day);
    if (test.getFullYear() !== year || test.getMonth() !== month - 1 || test.getDate() !== day) throw new Error('등록 날짜를 확인해 주세요.');
    return { year, month: String(month), day: String(day), enrolled_at: `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}` };
  }

  function renderPersonality(student) {
    try {
      if (typeof global.refreshStudentModalPersonalityDropdowns === 'function') global.refreshStudentModalPersonalityDropdowns();
    } catch (_) {}
    try {
      if (typeof syncElementaryInfoButtons === 'function') syncElementaryInfoButtons();
    } catch (_) {}
    const row = document.getElementById('elementaryPersonalityToggleRow');
    if (!row || row.children.length) return;
    const value = clean(student && student.personality);
    row.innerHTML = `<div class="phonePcPersonalityFallback ${value ? '' : 'isEmpty'}">${esc(value || '미지정')}</div>`;
  }

  function syncAgeFromGradeNow(student) {
    const gradeInput = document.getElementById('elementaryGradeInput');
    const ageInput = document.getElementById('elementaryAgeInput');
    if (!gradeInput || !ageInput) return;
    const normalized = typeof global.normalizeElementaryGradeValue === 'function'
      ? global.normalizeElementaryGradeValue(gradeInput.value || '')
      : clean(gradeInput.value);
    const age = typeof global.getElementaryAgeFromGrade === 'function'
      ? global.getElementaryAgeFromGrade(normalized)
      : (student && student.age || '');
    ageInput.value = typeof global.formatElementaryAgeInputValue === 'function'
      ? global.formatElementaryAgeInputValue(age || '')
      : (age || '');
  }

  function applyStudentProfile(student) {
    if (!student) return;
    try {
      elementaryInfoDraft = { group: student.group || '', personality: student.personality || '' };
    } catch (_) {}
    const name = document.getElementById('elementaryInfoNameInput');
    const school = document.getElementById('elementarySchoolInput');
    const grade = document.getElementById('elementaryGradeInput');
    if (name) name.value = student.name || '';
    if (school) school.value = student.school || '';
    if (grade) grade.value = typeof global.formatElementaryGradeInputValue === 'function'
      ? global.formatElementaryGradeInputValue(student.grade)
      : (student.grade || '');
    syncAgeFromGradeNow(student);
    setDate(student);
    renderPersonality(student);
  }

  async function openElementaryInfoModal() {
    const student = targetStudent();
    if (!student) return;
    activeStudentId = clean(student.id);
    if (typeof global.olliStudentInfoResetDirty === 'function') global.olliStudentInfoResetDirty();
    const modal = ensureModal(student);

    try {
      elementaryInfoDraft = {
        group: student.group || '',
        personality: student.personality || ''
      };
    } catch (_) {}

    const name = document.getElementById('elementaryInfoNameInput');
    const school = document.getElementById('elementarySchoolInput');
    const grade = document.getElementById('elementaryGradeInput');
    if (name) name.value = student.name || '';
    if (school) school.value = student.school || '';
    if (grade) grade.value = typeof global.formatElementaryGradeInputValue === 'function'
      ? global.formatElementaryGradeInputValue(student.grade)
      : (student.grade || '');
    syncAgeFromGradeNow(student);
    setDate(student);

    modal.style.display = 'flex';
    document.body.classList.add('olliStudentInfoModalOpen');

    if (typeof global.olliPrepareInfoExtra === 'function') {
      try { global.olliPrepareInfoExtra('elementary', student); } catch (_) {}
    }
    renderPersonality(student);

    const renderedLocalSchedule = typeof global.phoneStudentInfoRenderLocal === 'function'
      ? global.phoneStudentInfoRenderLocal(student, 'elementary')
      : false;
    if (!renderedLocalSchedule && typeof global.olliSetPhoneInfoScheduleLoading === 'function') {
      try { global.olliSetPhoneInfoScheduleLoading('elementary'); } catch (_) {}
    }

    if (typeof global.phoneStudentInfoRefreshAuthoritative === 'function') {
      try {
        const context = await global.phoneStudentInfoRefreshAuthoritative(student, 'elementary');
        if (clean(activeStudentId) !== clean(student.id) || modal.style.display !== 'flex') return context;
        const current = targetStudent() || student;
        renderPersonality(current);
        return context;
      } catch (error) {
        console.warn('초등부 학생정보 PC 원본 연결 실패:', error && (error.message || error));
      }
    }
    return null;
  }

  function closeElementaryInfoModal() {
    activeStudentId = '';
    if (typeof global.olliStudentInfoResetDirty === 'function') global.olliStudentInfoResetDirty();
    if (typeof global.phoneStudentInfoCancelAuthoritative === 'function') {
      try { global.phoneStudentInfoCancelAuthoritative('elementary'); } catch (_) {}
    }
    const modal = document.getElementById('elementaryInfoModal');
    if (modal) modal.style.display = 'none';
    document.body.classList.remove('olliStudentInfoModalOpen');
    try { studentInfoModalTarget = null; } catch (_) {}
  }

  async function saveElementaryInfo() {
    if (saving) return false;
    const originalTarget = targetStudent();
    if (!originalTarget) return false;

    const name = clean(document.getElementById('elementaryInfoNameInput')?.value);
    if (!name) { alert('학생 이름을 입력해 주세요.'); return false; }

    const originalName = clean(originalTarget.name);
    try {
      const duplicate = name !== originalName
        && typeof getStudentsByType === 'function'
        && getStudentsByType('elementary').some((student) => clean(student && student.id) !== clean(originalTarget.id) && clean(student && student.name) === name);
      if (duplicate) { alert('이미 등록된 학생 이름입니다.'); return false; }
    } catch (_) {}

    const saveBtn = document.getElementById('phoneElementaryInfoSaveBtn');
    saving = true;
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '저장 중...'; }

    try {
      const dateInfo = readDate();
      const latestTarget = targetStudent() || originalTarget;
      const gradeRaw = document.getElementById('elementaryGradeInput')?.value || '';
      const grade = typeof global.normalizeElementaryGradeValue === 'function'
        ? global.normalizeElementaryGradeValue(gradeRaw)
        : clean(gradeRaw);
      const age = typeof global.getElementaryAgeFromGrade === 'function'
        ? global.getElementaryAgeFromGrade(grade)
        : (latestTarget.age || '');

      const profileBase = Object.assign({}, latestTarget);
      delete profileBase.__olli_timetable_teacher;
      delete profileBase.__olli_authoritative_enrollments;
      delete profileBase.__olli_authoritative_pickups;

      const group = (typeof elementaryInfoDraft !== 'undefined' && elementaryInfoDraft)
        ? (elementaryInfoDraft.group || '')
        : (latestTarget.group || '');
      const personality = (typeof elementaryInfoDraft !== 'undefined' && elementaryInfoDraft)
        ? (elementaryInfoDraft.personality || '')
        : (latestTarget.personality || '');

      const profile = Object.assign({}, profileBase, dateInfo, {
        name,
        group,
        personality,
        school: clean(document.getElementById('elementarySchoolInput')?.value),
        grade,
        age,
        birth_year: '',
        school_entry_year: typeof global.inferOlliSchoolEntryYearFromGrade === 'function'
          ? global.inferOlliSchoolEntryYearFromGrade(grade)
          : (latestTarget.school_entry_year || ''),
        className: '',
        lesson_day: latestTarget.lesson_day || '',
        lesson_time: latestTarget.lesson_time || latestTarget.class_time || '',
        class_time: latestTarget.lesson_time || latestTarget.class_time || ''
      });

      if (typeof global.elementaryGroupMonthsToText === 'function' && typeof global.getElementaryGroupFeedbackMonths === 'function') {
        const months = global.elementaryGroupMonthsToText(global.getElementaryGroupFeedbackMonths(group, latestTarget));
        profile.group_months = months;
        profile.feedback_months = months;
      }

      if (typeof global.ensureStudentSavedToSupabase !== 'function') throw new Error('학생정보 저장 기능을 찾지 못했습니다.');

      const saved = await global.ensureStudentSavedToSupabase(profile, { requireServer: true });

      if (typeof global.loadStudentsFromSupabase === 'function') await global.loadStudentsFromSupabase({ skipLifecycleSync: true });
      const refreshed = typeof global.findStudentById === 'function' ? (global.findStudentById(saved.id) || saved) : saved;
      try {
        if (currentMemoStudent && clean(currentMemoStudent.id) === clean(saved.id)) {
          currentMemoStudent = refreshed;
          if (typeof setMemoModePillLabel === 'function') setMemoModePillLabel(refreshed.name || '학생 이름');
          const memoSubLabel = document.getElementById('memoSubLabel');
          if (memoSubLabel) memoSubLabel.textContent = '학생분석 메모';
        }
      } catch (_) {}

      global.closeElementaryInfoModal();
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

  global.olliPhoneElementaryApplyStudentProfile = applyStudentProfile;
  global.openElementaryInfoModal = openElementaryInfoModal;
  global.closeElementaryInfoModal = closeElementaryInfoModal;
  global.saveElementaryInfo = saveElementaryInfo;

  installStyle();
})(window);
