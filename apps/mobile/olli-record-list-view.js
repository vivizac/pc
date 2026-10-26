function getPhoneRecordSortCriterionFromSectionKey(sectionKey) {
  return String(sectionKey || '').split(':')[0] || '';
}

function getPhoneRecordSectionLabel(student, view, sectionKey) {
  const status = (typeof getStudentStatus === 'function') ? getStudentStatus(student) : String(student?.status || 'active');
  if (status !== 'active') return '';
  const criterion = getPhoneRecordSortCriterionFromSectionKey(sectionKey);
  if (criterion === 'day') return '';

  if (view === 'elementary') {
    if (criterion === 'initial' || !criterion) return '전체';
    if (criterion === 'grade') {
      const raw = String(student?.grade || student?.school_grade || student?.class_grade || '').trim();
      const match = raw.match(/\d+/);
      return match ? `${match[0]}학년` : (raw || '학년');
    }
    if (criterion === 'tendency') {
      let raw = String(student?.tendency || student?.personality || student?.personalityType || student?.personality_type || '').trim();
      raw = raw.replace(/^성향\s*/u, '').replace(/\s*성향$/u, '').trim();
      return raw ? `${raw}성향` : '성향';
    }
    if (criterion === 'school') {
      let raw = '';
      try {
        if (typeof formatElementarySchoolGuideDisplay === 'function') raw = String(formatElementarySchoolGuideDisplay(student) || '').trim();
      } catch (_) {}
      if (!raw) raw = String(student?.school || student?.elementary_school || student?.schoolName || '').trim();
      raw = raw.replace(/\s+/g, '').replace(/초등학교/g, '초').replace(/초등/g, '초').replace(/등학교/g, '');
      return raw || '학교';
    }
    if (criterion === 'teacher') {
      let raw = '';
      try {
        if (typeof getRecordSortTeacherValue === 'function') raw = String(getRecordSortTeacherValue(student) || '').trim();
      } catch (_) {}
      if (!raw) raw = String(student?.homeroom_teacher || student?.teacher || student?.teacher_name || student?.teacherName || '').trim();
      raw = raw.replace(/T$/i, '').trim();
      return raw ? `${raw}T` : '담임';
    }
    if (criterion === 'group') {
      const raw = String(student?.group || '').trim();
      if (!raw) return '그룹';
      const map = { '1':'A', '2':'B', '3':'C', '4':'D', '5':'E', '6':'F' };
      const value = map[raw] || raw.replace(/그룹$/u, '').trim();
      return value ? `${value}그룹` : '그룹';
    }
  }
  if (view === 'kinder') {
    if (criterion === 'initial' || !criterion) return '전체';
    if (criterion === 'age') {
      const raw = String(student?.age || '').trim();
      const match = raw.match(/\d+/);
      return match ? `${match[0]}세` : (raw || '나이');
    }
    if (criterion === 'teacher') {
      let raw = '';
      try {
        if (typeof getRecordSortTeacherValue === 'function') raw = String(getRecordSortTeacherValue(student) || '').trim();
      } catch (_) {}
      if (!raw) raw = String(student?.homeroom_teacher || student?.teacher || student?.teacher_name || student?.teacherName || '').trim();
      raw = raw.replace(/T$/i, '').trim();
      return raw ? `${raw}T` : '담임';
    }
    if (criterion === 'tendency') {
      let raw = String(student?.tendency || student?.personality || student?.personalityType || student?.personality_type || '').trim();
      raw = raw.replace(/^성향\s*/u, '').replace(/\s*성향$/u, '').trim();
      return raw ? `${raw}성향` : '성향';
    }
    if (criterion === 'kindergarten') {
      const raw = String(student?.kindergarten || student?.school || '').trim();
      return raw || '유치원';
    }
  }
  return '';
}

function renderPhoneRecordSectionDivider(label) {
  const text = String(label || '').trim();
  if (!text) return '';
  return `<div class="recordSortSectionDivider"><span class="recordSortSectionLine" aria-hidden="true"></span><span class="recordSortSectionLabel">${escapeHtml(text)}</span><span class="recordSortSectionLine" aria-hidden="true"></span></div>`;
}

