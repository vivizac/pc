/* Phone-only student picker extensions: feedback status dots, archive sheet, and phone menu coordination. */

function isMemoStudentFeedbackDateInCurrentMonth(value) {
  if (!value) return false;
  const normalized = String(value).replace(/\./g, '-');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function hasMemoStudentCurrentMonthFeedbackSaved(student) {
  if (!student?.id) return false;
  const info = getMemoStudentFeedbackMonthInfo(student);
  if (!info.current) return false;
  const currentMonth = new Date().getMonth() + 1;
  const items = getMemoFeedbackArchiveItems(student);
  return items.some(item => {
    if (!String(item?.content || '').trim()) return false;
    const explicitMonth = Number(item?.feedbackMonthNumber || item?.row?.feedback_month_number || 0);
    if (explicitMonth === currentMonth) return true;
    const rawMonthText = String(item?.feedbackMonth || item?.row?.feedback_month || '').trim();
    if (rawMonthText && normalizeElementaryGroupMonths(rawMonthText).includes(currentMonth)) return true;
    return isMemoStudentFeedbackDateInCurrentMonth(item?.createdAt || item?.created_at || item?.row?.created_at || item?.row?.updated_at || item?.row?.date || item?.date);
  });
}

function renderMemoStudentFeedbackStatusDot(student) {
  const completed = hasMemoStudentCurrentMonthFeedbackSaved(student);
  return `<span class="memoStudentFeedbackDot ${completed ? 'completed' : ''}" aria-hidden="true"></span>`;
}

function renderMemoStudentSelectPopup() {
  const popup = document.getElementById('memoStudentSelectPopup');
  if (!popup) return;
  const state = readMemoStudentPickerSortState();
  const manageMode = isMemoStudentPickerManageMode();
  const students = getMemoStudentsForPicker();
  const title = manageMode ? '원생 설정' : '원생 목록';
  if (!students.length) {
    const emptyText = state.day && !manageMode ? `${state.day}요일 등원 학생이 없습니다.` : '등록된 초등부 학생이 없습니다.';
    popup.innerHTML = `${renderMemoStudentPickerHeader(title)}<div class="memoStudentSelectList"><div class="memoStudentSelectEmpty">${escapeHtml(emptyText)}</div></div>${renderMemoStudentPickerSortControls()}`;
    return;
  }
  const rows = [];
  let lastDividerKey = '';
  students.forEach(student => {
    const active = !manageMode && currentMemoStudent && String(currentMemoStudent.id) === String(student.id);
    const meta = getElementaryMetaText(student);
    const studentId = escapeHtml(String(student.id || ''));
    const monthInfo = getMemoStudentFeedbackMonthInfo(student);
    if (!manageMode && state.group && monthInfo.key !== lastDividerKey) {
      rows.push(renderMemoStudentMonthDivider(monthInfo.label));
      lastDividerKey = monthInfo.key;
    }
    const dot = !manageMode ? renderMemoStudentFeedbackStatusDot(student) : '';
    const textBlock = `${dot}<span class="memoStudentSelectName">${escapeHtml(student.name || '이름 없음')}</span>${meta ? `<span class="memoStudentSelectMeta">${escapeHtml(meta)}</span>` : ''}`;
    if (manageMode) {
      rows.push(`<div class="memoStudentSelectOption manageMode">
        <span class="memoStudentSelectTextBlock">${textBlock}</span>
        <button type="button" class="memoStudentInfoDotsBtn" onclick="openElementaryRecordsMenuForStudent('${studentId}', event)" aria-label="보관함 열기">•••</button>
      </div>`);
      return;
    }
    rows.push(`<div class="memoStudentSelectOption ${active ? 'active' : ''}">
      <button type="button" class="memoStudentSelectNameBtn" data-memo-student-id="${studentId}">${textBlock}</button>
    </div>`);
  });
  popup.innerHTML = `${renderMemoStudentPickerHeader(title)}<div class="memoStudentSelectList">${rows.join('')}</div>${renderMemoStudentPickerSortControls()}`;
}

function toggleMemoStudentSelectPopup(event) {
  if (event) event.stopPropagation();
  if (currentMemoType !== 'elementary') return;
  closeElementaryRecordsMenu();
  const popup = document.getElementById('memoStudentSelectPopup');
  if (!popup) return;
  renderMemoStudentSelectPopup();
  popup.classList.toggle('show');
}

function getMemoFeedbackArchivePreviewText(content) {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  return text.length > 78 ? `${text.slice(0, 78)}…` : text;
}
function getMemoFeedbackArchivePurpose(item) {
  const sourceTable = String(item?.sourceTable || item?.row?.source_table || '').trim().toLowerCase();
  const rawType = String(item?.feedbackType || item?.row?.feedback_type || '').trim().toLowerCase();
  if (sourceTable === 'fail_feedbacks' || rawType === 'fail') return 'fail';
  if (rawType === 'growth') return 'growth';
  if (rawType === 'class') return 'class';
  return 'legacy';
}
function getMemoFeedbackArchiveNoteTitle(item) {
  const purpose = getMemoFeedbackArchivePurpose(item);
  const label = purpose === 'class'
    ? '수업 피드백'
    : purpose === 'growth'
      ? '성장 피드백'
      : purpose === 'fail'
        ? '실패-성장 피드백'
        : '성장노트';
  const explicitMonth = Number(item?.feedbackMonthNumber || item?.row?.feedback_month_number || 0);
  if (explicitMonth) return `${explicitMonth}월 ${label}`;
  const monthText = String(item?.feedbackMonth || item?.row?.feedback_month || '').trim();
  const monthMatch = monthText.match(/(\d{1,2})/);
  if (monthMatch) return `${Number(monthMatch[1])}월 ${label}`;
  const rawDate = String(item?.createdAt || item?.row?.created_at || item?.row?.updated_at || item?.row?.date || '').trim();
  const date = new Date(rawDate);
  if (!Number.isNaN(date.getTime())) return `${date.getMonth() + 1}월 ${label}`;
  const match = rawDate.match(/(?:^|\D)(\d{1,2})\s*[월.]/);
  return match ? `${Number(match[1])}월 ${label}` : label;
}
function getMemoFeedbackArchiveSavedAt(item) {
  const row = item?.row || {};
  const candidates = [
    row.created_at,
    item?.created_at,
    item?.savedAt,
    item?.saved_at,
    item?.createdAt,
    row.updated_at,
    item?.updatedAt,
    item?.updated_at,
    row.date,
    item?.date
  ];
  for (const value of candidates) {
    if (formatMemoFeedbackArchiveDate(value)) return value;
  }
  const localIdMatch = String(item?.id || '').match(/^memo_feedback_(\d{10,})_/);
  if (localIdMatch) {
    const timestamp = Number(localIdMatch[1]);
    if (Number.isFinite(timestamp) && formatMemoFeedbackArchiveDate(timestamp)) return timestamp;
  }
  return '';
}
function getMemoFeedbackArchiveMonthInfo(item) {
  const savedAt = getMemoFeedbackArchiveSavedAt(item);
  const savedDate = savedAt ? new Date(savedAt) : null;
  const hasSavedDate = Boolean(savedDate && !Number.isNaN(savedDate.getTime()));
  const explicitMonth = Number(item?.feedbackMonthNumber || item?.row?.feedback_month_number || 0);
  const monthText = String(item?.feedbackMonth || item?.row?.feedback_month || '').trim();
  const monthMatch = monthText.match(/(\d{1,2})/);
  const textMonth = monthMatch ? Number(monthMatch[1]) : 0;
  const month = explicitMonth >= 1 && explicitMonth <= 12
    ? explicitMonth
    : (textMonth >= 1 && textMonth <= 12
      ? textMonth
      : (hasSavedDate ? savedDate.getMonth() + 1 : 0));

  if (!month) {
    return { key: 'undated', label: '기타', month: 0, year: 0, sortValue: -1 };
  }

  const year = hasSavedDate ? savedDate.getFullYear() : new Date().getFullYear();
  return {
    key: `${year}-${String(month).padStart(2, '0')}`,
    label: `${month}월`,
    month,
    year,
    sortValue: (year * 100) + month
  };
}

function getMemoFeedbackArchiveMonthGroups(items) {
  const groups = new Map();
  (Array.isArray(items) ? items : []).forEach(item => {
    const info = getMemoFeedbackArchiveMonthInfo(item);
    if (!groups.has(info.key)) groups.set(info.key, { ...info, count: 0 });
    groups.get(info.key).count += 1;
  });
  return Array.from(groups.values()).sort((a, b) => b.sortValue - a.sortValue);
}

function renderMemoFeedbackArchiveMonthCapsules(groups, selectedMonthKey) {
  const list = Array.isArray(groups) ? groups : [];
  if (!list.length) return '';
  return `<div class="memoFeedbackArchiveMonthRow" role="tablist" aria-label="피드백 월 선택">
    ${list.map(group => {
      const active = group.key === selectedMonthKey;
      return `<button type="button" class="memoFeedbackArchiveMonthBtn ${active ? 'active' : ''}" data-memo-archive-month="${escapeHtml(group.key)}" aria-selected="${active ? 'true' : 'false'}" role="tab" onclick="event.stopPropagation(); selectMemoFeedbackArchiveMonth('${escapeHtml(group.key)}')">${escapeHtml(group.label)}</button>`;
    }).join('')}
  </div>`;
}

function selectMemoFeedbackArchiveMonth(monthKey) {
  const menu = document.getElementById('elementaryRecordsDropup');
  if (!menu) return;
  const key = String(monthKey || '').trim();
  menu.dataset.memoArchiveSelectedMonth = key;
  menu.querySelectorAll('.memoFeedbackArchiveMonthBtn').forEach(button => {
    const active = button.dataset.memoArchiveMonth === key;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  menu.querySelectorAll('.memoFeedbackArchiveCard').forEach(card => {
    card.hidden = card.dataset.memoArchiveMonth !== key;
  });
}
window.selectMemoFeedbackArchiveMonth = selectMemoFeedbackArchiveMonth;

function buildMemoFeedbackArchiveCards(items, emptyMessage = '아직 저장된 피드백이 없습니다.<br>피드백을 생성하면 이곳에 바로 저장됩니다.', selectedMonthKey = '') {
  const list = Array.isArray(items) ? items : [];
  return list.length
    ? list.map((item, index) => {
        const cardId = item.id || `memo_archive_${index}`;
        const dateText = formatMemoFeedbackArchiveDate(getMemoFeedbackArchiveSavedAt(item)) || '날짜 정보 없음';
        const content = item.content || '';
        const noteTitle = getMemoFeedbackArchiveNoteTitle(item);
        const monthInfo = getMemoFeedbackArchiveMonthInfo(item);
        const hiddenAttr = selectedMonthKey && monthInfo.key !== selectedMonthKey ? ' hidden' : '';
        return `<article class="memoFeedbackArchiveCard" data-memo-archive-id="${escapeHtml(String(cardId))}" data-memo-archive-month="${escapeHtml(monthInfo.key)}"${hiddenAttr} onclick="toggleMemoFeedbackArchiveCard('${escapeHtml(String(cardId))}')">
          <div class="memoFeedbackArchiveText" data-memo-preview="${escapeHtml(noteTitle)}">${escapeHtml(noteTitle)}</div>
          <div class="memoFeedbackArchiveDate">${escapeHtml(dateText)}</div>
          <div class="memoFeedbackArchiveFullText">${escapeHtml(content)}</div>
          <textarea class="memoFeedbackArchiveEditArea" onclick="event.stopPropagation()">${escapeHtml(content)}</textarea>
          <div class="memoFeedbackArchiveActions" onclick="event.stopPropagation()">
            <button type="button" class="memoFeedbackArchiveActionBtn memoFeedbackArchiveCopyBtn" onclick="copyMemoFeedbackArchiveItem('${escapeHtml(String(cardId))}', this)">복사</button>
            <button type="button" class="memoFeedbackArchiveActionBtn memoFeedbackArchiveEditBtn" onclick="enterMemoFeedbackArchiveEdit('${escapeHtml(String(cardId))}')">수정</button>
            <button type="button" class="memoFeedbackArchiveActionBtn memoFeedbackArchiveCancelBtn" onclick="cancelMemoFeedbackArchiveEdit('${escapeHtml(String(cardId))}')">취소</button>
            <button type="button" class="memoFeedbackArchiveActionBtn primary memoFeedbackArchiveSaveBtn" onclick="saveMemoFeedbackArchiveEdit('${escapeHtml(String(cardId))}', this)">저장</button>
          </div>
        </article>`;
      }).join('')
    : `<div class="memoFeedbackArchiveEmpty">${emptyMessage}</div>`;
}
function toggleMemoFeedbackArchiveCard(id) {
  const card = document.querySelector(`[data-memo-archive-id="${CSS.escape(String(id))}"]`);
  if (!card) return;
  if (card.classList.contains('editing')) return;
  const nextOpen = !card.classList.contains('open');
  card.classList.toggle('open', nextOpen);
  const textEl = card.querySelector('.memoFeedbackArchiveText');
  if (textEl) textEl.textContent = textEl.dataset.memoPreview || '';
}
function getMemoFeedbackArchiveItemById(id) {
  if (!currentMemoStudent) return null;
  return getMemoFeedbackArchiveItems(currentMemoStudent).find(item => String(item?.id || '') === String(id || '')) || null;
}
function replaceMemoFeedbackArchiveItem(student, id, patch = {}) {
  if (!student?.id) return null;
  const items = getMemoFeedbackArchiveItems(student);
  let updatedItem = null;
  const next = items.map(item => {
    if (String(item?.id || '') !== String(id || '')) return item;
    updatedItem = { ...item, ...patch };
    if (updatedItem.row) updatedItem.row = { ...updatedItem.row, content: updatedItem.content, updated_at: new Date().toISOString() };
    return updatedItem;
  });
  setMemoFeedbackArchiveItems(student, next);
  return updatedItem;
}
function enterMemoFeedbackArchiveEdit(id) {
  const card = document.querySelector(`[data-memo-archive-id="${CSS.escape(String(id))}"]`);
  if (!card) return;
  card.classList.add('open');
  const full = card.querySelector('.memoFeedbackArchiveFullText');
  const area = card.querySelector('.memoFeedbackArchiveEditArea');
  if (area) {
    const fullHeight = full ? Math.max(full.scrollHeight, full.getBoundingClientRect().height) : 0;
    card.classList.add('editing');
    area.style.height = `${Math.max(120, Math.ceil(fullHeight || area.scrollHeight))}px`;
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  } else {
    card.classList.add('editing');
  }
}
function cancelMemoFeedbackArchiveEdit(id) {
  const card = document.querySelector(`[data-memo-archive-id="${CSS.escape(String(id))}"]`);
  const item = getMemoFeedbackArchiveItemById(id);
  if (!card) return;
  const area = card.querySelector('.memoFeedbackArchiveEditArea');
  if (area && item) {
    area.value = item.content || '';
    area.style.height = '';
  }
  card.classList.remove('editing');
}
async function copyMemoFeedbackArchiveItem(id, btn = null) {
  const item = getMemoFeedbackArchiveItemById(id);
  const text = String(item?.content || '').trim();
  if (!text) return;

  let copied = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch (_) {}

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
      copied = document.execCommand('copy');
      temp.remove();
    } catch (_) {
      copied = false;
    }
  }

  if (copied) {
    if (btn) showOlliCopySuccess(btn);
    showPushToast('피드백을 복사했어요.');
  } else {
    showPushToast('복사에 실패했어요.');
  }
}
function getMemoFeedbackArchiveSourceTable(item) {
  const table = String(item?.sourceTable || item?.row?.source_table || '').trim();
  if (table) return table;
  const type = String(item?.feedbackType || item?.row?.feedback_type || '').toLowerCase();
  return type === 'fail' ? 'fail_feedbacks' : 'feedbacks';
}
function getMemoFeedbackArchiveEditFeature(tableName) {
  const table = String(tableName || '').trim();
  if (table === 'feedbacks') return 'general_feedback_edit';
  if (table === 'fail_feedbacks') return 'growth_feedback_edit';
  if (table === 'summary_feedbacks') return 'summary_feedback_edit';
  return '';
}
async function saveMemoFeedbackArchiveEditViaCommonStorage(tableName, rowId, student, patch) {
  const feature = getMemoFeedbackArchiveEditFeature(tableName);
  const academyId = getOlliCurrentAcademyId();
  const studentId = String(student?.id || '').trim();
  const recordId = String(rowId || '').trim();
  if (!feature) throw new Error(`지원하지 않는 피드백 수정 테이블입니다: ${tableName}`);
  if (!academyId || !studentId || !recordId) throw new Error('피드백 수정 저장 식별값이 없습니다.');
  if (typeof saveOlliData !== 'function') throw new Error('공통 저장 함수가 준비되지 않았습니다.');
  const result = await saveOlliData(feature, {
    academyId,
    studentId,
    recordId,
    data: patch,
    forceCommon: true
  });
  if (!result || !result.serverSaved || !result.verified) {
    const error = result && result.error ? result.error : new Error('피드백 수정 서버 저장이 완료되지 않았습니다.');
    throw error;
  }
  return result.serverRow || (Array.isArray(result.serverRows) ? result.serverRows[0] : result.serverRows) || null;
}
async function saveMemoFeedbackArchiveEdit(id, btn = null) {
  if (!currentMemoStudent) return;
  const card = document.querySelector(`[data-memo-archive-id="${CSS.escape(String(id))}"]`);
  const area = card?.querySelector?.('.memoFeedbackArchiveEditArea');
  const item = getMemoFeedbackArchiveItemById(id);
  const content = String(area?.value || '').trim();
  if (!card || !area || !item) return;
  if (!content) {
    showPushToast('저장할 피드백 내용이 비어 있어요.');
    return;
  }
  try {
    if (btn) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent || '저장';
      btn.textContent = '저장 중...';
    }
    const tableName = getMemoFeedbackArchiveSourceTable(item);
    const rowId = item?.row?.id || item.id;
    const patch = { content, updated_at: new Date().toISOString() };
    let savedRow = null;
    if (rowId && !String(rowId).startsWith('memo_feedback_') && isSupabaseConfigured()) {
      savedRow = await saveMemoFeedbackArchiveEditViaCommonStorage(tableName, rowId, currentMemoStudent, patch);
    }
    const updated = replaceMemoFeedbackArchiveItem(currentMemoStudent, id, {
      content,
      createdAt: item.createdAt || new Date().toISOString(),
      row: item.row ? { ...item.row, ...patch, ...(savedRow || {}) } : (savedRow || item.row)
    });
    const full = card.querySelector('.memoFeedbackArchiveFullText');
    if (full) full.textContent = content;
    area.value = content;
    area.style.height = '';
    card.classList.remove('editing');
    showPushToast(updated ? '수정한 피드백을 저장했어요.' : '수정 내용을 저장했어요.');
    if (typeof refreshRecordsAfterFeedbackSave === 'function') refreshRecordsAfterFeedbackSave().catch(err => console.warn('기록 갱신 실패:', err));
  } catch (err) {
    console.error('피드백 보관함 수정 저장 오류:', err);
    alert(`수정 내용 저장 중 오류가 발생했어요.\n\n${err.message || '알 수 없는 오류입니다.'}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || '저장';
      delete btn.dataset.originalText;
    }
  }
}
function ensureMemoFeedbackArchiveSheet(menu) {
  if (!menu) return null;
  let sheet = menu.querySelector('.memoFeedbackArchiveSheet');
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.className = 'memoFeedbackArchiveSheet';
    sheet.addEventListener('click', event => event.stopPropagation());
    sheet.innerHTML = `
      <div class="memoFeedbackArchiveHandle"></div>
      <div class="memoFeedbackArchiveHead">
        <div class="memoFeedbackArchiveTitleWrap">
          <div class="memoFeedbackArchiveTitle">피드백 보관함</div>
          <div class="memoFeedbackArchiveSubtitle"></div>
        </div>
        <button type="button" class="memoFeedbackArchiveClose" onclick="event.stopPropagation(); closeElementaryRecordsMenu();" aria-label="닫기">&times;</button>
      </div>
      <div class="memoFeedbackArchiveContent"></div>`;
    menu.replaceChildren(sheet);
  }
  menu.onclick = function(event) {
    if (event.target === menu) closeElementaryRecordsMenu();
  };
  return sheet;
}

function renderMemoFeedbackArchiveSheet(menu, student, items, subtitle = '', selectedMonthKey = '') {
  if (!menu || !student) return;
  const sheet = ensureMemoFeedbackArchiveSheet(menu);
  if (!sheet) return;

  const monthGroups = getMemoFeedbackArchiveMonthGroups(items);
  const requestedMonthKey = String(selectedMonthKey || '').trim();
  const selectedMonth = monthGroups.some(group => group.key === requestedMonthKey)
    ? requestedMonthKey
    : (monthGroups[0]?.key || '');
  const openCardIds = new Set(
    Array.from(sheet.querySelectorAll('.memoFeedbackArchiveCard.open'))
      .map(card => String(card.dataset.memoArchiveId || ''))
      .filter(Boolean)
  );
  const previousScrollTop = sheet.scrollTop;

  menu.dataset.memoArchiveSelectedMonth = selectedMonth;
  const subtitleEl = sheet.querySelector('.memoFeedbackArchiveSubtitle');
  const contentEl = sheet.querySelector('.memoFeedbackArchiveContent');
  if (subtitleEl) subtitleEl.textContent = subtitle || `${student.name || ''} 받은 피드백을 최신순으로 확인해요.`;
  if (contentEl) {
    contentEl.innerHTML = `${renderMemoFeedbackArchiveMonthCapsules(monthGroups, selectedMonth)}
      ${buildMemoFeedbackArchiveCards(items, undefined, selectedMonth)}`;
    contentEl.querySelectorAll('.memoFeedbackArchiveCard').forEach(card => {
      if (openCardIds.has(String(card.dataset.memoArchiveId || ''))) card.classList.add('open');
    });
  }
  sheet.scrollTop = previousScrollTop;
}

function renderMemoFeedbackArchiveLoadError(menu, error) {
  const sheet = ensureMemoFeedbackArchiveSheet(menu);
  if (!sheet) return;
  const subtitleEl = sheet.querySelector('.memoFeedbackArchiveSubtitle');
  const contentEl = sheet.querySelector('.memoFeedbackArchiveContent');
  if (subtitleEl) subtitleEl.textContent = '서버 연결을 확인해 주세요.';
  if (contentEl) {
    contentEl.innerHTML = `<div class="memoFeedbackArchiveEmpty">슈파베이스 피드백을 불러오지 못했어요.<br>${escapeHtml(error?.message || '알 수 없는 오류입니다.')}</div>`;
  }
}

function getMemoFeedbackArchiveItemsSignature(items) {
  return JSON.stringify((Array.isArray(items) ? items : []).map(item => ({
    id: String(item?.id || item?.row?.id || ''),
    content: String(item?.content || ''),
    createdAt: String(item?.createdAt || item?.created_at || item?.row?.created_at || ''),
    updatedAt: String(item?.updatedAt || item?.updated_at || item?.row?.updated_at || ''),
    feedbackType: String(item?.feedbackType || item?.feedback_type || item?.row?.feedback_type || '')
  })).sort((a, b) => a.id.localeCompare(b.id) || a.createdAt.localeCompare(b.createdAt)));
}

function refreshElementaryRecordsMenuFromServer(menu, student, localItems) {
  const studentId = String(student?.id || '');
  const localSignature = getMemoFeedbackArchiveItemsSignature(localItems);
  Promise.resolve()
    .then(() => loadMemoFeedbackArchiveItemsFromSupabase(student))
    .then(remoteItems => {
      if (!currentMemoStudent || String(currentMemoStudent.id || '') !== studentId) return false;
      const safeRemoteItems = Array.isArray(remoteItems) ? remoteItems : [];
      if (getMemoFeedbackArchiveItemsSignature(safeRemoteItems) === localSignature) return true;
      if (menu.classList.contains('show') && menu.querySelector('.memoFeedbackArchiveCard.editing')) return true;
      renderMemoFeedbackArchiveSheet(menu, student, safeRemoteItems, '', menu.dataset.memoArchiveSelectedMonth || '');
      return true;
    })
    .catch(err => {
      console.error('관찰노트 보관함 불러오기 오류:', err);
      if (!currentMemoStudent || String(currentMemoStudent.id || '') !== studentId) return false;
      if (!localItems.length) renderMemoFeedbackArchiveLoadError(menu, err);
      return false;
    });
}

function renderElementaryRecordsMenu() {
  const menu = document.getElementById('elementaryRecordsDropup');
  if (!menu || !currentMemoStudent || !['elementary', 'kinder'].includes(currentMemoType)) return false;

  const student = currentMemoStudent;
  const localItems = getMemoFeedbackArchiveItems(student);
  renderMemoFeedbackArchiveSheet(menu, student, localItems);
  refreshElementaryRecordsMenuFromServer(menu, student, localItems);
  return true;
}
function openElementaryRecordsMenuForStudent(studentId, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const student = typeof findStudentById === 'function' ? findStudentById(studentId) : null;
  if (!student) return;
  const studentDivision = student.type === 'kinder' ? 'kinder' : 'elementary';
  currentMemoStudent = student;
  currentMemoType = studentDivision;
  if (studentDivision === 'elementary' && typeof setLastElementaryMemoStudent === 'function') setLastElementaryMemoStudent(student);
  if (typeof closeMemoStudentSelectPopup === 'function') closeMemoStudentSelectPopup();
  const menu = document.getElementById('elementaryRecordsDropup');
  if (!menu) return;
  if (menu.parentElement !== document.body) document.body.appendChild(menu);
  menu.classList.remove('show');
  renderElementaryRecordsMenu();
  requestAnimationFrame(() => menu.classList.add('show'));
}
window.openElementaryRecordsMenuForStudent = openElementaryRecordsMenuForStudent;

function toggleElementaryRecordsMenu(event) {
  if (event) event.stopPropagation();
  if (!currentMemoStudent || !['elementary', 'kinder'].includes(currentMemoType)) return;
  closeMemoStudentSelectPopup();
  const menu = document.getElementById('elementaryRecordsDropup');
  if (!menu) return;
  if (menu.parentElement !== document.body) document.body.appendChild(menu);
  if (menu.classList.contains('show')) {
    closeElementaryRecordsMenu();
    return;
  }
  menu.classList.remove('show');
  renderElementaryRecordsMenu();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      menu.classList.add('show');
    });
  });
}
function closeElementaryRecordsMenu() {
  const menu = document.getElementById('elementaryRecordsDropup');
  if (menu) menu.classList.remove('show');
}
function openCurrentElementaryMemoRecord() { if (!currentMemoStudent) return; viewingArchivedElementaryRecord = false; const memo = document.getElementById('memoEditor'); if (memo) { memo.readOnly = false; memo.value = getMemoByStudent(currentMemoStudent, 'elementary_observation'); } if (currentMemoType === 'elementary') { const __displayAnalysis = getPrimaryElementaryAnalysisDisplay(currentMemoStudent); selectedElementaryAnalysisHistoryId = ''; renderElementaryAnalysisSummaryCard(__displayAnalysis.data || {}, { title: '분석 결과', createdAt: __displayAnalysis.createdAt || '' }); renderElementaryAnalysisHistoryCards(currentMemoStudent); requestAnimationFrame(forceRenderCurrentElementaryAnalysisResult); setTimeout(forceRenderCurrentElementaryAnalysisResult, 80); } setMemoSaveStatus('자동 저장'); closeElementaryRecordsMenu(); }
function openArchivedElementaryMemoRecord(recordId) { if (!currentMemoStudent) return; if (!viewingArchivedElementaryRecord) saveCurrentMemo({ silent: true }); const record = getElementaryMemoRecords(currentMemoStudent).find(item => item.id === recordId); if (!record) return; viewingArchivedElementaryRecord = record.id; const memo = document.getElementById('memoEditor'); if (memo) { memo.value = record.content || ''; memo.readOnly = true; } selectedElementaryAnalysisHistoryId = '';
renderElementaryAnalysisSummaryCard(record.analysis || {}, { title: '분석 결과', createdAt: record.createdAt || '' }); renderElementaryAnalysisHistoryCards(currentMemoStudent); setMemoSaveStatus((record.label || formatElementaryRecordLabel(record)) + ' · 읽기 전용'); closeElementaryRecordsMenu(); }

/* Phone-only archive outside-click coordination. */
document.addEventListener('click', (event) => {
  const archiveBtn = document.getElementById('memoRecordsBtn');
  const archiveSheet = document.querySelector('#elementaryRecordsDropup .memoFeedbackArchiveSheet');
  if (archiveBtn && archiveSheet && !archiveBtn.contains(event.target) && !archiveSheet.contains(event.target)) closeElementaryRecordsMenu();
});
