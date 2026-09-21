const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html','utf8');
const css = fs.readFileSync('pc-team-talk.css','utf8');
const js = fs.readFileSync('pc-team-talk.js','utf8');
const materialJs = fs.readFileSync('pc-team-talk-material-orders.js','utf8');
const materialCss = fs.readFileSync('pc-team-talk-material-orders.css','utf8');

test('PC Team Talk runtime compiles', () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename:'pc-team-talk.js' }));
});

test('PC Team Talk uses separate chat and tabbed materials/archive panels', () => {
  assert.match(html,/olliPcTeamTalkTitle">채팅창</);
  assert.match(html,/data-team-talk-workspace-tab="materials"[^>]*>재료주문</);
  assert.match(html,/data-team-talk-workspace-tab="archive"[^>]*>자료실</);
  assert.match(css,/grid-template-columns:minmax\(300px,1fr\) minmax\(0,2fr\)/);
  assert.match(html,/data-olli-team-material-orders/);
  assert.match(js,/function setWorkspaceTab\(tab\)/);
});

test('archive tabs are ordered files media links', () => {
  const files = html.indexOf('data-team-talk-archive-tab="files"');
  const media = html.indexOf('data-team-talk-archive-tab="media"');
  const links = html.indexOf('data-team-talk-archive-tab="links"');
  assert.ok(files >= 0 && files < media && media < links);
  assert.match(js,/archiveTab: 'files'/);
});

test('outgoing link bubble is forced white and incoming avatar is a left column', () => {
  assert.match(js,/bubble\.classList\.add\('olliPcTeamTalkLinkBubble'\)/);
  assert.match(css,/\.olliPcTeamTalkMessage\.outgoing \.olliPcTeamTalkBubble\.olliPcTeamTalkLinkBubble\{--olli-pc-talk-bubble-bg:#fff\}/);
  assert.match(js,/row\.appendChild\(avatar\)/);
  assert.match(css,/\.olliPcTeamTalkMessage\.incoming,.olliPcTeamTalkMessage\.ai\{align-items:flex-start;justify-content:flex-start;gap:8px\}/);
});

test('composer is restored to white pre-three-column PC style', () => {
  assert.match(css,/\.olliPcTeamTalkComposerWrap\{[^\n]*background:#fff/);
  assert.match(css,/\.olliPcTeamTalkComposer\{[^\n]*border:1px solid #e1e4e7[^\n]*background:#f8f9fa/);
});


test('PC Team Talk material order runtime compiles', () => {
  assert.doesNotThrow(() => new vm.Script(materialJs, { filename:'pc-team-talk-material-orders.js' }));
});

test('material order panel contains request list detail and status workflow', () => {
  assert.match(materialJs,/요청 목록/);
  assert.match(materialJs,/상세 정보 \/ 처리/);
  assert.match(materialJs,/requested/);
  assert.match(materialJs,/ordered/);
  assert.match(materialJs,/arrived/);
  assert.match(materialCss,/\.olliMatWorkspace/);
});

test('Team Talk keeps one-third chat and two-thirds work area', () => {
  assert.match(css,/grid-template-columns:minmax\(300px,1fr\) minmax\(0,2fr\)/);
  assert.match(html,/pc-team-talk-material-orders\.css/);
  assert.match(html,/pc-team-talk-material-orders\.js/);
});


test('material request action lives in the workspace toolbar and hides on archive tab', () => {
  assert.match(html,/id="olliPcTeamTalkMaterialCreate"[^>]*>[\s\S]*?요청 등록/);
  assert.doesNotMatch(materialJs,/class="olliMatHeader"/);
  assert.match(js,/materialCreate\.hidden = next !== 'materials'/);
  assert.match(materialJs,/openCreate,/);
});

test('mention popup is narrower and aligned to the right side of composer', () => {
  assert.match(css,/\.olliPcTeamTalkMentionMenu\{[^\n]*right:58px;left:auto[^\n]*width:min\(220px,calc\(100% - 96px\)\)/);
});