window.getPhoneRecordSectionLabel = getPhoneRecordSectionLabel;
window.renderPhoneRecordSectionDivider = renderPhoneRecordSectionDivider;

function syncPhoneRecordInitialSortLabel() {
  document.querySelectorAll('#recordSortPopup [data-olli-sort-criteria="initial"], #recordSortPopup [data-sort-criteria="initial"]').forEach(btn => {
    if ((btn.textContent || '').trim() !== '전체') btn.textContent = '전체';
    btn.setAttribute('aria-label', '전체 학생을 자음순으로 정렬');
    btn.setAttribute('title', '전체 학생을 자음순으로 정렬');
  });
}
window.syncPhoneRecordInitialSortLabel = syncPhoneRecordInitialSortLabel;

document.addEventListener('click', event => {
  if (event.target?.closest?.('#recordSortBtn, #recordSortPopup [data-olli-sort-criteria], #recordSortPopup [data-sort-criteria]')) {
    setTimeout(syncPhoneRecordInitialSortLabel, 0);
  }
}, true);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(syncPhoneRecordInitialSortLabel, 0));
else setTimeout(syncPhoneRecordInitialSortLabel, 0);

function sortPhoneRecordStudentsForDisplay(students, searchQuery) {
  const list = [...(students || [])];
  if (!String(searchQuery || '').trim()) return sortStudentsForRecord(list);
  return list.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), 'ko'));
}

function renderPhoneRecordStatusSection(view, status, label, rowsHtml, emptyText, searchMode) {
  if (!searchMode) return renderRecordStatusSection(view, status, label, rowsHtml, emptyText);
  const bodyHtml = rowsHtml || `<div class="recordStatusSectionEmpty">${escapeHtml(emptyText || '해당 학생이 없습니다.')}</div>`;
  return `<div class="recordStatusSection open">
    <button type="button" class="recordStatusSectionToggle" aria-expanded="true" aria-disabled="true">
      <span>${escapeHtml(label)}</span>
      <span class="recordStatusSectionTriangle" aria-hidden="true"></span>
    </button>
    <div class="recordStatusSectionBody">${bodyHtml}</div>
  </div>`;
}

function getPhoneRecordStudentGuideText(student, view) {
  const value = (input) => String(input == null ? '' : input).trim();
  if (view === 'elementary') {
    const school = value(student?.school || student?.elementary_school || student?.schoolName);
    const rawGrade = value(student?.grade || student?.school_grade || student?.class_grade);
    const gradeMatch = rawGrade.match(/\d+/);
    const grade = gradeMatch ? `${gradeMatch[0]}학년` : rawGrade;
    return [school, grade].filter(Boolean).join(' ');
  }

  const kindergarten = value(student?.kindergarten || student?.school);
  const rawAge = value(student?.age);
  const ageMatch = rawAge.match(/\d+/);
  const age = ageMatch ? `${ageMatch[0]}세` : rawAge;
  return [kindergarten, age].filter(Boolean).join(' ');
}

// A mounted roster is reusable only for the same academy, division, search and sort state.
// The DOM is never shared between academies, even while the drawer is hidden.
function phoneRecordListRenderKey(view, name) {
  const division = view === 'kinder' ? 'kinder' : view === 'elementary' ? 'elementary' : '';
  const academyId = typeof getOlliCurrentAcademyId === 'function'
    ? String(getOlliCurrentAcademyId() || '').trim() : '';
  if (!division || !academyId) return '';
  let sortState = '';
  try { sortState = localStorage.getItem('olli_record_sort_settings_by_view_v3') || ''; } catch (_) {}
  return JSON.stringify([academyId, division, String(name || '').trim(), sortState, new Date().toDateString()]);
}
function markPhoneRecordListRendered(view, name) {
  const list = document.getElementById('recordList');
  if (!list) return;
  const key = phoneRecordListRenderKey(view, name);
  if (key) list.dataset.olliRecordRenderKey = key;
  else delete list.dataset.olliRecordRenderKey;
}
function canReusePhoneRecordList(view, name) {
  const list = document.getElementById('recordList');
  const key = phoneRecordListRenderKey(view, name);
  return !!(key && list?.children.length && list.dataset.olliRecordRenderKey === key);
}
window.markPhoneRecordListRendered = markPhoneRecordListRendered;
window.canReusePhoneRecordList = canReusePhoneRecordList;

