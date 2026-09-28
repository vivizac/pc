(function pcStudentClassRoutingMakeupBridge(global){
  'use strict';
  if (global.__OLLI_PC_CLASS_ROUTING_MAKEUP_BRIDGE_V1__) return;
  global.__OLLI_PC_CLASS_ROUTING_MAKEUP_BRIDGE_V1__ = true;

  function clean(value){ return String(value == null ? '' : value).trim(); }
  function makeupMode(dialog){
    if (!dialog || !dialog.classList.contains('olliTtMoveDialog')) return false;
    const activeMode = dialog.querySelector('.olliTtModeCard.simple.active [data-tt-action-type="makeup"]');
    if (activeMode) return true;
    const primary = dialog.querySelector('[data-tt-save-move]');
    return clean(primary && primary.textContent).includes('보강');
  }
  function weekdayFromDate(value){
    const m = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return 0;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.getDay();
  }
  function apply(){
    const dialog = document.getElementById('olliTtDialog');
    if (!dialog) return;
    const old = dialog.querySelector('[data-olli-makeup-day-bridge]');
    if (!makeupMode(dialog)) { if (old) old.remove(); return; }
    if (dialog.querySelector('[data-tt-target-day].active:not([data-olli-makeup-day-bridge])')) { if (old) old.remove(); return; }
    const dateInput = dialog.querySelector('[data-tt-effective-date]');
    const weekday = weekdayFromDate(dateInput && dateInput.value);
    if (!weekday || weekday > 6) { if (old) old.remove(); return; }
    const bridge = old || document.createElement('button');
    bridge.type = 'button';
    bridge.hidden = true;
    bridge.className = 'active';
    bridge.dataset.ttTargetDay = String(weekday);
    bridge.dataset.olliMakeupDayBridge = '1';
    if (!old) dialog.appendChild(bridge);
  }

  let timer = 0;
  function queue(){ clearTimeout(timer); timer = setTimeout(apply, 0); }
  const observer = new MutationObserver(queue);
  observer.observe(document.body, { childList:true, subtree:true });
  document.addEventListener('change', (event) => {
    if (event.target && event.target.matches('#olliTtDialog [data-tt-effective-date]')) queue();
  }, true);
  document.addEventListener('click', (event) => {
    if (event.target.closest('#olliTtDialog [data-tt-action-type]')) queue();
  }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', queue, { once:true });
  else queue();
})(window);
