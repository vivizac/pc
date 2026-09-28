const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'olli-talk-beta.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'olli-talk-beta.js'), 'utf8');

test('Olli Talk header search opens an inline chat search field', () => {
  assert.match(html, /id="olliTalkSearchBtn"/);
  assert.match(html, /id="olliTalkSearchBar" hidden/);
  assert.match(html, /id="olliTalkSearchInput"/);
  assert.match(html, /id="olliTalkSearchNextBtn"/);
  assert.match(html, /id="olliTalkSearchCloseBtn"/);
  assert.match(css, /\.olliTalkSearchBar\{/);
  assert.match(css, /\.olliTalkSearchOpen \.olliTalkBetaChatArea\{/);
});

test('Olli Talk search finds rendered chat text, counts matches and cycles results', () => {
  assert.match(js, /function refreshOlliTalkSearch\(/);
  assert.match(js, /querySelectorAll\('\.olliTalkBetaMessage, \.olliTalkBetaSystemMessage'\)/);
  assert.match(js, /includes\(query\)/);
  assert.match(js, /olliTalkSearchMatch/);
  assert.match(js, /olliTalkSearchCurrent/);
  assert.match(js, /scrollToOlliTalkSearchMatch\(olliTalkSearchIndex \+ 1\)/);
});

test('Olli Talk rerenders keep an active search applied', () => {
  assert.match(js, /hasActiveSearch[\s\S]*refreshOlliTalkSearch\(\{ resetIndex:true, scroll:true \}\)/);
});


test('Olli Talk search highlights matched text in blue without outlining the whole bubble', () => {
  assert.match(js, /function highlightOlliTalkSearchText\(/);
  assert.match(js, /className='olliTalkSearchTextMark'/);
  assert.match(css, /\.olliTalkSearchTextMark\{[\s\S]*?background:#b8d6ff;/);
  assert.match(css, /\.olliTalkSearchCurrent \.olliTalkSearchTextMark\{[\s\S]*?background:#86b9ff;/);
  assert.doesNotMatch(css, /\.olliTalkBetaMessage\.olliTalkSearchMatch \.olliTalkBetaBubble/);
  assert.doesNotMatch(css, /\.olliTalkBetaMessage\.olliTalkSearchCurrent \.olliTalkBetaBubble/);
});
