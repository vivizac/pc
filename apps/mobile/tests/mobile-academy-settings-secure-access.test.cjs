const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const runtime=fs.readFileSync(path.join(root,'olli-settings-account-runtime.js'),'utf8');
const vercel=fs.readFileSync(path.join(root,'vercel.json'),'utf8');

test('mobile academy settings writes use secure shared helper',()=>{
  assert.match(runtime,/saveOlliAcademySettingsSecure/);
  assert.doesNotMatch(runtime,/supabase\('PATCH',`academies/);
});

test('mobile receives secure settings core from PC work branch',()=>{
  assert.match(vercel,/pc\/work\/olli-architecture-stabilization-20260928\/olli-settings-common-core\.js/);
});
