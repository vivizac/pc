const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const drawer = fs.readFileSync('olli-main-subpage-drawer.js', 'utf8');
const search = fs.readFileSync('olli-record-search-controls.js', 'utf8');
const navigation = fs.readFileSync('olli-record-room-navigation.js', 'utf8');
const css = fs.readFileSync('olli-phone-base.css', 'utf8');

function createDrawerFixture({ academy = false, open = true } = {}) {
  const start = drawer.indexOf('  function setOlliMainSubpageDrawerCompanionHidden(active){');
  const end = drawer.indexOf('\n  window.deferOlliMainDrawerAttendanceRender', start);
  assert.ok(start >= 0 && end > start, 'use the original drawer state function');

  const bodyClasses = new Set();
  const recordClasses = new Set(academy ? ['record-academy-view'] : []);
  const hit = { hidden: false };
  let returnTimer;
  const context = {
    drawerState: open ? { mainPage: {} } : null,
    drawerSearchReturnTimer: 0,
    clearTimeout() {},
    document: {
      body: {
        classList: {
          contains: (name) => bodyClasses.has(name),
          add: (name) => bodyClasses.add(name),
          remove: (name) => bodyClasses.delete(name)
        }
      },
      getElementById: (id) => {
        if (id === 'recordRoomScreen') return { classList: { contains: (name) => recordClasses.has(name) } };
        if (id === 'olliMainDrawerReturnHit') return hit;
        return null;
      }
    },
    window: {
      setTimeout(fn) { returnTimer = fn; return 1; }
    }
  };
  const setHidden = vm.runInNewContext(drawer.slice(start, end) + '\nsetOlliMainSubpageDrawerCompanionHidden', context);
  return { setHidden, bodyClasses, recordClasses, hit, finishReturn: () => returnTimer?.() };
}

test('academy view remains full width after app-resume search cleanup', () => {
  assert.match(navigation, /currentRecordView = 'academy';[\s\S]*syncRecordAcademyPageState\(\);[\s\S]*setOlliMainSubpageDrawerSearchActive\(true\)/);
  assert.match(search, /function restoreRecordSearchAfterAppReturn\(\)[\s\S]*setRecordSearchDrawerStripHidden\(false\)/);
  const fixture = createDrawerFixture({ academy: true });
  assert.equal(fixture.setHidden(true), true);
  assert.ok(fixture.bodyClasses.has('olli-main-subpage-drawer-search-active'));
  // iOS resume invokes the search cleanup with false; the academy must ignore it.
  assert.equal(fixture.setHidden(false), true);
  assert.ok(fixture.bodyClasses.has('olli-main-subpage-drawer-search-active'));
  assert.equal(fixture.hit.hidden, true);
  assert.match(css, /body\.olli-main-subpage-drawer-search-active \.olliMainDrawerMainPage\.is-olli-main-drawer-open[\s\S]*?translate3d\(100%,0,0\) !important/);
});

test('attendance restores the original right-quarter drawer behavior', () => {
  const fixture = createDrawerFixture({ academy: true });
  fixture.setHidden(true);
  fixture.recordClasses.delete('record-academy-view');
  assert.equal(fixture.setHidden(false), false);
  assert.equal(fixture.bodyClasses.has('olli-main-subpage-drawer-search-active'), false);
  fixture.finishReturn();
  assert.match(css, /\.olliMainDrawerMainPage\.is-olli-main-drawer-open\s*\{[\s\S]*?translate3d\(75%,0,0\) !important/);
});

test('academy view without an open drawer does not create a phantom strip', () => {
  const fixture = createDrawerFixture({ academy: true, open: false });
  assert.equal(fixture.setHidden(false), false);
  assert.equal(fixture.bodyClasses.has('olli-main-subpage-drawer-search-active'), false);
});
