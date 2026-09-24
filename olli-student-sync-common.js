(function initializeOlliStudentSync(global){
  'use strict';

  if(global.OlliStudentSync?.version)return;

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

  function dispatch(result,reason){
    try{
      global.dispatchEvent?.(new global.CustomEvent('olli:students-synced',{
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
    if(!current.academyId||!current.sessionToken||typeof global.loadStudentsFromSupabase!=='function'){
      return{applied:false,skipped:true,changed:false};
    }
    const isCurrent=typeof options.isCurrent==='function'
      ?options.isCurrent
      :captureCurrent(current);
    const snapshotApi=global.OlliSnapshotRevision;

    if(!snapshotApi?.syncSnapshot){
      const direct=await global.loadStudentsFromSupabase({skipLifecycleSync:options.skipLifecycleSync===true});
      const result={
        applied:!(direct?.stale||direct?.error),
        skipped:false,
        changed:direct?.changed===true,
        fallback:true,
        result:direct
      };
      if(isCurrent())dispatch(result,options.reason);
      return result;
    }

    const result=await snapshotApi.syncSnapshot({
      snapshotKey:'students',
      markerName:'students',
      academyId:current.academyId,
      accountId:current.accountId||'account',
      sessionToken:current.sessionToken,
      rpc,
      force:options.force===true,
      isCurrent,
      loadSnapshot:async()=>{
        return global.loadStudentsFromSupabase({
          skipLifecycleSync:options.skipLifecycleSync===true
        });
      }
    });
    if(isCurrent())dispatch(result,options.reason);
    return result;
  }

  function sync(options={}){
    if(inFlight)return inFlight;
    inFlight=run(options).catch(error=>{
      console.warn('학생 snapshot 동기화 실패:',error?.message||error);
      return{applied:false,skipped:false,changed:false,error};
    }).finally(()=>{inFlight=null});
    return inFlight;
  }

  function start(){
    if(watcher||!global.OlliRealtime?.watchDomain)return false;
    watcher=global.OlliRealtime.watchDomain('students',async info=>{
      const result=await sync({
        reason:info?.trigger||'students_realtime',
        force:info?.trigger==='change',
        skipLifecycleSync:true,
        isCurrent:info?.isCurrent
      });
      return result?.applied===true||result?.skipped===true;
    });
    global.OlliRealtime.ensureConnected?.({reason:'students_sync'}).catch(()=>{});
    return true;
  }

  function stop(){
    try{watcher?.dispose?.()}catch(_){}
    watcher=null;
  }

  global.OlliStudentSync=Object.freeze({
    version:VERSION,
    sync,
    start,
    stop,
    context
  });

  const startWhenReady=()=>{try{start()}catch(error){console.warn('학생 Realtime 시작 실패:',error?.message||error)}};
  if(global.document?.readyState==='loading')global.document.addEventListener('DOMContentLoaded',startWhenReady,{once:true});
  else global.setTimeout(startWhenReady,0);
})(window);
