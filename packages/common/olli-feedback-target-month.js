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
  global.getOlliFeedbackTargetMonthForSave=getTargetMonth;
})(window);
