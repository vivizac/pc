'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const css=read('apps/pc/pc-student-management.css'),html=read('apps/pc/index.html'),js=read('apps/pc/pc-student-management.js');
function block(source,selector){
 const start=source.indexOf(selector);assert.ok(start>=0,'missing original rule '+selector);
 const open=source.indexOf('{',start+selector.length);
 assert.ok(open>=0,'missing opening brace for '+selector);
 const begin=open+1;const end=source.indexOf('}',begin);
 return source.slice(begin,end);
}
test('student-management page alone never scrolls; boxes use a single fixed-height grid',()=>{
 const layout=block(css,'body.olliPcApp #recordRoomScreen .recordBodyNew.pcAcademyLayout');
 const parent=block(css,'body.olliPcApp #recordRoomScreen.record-academy-management-mode .recordPageInner');
 const board=block(css,'body.olliPcApp #recordAcademyDashboard.show');
 assert.match(parent,/overflow:hidden/);
 assert.match(layout,/height:100%/);assert.match(layout,/min-height:0/);
 assert.match(layout,/grid-template-rows:minmax\(0,1fr\)/);
 assert.match(layout,/overflow:hidden/);
 assert.match(board,/grid-template-rows:auto minmax\(0,1fr\)/);
 assert.match(block(css,'#recordAcademyDashboard .pcAcademyWorkOrderGrid'),/height:100%;min-height:0/);
 assert.match(block(css,'.pcAcademyDetailPanel'),/height:100%;min-height:0;max-height:none/);
 assert.doesNotMatch(block(css,'.pcAcademyDetailPanel'),/position:sticky|100vh/);
});
test('card height cannot increase from new rows and scroll controls live only inside lists',()=>{
 const section=block(css,'body.olliPcApp #recordAcademyDashboard .recordAcademyConsultSection');
 assert.match(section,/height:100%;min-width:0;min-height:0/);
 assert.match(section,/display:flex;flex-direction:column/);
 assert.match(section,/overflow:hidden/);
 assert.match(block(css,'body.olliPcApp #recordAcademyDashboard .recordAcademyStatCard'),/min-height:122px/);
 assert.doesNotMatch(block(css,'body.olliPcApp #recordAcademyDashboard .recordAcademyStatGrid'),/grid-auto-rows/);
 for(const selector of ['.pcAcademyTodoList','.pcAcademyConsultationList']){
  const value=block(css,selector);
  assert.match(value,/min-height:0/);assert.match(value,/overflow-y:auto/);
  assert.match(value,/scrollbar-width:none/);
 }
 assert.match(css,/\.pcAcademyTodoList::-webkit-scrollbar,[\s\S]*?\.pcAcademyConsultationList::-webkit-scrollbar\{display:none;width:0;height:0;\}/);
 assert.match(block(css,'.pcAcademyTodoSection'),/min-height:0/);
 assert.doesNotMatch(css,/pcAcademyMaterialsSection/);
});
test('all four statistics preserve label-above-number layout and 42px values',()=>{
 const start=js.indexOf('  function buildStatCard('),end=js.indexOf('  function renderDashboard()',start);
 assert.ok(start>=0&&end>start);
 const build=vm.runInNewContext(js.slice(start,end)+';buildStatCard',{escape:x=>String(x)});
 const card=build('원생수',89,'초등부 53명 · 유치부 36명');
 assert.ok(card.indexOf('recordAcademyStatLabel')<card.indexOf('recordAcademyStatBody'));
 assert.ok(card.indexOf('recordAcademyStatValue')<card.indexOf('recordAcademyStatSub'));
 assert.equal((card.match(/<br>/g)||[]).length,1);
 assert.ok(card.indexOf('초등부 53명')<card.indexOf('유치부 36명'));
 assert.doesNotMatch(card,/recordAcademyStatGuide/);
 assert.ok(block(html,'.recordAcademyStatValue').includes('font-size: calc(42px'));
 assert.ok(block(html,'body[data-olli-text-size="large"] .recordAcademyStatValue').includes('font-size: calc(42px'));
 assert.ok(block(html,'.recordAcademyStatLabel').includes('transform: translateX(4px)'));
 assert.match(block(html,'.recordAcademyStatSub'),/width: 72px/);
 assert.ok(html.includes('pc-student-management.css?v=20261110-academy-typography-1'));
});
test('no student save, synchronization, attendance, or mobile code is changed by this PC-only contract',()=>{
 assert.match(js,/function renderDashboard\(/);
 assert.match(js,/renderTodoCard\(\);/);
 assert.match(js,/renderMaterialOrders\(\);/);
 assert.match(js,/renderConsultationPanel\(due\);/);
 assert.ok(!css.includes('@import'),'PC dashboard layout does not inject a second CSS file');
});

test('material cards appear inside the academy work list without a separate panel or opener',()=>{
 assert.match(js,/const materialRows = materialOrderCardsHtml\(\)/);
 assert.match(js,/const rows = todoRows \+ materialRows/);
 assert.match(js,/class="pcAcademyMaterialRow" onclick="pcOpenAcademyMaterials\(\)"/);
 assert.doesNotMatch(js,/pcAcademyMaterialsSection|pcAcademyMaterialsOpen|재료주문 화면 열기/);
 assert.doesNotMatch(css,/pcAcademyMaterialsSection|pcAcademyMaterialsOpen|pcAcademyMaterialsList/);
 assert.match(block(css,'#recordAcademyDashboard .pcAcademyWorkOrderGrid'),/grid-template-columns:minmax\(0,1fr\)/);
 assert.match(block(css,'.pcAcademySectionTitle,.pcAcademyDetailName'),/font-weight:650/);
 const shared=block(css,'.pcAcademySectionCount,#recordAcademyDashboard .pcAcademyRecurringManageBtn');
 for(const snippet of ['height:30px','border-radius:999px','background:#f2f4f7','color:#747b85','font-size:11px','font-weight:820'])
  assert.ok(shared.includes(snippet),snippet);
 assert.match(css,/#recordAcademyDashboard \.pcAcademyRecurringManageBtn svg\{[^}]*stroke:currentColor/);
});

test('academy work, consultations and statistics use approved type scale and weights',()=>{
 const rule=(sel,source=css)=>block(source,sel);
 const size=(sel,value,source=css)=>{
  const target='font-size:calc('+value+'px * var(--olli-text-scale))';
  const normalized=rule(sel,source).replace(/\s/g,'');
  assert.ok(normalized.includes(target.replace(/\s/g,'')),sel+' font-size '+value);
 };
 const weight=(sel,value,source=css)=>{
  const body=rule(sel,source);
  assert.match(body,new RegExp('font-weight:\\s*'+value+'(?:;|\\s)'),sel+' font-weight '+value);
 };
 const items=[
  ['.pcAcademySectionTitle,.pcAcademyDetailName',21,650],
  ['.pcAcademySectionSub,.pcAcademyDetailSub',12,700],
  ['.pcAcademyTodoForm input',14,null],
  ['.pcAcademyTodoForm button',14,830],
  ['.pcAcademyTodoText',14,650],
  ['.pcAcademyTodoOrigin',10,800],
  ['.pcAcademyTodoEmpty span',14,780],
  ['.pcAcademyTodoEmpty small',12,null],
  ['.pcAcademyDetailPanel .recordAcademyConsultGroupTitle',12,800],
  ['.pcAcademyDetailPanel .recordAcademyListName',14,700],
  ['.pcAcademyDetailPanel .recordAcademyInfoChip',11,null],
  ['.pcAcademyDetailPanel .recordAcademyConsultGroupEmpty,.pcAcademyConsultEmpty',12,700],
  ['.recordAcademyStatLabel',12,600,'html'],
  ['.recordAcademyStatValue',42,400,'html'],
  ['.recordAcademyStatSub',12,null,'html'],
 ];
 for(const [sel,sz,w,src] of items){
  const source=src==='html'?html:css;
  size(sel,sz,source);
  if(w!==null)weight(sel,w,source);
 }
 const statusStyles=[...html.matchAll(/\.recordAcademyConsultStatusChip\s*\{([^}]+)\}/g)];
 assert.equal(statusStyles.length,2);
 for(const match of statusStyles){
  assert.match(match[1],/font-size: calc\(11px \* var\(--olli-text-scale\)\)/);
  assert.match(match[1],/font-weight: 700/);
 }
 const taskCountRule=rule('.pcAcademySectionCount,#recordAcademyDashboard .pcAcademyRecurringManageBtn');
 assert.ok(taskCountRule.includes('font-size:11px'));
 assert.ok(taskCountRule.includes('font-weight:820'));
 const largeRules=html.match(/body\[data-olli-text-size="large"\][^{}]+\{[^{}]*\}/g)||[];
 for(const className of ['recordAcademyStatLabel','recordAcademyStatSub','recordAcademyConsultGroupTitle','recordAcademyListName','recordAcademyInfoChip','recordAcademyConsultStatusChip','recordAcademyConsultGroupEmpty']){
  assert.ok(!largeRules.some(rule=>rule.includes('.'+className)),className+' overridden in large mode');
 }
 assert.match(html,/pc-student-management\.css\?v=20261110-academy-typography-1/);
});
