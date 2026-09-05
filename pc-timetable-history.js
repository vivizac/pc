(function timetableHistoryModule(global) {
  'use strict';

  function create(ctx) {
    const {
      state, service, clean, weekdayLabel, timeLabel, shortDate, esc,
      dialogHead, openOverlay, renderDialog, loadWeek, notify
    } = ctx;

  function memoHistoryDetail(item) {
    const details = Array.isArray(item && item.details) ? item.details : [];
    return details.find((detail) => detail.table_name === 'olli_schedule_cell_memos') || null;
  }

  function memoHistoryText(value) {
    const text = clean(value).replace(/\s+/g, ' ');
    if (!text) return '메모 없음';
    return text.length > 48 ? `${text.slice(0, 48)}…` : text;
  }

  function historySubjectLabel(item) {
    const detail = memoHistoryDetail(item);
    if (!detail) return item && item.student_name || '학생';
    const data = detail.new_data || detail.old_data || {};
    return clean(data.division) === 'kinder' ? '유치부 메모' : (clean(data.division) === 'elementary' ? '초등부 메모' : '시간표 메모');
  }

  function historyActionLabel(item) {
    if (item && item.is_restore) return '이전 변경 복구';
    const memoDetail = memoHistoryDetail(item);
    if (memoDetail) {
      const oldNote = clean(memoDetail.old_data && memoDetail.old_data.note);
      const newNote = clean(memoDetail.new_data && memoDetail.new_data.note);
      if (memoDetail.operation === 'DELETE' || (oldNote && !newNote)) return '메모 삭제';
      if (memoDetail.operation === 'INSERT' || (!oldNote && newNote)) return '메모 추가';
      return '메모 수정';
    }
    const details = Array.isArray(item && item.details) ? item.details : [];
    const onlyWaitAdded = details.length && details.every((detail) => detail.table_name === 'olli_schedule_waitlist' && detail.operation === 'INSERT');
    if (onlyWaitAdded) return clean(item.action_name) === 'move' ? '수업 이동 대기 등록' : '수업 추가 대기 등록';
    return ({
      move: '수업 이동',
      add: '주간 수업 추가',
      remove: '주간 수업 삭제',
      wait_accept: '대기 학생 입장',
      wait_cancel: '대기 취소',
      makeup_add: '보강 등록',
      makeup_cancel: '보강 취소',
      scheduled_cancel: '변경 예약 취소',
      restore: '이전 변경 복구'
    })[clean(item && item.action_name)] || '시간표 변경';
  }

  function historyStatusLabel(data, tableName) {
    const status = clean(data && data.status);
    if (!status) return '';
    if (tableName === 'olli_schedule_waitlist') return ({ waiting: '대기', offered: '입장 안내', accepted: '입장 완료', cancelled: '대기 취소' })[status] || status;
    if (tableName === 'olli_schedule_one_time_sessions') return ({ scheduled: '보강', attended: '출석 완료', cancelled: '보강 취소' })[status] || status;
    if (tableName === 'olli_schedule_changes') return ({ scheduled: '변경 예약', applied: '적용', cancelled: '예약 취소' })[status] || status;
    return status === 'cancelled' ? '삭제' : '';
  }

  function historyPoint(data, tableName) {
    if (!data) return '';
    if (tableName === 'olli_schedule_cell_memos') {
      return `${shortDate(data.session_date)} ${timeLabel(data.time_slot)} · ${memoHistoryText(data.note)}`;
    }
    if (tableName === 'olli_schedule_enrollments') {
      const point = `${weekdayLabel(data.weekday)}요일 ${timeLabel(data.time_slot)}`;
      const status = historyStatusLabel(data, tableName);
      return `${point}${status ? ` · ${status}` : ''}`;
    }
    if (tableName === 'olli_schedule_waitlist') {
      const point = `${weekdayLabel(data.target_weekday)}요일 ${timeLabel(data.target_time_slot)}`;
      return `${point} · ${historyStatusLabel(data, tableName) || '대기'}`;
    }
    if (tableName === 'olli_schedule_one_time_sessions') {
      return `${shortDate(data.session_date)} ${timeLabel(data.time_slot)} · ${historyStatusLabel(data, tableName) || '보강'}`;
    }
    return '';
  }

  function historyComparison(item) {
    const details = Array.isArray(item && item.details) ? item.details : [];
    const action = clean(item && item.action_name);
    const enrollmentsChanged = details.filter((detail) => detail.table_name === 'olli_schedule_enrollments');
    const waitChanged = details.find((detail) => detail.table_name === 'olli_schedule_waitlist');
    const makeupChanged = details.find((detail) => detail.table_name === 'olli_schedule_one_time_sessions');
    const memoChanged = details.find((detail) => detail.table_name === 'olli_schedule_cell_memos');

    let before = '';
    let after = '';
    if (memoChanged) {
      const memoData = memoChanged.new_data || memoChanged.old_data || {};
      const point = `${shortDate(memoData.session_date)} ${timeLabel(memoData.time_slot)}`;
      before = memoChanged.old_data ? historyPoint(memoChanged.old_data, memoChanged.table_name) : `${point} · 메모 없음`;
      after = memoChanged.new_data ? historyPoint(memoChanged.new_data, memoChanged.table_name) : `${point} · 메모 삭제`;
    } else if (action === 'move') {
      const source = enrollmentsChanged.find((detail) => detail.operation === 'UPDATE');
      const target = enrollmentsChanged.find((detail) => detail.operation === 'INSERT');
      before = historyPoint(source && source.old_data, 'olli_schedule_enrollments');
      after = historyPoint(target && target.new_data, 'olli_schedule_enrollments')
        || historyPoint(waitChanged && waitChanged.new_data, 'olli_schedule_waitlist');
    } else if (action === 'add') {
      const target = enrollmentsChanged.find((detail) => detail.operation === 'INSERT');
      before = '추가 전';
      after = historyPoint(target && target.new_data, 'olli_schedule_enrollments')
        || historyPoint(waitChanged && waitChanged.new_data, 'olli_schedule_waitlist');
    } else if (action === 'remove') {
      const source = enrollmentsChanged.find((detail) => detail.operation === 'UPDATE');
      before = historyPoint(source && source.old_data, 'olli_schedule_enrollments');
      after = source && source.new_data && source.new_data.effective_to
        ? `${shortDate(source.new_data.effective_to)}까지 수업`
        : '수업 삭제';
    } else if (makeupChanged) {
      before = historyPoint(makeupChanged.old_data, makeupChanged.table_name) || '등록 전';
      after = historyPoint(makeupChanged.new_data, makeupChanged.table_name) || '등록 취소';
    } else if (waitChanged) {
      before = historyPoint(waitChanged.old_data, waitChanged.table_name) || '대기 전';
      after = historyPoint(waitChanged.new_data, waitChanged.table_name) || '대기 취소';
    }

    if (!before || !after) {
      const oldPoint = details.map((detail) => historyPoint(detail.old_data, detail.table_name)).find(Boolean);
      const newPoint = details.slice().reverse().map((detail) => historyPoint(detail.new_data, detail.table_name)).find(Boolean);
      before = before || oldPoint || '변경 전 상태';
      after = after || newPoint || '변경 후 상태';
    }
    return { before, after };
  }

  function historyDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function historyItemHtml(item) {
    const comparison = historyComparison(item);
    const restored = !!item.is_restored;
    const canRestore = !!item.can_restore && !item.is_restore && !restored && !memoHistoryDetail(item);
    return `<article class="olliTtHistoryItem ${restored ? 'restored' : ''} ${item.is_restore ? 'restoreRecord' : ''}">`
      + `<div class="olliTtHistoryItemTop"><div><span class="olliTtHistoryAction">${esc(historyActionLabel(item))}</span><strong>${esc(historySubjectLabel(item))}</strong></div><time>${esc(historyDateTime(item.created_at))}</time></div>`
      + `<div class="olliTtHistoryCompare"><span>${esc(comparison.before)}</span><i aria-hidden="true">→</i><span>${esc(comparison.after)}</span></div>`
      + `<div class="olliTtHistoryMeta"><span>${esc(item.actor_name || '기록 없음')} 수정</span>${restored ? '<b>복구 완료</b>' : item.is_restore ? '<b>복구 기록</b>' : ''}</div>`
      + (canRestore ? `<button type="button" class="olliTtHistoryRestoreBtn" data-tt-prepare-restore="${esc(item.transaction_id)}">이 변경만 복구</button>` : '')
      + '</article>';
  }

  function historyDialogHtml(dialog) {
    const data = dialog.data;
    let content = '<div class="olliTtHistoryLoading">변경 이력을 불러오고 있어요.</div>';
    if (!dialog.loading && dialog.error) content = `<div class="olliTtHistoryEmpty"><strong>변경 이력을 불러오지 못했어요.</strong><span>${esc(dialog.error)}</span><button type="button" data-tt-history-refresh>다시 불러오기</button></div>`;
    else if (!dialog.loading && data) {
      const items = Array.isArray(data.items) ? data.items : [];
      content = items.length ? `<div class="olliTtHistoryList">${items.map(historyItemHtml).join('')}</div>` : '<div class="olliTtHistoryEmpty"><strong>아직 저장된 변경이 없습니다.</strong><span>앞으로 발생하는 시간표 수정은 자동으로 기록됩니다.</span></div>';
    }
    const permissionText = data && data.can_restore
      ? '최근 30일 변경을 확인하고 한 건씩 안전하게 복구할 수 있습니다.'
      : '변경 내용은 확인할 수 있으며 복구는 원장·관리자만 가능합니다.';
    return dialogHead('↶', '시간표 변경 이력', permissionText)
      + `<div class="olliTtDialogBody olliTtHistoryBody"><div class="olliTtHistorySafety"><strong>자동 안전 기록</strong><span>시간표가 수정될 때마다 변경 전·후 상태를 서버에 저장합니다.</span></div>${content}`
      + '<div class="olliTtDialogActions"><button type="button" class="olliTtDialogCancel" data-tt-dialog-close>닫기</button><button type="button" class="olliTtDialogPrimary secondary" data-tt-history-refresh>새로고침</button></div></div>';
  }

  function restoreConfirmDialogHtml(dialog) {
    const item = dialog.item;
    const comparison = historyComparison(item);
    return dialogHead('!', '시간표 복구 확인', '버튼을 잘못 눌러도 바로 복구되지 않도록 한 번 더 확인합니다.')
      + '<div class="olliTtDialogBody olliTtRestoreConfirmBody">'
      + `<div class="olliTtRestoreTarget"><span>${esc(historyActionLabel(item))}</span><strong>${esc(historySubjectLabel(item))}</strong><div><b>${esc(comparison.after)}</b><i aria-hidden="true">→</i><b>${esc(comparison.before)}</b></div></div>`
      + '<div class="olliTtRestoreWarning"><strong>복구 후에도 기록은 사라지지 않습니다.</strong><span>복구 작업도 새로운 변경 이력으로 남습니다. 이후 같은 학생의 시간표가 다시 수정된 경우에는 서버가 복구를 자동으로 막습니다.</span></div>'
      + '<label class="olliTtRestoreCheck"><input type="checkbox" data-tt-restore-check><span>위의 변경 전·후 내용을 확인했습니다.</span></label>'
      + '<div class="olliTtDialogActions"><button type="button" class="olliTtDialogCancel" data-tt-back-history>이전</button><button type="button" class="olliTtDialogPrimary danger" data-tt-confirm-restore disabled>확인 후 복구</button></div></div>';
  }

  function openHistory() {
    state.dialog = { kind: 'history', loading: true, data: null, error: '' };
    openOverlay();
    loadHistoryIntoDialog();
  }

  async function loadHistoryIntoDialog() {
    const token = ++state.historyLoadToken;
    if (!state.dialog || state.dialog.kind !== 'history') return;
    state.dialog.loading = true;
    state.dialog.error = '';
    renderDialog();
    try {
      const data = await service.loadHistory(50);
      if (token !== state.historyLoadToken || !state.dialog || state.dialog.kind !== 'history') return;
      state.dialog.loading = false;
      state.dialog.data = data;
      renderDialog();
    } catch (error) {
      if (token !== state.historyLoadToken || !state.dialog || state.dialog.kind !== 'history') return;
      state.dialog.loading = false;
      state.dialog.error = error && (error.message || error) || '잠시 후 다시 시도해 주세요.';
      renderDialog();
    }
  }

  function prepareHistoryRestore(transactionId) {
    const historyData = state.dialog && state.dialog.kind === 'history' ? state.dialog.data : null;
    const items = Array.isArray(historyData && historyData.items) ? historyData.items : [];
    const item = items.find((row) => clean(row.transaction_id) === clean(transactionId));
    if (!item || !item.can_restore) return;
    state.dialog = { kind: 'restoreConfirm', item, historyData };
    renderDialog();
  }

  function backToHistory() {
    const historyData = state.dialog && state.dialog.historyData;
    state.dialog = { kind: 'history', loading: !historyData, data: historyData || null, error: '' };
    renderDialog();
    if (!historyData) loadHistoryIntoDialog();
  }

  async function restoreHistoryAction() {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== 'restoreConfirm' || state.saving) return;
    state.saving = true;
    const button = document.querySelector('[data-tt-confirm-restore]');
    if (button) { button.disabled = true; button.textContent = '복구 중…'; }
    try {
      await service.restoreHistory(dialog.item.transaction_id);
      state.saving = false;
      state.data = null;
      state.dataWeek = '';
      state.dataAcademyId = '';
      await loadWeek();
      notify(`${dialog.item.student_name || '학생'} 시간표를 변경 전 상태로 복구했어요.`);
      openHistory();
    } catch (error) {
      state.saving = false;
      renderDialog();
      alert(error && (error.message || error) || '시간표 복구에 실패했습니다.');
    }
  }


    return { historyActionLabel, historyStatusLabel, historyPoint, historyComparison, historyDateTime, historyItemHtml, historyDialogHtml, restoreConfirmDialogHtml, openHistory, loadHistoryIntoDialog, prepareHistoryRestore, backToHistory, restoreHistoryAction };
  }

  global.OlliTimetableHistoryModule = { create };
})(window);
