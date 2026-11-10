'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { test, before, after } = require('node:test');
const requireBrowser = createRequire(path.resolve(__dirname, '../../../tests/shared-chat/package.json'));
const { chromium } = requireBrowser('playwright');

const app = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(app, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(app, 'olli-talk-beta.css'), 'utf8');
const runtime = path.join(app, 'olli-talk-beta.js');
const origin = 'https://olli-teamchat.test';
const message = (id, body, fields = {}) => ({
  id, body, sender_member_id: 'teacher', sender_name: '김선생', message_type: 'text',
  created_at: new Date(Date.UTC(2026, 10, 6, 9, id)).toISOString(),
  ...fields
});

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

async function openChat(t, messages = [], expectedDialogs = []) {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
    timezoneId: 'Asia/Seoul'
  });
  page.setDefaultTimeout(10000);
  const errors = [];
  const dialogs = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  t.after(async () => {
    try {
      assert.deepEqual(errors, []);
      assert.deepEqual(dialogs, expectedDialogs);
      assert.equal(await page.evaluate(() => window.fixture?.unexpectedRpc), undefined);
    } finally {
      await page.close();
    }
  });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === '/') {
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><div data-olli-work-badge hidden></div>'
      });
    }
    if (url.origin === origin && url.pathname === '/api/link-preview') {
      return route.fulfill({ json: { ok: true, title: '로컬 미리보기', description: '테스트 링크' } });
    }
    return route.abort();
  });
  await page.goto(origin);
  await page.evaluate(({ html, messages }) => {
    const documentSource = new DOMParser().parseFromString(html, 'text/html');
    for (const id of ['olliTalkBetaScreen', 'olliTalkArchiveScreen']) {
      document.body.append(document.importNode(documentSource.getElementById(id), true));
    }
    localStorage.setItem('olli_current_academy_id', 'academy');
    localStorage.setItem('olli_current_member_id', 'self');
    localStorage.setItem('olli_account_session_token_v1', 'local-test-token');
    window.fixture = {
      calls: [], pushes: [], archiveActions: [], watchers: [],
      messages, older: [], summary: { unread_count: 3, mention_unread_count: 2, material_unread_count: 1 }
    };
    window.OlliTalkPush = { dispatch: id => fixture.pushes.push(id) };
    window.OlliRealtime = {
      watchDomain: (domain, callback) => { fixture.watchers.push({ domain, callback }); return {}; }
    };
    window.OlliMobileTeamTalkMaterialOrders = {
      mount: async (element, options) => { fixture.archiveActions.push(['mount', options.localOnly]); },
      activate: async () => { fixture.archiveActions.push(['activate']); },
      destroy: () => { fixture.archiveActions.push(['destroy']); },
      openQuickOrder: () => { fixture.archiveActions.push(['quick-order']); return true; }
    };
    window.supabase = async (method, rpc, params) => {
      const name = rpc.slice('rpc/'.length);
      fixture.calls.push({ method, name, params });
      if (params.p_academy_id !== 'academy' || params.p_session_token !== 'local-test-token') {
        throw new Error('Unexpected fixture context for ' + name);
      }
      switch (name) {
        case 'olli_team_chat_members':
          return { ok: true, members: [
            { member_id: 'self', display_name: '나', is_current_member: true },
            { member_id: 'owner', display_name: '원장(A)+', role: 'owner' },
            { member_id: 'teacher', display_name: '김선생', role: 'teacher' }
          ] };
        case 'olli_team_chat_list':
          return {
            ok: true, academy_id: 'academy', current_member_id: 'self',
            messages: params.p_before_message_id ? fixture.older : fixture.messages.slice(-100)
          };
        case 'olli_team_chat_send': {
          const item = {
            id: 1000 + fixture.messages.length, body: params.p_body, created_at: '2026-11-06T12:00:00Z',
            sender_member_id: 'self', sender_name: '나', message_type: 'text'
          };
          fixture.messages.push(item);
          return { ok: true, message: item };
        }
        case 'olli_team_chat_send_ai': {
          if (fixture.rejectAssistantReply) return { ok: false, message: 'Synthetic reply save failure' };
          const item = {
            id: 1000 + fixture.messages.length, body: params.p_body, created_at: '2026-11-06T12:01:00Z',
            message_type: 'ai', reply_to_message_id: params.p_reply_to_message_id
          };
          fixture.messages.push(item);
          return { ok: true, message: item };
        }
        case 'olli_mobile_work_notification_summary':
          return { ok: true, ...fixture.summary };
        case 'olli_mobile_work_mark_material_read':
          fixture.summary.material_unread_count = 0;
          return { ok: true };
        case 'olli_team_chat_mark_read':
          fixture.summary.unread_count = 0;
          fixture.summary.mention_unread_count = 0;
          return { ok: true };
        case 'olli_team_chat_archive':
          return { ok: true, messages: [] };
        case 'olli_team_chat_set_mentions':
        case 'olli_academy_tasks_create_from_chat':
          return { ok: true };
        default:
          errorsForUnexpectedRpc(name);
      }
    };
    function errorsForUnexpectedRpc(name) {
      fixture.unexpectedRpc = name;
      throw new Error('Unexpected fixture RPC: ' + name);
    }
    const viewport = new EventTarget();
    Object.assign(viewport, { width: innerWidth, height: innerHeight, offsetLeft: 0, offsetTop: 0 });
    Object.defineProperty(window, 'visualViewport', { value: viewport });
    window.setChatViewportHeight = height => {
      viewport.height = height;
      viewport.dispatchEvent(new Event('resize'));
    };
  }, { html, messages });
  await page.addStyleTag({ content: 'body{margin:0}.pageScreen[aria-hidden="true"]{display:none}' + css });
  await page.addScriptTag({ path: path.join(app, 'olli-mobile-keyboard-activation.js') });
  await page.addScriptTag({ path: runtime });
  await page.waitForFunction(() => document.querySelector('[data-olli-work-badge]').textContent === '3');
  await page.evaluate(() => window.openOlliTalkBetaPage());
  await page.waitForFunction(() =>
    fixture.calls.some(call => call.name === 'olli_team_chat_mark_read') &&
    document.getElementById('olliTalkBetaMemberCount').textContent === '3'
  );
  return page;
}

