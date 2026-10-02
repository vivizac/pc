'use strict';

const crypto = require('node:crypto');
const { resolveAgentEvalContract } = require('./eval-contracts.cjs');

const WORKFLOW_NAME = 'Olli Team Chat Agent';
const GROUP_PREFIX = 'olli_team_talk_';
const MAX_KEYS = 24;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function safeName(value, fallback = 'unknown') {
  const normalized = clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

function safeErrorCode(value) {
  return safeName(value, 'agent-run-error').toUpperCase().replace(/-/g, '_');
}

function buildTraceGroupId(context = {}) {
  const academyId = clean(context?.academyId);
  const memberId = clean(context?.memberId);
  if (!academyId || !memberId) return '';

  const digest = crypto
    .createHash('sha256')
    .update('olli-agent-trace:v1\n' + academyId + '\n' + memberId + '\nteam_talk')
    .digest('hex')
    .slice(0, 32);

  return GROUP_PREFIX + digest;
}

function buildOlliTraceOptions(agent, options = {}) {
  const context = options?.context && typeof options.context === 'object'
    ? options.context
    : {};
  const groupId = buildTraceGroupId(context);
  const agentName = safeName(agent?.name, 'olli-agent');
  const tracingDisabled =
    options?.tracingDisabled === true ||
    process.env.NODE_ENV === 'test' ||
    process.env.OPENAI_AGENTS_DISABLE_TRACING === '1';

  const next = {
    ...options,
    tracingDisabled,
    traceIncludeSensitiveData: false,
    workflowName: WORKFLOW_NAME,
    traceMetadata: {
      app: 'olli',
      surface: 'team_talk',
      agent: agentName,
      privacy: 'redacted',
    },
  };

  // Never accept caller-provided trace/group identifiers because they may
  // accidentally contain academy/member/message identifiers.
  delete next.traceId;
  if (groupId) next.groupId = groupId;
  else delete next.groupId;

  return next;
}

function parseArgumentKeys(value) {
  let parsed = value;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [];
    try {
      parsed = JSON.parse(text);
    } catch {
      return ['__unparsed__'];
    }
  }

  if (Array.isArray(parsed)) return ['__array__'];
  if (!parsed || typeof parsed !== 'object') return [];
  return Object.keys(parsed).sort().slice(0, MAX_KEYS);
}

function outputShape(value) {
  if (value == null) return { type: 'null' };
  if (Array.isArray(value)) return { type: 'array' };
  if (typeof value === 'object') {
    return {
      type: 'object',
      keys: Object.keys(value).sort().slice(0, MAX_KEYS),
    };
  }
  return { type: typeof value };
}

function toolNameFromItem(item) {
  return safeName(
    item?.toolName ||
    item?.rawItem?.name ||
    '',
    ''
  );
}

function summarizeAgentRun(agent, result) {
  const items = Array.isArray(result?.newItems) ? result.newItems : [];
  const toolCalls = [];
  const toolOutputs = [];
  let assistantMessageCount = 0;
  let unknownItemCount = 0;

  for (const item of items) {
    if (item?.type === 'tool_call_item') {
      const name = toolNameFromItem(item);
      toolCalls.push({
        name: name || 'unknown-tool',
        argumentKeys: parseArgumentKeys(item?.rawItem?.arguments),
      });
      continue;
    }

    if (item?.type === 'tool_call_output_item') {
      const name = toolNameFromItem(item);
      toolOutputs.push({
        name: name || 'unknown-tool',
        shape: outputShape(item?.output),
      });
      continue;
    }

    if (item?.type === 'message_output_item') {
      assistantMessageCount += 1;
      continue;
    }

    if (item?.type) unknownItemCount += 1;
  }

  const counts = new Map();
  for (const call of toolCalls) {
    counts.set(call.name, (counts.get(call.name) || 0) + 1);
  }

  const duplicateToolNames = Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([name]) => name)
    .sort();

  return Object.freeze({
    version: 1,
    agent: safeName(agent?.name, 'olli-agent'),
    toolCalls,
    toolOutputs,
    toolCallCount: toolCalls.length,
    toolOutputCount: toolOutputs.length,
    duplicateToolNames,
    assistantMessageCount,
    unknownItemCount,
    finalOutputPresent: clean(result?.finalOutput).length > 0,
  });
}

