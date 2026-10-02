'use strict';

const crypto = require('node:crypto');
const { callSupabaseRpc } = require('./supabase-rpc.cjs');

const DEFAULT_SURFACE = 'team_talk';
const MAX_SESSION_ITEMS = 160;
const MAX_ADD_ITEMS = 50;
const SUBJECT_REF_PATTERN = /^subject_[A-Za-z0-9_-]{16}$/;
const SUBJECT_LABEL_PATTERN = /^학생[A-Z]$/;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function sessionError(message, statusCode = 500, code = 'OLLI_AGENT_SESSION_ERROR') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeSurface(value) {
  const surface = clean(value) || DEFAULT_SURFACE;
  if (surface !== DEFAULT_SURFACE) {
    throw sessionError(
      '지원하지 않는 Agent Session surface입니다.',
      400,
      'OLLI_AGENT_SESSION_SURFACE_INVALID'
    );
  }
  return surface;
}

function normalizeItemLimit(value) {
  if (value == null || value === '') return MAX_SESSION_ITEMS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return MAX_SESSION_ITEMS;
  return Math.min(MAX_SESSION_ITEMS, Math.max(1, Math.trunc(parsed)));
}

function normalizeItems(items) {
  if (!Array.isArray(items)) {
    throw sessionError(
      'Agent Session 저장 항목은 배열이어야 합니다.',
      400,
      'OLLI_AGENT_SESSION_ITEMS_INVALID'
    );
  }
  if (items.length > MAX_ADD_ITEMS) {
    throw sessionError(
      '한 번에 저장할 Agent Session 항목이 너무 많습니다.',
      400,
      'OLLI_AGENT_SESSION_ITEMS_TOO_MANY'
    );
  }
  return items.filter((item) => item && typeof item === 'object');
}

function normalizeSubjectBinding(item) {
  const studentId = clean(item?.studentId || item?.student_id);
  const subjectRef = clean(item?.subjectRef || item?.subject_ref);
  const label = clean(item?.label);
  if (!studentId || !SUBJECT_REF_PATTERN.test(subjectRef) || !SUBJECT_LABEL_PATTERN.test(label)) {
    throw sessionError(
      'Agent Session 학생 참조 정보가 올바르지 않습니다.',
      400,
      'OLLI_AGENT_SESSION_SUBJECT_INVALID'
    );
  }
  return {
    student_id: studentId,
    subject_ref: subjectRef,
    label,
  };
}

function safeSubjectBinding(row) {
  const safe = Object.freeze({
    label: clean(row?.label),
    subjectRef: clean(row?.subject_ref),
    lastUsedAt: clean(row?.last_used_at),
  });
  Object.defineProperty(safe, 'studentId', {
    value: clean(row?.student_id),
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return safe;
}

class OlliSupabaseAgentSession {
  #requestContext;
  #surface;
  #runKey;
  #callRpc;
  #sessionId;
  #writeIndex;

  constructor({
    requestContext,
    surface = DEFAULT_SURFACE,
    runKey = '',
    callRpc = callSupabaseRpc,
  } = {}) {
    const academyId = clean(requestContext?.academyId);
    const memberId = clean(requestContext?.memberId);
    const sessionToken = clean(requestContext?.sessionToken);
    if (!academyId || !memberId || !sessionToken) {
      throw sessionError(
        'Agent Session에는 인증된 academy/member/session context가 필요합니다.',
        500,
        'OLLI_AGENT_SESSION_CONTEXT_REQUIRED'
      );
    }
    if (typeof callRpc !== 'function') {
      throw sessionError(
        'Agent Session 저장소 연결이 준비되지 않았습니다.',
        500,
        'OLLI_AGENT_SESSION_RPC_MISSING'
      );
    }

    this.#requestContext = Object.freeze({ academyId, memberId, sessionToken });
    this.#surface = normalizeSurface(surface);
    this.#runKey = clean(runKey) || crypto.randomUUID();
    this.#callRpc = callRpc;
    this.#sessionId = '';
    this.#writeIndex = 0;
  }

  async #access(action, payload = {}) {
    const result = await this.#callRpc('olli_agent_session_access', {
      p_session_token: this.#requestContext.sessionToken,
      p_academy_id: this.#requestContext.academyId,
      p_member_id: this.#requestContext.memberId,
      p_surface: this.#surface,
      p_action: action,
      p_payload: payload && typeof payload === 'object' ? payload : {},
    });
    if (!result?.ok) {
      throw sessionError(
        result?.message || 'Agent Session 저장소 요청에 실패했습니다.',
        500,
        result?.code || 'OLLI_AGENT_SESSION_ACCESS_FAILED'
      );
    }
    const sessionId = clean(result.session_id);
    if (sessionId) this.#sessionId = sessionId;
    return result;
  }

  async getSessionId() {
    if (this.#sessionId) return this.#sessionId;
    const result = await this.#access('ensure');
    const sessionId = clean(result.session_id);
    if (!sessionId) {
      throw sessionError(
        'Agent Session ID를 확인하지 못했습니다.',
        500,
        'OLLI_AGENT_SESSION_ID_MISSING'
      );
    }
    return sessionId;
  }

  async getItems(limit) {
    const result = await this.#access('get_items', {
      limit: normalizeItemLimit(limit),
    });
    return Array.isArray(result.items) ? result.items : [];
  }

  async addItems(items) {
    const normalized = normalizeItems(items);
    if (!normalized.length) return;

    this.#writeIndex += 1;
    const batchKey = this.#runKey + ':' + String(this.#writeIndex);
    await this.#access('add_items', {
      items: normalized,
      batch_key: batchKey,
    });
  }

  async popItem() {
    const result = await this.#access('pop_item');
    return result.item && typeof result.item === 'object'
      ? result.item
      : undefined;
  }

  async clearSession() {
    await this.#access('clear');
    this.#writeIndex = 0;
  }

  async getSubjectBindings() {
    const result = await this.#access('get_subjects');
    return (Array.isArray(result.subjects) ? result.subjects : [])
      .map(safeSubjectBinding)
      .filter((item) => item.label && item.subjectRef);
  }

  async bindSubjectBindings(subjects) {
    const normalized = (Array.isArray(subjects) ? subjects : [])
      .map(normalizeSubjectBinding);
    if (!normalized.length) return this.getSubjectBindings();
    if (normalized.length > 8) {
      throw sessionError(
        '한 번에 연결할 학생 참조가 너무 많습니다.',
        400,
        'OLLI_AGENT_SESSION_SUBJECTS_TOO_MANY'
      );
    }
    const result = await this.#access('bind_subjects', {
      subjects: normalized,
    });
    return (Array.isArray(result.subjects) ? result.subjects : [])
      .map(safeSubjectBinding)
      .filter((item) => item.label && item.subjectRef);
  }
}

function createOlliAgentSession(options) {
  return new OlliSupabaseAgentSession(options);
}

module.exports = {
  DEFAULT_SURFACE,
  MAX_SESSION_ITEMS,
  MAX_ADD_ITEMS,
  SUBJECT_REF_PATTERN,
  SUBJECT_LABEL_PATTERN,
  normalizeItemLimit,
  normalizeItems,
  normalizeSubjectBinding,
  createOlliAgentSession,
  OlliSupabaseAgentSession,
};
