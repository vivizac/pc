(function(){
'use strict';
const base=(document.currentScript&&document.currentScript.src)?document.currentScript.src:location.href;
const files=['consultation-analysis.js','consultation-observation.js','consultation-survey-core.js','consultation-observation-ui.js'];
function load(index){
  if(index>=files.length)return;
  const script=document.createElement('script');
  script.src=new URL(files[index],base).toString();
  script.async=false;
  script.onload=()=>load(index+1);
  script.onerror=()=>console.error('[OLLI consultation] load failed:',files[index]);
  document.head.appendChild(script);
}
load(0);
})();