// Stage 5: patch a changed student card only while the surrounding roster structure
// remains identical. Sorting, status sections, and day-specific duplicate sessions
// always fall back to the existing full-list rendering path.
const phoneRecordRowPatchState = new WeakMap();
function parsePhoneRecordRowPatch(html) {
  if (typeof document.createElement !== 'function') return null;
  const template = document.createElement('template');
  if (!template.content) return null;
  template.innerHTML = html;
  const rows = Array.from(template.content.querySelectorAll('.elementaryStudentRow, .kinderStudentRow'));
  if (!rows.length) return null;
  const ids = rows.map(row => String(row.getAttribute('data-record-student-id') || ''));
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) return null;
  rows.forEach(row => row.replaceWith(document.createComment('olli-student-row')));
  return { rows, ids, structure: template.innerHTML };
}

function applyPhoneRecordRosterHtml(list, view, name, nextHtml) {
  const key = phoneRecordListRenderKey(view, name);
  const canReuse = window.canReusePhoneRecordList?.(view, name) === true;
  const previous = phoneRecordRowPatchState.get(list);
  if (canReuse && list.innerHTML === nextHtml) return;
  let next = null;
  // Parsing in a template keeps potentially costly card images out of the live DOM.
  try { next = parsePhoneRecordRowPatch(nextHtml); } catch (_) {}
  const previousMatches = !!(canReuse && key && previous && next
    && previous.key === key && previous.structure === next.structure
    && previous.ids.length === next.ids.length
    && previous.ids.every((id, i) => id === next.ids[i]));
  if (previousMatches) {
    const currentRows = Array.from(list.querySelectorAll('.elementaryStudentRow, .kinderStudentRow'));
    if (currentRows.length === next.rows.length
      && currentRows.every((row, i) => row.getAttribute('data-record-student-id') === next.ids[i])) {
      next.rows.forEach((newRow, i) => {
        if (currentRows[i].outerHTML !== newRow.outerHTML) currentRows[i].replaceWith(newRow);
      });
      phoneRecordRowPatchState.set(list, { key, structure: next.structure, ids: next.ids });
      return;
    }
  }
  // If the student set/order, grouping, or rendered section changes, rebuild once.
  list.innerHTML = nextHtml;
  if (key && next) phoneRecordRowPatchState.set(list, { key, structure: next.structure, ids: next.ids });
  else phoneRecordRowPatchState.delete(list);
}

function notifyPhoneRecordListRendered(view, name) {
  markPhoneRecordListRendered(view, name);
  try {
    window.dispatchEvent(new CustomEvent('olli:record-list-rendered', {
      detail: { view: view === 'kinder' ? 'kinder' : 'elementary' }
    }));
  } catch (_) {}
}

function renderElementaryStudentRows(students, searchMode = false) {
  const cycleGroups = getElementaryCycleGroups(students);
  let previousVisualSectionKey = '';
  return students.map((student, index) => {
    const metaText = getPhoneRecordStudentGuideText(student, 'elementary');
    const metaHtml = escapeHtml(metaText || '');
    const sectionKey = searchMode
      ? 'search'
      : ((typeof getRecordSortSectionKey === 'function') ? getRecordSortSectionKey(student, 'elementary', cycleGroups) : getElementaryGroupSectionKey(student, cycleGroups));
    const dividerLabel = searchMode ? '' : getPhoneRecordSectionLabel(student, 'elementary', sectionKey);
    const criterion = searchMode ? 'search' : getPhoneRecordSortCriterionFromSectionKey(sectionKey);
    const visualSectionKey = searchMode
      ? 'search'
      : (criterion === 'initial'
        ? 'initial:전체'
        : (dividerLabel ? `${criterion}:${dividerLabel}` : sectionKey));
    const sectionChanged = index === 0 || visualSectionKey !== previousVisualSectionKey;
    const dividerHtml = !searchMode && sectionChanged && dividerLabel ? renderPhoneRecordSectionDivider(dividerLabel) : '';
    const groupBreakClass = !searchMode && criterion !== 'day' && !dividerHtml && index > 0 && visualSectionKey !== previousVisualSectionKey ? ' groupBreak' : '';
    previousVisualSectionKey = visualSectionKey;
    const status = getStudentStatus(student);
    const statusClass = status === 'paused' ? ' studentStatusPaused' : (status === 'withdrawn' ? ' studentStatusWithdrawn' : '');
    const searchStudentAttr = searchMode ? ` data-record-search-student-id="${escapeHtml(student.id)}"` : '';
    return `${dividerHtml}
    <button class="elementaryStudentRow${groupBreakClass}${statusClass}"${searchStudentAttr} data-record-student-id="${escapeHtml(student.id)}" onclick="handleStudentRowClick(event,'${escapeTemplateLiteral(student.id)}')">
      <div class="elementaryRowInner">
        ${renderPhoneElementaryAttendanceLeadIcon(student)}
        <span class="studentTextWrap">
          <span>${escapeHtml(student.name)}</span>
          ${metaHtml ? `<span class="studentMetaText">${metaHtml}</span>` : ''}
        </span>
      </div>
    </button>`;
  }).join('');
}