async function expandComposer(page) {
  await page.locator('#olliTalkBetaInput').focus();
  await page.evaluate(() => window.setChatViewportHeight(530));
  await page.waitForFunction(() => document.getElementById('olliTalkBetaScreen').classList.contains('olliTalkKeyboardOpen'));
}

async function send(page, body, count) {
  await page.locator('#olliTalkBetaInput').fill(body);
  await page.getByRole('button', { name: '메시지 전송', exact: true }).click();
  await page.waitForFunction(count =>
    fixture.calls.filter(call => call.name === 'olli_team_chat_send').length === count &&
    !document.getElementById('olliTalkBetaSendBtn').classList.contains('sending'), count);
}

test('Mobile chat targets a selected teacher, assigns owner task bullets and broadcasts unaddressed messages', async t => {
  const page = await openChat(t, [message(1, '기존 대화')]);
  await expandComposer(page);
  await page.getByRole('button', { name: '선생님 멘션', exact: true }).click();
  const menu = page.locator('#olliTalkMentionMenu');
  await menu.getByRole('button', { name: '@원장(A)+', exact: true }).waitFor();
  assert.equal(await menu.getByRole('button', { name: '@나', exact: true }).count(), 0);
  await menu.getByRole('button', { name: '@원장(A)+', exact: true }).click();
  await send(page, '할 일\n- 교재 정리\n- 수업 준비', 1);
  // Cancel the persistent mention using its existing control before sending again.
  await page.getByRole('button', { name: '선생님 멘션 취소', exact: true }).click();
  await page.evaluate(() => window.setChatViewportHeight(844));
  await page.waitForFunction(() => !document.getElementById('olliTalkBetaScreen').classList.contains('olliTalkKeyboardOpen'));
  await expandComposer(page);
  await send(page, '전체 공지', 2);
  const { calls, pushes } = await page.evaluate(() => fixture);
  const sent = calls.filter(call => call.name === 'olli_team_chat_send');
  const recipients = calls.filter(call => call.name === 'olli_team_chat_set_mentions');
  const tasks = calls.filter(call => call.name === 'olli_academy_tasks_create_from_chat');
  assert.match(sent[0].params.p_body, /^@원장\(A\)\+/);
  assert.equal(sent[1].params.p_body, '전체 공지');
  assert.deepEqual(recipients.map(call => call.params.p_member_ids), [['owner'], []]);
  assert.deepEqual(recipients.map(call => call.params.p_message_id), pushes);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].params.p_assigned_to_member_id, 'owner');
  assert.equal(tasks[0].params.p_source_message_id, pushes[0]);
  assert.deepEqual(tasks[0].params.p_items, ['교재 정리', '수업 준비']);
});

