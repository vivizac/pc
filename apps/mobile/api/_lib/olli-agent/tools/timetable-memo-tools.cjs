'use strict';

const crypto = require('node:crypto');
const { callSupabaseRpc } = require('../supabase-rpc.cjs');
const { DATE_PATTERN, timeLabel, normalizeTimetableMode } = require('./schedule-tools.cjs');

const VALID_DIVISIONS = new Set(['elementary', 'kinder']);
const VALID_OPERATIONS = new Set(['add', 'delete']);

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function memoToolError(message, statusCode = 400, code = 'OLLI_AGENT_TIMETABLE_MEMO_TOOL_ERROR') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function parseDateKey(value) {
  const candidate = clean(value);
  if (!DATE_PATTERN.test(candidate)) return null;
  const [year, month, day] = candidate.split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) return null;
  return { key:candidate, timestamp };
}

function isoWeekday(dateKey) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return 0;
  const day = new Date(parsed.timestamp).getUTCDay();
  return day === 0 ? 7 : day;
}

function mondayKey(dateKey) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return '';
  return new Date(
    parsed.timestamp - ((isoWeekday(dateKey) - 1) * 86400000)
  ).toISOString().slice(0, 10);
}

function normalizeDivision(value) {
  const division = clean(value).toLowerCase();
  if (!VALID_DIVISIONS.has(division)) {
    throw memoToolError(
      '시간표 메모의 수업 구분을 확인해 주세요.',
      400,
      'OLLI_AGENT_TIMETABLE_MEMO_DIVISION_INVALID'
    );
  }
  return division;
}

function normalizeOperation(value) {
  const operation = clean(value).toLowerCase();
  if (!VALID_OPERATIONS.has(operation)) {
    throw memoToolError(
      '시간표 메모 작업 종류를 확인해 주세요.',
      400,
      'OLLI_AGENT_TIMETABLE_MEMO_OPERATION_INVALID'
    );
  }
  return operation;
}

function normalizeRequestedGroup(value) {
  const group = clean(value).toUpperCase() || 'AUTO';
  if (!['AUTO', 'A', 'B'].includes(group)) {
    throw memoToolError(
      '시간표 메모의 반을 확인해 주세요.',
      400,
      'OLLI_AGENT_TIMETABLE_MEMO_GROUP_INVALID'
    );
  }
  return group;
}

function encodeMemoTimeSlot(division, weekday, timetableMode, hour, minute) {
  const normalizedDivision = normalizeDivision(division);
  const day = Number(weekday || 0);
  const h = Number(hour || 0);
  const m = Number(minute || 0);
  const mode = normalizeTimetableMode(timetableMode);

  if (!Number.isInteger(h) || h < 1 || h > 12 || ![0, 30].includes(m)) return 0;

  if (normalizedDivision === 'elementary' && day === 6) {
    if (m !== 0 || h < 1 || h > 3) return 0;
    return h + 9;
  }

  if (mode === 'half_hour') {
    const key = String(h) + ':' + String(m);
    const elementary = {
      '1:0':1, '1:30':7, '2:0':2, '2:30':8, '3:0':3, '3:30':9,
      '4:0':4, '4:30':10, '5:0':5, '5:30':11, '6:0':6,
    };
    const kinder = {
      '3:30':7, '4:0':4, '4:30':8, '5:0':5, '5:30':9,
    };
    return Number((normalizedDivision === 'kinder' ? kinder : elementary)[key] || 0);
  }

  if (m !== 0) return 0;
  if (normalizedDivision === 'kinder') return [4, 5].includes(h) ? h : 0;
  return h >= 1 && h <= 6 ? h : 0;
}

function normalizeStoredGroup(value, timetableMode) {
  if (normalizeTimetableMode(timetableMode) === 'half_hour') return 'A';
  return clean(value).toUpperCase() === 'B' ? 'B' : 'A';
}

function effectiveOn(row, dateKey) {
  const from = clean(row?.effective_from).slice(0, 10);
  const to = clean(row?.effective_to).slice(0, 10);
  return (!from || from <= dateKey) && (!to || to >= dateKey);
}