function evaluateRunSummary(summary, contract = {}) {
  const requiredTools = Array.isArray(contract.requiredTools)
    ? contract.requiredTools.map((item) => safeName(item, '')).filter(Boolean)
    : [];
  const allowedTools = Array.isArray(contract.allowedTools)
    ? new Set(contract.allowedTools.map((item) => safeName(item, '')).filter(Boolean))
    : null;
  const maxToolCalls = Number.isFinite(Number(contract.maxToolCalls))
    ? Math.max(0, Math.trunc(Number(contract.maxToolCalls)))
    : null;
  const issues = [];
  const usedTools = new Set(
    (Array.isArray(summary?.toolCalls) ? summary.toolCalls : [])
      .map((item) => safeName(item?.name, ''))
      .filter(Boolean)
  );

  for (const toolName of requiredTools) {
    if (!usedTools.has(toolName)) issues.push('REQUIRED_TOOL_MISSING:' + toolName);
  }

  if (allowedTools) {
    for (const toolName of usedTools) {
      if (!allowedTools.has(toolName)) issues.push('UNEXPECTED_TOOL:' + toolName);
    }
  }

  if (maxToolCalls != null && Number(summary?.toolCallCount || 0) > maxToolCalls) {
    issues.push('TOOL_CALL_LIMIT_EXCEEDED');
  }

  if (contract.requireFinalOutput === true && summary?.finalOutputPresent !== true) {
    issues.push('FINAL_OUTPUT_MISSING');
  }

  if (contract.forbidDuplicateTools === true && Array.isArray(summary?.duplicateToolNames) && summary.duplicateToolNames.length) {
    issues.push('DUPLICATE_TOOL_CALL');
  }

  return Object.freeze({
    ok: issues.length === 0,
    issues,
  });
}

function shouldEmitEvalLog() {
  return process.env.NODE_ENV !== 'test' && process.env.OLLI_AGENT_EVAL_LOGS !== '0';
}

function emitEvalLog(payload, level = 'info') {
  if (!shouldEmitEvalLog()) return;
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  const line = '[OLLI Agent Eval] ' + JSON.stringify(safePayload);
  if (level === 'warn') console.warn(line);
  else console.info(line);
}

function wrapOlliAgentRun(runFn) {
  if (typeof runFn !== 'function') {
    throw new TypeError('Agents SDK run 함수가 필요합니다.');
  }

  return async function olliObservedRun(agent, input, options = {}) {
    const runOptions = buildOlliTraceOptions(agent, options);
    try {
      const result = await runFn(agent, input, runOptions);
      const summary = summarizeAgentRun(agent, result);
      const contract = resolveAgentEvalContract(agent?.name);
      const evaluation = contract ? evaluateRunSummary(summary, contract) : null;
      emitEvalLog({
        status: 'ok',
        ...summary,
        evalContract: contract
          ? {
              category: contract.category || 'unknown',
              ok: evaluation.ok,
              issues: evaluation.issues,
            }
          : {
              category: 'unmapped',
              ok: false,
              issues: ['AGENT_EVAL_CONTRACT_MISSING'],
            },
      }, evaluation && evaluation.ok === false ? 'warn' : 'info');
      return result;
    } catch (error) {
      emitEvalLog({
        status: 'error',
        version: 1,
        agent: safeName(agent?.name, 'olli-agent'),
        errorCode: safeErrorCode(error?.code || error?.name),
      }, 'warn');
      throw error;
    }
  };
}

module.exports = {
  WORKFLOW_NAME,
  GROUP_PREFIX,
  buildTraceGroupId,
  buildOlliTraceOptions,
  parseArgumentKeys,
  outputShape,
  summarizeAgentRun,
  evaluateRunSummary,
  wrapOlliAgentRun,
};
