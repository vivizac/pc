(function(){
'use strict';
const base=(document.currentScript&&document.currentScript.src)?document.currentScript.src:location.href;
for(const file of ['consultation-final-analysis.css','consultation-result-sheet.css','pc-settings-layout.css']){
  const style=document.createElement('link');
  style.rel='stylesheet';
  style.href=new URL(file,base).toString();
  document.head.appendChild(style);
}
const files=['pc-timetable-teacher-ui.js','pc-student-class-routing.js','pc-student-class-routing-makeup-bridge.js','pc-student-info-schedule-readonly.js','pc-settings-layout.js','consultation-analysis.js','consultation-observation.js','consultation-final-analysis.js','consultation-result-library-st.js','consultation-result-library-gm.js','consultation-result-sheet.js','consultation-survey-core.js','consultation-survey-token-link.js','consultation-observation-ui.js','consultation-final-analysis-ui.js','consultation-result-sheet-ui.js'];
function load(index){
  if(index>=files.length)return;
  const script=document.createElement('script');
  script.src=new URL(files[index],base).toString();
  script.async=false;
  script.onload=()=>load(index+1);
  script.onerror=()=>console.error('[OLLI module] load failed:',files[index]);
  document.head.appendChild(script);
}
load(0);
})();