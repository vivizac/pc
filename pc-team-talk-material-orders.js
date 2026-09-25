(function initializeOlliTeamTalkMaterialOrders(global) {
  'use strict';

  if (global.OlliTeamTalkMaterialOrders?.version) return;

  const VERSION = '1.0.1';
  const ACCOUNT_SESSION_TOKEN_KEY = 'olli_account_session_token_v1';

  const state = {
    root: null,
    items: [],
    summary: { requested: 0, on_hold: 0, ordered: 0, arrived: 0 },
    selectedId: '',
    currentRole: '',
    canProcess: false,
    loading: false,
    creating: false,
    processing: false,
    sequence: 0,
    filter: 'all',
    search: '',
    realtimeWatcher: null,
    deltaUnavailable: false,
    deltaCheckpoint: null,
    deltaAcademyId: '',
    started: false
  };

  const clean = value => String(value == null ? '' : value).trim();

  function context() {
    let academyContext = null;
    try { academyContext = global.OlliStorageCore?.AcademyContext?.getCurrent?.() || null; } catch (_) {}
    let academyId = '';
    let memberId = '';
    let accountId = '';
    let sessionToken = '';
    try {
      academyId = clean(localStorage.getItem('olli_current_academy_id'));
      memberId = clean(localStorage.getItem('olli_current_member_id'));
      accountId = clean(localStorage.getItem('olli_account_id_v1'));
      sessionToken = clean(localStorage.getItem(ACCOUNT_SESSION_TOKEN_KEY));
    } catch (_) {}
    return {
      academyId: clean(academyContext?.academyId || academyContext?.academy_id || academyId),
      memberId: clean(academyContext?.memberId || academyContext?.member_id || memberId),
      accountId,
      sessionToken
    };
  }

  async function rpc(name, params) {
    const call = typeof global.supabase === 'function'
      ? global.supabase
      : (typeof supabase === 'function' ? supabase : null);
    if (!call) throw new Error('Supabase 연결이 준비되지 않았습니다.');
    return call('POST', `rpc/${name}`, params);
  }

  function captureMaterialsContext(current) {
    const academyContext=global.OlliStorageCore?.AcademyContext;
    const token=academyContext?.captureToken?.()||null;
    return()=>{
      const latest=context();
      if(latest.academyId!==current.academyId||latest.sessionToken!==current.sessionToken)return false;
      if(token&&academyContext?.isTokenCurrent){
        try{return !!academyContext.isTokenCurrent(token)}catch(_){return false}
      }
      return true;
    };
  }

  function materialsStorageContext(current){
    return{academyId:current.academyId,accountId:current.accountId||'account'};
  }

  function currentPayload(){
    return{
      ok:true,
      academy_id:state.deltaAcademyId||context().academyId,
      current_member_id:context().memberId,
      current_role:state.currentRole,
      can_process:state.canProcess,
      summary:state.summary,
      items:state.items
    };
  }

  function payloadSignature(payload){
    try{
      return JSON.stringify({
        items:Array.isArray(payload?.items)?payload.items:[],
        summary:payload?.summary||{},
        current_role:clean(payload?.current_role),
        can_process:payload?.can_process===true
      });
    }catch(_){return ''}
  }

  async function captureMaterialsBaseline(current){
    const api=global.OlliMaterialsSync;
    if(!api||state.deltaUnavailable||!current?.sessionToken||!current?.academyId)return null;
    const isCurrent=captureMaterialsContext(current);
    try{
      const checkpoint=await api.createBaseline({
        rpc,
        academyId:current.academyId,
        sessionToken:current.sessionToken,
        isCurrent
      });
      return isCurrent()?checkpoint:null;
    }catch(error){
      if(api.isUnavailableError?.(error))state.deltaUnavailable=true;
      else console.warn('PC 재료주문 delta baseline 준비 실패:',error?.message||error);
      return null;
    }
  }

  function commitMaterialsBaseline(current,checkpoint){
    const api=global.OlliMaterialsSync;
    if(!api||!checkpoint)return false;
    state.deltaCheckpoint=checkpoint;
    state.deltaAcademyId=current.academyId;
    return api.writeCheckpoint(materialsStorageContext(current),checkpoint);
  }

  async function syncMaterialsDelta(options={}){
    if(!state.root?.isConnected)return true;
    const api=global.OlliMaterialsSync;
    const current=context();
    if(!api||state.deltaUnavailable||!current.sessionToken||!current.academyId){
      return refresh({showLoading:false});
    }

    if(state.deltaAcademyId!==current.academyId){
      state.deltaCheckpoint=api.readCheckpoint(materialsStorageContext(current));
      state.deltaAcademyId=current.academyId;
    }
    if(!state.deltaCheckpoint)return refresh({showLoading:false});

    const isCurrent=captureMaterialsContext(current);
    try{
      const delta=await api.pull({
        rpc,
        academyId:current.academyId,
        sessionToken:current.sessionToken,
        checkpoint:state.deltaCheckpoint,
        isCurrent
      });
      if(!isCurrent())return false;

      const before=currentPayload();
      const next=api.applyToPayload(before,delta,{maxItems:300});
      if(payloadSignature(before)!==payloadSignature(next))renderPayload(next);

      // Persist only after the in-memory payload accepted the delta.
      state.deltaCheckpoint=delta.checkpoint;
      state.deltaAcademyId=current.academyId;
      api.writeCheckpoint(materialsStorageContext(current),delta.checkpoint);
      return delta.complete===true;
    }catch(error){
      if(api.isUnavailableError?.(error))state.deltaUnavailable=true;
      else console.warn('PC 재료주문 delta 동기화 실패, 전체 조회로 복구:',error?.message||error);
      return refresh({showLoading:false});
    }
  }

  function create(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function statusMeta(status) {
    const map = {
      requested: { label: '요청', className: 'requested' },
      on_hold: { label: '보류', className: 'hold' },
      ordered: { label: '주문완료', className: 'ordered' },
      arrived: { label: '도착', className: 'arrived' }
    };
    return map[clean(status)] || map.requested;
  }

  function formatDate(value) {
    const text = clean(value);
    if (!text) return '미지정';
    const date = new Date(text + (text.length === 10 ? 'T00:00:00' : ''));
    if (!Number.isFinite(date.getTime())) return text;
    return `${date.getMonth() + 1}월 ${date.getDate()}일`;
  }

  function formatDateTime(value) {
    const date = new Date(value || 0);
    if (!Number.isFinite(date.getTime())) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${y}.${m}.${d} ${hh}:${mm}`;
  }

  function clientMutationId() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    return `material-${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
  }

  function rootQuery(selector) {
    return state.root?.querySelector(selector) || null;
  }

  function shellHtml() {
    return `
      <section class="olliMatRoot" aria-label="팀톡 재료주문">
        <div class="olliMatSummary" aria-label="재료 주문 현황">
          <button class="olliMatSummaryCard requested" type="button" data-material-filter="requested">
            <span class="olliMatSummaryIcon" aria-hidden="true">＋</span>
            <span class="olliMatSummaryLabel">요청</span>
            <strong data-material-count="requested">0</strong>
          </button>
          <button class="olliMatSummaryCard ordered" type="button" data-material-filter="ordered">
            <span class="olliMatSummaryIcon" aria-hidden="true">✓</span>
            <span class="olliMatSummaryLabel">주문완료</span>
            <strong data-material-count="ordered">0</strong>
          </button>
          <button class="olliMatSummaryCard arrived" type="button" data-material-filter="arrived">
            <span class="olliMatSummaryIcon" aria-hidden="true">□</span>
            <span class="olliMatSummaryLabel">도착</span>
            <strong data-material-count="arrived">0</strong>
          </button>
        </div>

        <div class="olliMatWorkspace">
          <section class="olliMatListPane" aria-label="재료 요청 목록">
            <div class="olliMatListHead">
              <div class="olliMatPaneTitle">요청 목록</div>
              <div class="olliMatListTools">
                <label class="olliMatSearch">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4 4"></path></svg>
                  <input type="search" data-material-search placeholder="품목명, 요청자로 검색" aria-label="재료 요청 검색">
                </label>
                <select class="olliMatFilterSelect" data-material-filter-select aria-label="재료 주문 상태 필터">
                  <option value="all">전체</option>
                  <option value="requested">요청</option>
                  <option value="on_hold">보류</option>
                  <option value="ordered">주문완료</option>
                  <option value="arrived">도착</option>
                </select>
              </div>
            </div>
            <div class="olliMatList" data-material-list></div>
          </section>

          <aside class="olliMatDetailPane" aria-label="재료 주문 상세">
            <div class="olliMatDetailHead">
              <div class="olliMatPaneTitle">상세 정보 / 처리</div>
              <span class="olliMatStatusTag requested" data-material-detail-status>요청</span>
            </div>
            <div class="olliMatDetailBody" data-material-detail></div>
          </aside>
        </div>

        <div class="olliMatToast" data-material-toast hidden></div>

        <div class="olliMatModalBackdrop" data-material-modal hidden>
          <div class="olliMatModal" role="dialog" aria-modal="true" aria-labelledby="olliMatCreateTitle">
            <div class="olliMatModalHead">
              <div>
                <div class="olliMatModalTitle" id="olliMatCreateTitle">재료 요청 등록</div>
                <div class="olliMatModalSub">필요한 재료와 필요한 날짜를 적어 주세요.</div>
              </div>
              <button class="olliMatIconBtn" type="button" data-material-action="close-create" aria-label="닫기">×</button>
            </div>
            <form class="olliMatForm" data-material-form>
              <label class="olliMatField olliMatFieldWide">
                <span>재료명 <b>*</b></span>
                <input name="item_name" maxlength="120" required placeholder="예: 아크릴 물감 12색">
              </label>
              <label class="olliMatField">
                <span>수량 <b>*</b></span>
                <input name="quantity_text" maxlength="60" required placeholder="예: 2세트">
              </label>
              <label class="olliMatField">
                <span>필요일</span>
                <input name="needed_on" type="date">
              </label>
              <label class="olliMatField olliMatFieldWide">
                <span>사용수업</span>
                <input name="use_context" maxlength="160" placeholder="예: 초등부 수요일 3시">
              </label>
              <label class="olliMatField olliMatFieldWide">
                <span>구매링크</span>
                <input name="purchase_url" type="url" maxlength="2000" placeholder="https://">
              </label>
              <label class="olliMatField olliMatFieldWide">
                <span>메모</span>
                <textarea name="memo" maxlength="1000" rows="4" placeholder="색상, 규격 등 주문할 때 참고할 내용을 적어 주세요."></textarea>
              </label>
              <div class="olliMatFormActions">
                <button class="olliMatSecondaryBtn" type="button" data-material-action="close-create">취소</button>
                <button class="olliMatPrimaryBtn" type="submit" data-material-submit>요청 등록</button>
              </div>
            </form>
          </div>
        </div>
      </section>`;
  }

  function showToast(message, tone) {
    const toast = rootQuery('[data-material-toast]');
    if (!toast) return;
    toast.textContent = clean(message);
    toast.className = `olliMatToast ${tone === 'error' ? 'error' : 'ok'}`;
    toast.hidden = !toast.textContent;
    if (toast.hidden) return;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      if (toast.isConnected) toast.hidden = true;
    }, 2800);
  }

  function renderSummary() {
    ['requested', 'ordered', 'arrived'].forEach(key => {
      const node = rootQuery(`[data-material-count="${key}"]`);
      if (node) node.textContent = String(Math.max(0, Number(state.summary?.[key] || 0)));
    });
    state.root?.querySelectorAll('[data-material-filter]').forEach(button => {
      button.classList.toggle('active', button.dataset.materialFilter === state.filter);
    });
    const select = rootQuery('[data-material-filter-select]');
    if (select && select.value !== state.filter) select.value = state.filter;
  }

  function matchesFilter(item) {
    if (state.filter !== 'all' && clean(item?.status) !== state.filter) return false;
    const q = state.search.toLowerCase();
    if (!q) return true;
    return [
      item?.item_name,
      item?.quantity_text,
      item?.requested_by_name,
      item?.use_context,
      item?.memo
    ].some(value => clean(value).toLowerCase().includes(q));
  }

  function filteredItems() {
    return state.items.filter(matchesFilter);
  }

  function ensureSelection(items) {
    if (!items.length) {
      state.selectedId = '';
      return;
    }
    if (!items.some(item => clean(item?.id) === state.selectedId)) {
      state.selectedId = clean(items[0]?.id);
    }
  }

  function materialIcon() {
    const wrap = create('span', 'olliMatItemIcon');
    wrap.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14v11H5z"></path><path d="M8 8V5h8v3M9 13h6"></path></svg>';
    return wrap;
  }

  function renderList() {
    const body = rootQuery('[data-material-list]');
    if (!body) return;
    const items = filteredItems();
    ensureSelection(items);
    body.replaceChildren();

    if (state.loading && !state.items.length) {
      const empty = create('div', 'olliMatEmpty');
      empty.append(create('strong', '', '재료 요청을 불러오는 중이에요.'), create('span', '', '잠시만 기다려 주세요.'));
      body.appendChild(empty);
      renderDetail();
      return;
    }

    if (!items.length) {
      const empty = create('div', 'olliMatEmpty');
      empty.append(
        create('strong', '', state.search || state.filter !== 'all' ? '조건에 맞는 요청이 없어요.' : '등록된 재료 요청이 없어요.'),
        create('span', '', state.search || state.filter !== 'all' ? '검색어나 상태 필터를 바꿔 보세요.' : '필요한 재료가 생기면 요청 등록을 눌러 주세요.')
      );
      body.appendChild(empty);
      renderDetail();
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'olliMatItemCard';
      button.dataset.materialId = clean(item?.id);
      button.classList.toggle('selected', clean(item?.id) === state.selectedId);

      const icon = materialIcon();
      const copy = create('span', 'olliMatItemCopy');
      copy.appendChild(create('strong', 'olliMatItemName', clean(item?.item_name) || '재료'));

      const meta = create('span', 'olliMatItemMeta');
      [
        `수량 ${clean(item?.quantity_text) || '-'}`,
        `필요일 ${formatDate(item?.needed_on)}`,
        `요청자 ${clean(item?.requested_by_name) || '-'}`
      ].forEach(text => meta.appendChild(create('span', '', text)));
      copy.appendChild(meta);

      const status = statusMeta(item?.status);
      const tag = create('span', `olliMatStatusTag ${status.className}`, status.label);
      const arrow = create('span', 'olliMatChevron', '›');
      button.append(icon, copy, tag, arrow);
      fragment.appendChild(button);
    });
    body.appendChild(fragment);
    renderDetail();
  }

  function detailRow(label, valueNode) {
    const row = create('div', 'olliMatDetailRow');
    row.appendChild(create('dt', '', label));
    const dd = create('dd');
    if (valueNode instanceof Node) dd.appendChild(valueNode);
    else dd.textContent = clean(valueNode) || '-';
    row.appendChild(dd);
    return row;
  }

  function selectedItem() {
    return state.items.find(item => clean(item?.id) === state.selectedId) || null;
  }

  function actionButton(label, nextStatus, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset.materialSetStatus = nextStatus;
    button.textContent = label;
    button.disabled = state.processing;
    return button;
  }

  function renderDetail() {
    const body = rootQuery('[data-material-detail]');
    const statusNode = rootQuery('[data-material-detail-status]');
    if (!body || !statusNode) return;

    const item = selectedItem();
    if (!item) {
      statusNode.hidden = true;
      body.replaceChildren();
      const empty = create('div', 'olliMatDetailEmpty');
      empty.append(create('strong', '', '요청을 선택해 주세요.'), create('span', '', '왼쪽 목록에서 재료 요청을 선택하면 상세 내용이 표시됩니다.'));
      body.appendChild(empty);
      return;
    }

    const meta = statusMeta(item.status);
    statusNode.hidden = false;
    statusNode.className = `olliMatStatusTag ${meta.className}`;
    statusNode.textContent = meta.label;
    body.replaceChildren();

    const hero = create('div', 'olliMatDetailHero');
    hero.append(materialIcon(), create('div', 'olliMatDetailHeroCopy'));
    const heroCopy = hero.lastElementChild;
    heroCopy.append(
      create('strong', '', clean(item.item_name) || '재료'),
      create('span', '', `${clean(item.quantity_text) || '-'} · ${clean(item.requested_by_name) || '요청자 미확인'}`)
    );
    body.appendChild(hero);

    const dl = create('dl', 'olliMatDetailGrid');
    dl.append(
      detailRow('품목명', item.item_name),
      detailRow('수량', item.quantity_text),
      detailRow('필요일', item.needed_on ? formatDate(item.needed_on) : '미지정'),
      detailRow('사용수업', item.use_context || '미지정'),
      detailRow('요청자', item.requested_by_name || '-')
    );

    if (item.purchase_url) {
      const link = document.createElement('a');
      link.href = item.purchase_url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'olliMatPurchaseLink';
      link.textContent = '구매링크 열기 ↗';
      dl.appendChild(detailRow('구매링크', link));
    } else {
      dl.appendChild(detailRow('구매링크', '없음'));
    }
    body.appendChild(dl);

    const memo = create('section', 'olliMatMemo');
    memo.append(
      create('div', 'olliMatMemoLabel', '메모'),
      create('div', 'olliMatMemoText', clean(item.memo) || '등록된 메모가 없습니다.')
    );
    body.appendChild(memo);

    if (item.status === 'on_hold' && clean(item.hold_reason)) {
      const hold = create('section', 'olliMatHoldReason');
      hold.append(create('strong', '', '보류 사유'), create('span', '', item.hold_reason));
      body.appendChild(hold);
    }

    const audit = create('div', 'olliMatAudit');
    const statusBy = clean(item.status_changed_by_name);
    const changedAt = formatDateTime(item.status_changed_at);
    if (statusBy || changedAt) audit.textContent = [statusBy, changedAt].filter(Boolean).join(' · ');
    body.appendChild(audit);

    const actions = create('div', 'olliMatActions');
    if (!state.canProcess) {
      actions.appendChild(create('div', 'olliMatReadOnlyNote', '주문 상태는 원장 또는 관리자가 변경합니다.'));
    } else if (item.status === 'requested') {
      actions.append(
        actionButton('보류', 'on_hold', 'olliMatSecondaryBtn'),
        actionButton('주문완료', 'ordered', 'olliMatDarkBtn')
      );
    } else if (item.status === 'on_hold') {
      actions.append(
        actionButton('요청으로', 'requested', 'olliMatSecondaryBtn'),
        actionButton('주문완료', 'ordered', 'olliMatDarkBtn')
      );
    } else if (item.status === 'ordered') {
      actions.appendChild(actionButton('도착처리', 'arrived', 'olliMatPrimaryBtn'));
    } else {
      actions.appendChild(create('div', 'olliMatDoneNote', '도착 처리가 완료된 요청입니다.'));
    }
    body.appendChild(actions);
  }

  function setFilter(filter) {
    if (!['all', 'requested', 'on_hold', 'ordered', 'arrived'].includes(filter)) filter = 'all';
    state.filter = filter;
    renderSummary();
    renderList();
  }

  function setSearch(value) {
    state.search = clean(value);
    renderList();
  }

  function renderPayload(payload) {
    state.items = Array.isArray(payload?.items) ? payload.items : [];
    state.summary = {
      requested: Number(payload?.summary?.requested || 0),
      on_hold: Number(payload?.summary?.on_hold || 0),
      ordered: Number(payload?.summary?.ordered || 0),
      arrived: Number(payload?.summary?.arrived || 0)
    };
    state.currentRole = clean(payload?.current_role);
    state.canProcess = payload?.can_process === true;
    if (state.selectedId && !state.items.some(item => clean(item?.id) === state.selectedId)) state.selectedId = '';
    renderSummary();
    renderList();
  }

  async function refresh(options = {}) {
    const sequence = ++state.sequence;
    const current = context();
    if (!state.root?.isConnected) return true;
    if (!current.sessionToken || !current.academyId) {
      state.items = [];
      state.summary = { requested: 0, on_hold: 0, ordered: 0, arrived: 0 };
      renderSummary();
      renderList();
      showToast('팀톡을 사용하려면 계정 로그인이 필요합니다.', 'error');
      return true;
    }

    if (options.showLoading !== false) {
      state.loading = true;
      renderList();
    }

    try {
      // Capture event head before the full snapshot so concurrent writes replay safely.
      const baselineCheckpoint=await captureMaterialsBaseline(current);
      const payload = await rpc('olli_team_material_requests_list', {
        p_session_token: current.sessionToken,
        p_academy_id: current.academyId,
        p_limit: 300
      });
      if (sequence !== state.sequence) return true;
      if (!payload?.ok) throw new Error(payload?.message || '재료 요청을 불러오지 못했습니다.');
      renderPayload(payload);
      commitMaterialsBaseline(current,baselineCheckpoint);
      return true;
    } catch (error) {
      if (sequence !== state.sequence) return true;
      console.warn('팀톡 재료주문 조회 실패:', error?.message || error);
      showToast(error?.message || '재료 요청을 불러오지 못했습니다.', 'error');
      return false;
    } finally {
      if (sequence === state.sequence) {
        state.loading = false;
        renderList();
      }
    }
  }

  function openCreate() {
    const modal = rootQuery('[data-material-modal]');
    const form = rootQuery('[data-material-form]');
    if (!modal || !form) return;
    form.reset();
    modal.hidden = false;
    requestAnimationFrame(() => form.elements.item_name?.focus());
  }

  function closeCreate() {
    const modal = rootQuery('[data-material-modal]');
    if (modal) modal.hidden = true;
  }

  async function submitCreate(event) {
    event.preventDefault();
    if (state.creating) return;
    const form = event.currentTarget;
    const submit = rootQuery('[data-material-submit]');
    const current = context();
    if (!current.sessionToken || !current.academyId) {
      showToast('팀톡을 사용하려면 계정 로그인이 필요합니다.', 'error');
      return;
    }

    const data = new FormData(form);
    const itemName = clean(data.get('item_name'));
    const quantityText = clean(data.get('quantity_text'));
    if (!itemName || !quantityText) {
      showToast('재료명과 수량을 입력해 주세요.', 'error');
      return;
    }

    state.creating = true;
    if (submit) {
      submit.disabled = true;
      submit.textContent = '등록 중...';
    }

    try {
      const payload = await rpc('olli_team_material_request_create', {
        p_session_token: current.sessionToken,
        p_academy_id: current.academyId,
        p_item_name: itemName,
        p_quantity_text: quantityText,
        p_needed_on: clean(data.get('needed_on')) || null,
        p_use_context: clean(data.get('use_context')) || null,
        p_purchase_url: clean(data.get('purchase_url')) || null,
        p_memo: clean(data.get('memo')) || null,
        p_client_mutation_id: clientMutationId()
      });
      if (!payload?.ok) throw new Error(payload?.message || '재료 요청을 등록하지 못했습니다.');
      state.selectedId = clean(payload.request_id);
      closeCreate();
      await refresh({ showLoading: false });
      showToast('재료 요청을 등록했습니다.', 'ok');
    } catch (error) {
      showToast(error?.message || '재료 요청을 등록하지 못했습니다.', 'error');
    } finally {
      state.creating = false;
      if (submit) {
        submit.disabled = false;
        submit.textContent = '요청 등록';
      }
    }
  }

  async function setStatus(nextStatus) {
    if (state.processing || !state.canProcess) return;
    const item = selectedItem();
    if (!item) return;
    const current = context();
    if (!current.sessionToken || !current.academyId) return;

    const holdReason = null;

    state.processing = true;
    renderDetail();
    try {
      const payload = await rpc('olli_team_material_request_set_status', {
        p_session_token: current.sessionToken,
        p_academy_id: current.academyId,
        p_request_id: item.id,
        p_status: nextStatus,
        p_expected_revision: Number(item.revision || 0),
        p_hold_reason: holdReason
      });
      if (!payload?.ok) throw new Error(payload?.message || '주문 상태를 변경하지 못했습니다.');
      await refresh({ showLoading: false });
      showToast(`${statusMeta(nextStatus).label} 상태로 변경했습니다.`, 'ok');
    } catch (error) {
      await refresh({ showLoading: false });
      showToast(error?.message || '주문 상태를 변경하지 못했습니다.', 'error');
    } finally {
      state.processing = false;
      renderDetail();
    }
  }

  function bindEvents() {
    if (!state.root || state.root.dataset.olliMaterialBound) return;
    state.root.dataset.olliMaterialBound = '1';

    state.root.addEventListener('click', event => {
      const action = event.target.closest('[data-material-action]')?.dataset.materialAction;
      if (action === 'open-create') {
        openCreate();
        return;
      }
      if (action === 'close-create') {
        closeCreate();
        return;
      }

      const filterButton = event.target.closest('[data-material-filter]');
      if (filterButton) {
        const next = clean(filterButton.dataset.materialFilter);
        setFilter(state.filter === next ? 'all' : next);
        return;
      }

      const itemButton = event.target.closest('[data-material-id]');
      if (itemButton) {
        state.selectedId = clean(itemButton.dataset.materialId);
        renderList();
        return;
      }

      const statusButton = event.target.closest('[data-material-set-status]');
      if (statusButton) setStatus(clean(statusButton.dataset.materialSetStatus));
    });

    state.root.addEventListener('input', event => {
      if (event.target.matches('[data-material-search]')) setSearch(event.target.value);
    });

    state.root.addEventListener('change', event => {
      if (event.target.matches('[data-material-filter-select]')) setFilter(event.target.value);
    });

    const form = rootQuery('[data-material-form]');
    form?.addEventListener('submit', submitCreate);

    const modal = rootQuery('[data-material-modal]');
    modal?.addEventListener('click', event => {
      if (event.target === modal) closeCreate();
    });

    state.root.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !rootQuery('[data-material-modal]')?.hidden) closeCreate();
    });
  }

  function bindRealtime() {
    if (state.realtimeWatcher || !global.OlliRealtime?.watchDomain) return;
    try {
      state.realtimeWatcher = global.OlliRealtime.watchDomain('materials', async () => {
        if (!state.root?.isConnected) return true;
        return syncMaterialsDelta({ showLoading:false });
      });
      global.OlliRealtime.ensureConnected?.({ reason: 'team_material_orders_start' }).catch(() => {});
    } catch (error) {
      console.warn('팀톡 재료주문 Realtime 연결 실패:', error?.message || error);
    }
  }

  async function mount(target, options = {}) {
    const root = typeof target === 'string' ? document.querySelector(target) : target;
    if (!(root instanceof Element)) return false;

    if (state.root && state.root !== root) {
      state.root.removeAttribute('data-olli-material-mounted');
    }
    state.root = root;
    state.root.setAttribute('data-olli-material-mounted', '1');
    state.root.innerHTML = shellHtml();
    bindEvents();
    bindRealtime();

    if (options.filter) state.filter = clean(options.filter);
    renderSummary();
    renderList();
    await refresh({ showLoading: true });
    return true;
  }

  async function activate() {
    if (!state.root?.isConnected) {
      const auto = document.querySelector('[data-olli-team-material-orders]');
      if (auto) await mount(auto);
      return !!auto;
    }
    await refresh({ showLoading: false });
    return true;
  }

  function destroy() {
    state.realtimeWatcher?.dispose?.();
    state.realtimeWatcher = null;
    if (state.root) {
      state.root.replaceChildren();
      state.root.removeAttribute('data-olli-material-mounted');
    }
    state.root = null;
    state.items = [];
    state.selectedId = '';
  }

  function start() {
    if (state.started) return;
    state.started = true;
    const auto = document.querySelector('[data-olli-team-material-orders]');
    if (auto) mount(auto).catch(error => console.warn('팀톡 재료주문 시작 실패:', error));
    global.addEventListener('olli:reconcile', () => {
      if (state.root?.isConnected && !state.realtimeWatcher) refresh({ showLoading: false });
    });
  }

  global.OlliTeamTalkMaterialOrders = Object.freeze({
    version: VERSION,
    mount,
    activate,
    refresh,
    openCreate,
    destroy
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})(window);
