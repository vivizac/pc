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
const NOW=Date.now();
const AGE=24*60*60*1000;
const item=(id,age,saved)=>({id,createdAt:new Date(NOW-age).toISOString(),resultText:'test feedback '+id,saved:!!saved});
function makeQueue(active=true){
 const store=new Map(),recorded=[];
 const localStorage={
   getItem:key=>store.has(key)?store.get(key):null,
   setItem:(key,value)=>{store.set(key,value);},
   removeItem:key=>store.delete(key)
 };
 const window={OLLI_MOBILE_FEEDBACK_24H_RETENTION:active};
 const start=common.indexOf('function getFeedbackJobQueueStorageKey()');
 const end=common.indexOf("try { localStorage.removeItem('olli_today_feedback_queue_v1');",start);
 assert.ok(start>=0&&end>start);
 const {expiry,cleanup}=new Function('window','localStorage','getOlliCurrentAcademyId',
   'recordOlliFeedbackStorageCheck','getOlliFeedbackStorageErrorReason',
   "const FEEDBACK_JOB_QUEUE_KEY='olli_feedback_jobs_v2';\n"+
   common.slice(start,end)+
   '\nreturn {expiry:isExpiredOlliPhoneLocalFeedback,cleanup:cleanupOlliPhoneFeedbackJobQueue};')(
    window,localStorage,()=> 'academy-one',(...args)=>recorded.push(args),()=> 'storage_exception');
 return {store,window,localStorage,expiry,cleanup,recorded,key:'olli_feedback_jobs_v2_academy-one'};
}
test('only phone Quick Note records older than 24 hours are discarded',()=>{
 const q=makeQueue();
 assert.equal(q.expiry(item('old',AGE+1000,false),NOW),true);
 assert.equal(q.expiry(item('exact',AGE,false),NOW),true);
 assert.equal(q.expiry(item('recent',AGE-1000,true),NOW),false);
 assert.equal(q.expiry({id:'unknown',resultText:'keep'},NOW),false);
 q.store.set(q.key,JSON.stringify([
   item('old-saved',AGE+1000,true),item('old-unsaved',AGE+1000,false),
   item('recent',AGE-1000,false),{id:'unknown',resultText:'no timestamp'}
 ]));
 assert.equal(q.cleanup().removed,2);
 const kept=JSON.parse(q.store.get(q.key));
 assert.deepEqual(kept.map(x=>x.id),['recent','unknown']);
});
test('cleanup never touches observation drafts or another academy storage',()=>{
 const q=makeQueue();
 q.store.set(q.key,JSON.stringify([item('expired',AGE+1000,true)]));
 q.store.set('olli_observation_draft_student123','important draft');
 q.store.set('olli_feedback_jobs_v2_academy-two',JSON.stringify([item('other',AGE+1000,true)]));
 q.cleanup();
 assert.equal(q.store.get('olli_observation_draft_student123'),'important draft');
 assert.match(q.store.get('olli_feedback_jobs_v2_academy-two'),/other/);
 assert.equal(q.store.has(q.key),false);
});
test('desktop does not apply mobile deletion policy',()=>{
 const q=makeQueue(false);
 q.store.set(q.key,JSON.stringify([item('old',AGE+1000,true)]));
 assert.equal(q.cleanup().removed,0);
 assert.equal(q.expiry(item('old',AGE+1000,true),NOW),false);
 assert.ok(q.store.has(q.key));
});
test('LIVE feed expires each feedback separately regardless of save status',()=>{
 const a=live.indexOf('const KCF_LIVE_SESSION_RETENTION_MS =');
 const b=live.indexOf('let kcfLiveSessionPersistTimer',a);
 assert.ok(a>=0&&b>a);
 const m=new Map([['old',item('old',AGE+1000,false)],['new',item('new',AGE-1000,true)]]);
 const f=new Function('kcfLiveFeedbackItems',live.slice(a,b)+
   '\nreturn {expiry:isExpiredKinderChatFeedbackLocalItem,prune:pruneExpiredKinderChatFeedbackLocalItems};')(m);
 assert.equal(f.expiry(item('old',AGE+1000,false),NOW),true);
 assert.equal(f.prune(),1);
 assert.equal(m.has('old'),false);
 assert.equal(m.has('new'),true);
});
test('automatic cleanup runs on reopen, foreground and while application is active',()=>{
 assert.match(live,/window\.addEventListener\('pageshow',cleanupKinderChatFeedbackPhoneLocalRetention\)/);
 assert.match(live,/document\.addEventListener\('visibilitychange'/);
 assert.match(live,/window\.setInterval\(cleanupKinderChatFeedbackPhoneLocalRetention,15 \* 60 \* 1000\)/);
 assert.match(live,/filter\(item => !isExpiredKinderChatFeedbackLocalItem\(item,now\)\)/);
 assert.match(common,/filter\(item => !isExpiredOlliPhoneLocalFeedback\(item\)\)/);
 assert.match(mobileHtml,/window\.OLLI_MOBILE_FEEDBACK_24H_RETENTION = true/);
 assert.doesNotMatch(pcHtml,/OLLI_MOBILE_FEEDBACK_24H_RETENTION/);
});
