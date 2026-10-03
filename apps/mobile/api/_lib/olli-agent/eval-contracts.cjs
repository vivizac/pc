'use strict';

function singleToolContract(tool, category) {
  return Object.freeze({
    category,
    requiredTools: [tool],
    allowedTools: [tool],
    maxToolCalls: 1,
    requireFinalOutput: true,
    forbidDuplicateTools: true,
  });
}

const CONTRACTS = Object.freeze({
  'Olli Foundation Probe': Object.freeze({
    category: 'foundation',
    requiredTools: [],
    allowedTools: [],
    maxToolCalls: 0,
    requireFinalOutput: true,
    forbidDuplicateTools: true,
  }),

  'Olli Student Schedule Probe': singleToolContract('get_student_schedule', 'read'),
  'Olli Recent Records Probe': singleToolContract('get_recent_records', 'read'),
  'Olli Schedule Availability Probe': singleToolContract('get_schedule_availability', 'read'),
  'Olli Attendance Probe': singleToolContract('get_attendance', 'read'),
  'Olli Pickup Probe': singleToolContract('get_pickups', 'read'),
  'Olli Student Profile Probe': singleToolContract('get_student_profile', 'read'),
  'Olli Timetable Read': singleToolContract('read_timetable_query', 'read'),
  'Olli Contextual Read': Object.freeze({
    category:'read',
    requiredTools:[],
    allowedTools:[
      'get_student_schedule',
      'get_attendance',
      'get_pickups',
      'read_timetable_context_query',
    ],
    maxToolCalls:3,
    requireFinalOutput:true,
    forbidDuplicateTools:true,
  }),
  'Olli Feedback Direct Read': Object.freeze({
    category:'read',
    requiredTools:[],
    allowedTools:[],
    maxToolCalls:0,
    requireFinalOutput:true,
    forbidDuplicateTools:true,
  }),

  'Olli Absence Prepare': singleToolContract('prepare_absence', 'prepare'),
  'Olli Absence Prepare Probe': singleToolContract('prepare_absence', 'prepare'),
  'Olli One-time Class Prepare': singleToolContract('prepare_class_once', 'prepare'),
  'Olli One-time Class Prepare Probe': singleToolContract('prepare_class_once', 'prepare'),
  'Olli Makeup Prepare': singleToolContract('prepare_makeup', 'prepare'),
  'Olli Makeup Prepare Probe': singleToolContract('prepare_makeup', 'prepare'),
  'Olli Makeup Dialogue': Object.freeze({
    category:'dialogue',
    requiredTools:[],
    allowedTools:[],
    maxToolCalls:0,
    requireFinalOutput:true,
    forbidDuplicateTools:true,
  }),
  'Olli Makeup Update Prepare': singleToolContract('prepare_makeup_update', 'prepare'),
  'Olli Makeup Update Prepare Probe': singleToolContract('prepare_makeup_update', 'prepare'),
  'Olli Makeup Cancel Prepare': singleToolContract('prepare_makeup_cancel', 'prepare'),
  'Olli Makeup Cancel Prepare Probe': singleToolContract('prepare_makeup_cancel', 'prepare'),
  'Olli Trial Add Prepare': singleToolContract('prepare_trial_add', 'prepare'),
  'Olli Trial Add Prepare Probe': singleToolContract('prepare_trial_add', 'prepare'),
  'Olli Trial Update Prepare': singleToolContract('prepare_trial_update', 'prepare'),
  'Olli Trial Update Prepare Probe': singleToolContract('prepare_trial_update', 'prepare'),
  'Olli Trial Cancel Prepare': singleToolContract('prepare_trial_cancel', 'prepare'),
  'Olli Trial Cancel Prepare Probe': singleToolContract('prepare_trial_cancel', 'prepare'),
  'Olli Waitlist Add Prepare': singleToolContract('prepare_waitlist_add', 'prepare'),
  'Olli Waitlist Add Prepare Probe': singleToolContract('prepare_waitlist_add', 'prepare'),
  'Olli Waitlist Update Prepare': singleToolContract('prepare_waitlist_update', 'prepare'),
  'Olli Waitlist Update Prepare Probe': singleToolContract('prepare_waitlist_update', 'prepare'),
  'Olli Waitlist Cancel Prepare': singleToolContract('prepare_waitlist_cancel', 'prepare'),
  'Olli Waitlist Cancel Prepare Probe': singleToolContract('prepare_waitlist_cancel', 'prepare'),
  'Olli Move Prepare': singleToolContract('prepare_move_class', 'prepare'),
  'Olli Move Prepare Probe': singleToolContract('prepare_move_class', 'prepare'),
  'Olli Move Cancel Prepare': singleToolContract('prepare_move_cancel', 'prepare'),
  'Olli Move Cancel Prepare Probe': singleToolContract('prepare_move_cancel', 'prepare'),
  'Olli Timetable Memo Prepare': singleToolContract('prepare_timetable_memo', 'prepare'),
  'Olli Timetable Memo Prepare Probe': singleToolContract('prepare_timetable_memo', 'prepare'),
  'Olli Pickup Prepare': singleToolContract('prepare_pickup_add', 'prepare'),
  'Olli Pickup Prepare Probe': singleToolContract('prepare_pickup_add', 'prepare'),
  'Olli Pickup Update Prepare': singleToolContract('prepare_pickup_update', 'prepare'),
  'Olli Pickup Update Prepare Probe': singleToolContract('prepare_pickup_update', 'prepare'),
  'Olli Pickup Cancel Prepare': singleToolContract('prepare_pickup_cancel', 'prepare'),
  'Olli Pickup Cancel Prepare Probe': singleToolContract('prepare_pickup_cancel', 'prepare'),
  'Olli Timetable Admin Prepare': singleToolContract('prepare_timetable_admin', 'prepare'),
  'Olli Attendance Status Prepare': singleToolContract('prepare_attendance_status', 'prepare'),
});

