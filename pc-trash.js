(function recordTrashModule(global) {
  'use strict';

  const SESSION_KEY = 'olli_account_session_token_v1';
  const state = { loading: false, restoring: '', items: [] };

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
  async function rpc(name, payload) {
    if (typeof global.supabase !== 'function') throw new Error('휴지통 서버 연결을 찾지 못했습니다.');
    const response = await global.supabase('POST', `rpc/${name}`, payload);
    const data = Array.isArray(response) && response.length === 1 ? response[0] : response;
    if (!data || data.ok === false) throw new Error(data?.message || '휴지통 요청을 처리하지 못했습니다.');
    return data;
  }
  function formatDate(value) {
    const date = new Date(value || '');
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  }
  function ensureOverlay() {
    let overlay = document.getElementById('olliRecordTrashOverlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'olliRecordTrashOverlay';
    overlay.tabIndex = -1;
    overlay.innerHTML = '<section class="olliRecordTrashDialog" role="dialog" aria-modal="true" aria-labelledby="olliRecordTrashTitle">'
      + '<header><div><h2 id="olliRecordTrashTitle">휴지통</h2><p>삭제한 관찰기록과 종합 성장 기록을 복구할 수 있습니다.</p></div>'
      + '<button type="button" class="olliRecordTrashClose" aria-label="휴지통 닫기">×</button></header>'
      + '<div class="olliRecordTrashBody" aria-live="polite"></div></section>';
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    overlay.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
    overlay.querySelector('.olliRecordTrashClose').addEventListener('click', close);
    overlay.querySelector('.olliRecordTrashBody').addEventListener('click', (event) => {
      const button = event.target.closest('[data-trash-restore]');
      if (button) restore(button.dataset.sourceTable, button.dataset.recordId);
    });
    document.body.appendChild(overlay);
    return overlay;
  }
  function render() {
    const body = ensureOverlay().querySelector('.olliRecordTrashBody');
    if (state.loading) {
      body.innerHTML = '<div class="olliRecordTrashStatus">삭제한 기록을 불러오고 있어요.</div>';
      return;
    }
    if (!state.items.length) {
      body.innerHTML = '<div class="olliRecordTrashEmpty"><strong>휴지통이 비어 있습니다.</strong><span>삭제한 관찰기록과 종합 성장 기록이 이곳에 표시됩니다.</span></div>';
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
  async function load() {
    state.loading = true;
    render();
    try {
      const data = await rpc('olli_record_trash_list', context());
      state.items = Array.isArray(data.items) ? data.items : [];
    } catch (error) {
      state.items = [];
      const body = ensureOverlay().querySelector('.olliRecordTrashBody');
      body.innerHTML = `<div class="olliRecordTrashStatus error">${esc(error.message || error)}</div>`;
      state.loading = false;
      return;
    }
    state.loading = false;
    render();
  }
  async function open() {
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
    if (document.getElementById('olliRecordTrashOverlay')?.classList.contains('show')) await load();
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

  global.OlliRecordTrash = Object.freeze({ open, close, move, load });
  global.pcOpenRecordTrash = open;
})(window);
