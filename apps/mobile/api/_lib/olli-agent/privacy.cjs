'use strict';

const {
  preparePrivacySafeMessages,
  assertPreparedPrivacyEgress,
  collectStudentNameVariants,
  buildPrivacyPlan,
} = require('../ai-privacy-gateway.cjs');
const { sanitizeValue } = require('../ai-privacy-sanitizer.cjs');
const { assertSafeEgress } = require('../ai-egress-guard.cjs');
const {
  resolveStudentReferences,
  matchStudentReferences,
  createSubjectAccess,
} = require('./student-reference-resolver.cjs');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function safeSubjectRefs(resolution) {
  return (Array.isArray(resolution?.resolved) ? resolution.resolved : []).map((item) => ({
    label: item.label,
    subject_ref: item.subjectRef,
    division: clean(item.student?.division),
  }));
}

function unresolvedSensitiveEntities(resolution) {
  const resolvedIds = new Set(
    (Array.isArray(resolution?.resolved) ? resolution.resolved : [])
      .map((item) => clean(item.student?.id))
      .filter(Boolean)
  );

  const entities = [];
  (Array.isArray(resolution?.students) ? resolution.students : []).forEach((student) => {
    if (resolvedIds.has(clean(student.id))) return;
    const aliases = collectStudentNameVariants(student.row);
    if (!aliases.length) return;
    entities.push({
      values: aliases,
      replacement: '[학생명 제거]',
    });
  });

  return entities;
}

function buildAgentToolPrivacyPlan(resolution) {
  const resolved = Array.isArray(resolution?.resolved) ? resolution.resolved : [];
  const primary = resolved[0] || null;
  const related = resolved.slice(1);

  return buildPrivacyPlan({
    subject: primary?.student?.row || {},
    relatedStudents: related.map((item) => item.student.row),
    sensitiveEntities: unresolvedSensitiveEntities(resolution),
  });
}

function sanitizeAgentToolPayload(value, preparedPrivacy) {
  const resolution = preparedPrivacy?.rawResolution;
  if (!resolution) {
    const error = new Error('Agent Tool 결과를 익명화할 개인정보 범위를 확인하지 못했습니다.');
    error.statusCode = 500;
    error.code = 'OLLI_AGENT_PRIVACY_CONTEXT_MISSING';
    throw error;
  }

  const plan = buildAgentToolPrivacyPlan(resolution);
  const sanitized = sanitizeValue(value, { entities: plan.entities });
  assertSafeEgress(sanitized, { forbiddenValues: plan.forbiddenValues });
  return sanitized;
}

function prepareAgentPrivacyFromResolution(text, resolution) {
  const sourceText = String(text || '');
  const resolved = Array.isArray(resolution?.resolved) ? resolution.resolved : [];
  const ambiguous = Array.isArray(resolution?.ambiguous) ? resolution.ambiguous : [];

  const primary = resolved[0] || null;
  const related = resolved.slice(1);

  const prepared = preparePrivacySafeMessages({
    requestScope: primary ? { subjectRef: primary.subjectRef } : {},
    subject: primary?.student?.row || {},
    relatedStudents: related.map((item) => item.student.row),
    sensitiveEntities: unresolvedSensitiveEntities(resolution),
    messages: [{ role: 'user', content: sourceText }],
  });

  assertPreparedPrivacyEgress(prepared.messages, prepared);

  const result = {
    safeMessages: prepared.messages,
    safeText: clean(prepared.messages?.[0]?.content),
    subjectRefs: safeSubjectRefs(resolution),
    privacy: prepared.privacy,
    needsDisambiguation: ambiguous.length > 0,
    ambiguousCount: ambiguous.length,
  };

  Object.defineProperties(result, {
    subjectAccess: {
      value: createSubjectAccess(resolution),
      enumerable: false,
      writable: false,
      configurable: false,
    },
    requestScope: {
      value: prepared.requestScope,
      enumerable: false,
      writable: false,
      configurable: false,
    },
    rawResolution: {
      value: resolution,
      enumerable: false,
      writable: false,
      configurable: false,
    },
  });

  return Object.freeze(result);
}


function isContextualStudentReference(text) {
  const compact=String(text || '').replace(/\s+/g,'');
  return /(?:그학생|그아이|그친구|그애|걔|아까(?:그)?(?:학생|아이|친구)?|방금(?:그)?(?:학생|아이|친구)?)/.test(compact);
}

function withStableSingleSubject(resolution, item, binding) {
  const stable=Object.assign({},item,{
    label:'학생A',
    subjectRef:clean(binding?.subjectRef) || item.subjectRef,
  });
  return Object.assign({},resolution,{resolved:[stable]});
}

