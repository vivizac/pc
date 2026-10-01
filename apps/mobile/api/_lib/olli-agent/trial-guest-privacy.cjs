'use strict';

const {
  preparePrivacySafeMessages,
  assertPreparedPrivacyEgress,
  buildPrivacyPlan,
} = require('../ai-privacy-gateway.cjs');
const { sanitizeValue } = require('../ai-privacy-sanitizer.cjs');
const { assertSafeEgress } = require('../ai-egress-guard.cjs');
const { createOpaqueSubjectRef } = require('../ai-request-scope.cjs');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function trialPrivacyError(message, statusCode=400, code='OLLI_AGENT_TRIAL_PRIVACY_ERROR') {
  const error=new Error(message);
  error.statusCode=statusCode;
  error.code=code;
  return error;
}

function stripTrialCommandParts(value) {
  return clean(value)
    .replace(/(^|\s)@올리(?=\s|$)/g,' ')
    .replace(/(?:초등부|초등|유치부|유치원|유치|유아)/g,' ')
    .replace(/[.!?,，。！？]/g,' ')
    .replace(/\d{4}\s*[-./]\s*\d{1,2}\s*[-./]\s*\d{1,2}/g,' ')
    .replace(/\d{1,2}\s*월\s*\d{1,2}\s*일/g,' ')
    .replace(/\d{1,2}\s*\/\s*\d{1,2}\s*일/g,' ')
    .replace(/(?:^|\s)\d{1,2}\s*일(?=\s|$)/g,' ')
    .replace(/(?:오늘|금일|내일|(?:(?:이번\s*주|금주|다다음\s*주|다음\s*주|차주)\s*)?[월화수목금토]요일)/g,' ')
    .replace(/\d{1,2}\s*시(?:\s*\d{1,2}\s*분)?(?:에서|으로|에|로)?/g,' ')
    .replace(/[AaBb]\s*반(?:에서|으로|에|로)?/g,' ')
    .replace(/(?:체험\s*클래스|체험\s*수업|체험)(?:에서|으로|에|을|를)?/g,' ')
    .replace(/(?:수정|변경|옮겨|옮기|이동|바꿔|바꾸|고쳐|고치)(?:줘요|해주세요|해줘|해줄래|할래|해|줘|주세요|어줘|아줘|어요|아요|기)?/g,' ')
    .replace(/(?:등록|추가|예약|신청|배정|넣어|넣|저장|잡아)(?:줘요|해주세요|해줘|해줄래|할래|해|줘|주세요|어줘|아줘|어요|아요|기)?/g,' ')
    .replace(/(?:취소|삭제|지워|지우|제거|빼|해제|없애)(?:해줘요|해주세요|해줘|해줄래|할래|해|줘|주세요|어줘|아줘|어요|아요|기)?/g,' ')
    .replace(/(?:사유|이유)\s*(?:는|은)?\s*[:：-]?/g,' ')
    .replace(/(?:타임|시간대|날짜|시간|기존|현재|원래|새로|새로운)/g,' ')
    .replace(/(?:^|\s)(?:에서|으로|로|을|를|에|에게|한테|좀|한번)(?=\s|$)/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function extractTrialGuestName(text) {
  let name=stripTrialCommandParts(text)
    .replace(/^(?:학생|원생)\s*/,'')
    .replace(/\s*(?:학생|원생)$/,'')
    .replace(/(?:의|꺼|것)$/,'')
    .trim();

  if(!name || name.length<2 || name.length>40) {
    throw trialPrivacyError(
      '변경할 체험 학생 이름을 확인해 주세요.',
      400,
      'OLLI_AGENT_TRIAL_GUEST_NAME_REQUIRED'
    );
  }
  if(/\s/.test(name) || !/^[가-힣A-Za-z0-9·ㆍ()\-]+$/.test(name)) {
    throw trialPrivacyError(
      '체험 학생 이름을 하나로 구분하지 못했습니다. 이름과 기존 체험 일정을 함께 알려 주세요.',
      409,
      'OLLI_AGENT_TRIAL_GUEST_NAME_AMBIGUOUS'
    );
  }
  return name;
}

function detectTrialDivision(text) {
  const compact=clean(text).replace(/\s+/g,'');
  if(/초등부|초등/.test(compact)) return 'elementary';
  if(/유치부|유치원|유치|유아/.test(compact)) return 'kinder';
  return '';
}

function prepareTrialGuestPrivacyInput(text) {
  const sourceText=String(text || '');
  const guestName=extractTrialGuestName(sourceText);
  const division=detectTrialDivision(sourceText);
  const subjectRef=createOpaqueSubjectRef();
  const subject={name:guestName};
  const prepared=preparePrivacySafeMessages({
    requestScope:{subjectRef},
    subject,
    messages:[{role:'user',content:sourceText}],
  });
  assertPreparedPrivacyEgress(prepared.messages,prepared);

  const result={
    safeMessages:prepared.messages,
    safeText:clean(prepared.messages?.[0]?.content),
    subjectRefs:[{label:'학생A',subject_ref:subjectRef,division}],
    privacy:prepared.privacy,
    needsDisambiguation:false,
    ambiguousCount:0,
  };

  Object.defineProperties(result,{
    trialAccess:{
      value:Object.freeze({
        resolve(subjectKey){
          const key=clean(subjectKey);
          if(key!=='학생A' && key!==subjectRef) return null;
          return Object.freeze({guestName,division});
        },
      }),
      enumerable:false,
      writable:false,
      configurable:false,
    },
    rawTrialSubject:{
      value:Object.freeze({guestName,division}),
      enumerable:false,
      writable:false,
      configurable:false,
    },
  });
  return Object.freeze(result);
}

function prepareTrialCancelPrivacyInput(text,reasonText='') {
  const sourceText=String(text || '');
  const reason=clean(reasonText);
  let commandText=sourceText;
  if(reason){
    const index=commandText.lastIndexOf(reason);
    if(index>=0){
      commandText=(commandText.slice(0,index)+' '+commandText.slice(index+reason.length)).trim();
    }
  }
  return prepareTrialGuestPrivacyInput(commandText);
}

function sanitizeTrialToolPayload(value,preparedPrivacy) {
  const subject=preparedPrivacy?.rawTrialSubject;
  const guestName=clean(subject?.guestName);
  if(!guestName) {
    throw trialPrivacyError(
      '체험 Agent Tool 결과 개인정보 범위를 확인하지 못했습니다.',
      500,
      'OLLI_AGENT_TRIAL_PRIVACY_CONTEXT_MISSING'
    );
  }
  const plan=buildPrivacyPlan({subject:{name:guestName}});
  const sanitized=sanitizeValue(value,{entities:plan.entities});
  assertSafeEgress(sanitized,{forbiddenValues:plan.forbiddenValues});
  return sanitized;
}

module.exports={
  stripTrialCommandParts,
  extractTrialGuestName,
  detectTrialDivision,
  prepareTrialGuestPrivacyInput,
  prepareTrialCancelPrivacyInput,
  sanitizeTrialToolPayload,
};
