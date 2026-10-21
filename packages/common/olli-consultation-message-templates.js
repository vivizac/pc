(function(root,factory){
  const value=factory();
  if(typeof module!=='undefined' && module.exports)module.exports=value;
  else root.OlliConsultationMessageTemplates=value;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const divisions=[{key:'elementary',label:'초등부'},{key:'kinder',label:'유치부'}];
  const stages=[{key:'after_1',label:'1개월',months:1},{key:'every_6',label:'6개월',months:6},{key:'every_12',label:'12개월',months:12},{key:'after_3',label:'3개월',months:3,optional:true}];
  const slots=divisions.flatMap(division=>stages.map(stage=>({key:division.key+':'+stage.key,division:division.key,ruleKey:stage.key,label:division.label+' · '+stage.label,optional:!!stage.optional})));
  function select(settings,student,tasks){
    if(!Array.isArray(tasks)||!tasks.length)throw new Error('CONSULTATION_TASK_REQUIRED');
    // One notice per due month. The latest month wins; annual consultation wins a 6/12 overlap.
    const task=tasks.slice().sort((a,b)=>String(b.dueMonth).localeCompare(String(a.dueMonth)) || (Number(b.occurrenceMonths)||0)-(Number(a.occurrenceMonths)||0) || (stages.find(s=>s.key===b.ruleKey)?.months||0)-(stages.find(s=>s.key===a.ruleKey)?.months||0))[0];
    const division=(student.division||student.type)==='kinder'?'kinder':'elementary';
    const key=division+':'+task.ruleKey;
    const custom=settings.template_variants?.[key];
    if(settings.template_mode==='by_type' && custom?.use_common===false){
      return {scope:key,task,template_id:custom.template_id,template_body:custom.template_body,template_confirmed:custom.template_confirmed};
    }
    return {scope:'common',task,template_id:settings.template_id,template_body:settings.template_body,template_confirmed:settings.template_confirmed};
  }
  return Object.freeze({slots,select});
});