function renderKinderStudentRows(students, searchMode = false) {
  let previousVisualSectionKey = '';
  return students.map((student, index) => {
    const metaText = getPhoneRecordStudentGuideText(student, 'kinder');
    const metaHtml = escapeHtml(metaText || '');
    const sectionKey = searchMode
      ? 'search'
      : ((typeof getRecordSortSectionKey === 'function') ? getRecordSortSectionKey(student, 'kinder') : `status:${getStudentStatus(student)}:${student.age || ''}`);
    const dividerLabel = searchMode ? '' : getPhoneRecordSectionLabel(student, 'kinder', sectionKey);
    const criterion = searchMode ? 'search' : getPhoneRecordSortCriterionFromSectionKey(sectionKey);
    const visualSectionKey = searchMode
      ? 'search'
      : (criterion === 'initial'
        ? 'initial:전체'
        : (dividerLabel ? `${criterion}:${dividerLabel}` : sectionKey));
    const sectionChanged = index === 0 || visualSectionKey !== previousVisualSectionKey;
    const dividerHtml = !searchMode && sectionChanged && dividerLabel ? renderPhoneRecordSectionDivider(dividerLabel) : '';
    const groupBreakClass = !searchMode && criterion !== 'day' && !dividerHtml && index > 0 && visualSectionKey !== previousVisualSectionKey ? ' groupBreak' : '';
    previousVisualSectionKey = visualSectionKey;
    const status = getStudentStatus(student);
    const statusClass = status === 'paused' ? ' studentStatusPaused' : (status === 'withdrawn' ? ' studentStatusWithdrawn' : '');
    const searchStudentAttr = searchMode ? ` data-record-search-student-id="${escapeHtml(student.id)}"` : '';
    return `${dividerHtml}
    <button class="kinderStudentRow${groupBreakClass}${statusClass}"${searchStudentAttr} data-record-student-id="${escapeHtml(student.id)}" onclick="handleStudentRowClick(event,'${escapeTemplateLiteral(student.id)}')">
      <div class="kinderRowInner">
        ${renderPhoneKinderAttendanceLeadIcon(student)}
        <span class="studentTextWrap">
          <span>${escapeHtml(student.name)}</span>
          ${metaHtml ? `<span class="studentMetaText">${metaHtml}</span>` : ''}
        </span>
      </div>
    </button>`;
  }).join('');
}

