(function initializeOlliFeedbackSync(global){
  'use strict';

  if(global.OlliFeedbackSync?.version)return;

  const VERSION='1.0.0-step6';
  const CHECKPOINT_PREFIX='olli_feedback_event_checkpoint_v1:';
  const DEFAULT_LIMIT=200;
  const DEFAULT_MAX_PAGES=50;

  const clean=value=>String(value==null?'':value).trim();

  function safeKey(value){
    return clean(value).replace(/[^a-zA-Z0-9가-힣._:-]/g,'_');
  }

  function eventId(value){
    const n=Number(value||0);
    return Number.isFinite(n)&&n>0?Math.floor(n):0;
  }

  function normalizeCheckpoint(value){
    if(value==null)return null;
    if(typeof value==='number'||typeof value==='string')return Object.freeze({eventId:eventId(value)});
    if(typeof value!=='object')return null;
    return Object.freeze({eventId:eventId(value.event_id||value.eventId)});
  }

  function studentScope(context){
    return safeKey(context?.studentId||context?.student_id||context?.studentName||context?.student_name);
  }

  function checkpointKey(context){
    const academyId=safeKey(context?.academyId||context?.academy_id);
    const accountId=safeKey(context?.accountId||context?.account_id||'account');
    const student=studentScope(context);
    return academyId&&student?(CHECKPOINT_PREFIX+accountId+':'+academyId+':'+student):'';
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
        student_id:clean(context?.studentId||context?.student_id),
        student_name:clean(context?.studentName||context?.student_name),
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
      const error=new Error('Feedback sync context changed');
      error.code='OLLI_FEEDBACK_STALE';
      throw error;
    }
  }

  function normalizeDeltaPayload(payload){
    if(!payload||payload.ok!==true){
      throw new Error(clean(payload?.message)||'피드백 변경분을 불러오지 못했습니다.');
    }
    return{
      baseline:payload.baseline===true,
      academyId:clean(payload.academy_id),
      studentId:clean(payload.student_id),
      studentName:clean(payload.student_name),
      latestEventId:eventId(payload.latest_event_id),
      nextEventId:eventId(payload.next_event_id),
      hasMore:payload.has_more===true,
      records:Array.isArray(payload.records)?payload.records:[],
      deletedRecords:Array.isArray(payload.deleted_records)?payload.deleted_records:[],
      changeTypes:Array.isArray(payload.change_types)?payload.change_types.map(clean).filter(Boolean):[]
    };
  }

  async function createBaseline(options){
    const rpc=options?.rpc;
    const academyId=clean(options?.academyId);
    const studentId=clean(options?.studentId);
    const studentName=clean(options?.studentName);
    const sessionToken=clean(options?.sessionToken);
    if(typeof rpc!=='function')throw new Error('Feedback sync RPC 호출기가 없습니다.');
    if(!academyId||!sessionToken||(!studentId&&!studentName))throw new Error('Feedback sync baseline context가 없습니다.');
    ensureCurrent(options?.isCurrent);

    const payload=normalizeDeltaPayload(await rpc('olli_feedback_delta',{
      p_session_token:sessionToken,
      p_academy_id:academyId,
      p_student_id:studentId||null,
      p_student_name:studentName||null,
      p_after_event_id:null,
      p_limit:1
    }));

    ensureCurrent(options?.isCurrent);
    return Object.freeze({eventId:payload.nextEventId||payload.latestEventId});
  }

  async function pull(options){
    const rpc=options?.rpc;
    const academyId=clean(options?.academyId);
    const studentId=clean(options?.studentId);
    const studentName=clean(options?.studentName);
    const sessionToken=clean(options?.sessionToken);
    const initial=normalizeCheckpoint(options?.checkpoint);
    if(typeof rpc!=='function')throw new Error('Feedback sync RPC 호출기가 없습니다.');
    if(!academyId||!sessionToken||(!studentId&&!studentName)||!initial)throw new Error('Feedback sync cursor가 준비되지 않았습니다.');

    const limit=Math.max(1,Math.min(Number(options?.limit||DEFAULT_LIMIT),500));
    const maxPages=Math.max(1,Math.min(Number(options?.maxPages||DEFAULT_MAX_PAGES),100));
    let cursor=initial.eventId;
    let latestEventId=cursor;
    let pages=0;
    let complete=false;
    const changed=new Map();
    const deleted=new Map();
    const changeTypes=new Set();

    while(pages<maxPages){
      ensureCurrent(options?.isCurrent);
      const payload=normalizeDeltaPayload(await rpc('olli_feedback_delta',{
        p_session_token:sessionToken,
        p_academy_id:academyId,
        p_student_id:studentId||null,
        p_student_name:studentName||null,
        p_after_event_id:cursor,
        p_limit:limit
      }));
      ensureCurrent(options?.isCurrent);

      payload.records.forEach(entry=>{
        const sourceTable=clean(entry?.source_table);
        const recordId=clean(entry?.record_id||entry?.row?.id);
        if(sourceTable&&recordId)changed.set(sourceTable+':'+recordId,{
          sourceTable,recordId,row:entry?.row&&typeof entry.row==='object'?entry.row:{}
        });
      });
      payload.deletedRecords.forEach(entry=>{
        const sourceTable=clean(entry?.source_table);
        const recordId=clean(entry?.record_id);
        if(sourceTable&&recordId)deleted.set(sourceTable+':'+recordId,{sourceTable,recordId});
      });
      payload.changeTypes.forEach(type=>changeTypes.add(type));
      latestEventId=Math.max(latestEventId,payload.latestEventId);
      pages+=1;

      const next=Math.max(cursor,payload.nextEventId);
      if(!payload.hasMore){
        cursor=next;
        complete=true;
        break;
      }
      if(next<=cursor){
        const error=new Error('Feedback sync cursor가 진행되지 않았습니다.');
        error.code='OLLI_FEEDBACK_DELTA_STALLED';
        throw error;
      }
      cursor=next;
    }

    return Object.freeze({
      academyId,
      studentId,
      studentName,
      records:[...changed.values()],
      deletedRecords:[...deleted.values()],
      changeTypes:[...changeTypes],
      checkpoint:Object.freeze({eventId:cursor}),
      latestEventId,
      pages,
      complete
    });
  }

  function rowDate(row){
    return row?.date||row?.created_at||row?.updated_at||'';
  }

  function normalizeRecord(entry){
    const sourceTable=clean(entry?.sourceTable||entry?.source_table);
    const row=entry?.row&&typeof entry.row==='object'?entry.row:{};
    const recordId=clean(entry?.recordId||entry?.record_id||row?.id);
    const content=clean(row?.content);
    if(!sourceTable||!recordId||!content||row?.is_deleted===true)return null;
    return{
      id:sourceTable+'_'+recordId,
      rowId:recordId,
      sourceTable,
      content,
      createdAt:rowDate(row),
      row:{...row,source_table:sourceTable}
    };
  }

  function itemKey(item){
    const sourceTable=clean(item?.sourceTable||item?.row?.source_table);
    const recordId=clean(item?.rowId||item?.row?.id);
    return sourceTable&&recordId?sourceTable+':'+recordId:'';
  }

  function sortDesc(a,b){
    return (new Date(b?.createdAt||'').getTime()||0)-(new Date(a?.createdAt||'').getTime()||0);
  }

  function applyToData(baseData,delta,options={}){
    const maxFeedbacks=Math.max(1,Number(options.maxFeedbacks||160));
    const maxSummaries=Math.max(1,Number(options.maxSummaries||50));
    const feedbacks=new Map();
    const summaries=new Map();

    (Array.isArray(baseData?.feedbacks)?baseData.feedbacks:[]).forEach(item=>{
      const key=itemKey(item);
      if(key)feedbacks.set(key,item);
    });
    (Array.isArray(baseData?.summaries)?baseData.summaries:[]).forEach(item=>{
      const key=itemKey(item);
      if(key)summaries.set(key,item);
    });

    (Array.isArray(delta?.deletedRecords)?delta.deletedRecords:[]).forEach(entry=>{
      const sourceTable=clean(entry?.sourceTable||entry?.source_table);
      const recordId=clean(entry?.recordId||entry?.record_id);
      const key=sourceTable&&recordId?sourceTable+':'+recordId:'';
      if(!key)return;
      feedbacks.delete(key);
      summaries.delete(key);
    });

    (Array.isArray(delta?.records)?delta.records:[]).forEach(entry=>{
      const item=normalizeRecord(entry);
      if(!item)return;
      const key=itemKey(item);
      if(item.sourceTable==='summary_feedbacks'){
        summaries.set(key,item);
        feedbacks.delete(key);
      }else{
        feedbacks.set(key,item);
        summaries.delete(key);
      }
    });

    return{
      feedbacks:[...feedbacks.values()].sort(sortDesc).slice(0,maxFeedbacks),
      summaries:[...summaries.values()].sort(sortDesc).slice(0,maxSummaries)
    };
  }

  function isUnavailableError(error){
    const message=clean(error?.message||error).toLowerCase();
    return message.includes('olli_feedback_delta')
      &&(
        message.includes('not find')
        ||message.includes('not found')
        ||message.includes('does not exist')
        ||message.includes('pgrst202')
        ||message.includes('schema cache')
      );
  }

  global.OlliFeedbackSync=Object.freeze({
    version:VERSION,
    normalizeCheckpoint,
    readCheckpoint,
    writeCheckpoint,
    clearCheckpoint,
    createBaseline,
    pull,
    applyToData,
    normalizeRecord,
    isUnavailableError
  });
})(window);
