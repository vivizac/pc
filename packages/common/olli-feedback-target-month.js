(function(global){
  'use strict';
  function currentMonth(date=new Date()){
    return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0');
  }
  function getTargetMonth(type,supplied){
    if(String(type||'').toLowerCase()!=='growth')return null;
    const now=new Date(),thisMonth=currentMonth(now);
    const previous=new Date(now.getFullYear(),now.getMonth()-1,1);
    const suggestion=now.getDate()<=10?currentMonth(previous):thisMonth;
    const input=supplied||global.prompt(
      '성장 피드백이 실제로 다루는 수업 월(YYYY-MM)을 입력해 주세요.\n'
      +'4월에 정리하는 3월 성장 기록이라면 2026-03을 입력합니다.\n'
      +'작성일과 대상 월은 별도로 보관됩니다.',suggestion);
    if(input===null)throw new Error('대상 월 선택이 취소되어 저장하지 않았습니다.');
    const value=String(input).trim();
    if(!/^20[0-9]{2}-(0[1-9]|1[0-2])$/.test(value)||value>thisMonth)
      throw new Error('성장 피드백 대상 월은 YYYY-MM 형식이며 미래 월일 수 없습니다.');
    return value;
  }
  // One saved-record correction gateway for both PC and Mobile.
  // No local writes or optimistic UI changes: the session-checked RPC commits first.
  function currentKoreanMonth(){
    const today=new Date(Date.now()+9*60*60*1000);
    return today.getUTCFullYear()+'-'+String(today.getUTCMonth()+1).padStart(2,'0');
  }
  function isGrowthRecord(row,table){
    return String(table||'').toLowerCase()==='feedbacks'
      && String(row?.feedback_type||'').toLowerCase()==='growth';
  }
  function validateHistoricalMonth(month){
    const input=String(month||'').trim();
    if(!/^20[0-9]{2}-(0[1-9]|1[0-2])$/.test(input)||input>currentKoreanMonth()){
      throw new Error('수업 대상 월은 YYYY-MM 형식으로, 현재 월보다 미래일 수 없습니다.');
    }
    return input;
  }
  function assertLiveHost(){
    const host=String(global.location?.hostname||'').toLowerCase();
    if(host.endsWith('.vercel.app')&&!['pc-seven-silk.vercel.app','vivizac-feedback.vercel.app'].includes(host)){
      throw new Error('미리보기 주소에서는 실제 기록의 대상 월을 변경할 수 없습니다.');
    }
  }
  async function changeSavedMonth({studentId,recordId,row}){
    if(!isGrowthRecord(row,'feedbacks'))throw new Error('일반 성장 피드백만 대상 월을 수정할 수 있습니다.');
    const id=String(recordId||'').trim();
    if(!/^[1-9][0-9]*$/.test(id)||!studentId)throw new Error('서버에 저장된 성장 피드백 식별값이 없습니다.');
    const previous=String(row.target_month||'').trim()||null;
    const supplied=global.prompt('이 성장 피드백이 실제로 다루는 수업 월을 YYYY-MM으로 입력하세요.\\n기존 수업 기록을 확인해 직접 지정해야 하며 작성일로 자동 추정하지 않습니다.\\n현재 대상 월: '+(previous||'미지정'),previous||'');
    if(supplied===null)return null;
    const next=validateHistoricalMonth(supplied);
    if(next===previous)return null;
    if(!global.confirm('성장 피드백의 수업 대상 월을 '+next+'로 변경할까요?\\n피드백 본문과 작성일은 변경하지 않습니다.'))return null;
    assertLiveHost();
    const academyId=String(typeof global.getOlliCurrentAcademyId==='function'?global.getOlliCurrentAcademyId():'').trim();
    const sessionToken=String(global.localStorage?.getItem('olli_account_session_token_v1')||'').trim();
    if(!academyId||!sessionToken||typeof global.supabase!=='function')throw new Error('원장 로그인 및 서버 연결을 확인해 주세요.');
    const result=await global.supabase('POST','rpc/olli_growth_feedback_target_month_access',{
      p_session_token:sessionToken,p_academy_id:academyId,p_student_id:String(studentId),
      p_feedback_id:id,p_expected_target_month:previous,p_target_month:next
    });
    if(!result?.ok){
      const error=new Error(result?.message||'수업 대상 월을 저장하지 못했습니다. ('+(result?.code||'UNKNOWN')+')');
      error.code=result?.code||'TARGET_MONTH_SAVE_FAILED';
      throw error;
    }
    if(String(result.row?.target_month||'')!==next)throw new Error('서버에서 변경된 대상 월을 확인하지 못했습니다.');
    return result.row;
  }
  global.OlliFeedbackTargetMonth=Object.freeze({isGrowthRecord,changeSavedMonth,validateHistoricalMonth});
  global.getOlliFeedbackTargetMonthForSave=getTargetMonth;
})(window);
