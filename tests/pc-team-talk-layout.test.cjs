const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html','utf8');
const css = fs.readFileSync('pc-team-talk.css','utf8');
const js = fs.readFileSync('pc-team-talk.js','utf8');

test('PC Team Talk runtime compiles', () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename:'pc-team-talk.js' }));
});

test('PC Team Talk uses separate chat and tabbed materials/archive panels', () => {
  assert.match(html,/olliPcTeamTalkTitle">채팅창</);
  assert.match(html,/data-team-talk-workspace-tab="materials"[^>]*>재료주문</);
  assert.match(html,/data-team-talk-workspace-tab="archive"[^>]*>자료실</);
  assert.match(css,/grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
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
