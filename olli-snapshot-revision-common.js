(function initializeOlliSnapshotRevision(global){
  'use strict';

  if(global.OlliSnapshotRevision?.version)return;

  const VERSION='1.0.0-step7';
  const CHECKPOINT_PREFIX='olli_snapshot_revision_v1:';

  const clean=value=>String(value==null?'':value).trim();

  function safeKey(value){
    return clean(value).replace(/[^a-zA-Z0-9가-힣._:-]/g,'_');
  }

  function revisionValue(value){
    const n=Number(value||0);
    return Number.isFinite(n)&&n>=0?Math.floor(n):0;
  }

  function checkpointKey(context){
    const academyId=safeKey(context?.academyId||context?.academy_id);
    const accountId=safeKey(context?.accountId||context?.account_id||'account');
    const snapshotKey=safeKey(context?.snapshotKey||context?.snapshot_key);
    return academyId&&snapshotKey
      ?CHECKPOINT_PREFIX+accountId+':'+academyId+':'+snapshotKey
      :'';
  }

  function readCheckpoint(context){
    const key=checkpointKey(context);
    if(!key)return null;
    try{
      const raw=global.localStorage?.getItem?.(key);
      const parsed=raw?JSON.parse(raw):null;
      if(!parsed||Number(parsed.schema_version||0)!==1)return null;
      return Object.freeze({
        markerName:clean(parsed.marker_name),
        revision:revisionValue(parsed.revision)
      });
    }catch(_){return null}
  }

  function writeCheckpoint(context,markerName,revision){
    const key=checkpointKey(context);
    const marker=clean(markerName);
    if(!key||!marker)return false;
    try{
      global.localStorage?.setItem?.(key,JSON.stringify({
        schema_version:1,
        academy_id:clean(context?.academyId||context?.academy_id),
        account_id:clean(context?.accountId||context?.account_id),
        snapshot_key:clean(context?.snapshotKey||context?.snapshot_key),
        marker_name:marker,
        revision:revisionValue(revision),
        saved_at:new Date().toISOString()
      }));
      return true;
    }catch(_){return false}
  }

  function clearCheckpoint(context){
    const key=checkpointKey(context);
    if(!key)return false;
    try{
      global.localStorage?.removeItem?.(key);
      return true;
    }catch(_){return false}
  }

  function ensureCurrent(isCurrent){
    if(typeof isCurrent==='function'&&isCurrent()!==true){
      const error=new Error('Snapshot sync context changed');
      error.code='OLLI_SNAPSHOT_STALE';
      throw error;
    }
  }

  function normalizeManifest(payload){
    if(!payload||payload.ok!==true){
      throw new Error(clean(payload?.message)||'동기화 상태를 확인하지 못했습니다.');
    }
    return{
      protocol:Number(payload.protocol||0),
      academyId:clean(payload.academy_id),
      markers:payload.markers&&typeof payload.markers==='object'?payload.markers:{}
    };
  }

  function markerFromManifest(manifest,name){
    const key=clean(name);
    const marker=manifest?.markers?.[key];
    if(!marker||typeof marker!=='object')return null;
    return Object.freeze({
      name:key,
      kind:clean(marker.kind),
      revision:revisionValue(marker.value),
      coverage:clean(marker.coverage)
    });
  }

  async function fetchManifest(options){
    const rpc=options?.rpc;
    const academyId=clean(options?.academyId);
    const sessionToken=clean(options?.sessionToken);
    if(typeof rpc!=='function')throw new Error('Snapshot sync RPC 호출기가 없습니다.');
    if(!academyId||!sessionToken)throw new Error('Snapshot sync context가 없습니다.');
    ensureCurrent(options?.isCurrent);
    const payload=normalizeManifest(await rpc('olli_sync_manifest',{
      p_session_token:sessionToken,
      p_academy_id:academyId
    }));
    ensureCurrent(options?.isCurrent);
    return payload;
  }

  function isManifestUnavailable(error){
    const message=clean(error?.message||error).toLowerCase();
    return message.includes('olli_sync_manifest')
      &&(
        message.includes('not find')
        ||message.includes('not found')
        ||message.includes('does not exist')
        ||message.includes('pgrst202')
        ||message.includes('schema cache')
      );
  }

  async function syncSnapshot(options){
    const snapshotKey=clean(options?.snapshotKey);
    const markerName=clean(options?.markerName);
    const academyId=clean(options?.academyId);
    const accountId=clean(options?.accountId||'account');
    const sessionToken=clean(options?.sessionToken);
    const loadSnapshot=options?.loadSnapshot;
    const isCurrent=options?.isCurrent;
    const force=options?.force===true;

    if(!snapshotKey||!markerName||!academyId||!sessionToken||typeof loadSnapshot!=='function'){
      throw new Error('Snapshot sync 설정이 올바르지 않습니다.');
    }

    const checkpointContext={academyId,accountId,snapshotKey};
    let marker=null;
    let manifestAvailable=true;

    try{
      const manifest=await fetchManifest({
        rpc:options.rpc,
        academyId,
        sessionToken,
        isCurrent
      });
      marker=markerFromManifest(manifest,markerName);
      if(!marker)throw new Error('Snapshot sync marker가 없습니다: '+markerName);
    }catch(error){
      if(isManifestUnavailable(error)){
        manifestAvailable=false;
      }else{
        throw error;
      }
    }

    ensureCurrent(isCurrent);

    const localCheckpoint=readCheckpoint(checkpointContext);
    if(
      manifestAvailable
      && !force
      && localCheckpoint
      && localCheckpoint.markerName===markerName
      && localCheckpoint.revision===marker.revision
    ){
      return Object.freeze({
        applied:false,
        skipped:true,
        changed:false,
        fallback:false,
        marker
      });
    }

    // Marker was captured before the snapshot. If a write happens while the
    // snapshot is loading, the later revision will remain ahead and reconcile next time.
    const result=await loadSnapshot({
      marker,
      fallback:!manifestAvailable,
      isCurrent
    });
    ensureCurrent(isCurrent);

    const successful=result!==false
      && !(result&&typeof result==='object'&&(result.error||result.stale||result.success===false));
    if(!successful){
      return Object.freeze({
        applied:false,
        skipped:false,
        changed:false,
        fallback:!manifestAvailable,
        marker,
        result
      });
    }

    // Never manufacture a durable checkpoint when the manifest RPC is unavailable.
    if(manifestAvailable){
      writeCheckpoint(checkpointContext,markerName,marker.revision);
    }

    const changed=!!(result&&typeof result==='object'&&result.changed===true);
    return Object.freeze({
      applied:true,
      skipped:false,
      changed,
      fallback:!manifestAvailable,
      marker,
      result
    });
  }

  global.OlliSnapshotRevision=Object.freeze({
    version:VERSION,
    readCheckpoint,
    writeCheckpoint,
    clearCheckpoint,
    fetchManifest,
    markerFromManifest,
    syncSnapshot,
    isManifestUnavailable
  });
})(window);
