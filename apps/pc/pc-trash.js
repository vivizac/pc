(function recordTrashModule(global) {
  'use strict';

  const SESSION_KEY = 'olli_account_session_token_v1';
  const DEVICE_KEY = 'olli_account_device_id_v1';
  const state = {
    loading: false,
    restoring: '',
    items: [],
    conflictLoading: false,
    conflictRestoring: '',
    conflictItems: [],
    tab: 'deleted'
  };

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function esc(value) {
    return clean(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function academyId() {
    try { if (typeof global.getOlliCurrentAcademyId === 'function') return clean(global.getOlliCurrentAcademyId()); }
    catch (_) {}
    return clean(localStorage.getItem('olli_current_academy_id'));
  }
  function context(extra) {
    const id = academyId();
    const token = clean(localStorage.getItem(SESSION_KEY));
    if (!id || !token) throw new Error('로그인 정보가 만료되었습니다. 다시 로그인해 주세요.');
    return Object.assign({ p_session_token: token, p_academy_id: id }, extra || {});
  }
  function mutationId(prefix) {
    const safePrefix = clean(prefix) || 'recovery';
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return `${safePrefix}_${global.crypto.randomUUID()}`;
    return `${safePrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
  async function rpc(name, payload) {
    if (typeof global.supabase !== 'function') throw new Error('복구센터 서버 연결을 찾지 못했습니다.');
    const response = await global.supabase('POST', `rpc/${name}`, payload);
    const data = Array.isArray(response) && response.length === 1 ? response[0] : response;
    if (!data || data.ok === false) {
      const error = new Error(data?.message || '복구센터 요청을 처리하지 못했습니다.');
      error.code = data?.code || '';
      error.data = data || null;
      throw error;
    }
    return data;
  }
  function formatDate(value) {
    const date = new Date(value || '');
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).format(date);
  }
  function noteTypeLabel(value) {
    const type = clean(value);
    if (type === 'elementary_observation') return '초등 관찰노트';
    if (type === 'kinder_risk') return '유치부 메모';
    return '관찰노트';
  }
  function ensureOverlay() {
    let overlay = document.getElementById('olliRecordTrashOverlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'olliRecordTrashOverlay';
    overlay.tabIndex = -1;
    overlay.innerHTML = '<section class="olliRecordTrashDialog" role="dialog" aria-modal="true" aria-labelledby="olliRecordTrashTitle">'
      + '<header><div><h2 id="olliRecordTrashTitle">휴지통</h2><p>삭제된 기록과 여러 기기에서 충돌한 작성본을 안전하게 복구할 수 있습니다.</p></div>'
      + '<button type="button" class="olliRecordTrashClose" aria-label="휴지통 닫기">×</button></header>'
      + '<nav class="olliRecordTrashTabs" aria-label="복구 항목 종류">'
      + '<button type="button" data-trash-tab="deleted" class="active">삭제된 기록 <span data-trash-count="deleted"></span></button>'
      + '<button type="button" data-trash-tab="conflicts">충돌 작성본 <span data-trash-count="conflicts"></span></button>'
      + '</nav>'
      + '<div class="olliRecordTrashBody" aria-live="polite"></div></section>';
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) { close(); return; }
      const tabButton = event.target.closest('[data-trash-tab]');
      if (tabButton) {
        state.tab = tabButton.dataset.trashTab === 'conflicts' ? 'conflicts' : 'deleted';
        render();
        return;
      }
      const restoreButton = event.target.closest('[data-trash-restore]');
      if (restoreButton) {
        restore(restoreButton.dataset.sourceTable, restoreButton.dataset.recordId);
        return;
      }
      const conflictRestore = event.target.closest('[data-conflict-restore]');
      if (conflictRestore) {
        restoreConflict(conflictRestore.dataset.conflictId);
        return;
      }
      const copyButton = event.target.closest('[data-conflict-copy]');
      if (copyButton) copyConflictContent(copyButton.dataset.conflictId);
    });
    overlay.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
    overlay.querySelector('.olliRecordTrashClose').addEventListener('click', close);
    document.body.appendChild(overlay);
    return overlay;
  }
  function updateTabs() {
    const overlay = ensureOverlay();
    overlay.querySelectorAll('[data-trash-tab]').forEach((button) => {
      button.classList.toggle('active', button.dataset.trashTab === state.tab);
    });
    const deletedCount = overlay.querySelector('[data-trash-count="deleted"]');
    const conflictCount = overlay.querySelector('[data-trash-count="conflicts"]');
    if (deletedCount) deletedCount.textContent = state.items.length ? String(state.items.length) : '';
    if (conflictCount) conflictCount.textContent = state.conflictItems.length ? String(state.conflictItems.length) : '';
  }
  function renderDeleted(body) {
    if (state.loading) {
      body.innerHTML = '<div class="olliRecordTrashStatus">삭제한 기록을 불러오고 있어요.</div>';
      return;
    }
    if (!state.items.length) {
      body.innerHTML = '<div class="olliRecordTrashEmpty"><strong>삭제된 기록이 없습니다.</strong><span>삭제한 관찰기록과 종합 성장 기록이 이곳에 표시됩니다.</span></div>';
      return;
    }
    body.innerHTML = state.items.map((item) => {
      const type = item.record_type === 'summary_growth' ? '종합 성장 기록' : '관찰 기록';
      const key = `${item.source_table}:${item.record_id}`;
      const busy = state.restoring === key;
      const preview = clean(item.content).replace(/\s+/g, ' ');
      return `<article class="olliRecordTrashItem"><div class="olliRecordTrashItemTop"><div><span class="olliRecordTrashType ${item.record_type === 'summary_growth' ? 'summary' : ''}">${type}</span><strong>${esc(item.student_name || '학생')}</strong></div><button type="button" data-trash-restore data-source-table="${esc(item.source_table)}" data-record-id="${esc(item.record_id)}"${busy ? ' disabled' : ''}>${busy ? '복구 중…' : '복구'}</button></div><p>${esc(preview || '내용 없음')}</p><time>${esc(formatDate(item.deleted_at))} 삭제</time></article>`;
    }).join('');
  }
  function renderConflicts(body) {
    if (state.conflictLoading) {
      body.innerHTML = '<div class="olliRecordTrashStatus">충돌 작성본을 확인하고 있어요.</div>';
      return;
    }
    if (!state.conflictItems.length) {
      body.innerHTML = '<div class="olliRecordTrashEmpty"><strong>충돌 작성본이 없습니다.</strong><span>다른 기기의 최신 기록 때문에 저장되지 못한 작성본이 이곳에 안전하게 보관됩니다.</span></div>';
      return;
    }
    body.innerHTML = state.conflictItems.map((item) => {
      const id = clean(item.id);
      const busy = state.conflictRestoring === id;
      const rejected = String(item.rejected_content == null ? '' : item.rejected_content);
      const current = String(item.current_content == null ? '' : item.current_content);
      const rejectedDisplay = rejected.trim() ? rejected : '※ 이 기기에서는 내용을 비우려고 했습니다.';
      const currentDisplay = current.trim() ? current : '현재 서버 내용이 비어 있습니다.';
      const revisionMeta = `작성 기준 v${Number(item.base_revision || 0)} · 현재 v${Number(item.current_revision ?? item.server_revision ?? 0)}`;
      const deviceMeta = item.device_id ? ` · 기기 ${clean(item.device_id).slice(0, 16)}` : '';
      return `<article class="olliRecordTrashItem olliRecordConflictItem">
        <div class="olliRecordTrashItemTop"><div><span class="olliRecordTrashType conflict">${esc(noteTypeLabel(item.note_type))}</span><strong>${esc(item.student_name || '학생')}</strong></div><time>${esc(formatDate(item.created_at))}</time></div>
        <div class="olliRecordConflictMeta">${esc(revisionMeta + deviceMeta)}</div>
        <div class="olliRecordConflictCompare">
          <section><div class="olliRecordConflictLabel">보관된 작성본</div><div class="olliRecordConflictText">${esc(rejectedDisplay)}</div></section>
          <section><div class="olliRecordConflictLabel">현재 서버 내용</div><div class="olliRecordConflictText current">${esc(currentDisplay)}</div></section>
        </div>
        <div class="olliRecordConflictActions">
          <button type="button" class="secondary" data-conflict-copy data-conflict-id="${esc(id)}">작성본 복사</button>
          <button type="button" data-conflict-restore data-conflict-id="${esc(id)}"${busy ? ' disabled' : ''}>${busy ? '복구 중…' : '이 작성본으로 복구'}</button>
        </div>
      </article>`;
    }).join('');
  }
  function render() {
    const body = ensureOverlay().querySelector('.olliRecordTrashBody');
    updateTabs();
    if (state.tab === 'conflicts') renderConflicts(body);
    else renderDeleted(body);
  }
  async function loadDeleted() {
    state.loading = true;
    render();
    try {
      const data = await rpc('olli_record_trash_list', context());
      state.items = Array.isArray(data.items) ? data.items : [];
    } catch (error) {
      state.items = [];
      if (state.tab === 'deleted') {
        const body = ensureOverlay().querySelector('.olliRecordTrashBody');
        body.innerHTML = `<div class="olliRecordTrashStatus error">${esc(error.message || error)}</div>`;
      }
    } finally {
      state.loading = false;
      render();
    }
  }
  async function loadConflicts() {
    state.conflictLoading = true;
    render();
    try {
      const data = await rpc('olli_note_conflict_list', context());
      state.conflictItems = Array.isArray(data.items) ? data.items : [];
    } catch (error) {
      state.conflictItems = [];
      if (state.tab === 'conflicts') {
        const body = ensureOverlay().querySelector('.olliRecordTrashBody');
        body.innerHTML = `<div class="olliRecordTrashStatus error">${esc(error.message || error)}</div>`;
      }
    } finally {
      state.conflictLoading = false;
      render();
    }
  }
  async function load() {
    await Promise.all([loadDeleted(), loadConflicts()]);
    render();
  }
  async function open(options = {}) {
    state.tab = options.tab === 'conflicts' ? 'conflicts' : 'deleted';
    const overlay = ensureOverlay();
    overlay.classList.add('show');
    requestAnimationFrame(() => overlay.focus());
    await load();
  }
  function close() { document.getElementById('olliRecordTrashOverlay')?.classList.remove('show'); }
  async function move(sourceTable, recordId, reason) {
    const data = await rpc('olli_record_trash_move', context({
      p_source_table: clean(sourceTable), p_record_id: clean(recordId),
      p_reason: clean(reason) || 'manual_delete_from_student_record'
    }));
    if (document.getElementById('olliRecordTrashOverlay')?.classList.contains('show')) await loadDeleted();
    return data;
  }
  async function restore(sourceTable, recordId) {
    const key = `${sourceTable}:${recordId}`;
    if (state.restoring) return;
    state.restoring = key;
    render();
    try {
      await rpc('olli_record_trash_restore', context({ p_source_table: clean(sourceTable), p_record_id: clean(recordId) }));
      state.items = state.items.filter((item) => `${item.source_table}:${item.record_id}` !== key);
      if (typeof global.showPushToast === 'function') global.showPushToast('기록을 복구했어요.');
      global.dispatchEvent(new CustomEvent('olli:record-restored', { detail: { sourceTable, recordId } }));
    } catch (error) {
      alert(`기록을 복구하지 못했습니다.\n\n${error.message || error}`);
    } finally {
      state.restoring = '';
      render();
    }
  }
  async function copyConflictContent(conflictId) {
    const item = state.conflictItems.find((entry) => clean(entry.id) === clean(conflictId));
    if (!item) return;
    const text = String(item.rejected_content == null ? '' : item.rejected_content);
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }
      if (typeof global.showPushToast === 'function') global.showPushToast('작성본을 복사했어요.');
    } catch (error) {
      alert('작성본을 복사하지 못했습니다.');
    }
  }
  async function restoreConflict(conflictId) {
    const id = clean(conflictId);
    const item = state.conflictItems.find((entry) => clean(entry.id) === id);
    if (!item || state.conflictRestoring) return;
    const expectedRevision = Number(item.current_revision ?? item.server_revision ?? 0);
    const confirmed = confirm(`${item.student_name || '학생'} 학생의 보관된 작성본으로 현재 관찰노트를 복구할까요?\n\n복구 직전에 다른 기기에서 다시 수정됐다면 자동으로 중단됩니다.`);
    if (!confirmed) return;
    state.conflictRestoring = id;
    render();
    try {
      const data = await rpc('olli_note_conflict_restore', context({
        p_conflict_id: id,
        p_expected_revision: expectedRevision,
        p_mutation_id: mutationId('recovery'),
        p_device_id: clean(localStorage.getItem(DEVICE_KEY)) || null
      }));
      state.conflictItems = state.conflictItems.filter((entry) => clean(entry.id) !== id);
      if (typeof global.showPushToast === 'function') global.showPushToast('충돌 작성본을 관찰노트로 복구했어요.');
      global.dispatchEvent(new CustomEvent('olli:note-conflict-restored', {
        detail: {
          conflictId: id,
          studentId: data.student_id || item.student_id,
          noteType: data.note_type || item.note_type,
          revision: data.revision || null
        }
      }));
    } catch (error) {
      if (error.code === 'REVISION_CONFLICT') {
        alert('복구를 누른 뒤 다른 기기에서 기록이 다시 수정되었습니다.\n\n최신 내용을 다시 불러온 뒤 비교해 주세요.');
        await loadConflicts();
      } else {
        alert(`충돌 작성본을 복구하지 못했습니다.\n\n${error.message || error}`);
      }
    } finally {
      state.conflictRestoring = '';
      render();
    }
  }

  global.OlliRecordTrash = Object.freeze({ open, close, move, load, loadConflicts });
  global.pcOpenRecordTrash = open;
  global.pcOpenConflictRecovery = function pcOpenConflictRecovery() { return open({ tab: 'conflicts' }); };
})(window);
