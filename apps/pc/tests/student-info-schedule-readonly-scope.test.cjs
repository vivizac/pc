'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'pc-student-info-schedule-readonly.js'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'consultation-survey.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const card = fs.readFileSync(path.join(root, 'pc-student-info-card-runtime.js'), 'utf8');
const target = '#recordRoomScreen .pcStudentInfoCard .pcStudentInfoSchedule[aria-label="수업시간 조회"]';

test('read-only student schedule does not overwrite pickup title or add its timetable guide', () => {
  const begin = script.indexOf('  function applyReadonly(){');
  const end = script.indexOf('\n  if (!document.getElementById', begin);
  assert.ok(begin >= 0 && end > begin);
  const createCard = name => {
    const title = { textContent: name };
    const guideNodes = [];
    const buttons = [{ disabled: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, tabIndex: 0 }];
    return {
      title, guideNodes, buttons,
      querySelector(q) {
        if (q === '.pcStudentInfoScheduleTitle') return title;
        if (q === '.pcStudentInfoScheduleReadonlyGuide') return guideNodes[0] || null;
        return null;
      },
      querySelectorAll(q) { return q === 'button' ? buttons : []; },
      appendChild(node) { guideNodes.push(node); }
    };
  };
  const schedule = createCard('수업시간');
  const pickup = createCard('픽업정보');
  const seen = [];
  const document = {
    querySelectorAll(selector) {
      seen.push(selector);
      return selector === target ? [schedule] : [schedule, pickup];
    },
    createElement() { return { className: '', textContent: '' }; }
  };
  const apply = new Function('document', script.slice(begin, end) + '\nreturn applyReadonly;')(document);
  apply();
  assert.deepEqual(seen, [target]);
  assert.equal(schedule.title.textContent, '수업 시간 · 시간표에서 변경');
  assert.equal(schedule.guideNodes.length, 1);
  assert.equal(schedule.buttons[0].disabled, true);
  assert.equal(pickup.title.textContent, '픽업정보');
  assert.equal(pickup.guideNodes.length, 0);
  assert.equal(pickup.buttons[0].disabled, false);
});

test('PC schedule and pickup markup have distinct aria labels, and script asset is cache-busted', () => {
  assert.match(card, /class="pcStudentInfoSchedule" aria-label="수업시간 조회"/);
  assert.match(card, /class="pcStudentInfoSchedule" aria-label="픽업정보"/);
  assert.match(loader, /pc-student-info-schedule-readonly\.js\?v=20261013-schedule-only-1/);
  assert.match(html, /consultation-survey\.js\?v=20261013-schedule-only-1/);
  assert.doesNotMatch(script, /querySelectorAll\('#recordRoomScreen \.pcStudentInfoCard \.pcStudentInfoSchedule'\)/);
});
