'use strict';

const { wrapOlliAgentRun } = require('./observability.cjs');

const MIN_NODE_MAJOR = 22;

function runtimeError(message, statusCode = 500, code = 'OLLI_AGENT_RUNTIME_ERROR') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function nodeMajorVersion() {
  return Number(String(process.versions?.node || '').split('.')[0] || 0);
}

function assertSupportedNodeRuntime() {
  const major = nodeMajorVersion();
  if (!Number.isFinite(major) || major < MIN_NODE_MAJOR) {
    throw runtimeError(
      `OpenAI Agents SDK는 Node.js ${MIN_NODE_MAJOR} 이상이 필요합니다. 현재 runtime: ${process.versions?.node || 'unknown'}`,
      500,
      'OLLI_AGENT_NODE_UNSUPPORTED'
    );
  }
  return major;
}

function todayInSeoul() {
  const shifted = new Date(Date.now() + (9 * 60 * 60 * 1000));
  return shifted.toISOString().slice(0, 10);
}

async function loadAgentsSdk() {
  assertSupportedNodeRuntime();

  const [agentsSdk, zodModule] = await Promise.all([
    import('@openai/agents'),
    import('zod'),
  ]);

  if (
    !agentsSdk?.Agent ||
    typeof agentsSdk?.run !== 'function' ||
    typeof agentsSdk?.tool !== 'function' ||
    !zodModule?.z
  ) {
    throw runtimeError(
      'OpenAI Agents SDK 의존성을 불러오지 못했습니다.',
      500,
      'OLLI_AGENT_SDK_LOAD_FAILED'
    );
  }

  return {
    Agent: agentsSdk.Agent,
    run: wrapOlliAgentRun(agentsSdk.run),
    tool: agentsSdk.tool,
    z: zodModule.z,
  };
}

function agentModel() {
  return (
    String(process.env.OPENAI_AGENT_MODEL || process.env.OPENAI_MODEL || '').trim() ||
    'gpt-5-mini'
  );
}

function assertOpenAiKey() {
  if (!process.env.OPENAI_API_KEY) {
    throw runtimeError(
      'OPENAI_API_KEY가 서버 환경변수에 설정되지 않았습니다.',
      500,
      'OPENAI_API_KEY_MISSING'
    );
  }
}

async function runFoundationProbe(agentContext) {
  assertOpenAiKey();

  const { Agent, run } = await loadAgentsSdk();
  const model = agentModel();

  const agent = new Agent({
    name: 'Olli Foundation Probe',
    model,
    instructions: [
      'You are a private diagnostic agent for the Olli application.',
      'This probe has no business tools and must not infer, retrieve, or modify academy data.',
      'When asked for the readiness token, reply with OLLI_AGENT_READY only.',
    ].join(' '),
    tools: [],
  });

  const result = await run(
    agent,
    'Return the readiness token OLLI_AGENT_READY only.',
    {
      context: agentContext,
    }
  );

  const finalOutput = String(result?.finalOutput || '').trim();
  if (!finalOutput) {
    throw runtimeError(
      'Agents SDK probe 응답이 비어 있습니다.',
      502,
      'OLLI_AGENT_EMPTY_PROBE'
    );
  }

  return {
    ready: true,
    model,
    output: finalOutput,
    nodeVersion: process.versions.node,
  };
}

async function runStudentScheduleProbe({
  agentContext,
  requestContext,
  preparedPrivacy,
  session=null,
}) {
  assertOpenAiKey();

  const subjectRefs = Array.isArray(preparedPrivacy?.subjectRefs)
    ? preparedPrivacy.subjectRefs
    : [];

  if (preparedPrivacy?.needsDisambiguation) {
    throw runtimeError(
      '학생 이름을 한 명으로 구분할 수 없습니다. 전체 이름으로 다시 알려 주세요.',
      409,
      'OLLI_AGENT_STUDENT_AMBIGUOUS'
    );
  }

  if (subjectRefs.length !== 1) {
    throw runtimeError(
      '시간표 조회 probe에서는 학생 한 명을 정확히 지정해 주세요.',
      400,
      'OLLI_AGENT_SINGLE_STUDENT_REQUIRED'
    );
  }

  const { Agent, run, tool, z } = await loadAgentsSdk();
  const { createGetStudentScheduleTool } = require('./tools/schedule-tools.cjs');
  const model = agentModel();
  const today = todayInSeoul();
  const onlyLabel = subjectRefs[0].label;

  const getStudentSchedule = createGetStudentScheduleTool({
    tool,
    z,
    requestContext,
    subjectAccess: preparedPrivacy.subjectAccess,
  });

  const agent = new Agent({
    name: 'Olli Student Schedule Probe',
    model,
    instructions: [
      'You are the Olli academy schedule assistant.',
      'The user message has already been privacy-sanitized.',
      `The only available anonymous student label for this run is ${onlyLabel}.`,
      `Today in Korea is ${today}.`,
      'Always use get_student_schedule before answering a student schedule question.',
      'Never ask for, infer, or reveal a real student name, UUID, member ID, session token, or academy ID.',
      'Use the tool result only. If no regular enrollment exists, say that no regular class was found for that reference date.',
      'Answer briefly in Korean.',
    ].join(' '),
    tools: [getStudentSchedule],
    modelSettings: {
      toolChoice: 'get_student_schedule',
    },
  });

  const runOptions={ context:agentContext };
  if(session) runOptions.session=session;
  const result = await run(agent, preparedPrivacy.safeText, runOptions);

  const finalOutput = String(result?.finalOutput || '').trim();
  if (!finalOutput) {
    throw runtimeError(
      '학생 시간표 Agent 응답이 비어 있습니다.',
      502,
      'OLLI_AGENT_EMPTY_SCHEDULE_RESPONSE'
    );
  }

  return {
    ready: true,
    model,
    output: finalOutput,
    nodeVersion: process.versions.node,
  };
}


async function runRecentRecordsProbe({
  agentContext,
  requestContext,
  preparedPrivacy,
}) {
  assertOpenAiKey();

  const subjectRefs = Array.isArray(preparedPrivacy?.subjectRefs)
    ? preparedPrivacy.subjectRefs
    : [];

  if (preparedPrivacy?.needsDisambiguation) {
    throw runtimeError(
      '학생 이름을 한 명으로 구분할 수 없습니다. 전체 이름으로 다시 알려 주세요.',
      409,
      'OLLI_AGENT_STUDENT_AMBIGUOUS'
    );
  }

  if (subjectRefs.length !== 1) {
    throw runtimeError(
      '최근 기록 조회 probe에서는 학생 한 명을 정확히 지정해 주세요.',
      400,
      'OLLI_AGENT_SINGLE_STUDENT_REQUIRED'
    );
  }

  const { Agent, run, tool, z } = await loadAgentsSdk();
  const { createGetRecentRecordsTool } = require('./tools/record-tools.cjs');
  const { sanitizeAgentToolPayload } = require('./privacy.cjs');
  const model = agentModel();
  const onlyLabel = subjectRefs[0].label;

  const getRecentRecords = createGetRecentRecordsTool({
    tool,
    z,
    requestContext,
    subjectAccess: preparedPrivacy.subjectAccess,
    sanitizePayload(payload) {
      return sanitizeAgentToolPayload(payload, preparedPrivacy);
    },
  });

  const agent = new Agent({
    name: 'Olli Recent Records Probe',
    model,
    instructions: [
      'You are the Olli academy recent-record assistant.',
      'The user message has already been privacy-sanitized.',
      'The only available anonymous student label for this run is ' + onlyLabel + '.',
      'Always use get_recent_records before answering about recent class behavior, observations, or feedback.',
      'Use max_records 12 unless the user explicitly asks for another amount from 1 to 20.',
      'The tool returns saved general feedback, growth feedback, and observation records only. It does not return generated summary feedback.',
      'Use only evidence in the tool result. Do not invent causes, diagnoses, or traits that are not supported by the records.',
      'If there are no saved records, say that no recent saved records were found.',
      'Never ask for, infer, or reveal a real student name, UUID, member ID, session token, or academy ID.',
      'Answer briefly in Korean.',
    ].join(' '),
    tools: [getRecentRecords],
    modelSettings: {
      toolChoice: 'get_recent_records',
    },
  });

  const result = await run(agent, preparedPrivacy.safeText, {
    context: agentContext,
  });

  const finalOutput = String(result?.finalOutput || '').trim();
  if (!finalOutput) {
    throw runtimeError(
      '학생 최근 기록 Agent 응답이 비어 있습니다.',
      502,
      'OLLI_AGENT_EMPTY_RECENT_RECORDS_RESPONSE'
    );
  }

  return {
    ready: true,
    model,
    output: finalOutput,
    nodeVersion: process.versions.node,
  };
}


function resolveAvailabilityScope(preparedPrivacy) {
  if (preparedPrivacy?.needsDisambiguation) {
    throw runtimeError(
      '학생 이름을 한 명으로 구분할 수 없습니다. 전체 이름으로 다시 알려 주세요.',
      409,
      'OLLI_AGENT_STUDENT_AMBIGUOUS'
    );
  }

  const subjectRefs = Array.isArray(preparedPrivacy?.subjectRefs)
    ? preparedPrivacy.subjectRefs
    : [];
  if (subjectRefs.length > 1) {
    throw runtimeError(
      '시간표 가용성 조회에서는 학생을 한 명만 지정해 주세요.',
      400,
      'OLLI_AGENT_AVAILABILITY_MULTI_STUDENT'
    );
  }

  const safeText = String(preparedPrivacy?.safeText || '');
  const elementaryExplicit = /(?:초등부|초등|elementary)/i.test(safeText);
  const kinderExplicit = /(?:유치부|유치|유아|kinder)/i.test(safeText);

  if (elementaryExplicit && kinderExplicit) {
    throw runtimeError(
      '초등부와 유치부 중 한 수업 구분만 지정해 주세요.',
      400,
      'OLLI_AGENT_AVAILABILITY_DIVISION_AMBIGUOUS'
    );
  }

  const explicitDivision = elementaryExplicit
    ? 'elementary'
    : (kinderExplicit ? 'kinder' : '');

  let subjectDivision = '';
  if (subjectRefs.length === 1) {
    const subject = preparedPrivacy?.subjectAccess?.resolve?.(subjectRefs[0].label);
    const value = String(subject?.division || '').trim().toLowerCase();
    if (value === 'elementary' || value === 'kinder') subjectDivision = value;
  }

  if (explicitDivision && subjectDivision && explicitDivision !== subjectDivision) {
    throw runtimeError(
      '지정한 학생의 수업 구분과 요청한 초등부·유치부가 서로 다릅니다.',
      400,
      'OLLI_AGENT_AVAILABILITY_DIVISION_MISMATCH'
    );
  }

  const division = subjectDivision || explicitDivision;
  if (!division) {
    throw runtimeError(
      '시간표 가용성 조회에는 초등부 또는 유치부를 함께 알려 주세요.',
      400,
      'OLLI_AGENT_AVAILABILITY_DIVISION_REQUIRED'
    );
  }

  const purposes = [];
  if (/보강/.test(safeText)) purposes.push('makeup');
  if (/체험/.test(safeText)) purposes.push('trial');
  if (/대기/.test(safeText)) purposes.push('wait');
  if (/(?:정규수업|정규|신규\s*등록|신규등록|수업\s*이동)/.test(safeText)) purposes.push('regular');

  const uniquePurposes = Array.from(new Set(purposes));
  if (uniquePurposes.length > 1) {
    throw runtimeError(
      '보강·체험·대기·정규 중 한 가지 목적만 지정해 주세요.',
      400,
      'OLLI_AGENT_AVAILABILITY_PURPOSE_AMBIGUOUS'
    );
  }

  return {
    division,
    purpose: uniquePurposes[0] || 'regular',
    subjectLabel: subjectRefs.length === 1 ? subjectRefs[0].label : '',
  };
}

async function runScheduleAvailabilityProbe({
  agentContext,
  requestContext,
  preparedPrivacy,
}) {
  assertOpenAiKey();

  const scope = resolveAvailabilityScope(preparedPrivacy);
  const { Agent, run, tool, z } = await loadAgentsSdk();
  const { createGetScheduleAvailabilityTool } = require('./tools/availability-tools.cjs');
  const { sanitizeAgentToolPayload } = require('./privacy.cjs');
  const model = agentModel();
  const today = todayInSeoul();

  const getScheduleAvailability = createGetScheduleAvailabilityTool({
    tool,
    z,
    requestContext,
    division: scope.division,
    purpose: scope.purpose,
    sanitizePayload(payload) {
      return sanitizeAgentToolPayload(payload, preparedPrivacy);
    },
  });

  const subjectText = scope.subjectLabel
    ? 'The anonymous student label for this run is ' + scope.subjectLabel + '.'
    : 'This run is not tied to a specific student.';

  const agent = new Agent({
    name: 'Olli Schedule Availability Probe',
    model,
    instructions: [
      'You are the Olli academy schedule-availability assistant.',
      'The user message has already been privacy-sanitized.',
      subjectText,
      'The server has already fixed the division to ' + scope.division + ' and the purpose to ' + scope.purpose + '. Do not override them.',
      'Today in Korea is ' + today + '.',
      'Always use get_schedule_availability before answering.',
      'The maximum tool date range is 14 days.',
      'Use time_slot 0 when the user did not specify a time or when a half-hour label could be ambiguous. Use class_group ALL unless the user explicitly asks for A반 or B반.',
      'For makeup availability, a dated regular absence can free a same-day seat. For regular or trial availability, an absence does not create a seat.',
      'For wait queries, waitlist_open means the wait slot is unused. If remaining is greater than zero, explain that the class itself still has a seat rather than implying that waiting is necessary.',
      'Use only the tool result. Do not invent classes or capacity.',
      'Never ask for, infer, or reveal a real student name, UUID, member ID, session token, academy ID, or teacher ID.',
      'Answer briefly in Korean.',
    ].join(' '),
    tools: [getScheduleAvailability],
    modelSettings: {
      toolChoice: 'get_schedule_availability',
    },
  });

  const result = await run(agent, preparedPrivacy.safeText, {
    context: agentContext,
  });

  const finalOutput = String(result?.finalOutput || '').trim();
  if (!finalOutput) {
    throw runtimeError(
      '시간표 가용성 Agent 응답이 비어 있습니다.',
      502,
      'OLLI_AGENT_EMPTY_AVAILABILITY_RESPONSE'
    );
  }

  return {
    ready: true,
    model,
    output: finalOutput,
    nodeVersion: process.versions.node,
  };
}



function resolveAbsencePrepareScope(preparedPrivacy) {
  if(preparedPrivacy?.needsDisambiguation){
    throw runtimeError('학생 이름을 한 명으로 구분할 수 없습니다. 전체 이름으로 다시 알려 주세요.',409,'OLLI_AGENT_STUDENT_AMBIGUOUS');
  }
  const subjectRefs=Array.isArray(preparedPrivacy?.subjectRefs)?preparedPrivacy.subjectRefs:[];
  if(subjectRefs.length!==1){
    throw runtimeError('결석 처리는 한 번에 학생 한 명만 지정해 주세요.',400,'OLLI_AGENT_ABSENCE_SINGLE_STUDENT_REQUIRED');
  }

  const subjectLabel=subjectRefs[0].label;
  const subject=preparedPrivacy?.subjectAccess?.resolve?.(subjectLabel);
  const division=String(subject?.division||'').trim().toLowerCase();
  if(!['elementary','kinder'].includes(division)){
    throw runtimeError('결석 처리 대상 학생의 수업 구분을 확인하지 못했습니다.',400,'OLLI_AGENT_ABSENCE_DIVISION_REQUIRED');
  }

  const safeText=String(preparedPrivacy?.safeText||'');
  const compact=safeText.replace(/\s+/g,'');
  if(!/(?:결석|결석처리)/.test(compact)){
    throw runtimeError('결석 처리 요청을 확인하지 못했습니다.',400,'OLLI_AGENT_ABSENCE_INTENT_REQUIRED');
  }
  if(/(?:보강|보충|체험|대기|웨이팅|이동|변경|취소|삭제)/.test(compact)){
    throw runtimeError('정규수업 결석 처리 요청을 확인해 주세요.',400,'OLLI_AGENT_ABSENCE_INTENT_REQUIRED');
  }

  const groupMatch=safeText.match(/([ABab])\s*반/);
  return {
    subjectLabel,
    division,
    classGroup:groupMatch?groupMatch[1].toUpperCase():'AUTO',
  };
}

async function runAbsencePrepareAgent({
  agentContext,
  requestContext,
  preparedPrivacy,
  requestId,
  reason,
  replyToMessageId=null,
  requirePersistedMessage=false,
}) {
  const scope=resolveAbsencePrepareScope(preparedPrivacy);
  const {normalizeAbsenceReason}=require('./tools/absence-prepare-tools.cjs');
  const fixedReason=normalizeAbsenceReason(reason);
  assertOpenAiKey();

  const {Agent,run,tool,z}=await loadAgentsSdk();
  const {createPrepareAbsenceTool}=require('./tools/absence-prepare-tools.cjs');
  const {sanitizeAgentToolPayload}=require('./privacy.cjs');
  const model=agentModel();
  const today=todayInSeoul();
  let persistedMessage=null;

  const prepareAbsence=createPrepareAbsenceTool({
    tool,z,requestContext,
    subjectAccess:preparedPrivacy.subjectAccess,
    guestAccess:preparedPrivacy.waitlistGuestAccess,
    studentLabel:scope.subjectLabel,
    division:scope.division,
    classGroup:scope.classGroup,
    reason:fixedReason,
    currentDate:today,
    requestId,
    replyToMessageId,
    capturePersistedMessage(message){persistedMessage=pickupPersistedMessageForClient(message);},
    sanitizePayload(payload){return sanitizeWaitlistPayload(payload,preparedPrivacy,scope);},
  });

  const agent=new Agent({
    name:requirePersistedMessage?'Olli Absence Prepare':'Olli Absence Prepare Probe',
    model,
    instructions:[
      'You are the Olli regular-class absence preparation assistant.',
      'The user message has already been privacy-sanitized.',
      'The only available anonymous student label for this run is '+scope.subjectLabel+'.',
      'The server has fixed the student division to '+scope.division+'. Do not override it.',
      'The absence reason is private server-side context. It is not included in model input. Never ask for, infer, repeat, or invent it.',
      'Today in Korea is '+today+'.',
      'Always call prepare_absence exactly once before answering.',
      'If the user explicitly states a date, convert it to exact YYYY-MM-DD. If no date is stated, pass an empty session_date string so the server uses today, matching existing Olli behavior.',
      'If the user explicitly states a visible class time, pass class_hour and class_minute. For 4시 30분 or 4시 반 use 4 and 30. If no class time is stated, pass 0 and 0.',
      'The server rechecks the active regular enrollment for that date. If multiple classes remain it rejects instead of guessing.',
      'The tool creates a pending confirmation card only. It never directly changes attendance or writes the reason memo.',
      'Never say the student was marked absent. Say the absence is waiting for user confirmation.',
      'Never ask for, infer, or reveal a real student name, UUID, enrollment ID, internal time slot, member ID, session token, academy ID, action ID, message ID, or absence reason.',
      'Answer briefly in Korean.',
    ].join(' '),
    tools:[prepareAbsence],
    modelSettings:{toolChoice:'prepare_absence'},
    toolUseBehavior: requirePersistedMessage ? 'stop_on_first_tool' : 'run_llm_again',
  });

  let result=null,runError=null;
  try{
    result=await run(agent,preparedPrivacy.safeText,{context:agentContext});
  }catch(error){
    runError=error;
    if(!requirePersistedMessage||!persistedMessage) throw error;
  }

  const finalOutput=String(result?.finalOutput||'').trim();
  if(!finalOutput&&(!requirePersistedMessage||!persistedMessage)){
    throw runtimeError('결석 준비 Agent 응답이 비어 있습니다.',502,'OLLI_AGENT_EMPTY_ABSENCE_PREPARE_RESPONSE');
  }
  if(requirePersistedMessage&&!persistedMessage){
    throw runtimeError('결석 확인 카드 저장 결과를 확인하지 못했습니다.',502,'OLLI_AGENT_ABSENCE_PERSISTED_MESSAGE_MISSING');
  }

  return {
    ready:true,
    model,
    output:finalOutput,
    nodeVersion:process.versions.node,
    persistedMessage,
    recoveredAfterPersist:!!runError,
  };
}

async function runAbsencePrepareProbe({agentContext,requestContext,preparedPrivacy,requestId,reason}){
  return runAbsencePrepareAgent({
    agentContext,requestContext,preparedPrivacy,requestId,reason,
  });
}

function resolveClassOncePrepareScope(preparedPrivacy) {
  if (preparedPrivacy?.needsDisambiguation) {
    throw runtimeError(
      '학생 이름을 한 명으로 구분할 수 없습니다. 전체 이름으로 다시 알려 주세요.',
      409,
      'OLLI_AGENT_STUDENT_AMBIGUOUS'
    );
  }

  const subjectRefs=Array.isArray(preparedPrivacy?.subjectRefs)?preparedPrivacy.subjectRefs:[];
  if(subjectRefs.length!==1){
    throw runtimeError(
      '1회 수업 등록은 한 번에 학생 한 명만 지정해 주세요.',
      400,
      'OLLI_AGENT_CLASS_ONCE_SINGLE_STUDENT_REQUIRED'
    );
  }

  const subjectLabel=subjectRefs[0].label;
  const subject=preparedPrivacy?.subjectAccess?.resolve?.(subjectLabel);
  const division=String(subject?.division||'').trim().toLowerCase();
  if(!['elementary','kinder'].includes(division)){
    throw runtimeError(
      '1회 수업 등록 대상 학생의 수업 구분을 확인하지 못했습니다.',
      400,
      'OLLI_AGENT_CLASS_ONCE_DIVISION_REQUIRED'
    );
  }

  const safeText=String(preparedPrivacy?.safeText||'');
  const compact=safeText.replace(/\s+/g,'');
  const hasClass=/(?:수업|클래스)/.test(compact);
  const hasAdd=/(?:등록|추가|예약|신청|배정|넣|저장|잡아|올려)/.test(compact);
  const hasExcluded=/(?:보강|보충|체험|대기|웨이팅|결석|이동|변경|바꿔|바꾸|옮|취소|삭제|지워|지우|제거|빼|해제|없애|신규|신입|새학생|새원생|처음등록)/.test(compact);
  if(!hasClass||!hasAdd||hasExcluded){
    throw runtimeError(
      '일반 1회 수업 등록 요청을 확인하지 못했습니다.',
      400,
      'OLLI_AGENT_CLASS_ONCE_INTENT_REQUIRED'
    );
  }

  const hasDateSignal=/(?:오늘|내일|모레|이번\s*주|다음\s*주|다다음\s*주|월요일|화요일|수요일|목요일|금요일|토요일|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}[./]\d{1,2})/.test(safeText);
  const hasTimeSignal=/\d{1,2}\s*시/.test(safeText);
  if(!hasDateSignal||!hasTimeSignal){
    throw runtimeError(
      '1회 수업 등록에는 날짜와 수업 시간을 함께 알려 주세요.',
      400,
      'OLLI_AGENT_CLASS_ONCE_DATE_TIME_REQUIRED'
    );
  }

  let requestedDivision='';
  if(/(?:초등부|초등)/.test(safeText)) requestedDivision='elementary';
  else if(/(?:유치부|유치원|유치|유아)/.test(safeText)) requestedDivision='kinder';

  const groupMatch=safeText.match(/([ABab])\s*반/);
  return {
    subjectLabel,
    division,
    requestedDivision,
    classGroup:groupMatch?groupMatch[1].toUpperCase():'AUTO',
  };
}

async function runClassOncePrepareAgent({
  agentContext,
  requestContext,
  preparedPrivacy,
  requestId,
  replyToMessageId=null,
  requirePersistedMessage=false,
}) {
  const scope=resolveClassOncePrepareScope(preparedPrivacy);
  assertOpenAiKey();

  const {Agent,run,tool,z}=await loadAgentsSdk();
  const {createPrepareClassOnceTool}=require('./tools/class-once-prepare-tools.cjs');
  const {sanitizeAgentToolPayload}=require('./privacy.cjs');
  const model=agentModel();
  const today=todayInSeoul();
  let persistedMessage=null;

  const prepareClassOnce=createPrepareClassOnceTool({
    tool,
    z,
    requestContext,
    subjectAccess:preparedPrivacy.subjectAccess,
    studentLabel:scope.subjectLabel,
    division:scope.division,
    requestedDivision:scope.requestedDivision,
    classGroup:scope.classGroup,
    currentDate:today,
    requestId,
    replyToMessageId,
    capturePersistedMessage(message){
      persistedMessage=pickupPersistedMessageForClient(message);
    },
    sanitizePayload(payload){
      return sanitizeAgentToolPayload(payload,preparedPrivacy);
    },
  });

  const groupInstruction=scope.classGroup==='AUTO'
    ? 'The user did not explicitly select A반 or B반. The server must reject a split class rather than guessing.'
    : 'The server has fixed the requested class group to '+scope.classGroup+'. Do not override it.';

  const agent=new Agent({
    name:requirePersistedMessage?'Olli One-time Class Prepare':'Olli One-time Class Prepare Probe',
    model,
    instructions:[
      'You are the Olli one-time regular-class registration preparation assistant.',
      'This is a generic one-time class registration, not a makeup class, trial class, waitlist action, class move, or absence.',
      'The user message has already been privacy-sanitized.',
      'The only available anonymous student label for this run is '+scope.subjectLabel+'.',
      'The server has fixed the student division to '+scope.division+'. Do not override it.',
      groupInstruction,
      'Today in Korea is '+today+'.',
      'The server already confirmed that the user explicitly supplied both a date expression and a class time.',
      'Convert the requested date to exact YYYY-MM-DD using today as the reference. Do not invent a different date.',
      'Convert the visible class time to class_hour and class_minute. For 4시 30분 or 4시 반, use 4 and 30.',
      'Always call prepare_class_once exactly once before answering.',
      'The server rechecks active student status, requested division, operating slot, capacity, A/B group, and duplicate one-time sessions before storing the card.',
      'The tool creates a pending confirmation card only. It never directly registers the class.',
      'Never say the class was registered. Say that the registration is waiting for user confirmation.',
      'Never ask for, infer, or reveal a real student name, UUID, one-time-session ID, internal time slot, member ID, session token, academy ID, action ID, or message ID.',
      'Answer briefly in Korean.',
    ].join(' '),
    tools:[prepareClassOnce],
    modelSettings:{toolChoice:'prepare_class_once'},
    toolUseBehavior: requirePersistedMessage ? 'stop_on_first_tool' : 'run_llm_again',
  });

  let result=null;
  let runError=null;
  try{
    result=await run(agent,preparedPrivacy.safeText,{context:agentContext});
  }catch(error){
    runError=error;
    if(!requirePersistedMessage||!persistedMessage) throw error;
  }

  const finalOutput=String(result?.finalOutput||'').trim();
  if(!finalOutput&&(!requirePersistedMessage||!persistedMessage)){
    throw runtimeError(
      '1회 수업 준비 Agent 응답이 비어 있습니다.',
      502,
      'OLLI_AGENT_EMPTY_CLASS_ONCE_PREPARE_RESPONSE'
    );
  }
  if(requirePersistedMessage&&!persistedMessage){
    throw runtimeError(
      '1회 수업 확인 카드 저장 결과를 확인하지 못했습니다.',
      502,
      'OLLI_AGENT_CLASS_ONCE_PERSISTED_MESSAGE_MISSING'
    );
  }

  return {
    ready:true,
    model,
    output:finalOutput,
    nodeVersion:process.versions.node,
    persistedMessage,
    recoveredAfterPersist:!!runError,
  };
}

async function runClassOncePrepareProbe({
  agentContext,
  requestContext,
  preparedPrivacy,
  requestId,
}) {
  return runClassOncePrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId,
  });
}


