'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const read = p => fs.readFileSync(path.join(root, p),'utf8');
const blobSha = content => crypto.createHash('sha1')
  .update('blob '+Buffer.byteLength(content,'utf8')+'\0')
  .update(content,'utf8')
  .digest('hex');
const originalDashboard = read('apps/mobile/olli-settings-server-sync.js');
const style = read('apps/mobile/olli-academy-dashboard.css');
const copy = read('packages/common/olli-consultation-messages.js');
const runtime = read('apps/mobile/olli-consultation-mobile-runtime.js');
const html = read('apps/mobile/index.html');

test('original consultation dashboard markup is preserved byte-for-byte', () => {
  // Only the legacy consultation data duplicate was removed; the original
  // renderer and its CSS still own the UI, unchanged.
  const renderer = originalDashboard.slice(originalDashboard.indexOf('function renderAcademyConsultationList(students){'));
  assert.match(renderer, /function renderRecordAcademyManagementDashboard\(\)/);
  assert.match(originalDashboard, /function renderRecordAcademyManagementDashboard\(\)/);
  assert.match(originalDashboard, /function renderAcademyConsultationList\(students\)/);
  assert.match(originalDashboard, /recordAcademyStatGrid/);
  assert.match(originalDashboard, /recordAcademyConsultGroups/);
  assert.match(originalDashboard, /recordAcademyListItem recordAcademyConsultListItem/);
});
test('original academy CSS is restored byte-for-byte', () => {
  assert.equal(blobSha(style), '071040b9ba796a84b4664b9d761d3ea1123d4423');
});
test('mobile notice is a PC-style copy icon immediately left of status; PC untouched', () => {
  const vm = require('node:vm');
  const start = copy.indexOf('function manualConsultationCopyIconSvg() {');
  const finish = copy.indexOf('function startManualConsultationButtons()', start);
  assert.ok(start > 0 && finish > start);
  const source = copy.slice(start, finish);
  const render = isPc => {
    const status = { textContent: '자료부족' };
    const actions = {
      children: [status],
      querySelector: selector => selector === '.recordAcademyConsultStatusChip' ? status : null,
      insertBefore(button, anchor) {
        const i = this.children.indexOf(anchor);
        assert.ok(i >= 0);
        this.children.splice(i, 0, button);
      }
    };
    const studentMain = { textContent: '김테스트 · 12개월' };
    const card = {
      children: [studentMain, actions],
      firstChild: studentMain,
      querySelector(selector) {
        if (selector === '[data-consultation-manual-copy]') return null;
        if (selector === '.recordAcademyConsultActions') return actions;
        return null;
      },
      insertBefore(button, anchor) {
        const i = this.children.indexOf(anchor);
        assert.ok(i >= 0);
        this.children.splice(i, 0, button);
      }
    };
    let button;
    const document = {
      body: { classList: { contains: value => value === 'olliPcApp' && isPc } },
      querySelectorAll: selector => selector === '.recordAcademyConsultListItem' ? [card] : [],
      createElement(tag) {
        assert.equal(tag, 'button');
        button = {dataset: {}, style: {}, attrs: {}, addEventListener(){},
          setAttribute(key,value){this.attrs[key]=value;}};
        return button;
      }
    };
    vm.runInNewContext(source + '\nattachManualConsultationButtons();', { document, isOwner: () => true });
    return { status, actions, studentMain, card, button };
  };
  const mobile = render(false);
  const pc = render(true);
  assert.deepEqual(mobile.actions.children, [mobile.button, mobile.status]);
  assert.deepEqual(mobile.card.children, [mobile.studentMain, mobile.actions]);
  // PC and mobile now both place the copy control immediately before the status chip.
  assert.deepEqual(pc.card.children, [pc.studentMain, pc.actions]);
  assert.deepEqual(pc.actions.children, [pc.button, pc.status]);
  assert.equal(mobile.button.dataset.consultationCopyIcon,'true');
  assert.match(mobile.button.innerHTML, /<svg /);
  assert.match(mobile.button.innerHTML, /<rect x="8" y="8"/);
  assert.match(mobile.button.innerHTML, /stroke-width="1\.9"/);
  assert.equal(mobile.button.attrs['aria-label'], '학생 상담 안내문 복사');
  assert.equal(mobile.button.title, '안내문 복사');
  assert.match(mobile.button.style.cssText, /width:28px;height:24px;min-height:24px;box-sizing:border-box;border:none;border-radius:50%/);
  assert.match(mobile.button.style.cssText, /background:transparent;color:#7f7f7f/);
  assert.equal(pc.button.textContent,'안내문 복사','desktop creation behavior is unchanged');
  assert.match(pc.button.style.cssText,/height:24px;min-height:24px;box-sizing:border-box/);
  assert.match(pc.button.style.cssText,/border-radius:999px;background:#fff;color:#343d4b/);
  assert.match(copy,/button\.innerHTML = manualConsultationCopyIconSvg\(\)/,'icon restored after success');
  assert.equal(blobSha(style), '071040b9ba796a84b4664b9d761d3ea1123d4423');
});

test('new server keeps data synchronization but never overlays or replaces the old dashboard', () => {
  assert.doesNotMatch(runtime, /renderOlliServerConsultationDashboard|recordAcademyConsultationListMobile|root\.prepend\(panel\)/);
  assert.doesNotMatch(runtime, /window\.renderRecordAcademyManagementDashboard\s*=/);
  assert.match(runtime, /window\.OlliConsultationServer\.readProgress\(\)/);
  assert.doesNotMatch(runtime, /window\.OlliConsultationServer\.setCompleted\(|toggleAcademyConsultationCompleted/);
  assert.match(runtime, /function initializeMobileConsultationServer\(\)/);
  assert.match(runtime, /loadOlliConsultationProgressFromServer/);
});
test('restored scripts and stylesheet are explicitly cache-busted for installed phones', () => {
  assert.match(html,/olli-academy-dashboard\.css\?v=20261024-original-ui-restore-1/);
  assert.match(html,/olli-consultation-mobile-runtime\.js\?v=20261024-month-only-1/);
  assert.match(html,/olli-settings-server-sync\.js\?v=20261024-remove-consultation-entry-1/);
  assert.match(html,/olli-consultation-messages\.js\?v=20261027-mobile-instant-copy-icon-1/);
});

test('mobile manual notice icon acknowledges tap immediately and restores on clipboard settlement, without affecting PC', async () => {
  const vm = require('node:vm');
  const start = copy.indexOf("      button.addEventListener('click', async event => {");
  const end = copy.indexOf('      // Place the copy control immediately', start);
  assert.ok(start > 0 && end > start, 'use the original card click handler');

  function scenario(mobile) {
    let callback, resolveCopy, rejectCopy;
    const errors = [];
    const attrs = {};
    const copyPromise = new Promise((resolve, reject) => { resolveCopy = resolve; rejectCopy = reject; });
    const button = {
      dataset:{ consultationCopyIcon:mobile ? 'true' : undefined },
      textContent:'안내문 복사',
      innerHTML:mobile ? 'COPY' : '',
      disabled:false,
      setAttribute(name, value){ attrs[name] = value; },
      addEventListener(type, fn){ assert.equal(type, 'click'); callback=fn; }
    };
    vm.runInNewContext(copy.slice(start,end), {
      button, mobile, card:{}, alert:message=>errors.push(message),
      manualConsultationCheckIconSvg:()=> 'CHECK',
      manualConsultationCopyIconSvg:()=> 'COPY',
      copyManualConsultationNotice:()=>copyPromise
    });
    const finished = callback({ preventDefault(){}, stopPropagation(){} });
    return { button, attrs, errors, resolveCopy, rejectCopy, finished };
  }

  const mobileSuccess = scenario(true);
  assert.equal(mobileSuccess.button.innerHTML, 'CHECK', 'check displays synchronously before server/clipboard finishes');
  assert.equal(mobileSuccess.button.disabled,true);
  mobileSuccess.resolveCopy();
  await mobileSuccess.finished;
  assert.equal(mobileSuccess.button.innerHTML, 'COPY', 'copy icon returns immediately when clipboard resolves');
  assert.equal(mobileSuccess.button.disabled,false);
  assert.equal(mobileSuccess.attrs['aria-label'],'학생 상담 안내문 복사');

  const mobileFailure = scenario(true);
  assert.equal(mobileFailure.button.innerHTML, 'CHECK');
  mobileFailure.rejectCopy(new Error('복사 권한이 없습니다.'));
  await mobileFailure.finished;
  assert.equal(mobileFailure.button.innerHTML,'COPY', 'failed copy does not leave misleading check');
  assert.equal(mobileFailure.button.disabled,false);
  assert.deepEqual(mobileFailure.errors,['복사 권한이 없습니다.']);

  const pc = scenario(false);
  assert.equal(pc.button.innerHTML,'', 'PC has no early check icon');
  assert.equal(pc.button.textContent,'안내문 복사');
  pc.resolveCopy();
  await pc.finished;
  assert.equal(pc.button.innerHTML,'');
  assert.equal(pc.button.disabled,false);

  const copyStart=copy.indexOf('  async function copyManualConsultationNotice(');
  const copyEnd=copy.indexOf('  function manualConsultationCheckIconSvg()',copyStart);
  const originalCopyFlow=copy.slice(copyStart,copyEnd);
  assert.match(originalCopyFlow,/if \(button\.dataset\.consultationCopyIcon === 'true'\) return/);
  assert.match(originalCopyFlow,/button\.textContent = '복사 완료'/);
  assert.match(originalCopyFlow,/\}, 1800\)/, 'PC confirmation display timing is preserved');
});
