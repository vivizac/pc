(function initializeOlliMaterialsSync(global){
  'use strict';

  if(global.OlliMaterialsSync?.version)return;

  const VERSION='1.0.0-step5';
  const CHECKPOINT_PREFIX='olli_team_material_event_checkpoint_v1:';
  const DEFAULT_LIMIT=100;
  const DEFAULT_MAX_PAGES=50;

  const clean=value=>String(value==null?'':value).trim();

  function safeKey(value){
    return clean(value).replace(/[^a-zA-Z0-9._:-]/g,'_');
  }

  function eventId(value){
    const n=Number(value||0);
    return Number.isFinite(n)&&n>0?Math.floor(n):0;
  }

  function normalizeCheckpoint(value){
    if(value==null)return null;
    if(typeof value==='number'||typeof value==='string'){
      return Object.freeze({eventId:eventId(value)});
    }
    if(typeof value!=='object')return null;
    return Object.freeze({eventId:eventId(value.event_id||value.eventId)});
  }

  function checkpointKey(context){
    const academyId=safeKey(context?.academyId||context?.academy_id);
    const accountId=safeKey(context?.accountId||context?.account_id||'account');
    return academyId?(CHECKPOINT_PREFIX+accountId+':'+academyId):'';
  }

  function readCheckpoint(context){
    const key=checkpointKey(context);
    if(!key)return null;
    try{
      const raw=global.localStorage?.getItem?.(key);
      const parsed=raw?JSON.parse(raw):null;
      if(!parsed||Number(parsed.schema_version||0)!==1)return null;
      return normalizeCheckpoint(parsed);
    }catch(_){return null}
  }

  function writeCheckpoint(context,checkpoint){
    const key=checkpointKey(context);
    const normalized=normalizeCheckpoint(checkpoint);
    if(!key||!normalized)return false;
    try{
      global.localStorage?.setItem?.(key,JSON.stringify({
        schema_version:1,
        academy_id:clean(context?.academyId||context?.academy_id),
        account_id:clean(context?.accountId||context?.account_id),
        event_id:normalized.eventId,
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
      const error=new Error('Materials sync context changed');
      error.code='OLLI_MATERIALS_STALE';
      throw error;
    }
  }

  function normalizeSummary(summary){
    return{
      requested:Math.max(0,Number(summary?.requested||0)),
      on_hold:Math.max(0,Number(summary?.on_hold||0)),
      ordered:Math.max(0,Number(summary?.ordered||0)),
      arrived:Math.max(0,Number(summary?.arrived||0))
    };
  }

  function normalizeDeltaPayload(payload){
    if(!payload||payload.ok!==true){
      throw new Error(clean(payload?.message)||'재료 요청 변경분을 불러오지 못했습니다.');
    }
    return{
      baseline:payload.baseline===true,
      academyId:clean(payload.academy_id),
      currentMemberId:clean(payload.current_member_id),
      currentRole:clean(payload.current_role),
      canProcess:payload.can_process===true,
      summary:normalizeSummary(payload.summary),
      latestEventId:eventId(payload.latest_event_id),
      nextEventId:eventId(payload.next_event_id),
      hasMore:payload.has_more===true,
      items:Array.isArray(payload.items)?payload.items:[],
      deletedRequestIds:Array.isArray(payload.deleted_request_ids)
        ?payload.deleted_request_ids.map(clean).filter(Boolean)
        :[],
      changeTypes:Array.isArray(payload.change_types)
        ?payload.change_types.map(clean).filter(Boolean)
        :[]
    };
  }

  async function createBaseline(options){
    const rpc=options?.rpc;
    const academyId=clean(options?.academyId);
    const sessionToken=clean(options?.sessionToken);
    if(typeof rpc!=='function')throw new Error('Materials sync RPC 호출기가 없습니다.');
    if(!academyId||!sessionToken)throw new Error('Materials sync baseline context가 없습니다.');
    ensureCurrent(options?.isCurrent);
    const payload=normalizeDeltaPayload(await rpc('olli_team_material_requests_delta',{
      p_session_token:sessionToken,
      p_academy_id:academyId,
      p_after_event_id:null,
      p_limit:1
    }));
    ensureCurrent(options?.isCurrent);
    return Object.freeze({eventId:payload.nextEventId||payload.latestEventId});
  }

  async function pull(options){
    const rpc=options?.rpc;
    const academyId=clean(options?.academyId);
    const sessionToken=clean(options?.sessionToken);
    const initial=normalizeCheckpoint(options?.checkpoint);
    if(typeof rpc!=='function')throw new Error('Materials sync RPC 호출기가 없습니다.');
    if(!academyId||!sessionToken||!initial)throw new Error('Materials sync cursor가 준비되지 않았습니다.');

    const limit=Math.max(1,Math.min(Number(options?.limit||DEFAULT_LIMIT),200));
    const maxPages=Math.max(1,Math.min(Number(options?.maxPages||DEFAULT_MAX_PAGES),100));
    let cursor=initial.eventId;
    let latestEventId=cursor;
    let pages=0;
    let complete=false;
    let latestMeta=null;
    const changed=new Map();
    const deleted=new Set();
    const changeTypes=new Set();

    while(pages<maxPages){
      ensureCurrent(options?.isCurrent);
      const payload=normalizeDeltaPayload(await rpc('olli_team_material_requests_delta',{
        p_session_token:sessionToken,
        p_academy_id:academyId,
        p_after_event_id:cursor,
        p_limit:limit
      }));
      ensureCurrent(options?.isCurrent);

      payload.items.forEach(item=>{
        const id=clean(item?.id);
        if(id)changed.set(id,item);
      });
      payload.deletedRequestIds.forEach(id=>deleted.add(id));
      payload.changeTypes.forEach(type=>changeTypes.add(type));
      latestMeta=payload;
      latestEventId=Math.max(latestEventId,payload.latestEventId);
      pages+=1;

      const next=Math.max(cursor,payload.nextEventId);
      if(!payload.hasMore){
        cursor=next;
        complete=true;
        break;
      }
      if(next<=cursor){
        const error=new Error('Materials sync cursor가 진행되지 않았습니다.');
        error.code='OLLI_MATERIALS_DELTA_STALLED';
        throw error;
      }
      cursor=next;
    }

    return Object.freeze({
      academyId,
      items:[...changed.values()],
      deletedRequestIds:[...deleted],
      changeTypes:[...changeTypes],
      summary:latestMeta?.summary||normalizeSummary(null),
      currentMemberId:latestMeta?.currentMemberId||'',
      currentRole:latestMeta?.currentRole||'',
      canProcess:latestMeta?.canProcess===true,
      checkpoint:Object.freeze({eventId:cursor}),
      latestEventId,
      pages,
      complete
    });
  }

  function statusRank(status){
    if(status==='requested')return 1;
    if(status==='on_hold')return 2;
    if(status==='ordered')return 3;
    if(status==='arrived')return 4;
    return 5;
  }

  function compareItems(a,b){
    const statusDiff=statusRank(clean(a?.status))-statusRank(clean(b?.status));
    if(statusDiff)return statusDiff;

    const aNeeded=clean(a?.needed_on);
    const bNeeded=clean(b?.needed_on);
    if(aNeeded&&bNeeded&&aNeeded!==bNeeded)return aNeeded<bNeeded?-1:1;
    if(aNeeded&&!bNeeded)return -1;
    if(!aNeeded&&bNeeded)return 1;

    const aCreated=clean(a?.created_at);
    const bCreated=clean(b?.created_at);
    if(aCreated!==bCreated)return aCreated>bCreated?-1:1;
    return clean(a?.id).localeCompare(clean(b?.id));
  }

  function applyToPayload(basePayload,delta,options={}){
    const maxItems=Math.max(1,Number(options.maxItems||300));
    const deleted=new Set(
      (Array.isArray(delta?.deletedRequestIds)?delta.deletedRequestIds:[])
        .map(clean)
        .filter(Boolean)
    );
    const merged=new Map();

    (Array.isArray(basePayload?.items)?basePayload.items:[]).forEach(item=>{
      const id=clean(item?.id);
      if(id&&!deleted.has(id))merged.set(id,item);
    });
    (Array.isArray(delta?.items)?delta.items:[]).forEach(item=>{
      const id=clean(item?.id);
      if(id&&!deleted.has(id))merged.set(id,item);
    });
    deleted.forEach(id=>merged.delete(id));

    const items=[...merged.values()]
      .filter(item=>!deleted.has(clean(item?.id)))
      .sort(compareItems)
      .slice(0,maxItems);

    return{
      ok:true,
      academy_id:delta?.academyId||basePayload?.academy_id||'',
      current_member_id:delta?.currentMemberId||basePayload?.current_member_id||'',
      current_role:delta?.currentRole||basePayload?.current_role||'',
      can_process:delta?.currentRole?delta?.canProcess===true:basePayload?.can_process===true,
      summary:delta?.summary?normalizeSummary(delta.summary):normalizeSummary(basePayload?.summary),
      items
    };
  }

  function isUnavailableError(error){
    const message=clean(error?.message||error).toLowerCase();
    return message.includes('olli_team_material_requests_delta')
      &&(
        message.includes('not find')
        ||message.includes('not found')
        ||message.includes('does not exist')
        ||message.includes('pgrst202')
        ||message.includes('schema cache')
      );
  }

  global.OlliMaterialsSync=Object.freeze({
    version:VERSION,
    normalizeCheckpoint,
    readCheckpoint,
    writeCheckpoint,
    clearCheckpoint,
    createBaseline,
    pull,
    applyToPayload,
    compareItems,
    isUnavailableError
  });
})(window);
