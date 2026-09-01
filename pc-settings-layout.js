(function(){
'use strict';

if(!document.body || !document.body.classList.contains('olliPcApp')) return;

const originalOpenSettingsPage=window.openSettingsPage;
const originalCloseSettingsPage=window.closeSettingsPage;
const originalOpenSettingsDetail=window.openSettingsDetail;
const originalCloseSettingsDetail=window.closeSettingsDetail;
const originalPcOpenSection=window.pcOpenSection;
let previousPcSection='academy';

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
  if(typeof originalPcOpenSection==='function'){
    Promise.resolve(originalPcOpenSection(previousPcSection)).catch(()=>{});
    return;
  }
  const shell=document.getElementById('olliPcShell');
  const topbar=document.getElementById('olliPcTopbar');
  shell?.classList.add('visible');
  topbar?.classList.add('visible');
}

function pcOpenSettingsPage(){
  previousPcSection=currentPcSection();
  let result;
  if(typeof originalOpenSettingsPage==='function') result=originalOpenSettingsPage.apply(this,arguments);
  showPcSettingsChrome();
  const settings=document.getElementById('settingsPageScreen');
  if(settings) settings.style.display='flex';
  requestAnimationFrame(showPcSettingsChrome);
  return result;
}

function pcCloseSettingsPage(){
  let result;
  if(typeof originalCloseSettingsPage==='function') result=originalCloseSettingsPage.apply(this,arguments);
  leavePcSettingsChrome();
  hideSettingsScreens();
  restorePreviousPcSection();
  return result;
}

function pcOpenSettingsDetail(type){
  showPcSettingsChrome();
  let result;
  if(typeof originalOpenSettingsDetail==='function') result=originalOpenSettingsDetail.apply(this,arguments);
  const applyLayout=()=>{
    if(!isSettingsMode()) return;
    showPcSettingsChrome();
    placeSettingsScreen(document.getElementById('settingsPageScreen'),84000);
    placeSettingsScreen(document.getElementById('settingsDetailScreen'),84100);
  };
  requestAnimationFrame(applyLayout);
  if(result && typeof result.finally==='function') result.finally(applyLayout);
  return result;
}

function pcCloseSettingsDetail(){
  let result;
  if(typeof originalCloseSettingsDetail==='function') result=originalCloseSettingsDetail.apply(this,arguments);
  showPcSettingsChrome();
  const settings=document.getElementById('settingsPageScreen');
  if(settings) settings.style.display='flex';
  return result;
}

function pcOpenSectionFromSettings(section){
  if(isSettingsMode()){
    leavePcSettingsChrome();
    if(typeof originalCloseSettingsPage==='function') originalCloseSettingsPage();
    hideSettingsScreens();
  }
  if(typeof originalPcOpenSection==='function') return originalPcOpenSection.apply(this,arguments);
}

window.openSettingsPage=pcOpenSettingsPage;
window.closeSettingsPage=pcCloseSettingsPage;
window.openSettingsDetail=pcOpenSettingsDetail;
window.closeSettingsDetail=pcCloseSettingsDetail;
window.pcOpenSection=pcOpenSectionFromSettings;

try{openSettingsPage=pcOpenSettingsPage;}catch(_){}
try{closeSettingsPage=pcCloseSettingsPage;}catch(_){}
try{openSettingsDetail=pcOpenSettingsDetail;}catch(_){}
try{closeSettingsDetail=pcCloseSettingsDetail;}catch(_){}
try{pcOpenSection=pcOpenSectionFromSettings;}catch(_){}

function keepChromeVisible(){
  if(isSettingsMode()) requestAnimationFrame(showPcSettingsChrome);
}
window.addEventListener('focus',keepChromeVisible);
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible') keepChromeVisible();
});
})();
