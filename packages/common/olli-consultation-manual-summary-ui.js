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
  async function openLegacyReview({studentId,studentName,taskKey,candidateData,onLinked}){
    close();
    overlay=elm('div',{className:'olliSummaryServerOverlay',role:'dialog','aria-modal':'true'});
    const current=overlay;
    const panel=elm('section',{className:'olliSummaryServerPanel'});
    const months=String(taskKey||'').split('|')[1]||'';
    const dueMonth=String(taskKey||'').split('|')[2]||'';
    const title=elm('h3',{},String(studentName||'학생')+' · 기존 종합 피드백 연결');
    const hint=elm('p',{className:'olliSummaryServerHint'},
      '상담 기준월 '+dueMonth+' / '+({after_1:'1개월',after_3:'3개월',every_6:'6개월',every_12:'12개월'}[months]||'')+
      ' 분석. 기존 피드백을 읽고 이 상담 회차의 기록임을 직접 확인해 주세요. 작성일과 상담월은 다를 수 있습니다.');
    const chooser=elm('select',{className:'olliLegacySummaryChooser','aria-label':'기존 피드백 선택'});
    const text=elm('textarea',{className:'olliSummaryServerText',readonly:'readonly','aria-label':'기존 피드백 원문'});
    const confirmation=elm('label',{className:'olliLegacySummaryConfirmation'});
    const checkbox=elm('input',{type:'checkbox'});
    const acknowledgment=elm('span',{},'선택한 피드백이 이 학생의 해당 상담 회차에 속하는 정확한 원본임을 확인했습니다.');
    confirmation.append(checkbox,acknowledgment);
    const notice=elm('p',{className:'olliSummaryServerHint',role:'status'},'기존 피드백을 불러오는 중입니다.');
    const actions=elm('div',{className:'olliSummaryServerActions'});
    const save=elm('button',{type:'button'},'확인 후 연결');save.disabled=true;
    const dismiss=elm('button',{type:'button'},'닫기');
    actions.append(save,dismiss);
    panel.append(title,hint,chooser,text,confirmation,notice,actions);
    current.append(panel);
    document.body.append(current);
    let candidates=[];
    function selected(){return candidates.find(row=>String(row.feedback_id)===String(chooser.value))||null;}
    function update(){
      const row=selected();
      text.value=row?String(row.content||''):'';
      checkbox.checked=false;
      save.disabled=!row;
      if(row)save.disabled=true;
      notice.textContent=row?'기록을 확인한 후 아래 확인란을 선택해 주세요.':'연결할 기록을 선택해 주세요.';
    }
    checkbox.addEventListener('change',()=>{save.disabled=!(selected()&&checkbox.checked);});
    chooser.addEventListener('change',update);
    dismiss.addEventListener('click',close);
    current.addEventListener('click',event=>{if(event.target===current&& !save.disabled)return; if(event.target===current)close();});
    try{
      const data=candidateData||await global.OlliConsultationServer.listLegacyCandidates(studentId,taskKey);
      if(current!==overlay)return;
      candidates=Array.isArray(data.candidates)?data.candidates:[];
      const empty=elm('option',{value:''},'연결할 기록을 선택하세요');
      chooser.append(empty);
      candidates.forEach(row=>{
        chooser.append(elm('option',{value:String(row.feedback_id)},
          '기록 #'+row.feedback_id+' · '+String(row.date||row.created_at||'작성일 미확인')+
          ' · '+row.summary_months+'개월'));
      });
      if(data.status==='ready'&&data.linkedFeedbackId){
        notice.textContent='이 상담 회차는 이미 피드백과 연결되어 있습니다.';
        save.disabled=true;chooser.disabled=true;checkbox.disabled=true;
      }else if(candidates.length===0){
        notice.textContent='연결할 수 있는 후보가 없습니다. 피드백 보관함에서 원본을 확인해 주세요.';
        save.disabled=true;chooser.disabled=true;checkbox.disabled=true;
      }else {
        notice.textContent=candidates.length+'건의 후보가 있습니다. 날짜만으로 자동 연결하지 않습니다.';
      }
    }catch(error){
      if(current===overlay)notice.textContent='기존 피드백 확인 실패: '+(error.message||error);
      save.disabled=true;
    }
    save.addEventListener('click',async()=>{
      const row=selected();
      if(!row||!checkbox.checked)return;
      save.disabled=true;chooser.disabled=true;checkbox.disabled=true;
      save.textContent='연결중...';
      try{
        await global.OlliConsultationServer.linkLegacySummary(studentId,taskKey,row.feedback_id);
        const task={key:taskKey,ruleKey:months,dueMonth};
        const verified=await global.OlliConsultationServer.checkSummaryStatus({id:studentId},task);
        if(verified.status!=='ready'||Number(verified.feedbackId)!==Number(row.feedback_id))
          throw new Error('서버에서 준비완료 연결을 재확인하지 못했습니다. 상담 카드를 다시 확인해 주세요.');
        if(typeof onLinked==='function')await onLinked(verified);
        if(current===overlay)close();
      }catch(error){
        if(current===overlay){
          notice.textContent='연결 상태 확인: '+(error.message||error);
          save.disabled=false;chooser.disabled=false;checkbox.disabled=false;
          save.textContent='확인 후 연결';
        }
      }
    });
  }
  global.OlliConsultationManualUI=Object.freeze({open,openLegacyReview,close});
})(window);
