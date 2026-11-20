'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const common=read('packages/common/olli-feedback-runtime.js');
const live=read('apps/mobile/kinder-feedback.js');
const mobileHtml=read('apps/mobile/index.html');
const pcHtml=read('apps/pc/index.html');
const AGE=24*60*60*1000;
const CUTOFF=Date.parse('2026-11-20T04:43:00Z');
const NOW=CUTOFF+3*AGE;
const Clock={now:()=>NOW,parse:Date.parse};
const item=(id,created,saved=false,verified=false)=>({
  id,createdAt:new Date(created).toISOString(),resultText:'feedback text '+id,
  saved,savedRowId:verified?'1695':'',studentId:'test-student'
});
const legacy=item('legacy',CUTOFF-AGE-1000,false);
const newPending=item('new-pending',CUTOFF+1000,false);
const newVerified=item('new-verified',CUTOFF+1000,true,true);
const newFalseSuccess=item('unverified',CUTOFF+1000,true,false);
function makeQueue(active=true) {
 const store=new Map(),recorded=[];
 const localStorage={
  getItem:key=>store.has(key)?store.get(key):null,
  setItem:(key,val)=>store.set(key,val),removeItem:key=>store.delete(key)
 };
 const window={OLLI_MOBILE_FEEDBACK_24H_RETENTION:active};
 const start=common.indexOf('function getFeedbackJobQueueStorageKey()');
 const end=common.indexOf("try { localStorage.removeItem('olli_today_feedback_queue_v1');",start);
 assert.ok(start>=0&&end>start);
 const code="const FEEDBACK_JOB_QUEUE_KEY='olli_feedback_jobs_v2';\n"+common.slice(start,end)+
   '\nreturn {expiry:isExpiredOlliPhoneLocalFeedback,protected:isOlliPhoneFeedbackProtected,cleanup:cleanupOlliPhoneFeedbackJobQueue,limit:limitOlliPhoneFeedbackJobs};';
 const methods=new Function('window','localStorage','getOlliCurrentAcademyId',
  'recordOlliFeedbackStorageCheck','getOlliFeedbackStorageErrorReason','Date',code)(
  window,localStorage,()=> 'academy-one',(...args)=>recorded.push(args),
  ()=> 'storage_exception',Clock);
 return {store,window,localStorage,recorded,key:'olli_feedback_jobs_v2_academy-one',...methods};
}
test('legacy pre-policy records older than 24 hours can be removed',()=>{
 const q=makeQueue();
 assert.equal(q.expiry(legacy,NOW),true);
 assert.equal(q.expiry(newPending,NOW),false);
 assert.equal(q.expiry(newVerified,NOW),true);
 assert.equal(q.expiry(newFalseSuccess,NOW),false);
 assert.equal(q.expiry({id:'missing-date',saved:true},NOW),false);
 q.store.set(q.key,JSON.stringify([legacy,newPending,newVerified,newFalseSuccess]));
 assert.equal(q.cleanup().removed,2);
 assert.deepEqual(JSON.parse(q.store.get(q.key)).map(x=>x.id),['new-pending','unverified']);
});
test('new unsaved jobs are never evicted by max 300 cache limit',()=>{
 const q=makeQueue();
 const many=Array.from({length:330},(_,i)=>item('saved-'+i,CUTOFF+2000,true,true));
 const pending=item('protected',CUTOFF+3000,false);
 const result=q.limit([...many,pending],300);
 assert.equal(result.length,301);
 assert.ok(result.some(x=>x.id==='protected'));
});
test('cleanup does not affect observation notes, other academies, or PC',()=>{
 const q=makeQueue();
 q.store.set(q.key,JSON.stringify([legacy]));
 q.store.set('olli_observation_draft_student','keep');
 q.store.set('olli_feedback_jobs_v2_another',JSON.stringify([legacy]));
 q.cleanup();
 assert.equal(q.store.has(q.key),false);
 assert.equal(q.store.get('olli_observation_draft_student'),'keep');
 assert.match(q.store.get('olli_feedback_jobs_v2_another'),/legacy/);
 const desktop=makeQueue(false);
 desktop.store.set(desktop.key,JSON.stringify([legacy]));
 assert.equal(desktop.cleanup().removed,0);
 assert.equal(desktop.expiry(legacy,NOW),false);
});
test('LIVE session retention protects new unsaved jobs even past 24 hours',()=>{
 const a=live.indexOf('const KCF_LIVE_SESSION_RETENTION_MS =');
 const b=live.indexOf('let kcfLiveSessionPersistTimer',a);
 assert.ok(a>=0&&b>a);
 const m=new Map([['legacy',legacy],['pending',newPending],['saved',newVerified]]);
 const win={isOlliPhoneFeedbackProtected:makeQueue().protected};
 const fn=new Function('window','kcfLiveFeedbackItems','Date',live.slice(a,b)+
  '\nreturn {expiry:isExpiredKinderChatFeedbackLocalItem,prune:pruneExpiredKinderChatFeedbackLocalItems,retain:retainKinderChatFeedbackLiveLocalItems};');
 const f=fn(win,m,Clock);
 assert.equal(f.expiry(newPending,NOW),false);
 assert.equal(f.expiry(newVerified,NOW),true);
 assert.equal(f.prune(),2);
 assert.equal(m.has('pending'),true);
 assert.equal(m.has('legacy'),false);
 const many=Array.from({length:60},(_,i)=>item('saved-'+i,CUTOFF+1000,true,true));
 assert.equal(f.retain([...many,newPending],50).length,51);
});
test('foreground and online retries use stable 5-minute backoff',async()=>{
 const start=live.indexOf('const kcfLiveSaveInFlight = new Map();');
 const end=live.indexOf('function saveKinderChatFeedbackLive(',start);
 assert.ok(start>=0&&end>start);
 const items=new Map([['new-pending',{...newPending,status:'done',suspiciousSegments:[]}]]);
 let runs=0;
 const fakeDate={now:()=>NOW,parse:Date.parse};
 const win={isOlliPhoneFeedbackProtected:makeQueue().protected,autoSaveGeneratedFeedback:()=>{}};
 const f=new Function('window','navigator','kcfLiveFeedbackItems','saveKinderChatFeedbackLive','Date','console',
   live.slice(start,end)+'\nreturn retryPendingNewQuickNoteSaves;')(
   win,{onLine:true},items,async()=>{runs++;return false;},fakeDate,console);
 f();f();await Promise.resolve();
 assert.equal(runs,1);
 assert.match(live,/window\.addEventListener\('online', \(\) =>/);
 assert.match(live,/retryPendingNewQuickNoteSaves\(\)/);
 assert.match(live,/KCF_QUICKNOTE_RETRY_INTERVAL_MS = 5 \* 60 \* 1000/);
});
test('mobile-only enablement and cache scripts remain correct',()=>{
 assert.match(mobileHtml,/window\.OLLI_MOBILE_FEEDBACK_24H_RETENTION = true/);
 assert.doesNotMatch(pcHtml,/OLLI_MOBILE_FEEDBACK_24H_RETENTION/);
 assert.match(live,/filter\(item => !isExpiredKinderChatFeedbackLocalItem\(item,now\)\)/);
 assert.match(common,/filter\(item => !isExpiredOlliPhoneLocalFeedback\(item\)\)/);
 assert.match(live,/window\.setInterval\(cleanupKinderChatFeedbackPhoneLocalRetention,5 \* 60 \* 1000\)/);
});
