'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../pc-timetable.js'),'utf8');
const slice=(start,end)=>{
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,'missing original timetable helper: '+start);
  return source.slice(a,b);
};
const helper=slice('  function existingMakeupForGroupChange(', '  function addPickerHtml(');
const get=(rows)=>new Function('oneTimeSessions','clean','classGroupOf',helper+';return existingMakeupForGroupChange;')(
  ()=>rows, x=>String(x??'').trim(), item=>String(item.class_group||'A').trim().toUpperCase());
const sample={id:'existing-a',student_id:'student-1',division:'kinder',session_type:'makeup',
  session_date:'2026-11-20',time_slot:4,class_group:'A'};
const dialog={kind:'add',addType:'makeup',studentId:'student-1',division:'kinder',
  date:'2026-11-20',time:4,targetClassGroup:'B'};
test('existing A makeup is a unique change to B, not a second registration',()=>{
  assert.equal(get([sample])(dialog)?.id,'existing-a');
  assert.equal(get([sample])({...dialog,targetClassGroup:'A'}),null);
  assert.equal(get([sample])({...dialog,studentId:''}),null);
  assert.equal(get([sample])({...dialog,studentId:'other'}),null);
  assert.equal(get([sample])({...dialog,addType:'regular'}),null);
});
test('ambiguous students or multiple matching sessions cannot be silently changed',()=>{
  assert.equal(get([sample,{...sample,id:'other-a'}])(dialog),null);
  assert.equal(get([{...sample,session_type:'trial'}])(dialog),null);
});
test('save paths use updateOneTimeSession for existing makeup and keep addMakeup for new makeup',()=>{
  const code=slice('  async function saveAdd()', '  async function ');
  assert.match(code,/const existing = existingMakeupForGroupChange\(dialog\)/);
  assert.match(code,/if \(existing\) \{[\s\S]*?service\.updateOneTimeSession\(existing\.id/);
  assert.match(code,/else \{[\s\S]*?service\.addMakeup\(dialog\.studentId/);
  assert.match(source,/existingMakeupForGroupChange\(dialog\) \? '반 변경' : '등록'/);
});
