const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('arrived material/coffee cards navigate to existing archive on PC and mobile',()=>{
 const cases=[
 {js:'apps/pc/pc-team-talk-material-orders.js',css:'apps/pc/pc-team-talk-material-orders.css',index:'apps/pc/index.html',button:'olliMatDoneNote',asset:'pc-team-talk-material-orders'},
 {js:'apps/mobile/olli-talk-material-orders-mobile.js',css:'apps/mobile/olli-talk-material-orders-mobile.css',index:'apps/mobile/index.html',button:'olliMobileMatDoneNote',asset:'olli-talk-material-orders-mobile'}
 ];
 for(const c of cases){
  const src=read(c.js),css=read(c.css),html=read(c.index);
  assert.match(src,/item\.status\s*===\s*'arrived'/);
  assert.match(src,/지난 주문 내역으로 이동/);
  assert.match(src,/archiveButton\.dataset\.materialAction\s*=\s*'open-archive'/);
  assert.match(src,/action\s*===?\s*'open-archive'/);
  assert.match(src,/openArchive\(\)\.catch/);
  assert.match(css,new RegExp('button\\.'+c.button));
  assert.match(html,new RegExp(c.asset+'\\.js\\?v=20261110-arrived-archive-1'));
  assert.match(html,new RegExp(c.asset+'\\.css\\?v=20261110-arrived-archive-1'));
 }
});
