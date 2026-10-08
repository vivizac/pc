'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const normal=fs.readFileSync(path.join(root,'apps/mobile/kcf-normal-sheet.css'),'utf8');
const teacher=fs.readFileSync(path.join(root,'apps/mobile/kcf-teacher-sheet.css'),'utf8');
const html=fs.readFileSync(path.join(root,'apps/mobile/index.html'),'utf8');

test('QuickNote normal and Class sheets keep the page visible under a subtle dim backdrop',()=>{
  assert.match(normal,/\.kcfNormalSheetOverlay\s*\{[\s\S]*background:rgba\(0,0,0,\.14\)/);
  assert.match(teacher,/\.kcfTeacherSheetOverlay\s*\{[\s\S]*background:rgba\(0,0,0,\.14\)/);

  const normalOpen=normal.match(/body\.kcfNormalSheetOpen #kcfPersistentTopLayer,[\s\S]*?\}/)?.[0] || '';
  const teacherOpen=teacher.match(/body\.kcfTeacherSheetOpen #kcfPersistentTopLayer,[\s\S]*?\}/)?.[0] || '';
  assert.match(normalOpen,/pointer-events:none !important/);
  assert.doesNotMatch(normalOpen,/visibility:hidden|opacity:0/);
  assert.match(teacherOpen,/pointer-events:none !important/);
  assert.doesNotMatch(teacherOpen,/visibility:hidden|opacity:0/);

  assert.match(normal,/\.kcfNormalSheet\s*\{[\s\S]*border-radius:28px 28px 0 0;[\s\S]*transform:translateY\(100%\);[\s\S]*transition:transform \.24s cubic-bezier\(\.22,\.61,\.36,1\)/);
  assert.match(normal,/\.kcfNormalSheetOverlay\.show \.kcfNormalSheet\s*\{[\s\S]*transform:translateY\(0\)/);
  assert.match(normal,/transition:visibility 0s linear \.24s/);
  assert.match(html,/kcf-normal-sheet\.css\?v=20261008-sheet-motion-1/);
  assert.match(teacher,/\.kcfTeacherSheet\s*\{[\s\S]*border-radius:28px 28px 0 0;[\s\S]*transform:translateY\(100%\);[\s\S]*transition:transform \.24s cubic-bezier\(\.22,\.61,\.36,1\)/);
  assert.match(teacher,/\.kcfTeacherSheetOverlay\.show \.kcfTeacherSheet\s*\{[\s\S]*transform:translateY\(0\)/);
  assert.match(teacher,/transition:visibility 0s linear \.24s/);
  assert.match(html,/kcf-teacher-sheet\.css\?v=20261008-sheet-motion-1/);
});
