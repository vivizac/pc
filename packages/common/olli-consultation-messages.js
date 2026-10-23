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
          <label>개별 안내문<textarea data-variant-body rows="6" maxlength="1000" aria-label="${escape(slot.label)} 안내문">${escape(value.template_body || (MANUAL_NOTICE_BODIES[slot.key] ? MANUAL_NOTICE_BODIES[slot.key] + '\n\n' + MANUAL_NOTICE_INFO : ''))}</textarea></label>
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
          <button type="button" data-auth-check>솔라피 API 인증 확인 (발송 없음)</button>
          <p data-auth-result class="ocm-muted"></p>
          <p data-connection class="ocm-muted">${settings.enabled ? '발송업체 연결 확인 중…' : '현재 사용하지 않습니다. 사용하지 않는 학원은 발송업체를 연결하지 않아도 됩니다.'}</p>
          <button type="submit" class="ocm-primary">발송 설정 저장</button>
        </form>
        ${manualNoticeEditorMarkup()}
      </section>
      <section data-panel="contacts" hidden>
        <p class="ocm-muted">현재 재원생의 상담 안내 대상입니다. 보호자 연락처는 학생 등록·학생정보 화면에서 저장하고 수정합니다.</p>
        <label>학생 찾기<input type="search" data-search placeholder="이름 검색"></label>
        <div class="ocm-contacts">${payload.students.map((s) => `<div data-contact="${escape(s.id)}" data-name="${escape(s.name)}" class="ocm-contact">
          <strong>${escape(s.name)} <small>${s.division === 'kinder' ? '유치부' : '초등부'}</small></strong>
          <p>${escape(s.phone || '학생정보에서 보호자 연락처를 등록해 주세요.')}</p>
          <p class="ocm-muted">${s.enabled && s.confirmed ? '확인된 보호자 번호 · 상담 안내 대상' : '보호자 번호 확인 또는 상담 안내 대상 설정이 필요합니다.'}</p>
          <button type="button" data-send="${escape(s.id)}" ${!settings.enabled ? 'disabled' : ''}>예약 안내 보내기</button> <button type="button" data-test-send="${escape(s.id)}" ${settings.enabled || !s.enabled || !s.confirmed ? "disabled" : ""}>시험 발송</button>
        </div>`).join('') || '<p class="ocm-muted">현재 재원생이 없습니다.</p>'}</div>
      </section>
      <section data-panel="history" hidden>
        <button type="button" data-refresh>발송 결과 새로고침</button>
        <p class="ocm-muted">‘접수 완료’는 발송업체가 요청을 받은 상태입니다. ‘발송 성공’은 업체가 확인한 발송 결과이며 읽음이나 상담 예약을 뜻하지 않습니다. 결과 확인이 필요한 건은 중복 발송을 막기 위해 자동으로 다시 보내지 않습니다.</p>
        <div data-history>${historyHtml(payload)}</div>
      </section>`;
    state.dialog.querySelector('[data-settings]').addEventListener('submit', saveSettings);
    state.dialog.querySelector('.ocm-manual-editor')?.addEventListener('click', saveManualNotice);
    hydrateManualNoticeEditor();
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
    state.dialog.querySelector('[data-auth-check]').addEventListener('click', async () => { const state=active;if(!state||state.busy)return;state.busy=true;const el=state.dialog.querySelector('[data-auth-result]');el.textContent='인증 확인 중…';try{const x=await server('auth-check',null,state);const d=x.result?.diagnostics||{};const flags=[d.apiKeySurroundingWhitespace?'API Key 앞뒤 공백 있음':null,d.apiSecretSurroundingWhitespace?'API Secret 앞뒤 공백 있음':null,d.apiKeyContainsQuotationMarks?'API Key 내부 따옴표 있음':null,d.apiSecretContainsQuotationMarks?'API Secret 내부 따옴표 있음':null].filter(Boolean);el.textContent=(x.result?.authenticated?'솔라피 API 인증 성공 (메시지 발송 없음)':'솔라피 API 인증 실패: '+(x.result?.code||'UNKNOWN')+' / 상세 분류: '+(x.result?.authCategory||'확인 불가')+' / 응답 형식: '+(x.result?.responseKind||'UNKNOWN'))+' / 입력 형식 검사: '+(flags.length?flags.join(', '):'공백·따옴표 이상 없음')+' / 공식 SDK 잔액 조회: '+(x.result?.sdk?.authenticated?'인증 성공':'인증 실패 ('+(x.result?.sdk?.code||'확인 불가')+', HTTP: '+(x.result?.sdk?.status??'미확인')+', 분류: '+(x.result?.sdk?.category||'확인 불가')+', 응답: '+(x.result?.sdk?.responseKind||'UNKNOWN')+')');}catch(e){el.textContent='인증 확인 실패: '+e.message;}finally{state.busy=false;} });
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
    if(!confirm(contact.name+' 학생의 등록된 보호자 번호로 알림톡을 1건 시험 발송할까요?\\n\\n실제 문자 요금이 발생할 수 있습니다. 확실한 API 거절일 때만 다시 시도할 수 있습니다.'))return;
    state.busy=true;button.disabled=true;
    try {
      const result=await server('test-send',button.dataset.testSend,state);
      const status=result.result?.status;
      notice(status==='duplicate'?'기존 요청이 접수됐거나 결과가 불확실하여 재발송을 차단했습니다. 솔라피에서 확인해 주세요.':status==='failed'?'발송이 거절되었습니다. 솔라피 발송 내역을 확인해 주세요.':status==='unknown'?'발송 결과가 불확실합니다. 재발송 전에 솔라피에서 확인해 주세요.':'시험 알림톡이 접수되었습니다. 실제 수신 여부를 확인해 주세요.',status==='failed'||status==='unknown');
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

  // Manual consultation notices: no Solapi credentials and no message dispatch.
  const MANUAL_NOTICE_INFO = "〈상담 신청 안내〉\n상담 기간: 매월 둘째 주와 셋째 주\n상담 시간: 월~금 (오전 11시 ~ 오후 6시)\n상담 소요 시간: 약 10~15분\n상담 신청: 아래 예약 링크 → '재원생 정기 상담' 선택 → 예약";
  const MANUAL_NOTICE_BODIES = {
    "kinder:after_1": "안녕하세요 어머님 😊\n#{학생이름_주격} 비비작에서 수업을 시작한 지 어느덧 한 달이 지났습니다.\n\n처음 안내드린 대로 등록 후 1개월 차 정기상담을 진행하려 합니다.",
    "kinder:after_3": "안녕하세요 어머님 😊\n#{학생이름_주격} 비비작에서 수업을 시작한 지 어느덧 3개월이 지났습니다.\n\n그동안의 수업 모습과 학원 생활에 대해 함께 이야기 나누고자 정기상담을 진행하려 합니다.",
    "elementary:after_3": "안녕하세요 어머님 😊\n#{학생이름_주격} 비비작에서 수업을 시작한 지 어느덧 3개월이 지났습니다.\n\n그동안의 수업 모습과 학원 생활에 대해 함께 이야기 나누고자 정기상담을 진행하려 합니다.",
    "elementary:after_1": "안녕하세요 어머님 😊\n#{학생이름_주격} 비비작에서 수업을 시작한 지 어느덧 한 달이 지났습니다.\n\n처음 안내드린 대로 등록 후 1개월 차 정기상담을 진행하려 합니다.",
    "kinder:every_6": "안녕하세요, 어머님 😊\n#{학생이름_주격} 비비작에서 수업을 시작한 지 어느덧 6개월이 지났습니다^^\n\n그동안의 수업 작품과 새롭게 진행한 성향 테스트 결과를 바탕으로 #{학생이름_소유격} 그림과 테스트에서는 어떤 결과가 보이는지, 학원 생활에는 잘 적응하고 있는지 함께 이야기 나누려 합니다.",
    "elementary:every_6": "안녕하세요, 어머님 😊\n#{학생이름_주격} 비비작에서 수업을 시작한 지 어느덧 6개월이 지났습니다^^\n그동안의 수업 작품을 바탕으로 #{학생이름_소유격} 그림에서는 어떤 성향이 보이는지, 학원 생활에는 잘 적응하고 있는지 함께 이야기 나누려 합니다.",
    "kinder:every_12": "안녕하세요, 어머님\n지난 1년 동안 #{학생이름_주격} 어떤 성장을 했을까요? 😊\n\n그동안 담임 선생님이 기록한 수업 피드백과 아이의 작품을 바탕으로 #{학생이름_소유격} 생각과 표현에 어떤 변화가 있었는지 살펴보며 이야기 나누고자 합니다.",
    "elementary:every_12": "안녕하세요, 어머님\n지난 1년 동안 #{학생이름_주격} 어떤 성장을 했을까요? 😊\n\n그동안 담임 선생님이 기록한 수업 피드백과 아이의 작품을 바탕으로 #{학생이름_소유격} 생각과 표현에 어떤 변화가 있었는지 살펴보며 이야기 나누고자 합니다.",
    "annual:every_12": "안녕하세요, 어머님 😊\n\n올해도 #{학생이름_소유격} 정기상담 기간이 돌아왔습니다^^\n\n그동안의 그림과 수업 과정을 함께 살펴보거나, 가정에서 궁금하셨던 점이 있다면 편하게 상담을 신청해 주세요. 😊"
  };
  const manualNoticeCache = { academyId:'', sessionToken:'', notices:null, promise:null };
  async function loadManualNotices(force=false) {
    const ctx=context();
    if (!ctx.academyId || !ctx.sessionToken || typeof global.callOlliRpc !== 'function') throw new Error('학원 로그인이 필요합니다.');
    if (manualNoticeCache.academyId!==ctx.academyId || manualNoticeCache.sessionToken!==ctx.sessionToken) {
      manualNoticeCache.academyId=ctx.academyId;
      manualNoticeCache.sessionToken=ctx.sessionToken;
      manualNoticeCache.notices=null;
      manualNoticeCache.promise=null;
    }
    if (!force && manualNoticeCache.notices) return manualNoticeCache.notices;
    if (!force && manualNoticeCache.promise) return manualNoticeCache.promise;
    const pending=global.callOlliRpc('olli_consultation_manual_notice_manage', {
      p_session_token:ctx.sessionToken,p_academy_id:ctx.academyId,p_action:'load',p_key:null,p_body:null
    }).then(result=>{
      if (!sameContext(ctx) || result?.ok!==true) throw new Error('안내문 서버 조회 실패');
      manualNoticeCache.notices=result.notices||{};
      return manualNoticeCache.notices;
    }).finally(()=>{if(manualNoticeCache.promise===pending)manualNoticeCache.promise=null;});
    manualNoticeCache.promise=pending;
    return pending;
  }
  function manualNoticeDefaults(key) {
    return (MANUAL_NOTICE_BODIES[key] || '') + '\n\n' + MANUAL_NOTICE_INFO;
  }
  function manualNoticeEditorMarkup() {
    const slots=global.OlliConsultationMessageTemplates?.slots||[];
    return '<div class="ocm-manual-editor"><h3>안내문 복사 문구</h3><p class="ocm-muted">솔라피 승인 문구와 별도로 저장됩니다. 변경하면 PC·모바일 복사에 반영됩니다.</p>'
      +slots.map(slot=>'<details data-manual-key="'+escape(slot.key)+'"><summary>'+escape(slot.label)+'</summary><textarea rows="7" maxlength="5000" style="width:100%;box-sizing:border-box;white-space:pre-wrap" data-manual-body></textarea><button type="button" data-manual-save>복사용 안내문 저장</button></details>').join('')+'</div>';
  }
  async function hydrateManualNoticeEditor() {
    const host=active?.dialog?.querySelector('.ocm-manual-editor');
    if (!host) return;
    try {
      const notices=await loadManualNotices();
      if (!host.isConnected) return;
      host.querySelectorAll('[data-manual-key]').forEach(item=>{
        const key=item.dataset.manualKey;
        item.querySelector('[data-manual-body]').value=notices[key]??manualNoticeDefaults(key);
      });
    }catch(error){
      host.querySelector('p').textContent='안내문 조회 실패: '+(error.message||error);
    }
  }
  async function saveManualNotice(event) {
    const button=event.target.closest('[data-manual-save]');
    if(!button)return;
    const item=button.closest('[data-manual-key]');
    const key=item.dataset.manualKey, body=item.querySelector('[data-manual-body]').value;
    const ctx=context();
    button.disabled=true;
    try {
      const result=await global.callOlliRpc('olli_consultation_manual_notice_manage',{
        p_session_token:ctx.sessionToken,p_academy_id:ctx.academyId,p_action:'save',p_key:key,p_body:body
      });
      if (result?.ok!==true || !sameContext(ctx)) throw new Error('안내문 저장이 확인되지 않았습니다.');
      if (manualNoticeCache.notices) manualNoticeCache.notices[key]=body;
      notice('복사용 안내문을 저장했습니다.');
    }catch(error){notice(error.message||'저장 실패',true);}
    finally{button.disabled=false;}
  }
  function manualGivenName(fullName) {
    const value = String(fullName || '').trim();
    if (!/^[가-힣]{3,}$/.test(value)) return value;
    const compound = ['남궁','황보','제갈','선우','독고','사공','서문','동방'];
    return value.slice(compound.some(name => value.startsWith(name)) ? 2 : 1);
  }
  function manualNameValue(fullName, kind) {
    const name = manualGivenName(fullName);
    const last = name.charCodeAt(name.length - 1);
    const jong = last >= 0xac00 && last <= 0xd7a3 ? (last - 0xac00) % 28 : 0;
    const friendly = jong ? name + '이' : name;
    if (kind === 'subject') return friendly + '는';
    if (kind === 'nominative') return friendly + '가';
    if (kind === 'possessive') return friendly + '의';
    return friendly;
  }
  function manualNoticeStage(card, student) {
    if (typeof global.getConsultationDueTasksForStudent === 'function' && student) {
      const tasks = global.getConsultationDueTasksForStudent(student) || [];
      if (tasks.length) {
        const chosen = global.OlliConsultationMessageTemplates?.select({template_mode:'common'},student,tasks);
        if (Number(chosen?.task?.occurrenceMonths) >= 24) return 'annual:every_12';
        if (['after_1','after_3','every_6','every_12'].includes(chosen?.task?.ruleKey)) return chosen.task.ruleKey;
      }
    }
    const months = Array.from(card.querySelectorAll('.recordAcademyRuleChip, .recordAcademyInfoChip'))
      .map(chip => Number((chip.textContent || '').match(/(\d+)\s*개월/)?.[1])).find(Number.isFinite);
    if (months >= 24) return 'annual:every_12';
    if (months >= 12) return 'every_12';
    if (months >= 6) return 'every_6';
    if (months >= 3) return 'after_3';
    return 'after_1';
  }
  function manualNoticeStudent(card) {
    const ref = card.dataset.pcStudentRef || card.dataset.studentRef || '';
    if (ref && global.OlliPcStudentManagement?.resolveStudent) {
      const matched = global.OlliPcStudentManagement.resolveStudent(ref);
      if (matched) return matched;
    }
    const id = card.dataset.studentId || '';
    const name = String(card.querySelector('.recordAcademyListName, .recordAcademyConsultStudentName, .studentName')?.textContent || '').trim();
    const all = typeof global.getAllStudents === 'function' ? global.getAllStudents() : [];
    if (id) return all.find(student => String(student.id) === String(id)) || null;
    const matching = all.filter(student => student.name === name);
    return matching.length === 1 ? matching[0] : null;
  }
  async function manualNoticeConfig() {
    const ctx = context();
    if (!ctx.academyId || !ctx.sessionToken || typeof global.callOlliRpc !== 'function') throw new Error('학원 로그인 정보를 확인할 수 없습니다.');
    const result = await global.callOlliRpc('olli_consultation_messages_manage', {
      p_session_token:ctx.sessionToken,p_academy_id:ctx.academyId,p_action:'load',p_data:{}
    });
    if (result?.ok !== true || !sameContext(ctx)) throw new Error('상담 안내 설정을 조회할 수 없습니다.');
    return result.settings || {};
  }
  async function copyManualConsultationNotice(card, button) {
    const student = manualNoticeStudent(card);
    if (!student) throw new Error('학생을 정확하게 찾지 못했습니다. 학생 카드를 다시 열어 주세요.');
    const stage = manualNoticeStage(card, student);
    const division = (student.type || student.division) === 'kinder' ? 'kinder' : 'elementary';
    const key = stage === 'annual:every_12' ? stage : division + ':' + stage;
    const settings = await manualNoticeConfig();
    const variant = settings.template_mode === 'by_type' && settings.template_variants?.[key]?.use_common === false
      ? settings.template_variants[key] : null;
    // Manual copying follows the approved academy copy wording independently of older Solapi templates.
    const notices = await loadManualNotices();
    let body = notices[key] ?? manualNoticeDefaults(key);
    // The old template contained '#{학생이름_주격}가'; the token already includes the subject particle.
    body = body.replace(/#\{학생이름_주격\}가/g, '#{학생이름_주격}');
    body = body.replace(/#\{학생이름_주격\}/g, manualNameValue(student.name, 'nominative'))
      .replace(/#\{학생이름_주제\}/g, manualNameValue(student.name, 'subject'))
      .replace(/#\{학생이름_소유격\}/g, manualNameValue(student.name, 'possessive'))
      .replace(/#\{학생명\}/g, manualGivenName(student.name))
      .replace(/#\{학원명\}/g, String(settings.academy_name || '비비작'))
      .replace(/#\{상담구분\}/g, (stage === 'every_12' || stage === 'annual:every_12') ? '12개월' : stage === 'every_6' ? '6개월' : stage === 'after_3' ? '3개월' : '1개월')
      .replace(/#\{예약링크\}/g, String(settings.booking_url || '').trim());
    if (settings.booking_url && !body.includes(settings.booking_url)) body += '\n' + settings.booking_url;
    if (/#\{[^}]+\}/.test(body)) throw new Error('안내문에 아직 치환되지 않은 변수가 있습니다.');
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(body);
    else {
      const field = document.createElement('textarea');
      field.value = body; field.style.position = 'fixed'; field.style.opacity = '0';
      document.body.appendChild(field); field.select();
      const success = document.execCommand('copy'); field.remove();
      if (!success) throw new Error('복사 권한을 확인해 주세요.');
    }
    button.textContent = '복사 완료';
    setTimeout(() => { if (button.isConnected) button.textContent = '안내문 복사'; }, 1800);
  }
  function attachManualConsultationButtons() {
    if (!isOwner()) return;
    document.querySelectorAll('.recordAcademyConsultListItem').forEach(card => {
      if (card.querySelector('[data-consultation-manual-copy]')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.consultationManualCopy = 'true';
      button.textContent = '안내문 복사';
      button.setAttribute('aria-label', '학생 상담 안내문 복사');
      button.style.cssText = 'flex-shrink:0;order:-1;border:1px solid #d8dce4;border-radius:8px;background:#fff;color:#343d4b;padding:7px 10px;font-size:12px;font-weight:600;cursor:pointer';
      button.addEventListener('click', async event => {
        event.preventDefault(); event.stopPropagation();
        button.disabled = true;
        try { await copyManualConsultationNotice(card, button); }
        catch(error) { alert(error.message || '안내문 복사에 실패했습니다.'); }
        finally { button.disabled = false; }
      });
      card.insertBefore(button, card.firstChild);
    });
  }
  function startManualConsultationButtons() {
    if (!document.body) return;
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => { scheduled = false; attachManualConsultationButtons(); });
    };
    new MutationObserver(schedule).observe(document.body, {childList:true,subtree:true});
    schedule();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startManualConsultationButtons);
  else startManualConsultationButtons();

  global.OlliConsultationMessages = Object.freeze({open,close,isOwner});
})(window);
