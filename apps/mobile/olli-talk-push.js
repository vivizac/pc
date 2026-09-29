(() => {
  'use strict';

  let registrationPromise = null;
  let publicKeyPromise = null;

  function context(){
    let academyId = '';
    try {
      academyId = String(window.OlliStorageCore?.AcademyContext?.getCurrent?.()?.academyId || '').trim();
    } catch (_) {}
    if (!academyId) {
      try { academyId = String(localStorage.getItem('olli_current_academy_id') || '').trim(); } catch (_) {}
    }

    let sessionToken = '';
    try {
      sessionToken = typeof window.getOlliPhoneWritableAccountSessionToken === 'function'
        ? String(window.getOlliPhoneWritableAccountSessionToken() || '').trim()
        : '';
    } catch (_) {}
    if (!sessionToken) {
      try { sessionToken = String(localStorage.getItem('olli_account_session_token_v1') || '').trim(); } catch (_) {}
    }

    return { academyId, sessionToken };
  }

  function isIos(){
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isStandalone(){
    return window.matchMedia?.('(display-mode: standalone)')?.matches === true
      || window.navigator.standalone === true;
  }

  function getButton(){
    return document.getElementById('olliTalkPushBtn');
  }

  function setButtonState(state){
    const button = getButton();
    if (!button) return;

    button.classList.remove('active', 'denied', 'unsupported', 'loading');
    button.dataset.pushState = state;

    if (state === 'active') {
      button.classList.add('active');
      button.title = '올리톡 알림 켜짐';
      button.setAttribute('aria-label', '올리톡 알림 켜짐');
    } else if (state === 'denied') {
      button.classList.add('denied');
      button.title = '알림 권한이 꺼져 있어요';
      button.setAttribute('aria-label', '올리톡 알림 권한 꺼짐');
    } else if (state === 'unsupported') {
      button.classList.add('unsupported');
      button.title = '이 환경에서는 푸시 알림을 사용할 수 없어요';
      button.setAttribute('aria-label', '올리톡 푸시 알림 사용 불가');
    } else if (state === 'loading') {
      button.classList.add('loading');
      button.title = '올리톡 알림 준비 중';
      button.setAttribute('aria-label', '올리톡 알림 준비 중');
    } else {
      button.title = '올리톡 알림 켜기';
      button.setAttribute('aria-label', '올리톡 알림 켜기');
    }
  }

  function supportsPush(){
    return 'serviceWorker' in navigator
      && 'PushManager' in window
      && 'Notification' in window;
  }

  function base64UrlToUint8Array(base64Url){
    const padding = '='.repeat((4 - base64Url.length % 4) % 4);
    const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from(raw, (character) => character.charCodeAt(0));
  }

  async function registerServiceWorker(){
    if (!supportsPush()) throw new Error('이 기기에서는 푸시 알림을 사용할 수 없습니다.');
    if (!registrationPromise) {
      registrationPromise = navigator.serviceWorker
        .register('./olli-push-sw.js?v=20260929-work-material-badge-1', { scope: './' })
        .then(() => navigator.serviceWorker.ready)
        .catch((error) => {
          registrationPromise = null;
          throw error;
        });
    }
    return registrationPromise;
  }

  async function callPushFunction(payload){
    if (typeof SUPABASE_URL === 'undefined') throw new Error('Supabase 연결 정보가 없습니다.');
    const headers = { 'Content-Type': 'application/json' };
    if (typeof SUPABASE_KEY !== 'undefined' && SUPABASE_KEY) headers.apikey = SUPABASE_KEY;

    const response = await fetch(SUPABASE_URL + '/functions/v1/olli-team-chat-push', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = { error: raw }; }
    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || ('푸시 서버 요청 실패 (' + response.status + ')'));
    }
    return data;
  }

  async function getPublicKey(){
    if (publicKeyPromise) return publicKeyPromise;
    const current = context();
    if (!current.academyId || !current.sessionToken) throw new Error('로그인 정보가 없습니다.');

    publicKeyPromise = callPushFunction({
      action: 'public-key',
      session_token: current.sessionToken,
      academy_id: current.academyId,
    }).then((result) => {
      const key = String(result.public_key || '').trim();
      if (!key) throw new Error('푸시 공개키를 불러오지 못했습니다.');
      return key;
    }).catch((error) => {
      publicKeyPromise = null;
      throw error;
    });

    return publicKeyPromise;
  }

  async function saveSubscription(subscription){
    const current = context();
    if (!current.academyId || !current.sessionToken) throw new Error('로그인 정보가 없습니다.');
    const json = subscription.toJSON();
    const endpoint = String(json.endpoint || subscription.endpoint || '').trim();
    const p256dh = String(json.keys?.p256dh || '').trim();
    const auth = String(json.keys?.auth || '').trim();

    if (!endpoint || !p256dh || !auth) throw new Error('푸시 구독 정보가 올바르지 않습니다.');
    if (typeof window.supabase !== 'function' && typeof supabase !== 'function') throw new Error('Supabase 연결 함수가 없습니다.');
    const call = typeof window.supabase === 'function' ? window.supabase : supabase;

    const result = await call('POST', 'rpc/olli_team_chat_push_subscribe', {
      p_session_token: current.sessionToken,
      p_academy_id: current.academyId,
      p_endpoint: endpoint,
      p_p256dh: p256dh,
      p_auth: auth,
      p_user_agent: navigator.userAgent || null,
    });

    if (!result?.ok) throw new Error(result?.message || '푸시 구독 저장에 실패했습니다.');
    return true;
  }

  async function ensureSubscription(options = {}){
    const interactive = options.interactive === true;

    if (!supportsPush()) {
      setButtonState('unsupported');
      if (interactive) alert('이 기기에서는 올리톡 푸시 알림을 사용할 수 없습니다.');
      return false;
    }

    if (isIos() && !isStandalone()) {
      setButtonState('unsupported');
      if (interactive) {
        alert('아이폰에서는 Safari에서 올리를 홈 화면에 추가한 뒤, 홈 화면의 올리에서 알림을 켜 주세요.');
      }
      return false;
    }

    if (Notification.permission === 'denied') {
      setButtonState('denied');
      if (interactive) alert('아이폰 설정에서 올리의 알림 권한을 켜 주세요.');
      return false;
    }

    if (Notification.permission === 'default') {
      setButtonState('idle');
      if (!interactive) return false;
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setButtonState(permission === 'denied' ? 'denied' : 'idle');
        return false;
      }
    }

    setButtonState('loading');

    try {
      const registration = await registerServiceWorker();
      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        const publicKey = await getPublicKey();
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(publicKey),
        });
      }

      await saveSubscription(subscription);
      setButtonState('active');
      return true;
    } catch (error) {
      console.warn('올리톡 푸시 구독 실패:', error);
      setButtonState('idle');
      if (interactive) alert('알림을 켜지 못했습니다.\n' + (error?.message || error));
      return false;
    }
  }

  async function dispatch(messageId){
    const current = context();
    const id = Number(messageId || 0);
    if (!current.academyId || !current.sessionToken || !Number.isInteger(id) || id <= 0) return false;

    try {
      await callPushFunction({
        action: 'dispatch',
        session_token: current.sessionToken,
        academy_id: current.academyId,
        message_id: id,
      });
      return true;
    } catch (error) {
      console.warn('올리톡 대상 푸시 전송 실패:', error);
      return false;
    }
  }

  async function dispatchMaterial(requestId){
    const current=context();
    const id=String(requestId||'').trim();
    if(!current.academyId||!current.sessionToken||!id)return false;
    try{
      await callPushFunction({
        action:'dispatch-material',
        session_token:current.sessionToken,
        academy_id:current.academyId,
        request_id:id,
      });
      return true;
    }catch(error){
      console.warn('재료주문 대상 푸시 전송 실패:',error);
      return false;
    }
  }

  function setAppBadge(count){
    const value = Math.max(0, Number(count || 0));
    try {
      if (value > 0 && typeof navigator.setAppBadge === 'function') {
        navigator.setAppBadge(value).catch(() => {});
      } else if (value === 0 && typeof navigator.clearAppBadge === 'function') {
        navigator.clearAppBadge().catch(() => {});
      }
    } catch (_) {}
  }

  function openFromNotification(messageId){
    if (typeof window.openOlliTalkBetaPage !== 'function') return;
    window.openOlliTalkBetaPage();
    const id = Number(messageId || 0);
    if (!id) return;

    let attempts = 0;
    const scroll = () => {
      attempts += 1;
      const row = document.querySelector('#olliTalkBetaChatArea [data-message-id="' + id + '"]');
      if (row) {
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      if (attempts < 8) setTimeout(scroll, 250);
    };
    setTimeout(scroll, 250);
  }

  function openMaterialsFromNotification(){
    if(typeof window.openOlliTalkBetaPage==='function')window.openOlliTalkBetaPage();
    setTimeout(()=>window.openOlliTalkArchivePage?.(null,{tab:'materials'}),220);
  }

  function bind(){
    const button = getButton();
    if (button && !button.__olliPushBound) {
      button.__olliPushBound = true;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        ensureSubscription({ interactive: true });
      });
    }

    navigator.serviceWorker?.addEventListener?.('message', (event) => {
      if (event?.data?.type === 'OLLI_TALK_OPEN_FROM_NOTIFICATION') {
        openFromNotification(event.data.messageId);
      } else if(event?.data?.type==='OLLI_WORK_OPEN_MATERIALS'){
        openMaterialsFromNotification();
      }
    });

    const params = new URLSearchParams(window.location.search || '');
    if (params.get('olliTalk') === '1') {
      const messageId = params.get('message');
      setTimeout(() => openFromNotification(messageId), 700);
      params.delete('olliTalk');
      params.delete('message');
      const nextQuery = params.toString();
      const nextUrl = window.location.pathname + (nextQuery ? '?' + nextQuery : '') + window.location.hash;
      try { history.replaceState(history.state, '', nextUrl); } catch (_) {}
    } else if(params.get('olliWork')==='materials'){
      setTimeout(openMaterialsFromNotification,700);
      params.delete('olliWork');
      const nextQuery=params.toString();
      const nextUrl=window.location.pathname+(nextQuery?'?'+nextQuery:'')+window.location.hash;
      try{history.replaceState(history.state,'',nextUrl)}catch(_){}
    }

    ensureSubscription({ interactive: false }).catch(() => {});
  }

  window.OlliTalkPush = Object.freeze({
    ensureSubscription,
    dispatch,
    dispatchMaterial,
    setAppBadge,
    syncState: () => ensureSubscription({ interactive: false }),
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }
})();
