const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const materialJs = fs.readFileSync(path.join(root, 'olli-talk-material-orders-mobile.js'), 'utf8');
const talkJs = fs.readFileSync(path.join(root, 'olli-talk-beta.js'), 'utf8');

test('Work quick order and Work Hub plus use one shared popup entrypoint', () => {
  assert.match(materialJs, /function openQuickOrder\(\)\{\s*return openCreate\(\{variant:'coffee'\}\);\s*\}/);
  assert.match(materialJs, /if\(action==='open-create'\)\{openQuickOrder\(\);return\}/);
  assert.match(materialJs, /openCreate,\s*openQuickOrder,\s*closeCreate/);

  assert.match(talkJs, /if\(!materialOrders\?\.openQuickOrder\)/);
  assert.match(talkJs, /return materialOrders\.openQuickOrder\(\);/);
  assert.doesNotMatch(talkJs, /materialOrders\.openCreate\(\{variant:'coffee'\}\)/);
});

test('material create popup DOM stays single-source outside the Work Hub shell', () => {
  assert.match(materialJs, /host\.innerHTML=\`<div class="olliMobileMatToast"[\s\S]*createMaterialCreateModalHtml\('olliMobileMatSharedCreateTitle'\)/);
  assert.doesNotMatch(materialJs, /shellHtml\(\)[\s\S]*\$\{createMaterialCreateModalHtml\(\)\}/);
});
