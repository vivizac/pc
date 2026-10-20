(function(global) {
  'use strict';
  const DEFAULT_BODY = '#{학원명} 정기 성장상담 안내\n\n#{학생명} 학생의 #{상담구분} 상담 기간입니다.\n수업 중 관찰한 모습과 앞으로의 지도 방향을 함께 나누고자 합니다.\n\n아래 네이버 예약에서 가능한 일정을 선택해 주세요.\n#{예약링크}';
  const STATUS = { reserved:'결과 확인 필요', submitted:'접수 완료', delivered:'발송 성공', failed:'발송 실패', unknown:'결과 확인 필요' };
  let active = null;
  function escape(value) { return String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  function context() {
    return { academyId:String(localStorage.getItem('olli_current_academy_id') || ''), sessionToken:String(localStorage.getItem('olli_account_session_token_v1') || '') };
  }
  function sameContext(ctx) { const current = context(); return current.academyId === ctx.academyId && current.sessionToken === ctx.sessionToken; }
  function isOwner() {
    const role = typeof global.getOlliCurrentRole === 'function' ? global.getOlliCurrentRole() : localStorage.getItem('olli_current_member_role');
    return ['owner','super_admin'].includes(role);
  }
  function notice(text, error = false) {
    if (!active) return;
    const el = active.dialog.querySelector('[data-notice]');
    el.textContent = text;
    el.classList.toggle('error', error);
  }
  function close() { if (active) { active.dialog.close(); active.dialog.remove(); active = null; } }
  async function rpc(action, data = {}, state = active) {
    if (!state || !sameContext(state.ctx)) throw new Error('학원 또는 로그인 계정이 바뀌었습니다. 창을 닫고 다시 열어 주세요.');
    const call = typeof global.callOlliRpc === 'function' ? global.callOlliRpc : null;
    if (!call) throw new Error('서버 연결 기능이 준비되지 않았습니다.');
    const result = await call('olli_consultation_messages_manage', {p_session_token:state.ctx.sessionToken,p_academy_id:state.ctx.academyId,p_action:action,p_data:data});
    if (!sameContext(state.ctx) || active !== state) throw new Error('학원 또는 로그인 계정이 바뀌었습니다.');
    if (result?.ok !== true) throw new Error(result?.message || '저장하지 못했습니다.');
    return result;
  }
  async function server(action, studentId = null, state = active) {
    if (!state || !sameContext(state.ctx)) throw new Error('학원 또는 로그인 계정이 바뀌었습니다.');
    const res = await fetch('/api/consultation-messages', {
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...state.ctx,action,studentId}), signal:AbortSignal.timeout(30000)
    });
    const result = await res.json();
    if (!sameContext(state.ctx) || active !== state) throw new Error('학원 또는 로그인 계정이 바뀌었습니다.');
    if (!res.ok || !result.ok) throw new Error(result.error === 'PRODUCTION_ONLY' ? '운영 배포 후 발송업체 연결 상태를 확인할 수 있습니다.' : result.error || '발송 서버에 연결하지 못했습니다.');
    return result;
  }
  function historyHtml(payload) {
    const names = new Map(payload.students.map((s) => [s.id,s.name]));
    if (!payload.deliveries.length) return '<p class="ocm-muted">아직 발송 내역이 없습니다.</p>';
    return payload.deliveries.map((d) => '<div class="ocm-history-row"><div><strong>'+escape(names.get(d.student_id) || '이전 재원생')+'</strong><small>'+escape(d.due_month)+' 상담 · '+escape(new Date(d.created_at).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'}))+'</small></div><span class="ocm-status '+escape(d.status)+'">'+escape(STATUS[d.status] || d.status)+'</span></div>').join('');
  }
  function render(state) {
    const payload = state.payload;
    const settings = payload.settings || {};
    state.dialog.querySelector('[data-content]').innerHTML = `
      <nav class="ocm-tabs" aria-label="상담 안내 메뉴">
        <button type="button" data-tab="settings" aria-pressed="true">발송 설정</button>
        <button type="button" data-tab="contacts" aria-pressed="false">발송 대상</button>
        <button type="button" data-tab="history" aria-pressed="false">발송 내역</button>
      </nav>
      <section data-panel="settings">
        <p class="ocm-muted">상담 대상 학부모에게 네이버 예약 링크가 담긴 알림톡을 자동 발송합니다. 예약 여부는 네이버에서 확인해 주세요.</p>
        <form data-settings>
          <label class="ocm-check"><input type="checkbox" name="enabled" ${settings.enabled ? 'checked' : ''}>상담 예약 안내 자동 발송</label>
          <label>네이버 플레이스·예약 링크<input name="booking_url" type="url" inputmode="url" placeholder="https://booking.naver.com/…" value="${escape(settings.booking_url)}" maxlength="2000"></label>
          <label>카카오채널 연동 ID<input name="channel_id" value="${escape(settings.channel_id)}" placeholder="솔라피에 등록된 채널 ID" maxlength="100"></label>
          <label>알림톡 템플릿 ID<input name="template_id" value="${escape(settings.template_id)}" placeholder="솔라피에서 승인된 템플릿 ID" maxlength="100"></label>
          <label>승인된 안내 문구<textarea name="template_body" rows="8" maxlength="1000">${escape(settings.template_body || DEFAULT_BODY)}</textarea></label>
          <p class="ocm-muted">변수: #{학원명}, #{학생명}, #{상담구분}, #{예약링크}<br>솔라피 템플릿에도 같은 문구와 ‘상담 예약하기’ 웹 링크 버튼을 등록해 주세요. 버튼 주소는 #{예약링크}로 설정합니다.</p>
          <label class="ocm-check"><input type="checkbox" name="template_confirmed" ${settings.template_confirmed ? 'checked' : ''}>채널·템플릿 ID와 문구가 승인된 내용과 일치함을 확인했습니다.</label>
          <p class="ocm-muted">설정을 처음 켠 달부터 상담 안내를 시작하며, 이전 달의 상담은 한꺼번에 발송하지 않습니다. 같은 학생의 같은 상담 예정 월에는 한 번만 발송합니다.</p>
          <p data-connection class="ocm-muted">발송업체 연결 확인 중…</p>
          <button type="submit" class="ocm-primary">발송 설정 저장</button>
        </form>
      </section>
      <section data-panel="contacts" hidden>
        <p class="ocm-muted">현재 재원생의 상담 안내 대상입니다. 보호자 연락처는 학생 등록·학생정보 화면에서 저장하고 수정합니다.</p>
        <label>학생 찾기<input type="search" data-search placeholder="이름 검색"></label>
        <div class="ocm-contacts">${payload.students.map((s) => `<div data-contact="${escape(s.id)}" data-name="${escape(s.name)}" class="ocm-contact">
          <strong>${escape(s.name)} <small>${s.division === 'kinder' ? '유치부' : '초등부'}</small></strong>
          <p>${escape(s.phone || '학생정보에서 보호자 연락처를 등록해 주세요.')}</p>
          <p class="ocm-muted">${s.enabled && s.confirmed ? '확인된 보호자 번호 · 상담 안내 대상' : '보호자 번호 확인 또는 상담 안내 대상 설정이 필요합니다.'}</p>
          <button type="button" data-send="${escape(s.id)}">예약 안내 보내기</button>
        </div>`).join('') || '<p class="ocm-muted">현재 재원생이 없습니다.</p>'}</div>
      </section>
      <section data-panel="history" hidden>
        <button type="button" data-refresh>발송 결과 새로고침</button>
        <p class="ocm-muted">‘접수 완료’는 발송업체가 요청을 받은 상태입니다. ‘발송 성공’은 업체가 확인한 발송 결과이며 읽음이나 상담 예약을 뜻하지 않습니다. 결과 확인이 필요한 건은 중복 발송을 막기 위해 자동으로 다시 보내지 않습니다.</p>
        <div data-history>${historyHtml(payload)}</div>
      </section>`;
    state.dialog.querySelector('[data-settings]').addEventListener('submit', saveSettings);
    ['channel_id','template_id','template_body'].forEach((name) => {
      state.dialog.querySelector('[data-settings]').elements[name].addEventListener('input', () => {
        state.dialog.querySelector('[data-settings]').elements.template_confirmed.checked = false;
      });
    });
    state.dialog.querySelector('[data-search]').addEventListener('input', (event) => {
      const query = event.target.value.trim();
      state.dialog.querySelectorAll('[data-contact]').forEach((row) => { row.hidden = !row.dataset.name.includes(query); });
    });
    state.dialog.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => {
      state.dialog.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
      state.dialog.querySelectorAll('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== button.dataset.tab; });
    }));
    state.dialog.querySelectorAll('[data-send]').forEach((button) => button.addEventListener('click', () => send(button)));
    state.dialog.querySelector('[data-refresh]').addEventListener('click', refresh);
    server('status', null, state).then((r) => {
      const el = state.dialog.querySelector('[data-connection]');
      if (el) el.textContent = r.configured ? '발송업체 서버 연결 설정 완료' : '발송업체 서버 연결 설정이 필요합니다. API 키는 서버에서만 등록합니다.';
    }).catch(() => {
      if (active === state) state.dialog.querySelector('[data-connection]').textContent = '발송업체 연결 상태를 확인하지 못했습니다. 서버 설정과 배포 상태를 확인해 주세요.';
    });
  }
  async function saveSettings(event) {
    event.preventDefault();
    const state = active, form = event.currentTarget, button = form.querySelector('[type=submit]');
    if (state.busy) return;
    const data = Object.fromEntries(new FormData(form));
    data.enabled = form.elements.enabled.checked;
    data.template_confirmed = form.elements.template_confirmed.checked;
    state.busy = true; button.disabled = true;
    try {
      if (data.enabled) {
        const status = await server('status', null, state);
        if (!status.configured) throw new Error('발송업체 서버 연결을 먼저 설정해 주세요.');
      }
      const result = await rpc('settings',data,state);
      state.payload = result;
      notice(data.enabled ? '저장했습니다. 다음 자동 발송부터 적용됩니다.' : '저장했습니다. 자동 발송이 꺼져 있습니다.');
    } catch (error) { if (active === state) notice(error.message,true); }
    finally { state.busy = false; button.disabled = false; }
  }
  async function send(button) {
    const state = active;
    if (!state || state.busy) return;
    const contact = state.payload.students.find((s) => s.id === button.dataset.send);
    if (!contact?.confirmed || !contact.enabled) return notice('확인된 보호자 연락처를 먼저 저장해 주세요.',true);
    if (!state.payload.settings?.enabled) return notice('자동 발송 설정을 먼저 켜고 저장해 주세요.',true);
    state.busy = true; button.disabled = true;
    try {
      const result = await server('send',button.dataset.send,state);
      const counts = result.counts;
      notice(counts.unknown ? '발송 결과를 확인하지 못했습니다. 솔라피 발송 내역을 먼저 확인해 주세요.' : counts.failed ? '발송에 실패했습니다. 발송 내역을 확인해 주세요.' : counts.submitted || counts.delivered ? '예약 안내를 접수했습니다. 발송 내역에서 결과를 확인해 주세요.' : '새 발송 대상이 없습니다. 상담 대상·완료 여부와 기존 발송 내역을 확인해 주세요.',!!(counts.unknown || counts.failed));
      state.payload = await rpc('load',{},state);
      state.dialog.querySelector('[data-history]').innerHTML = historyHtml(state.payload);
    } catch (error) { if (active === state) notice(error.message,true); }
    finally { state.busy = false; button.disabled = false; }
  }
  async function refresh() {
    const state = active;
    if (!state || state.busy) return;
    state.busy = true;
    try {
      await server('refresh',null,state);
      state.payload = await rpc('load',{},state);
      state.dialog.querySelector('[data-history]').innerHTML = historyHtml(state.payload);
      notice('발송 결과를 확인했습니다.');
    } catch (error) { if (active === state) notice(error.message,true); }
    finally { state.busy = false; }
  }
  async function open() {
    if (!isOwner()) return;
    close();
    const ctx = context();
    if (!ctx.academyId || !ctx.sessionToken) return;
    const dialog = document.createElement('dialog');
    dialog.className = 'olliConsultationMessages';
    dialog.setAttribute('aria-labelledby','ocm-title');
    dialog.innerHTML = '<header><div><h2 id="ocm-title">상담 예약 안내</h2><p>알림톡으로 예약 안내를 전달해요.</p></div><button type="button" data-close aria-label="닫기">×</button></header><div class="ocm-content" data-content>불러오는 중…</div><p data-notice role="status" aria-live="polite"></p>';
    document.body.appendChild(dialog);
    const state = {ctx,dialog,payload:null,busy:false};
    active = state;
    dialog.querySelector('[data-close]').addEventListener('click',close);
    dialog.addEventListener('cancel',(event) => { event.preventDefault(); close(); });
    dialog.showModal();
    try { state.payload = await rpc('load',{},state); render(state); }
    catch (error) { if (active === state) { state.dialog.querySelector('[data-content]').textContent = '상담 안내 설정을 불러오지 못했습니다.'; notice(error.message,true); } }
  }
  function checkContext() { if (active && !sameContext(active.ctx)) close(); }
  global.addEventListener('storage',checkContext);
  global.addEventListener('focus',checkContext);
  document.addEventListener('visibilitychange',checkContext);
  global.OlliConsultationMessages = Object.freeze({open,close,isOwner});
})(window);
