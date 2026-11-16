'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

async function renderGuardian(division,slots){
  const source=fs.readFileSync(path.join(__dirname,'..','olli-makeup-guardian.js'),'utf8');
  const handlers={};
  const root={innerHTML:'',addEventListener:(name,fn)=>{handlers[name]=fn;}};
  const calls=[];
  class MockDate extends Date{
    constructor(...args){super(...(args.length?args:['2026-11-14T02:00:00Z']));}
    static now(){return Date.parse('2026-11-14T02:00:00Z');}
  }
  class MockFormData{constructor(form){this.form=form;}get(name){return this.form.fields[name];}}
  const responses={
    info:{ok:true,academy_name:'테스트학원'},
    identify:{ok:true,student_name:'테스트학생',division,session_token:'A'.repeat(43)},
    snapshot:{ok:true,student_name:'테스트학생',division,regular:[],absences:[],makeups:[]},
    week:{ok:true,week_start:'2026-11-16',slots}
  };
  const win={
    document:{getElementById:()=>root},
    location:{search:'?academy=0123456789abcdef0123456789abcdef0123'},
    crypto:{randomUUID:()=> '123e4567-e89b-42d3-a456-426614174000'},
    fetch:async(_,opts)=>{
      const body=JSON.parse(opts.body);
      calls.push(body);
      return {ok:true,status:200,json:async()=>responses[body.action]};
    }
  };
  vm.runInNewContext(source,{window:win,URLSearchParams,Date:MockDate,Intl,FormData:MockFormData});
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  const settle=async()=>{for(let i=0;i<7;i++)await tick();};
  function click(action,fields={}){
    handlers.click({target:{closest:()=>({dataset:{action,...fields}})}});
  }
  await settle();
  click('begin-apply');
  await handlers.submit({preventDefault(){},target:{id:'ombIdentifyForm',
    fields:{student_name:'테스트학생',guardian_phone:'01012345678'}}});
  click('select-student');
  await settle();
  click('week-next');
  await settle();
  click('select-week-day',{date:'2026-11-16'});
  return {root,calls,click,settle};
}

test('kinder: split class uses two equal-width group buttons and unsplit class full width',async()=>{
  const slots=[
    {date:'2026-11-16',time_slot:4,group:'A',label:'4:00',status:'available'},
    {date:'2026-11-16',time_slot:4,group:'B',label:'4:00',status:'available'},
    {date:'2026-11-16',time_slot:5,group:'A',label:'5:00',status:'prebooked'},
    {date:'2026-11-16',time_slot:2,group:'A',label:'2:00',status:'available'}
  ];
  const {root,click}=await renderGuardian('kinder',slots);
  const html=root.innerHTML;
  assert.match(html,/ombMobileWeek isKinder/);
  assert.match(html,/4시 타임/);
  assert.match(html,/5시 타임/);
  assert.match(html,/ombMobileTimeGrid isSplit[\s\S]*?4:00 A반[\s\S]*?4:00 B반/);
  assert.match(html,/ombMobileTimeGrid isSingle[\s\S]*?5:00/);
  assert.match(html,/ombMobileTimeGrid isSingle[\s\S]*?2:00/);
  assert.doesNotMatch(html,/5:00 A반/,'single class must not show group label');
  assert.doesNotMatch(html,/2:00 A반/,'single class must not show group label');
  click('toggle-week-makeup',{item:'2026-11-16|5|A'});
  assert.match(root.innerHTML,/보강 수업 0건/,'prebooked group is not selectable');
  click('toggle-week-makeup',{item:'2026-11-16|4|A'});
  assert.match(root.innerHTML,/보강 수업 1건/,'available group is selectable');
  click('toggle-week-makeup',{item:'2026-11-16|4|B'});
  assert.match(root.innerHTML,/보강 수업 1건/,'group switch does not double-book same time');
  assert.match(root.innerHTML,/4:00 B반/);
});

test('elementary: selected date and group buttons without kinder time headers',async()=>{
  const slots=[
    {date:'2026-11-16',time_slot:2,group:'A',label:'2:00',status:'available'},
    {date:'2026-11-16',time_slot:4,group:'A',label:'4:00',status:'available'},
    {date:'2026-11-16',time_slot:4,group:'B',label:'4:00',status:'unavailable'}
  ];
  const {root,click}=await renderGuardian('elementary',slots);
  const html=root.innerHTML;
  assert.match(html,/ombMobileWeek isElementary/);
  assert.match(html,/11월 16일/,'chosen date remains visible');
  assert.doesNotMatch(html,/4시 타임/);
  assert.doesNotMatch(html,/5시 타임/);
  assert.match(html,/ombMobileTimeGrid isSingle[\s\S]*?2:00/);
  assert.match(html,/ombMobileTimeGrid isSplit[\s\S]*?4:00 A반[\s\S]*?4:00 B반/);
  assert.doesNotMatch(html,/2:00 A반/);
  click('toggle-week-makeup',{item:'2026-11-16|4|B'});
  assert.match(root.innerHTML,/보강 수업 0건/,'full class is blocked');
  click('toggle-week-makeup',{item:'2026-11-16|2|A'});
  assert.match(root.innerHTML,/보강 수업 1건/);
});

test('mobile reference colors, layout and arrow-only buttons are scoped to phone',()=>{
  const css=fs.readFileSync(path.join(__dirname,'..','olli-makeup-guardian.css'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'..','makeup-booking.html'),'utf8');
  assert.match(css,/@media\(max-width:600px\)/);
  assert.match(css,/\.ombMobileDay\.isCurrent\{background:#0c6170;color:#fff/);
  assert.match(css,/\.ombMobileTimeGrid\.isSplit\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/\.ombWeekNav button\{[^}]*background:transparent;border:0/);
  assert.match(css,/\.ombDesktopWeek,.ombDesktopActions\{display:none!important\}/);
  assert.match(html,/olli-makeup-guardian\.css\?v=20261116-slot-grid-1/);
  assert.match(html,/olli-makeup-guardian\.js\?v=20261116-slot-grid-1/);
});
