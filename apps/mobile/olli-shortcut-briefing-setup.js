(() => {
  'use strict';
  // Dedicated owner/manager credential. It cannot modify Olli records.
  const UUID = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
  let modal = null;
  function context() {
    let academyId = '';
    try { academyId = String(window.OlliStorageCore?.AcademyContext?.getCurrent?.()?.academyId || ''); } catch (_) {}
    if (!academyId) { try { academyId = String(localStorage.getItem('olli_current_academy_id') || ''); } catch (_) {} }
    let sessionToken = '';
    try { sessionToken = String(window.getOlliPhoneWritableAccountSessionToken?.() || ''); } catch (_) {}
    if (!sessionToken) { try { sessionToken = String(localStorage.getItem('olli_account_session_token_v1') || ''); } catch (_) {} }
    return {academyId:academyId.trim(),sessionToken:sessionToken.trim()};
  }
  async function copy(value) {
    await navigator.clipboard.writeText(value);
  }
  async function rpc(action, hash) {
    const ctx = context();
    if (!UUID.test(ctx.academyId) || !ctx.sessionToken) throw new Error('올리에서 다시 로그인해 주세요.');
    if (typeof window.supabase !== 'function') throw new Error('올리 데이터 연결이 준비되지 않았습니다.');
    const data = await window.supabase('POST', 'rpc/olli_shortcut_briefing_manage', {
      p_session_token:ctx.sessionToken,
      p_academy_id:ctx.academyId,
      p_action:action,
      p_token_hash:hash || null
    });
    if (data?.ok !== true) throw new Error('연결키를 처리하지 못했습니다. 로그인 상태를 확인해 주세요.');
    return data;
  }
  function close() {
    if (!modal) return;
    modal.remove(); modal = null;
  }
  async function generate() {
    const note = modal?.querySelector('[data-shortcuts-status]');
    const btn = modal?.querySelector('[data-shortcuts-generate]');
    if (!note || !btn) return;
    btn.disabled = true;
    note.textContent = '읽기 전용 연결키를 준비하고 있습니다.';
    try {
      const before = context();
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const secret = btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret)));
      const hash = Array.from(digest, b => b.toString(16).padStart(2,'0')).join('');
      const result = await rpc('issue', hash);
      const after = context();
      if (before.academyId !== after.academyId || before.sessionToken !== after.sessionToken)
        throw new Error('학원 또는 로그인 계정이 변경되었습니다. 다시 시작해 주세요.');
      const input = modal?.querySelector('[data-shortcuts-token]');
      if (!input) return;
      input.value = secret;
      input.type = 'text';
      modal.querySelector('[data-shortcuts-copy-token]').disabled = false;
      note.textContent = '연결키가 만들어졌습니다. 아이폰 단축어에 붙여넣으세요. 새로 만들면 이전 키는 즉시 무효화됩니다. 만료일: ' + String(result.expires_at || '').slice(0,10);
    } catch(e) {
      note.textContent = e?.message || '연결키를 생성하지 못했습니다.';
    } finally {
      if (btn.isConnected) btn.disabled = false;
    }
  }
  async function revoke() {
    if (!confirm('이 아이폰 단축어 연결키를 해제하시겠습니까? 해제 후에는 새로운 키를 발급해야 합니다.')) return;
    const note=modal?.querySelector('[data-shortcuts-status]');
    try {
      await rpc('revoke',null);
      const input=modal?.querySelector('[data-shortcuts-token]');
      if(input) input.value='';
      modal.querySelector('[data-shortcuts-copy-token]').disabled=true;
      if(note) note.textContent='연결이 해제되었습니다. 기존 단축어에서는 더 이상 올리 일정을 읽을 수 없습니다.';
    } catch(e) { if(note) note.textContent=e?.message||'연결을 해제하지 못했습니다.'; }
  }
  function open() {
    close();
    modal = document.createElement('div');
    modal.className = 'olliShortcutsShade';
    modal.innerHTML = '<section class="olliShortcutsDialog" role="dialog" aria-modal="true" aria-labelledby="olliShortcutsTitle">' +
      '<div class="olliShortcutsHeader"><h2 id="olliShortcutsTitle">아이폰 아침 브리핑 연결</h2><button type="button" data-shortcuts-close aria-label="닫기">×</button></div>' +
      '<p>아이폰 시계 알람을 끄면 올리의 오늘 상담과 미완료 업무를 음성으로 알려줍니다. 단축어에는 로그인 비밀번호를 넣지 않습니다.</p>' +
      '<label class="olliShortcutsLabel">올리 읽기 전용 API 주소</label>' +
      '<div class="olliShortcutsRow"><input data-shortcuts-url readonly aria-label="API 주소"><button type="button" data-shortcuts-copy-url>주소 복사</button></div>' +
      '<label class="olliShortcutsLabel">전용 연결키 (다른 사람에게 보내지 마세요)</label>' +
      '<div class="olliShortcutsRow"><input data-shortcuts-token readonly aria-label="연결키" placeholder="아래 버튼으로 생성"><button type="button" data-shortcuts-copy-token disabled>키 복사</button></div>' +
      '<button type="button" class="olliShortcutsPrimary" data-shortcuts-generate>새 연결키 생성</button>' +
      '<p class="olliShortcutsStatus" role="status" data-shortcuts-status>이 연결키는 상담과 업무를 조회만 할 수 있습니다.</p>' +
      '<div class="olliShortcutsHelp"><strong>아이폰 단축어 설정</strong><ol>' +
      '<li>단축어 앱의 <b>아침 브리핑</b>을 편집합니다.</li>' +
      '<li><b>URL</b> 동작에 위 API 주소를 넣습니다.</li>' +
      '<li><b>URL 콘텐츠 가져오기</b>를 추가하고 방법을 POST, 요청 본문을 JSON으로 설정합니다.</li>' +
      '<li>JSON 키를 <code>token</code>으로 지정하고 복사한 연결키를 값으로 붙여넣습니다.</li>' +
      '<li><b>사전 값 가져오기</b>로 키 <code>text</code>를 읽은 뒤 <b>텍스트 말하기</b>에 연결합니다.</li>' +
      '</ol><small>기존 예제용 텍스트/말하기 동작은 새 동작으로 교체합니다. 잠금 화면에서는 단축어 실행 권한을 허용해야 할 수 있습니다.</small></div>' +
      '<button type="button" class="olliShortcutsRevoke" data-shortcuts-revoke>연결키 해제</button>' +
      '</section>';
    document.body.appendChild(modal);
    modal.querySelector('[data-shortcuts-url]').value=location.origin+'/api/olli-shortcut-briefing';
    modal.querySelector('[data-shortcuts-close]').addEventListener('click',close);
    modal.addEventListener('click',e=>{if(e.target===modal)close();});
    modal.querySelector('[data-shortcuts-generate]').addEventListener('click',generate);
    modal.querySelector('[data-shortcuts-revoke]').addEventListener('click',revoke);
    modal.querySelector('[data-shortcuts-copy-url]').addEventListener('click',async()=>{
      try {await copy(modal.querySelector('[data-shortcuts-url]').value);modal.querySelector('[data-shortcuts-status]').textContent='API 주소를 복사했습니다.';}
      catch(_){modal.querySelector('[data-shortcuts-status]').textContent='주소를 길게 눌러 복사해 주세요.';}
    });
    modal.querySelector('[data-shortcuts-copy-token]').addEventListener('click',async()=>{
      try {await copy(modal.querySelector('[data-shortcuts-token]').value);modal.querySelector('[data-shortcuts-status]').textContent='연결키를 복사했습니다. 다른 사람에게 공유하지 마세요.';}
      catch(_){modal.querySelector('[data-shortcuts-status]').textContent='연결키를 길게 눌러 복사해 주세요.';}
    });
  }
  window.OlliShortcutBriefing=Object.freeze({open});
})();