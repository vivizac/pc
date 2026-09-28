const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const vercel=fs.readFileSync(path.join(root,'vercel.json'),'utf8');

test('mobile preview uses secured settings access source',()=>{
  assert.match(vercel,/pc\/main\/olli-settings-access\.js/);
  assert.doesNotMatch(vercel,/pc\/main\/olli-settings-access\.js/);
});
