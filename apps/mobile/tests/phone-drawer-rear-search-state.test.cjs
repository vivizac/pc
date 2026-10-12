const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'olli-record-search-controls.js'), 'utf8');

function setup({mounted=true, query='학생', focused=false}={}) {
  const classes = new Set(['record-search-open','record-search-has-query','record-keyboard-open','record-keyboard-closing','record-search-list-restoring']);
  const cleared = [], properties = new Map();
  const screen = {hasAttribute:key=>mounted && key==='data-olli-drawer-rear-mounted',classList:{
    contains:key=>classes.has(key),add:(...keys)=>keys.forEach(k=>classes.add(k)),
    remove:(...keys)=>keys.forEach(k=>classes.delete(k)),toggle:(key,on)=>on?classes.add(key):classes.delete(key)}};
  const input={value:query};
  const context={window:{innerHeight:800,visualViewport:{offsetTop:0,height:500},__olliRecordSearchViewportBottomBaseline:800,__olliRecordKeyboardLastOffset:300},
    document:{activeElement:focused?input:null,documentElement:{clientHeight:800,style:{setProperty:(k,v)=>properties.set(k,v)}},getElementById:id=>id==='recordRoomScreen'?screen:id==='searchName'?input:null},
    setTimeout:()=>1,clearTimeout:id=>cleared.push(id),requestAnimationFrame:()=>1};
  vm.runInNewContext(source.slice(0,source.indexOf('window.prepareOlliRecordSearchForDrawerRear =')),context);
  return {context,classes,input,properties,cleared};
}

test('rear preparation clears keyboard restoration timers and classes without losing a query',()=>{
  const s=setup();vm.runInNewContext('recordSearchListReturnTimer=10;recordSearchListReturnFallback=11;',s.context);
  s.context.prepareRecordSearchForDrawerRear();
  assert.deepEqual(s.cleared,[10,11]);
  for(const name of ['record-keyboard-open','record-keyboard-closing','record-search-list-restoring'])assert.equal(s.classes.has(name),false);
  assert.equal(s.input.value,'학생');assert.equal(s.classes.has('record-search-open'),true);
  assert.equal(s.properties.get('--record-keyboard-offset'),'0px');
});

test('a foreground keyboard cannot collapse the prepared rear header',()=>{
  const s=setup();s.context.prepareRecordSearchForDrawerRear();s.context.setRecordKeyboardOffset();
  assert.equal(s.classes.has('record-keyboard-open'),false);
  assert.equal(s.properties.get('--record-keyboard-offset'),'0px');
});

test('search keyboard behavior still works when the actual rear input receives focus',()=>{
  const s=setup({focused:true});s.context.prepareRecordSearchForDrawerRear();s.context.setRecordKeyboardOffset();
  assert.equal(s.classes.has('record-keyboard-open'),true);
  assert.equal(s.properties.get('--record-keyboard-offset'),'300px');
});

test('ordinary attendance search keeps its original viewport handling',()=>{
  const s=setup({mounted:false});s.classes.delete('record-keyboard-closing');s.context.setRecordKeyboardOffset();
  assert.equal(s.classes.has('record-keyboard-open'),true);
  assert.equal(s.properties.get('--record-keyboard-offset'),'300px');
});

test('rear transitions are enabled only when the drawer is revealed or attendance is standalone',()=>{
  const css=fs.readFileSync(path.join(__dirname,'..','olli-record-search-controls.css'),'utf8');
  assert.match(css,/#recordRoomScreen:not\(\[data-olli-drawer-rear-mounted\]\) \.recordStickyArea > \.recordUtilityRow,\s*body\.olli-main-subpage-drawer-open #recordRoomScreen \.recordStickyArea > \.recordUtilityRow/);
  assert.match(css,/#recordRoomScreen:not\(\[data-olli-drawer-rear-mounted\]\) #recordList,\s*body\.olli-main-subpage-drawer-open #recordRoomScreen #recordList/);
});
