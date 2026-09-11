from pathlib import Path
import re

path = Path('observation-memo-save-common.js')
text = path.read_text()

anchor = "  const legacyGetMemoEntry = global.getMemoEntryByStudent;\n"
if text.count(anchor) != 1:
    raise SystemExit(f'legacy entry anchor expected once, found {text.count(anchor)}')
state = """
  // Same-device request ordering state. CAS protects cross-device writes; these maps
  // additionally prevent an older in-flight request from reverting a newer local edit.
  const requestChains = new Map();
  const latestRequests = new Map();
  const knownServerRevisions = new Map();
  let requestSequence = 0;
"""
if 'const requestChains = new Map();' not in text:
    text = text.replace(anchor, anchor + state, 1)

old_export = "  global.clearStudentNoteDraftFromSupabase = (student, noteType = '', options = {}) => safeSaveNote(student, '', noteType, options);\n"
if text.count(old_export) != 1:
    raise SystemExit(f'raw clear export expected once, found {text.count(old_export)}')
text = text.replace(old_export, '', 1)

old_sig = '  async function persistObservationMemoDraft(student, content, options = {}) {'
if text.count(old_sig) != 1:
    raise SystemExit(f'persist signature expected once, found {text.count(old_sig)}')
text = text.replace(old_sig, '  async function persistObservationMemoDraftBase(student, content, options = {}) {', 1)

old_tail = "  global.persistObservationMemoDraft = persistObservationMemoDraft;\n})(window);"
if text.count(old_tail) != 1:
    raise SystemExit(f'persist export tail expected once, found {text.count(old_tail)}')

