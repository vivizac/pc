'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');

function loadSchedule(students){
  const source=fs.readFileSync(
    path.resolve(__dirname,'../packages/common/olli-command-schedule-common.js'),
    'utf8'
  );
  const context={
    console,
    Date,
    Math,
    Map,
    Set,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    JSON,
    Promise,
    getAllStudents:()=>students,
    getStudentStatus:()=> 'active'
  };
  context.window=context;
  vm.runInNewContext(source,context,{filename:'olli-command-schedule-common.js'});
  return context.OlliCommandSchedule;
}

test('student search normalization supports the three academy display-name patterns',()=>{
  const schedule=loadSchedule([]);
  assert.equal(schedule.normalizeStudentSearchName('토)김채원'),'김채원');
  assert.equal(schedule.normalizeStudentSearchName('이한율(6)'),'이한율');
  assert.equal(schedule.normalizeStudentSearchName('이한율(2)'),'이한율');
  assert.equal(schedule.normalizeStudentSearchName('방채은*'),'방채은');
  assert.equal(schedule.normalizeStudentSearchName('김채원'),'김채원');
});

test('unique decorated student resolves to the stored canonical name and division',()=>{
  const schedule=loadSchedule([
    {id:'1',name:'토)김채원',division:'elementary'},
    {id:'2',name:'방채은*',division:'kinder'}
  ]);
  const result=schedule.resolveStructuredStudentReference({
    action:'add_makeup',
    studentName:'김채원'
  });
  assert.equal(result.ok,true);
  assert.equal(result.matched,true);
  assert.equal(result.studentName,'토)김채원');
  assert.equal(result.division,'elementary');
});

test('bare duplicate name returns the decorated stored names as choices',()=>{
  const schedule=loadSchedule([
    {id:'1',name:'이한율(6)',division:'elementary'},
    {id:'2',name:'이한율(2)',division:'elementary'}
  ]);
  const result=schedule.resolveStructuredStudentReference({
    action:'add_makeup',
    studentName:'이한율'
  });
  assert.equal(result.ok,false);
  assert.equal(result.code,'student_choice_required');
  assert.deepEqual(
    Array.from(result.choices,item=>item.studentName),
    ['이한율(6)','이한율(2)']
  );
});

test('an explicitly decorated stored name remains an exact single match',()=>{
  const schedule=loadSchedule([
    {id:'1',name:'이한율(6)',division:'elementary'},
    {id:'2',name:'이한율(2)',division:'elementary'}
  ]);
  const result=schedule.resolveStructuredStudentReference({
    action:'add_makeup',
    studentName:'이한율(6)'
  });
  assert.equal(result.ok,true);
  assert.equal(result.studentName,'이한율(6)');
});