function resolveMakeupPrepareScope(preparedPrivacy) {
  if (preparedPrivacy?.needsDisambiguation) {
    throw runtimeError(
      '학생 이름을 한 명으로 구분할 수 없습니다. 전체 이름으로 다시 알려 주세요.',
      409,
      'OLLI_AGENT_STUDENT_AMBIGUOUS'
    );
  }

  const subjectRefs = Array.isArray(preparedPrivacy?.subjectRefs)
    ? preparedPrivacy.subjectRefs
    : [];
  if (subjectRefs.length !== 1) {
    throw runtimeError(
      '보강 등록은 한 번에 학생 한 명만 지정해 주세요.',
      400,
      'OLLI_AGENT_MAKEUP_SINGLE_STUDENT_REQUIRED'
    );
  }

  const subjectLabel = subjectRefs[0].label;
  const subject = preparedPrivacy?.subjectAccess?.resolve?.(subjectLabel);
  const division = String(subject?.division || '').trim().toLowerCase();
  if (!['elementary', 'kinder'].includes(division)) {
    throw runtimeError(
      '보강 등록 대상 학생의 수업 구분을 확인하지 못했습니다.',
      400,
      'OLLI_AGENT_MAKEUP_DIVISION_REQUIRED'
    );
  }

  const safeText = String(preparedPrivacy?.safeText || '');
  const compact = safeText.replace(/\s+/g, '');
  const hasMakeup = /(?:보강|보충)/.test(compact);
  const hasAdd = /(?:등록|추가|예약|신청|배정|넣|저장|잡아)/.test(compact);
  const hasOtherMutation = /(?:변경|수정|바꿔|옮|취소|삭제|지워|지우|제거|빼|해제|없애)/.test(compact);

  if (!hasMakeup || !hasAdd || hasOtherMutation) {
    throw runtimeError(
      '보강 등록 요청을 확인하지 못했습니다.',
      400,
      'OLLI_AGENT_MAKEUP_ADD_INTENT_REQUIRED'
    );
  }

  const hasDateSignal = /(?:오늘|내일|모레|이번\s*주|다음\s*주|다다음\s*주|월요일|화요일|수요일|목요일|금요일|토요일|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}[./]\d{1,2})/.test(safeText);
  const hasTimeSignal = /\d{1,2}\s*시/.test(safeText);
  if (!hasDateSignal || !hasTimeSignal) {
    throw runtimeError(
      '보강 등록에는 날짜와 수업 시간을 함께 알려 주세요.',
      400,
      'OLLI_AGENT_MAKEUP_DATE_TIME_REQUIRED'
    );
  }

  const groupMatch = safeText.match(/([ABab])\s*반/);
  return {
    subjectLabel,
    division,
    classGroup:groupMatch ? groupMatch[1].toUpperCase() : 'AUTO',
  };
}

async function runMakeupPrepareAgent({
  agentContext,
  requestContext,
  preparedPrivacy,
  requestId,
  replyToMessageId = null,
  requirePersistedMessage = false,
}) {
  assertOpenAiKey();

  const scope = resolveMakeupPrepareScope(preparedPrivacy);
  const { Agent, run, tool, z } = await loadAgentsSdk();
  const { createPrepareMakeupTool } = require('./tools/makeup-prepare-tools.cjs');
  const { sanitizeAgentToolPayload } = require('./privacy.cjs');
  const model = agentModel();
  const today = todayInSeoul();
  let persistedMessage = null;
  let prepareError = null;
  let toolOutcome = null;

  const prepareMakeup = createPrepareMakeupTool({
    tool,
    z,
    requestContext,
    subjectAccess:preparedPrivacy.subjectAccess,
    studentLabel:scope.subjectLabel,
    division:scope.division,
    classGroup:scope.classGroup,
    currentDate:today,
    requestId,
    replyToMessageId,
    capturePersistedMessage(message) {
      persistedMessage = pickupPersistedMessageForClient(message);
    },
    capturePrepareError(error) {
      prepareError = error;
    },
    captureToolOutcome(outcome) {
      toolOutcome = outcome;
    },
    sanitizePayload(payload) {
      return sanitizeAgentToolPayload(payload, preparedPrivacy);
    },
  });

  const groupInstruction = scope.classGroup === 'AUTO'
    ? 'The user did not explicitly select A반 or B반. The server must reject a split class rather than guessing.'
    : 'The server has fixed the requested class group to ' + scope.classGroup + '. Do not override it.';

  const agent = new Agent({
    name:requirePersistedMessage ? 'Olli Makeup Prepare' : 'Olli Makeup Prepare Probe',
    model,
    instructions:[
      'You are the Olli makeup-class preparation assistant.',
      'The user message has already been privacy-sanitized.',
      'The only available anonymous student label for this run is ' + scope.subjectLabel + '.',
      'The server has fixed the student division to ' + scope.division + '. Do not override it.',
      groupInstruction,
      'Today in Korea is ' + today + '.',
      'The server already confirmed that the user explicitly supplied both a date expression and a class time.',
      'Convert the requested date to exact YYYY-MM-DD using today as the reference. Do not invent a different date.',
      'Convert the visible class time to class_hour and class_minute. For expressions such as 4시 반, use class_minute 30.',
      'Always call prepare_makeup exactly once before answering.',
      'The tool resolves the actual stored timetable slot from current server availability. Never invent or expose an internal time_slot.',
      'The tool returns one of three business outcomes: pending, needs_clarification, or blocked.',
      'If status is pending, a confirmation card was saved. Never say the makeup was registered.',
      'If status is needs_clarification or blocked, return the tool result without inventing a choice or a different schedule.',
      'Never ask for, infer, or reveal a real student name, UUID, member ID, session token, academy ID, action ID, message ID, or internal time slot.',
      'Answer briefly in Korean.',
    ].join(' '),
    tools:[prepareMakeup],
    modelSettings:{toolChoice:'prepare_makeup'},
    toolUseBehavior: requirePersistedMessage ? 'stop_on_first_tool' : 'run_llm_again',
  });

  let result = null;
  let runError = null;
  try {
    result = await run(agent, preparedPrivacy.safeText, {
      context:agentContext,
    });
  } catch (error) {
    runError = error;
    if (!requirePersistedMessage || !persistedMessage) throw error;
  }

  if (requirePersistedMessage && !persistedMessage && prepareError) {
    throw prepareError;
  }

  const interactionStatus=String(toolOutcome?.status || '').trim();
  const conversationalOutcome=['needs_clarification','blocked'].includes(interactionStatus);

  let dialogueOutput='';
  if(requirePersistedMessage && !persistedMessage && conversationalOutcome){
    const dialogueAgent=new Agent({
      name:'Olli Makeup Dialogue',
      model,
      instructions:[
        'You are Olli, continuing a Korean academy-operation conversation.',
        'You receive only a privacy-safe structured makeup tool result.',
        'If status is needs_clarification, ask exactly one short natural Korean follow-up question.',
        'If reason is class_group_required, ask which returned class group the user wants. Do not choose one yourself.',
        'If status is blocked, explain the reason briefly and naturally. Do not call it a system error.',
        'Do not mention internal status names, reason codes, anonymous student labels, UUIDs, IDs, or internal time slots.',
        'Use only facts present in the structured result. Do not invent availability or schedule data.',
      ].join(' '),
    });
    const dialogueResult=await run(
      dialogueAgent,
      JSON.stringify(toolOutcome),
      {context:agentContext}
    );
    dialogueOutput=String(dialogueResult?.finalOutput || '').trim();
  }

  const finalOutput = dialogueOutput || String(result?.finalOutput || '').trim();
  if (!finalOutput && (!requirePersistedMessage || !persistedMessage || conversationalOutcome)) {
    throw runtimeError(
      '보강 등록 준비 Agent 응답이 비어 있습니다.',
      502,
      'OLLI_AGENT_EMPTY_MAKEUP_PREPARE_RESPONSE'
    );
  }
  if (requirePersistedMessage && !persistedMessage && !conversationalOutcome) {
    throw runtimeError(
      '보강 확인 카드 저장 결과를 확인하지 못했습니다.',
      502,
      'OLLI_AGENT_MAKEUP_PERSISTED_MESSAGE_MISSING'
    );
  }

  return {
    ready:true,
    model,
    output:finalOutput,
    nodeVersion:process.versions.node,
    persistedMessage,
    interactionStatus:conversationalOutcome ? interactionStatus : '',
    interaction:conversationalOutcome ? toolOutcome : null,
    recoveredAfterPersist:!!runError,
  };
}

async function runMakeupPrepareProbe({
  agentContext,
  requestContext,
  preparedPrivacy,
  requestId,
}) {
  return runMakeupPrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId,
  });
}

function resolveMakeupUpdatePrepareScope(preparedPrivacy) {
  if (preparedPrivacy?.needsDisambiguation) {
    throw runtimeError(
      '학생 이름을 한 명으로 구분할 수 없습니다. 전체 이름으로 다시 알려 주세요.',
      409,
      'OLLI_AGENT_STUDENT_AMBIGUOUS'
    );
  }

  const subjectRefs = Array.isArray(preparedPrivacy?.subjectRefs)
    ? preparedPrivacy.subjectRefs
    : [];
  if (subjectRefs.length !== 1) {
    throw runtimeError(
      '보강 변경은 한 번에 학생 한 명만 지정해 주세요.',
      400,
      'OLLI_AGENT_MAKEUP_UPDATE_SINGLE_STUDENT_REQUIRED'
    );
  }

  const subjectLabel = subjectRefs[0].label;
  const subject = preparedPrivacy?.subjectAccess?.resolve?.(subjectLabel);
  const division = String(subject?.division || '').trim().toLowerCase();
  if (!['elementary', 'kinder'].includes(division)) {
    throw runtimeError(
      '보강 변경 대상 학생의 수업 구분을 확인하지 못했습니다.',
      400,
      'OLLI_AGENT_MAKEUP_UPDATE_DIVISION_REQUIRED'
    );
  }

  const safeText = String(preparedPrivacy?.safeText || '');
  const compact = safeText.replace(/\s+/g, '');
  const hasMakeup = /(?:보강|보충)/.test(compact);
  const hasUpdate = /(?:변경|수정|바꿔|바꾸|옮겨|옮기|이동)/.test(compact);
  const hasRemove = /(?:취소|삭제|지워|지우|제거|빼|해제|없애)/.test(compact);

  if (!hasMakeup || !hasUpdate || hasRemove) {
    throw runtimeError(
      '보강 변경 요청을 확인하지 못했습니다.',
      400,
      'OLLI_AGENT_MAKEUP_UPDATE_INTENT_REQUIRED'
    );
  }

  return { subjectLabel, division };
}


function structuredMakeupUpdateDateKey(value, currentDate) {
  const expression = String(value == null ? '' : value).trim();
  if (!expression) return '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(expression)) {
    const exact = new Date(expression + 'T12:00:00Z');
    if (!Number.isNaN(exact.getTime()) && exact.toISOString().slice(0, 10) === expression) {
      return expression;
    }
  }

  const router = loadSharedCommandRouter();
  const spec = router.parseDateExpression(expression.replace(/\s+/g, ''));
  const base = new Date(String(currentDate || '') + 'T12:00:00Z');
  const resolved = spec && !Number.isNaN(base.getTime())
    ? router.resolveDateExpression(spec, base)
    : null;
  if (!resolved || Number.isNaN(resolved.getTime())) {
    throw runtimeError(
      '보강 날짜 표현을 확인하지 못했습니다.',
      400,
      'OLLI_ROUTINE_MAKEUP_UPDATE_DATE_INVALID'
    );
  }
  return resolved.toISOString().slice(0, 10);
}

async function runStructuredMakeupUpdatePrepare({
  requestContext,
  structuredCommand,
  sourceMessageId,
  sourceMessageText,
}) {
  const sourceId = Number(sourceMessageId || 0);
  if (!Number.isSafeInteger(sourceId) || sourceId <= 0) {
    throw runtimeError(
      '원문 Team Chat 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_ROUTINE_MAKEUP_UPDATE_SOURCE_MESSAGE_INVALID'
    );
  }

  await validateMakeupSourceMessage({
    requestContext,
    sourceMessageId:sourceId,
    sourceMessageText,
  });

  const command = structuredCommand && typeof structuredCommand === 'object'
    ? structuredCommand
    : {};
  if (String(command.action || '').trim() !== 'update_makeup') {
    throw runtimeError(
      '보강 변경 구조화 명령을 확인하지 못했습니다.',
      400,
      'OLLI_ROUTINE_MAKEUP_UPDATE_ACTION_INVALID'
    );
  }

  const studentName = String(command.studentName || '').trim();
  const sourceDateExpression = String(command.sourceDateExpression || '').trim();
  if (!studentName || !sourceDateExpression) {
    throw runtimeError(
      '보강 변경에는 학생 이름과 기존 보강 날짜가 필요합니다.',
      400,
      'OLLI_ROUTINE_MAKEUP_UPDATE_FACTS_REQUIRED'
    );
  }

  const {
    resolveStudentReferences,
    createSubjectAccess,
  } = require('./student-reference-resolver.cjs');
  const resolution = await resolveStudentReferences(studentName, requestContext);
  if (Array.isArray(resolution?.ambiguous) && resolution.ambiguous.length) {
    throw runtimeError(
      '학생 이름을 한 명으로 구분할 수 없습니다. 전체 이름으로 다시 알려 주세요.',
      409,
      'OLLI_ROUTINE_MAKEUP_UPDATE_STUDENT_AMBIGUOUS'
    );
  }
  const resolvedStudents = Array.isArray(resolution?.resolved)
    ? resolution.resolved
    : [];
  if (resolvedStudents.length !== 1) {
    throw runtimeError(
      '보강을 변경할 학생을 한 명으로 확인하지 못했습니다.',
      404,
      'OLLI_ROUTINE_MAKEUP_UPDATE_STUDENT_NOT_FOUND'
    );
  }

  const subject = resolvedStudents[0];
  const division = String(subject?.student?.division || '').trim().toLowerCase();
  if (!['elementary', 'kinder'].includes(division)) {
    throw runtimeError(
      '보강 변경 대상 학생의 수업 구분을 확인하지 못했습니다.',
      400,
      'OLLI_ROUTINE_MAKEUP_UPDATE_DIVISION_REQUIRED'
    );
  }

  const today = todayInSeoul();
  const sourceDate = structuredMakeupUpdateDateKey(sourceDateExpression, today);
  const targetDateExpression = String(command.targetDateExpression || '').trim();
  const targetDate = targetDateExpression
    ? structuredMakeupUpdateDateKey(targetDateExpression, today)
    : '';

  const { prepareMakeupUpdateAction } = require('./tools/makeup-update-prepare-tools.cjs');
  let persistedMessage = null;
  await prepareMakeupUpdateAction({
    requestContext,
    subjectAccess:createSubjectAccess(resolution),
    studentLabel:subject.label,
    division,
    sourceDate,
    sourceHour:Number(command.sourceTimeSlot || 0),
    sourceMinute:Number(command.sourceMinute || 0),
    sourceGroup:String(command.sourceClassGroup || '').trim().toUpperCase() || 'AUTO',
    targetDate,
    targetHour:Number(command.targetTimeSlot || 0),
    targetMinute:Number(command.targetMinute || 0),
    targetGroup:String(command.targetClassGroup || '').trim().toUpperCase() || 'AUTO',
    currentDate:today,
    requestId:'team-chat-message:' + sourceId,
    replyToMessageId:sourceId,
    capturePersistedMessage(message) {
      persistedMessage = pickupPersistedMessageForClient(message);
    },
    sanitizePayload(payload) {
      return payload;
    },
  });

  if (!persistedMessage?.action || String(persistedMessage.action.action_type || '').trim() !== 'update_makeup') {
    throw runtimeError(
      '보강 변경 확인 카드 저장 결과를 확인하지 못했습니다.',
      502,
      'OLLI_ROUTINE_MAKEUP_UPDATE_PERSISTED_MESSAGE_MISSING'
    );
  }

  return {
    ready:true,
    persistedMessage,
    recoveredAfterPersist:false,
  };
}



async function runStructuredMakeupCancelPrepare({
  requestContext,
  structuredCommand,
  sourceMessageId,
  sourceMessageText,
  reasonMessageId,
  reasonMessageText,
  reason,
}) {
  const sourceId=Number(sourceMessageId || 0);
  const reasonId=Number(reasonMessageId || 0);
  if(!Number.isSafeInteger(sourceId) || sourceId<=0){
    throw runtimeError(
      '원문 Team Chat 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_ROUTINE_MAKEUP_CANCEL_SOURCE_MESSAGE_INVALID'
    );
  }
  if(!Number.isSafeInteger(reasonId) || reasonId<=0){
    throw runtimeError(
      '보강 취소 사유 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_ROUTINE_MAKEUP_CANCEL_REASON_MESSAGE_INVALID'
    );
  }

  const command=structuredCommand && typeof structuredCommand==='object'
    ? structuredCommand
    : {};
  if(String(command.action || '').trim()!=='cancel_makeup'){
    throw runtimeError(
      '보강 취소 구조화 명령을 확인하지 못했습니다.',
      400,
      'OLLI_ROUTINE_MAKEUP_CANCEL_ACTION_INVALID'
    );
  }

  await validateMakeupSourceMessage({
    requestContext,
    sourceMessageId:sourceId,
    sourceMessageText,
  });
  const validatedReason=await validateMakeupReasonMessage({
    requestContext,
    reasonMessageId:reasonId,
    reasonMessageText,
    reason,
  });

  const studentName=String(command.studentName || '').trim();
  if(!studentName){
    throw runtimeError(
      '보강을 취소할 학생 이름이 필요합니다.',
      400,
      'OLLI_ROUTINE_MAKEUP_CANCEL_STUDENT_REQUIRED'
    );
  }

  const {
    resolveStudentReferences,
    createSubjectAccess,
  }=require('./student-reference-resolver.cjs');
  const resolution=await resolveStudentReferences(studentName,requestContext);
  if(Array.isArray(resolution?.ambiguous) && resolution.ambiguous.length){
    throw runtimeError(
      '학생 이름을 한 명으로 구분할 수 없습니다. 전체 이름으로 다시 알려 주세요.',
      409,
      'OLLI_ROUTINE_MAKEUP_CANCEL_STUDENT_AMBIGUOUS'
    );
  }
  const resolvedStudents=Array.isArray(resolution?.resolved)
    ? resolution.resolved
    : [];
  if(resolvedStudents.length!==1){
    throw runtimeError(
      '보강을 취소할 학생을 한 명으로 확인하지 못했습니다.',
      404,
      'OLLI_ROUTINE_MAKEUP_CANCEL_STUDENT_NOT_FOUND'
    );
  }

  const subject=resolvedStudents[0];
  const division=String(subject?.student?.division || '').trim().toLowerCase();
  if(!['elementary','kinder'].includes(division)){
    throw runtimeError(
      '보강 취소 대상 학생의 수업 구분을 확인하지 못했습니다.',
      400,
      'OLLI_ROUTINE_MAKEUP_CANCEL_DIVISION_REQUIRED'
    );
  }

  const today=todayInSeoul();
  const dateExpression=String(command.dateExpression || '').trim();
  const sessionDate=dateExpression
    ? structuredMakeupUpdateDateKey(dateExpression,today)
    : '';

  const {prepareMakeupCancelAction}=require('./tools/makeup-cancel-prepare-tools.cjs');
  let persistedMessage=null;
  await prepareMakeupCancelAction({
    requestContext,
    subjectAccess:createSubjectAccess(resolution),
    studentLabel:subject.label,
    division,
    classGroup:String(command.classGroup || '').trim().toUpperCase() || 'AUTO',
    sessionDate,
    classHour:Number(command.timeSlot || 0),
    classMinute:Number(command.classMinute || 0),
    reason:validatedReason.reason,
    currentDate:today,
    requestId:'team-chat-makeup-cancel:'+sourceId+':'+reasonId,
    replyToMessageId:reasonId,
    capturePersistedMessage(message){
      persistedMessage=pickupPersistedMessageForClient(message);
    },
    sanitizePayload(payload){
      return payload;
    },
  });

  if(!persistedMessage?.action || String(persistedMessage.action.action_type || '').trim()!=='cancel_makeup'){
    throw runtimeError(
      '보강 취소 확인 카드 저장 결과를 확인하지 못했습니다.',
      502,
      'OLLI_ROUTINE_MAKEUP_CANCEL_PERSISTED_MESSAGE_MISSING'
    );
  }

  return {
    ready:true,
    persistedMessage,
    recoveredAfterPersist:false,
  };
}


async function runMakeupUpdatePrepareAgent({
  agentContext,
  requestContext,
  preparedPrivacy,
  requestId,
  replyToMessageId = null,
  requirePersistedMessage = false,
}) {
  assertOpenAiKey();

  const scope = resolveMakeupUpdatePrepareScope(preparedPrivacy);
  const { Agent, run, tool, z } = await loadAgentsSdk();
  const { createPrepareMakeupUpdateTool } = require('./tools/makeup-update-prepare-tools.cjs');
  const { sanitizeAgentToolPayload } = require('./privacy.cjs');
  const model = agentModel();
  const today = todayInSeoul();
  let persistedMessage = null;

  const prepareMakeupUpdate = createPrepareMakeupUpdateTool({
    tool,
    z,
    requestContext,
    subjectAccess:preparedPrivacy.subjectAccess,
    studentLabel:scope.subjectLabel,
    division:scope.division,
    currentDate:today,
    requestId,
    replyToMessageId,
    capturePersistedMessage(message) {
      persistedMessage = pickupPersistedMessageForClient(message);
    },
    sanitizePayload(payload) {
      return sanitizeAgentToolPayload(payload, preparedPrivacy);
    },
  });

  const agent = new Agent({
    name:requirePersistedMessage ? 'Olli Makeup Update Prepare' : 'Olli Makeup Update Prepare Probe',
    model,
    instructions:[
      'You are the Olli makeup-update preparation assistant.',
      'The user message has already been privacy-sanitized.',
      'The only available anonymous student label for this run is ' + scope.subjectLabel + '.',
      'The server has fixed the student division to ' + scope.division + '. Do not override it.',
      'Today in Korea is ' + today + '.',
      'Always call prepare_makeup_update exactly once before answering.',
      'source_date identifies the existing makeup date and is required. Convert relative source dates to exact YYYY-MM-DD.',
      'For the existing makeup time, pass source_hour and source_minute only when the user identifies it. Otherwise pass 0 and 0.',
      'For the existing makeup group, use A or B only when the user identifies the old group. Otherwise use AUTO.',
      'For the new date, use exact target_date only when the user changes the date. Otherwise pass an empty string.',
      'For the new visible time, pass target_hour and target_minute only when the user changes the time. Otherwise pass 0 and 0.',
      'For the new group, use A or B only when the user explicitly requests the new group. Otherwise use AUTO.',
      'For A반에서 B반으로 변경, source_group must be A and target_group must be B.',
      'The server re-resolves the existing makeup row and the target availability. It never trusts or exposes an internal time_slot.',
      'The tool creates a pending confirmation card only. It never directly changes the makeup class.',
      'Never say the makeup was changed. Say that the change is waiting for user confirmation.',
      'Never ask for, infer, or reveal a real student name, UUID, one-time-session ID, member ID, session token, academy ID, action ID, message ID, or internal time slot.',
      'Answer briefly in Korean.',
    ].join(' '),
    tools:[prepareMakeupUpdate],
    modelSettings:{toolChoice:'prepare_makeup_update'},
    toolUseBehavior: requirePersistedMessage ? 'stop_on_first_tool' : 'run_llm_again',
  });

  let result = null;
  let runError = null;
  try {
    result = await run(agent, preparedPrivacy.safeText, {
      context:agentContext,
    });
  } catch (error) {
    runError = error;
    if (!requirePersistedMessage || !persistedMessage) throw error;
  }

  const finalOutput = String(result?.finalOutput || '').trim();
  if (!finalOutput && (!requirePersistedMessage || !persistedMessage)) {
    throw runtimeError(
      '보강 변경 준비 Agent 응답이 비어 있습니다.',
      502,
      'OLLI_AGENT_EMPTY_MAKEUP_UPDATE_PREPARE_RESPONSE'
    );
  }
  if (requirePersistedMessage && !persistedMessage) {
    throw runtimeError(
      '보강 변경 확인 카드 저장 결과를 확인하지 못했습니다.',
      502,
      'OLLI_AGENT_MAKEUP_UPDATE_PERSISTED_MESSAGE_MISSING'
    );
  }

  return {
    ready:true,
    model,
    output:finalOutput,
    nodeVersion:process.versions.node,
    persistedMessage,
    recoveredAfterPersist:!!runError,
  };
}

async function runMakeupUpdatePrepareProbe({
  agentContext,
  requestContext,
  preparedPrivacy,
  requestId,
}) {
  return runMakeupUpdatePrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId,
  });
}

function resolveMakeupCancelPrepareScope(preparedPrivacy) {
  if (preparedPrivacy?.needsDisambiguation) {
    throw runtimeError(
      '학생 이름을 한 명으로 구분할 수 없습니다. 전체 이름으로 다시 알려 주세요.',
      409,
      'OLLI_AGENT_STUDENT_AMBIGUOUS'
    );
  }

  const subjectRefs = Array.isArray(preparedPrivacy?.subjectRefs)
    ? preparedPrivacy.subjectRefs
    : [];
  if (subjectRefs.length !== 1) {
    throw runtimeError(
      '보강 취소는 한 번에 학생 한 명만 지정해 주세요.',
      400,
      'OLLI_AGENT_MAKEUP_CANCEL_SINGLE_STUDENT_REQUIRED'
    );
  }

  const subjectLabel = subjectRefs[0].label;
  const subject = preparedPrivacy?.subjectAccess?.resolve?.(subjectLabel);
  const division = String(subject?.division || '').trim().toLowerCase();
  if (!['elementary', 'kinder'].includes(division)) {
    throw runtimeError(
      '보강 취소 대상 학생의 수업 구분을 확인하지 못했습니다.',
      400,
      'OLLI_AGENT_MAKEUP_CANCEL_DIVISION_REQUIRED'
    );
  }

  const safeText = String(preparedPrivacy?.safeText || '');
  const compact = safeText.replace(/\s+/g, '');
  const hasMakeup = /(?:보강|보충)/.test(compact);
  const hasRemove = /(?:취소|삭제|지워|지우|제거|빼|해제|없애)/.test(compact);
  const hasOtherMutation = /(?:등록|추가|예약|신청|배정|넣|저장|잡아|변경|수정|바꿔|옮)/.test(compact);

  if (!hasMakeup || !hasRemove || hasOtherMutation) {
    throw runtimeError(
      '보강 취소 요청을 확인하지 못했습니다.',
      400,
      'OLLI_AGENT_MAKEUP_CANCEL_INTENT_REQUIRED'
    );
  }

  const groupMatch = safeText.match(/([ABab])\s*반/);
  return {
    subjectLabel,
    division,
    classGroup:groupMatch ? groupMatch[1].toUpperCase() : 'AUTO',
  };
}

