/* PC/Phone common observation memo version history UI.
   Uses revision-protected RPCs so viewing/restoring history never bypasses CAS safety. */
(function initObservationMemoVersionHistory(global) {
  'use strict';

  if (global.__olliObservationMemoVersionHistoryInstalled) return;
  global.__olliObservationMemoVersionHistoryInstalled = true;

  const NOTE_TYPE = 'elementary_observation';
  const OVERLAY_ID = 'olliMemoVersionHistoryOverlay';
  const BUTTON_ID = 'olliMemoVersionHistoryBtn';
  const STYLE_ID = 'olliMemoVersionHistoryStyle';
  const state = {
    student: null,
    items: [],
    currentRevision: 0,
    currentUpdatedAt: '',
    selectedRevision: null,
    loading: false,
    restoring: false
  };

  function text(value) { return String(value == null ? '' : value); }
  function clean(value) { return text(value).trim(); }
  function revision(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
  }
  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function sameStudent(a, b) {
    return !!a && !!b && clean(a.id) && clean(a.id) === clean(b.id);
  }
  function activeStudent() {
    const student = global.currentMemoStudent;
    if (!student || global.currentMemoType !== 'elementary') return null;
    return student;
  }
  function academyId() {
    try {
      if (typeof global.requireOlliAcademyId === 'function') return clean(global.requireOlliAcademyId('관찰노트 이전 기록'));
    } catch (_) {}
    try {
      if (typeof global.getOlliCurrentAcademyId === 'function') return clean(global.getOlliCurrentAcademyId());
    } catch (_) {}
    return clean(localStorage.getItem('olli_current_academy_id'));
  }
  function sessionToken() {
    return clean(localStorage.getItem('olli_account_session_token_v1'));
  }
  function deviceId() {
    try {
      if (typeof global.getOlliLoginDeviceId === 'function') {
        const value = clean(global.getOlliLoginDeviceId());
        if (value) return value;
      }
    } catch (_) {}
    return clean(localStorage.getItem('olli_device_id_v1'));
  }
  function mutationId() {
    try {
      if (typeof global.createObservationMemoMutationId === 'function') {
        const value = clean(global.createObservationMemoMutationId());
        if (value) return value;
      }
      if (global.crypto && typeof global.crypto.randomUUID === 'function') return `note_history_${global.crypto.randomUUID()}`;
    } catch (_) {}
    return `note_history_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
  function rpc(name, body) {
    if (typeof global.supabase !== 'function') {
      const error = new Error('관찰노트 서버 연결이 준비되지 않았습니다.');
      error.code = 'SERVER_UNAVAILABLE';
      throw error;
    }
    return global.supabase('POST', `rpc/${name}`, body);
  }
  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${y}.${m}.${d} ${hh}:${mm}`;
  }
  function sourceLabel(item) {
    const source = clean(item?.source);
    if (source === 'history_restore') {
      const from = revision(item?.source_revision);
      return from > 0 ? `버전 ${from}에서 복구` : '이전 기록에서 복구';
    }
    if (source === 'backfill_current') return '기준 저장본';
    if (source === 'insert') return '첫 저장';
    return '자동 저장';
  }
  function setStatus(message) {
    try { if (typeof global.setMemoSaveStatus === 'function') global.setMemoSaveStatus(message || ''); } catch (_) {}
  }
  function alertMessage(message) {
    try { global.alert(message); } catch (_) {}
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
#${BUTTON_ID}{position:relative;}
#${BUTTON_ID} svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;}
#${OVERLAY_ID}{position:fixed;inset:0;z-index:2147482500;display:none;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.26);padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
#${OVERLAY_ID}.show{display:flex;}
#${OVERLAY_ID} .olliMemoHistorySheet{width:min(560px,100%);max-height:min(78vh,720px);background:#fff;border-radius:28px 28px 0 0;box-shadow:0 -14px 48px rgba(0,0,0,.13);display:flex;flex-direction:column;overflow:hidden;padding-bottom:env(safe-area-inset-bottom);}
#${OVERLAY_ID} .olliMemoHistoryHandle{width:38px;height:4px;border-radius:999px;background:#d7d7d7;margin:9px auto 2px;flex:0 0 auto;}
#${OVERLAY_ID} .olliMemoHistoryHeader{min-height:58px;padding:8px 16px 8px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid rgba(0,0,0,.055);flex:0 0 auto;}
#${OVERLAY_ID} .olliMemoHistoryHeaderLeft{display:flex;align-items:center;gap:9px;min-width:0;}
#${OVERLAY_ID} .olliMemoHistoryBack,#${OVERLAY_ID} .olliMemoHistoryClose{width:36px;height:36px;border:0;background:transparent;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#111;font-family:inherit;font-size:20px;cursor:pointer;flex:0 0 auto;}
#${OVERLAY_ID} .olliMemoHistoryBack{display:none;font-size:23px;}
#${OVERLAY_ID}.preview .olliMemoHistoryBack{display:inline-flex;}
#${OVERLAY_ID} .olliMemoHistoryTitleWrap{min-width:0;}
#${OVERLAY_ID} .olliMemoHistoryTitle{font-size:16px;font-weight:800;color:#111;letter-spacing:-.045em;line-height:1.2;}
#${OVERLAY_ID} .olliMemoHistorySub{margin-top:3px;font-size:11px;color:#9a9a9a;letter-spacing:-.025em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
#${OVERLAY_ID} .olliMemoHistoryBody{overflow:auto;-webkit-overflow-scrolling:touch;padding:12px 14px 18px;min-height:170px;}
#${OVERLAY_ID} .olliMemoHistoryLoading,#${OVERLAY_ID} .olliMemoHistoryEmpty,#${OVERLAY_ID} .olliMemoHistoryError{min-height:190px;display:flex;align-items:center;justify-content:center;text-align:center;padding:30px 20px;font-size:13px;line-height:1.55;color:#8e8e93;}
#${OVERLAY_ID} .olliMemoHistoryList{display:grid;gap:8px;}
#${OVERLAY_ID} .olliMemoHistoryItem{width:100%;border:1px solid rgba(0,0,0,.06);background:#fafafa;border-radius:17px;padding:12px 13px;text-align:left;font-family:inherit;cursor:pointer;color:#111;display:block;}
#${OVERLAY_ID} .olliMemoHistoryItem.current{background:#fff;border-color:rgba(10,132,255,.24);}
#${OVERLAY_ID} .olliMemoHistoryItemTop{display:flex;align-items:center;justify-content:space-between;gap:10px;}
#${OVERLAY_ID} .olliMemoHistoryDate{font-size:12px;font-weight:750;color:#333;letter-spacing:-.025em;}
#${OVERLAY_ID} .olliMemoHistoryBadges{display:flex;align-items:center;gap:5px;flex:0 0 auto;}
#${OVERLAY_ID} .olliMemoHistoryBadge{height:21px;padding:0 7px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:#efefef;color:#8a8a8a;font-size:9.5px;font-weight:800;white-space:nowrap;}
#${OVERLAY_ID} .olliMemoHistoryBadge.current{background:#eef6ff;color:#0a84ff;}
#${OVERLAY_ID} .olliMemoHistoryMeta{margin-top:6px;font-size:10.5px;color:#aaa;letter-spacing:-.02em;}
#${OVERLAY_ID} .olliMemoHistoryPreviewText{margin-top:8px;font-size:12px;line-height:1.48;color:#666;letter-spacing:-.025em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;word-break:break-word;}
#${OVERLAY_ID} .olliMemoHistoryPreviewText.empty{color:#b4b4b4;font-style:normal;}
#${OVERLAY_ID} .olliMemoHistoryDetail{display:grid;gap:12px;}
#${OVERLAY_ID} .olliMemoHistoryDetailMeta{padding:0 2px;display:flex;align-items:center;justify-content:space-between;gap:10px;}
#${OVERLAY_ID} .olliMemoHistoryDetailDate{font-size:12px;font-weight:750;color:#333;}
#${OVERLAY_ID} .olliMemoHistoryDetailText{min-height:160px;max-height:42vh;overflow:auto;border-radius:18px;background:#f7f7f7;padding:15px 14px;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.66;color:#333;letter-spacing:-.025em;}
#${OVERLAY_ID} .olliMemoHistoryDetailText.empty{color:#aaa;}
#${OVERLAY_ID} .olliMemoHistoryGuide{font-size:11px;line-height:1.5;color:#999;padding:0 3px;letter-spacing:-.025em;}
#${OVERLAY_ID} .olliMemoHistoryRestoreBtn{width:100%;min-height:48px;border:0;border-radius:16px;background:#111;color:#fff;font-family:inherit;font-size:14px;font-weight:800;letter-spacing:-.035em;cursor:pointer;}
#${OVERLAY_ID} .olliMemoHistoryRestoreBtn:disabled{background:#ededed;color:#aaa;cursor:default;}
@media (min-width:700px){#${OVERLAY_ID}{align-items:center;padding:24px;}#${OVERLAY_ID} .olliMemoHistorySheet{border-radius:28px;max-height:min(76vh,720px);padding-bottom:0;}#${OVERLAY_ID} .olliMemoHistoryHandle{margin-top:11px;}}
`;
    document.head.appendChild(style);
  }

  function makeButton() {
    if (document.getElementById(BUTTON_ID)) return document.getElementById(BUTTON_ID);
    const anchor = document.getElementById('memoRecordsBtn');
    const actions = anchor?.parentElement || document.querySelector('.memoHeaderActions');
    if (!actions) return null;

    const button = document.createElement('button');
    button.type = 'button';
    button.id = BUTTON_ID;
    button.className = anchor?.className || 'memoRecordRoomBtn';
    button.setAttribute('aria-label', '관찰노트 이전 기록');
    button.title = '이전 기록';
    button.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5.2 8.1A7.6 7.6 0 1 1 4.6 14"></path><path d="M5.2 4.8v4.5h4.5"></path><path d="M12 7.7v4.5l3 1.8"></path></svg>';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openHistory();
    });
    if (anchor) actions.insertBefore(button, anchor); else actions.appendChild(button);
    return button;
  }

  function ensureOverlay() {
    let overlay = document.getElementById(OVERLAY_ID);
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <section class="olliMemoHistorySheet" role="dialog" aria-modal="true" aria-label="관찰노트 이전 기록">
        <div class="olliMemoHistoryHandle" aria-hidden="true"></div>
        <header class="olliMemoHistoryHeader">
          <div class="olliMemoHistoryHeaderLeft">
            <button type="button" class="olliMemoHistoryBack" aria-label="이전 기록 목록으로">‹</button>
            <div class="olliMemoHistoryTitleWrap">
              <div class="olliMemoHistoryTitle">이전 기록</div>
              <div class="olliMemoHistorySub"></div>
            </div>
          </div>
          <button type="button" class="olliMemoHistoryClose" aria-label="닫기">×</button>
        </header>
        <div class="olliMemoHistoryBody"></div>
      </section>`;
    overlay.addEventListener('click', event => {
      if (event.target === overlay) closeHistory();
    });
    overlay.querySelector('.olliMemoHistoryClose')?.addEventListener('click', closeHistory);
    overlay.querySelector('.olliMemoHistoryBack')?.addEventListener('click', renderList);
    document.body.appendChild(overlay);
    return overlay;
  }

  function showOverlay() {
    installStyle();
    makeButton();
    const overlay = ensureOverlay();
    overlay.classList.add('show');
    overlay.classList.remove('preview');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('olliMemoHistoryOpen');
  }
  function closeHistory() {
    if (state.restoring) return;
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;
    overlay.classList.remove('show', 'preview');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('olliMemoHistoryOpen');
    state.selectedRevision = null;
  }

  function bodyElement() { return document.querySelector(`#${OVERLAY_ID} .olliMemoHistoryBody`); }
  function subElement() { return document.querySelector(`#${OVERLAY_ID} .olliMemoHistorySub`); }
  function titleElement() { return document.querySelector(`#${OVERLAY_ID} .olliMemoHistoryTitle`); }

  function renderLoading(message = '이전 기록을 불러오고 있습니다.') {
    const body = bodyElement();
    if (!body) return;
    body.replaceChildren();
    const el = document.createElement('div');
    el.className = 'olliMemoHistoryLoading';
    el.textContent = message;
    body.appendChild(el);
  }
  function renderError(message) {
    const body = bodyElement();
    if (!body) return;
    body.replaceChildren();
    const el = document.createElement('div');
    el.className = 'olliMemoHistoryError';
    el.textContent = message || '이전 기록을 불러오지 못했습니다.';
    body.appendChild(el);
  }

  async function waitForRequestGuardIdle(student, timeoutMs = 5000) {
    if (typeof global.getObservationMemoRequestGuardState !== 'function') return true;
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const guard = global.getObservationMemoRequestGuardState(student, NOTE_TYPE);
      if (!guard?.inFlight) return true;
      await sleep(60);
    }
    return false;
  }

  async function settleActiveDraft(student) {
    if (!student) return false;
    if (typeof global.shouldBlockObservationMemoAutoSave === 'function') {
      try {
        if (global.shouldBlockObservationMemoAutoSave()) {
          alertMessage('보관된 기록을 보는 중에는 이전 기록 복구를 사용할 수 없습니다.');
          return false;
        }
      } catch (_) {}
    }

    let hadTimer = false;
    if (global.__olliObservationMemoAutoSaveTimer) {
      clearTimeout(global.__olliObservationMemoAutoSaveTimer);
      global.__olliObservationMemoAutoSaveTimer = null;
      hadTimer = true;
    }
    let dirty = false;
    try { dirty = typeof global.hasObservationMemoDirtyChanges === 'function' && global.hasObservationMemoDirtyChanges(); } catch (_) {}

    if ((hadTimer || dirty) && typeof global.saveCurrentMemo === 'function') {
      setStatus('저장 중...');
      try {
        const result = await global.saveCurrentMemo({ silent: true, status: true });
        if (result?.state === 'conflict') {
          alertMessage('다른 기기에서 관찰노트가 먼저 수정되었습니다. 최신 내용을 확인한 뒤 이전 기록을 열어 주세요.');
          return false;
        }
        if (result?.state === 'pending' || result?.state === 'blocked') {
          alertMessage('현재 작성 내용을 서버에 안전하게 저장한 뒤 이전 기록을 열 수 있습니다. 네트워크와 로그인 상태를 확인해 주세요.');
          return false;
        }
        try { if (typeof global.markObservationMemoEditorClean === 'function') global.markObservationMemoEditorClean(); } catch (_) {}
      } catch (error) {
        console.warn('관찰노트 이전 기록 전 저장 실패:', error?.message || error);
        alertMessage('현재 작성 내용을 먼저 저장하지 못했습니다. 저장 상태를 확인한 뒤 다시 시도해 주세요.');
        return false;
      } finally {
        setStatus('');
      }
    }

    const idle = await waitForRequestGuardIdle(student);
    if (!idle) {
      alertMessage('관찰노트 저장이 아직 진행 중입니다. 저장이 끝난 뒤 다시 눌러 주세요.');
      return false;
    }
    return true;
  }

  async function fetchHistory(student) {
    const id = academyId();
    const token = sessionToken();
    if (!id || !token) {
      const error = new Error('로그인 정보를 확인해 주세요.');
      error.code = 'SESSION_REQUIRED';
      throw error;
    }
    const response = await rpc('olli_note_draft_version_list', {
      p_session_token: token,
      p_academy_id: id,
      p_student_id: student.id,
      p_note_type: NOTE_TYPE,
      p_limit: 30
    });
    if (!response || response.ok === false) {
      const error = new Error(response?.message || '이전 기록을 불러오지 못했습니다.');
      error.code = response?.code || 'HISTORY_LIST_FAILED';
      throw error;
    }
    return response;
  }

  async function openHistory() {
    const student = activeStudent();
    if (!student?.id) {
      alertMessage('학생을 선택한 뒤 이전 기록을 확인해 주세요.');
      return;
    }
    if (state.loading || state.restoring) return;
    if (navigator?.onLine === false) {
      alertMessage('이전 기록은 서버 연결이 필요합니다. 인터넷 연결을 확인해 주세요.');
      return;
    }

    const safe = await settleActiveDraft(student);
    if (!safe || !sameStudent(student, activeStudent())) return;

    state.student = { ...student };
    state.items = [];
    state.selectedRevision = null;
    state.loading = true;
    showOverlay();
    const title = titleElement();
    const sub = subElement();
    if (title) title.textContent = '이전 기록';
    if (sub) sub.textContent = student.name ? `${student.name} · 관찰노트` : '관찰노트';
    renderLoading();

    try {
      const response = await fetchHistory(student);
      if (!sameStudent(state.student, student)) return;
      state.items = Array.isArray(response.items) ? response.items : [];
      state.currentRevision = revision(response.current_revision);
      state.currentUpdatedAt = text(response.current_updated_at);
      renderList();
    } catch (error) {
      console.warn('관찰노트 이전 기록 조회 실패:', error?.message || error);
      renderError(error?.message || '이전 기록을 불러오지 못했습니다.');
    } finally {
      state.loading = false;
    }
  }

  function renderList() {
    const overlay = ensureOverlay();
    overlay.classList.remove('preview');
    state.selectedRevision = null;
    const title = titleElement();
    const sub = subElement();
    if (title) title.textContent = '이전 기록';
    if (sub) sub.textContent = state.student?.name ? `${state.student.name} · 최근 ${Math.min(state.items.length, 30)}개` : '관찰노트';

    const body = bodyElement();
    if (!body) return;
    body.replaceChildren();
    if (!state.items.length) {
      const empty = document.createElement('div');
      empty.className = 'olliMemoHistoryEmpty';
      empty.textContent = '아직 저장된 이전 기록이 없습니다.';
      body.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'olliMemoHistoryList';
    state.items.forEach(item => {
      const itemRevision = revision(item.revision);
      const isCurrent = item.is_current === true || itemRevision === state.currentRevision;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `olliMemoHistoryItem${isCurrent ? ' current' : ''}`;

      const top = document.createElement('div');
      top.className = 'olliMemoHistoryItemTop';
      const date = document.createElement('div');
      date.className = 'olliMemoHistoryDate';
      date.textContent = formatDate(item.saved_at) || `버전 ${itemRevision}`;
      const badges = document.createElement('div');
      badges.className = 'olliMemoHistoryBadges';
      if (isCurrent) {
        const currentBadge = document.createElement('span');
        currentBadge.className = 'olliMemoHistoryBadge current';
        currentBadge.textContent = '현재';
        badges.appendChild(currentBadge);
      }
      const versionBadge = document.createElement('span');
      versionBadge.className = 'olliMemoHistoryBadge';
      versionBadge.textContent = `v${itemRevision}`;
      badges.appendChild(versionBadge);
      top.append(date, badges);

      const meta = document.createElement('div');
      meta.className = 'olliMemoHistoryMeta';
      meta.textContent = sourceLabel(item);
      const preview = document.createElement('div');
      preview.className = `olliMemoHistoryPreviewText${clean(item.content) ? '' : ' empty'}`;
      preview.textContent = clean(item.content) ? text(item.content) : '내용 없음';
      button.append(top, meta, preview);
      button.addEventListener('click', () => renderPreview(itemRevision));
      list.appendChild(button);
    });
    body.appendChild(list);
  }

  function findItem(targetRevision) {
    const target = revision(targetRevision);
    return state.items.find(item => revision(item.revision) === target) || null;
  }

  function renderPreview(targetRevision) {
    const item = findItem(targetRevision);
    if (!item) return;
    state.selectedRevision = revision(item.revision);
    const overlay = ensureOverlay();
    overlay.classList.add('preview');
    const title = titleElement();
    const sub = subElement();
    if (title) title.textContent = `버전 ${state.selectedRevision}`;
    if (sub) sub.textContent = sourceLabel(item);

    const body = bodyElement();
    if (!body) return;
    body.replaceChildren();
    const detail = document.createElement('div');
    detail.className = 'olliMemoHistoryDetail';

    const meta = document.createElement('div');
    meta.className = 'olliMemoHistoryDetailMeta';
    const date = document.createElement('div');
    date.className = 'olliMemoHistoryDetailDate';
    date.textContent = formatDate(item.saved_at) || '저장 시간 없음';
    const badge = document.createElement('span');
    const isCurrent = item.is_current === true || state.selectedRevision === state.currentRevision;
    badge.className = `olliMemoHistoryBadge${isCurrent ? ' current' : ''}`;
    badge.textContent = isCurrent ? '현재 사용 중' : `v${state.selectedRevision}`;
    meta.append(date, badge);

    const content = document.createElement('div');
    content.className = `olliMemoHistoryDetailText${clean(item.content) ? '' : ' empty'}`;
    content.textContent = clean(item.content) ? text(item.content) : '내용 없음';

    const guide = document.createElement('div');
    guide.className = 'olliMemoHistoryGuide';
    guide.textContent = isCurrent
      ? '현재 사용 중인 관찰노트입니다.'
      : '복구해도 지금 내용은 이전 버전에 그대로 남아 있어 다시 되돌릴 수 있습니다.';

    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'olliMemoHistoryRestoreBtn';
    restore.disabled = isCurrent;
    restore.textContent = isCurrent ? '현재 사용 중' : '이 버전으로 복구';
    restore.addEventListener('click', () => restoreVersion(item));

    detail.append(meta, content, guide, restore);
    body.appendChild(detail);
  }

  function applyServerSnapshot(student, content, nextRevision, updatedAt) {
    if (!student?.id) return;
    const syncedAt = text(updatedAt) || new Date().toISOString();
    try {
      if (typeof global.setMemoByStudent === 'function') {
        global.setMemoByStudent(student, text(content), {
          updatedAt: syncedAt,
          lastSyncedAt: syncedAt,
          syncStatus: 'synced',
          revision: revision(nextRevision),
          mutationId: '',
          conflict: null
        });
      }
    } catch (error) {
      console.warn('복구된 관찰노트 로컬 반영 실패:', error?.message || error);
    }

    if (sameStudent(student, activeStudent())) {
      const editor = document.getElementById('memoEditor');
      if (editor) {
        editor.value = text(content);
        try { if (typeof global.autoResizeTextarea === 'function') global.autoResizeTextarea(editor); } catch (_) {}
      }
      try { if (typeof global.updateMemoStudentMetaDisplay === 'function') global.updateMemoStudentMetaDisplay(student, syncedAt); } catch (_) {}
      try {
        if (typeof global.beginObservationMemoEditSession === 'function') {
          global.beginObservationMemoEditSession(student, 'elementary', text(content));
        }
        if (typeof global.markObservationMemoEditorClean === 'function') global.markObservationMemoEditorClean();
      } catch (_) {}
    }
  }

  async function refreshAfterConflict(result) {
    if (!state.student) return;
    const serverRevision = revision(result?.server_revision);
    applyServerSnapshot(state.student, result?.server_content || '', serverRevision, result?.server_updated_at || '');
    try {
      const response = await fetchHistory(state.student);
      state.items = Array.isArray(response.items) ? response.items : [];
      state.currentRevision = revision(response.current_revision);
      state.currentUpdatedAt = text(response.current_updated_at);
      renderList();
    } catch (error) {
      renderError(error?.message || '최신 이전 기록을 다시 불러오지 못했습니다.');
    }
  }

  async function restoreVersion(item) {
    if (!item || !state.student?.id || state.restoring) return;
    const targetRevision = revision(item.revision);
    if (targetRevision === state.currentRevision) return;
    if (!sameStudent(state.student, activeStudent())) {
      closeHistory();
      return;
    }

    let confirmed = true;
    try {
      confirmed = global.confirm(`버전 ${targetRevision}의 내용으로 복구할까요?\n현재 내용도 이전 기록에 남아 있어 다시 되돌릴 수 있습니다.`);
    } catch (_) {}
    if (!confirmed) return;

    const safe = await settleActiveDraft(state.student);
    if (!safe || !sameStudent(state.student, activeStudent())) return;

    // The safety save above may have advanced the server revision. Reload before restore so
    // expectedRevision always refers to the version the user is actually replacing.
    try {
      const latest = await fetchHistory(state.student);
      state.items = Array.isArray(latest.items) ? latest.items : state.items;
      state.currentRevision = revision(latest.current_revision);
      state.currentUpdatedAt = text(latest.current_updated_at);
    } catch (error) {
      alertMessage('최신 관찰노트 버전을 확인하지 못했습니다. 복구를 중단했습니다.');
      return;
    }

    const freshTarget = findItem(targetRevision);
    if (!freshTarget) {
      alertMessage('선택한 이전 기록을 다시 찾지 못했습니다. 목록을 새로 확인해 주세요.');
      renderList();
      return;
    }
    if (targetRevision === state.currentRevision) {
      renderPreview(targetRevision);
      return;
    }

    state.restoring = true;
    const restoreButton = document.querySelector(`#${OVERLAY_ID} .olliMemoHistoryRestoreBtn`);
    if (restoreButton) {
      restoreButton.disabled = true;
      restoreButton.textContent = '복구 중...';
    }
    setStatus('이전 기록 복구 중...');

    try {
      const response = await rpc('olli_note_draft_version_restore', {
        p_session_token: sessionToken(),
        p_academy_id: academyId(),
        p_student_id: state.student.id,
        p_note_type: NOTE_TYPE,
        p_target_revision: targetRevision,
        p_expected_revision: state.currentRevision,
        p_mutation_id: mutationId(),
        p_device_id: deviceId()
      });

      if (!response || response.ok === false) {
        if (response?.code === 'REVISION_CONFLICT') {
          await refreshAfterConflict(response);
          alertMessage('다른 기기에서 관찰노트가 변경되어 복구를 중단했습니다. 최신 내용을 불러왔습니다.');
          return;
        }
        throw Object.assign(new Error(response?.message || '이전 기록 복구에 실패했습니다.'), { code: response?.code || 'RESTORE_FAILED' });
      }

      state.currentRevision = revision(response.revision);
      state.currentUpdatedAt = text(response.updated_at);
      applyServerSnapshot(state.student, response.content || '', state.currentRevision, state.currentUpdatedAt);
      try { global.dispatchEvent(new CustomEvent('olli:observation-memo-version-restored', { detail: { studentId: clean(state.student.id), revision: state.currentRevision, restoredFromRevision: targetRevision } })); } catch (_) {}
      closeHistory();
      setStatus('이전 기록으로 복구됨');
      try { if (typeof global.showMemoSaveCheck === 'function') global.showMemoSaveCheck(); } catch (_) {}
      setTimeout(() => setStatus(''), 1500);
    } catch (error) {
      console.warn('관찰노트 이전 기록 복구 실패:', error?.message || error);
      alertMessage(error?.message || '이전 기록 복구에 실패했습니다.');
      if (restoreButton) {
        restoreButton.disabled = false;
        restoreButton.textContent = '이 버전으로 복구';
      }
      setStatus('복구 확인 필요');
    } finally {
      state.restoring = false;
    }
  }

  function updateButtonVisibility() {
    const button = makeButton();
    if (!button) return;
    const screen = document.getElementById('studentMemoScreen');
    const active = !!activeStudent() && (!screen || screen.style.display !== 'none');
    button.style.display = active ? '' : 'none';
  }

  function install() {
    installStyle();
    makeButton();
    ensureOverlay();
    updateButtonVisibility();
    document.addEventListener('click', () => setTimeout(updateButtonVisibility, 0), true);
    global.addEventListener('olli:observation-memo-version-restored', updateButtonVisibility);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && document.getElementById(OVERLAY_ID)?.classList.contains('show')) closeHistory();
    });
  }

  global.openObservationMemoVersionHistory = openHistory;
  global.closeObservationMemoVersionHistory = closeHistory;
  global.refreshObservationMemoVersionHistoryButton = updateButtonVisibility;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(window);