async function useLocalScheduleRouter(page, rejectAssistantReply = false) {
  await page.evaluate(reject => {
    fixture.rejectAssistantReply = reject;
    fixture.queries = [];
    window.OlliCommandRouter = {
      classifyRequest: () => ({ type: 'query', intent: 'find_available_slots' }),
      interpretedIntentToStructuredCommand: (intent, text) => ({ action: intent, text }),
      runStructuredQuery: async command => {
        fixture.queries.push(command);
        return { handled: true, message: '합성 빈자리 조회 결과' };
      }
    };
  }, rejectAssistantReply);
}

test('Mobile chat sends an Olli mention through the academy query router and saves the linked reply', async t => {
  const page = await openChat(t);
  await useLocalScheduleRouter(page);
  await expandComposer(page);
  await page.getByRole('button', { name: '선생님 멘션', exact: true }).click();
  await page.getByRole('button', { name: '@올리 · AI', exact: true }).click();
  await send(page, '오늘 빈자리', 1);
  await page.getByText('합성 빈자리 조회 결과').waitFor();
  const { calls, queries, pushes } = await page.evaluate(() => fixture);
  const sent = calls.find(call => call.name === 'olli_team_chat_send');
  const reply = calls.find(call => call.name === 'olli_team_chat_send_ai');
  assert.equal(sent.params.p_body, '@올리 오늘 빈자리');
  assert.deepEqual(queries, [{ action: 'find_available_slots', text: '오늘 빈자리' }]);
  assert.equal(reply.params.p_reply_to_message_id, 1000);
  assert.equal(calls.some(call => call.name === 'olli_team_chat_set_mentions'), false);
  assert.deepEqual(pushes, []);
});

test('Mobile chat reports the failed Olli reply while preserving the already saved question', async t => {
  const page = await openChat(t, [], ['메시지는 전송됐지만 올리 응답에 실패했습니다.']);
  await useLocalScheduleRouter(page, true);
  await expandComposer(page);
  await send(page, '@올리 오늘 빈자리', 1);
  await page.getByText('@올리 오늘 빈자리', { exact: true }).waitFor();
  assert.equal(await page.locator('#olliTalkBetaInput').inputValue(), '');
  const { calls, messages } = await page.evaluate(() => fixture);
  assert.equal(calls.filter(call => call.name === 'olli_team_chat_send_ai').length, 1);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].body, '@올리 오늘 빈자리');
});