async function prepareAgentReadPrivacyInput(text, requestContext, options = {}) {
  const session=options?.session;
  const allowBoundSubjectContinuation=options?.allowBoundSubjectContinuation===true;
  const resolverOptions=Object.assign({},options);
  delete resolverOptions.session;
  delete resolverOptions.allowBoundSubjectContinuation;

  const resolution=await resolveStudentReferences(text,requestContext,resolverOptions);
  const preparedWithoutSession=()=>prepareAgentPrivacyFromResolution(text,resolution);

  if(!session || typeof session.getSubjectBindings!=='function' || typeof session.bindSubjectBindings!=='function'){
    return Object.freeze({
      preparedPrivacy:preparedWithoutSession(),
      sessionEnabled:false,
      sessionReset:false,
    });
  }

  const resolved=Array.isArray(resolution?.resolved)?resolution.resolved:[];
  const ambiguous=Array.isArray(resolution?.ambiguous)?resolution.ambiguous:[];

  // Keep multi-student and ambiguous requests on the existing per-request privacy path.
  // Persistent read context is intentionally single-subject first so a stale context
  // can never silently select a different student.
  if(ambiguous.length>0 || resolved.length>1){
    return Object.freeze({
      preparedPrivacy:preparedWithoutSession(),
      sessionEnabled:false,
      sessionReset:false,
    });
  }

  let bindings=await session.getSubjectBindings();
  bindings=Array.isArray(bindings)?bindings:[];

  if(resolved.length===1){
    const current=resolved[0];
    const currentId=clean(current?.student?.id);
    const sameBinding=bindings.length===1
      && clean(bindings[0]?.studentId)===currentId
      && clean(bindings[0]?.label)==='학생A';

    let sessionReset=false;
    let subjectRef=current.subjectRef;

    if(sameBinding){
      subjectRef=clean(bindings[0]?.subjectRef) || subjectRef;
    }else{
      if(bindings.length>0){
        await session.clearSession();
        bindings=[];
        sessionReset=true;
      }
      await session.bindSubjectBindings([{
        label:'학생A',
        subjectRef,
        studentId:currentId,
      }]);
    }

    const stableResolution=withStableSingleSubject(
      resolution,
      current,
      {subjectRef}
    );

    return Object.freeze({
      preparedPrivacy:prepareAgentPrivacyFromResolution(text,stableResolution),
      sessionEnabled:true,
      sessionReset,
    });
  }

  if(
    bindings.length===1
    && clean(bindings[0]?.label)==='학생A'
    && (isContextualStudentReference(text) || allowBoundSubjectContinuation)
  ){
    const boundStudent=(Array.isArray(resolution?.students)?resolution.students:[])
      .find((student)=>clean(student?.id)===clean(bindings[0]?.studentId));

    if(boundStudent){
      const contextualResolution=Object.assign({},resolution,{
        resolved:[{
          label:'학생A',
          subjectRef:bindings[0].subjectRef,
          position:-1,
          matchedAlias:'',
          fromSession:true,
          student:boundStudent,
        }],
      });

      return Object.freeze({
        preparedPrivacy:prepareAgentPrivacyFromResolution(text,contextualResolution),
        sessionEnabled:true,
        sessionReset:false,
      });
    }
  }

  return Object.freeze({
    preparedPrivacy:preparedWithoutSession(),
    sessionEnabled:false,
    sessionReset:false,
  });
}


function normalizeAgentConversation(conversation) {
  return (Array.isArray(conversation) ? conversation : [])
    .map((item) => {
      const role=clean(item?.role);
      const content=clean(item?.content ?? item?.text);
      if(!content || !['user','assistant'].includes(role)) return null;
      return { role, content };
    })
    .filter(Boolean);
}

function prepareAgentConversationInput(preparedPrivacy, conversation, currentText) {
  const resolution=preparedPrivacy?.rawResolution;
  if(!resolution){
    const error=new Error('Agent 대화 익명화 범위를 확인하지 못했습니다.');
    error.statusCode=500;
    error.code='OLLI_AGENT_PRIVACY_CONTEXT_MISSING';
    throw error;
  }

  const resolved=Array.isArray(resolution?.resolved)?resolution.resolved:[];
  const primary=resolved[0] || null;
  const related=resolved.slice(1);
  const messages=normalizeAgentConversation(conversation)
    .concat({role:'user',content:String(currentText || '')});

  const prepared=preparePrivacySafeMessages({
    requestScope:primary ? {subjectRef:primary.subjectRef} : {},
    subject:primary?.student?.row || {},
    relatedStudents:related.map((item)=>item.student.row),
    sensitiveEntities:unresolvedSensitiveEntities(resolution),
    messages,
  });
  assertPreparedPrivacyEgress(prepared.messages,prepared);

  return prepared.messages
    .map((item)=>({
      role:clean(item?.role),
      content:clean(item?.content),
    }))
    .filter((item)=>['user','assistant'].includes(item.role) && item.content);
}