function renderElementaryRecords(name) {
  if (window.deferOlliMainDrawerAttendanceRender?.('elementary', name)) return;
  const list = document.getElementById('recordList');
  const query = String(name || '').trim();
  if (window.OlliPhoneAttendanceAdapter && typeof window.OlliPhoneAttendanceAdapter.renderRecordListOverride === 'function'
      && window.OlliPhoneAttendanceAdapter.renderRecordListOverride('elementary', name)) return;
  let students = getStudentsByType('elementary');
  if (query) students = students.filter(student => String(student?.name || '').includes(query));

  const activeStudents = sortPhoneRecordStudentsForDisplay(students.filter(student => getStudentStatus(student) === 'active'), query);
  const pausedStudents = sortPhoneRecordStudentsForDisplay(students.filter(student => getStudentStatus(student) === 'paused'), query);
  const withdrawnStudents = sortPhoneRecordStudentsForDisplay(students.filter(isWithdrawnVisibleInAttendance), query);

  const searchMode = Boolean(query);
  const activeHtml = renderElementaryStudentRows(activeStudents, searchMode);
  const pausedHtml = renderElementaryStudentRows(pausedStudents, searchMode);
  const withdrawnHtml = renderElementaryStudentRows(withdrawnStudents, searchMode);
  const hasInactiveSearchResult = searchMode && Boolean(pausedHtml || withdrawnHtml);
  const activeEmptyHtml = activeHtml || hasInactiveSearchResult ? '' : `<div class="recordEmpty">${searchMode ? '검색된 학생이 없습니다.' : '등록된 재원생이 없습니다.'}</div>`;
  const nextHtml = activeHtml
    + activeEmptyHtml
    + renderPhoneRecordStatusSection('elementary', 'paused', '휴원', pausedHtml, '휴원생이 없습니다.', searchMode)
    + renderPhoneRecordStatusSection('elementary', 'withdrawn', '퇴원', withdrawnHtml, '최근 한 달 내 퇴원생이 없습니다.', searchMode);
  applyPhoneRecordRosterHtml(list, 'elementary', name, nextHtml);
  syncPhoneRecordInitialSortLabel();
  notifyPhoneRecordListRendered('elementary', name);
}

function renderKinderRecords(name) {
  if (window.deferOlliMainDrawerAttendanceRender?.('kinder', name)) return;
  const list = document.getElementById('recordList');
  const query = String(name || '').trim();
  if (window.OlliPhoneAttendanceAdapter && typeof window.OlliPhoneAttendanceAdapter.renderRecordListOverride === 'function'
      && window.OlliPhoneAttendanceAdapter.renderRecordListOverride('kinder', name)) return;
  let students = getStudentsByType('kinder');
  if (query) students = students.filter(student => String(student?.name || '').includes(query));

  const activeStudents = sortPhoneRecordStudentsForDisplay(students.filter(student => getStudentStatus(student) === 'active'), query);
  const pausedStudents = sortPhoneRecordStudentsForDisplay(students.filter(student => getStudentStatus(student) === 'paused'), query);
  const withdrawnStudents = sortPhoneRecordStudentsForDisplay(students.filter(isWithdrawnVisibleInAttendance), query);

  const searchMode = Boolean(query);
  const activeHtml = renderKinderStudentRows(activeStudents, searchMode);
  const pausedHtml = renderKinderStudentRows(pausedStudents, searchMode);
  const withdrawnHtml = renderKinderStudentRows(withdrawnStudents, searchMode);
  const transferCandidates = searchMode ? [] : getKinderElementaryTransferCandidates();
  const transferBannerHtml = transferCandidates.length
    ? `<button type="button" class="kinderTransferBanner" onclick="openKinderTransferModal()">
        <span class="kinderTransferBannerText"><span class="kinderTransferBannerTitle">초등부 이관 대상</span><span class="kinderTransferBannerSub">3월부터 8세 유치부 학생을 확인해 주세요.</span></span>
        <span class="kinderTransferBannerCount">${transferCandidates.length}명</span>
      </button>`
    : '';
  const hasInactiveSearchResult = searchMode && Boolean(pausedHtml || withdrawnHtml);
  const activeEmptyHtml = activeHtml || hasInactiveSearchResult ? '' : `<div class="recordEmpty">${searchMode ? '검색된 학생이 없습니다.' : '등록된 재원생이 없습니다.'}</div>`;
  const nextHtml = transferBannerHtml + activeHtml
    + activeEmptyHtml
    + renderPhoneRecordStatusSection('kinder', 'paused', '휴원', pausedHtml, '휴원생이 없습니다.', searchMode)
    + renderPhoneRecordStatusSection('kinder', 'withdrawn', '퇴원', withdrawnHtml, '최근 한 달 내 퇴원생이 없습니다.', searchMode);
  applyPhoneRecordRosterHtml(list, 'kinder', name, nextHtml);
  syncPhoneRecordInitialSortLabel();
  notifyPhoneRecordListRendered('kinder', name);
}

