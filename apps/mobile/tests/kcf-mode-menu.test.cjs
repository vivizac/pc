const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'kcf-teacher-sheet.js'),'utf8');

function setup(mode='dialogue'){
  const nodes=new Map(), changes=[];
  function node(){return {hidden:false,dataset:{},attrs:{},style:{},children:[],events:{},offsetWidth:116,offsetHeight:74,
    setAttribute(k,v){this.attrs[k]=v;},appendChild(n){this.children.push(n);if(n.id)nodes.set(n.id,n);},
    addEventListener(k,fn){this.events[k]=fn;},querySelectorAll(){return this.children;},
    getBoundingClientRect(){return {right:280,top:400};}};}
  const button=node();nodes.set('kcfModeSwitchBtn',button);
  const document={getElementById:k=>nodes.get(k),createElement:()=>node(),body:node()};
  const context={document,state:{composerMode:mode},global:{innerWidth:390,visualViewport:{offsetLeft:0,offsetTop:0,width:390}},
    setComposerMode:(mode,event)=>changes.push({mode,event})};
  vm.runInNewContext(source.slice(source.indexOf('  function attachModeToggle('),source.indexOf('\n  function ensureSheet(')),context);
  context.attachModeToggle(button);
  return {button,nodes,context,changes,event:{cancelable:true,preventDefault(){},stopPropagation(){}}};
}

test('mode button opens a compact menu without switching mode or focusing an editor',()=>{
  const s=setup();s.button.events.click(s.event);
  assert.equal(s.changes.length,0);
  const menu=s.nodes.get('kcfComposerModeMenu');
  assert.equal(menu.hidden,false);
  assert.equal(s.button.attrs['aria-expanded'],'true');
  assert.equal(menu.children[0].attrs['aria-checked'],'true');
  assert.equal(menu.children[1].attrs['aria-checked'],'false');
  assert.equal(menu.style.top,'318px');
});
test('choosing an option closes the menu and delegates to the existing mode-switch path',()=>{
  const s=setup();s.button.events.click(s.event);
  const menu=s.nodes.get('kcfComposerModeMenu');menu.children[1].events.click(s.event);
  assert.equal(menu.hidden,true);
  assert.equal(s.changes.length,1);
  assert.equal(s.changes[0].mode,'continuous');
  assert.equal(s.changes[0].event,s.event);
});
test('continuous mode displays its checked state and a second button tap dismisses without switching',()=>{
  const s=setup('continuous');s.button.events.click(s.event);
  const menu=s.nodes.get('kcfComposerModeMenu');
  assert.equal(menu.children[1].attrs['aria-checked'],'true');
  s.button.events.click(s.event);
  assert.equal(menu.hidden,true);assert.equal(s.changes.length,0);
});
test('menu pointerdown suppresses blur and menu reopens without duplicate options',()=>{
  const s=setup();s.button.events.click(s.event);
  const menu=s.nodes.get('kcfComposerModeMenu');let prevented=false;
  menu.children[0].events.pointerdown({cancelable:true,preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  s.context.closeModeMenu();s.button.events.click(s.event);
  assert.equal(menu.children.length,2);
});
test('popup font matches the current mode control and keeps its small dimensions',()=>{
  const css=fs.readFileSync(path.join(root,'kcf-teacher-sheet.css'),'utf8');
  const control=css.match(/\.kcfComposerModeBtn\{[^}]*font-size:([^;]+);/)?.[1];
  const popup=css.match(/\.kcfComposerModeMenu\{[^}]*font-size:([^;]+);/)?.[1];
  assert.equal(popup,control);
  assert.match(css,/\.kcfComposerModeOption\{[^}]*height:32px;/);
});
