'use strict';

const PERF_LOG_PREFIX = '[OLLI Agent Perf] ';

function cleanName(value, maxLength = 80) {
  return String(value == null ? '' : value)
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]/g, '_')
    .slice(0, maxLength);
}

function startPerfTimer() {
  return process.hrtime.bigint();
}

function perfDurationMs(startedAt) {
  if (typeof startedAt !== 'bigint') return null;
  const elapsedNs = process.hrtime.bigint() - startedAt;
  const elapsedMs = Number(elapsedNs) / 1e6;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return null;
  return Math.round(elapsedMs * 10) / 10;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildPerfEvent(input = {}) {
  const phase = cleanName(input.phase, 80);
  if (!phase) return null;

  const event = {
    version: 1,
    phase,
    status: cleanName(input.status || 'ok', 20) || 'ok',
  };

  for (const key of ['mode', 'agent', 'rpc', 'errorCode']) {
    const value = cleanName(input[key], 100);
    if (value) event[key] = value;
  }

  for (const key of [
    'durationMs',
    'httpStatus',
    'toolCallCount',
    'assistantMessageCount',
    'modelResponseCount',
  ]) {
    const value = finiteNumber(input[key]);
    if (value != null) event[key] = value;
  }

  return Object.freeze(event);
}

function shouldEmitPerfLog() {
  return process.env.NODE_ENV !== 'test' && process.env.OLLI_AGENT_PERF_LOGS !== '0';
}

function emitPerfLog(input = {}) {
  const event = buildPerfEvent(input);
  if (!event) return false;
  if (shouldEmitPerfLog()) {
    console.info(PERF_LOG_PREFIX + JSON.stringify(event));
  }
  return true;
}

module.exports = {
  PERF_LOG_PREFIX,
  cleanName,
  startPerfTimer,
  perfDurationMs,
  buildPerfEvent,
  emitPerfLog,
};