integration = r'''
  function requestClean(value) {
    return String(value == null ? '' : value).trim();
  }

  function requestNoteTypeFor(student, explicitType) {
    const explicit = requestClean(explicitType);
    if (explicit) return explicit;
    try {
      if (typeof global.getSupabaseNoteDraftType === 'function') {
        return requestClean(global.getSupabaseNoteDraftType(student));
      }
    } catch (_) {}
    return student?.type === 'kinder' ? 'kinder_risk' : 'elementary_observation';
  }

  function requestKey(student, noteType) {
    const academyId = currentAcademyId();
    const studentId = requestClean(student?.id);
    const type = requestClean(noteType);
    return academyId && studentId && type ? `${academyId}:${studentId}:${type}` : '';
  }

  function localEntry(student) {
    try { return getMemoEntrySafe(student) || {}; }
    catch (_) { return {}; }
  }

  function writePendingRequest(request, expectedRevision) {
    if (!request) return;
    const current = localEntry(request.student);
    setMemoSafe(request.student, request.content, {
      updatedAt: request.updatedAt,
      lastSyncedAt: current.lastSyncedAt || '',
      syncStatus: 'pending',
      revision: memoRevision(expectedRevision),
      mutationId: request.mutationId,
      conflict: null
    });
  }

  function isSuccessfulPersistResult(result) {
    return !!(
      result &&
      (result.state === 'synced' || result.state === 'cleared') &&
      Number.isFinite(Number(result.revision))
    );
  }

  function rememberServerRevision(key, result) {
    if (!key || !isSuccessfulPersistResult(result)) return;
    const value = memoRevision(result.revision);
    const previous = memoRevision(knownServerRevisions.get(key));
    if (value >= previous) knownServerRevisions.set(key, value);
  }

  function restoreNewestPendingRequest(key, completedSequence, completedResult) {
    rememberServerRevision(key, completedResult);
    const newest = latestRequests.get(key);
    if (!newest || newest.sequence === completedSequence) return false;

    const knownRevision = memoRevision(knownServerRevisions.get(key));
    if (isSuccessfulPersistResult(completedResult) && knownRevision > newest.expectedRevision) {
      newest.expectedRevision = knownRevision;
    }
    writePendingRequest(newest, newest.expectedRevision);
    try {
      if (typeof global.setMemoSaveStatus === 'function') global.setMemoSaveStatus('작성 중...');
    } catch (_) {}
    return true;
  }

  async function persistObservationMemoDraft(student, content, options = {}) {
    if (!student) return persistObservationMemoDraftBase(student, content, options);
    const noteType = requestNoteTypeFor(student, options.noteType);
    const key = requestKey(student, noteType);
    if (!key) return persistObservationMemoDraftBase(student, content, options);

    const before = localEntry(student);
    // Preserve the base CAS boundary: a known conflict is never converted back to
    // pending merely because another autosave callback fired.
    if (before.syncStatus === 'conflict' && options.resolveConflict !== true) {
      return persistObservationMemoDraftBase(student, content, options);
    }

    const explicitExpected = Object.prototype.hasOwnProperty.call(options, 'expectedRevision');
    const request = {
      sequence: ++requestSequence,
      student: { ...student },
      noteType,
      content: String(content == null ? '' : content),
      expectedRevision: explicitExpected ? memoRevision(options.expectedRevision) : memoRevision(before.revision),
      mutationId: requestClean(options.mutationId) || createMutationId(),
      updatedAt: options.updatedAt || new Date().toISOString(),
      options: { ...options }
    };

    latestRequests.set(key, request);
    // Keep the newest text durable locally immediately while network writes serialize.
    writePendingRequest(request, request.expectedRevision);

    const previous = requestChains.get(key) || Promise.resolve(null);
    let task;
    task = previous
      .catch(() => null)
      .then(async previousResult => {
        rememberServerRevision(key, previousResult);

        if (latestRequests.get(key)?.sequence !== request.sequence) {
          return {
            state: 'superseded',
            student: request.student,
            error: null,
            revision: memoRevision(knownServerRevisions.get(key) || request.expectedRevision),
            superseded: true
          };
        }

        const knownRevision = memoRevision(knownServerRevisions.get(key));
        if (knownRevision > request.expectedRevision) request.expectedRevision = knownRevision;
        writePendingRequest(request, request.expectedRevision);

        return persistObservationMemoDraftBase(request.student, request.content, {
          ...request.options,
          noteType: request.noteType,
          expectedRevision: request.expectedRevision,
          mutationId: request.mutationId,
          updatedAt: request.updatedAt
        });
      })
      .then(result => {
        const superseded = restoreNewestPendingRequest(key, request.sequence, result);
        if (superseded && result && typeof result === 'object') return { ...result, superseded: true };
        return result;
      })
      .finally(() => {
        if (requestChains.get(key) === task) requestChains.delete(key);
        if (latestRequests.get(key)?.sequence === request.sequence) latestRequests.delete(key);
      });

    requestChains.set(key, task);
    return task;
  }

  function protectObservationMemoLocalDraft(student, noteType = '', content = '', updatedAt = '') {
    if (!student) return false;
    const type = requestNoteTypeFor(student, noteType);
    const key = requestKey(student, type);
    if (!key) return false;
    const before = localEntry(student);
    const request = {
      sequence: ++requestSequence,
      student: { ...student },
      noteType: type,
      content: String(content == null ? '' : content),
      expectedRevision: memoRevision(before.revision),
      mutationId: createMutationId(),
      updatedAt: updatedAt || new Date().toISOString(),
      options: { localOnly: true }
    };
    latestRequests.set(key, request);
    writePendingRequest(request, request.expectedRevision);
    return true;
  }

  async function clearObservationMemoDraftWithGuard(student, noteType = '') {
    const result = await persistObservationMemoDraft(student, '', { noteType });
    if (result?.state === 'conflict') return result;
    if (result?.state === 'pending' || result?.state === 'blocked') {
      throw result.error || new Error('관찰노트 비우기 서버 저장이 완료되지 않았습니다.');
    }
    return result;
  }

  function getObservationMemoRequestGuardState(student, noteType = '') {
    const type = requestNoteTypeFor(student, noteType);
    const key = requestKey(student, type);
    if (!key) return null;
    const latest = latestRequests.get(key);
    return {
      inFlight: requestChains.has(key),
      latestSequence: latest?.sequence || 0,
      expectedRevision: latest?.expectedRevision ?? memoRevision(knownServerRevisions.get(key)),
      knownServerRevision: memoRevision(knownServerRevisions.get(key))
    };
  }

  global.protectObservationMemoLocalDraft = protectObservationMemoLocalDraft;
  global.persistObservationMemoDraft = persistObservationMemoDraft;
  global.clearStudentNoteDraftFromSupabase = clearObservationMemoDraftWithGuard;
  global.getObservationMemoRequestGuardState = getObservationMemoRequestGuardState;
})(window);'''

text = text.replace(old_tail, integration, 1)
path.write_text(text.rstrip() + '\n')
print('request guard integrated into observation-memo-save-common.js')