async function runMakeupCancelPrepareAgent({
  agentContext,
  requestContext,
  preparedPrivacy,
  requestId,
  reason,
  replyToMessageId = null,
  requirePersistedMessage = false,
}) {
  const scope = resolveMakeupCancelPrepareScope(preparedPrivacy);
  const { normalizeMakeupCancelReason } = require('./tools/makeup-cancel-prepare-tools.cjs');
  const fixedReason = normalizeMakeupCancelReason(reason);
  assertOpenAiKey();
  const { Agent, run, tool, z } = await loadAgentsSdk();
  const { createPrepareMakeupCancelTool } = require('./tools/makeup-cancel-prepare-tools.cjs');
  const { sanitizeAgentToolPayload } = require('./privacy.cjs');
  const model = agentModel();
  const today = todayInSeoul();
  let persistedMessage = null;

  const prepareMakeupCancel = createPrepareMakeupCancelTool({
    tool,
    z,
    requestContext,
    subjectAccess:preparedPrivacy.subjectAccess,
    studentLabel:scope.subjectLabel,
    division:scope.division,
    classGroup:scope.classGroup,
    reason:fixedReason,
    currentDate:today,
    requestId,
    replyToMessageId,
    capturePersistedMessage(message) {
      persistedMessage = pickupPersistedMessageForClient(message);
    },
    sanitizePayload(payload) {
      return sanitizeAgentToolPayload(payload, preparedPrivacy);
    },
  });

  const groupInstruction = scope.classGroup === 'AUTO'
    ? 'The user did not explicitly select A반 or B반. The server must not guess a group if multiple rows still match.'
    : 'The server has fixed the requested class group to ' + scope.classGroup + '. Do not override it.';

  const agent = new Agent({
    name:requirePersistedMessage ? 'Olli Makeup Cancel Prepare' : 'Olli Makeup Cancel Prepare Probe',
    model,
    instructions:[
      'You are the Olli makeup-cancellation preparation assistant.',
      'The user message has already been privacy-sanitized.',
      'The only available anonymous student label for this run is ' + scope.subjectLabel + '.',
      'The server has fixed the student division to ' + scope.division + '. Do not override it.',
      groupInstruction,
      'Today in Korea is ' + today + '.',
      'Always call prepare_makeup_cancel exactly once before answering.',
      'If the user explicitly names a date, convert it to exact YYYY-MM-DD. If no date is present, pass an empty session_date string.',
      'If the user explicitly names a class time, convert the visible time to class_hour and class_minute. For 4시 반 use 4 and 30. If no time is present, pass 0 and 0.',
      'The cancellation reason is private server-side context. It is not included in model input or the tool schema. Never ask for, infer, repeat, summarize, translate, or invent it.',
      'The server validates the stored reason message and re-resolves the current stored makeup row before creating the card.',
      'The tool creates a pending confirmation card only. It never directly cancels a makeup class.',
      'Never say the makeup was cancelled. Say that the cancellation is waiting for user confirmation.',
      'Never ask for, infer, or reveal a real student name, UUID, one-time-session ID, member ID, session token, academy ID, action ID, message ID, or internal time slot.',
      'Answer briefly in Korean.',
    ].join(' '),
    tools:[prepareMakeupCancel],
    modelSettings:{toolChoice:'prepare_makeup_cancel'},
    toolUseBehavior: requirePersistedMessage ? 'stop_on_first_tool' : 'run_llm_again',
  });

  let result = null;
  let runError = null;
  try {
    result = await run(agent, preparedPrivacy.safeText, {
      context:agentContext,
    });
  } catch (error) {
    runError = error;
    if (!requirePersistedMessage || !persistedMessage) throw error;
  }

  const finalOutput = String(result?.finalOutput || '').trim();
  if (!finalOutput && (!requirePersistedMessage || !persistedMessage)) {
    throw runtimeError(
      '보강 취소 준비 Agent 응답이 비어 있습니다.',
      502,
      'OLLI_AGENT_EMPTY_MAKEUP_CANCEL_PREPARE_RESPONSE'
    );
  }
  if (requirePersistedMessage && !persistedMessage) {
    throw runtimeError(
      '보강 취소 확인 카드 저장 결과를 확인하지 못했습니다.',
      502,
      'OLLI_AGENT_MAKEUP_CANCEL_PERSISTED_MESSAGE_MISSING'
    );
  }

  return {
    ready:true,
    model,
    output:finalOutput,
    nodeVersion:process.versions.node,
    persistedMessage,
    recoveredAfterPersist:!!runError,
  };
}

async function runMakeupCancelPrepareProbe({
  agentContext,
  requestContext,
  preparedPrivacy,
  requestId,
  reason,
}) {
  return runMakeupCancelPrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId,
    reason,
  });
}

function resolveTrialAddPrepareScope(preparedPrivacy){
  if(preparedPrivacy?.needsDisambiguation){
    throw runtimeError('체험 학생 이름을 하나로 구분할 수 없습니다.',409,'OLLI_AGENT_TRIAL_GUEST_AMBIGUOUS');
  }
  const subjectRefs=Array.isArray(preparedPrivacy?.subjectRefs)?preparedPrivacy.subjectRefs:[];
  if(subjectRefs.length!==1){
    throw runtimeError('체험 등록은 한 번에 학생 한 명만 지정해 주세요.',400,'OLLI_AGENT_TRIAL_ADD_SINGLE_GUEST_REQUIRED');
  }
  const guestLabel=subjectRefs[0].label;
  const guest=preparedPrivacy?.trialAccess?.resolve?.(guestLabel);
  const division=String(guest?.division||'').trim().toLowerCase();
  if(!guest?.guestName){
    throw runtimeError('체험할 학생 이름을 확인하지 못했습니다.',400,'OLLI_AGENT_TRIAL_GUEST_REQUIRED');
  }
  if(!['elementary','kinder'].includes(division)){
    throw runtimeError('체험 등록은 유치부인지 초등부인지 함께 알려 주세요.',400,'OLLI_AGENT_TRIAL_ADD_DIVISION_REQUIRED');
  }

  const safeText=String(preparedPrivacy?.safeText||'');
  const compact=safeText.replace(/\s+/g,'');
  const hasTrial=/(?:체험클래스|체험수업|체험)/.test(compact);
  const hasAdd=/(?:등록|추가|신청|예약|배정|넣|저장|잡아)/.test(compact);
  const hasOtherMutation=/(?:변경|수정|바꿔|바꾸|옮|이동|고쳐|고치|취소|삭제|지워|지우|제거|빼|해제|없애)/.test(compact);
  if(!hasTrial||!hasAdd||hasOtherMutation){
    throw runtimeError('체험 등록 요청을 확인하지 못했습니다.',400,'OLLI_AGENT_TRIAL_ADD_INTENT_REQUIRED');
  }

  const hasDateSignal=/(?:오늘|내일|모레|이번\s*주|다음\s*주|다다음\s*주|월요일|화요일|수요일|목요일|금요일|토요일|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}[./]\d{1,2})/.test(safeText);
  const hasTimeSignal=/\d{1,2}\s*시/.test(safeText);
  if(!hasDateSignal||!hasTimeSignal){
    throw runtimeError('체험 등록에는 날짜와 수업 시간을 함께 알려 주세요.',400,'OLLI_AGENT_TRIAL_ADD_DATE_TIME_REQUIRED');
  }

  const groupMatch=safeText.match(/([ABab])\s*반/);
  return {
    guestLabel,
    division,
    classGroup:groupMatch?groupMatch[1].toUpperCase():'AUTO',
  };
}

async function runTrialAddPrepareAgent({
  agentContext,requestContext,preparedPrivacy,requestId,
  replyToMessageId=null,requirePersistedMessage=false,
}){
  const scope=resolveTrialAddPrepareScope(preparedPrivacy);
  assertOpenAiKey();
  const {Agent,run,tool,z}=await loadAgentsSdk();
  const {createPrepareTrialAddTool}=require('./tools/trial-add-prepare-tools.cjs');
  const {sanitizeTrialToolPayload}=require('./trial-guest-privacy.cjs');
  const model=agentModel();
  const today=todayInSeoul();
  let persistedMessage=null;

  const prepareTrialAdd=createPrepareTrialAddTool({
    tool,z,requestContext,
    trialAccess:preparedPrivacy.trialAccess,
    guestLabel:scope.guestLabel,
    division:scope.division,
    classGroup:scope.classGroup,
    currentDate:today,
    requestId,
    replyToMessageId,
    capturePersistedMessage(message){persistedMessage=pickupPersistedMessageForClient(message);},
    sanitizePayload(payload){return sanitizeTrialToolPayload(payload,preparedPrivacy);},
  });

  const groupInstruction=scope.classGroup==='AUTO'
    ? 'The user did not explicitly select A반 or B반. The server must reject a split class rather than guessing.'
    : 'The server has fixed the requested class group to '+scope.classGroup+'. Do not override it.';

  const agent=new Agent({
    name:requirePersistedMessage?'Olli Trial Add Prepare':'Olli Trial Add Prepare Probe',
    model,
    instructions:[
      'You are the Olli trial-class registration preparation assistant.',
      'The user message has already been privacy-sanitized.',
      'The real guest name is private. The only available anonymous label is '+scope.guestLabel+'.',
      'The server has fixed the division to '+scope.division+'. Do not override it.',
      groupInstruction,
      'Today in Korea is '+today+'.',
      'The server already confirmed that the user explicitly supplied both a date expression and a class time.',
      'Convert the requested date to exact YYYY-MM-DD using today as the reference. Do not invent a different date.',
      'Convert the visible class time to class_hour and class_minute. For expressions such as 4시 반, use class_minute 30.',
      'Always call prepare_trial_add exactly once before answering.',
      'The server rechecks current trial availability and duplicate guest trials before storing the card.',
      'The tool creates a pending confirmation card only. It never directly registers a trial class.',
      'Never say the trial was registered. Say that the registration is waiting for user confirmation.',
      'Never ask for, infer, or reveal the real guest name, UUID, one-time-session ID, internal time slot, member ID, session token, academy ID, action ID, or message ID.',
      'Answer briefly in Korean.',
    ].join(' '),
    tools:[prepareTrialAdd],
    modelSettings:{toolChoice:'prepare_trial_add'},
    toolUseBehavior: requirePersistedMessage ? 'stop_on_first_tool' : 'run_llm_again',
  });

  let result=null,runError=null;
  try{
    result=await run(agent,preparedPrivacy.safeText,{context:agentContext});
  }catch(error){
    runError=error;
    if(!requirePersistedMessage||!persistedMessage) throw error;
  }

  const finalOutput=String(result?.finalOutput||'').trim();
  if(!finalOutput&&(!requirePersistedMessage||!persistedMessage)){
    throw runtimeError('체험 등록 준비 Agent 응답이 비어 있습니다.',502,'OLLI_AGENT_EMPTY_TRIAL_ADD_PREPARE_RESPONSE');
  }
  if(requirePersistedMessage&&!persistedMessage){
    throw runtimeError('체험 등록 확인 카드 저장 결과를 확인하지 못했습니다.',502,'OLLI_AGENT_TRIAL_ADD_PERSISTED_MESSAGE_MISSING');
  }
  return {ready:true,model,output:finalOutput,nodeVersion:process.versions.node,persistedMessage,recoveredAfterPersist:!!runError};
}

async function runTrialAddPrepareProbe({agentContext,requestContext,preparedPrivacy,requestId}){
  return runTrialAddPrepareAgent({agentContext,requestContext,preparedPrivacy,requestId});
}

async function runTrialAddPrepare({
  agentContext,
  requestContext,
  preparedPrivacy,
  sourceMessageId,
  sourceMessageText,
}){
  const sourceId=Number(sourceMessageId||0);
  if(!Number.isSafeInteger(sourceId)||sourceId<=0){
    throw runtimeError(
      '원문 Team Chat 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_AGENT_TRIAL_SOURCE_MESSAGE_INVALID'
    );
  }

  await validateTrialSourceMessage({
    requestContext,
    sourceMessageId:sourceId,
    sourceMessageText,
  });

  return runTrialAddPrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId:'team-chat-message:'+sourceId,
    replyToMessageId:sourceId,
    requirePersistedMessage:true,
  });
}


function resolveTrialCancelPrepareScope(preparedPrivacy){
  if(preparedPrivacy?.needsDisambiguation){
    throw runtimeError('체험 학생 이름을 하나로 구분할 수 없습니다.',409,'OLLI_AGENT_TRIAL_GUEST_AMBIGUOUS');
  }
  const subjectRefs=Array.isArray(preparedPrivacy?.subjectRefs)?preparedPrivacy.subjectRefs:[];
  if(subjectRefs.length!==1){
    throw runtimeError('체험 취소는 한 번에 학생 한 명만 지정해 주세요.',400,'OLLI_AGENT_TRIAL_CANCEL_SINGLE_GUEST_REQUIRED');
  }
  const guestLabel=subjectRefs[0].label;
  const guest=preparedPrivacy?.trialAccess?.resolve?.(guestLabel);
  if(!guest?.guestName){
    throw runtimeError('취소할 체험 학생을 확인하지 못했습니다.',400,'OLLI_AGENT_TRIAL_GUEST_REQUIRED');
  }

  const safeText=String(preparedPrivacy?.safeText||'');
  const compact=safeText.replace(/\s+/g,'');
  const hasTrial=/(?:체험클래스|체험수업|체험)/.test(compact);
  const hasRemove=/(?:취소|삭제|지워|지우|제거|빼|해제|없애)/.test(compact);
  const hasOtherMutation=/(?:등록|추가|신청|예약|배정|넣|저장|잡아|변경|수정|바꿔|바꾸|옮|이동|고쳐|고치)/.test(compact);
  if(!hasTrial||!hasRemove||hasOtherMutation){
    throw runtimeError('체험 취소 요청을 확인하지 못했습니다.',400,'OLLI_AGENT_TRIAL_CANCEL_INTENT_REQUIRED');
  }

  const groupMatch=safeText.match(/([ABab])\s*반/);
  return {
    guestLabel,
    classGroup:groupMatch?groupMatch[1].toUpperCase():'AUTO',
  };
}

async function runTrialCancelPrepareAgent({
  agentContext,requestContext,preparedPrivacy,requestId,reason,
  replyToMessageId=null,requirePersistedMessage=false,
}){
  const scope=resolveTrialCancelPrepareScope(preparedPrivacy);
  assertOpenAiKey();
  const {Agent,run,tool,z}=await loadAgentsSdk();
  const {createPrepareTrialCancelTool}=require('./tools/trial-cancel-prepare-tools.cjs');
  const {sanitizeTrialToolPayload}=require('./trial-guest-privacy.cjs');
  const model=agentModel();
  const today=todayInSeoul();
  let persistedMessage=null;

  const prepareTrialCancel=createPrepareTrialCancelTool({
    tool,z,requestContext,
    trialAccess:preparedPrivacy.trialAccess,
    guestLabel:scope.guestLabel,
    classGroup:scope.classGroup,
    reason,
    currentDate:today,
    requestId,
    replyToMessageId,
    capturePersistedMessage(message){persistedMessage=pickupPersistedMessageForClient(message);},
    sanitizePayload(payload){return sanitizeTrialToolPayload(payload,preparedPrivacy);},
  });

  const groupInstruction=scope.classGroup==='AUTO'
    ? 'The user did not explicitly select A반 or B반. Do not guess a group if more than one current trial still matches.'
    : 'The server has fixed the requested class group to '+scope.classGroup+'. Do not override it.';

  const agent=new Agent({
    name:requirePersistedMessage?'Olli Trial Cancel Prepare':'Olli Trial Cancel Prepare Probe',
    model,
    instructions:[
      'You are the Olli trial-class cancellation preparation assistant.',
      'The user message has already been privacy-sanitized.',
      'The real guest name is private. The only available anonymous label is '+scope.guestLabel+'.',
      groupInstruction,
      'Today in Korea is '+today+'.',
      'The cancellation reason is private server-side context. It is not included in the model input and you must never ask for or invent it.',
      'Always call prepare_trial_cancel exactly once before answering.',
      'If the user explicitly names a date, convert it to exact YYYY-MM-DD. If no date is present, pass an empty source_date string.',
      'If the user explicitly names a class time, convert the visible time to source_hour and source_minute. For 4시 반 use 4 and 30. If no time is present, pass 0 and 0.',
      'The server re-resolves the current stored trial row and binds the already-validated cancellation reason before creating the card.',
      'The tool creates a pending confirmation card only. It never directly cancels a trial class.',
      'Never say the trial was cancelled. Say that the cancellation is waiting for user confirmation.',
      'Never ask for, infer, or reveal the real guest name, cancellation reason, UUID, one-time-session ID, internal time slot, member ID, session token, academy ID, action ID, or message ID.',
      'Answer briefly in Korean.',
    ].join(' '),
    tools:[prepareTrialCancel],
    modelSettings:{toolChoice:'prepare_trial_cancel'},
    toolUseBehavior: requirePersistedMessage ? 'stop_on_first_tool' : 'run_llm_again',
  });

  let result=null,runError=null;
  try{
    result=await run(agent,preparedPrivacy.safeText,{context:agentContext});
  }catch(error){
    runError=error;
    if(!requirePersistedMessage||!persistedMessage) throw error;
  }

  const finalOutput=String(result?.finalOutput||'').trim();
  if(!finalOutput&&(!requirePersistedMessage||!persistedMessage)){
    throw runtimeError('체험 취소 준비 Agent 응답이 비어 있습니다.',502,'OLLI_AGENT_EMPTY_TRIAL_CANCEL_PREPARE_RESPONSE');
  }
  if(requirePersistedMessage&&!persistedMessage){
    throw runtimeError('체험 취소 확인 카드 저장 결과를 확인하지 못했습니다.',502,'OLLI_AGENT_TRIAL_CANCEL_PERSISTED_MESSAGE_MISSING');
  }
  return {ready:true,model,output:finalOutput,nodeVersion:process.versions.node,persistedMessage,recoveredAfterPersist:!!runError};
}

async function validateTrialReasonMessage({
  requestContext,
  reasonMessageId,
  reasonMessageText,
  reason,
  callRpc,
}){
  let source;
  try{
    source=await validatePickupSourceMessage({
      requestContext,
      sourceMessageId:reasonMessageId,
      sourceMessageText:reasonMessageText,
      callRpc,
    });
  }catch(error){
    const pickupCode=String(error?.code||'');
    if(!pickupCode.startsWith('OLLI_AGENT_PICKUP_SOURCE_')) throw error;
    const trialCode=pickupCode.replace(
      'OLLI_AGENT_PICKUP_SOURCE_',
      'OLLI_AGENT_TRIAL_REASON_'
    );
    const message=String(error?.message||'체험 취소 사유 메시지를 확인하지 못했습니다.')
      .replace(/원문 Team Chat/g,'체험 취소 사유')
      .replace(/픽업 Agent 원문/g,'체험 취소 사유');
    throw runtimeError(message,Number(error?.statusCode||400),trialCode);
  }

  const {normalizeTrialCancelReason}=require('./tools/trial-cancel-prepare-tools.cjs');
  const normalizedReason=normalizeTrialCancelReason(reason);
  const storedText=normalizePickupSourceMessageText(source?.body);
  const requestedText=normalizePickupSourceMessageText(reasonMessageText);
  if(!storedText||!requestedText||storedText!==requestedText||!requestedText.includes(normalizedReason)){
    throw runtimeError(
      '체험 취소 사유가 저장된 Team Chat 메시지와 일치하지 않습니다.',
      409,
      'OLLI_AGENT_TRIAL_REASON_BODY_MISMATCH'
    );
  }
  return {source,reason:normalizedReason};
}

async function runTrialCancelPrepareProbe({
  agentContext,requestContext,preparedPrivacy,requestId,reason,
}){
  const {normalizeTrialCancelReason}=require('./tools/trial-cancel-prepare-tools.cjs');
  return runTrialCancelPrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId,
    reason:normalizeTrialCancelReason(reason),
  });
}

async function runTrialCancelPrepare({
  agentContext,
  requestContext,
  preparedPrivacy,
  sourceMessageId,
  sourceMessageText,
  reasonMessageId,
  reasonMessageText,
  reason,
}){
  const sourceId=Number(sourceMessageId||0);
  const reasonId=Number(reasonMessageId||0);
  if(!Number.isSafeInteger(sourceId)||sourceId<=0){
    throw runtimeError('원문 Team Chat 메시지 식별값이 올바르지 않습니다.',400,'OLLI_AGENT_TRIAL_SOURCE_MESSAGE_INVALID');
  }
  if(!Number.isSafeInteger(reasonId)||reasonId<=0){
    throw runtimeError('체험 취소 사유 메시지 식별값이 올바르지 않습니다.',400,'OLLI_AGENT_TRIAL_REASON_MESSAGE_INVALID');
  }

  await validateTrialSourceMessage({
    requestContext,
    sourceMessageId:sourceId,
    sourceMessageText,
  });
  const validatedReason=await validateTrialReasonMessage({
    requestContext,
    reasonMessageId:reasonId,
    reasonMessageText,
    reason,
  });

  return runTrialCancelPrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId:'team-chat-trial-cancel:'+sourceId+':'+reasonId,
    reason:validatedReason.reason,
    replyToMessageId:reasonId,
    requirePersistedMessage:true,
  });
}




function structuredTrialCancelDateKey(value,currentDate){
  const expression=String(value==null?'':value).trim();
  if(!expression) return '';

  if(/^\d{4}-\d{2}-\d{2}$/.test(expression)){
    const exact=new Date(expression+'T12:00:00Z');
    if(!Number.isNaN(exact.getTime())&&exact.toISOString().slice(0,10)===expression){
      return expression;
    }
  }

  const router=loadSharedCommandRouter();
  const spec=router.parseDateExpression(expression.replace(/\s+/g,''));
  const base=new Date(String(currentDate||'')+'T12:00:00Z');
  const resolved=spec&&!Number.isNaN(base.getTime())
    ? router.resolveDateExpression(spec,base)
    : null;
  if(!resolved||Number.isNaN(resolved.getTime())){
    throw runtimeError(
      '체험 취소 날짜 표현을 확인하지 못했습니다.',
      400,
      'OLLI_ROUTINE_TRIAL_CANCEL_DATE_INVALID'
    );
  }
  return resolved.toISOString().slice(0,10);
}

async function runStructuredTrialCancelPrepare({
  requestContext,
  structuredCommand,
  sourceMessageId,
  sourceMessageText,
  reasonMessageId,
  reasonMessageText,
  reason,
}){
  const sourceId=Number(sourceMessageId||0);
  const reasonId=Number(reasonMessageId||0);
  if(!Number.isSafeInteger(sourceId)||sourceId<=0){
    throw runtimeError(
      '원문 Team Chat 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_ROUTINE_TRIAL_CANCEL_SOURCE_MESSAGE_INVALID'
    );
  }
  if(!Number.isSafeInteger(reasonId)||reasonId<=0){
    throw runtimeError(
      '체험 취소 사유 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_ROUTINE_TRIAL_CANCEL_REASON_MESSAGE_INVALID'
    );
  }

  const command=structuredCommand&&typeof structuredCommand==='object'
    ? structuredCommand
    : {};
  if(String(command.action||'').trim()!=='cancel_trial'){
    throw runtimeError(
      '체험 취소 구조화 명령을 확인하지 못했습니다.',
      400,
      'OLLI_ROUTINE_TRIAL_CANCEL_ACTION_INVALID'
    );
  }

  await validateTrialSourceMessage({
    requestContext,
    sourceMessageId:sourceId,
    sourceMessageText,
  });
  const validatedReason=await validateTrialReasonMessage({
    requestContext,
    reasonMessageId:reasonId,
    reasonMessageText,
    reason,
  });

  const {prepareTrialCancelPrivacyInput}=require('./trial-guest-privacy.cjs');
  const preparedPrivacy=prepareTrialCancelPrivacyInput(
    sourceMessageText,
    validatedReason.reason
  );
  const subjectRefs=Array.isArray(preparedPrivacy?.subjectRefs)
    ? preparedPrivacy.subjectRefs
    : [];
  if(subjectRefs.length!==1){
    throw runtimeError(
      '취소할 체험 학생을 한 명으로 확인하지 못했습니다.',
      400,
      'OLLI_ROUTINE_TRIAL_CANCEL_GUEST_REQUIRED'
    );
  }
  const guestLabel=subjectRefs[0].label;
  const guest=preparedPrivacy?.trialAccess?.resolve?.(guestLabel);
  if(!guest?.guestName){
    throw runtimeError(
      '취소할 체험 학생을 원문에서 확인하지 못했습니다.',
      400,
      'OLLI_ROUTINE_TRIAL_CANCEL_GUEST_REQUIRED'
    );
  }

  const today=todayInSeoul();
  const dateExpression=String(command.dateExpression||'').trim();
  const sourceDate=dateExpression
    ? structuredTrialCancelDateKey(dateExpression,today)
    : '';

  const {prepareTrialCancelAction}=require('./tools/trial-cancel-prepare-tools.cjs');
  let persistedMessage=null;
  await prepareTrialCancelAction({
    requestContext,
    trialAccess:preparedPrivacy.trialAccess,
    guestLabel,
    sourceDate,
    sourceHour:Number(command.timeSlot||0),
    sourceMinute:Number(command.classMinute||0),
    classGroup:String(command.classGroup||'').trim().toUpperCase()||'AUTO',
    reason:validatedReason.reason,
    currentDate:today,
    requestId:'team-chat-trial-cancel:'+sourceId+':'+reasonId,
    replyToMessageId:reasonId,
    capturePersistedMessage(message){
      persistedMessage=pickupPersistedMessageForClient(message);
    },
    sanitizePayload(payload){
      return payload;
    },
  });

  if(!persistedMessage?.action||String(persistedMessage.action.action_type||'').trim()!=='cancel_trial'){
    throw runtimeError(
      '체험 취소 확인 카드 저장 결과를 확인하지 못했습니다.',
      502,
      'OLLI_ROUTINE_TRIAL_CANCEL_PERSISTED_MESSAGE_MISSING'
    );
  }

  return {
    ready:true,
    persistedMessage,
    recoveredAfterPersist:false,
  };
}


function structuredTrialUpdateDateKey(value,currentDate){
  const expression=String(value==null?'':value).trim();
  if(!expression) return '';

  if(/^\d{4}-\d{2}-\d{2}$/.test(expression)){
    const exact=new Date(expression+'T12:00:00Z');
    if(!Number.isNaN(exact.getTime())&&exact.toISOString().slice(0,10)===expression){
      return expression;
    }
  }

  const router=loadSharedCommandRouter();
  const spec=router.parseDateExpression(expression.replace(/\s+/g,''));
  const base=new Date(String(currentDate||'')+'T12:00:00Z');
  const resolved=spec&&!Number.isNaN(base.getTime())
    ? router.resolveDateExpression(spec,base)
    : null;
  if(!resolved||Number.isNaN(resolved.getTime())){
    throw runtimeError(
      '체험 날짜 표현을 확인하지 못했습니다.',
      400,
      'OLLI_ROUTINE_TRIAL_UPDATE_DATE_INVALID'
    );
  }
  return resolved.toISOString().slice(0,10);
}