const REPRESENTATIVE_SCENARIOS = Object.freeze([
  Object.freeze({
    id: 'explicit-student-schedule',
    kind: 'read',
    agent: 'Olli Student Schedule Probe',
    expectation: 'one get_student_schedule call with privacy-safe student reference',
  }),
  Object.freeze({
    id: 'contextual-student-attendance',
    kind: 'session',
    agent: 'Olli Attendance Probe',
    expectation: 'reuse the same private subject binding for “그 학생”',
  }),
  Object.freeze({
    id: 'cross-device-team-talk-context',
    kind: 'session',
    expectation: 'same academy+member+team_talk resolves the same server session on PC and Mobile',
  }),
  Object.freeze({
    id: 'ambiguous-student-blocked-before-model',
    kind: 'privacy',
    expectation: 'ambiguous student name is rejected before Agent execution',
  }),
  Object.freeze({
    id: 'availability-tool-selection',
    kind: 'read',
    agent: 'Olli Timetable Read',
    expectation: 'one read_timetable_query call for source-bound availability/roster/pickup reads',
  }),
  Object.freeze({
    id: 'attendance-tool-selection',
    kind: 'read',
    agent: 'Olli Attendance Probe',
    expectation: 'one get_attendance call',
  }),
  Object.freeze({
    id: 'pickup-tool-selection',
    kind: 'read',
    agent: 'Olli Pickup Probe',
    expectation: 'one get_pickups call',
  }),
  Object.freeze({
    id: 'write-stops-at-confirmation',
    kind: 'prepare',
    expectation: 'Agent endpoint creates pending actions only and never executes olli_team_chat_action_execute',
  }),
  Object.freeze({
    id: 'retry-idempotency',
    kind: 'session',
    expectation: 'same source run key produces the same first deterministic batch key',
  }),
  Object.freeze({
    id: 'duplicate-tool-detected',
    kind: 'eval',
    expectation: 'duplicate single-tool calls are reported as eval failure without blocking the user request',
  }),
]);

function resolveAgentEvalContract(agentName) {
  return CONTRACTS[String(agentName || '').trim()] || null;
}

module.exports = {
  CONTRACTS,
  REPRESENTATIVE_SCENARIOS,
  resolveAgentEvalContract,
};
