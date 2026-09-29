const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const teacherCss = fs.readFileSync('kcf-teacher-sheet.css', 'utf8');
const autoCss = fs.readFileSync('kcf-auto-mode.css', 'utf8');

/*
 * 유지보수 보호 테스트
 * - 일반 명령 입력창은 별도 viewport lock을 만들지 않는다.
 * - Teacher 전용 입력만 kcfTeacherSheetOpen으로 문서 스크롤을 잠근다.
 * - 피드백/수업기록 수정 시트는 기존 kcfDedicatedEditViewportLocked를 유지한다.
 * body를 position:fixed로 고정하지 않는다.
 */
test('Teacher and edit-sheet scroll guards remain separate and non-fixed', () => {
  const teacherLock = teacherCss.match(/html\.kcfTeacherSheetOpen,[\s\S]*?body\.kcfTeacherSheetOpen\s*\{[\s\S]*?\n\}/)?.[0] || '';
  const dedicatedLock = autoCss.match(/html\.kcfDedicatedEditViewportLocked,[\s\S]*?body\.kcfDedicatedEditViewportLocked\s*\{[\s\S]*?\n\}/)?.[0] || '';

  assert.ok(teacherLock.length > 0);
  assert.ok(dedicatedLock.length > 0);

  for (const block of [teacherLock, dedicatedLock]) {
    assert.match(block, /overflow:hidden/);
    assert.match(block, /overscroll-behavior:none/);
    assert.doesNotMatch(block, /position\s*:\s*fixed/i);
  }
});
