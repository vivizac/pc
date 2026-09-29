/* Work / Work Hub phone media cache
 * Phone-only persistent cache for Team Chat attachment thumbnails and link previews.
 * Keeps cache-only blobs/metadata scoped by account + academy.
 */
(function(global){
  'use strict';

  const DB_NAME='olli_phone_attachment_cache_v1';
  const DB_VERSION=3;
  const STORE_NAME='images';
  const LINK_STORE_NAME='link_previews';
  const DEFAULT_SCOPE_BYTES=80*1024*1024;
  const MIN_SCOPE_BYTES=40*1024*1024;
  const MAX_SCOPE_BYTES=96*1024*1024;
  const MAX_SCOPE_ITEMS=1000;
  const MAX_LINK_SCOPE_BYTES=24*1024*1024;
  const MAX_LINK_SCOPE_ITEMS=300;
  const MAX_LINK_IMAGE_BYTES=1536*1024;

  let dbPromise=null;
  let byteLimitPromise=null;

  function clean(value){return String(value==null?'':value).trim();}
  function available(){return !!global.indexedDB;}
  function normalizeVariant(value){return clean(value)==='original'?'original':'thumbnail';}

  function makeScope(input){
    const accountId=clean(input?.accountId);
    const academyId=clean(input?.academyId);
    if(!accountId||!academyId)return '';
    return accountId+'::'+academyId;
  }

  function makeKey(input){
    const scope=makeScope(input);
    const attachmentId=clean(input?.attachmentId);
    if(!scope||!attachmentId)return '';
    return scope+'::'+attachmentId+'::'+normalizeVariant(input?.variant);
  }

  function makeLinkPreviewKey(input){
    const scope=makeScope(input);
    const url=clean(input?.url).slice(0,2048);
    if(!scope||!url)return '';
    return scope+'::link::'+url;
  }

  function openDb(){
    if(!available())return Promise.resolve(null);
    if(dbPromise)return dbPromise;

    dbPromise=new Promise((resolve,reject)=>{
      let request;
      try{request=global.indexedDB.open(DB_NAME,DB_VERSION)}
      catch(error){reject(error);return}

      request.onupgradeneeded=event=>{
        const db=request.result;
        let store;
        if(!db.objectStoreNames.contains(STORE_NAME)){
          store=db.createObjectStore(STORE_NAME,{keyPath:'key'});
        }else{
          store=request.transaction.objectStore(STORE_NAME);
        }

        // v1 stored full-size original blobs. They are cache-only data, so clear them
        // once when moving to the thumbnail-first v2 format.
        if(Number(event?.oldVersion||0)<2){
          try{store.clear()}catch(_){}
        }

        if(!store.indexNames.contains('scope'))store.createIndex('scope','scope',{unique:false});
        if(!store.indexNames.contains('last_accessed_at'))store.createIndex('last_accessed_at','last_accessed_at',{unique:false});

        let linkStore;
        if(!db.objectStoreNames.contains(LINK_STORE_NAME)){
          linkStore=db.createObjectStore(LINK_STORE_NAME,{keyPath:'key'});
        }else{
          linkStore=request.transaction.objectStore(LINK_STORE_NAME);
        }
        if(!linkStore.indexNames.contains('scope'))linkStore.createIndex('scope','scope',{unique:false});
        if(!linkStore.indexNames.contains('last_accessed_at'))linkStore.createIndex('last_accessed_at','last_accessed_at',{unique:false});
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error('IndexedDB open failed'));
      request.onblocked=()=>console.warn('Work 이미지 로컬 캐시 DB가 다른 탭에 의해 잠겨 있습니다.');
    }).catch(error=>{
      console.warn('Work 이미지 로컬 캐시를 열지 못했습니다.',error);
      dbPromise=null;
      return null;
    });

    return dbPromise;
  }

  function requestPromise(request){
    return new Promise((resolve,reject)=>{
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error('IndexedDB request failed'));
    });
  }

  async function getScopeByteLimit(){
    if(byteLimitPromise)return byteLimitPromise;
    byteLimitPromise=(async()=>{
      try{
        const estimate=await global.navigator?.storage?.estimate?.();
        const quota=Math.max(0,Number(estimate?.quota||0));
        if(quota>0){
          const adaptive=Math.round(quota*0.05);
          return Math.min(MAX_SCOPE_BYTES,Math.max(MIN_SCOPE_BYTES,adaptive));
        }
      }catch(_){}
      return DEFAULT_SCOPE_BYTES;
    })();
    return byteLimitPromise;
  }

  async function touchRecord(db,key){
    if(!db||!key)return;
    try{
      await new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE_NAME,'readwrite');
        const store=tx.objectStore(STORE_NAME);
        const request=store.get(key);
        request.onsuccess=()=>{
          const row=request.result;
          if(row){
            row.last_accessed_at=Date.now();
            store.put(row);
          }
        };
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error||new Error('IndexedDB touch failed'));
        tx.onabort=()=>reject(tx.error||new Error('IndexedDB touch aborted'));
      });
    }catch(_){}
  }

  async function getBlob(input){
    const key=makeKey(input);
    if(!key)return null;
    const db=await openDb();
    if(!db)return null;

    try{
      const tx=db.transaction(STORE_NAME,'readonly');
      const record=await requestPromise(tx.objectStore(STORE_NAME).get(key));
      const blob=record?.blob;
      if(!(blob instanceof Blob)||blob.size<1)return null;
      touchRecord(db,key).catch(()=>{});
      return blob;
    }catch(error){
      console.warn('Work 이미지 로컬 캐시 읽기 실패:',error);
      return null;
    }
  }

  async function deleteKeys(db,keys){
    if(!keys.length)return;
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE_NAME,'readwrite');
      const store=tx.objectStore(STORE_NAME);
      keys.forEach(key=>store.delete(key));
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error||new Error('IndexedDB prune failed'));
      tx.onabort=()=>reject(tx.error||new Error('IndexedDB prune aborted'));
    });
  }

  async function pruneScope(db,scope){
    if(!scope)return;
    try{
      const tx=db.transaction(STORE_NAME,'readonly');
      const index=tx.objectStore(STORE_NAME).index('scope');
      const rows=await requestPromise(index.getAll(scope));
      if(!Array.isArray(rows)||!rows.length)return;

      rows.sort((a,b)=>Number(b?.last_accessed_at||b?.saved_at||0)-Number(a?.last_accessed_at||a?.saved_at||0));
      const maxBytes=await getScopeByteLimit();
      let total=0;
      const remove=[];
      rows.forEach((row,indexNo)=>{
        const bytes=Math.max(0,Number(row?.bytes||row?.blob?.size||0));
        total+=bytes;
        if(indexNo>=MAX_SCOPE_ITEMS||total>maxBytes)remove.push(row.key);
      });
      if(remove.length)await deleteKeys(db,remove);
    }catch(error){
      console.warn('Work 이미지 로컬 캐시 정리 실패:',error);
    }
  }

  async function putBlob(input,blob,meta={}){
    const key=makeKey(input);
    const scope=makeScope(input);
    if(!key||!scope||!(blob instanceof Blob)||blob.size<1)return false;

    const db=await openDb();
    if(!db)return false;

    try{
      const now=Date.now();
      const record={
        key,
        scope,
        variant:normalizeVariant(input?.variant),
        account_id:clean(input?.accountId),
        academy_id:clean(input?.academyId),
        attachment_id:clean(input?.attachmentId),
        mime_type:clean(meta?.mimeType||blob.type),
        file_name:clean(meta?.fileName),
        bytes:blob.size,
        saved_at:now,
        last_accessed_at:now,
        blob
      };
      await new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE_NAME,'readwrite');
        tx.objectStore(STORE_NAME).put(record);
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error||new Error('IndexedDB put failed'));
        tx.onabort=()=>reject(tx.error||new Error('IndexedDB put aborted'));
      });
      pruneScope(db,scope).catch(()=>{});
      return true;
    }catch(error){
      console.warn('Work 이미지 로컬 캐시 저장 실패:',error);
      return false;
    }
  }

  async function touchLinkPreviewRecord(db,key){
    if(!db||!key)return;
    try{
      await new Promise((resolve,reject)=>{
        const tx=db.transaction(LINK_STORE_NAME,'readwrite');
        const store=tx.objectStore(LINK_STORE_NAME);
        const request=store.get(key);
        request.onsuccess=()=>{
          const row=request.result;
          if(row){
            row.last_accessed_at=Date.now();
            store.put(row);
          }
        };
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error||new Error('IndexedDB link preview touch failed'));
        tx.onabort=()=>reject(tx.error||new Error('IndexedDB link preview touch aborted'));
      });
    }catch(_){}
  }

  async function pruneLinkPreviewScope(db,scope){
    if(!scope)return;
    try{
      const tx=db.transaction(LINK_STORE_NAME,'readonly');
      const index=tx.objectStore(LINK_STORE_NAME).index('scope');
      const rows=await requestPromise(index.getAll(scope));
      if(!Array.isArray(rows)||!rows.length)return;

      rows.sort((a,b)=>Number(b?.last_accessed_at||b?.saved_at||0)-Number(a?.last_accessed_at||a?.saved_at||0));
      let total=0;
      const remove=[];
      rows.forEach((row,indexNo)=>{
        const bytes=Math.max(0,Number(row?.bytes||row?.image_blob?.size||0));
        total+=bytes;
        if(indexNo>=MAX_LINK_SCOPE_ITEMS||total>MAX_LINK_SCOPE_BYTES)remove.push(row.key);
      });
      if(!remove.length)return;

      await new Promise((resolve,reject)=>{
        const writeTx=db.transaction(LINK_STORE_NAME,'readwrite');
        const store=writeTx.objectStore(LINK_STORE_NAME);
        remove.forEach(key=>store.delete(key));
        writeTx.oncomplete=()=>resolve();
        writeTx.onerror=()=>reject(writeTx.error||new Error('IndexedDB link preview prune failed'));
        writeTx.onabort=()=>reject(writeTx.error||new Error('IndexedDB link preview prune aborted'));
      });
    }catch(error){
      console.warn('Team Chat 링크 프리뷰 로컬 캐시 정리 실패:',error);
    }
  }

  async function getLinkPreview(input){
    const key=makeLinkPreviewKey(input);
    if(!key)return null;
    const db=await openDb();
    if(!db)return null;

    try{
      const tx=db.transaction(LINK_STORE_NAME,'readonly');
      const row=await requestPromise(tx.objectStore(LINK_STORE_NAME).get(key));
      if(!row)return null;
      touchLinkPreviewRecord(db,key).catch(()=>{});
      return {
        url:clean(row.url),
        domain:clean(row.domain),
        title:clean(row.title),
        description:clean(row.description),
        image:clean(row.image_url),
        site_name:clean(row.site_name),
        image_blob:row.image_blob instanceof Blob?row.image_blob:null,
        saved_at:Number(row.saved_at||0),
        last_accessed_at:Number(row.last_accessed_at||0)
      };
    }catch(error){
      console.warn('Team Chat 링크 프리뷰 로컬 캐시 읽기 실패:',error);
      return null;
    }
  }

  async function putLinkPreview(input,preview,imageBlob=null){
    const key=makeLinkPreviewKey(input);
    const scope=makeScope(input);
    const url=clean(input?.url).slice(0,2048);
    if(!key||!scope||!url||!preview)return false;

    const db=await openDb();
    if(!db)return false;

    try{
      const readTx=db.transaction(LINK_STORE_NAME,'readonly');
      const previous=await requestPromise(readTx.objectStore(LINK_STORE_NAME).get(key));
      const imageUrl=clean(preview?.image).slice(0,4096);
      const usableBlob=imageBlob instanceof Blob&&imageBlob.size>0&&imageBlob.size<=MAX_LINK_IMAGE_BYTES?imageBlob:null;
      const preservePreviousBlob=!usableBlob&&previous?.image_blob instanceof Blob&&clean(previous?.image_url)===imageUrl;
      const storedBlob=usableBlob||(preservePreviousBlob?previous.image_blob:null);
      const now=Date.now();
      const metadataBytes=
        clean(preview?.title).length+
        clean(preview?.description).length+
        clean(preview?.domain).length+
        clean(preview?.site_name).length+
        imageUrl.length+
        url.length;

      const record={
        key,
        scope,
        account_id:clean(input?.accountId),
        academy_id:clean(input?.academyId),
        url,
        domain:clean(preview?.domain).slice(0,255),
        title:clean(preview?.title).slice(0,180),
        description:clean(preview?.description).slice(0,260),
        image_url:imageUrl,
        site_name:clean(preview?.site_name).slice(0,100),
        image_blob:storedBlob,
        bytes:metadataBytes+Math.max(0,Number(storedBlob?.size||0)),
        saved_at:now,
        last_accessed_at:now
      };

      await new Promise((resolve,reject)=>{
        const tx=db.transaction(LINK_STORE_NAME,'readwrite');
        tx.objectStore(LINK_STORE_NAME).put(record);
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error||new Error('IndexedDB link preview put failed'));
        tx.onabort=()=>reject(tx.error||new Error('IndexedDB link preview put aborted'));
      });
      pruneLinkPreviewScope(db,scope).catch(()=>{});
      return true;
    }catch(error){
      console.warn('Team Chat 링크 프리뷰 로컬 캐시 저장 실패:',error);
      return false;
    }
  }

  async function removeAttachment(input){
    const db=await openDb();
    if(!db)return false;
    const keys=['thumbnail','original'].map(variant=>makeKey({...input,variant})).filter(Boolean);
    if(!keys.length)return false;
    try{
      await deleteKeys(db,keys);
      return true;
    }catch(error){
      console.warn('Work 이미지 로컬 캐시 삭제 실패:',error);
      return false;
    }
  }

  global.OlliTalkAttachmentCachePhone=Object.freeze({
    version:'3.0.0',
    getBlob,
    putBlob,
    getLinkPreview,
    putLinkPreview,
    removeAttachment,
    available
  });
})(window);
