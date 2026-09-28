/* Phone student timetable editor inside the existing student-info modal.
   The timetable remains authoritative. Students choose classes; class teachers are read-only. */
(function phoneStudentScheduleEditor(global) {
  'use strict';
  if (global.__OLLI_PHONE_STUDENT_SCHEDULE_EDITOR_V1__) return;
  global.__OLLI_PHONE_STUDENT_SCHEDULE_EDITOR_V1__ = true;

  const DAYS = ['월','화','수','목','금','토'];
  const STYLE_ID = 'olliPhoneStudentScheduleEditorStyle';
  const states = {
    elementary: makeState('elementary'),
    kinder: makeState('kinder')
  };

  function makeState(division) {
    return {
      division,
      studentId: '',
      student: null,
      studentContext: null,
      mode: 'info',
      current: [],
      selected: [],
      options: [],
      weekData: null,
      effectiveDate: todayKey(),
      loading: false,
      showingLocal: false,
      loadError: '',
      saving: false,
      loadToken: 0,
      summaryToken: 0,
      summaryStudentId: ''
    };
  }

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function esc(value) {
    return clean(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }
  function parseDateKey(value) {
    const m = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
    return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2])-1 && d.getDate() === Number(m[3]) ? d : null;
  }
  function mondayKey(value) {
    const date = parseDateKey(value) || new Date();
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - day + 1);
    return dateKey(date);
  }
  function dayLabel(weekday) { return DAYS[Number(weekday)-1] || ''; }
  function groupValue(value) { return clean(value).toUpperCase() === 'B' ? 'B' : 'A'; }
  function classKey(item) { return `${Number(item.weekday)}|${Number(item.time_slot)}|${groupValue(item.class_group)}`; }
  function timeKey(item) { return `${Number(item.weekday)}|${Number(item.time_slot)}`; }
  function teacherLabel(value) {
    const name = clean(value);
    if (!name) return '';
    if (typeof global.formatTeacherNameWithT === 'function') return global.formatTeacherNameWithT(name);
    return /T$/i.test(name) ? name : `${name}T`;
  }
  function currentTarget(division) {
    try {
      if (typeof global.getStudentInfoModalTarget === 'function') {
        const target = global.getStudentInfoModalTarget(division);
        if (target && clean(target.id)) return target;
      }
    } catch (_) {}
    try {
      if (typeof studentInfoModalTarget !== 'undefined' && studentInfoModalTarget && clean(studentInfoModalTarget.id)) return studentInfoModalTarget;
    } catch (_) {}
    return null;
  }
  function modalFor(division) { return document.getElementById(division === 'kinder' ? 'kinderInfoModal' : 'elementaryInfoModal'); }
  function cardFor(division) { return modalFor(division)?.querySelector('.pcStudentInfoCard') || null; }
  function scheduleBoxFor(division) { return modalFor(division)?.querySelector('.pcStudentInfoSchedule') || null; }
  function stateFor(division) { return states[division === 'kinder' ? 'kinder' : 'elementary']; }
  function isModalOpen(division) {
    const modal = modalFor(division);
    return !!modal && modal.style.display === 'flex';
  }
  function notify(message) {
    if (typeof global.showPushToast === 'function') global.showPushToast(message);
    else alert(message);
  }

  function closeStudentInfoModal(division) {
    const state = states[division];
    state.loadToken += 1;
    state.loading = false;
    state.showingLocal = false;
    state.loadError = '';
    state.mode = 'info';
    state.summaryStudentId = '';
    const closeFn = division === 'kinder' ? global.closeKinderInfoModal : global.closeElementaryInfoModal;
    if (typeof closeFn === 'function') {
      closeFn();
      return;
    }
    const modal = modalFor(division);
    if (modal) modal.style.display = 'none';
    document.body.classList.remove('olliStudentInfoModalOpen');
  }

  function scheduleService() {
    const service = global.OlliPhoneStudentScheduleService;
    if (!service) throw new Error('학생 시간표 서비스를 찾지 못했습니다.');
    return service;
  }

  async function rpc(name, payload) {
    return scheduleService().request(name, payload || {});
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #elementaryInfoModal .olliPhoneInfoTabs,#kinderInfoModal .olliPhoneInfoTabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin:0 0 14px;padding:4px;border-radius:13px;background:#f1f2f4;}
      #elementaryInfoModal .olliPhoneInfoTab,#kinderInfoModal .olliPhoneInfoTab{height:36px;border:0;border-radius:10px;background:transparent;color:#858b93;font:inherit;font-size:12px;font-weight:760;letter-spacing:-.03em;}
      #elementaryInfoModal .olliPhoneInfoTab.active,#kinderInfoModal .olliPhoneInfoTab.active{background:#fff;color:#222;box-shadow:0 1px 5px rgba(0,0,0,.08);}
      #elementaryInfoModal .olliPhoneScheduleEditor,#kinderInfoModal .olliPhoneScheduleEditor{display:none;}
      #elementaryInfoModal .pcStudentInfoCard.olliPhoneScheduleMode .pcStudentInfoForm,#kinderInfoModal .pcStudentInfoCard.olliPhoneScheduleMode .pcStudentInfoForm{display:none;}
      #elementaryInfoModal .pcStudentInfoCard.olliPhoneScheduleMode,#kinderInfoModal .pcStudentInfoCard.olliPhoneScheduleMode{height:calc(100% - 21px);display:flex;flex-direction:column;min-height:0;}
      #elementaryInfoModal .pcStudentInfoCard.olliPhoneScheduleMode .olliPhoneScheduleEditor,#kinderInfoModal .pcStudentInfoCard.olliPhoneScheduleMode .olliPhoneScheduleEditor{display:flex;flex:1 1 auto;min-height:0;flex-direction:column;}
      #elementaryInfoModal .olliPhoneScheduleSummaryHead,#kinderInfoModal .olliPhoneScheduleSummaryHead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px;}
      #elementaryInfoModal .olliPhoneScheduleSummaryTitle,#kinderInfoModal .olliPhoneScheduleSummaryTitle{font-size:11px;font-weight:780;color:#626972;}
      #elementaryInfoModal .olliPhoneScheduleChangeBtn,#kinderInfoModal .olliPhoneScheduleChangeBtn{height:32px;padding:0 11px;border:0;border-radius:10px;background:#24272b;color:#fff;font:inherit;font-size:11px;font-weight:780;white-space:nowrap;}
      #elementaryInfoModal .olliPhoneScheduleSummaryList,#kinderInfoModal .olliPhoneScheduleSummaryList{display:grid;gap:7px;}
      #elementaryInfoModal .olliPhoneScheduleSummaryItem,#kinderInfoModal .olliPhoneScheduleSummaryItem{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:8px;min-height:43px;padding:8px 10px;border-radius:12px;background:#fff;border:1px solid #e9ebee;box-sizing:border-box;}
      #elementaryInfoModal .olliPhoneScheduleOrder,#kinderInfoModal .olliPhoneScheduleOrder{min-width:35px;color:#8f959c;font-size:10px;font-weight:750;}
      #elementaryInfoModal .olliPhoneScheduleMain,#kinderInfoModal .olliPhoneScheduleMain{min-width:0;}
      #elementaryInfoModal .olliPhoneScheduleWhen,#kinderInfoModal .olliPhoneScheduleWhen{color:#25292e;font-size:12px;font-weight:800;letter-spacing:-.035em;}
      #elementaryInfoModal .olliPhoneScheduleTeacher,#kinderInfoModal .olliPhoneScheduleTeacher{margin-top:2px;color:#8b9198;font-size:10.5px;font-weight:650;}
      #elementaryInfoModal .olliPhoneScheduleClassBadge,#kinderInfoModal .olliPhoneScheduleClassBadge{height:24px;padding:0 8px;border-radius:999px;background:#f1f2f4;color:#60666e;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;white-space:nowrap;}
      #elementaryInfoModal .olliPhoneScheduleEmpty,#kinderInfoModal .olliPhoneScheduleEmpty{min-height:48px;border-radius:12px;background:#fff;border:1px dashed #dadde1;color:#9aa0a7;font-size:11px;display:flex;align-items:center;justify-content:center;text-align:center;padding:8px;}
      #elementaryInfoModal .pcStudentInfoCardIntro .olliPhoneScheduleTopDate,#kinderInfoModal .pcStudentInfoCardIntro .olliPhoneScheduleTopDate{display:grid;grid-template-columns:auto 118px;align-items:center;justify-content:end;gap:7px;margin-left:auto;}
      #elementaryInfoModal .olliPhoneScheduleTopDate label,#kinderInfoModal .olliPhoneScheduleTopDate label{font-size:10px;font-weight:760;color:#767d85;white-space:nowrap;}
      #elementaryInfoModal .olliPhoneScheduleTopDate .olliPhoneScheduleDateInput,#kinderInfoModal .olliPhoneScheduleTopDate .olliPhoneScheduleDateInput{width:118px;height:32px;border:1px solid #e0e3e6;border-radius:9px;background:#fff;padding:0 6px;box-sizing:border-box;font:inherit;font-size:11px;color:#222;}
      #elementaryInfoModal .olliPhoneScheduleSelectedHead,#kinderInfoModal .olliPhoneScheduleSelectedHead{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;}
      #elementaryInfoModal .olliPhoneScheduleSelectedHead strong,#kinderInfoModal .olliPhoneScheduleSelectedHead strong{font-size:11px;font-weight:800;color:#5f6670;}
      #elementaryInfoModal .olliPhoneScheduleSelectedHead b,#kinderInfoModal .olliPhoneScheduleSelectedHead b{font-size:11px;color:#24272b;}
      #elementaryInfoModal .olliPhoneScheduleSelectedList,#kinderInfoModal .olliPhoneScheduleSelectedList{display:grid;gap:7px;margin-bottom:14px;}
      #elementaryInfoModal .olliPhoneScheduleSelectedItem,#kinderInfoModal .olliPhoneScheduleSelectedItem{display:grid;grid-template-columns:36px minmax(0,1fr) auto;align-items:center;gap:8px;min-height:50px;padding:8px 9px;border-radius:13px;background:#f7f8f9;border:1px solid #e8eaed;}
      #elementaryInfoModal .olliPhoneScheduleRemoveBtn,#kinderInfoModal .olliPhoneScheduleRemoveBtn{width:32px;height:32px;border:0;border-radius:9px;background:#fff;color:#9a4b4b;font:inherit;font-size:18px;line-height:1;}
      #elementaryInfoModal .olliPhoneScheduleRemoveBtn:disabled,#kinderInfoModal .olliPhoneScheduleRemoveBtn:disabled{opacity:.38;}
      #elementaryInfoModal .olliPhoneScheduleOptionsTitle,#kinderInfoModal .olliPhoneScheduleOptionsTitle{margin-bottom:7px;font-size:11px;font-weight:800;color:#5f6670;}
      #elementaryInfoModal .olliPhoneScheduleOptions,#kinderInfoModal .olliPhoneScheduleOptions{display:grid;gap:7px;max-height:none;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;padding-bottom:2px;align-content:start;flex:1 1 auto;}
      #elementaryInfoModal .olliPhoneScheduleOption,#kinderInfoModal .olliPhoneScheduleOption{width:100%;min-height:52px;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;border:1px solid #e6e8eb;border-radius:13px;background:#fff;padding:8px 10px;text-align:left;font:inherit;color:#25292e;box-sizing:border-box;}
      #elementaryInfoModal .olliPhoneScheduleOption.active,#kinderInfoModal .olliPhoneScheduleOption.active{border-color:#24272b;background:#f7f8f9;box-shadow:inset 0 0 0 1px #24272b;}
      #elementaryInfoModal .olliPhoneScheduleOption:disabled,#kinderInfoModal .olliPhoneScheduleOption:disabled{opacity:.48;background:#f5f5f5;}
      #elementaryInfoModal .olliPhoneScheduleOptionWhen,#kinderInfoModal .olliPhoneScheduleOptionWhen{font-size:12px;font-weight:800;letter-spacing:-.035em;}
      #elementaryInfoModal .olliPhoneScheduleOptionMeta,#kinderInfoModal .olliPhoneScheduleOptionMeta{margin-top:3px;font-size:10.5px;color:#8c9299;line-height:1.35;}
      #elementaryInfoModal .olliPhoneScheduleOptionState,#kinderInfoModal .olliPhoneScheduleOptionState{font-size:10px;font-weight:800;color:#717780;white-space:nowrap;}
      #elementaryInfoModal .olliPhoneScheduleOptionState.full,#kinderInfoModal .olliPhoneScheduleOptionState.full{color:#b05a5a;}
      #elementaryInfoModal .olliPhoneScheduleActions,#kinderInfoModal .olliPhoneScheduleActions{display:grid;grid-template-columns:1fr 1.35fr;gap:8px;margin:14px -18px calc(-20px - env(safe-area-inset-bottom, 0px));position:relative;bottom:auto;padding:12px 18px calc(20px + env(safe-area-inset-bottom, 0px));background:#fff;border-top:1px solid #f0f1f3;z-index:3;flex:0 0 auto;}
      #elementaryInfoModal .olliPhoneScheduleAction,#kinderInfoModal .olliPhoneScheduleAction{height:46px;border:0;border-radius:13px;background:#f0f1f3;color:#555b63;font:inherit;font-size:13px;font-weight:800;}
      #elementaryInfoModal .olliPhoneScheduleAction.primary,#kinderInfoModal .olliPhoneScheduleAction.primary{background:#24272b;color:#fff;}
      #elementaryInfoModal .olliPhoneScheduleAction:disabled,#kinderInfoModal .olliPhoneScheduleAction:disabled{opacity:.5;}
      #elementaryInfoModal .olliPhoneScheduleLoading,#kinderInfoModal .olliPhoneScheduleLoading{min-height:170px;display:flex;align-items:center;justify-content:center;text-align:center;color:#9298a0;font-size:11px;line-height:1.5;flex:1 1 auto;}
      @media(max-width:390px){
        #elementaryInfoModal .olliPhoneInfoTab,#kinderInfoModal .olliPhoneInfoTab{height:34px;font-size:11.5px;}
        #elementaryInfoModal .olliPhoneScheduleOption,#kinderInfoModal .olliPhoneScheduleOption{min-height:49px;padding:7px 8px;}
        #elementaryInfoModal .olliPhoneScheduleAction,#kinderInfoModal .olliPhoneScheduleAction{height:44px;}
        #elementaryInfoModal .olliPhoneScheduleActions,#kinderInfoModal .olliPhoneScheduleActions{margin-left:-16px;margin-right:-16px;padding-left:16px;padding-right:16px;}
      }
    `;
    document.head.appendChild(style);
  }

  function enrollmentSort(rows) {
    return (Array.isArray(rows) ? rows : []).slice().sort((a,b) => {
      const ao = Number(a && a.session_order);
      const bo = Number(b && b.session_order);
      const ar = ao === 1 ? 0 : (ao === 2 ? 1 : 2);
      const br = bo === 1 ? 0 : (bo === 2 ? 1 : 2);
      return ar-br || Number(a.weekday)-Number(b.weekday) || Number(a.time_slot)-Number(b.time_slot);
    });
  }
  function normalizePair(row) {
    const pair = {
      weekday:Number(row && row.weekday),
      time_slot:Number(row && row.time_slot),
      class_group:groupValue(row && row.class_group)
    };
    const teacherName = teacherLabel(row && row.teacher_name);
    if (teacherName) pair.teacher_name = teacherName;
    const order = Number(row && row.session_order);
    if (Number.isFinite(order) && order > 0) pair.session_order = order;
    return pair;
  }
  function normalizeSelected(rows) {
    const seenTime = new Set();
    const out = [];
    enrollmentSort(rows).forEach(row => {
      const pair = normalizePair(row);
      if (pair.weekday < 1 || pair.weekday > 6 || pair.time_slot < 1 || seenTime.has(timeKey(pair))) return;
      seenTime.add(timeKey(pair));
      out.push(pair);
    });
    return out.slice(0,2);
  }
  function sameSchedule(left, right) {
    const a = normalizeSelected(left).map(classKey);
    const b = normalizeSelected(right).map(classKey);
    return a.length === b.length && a.every((key,i) => key === b[i]);
  }
  function enrollmentEffectiveOn(row, effectiveDate) {
    const from = clean(row && row.effective_from);
    const to = clean(row && row.effective_to);
    const status = clean(row && row.status).toLowerCase();
    if (status && status !== 'active') return false;
    return (!from || from <= effectiveDate) && (!to || to >= effectiveDate);
  }
  function firstOccurrenceOnOrAfter(effectiveDate, weekday) {
    const date = parseDateKey(effectiveDate);
    const target = Number(weekday || 0);
    if (!date || target < 1 || target > 6) return '';
    const current = date.getDay() || 7;
    date.setDate(date.getDate() + ((target - current + 7) % 7));
    return dateKey(date);
  }
  function isElementarySplit(data, weekday, timeSlot, effectiveDate) {
    const targetDate = firstOccurrenceOnOrAfter(effectiveDate, weekday);
    if (!targetDate) return false;
    return (Array.isArray(data && data.class_split_periods) ? data.class_split_periods : []).some(row => {
      if (Number(row && row.weekday) !== Number(weekday) || Number(row && row.time_slot) !== Number(timeSlot)) return false;
      const from = clean(row && row.effective_from).slice(0, 10);
      const to = clean(row && row.effective_to).slice(0, 10);
      return (!from || from <= targetDate) && (!to || to >= targetDate);
    });
  }
  function isKinderMerged(data, weekday, timeSlot) {
    return (Array.isArray(data && data.kinder_class_merges) ? data.kinder_class_merges : []).some(row => Number(row.weekday) === Number(weekday) && Number(row.time_slot) === Number(timeSlot));
  }
  function capacityFor(data, division) {
    const raw = division === 'kinder' ? Number(data && data.kinder_capacity) : Number(data && data.elementary_capacity);
    return Number.isFinite(raw) && raw > 0 ? raw : 5;
  }
  function optionClassLabel(option) {
    if (option.division === 'kinder' && option.merged) return '합반';
    if (option.division === 'elementary' && !option.split) return '기본 클래스';
    return `${option.class_group}반`;
  }

  async function loadWeekData(effectiveDate, academyId = '') {
    return scheduleService().loadWeek(effectiveDate, academyId);
  }

  async function loadStudentEnrollmentContext(student, division, effectiveDate) {
    const referenceDate = effectiveDate || todayKey();
    if (referenceDate === todayKey()) return scheduleService().ensureContext(student, division);
    return scheduleService().loadContext(student, division, referenceDate, { force: true, source: 'editor_date' });
  }

  function resolveStudentEnrollmentRows(context, weekData, studentId, effectiveDate) {
    return (Array.isArray(context && context.enrollments) ? context.enrollments : [])
      .filter(row => enrollmentEffectiveOn(row, effectiveDate));
  }

  function buildOptions(data, division, effectiveDate, currentRows) {
    const enrollments = Array.isArray(data && data.enrollments) ? data.enrollments : [];
    const assignments = Array.isArray(data && data.class_teachers) ? data.class_teachers : [];
    const slotMap = new Map();
    const addSlot = (weekday,timeSlot) => {
      const w = Number(weekday), t = Number(timeSlot);
      if (!Number.isFinite(w) || w < 1 || w > 6 || !Number.isFinite(t) || t < 1 || t > 12) return;
      slotMap.set(`${w}|${t}`, { weekday:w, time_slot:t });
    };
    assignments.filter(row => clean(row && row.division) === division).forEach(row => addSlot(row.weekday,row.time_slot));
    enrollments.filter(row => clean(row && row.division) === division && enrollmentEffectiveOn(row,effectiveDate)).forEach(row => addSlot(row.weekday,row.time_slot));
    (Array.isArray(currentRows) ? currentRows : []).forEach(row => addSlot(row.weekday,row.time_slot));
    if (division === 'kinder') (Array.isArray(data && data.kinder_class_merges) ? data.kinder_class_merges : []).forEach(row => addSlot(row.weekday,row.time_slot));

    const capacity = capacityFor(data, division);
    const currentKeys = new Set(normalizeSelected(currentRows).map(classKey));
    const options = [];
    Array.from(slotMap.values()).sort((a,b) => a.weekday-b.weekday || a.time_slot-b.time_slot).forEach(slot => {
      const split = division === 'kinder' ? !isKinderMerged(data,slot.weekday,slot.time_slot) : isElementarySplit(data,slot.weekday,slot.time_slot,effectiveDate);
      const merged = division === 'kinder' && !split;
      const groups = split ? ['A','B'] : ['A'];
      groups.forEach(group => {
        const teacher = assignments.find(row => clean(row && row.division) === division
          && Number(row.weekday) === slot.weekday
          && Number(row.time_slot) === slot.time_slot
          && groupValue(row.class_group) === group);
        const teacherName = teacherLabel(teacher && teacher.teacher_name);
        const count = enrollments.filter(row => clean(row && row.division) === division
          && Number(row.weekday) === slot.weekday
          && Number(row.time_slot) === slot.time_slot
          && groupValue(row.class_group) === group
          && enrollmentEffectiveOn(row,effectiveDate)).length;
        const item = {
          division, weekday:slot.weekday, time_slot:slot.time_slot, class_group:group,
          split, merged, teacher_name:teacherName, count, capacity,
          remaining:Math.max(capacity-count,0), full:count >= capacity
        };
        item.current = currentKeys.has(classKey(item));
        item.selectable = item.current || (!!teacherName && !item.full);
        const configured = !!teacherName || count > 0 || item.current || split || merged;
        if (configured) options.push(item);
      });
    });
    return options;
  }

  function optionFor(state,pair) {
    return state.options.find(option => classKey(option) === classKey(pair)) || null;
  }
  function teacherForPair(state,pair) {
    const directTeacher = teacherLabel(pair && pair.teacher_name);
    if (directTeacher) return directTeacher;

    const canonicalAssignments = Array.isArray(state.studentContext && state.studentContext.assignments)
      ? state.studentContext.assignments
      : [];
    const weekAssignments = Array.isArray(state.weekData && state.weekData.class_teachers)
      ? state.weekData.class_teachers
      : [];
    const assignments = canonicalAssignments.length ? canonicalAssignments : weekAssignments;
    const match = assignments.find(row => clean(row && row.division) === state.division
      && Number(row.weekday) === Number(pair.weekday)
      && Number(row.time_slot) === Number(pair.time_slot)
      && groupValue(row.class_group) === groupValue(pair.class_group));
    return teacherLabel(match && match.teacher_name);
  }
  function displayClassForPair(state,pair) {
    const option = optionFor(state,pair);
    if (option) return optionClassLabel(option);
    return `${groupValue(pair.class_group)}반`;
  }

  function scheduleSummaryHtml(state, rows) {
    const pairs = normalizeSelected(rows);
    if (!pairs.length) return '<div class="olliPhoneScheduleEmpty">등록된 수업이 없습니다.</div>';
    return '<div class="olliPhoneScheduleSummaryList">' + pairs.map((pair,index) => {
      const teacher = teacherForPair(state,pair) || '담임 미지정';
      return `<div class="olliPhoneScheduleSummaryItem"><div class="olliPhoneScheduleOrder">${index+1}회차</div><div class="olliPhoneScheduleMain"><div class="olliPhoneScheduleWhen">${esc(dayLabel(pair.weekday))}요일 ${pair.time_slot}시</div><div class="olliPhoneScheduleTeacher">${esc(teacher)}</div></div><div class="olliPhoneScheduleClassBadge">${esc(displayClassForPair(state,pair))}</div></div>`;
    }).join('') + '</div>';
  }

  function ensureTabs(division) {
    const card = cardFor(division);
    if (!card) return null;
    let tabs = card.querySelector('.olliPhoneInfoTabs');
    if (!tabs) {
      tabs = document.createElement('div');
      tabs.className = 'olliPhoneInfoTabs';
      tabs.innerHTML = `<button type="button" class="olliPhoneInfoTab active" data-mode="info">학생정보</button><button type="button" class="olliPhoneInfoTab" data-mode="schedule">수업시간 설정</button>`;
      const intro = card.querySelector('.pcStudentInfoCardIntro');
      if (intro && intro.nextSibling) card.insertBefore(tabs,intro.nextSibling);
      else card.prepend(tabs);
      tabs.addEventListener('click', event => {
        const button = event.target.closest('.olliPhoneInfoTab');
        if (!button) return;
        if (button.dataset.mode === 'schedule') openScheduleMode(division);
        else setMode(division,'info');
      });
    }
    return tabs;
  }

  function ensureEditor(division) {
    const card = cardFor(division);
    if (!card) return null;
    let editor = card.querySelector('.olliPhoneScheduleEditor');
    if (!editor) {
      editor = document.createElement('div');
      editor.className = 'olliPhoneScheduleEditor';
      editor.innerHTML = '<div class="olliPhoneScheduleLoading">수업시간 설정을 준비하고 있어요.</div>';
      card.appendChild(editor);
    }
    return editor;
  }

  function introMetaFor(division) {
    return cardFor(division)?.querySelector('.pcStudentInfoCardIntro span') || null;
  }

  function renderIntroMeta(division) {
    const state = states[division];
    const meta = introMetaFor(division);
    if (!meta) return;
    if (state.mode !== 'schedule') {
      meta.className = '';
      meta.textContent = '요일·시간은 시간표 기준으로 저장됩니다.';
      return;
    }
    meta.className = 'olliPhoneScheduleTopDate';
    meta.innerHTML = `<label>변경 적용일</label><input type="date" class="olliPhoneScheduleDateInput" value="${esc(state.effectiveDate)}" aria-label="변경 적용일">`;
    meta.querySelector('.olliPhoneScheduleDateInput')?.addEventListener('change', event => reloadForDate(division,event.target.value));
  }

  function setMode(division,mode) {
    const state = states[division];
    state.mode = mode === 'schedule' ? 'schedule' : 'info';
    const card = cardFor(division);
    if (!card) return;
    card.classList.toggle('olliPhoneScheduleMode',state.mode === 'schedule');
    ensureTabs(division)?.querySelectorAll('.olliPhoneInfoTab').forEach(btn => btn.classList.toggle('active',btn.dataset.mode === state.mode));
    renderIntroMeta(division);
    if (state.mode === 'info') {
      const studentId = clean(currentTarget(division)?.id);
      if (!studentId || state.summaryStudentId !== studentId) refreshSummary(division);
    }
  }

  function renderSummaryShell(division, bodyHtml) {
    const scheduleBox = scheduleBoxFor(division);
    if (!scheduleBox) return false;
    scheduleBox.innerHTML = '<div class="olliPhoneScheduleSummaryHead"><div class="olliPhoneScheduleSummaryTitle">수업시간</div><button type="button" class="olliPhoneScheduleChangeBtn">시간표 변경</button></div>' + bodyHtml;
    scheduleBox.querySelector('.olliPhoneScheduleChangeBtn')?.addEventListener('click',() => openScheduleMode(division));
    return true;
  }

  function renderLocalSummary(division) {
    const state = states[division];
    const student = currentTarget(division);
    if (!student || !isModalOpen(division)) return null;
    const localContext = scheduleService().readLocal(student, division);
    if (!localContext || localContext.loaded !== true) return null;
    const localRows = Array.isArray(localContext.enrollments) ? localContext.enrollments : [];
    const studentId = clean(student.id);
    state.studentId = studentId;
    state.student = student;
    state.studentContext = localContext;
    state.current = normalizeSelected(localRows);
    state.summaryStudentId = studentId;
    const summaryHtml = scheduleSummaryHtml(state, localRows);
    renderSummaryShell(division, summaryHtml);
    return summaryHtml;
  }

  async function refreshSummary(division) {
    const state = states[division];
    const student = currentTarget(division);
    const scheduleBox = scheduleBoxFor(division);
    if (!student || !scheduleBox || !isModalOpen(division)) return;
    const studentId = clean(student.id);
    state.summaryStudentId = studentId;
    const token = ++state.summaryToken;
    const localSummaryHtml = renderLocalSummary(division);
    let renderedSummaryHtml = localSummaryHtml === null ? '' : localSummaryHtml;
    if (localSummaryHtml === null) {
      renderSummaryShell(division, '<div class="olliPhoneScheduleEmpty">시간표에서 불러오는 중...</div>');
    }

    try {
      const referenceDate = todayKey();
      const [context, weekData] = await Promise.all([
        loadStudentEnrollmentContext(student, division, referenceDate),
        state.weekData ? Promise.resolve(state.weekData) : loadWeekData(referenceDate, clean(student && student.academy_id))
      ]);
      if (token !== state.summaryToken || !isModalOpen(division)) return;
      state.studentId = studentId;
      state.student = student;
      state.studentContext = context;
      const studentRows = resolveStudentEnrollmentRows(context, weekData, studentId, referenceDate);
      state.current = normalizeSelected(studentRows);
      state.weekData = weekData;
      state.options = buildOptions(weekData, division, referenceDate, studentRows);
      if (typeof global.phoneStudentInfoRememberLocalRows === 'function') {
        scheduleService().rememberRows(student, division, studentRows, context);
      }
      if (token !== state.summaryToken || !isModalOpen(division)) return;
      const nextSummaryHtml = scheduleSummaryHtml(state, studentRows);
      if (nextSummaryHtml !== renderedSummaryHtml) {
        renderedSummaryHtml = nextSummaryHtml;
        renderSummaryShell(division, nextSummaryHtml);
      }
    } catch (error) {
      if (token !== state.summaryToken) return;
      if (!renderedSummaryHtml) {
        renderSummaryShell(division, '<div class="olliPhoneScheduleEmpty">시간표를 불러오지 못했습니다.</div>');
      }
    }
  }

  function primeEditorFromLocal(division, student) {
    const state = states[division];
    const localContext = scheduleService().readLocal(student, division);
    if (!localContext || localContext.loaded !== true) return false;
    const localRows = Array.isArray(localContext.enrollments) ? localContext.enrollments : [];
    state.studentContext = localContext;
    state.current = normalizeSelected(localRows);
    state.selected = state.current.map(pair => Object.assign({}, pair));
    state.weekData = null;
    state.options = [];
    state.showingLocal = true;
    state.loadError = '';
    return true;
  }

  function selectedHtml(state) {
    if (!state.selected.length) return '<div class="olliPhoneScheduleEmpty">선택된 수업이 없습니다. 학생정보만 유지할 수 있어요.</div>';
    return state.selected.map((pair,index) => {
      const teacher = teacherForPair(state,pair) || '담임 미지정';
      return `<div class="olliPhoneScheduleSelectedItem"><div class="olliPhoneScheduleOrder">${index+1}회차</div><div class="olliPhoneScheduleMain"><div class="olliPhoneScheduleWhen">${esc(dayLabel(pair.weekday))}요일 ${pair.time_slot}시 · ${esc(displayClassForPair(state,pair))}</div><div class="olliPhoneScheduleTeacher">${esc(teacher)}</div></div><button type="button" class="olliPhoneScheduleRemoveBtn" data-remove-key="${esc(classKey(pair))}" ${state.loading || state.loadError ? 'disabled' : ''} aria-label="수업 삭제">×</button></div>`;
    }).join('');
  }

  function optionsHtml(state) {
    if (state.loading) return '<div class="olliPhoneScheduleEmpty">저장된 수업을 먼저 표시했습니다.<br>최신 시간표를 확인하고 있어요.</div>';
    if (state.loadError) return '<div class="olliPhoneScheduleEmpty">최신 시간표를 불러오지 못했습니다.<br>저장된 수업을 표시하고 있어요.</div>';
    if (!state.options.length) return '<div class="olliPhoneScheduleEmpty">선택 가능한 클래스가 없습니다.<br>PC 시간표 설정에서 클래스 담임을 먼저 지정해 주세요.</div>';
    const selectedKeys = new Set(state.selected.map(classKey));
    return state.options.map(option => {
      const key = classKey(option);
      const selected = selectedKeys.has(key);
      const fullForNew = !selected && option.full;
      const disabled = !selected && !option.selectable;
      const teacher = option.teacher_name || '담임 미지정';
      let stateText = selected ? '선택됨' : (fullForNew ? '정원 마감' : (option.teacher_name ? `${option.remaining}자리` : '담임 미지정'));
      return `<button type="button" class="olliPhoneScheduleOption ${selected ? 'active' : ''}" data-class-key="${esc(key)}" ${disabled ? 'disabled' : ''}><div><div class="olliPhoneScheduleOptionWhen">${esc(dayLabel(option.weekday))}요일 ${option.time_slot}시 · ${esc(optionClassLabel(option))}</div><div class="olliPhoneScheduleOptionMeta">${esc(teacher)} · ${option.count}/${option.capacity}명</div></div><div class="olliPhoneScheduleOptionState ${fullForNew ? 'full' : ''}">${esc(stateText)}</div></button>`;
    }).join('');
  }

  function renderEditor(division) {
    const state = states[division];
    const editor = ensureEditor(division);
    if (!editor) return;
    renderIntroMeta(division);
    if (state.loading && !state.showingLocal) {
      editor.innerHTML = '<div class="olliPhoneScheduleLoading">시간표의 클래스·담임·정원을 확인하고 있어요.</div>';
      return;
    }
    editor.innerHTML = `
      <div class="olliPhoneScheduleSelectedHead"><strong>선택한 수업</strong><b>${state.selected.length} / 2</b></div>
      <div class="olliPhoneScheduleSelectedList">${selectedHtml(state)}</div>
      <div class="olliPhoneScheduleOptionsTitle">수업 클래스 선택</div>
      <div class="olliPhoneScheduleOptions">${optionsHtml(state)}</div>
      <div class="olliPhoneScheduleActions"><button type="button" class="olliPhoneScheduleAction" data-schedule-cancel>취소</button><button type="button" class="olliPhoneScheduleAction primary" data-schedule-save ${state.saving || state.loading || state.loadError ? 'disabled' : ''}>${state.saving ? '저장 중...' : '수업시간 저장'}</button></div>`;
    editor.querySelector('[data-schedule-cancel]')?.addEventListener('click',() => closeStudentInfoModal(division));
    editor.querySelector('[data-schedule-save]')?.addEventListener('click',() => saveSchedule(division));
    editor.querySelectorAll('[data-remove-key]').forEach(button => button.addEventListener('click',() => removeSelected(division,button.dataset.removeKey)));
    editor.querySelectorAll('[data-class-key]').forEach(button => button.addEventListener('click',() => toggleOption(division,button.dataset.classKey)));
  }

  async function openScheduleMode(division) {
    const state = states[division];
    const student = currentTarget(division);
    if (!student || !clean(student.id)) return;
    setMode(division,'schedule');
    state.student = student;
    state.studentId = clean(student.id);
    state.effectiveDate = todayKey();
    state.studentContext = null;
    state.current = [];
    state.selected = [];
    state.options = [];
    state.weekData = null;
    state.loadError = '';
    state.showingLocal = primeEditorFromLocal(division, student);
    state.loading = true;
    renderEditor(division);
    const token = ++state.loadToken;
    try {
      const [context,weekData] = await Promise.all([
        loadStudentEnrollmentContext(student, division, state.effectiveDate),
        loadWeekData(state.effectiveDate, clean(student && student.academy_id))
      ]);
      if (token !== state.loadToken || !isModalOpen(division)) return;
      state.studentContext = context;
      const studentRows = resolveStudentEnrollmentRows(context, weekData, state.studentId, state.effectiveDate);
      state.current = normalizeSelected(studentRows);
      state.selected = state.current.map(pair => Object.assign({},pair));
      state.weekData = weekData;
      state.options = buildOptions(weekData,division,state.effectiveDate,studentRows);
      state.showingLocal = false;
      state.loadError = '';
      if (typeof global.phoneStudentInfoRememberLocalRows === 'function') {
        scheduleService().rememberRows(student, division, studentRows, context);
      }
    } catch (error) {
      if (token !== state.loadToken) return;
      if (!state.showingLocal) {
        state.current = [];
        state.selected = [];
      }
      state.options = [];
      state.weekData = null;
      state.loadError = clean(error && (error.message || error)) || '시간표를 불러오지 못했습니다.';
      notify(state.loadError);
    } finally {
      if (token === state.loadToken) {
        state.loading = false;
        renderEditor(division);
      }
    }
  }

  async function reloadForDate(division,value) {
    const state = states[division];
    const next = clean(value);
    if (!parseDateKey(next)) { notify('변경 적용일을 확인해 주세요.'); renderEditor(division); return; }
    state.effectiveDate = next;
    state.showingLocal = false;
    state.loadError = '';
    state.loading = true;
    renderEditor(division);
    const token = ++state.loadToken;
    try {
      const [context,data] = await Promise.all([
        loadStudentEnrollmentContext(state.student, division, next),
        loadWeekData(next, clean(state.student && state.student.academy_id))
      ]);
      if (token !== state.loadToken) return;
      state.studentContext = context;
      const studentRows = resolveStudentEnrollmentRows(context, data, state.studentId, next);
      state.current = normalizeSelected(studentRows);
      state.selected = state.current.map(pair => Object.assign({}, pair));
      state.weekData = data;
      state.options = buildOptions(data,division,next,studentRows);
    } catch (error) {
      state.loadError = clean(error && (error.message || error)) || '해당 날짜의 시간표를 불러오지 못했습니다.';
      notify(state.loadError);
    } finally {
      if (token === state.loadToken) { state.loading = false; renderEditor(division); }
    }
  }

  function removeSelected(division,key) {
    const state = states[division];
    state.selected = state.selected.filter(pair => classKey(pair) !== clean(key));
    renderEditor(division);
  }

  function toggleOption(division,key) {
    const state = states[division];
    const option = state.options.find(item => classKey(item) === clean(key));
    if (!option) return;
    const existingIndex = state.selected.findIndex(pair => classKey(pair) === classKey(option));
    if (existingIndex >= 0) {
      state.selected.splice(existingIndex,1);
      renderEditor(division);
      return;
    }
    if (!option.selectable) {
      notify(option.full ? '정원이 마감된 클래스입니다.' : '시간표 설정에서 담임을 먼저 지정해 주세요.');
      return;
    }
    const sameTime = state.selected.find(pair => timeKey(pair) === timeKey(option));
    if (sameTime) {
      const index = state.selected.indexOf(sameTime);
      state.selected[index] = normalizePair(option);
      renderEditor(division);
      return;
    }
    if (state.selected.length >= 2) {
      notify('수업은 최대 2회까지 선택할 수 있습니다.');
      return;
    }
    state.selected.push(normalizePair(option));
    renderEditor(division);
  }

  async function saveSchedule(division) {
    const state = states[division];
    if (state.saving || !state.studentId) return;
    const effectiveDate = clean(state.effectiveDate);
    if (!parseDateKey(effectiveDate)) { notify('변경 적용일을 확인해 주세요.'); return; }
    if (state.selected.length > 2) { notify('수업은 최대 2회까지 선택할 수 있습니다.'); return; }
    const timeKeys = state.selected.map(timeKey);
    if (new Set(timeKeys).size !== timeKeys.length) { notify('같은 요일과 시간에는 한 클래스만 선택할 수 있습니다.'); return; }
    for (const pair of state.selected) {
      const option = optionFor(state,pair);
      const wasCurrent = state.current.some(current => classKey(current) === classKey(pair));
      if (!wasCurrent && (!option || !option.teacher_name)) { notify('담임이 지정된 클래스만 선택할 수 있습니다.'); return; }
      if (!wasCurrent && option && option.full) { notify('정원이 마감된 클래스는 선택할 수 없습니다.'); return; }
    }
    if (sameSchedule(state.selected,state.current) && effectiveDate === todayKey()) {
      setMode(division,'info');
      return;
    }

    state.saving = true;
    renderEditor(division);
    try {
      const pairs = state.selected.map((pair,index) => ({
        weekday:Number(pair.weekday),
        time_slot:Number(pair.time_slot),
        class_group:groupValue(pair.class_group),
        session_order:index+1
      }));
      const saved = await scheduleService().saveSchedule(state.student, division, pairs, effectiveDate);
      if (saved && saved.context) {
        state.studentContext = saved.context;
        state.current = normalizeSelected(saved.context.enrollments);
        state.selected = state.current.map(pair => Object.assign({}, pair));
      } else {
        state.current = state.selected.map(pair => Object.assign({}, pair));
      }
      notify(effectiveDate === todayKey() ? '수업시간을 저장했어요.' : `${effectiveDate}부터 적용되도록 저장했어요.`);
      state.summaryStudentId = '';
      setMode(division,'info');
    } catch (error) {
      notify(error && (error.message || error) || '수업시간 저장에 실패했습니다.');
    } finally {
      state.saving = false;
      if (state.mode === 'schedule') renderEditor(division);
    }
  }

  function mount(division, student, context, options = {}) {
    const kind = division === 'kinder' ? 'kinder' : 'elementary';
    const state = states[kind];
    const target = student || currentTarget(kind);
    if (!target || !clean(target.id)) return false;
    installStyle();
    state.student = target;
    state.studentId = clean(target.id);
    state.mode = 'info';
    state.summaryStudentId = state.studentId;
    const card = cardFor(kind);
    if (!card) return false;
    card.classList.remove('olliPhoneScheduleMode');
    ensureTabs(kind)?.querySelectorAll('.olliPhoneInfoTab').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === 'info'));
    ensureEditor(kind);
    renderIntroMeta(kind);
    if (context && context.loaded === true) applyContext(kind, target, context);
    else if (options.error) renderSummaryShell(kind, '<div class="olliPhoneScheduleEmpty">시간표를 불러오지 못했습니다.</div>');
    else renderSummaryShell(kind, '<div class="olliPhoneScheduleEmpty">시간표에서 불러오는 중...</div>');
    return true;
  }

  function applyContext(division, student, context) {
    const kind = division === 'kinder' ? 'kinder' : 'elementary';
    const state = states[kind];
    const target = student || state.student || currentTarget(kind);
    if (!target || !context || context.loaded !== true) return false;
    state.student = target;
    state.studentId = clean(target.id);
    state.studentContext = context;
    if (state.mode === 'schedule') return true;
    const rows = resolveStudentEnrollmentRows(context, null, state.studentId, todayKey());
    state.current = normalizeSelected(rows);
    state.summaryStudentId = state.studentId;
    renderSummaryShell(kind, scheduleSummaryHtml(state, rows));
    const snapshotId = state.studentId;
    scheduleService().loadWeek(todayKey(), clean(target && target.academy_id)).then(data => {
      if (state.mode !== 'info' || state.studentId !== snapshotId || !isModalOpen(kind)) return;
      state.weekData = data;
      state.options = buildOptions(data, kind, todayKey(), rows);
      renderSummaryShell(kind, scheduleSummaryHtml(state, rows));
    }).catch(() => {});
    return true;
  }

  function showError(division, message) {
    const kind = division === 'kinder' ? 'kinder' : 'elementary';
    const text = esc(message || '시간표를 불러오지 못했습니다.');
    renderSummaryShell(kind, `<div class="olliPhoneScheduleEmpty">${text}</div>`);
  }

  global.OlliPhoneStudentScheduleEditor = Object.freeze({
    mount,
    applyContext,
    showError,
    open(division) { return openScheduleMode(division === 'kinder' ? 'kinder' : 'elementary'); }
  });
  global.openPhoneStudentScheduleEditor = function(division) { return openScheduleMode(division === 'kinder' ? 'kinder' : 'elementary'); };
})(window);