async function runStructuredTrialUpdatePrepare({
  requestContext,
  structuredCommand,
  sourceMessageId,
  sourceMessageText,
}){
  const sourceId=Number(sourceMessageId||0);
  if(!Number.isSafeInteger(sourceId)||sourceId<=0){
    throw runtimeError(
      '원문 Team Chat 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_ROUTINE_TRIAL_UPDATE_SOURCE_MESSAGE_INVALID'
    );
  }

  await validateTrialSourceMessage({
    requestContext,
    sourceMessageId:sourceId,
    sourceMessageText,
  });

  const command=structuredCommand&&typeof structuredCommand==='object'
    ? structuredCommand
    : {};
  if(String(command.action||'').trim()!=='update_trial'){
    throw runtimeError(
      '체험 변경 구조화 명령을 확인하지 못했습니다.',
      400,
      'OLLI_ROUTINE_TRIAL_UPDATE_ACTION_INVALID'
    );
  }

  const sourceDateExpression=String(command.sourceDateExpression||'').trim();
  if(!sourceDateExpression){
    throw runtimeError(
      '체험 변경에는 기존 체험 날짜가 필요합니다.',
      400,
      'OLLI_ROUTINE_TRIAL_UPDATE_SOURCE_DATE_REQUIRED'
    );
  }

  const trialPrivacyModule=require('./trial-guest-privacy.cjs');
  const preparedPrivacy=trialPrivacyModule.prepareTrialGuestPrivacyInput(sourceMessageText);
  const subjectRefs=Array.isArray(preparedPrivacy?.subjectRefs)
    ? preparedPrivacy.subjectRefs
    : [];
  if(subjectRefs.length!==1){
    throw runtimeError(
      '변경할 체험 학생을 한 명으로 확인하지 못했습니다.',
      400,
      'OLLI_ROUTINE_TRIAL_UPDATE_GUEST_REQUIRED'
    );
  }
  const guestLabel=subjectRefs[0].label;
  const guest=preparedPrivacy?.trialAccess?.resolve?.(guestLabel);
  if(!guest?.guestName){
    throw runtimeError(
      '변경할 체험 학생을 원문에서 확인하지 못했습니다.',
      400,
      'OLLI_ROUTINE_TRIAL_UPDATE_GUEST_REQUIRED'
    );
  }

  const today=todayInSeoul();
  const sourceDate=structuredTrialUpdateDateKey(sourceDateExpression,today);
  const targetDateExpression=String(command.targetDateExpression||'').trim();
  const targetDate=targetDateExpression
    ? structuredTrialUpdateDateKey(targetDateExpression,today)
    : '';

  const {prepareTrialUpdateAction}=require('./tools/trial-update-prepare-tools.cjs');
  let persistedMessage=null;
  await prepareTrialUpdateAction({
    requestContext,
    trialAccess:preparedPrivacy.trialAccess,
    guestLabel,
    sourceDate,
    sourceHour:Number(command.sourceTimeSlot||0),
    sourceMinute:Number(command.sourceMinute||0),
    sourceGroup:String(command.sourceClassGroup||'').trim().toUpperCase()||'AUTO',
    targetDate,
    targetHour:Number(command.targetTimeSlot||0),
    targetMinute:Number(command.targetMinute||0),
    targetGroup:String(command.targetClassGroup||'').trim().toUpperCase()||'AUTO',
    currentDate:today,
    requestId:'team-chat-trial-update:'+sourceId,
    replyToMessageId:sourceId,
    capturePersistedMessage(message){
      persistedMessage=pickupPersistedMessageForClient(message);
    },
    sanitizePayload(payload){
      return payload;
    },
  });

  if(!persistedMessage?.action||String(persistedMessage.action.action_type||'').trim()!=='update_trial'){
    throw runtimeError(
      '체험 변경 확인 카드 저장 결과를 확인하지 못했습니다.',
      502,
      'OLLI_ROUTINE_TRIAL_UPDATE_PERSISTED_MESSAGE_MISSING'
    );
  }

  return {
    ready:true,
    persistedMessage,
    recoveredAfterPersist:false,
  };
}


function resolveTrialUpdatePrepareScope(preparedPrivacy){
  if(preparedPrivacy?.needsDisambiguation){
    throw runtimeError('체험 학생 이름을 하나로 구분할 수 없습니다.',409,'OLLI_AGENT_TRIAL_GUEST_AMBIGUOUS');
  }
  const subjectRefs=Array.isArray(preparedPrivacy?.subjectRefs)?preparedPrivacy.subjectRefs:[];
  if(subjectRefs.length!==1){
    throw runtimeError('체험 변경은 한 번에 학생 한 명만 지정해 주세요.',400,'OLLI_AGENT_TRIAL_UPDATE_SINGLE_GUEST_REQUIRED');
  }
  const guestLabel=subjectRefs[0].label;
  const guest=preparedPrivacy?.trialAccess?.resolve?.(guestLabel);
  if(!guest?.guestName){
    throw runtimeError('변경할 체험 학생을 확인하지 못했습니다.',400,'OLLI_AGENT_TRIAL_GUEST_REQUIRED');
  }
  const safeText=String(preparedPrivacy?.safeText||'');
  const compact=safeText.replace(/\s+/g,'');
  const hasTrial=/(?:체험클래스|체험수업|체험)/.test(compact);
  const hasUpdate=/(?:변경|수정|바꿔|바꾸|옮|이동|고쳐|고치)/.test(compact);
  const hasRemove=/(?:취소|삭제|지워|지우|제거|빼|해제|없애)/.test(compact);
  const hasAdd=/(?:등록|추가|신청|예약|넣|저장)/.test(compact);
  if(!hasTrial||!hasUpdate||hasRemove||hasAdd){
    throw runtimeError('체험 변경 요청을 확인하지 못했습니다.',400,'OLLI_AGENT_TRIAL_UPDATE_INTENT_REQUIRED');
  }
  return {guestLabel};
}

async function runTrialUpdatePrepareAgent({
  agentContext,requestContext,preparedPrivacy,requestId,
  replyToMessageId=null,requirePersistedMessage=false,
}){
  const scope=resolveTrialUpdatePrepareScope(preparedPrivacy);
  assertOpenAiKey();
  const {Agent,run,tool,z}=await loadAgentsSdk();
  const {createPrepareTrialUpdateTool}=require('./tools/trial-update-prepare-tools.cjs');
  const {sanitizeTrialToolPayload}=require('./trial-guest-privacy.cjs');
  const model=agentModel();
  const today=todayInSeoul();
  let persistedMessage=null;

  const prepareTrialUpdate=createPrepareTrialUpdateTool({
    tool,z,requestContext,
    trialAccess:preparedPrivacy.trialAccess,
    guestLabel:scope.guestLabel,
    currentDate:today,
    requestId,
    replyToMessageId,
    capturePersistedMessage(message){persistedMessage=pickupPersistedMessageForClient(message);},
    sanitizePayload(payload){return sanitizeTrialToolPayload(payload,preparedPrivacy);},
  });

  const agent=new Agent({
    name:requirePersistedMessage?'Olli Trial Update Prepare':'Olli Trial Update Prepare Probe',
    model,
    instructions:[
      'You are the Olli trial-class update preparation assistant.',
      'The user message has already been privacy-sanitized.',
      'The real guest name is private. The only available anonymous label is '+scope.guestLabel+'.',
      'Today in Korea is '+today+'.',
      'Always call prepare_trial_update exactly once before answering.',
      'source_date identifies the existing trial date and is required. Convert relative source dates to exact YYYY-MM-DD.',
      'For the existing trial time, pass source_hour and source_minute only when the user identifies it. Otherwise pass 0 and 0.',
      'For the existing trial group, use A or B only when the user identifies the old group. Otherwise use AUTO.',
      'For the new date, use exact target_date only when the user changes the date. Otherwise pass an empty string.',
      'For the new visible time, pass target_hour and target_minute only when the user changes the time. Otherwise pass 0 and 0.',
      'For the new group, use A or B only when the user explicitly requests the new group. Otherwise use AUTO.',
      'For A반에서 B반으로 변경, source_group must be A and target_group must be B.',
      'The server re-resolves the real guest trial row and target availability. Never infer or expose the real guest name, UUID, one-time-session ID, internal time slot, member ID, session token, academy ID, action ID, or message ID.',
      'The tool creates a pending confirmation card only. It never directly changes the trial class.',
      'Never say the trial was changed. Say the change is waiting for user confirmation.',
      'Answer briefly in Korean.',
    ].join(' '),
    tools:[prepareTrialUpdate],
    modelSettings:{toolChoice:'prepare_trial_update'},
    toolUseBehavior: requirePersistedMessage ? 'stop_on_first_tool' : 'run_llm_again',
  });

  let result=null,runError=null;
  try{
    result=await run(agent,preparedPrivacy.safeText,{context:agentContext});
  }catch(error){
    runError=error;
    if(!requirePersistedMessage||!persistedMessage) throw error;
  }

  const finalOutput=String(result?.finalOutput||'').trim();
  if(!finalOutput&&(!requirePersistedMessage||!persistedMessage)){
    throw runtimeError('체험 변경 준비 Agent 응답이 비어 있습니다.',502,'OLLI_AGENT_EMPTY_TRIAL_UPDATE_PREPARE_RESPONSE');
  }
  if(requirePersistedMessage&&!persistedMessage){
    throw runtimeError('체험 변경 확인 카드 저장 결과를 확인하지 못했습니다.',502,'OLLI_AGENT_TRIAL_UPDATE_PERSISTED_MESSAGE_MISSING');
  }
  return {ready:true,model,output:finalOutput,nodeVersion:process.versions.node,persistedMessage,recoveredAfterPersist:!!runError};
}

async function runTrialUpdatePrepareProbe({agentContext,requestContext,preparedPrivacy,requestId}){
  return runTrialUpdatePrepareAgent({agentContext,requestContext,preparedPrivacy,requestId});
}


async function validateTrialSourceMessage({
  requestContext,
  sourceMessageId,
  sourceMessageText,
  callRpc,
}) {
  try {
    return await validatePickupSourceMessage({
      requestContext,
      sourceMessageId,
      sourceMessageText,
      callRpc,
    });
  } catch (error) {
    const pickupCode=String(error?.code||'');
    if(!pickupCode.startsWith('OLLI_AGENT_PICKUP_SOURCE_')) throw error;
    const trialCode=pickupCode.replace(
      'OLLI_AGENT_PICKUP_SOURCE_',
      'OLLI_AGENT_TRIAL_SOURCE_'
    );
    const message=String(error?.message||'원문 Team Chat 메시지를 확인하지 못했습니다.')
      .replace(/픽업/g,'체험');
    throw runtimeError(
      message,
      Number(error?.statusCode||400),
      trialCode
    );
  }
}

async function runTrialUpdatePrepare({
  agentContext,
  requestContext,
  preparedPrivacy,
  sourceMessageId,
  sourceMessageText,
}) {
  const sourceId=Number(sourceMessageId||0);
  if(!Number.isSafeInteger(sourceId)||sourceId<=0){
    throw runtimeError(
      '원문 Team Chat 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_AGENT_TRIAL_SOURCE_MESSAGE_INVALID'
    );
  }

  await validateTrialSourceMessage({
    requestContext,
    sourceMessageId:sourceId,
    sourceMessageText,
  });

  return runTrialUpdatePrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId:'team-chat-message:'+sourceId,
    replyToMessageId:sourceId,
    requirePersistedMessage:true,
  });
}


function resolveWaitlistActor(preparedPrivacy,{operation='대기 작업',requireGuestDivision=false}={}) {
  if (preparedPrivacy?.needsDisambiguation) {
    throw runtimeError('학생 이름을 한 명으로 구분할 수 없습니다. 전체 이름으로 다시 알려 주세요.',409,'OLLI_AGENT_STUDENT_AMBIGUOUS');
  }
  const subjectRefs=Array.isArray(preparedPrivacy?.subjectRefs)?preparedPrivacy.subjectRefs:[];
  if(subjectRefs.length!==1){
    throw runtimeError(operation+'은 한 번에 학생 한 명만 지정해 주세요.',400,'OLLI_AGENT_WAITLIST_SINGLE_SUBJECT_REQUIRED');
  }
  const subjectLabel=subjectRefs[0].label;
  const registered=preparedPrivacy?.subjectAccess?.resolve?.(subjectLabel) || null;
  const guest=preparedPrivacy?.waitlistGuestAccess?.resolve?.(subjectLabel) || null;
  const isGuest=!registered?.studentId && !!String(guest?.guestName||'').trim();
  if(!registered?.studentId && !isGuest){
    throw runtimeError(operation+' 대상 학생을 확인하지 못했습니다.',400,'OLLI_AGENT_WAITLIST_SUBJECT_REQUIRED');
  }
  const division=String(registered?.division || guest?.division || '').trim().toLowerCase();
  if(!isGuest && !['elementary','kinder'].includes(division)){
    throw runtimeError(operation+' 대상 학생의 수업 구분을 확인하지 못했습니다.',400,'OLLI_AGENT_WAITLIST_DIVISION_REQUIRED');
  }
  if(isGuest && requireGuestDivision && !['elementary','kinder'].includes(division)){
    throw runtimeError('비재원 대기는 유치부인지 초등부인지 함께 알려 주세요.',400,'OLLI_AGENT_WAITLIST_GUEST_DIVISION_REQUIRED');
  }
  return {subjectLabel,division,isGuest};
}

function sanitizeWaitlistPayload(payload,preparedPrivacy,scope){
  if(scope?.isGuest){
    return require('./waitlist-guest-privacy.cjs').sanitizeWaitlistGuestToolPayload(payload,preparedPrivacy);
  }
  return require('./privacy.cjs').sanitizeAgentToolPayload(payload,preparedPrivacy);
}

function resolveWaitlistAddPrepareScope(preparedPrivacy) {
  const actor=resolveWaitlistActor(preparedPrivacy,{operation:'대기 등록',requireGuestDivision:true});
  const {subjectLabel,division,isGuest}=actor;

  const safeText=String(preparedPrivacy?.safeText||'');
  const compact=safeText.replace(/\s+/g,'');
  const hasWait=/(?:대기|웨이팅)/.test(compact);
  const hasAdd=/(?:등록|추가|신청|예약|배정|넣|저장|걸어)/.test(compact);
  const hasOtherMutation=/(?:취소|삭제|지워|지우|제거|빼|해제|없애|변경|수정|바꿔|바꾸|옮|이동|고쳐|고치)/.test(compact);
  if(!hasWait||!hasAdd||hasOtherMutation){
    throw runtimeError('대기 등록 요청을 확인하지 못했습니다.',400,'OLLI_AGENT_WAITLIST_ADD_INTENT_REQUIRED');
  }

  const hasDateSignal=/(?:오늘|내일|모레|이번\s*주|다음\s*주|다다음\s*주|월요일|화요일|수요일|목요일|금요일|토요일|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}[./]\d{1,2})/.test(safeText);
  const hasTimeSignal=/\d{1,2}\s*시/.test(safeText);
  if(!hasDateSignal||!hasTimeSignal){
    throw runtimeError('대기 등록에는 날짜와 수업 시간을 함께 알려 주세요.',400,'OLLI_AGENT_WAITLIST_ADD_DATE_TIME_REQUIRED');
  }

  const groupMatch=safeText.match(/([ABab])\s*반/);
  return {
    subjectLabel,
    division,
    isGuest,
    classGroup:groupMatch?groupMatch[1].toUpperCase():'AUTO',
  };
}

async function runWaitlistAddPrepareAgent({
  agentContext,requestContext,preparedPrivacy,requestId,
  replyToMessageId=null,requirePersistedMessage=false,
}) {
  const scope=resolveWaitlistAddPrepareScope(preparedPrivacy);
  assertOpenAiKey();
  const {Agent,run,tool,z}=await loadAgentsSdk();
  const {createPrepareWaitlistAddTool}=require('./tools/waitlist-add-prepare-tools.cjs');
  const model=agentModel();
  const today=todayInSeoul();
  let persistedMessage=null;

  const prepareWaitlistAdd=createPrepareWaitlistAddTool({
    tool,z,requestContext,
    subjectAccess:preparedPrivacy.subjectAccess,
    guestAccess:preparedPrivacy.waitlistGuestAccess,
    studentLabel:scope.subjectLabel,
    division:scope.division,
    classGroup:scope.classGroup,
    currentDate:today,
    requestId,
    replyToMessageId,
    capturePersistedMessage(message){persistedMessage=pickupPersistedMessageForClient(message);},
    sanitizePayload(payload){return sanitizeWaitlistPayload(payload,preparedPrivacy,scope);},
  });

  const groupInstruction=scope.classGroup==='AUTO'
    ? 'The user did not explicitly select A반 or B반. The server must reject a split class rather than guessing.'
    : 'The server has fixed the requested class group to '+scope.classGroup+'. Do not override it.';

  const agent=new Agent({
    name:requirePersistedMessage?'Olli Waitlist Add Prepare':'Olli Waitlist Add Prepare Probe',
    model,
    instructions:[
      'You are the Olli registered-or-guest waitlist-registration preparation assistant.',
      'The user message has already been privacy-sanitized.',
      'The only available anonymous student label for this run is '+scope.subjectLabel+'.',
      'The server has fixed the student division to '+scope.division+'. Do not override it.',
      groupInstruction,
      'Today in Korea is '+today+'.',
      'The server already confirmed that the user explicitly supplied both a date expression and a class time.',
      'Convert the requested date to exact YYYY-MM-DD using today as the reference. Do not invent a different date.',
      'Convert the visible class time to class_hour and class_minute. For 4시 반 use class_minute 30.',
      'Always call prepare_waitlist_add exactly once before answering.',
      'The server rechecks the registered student or non-enrolled guest identity, operating slot, current enrollment when applicable, and current waitlist occupancy before storing the card.',
      'The tool creates a pending confirmation card only. It never directly registers a waitlist row.',
      'Never say the waitlist was registered. Say that the registration is waiting for user confirmation.',
      'Never ask for, infer, or reveal a real student name, UUID, waitlist ID, internal time slot, member ID, session token, academy ID, action ID, or message ID.',
      'Answer briefly in Korean.',
    ].join(' '),
    tools:[prepareWaitlistAdd],
    modelSettings:{toolChoice:'prepare_waitlist_add'},
    toolUseBehavior: requirePersistedMessage ? 'stop_on_first_tool' : 'run_llm_again',
  });

  let result=null,runError=null;
  try{
    result=await run(agent,preparedPrivacy.safeText,{context:agentContext});
  }catch(error){
    runError=error;
    if(!requirePersistedMessage||!persistedMessage) throw error;
  }

  const finalOutput=String(result?.finalOutput||'').trim();
  if(!finalOutput&&(!requirePersistedMessage||!persistedMessage)){
    throw runtimeError('대기 등록 준비 Agent 응답이 비어 있습니다.',502,'OLLI_AGENT_EMPTY_WAITLIST_ADD_PREPARE_RESPONSE');
  }
  if(requirePersistedMessage&&!persistedMessage){
    throw runtimeError('대기 등록 확인 카드 저장 결과를 확인하지 못했습니다.',502,'OLLI_AGENT_WAITLIST_ADD_PERSISTED_MESSAGE_MISSING');
  }

  return {
    ready:true,
    model,
    output:finalOutput,
    nodeVersion:process.versions.node,
    persistedMessage,
    recoveredAfterPersist:!!runError,
  };
}

async function runWaitlistAddPrepareProbe({agentContext,requestContext,preparedPrivacy,requestId}) {
  return runWaitlistAddPrepareAgent({agentContext,requestContext,preparedPrivacy,requestId});
}

async function runWaitlistAddPrepare({
  agentContext,
  requestContext,
  preparedPrivacy,
  sourceMessageId,
  sourceMessageText,
}) {
  const sourceId=Number(sourceMessageId||0);
  if(!Number.isSafeInteger(sourceId)||sourceId<=0){
    throw runtimeError('원문 Team Chat 메시지 식별값이 올바르지 않습니다.',400,'OLLI_AGENT_WAITLIST_SOURCE_MESSAGE_INVALID');
  }

  await validateWaitlistSourceMessage({
    requestContext,
    sourceMessageId:sourceId,
    sourceMessageText,
  });

  return runWaitlistAddPrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId:'team-chat-message:'+sourceId,
    replyToMessageId:sourceId,
    requirePersistedMessage:true,
  });
}


function resolveWaitlistUpdatePrepareScope(preparedPrivacy) {
  const actor=resolveWaitlistActor(preparedPrivacy,{operation:'대기 변경',requireGuestDivision:false});
  const {subjectLabel,division,isGuest}=actor;
  const safeText=String(preparedPrivacy?.safeText||'');
  const compact=safeText.replace(/\s+/g,'');
  const hasWait=/(?:대기|웨이팅)/.test(compact);
  const hasUpdate=/(?:변경|수정|바꿔|바꾸|옮|이동|고쳐|고치)/.test(compact);
  const hasRemove=/(?:취소|삭제|지워|지우|제거|빼|해제|없애)/.test(compact);
  const hasAdd=/(?:등록|추가|신청|예약|넣|저장)/.test(compact);
  if(!hasWait||!hasUpdate||hasRemove||hasAdd){
    throw runtimeError('대기 변경 요청을 확인하지 못했습니다.',400,'OLLI_AGENT_WAITLIST_UPDATE_INTENT_REQUIRED');
  }
  return {subjectLabel,division,isGuest};
}

async function runWaitlistUpdatePrepareAgent({
  agentContext,requestContext,preparedPrivacy,requestId,
  replyToMessageId=null,requirePersistedMessage=false,
}) {
  const scope=resolveWaitlistUpdatePrepareScope(preparedPrivacy);
  assertOpenAiKey();
  const {Agent,run,tool,z}=await loadAgentsSdk();
  const {createPrepareWaitlistUpdateTool}=require('./tools/waitlist-update-prepare-tools.cjs');
  const model=agentModel();
  const today=todayInSeoul();
  let persistedMessage=null;

  const prepareWaitlistUpdate=createPrepareWaitlistUpdateTool({
    tool,z,requestContext,
    subjectAccess:preparedPrivacy.subjectAccess,
    guestAccess:preparedPrivacy.waitlistGuestAccess,
    studentLabel:scope.subjectLabel,
    division:scope.division,
    currentDate:today,
    requestId,
    replyToMessageId,
    capturePersistedMessage(message){persistedMessage=pickupPersistedMessageForClient(message);},
    sanitizePayload(payload){return sanitizeWaitlistPayload(payload,preparedPrivacy,scope);},
  });

  const agent=new Agent({
    name:requirePersistedMessage?'Olli Waitlist Update Prepare':'Olli Waitlist Update Prepare Probe',
    model,
    instructions:[
      'You are the Olli waitlist-update preparation assistant.',
      'The user message has already been privacy-sanitized.',
      'The only available anonymous student label for this run is '+scope.subjectLabel+'.',
      scope.division ? 'The server has fixed the division to '+scope.division+'. Do not override it.' : 'For a non-enrolled guest with no division stated, the server resolves the division from the current waitlist row.',
      'Today in Korea is '+today+'.',
      'Always call prepare_waitlist_update exactly once before answering.',
      'Extract source information only when the user explicitly gives it. Otherwise pass empty source_date, source_weekday 0, source_hour 0, source_minute 0, source_group AUTO so the server can resolve a unique current waitlist.',
      'For target information, pass only what the user explicitly changes. Use empty target_date, target_weekday 0, target_hour 0, target_minute 0, target_group AUTO for omitted fields so the server preserves the current value.',
      'If an exact date is stated, convert it to YYYY-MM-DD. If a weekday is stated without a date, pass target_weekday 1 through 6 for Monday through Saturday.',
      'For visible half-hour times, 4시 30분 means hour 4 and minute 30.',
      'The server resolves internal slots and the current waitlist id. Never infer or expose them.',
      'The tool creates only a pending update_waitlist confirmation card. It never updates the waitlist row directly.',
      'Never say the waitlist was changed. Say the change is waiting for confirmation.',
      'Never ask for, infer, or reveal a real student name, UUID, waitlist ID, member ID, session token, academy ID, action ID, message ID, or internal time slot.',
      'Answer briefly in Korean.',
    ].join(' '),
    tools:[prepareWaitlistUpdate],
    modelSettings:{toolChoice:'prepare_waitlist_update'},
    toolUseBehavior: requirePersistedMessage ? 'stop_on_first_tool' : 'run_llm_again',
  });

  let result=null,runError=null;
  try{
    result=await run(agent,preparedPrivacy.safeText,{context:agentContext});
  }catch(error){
    runError=error;
    if(!requirePersistedMessage||!persistedMessage) throw error;
  }
  const finalOutput=String(result?.finalOutput||'').trim();
  if(!finalOutput&&(!requirePersistedMessage||!persistedMessage)){
    throw runtimeError('대기 변경 준비 Agent 응답이 비어 있습니다.',502,'OLLI_AGENT_EMPTY_WAITLIST_UPDATE_PREPARE_RESPONSE');
  }
  if(requirePersistedMessage&&!persistedMessage){
    throw runtimeError('대기 변경 확인 카드 저장 결과를 확인하지 못했습니다.',502,'OLLI_AGENT_WAITLIST_UPDATE_PERSISTED_MESSAGE_MISSING');
  }
  return {ready:true,model,output:finalOutput,nodeVersion:process.versions.node,persistedMessage,recoveredAfterPersist:!!runError};
}

async function runWaitlistUpdatePrepareProbe({agentContext,requestContext,preparedPrivacy,requestId}) {
  return runWaitlistUpdatePrepareAgent({agentContext,requestContext,preparedPrivacy,requestId});
}


async function runWaitlistUpdatePrepare({
  agentContext,
  requestContext,
  preparedPrivacy,
  sourceMessageId,
  sourceMessageText,
}) {
  const sourceId=Number(sourceMessageId || 0);
  if(!Number.isSafeInteger(sourceId) || sourceId<=0){
    throw runtimeError(
      '원문 Team Chat 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_AGENT_WAITLIST_SOURCE_MESSAGE_INVALID'
    );
  }

  await validateWaitlistSourceMessage({
    requestContext,
    sourceMessageId:sourceId,
    sourceMessageText,
  });

  return runWaitlistUpdatePrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId:'team-chat-message:' + sourceId,
    replyToMessageId:sourceId,
    requirePersistedMessage:true,
  });
}


function resolveWaitlistCancelPrepareScope(preparedPrivacy) {
  const actor=resolveWaitlistActor(preparedPrivacy,{operation:'대기 취소',requireGuestDivision:false});
  const {subjectLabel,division,isGuest}=actor;

  const safeText = String(preparedPrivacy?.safeText || '');
  const compact = safeText.replace(/\s+/g, '');
  const hasWaitlist = /(?:대기|웨이팅)/.test(compact);
  const hasRemove = /(?:취소|삭제|지워|지우|제거|빼|해제|없애)/.test(compact);
  const hasOtherMutation = /(?:등록|추가|예약|신청|배정|넣|저장|변경|수정|바꿔|바꾸|옮|이동)/.test(compact);

  if (!hasWaitlist || !hasRemove || hasOtherMutation) {
    throw runtimeError(
      '대기 취소 요청을 확인하지 못했습니다.',
      400,
      'OLLI_AGENT_WAITLIST_CANCEL_INTENT_REQUIRED'
    );
  }

  const groupMatch = safeText.match(/([ABab])\s*반/);
  return {
    subjectLabel,
    division,
    isGuest,
    classGroup:groupMatch ? groupMatch[1].toUpperCase() : 'AUTO',
  };
}

async function runWaitlistCancelPrepareAgent({
  agentContext,
  requestContext,
  preparedPrivacy,
  requestId,
  replyToMessageId = null,
  requirePersistedMessage = false,
}) {
  const scope = resolveWaitlistCancelPrepareScope(preparedPrivacy);
  assertOpenAiKey();

  const { Agent, run, tool, z } = await loadAgentsSdk();
  const { createPrepareWaitlistCancelTool } = require('./tools/waitlist-cancel-prepare-tools.cjs');
  const model = agentModel();
  const today = todayInSeoul();
  let persistedMessage = null;

  const prepareWaitlistCancel = createPrepareWaitlistCancelTool({
    tool,
    z,
    requestContext,
    subjectAccess:preparedPrivacy.subjectAccess,
    guestAccess:preparedPrivacy.waitlistGuestAccess,
    studentLabel:scope.subjectLabel,
    division:scope.division,
    classGroup:scope.classGroup,
    currentDate:today,
    requestId,
    replyToMessageId,
    capturePersistedMessage(message) {
      persistedMessage = pickupPersistedMessageForClient(message);
    },
    sanitizePayload(payload) {
      return sanitizeWaitlistPayload(payload, preparedPrivacy, scope);
    },
  });

  const groupInstruction = scope.classGroup === 'AUTO'
    ? 'The user did not explicitly select A반 or B반. The server must not guess if multiple waitlist rows still match.'
    : 'The server has fixed the requested class group to ' + scope.classGroup + '. Do not override it.';

  const agent = new Agent({
    name:requirePersistedMessage ? 'Olli Waitlist Cancel Prepare' : 'Olli Waitlist Cancel Prepare Probe',
    model,
    instructions:[
      'You are the Olli waitlist-cancellation preparation assistant.',
      'The user message has already been privacy-sanitized.',
      'The only available anonymous student label for this run is ' + scope.subjectLabel + '.',
      scope.division ? 'The server has fixed the division to ' + scope.division + '. Do not override it.' : 'For a non-enrolled guest with no division stated, the server resolves the division from the current waitlist row.',
      groupInstruction,
      'Today in Korea is ' + today + '.',
      'Always call prepare_waitlist_cancel exactly once before answering.',
      'If the user explicitly names a date, convert it to exact YYYY-MM-DD and pass it as waitlist_date. The server uses that date only to identify the requested weekday. If no date is present, pass an empty string.',
      'If the user explicitly names a class time, convert the visible time to class_hour and class_minute. For 4시 반 use 4 and 30. If no time is present, pass 0 and 0.',
      'The server re-reads the current active waitlist and rejects ambiguous matches. It never trusts or exposes an internal time slot or waitlist id.',
      'The tool creates a pending confirmation card only. It never directly cancels a waitlist row.',
      'Never say the waitlist was cancelled. Say that the cancellation is waiting for user confirmation.',
      'Never ask for, infer, or reveal a real student name, UUID, waitlist ID, member ID, session token, academy ID, action ID, message ID, or internal time slot.',
      'Answer briefly in Korean.',
    ].join(' '),
    tools:[prepareWaitlistCancel],
    modelSettings:{toolChoice:'prepare_waitlist_cancel'},
    toolUseBehavior: requirePersistedMessage ? 'stop_on_first_tool' : 'run_llm_again',
  });

  let result = null;
  let runError = null;
  try {
    result = await run(agent, preparedPrivacy.safeText, {
      context:agentContext,
    });
  } catch (error) {
    runError = error;
    if (!requirePersistedMessage || !persistedMessage) throw error;
  }

  const finalOutput = String(result?.finalOutput || '').trim();
  if (!finalOutput && (!requirePersistedMessage || !persistedMessage)) {
    throw runtimeError(
      '대기 취소 준비 Agent 응답이 비어 있습니다.',
      502,
      'OLLI_AGENT_EMPTY_WAITLIST_CANCEL_PREPARE_RESPONSE'
    );
  }
  if (requirePersistedMessage && !persistedMessage) {
    throw runtimeError(
      '대기 취소 확인 카드 저장 결과를 확인하지 못했습니다.',
      502,
      'OLLI_AGENT_WAITLIST_CANCEL_PERSISTED_MESSAGE_MISSING'
    );
  }

  return {
    ready:true,
    model,
    output:finalOutput,
    nodeVersion:process.versions.node,
    persistedMessage,
    recoveredAfterPersist:!!runError,
  };
}

