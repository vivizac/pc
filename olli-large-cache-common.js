(function initializeOlliLargeCache(global){
  'use strict';

  if(global.OlliLargeCache?.version)return;

  const VERSION='1.0.0-step8';
  const DB_NAME='olli_large_cache_v1';
  const DB_VERSION=1;
  const STORE='snapshots';
  let openPromise=null;

  const clean=value=>String(value==null?'':value).trim();
  const safe=value=>clean(value).replace(/[^a-zA-Z0-9가-힣._:-]/g,'_');

  function available(){
    return !!global.indexedDB;
  }

  function key(input={}){
    const domain=safe(input.domain);
    const account=safe(input.accountId||input.account_id||'account');
    const academy=safe(input.academyId||input.academy_id);
    const scope=safe(input.scopeId||input.scope_id||'root');
    return domain&&academy ? [domain,account,academy,scope].join(':') : '';
  }

  function openDb(){
    if(!available())return Promise.resolve(null);
    if(openPromise)return openPromise;
    openPromise=new Promise((resolve,reject)=>{
      let request;
      try{request=global.indexedDB.open(DB_NAME,DB_VERSION)}
      catch(error){reject(error);return}
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains(STORE)){
          const store=db.createObjectStore(STORE,{keyPath:'key'});
          store.createIndex('domain_scope','domain_scope',{unique:false});
          store.createIndex('saved_at','saved_at',{unique:false});
        }
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error('IndexedDB open failed'));
      request.onblocked=()=>reject(new Error('IndexedDB open blocked'));
    }).catch(error=>{
      openPromise=null;
      throw error;
    });
    return openPromise;
  }

  function requestResult(request){
    return new Promise((resolve,reject)=>{
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error('IndexedDB request failed'));
    });
  }

  async function get(input={}){
    const cacheKey=key(input);
    if(!cacheKey||!available())return null;
    const db=await openDb();
    if(!db)return null;
    const tx=db.transaction(STORE,'readonly');
    const row=await requestResult(tx.objectStore(STORE).get(cacheKey));
    return row?.payload??null;
  }

  async function put(input={},payload){
    const cacheKey=key(input);
    if(!cacheKey)return false;
    if(!available())return false;
    const db=await openDb();
    if(!db)return false;
    const domain=safe(input.domain);
    const account=safe(input.accountId||input.account_id||'account');
    const academy=safe(input.academyId||input.academy_id);
    const scope=safe(input.scopeId||input.scope_id||'root');
    const savedAt=Date.now();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      tx.objectStore(STORE).put({
        key:cacheKey,
        domain,
        account_id:account,
        academy_id:academy,
        scope_id:scope,
        domain_scope:[domain,account,academy].join(':'),
        saved_at:savedAt,
        payload
      });
      tx.oncomplete=()=>resolve(true);
      tx.onerror=()=>reject(tx.error||new Error('IndexedDB put failed'));
      tx.onabort=()=>reject(tx.error||new Error('IndexedDB put aborted'));
    });
  }

  async function remove(input={}){
    const cacheKey=key(input);
    if(!cacheKey||!available())return false;
    const db=await openDb();
    if(!db)return false;
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      tx.objectStore(STORE).delete(cacheKey);
      tx.oncomplete=()=>resolve(true);
      tx.onerror=()=>reject(tx.error||new Error('IndexedDB delete failed'));
      tx.onabort=()=>reject(tx.error||new Error('IndexedDB delete aborted'));
    });
  }

  async function pruneDomain(input={},maxEntries=250){
    if(!available())return 0;
    const domain=safe(input.domain);
    const account=safe(input.accountId||input.account_id||'account');
    const academy=safe(input.academyId||input.academy_id);
    if(!domain||!academy)return 0;
    const keep=Math.max(1,Math.floor(Number(maxEntries)||250));
    const db=await openDb();
    if(!db)return 0;
    const scope=[domain,account,academy].join(':');
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      const store=tx.objectStore(STORE);
      const index=store.index('domain_scope');
      const request=index.getAll(scope);
      let removed=0;
      request.onsuccess=()=>{
        const rows=Array.isArray(request.result)?request.result:[];
        rows.sort((a,b)=>Number(b.saved_at||0)-Number(a.saved_at||0));
        rows.slice(keep).forEach(row=>{store.delete(row.key);removed+=1});
      };
      request.onerror=()=>reject(request.error||new Error('IndexedDB prune read failed'));
      tx.oncomplete=()=>resolve(removed);
      tx.onerror=()=>reject(tx.error||new Error('IndexedDB prune failed'));
      tx.onabort=()=>reject(tx.error||new Error('IndexedDB prune aborted'));
    });
  }

  global.OlliLargeCache=Object.freeze({
    version:VERSION,
    available,
    key,
    get,
    put,
    remove,
    pruneDomain
  });
})(window);