test('Mobile chat groups adjacent messages in the same clock minute and shows human unread counts', async t => {
  const at = time => '2026-11-06T09:' + time + 'Z';
  const page = await openChat(t, [
    message(1, '첫째', { created_at: at('10:45'), unread_count: 2 }),
    message(2, '둘째', { created_at: at('10:59'), unread_count: 1 }),
    message(3, '다음 분', { created_at: at('11:00') }),
    message(4, '내 메시지', { created_at: at('11:10'), sender_member_id: 'self', unread_count: 3 }),
    message(5, 'AI 메시지', { created_at: at('11:20'), message_type: 'ai', unread_count: 8 })
  ]);
  const groups = await page.locator('.olliTalkBetaMessageGroup').evaluateAll(items => items.map(group =>
    Array.from(group.querySelectorAll('[data-message-id]'), row => row.dataset.messageId)
  ));
  assert.deepEqual(groups, [['1', '2'], ['3'], ['4'], ['5']]);
  const first = page.locator('[data-message-id="1"] .olliTalkBetaBubble');
  const second = page.locator('[data-message-id="2"] .olliTalkBetaBubble');
  const firstBounds = await first.boundingBox();
  assert.ok((await second.boundingBox()).y > firstBounds.y + firstBounds.height);
  assert.notEqual(await first.evaluate(bubble => getComputedStyle(bubble, '::before').content), 'none');
  assert.equal(await second.evaluate(bubble => getComputedStyle(bubble, '::before').content), 'none');
  assert.equal(await page.locator('[data-message-id="1"] .olliTalkBetaMessageTime').getAttribute('aria-hidden'), 'true');
  assert.equal(await page.locator('[data-message-id="2"] .olliTalkBetaMessageTime').getAttribute('aria-hidden'), null);
  assert.deepEqual(await page.locator('.olliTalkBetaUnreadCount').allTextContents(), ['2', '1', '3']);
  const read = await page.evaluate(() => fixture.calls.find(call => call.name === 'olli_team_chat_mark_read'));
  assert.equal(read.params.p_up_to_message_id, 5);
  await page.waitForFunction(() => document.querySelector('[data-olli-work-badge]').hidden);
  assert.equal(await page.locator('[data-olli-work-hub-badge]').textContent(), '1');
});

test('Mobile chat renders a safe link preview in the message and keeps plain markup as text', async t => {
  const url = 'https://example.test/lesson';
  const page = await openChat(t, [
    message(1, '자료 ' + url),
    message(2, '<img src=x onerror=alert(1)> javascript:alert(1)')
  ]);
  const preview = page.locator('[data-message-id="1"]').getByRole('link');
  await preview.getByText('로컬 미리보기').waitFor();
  assert.equal(await preview.getAttribute('href'), url);
  assert.equal(await preview.getAttribute('target'), '_blank');
  assert.equal(await preview.getAttribute('rel'), 'noopener noreferrer');
  assert.match(await page.locator('[data-message-id="1"]').textContent(), /자료/);
  assert.equal(await page.locator('[data-message-id="2"] a, [data-message-id="2"] img').count(), 0);
  assert.match(await page.locator('[data-message-id="2"]').textContent(), /<img src=x/);
});

test('Mobile chat refresh keeps the reading position and follows new messages only near the bottom', async t => {
  const page = await openChat(t, Array.from({ length: 35 }, (_, index) => message(index + 1, '메시지 ' + (index + 1))));
  const readPosition = await page.evaluate(async () => {
    const chat = document.getElementById('olliTalkBetaChatArea');
    chat.scrollTop = 170;
    const previous = chat.scrollTop;
    const item = { ...fixture.messages.at(-1), id: 36, body: '새 대화', created_at: '2026-11-06T10:30:00Z' };
    fixture.messages.push(item);
    await fixture.watchers[0].callback({ isCurrent: () => true });
    return { previous, current: chat.scrollTop };
  });
  assert.equal(readPosition.previous, 170);
  assert.equal(readPosition.current, readPosition.previous);
  await page.locator('[data-message-id="36"]').waitFor();
  await page.evaluate(async () => {
    const chat = document.getElementById('olliTalkBetaChatArea');
    chat.scrollTop = chat.scrollHeight;
    fixture.messages.push({ ...fixture.messages.at(-1), id: 37, body: '최신 대화', created_at: '2026-11-06T10:31:00Z' });
    await fixture.watchers[0].callback({ isCurrent: () => true });
  });
  await page.waitForFunction(() => {
    const chat = document.getElementById('olliTalkBetaChatArea');
    return !!chat.querySelector('[data-message-id="37"]') && chat.scrollHeight - chat.clientHeight - chat.scrollTop < 2;
  });
});

