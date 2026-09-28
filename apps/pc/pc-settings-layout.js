(function(){
'use strict';

if(!document.body || !document.body.classList.contains('olliPcApp')) return;

let previousPcSection='academy';
let restoringPreviousSection=false;

function isSettingsMode(){
  return document.body.classList.contains('pcSettingsOpen');
}

function currentPcSection(){
  const shell=document.getElementById('olliPcShell');
  return String(shell?.dataset?.pcSection||previousPcSection||'academy');
}

function placeSettingsScreen(element,zIndex){
  if(!element) return;
  element.style.position='fixed';
  element.style.inset='auto';
  element.style.left='var(--pc-sidebar-w)';
  element.style.top='var(--pc-topbar-h)';
  element.style.right='0';
  element.style.bottom='0';
  element.style.width='auto';
  element.style.height='auto';
  element.style.maxWidth='none';
  element.style.transform='translateX(0)';
  element.style.opacity='1';
  element.style.pointerEvents='auto';
  element.style.zIndex=String(zIndex);
}

function showPcSettingsChrome(){
  const body=document.body;
  const shell=document.getElementById('olliPcShell');
  const topbar=document.getElementById('olliPcTopbar');
  const title=document.getElementById('olliPcTopbarTitle');
  const search=document.getElementById('olliPcSearch');
  const archive=document.getElementById('olliPcTopArchiveBtn');
  const sortBtn=document.getElementById('olliPcSortBtn');
  const settingsBtn=document.getElementById('olliPcSettingsBtn');

  body.classList.add('pcSettingsOpen');
  shell?.classList.add('visible');
  topbar?.classList.add('visible');
  if(title) title.textContent='설정';
  if(search) search.style.display='none';
  archive?.classList.remove('show');
  if(sortBtn) sortBtn.style.visibility='hidden';
  settingsBtn?.classList.add('pcSettingsActive');

  document.querySelectorAll('[data-pc-nav]').forEach(btn=>btn.classList.remove('active'));
  placeSettingsScreen(document.getElementById('settingsPageScreen'),84000);
  placeSettingsScreen(document.getElementById('settingsDetailScreen'),84100);
}

function leavePcSettingsChrome(){
  document.body.classList.remove('pcSettingsOpen');
  document.getElementById('olliPcSettingsBtn')?.classList.remove('pcSettingsActive');
}

function hideSettingsScreens(){
  const settings=document.getElementById('settingsPageScreen');
  const detail=document.getElementById('settingsDetailScreen');
  if(settings) settings.style.display='none';
  if(detail) detail.style.display='none';
}

function restorePreviousPcSection(){
  if(restoringPreviousSection) return;
  if(typeof window.pcOpenSection==='function'){
    restoringPreviousSection=true;
    Promise.resolve(window.pcOpenSection(previousPcSection)).catch(()=>{}).finally(()=>{ restoringPreviousSection=false; });
    return;
  }
  const shell=document.getElementById('olliPcShell');
  const topbar=document.getElementById('olliPcTopbar');
  shell?.classList.add('visible');
  topbar?.classList.add('visible');
}

function applyDetailLayout(){
  if(!isSettingsMode()) return;
  showPcSettingsChrome();
  placeSettingsScreen(document.getElementById('settingsPageScreen'),84000);
  placeSettingsScreen(document.getElementById('settingsDetailScreen'),84100);
}

window.olliPcSettingsLayoutBeforeOpenPage=function(){
  previousPcSection=currentPcSection();
};

window.olliPcSettingsLayoutAfterOpenPage=function(){
  showPcSettingsChrome();
  const settings=document.getElementById('settingsPageScreen');
  if(settings) settings.style.display='flex';
  requestAnimationFrame(showPcSettingsChrome);
};

window.olliPcSettingsLayoutAfterClosePage=function(){
  leavePcSettingsChrome();
  hideSettingsScreens();
  restorePreviousPcSection();
};

window.olliPcSettingsLayoutBeforeOpenDetail=function(){
  showPcSettingsChrome();
};

window.olliPcSettingsLayoutAfterOpenDetail=function(){
  requestAnimationFrame(applyDetailLayout);
};

window.olliPcSettingsLayoutAfterCloseDetail=function(){
  showPcSettingsChrome();
  const settings=document.getElementById('settingsPageScreen');
  if(settings) settings.style.display='flex';
};

window.olliPcSettingsLayoutBeforeOpenSection=function(){
  if(!isSettingsMode()) return;
  leavePcSettingsChrome();
  hideSettingsScreens();
};

function keepChromeVisible(){
  if(isSettingsMode()) requestAnimationFrame(showPcSettingsChrome);
}
window.addEventListener('focus',keepChromeVisible);
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible') keepChromeVisible();
});
})();