async function runWaitlistCancelPrepareProbe({
  agentContext,
  requestContext,
  preparedPrivacy,
  requestId,
}) {
  return runWaitlistCancelPrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId,
  });
}



function resolveMovePrepareScope(preparedPrivacy) {
  if (preparedPrivacy?.needsDisambiguation) {
    throw runtimeError(
      '학생 이름을 한 명으로 구분할 수 없습니다. 전체 이름으로 다시 알려 주세요.',
      409,
      'OLLI_AGENT_STUDENT_AMBIGUOUS'
    );
  }

  const subjectRefs=Array.isArray(preparedPrivacy?.subjectRefs)?preparedPrivacy.subjectRefs:[];
  if(subjectRefs.length!==1){
    throw runtimeError(
      '수업 이동은 한 번에 학생 한 명만 지정해 주세요.',
      400,
      'OLLI_AGENT_MOVE_SINGLE_STUDENT_REQUIRED'
    );
  }

  const subjectLabel=subjectRefs[0].label;
  const subject=preparedPrivacy?.subjectAccess?.resolve?.(subjectLabel);
  const division=String(subject?.division||'').trim().toLowerCase();
  if(!['elementary','kinder'].includes(division)){
    throw runtimeError(
      '수업 이동 대상 학생의 수업 구분을 확인하지 못했습니다.',
      400,
      'OLLI_AGENT_MOVE_DIVISION_REQUIRED'
    );
  }

  const safeText=String(preparedPrivacy?.safeText||'');
  const compact=safeText.replace(/\s+/g,'');
  const hasMove=/(?:수업이동|수업변경|시간표변경|옮겨|옮기|이동|변경|바꿔|바꾸)/.test(compact);
  const hasRemove=/(?:취소|삭제|지워|지우|제거|빼|해제|없애)/.test(compact);
  const weekdayMentions=Array.from(safeText.matchAll(/([월화수목금토])요일/g));
  const timeMentions=Array.from(safeText.matchAll(/\d{1,2}\s*시(?:\s*(?:30|0)\s*분)?/g));

  if(!hasMove||hasRemove||weekdayMentions.length<2||timeMentions.length<2){
    throw runtimeError(
      '수업 이동은 기존 수업과 새 수업의 요일·시간을 모두 알려 주세요.',
      400,
      'OLLI_AGENT_MOVE_INTENT_REQUIRED'
    );
  }

  return {subjectLabel,division};
}

async function runMovePrepareAgent({
  agentContext,
  requestContext,
  preparedPrivacy,
  requestId,
  replyToMessageId=null,
  requirePersistedMessage=false,
}) {
  const scope=resolveMovePrepareScope(preparedPrivacy);
  assertOpenAiKey();

  const {Agent,run,tool,z}=await loadAgentsSdk();
  const {createPrepareMoveTool}=require('./tools/move-prepare-tools.cjs');
  const {sanitizeAgentToolPayload}=require('./privacy.cjs');
  const model=agentModel();
  const today=todayInSeoul();
  let persistedMessage=null;

  const prepareMove=createPrepareMoveTool({
    tool,
    z,
    requestContext,
    subjectAccess:preparedPrivacy.subjectAccess,
    studentLabel:scope.subjectLabel,
    division:scope.division,
    currentDate:today,
    requestId,
    replyToMessageId,
    capturePersistedMessage(message){
      persistedMessage=pickupPersistedMessageForClient(message);
    },
    sanitizePayload(payload){
      return sanitizeAgentToolPayload(payload,preparedPrivacy);
    },
  });

  const agent=new Agent({
    name:requirePersistedMessage?'Olli Move Prepare':'Olli Move Prepare Probe',
    model,
    instructions:[
      'You are the Olli regular-class move preparation assistant.',
      'The user message has already been privacy-sanitized.',
      'The only available anonymous student label for this run is '+scope.subjectLabel+'.',
      'The server has fixed the student division to '+scope.division+'. Do not override it.',
      'Today in Korea is '+today+'.',
      'Always call prepare_move_class exactly once before answering.',
      'Read the first explicitly stated weekday/time pair as the current source class and the second explicitly stated weekday/time pair as the target class.',
      'weekday uses 1=Monday through 6=Saturday.',
      'Convert visible clock times to source_hour/source_minute and target_hour/target_minute. For 4시 30분 use 4 and 30.',
      'Set target_class_group to A or B only when the destination group is explicitly stated. If the destination group is omitted or unclear, use AUTO.',
      'Do not use a source-group mention as the target group.',
      'The server rechecks the current source enrollment, target operating slot, capacity, duplicate enrollment, and A/B behavior before storing the card.',
      'If target_class_group is AUTO, the server preserves the current source group when possible, matching the existing Olli behavior.',
      'The tool creates a pending confirmation card only. It never directly changes the regular timetable.',
      'Never say the class was moved. Say that the move is waiting for user confirmation.',
      'Never ask for, infer, or reveal a real student name, UUID, enrollment ID, internal time slot, member ID, session token, academy ID, action ID, or message ID.',
      'Answer briefly in Korean.',
    ].join(' '),
    tools:[prepareMove],
    modelSettings:{toolChoice:'prepare_move_class'},
    toolUseBehavior: requirePersistedMessage ? 'stop_on_first_tool' : 'run_llm_again',
  });

  let result=null;
  let runError=null;
  try{
    result=await run(agent,preparedPrivacy.safeText,{context:agentContext});
  }catch(error){
    runError=error;
    if(!requirePersistedMessage||!persistedMessage) throw error;
  }

  const finalOutput=String(result?.finalOutput||'').trim();
  if(!finalOutput&&(!requirePersistedMessage||!persistedMessage)){
    throw runtimeError(
      '수업 이동 준비 Agent 응답이 비어 있습니다.',
      502,
      'OLLI_AGENT_EMPTY_MOVE_PREPARE_RESPONSE'
    );
  }
  if(requirePersistedMessage&&!persistedMessage){
    throw runtimeError(
      '수업 이동 확인 카드 저장 결과를 확인하지 못했습니다.',
      502,
      'OLLI_AGENT_MOVE_PERSISTED_MESSAGE_MISSING'
    );
  }

  return {
    ready:true,
    model,
    output:finalOutput,
    nodeVersion:process.versions.node,
    persistedMessage,
    recoveredAfterPersist:!!runError,
  };
}

async function runMovePrepareProbe({
  agentContext,
  requestContext,
  preparedPrivacy,
  requestId,
}) {
  return runMovePrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId,
  });
}

function resolveMoveCancelPrepareScope(preparedPrivacy) {
  if (preparedPrivacy?.needsDisambiguation) {
    throw runtimeError(
      '학생 이름을 한 명으로 구분할 수 없습니다. 전체 이름으로 다시 알려 주세요.',
      409,
      'OLLI_AGENT_STUDENT_AMBIGUOUS'
    );
  }

  const subjectRefs=Array.isArray(preparedPrivacy?.subjectRefs)?preparedPrivacy.subjectRefs:[];
  if(subjectRefs.length!==1){
    throw runtimeError(
      '수업 이동 취소는 한 번에 학생 한 명만 지정해 주세요.',
      400,
      'OLLI_AGENT_MOVE_CANCEL_SINGLE_STUDENT_REQUIRED'
    );
  }

  const subjectLabel=subjectRefs[0].label;
  const subject=preparedPrivacy?.subjectAccess?.resolve?.(subjectLabel);
  const division=String(subject?.division||'').trim().toLowerCase();
  if(!['elementary','kinder'].includes(division)){
    throw runtimeError(
      '수업 이동 취소 대상 학생의 수업 구분을 확인하지 못했습니다.',
      400,
      'OLLI_AGENT_MOVE_CANCEL_DIVISION_REQUIRED'
    );
  }

  const safeText=String(preparedPrivacy?.safeText||'');
  const compact=safeText.replace(/\s+/g,'');
  const hasMove=/(?:수업이동|수업변경|시간표변경|이동예약|변경예약|옮긴|옮겨|이동|변경)/.test(compact);
  const hasRemove=/(?:취소|삭제|지워|지우|제거|빼|해제|없애)/.test(compact);
  if(!hasMove||!hasRemove){
    throw runtimeError(
      '예약된 수업 이동 취소 요청을 확인하지 못했습니다.',
      400,
      'OLLI_AGENT_MOVE_CANCEL_INTENT_REQUIRED'
    );
  }

  return {subjectLabel,division};
}

async function runMoveCancelPrepareAgent({
  agentContext,
  requestContext,
  preparedPrivacy,
  requestId,
  replyToMessageId=null,
  requirePersistedMessage=false,
}) {
  const scope=resolveMoveCancelPrepareScope(preparedPrivacy);
  assertOpenAiKey();

  const {Agent,run,tool,z}=await loadAgentsSdk();
  const {createPrepareMoveCancelTool}=require('./tools/move-cancel-prepare-tools.cjs');
  const {sanitizeAgentToolPayload}=require('./privacy.cjs');
  const model=agentModel();
  const today=todayInSeoul();
  let persistedMessage=null;

  const prepareMoveCancel=createPrepareMoveCancelTool({
    tool,
    z,
    requestContext,
    subjectAccess:preparedPrivacy.subjectAccess,
    studentLabel:scope.subjectLabel,
    division:scope.division,
    currentDate:today,
    requestId,
    replyToMessageId,
    capturePersistedMessage(message){
      persistedMessage=pickupPersistedMessageForClient(message);
    },
    sanitizePayload(payload){
      return sanitizeAgentToolPayload(payload,preparedPrivacy);
    },
  });

  const agent=new Agent({
    name:requirePersistedMessage?'Olli Move Cancel Prepare':'Olli Move Cancel Prepare Probe',
    model,
    instructions:[
      'You are the Olli scheduled-class-move cancellation preparation assistant.',
      'The user message has already been privacy-sanitized.',
      'The only available anonymous student label for this run is '+scope.subjectLabel+'.',
      'The server has fixed the student division to '+scope.division+'. Do not override it.',
      'Today in Korea is '+today+'.',
      'Always call prepare_move_cancel exactly once before answering.',
      'If the user explicitly names the original class weekday, pass source_weekday using 1=Monday through 6=Saturday. Otherwise pass 0.',
      'If the user explicitly names the original visible class time, pass source_hour and source_minute. For 4시 반 use 4 and 30. If the original time is omitted, pass 0 and 0.',
      'Use only the original/source class details for filtering. Do not use target class details as source details.',
      'The server re-reads current scheduled move rows and their source/target enrollments. If more than one still matches it rejects instead of guessing.',
      'The tool creates a pending confirmation card only. It never directly cancels a scheduled move.',
      'Never say the move was cancelled. Say the cancellation is waiting for user confirmation.',
      'Never ask for, infer, or reveal a real student name, UUID, change ID, enrollment ID, internal time slot, member ID, session token, academy ID, action ID, or message ID.',
      'Answer briefly in Korean.',
    ].join(' '),
    tools:[prepareMoveCancel],
    modelSettings:{toolChoice:'prepare_move_cancel'},
    toolUseBehavior: requirePersistedMessage ? 'stop_on_first_tool' : 'run_llm_again',
  });

  let result=null;
  let runError=null;
  try{
    result=await run(agent,preparedPrivacy.safeText,{context:agentContext});
  }catch(error){
    runError=error;
    if(!requirePersistedMessage||!persistedMessage) throw error;
  }

  const finalOutput=String(result?.finalOutput||'').trim();
  if(!finalOutput&&(!requirePersistedMessage||!persistedMessage)){
    throw runtimeError(
      '수업 이동 취소 준비 Agent 응답이 비어 있습니다.',
      502,
      'OLLI_AGENT_EMPTY_MOVE_CANCEL_PREPARE_RESPONSE'
    );
  }
  if(requirePersistedMessage&&!persistedMessage){
    throw runtimeError(
      '수업 이동 취소 확인 카드 저장 결과를 확인하지 못했습니다.',
      502,
      'OLLI_AGENT_MOVE_CANCEL_PERSISTED_MESSAGE_MISSING'
    );
  }

  return {
    ready:true,
    model,
    output:finalOutput,
    nodeVersion:process.versions.node,
    persistedMessage,
    recoveredAfterPersist:!!runError,
  };
}

async function runMoveCancelPrepareProbe({
  agentContext,
  requestContext,
  preparedPrivacy,
  requestId,
}) {
  return runMoveCancelPrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId,
  });
}


async function runAttendanceProbe({
  agentContext,
  requestContext,
  preparedPrivacy,
  session=null,
}) {
  assertOpenAiKey();

  const subjectRefs = Array.isArray(preparedPrivacy?.subjectRefs)
    ? preparedPrivacy.subjectRefs
    : [];

  if (preparedPrivacy?.needsDisambiguation) {
    throw runtimeError(
      '학생 이름을 한 명으로 구분할 수 없습니다. 전체 이름으로 다시 알려 주세요.',
      409,
      'OLLI_AGENT_STUDENT_AMBIGUOUS'
    );
  }

  if (subjectRefs.length !== 1) {
    throw runtimeError(
      '출결 조회에서는 학생 한 명을 정확히 지정해 주세요.',
      400,
      'OLLI_AGENT_SINGLE_STUDENT_REQUIRED'
    );
  }

  const { Agent, run, tool, z } = await loadAgentsSdk();
  const { createGetAttendanceTool } = require('./tools/attendance-tools.cjs');
  const { sanitizeAgentToolPayload } = require('./privacy.cjs');
  const model = agentModel();
  const today = todayInSeoul();
  const onlyLabel = subjectRefs[0].label;

  const getAttendance = createGetAttendanceTool({
    tool,
    z,
    requestContext,
    subjectAccess: preparedPrivacy.subjectAccess,
    sanitizePayload(payload) {
      return sanitizeAgentToolPayload(payload, preparedPrivacy);
    },
  });

  const agent = new Agent({
    name: 'Olli Attendance Probe',
    model,
    instructions: [
      'You are the Olli academy attendance assistant.',
      'The user message has already been privacy-sanitized.',
      'The only available anonymous student label for this run is ' + onlyLabel + '.',
      'Today in Korea is ' + today + '.',
      'Always use get_attendance before answering an attendance question.',
      'If the user names a specific date or range, use it. If the user asks generally about attendance without a range, use the current month from the first day through today.',
      'Use session_kind ALL unless the user explicitly asks only about regular classes or only about makeup classes.',
      'The maximum tool date range is 62 days.',
      'The tool already applies the same final-state rules as the attendance register: closed days are excluded; explicit session overrides take priority when newer; actual attendance is next; a past expected regular class without a mark is absent; an unmarked makeup remains blank.',
      'Do not treat blank as absent.',
      'Use only the tool result. Do not invent attendance states or reasons.',
      'Never ask for, infer, or reveal a real student name, UUID, member ID, session token, academy ID, or attendance row ID.',
      'Answer briefly in Korean.',
    ].join(' '),
    tools: [getAttendance],
    modelSettings: {
      toolChoice: 'get_attendance',
    },
  });

  const runOptions={ context:agentContext };
  if(session) runOptions.session=session;
  const result = await run(agent, preparedPrivacy.safeText, runOptions);

  const finalOutput = String(result?.finalOutput || '').trim();
  if (!finalOutput) {
    throw runtimeError(
      '출결 Agent 응답이 비어 있습니다.',
      502,
      'OLLI_AGENT_EMPTY_ATTENDANCE_RESPONSE'
    );
  }

  return {
    ready: true,
    model,
    output: finalOutput,
    nodeVersion: process.versions.node,
  };
}


async function runPickupProbe({
  agentContext,
  requestContext,
  preparedPrivacy,
  session=null,
}) {
  assertOpenAiKey();

  const subjectRefs = Array.isArray(preparedPrivacy?.subjectRefs)
    ? preparedPrivacy.subjectRefs
    : [];

  if (preparedPrivacy?.needsDisambiguation) {
    throw runtimeError(
      '학생 이름을 한 명으로 구분할 수 없습니다. 전체 이름으로 다시 알려 주세요.',
      409,
      'OLLI_AGENT_STUDENT_AMBIGUOUS'
    );
  }

  if (subjectRefs.length !== 1) {
    throw runtimeError(
      '픽업 조회에서는 학생 한 명을 정확히 지정해 주세요.',
      400,
      'OLLI_AGENT_SINGLE_STUDENT_REQUIRED'
    );
  }

  const { Agent, run, tool, z } = await loadAgentsSdk();
  const { createGetPickupsTool } = require('./tools/pickup-tools.cjs');
  const { sanitizeAgentToolPayload } = require('./privacy.cjs');
  const model = agentModel();
  const today = todayInSeoul();
  const onlyLabel = subjectRefs[0].label;

  const getPickups = createGetPickupsTool({
    tool,
    z,
    requestContext,
    subjectAccess:preparedPrivacy.subjectAccess,
    sanitizePayload(payload) {
      return sanitizeAgentToolPayload(payload, preparedPrivacy);
    },
  });

  const agent = new Agent({
    name:'Olli Pickup Probe',
    model,
    instructions:[
      'You are the Olli academy pickup-schedule assistant.',
      'The user message has already been privacy-sanitized.',
      'The only available anonymous student label for this run is ' + onlyLabel + '.',
      'Today in Korea is ' + today + '.',
      'Always use get_pickups before answering a pickup question.',
      'If the user names a date or range, use it. For this week or next week, use the corresponding Monday through Saturday. If no date is given, use today through the next 7 days.',
      'The maximum tool date range is 62 days.',
      'The tool distinguishes arrival pickup and dropoff. Arrival may have a place and time; dropoff has a place and may not have a time.',
      'If pickup_supported is false, explain that the student division is not using the kinder pickup timetable.',
      'Closed days are excluded from pickup occurrences.',
      'Use only the tool result. Do not invent times, locations, or transport details.',
      'Never ask for, infer, or reveal a real student name, UUID, pickup row ID, member ID, session token, or academy ID.',
      'Answer briefly in Korean.',
    ].join(' '),
    tools:[getPickups],
    modelSettings:{ toolChoice:'get_pickups' },
  });

  const runOptions={ context:agentContext };
  if(session) runOptions.session=session;
  const result = await run(agent, preparedPrivacy.safeText, runOptions);

  const finalOutput = String(result?.finalOutput || '').trim();
  if (!finalOutput) {
    throw runtimeError(
      '픽업 Agent 응답이 비어 있습니다.',
      502,
      'OLLI_AGENT_EMPTY_PICKUP_RESPONSE'
    );
  }

  return {
    ready:true,
    model,
    output:finalOutput,
    nodeVersion:process.versions.node,
  };
}


function resolveTimetableMemoScope(preparedPrivacy) {
  if (preparedPrivacy?.needsDisambiguation) {
    throw runtimeError(
      '학생 이름을 한 명으로 구분할 수 없습니다. 전체 이름으로 다시 알려 주세요.',
      409,
      'OLLI_AGENT_STUDENT_AMBIGUOUS'
    );
  }

  const subjectRefs = Array.isArray(preparedPrivacy?.subjectRefs)
    ? preparedPrivacy.subjectRefs
    : [];
  if (subjectRefs.length > 1) {
    throw runtimeError(
      '시간표 메모는 한 번에 학생 한 명만 지정해 주세요.',
      400,
      'OLLI_AGENT_TIMETABLE_MEMO_MULTI_STUDENT'
    );
  }

  const safeText = String(preparedPrivacy?.safeText || '');
  const elementaryExplicit = /(?:초등부|초등|elementary)/i.test(safeText);
  const kinderExplicit = /(?:유치부|유치|유아|kinder)/i.test(safeText);
  if (elementaryExplicit && kinderExplicit) {
    throw runtimeError(
      '초등부와 유치부 중 한 수업 구분만 지정해 주세요.',
      400,
      'OLLI_AGENT_TIMETABLE_MEMO_DIVISION_AMBIGUOUS'
    );
  }

  const explicitDivision = elementaryExplicit
    ? 'elementary'
    : (kinderExplicit ? 'kinder' : '');
  const subjectLabel = subjectRefs.length === 1 ? subjectRefs[0].label : '';

  let subjectDivision = '';
  if (subjectLabel) {
    const subject = preparedPrivacy?.subjectAccess?.resolve?.(subjectLabel);
    const value = String(subject?.division || '').trim().toLowerCase();
    if (value === 'elementary' || value === 'kinder') subjectDivision = value;
  }

  if (explicitDivision && subjectDivision && explicitDivision !== subjectDivision) {
    throw runtimeError(
      '지정한 학생의 수업 구분과 요청한 초등부·유치부가 서로 다릅니다.',
      400,
      'OLLI_AGENT_TIMETABLE_MEMO_DIVISION_MISMATCH'
    );
  }

  const division = subjectDivision || explicitDivision;
  if (!division) {
    throw runtimeError(
      '학생을 지정하지 않은 시간표 메모에는 초등부 또는 유치부를 함께 알려 주세요.',
      400,
      'OLLI_AGENT_TIMETABLE_MEMO_DIVISION_REQUIRED'
    );
  }

  const deleteIntent = /(?:메모.{0,20}(?:삭제|지워|지우|제거|없애)|(?:삭제|지워|지우|제거|없애).{0,20}메모)/.test(safeText);
  return {
    subjectLabel,
    division,
    operation:deleteIntent ? 'delete' : 'add',
  };
}

async function runTimetableMemoPrepareAgent({
  agentContext,
  requestContext,
  preparedPrivacy,
  requestId,
  memoNote,
  replyToMessageId = null,
  requirePersistedMessage = false,
}) {
  assertOpenAiKey();

  const scope = resolveTimetableMemoScope(preparedPrivacy);
  const { Agent, run, tool, z } = await loadAgentsSdk();
  const { createPrepareTimetableMemoTool } = require('./tools/timetable-memo-tools.cjs');
  const { sanitizeAgentToolPayload } = require('./privacy.cjs');
  const model = agentModel();
  const today = todayInSeoul();
  let persistedMessage = null;

  const prepareTimetableMemo = createPrepareTimetableMemoTool({
    tool,
    z,
    requestContext,
    subjectAccess:preparedPrivacy.subjectAccess,
    studentLabel:scope.subjectLabel,
    division:scope.division,
    operation:scope.operation,
    memoNote:String(memoNote || '').trim(),
    requestId,
    replyToMessageId,
    capturePersistedMessage(message) {
      persistedMessage = pickupPersistedMessageForClient(message);
    },
    sanitizePayload(payload) {
      return sanitizeAgentToolPayload(payload, preparedPrivacy);
    },
  });

  const subjectText = scope.subjectLabel
    ? 'The anonymous student label for this run is ' + scope.subjectLabel + '.'
    : 'This memo is not tied to a specific student.';

  const agent = new Agent({
    name:requirePersistedMessage ? 'Olli Timetable Memo Prepare' : 'Olli Timetable Memo Prepare Probe',
    model,
    instructions:[
      'You are the Olli timetable-memo preparation assistant.',
      'The user message has already been privacy-sanitized.',
      subjectText,
      'The server has fixed the division to ' + scope.division + ' and the operation to ' + scope.operation + '. Do not override them.',
      'The memo text is private server-side context and is not included in the model input or tool schema. Never ask for, infer, repeat, summarize, or invent memo text.',
      'Today in Korea is ' + today + '.',
      'Always call prepare_timetable_memo exactly once before answering.',
      'This tool creates a pending confirmation card only. It never directly changes timetable memo data.',
      'Resolve relative dates into YYYY-MM-DD.',
      'Use the visible clock hour from 1 to 12 and minute 0 or 30.',
      'If the user named a student but omitted the time, use hour 0 and minute 0 so the server can resolve a single class.',
      'Use class_group AUTO unless the user explicitly asked for A반 or B반.',
      'Never say the memo was saved or deleted. Say that the work is waiting for user confirmation.',
      'Never ask for, infer, or reveal a real student name, UUID, memo ID, memo text, internal time slot, member ID, session token, academy ID, action ID, or message ID.',
      'Answer briefly in Korean.',
    ].join(' '),
    tools:[prepareTimetableMemo],
    modelSettings:{toolChoice:'prepare_timetable_memo'},
    toolUseBehavior: requirePersistedMessage ? 'stop_on_first_tool' : 'run_llm_again',
  });

  let result = null;
  let runError = null;
  try {
    result = await run(agent, preparedPrivacy.safeText, {
      context:agentContext,
    });
  } catch (error) {
    runError = error;
    if (!requirePersistedMessage || !persistedMessage) throw error;
  }

  const finalOutput = String(result?.finalOutput || '').trim();
  if (!finalOutput && (!requirePersistedMessage || !persistedMessage)) {
    throw runtimeError(
      '시간표 메모 준비 Agent 응답이 비어 있습니다.',
      502,
      'OLLI_AGENT_EMPTY_TIMETABLE_MEMO_RESPONSE'
    );
  }
  if (requirePersistedMessage && !persistedMessage) {
    throw runtimeError(
      '시간표 메모 확인 카드 저장 결과를 확인하지 못했습니다.',
      502,
      'OLLI_AGENT_TIMETABLE_MEMO_PERSISTED_MESSAGE_MISSING'
    );
  }

  return {
    ready:true,
    model,
    output:finalOutput,
    nodeVersion:process.versions.node,
    persistedMessage,
    recoveredAfterPersist:!!runError,
  };
}

async function runTimetableMemoPrepareProbe({
  agentContext,
  requestContext,
  preparedPrivacy,
  requestId,
  memoNote,
}) {
  return runTimetableMemoPrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId,
    memoNote,
  });
}

async function validateTimetableMemoSourceMessage({
  requestContext,
  sourceMessageId,
  sourceMessageText,
  callRpc,
}) {
  try {
    return await validatePickupSourceMessage({
      requestContext,
      sourceMessageId,
      sourceMessageText,
      callRpc,
    });
  } catch (error) {
    const pickupCode = String(error?.code || '');
    if (!pickupCode.startsWith('OLLI_AGENT_PICKUP_SOURCE_')) throw error;
    const memoCode = pickupCode.replace(
      'OLLI_AGENT_PICKUP_SOURCE_',
      'OLLI_AGENT_TIMETABLE_MEMO_SOURCE_'
    );
    const message = String(error?.message || '원문 Team Chat 메시지를 확인하지 못했습니다.')
      .replace(/픽업/g, '시간표 메모');
    throw runtimeError(
      message,
      Number(error?.statusCode || 400),
      memoCode
    );
  }
}

