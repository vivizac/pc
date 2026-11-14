'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('guardian weekly timetable, prior reservation, multiple selections and collapsed absence calendar',async()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','olli-makeup-guardian.js'),'utf8');
  const handlers={};
  const calls=[];
  const root={
    innerHTML:'',
    addEventListener(name,fn){handlers[name]=fn;}
  };
  const student={student_name:'김민서',division:'elementary',session_token:'A'.repeat(43)};
  const snapshot={ok:true,student_name:'김민서',division:'elementary',
    regular:[{date:'2026-11-18',time_slot:4,group:'A',label:'4시'}],
    absences:[],makeups:[]};
  const api={
    info:()=>({ok:true,academy_name:'비비작아이성향미술학원'}),
    identify:()=>({ok:true,...student}),
    snapshot:()=>snapshot,
    week:body=>({ok:true,week_start:body.week_start,slots:body.week_start==='2026-11-16'?[
      {date:'2026-11-16',time_slot:4,group:'A',label:'4시',status:'available'},
      {date:'2026-11-16',time_slot:5,group:'A',label:'5시',status:'prebooked'},
      {date:'2026-11-18',time_slot:4,group:'A',label:'4시',status:'own'}
    ]:body.week_start==='2026-11-23'?[
      {date:'2026-11-23',time_slot:5,group:'A',label:'5시',status:'available'}
    ]:[]})
  };
  class FakeDate extends Date{
    constructor(...args){super(...(args.length?args:['2026-11-14T02:00:00Z']));}
    static now(){return Date.parse('2026-11-14T02:00:00Z');}
  }
  class FakeFormData{
    constructor(form){this.fields=form.fields;}
    get(name){return this.fields[name];}
  }
  const win={
    document:{getElementById:()=>root},
    location:{search:'?academy=0123456789abcdef0123456789abcdef0123'},
    fetch:async(_,options)=>{
      const body=JSON.parse(options.body);
      calls.push(body);
      const result=api[body.action](body);
      return {ok:true,status:200,json:async()=>result};
    },
    crypto:{randomUUID:()=> '123e4567-e89b-42d3-a456-426614174000'}
  };
  vm.runInNewContext(src,{window:win,URLSearchParams,Date:FakeDate,Intl,FormData:FakeFormData});
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  const settle=async()=>{for(let i=0;i<5;i++)await tick();};
  const click=(action,fields={})=>{
    handlers.click({target:{closest:()=>({dataset:{action,...fields}})}});
  };
  await settle();
  assert.match(root.innerHTML,/보강 신청하기/);
  click('begin-apply');
  assert.match(root.innerHTML,/학생 이름 검색/);
  await handlers.submit({preventDefault(){},target:{
    id:'ombIdentifyForm',
    fields:{student_name:'김민서',guardian_phone:'01012345678'}
  }});
  click('select-student');
  await settle();
  assert.match(root.innerHTML,/1\. 보강 수업일 선택/);
  assert.match(root.innerHTML,/2\. 결석 예정일 선택/);
  assert.ok(root.innerHTML.indexOf('1. 보강')<root.innerHTML.indexOf('2. 결석'));
  assert.doesNotMatch(root.innerHTML,/ogbCalendar/,'absence calendar stays collapsed');
  click('week-next');
  await settle();
  assert.match(root.innerHTML,/11\/16/);
  assert.match(root.innerHTML,/선예약 중/);
  assert.match(root.innerHTML,/ombMobileDayPicker/,'mobile six-day strip is rendered');
  assert.match(root.innerHTML,/ombMobileClassList/,'selected day uses stacked class cards');
  assert.match(root.innerHTML,/ombMobileSticky/,'mobile selection review remains accessible');
  assert.match(root.innerHTML,/ombDesktopWeek/,'desktop weekly table remains');
  click('select-week-day',{date:'2026-11-16'});
  assert.match(root.innerHTML,/ombMobileClass isprebooked/,'prebooked lesson is visible in mobile cards');
  click('select-week-day',{date:'2026-11-17'});
  assert.match(root.innerHTML,/이 날짜에는 신청 가능한 수업이 없습니다/);
  click('select-week-day',{date:'2026-11-16'});

  assert.match(root.innerHTML,/보강 불가/);
  click('toggle-week-makeup',{item:'2026-11-16|5|A'});
  assert.match(root.innerHTML,/보강 수업 0건/,'prebooked time cannot be selected');
  click('toggle-week-makeup',{item:'2026-11-16|4|A'});
  assert.match(root.innerHTML,/보강 수업 1건/);
  click('week-next');
  await settle();
  assert.match(root.innerHTML,/11\/23/);
  assert.match(root.innerHTML,/보강 수업 1건/,'selection persists across week navigation');
  assert.match(root.innerHTML,/ombMobileDayPicker/);
  click('select-week-day',{date:'2026-11-23'});
  assert.match(root.innerHTML,/11월 23일/);

  click('toggle-week-makeup',{item:'2026-11-23|5|A'});
  assert.match(root.innerHTML,/보강 수업 2건/);
  click('toggle-absence-calendar');
  assert.match(root.innerHTML,/결석 예정일 달력/);
  click('abs-date',{date:'2026-11-18'});
  assert.match(root.innerHTML,/정규 수업/);
  click('toggle-absence',{item:'2026-11-18|4|A'});
  assert.match(root.innerHTML,/결석 예정 1건/);
  click('toggle-absence-calendar');
  assert.doesNotMatch(root.innerHTML,/결석 예정일 달력/);
  assert.match(root.innerHTML,/결석 예정 1건/);
  assert.ok(calls.filter(c=>c.action==='week').length>=3);
});
