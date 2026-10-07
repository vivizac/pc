const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const rosterCss = fs.readFileSync(path.join(root, 'olli-observation-roster-phone.css'), 'utf8');
const baseCss = fs.readFileSync(path.join(root, 'olli-phone-base.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const rosterJs = fs.readFileSync(path.join(root, 'olli-observation-roster-phone.js'), 'utf8');

function ruleBody(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(escaped + '\\s*\\{([\\s\\S]*?)\\}'));
  assert.ok(match, `missing rule: ${selector}`);
  return match[1];
}

test('observation roster title/day top aligns with memo student-name top', () => {
  const rosterPage = ruleBody(rosterCss, '#observationRosterScreen .observationRosterPageInner');
  const rosterView = ruleBody(rosterCss, '#observationRosterScreen #memoStudentRosterView');
  const rosterHeader = ruleBody(rosterCss, '#observationRosterScreen .memoBodyRosterHeader');
  const memoPage = ruleBody(baseCss, '#studentMemoScreen .memoPageInner');
  const memoWrap = ruleBody(rosterCss, '#studentMemoScreen[data-memo-body-view="editor"] #elementaryMemoWrap');
  const analysisBlock = ruleBody(baseCss, '#studentMemoScreen .elementaryAnalysisBlock');
  const titleRow = ruleBody(baseCss, '#studentMemoScreen .memoAnalysisTitleRow');

  assert.match(rosterPage, /padding-top:calc\(var\(--vivizac-note-header-h\) \+ max\(18px, calc\(env\(safe-area-inset-top\) \+ 6px\)\) - 12px\);/);
  assert.match(rosterView, /padding:0 18px;/);
  assert.match(rosterHeader, /margin:2px 2px 14px;/);
  assert.match(memoPage, /padding-top:\s*calc\(var\(--vivizac-note-header-h\) \+ max\(18px, calc\(env\(safe-area-inset-top\) \+ 6px\)\) \+ 12px\);/);
  assert.match(memoWrap, /padding-top:12px;/);
  assert.match(analysisBlock, /margin:\s*-20px 0 0;/);
  assert.match(titleRow, /padding:\s*4px 0 0 22px;/);

  // 동일한 공통 헤더/세이프에어리어 기준에서 상대 Y 오프셋이 둘 다 8px이다.
  const rosterRelativeTop = 6 + 2;
  const memoRelativeTop = 12 + 12 - 20 + 4;
  assert.equal(rosterRelativeTop, memoRelativeTop);
});

test('roster alignment moves the whole roster body, not title/day independently', () => {
  const title = ruleBody(rosterCss, '#observationRosterScreen .memoBodyRosterTitle');
  const day = ruleBody(rosterCss, '#observationRosterScreen .memoBodyRosterDay');
  assert.doesNotMatch(title, /translateY|margin-top|top:/);
  assert.doesNotMatch(day, /translateY|margin-top|top:/);
  assert.match(html, /olli-observation-roster-phone\.css\?v=[^\"']+/);
});


test('observation roster switches exclusively between elementary and kinder', () => {
  assert.match(rosterJs, /let observationRosterActiveDivision = 'elementary'/);
  assert.match(rosterJs, /function setObservationRosterDivision\(division, options = \{\}\)/);
  assert.doesNotMatch(rosterJs, /observationRosterVisibleDivisions = new Set/);
  assert.doesNotMatch(rosterJs, /toggleObservationRosterDivision/);
  assert.match(rosterJs, /getObservationRosterAllStudents\(\)/);
  assert.match(rosterJs, /getAllStudents === 'function'/);
  assert.match(rosterJs, /getStudentsByType\('elementary'\)/);
  assert.match(rosterJs, /getStudentsByType\('kinder'\)/);
  assert.doesNotMatch(rosterJs, /\['initial', '자음'\]/);
  assert.match(rosterJs, /\['group', '그룹'\],[\s\S]*\['teacher', '담임'\],[\s\S]*\['tendency', '성향'\],[\s\S]*\['school', '학교'\],[\s\S]*\['grade', '학년'\],[\s\S]*\['lessonDay', '요일'\]/);
  assert.match(rosterJs, /data-memo-roster-division="\$\{key\}"/);
  assert.match(rosterJs, /observationRosterActiveDivision === key/);
  assert.match(rosterJs, /getObservationRosterStudentDivision\(student\) === observationRosterActiveDivision/);
  assert.match(rosterJs, /memoRosterSortDivider/);

  const divisionGrid = ruleBody(rosterCss, '#observationRosterScreen .memoRosterDivisionGrid');
  const sortGrid = ruleBody(rosterCss, '#observationRosterScreen .memoRosterSortGrid');
  assert.match(divisionGrid, /grid-template-columns:repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(sortGrid, /grid-template-columns:repeat\(3, minmax\(0, 1fr\)\);/);
});


test('observation roster title matches student-name size with lighter weight', () => {
  const title = ruleBody(rosterCss, '#observationRosterScreen .memoBodyRosterTitle');
  const name = ruleBody(rosterCss, '#observationRosterScreen .memoBodyRosterName');
  const meta = ruleBody(rosterCss, '#observationRosterScreen .memoBodyRosterMeta');
  assert.match(title, /color:#111;/);
  assert.match(title, /font-size:calc\(16px \* var\(--olli-text-scale\)\);/);
  assert.match(title, /font-weight:500;/);
  assert.match(name, /color:#111;/);
  assert.match(name, /font-size:calc\(16px \* var\(--olli-text-scale\)\);/);
  assert.match(meta, /color:#8f8f8f;/);
  assert.match(html, /olli-observation-roster-phone\.css\?v=20260928-sort-prefix-gray-1/);
});


test('roster header and student cards share one scroll owner without leftover nested boxes', () => {
  const scroll = ruleBody(rosterCss, '#observationRosterScreen .memoBodyRosterScroll');
  const list = ruleBody(rosterCss, '#observationRosterScreen .memoBodyRosterList');
  const empty = ruleBody(rosterCss, '#observationRosterScreen .memoBodyRosterEmpty');

  assert.match(rosterJs, /container\.innerHTML = `<div class="memoBodyRosterScroll"><div class="memoBodyRosterHeader">[\s\S]*?<div class="memoBodyRosterList">\$\{rosterContent\}<\/div><\/div>\$\{renderObservationRosterFooter\(\)\}`/);
  assert.match(scroll, /flex:1 1 auto;/);
  assert.match(scroll, /overflow-y:auto;/);
  assert.match(scroll, /overflow-x:hidden;/);
  assert.match(scroll, /margin-right:-18px;/);
  assert.match(scroll, /padding:calc\(var\(--vivizac-note-header-h\) \+ max\(18px, calc\(env\(safe-area-inset-top\) \+ 6px\)\) \+ 6px\) 18px 94px 0;/);
  assert.match(scroll, /display:flex;/);
  assert.match(scroll, /flex-direction:column;/);

  assert.match(list, /overflow:visible;/);
  assert.match(list, /border:0;/);
  assert.match(list, /margin:0;/);
  assert.match(list, /padding:0;/);
  assert.doesNotMatch(list, /overflow-y:auto|border:1px solid transparent|margin-right:-18px/);

  assert.match(empty, /border:0;/);
  assert.match(empty, /overflow:visible;/);
});


test('observation roster scrolls under fixed top and bottom controls without outer spacer boxes', () => {
  const page = ruleBody(rosterCss, '#observationRosterScreen .observationRosterPageInner');
  const rosterView = ruleBody(rosterCss, '#observationRosterScreen #memoStudentRosterView');
  const scroll = ruleBody(rosterCss, '#observationRosterScreen .memoBodyRosterScroll');

  assert.match(page, /padding-top:0;/);
  assert.match(page, /background:transparent;/);
  assert.match(rosterView, /padding:0 18px;/);
  assert.doesNotMatch(rosterCss, /#observationRosterScreen #memoStudentRosterView \{\s*padding-bottom:86px !important;/);
  assert.match(scroll, /padding:calc\(var\(--vivizac-note-header-h\) \+ max\(18px, calc\(env\(safe-area-inset-top\) \+ 6px\)\) \+ 6px\) 18px 94px 0;/);
  assert.match(scroll, /overflow-y:auto;/);
  assert.match(scroll, /background:transparent;/);
  assert.match(html, /olli-observation-roster-phone\.css\?v=20260928-sort-prefix-gray-1/);
});


test('roster sort prefix uses the same gray as student guide text while the sort value stays blue', () => {
  const prefix = ruleBody(rosterCss, '#observationRosterScreen .memoBodyRosterSortPrefix');
  const value = ruleBody(rosterCss, '#observationRosterScreen .memoBodyRosterSortValue');
  const meta = ruleBody(rosterCss, '#observationRosterScreen .memoBodyRosterMeta');

  assert.match(rosterJs, /<span class="memoBodyRosterSortPrefix">정렬<\/span><span class="memoBodyRosterSortValue"> · \$\{escapeHtml\(sortLabel\)\}<\/span>/);
  assert.match(prefix, /color:#8f8f8f;/);
  assert.match(meta, /color:#8f8f8f;/);
  assert.match(value, /color:#0A84FF;/);
  assert.match(html, /olli-observation-roster-phone\.js\?v=20260928-sort-prefix-gray-1/);
  assert.match(html, /olli-observation-roster-phone\.css\?v=20260928-sort-prefix-gray-1/);
});


test('observation roster student rows match the compact attendance card height', () => {
  const rosterRow = ruleBody(rosterCss, '#observationRosterScreen .memoBodyRosterRow');
  const rosterButton = ruleBody(rosterCss, '#observationRosterScreen .memoBodyRosterStudentBtn');
  assert.match(rosterRow, /min-height:50px;/);
  assert.match(rosterButton, /min-height:50px;/);
  assert.match(baseCss, /\.elementaryStudentRow,[\s\S]*?\.kinderStudentRow \{[\s\S]*?min-height:50px;[\s\S]*?padding:6px 10px 6px 10px;/);
});