test('Mobile chat keeps the header fixed while the composer follows a simulated keyboard', async t => {
  const page = await openChat(t, [message(1, '채팅')]);
  const header = page.locator('.olliTalkBetaHeader');
  const composer = page.locator('.olliTalkBetaComposer');
  const initialHeader = await header.boundingBox();
  const initialComposer = await composer.boundingBox();
  await expandComposer(page);
  await page.waitForFunction(() => document.querySelector('.olliTalkBetaComposer').getBoundingClientRect().bottom <= 530);
  const expanded = await composer.boundingBox();
  assert.ok(expanded.y < initialComposer.y - 200);
  assert.ok(expanded.height > initialComposer.height);
  assert.equal((await header.boundingBox()).y, initialHeader.y);
  assert.equal(await page.locator('#olliTalkBetaInput').evaluate(input => input === document.activeElement), true);
  await page.locator('#olliTalkBetaInput').blur();
  await page.evaluate(() => window.setChatViewportHeight(620));
  await page.waitForFunction(() =>
    document.getElementById('olliTalkBetaComposerLayer').style.getPropertyValue('--olli-talk-composer-vv-height') === '620px'
  );
  assert.equal(await page.locator('#olliTalkBetaScreen').evaluate(screen => screen.classList.contains('olliTalkKeyboardOpen')), true);
  await page.evaluate(() => window.setChatViewportHeight(844));
  await page.waitForFunction(() => !document.getElementById('olliTalkBetaScreen').classList.contains('olliTalkKeyboardOpen'));
});

