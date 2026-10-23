(function(global){
  'use strict';
  let overlay=null;
  function elm(tag,attrs={},text){
    const el=document.createElement(tag);
    for(const [key,value] of Object.entries(attrs)) {
      if(key==='className')el.className=value;
      else el.setAttribute(key,value);
    }
    if(text!==undefined)el.textContent=text;
    return el;
  }
  function close(){if(overlay){overlay.remove();overlay=null;}}
  function open({studentId,studentName,months,taskKey,content}){
    close();
    overlay=elm('div',{className:'olliSummaryServerOverlay',role:'dialog','aria-modal':'true'});
    const panel=elm('section',{className:'olliSummaryServerPanel'});
    const title=elm('h3',{},String(studentName||'학생')+' · '+Number(months)+'개월 종합 피드백');
    const hint=elm('p',{className:'olliSummaryServerHint'},'서버에 저장된 종합 피드백입니다. 수정 저장하면 PC와 모바일에 같은 내용이 반영됩니다.');
    const area=elm('textarea',{className:'olliSummaryServerText',readonly:'readonly','aria-label':'종합 피드백 내용'});
    area.value=String(content||'');
    const actions=elm('div',{className:'olliSummaryServerActions'});
    const edit=elm('button',{type:'button'},'수정');
    const save=elm('button',{type:'button'},'수정 저장');save.disabled=true;
    const dismiss=elm('button',{type:'button'},'닫기');
    edit.addEventListener('click',()=>{
      area.removeAttribute('readonly');save.disabled=false;area.focus();
    });
    save.addEventListener('click',async()=>{
      const value=area.value.trim();
      if(value.length<10){alert('수정할 내용을 확인해 주세요.');return;}
      save.disabled=true;edit.disabled=true;
      save.textContent='저장중...';
      try{
        const response=await global.OlliConsultationServer.reviseManualSummary(studentId,taskKey,value);
        if(response.status!=='ready')throw new Error('서버가 저장을 완료하지 못했습니다.');
        area.value=String(response.content||value);
        area.setAttribute('readonly','readonly');
        if(typeof global.refreshRecordsAfterFeedbackSave==='function'){
          await global.refreshRecordsAfterFeedbackSave();
        }
        alert('종합 피드백 수정 내용을 서버에 저장했습니다.');
      }catch(error){save.disabled=false;alert('수정 저장 실패: '+(error.message||error));}
      finally{save.textContent='수정 저장';edit.disabled=false;}
    });
    dismiss.addEventListener('click',close);
    overlay.addEventListener('click',event=>{if(event.target===overlay)close();});
    actions.append(edit,save,dismiss);panel.append(title,hint,area,actions);overlay.append(panel);
    document.body.append(overlay);
  }
  global.OlliConsultationManualUI=Object.freeze({open,close});
})(window);
