
(function(){
  function updateVivizacMemoViewportVars(){
    var root = document.documentElement;
    var vv = window.visualViewport;
    var topOffset = 0;
    var bottomOffset = 0;
    if (vv) {
      topOffset = Math.max(0, vv.offsetTop || 0);
      bottomOffset = Math.max(0, (window.innerHeight || document.documentElement.clientHeight || 0) - vv.height - topOffset);
    }
    root.style.setProperty('--vivizac-vv-offset-top', topOffset + 'px');
    root.style.setProperty('--vivizac-vv-bottom', bottomOffset + 'px');
  }

  function reviveStudentMemoControlsForIpad(){
    var screen = document.getElementById('studentMemoScreen');
    if (!screen || getComputedStyle(screen).display === 'none') return;
    updateVivizacMemoViewportVars();
    [
      'memoRecordRoomBtn',
      'memoStudentListBtn',
      'memoBottomAnalysisBtn',
      'memoFeedbackBtn'
    ].forEach(function(id){
      var el = document.getElementById(id);
      if (!el) return;
      el.hidden = false;
      el.removeAttribute('hidden');
      el.removeAttribute('aria-hidden');
      el.style.visibility = 'visible';
      el.style.opacity = '1';
      el.style.pointerEvents = 'auto';
      el.style.display = 'inline-flex';
    });
    ['.memoHeaderActions', '.memoBottomBar', '#memoModeWrap'].forEach(function(sel){
      var el = document.querySelector('#studentMemoScreen ' + sel);
      if (!el) return;
      el.hidden = false;
      el.removeAttribute('hidden');
      el.removeAttribute('aria-hidden');
      el.style.visibility = 'visible';
      el.style.opacity = '1';
    });
  }

  window.updateVivizacMemoViewportVars = updateVivizacMemoViewportVars;
  window.reviveStudentMemoControlsForIpad = reviveStudentMemoControlsForIpad;

  ['resize', 'orientationchange', 'pageshow'].forEach(function(name){
    window.addEventListener(name, function(){
      updateVivizacMemoViewportVars();
      setTimeout(reviveStudentMemoControlsForIpad, 60);
    });
  });
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', function(){
      updateVivizacMemoViewportVars();
      setTimeout(reviveStudentMemoControlsForIpad, 60);
    });
    visualViewport.addEventListener('scroll', function(){
      updateVivizacMemoViewportVars();
      setTimeout(reviveStudentMemoControlsForIpad, 60);
    });
  }
  document.addEventListener('DOMContentLoaded', function(){
    updateVivizacMemoViewportVars();
    setTimeout(reviveStudentMemoControlsForIpad, 120);
  });
})();