async function runTimetableMemoPrepare({
  agentContext,
  requestContext,
  preparedPrivacy,
  sourceMessageId,
  sourceMessageText,
  memoNote,
}) {
  const sourceId = Number(sourceMessageId || 0);
  if (!Number.isSafeInteger(sourceId) || sourceId <= 0) {
    throw runtimeError(
      '원문 Team Chat 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_AGENT_TIMETABLE_MEMO_SOURCE_MESSAGE_INVALID'
    );
  }

  await validateTimetableMemoSourceMessage({
    requestContext,
    sourceMessageId:sourceId,
    sourceMessageText,
  });

  return runTimetableMemoPrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId:'team-chat-memo:' + sourceId,
    memoNote,
    replyToMessageId:sourceId,
    requirePersistedMessage:true,
  });
}


function resolvePickupPrepareScope(preparedPrivacy) {
  if (preparedPrivacy?.needsDisambiguation) {
    throw runtimeError(
      '학생 이름을 한 명으로 구분할 수 없습니다. 전체 이름으로 다시 알려 주세요.',
      409,
      'OLLI_AGENT_STUDENT_AMBIGUOUS'
    );
  }

  const subjectRefs = Array.isArray(preparedPrivacy?.subjectRefs)
    ? preparedPrivacy.subjectRefs
    : [];
  if (subjectRefs.length !== 1) {
    throw runtimeError(
      '픽업 등록은 한 번에 유치부 학생 한 명만 지정해 주세요.',
      400,
      'OLLI_AGENT_PICKUP_SINGLE_STUDENT_REQUIRED'
    );
  }

  const subjectLabel = subjectRefs[0].label;
  const subject = preparedPrivacy?.subjectAccess?.resolve?.(subjectLabel);
  const division = String(subject?.division || '').trim().toLowerCase();
  if (division !== 'kinder') {
    throw runtimeError(
      '픽업 등록은 유치부 학생만 지원해요.',
      400,
      'OLLI_AGENT_PICKUP_KINDER_ONLY'
    );
  }

  const safeText = String(preparedPrivacy?.safeText || '');
  if (/(?:초등부|초등|elementary)/i.test(safeText)) {
    throw runtimeError(
      '픽업 등록은 유치부 학생만 지원해요.',
      400,
      'OLLI_AGENT_PICKUP_KINDER_ONLY'
    );
  }

  const both = /등하원|등원[\s\S]{0,40}하원|하원[\s\S]{0,40}등원/.test(safeText);
  const pickupKind = both
    ? 'both'
    : (/하원/.test(safeText) ? 'dropoff' : 'arrival');

  return {
    subjectLabel,
    pickupKind,
  };
}

function resolvePickupUpdatePrepareScope(preparedPrivacy) {
  if (preparedPrivacy?.needsDisambiguation) {
    throw runtimeError(
      '학생 이름을 한 명으로 구분할 수 없습니다. 전체 이름으로 다시 알려 주세요.',
      409,
      'OLLI_AGENT_STUDENT_AMBIGUOUS'
    );
  }

  const subjectRefs = Array.isArray(preparedPrivacy?.subjectRefs)
    ? preparedPrivacy.subjectRefs
    : [];
  if (subjectRefs.length !== 1) {
    throw runtimeError(
      '픽업 수정은 한 번에 유치부 학생 한 명만 지정해 주세요.',
      400,
      'OLLI_AGENT_PICKUP_UPDATE_SINGLE_STUDENT_REQUIRED'
    );
  }

  const subjectLabel = subjectRefs[0].label;
  const subject = preparedPrivacy?.subjectAccess?.resolve?.(subjectLabel);
  const division = String(subject?.division || '').trim().toLowerCase();
  if (division !== 'kinder') {
    throw runtimeError(
      '픽업 수정은 유치부 학생만 지원해요.',
      400,
      'OLLI_AGENT_PICKUP_UPDATE_KINDER_ONLY'
    );
  }

  const safeText = String(preparedPrivacy?.safeText || '');
  if (/(?:초등부|초등|elementary)/i.test(safeText)) {
    throw runtimeError(
      '픽업 수정은 유치부 학생만 지원해요.',
      400,
      'OLLI_AGENT_PICKUP_UPDATE_KINDER_ONLY'
    );
  }

  const compact = safeText.replace(/\s+/g, '');
  const hasUpdate = /(?:수정|변경|바꿔|바꾸|고쳐)/.test(compact);
  const hasRemove = /(?:취소|삭제|지워|지우|제거|빼|해제|없애)/.test(compact);
  if (!/픽업/.test(compact) || !hasUpdate || hasRemove) {
    throw runtimeError(
      '픽업 수정 요청을 확인하지 못했습니다.',
      400,
      'OLLI_AGENT_PICKUP_UPDATE_INTENT_REQUIRED'
    );
  }

  return {
    subjectLabel,
    updateKind:/하원/.test(compact) ? 'dropoff' : 'arrival',
  };
}

async function runPickupUpdatePrepareAgent({
  agentContext,
  requestContext,
  preparedPrivacy,
  requestId,
  replyToMessageId = null,
  requirePersistedMessage = false,
}) {
  assertOpenAiKey();

  const scope = resolvePickupUpdatePrepareScope(preparedPrivacy);
  const { Agent, run, tool, z } = await loadAgentsSdk();
  const { createPreparePickupUpdateTool } = require('./tools/pickup-update-prepare-tools.cjs');
  const { sanitizeAgentToolPayload } = require('./privacy.cjs');
  const model = agentModel();
  const today = todayInSeoul();
  let persistedMessage = null;

  const preparePickupUpdate = createPreparePickupUpdateTool({
    tool,
    z,
    requestContext,
    subjectAccess:preparedPrivacy.subjectAccess,
    studentLabel:scope.subjectLabel,
    updateKind:scope.updateKind,
    currentDate:today,
    requestId,
    replyToMessageId,
    capturePersistedMessage(message) {
      persistedMessage = pickupPersistedMessageForClient(message);
    },
    sanitizePayload(payload) {
      return sanitizeAgentToolPayload(payload, preparedPrivacy);
    },
  });

  const kindInstruction = scope.updateKind === 'dropoff'
    ? 'This request updates dropoff pickup. Put only an explicitly requested new dropoff place in dropoff_label. Use empty arrival fields.'
    : 'This request updates arrival pickup. Put only explicitly requested new arrival place/time in arrival_label and arrival_time. Use an empty dropoff_label. The server may preserve an omitted existing arrival field.';

  const agent = new Agent({
    name:requirePersistedMessage ? 'Olli Pickup Update Prepare' : 'Olli Pickup Update Prepare Probe',
    model,
    instructions:[
      'You are the Olli pickup-update preparation assistant.',
      'The user message has already been privacy-sanitized.',
      'The only available anonymous student label for this run is ' + scope.subjectLabel + '.',
      'The server has fixed the update kind to ' + scope.updateKind + '. Do not override it.',
      kindInstruction,
      'Today in Korea is ' + today + '.',
      'Always call prepare_pickup_update exactly once before answering.',
      'This tool creates a pending confirmation card only. It never directly changes pickup data.',
      'If the user omitted the class weekday, use weekday 0.',
      'If the user omitted the class time, use class_hour 0 and class_minute 0.',
      'When provided, weekday uses 1=Monday through 6=Saturday.',
      'When provided, use the visible class clock hour from 1 to 12 and class_minute 0 or 30. Never use internal stored slots such as 7, 8, or 9 as class_hour.',
      'Convert an explicitly requested arrival pickup time to 24-hour HH:MM. Do not invent a place or time the user did not provide.',
      'The server re-reads the current pickup schedule and chooses an existing row only when the target is unique.',
      'Never say the pickup was changed. Say that the pickup update is waiting for user confirmation.',
      'Never ask for, infer, or reveal a real student name, UUID, pickup ID, member ID, session token, academy ID, action ID, message ID, or internal stored time slot.',
      'Answer briefly in Korean.',
    ].join(' '),
    tools:[preparePickupUpdate],
    modelSettings:{toolChoice:'prepare_pickup_update'},
    toolUseBehavior: requirePersistedMessage ? 'stop_on_first_tool' : 'run_llm_again',
  });

  let result = null;
  let runError = null;
  try {
    result = await run(agent, preparedPrivacy.safeText, {
      context:agentContext,
    });
  } catch (error) {
    runError = error;
    if (!requirePersistedMessage || !persistedMessage) throw error;
  }

  const finalOutput = String(result?.finalOutput || '').trim();
  if (!finalOutput && (!requirePersistedMessage || !persistedMessage)) {
    throw runtimeError(
      '픽업 수정 준비 Agent 응답이 비어 있습니다.',
      502,
      'OLLI_AGENT_EMPTY_PICKUP_UPDATE_PREPARE_RESPONSE'
    );
  }
  if (requirePersistedMessage && !persistedMessage) {
    throw runtimeError(
      '픽업 수정 확인 카드 저장 결과를 확인하지 못했습니다.',
      502,
      'OLLI_AGENT_PICKUP_UPDATE_PERSISTED_MESSAGE_MISSING'
    );
  }

  return {
    ready:true,
    model,
    output:finalOutput,
    nodeVersion:process.versions.node,
    persistedMessage,
    recoveredAfterPersist:!!runError,
  };
}

async function runPickupUpdatePrepareProbe({
  agentContext,
  requestContext,
  preparedPrivacy,
  requestId,
}) {
  return runPickupUpdatePrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId,
  });
}



function resolvePickupCancelPrepareScope(preparedPrivacy) {
  if (preparedPrivacy?.needsDisambiguation) {
    throw runtimeError(
      '학생 이름을 한 명으로 구분할 수 없습니다. 전체 이름으로 다시 알려 주세요.',
      409,
      'OLLI_AGENT_STUDENT_AMBIGUOUS'
    );
  }

  const subjectRefs = Array.isArray(preparedPrivacy?.subjectRefs)
    ? preparedPrivacy.subjectRefs
    : [];
  if (subjectRefs.length !== 1) {
    throw runtimeError(
      '픽업 삭제는 한 번에 유치부 학생 한 명만 지정해 주세요.',
      400,
      'OLLI_AGENT_PICKUP_CANCEL_SINGLE_STUDENT_REQUIRED'
    );
  }

  const subjectLabel = subjectRefs[0].label;
  const subject = preparedPrivacy?.subjectAccess?.resolve?.(subjectLabel);
  const division = String(subject?.division || '').trim().toLowerCase();
  if (division !== 'kinder') {
    throw runtimeError(
      '픽업 삭제는 유치부 학생만 지원해요.',
      400,
      'OLLI_AGENT_PICKUP_CANCEL_KINDER_ONLY'
    );
  }

  const safeText = String(preparedPrivacy?.safeText || '');
  if (/(?:초등부|초등|elementary)/i.test(safeText)) {
    throw runtimeError(
      '픽업 삭제는 유치부 학생만 지원해요.',
      400,
      'OLLI_AGENT_PICKUP_CANCEL_KINDER_ONLY'
    );
  }

  const compact = safeText.replace(/\s+/g, '');
  const hasRemove = /(?:취소|삭제|지워|지우|제거|빼|해제|없애)/.test(compact);
  if (!/픽업/.test(compact) || !hasRemove) {
    throw runtimeError(
      '픽업 삭제 요청을 확인하지 못했습니다.',
      400,
      'OLLI_AGENT_PICKUP_CANCEL_INTENT_REQUIRED'
    );
  }

  return {
    subjectLabel,
    cancelKind:/하원/.test(compact) ? 'dropoff' : 'all',
  };
}

async function runPickupCancelPrepareAgent({
  agentContext,
  requestContext,
  preparedPrivacy,
  requestId,
  replyToMessageId = null,
  requirePersistedMessage = false,
}) {
  assertOpenAiKey();

  const scope = resolvePickupCancelPrepareScope(preparedPrivacy);
  const { Agent, run, tool, z } = await loadAgentsSdk();
  const { createPreparePickupCancelTool } = require('./tools/pickup-cancel-prepare-tools.cjs');
  const { sanitizeAgentToolPayload } = require('./privacy.cjs');
  const model = agentModel();
  const today = todayInSeoul();
  let persistedMessage = null;

  const preparePickupCancel = createPreparePickupCancelTool({
    tool,
    z,
    requestContext,
    subjectAccess:preparedPrivacy.subjectAccess,
    studentLabel:scope.subjectLabel,
    cancelKind:scope.cancelKind,
    currentDate:today,
    requestId,
    replyToMessageId,
    capturePersistedMessage(message) {
      persistedMessage = pickupPersistedMessageForClient(message);
    },
    sanitizePayload(payload) {
      return sanitizeAgentToolPayload(payload, preparedPrivacy);
    },
  });

  const kindInstruction = scope.cancelKind === 'dropoff'
    ? 'This request removes only the dropoff part of the selected pickup. An existing arrival pickup must remain unchanged.'
    : 'This request removes the whole pickup schedule from the server-fixed effective date onward. Do not convert it to dropoff-only removal.';

  const agent = new Agent({
    name:requirePersistedMessage ? 'Olli Pickup Cancel Prepare' : 'Olli Pickup Cancel Prepare Probe',
    model,
    instructions:[
      'You are the Olli pickup-cancel preparation assistant.',
      'The user message has already been privacy-sanitized.',
      'The only available anonymous student label for this run is ' + scope.subjectLabel + '.',
      'The server has fixed the cancel kind to ' + scope.cancelKind + '. Do not override it.',
      kindInstruction,
      'Today in Korea is ' + today + '. The server fixes the cancellation effective date to today; never invent or change an effective date.',
      'Always call prepare_pickup_cancel exactly once before answering.',
      'This tool creates a pending confirmation card only. It never directly changes pickup data.',
      'If the user omitted the class weekday, use weekday 0.',
      'If the user omitted the class time, use class_hour 0 and class_minute 0.',
      'When provided, weekday uses 1=Monday through 6=Saturday.',
      'When provided, use the visible class clock hour from 1 to 12 and class_minute 0 or 30. Never use internal stored slots as class_hour.',
      'The server re-reads the current pickup schedule and chooses an existing row only when the target is unique.',
      'Never say the pickup was deleted. Say that the pickup deletion is waiting for user confirmation.',
      'Never ask for, infer, or reveal a real student name, UUID, pickup ID, member ID, session token, academy ID, action ID, message ID, or internal stored time slot.',
      'Answer briefly in Korean.',
    ].join(' '),
    tools:[preparePickupCancel],
    modelSettings:{toolChoice:'prepare_pickup_cancel'},
    toolUseBehavior: requirePersistedMessage ? 'stop_on_first_tool' : 'run_llm_again',
  });

  let result = null;
  let runError = null;
  try {
    result = await run(agent, preparedPrivacy.safeText, {
      context:agentContext,
    });
  } catch (error) {
    runError = error;
    if (!requirePersistedMessage || !persistedMessage) throw error;
  }

  const finalOutput = String(result?.finalOutput || '').trim();
  if (!finalOutput && (!requirePersistedMessage || !persistedMessage)) {
    throw runtimeError(
      '픽업 삭제 준비 Agent 응답이 비어 있습니다.',
      502,
      'OLLI_AGENT_EMPTY_PICKUP_CANCEL_PREPARE_RESPONSE'
    );
  }
  if (requirePersistedMessage && !persistedMessage) {
    throw runtimeError(
      '픽업 삭제 확인 카드 저장 결과를 확인하지 못했습니다.',
      502,
      'OLLI_AGENT_PICKUP_CANCEL_PERSISTED_MESSAGE_MISSING'
    );
  }

  return {
    ready:true,
    model,
    output:finalOutput,
    nodeVersion:process.versions.node,
    persistedMessage,
    recoveredAfterPersist:!!runError,
  };
}

async function runPickupCancelPrepareProbe({
  agentContext,
  requestContext,
  preparedPrivacy,
  requestId,
}) {
  return runPickupCancelPrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId,
  });
}

function pickupPersistedMessageForClient(message) {
  const action = message?.action && typeof message.action === 'object'
    ? message.action
    : null;
  const id = Number(message?.id || 0);
  if (!Number.isSafeInteger(id) || id <= 0 || !action?.id) return null;

  return {
    id,
    sender_member_id:null,
    sender_name:'올리',
    message_type:'ai',
    body:String(message?.body || '').trim(),
    reply_to_message_id:Number(message?.reply_to_message_id || 0) || null,
    created_at:message?.created_at || null,
    action:{
      id:String(action.id || '').trim(),
      action_type:String(action.action_type || '').trim(),
      status:String(action.status || '').trim(),
      revision:Number(action.revision || 0) || 0,
      created_at:action.created_at || null,
      updated_at:action.updated_at || null,
      resolved_at:action.resolved_at || null,
      error:action.error || null,
    },
  };
}

async function runPickupPrepareAgent({
  agentContext,
  requestContext,
  preparedPrivacy,
  requestId,
  replyToMessageId = null,
  requirePersistedMessage = false,
}) {
  assertOpenAiKey();

  const scope = resolvePickupPrepareScope(preparedPrivacy);
  const { Agent, run, tool, z } = await loadAgentsSdk();
  const { createPreparePickupAddTool } = require('./tools/pickup-prepare-tools.cjs');
  const { sanitizeAgentToolPayload } = require('./privacy.cjs');
  const model = agentModel();
  const today = todayInSeoul();
  let persistedMessage = null;

  const preparePickupAdd = createPreparePickupAddTool({
    tool,
    z,
    requestContext,
    subjectAccess:preparedPrivacy.subjectAccess,
    studentLabel:scope.subjectLabel,
    pickupKind:scope.pickupKind,
    currentDate:today,
    requestId,
    replyToMessageId,
    capturePersistedMessage(message) {
      persistedMessage = pickupPersistedMessageForClient(message);
    },
    sanitizePayload(payload) {
      return sanitizeAgentToolPayload(payload, preparedPrivacy);
    },
  });

  const kindInstruction = scope.pickupKind === 'both'
    ? 'This request contains both arrival and dropoff pickup. Fill arrival_label, arrival_time, and dropoff_label.'
    : (scope.pickupKind === 'dropoff'
      ? 'This request is dropoff-only. Fill dropoff_label and use empty strings for arrival_label and arrival_time.'
      : 'This request is arrival-only. Fill arrival_label and arrival_time and use an empty string for dropoff_label.');

  const agent = new Agent({
    name:requirePersistedMessage ? 'Olli Pickup Prepare' : 'Olli Pickup Prepare Probe',
    model,
    instructions:[
      'You are the Olli pickup-registration preparation assistant.',
      'The user message has already been privacy-sanitized.',
      'The only available anonymous student label for this run is ' + scope.subjectLabel + '.',
      'The server has fixed the pickup kind to ' + scope.pickupKind + '. Do not override it.',
      kindInstruction,
      'Today in Korea is ' + today + '.',
      'Always call prepare_pickup_add exactly once before answering.',
      'This tool creates a pending confirmation card only. It never directly changes pickup data.',
      'weekday uses 1=Monday through 6=Saturday.',
      'Use the visible class clock hour from 1 to 12 and class_minute 0 or 30. Never pass an internal stored slot such as 7, 8, or 9 as the clock hour.',
      'arrival_time must be converted to 24-hour HH:MM format.',
      'The server chooses the effective date as the next occurrence of the requested weekday, matching the existing Team Chat pickup behavior.',
      'Never say the pickup was saved. Say that the pickup registration is waiting for user confirmation.',
      'Never ask for, infer, or reveal a real student name, UUID, member ID, session token, academy ID, action ID, message ID, or internal stored time slot.',
      'Answer briefly in Korean.',
    ].join(' '),
    tools:[preparePickupAdd],
    modelSettings:{toolChoice:'prepare_pickup_add'},
    toolUseBehavior: requirePersistedMessage ? 'stop_on_first_tool' : 'run_llm_again',
  });

  let result = null;
  let runError = null;
  try {
    result = await run(agent, preparedPrivacy.safeText, {
      context:agentContext,
    });
  } catch (error) {
    runError = error;
    if (!requirePersistedMessage || !persistedMessage) throw error;
  }

  const finalOutput = String(result?.finalOutput || '').trim();
  if (!finalOutput && (!requirePersistedMessage || !persistedMessage)) {
    throw runtimeError(
      '픽업 등록 준비 Agent 응답이 비어 있습니다.',
      502,
      'OLLI_AGENT_EMPTY_PICKUP_PREPARE_RESPONSE'
    );
  }
  if (requirePersistedMessage && !persistedMessage) {
    throw runtimeError(
      '픽업 확인 카드 저장 결과를 확인하지 못했습니다.',
      502,
      'OLLI_AGENT_PICKUP_PERSISTED_MESSAGE_MISSING'
    );
  }

  return {
    ready:true,
    model,
    output:finalOutput,
    nodeVersion:process.versions.node,
    persistedMessage,
    recoveredAfterPersist:!!runError,
  };
}

async function runPickupPrepareProbe({
  agentContext,
  requestContext,
  preparedPrivacy,
  requestId,
}) {
  return runPickupPrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId,
  });
}

function normalizePickupSourceMessageText(value) {
  return String(value == null ? '' : value)
    .trim()
    .replace(/^\s*@올리(?:\s+|$)/, '')
    .trim();
}

async function validatePickupSourceMessage({
  requestContext,
  sourceMessageId,
  sourceMessageText,
  callRpc,
}) {
  const sourceId = Number(sourceMessageId || 0);
  if (!Number.isSafeInteger(sourceId) || sourceId <= 0 || sourceId >= Number.MAX_SAFE_INTEGER) {
    throw runtimeError(
      '원문 Team Chat 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_AGENT_PICKUP_SOURCE_MESSAGE_INVALID'
    );
  }

  const rpc = typeof callRpc === 'function'
    ? callRpc
    : require('./supabase-rpc.cjs').callSupabaseRpc;
  const payload = await rpc('olli_team_chat_list', {
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_before_message_id:sourceId + 1,
    p_limit:1,
  });

  if (!payload?.ok) {
    throw runtimeError(
      payload?.message || '원문 Team Chat 메시지를 확인하지 못했습니다.',
      403,
      payload?.code || 'OLLI_AGENT_PICKUP_SOURCE_MESSAGE_READ_FAILED'
    );
  }

  if (String(payload.current_member_id || '').trim() !== String(requestContext.memberId || '').trim()) {
    throw runtimeError(
      '원문 Team Chat 요청자 정보를 확인하지 못했습니다.',
      403,
      'OLLI_AGENT_PICKUP_SOURCE_CONTEXT_MISMATCH'
    );
  }

  const source = (Array.isArray(payload.messages) ? payload.messages : [])
    .find((item) => Number(item?.id || 0) === sourceId) || null;
  if (!source) {
    throw runtimeError(
      '원문 Team Chat 메시지를 찾지 못했습니다.',
      404,
      'OLLI_AGENT_PICKUP_SOURCE_MESSAGE_NOT_FOUND'
    );
  }

  if (String(source.sender_member_id || '').trim() !== String(requestContext.memberId || '').trim()) {
    throw runtimeError(
      '본인이 보낸 Team Chat 메시지만 픽업 Agent 원문으로 사용할 수 있습니다.',
      403,
      'OLLI_AGENT_PICKUP_SOURCE_MESSAGE_OWNER_MISMATCH'
    );
  }

  if (String(source.message_type || '').trim() !== 'text') {
    throw runtimeError(
      '일반 Team Chat 메시지만 픽업 Agent 원문으로 사용할 수 있습니다.',
      400,
      'OLLI_AGENT_PICKUP_SOURCE_MESSAGE_TYPE_INVALID'
    );
  }

  const storedText = normalizePickupSourceMessageText(source.body);
  const requestedText = normalizePickupSourceMessageText(sourceMessageText);
  if (!storedText || !requestedText || storedText !== requestedText) {
    throw runtimeError(
      '원문 Team Chat 메시지 내용이 현재 픽업 요청과 일치하지 않습니다.',
      409,
      'OLLI_AGENT_PICKUP_SOURCE_MESSAGE_BODY_MISMATCH'
    );
  }

  return source;
}

async function runPickupPrepare({
  agentContext,
  requestContext,
  preparedPrivacy,
  sourceMessageId,
  sourceMessageText,
}) {
  const sourceId = Number(sourceMessageId || 0);
  if (!Number.isSafeInteger(sourceId) || sourceId <= 0) {
    throw runtimeError(
      '원문 Team Chat 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_AGENT_PICKUP_SOURCE_MESSAGE_INVALID'
    );
  }

  await validatePickupSourceMessage({
    requestContext,
    sourceMessageId:sourceId,
    sourceMessageText,
  });

  return runPickupPrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId:'team-chat-message:' + sourceId,
    replyToMessageId:sourceId,
    requirePersistedMessage:true,
  });
}

async function runPickupUpdatePrepare({
  agentContext,
  requestContext,
  preparedPrivacy,
  sourceMessageId,
  sourceMessageText,
}) {
  const sourceId = Number(sourceMessageId || 0);
  if (!Number.isSafeInteger(sourceId) || sourceId <= 0) {
    throw runtimeError(
      '원문 Team Chat 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_AGENT_PICKUP_SOURCE_MESSAGE_INVALID'
    );
  }

  await validatePickupSourceMessage({
    requestContext,
    sourceMessageId:sourceId,
    sourceMessageText,
  });

  return runPickupUpdatePrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId:'team-chat-message:' + sourceId,
    replyToMessageId:sourceId,
    requirePersistedMessage:true,
  });
}

async function runPickupCancelPrepare({
  agentContext,
  requestContext,
  preparedPrivacy,
  sourceMessageId,
  sourceMessageText,
}) {
  const sourceId = Number(sourceMessageId || 0);
  if (!Number.isSafeInteger(sourceId) || sourceId <= 0) {
    throw runtimeError(
      '원문 Team Chat 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_AGENT_PICKUP_SOURCE_MESSAGE_INVALID'
    );
  }

  await validatePickupSourceMessage({
    requestContext,
    sourceMessageId:sourceId,
    sourceMessageText,
  });

  return runPickupCancelPrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId:'team-chat-message:' + sourceId,
    replyToMessageId:sourceId,
    requirePersistedMessage:true,
  });
}


async function validateAbsenceSourceMessage({
  requestContext,
  sourceMessageId,
  sourceMessageText,
  callRpc,
}) {
  try{
    return await validatePickupSourceMessage({
      requestContext,
      sourceMessageId,
      sourceMessageText,
      callRpc,
    });
  }catch(error){
    const pickupCode=String(error?.code||'');
    if(!pickupCode.startsWith('OLLI_AGENT_PICKUP_SOURCE_')) throw error;
    const code=pickupCode.replace('OLLI_AGENT_PICKUP_SOURCE_','OLLI_AGENT_ABSENCE_SOURCE_');
    const message=String(error?.message||'원문 Team Chat 메시지를 확인하지 못했습니다.')
      .replace(/픽업/g,'결석');
    throw runtimeError(message,Number(error?.statusCode||400),code);
  }
}