async function prepareAgentContextReadPrivacyInput(
  text,
  conversation,
  requestContext,
  options = {}
) {
  let result=await prepareAgentReadPrivacyInput(
    text,
    requestContext,
    Object.assign({},options,{allowBoundSubjectContinuation:true})
  );

  if(
    !result.preparedPrivacy?.needsDisambiguation
    && (Array.isArray(result.preparedPrivacy?.subjectRefs)
      ? result.preparedPrivacy.subjectRefs.length
      : 0)===0
  ){
    const baseResolution=result.preparedPrivacy?.rawResolution;
    const rawRows=(Array.isArray(baseResolution?.students) ? baseResolution.students : [])
      .map((student)=>student?.row)
      .filter(Boolean);
    const resolverOptions=Object.assign({},options);
    delete resolverOptions.session;
    delete resolverOptions.allowBoundSubjectContinuation;

    const priorUsers=normalizeAgentConversation(conversation)
      .filter((item)=>item.role==='user')
      .reverse();

    let inferred=null;
    for(const item of priorUsers){
      const candidate=matchStudentReferences(item.content,rawRows,resolverOptions);
      const resolved=Array.isArray(candidate?.resolved)?candidate.resolved:[];
      const ambiguous=Array.isArray(candidate?.ambiguous)?candidate.ambiguous:[];
      if(resolved.length===1 && ambiguous.length===0){
        inferred=candidate;
        break;
      }
    }

    if(inferred){
      const current=inferred.resolved[0];
      const stableResolution=withStableSingleSubject(
        inferred,
        current,
        {subjectRef:current.subjectRef}
      );
      const session=options?.session;
      if(session && typeof session.bindSubjectBindings==='function'){
        await session.bindSubjectBindings([{
          label:'학생A',
          subjectRef:current.subjectRef,
          studentId:clean(current?.student?.id),
        }]);
      }
      result=Object.freeze({
        preparedPrivacy:prepareAgentPrivacyFromResolution(text,stableResolution),
        sessionEnabled:!!session,
        sessionReset:false,
      });
    }
  }

  const input=prepareAgentConversationInput(
    result.preparedPrivacy,
    conversation,
    text
  );
  return Object.freeze(Object.assign({},result,{agentInput:input}));
}

async function prepareAgentPrivacyInput(text, requestContext, options = {}) {
  const resolution = await resolveStudentReferences(text, requestContext, options);
  return prepareAgentPrivacyFromResolution(text, resolution);
}

async function preparePrivateReasonPrivacyInput(text, reasonText, requestContext, options = {}) {
  const sourceText=String(text || '');
  const reason=clean(reasonText);
  let commandText=sourceText;

  if(reason){
    const index=commandText.lastIndexOf(reason);
    if(index>=0){
      commandText=commandText.slice(0,index)
        .replace(/(?:사유|이유)\s*(?:는|은)?\s*[:：-]?\s*$/i,'')
        .replace(/[,，:：-]\s*$/,'')
        .trim();
    }
  }

  const resolution=await resolveStudentReferences(commandText,requestContext,options);
  return prepareAgentPrivacyFromResolution(commandText,resolution);
}

async function prepareAbsencePrivacyInput(text, reasonText, requestContext, options = {}) {
  return preparePrivateReasonPrivacyInput(text,reasonText,requestContext,options);
}

async function prepareMakeupCancelPrivacyInput(text, reasonText, requestContext, options = {}) {
  return preparePrivateReasonPrivacyInput(text,reasonText,requestContext,options);
}


async function prepareTimetableMemoPrivacyInput(text, memoNote, requestContext, options = {}) {
  const sourceText=String(text || '');
  const note=clean(memoNote);
  let commandText=sourceText;

  if(note){
    const quotedVariants=[
      '“'+note+'”',
      '‘'+note+'’',
      '"'+note+'"',
      "'"+note+"'"
    ];
    for(const quoted of quotedVariants){
      if(commandText.includes(quoted)){
        commandText=commandText.replace(quoted,' ');
        break;
      }
    }
    if(commandText.includes(note)){
      commandText=commandText.replace(note,' ');
    }
    commandText=commandText
      .replace(/(?:내용|문구)\s*[:：-]?\s*/g,' ')
      .replace(/\s+/g,' ')
      .trim();
  }

  const resolution=await resolveStudentReferences(commandText,requestContext,options);
  return prepareAgentPrivacyFromResolution(commandText,resolution);
}


module.exports = {
  safeSubjectRefs,
  sanitizeAgentToolPayload,
  prepareAgentPrivacyFromResolution,
  prepareAgentReadPrivacyInput,
  prepareAgentContextReadPrivacyInput,
  prepareAgentConversationInput,
  prepareAgentPrivacyInput,
  preparePrivateReasonPrivacyInput,
  prepareAbsencePrivacyInput,
  prepareMakeupCancelPrivacyInput,
  prepareTimetableMemoPrivacyInput,
};
