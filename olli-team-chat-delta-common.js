(function initializeOlliTeamChatDelta(global) {
  'use strict';

  if (global.OlliTeamChatDelta?.version) return;

  const VERSION = '1.0.0-step4';
  const CHECKPOINT_PREFIX = 'olli_team_chat_delta_checkpoint_v1:';
  const DEFAULT_LIMIT = 200;
  const DEFAULT_MAX_PAGES = 50;

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function safeKey(value) {
    return clean(value).replace(/[^a-zA-Z0-9._:-]/g, '_');
  }

  function positiveInteger(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  }

  function normalizeCheckpoint(value) {
    if (!value || typeof value !== 'object') return null;
    const messageId = Math.max(0, positiveInteger(value.message_id || value.messageId));
    const changeId = Math.max(0, positiveInteger(value.change_id || value.changeId));
    return Object.freeze({ messageId, changeId });
  }

  function maxMessageId(messages) {
    return (Array.isArray(messages) ? messages : []).reduce(
      (max, item) => Math.max(max, positiveInteger(item?.id)),
      0
    );
  }

  function checkpointKey(context) {
    const academyId = safeKey(context?.academyId || context?.academy_id);
    const accountId = safeKey(context?.accountId || context?.account_id || 'account');
    return academyId ? (CHECKPOINT_PREFIX + accountId + ':' + academyId) : '';
  }

  function readCheckpoint(context) {
    const key = checkpointKey(context);
    if (!key) return null;
    try {
      const raw = global.localStorage?.getItem?.(key);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || Number(parsed.schema_version || 0) !== 1) return null;
      return normalizeCheckpoint(parsed);
    } catch (_) {
      return null;
    }
  }

  function writeCheckpoint(context, checkpoint) {
    const key = checkpointKey(context);
    const normalized = normalizeCheckpoint(checkpoint);
    if (!key || !normalized) return false;
    try {
      global.localStorage?.setItem?.(key, JSON.stringify({
        schema_version: 1,
        academy_id: clean(context?.academyId || context?.academy_id),
        account_id: clean(context?.accountId || context?.account_id),
        message_id: normalized.messageId,
        change_id: normalized.changeId,
        saved_at: new Date().toISOString()
      }));
      return true;
    } catch (_) {
      return false;
    }
  }

  function clearCheckpoint(context) {
    const key = checkpointKey(context);
    if (!key) return false;
    try {
      global.localStorage?.removeItem?.(key);
      return true;
    } catch (_) {
      return false;
    }
  }

  function ensureRpc(rpc) {
    if (typeof rpc !== 'function') throw new Error('Team Chat delta RPC 호출기가 없습니다.');
    return rpc;
  }

  function ensureCurrent(isCurrent) {
    if (typeof isCurrent === 'function' && isCurrent() !== true) {
      const error = new Error('Team Chat delta context changed');
      error.code = 'OLLI_CHAT_DELTA_STALE';
      throw error;
    }
  }

  function normalizeDeltaPayload(payload) {
    if (!payload || payload.ok !== true) {
      throw new Error(clean(payload?.message) || 'Team Chat delta를 불러오지 못했습니다.');
    }
    return {
      baseline: payload.baseline === true,
      academyId: clean(payload.academy_id),
      latestMessageId: Math.max(0, positiveInteger(payload.latest_message_id)),
      latestChangeId: Math.max(0, positiveInteger(payload.latest_change_id)),
      nextMessageId: Math.max(0, positiveInteger(payload.next_message_id)),
      nextChangeId: Math.max(0, positiveInteger(payload.next_change_id)),
      hasMoreMessages: payload.has_more_messages === true,
      hasMoreChanges: payload.has_more_changes === true,
      newMessages: Array.isArray(payload.new_messages) ? payload.new_messages : [],
      changedMessages: Array.isArray(payload.changed_messages) ? payload.changed_messages : [],
      deletedMessageIds: Array.isArray(payload.deleted_message_ids)
        ? payload.deleted_message_ids.map(positiveInteger).filter(Boolean)
        : [],
      changeTypes: Array.isArray(payload.change_types) ? payload.change_types.map(clean).filter(Boolean) : []
    };
  }

  async function createBaseline(options) {
    const rpc = ensureRpc(options?.rpc);
    const academyId = clean(options?.academyId);
    const sessionToken = clean(options?.sessionToken);
    if (!academyId || !sessionToken) throw new Error('Team Chat delta baseline context가 없습니다.');
    ensureCurrent(options?.isCurrent);

    const payload = normalizeDeltaPayload(await rpc('olli_team_chat_delta', {
      p_session_token: sessionToken,
      p_academy_id: academyId,
      p_after_message_id: null,
      p_after_change_id: null,
      p_limit: 1
    }));

    ensureCurrent(options?.isCurrent);
    return Object.freeze({
      messageId: payload.nextMessageId || payload.latestMessageId,
      changeId: payload.nextChangeId || payload.latestChangeId
    });
  }

  async function pull(options) {
    const rpc = ensureRpc(options?.rpc);
    const academyId = clean(options?.academyId);
    const sessionToken = clean(options?.sessionToken);
    const initial = normalizeCheckpoint(options?.checkpoint);
    if (!academyId || !sessionToken || !initial) {
      throw new Error('Team Chat delta cursor가 준비되지 않았습니다.');
    }

    const limit = Math.max(1, Math.min(Number(options?.limit || DEFAULT_LIMIT), 200));
    const maxPages = Math.max(1, Math.min(Number(options?.maxPages || DEFAULT_MAX_PAGES), 100));
    let cursor = { ...initial };
    const newById = new Map();
    const changedById = new Map();
    const deletedIds = new Set();
    const changeTypes = new Set();
    let latestMessageId = cursor.messageId;
    let latestChangeId = cursor.changeId;
    let pages = 0;
    let complete = false;

    while (pages < maxPages) {
      ensureCurrent(options?.isCurrent);
      const payload = normalizeDeltaPayload(await rpc('olli_team_chat_delta', {
        p_session_token: sessionToken,
        p_academy_id: academyId,
        p_after_message_id: cursor.messageId,
        p_after_change_id: cursor.changeId,
        p_limit: limit
      }));
      ensureCurrent(options?.isCurrent);

      payload.newMessages.forEach(item => {
        const id = positiveInteger(item?.id);
        if (id) newById.set(id, item);
      });
      payload.changedMessages.forEach(item => {
        const id = positiveInteger(item?.id);
        if (id) changedById.set(id, item);
      });
      payload.deletedMessageIds.forEach(id => deletedIds.add(id));
      payload.changeTypes.forEach(type => changeTypes.add(type));

      const next = {
        messageId: Math.max(cursor.messageId, payload.nextMessageId),
        changeId: Math.max(cursor.changeId, payload.nextChangeId)
      };
      latestMessageId = Math.max(latestMessageId, payload.latestMessageId);
      latestChangeId = Math.max(latestChangeId, payload.latestChangeId);
      pages += 1;

      const progressed = next.messageId > cursor.messageId || next.changeId > cursor.changeId;
      cursor = next;
      if (!payload.hasMoreMessages && !payload.hasMoreChanges) {
        complete = true;
        break;
      }
      if (!progressed) {
        const error = new Error('Team Chat delta cursor가 진행되지 않았습니다.');
        error.code = 'OLLI_CHAT_DELTA_STALLED';
        throw error;
      }
    }

    return Object.freeze({
      academyId,
      newMessages: [...newById.values()].sort((a, b) => positiveInteger(a?.id) - positiveInteger(b?.id)),
      changedMessages: [...changedById.values()].sort((a, b) => positiveInteger(a?.id) - positiveInteger(b?.id)),
      deletedMessageIds: [...deletedIds].sort((a, b) => a - b),
      changeTypes: [...changeTypes],
      checkpoint: Object.freeze({ messageId: cursor.messageId, changeId: cursor.changeId }),
      latestMessageId,
      latestChangeId,
      pages,
      complete
    });
  }

  function messageKey(item) {
    const id = positiveInteger(item?.id);
    if (id) return 'id:' + id;
    const clientId = clean(item?.client_message_id);
    return clientId ? 'client:' + clientId : '';
  }

  function applyToPayload(basePayload, delta, options) {
    const maxMessages = Math.max(1, Number(options?.maxMessages || 500));
    const deleted = new Set((delta?.deletedMessageIds || []).map(positiveInteger).filter(Boolean));
    const merged = new Map();

    (Array.isArray(basePayload?.messages) ? basePayload.messages : []).forEach(item => {
      const key = messageKey(item);
      const id = positiveInteger(item?.id);
      if (key && !deleted.has(id)) merged.set(key, item);
    });
    (Array.isArray(delta?.newMessages) ? delta.newMessages : []).forEach(item => {
      const key = messageKey(item);
      const id = positiveInteger(item?.id);
      if (key && !deleted.has(id)) merged.set(key, item);
    });
    (Array.isArray(delta?.changedMessages) ? delta.changedMessages : []).forEach(item => {
      const key = messageKey(item);
      const id = positiveInteger(item?.id);
      if (key && !deleted.has(id)) merged.set(key, item);
    });

    const messages = [...merged.values()]
      .filter(item => !deleted.has(positiveInteger(item?.id)))
      .sort((a, b) => positiveInteger(a?.id) - positiveInteger(b?.id))
      .slice(-maxMessages);

    return {
      ok: true,
      academy_id: delta?.academyId || basePayload?.academy_id || '',
      current_member_id: basePayload?.current_member_id || '',
      current_member_name: basePayload?.current_member_name || '',
      messages
    };
  }

  function applyToArchive(basePayload, delta, options) {
    if (!basePayload) return null;
    const maxMessages = Math.max(1, Number(options?.maxMessages || 1000));
    const updated = applyToPayload(basePayload, delta, { maxMessages });
    updated.messages = updated.messages.slice().sort((a, b) => positiveInteger(b?.id) - positiveInteger(a?.id));
    if (basePayload.cached_at) updated.cached_at = basePayload.cached_at;
    return updated;
  }

  function isUnavailableError(error) {
    const message = clean(error?.message || error).toLowerCase();
    return message.includes('olli_team_chat_delta')
      && (
        message.includes('not find')
        || message.includes('not found')
        || message.includes('does not exist')
        || message.includes('pgrst202')
        || message.includes('schema cache')
      );
  }

  global.OlliTeamChatDelta = Object.freeze({
    version: VERSION,
    normalizeCheckpoint,
    maxMessageId,
    readCheckpoint,
    writeCheckpoint,
    clearCheckpoint,
    createBaseline,
    pull,
    applyToPayload,
    applyToArchive,
    isUnavailableError
  });
})(window);