async function validateAbsenceReasonMessage({
  requestContext,
  reasonMessageId,
  reasonMessageText,
  reason,
  callRpc,
}) {
  let source;
  try{
    source=await validatePickupSourceMessage({
      requestContext,
      sourceMessageId:reasonMessageId,
      sourceMessageText:reasonMessageText,
      callRpc,
    });
  }catch(error){
    const pickupCode=String(error?.code||'');
    if(!pickupCode.startsWith('OLLI_AGENT_PICKUP_SOURCE_')) throw error;
    const code=pickupCode.replace('OLLI_AGENT_PICKUP_SOURCE_','OLLI_AGENT_ABSENCE_REASON_');
    const message=String(error?.message||'결석 사유 메시지를 확인하지 못했습니다.')
      .replace(/원문 Team Chat/g,'결석 사유')
      .replace(/픽업 Agent 원문/g,'결석 사유');
    throw runtimeError(message,Number(error?.statusCode||400),code);
  }

  const {normalizeAbsenceReason}=require('./tools/absence-prepare-tools.cjs');
  const normalizedReason=normalizeAbsenceReason(reason);
  const storedText=normalizePickupSourceMessageText(source?.body);
  const requestedText=normalizePickupSourceMessageText(reasonMessageText);
  if(!storedText||!requestedText||storedText!==requestedText||!requestedText.includes(normalizedReason)){
    throw runtimeError(
      '결석 사유가 저장된 Team Chat 메시지와 일치하지 않습니다.',
      409,
      'OLLI_AGENT_ABSENCE_REASON_BODY_MISMATCH'
    );
  }
  return {source,reason:normalizedReason};
}

async function runAbsencePrepare({
  agentContext,
  requestContext,
  preparedPrivacy,
  sourceMessageId,
  sourceMessageText,
  reasonMessageId,
  reasonMessageText,
  reason,
}) {
  const sourceId=Number(sourceMessageId||0);
  const reasonId=Number(reasonMessageId||0);
  if(!Number.isSafeInteger(sourceId)||sourceId<=0){
    throw runtimeError('원문 Team Chat 메시지 식별값이 올바르지 않습니다.',400,'OLLI_AGENT_ABSENCE_SOURCE_MESSAGE_INVALID');
  }
  if(!Number.isSafeInteger(reasonId)||reasonId<=0){
    throw runtimeError('결석 사유 메시지 식별값이 올바르지 않습니다.',400,'OLLI_AGENT_ABSENCE_REASON_MESSAGE_INVALID');
  }

  await validateAbsenceSourceMessage({
    requestContext,
    sourceMessageId:sourceId,
    sourceMessageText,
  });
  const validatedReason=await validateAbsenceReasonMessage({
    requestContext,
    reasonMessageId:reasonId,
    reasonMessageText,
    reason,
  });

  return runAbsencePrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId:'team-chat-absence:'+sourceId+':'+reasonId,
    reason:validatedReason.reason,
    replyToMessageId:reasonId,
    requirePersistedMessage:true,
  });
}

async function validateClassOnceSourceMessage({
  requestContext,
  sourceMessageId,
  sourceMessageText,
  callRpc,
}) {
  try {
    return await validatePickupSourceMessage({
      requestContext,
      sourceMessageId,
      sourceMessageText,
      callRpc,
    });
  } catch (error) {
    const pickupCode=String(error?.code||'');
    if(!pickupCode.startsWith('OLLI_AGENT_PICKUP_SOURCE_')) throw error;
    const classCode=pickupCode.replace(
      'OLLI_AGENT_PICKUP_SOURCE_',
      'OLLI_AGENT_CLASS_ONCE_SOURCE_'
    );
    const message=String(error?.message||'원문 Team Chat 메시지를 확인하지 못했습니다.')
      .replace(/픽업/g,'1회 수업');
    throw runtimeError(
      message,
      Number(error?.statusCode||400),
      classCode
    );
  }
}

async function runClassOncePrepare({
  agentContext,
  requestContext,
  preparedPrivacy,
  sourceMessageId,
  sourceMessageText,
}) {
  const sourceId=Number(sourceMessageId||0);
  if(!Number.isSafeInteger(sourceId)||sourceId<=0){
    throw runtimeError(
      '원문 Team Chat 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_AGENT_CLASS_ONCE_SOURCE_MESSAGE_INVALID'
    );
  }

  await validateClassOnceSourceMessage({
    requestContext,
    sourceMessageId:sourceId,
    sourceMessageText,
  });

  return runClassOncePrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId:'team-chat-message:'+sourceId,
    replyToMessageId:sourceId,
    requirePersistedMessage:true,
  });
}


async function validateMakeupSourceMessage({
  requestContext,
  sourceMessageId,
  sourceMessageText,
  callRpc,
}) {
  try {
    return await validatePickupSourceMessage({
      requestContext,
      sourceMessageId,
      sourceMessageText,
      callRpc,
    });
  } catch (error) {
    const pickupCode = String(error?.code || '');
    if (!pickupCode.startsWith('OLLI_AGENT_PICKUP_SOURCE_')) throw error;

    const makeupCode = pickupCode.replace(
      'OLLI_AGENT_PICKUP_SOURCE_',
      'OLLI_AGENT_MAKEUP_SOURCE_'
    );
    const message = String(error?.message || '원문 Team Chat 메시지를 확인하지 못했습니다.')
      .replace(/픽업/g, '보강');

    throw runtimeError(
      message,
      Number(error?.statusCode || 400),
      makeupCode
    );
  }
}



async function validateMoveSourceMessage({
  requestContext,
  sourceMessageId,
  sourceMessageText,
  callRpc,
}) {
  try {
    return await validatePickupSourceMessage({
      requestContext,
      sourceMessageId,
      sourceMessageText,
      callRpc,
    });
  } catch (error) {
    const pickupCode=String(error?.code||'');
    if(!pickupCode.startsWith('OLLI_AGENT_PICKUP_SOURCE_')) throw error;
    const moveCode=pickupCode.replace('OLLI_AGENT_PICKUP_SOURCE_','OLLI_AGENT_MOVE_SOURCE_');
    const message=String(error?.message||'원문 Team Chat 메시지를 확인하지 못했습니다.')
      .replace(/픽업/g,'수업 이동 취소');
    throw runtimeError(
      message,
      Number(error?.statusCode||400),
      moveCode
    );
  }
}

async function runMovePrepare({
  agentContext,
  requestContext,
  preparedPrivacy,
  sourceMessageId,
  sourceMessageText,
}) {
  const sourceId=Number(sourceMessageId||0);
  if(!Number.isSafeInteger(sourceId)||sourceId<=0){
    throw runtimeError(
      '원문 Team Chat 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_AGENT_MOVE_SOURCE_MESSAGE_INVALID'
    );
  }

  await validateMoveSourceMessage({
    requestContext,
    sourceMessageId:sourceId,
    sourceMessageText,
  });

  return runMovePrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId:'team-chat-message:'+sourceId,
    replyToMessageId:sourceId,
    requirePersistedMessage:true,
  });
}

async function runMoveCancelPrepare({
  agentContext,
  requestContext,
  preparedPrivacy,
  sourceMessageId,
  sourceMessageText,
}) {
  const sourceId=Number(sourceMessageId||0);
  if(!Number.isSafeInteger(sourceId)||sourceId<=0){
    throw runtimeError(
      '원문 Team Chat 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_AGENT_MOVE_SOURCE_MESSAGE_INVALID'
    );
  }

  await validateMoveSourceMessage({
    requestContext,
    sourceMessageId:sourceId,
    sourceMessageText,
  });

  return runMoveCancelPrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId:'team-chat-message:'+sourceId,
    replyToMessageId:sourceId,
    requirePersistedMessage:true,
  });
}

async function runMakeupPrepare({
  agentContext,
  requestContext,
  preparedPrivacy,
  sourceMessageId,
  sourceMessageText,
}) {
  const sourceId = Number(sourceMessageId || 0);
  if (!Number.isSafeInteger(sourceId) || sourceId <= 0) {
    throw runtimeError(
      '원문 Team Chat 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_AGENT_MAKEUP_SOURCE_MESSAGE_INVALID'
    );
  }

  await validateMakeupSourceMessage({
    requestContext,
    sourceMessageId:sourceId,
    sourceMessageText,
  });

  return runMakeupPrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId:'team-chat-message:' + sourceId,
    replyToMessageId:sourceId,
    requirePersistedMessage:true,
  });
}


async function runMakeupUpdatePrepare({
  agentContext,
  requestContext,
  preparedPrivacy,
  sourceMessageId,
  sourceMessageText,
}) {
  const sourceId = Number(sourceMessageId || 0);
  if (!Number.isSafeInteger(sourceId) || sourceId <= 0) {
    throw runtimeError(
      '원문 Team Chat 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_AGENT_MAKEUP_SOURCE_MESSAGE_INVALID'
    );
  }

  await validateMakeupSourceMessage({
    requestContext,
    sourceMessageId:sourceId,
    sourceMessageText,
  });

  return runMakeupUpdatePrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId:'team-chat-message:' + sourceId,
    replyToMessageId:sourceId,
    requirePersistedMessage:true,
  });
}


async function validateMakeupReasonMessage({
  requestContext,
  reasonMessageId,
  reasonMessageText,
  reason,
  callRpc,
}) {
  let source;
  try {
    source = await validatePickupSourceMessage({
      requestContext,
      sourceMessageId:reasonMessageId,
      sourceMessageText:reasonMessageText,
      callRpc,
    });
  } catch (error) {
    const pickupCode = String(error?.code || '');
    if (!pickupCode.startsWith('OLLI_AGENT_PICKUP_SOURCE_')) throw error;
    const code = pickupCode.replace(
      'OLLI_AGENT_PICKUP_SOURCE_',
      'OLLI_AGENT_MAKEUP_REASON_'
    );
    const message = String(error?.message || '보강 취소 사유 메시지를 확인하지 못했습니다.')
      .replace(/원문 Team Chat/g, '보강 취소 사유')
      .replace(/픽업 Agent 원문/g, '보강 취소 사유')
      .replace(/픽업/g, '보강 취소');
    throw runtimeError(message, Number(error?.statusCode || 400), code);
  }

  const { normalizeMakeupCancelReason } = require('./tools/makeup-cancel-prepare-tools.cjs');
  const normalizedReason = normalizeMakeupCancelReason(reason);
  const storedText = normalizePickupSourceMessageText(source?.body);
  const requestedText = normalizePickupSourceMessageText(reasonMessageText);
  if (
    !storedText ||
    !requestedText ||
    storedText !== requestedText ||
    !requestedText.includes(normalizedReason)
  ) {
    throw runtimeError(
      '보강 취소 사유가 저장된 Team Chat 메시지와 일치하지 않습니다.',
      409,
      'OLLI_AGENT_MAKEUP_REASON_BODY_MISMATCH'
    );
  }
  return { source, reason:normalizedReason };
}

async function runMakeupCancelPrepare({
  agentContext,
  requestContext,
  preparedPrivacy,
  sourceMessageId,
  sourceMessageText,
  reasonMessageId,
  reasonMessageText,
  reason,
}) {
  const sourceId = Number(sourceMessageId || 0);
  const reasonId = Number(reasonMessageId || 0);
  if (!Number.isSafeInteger(sourceId) || sourceId <= 0) {
    throw runtimeError(
      '원문 Team Chat 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_AGENT_MAKEUP_SOURCE_MESSAGE_INVALID'
    );
  }
  if (!Number.isSafeInteger(reasonId) || reasonId <= 0) {
    throw runtimeError(
      '보강 취소 사유 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_AGENT_MAKEUP_REASON_MESSAGE_INVALID'
    );
  }

  await validateMakeupSourceMessage({
    requestContext,
    sourceMessageId:sourceId,
    sourceMessageText,
  });
  const validatedReason = await validateMakeupReasonMessage({
    requestContext,
    reasonMessageId:reasonId,
    reasonMessageText,
    reason,
  });

  return runMakeupCancelPrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId:'team-chat-makeup-cancel:' + sourceId + ':' + reasonId,
    reason:validatedReason.reason,
    replyToMessageId:reasonId,
    requirePersistedMessage:true,
  });
}


async function validateWaitlistSourceMessage({
  requestContext,
  sourceMessageId,
  sourceMessageText,
  callRpc,
}) {
  try {
    return await validatePickupSourceMessage({
      requestContext,
      sourceMessageId,
      sourceMessageText,
      callRpc,
    });
  } catch (error) {
    const pickupCode = String(error?.code || '');
    if (!pickupCode.startsWith('OLLI_AGENT_PICKUP_SOURCE_')) throw error;

    const waitlistCode = pickupCode.replace(
      'OLLI_AGENT_PICKUP_SOURCE_',
      'OLLI_AGENT_WAITLIST_SOURCE_'
    );
    const message = String(error?.message || '원문 Team Chat 메시지를 확인하지 못했습니다.')
      .replace(/픽업/g, '대기');

    throw runtimeError(
      message,
      Number(error?.statusCode || 400),
      waitlistCode
    );
  }
}

async function runWaitlistCancelPrepare({
  agentContext,
  requestContext,
  preparedPrivacy,
  sourceMessageId,
  sourceMessageText,
}) {
  const sourceId = Number(sourceMessageId || 0);
  if (!Number.isSafeInteger(sourceId) || sourceId <= 0) {
    throw runtimeError(
      '원문 Team Chat 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_AGENT_WAITLIST_SOURCE_MESSAGE_INVALID'
    );
  }

  await validateWaitlistSourceMessage({
    requestContext,
    sourceMessageId:sourceId,
    sourceMessageText,
  });

  return runWaitlistCancelPrepareAgent({
    agentContext,
    requestContext,
    preparedPrivacy,
    requestId:'team-chat-message:' + sourceId,
    replyToMessageId:sourceId,
    requirePersistedMessage:true,
  });
}


async function runStudentProfileProbe({
  agentContext,
  requestContext,
  preparedPrivacy,
}) {
  assertOpenAiKey();

  const subjectRefs = Array.isArray(preparedPrivacy?.subjectRefs)
    ? preparedPrivacy.subjectRefs
    : [];

  if (preparedPrivacy?.needsDisambiguation) {
    throw runtimeError(
      '학생 이름을 한 명으로 구분할 수 없습니다. 전체 이름으로 다시 알려 주세요.',
      409,
      'OLLI_AGENT_STUDENT_AMBIGUOUS'
    );
  }

  if (subjectRefs.length !== 1) {
    throw runtimeError(
      '학생 기본정보 조회에서는 학생 한 명을 정확히 지정해 주세요.',
      400,
      'OLLI_AGENT_SINGLE_STUDENT_REQUIRED'
    );
  }

  const { Agent, run, tool, z } = await loadAgentsSdk();
  const { createGetStudentProfileTool } = require('./tools/profile-tools.cjs');
  const { sanitizeAgentToolPayload } = require('./privacy.cjs');
  const model = agentModel();
  const onlyLabel = subjectRefs[0].label;

  const getStudentProfile = createGetStudentProfileTool({
    tool,
    z,
    requestContext,
    subjectAccess:preparedPrivacy.subjectAccess,
    sanitizePayload(payload) {
      return sanitizeAgentToolPayload(payload, preparedPrivacy);
    },
  });

  const agent = new Agent({
    name:'Olli Student Profile Probe',
    model,
    instructions:[
      'You are the Olli academy student-profile assistant.',
      'The user message has already been privacy-sanitized.',
      'The only available anonymous student label for this run is ' + onlyLabel + '.',
      'Always use get_student_profile before answering a student basic-profile question.',
      'The tool intentionally returns only minimum profile fields: division, current status, grade, age, and enrollment date.',
      'School or kindergarten names, personality labels, memos, old lesson-day/time fields, internal IDs, and the real student name are intentionally excluded.',
      'If the user asks for an excluded field, explain briefly that it is not available in this AI profile scope instead of guessing.',
      'Use only the tool result. Do not infer missing grade, age, or dates.',
      'Never ask for, infer, or reveal a real student name, UUID, member ID, session token, academy ID, school name, kindergarten name, or memo.',
      'Answer briefly in Korean.',
    ].join(' '),
    tools:[getStudentProfile],
    modelSettings:{ toolChoice:'get_student_profile' },
  });

  const result = await run(agent, preparedPrivacy.safeText, {
    context:agentContext,
  });

  const finalOutput = String(result?.finalOutput || '').trim();
  if (!finalOutput) {
    throw runtimeError(
      '학생 기본정보 Agent 응답이 비어 있습니다.',
      502,
      'OLLI_AGENT_EMPTY_STUDENT_PROFILE_RESPONSE'
    );
  }

  return {
    ready:true,
    model,
    output:finalOutput,
    nodeVersion:process.versions.node,
  };
}

function normalizeBatchPartText(value) {
  return String(value || '').trim().replace(/\s+/g,' ');
}

function splitBatchWriteParts(value) {
  return String(value || '')
    .trim()
    .split(/\s*(?:;|그리고|그다음|그 다음|하고|\n)\s*[,，]?\s*/g)
    .map(normalizeBatchPartText)
    .filter(Boolean);
}

function batchExpectedActionTypes(intent) {
  const key=String(intent || '').trim();
  const map={
    add_timetable_memo:['add_timetable_memo'],
    delete_timetable_memo:['delete_timetable_memo'],
    mark_absent:['mark_absent'],
    add_class_once:['add_class_once'],
    add_makeup:['add_makeup'],
    update_makeup:['update_makeup'],
    cancel_makeup:['cancel_makeup'],
    add_trial:['add_trial'],
    update_trial:['update_trial'],
    cancel_trial:['cancel_trial'],
    add_waitlist:['add_waitlist'],
    update_waitlist:['update_waitlist'],
    cancel_waitlist:['cancel_waitlist'],
    move_class:['move_class'],
    cancel_move:['cancel_move'],
    add_pickup:['add_pickup'],
    update_pickup:['update_pickup_arrival','update_pickup_dropoff'],
    cancel_pickup:['cancel_pickup','cancel_pickup_dropoff'],
  };
  return map[key] || [];
}

async function prepareBatchPrivacy(item, requestContext) {
  const intent=String(item?.intent || '').trim();
  const text=String(item?.contextText || item?.text || '').trim();
  const reason=String(item?.reason || '').trim();
  const memoNote=String(item?.memoNote || '').trim();

  if(intent==='add_trial' || intent==='update_trial'){
    return require('./trial-guest-privacy.cjs').prepareTrialGuestPrivacyInput(text);
  }
  if(intent==='cancel_trial'){
    return require('./trial-guest-privacy.cjs').prepareTrialCancelPrivacyInput(text,reason);
  }

  const privacy=require('./privacy.cjs');
  if(intent==='mark_absent'){
    return privacy.prepareAbsencePrivacyInput(text,reason,requestContext);
  }
  if(intent==='cancel_makeup'){
    return privacy.prepareMakeupCancelPrivacyInput(text,reason,requestContext);
  }
  if(intent==='add_timetable_memo' || intent==='delete_timetable_memo'){
    return privacy.prepareTimetableMemoPrivacyInput(text,memoNote,requestContext);
  }
  if(['add_waitlist','update_waitlist','cancel_waitlist'].includes(intent)){
    const registered=await privacy.prepareAgentPrivacyInput(text,requestContext);
    if(Array.isArray(registered?.subjectRefs) && registered.subjectRefs.length>0) return registered;
    return require('./waitlist-guest-privacy.cjs').prepareWaitlistGuestPrivacyInput(text);
  }
  return privacy.prepareAgentPrivacyInput(text,requestContext);
}

async function runBatchPrepare({
  agentContext,
  requestContext,
  sourceMessageId,
  sourceMessageText,
  commands,
}) {
  const sourceId=Number(sourceMessageId || 0);
  if(!Number.isSafeInteger(sourceId) || sourceId<=0){
    throw runtimeError(
      '복합쓰기 원문 Team Chat 메시지 식별값이 올바르지 않습니다.',
      400,
      'OLLI_AGENT_BATCH_SOURCE_MESSAGE_INVALID'
    );
  }

  await validatePickupSourceMessage({
    requestContext,
    sourceMessageId:sourceId,
    sourceMessageText,
  });

  const items=Array.isArray(commands) ? commands : [];
  if(items.length<2 || items.length>3){
    throw runtimeError(
      '복합쓰기는 한 번에 2개 또는 3개 작업만 지원합니다.',
      400,
      'OLLI_AGENT_BATCH_COUNT_INVALID'
    );
  }

  const parts=splitBatchWriteParts(sourceMessageText);
  if(parts.length!==items.length){
    throw runtimeError(
      '복합쓰기 원문의 작업 개수가 요청 데이터와 일치하지 않습니다.',
      409,
      'OLLI_AGENT_BATCH_PARTS_MISMATCH'
    );
  }

  for(let index=0; index<items.length; index+=1){
    const item=items[index] || {};
    const intent=String(item.intent || '').trim();
    const text=String(item.text || '').trim();
    if(!batchExpectedActionTypes(intent).length){
      throw runtimeError(
        '복합쓰기에서 아직 지원하지 않는 작업이 포함되어 있습니다.',
        400,
        'OLLI_AGENT_BATCH_INTENT_UNSUPPORTED'
      );
    }
    if(!text || normalizeBatchPartText(text)!==normalizeBatchPartText(parts[index])){
      throw runtimeError(
        '복합쓰기 부분 명령이 저장된 원문과 일치하지 않습니다.',
        409,
        'OLLI_AGENT_BATCH_PART_BODY_MISMATCH'
      );
    }
    if(item?.needsClarification===true){
      throw runtimeError(
        '복합쓰기 작업에 필요한 추가 정보가 아직 없습니다.',
        400,
        'OLLI_AGENT_BATCH_CLARIFICATION_REQUIRED'
      );
    }
    const memoNote=String(item.memoNote || '').trim();
    if(intent==='add_timetable_memo' && (!memoNote || !text.includes(memoNote))){
      throw runtimeError(
        '시간표 메모 내용이 원문과 일치하지 않습니다.',
        409,
        'OLLI_AGENT_BATCH_MEMO_BODY_MISMATCH'
      );
    }
    if(intent==='delete_timetable_memo' && memoNote && !text.includes(memoNote)){
      throw runtimeError(
        '삭제할 시간표 메모 내용이 원문과 일치하지 않습니다.',
        409,
        'OLLI_AGENT_BATCH_MEMO_BODY_MISMATCH'
      );
    }
  }

  // Validate every stored clarification before creating any pending action card.
  for(const item of items){
    const clarificationMessageId=Number(item?.clarificationMessageId || 0);
    const clarificationMessageText=String(item?.clarificationMessageText || '').trim();
    const contextText=String(item?.contextText || '').trim();
    if(!clarificationMessageId && !clarificationMessageText && !contextText) continue;
    if(!Number.isSafeInteger(clarificationMessageId) || clarificationMessageId<=0 || !clarificationMessageText || !contextText){
      throw runtimeError(
        '복합쓰기 추가 정보 메시지를 확인하지 못했습니다.',
        400,
        'OLLI_AGENT_BATCH_CLARIFICATION_MESSAGE_REQUIRED'
      );
    }
    await validatePickupSourceMessage({
      requestContext,
      sourceMessageId:clarificationMessageId,
      sourceMessageText:clarificationMessageText,
    });
    const expectedContext=normalizeBatchPartText(String(item?.text || '')+' '+clarificationMessageText);
    if(normalizeBatchPartText(contextText)!==expectedContext){
      throw runtimeError(
        '복합쓰기 추가 정보가 저장된 메시지와 일치하지 않습니다.',
        409,
        'OLLI_AGENT_BATCH_CLARIFICATION_BODY_MISMATCH'
      );
    }
  }

  // Validate every reason-bearing item before creating any pending action card.
  for(const item of items){
    const intent=String(item?.intent || '').trim();
    if(!['mark_absent','cancel_makeup','cancel_trial'].includes(intent)) continue;
    const reason=String(item?.reason || '').trim();
    const reasonMessageId=Number(item?.reasonMessageId || 0);
    const reasonMessageText=String(item?.reasonMessageText || '').trim();
    if(!reason || !Number.isSafeInteger(reasonMessageId) || reasonMessageId<=0 || !reasonMessageText){
      throw runtimeError(
        '복합쓰기의 사유가 필요한 작업에 사유 메시지가 없습니다.',
        400,
        'OLLI_AGENT_BATCH_REASON_REQUIRED'
      );
    }
    if(intent==='mark_absent'){
      await validateAbsenceReasonMessage({
        requestContext,
        reasonMessageId,
        reasonMessageText,
        reason,
      });
    }else if(intent==='cancel_makeup'){
      await validateMakeupReasonMessage({
        requestContext,
        reasonMessageId,
        reasonMessageText,
        reason,
      });
    }else{
      await validateTrialReasonMessage({
        requestContext,
        reasonMessageId,
        reasonMessageText,
        reason,
      });
    }
  }

  const preparedMessages=[];
  for(let index=0; index<items.length; index+=1){
    const item=items[index];
    const intent=String(item.intent || '').trim();
    const privacy=await prepareBatchPrivacy(item,requestContext);
    const common={
      agentContext,
      requestContext,
      preparedPrivacy:privacy,
      requestId:'team-chat-batch:'+sourceId+':'+index+':'+intent,
      replyToMessageId:sourceId,
      requirePersistedMessage:true,
    };
    let result;

    if(intent==='add_timetable_memo' || intent==='delete_timetable_memo'){
      result=await runTimetableMemoPrepareAgent({
        ...common,
        memoNote:String(item.memoNote || '').trim(),
      });
    }else if(intent==='mark_absent'){
      result=await runAbsencePrepareAgent({...common,reason:String(item.reason || '').trim()});
    }else if(intent==='add_class_once'){
      result=await runClassOncePrepareAgent(common);
    }else if(intent==='add_makeup'){
      result=await runMakeupPrepareAgent(common);
    }else if(intent==='update_makeup'){
      result=await runMakeupUpdatePrepareAgent(common);
    }else if(intent==='cancel_makeup'){
      result=await runMakeupCancelPrepareAgent({...common,reason:String(item.reason || '').trim()});
    }else if(intent==='add_trial'){
      result=await runTrialAddPrepareAgent(common);
    }else if(intent==='update_trial'){
      result=await runTrialUpdatePrepareAgent(common);
    }else if(intent==='cancel_trial'){
      result=await runTrialCancelPrepareAgent({...common,reason:String(item.reason || '').trim()});
    }else if(intent==='add_waitlist'){
      result=await runWaitlistAddPrepareAgent(common);
    }else if(intent==='update_waitlist'){
      result=await runWaitlistUpdatePrepareAgent(common);
    }else if(intent==='cancel_waitlist'){
      result=await runWaitlistCancelPrepareAgent(common);
    }else if(intent==='move_class'){
      result=await runMovePrepareAgent(common);
    }else if(intent==='cancel_move'){
      result=await runMoveCancelPrepareAgent(common);
    }else if(intent==='add_pickup'){
      result=await runPickupPrepareAgent(common);
    }else if(intent==='update_pickup'){
      result=await runPickupUpdatePrepareAgent(common);
    }else if(intent==='cancel_pickup'){
      result=await runPickupCancelPrepareAgent(common);
    }

    const persisted=result?.persistedMessage;
    const actionType=String(persisted?.action?.action_type || '').trim();
    if(!persisted || !batchExpectedActionTypes(intent).includes(actionType)){
      throw runtimeError(
        '복합쓰기 작업의 확인 카드 종류가 예상과 다릅니다.',
        502,
        'OLLI_AGENT_BATCH_ACTION_TYPE_MISMATCH'
      );
    }
    preparedMessages.push(persisted);
  }

  return {
    ready:true,
    messages:preparedMessages,
    recoveredAfterPersist:false,
  };
}


function loadSharedCommandRouter(){
  const router=require('../../../../../packages/common/olli-command-router-common.js');
  if(!router || typeof router.parseQueryIntent!=='function'){
    throw runtimeError('공용 시간표 조회 파서를 불러오지 못했습니다.',500,'OLLI_AGENT_TIMETABLE_READ_ROUTER_MISSING');
  }
  return router;
}

function canonicalReadIntent(value){
  if(!value || typeof value!=='object') return '';
  return JSON.stringify(value);
}

function restorePreparedSubjectLabels(value,preparedPrivacy){
  let text=String(value || '');
  const resolved=Array.isArray(preparedPrivacy?.rawResolution?.resolved)
    ? preparedPrivacy.rawResolution.resolved
    : [];
  resolved
    .slice()
    .sort((a,b)=>String(b?.label||'').length-String(a?.label||'').length)
    .forEach((item)=>{
      const label=String(item?.label||'').trim();
      const name=String(item?.student?.name||'').trim();
      if(label&&name) text=text.split(label).join(name);
    });
  return text;
}