test('Mobile chat keeps the viewport pan on the composer and preserves the current chat scroll', async t => {
  const page = await openChat(t, Array.from({ length: 35 }, (_, index) => message(index + 1, '대화 ' + index)));
  await expandComposer(page);
  const layoutBefore = await page.evaluate(() => {
    const chat = document.getElementById('olliTalkBetaChatArea');
    chat.scrollTop = 170;
    return { top: chat.getBoundingClientRect().top, scrollTop: chat.scrollTop };
  });
  await page.evaluate(() => {
    window.visualViewport.offsetTop = 28;
    window.visualViewport.dispatchEvent(new Event('scroll'));
  });
  await page.waitForFunction(() =>
    document.getElementById('olliTalkBetaComposerLayer').style.getPropertyValue('--olli-talk-composer-vv-top') === '28px'
  );
  const layoutAfter = await page.locator('#olliTalkBetaChatArea').evaluate(chat =>
    ({ top: chat.getBoundingClientRect().top, scrollTop: chat.scrollTop })
  );
  assert.equal(layoutBefore.scrollTop, 170);
  assert.deepEqual(layoutAfter, layoutBefore);
  await page.evaluate(async () => {
    const chat = document.getElementById('olliTalkBetaChatArea');
    chat.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    window.visualViewport.offsetTop = 48;
    window.visualViewport.dispatchEvent(new Event('scroll'));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const layer = page.locator('#olliTalkBetaComposerLayer');
  assert.equal(await layer.evaluate(element => element.style.getPropertyValue('--olli-talk-composer-vv-top')), '28px');
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup')));
  await page.waitForFunction(() =>
    document.getElementById('olliTalkBetaComposerLayer').style.getPropertyValue('--olli-talk-composer-vv-top') === '48px'
  );
});

test('Mobile chat applies the selected light and dark control theme without blocking chat input', async t => {
  const page = await openChat(t);
  const screen = page.locator('#olliTalkBetaScreen');
  const control = page.getByRole('button', { name: 'Work Hub', exact: true });
  const setColor = color => page.evaluate(color => window.setOlliTalkBackgroundColor(color), color);
  assert.equal(await setColor('#ffffff'), 'light');
  assert.equal(await screen.getAttribute('data-olli-talk-control-theme'), 'light');
  const lightGlass = await control.evaluate(button => getComputedStyle(button).getPropertyValue('--olli-phone-glass-bg'));
  assert.equal(await setColor('#101820'), 'dark');
  assert.equal(await screen.getAttribute('data-olli-talk-control-theme'), 'dark');
  assert.notEqual(await control.evaluate(button => getComputedStyle(button).getPropertyValue('--olli-phone-glass-bg')), lightGlass);
  assert.equal(await screen.locator('.olliTalkBetaTitle').textContent(), 'Team Chat');
  for (const side of ['Top', 'Bottom']) {
    const overlay = screen.locator('.olliTalkBetaEdgeBlur' + side);
    assert.equal(await overlay.getAttribute('aria-hidden'), 'true');
    assert.equal(await overlay.evaluate(element => getComputedStyle(element).pointerEvents), 'none');
  }
  await expandComposer(page);
  await page.locator('#olliTalkBetaInput').fill('테마 전환 뒤 입력');
  await page.getByRole('button', { name: '메시지 전송', exact: true }).waitFor();
});

test('Mobile chat composer classifies image and video as media and finalizes only after signed upload', async t => {
  const page = await openChat(t);
  const calls = [];
  await page.route(origin + '/api/team-talk-file', route => {
    const request = route.request();
    const body = request.postDataJSON();
    assert.equal(request.headers()['x-olli-academy-id'], 'academy');
    assert.equal(request.headers()['x-olli-session-token'], 'local-test-token');
    calls.push([body.action, body.fileName, body.kind]);
    if (body.action === 'prepare') {
      return route.fulfill({ json: {
        ok: true, objectPath: body.fileName, uploadUrl: origin + '/signed/' + body.fileName
      } });
    }
    assert.equal(body.action, 'finalize');
    assert.equal(body.objectPath, body.fileName);
    return route.fulfill({ json: { ok: true } });
  });
  await page.route(origin + '/signed/*', route => {
    const request = route.request();
    assert.equal(request.method(), 'PUT');
    assert.equal(request.headers()['x-upsert'], 'false');
    calls.push(['upload', new URL(request.url()).pathname.split('/').at(-1)]);
    return route.fulfill({ status: 200, body: '' });
  });
  await page.locator('#olliTalkComposerFileInput').setInputFiles([
    { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('fixture image') },
    { name: 'video.mp4', mimeType: 'video/mp4', buffer: Buffer.from('fixture video') },
    { name: 'recipe.pdf', mimeType: 'application/pdf', buffer: Buffer.from('fixture PDF') }
  ]);
  await page.waitForFunction(() => fixture.calls.some(call => call.name === 'olli_team_chat_archive'));
  assert.deepEqual(calls, [
    ['prepare', 'photo.png', 'media'], ['upload', 'photo.png'], ['finalize', 'photo.png', 'media'],
    ['prepare', 'video.mp4', 'media'], ['upload', 'video.mp4'], ['finalize', 'video.mp4', 'media'],
    ['prepare', 'recipe.pdf', 'file'], ['upload', 'recipe.pdf'], ['finalize', 'recipe.pdf', 'file']
  ]);
});

test('Mobile chat opens Work Hub and releases material orders when switching to recipe files', async t => {
  const page = await openChat(t, [message(1, '채팅')]);
  await page.getByRole('button', { name: 'Work Hub', exact: true }).click();
  const hub = page.locator('#olliTalkArchiveScreen');
  await hub.getByRole('tab', { name: '커피주문', selected: true }).waitFor();
  await page.waitForFunction(() => fixture.archiveActions.some(([action]) => action === 'activate'));
  await hub.getByRole('tab', { name: '커피 레시피' }).click();
  assert.equal(await hub.getByRole('tab', { name: '커피 레시피' }).getAttribute('aria-selected'), 'true');
  await hub.getByRole('button', { name: '레시피 파일 올리기' }).waitFor();
  await hub.getByRole('tab', { name: '포토리뷰' }).click();
  assert.equal(await hub.getByRole('button', { name: '레시피 파일 올리기' }).count(), 0);
  assert.deepEqual(await page.evaluate(() => fixture.archiveActions.slice(0, 3)), [['mount', true], ['activate'], ['destroy']]);
  assert.equal(await page.locator('#olliTalkBetaScreen').getAttribute('aria-hidden'), 'true');
});
