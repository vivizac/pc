'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'olli-phone-base.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function ancestorsOf(markup, targetId) {
  const cleaned = markup.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const tags = /<\/?([a-z][\w:-]*)\b[^>]*>/gi;
  const voidTags = new Set(['meta','link','input','img','br','hr','source','area','base','wbr','embed','param']);
  const stack = [];
  let match;
  while ((match = tags.exec(cleaned))) {
    const full = match[0];
    const tag = match[1].toLowerCase();
    if (full.startsWith('</')) {
      const i = stack.map(x => x.tag).lastIndexOf(tag);
      if (i >= 0) stack.length = i;
      continue;
    }
    const id = full.match(/\bid=["']([^"']+)["']/i)?.[1];
    if (id === targetId) return stack.filter(x => x.id).map(x => x.id);
    if (!voidTags.has(tag) && !full.endsWith('/>')) stack.push({tag, id});
  }
  return null;
}

test('observation feedback archive is outside the transformed memo page', () => {
  const ancestors = ancestorsOf(html, 'elementaryRecordsDropup');
  assert.ok(ancestors && !ancestors.includes('studentMemoScreen'));
  assert.equal(html.split('id="elementaryRecordsDropup"').length - 1, 1);
});

test('global popups have a viewport overlay layer above the prepainted rear', () => {
  const section = css.slice(css.indexOf('/* Mobile modal ownership: attendance is prepainted'));
  assert.ok(section.includes('z-index: 180000'));
  for (const selector of [
    '.analysisSheetOverlay','.analysisResultSheetOverlay','.modalOverlay',
    '.memoRecordsDropup','.attendanceFeedbackSheetOverlay','.attendanceRecordDeleteOverlay',
    '.feedbackLoadingOverlay','.memoFeedbackPopupOverlay','.oneMinuteFeedbackPopupOverlay',
    '.sceneCardModalOverlay','.recordSummaryPopupOverlay','.recordBoardActionOverlay',
    '.settingsSheetOverlay','#kcfInboxOverlay','.kcfGrowthOverlay',
    '#kcfSaveStudentPickerOverlay','#olliAcademySwitchOverlay'
  ]) assert.ok(section.includes(selector), selector + ' lacks overlay stacking');
});

test('Work Hub renders above prepared attendance when it is the active route', () => {
  assert.match(css, /body > #olliTalkArchiveScreen\[aria-hidden="false"\]\s*\{\s*z-index:\s*130200;/);
  assert.match(html, /olli-phone-base\.css\?v=20261013-popup-layer-ownership-1/);
});
