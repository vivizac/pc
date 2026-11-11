const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const js=read('apps/mobile/olli-talk-beta.js');
const css=read('apps/mobile/olli-talk-beta.css');
const html=read('apps/mobile/index.html');

test('mobile team chat sender name and academy badge share a single grid cell',()=>{
  assert.match(js,/identity\.className='olliTalkBetaSenderIdentity'/);
  assert.match(js,/identity\.appendChild\(createMessageText\('span','olliTalkBetaSenderName',profile\.displayName\)\)/);
  assert.match(js,/if\(branchName\)identity\.appendChild\(createMessageText\('span','olliTalkBetaBranchBadge',branchName\)\)/);
  assert.match(js,/sender\.appendChild\(identity\)/);
  assert.match(css,/#olliTalkBetaScreen \.olliTalkBetaIncomingLayout \.olliTalkBetaSenderIdentity\s*\{[^}]*grid-column:2;[^}]*grid-row:1;[^}]*display:inline-flex;[^}]*white-space:nowrap;/);
  assert.match(css,/#olliTalkBetaScreen \.olliTalkBetaBranchBadge\s*\{[^}]*white-space:nowrap;[^}]*word-break:keep-all;[^}]*writing-mode:horizontal-tb;/);
});
test('mobile team chat sender name is subtly larger and assets are cache-busted',()=>{
  assert.match(css,/#olliTalkBetaScreen \.olliTalkBetaIncomingLayout \.olliTalkBetaSenderName\s*\{[^}]*font-size:calc\(11\.5px \* var\(--olli-text-scale, 1\)\)/);
  assert.match(html,/olli-talk-beta\.css\?v=20261110-sender-identity-inline-1/);
  assert.match(html,/olli-talk-beta\.js\?v=20261111-original-viewer-restore-1/);
});
