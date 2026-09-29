
(function(){
  function getPhoneLocalDateKey(value){
    var date = value ? new Date(value) : new Date();
    var safe = Number.isNaN(date.getTime()) ? new Date() : date;
    var year = safe.getFullYear();
    var month = String(safe.getMonth() + 1).padStart(2, '0');
    var day = String(safe.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function pruneStalePhoneKcfLiveSessions(){
    var prefix = 'olli_kcf_live_session_v1_';
    var today = getPhoneLocalDateKey();
    try {
      var staleKeys = [];
      for (var index = 0; index < localStorage.length; index += 1) {
        var key = String(localStorage.key(index) || '');
        if (key.indexOf(prefix) !== 0) continue;
        try {
          var raw = localStorage.getItem(key);
          if (!raw) continue;
          var session = JSON.parse(raw);
          var sessionDateKey = String(session && session.dateKey || '').trim();
          if (!sessionDateKey) {
            var rawDate = session && (session.updatedAt || session.createdAt) || '';
            if (rawDate) sessionDateKey = getPhoneLocalDateKey(rawDate);
          }
          if (sessionDateKey && sessionDateKey !== today) staleKeys.push(key);
        } catch (err) {
          staleKeys.push(key);
        }
      }
      staleKeys.forEach(function(key){ localStorage.removeItem(key); });
    } catch (err) {}
  }

  function ensurePhoneKcfHeaderStyles(){
    try {
      if (document.querySelector('link[data-olli-kcf-header-phone]')) return;
      var styleLink = document.createElement('link');
      styleLink.rel = 'stylesheet';
      styleLink.href = 'olli-kcf-header-phone.css?v=20260917-header-actions-2';
      styleLink.setAttribute('data-olli-kcf-header-phone', 'true');
      document.head.appendChild(styleLink);
    } catch (err) {}
  }

  function ensurePhoneKcfDailyChatReset(){
    try {
      if (document.querySelector('script[data-olli-kcf-daily-chat-reset]')) return;
      var script = document.createElement('script');
      script.src = 'olli-kcf-daily-chat-reset.js?v=20260917-daily-chat-1';
      script.defer = true;
      script.setAttribute('data-olli-kcf-daily-chat-reset', 'true');
      document.head.appendChild(script);
    } catch (err) {}
  }

  function ensurePhoneKcfComposerSheet(){
    try {
      if (!document.querySelector('link[data-olli-kcf-composer-sheet]')) {
        var styleLink = document.createElement('link');
        styleLink.rel = 'stylesheet';
        styleLink.href = 'olli-kcf-composer-sheet.css?v=20260917-dedicated-sheet-6';
        styleLink.setAttribute('data-olli-kcf-composer-sheet', 'true');
        document.head.appendChild(styleLink);
      }
      if (!document.querySelector('script[data-olli-kcf-composer-sheet]')) {
        var script = document.createElement('script');
        script.src = 'olli-kcf-composer-sheet.js?v=20260917-dedicated-sheet-5';
        script.defer = true;
        script.setAttribute('data-olli-kcf-composer-sheet', 'true');
        document.head.appendChild(script);
      }
    } catch (err) {}
  }

  function requestPortraitOrientation(){
    try {
      var orientation = window.screen && window.screen.orientation;
      if (!orientation || typeof orientation.lock !== 'function') return;
      var result = orientation.lock('portrait');
      if (result && typeof result.catch === 'function') result.catch(function(){});
    } catch (err) {}
  }

  function bindPortraitOrientation(){
    requestPortraitOrientation();
    window.addEventListener('orientationchange', requestPortraitOrientation);
    document.addEventListener('visibilitychange', function(){
      if (!document.hidden) requestPortraitOrientation();
    });
  }

  function bootPhoneHeadAssets(){
    /* Append Phone-only KCF assets after the document styles have been parsed. */
    ensurePhoneKcfHeaderStyles();
    ensurePhoneKcfDailyChatReset();
    ensurePhoneKcfComposerSheet();
    bindPortraitOrientation();
  }

  /* Remove yesterday's temporary LIVE session before KCF restore runs. */
  pruneStalePhoneKcfLiveSessions();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootPhoneHeadAssets, { once:true });
  } else {
    bootPhoneHeadAssets();
  }

  try {
    if (document.querySelector('link[rel="manifest"]')) return;
    var cleanPath = String(window.location.pathname || '/');
    var scopePath = cleanPath.replace(/[^\/]*$/, '');
    if (!scopePath) scopePath = '/';
    var manifest = {
      name: '올리',
      short_name: '올리',
      start_url: cleanPath,
      scope: scopePath,
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#ffffff',
      theme_color: '#ffffff',
      icons: [
        { src: 'icon.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon.png', sizes: '512x512', type: 'image/png' }
      ]
    };
    var link = document.createElement('link');
    link.rel = 'manifest';
    link.href = 'data:application/manifest+json;charset=utf-8,' + encodeURIComponent(JSON.stringify(manifest));
    document.head.appendChild(link);
  } catch (err) {
    console.warn('PWA manifest setup skipped:', err);
  }
})();
