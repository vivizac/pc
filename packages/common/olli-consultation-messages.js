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
  function variantHtml(settings, optional = false) {
    return global.OlliConsultationMessageTemplates.slots.filter(slot => slot.optional === optional).map(slot => {
      const value = settings.template_variants?.[slot.key] || {};
      const useCommon = value.use_common !== false;
      return `<details class="ocm-template-slot" data-template-key="${escape(slot.key)}">
        <summary>${escape(slot.label)} 안내문</summary>
        <label class="ocm-check"><input type="checkbox" data-use-common ${useCommon ? 'checked' : ''}>공통 안내문 사용</label>
        <div data-custom-template ${useCommon ? 'hidden' : ''}>
          <label>개별 알림톡 템플릿 ID<input data-variant-id maxlength="100" aria-label="${escape(slot.label)} 템플릿 ID" value="${escape(value.template_id || '')}"></label>
          <label>개별 안내문<textarea data-variant-body rows="6" maxlength="1000" aria-label="${escape(slot.label)} 안내문">${escape(value.template_body || '')}</textarea></label>
          <label class="ocm-check"><input type="checkbox" data-variant-confirmed ${value.template_confirmed ? 'checked' : ''}>이 안내문의 템플릿 승인 내용을 확인했습니다.</label>
        </div>
      </details>`;
    }).join('');
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
          <label class="ocm-use-switch"><span>상담 안내 문자 사용<small data-usage-status>${settings.enabled ? '켜짐' : '꺼짐'}</small></span><span class="ocm-switch-control"><input type="checkbox" role="switch" aria-label="상담 안내 문자 사용" name="enabled" ${settings.enabled ? 'checked' : ''}><span class="ocm-switch-track" aria-hidden="true"></span></span></label>
          <p class="ocm-muted">학원별 선택 기능입니다. 끄면 자동 발송과 직접 보내기가 모두 중단됩니다. 스위치 변경은 바로 저장되며, 문구와 보호자 연락처는 보존됩니다.</p>
          <label>네이버 플레이스·예약 링크<input name="booking_url" type="url" inputmode="url" placeholder="https://booking.naver.com/…" value="${escape(settings.booking_url)}" maxlength="2000"></label>
          <label>알림톡 발송 채널
            <select name="selected_channel_id" aria-label="알림톡 발송 채널">
              <option value="">본사 관리자센터에서 승인된 채널을 선택해 주세요</option>
              ${(payload.channels || []).map(c=>`<option value="${escape(c.id)}" ${settings.selected_channel_id === c.id ? 'selected' : ''}>${escape(c.mode === 'headquarters' ? '본사 공통 · ' : '우리 학원 · ')}${escape(c.name || '카카오채널')}</option>`).join('')}
            </select>
          </label>
          <p class="ocm-muted">채널 등록·승인은 본사 관리자센터에서 관리합니다. 채널을 변경하면 발송이 자동으로 꺼지며 승인된 템플릿을 다시 확인해야 합니다.</p>
          <label>안내문 사용 방식<select name="template_mode" aria-label="안내문 사용 방식"><option value="common" ${settings.template_mode !== 'by_type' ? 'selected' : ''}>모든 상담에 공통 안내문 사용</option><option value="by_type" ${settings.template_mode === 'by_type' ? 'selected' : ''}>초등부·유치부 / 상담 시기별로 설정</option></select></label>
          <label>공통 알림톡 템플릿 ID<input name="template_id" value="${escape(settings.template_id)}" placeholder="솔라피에서 승인된 템플릿 ID" maxlength="100"></label>
          <label>공통 안내문<textarea name="template_body" rows="8" maxlength="1000">${escape(settings.template_body || DEFAULT_BODY)}</textarea></label>
          <p class="ocm-muted">변수: #{학원명}, #{학생명}, #{상담구분}, #{예약링크}, #{학생이름_주제}, #{학생이름_주격}, #{학생이름_목적격}, #{학생이름_함께}, #{학생이름_방향}<br>솔라피 템플릿에도 같은 문구와 ‘상담 예약하기’ 웹 링크 버튼을 등록해 주세요. 버튼 주소는 #{예약링크}로 설정합니다.</p>
          <label class="ocm-check"><input type="checkbox" name="template_confirmed" ${settings.template_confirmed ? 'checked' : ''}>채널·템플릿 ID와 문구가 승인된 내용과 일치함을 확인했습니다.</label>

          <div data-template-variants ${settings.template_mode !== 'by_type' ? 'hidden' : ''}>
            <p class="ocm-muted">바꾸고 싶은 항목의 ‘공통 안내문 사용’을 해제하고 별도 문구와 승인된 템플릿 ID를 등록해 주세요. 나머지는 공통 안내문을 사용합니다.</p>
            ${variantHtml(settings)}
            <details class="ocm-extra-stages"><summary>3개월 상담 기준도 사용하는 경우</summary>${variantHtml(settings, true)}</details>
            <p class="ocm-muted">같은 달에 6개월·12개월 상담이 겹치면 12개월 안내문을 한 번 발송합니다. 공통 모드로 바꿔도 입력한 개별 안내문은 보존됩니다.</p>
          </div>
          <p class="ocm-muted">설정을 처음 켠 달부터 상담 안내를 시작하며, 이전 달의 상담은 한꺼번에 발송하지 않습니다. 같은 학생의 같은 상담 예정 월에는 한 번만 발송합니다.</p>
          <p data-connection class="ocm-muted">${settings.enabled ? '발송업체 연결 확인 중…' : '현재 사용하지 않습니다. 사용하지 않는 학원은 발송업체를 연결하지 않아도 됩니다.'}</p>
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
          <button type="button" data-send="${escape(s.id)}" ${!settings.enabled ? 'disabled' : ''}>예약 안내 보내기</button> <button type="button" data-test-send="${escape(s.id)}" ${settings.enabled || !s.enabled || !s.confirmed ? "disabled" : ""}>시험 발송 (1회)</button>
        </div>`).join('') || '<p class="ocm-muted">현재 재원생이 없습니다.</p>'}</div>
      </section>
      <section data-panel="history" hidden>
        <button type="button" data-refresh>발송 결과 새로고침</button>
        <p class="ocm-muted">‘접수 완료’는 발송업체가 요청을 받은 상태입니다. ‘발송 성공’은 업체가 확인한 발송 결과이며 읽음이나 상담 예약을 뜻하지 않습니다. 결과 확인이 필요한 건은 중복 발송을 막기 위해 자동으로 다시 보내지 않습니다.</p>
        <div data-history>${historyHtml(payload)}</div>
      </section>`;
    state.dialog.querySelector('[data-settings]').addEventListener('submit', saveSettings);
    state.dialog.querySelector('[name=enabled]').addEventListener('change', toggleUsage);
    state.dialog.querySelector('[name=selected_channel_id]').addEventListener('change', async (event) => {
      const channel = (state.payload.channels || []).find(c => c.id === event.target.value);
      if (!channel || state.busy) { event.target.value = state.payload.settings?.selected_channel_id || ''; return; }
      state.busy = true;
      event.target.disabled = true;
      try {
        state.payload = await rpc('channel', {channel_id:channel.id,channel_mode:channel.mode}, state);
        // The server disables sending on a channel change; re-render to remove stale approvals.
        render(state);
        notice('발송 채널을 변경했습니다. 자동 발송은 꺼졌습니다. 해당 채널에서 승인된 안내문을 확인한 뒤 다시 켜 주세요.');
      } catch(error) {
        if(active === state) { event.target.value = state.payload.settings?.selected_channel_id || ''; notice(error.message,true); }
      } finally {
        state.busy = false;
        if(active === state && event.isTrusted && event.target.isConnected) event.target.disabled = false;
      }
    });
    state.dialog.querySelector('[name=template_mode]').addEventListener('change', (event) => {
      state.dialog.querySelector('[data-template-variants]').hidden = event.target.value !== 'by_type';
    });
    state.dialog.querySelectorAll('[data-template-key]').forEach((slot) => {
      slot.querySelector('[data-use-common]').addEventListener('change', (event) => { slot.querySelector('[data-custom-template]').hidden = event.target.checked; });
      ['[data-variant-id]', '[data-variant-body]'].forEach(selector => slot.querySelector(selector).addEventListener('input', () => { slot.querySelector('[data-variant-confirmed]').checked = false; }));
    });
    ['template_id','template_body'].forEach((name) => {
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
    state.dialog.querySelectorAll('[data-test-send]').forEach((button) => button.addEventListener('click', () => testSend(button)));
    state.dialog.querySelector('[data-refresh]').addEventListener('click', refresh);
    if (settings.enabled) server('status', null, state).then((r) => {
      if (active !== state || state.payload.settings?.enabled !== true) return;
      const el = state.dialog.querySelector('[data-connection]');
      if (el) el.textContent = r.configured ? '발송업체 서버 연결 설정 완료' : '발송업체 서버 연결 설정이 필요합니다. API 키는 서버에서만 등록합니다.';
    }).catch(() => {
      if (active === state && state.payload.settings?.enabled === true) state.dialog.querySelector('[data-connection]').textContent = '발송업체 연결 상태를 확인하지 못했습니다. 서버 설정과 배포 상태를 확인해 주세요.';
    });
  }
  function syncUsage(state) {
    if (active !== state) return;
    const enabled = state.payload.settings?.enabled === true;
    state.dialog.querySelector('[name=enabled]').checked = enabled;
    state.dialog.querySelector('[data-usage-status]').textContent = enabled ? '켜짐' : '꺼짐';
    state.dialog.querySelectorAll('[data-send]').forEach(button => { button.disabled = !enabled; });
    state.dialog.querySelectorAll('[data-test-send]').forEach(button => { const c=state.payload.students.find(s=>s.id===button.dataset.testSend);button.disabled=enabled || !c?.confirmed || !c?.enabled; });
    state.dialog.querySelector('[data-connection]').textContent = enabled
      ? '상담 안내 문자 기능을 사용하고 있습니다.'
      : '현재 사용하지 않습니다. 발송업체를 연결하지 않아도 됩니다.';
  }
  async function toggleUsage(event) {
    const state = active;
    const input = event.currentTarget;
    if (!state || state.busy) { if (state) syncUsage(state); return; }
    if (input.checked) {
      await saveSettings({ preventDefault() {}, currentTarget: state.dialog.querySelector('[data-settings]') });
      syncUsage(state);
      return;
    }
    // Turning off must work even with incomplete, unsaved edits or no provider credentials.
    // Change only usage so concurrent server edits and the current form draft survive.
    state.busy = true; input.disabled = true;
    try {
      state.payload = await rpc('disable', {}, state);
      notice('상담 안내 문자 사용을 껐습니다. 자동 발송과 직접 보내기가 중단됩니다.');
    } catch (error) { if (active === state) notice(error.message, true); }
    finally { state.busy = false; input.disabled = false; syncUsage(state); }
  }
  async function saveSettings(event) {
    event.preventDefault();
    const state = active, form = event.currentTarget, button = form.querySelector('[type=submit]');
    if (state.busy) return;
    const data = Object.fromEntries(new FormData(form));
    data.enabled = form.elements.enabled.checked;
    // The selected channel is managed exclusively by the 'channel' RPC.
    // Never allow the generic settings save to override its assignment.
    delete data.selected_channel_id;
    delete data.channel_mode;
    delete data.channel_id;
    data.template_confirmed = form.elements.template_confirmed.checked;
    data.template_variants = Object.fromEntries(Array.from(form.querySelectorAll('[data-template-key]')).map(slot => [slot.dataset.templateKey, {
      use_common: slot.querySelector('[data-use-common]').checked,
      template_id: slot.querySelector('[data-variant-id]').value.trim(),
      template_body: slot.querySelector('[data-variant-body]').value.trim(),
      template_confirmed: slot.querySelector('[data-variant-confirmed]').checked
    }]));
    state.busy = true; button.disabled = true; form.elements.enabled.disabled = true;
    try {
      if (data.enabled) {
        const status = await server('status', null, state);
        if (!status.configured) throw new Error('발송업체 서버 연결을 먼저 설정해 주세요.');
      }
      const result = await rpc('settings',data,state);
      state.payload = result;
      syncUsage(state);
      notice(data.enabled ? '저장했습니다. 다음 자동 발송부터 적용됩니다.' : '저장했습니다. 상담 안내 문자 사용이 꺼져 있습니다.');
    } catch (error) { if (active === state) notice(error.message,true); }
    finally { state.busy = false; button.disabled = false; form.elements.enabled.disabled = false; }
  }
  async function testSend(button) {
    const state=active;
    if(!state||state.busy)return;
    const contact=state.payload.students.find(s=>s.id===button.dataset.testSend);
    if(!contact?.confirmed||!contact.enabled)return notice('확인된 보호자 연락처를 먼저 저장해 주세요.',true);
    if(state.payload.settings?.enabled)return notice('시험 발송 전에 자동 발송을 꺼 주세요.',true);
    if(!confirm(contact.name+' 학생의 등록된 보호자 번호로 알림톡을 1건 시험 발송할까요?\\n\\n실제 문자 요금이 발생할 수 있습니다. 같은 학생과 템플릿의 시험 발송은 1회만 가능합니다.'))return;
    state.busy=true;button.disabled=true;
    try {
      const result=await server('test-send',button.dataset.testSend,state);
      const status=result.result?.status;
      notice(status==='duplicate'?'이미 이 학생에게 같은 템플릿 시험 발송을 요청했습니다. 솔라피에서 결과를 확인해 주세요.':status==='failed'?'발송이 거절되었습니다. 솔라피 발송 내역을 확인해 주세요.':status==='unknown'?'발송 결과가 불확실합니다. 재발송 전에 솔라피에서 확인해 주세요.':'시험 알림톡이 접수되었습니다. 실제 수신 여부를 확인해 주세요.',status==='failed'||status==='unknown');
    }catch(error){notice(error.message,true);}
    finally{state.busy=false;button.disabled=false;}
  }
  async function send(button) {
    const state = active;
    if (!state || state.busy) return;
    const contact = state.payload.students.find((s) => s.id === button.dataset.send);
    if (!contact?.confirmed || !contact.enabled) return notice('확인된 보호자 연락처를 먼저 저장해 주세요.',true);
    if (!state.payload.settings?.enabled) return notice('상담 안내 문자 사용을 먼저 켜 주세요.',true);
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
