(function initializeOlliReconciliation(global){
  'use strict';

  if(global.OlliReconciliation?.version)return;

  const VERSION='1.0.0-step9';
  const SESSION_KEY='olli_account_session_token_v1';
  const ACADEMY_KEY='olli_current_academy_id';
  const COALESCE_MS=140;

  const state={
    started:false,
    running:false,
    pending:false,
    timer:null,
    sequence:0,
    runSequence:0,
    reasons:new Set(),
    forceRealtime:false,
    ensureInFlight:false,
    lastRunAt:0,
    lastReason:'',
    lastAcademyId:'',
    lastError:''
  };

  const clean=value=>String(value==null?'':value).trim();

  function currentAcademyId(){
    try{
      const context=global.OlliStorageCore?.AcademyContext?.getCurrent?.()||null;
      const id=clean(context?.academyId||context?.academy_id);
      if(id)return id;
    }catch(_){}
    try{return clean(global.localStorage?.getItem?.(ACADEMY_KEY))}catch(_){return ''}
  }

  function currentSessionToken(){
    try{return clean(global.localStorage?.getItem?.(SESSION_KEY))}catch(_){return ''}
  }

  function captureContext(){
    const academyContext=global.OlliStorageCore?.AcademyContext;
    const academyToken=academyContext?.captureToken?.()||null;
    return Object.freeze({
      academyId:currentAcademyId(),
      sessionToken:currentSessionToken(),
      academyToken
    });
  }

  function isContextCurrent(snapshot){
    if(!snapshot)return false;
    if(snapshot.academyId!==currentAcademyId())return false;
    if(snapshot.sessionToken!==currentSessionToken())return false;
    const academyContext=global.OlliStorageCore?.AcademyContext;
    if(snapshot.academyToken&&academyContext?.isTokenCurrent){
      try{return !!academyContext.isTokenCurrent(snapshot.academyToken)}catch(_){return false}
    }
    return true;
  }

  function canRun(){
    if(global.document?.hidden)return false;
    if(global.navigator&&global.navigator.onLine===false)return false;
    return !!currentAcademyId()&&!!currentSessionToken();
  }

  function dispatchState(phase,detail={}){
    try{
      global.dispatchEvent?.(new global.CustomEvent('olli:reconciliation-state',{
        detail:{
          phase,
          pending:state.pending,
          running:state.running,
          sequence:state.sequence,
          lastRunAt:state.lastRunAt,
          lastReason:state.lastReason,
          lastAcademyId:state.lastAcademyId,
          lastError:state.lastError,
          version:VERSION,
          ...detail
        }
      }));
    }catch(_){}
  }

  function schedule(delay=COALESCE_MS){
    if(!state.started||state.running||state.timer!==null||!state.pending)return;
    if(!canRun())return;
    state.timer=global.setTimeout(()=>{
      state.timer=null;
      void flush();
    },Math.max(0,Number(delay)||0));
  }

  function request(reason='manual',options={}){
    const normalized=clean(reason)||'manual';
    state.sequence+=1;
    state.pending=true;
    state.reasons.add(normalized);
    if(options.forceRealtime===true)state.forceRealtime=true;
    dispatchState('queued',{reason:normalized});
    schedule(options.immediate===true?0:COALESCE_MS);
    return state.sequence;
  }

  async function ensureRealtime(reason,force){
    if(!global.OlliRealtime?.ensureConnected)return false;
    state.ensureInFlight=true;
    try{
      return await global.OlliRealtime.ensureConnected({
        force:force===true,
        reason:'reconcile:'+reason
      });
    }finally{
      state.ensureInFlight=false;
    }
  }

  function dispatchReconcile(snapshot,reason,reasons,runSequence){
    try{
      global.dispatchEvent?.(new global.CustomEvent('olli:reconcile',{
        detail:{
          protocol:1,
          reason,
          reasons,
          sequence:runSequence,
          academyId:snapshot.academyId,
          requestedAt:Date.now(),
          isCurrent:()=>isContextCurrent(snapshot),
          version:VERSION
        }
      }));
      return true;
    }catch(error){
      state.lastError=clean(error?.message||error);
      return false;
    }
  }

  async function flush(){
    if(!state.started||state.running||!state.pending)return false;
    if(!canRun())return false;

    const snapshot=captureContext();
    if(!snapshot.academyId||!snapshot.sessionToken)return false;

    const runSequence=state.sequence;
    const reasons=[...state.reasons];
    const reason=reasons[reasons.length-1]||'reconcile';
    const forceRealtime=state.forceRealtime;

    state.running=true;
    state.pending=false;
    state.reasons.clear();
    state.forceRealtime=false;
    state.runSequence=runSequence;
    state.lastReason=reason;
    state.lastAcademyId=snapshot.academyId;
    state.lastError='';
    dispatchState('start',{reason,reasons});

    let dispatched=false;
    try{
      if(reason!=='realtime_subscribed'){
        await ensureRealtime(reason,forceRealtime);
      }

      if(!isContextCurrent(snapshot)){
        state.pending=true;
        return false;
      }

      dispatched=dispatchReconcile(snapshot,reason,reasons,runSequence);

      // Step 2 manager remains the execution/coalescing engine for adapters that
      // explicitly register with it. Lifecycle ownership stays here, not in manager.startLifecycle().
      try{
        const manager=global.OlliSyncManager;
        if(manager?.requestRegistered){
          manager.requestRegistered('reconcile:'+reason,{priority:'reconcile'})?.catch?.(()=>{});
        }else{
          manager?.resumePending?.('reconcile:'+reason,{priority:'reconcile'})?.catch?.(()=>{});
        }
      }catch(_){}

      state.lastRunAt=Date.now();
      return dispatched;
    }catch(error){
      state.lastError=clean(error?.message||error);
      // Realtime connection failure does not block authoritative catch-up.
      if(isContextCurrent(snapshot)){
        dispatched=dispatchReconcile(snapshot,reason,reasons,runSequence);
        state.lastRunAt=Date.now();
      }else{
        state.pending=true;
      }
      return dispatched;
    }finally{
      state.running=false;
      dispatchState(state.lastError?'error':'done',{reason,dispatched});
      if(state.sequence>runSequence||state.pending){
        state.pending=true;
        schedule(0);
      }
    }
  }

  function onOnline(){
    request('online',{forceRealtime:true});
  }
  function onFocus(){
    request('focus',{forceRealtime:true});
  }
  function onVisible(){
    if(!global.document?.hidden)request('visible',{forceRealtime:true});
  }
  function onStorage(event){
    if(!event||event.key===null||event.key===SESSION_KEY||event.key===ACADEMY_KEY){
      request('storage',{forceRealtime:true});
    }
  }
  function onAcademyContext(){
    request('academy_context',{forceRealtime:true,immediate:true});
  }
  function onRealtimeStatus(event){
    const detail=event?.detail||{};
    if(detail.status!=='SUBSCRIBED')return;
    if(clean(detail.academyId)!==currentAcademyId())return;
    // A SUBSCRIBED event caused by this coordinator's own ensureConnected is
    // already covered by the current reconciliation pass.
    if(state.ensureInFlight)return;
    request('realtime_subscribed',{immediate:true});
  }
  function onPageShow(event){
    if(event?.persisted===true)request('pageshow',{forceRealtime:true});
  }

  function start(){
    if(state.started)return false;
    state.started=true;
    global.addEventListener?.('online',onOnline);
    global.addEventListener?.('focus',onFocus);
    global.addEventListener?.('storage',onStorage);
    global.addEventListener?.('pageshow',onPageShow);
    global.addEventListener?.('olli:academy-context-changed',onAcademyContext);
    global.addEventListener?.('olli:realtime-status',onRealtimeStatus);
    global.document?.addEventListener?.('visibilitychange',onVisible);
    request('boot',{immediate:true});
    return true;
  }

  function stop(){
    if(!state.started)return false;
    state.started=false;
    if(state.timer!==null){
      global.clearTimeout?.(state.timer);
      state.timer=null;
    }
    global.removeEventListener?.('online',onOnline);
    global.removeEventListener?.('focus',onFocus);
    global.removeEventListener?.('storage',onStorage);
    global.removeEventListener?.('pageshow',onPageShow);
    global.removeEventListener?.('olli:academy-context-changed',onAcademyContext);
    global.removeEventListener?.('olli:realtime-status',onRealtimeStatus);
    global.document?.removeEventListener?.('visibilitychange',onVisible);
    return true;
  }

  function getState(){
    return Object.freeze({
      version:VERSION,
      started:state.started,
      running:state.running,
      pending:state.pending,
      sequence:state.sequence,
      lastRunAt:state.lastRunAt,
      lastReason:state.lastReason,
      lastAcademyId:state.lastAcademyId,
      lastError:state.lastError
    });
  }

  global.OlliReconciliation=Object.freeze({
    version:VERSION,
    start,
    stop,
    request,
    flush,
    getState,
    captureContext,
    isContextCurrent
  });

  const startWhenReady=()=>{try{start()}catch(error){console.warn('올리 중앙 reconciliation 시작 실패:',error?.message||error)}};
  if(global.document?.readyState==='loading')global.document.addEventListener('DOMContentLoaded',startWhenReady,{once:true});
  else global.setTimeout(startWhenReady,0);
})(window);
