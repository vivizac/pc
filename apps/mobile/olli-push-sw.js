self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload = {};
    try {
      payload = event.data ? event.data.json() : {};
    } catch (_) {
      try { payload = { body: event.data ? event.data.text() : '' }; } catch (_) {}
    }

    const title = String(payload.title || '올리톡');
    const body = String(payload.body || '');
    const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
    const tag = String(payload.tag || ('olli-talk-' + (data.messageId || Date.now())));
    const badgeCount = Math.max(0, Number(data.badgeCount || 0));

    if (badgeCount > 0 && typeof self.navigator?.setAppBadge === 'function') {
      try { await self.navigator.setAppBadge(badgeCount); } catch (_) {}
    }

    await self.registration.showNotification(title, {
      body,
      tag,
      renotify: true,
      silent: false,
      icon: './icon.png',
      badge: './icon.png',
      data,
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const data = event.notification.data && typeof event.notification.data === 'object'
      ? event.notification.data
      : {};
    const targetUrl = String(data.url || './?olliTalk=1');

    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      try {
        await client.focus();
        client.postMessage(data.type === 'olli-material-request'
          ? {
              type: 'OLLI_WORK_OPEN_MATERIALS',
              requestId: data.requestId || null,
            }
          : {
              type: 'OLLI_TALK_OPEN_FROM_NOTIFICATION',
              messageId: data.messageId || null,
            });
        return;
      } catch (_) {}
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
