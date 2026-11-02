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
 for(const selector of ['.pcAcademyTodoList','.pcAcademyMaterialsList','.pcAcademyConsultationList']){
  const value=block(css,selector);
  assert.match(value,/min-height:0/);assert.match(value,/overflow-y:auto/);
  assert.match(value,/scrollbar-width:none/);
 }
 assert.match(css,/\.pcAcademyTodoList::-webkit-scrollbar,[\s\S]*?\.pcAcademyConsultationList::-webkit-scrollbar\{display:none;width:0;height:0;\}/);
 assert.match(block(css,'.pcAcademyTodoSection'),/min-height:0/);
 assert.match(block(css,'#recordAcademyDashboard .pcAcademyMaterialsSection'),/min-height:0/);
});
test('all four statistics restore the exact original title-above-value layout and font sizes',()=>{
 const start=js.indexOf('  function buildStatCard('),end=js.indexOf('  function renderDashboard()',start);
 assert.ok(start>=0&&end>start);
 const build=vm.runInNewContext(js.slice(start,end)+';buildStatCard',{escape:x=>String(x)});
 const card=build('원생수',89,'초등부 53명 · 유치부 36명');
 assert.ok(card.indexOf('recordAcademyStatLabel')<card.indexOf('recordAcademyStatBody'));
 assert.ok(card.indexOf('recordAcademyStatValue')<card.indexOf('recordAcademyStatSub'));
 assert.equal((card.match(/<br>/g)||[]).length,1);
 assert.ok(card.indexOf('초등부 53명')<card.indexOf('유치부 36명'));
 assert.doesNotMatch(card,/recordAcademyStatGuide/);
 assert.match(block(html,'.recordAcademyStatValue'),/font-size: calc\\(42px/);
 assert.match(block(html,'body[data-olli-text-size="large"] .recordAcademyStatValue'),/font-size: calc\\(42px/);
 assert.match(block(html,'.recordAcademyStatLabel'),/transform: translateX\\(4px\\)/);
 assert.match(block(html,'.recordAcademyStatSub'),/width: 72px/);
 assert.match(html,/pc-student-management\\.css\\?v=20261102-stat-card-original-3/);
});
test('no student save, synchronization, attendance, or mobile code is changed by this PC-only contract',()=>{
 assert.match(js,/function renderDashboard\(/);
 assert.match(js,/renderTodoCard\(\);/);
 assert.match(js,/renderMaterialOrders\(\);/);
 assert.match(js,/renderConsultationPanel\(due\);/);
 assert.ok(!css.includes('@import'),'PC dashboard layout does not inject a second CSS file');
});

test('materials opener equals todo submit height; recurring manager shares existing count capsule style',()=>{
 const material=block(css,'.pcAcademyMaterialsOpen'),add=block(css,'.pcAcademyTodoForm button');
 assert.match(add,/height:48px/);assert.match(material,/height:48px/);
 assert.match(material,/min-height:48px/);assert.match(material,/box-sizing:border-box/);
 const shared=block(css,'.pcAcademySectionCount,#recordAcademyDashboard .pcAcademyRecurringManageBtn');
 for(const snippet of ['height:30px','border-radius:999px','background:#f2f4f7','color:#747b85','font-size:11px','font-weight:820'])
  assert.ok(shared.includes(snippet),snippet);
 const repeat=css.split('\n#recordAcademyDashboard .pcAcademyRecurringManageBtn{')[1]?.split('}')[0];
 assert.ok(repeat,'button-only base rule exists');
 assert.doesNotMatch(repeat,/background:|border-radius:|color:|font-size:/);assert.match(repeat,/border:0/);
 assert.match(css,/#recordAcademyDashboard \.pcAcademyRecurringManageBtn svg\{[^}]*stroke:currentColor/);
});
