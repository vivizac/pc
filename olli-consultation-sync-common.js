(function initializeOlliConsultationSync(global){
  'use strict';

  if(global.OlliConsultationSync?.version)return;

  const VERSION='1.0.0-step7';
  const SESSION_KEY='olli_account_session_token_v1';
  const ACADEMY_KEY='olli_current_academy_id';
  const ACCOUNT_KEY='olli_account_id_v1';
  let watcher=null;
  let inFlight=null;

  const clean=value=>String(value==null?'':value).trim();

  function context(){
    let academyId='',sessionToken='',accountId='';
    try{
      const academy=global.OlliStorageCore?.AcademyContext?.getCurrent?.()||null;
      academyId=clean(academy?.academyId||academy?.academy_id||global.localStorage?.getItem?.(ACADEMY_KEY));
      sessionToken=clean(global.localStorage?.getItem?.(SESSION_KEY));
      accountId=clean(global.localStorage?.getItem?.(ACCOUNT_KEY));
    }catch(_){}
    return{academyId,sessionToken,accountId};
  }

  function captureCurrent(current){
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

  async function rpc(name,params){
    const call=typeof global.supabase==='function'
      ?global.supabase
      :(typeof supabase==='function'?supabase:null);
    if(!call)throw new Error('Supabase 연결이 준비되지 않았습니다.');
    return call('POST','rpc/'+name,params);
  }

  function relevantScreenVisible(){
    const settings=global.document?.getElementById?.('settingsPageScreen');
    if(settings&&(settings.style.display==='flex'||settings.style.display==='block'))return true;
    try{
      return typeof currentRecordView!=='undefined'&&currentRecordView==='academy';
    }catch(_){return false}
  }

  async function loadSettingsSnapshot(){
    const loaders=[];
    if(typeof global.loadOlliConsultationRulesFromServer==='function'){
      loaders.push(global.loadOlliConsultationRulesFromServer({force:true}));
    }
    if(typeof global.loadOlliConsultationProgressFromServer==='function'){
      loaders.push(global.loadOlliConsultationProgressFromServer({force:true}));
    }
    if(typeof global.loadOlliSharedSettingsFromServer==='function'){
      loaders.push(global.loadOlliSharedSettingsFromServer());
    }
    if(!loaders.length)return{success:false,changed:false,skipped:true};
    const results=await Promise.all(loaders);
    return{success:true,changed:results.some(value=>value===true||value?.changed===true)};
  }

  function dispatch(result,reason){
    try{
      global.dispatchEvent?.(new global.CustomEvent('olli:consultation-settings-synced',{
        detail:{
          changed:result?.changed===true,
          applied:result?.applied===true,
          skipped:result?.skipped===true,
          fallback:result?.fallback===true,
          reason:clean(reason),
          version:VERSION
        }
      }));
    }catch(_){}
  }

  async function run(options={}){
    const current=context();
    if(!current.academyId||!current.sessionToken)return{applied:false,skipped:true,changed:false};
    const isCurrent=typeof options.isCurrent==='function'?options.isCurrent:captureCurrent(current);
    const api=global.OlliSnapshotRevision;

    if(!api?.syncSnapshot){
      const direct=await loadSettingsSnapshot();
      const result={applied:direct?.success===true,skipped:false,changed:direct?.changed===true,fallback:true,result:direct};
      if(isCurrent())dispatch(result,options.reason);
      return result;
    }

    const result=await api.syncSnapshot({
      snapshotKey:'consultation_settings',
      markerName:'consultation',
      academyId:current.academyId,
      accountId:current.accountId||'account',
      sessionToken:current.sessionToken,
      rpc,
      force:options.force===true,
      isCurrent,
      loadSnapshot:loadSettingsSnapshot
    });
    if(isCurrent())dispatch(result,options.reason);
    return result;
  }

  function syncSettings(options={}){
    if(inFlight)return inFlight;
    inFlight=run(options).catch(error=>{
      console.warn('상담 설정 snapshot 동기화 실패:',error?.message||error);
      return{applied:false,skipped:false,changed:false,error};
    }).finally(()=>{inFlight=null});
    return inFlight;
  }

  function start(){
    if(watcher||!global.OlliRealtime?.watchDomain)return false;
    watcher=global.OlliRealtime.watchDomain('consultation',async info=>{
      if(!relevantScreenVisible())return true;
      const result=await syncSettings({
        reason:info?.trigger||'consultation_realtime',
        force:info?.trigger==='change',
        isCurrent:info?.isCurrent
      });
      return result?.applied===true||result?.skipped===true;
    });
    global.OlliRealtime.ensureConnected?.({reason:'consultation_settings'}).catch(()=>{});
    return true;
  }

  function stop(){
    try{watcher?.dispose?.()}catch(_){}
    watcher=null;
  }

  global.OlliConsultationSync=Object.freeze({
    version:VERSION,
    syncSettings,
    start,
    stop,
    context,
    relevantScreenVisible
  });

  const startWhenReady=()=>{try{start()}catch(error){console.warn('상담 Realtime 시작 실패:',error?.message||error)}};
  if(global.document?.readyState==='loading')global.document.addEventListener('DOMContentLoaded',startWhenReady,{once:true});
  else global.setTimeout(startWhenReady,0);
})(window);
