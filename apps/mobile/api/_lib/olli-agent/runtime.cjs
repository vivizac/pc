'use strict';

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
    run: agentsSdk.run,
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

  const result = await run(agent, preparedPrivacy.safeText, {
    context: agentContext,
  });

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


async function runAttendanceProbe({
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

  const result = await run(agent, preparedPrivacy.safeText, {
    context: agentContext,
  });

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

  const result = await run(agent, preparedPrivacy.safeText, {
    context:agentContext,
  });

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

module.exports = {
  MIN_NODE_MAJOR,
  assertSupportedNodeRuntime,
  todayInSeoul,
  loadAgentsSdk,
  runFoundationProbe,
  runStudentScheduleProbe,
  runRecentRecordsProbe,
  resolveAvailabilityScope,
  runScheduleAvailabilityProbe,
  runAttendanceProbe,
  runPickupProbe,
};
