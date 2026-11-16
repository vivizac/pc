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


test('kinder: four bordered buttons per row in chronological order without time headings',async()=>{
  const slots=[
    {date:'2026-11-16',time_slot:4,group:'A',label:'4:00',status:'available'},
    {date:'2026-11-16',time_slot:4,group:'B',label:'4:00',status:'available'},
    {date:'2026-11-16',time_slot:5,group:'A',label:'5:00',status:'available'},
    {date:'2026-11-16',time_slot:5,group:'B',label:'5:00',status:'prebooked'}
  ];
  const {root,click}=await renderGuardian('kinder',slots);
  const html=root.innerHTML;
  assert.match(html,/ombMobileWeek isKinder/);
  assert.match(html,/ombMobileClassList isKinderGrid/);
  assert.doesNotMatch(html,/시 타임/);
  const a=html.indexOf('4:00 A반'),b=html.indexOf('4:00 B반');
  const c=html.indexOf('5:00 A반'),d=html.indexOf('5:00 B반');
  assert.ok(a>=0&&a<b&&b<c&&c<d);
  assert.doesNotMatch(html,/ombMobileTimeGroup/);
  assert.doesNotMatch(html,/ogbPanel ombPanel/);
  assert.doesNotMatch(html,/ogbTitleBand/);
  assert.doesNotMatch(html,/<h1[^>]*>보강 신청하기<\/h1>/);
  assert.match(html,/class="ombHeader"><strong>테스트학원<\/strong><\/div>/);
  click('toggle-week-makeup',{item:'2026-11-16|5|B'});
  assert.match(root.innerHTML,/보강 수업 0건/);
  click('toggle-week-makeup',{item:'2026-11-16|4|A'});
  assert.match(root.innerHTML,/보강 수업 1건/);
  click('toggle-week-makeup',{item:'2026-11-16|4|B'});
  assert.match(root.innerHTML,/보강 수업 1건/,'same time A/B cannot be double booked');
});

test('elementary: three across, split group pushes subsequent lessons to next cell',async()=>{
  const slots=[
    {date:'2026-11-16',time_slot:1,group:'A',status:'available'},
    {date:'2026-11-16',time_slot:2,group:'A',status:'available'},
    {date:'2026-11-16',time_slot:3,group:'A',status:'available'},
    {date:'2026-11-16',time_slot:3,group:'B',status:'unavailable'},
    {date:'2026-11-16',time_slot:4,group:'A',status:'available'},
    {date:'2026-11-16',time_slot:5,group:'A',status:'available'},
    {date:'2026-11-16',time_slot:6,group:'A',status:'available'}
  ];
  const {root,click}=await renderGuardian('elementary',slots);
  const html=root.innerHTML;
  assert.match(html,/ombMobileWeek isElementary/);
  assert.match(html,/ombMobileClassList isElementaryGrid/);
  assert.match(html,/11월 16일/);
  assert.doesNotMatch(html,/시 타임/);
  const titles=['1:00','2:00','3:00 A반','3:00 B반','4:00','5:00','6:00'];
  let pos=-1;
  for(const title of titles){
    const next=html.indexOf('>'+title+'</strong>',pos+1);
    assert.ok(next>pos, 'expected next slot in sequence: '+title);
    pos=next;
  }
  assert.doesNotMatch(html,/>2:00 A반</);
  click('toggle-week-makeup',{item:'2026-11-16|3|B'});
  assert.match(root.innerHTML,/보강 수업 0건/);
  click('toggle-week-makeup',{item:'2026-11-16|2|A'});
  assert.match(root.innerHTML,/보강 수업 1건/);
});

test('mobile flat canvas, centered brand, layout columns and reference teal color',()=>{
  const css=fs.readFileSync(path.join(__dirname,'..','olli-makeup-guardian.css'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'..','makeup-booking.html'),'utf8');
  const js=fs.readFileSync(path.join(__dirname,'..','olli-makeup-guardian.js'),'utf8');
  assert.match(css,/\.ombHeader\{display:flex;justify-content:center/);
  assert.match(css,/\.ombContent\{width:100%;min-width:0\}/);
  assert.match(css,/\.ombMobileClassList\.isKinderGrid\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\);gap:6px\}/);
  assert.match(css,/\.ombMobileClassList\.isElementaryGrid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css,/\.ombMobileClass\{[^}]*border:1px solid #e3e6e9/,'each class remains a separate bordered button');
  assert.match(css,/\.ombMobileDay\.isCurrent\{background:#0c6170;color:#fff/);
  assert.match(css,/\.ombWeekNav button\{[^}]*background:transparent;border:0/);
  assert.match(css,/\.ombDesktopWeek,.ombDesktopActions\{display:none!important\}/);
  assert.match(html,/20261116-flat-flow-1/);
  assert.match(js,/await api\('submit'/,'existing booking save RPC is retained');
});