function studentClassTargets(weekData, {
  studentId,
  division,
  sessionDate,
  timetableMode,
}) {
  const weekday = isoWeekday(sessionDate);
  const targets = [];

  (Array.isArray(weekData?.enrollments) ? weekData.enrollments : [])
    .filter((row) =>
      clean(row?.student_id) === clean(studentId) &&
      Number(row?.weekday || 0) === weekday &&
      effectiveOn(row, sessionDate)
    )
    .forEach((row) => targets.push({
      division,
      timeSlot:Number(row?.time_slot || 0),
      classGroup:normalizeStoredGroup(row?.class_group, timetableMode),
      studentName:clean(row?.student_name),
      source:'regular',
    }));

  (Array.isArray(weekData?.one_time_sessions) ? weekData.one_time_sessions : [])
    .filter((row) =>
      clean(row?.student_id) === clean(studentId) &&
      clean(row?.session_date).slice(0, 10) === sessionDate &&
      clean(row?.status).toLowerCase() !== 'cancelled'
    )
    .forEach((row) => targets.push({
      division:clean(row?.division).toLowerCase() || division,
      timeSlot:Number(row?.time_slot || 0),
      classGroup:normalizeStoredGroup(row?.class_group, timetableMode),
      studentName:clean(row?.student_name),
      source:clean(row?.session_type) || 'one_time',
    }));

  const seen = new Set();
  return targets.filter((target) => {
    if (!target.timeSlot) return false;
    const key = [target.division, target.timeSlot, target.classGroup].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function classSplitActive(row, weekday, timeSlot, dateKey) {
  if (
    Number(row?.weekday || 0) !== Number(weekday) ||
    Number(row?.time_slot || 0) !== Number(timeSlot)
  ) return false;
  const from = clean(row?.effective_from).slice(0, 10);
  const to = clean(row?.effective_to).slice(0, 10);
  return (!from || from <= dateKey) && (!to || to >= dateKey);
}

function availableGroups(weekData, kinderLayout, {
  division,
  sessionDate,
  timeSlot,
  timetableMode,
}) {
  if (normalizeTimetableMode(timetableMode) === 'half_hour') return ['A'];
  const weekday = isoWeekday(sessionDate);

  if (division === 'kinder') {
    const merged = (Array.isArray(kinderLayout?.merged_slots) ? kinderLayout.merged_slots : [])
      .some((row) =>
        Number(row?.weekday || 0) === weekday &&
        Number(row?.time_slot || 0) === Number(timeSlot)
      );
    return merged ? ['A'] : ['A', 'B'];
  }

  const split = (Array.isArray(weekData?.class_split_periods)
    ? weekData.class_split_periods
    : [])
    .some((row) => classSplitActive(row, weekday, timeSlot, sessionDate));

  return split ? ['A', 'B'] : ['A'];
}

function restoreStudentLabel(value, label, realName) {
  const text = clean(value);
  if (!text || !clean(label) || !clean(realName)) return text;
  return text.split(clean(label)).join(clean(realName));
}

function stableActionClientMessageId({ academyId, memberId, requestId, actionType }) {
  const request = clean(requestId);
  if (!request || request.length > 160) {
    throw memoToolError(
      '메모 준비 요청 식별값이 없습니다.',
      400,
      'OLLI_AGENT_TIMETABLE_MEMO_REQUEST_ID_REQUIRED'
    );
  }
  const hex = crypto
    .createHash('sha256')
    .update([
      'olli-agent-timetable-memo-v1',
      clean(academyId),
      clean(memberId),
      request,
      clean(actionType),
    ].join('|'))
    .digest('hex')
    .slice(0, 32);
  return [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
    hex.slice(16, 20), hex.slice(20, 32),
  ].join('-');
}

function divisionLabel(value) {
  return value === 'kinder' ? '유치부' : '초등부';
}

function dateLabel(value) {
  const parsed = parseDateKey(value);
  if (!parsed) return value;
  const date = new Date(parsed.timestamp);
  return String(date.getUTCMonth() + 1) + '월 ' + String(date.getUTCDate()) + '일';
}

function actionPrompt({
  operation, studentName, division, sessionDate, timeText,
  classGroup, timetableMode, memoNote,
}) {
  const subject = clean(studentName) ? clean(studentName) + ' · ' : '';
  const groupText = normalizeTimetableMode(timetableMode) === 'half_hour'
    ? ''
    : ' ' + classGroup + '반';
  return [
    subject + divisionLabel(division) + ' · ' + dateLabel(sessionDate) + ' ' + timeText + groupText,
    '메모: ' + clean(memoNote),
    operation === 'delete' ? '삭제할까요?' : '등록할까요?',
  ].join('\n');
}

function filterMemoRows(rows, {
  division, sessionDate, timeSlot, classGroup, memoNote,
}) {
  let filtered = (Array.isArray(rows) ? rows : []).filter((row) =>
    clean(row?.division).toLowerCase() === division &&
    clean(row?.session_date).slice(0, 10) === sessionDate &&
    Number(row?.time_slot || 0) === Number(timeSlot) &&
    normalizeStoredGroup(row?.class_group, 'hourly') === classGroup
  );

  const note = clean(memoNote);
  if (!note) return filtered;

  const exact = filtered.filter((row) => clean(row?.note) === note);
  if (exact.length) return exact;
  return filtered.filter((row) => clean(row?.note).includes(note));
}

async function prepareTimetableMemoAction({
  requestContext,
  subjectAccess,
  studentLabel = '',
  division,
  operation,
  sessionDate,
  hour = 0,
  minute = 0,
  classGroup = 'AUTO',
  memoNote = '',
  requestId,
  sanitizePayload,
  callRpc = callSupabaseRpc,
}) {
  if (typeof sanitizePayload !== 'function') {
    throw memoToolError(
      'Agent Tool 결과 개인정보 필터가 준비되지 않았습니다.',
      500,
      'OLLI_AGENT_TIMETABLE_MEMO_PRIVACY_MISSING'
    );
  }

  const op = normalizeOperation(operation);
  const date = parseDateKey(sessionDate);
  if (!date) {
    throw memoToolError(
      '시간표 메모 날짜는 YYYY-MM-DD 형식이어야 합니다.',
      400,
      'OLLI_AGENT_TIMETABLE_MEMO_DATE_INVALID'
    );
  }
  const weekday = isoWeekday(date.key);
  if (weekday < 1 || weekday > 6) {
    throw memoToolError(
      '시간표 메모는 월요일부터 토요일 수업에 준비할 수 있습니다.',
      400,
      'OLLI_AGENT_TIMETABLE_MEMO_WEEKDAY_INVALID'
    );
  }

  const label = clean(studentLabel);
  const subject = label ? subjectAccess?.resolve?.(label) : null;
  if (label && !subject?.studentId) {
    throw memoToolError(
      '현재 Agent 대화에서 확인할 수 없는 학생 참조입니다.',
      400,
      'OLLI_AGENT_SUBJECT_NOT_AVAILABLE'
    );
  }

  const subjectDivision = clean(subject?.division).toLowerCase();
  const explicitDivision = clean(division).toLowerCase();
  if (explicitDivision && !VALID_DIVISIONS.has(explicitDivision)) {
    throw memoToolError(
      '시간표 메모의 수업 구분을 확인해 주세요.',
      400,
      'OLLI_AGENT_TIMETABLE_MEMO_DIVISION_INVALID'
    );
  }
  if (subjectDivision && explicitDivision && subjectDivision !== explicitDivision) {
    throw memoToolError(
      '지정한 학생의 수업 구분과 요청한 초등부·유치부가 서로 다릅니다.',
      400,
      'OLLI_AGENT_TIMETABLE_MEMO_DIVISION_MISMATCH'
    );
  }

  const resolvedDivision = normalizeDivision(subjectDivision || explicitDivision);
  const requestedGroup = normalizeRequestedGroup(classGroup);
  const note = clean(memoNote);
  if (op === 'add' && !note) {
    throw memoToolError(
      '등록할 메모 내용을 알려 주세요.',
      400,
      'OLLI_AGENT_TIMETABLE_MEMO_NOTE_REQUIRED'
    );
  }

  const commonParams = {
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
  };
  const weekStart = mondayKey(date.key);

  const [settings, weekData, kinderLayout, memoData] = await Promise.all([
    callRpc('olli_academy_settings_get', commonParams),
    callRpc('olli_schedule_week', { ...commonParams, p_week_start:weekStart }),
    callRpc('olli_schedule_kinder_class_layouts', commonParams),
    op === 'delete'
      ? callRpc('olli_schedule_cell_memos_week_v2', { ...commonParams, p_week_start:weekStart })
      : Promise.resolve({ ok:true, memos:[] }),
  ]);

  if (!settings?.ok || !weekData?.ok || !kinderLayout?.ok || !memoData?.ok) {
    throw memoToolError(
      settings?.message || weekData?.message || kinderLayout?.message || memoData?.message ||
        '시간표 메모 대상을 확인하지 못했습니다.',
      403,
      'OLLI_AGENT_TIMETABLE_MEMO_READ_FAILED'
    );
  }

  const mode = normalizeTimetableMode(
    settings?.academy?.kinder_timetable_mode || weekData?.timetable_mode
  );
  let timeSlot = Number(hour || 0)
    ? encodeMemoTimeSlot(resolvedDivision, weekday, mode, hour, minute)
    : 0;
  let targetGroup = requestedGroup;
  let studentName = '';

  if (subject?.studentId) {
    let targets = studentClassTargets(weekData, {
      studentId:subject.studentId,
      division:resolvedDivision,
      sessionDate:date.key,
      timetableMode:mode,
    });

    if (timeSlot) targets = targets.filter((target) => target.timeSlot === timeSlot);
    else if (Number(hour || 0)) targets = [];

    if (targetGroup !== 'AUTO' && mode !== 'half_hour') {
      targets = targets.filter((target) => target.classGroup === targetGroup);
    }

    if (!targets.length) {
      throw memoToolError(
        '해당 날짜와 시간에 지정한 학생의 수업을 찾지 못했습니다.',
        404,
        'OLLI_AGENT_TIMETABLE_MEMO_STUDENT_CLASS_NOT_FOUND'
      );
    }
    if (targets.length > 1) {
      throw memoToolError(
        '지정한 학생에게 같은 날 여러 수업이 있습니다. 메모를 남길 시간을 더 정확히 알려 주세요.',
        409,
        'OLLI_AGENT_TIMETABLE_MEMO_STUDENT_CLASS_AMBIGUOUS'
      );
    }

    const target = targets[0];
    timeSlot = target.timeSlot;
    targetGroup = target.classGroup;
    studentName = target.studentName;
  } else {
    if (!Number(hour || 0) || !timeSlot) {
      throw memoToolError(
        '학생을 지정하지 않은 메모는 날짜와 수업 시간을 함께 알려 주세요.',
        400,
        'OLLI_AGENT_TIMETABLE_MEMO_TIME_REQUIRED'
      );
    }

    const groups = availableGroups(weekData, kinderLayout, {
      division:resolvedDivision,
      sessionDate:date.key,
      timeSlot,
      timetableMode:mode,
    });

    if (targetGroup !== 'AUTO' && !groups.includes(targetGroup)) {
      throw memoToolError(
        '해당 시간표 칸에서 요청한 반을 사용할 수 없습니다.',
        400,
        'OLLI_AGENT_TIMETABLE_MEMO_GROUP_NOT_AVAILABLE'
      );
    }
    if (targetGroup === 'AUTO' && groups.length > 1) {
      throw memoToolError(
        '이 시간은 A반과 B반이 나뉘어 있습니다. 메모를 넣을 반을 함께 알려 주세요.',
        409,
        'OLLI_AGENT_TIMETABLE_MEMO_GROUP_REQUIRED'
      );
    }
    targetGroup = targetGroup === 'AUTO' ? groups[0] : targetGroup;
  }

  if (!timeSlot) {
    throw memoToolError(
      '해당 시간표에서 사용할 수 있는 수업 시간을 확인해 주세요.',
      400,
      'OLLI_AGENT_TIMETABLE_MEMO_TIME_INVALID'
    );
  }
  if (mode === 'half_hour') targetGroup = 'A';

  const restoredNote = restoreStudentLabel(note, label, studentName);
  let memoId = '';
  let storedNote = restoredNote;

  if (op === 'delete') {
    const rows = filterMemoRows(memoData?.memos, {
      division:resolvedDivision,
      sessionDate:date.key,
      timeSlot,
      classGroup:targetGroup,
      memoNote:restoredNote,
    });
    if (!rows.length) {
      throw memoToolError(
        '해당 시간표 칸에서 삭제할 메모를 찾지 못했습니다.',
        404,
        'OLLI_AGENT_TIMETABLE_MEMO_NOT_FOUND'
      );
    }
    if (rows.length !== 1) {
      throw memoToolError(
        '삭제할 메모가 여러 개 있습니다. 메모 내용을 더 구체적으로 알려 주세요.',
        409,
        'OLLI_AGENT_TIMETABLE_MEMO_DELETE_AMBIGUOUS'
      );
    }
    memoId = clean(rows[0]?.id);
    storedNote = clean(rows[0]?.note);
  }

  const actionType = op === 'delete' ? 'delete_timetable_memo' : 'add_timetable_memo';
  const displayedTime = timeLabel(resolvedDivision, weekday, timeSlot, mode);
  const actionPayload = {
    intent:actionType,
    studentId:clean(subject?.studentId),
    studentName,
    division:resolvedDivision,
    sessionDate:date.key,
    timeSlot,
    classGroup:targetGroup,
    memoNote:storedNote,
  };
  if (memoId) actionPayload.memoId = memoId;

  const sent = await callRpc('olli_team_chat_send_action', {
    p_session_token:requestContext.sessionToken,
    p_academy_id:requestContext.academyId,
    p_body:actionPrompt({
      operation:op,
      studentName,
      division:resolvedDivision,
      sessionDate:date.key,
      timeText:displayedTime,
      classGroup:targetGroup,
      timetableMode:mode,
      memoNote:storedNote,
    }),
    p_action_type:actionType,
    p_action_payload:actionPayload,
    p_client_message_id:stableActionClientMessageId({
      academyId:requestContext.academyId,
      memberId:requestContext.memberId,
      requestId,
      actionType,
    }),
    p_reply_to_message_id:null,
  });

  if (!sent?.ok || !sent?.message?.action) {
    throw memoToolError(
      sent?.message || '시간표 메모 확인 카드를 저장하지 못했습니다.',
      500,
      'OLLI_AGENT_TIMETABLE_MEMO_ACTION_STORE_FAILED'
    );
  }

  return sanitizePayload({
    ok:true,
    status:'pending',
    requires_confirmation:true,
    action_type:actionType,
    student_label:label,
    division:resolvedDivision,
    session_date:date.key,
    time_slot:timeSlot,
    time_label:displayedTime,
    class_group:targetGroup,
    timetable_mode:mode,
    memo_note:note,
  });
}

function createPrepareTimetableMemoTool({
  tool,
  z,
  requestContext,
  subjectAccess,
  studentLabel,
  division,
  operation,
  requestId,
  sanitizePayload,
}) {
  if (typeof tool !== 'function' || !z) {
    throw memoToolError(
      'Agents SDK Tool 런타임이 준비되지 않았습니다.',
      500,
      'OLLI_AGENT_TOOL_RUNTIME_MISSING'
    );
  }

  return tool({
    name:'prepare_timetable_memo',
    description:
      '시간표 메모 추가 또는 삭제 작업을 실제 실행하지 않고 Team Chat의 확인 대기 카드로 준비합니다. 확인 버튼을 누르기 전에는 시간표 메모 데이터가 변경되지 않습니다.',
    parameters:z.object({
      session_date:z.string().regex(DATE_PATTERN),
      hour:z.number().int().min(0).max(12),
      minute:z.union([z.literal(0), z.literal(30)]),
      class_group:z.enum(['AUTO', 'A', 'B']),
      memo_note:z.string().max(5000),
    }),
    async execute({ session_date, hour, minute, class_group, memo_note }) {
      const payload = await prepareTimetableMemoAction({
        requestContext,
        subjectAccess,
        studentLabel,
        division,
        operation,
        sessionDate:session_date,
        hour,
        minute,
        classGroup:class_group,
        memoNote:memo_note,
        requestId,
        sanitizePayload,
      });
      return JSON.stringify(payload);
    },
  });
}

module.exports = {
  parseDateKey,
  isoWeekday,
  mondayKey,
  encodeMemoTimeSlot,
  studentClassTargets,
  availableGroups,
  stableActionClientMessageId,
  prepareTimetableMemoAction,
  createPrepareTimetableMemoTool,
};