async function runContextualReadAgent({
  agentContext,
  requestContext,
  preparedPrivacy,
  agentInput,
}) {
  assertOpenAiKey();

  const input=Array.isArray(agentInput) ? agentInput : [];
  if(!input.length){
    throw runtimeError(
      '문맥 조회 Agent 입력 대화를 확인하지 못했습니다.',
      400,
      'OLLI_AGENT_CONTEXT_READ_INPUT_REQUIRED'
    );
  }

  const subjectRefs=Array.isArray(preparedPrivacy?.subjectRefs)
    ? preparedPrivacy.subjectRefs
    : [];
  if(preparedPrivacy?.needsDisambiguation){
    throw runtimeError(
      '학생 이름을 한 명으로 구분할 수 없습니다. 전체 이름으로 다시 알려 주세요.',
      409,
      'OLLI_AGENT_STUDENT_AMBIGUOUS'
    );
  }
  if(subjectRefs.length>1){
    throw runtimeError(
      '문맥 조회에서는 학생을 한 명만 이어서 확인할 수 있습니다.',
      400,
      'OLLI_AGENT_CONTEXT_READ_MULTI_STUDENT'
    );
  }

  const {Agent,run,tool,z}=await loadAgentsSdk();
  const {createGetStudentScheduleTool}=require('./tools/schedule-tools.cjs');
  const {createGetAttendanceTool}=require('./tools/attendance-tools.cjs');
  const {createGetPickupsTool}=require('./tools/pickup-tools.cjs');
  const {createLabelBook,readTimetableIntent}=require('./tools/timetable-read-tools.cjs');
  const {sanitizeAgentToolPayload}=require('./privacy.cjs');
  const model=agentModel();
  const today=todayInSeoul();
  const labelBook=createLabelBook();
  const tools=[];

  if(subjectRefs.length===1){
    tools.push(
      createGetStudentScheduleTool({
        tool,z,requestContext,
        subjectAccess:preparedPrivacy.subjectAccess,
      }),
      createGetAttendanceTool({
        tool,z,requestContext,
        subjectAccess:preparedPrivacy.subjectAccess,
        sanitizePayload(payload){
          return sanitizeAgentToolPayload(payload,preparedPrivacy);
        },
      }),
      createGetPickupsTool({
        tool,z,requestContext,
        subjectAccess:preparedPrivacy.subjectAccess,
        sanitizePayload(payload){
          return sanitizeAgentToolPayload(payload,preparedPrivacy);
        },
      })
    );
  }

  tools.push(tool({
    name:'read_timetable_context_query',
    description:
      '활성 Olli 대화의 마지막 사용자 질문을 앞 문맥과 합쳐 만든 독립적인 읽기 전용 시간표 조회 문장을 서버 규칙 파서로 검증한 뒤 실행합니다. 등록·수정·삭제는 절대 수행하지 않습니다.',
    parameters:z.object({
      standalone_query:z.string().min(2).max(700),
    }),
    async execute({standalone_query}){
      const query=String(standalone_query || '').trim();
      const router=loadSharedCommandRouter();
      const intent=router.parseQueryIntent(query);
      const supported=new Set([
        'find_roster_entries',
        'find_pickups',
        'find_available_slots',
        'multi_read_query',
      ]);
      if(!intent || !supported.has(String(intent?.intent || '').trim())){
        throw runtimeError(
          '문맥에서 읽기 전용 시간표 조회 조건을 확정하지 못했습니다.',
          400,
          'OLLI_AGENT_CONTEXT_TIMETABLE_QUERY_INVALID'
        );
      }
      const payload=await readTimetableIntent({
        requestContext,
        intent,
        sourceText:query,
        todayKey:today,
        labelBook,
      });
      return JSON.stringify(payload);
    },
  }));

  const subjectInstruction=subjectRefs.length===1
    ? 'The currently bound anonymous student is '+subjectRefs[0].label+'. Use that label for student-specific tools when the final user message continues the same student.'
    : 'No student is currently bound. Do not call student-specific tools.';

  const agent=new Agent({
    name:'Olli Contextual Read',
    model,
    instructions:[
      'You are Olli continuing an active Korean academy-operation conversation.',
      'The input contains the entire active Olli conversation, already privacy-sanitized. The final item is the current user message.',
      'Today in Korea is '+today+'.',
      subjectInstruction,
      'Decide whether the final user message clearly continues an academy data READ from the preceding conversation.',
      'If it is unrelated to academy schedule, attendance, pickup, roster, or availability data, call no tool and return exactly OLLI_CONTEXT_UNRELATED.',
      'If it is related, you MUST use the smallest appropriate read tool set before answering. Never answer academy facts from memory.',
      'Use get_student_schedule for one student regular schedule questions, get_attendance for one student attendance history, and get_pickups for one student pickup history.',
      'Use read_timetable_context_query for roster, seat availability, wait availability, pickup-roster, or other shared timetable reads. Its standalone_query must faithfully combine the prior request with only the changes stated in the final user message.',
      'Do not invent a student, date, time, class group, division, or operation that is not supported by the conversation.',
      'All tools are read-only. Never claim that data was registered, changed, cancelled, or deleted.',
      'Use only tool results for the final answer.',
      'Never reveal UUIDs, internal time slots, member IDs, session tokens, academy IDs, or hidden identifiers.',
      'Answer briefly and naturally in Korean.',
    ].join(' '),
    tools,
  });

  const result=await run(agent,input,{context:agentContext});
  const finalOutput=String(result?.finalOutput || '').trim();
  const toolCalls=(Array.isArray(result?.newItems) ? result.newItems : [])
    .filter((item)=>item?.type==='tool_call_item')
    .map((item)=>String(item?.toolName || item?.rawItem?.name || '').trim())
    .filter(Boolean);

  if(finalOutput==='OLLI_CONTEXT_UNRELATED' && toolCalls.length===0){
    return {
      ready:true,
      handled:false,
      model,
      output:'',
      nodeVersion:process.versions.node,
    };
  }

  if(toolCalls.length<1){
    throw runtimeError(
      '문맥 조회 Agent가 데이터 Tool 없이 답변하려고 했습니다.',
      502,
      'OLLI_AGENT_CONTEXT_READ_TOOL_REQUIRED'
    );
  }

  const allowedTools=new Set([
    'get_student_schedule',
    'get_attendance',
    'get_pickups',
    'read_timetable_context_query',
  ]);
  if(toolCalls.some((name)=>!allowedTools.has(name))){
    throw runtimeError(
      '문맥 조회 Agent가 허용되지 않은 Tool을 호출했습니다.',
      502,
      'OLLI_AGENT_CONTEXT_READ_TOOL_INVALID'
    );
  }

  if(!finalOutput || finalOutput==='OLLI_CONTEXT_UNRELATED'){
    throw runtimeError(
      '문맥 조회 Agent 응답이 비어 있습니다.',
      502,
      'OLLI_AGENT_EMPTY_CONTEXT_READ_RESPONSE'
    );
  }

  const output=restorePreparedSubjectLabels(
    labelBook.restore(finalOutput),
    preparedPrivacy
  );
  return {
    ready:true,
    handled:true,
    model,
    output,
    nodeVersion:process.versions.node,
  };
}


async function runStudentScheduleRead({
  agentContext,
  requestContext,
  preparedPrivacy,
  sourceMessageId,
  sourceMessageText,
  session=null,
  sourceValidated=false,
}) {
  const sourceId=Number(sourceMessageId||0);
  if(!Number.isSafeInteger(sourceId)||sourceId<=0){
    throw runtimeError('학생 시간표 원문 메시지 식별값이 올바르지 않습니다.',400,'OLLI_AGENT_SCHEDULE_READ_SOURCE_INVALID');
  }
  if(!sourceValidated){
    await validatePickupSourceMessage({
      requestContext,
      sourceMessageId:sourceId,
      sourceMessageText,
    });
  }
  const result=await runStudentScheduleProbe({agentContext,requestContext,preparedPrivacy,session});
  return Object.assign({},result,{output:restorePreparedSubjectLabels(result?.output,preparedPrivacy)});
}

async function runAttendanceRead({
  agentContext,
  requestContext,
  preparedPrivacy,
  sourceMessageId,
  sourceMessageText,
  session=null,
  sourceValidated=false,
}) {
  const sourceId=Number(sourceMessageId||0);
  if(!Number.isSafeInteger(sourceId)||sourceId<=0){
    throw runtimeError('출결 조회 원문 메시지 식별값이 올바르지 않습니다.',400,'OLLI_AGENT_ATTENDANCE_READ_SOURCE_INVALID');
  }
  if(!sourceValidated){
    await validatePickupSourceMessage({
      requestContext,
      sourceMessageId:sourceId,
      sourceMessageText,
    });
  }
  const result=await runAttendanceProbe({agentContext,requestContext,preparedPrivacy,session});
  return Object.assign({},result,{output:restorePreparedSubjectLabels(result?.output,preparedPrivacy)});
}

async function runPickupRead({
  agentContext,
  requestContext,
  preparedPrivacy,
  sourceMessageId,
  sourceMessageText,
  session=null,
  sourceValidated=false,
}) {
  const sourceId=Number(sourceMessageId||0);
  if(!Number.isSafeInteger(sourceId)||sourceId<=0){
    throw runtimeError('픽업 조회 원문 메시지 식별값이 올바르지 않습니다.',400,'OLLI_AGENT_PICKUP_READ_SOURCE_INVALID');
  }
  if(!sourceValidated){
    await validatePickupSourceMessage({
      requestContext,
      sourceMessageId:sourceId,
      sourceMessageText,
    });
  }
  const result=await runPickupProbe({agentContext,requestContext,preparedPrivacy,session});
  return Object.assign({},result,{output:restorePreparedSubjectLabels(result?.output,preparedPrivacy)});
}

async function runTimetableRead({
  agentContext,
  requestContext,
  preparedPrivacy,
  sourceMessageId,
  sourceMessageText,
  readIntent,
  session=null,
  sourceValidated=false,
}) {
  const sourceId=Number(sourceMessageId||0);
  if(!Number.isSafeInteger(sourceId)||sourceId<=0){
    throw runtimeError('시간표 조회 원문 메시지 식별값이 올바르지 않습니다.',400,'OLLI_AGENT_TIMETABLE_READ_SOURCE_INVALID');
  }
  if(!sourceValidated){
    await validatePickupSourceMessage({
      requestContext,
      sourceMessageId:sourceId,
      sourceMessageText,
    });
  }

  const subjectRefs=Array.isArray(preparedPrivacy?.subjectRefs)?preparedPrivacy.subjectRefs:[];
  const router=loadSharedCommandRouter();
  const serverIntent=router.parseQueryIntent(String(sourceMessageText||''));
  if(!serverIntent){
    throw runtimeError('저장된 원문에서 시간표 조회 요청을 확인하지 못했습니다.',400,'OLLI_AGENT_TIMETABLE_READ_PARSE_FAILED');
  }
  if(readIntent && canonicalReadIntent(readIntent)!==canonicalReadIntent(serverIntent)){
    throw runtimeError('클라이언트 조회 조건과 저장된 원문이 일치하지 않습니다.',409,'OLLI_AGENT_TIMETABLE_READ_INTENT_MISMATCH');
  }
  const intent=JSON.parse(JSON.stringify(serverIntent));

  if(
    intent?.intent==='find_available_slots' &&
    String(intent?.viewMode||'').trim()==='schedule' &&
    subjectRefs.length===1
  ){
    const result=await runStudentScheduleProbe({agentContext,requestContext,preparedPrivacy,session});
    return Object.assign({},result,{output:restorePreparedSubjectLabels(result?.output,preparedPrivacy)});
  }
  if(intent?.intent==='find_pickups' && subjectRefs.length===1){
    const result=await runPickupProbe({agentContext,requestContext,preparedPrivacy,session});
    return Object.assign({},result,{output:restorePreparedSubjectLabels(result?.output,preparedPrivacy)});
  }

  if(intent?.intent==='find_available_slots' && !String(intent?.division||'').trim() && subjectRefs.length===1){
    const subject=preparedPrivacy?.subjectAccess?.resolve?.(subjectRefs[0].label);
    const division=String(subject?.division||'').trim().toLowerCase();
    if(['elementary','kinder'].includes(division)) intent.division=division;
  }

  assertOpenAiKey();
  const {Agent,run,tool,z}=await loadAgentsSdk();
  const {createLabelBook,createTimetableReadTool}=require('./tools/timetable-read-tools.cjs');
  const labelBook=createLabelBook();
  const model=agentModel();
  const today=todayInSeoul();

  const readTool=createTimetableReadTool({
    tool,z,requestContext,intent,sourceText:sourceMessageText,todayKey:today,labelBook,
  });

  const agent=new Agent({
    name:'Olli Timetable Read',
    model,
    instructions:[
      'You are the Olli timetable read assistant.',
      'The user message has already been privacy-sanitized.',
      'The server has fixed the exact read operation from the stored Team Chat source message.',
      'Always call read_timetable_query exactly once before answering.',
      'Use only the tool result. Never invent students, classes, availability, pickup details, attendance, waitlists, or move reservations.',
      'Roster names in tool output are anonymous labels such as 명단1 or 명단2. Preserve those labels exactly; the server restores real display names after model execution.',
      'For roster or pickup counts, use student_count when reporting the number of students. count may represent rows when one student has multiple entries.',
      'For move reservations, preserve the visible source and target weekday/time/group fields returned by the tool.',
      'If a result is empty, clearly say that no matching timetable data was found.',
      'Never ask for, infer, or reveal UUIDs, internal time slots, member IDs, session tokens, academy IDs, or hidden identifiers.',
      'Answer briefly in Korean.',
    ].join(' '),
    tools:[readTool],
    modelSettings:{toolChoice:'read_timetable_query'},
  });

  const runOptions={context:agentContext};
  if(session) runOptions.session=session;
  const result=await run(agent,preparedPrivacy.safeText,runOptions);
  const finalOutput=restorePreparedSubjectLabels(
    labelBook.restore(String(result?.finalOutput||'').trim()),
    preparedPrivacy
  );
  if(!finalOutput){
    throw runtimeError('시간표 읽기 Agent 응답이 비어 있습니다.',502,'OLLI_AGENT_EMPTY_TIMETABLE_READ_RESPONSE');
  }
  return {ready:true,model,output:finalOutput,nodeVersion:process.versions.node};
}


function parseTimetableAdminSource(sourceMessageText){
  const router=loadSharedCommandRouter();
  const text=String(sourceMessageText||'');
  const parsers=[
    'parseClassLayoutMutationIntent',
    'parseTeacherAssignmentMutationIntent',
    'parseSessionOrderMutationIntent',
    'parseNormalClassDayMutationIntent',
  ];
  for(const name of parsers){
    if(typeof router[name]!=='function') continue;
    const parsed=router[name](text);
    if(parsed) return parsed;
  }
  return null;
}

async function runTimetableAdminPrepare({
  agentContext,
  requestContext,
  preparedPrivacy,
  sourceMessageId,
  sourceMessageText,
}) {
  const sourceId=Number(sourceMessageId||0);
  if(!Number.isSafeInteger(sourceId)||sourceId<=0){
    throw runtimeError('시간표 관리 원문 메시지 식별값이 올바르지 않습니다.',400,'OLLI_AGENT_TIMETABLE_ADMIN_SOURCE_INVALID');
  }
  await validatePickupSourceMessage({
    requestContext,
    sourceMessageId:sourceId,
    sourceMessageText,
  });

  const intent=parseTimetableAdminSource(sourceMessageText);
  if(!intent){
    throw runtimeError('저장된 원문에서 시간표 관리 요청을 확인하지 못했습니다.',400,'OLLI_AGENT_TIMETABLE_ADMIN_PARSE_FAILED');
  }

  const subjectRefs=Array.isArray(preparedPrivacy?.subjectRefs)?preparedPrivacy.subjectRefs:[];
  let studentLabel='';
  if(String(intent.intent||'')==='set_session_order'){
    if(preparedPrivacy?.needsDisambiguation){
      throw runtimeError('학생 이름을 한 명으로 구분할 수 없습니다. 전체 이름으로 다시 알려 주세요.',409,'OLLI_AGENT_STUDENT_AMBIGUOUS');
    }
    if(subjectRefs.length!==1){
      throw runtimeError('수업 순서 변경은 학생 한 명을 정확히 지정해 주세요.',400,'OLLI_AGENT_SESSION_ORDER_SINGLE_STUDENT_REQUIRED');
    }
    studentLabel=String(subjectRefs[0]?.label||'').trim();
  }

  assertOpenAiKey();
  const {Agent,run,tool,z}=await loadAgentsSdk();
  const {createPrepareTimetableAdminTool}=require('./tools/timetable-admin-prepare-tools.cjs');
  const {sanitizeAgentToolPayload}=require('./privacy.cjs');
  const model=agentModel();
  const today=todayInSeoul();
  let persistedMessage=null;

  const prepareAdmin=createPrepareTimetableAdminTool({
    tool,z,requestContext,intent,
    subjectAccess:preparedPrivacy?.subjectAccess,
    studentLabel,
    currentDate:today,
    requestId:'team-chat-message:'+sourceId,
    replyToMessageId:sourceId,
    capturePersistedMessage(message){persistedMessage=pickupPersistedMessageForClient(message);},
    sanitizePayload(payload){return sanitizeAgentToolPayload(payload,preparedPrivacy);},
  });

  const agent=new Agent({
    name:'Olli Timetable Admin Prepare',
    model,
    instructions:[
      'You are the Olli timetable administration preparation assistant.',
      'The stored Team Chat source message has already been parsed by the server into one fixed administrative action.',
      'Always call prepare_timetable_admin exactly once. The tool accepts no arguments, so never invent dates, teachers, student ids, class groups, or internal slots.',
      'The server re-reads the current timetable, class layout, teacher list, holiday state, and student schedule as required before saving a pending confirmation card.',
      'The tool never performs the timetable mutation. Never say the change is complete.',
      'Never ask for, infer, or reveal UUIDs, internal time slots, member IDs, session tokens, academy IDs, action IDs, or message IDs.',
      'Answer briefly in Korean and say the change is waiting for confirmation.',
    ].join(' '),
    tools:[prepareAdmin],
    modelSettings:{toolChoice:'prepare_timetable_admin'},
    toolUseBehavior:'stop_on_first_tool',
  });

  let result=null,runError=null;
  try{
    result=await run(agent,preparedPrivacy?.safeText||String(sourceMessageText||''),{context:agentContext});
  }catch(error){
    runError=error;
    if(!persistedMessage) throw error;
  }

  if(!persistedMessage){
    throw runtimeError('시간표 관리 확인 카드 저장 결과를 확인하지 못했습니다.',502,'OLLI_AGENT_TIMETABLE_ADMIN_PERSISTED_MESSAGE_MISSING');
  }
  return {
    ready:true,
    model,
    output:String(result?.finalOutput||'').trim(),
    nodeVersion:process.versions.node,
    persistedMessage,
    recoveredAfterPersist:!!runError,
  };
}


function parseAttendanceStatusSource(sourceMessageText){
  const router=loadSharedCommandRouter();
  if(typeof router?.parseAttendanceStatusMutationIntent!=='function') return null;
  return router.parseAttendanceStatusMutationIntent(String(sourceMessageText||''))||null;
}

async function runAttendanceStatusPrepare({
  agentContext,
  requestContext,
  preparedPrivacy,
  sourceMessageId,
  sourceMessageText,
}) {
  const sourceId=Number(sourceMessageId||0);
  if(!Number.isSafeInteger(sourceId)||sourceId<=0){
    throw runtimeError('출석부 변경 원문 메시지 식별값이 올바르지 않습니다.',400,'OLLI_AGENT_ATTENDANCE_STATUS_SOURCE_INVALID');
  }
  await validatePickupSourceMessage({
    requestContext,
    sourceMessageId:sourceId,
    sourceMessageText,
  });

  const intent=parseAttendanceStatusSource(sourceMessageText);
  if(!intent){
    throw runtimeError('저장된 원문에서 출석부 상태 변경 요청을 확인하지 못했습니다.',400,'OLLI_AGENT_ATTENDANCE_STATUS_PARSE_FAILED');
  }
  if(preparedPrivacy?.needsDisambiguation){
    throw runtimeError('학생 이름을 한 명으로 구분할 수 없습니다. 전체 이름으로 다시 알려 주세요.',409,'OLLI_AGENT_STUDENT_AMBIGUOUS');
  }
  const subjectRefs=Array.isArray(preparedPrivacy?.subjectRefs)?preparedPrivacy.subjectRefs:[];
  if(subjectRefs.length!==1){
    throw runtimeError('출석부 상태 변경은 학생 한 명을 정확히 지정해 주세요.',400,'OLLI_AGENT_ATTENDANCE_STATUS_SINGLE_STUDENT_REQUIRED');
  }
  const studentLabel=String(subjectRefs[0]?.label||'').trim();
  if(!studentLabel){
    throw runtimeError('출석부를 변경할 학생을 확인하지 못했습니다.',400,'OLLI_AGENT_ATTENDANCE_STATUS_STUDENT_REQUIRED');
  }

  assertOpenAiKey();
  const {Agent,run,tool,z}=await loadAgentsSdk();
  const {createPrepareAttendanceStatusTool}=require('./tools/attendance-status-prepare-tools.cjs');
  const {sanitizeAgentToolPayload}=require('./privacy.cjs');
  const model=agentModel();
  const today=todayInSeoul();
  let persistedMessage=null;

  const prepareAttendanceStatus=createPrepareAttendanceStatusTool({
    tool,z,requestContext,intent,
    subjectAccess:preparedPrivacy?.subjectAccess,
    studentLabel,
    currentDate:today,
    requestId:'team-chat-message:'+sourceId,
    replyToMessageId:sourceId,
    capturePersistedMessage(message){persistedMessage=pickupPersistedMessageForClient(message);},
    sanitizePayload(payload){return sanitizeAgentToolPayload(payload,preparedPrivacy);},
  });

  const agent=new Agent({
    name:'Olli Attendance Status Prepare',
    model,
    instructions:[
      'You are the Olli attendance-register status preparation assistant.',
      'The stored Team Chat source message has already been parsed by the server into one fixed attendance status change.',
      'Always call prepare_attendance_status exactly once. The tool accepts no arguments, so never invent dates, student ids, class groups, session kinds, internal slots, or attendance values.',
      'The server re-reads the current schedule and attendance register before saving a pending confirmation card.',
      'This is different from the regular-class absence workflow: it changes only the attendance-register status and does not invent an absence reason or a makeup schedule.',
      'The tool never performs the attendance mutation. Never say the status change is complete.',
      'Never ask for, infer, or reveal a real student name, UUID, internal time slot, member ID, session token, academy ID, action ID, or message ID.',
      'Answer briefly in Korean and say the change is waiting for confirmation.',
    ].join(' '),
    tools:[prepareAttendanceStatus],
    modelSettings:{toolChoice:'prepare_attendance_status'},
    toolUseBehavior:'stop_on_first_tool',
  });

  let result=null,runError=null;
  try{
    result=await run(agent,preparedPrivacy?.safeText||String(sourceMessageText||''),{context:agentContext});
  }catch(error){
    runError=error;
    if(!persistedMessage) throw error;
  }
  if(!persistedMessage){
    throw runtimeError('출석부 변경 확인 카드 저장 결과를 확인하지 못했습니다.',502,'OLLI_AGENT_ATTENDANCE_STATUS_PERSISTED_MESSAGE_MISSING');
  }
  return {
    ready:true,
    model,
    output:String(result?.finalOutput||'').trim(),
    nodeVersion:process.versions.node,
    persistedMessage,
    recoveredAfterPersist:!!runError,
  };
}


module.exports = {
  MIN_NODE_MAJOR,
  assertSupportedNodeRuntime,
  todayInSeoul,
  loadAgentsSdk,
  runFoundationProbe,
  runStudentScheduleProbe,
  restorePreparedSubjectLabels,
  runContextualReadAgent,
  runStudentScheduleRead,
  runTimetableRead,
  parseTimetableAdminSource,
  runTimetableAdminPrepare,
  parseAttendanceStatusSource,
  runAttendanceStatusPrepare,
  runRecentRecordsProbe,
  resolveAvailabilityScope,
  runScheduleAvailabilityProbe,
  resolveAbsencePrepareScope,
  runAbsencePrepareAgent,
  runAbsencePrepareProbe,
  runAbsencePrepare,
  validateAbsenceSourceMessage,
  validateAbsenceReasonMessage,
  resolveClassOncePrepareScope,
  runClassOncePrepareAgent,
  runClassOncePrepareProbe,
  runClassOncePrepare,
  validateClassOnceSourceMessage,
  resolveMakeupPrepareScope,
  runMakeupPrepareAgent,
  runMakeupPrepareProbe,
  resolveMakeupUpdatePrepareScope,
  runMakeupUpdatePrepareAgent,
  runMakeupUpdatePrepareProbe,
  runMakeupUpdatePrepare,
  runStructuredMakeupUpdatePrepare,
  runStructuredMakeupCancelPrepare,
  resolveMakeupCancelPrepareScope,
  runMakeupCancelPrepareAgent,
  runMakeupCancelPrepareProbe,
  runMakeupCancelPrepare,
  validateMakeupReasonMessage,
  resolveTrialAddPrepareScope,
  runTrialAddPrepareAgent,
  runTrialAddPrepareProbe,
  runTrialAddPrepare,
  resolveTrialCancelPrepareScope,
  runTrialCancelPrepareAgent,
  runTrialCancelPrepareProbe,
  runTrialCancelPrepare,
  runStructuredTrialCancelPrepare,
  validateTrialReasonMessage,
  resolveTrialUpdatePrepareScope,
  runTrialUpdatePrepareAgent,
  runTrialUpdatePrepareProbe,
  runTrialUpdatePrepare,
  runStructuredTrialUpdatePrepare,
  validateTrialSourceMessage,
  resolveWaitlistAddPrepareScope,
  runWaitlistAddPrepareAgent,
  runWaitlistAddPrepareProbe,
  runWaitlistAddPrepare,
  resolveWaitlistUpdatePrepareScope,
  runWaitlistUpdatePrepareAgent,
  runWaitlistUpdatePrepareProbe,
  runWaitlistUpdatePrepare,
  resolveMovePrepareScope,
  runMovePrepareAgent,
  runMovePrepareProbe,
  runMovePrepare,
  resolveMoveCancelPrepareScope,
  runMoveCancelPrepareAgent,
  runMoveCancelPrepareProbe,
  runMoveCancelPrepare,
  validateMoveSourceMessage,
  resolveWaitlistCancelPrepareScope,
  runWaitlistCancelPrepareAgent,
  runWaitlistCancelPrepareProbe,
  runWaitlistCancelPrepare,
  validateWaitlistSourceMessage,
  validateMakeupSourceMessage,
  runMakeupPrepare,
  runAttendanceProbe,
  runAttendanceRead,
  runPickupProbe,
  runPickupRead,
  resolvePickupPrepareScope,
  resolvePickupUpdatePrepareScope,
  resolvePickupCancelPrepareScope,
  runPickupCancelPrepareAgent,
  runPickupCancelPrepareProbe,
  runPickupCancelPrepare,
  runPickupUpdatePrepareAgent,
  runPickupUpdatePrepareProbe,
  runPickupUpdatePrepare,
  pickupPersistedMessageForClient,
  normalizePickupSourceMessageText,
  validatePickupSourceMessage,
  runPickupPrepareAgent,
  runPickupUpdatePrepareAgent,
  runPickupCancelPrepareAgent,
  runPickupPrepareProbe,
  runPickupPrepare,
  runStudentProfileProbe,
  resolveTimetableMemoScope,
  runTimetableMemoPrepareAgent,
  runTimetableMemoPrepareProbe,
  runTimetableMemoPrepare,
  validateTimetableMemoSourceMessage,
  normalizeBatchPartText,
  splitBatchWriteParts,
  batchExpectedActionTypes,
  runBatchPrepare,
};
