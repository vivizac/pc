/* Phone-only safety net for rescuing observation drafts that exist only in localStorage.
   It never overwrites student_note_drafts and never mutates local memo timestamps/status. */
(function initOlliObservationLocalRecoveryPhone(global) {
  'use strict';

  let recoveryRunning = false;
  let recoveryCompletedThisPage = false;
  let recoveryStartedAt = 0;
  let recoveryRetryTimer = null;

  function text(value) {
    return String(value == null ? '' : value);
  }

  function currentAcademyId() {
    try {
      if (typeof global.getOlliCurrentAcademyId === 'function') {
        return text(global.getOlliCurrentAcademyId()).trim();
      }
    } catch (_) {}
    try {
      return text(localStorage.getItem('olli_current_academy_id')).trim();
    } catch (_) {
      return '';
    }
  }

  function sessionToken() {
    try {
      return text(localStorage.getItem('olli_account_session_token_v1')).trim();
    } catch (_) {
      return '';
    }
  }

  function deviceId() {
    try {
      if (typeof global.getOlliLoginDeviceId === 'function') {
        const resolved = text(global.getOlliLoginDeviceId()).trim();
        if (resolved) return resolved;
      }
    } catch (_) {}
    try {
      return text(
        localStorage.getItem('olli_account_device_id_v1') ||
        localStorage.getItem('olli_device_id_v1') ||
        ''
      ).trim();
    } catch (_) {
      return '';
    }
  }

  function allElementaryStudents() {
    let rows = [];
    try {
      if (typeof global.getAllStudents === 'function') rows = global.getAllStudents() || [];
      else if (typeof global.getStudentsByType === 'function') rows = global.getStudentsByType('elementary') || [];
    } catch (_) {
      rows = [];
    }

    const seen = new Set();
    return (Array.isArray(rows) ? rows : []).filter(student => {
      const id = text(student?.id).trim();
      if (!id || seen.has(id)) return false;
      if (student?.type === 'kinder') return false;
      seen.add(id);
      return true;
    });
  }

  function stableHash(input) {
    const value = text(input);
    let h1 = 0x811c9dc5;
    let h2 = 0x9e3779b9;
    for (let i = 0; i < value.length; i += 1) {
      const code = value.charCodeAt(i);
      h1 ^= code;
      h1 = Math.imul(h1, 0x01000193);
      h2 ^= code + ((h2 << 6) >>> 0) + (h2 >>> 2);
      h2 >>>= 0;
    }
    return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
  }

  function backupIdFor(student, entry) {
    return `local_recovery_${stableHash([
      currentAcademyId(),
      deviceId(),
      text(student?.id),
      text(entry?.updatedAt),
      Number(entry?.revision || 0),
      text(entry?.content)
    ].join('|'))}`;
  }

  async function ensureSession() {
    try {
      if (typeof global.ensureOlliObservationMemoWritableSession === 'function') {
        const ok = await global.ensureOlliObservationMemoWritableSession({ force: true });
        if (ok) return true;
      }
    } catch (error) {
      console.warn('관찰노트 로컬 복구 세션 확인 실패:', error?.message || error);
    }
    return !!sessionToken();
  }

  async function backUpOne(student, entry) {
    const content = text(entry?.content);
    if (!content.trim()) return { skipped: true, reason: 'empty' };
    if (typeof global.supabase !== 'function') throw new Error('Supabase 연결이 준비되지 않았습니다.');

    const academyId = currentAcademyId();
    const token = sessionToken();
    if (!academyId || !token || !student?.id) throw new Error('관찰노트 복구에 필요한 로그인 정보가 없습니다.');

    return global.supabase('POST', 'rpc/olli_note_local_draft_backup', {
      p_session_token: token,
      p_academy_id: academyId,
      p_student_id: student.id,
      p_note_type: 'elementary_observation',
      p_content: content,
      p_local_updated_at: entry?.updatedAt || null,
      p_local_revision: Number(entry?.revision || 0),
      p_device_id: deviceId() || null,
      p_backup_id: backupIdFor(student, entry)
    });
  }

  function scheduleRetry(delay = 5000) {
    if (recoveryCompletedThisPage || recoveryRetryTimer) return;
    const elapsed = recoveryStartedAt ? Date.now() - recoveryStartedAt : 0;
    if (elapsed > 90000) return;
    recoveryRetryTimer = setTimeout(() => {
      recoveryRetryTimer = null;
      void backupLocalObservationDrafts();
    }, delay);
  }

  async function backupLocalObservationDrafts(options = {}) {
    const force = options.force === true;
    if (recoveryRunning) return { ok: false, running: true };
    if (recoveryCompletedThisPage && !force) return { ok: true, skipped: true, reason: 'already_scanned' };
    if (global.navigator?.onLine === false) {
      scheduleRetry(5000);
      return { ok: false, skipped: true, reason: 'offline' };
    }

    if (!recoveryStartedAt) recoveryStartedAt = Date.now();
    recoveryRunning = true;
    const summary = { ok: true, studentCount: 0, scanned: 0, backedUp: 0, sameAsServer: 0, alreadyBackedUp: 0, failed: 0 };

    try {
      const ready = await ensureSession();
      if (!ready || !sessionToken()) {
        summary.ok = false;
        summary.reason = 'session_required';
        scheduleRetry(5000);
        return summary;
      }

      if (typeof global.getMemoEntryByStudent !== 'function') {
        summary.ok = false;
        summary.reason = 'memo_storage_not_ready';
        scheduleRetry(3000);
        return summary;
      }

      const students = allElementaryStudents();
      summary.studentCount = students.length;
      if (!students.length) {
        summary.ok = false;
        summary.reason = 'students_not_ready';
        scheduleRetry(3000);
        return summary;
      }

      for (const student of students) {
        let entry = null;
        try {
          entry = global.getMemoEntryByStudent(student) || null;
        } catch (_) {
          entry = null;
        }
        if (!entry || !text(entry.content).trim()) continue;

        summary.scanned += 1;
        try {
          const result = await backUpOne(student, entry);
          if (result?.ok === false) {
            summary.failed += 1;
            continue;
          }
          if (result?.result === 'same_as_server') summary.sameAsServer += 1;
          else if (result?.result === 'already_backed_up' || result?.result === 'deduplicated') summary.alreadyBackedUp += 1;
          else if (result?.backed_up === true || result?.result === 'backed_up') summary.backedUp += 1;
        } catch (error) {
          summary.failed += 1;
          console.warn(`관찰노트 로컬 복구본 백업 실패 (${student?.name || student?.id || '학생'}):`, error?.message || error);
        }
      }

      recoveryCompletedThisPage = summary.failed === 0;
      if (!recoveryCompletedThisPage) scheduleRetry(5000);
      try {
        global.dispatchEvent(new CustomEvent('olli:observation-local-recovery-complete', { detail: summary }));
      } catch (_) {}
      return summary;
    } finally {
      recoveryRunning = false;
    }
  }

  global.backupOlliPhoneLocalObservationDrafts = backupLocalObservationDrafts;

  function scheduleRecovery() {
    if (!recoveryStartedAt) recoveryStartedAt = Date.now();
    [2500, 6000, 12000, 20000, 35000, 55000].forEach(delay => {
      setTimeout(() => {
        if (!recoveryCompletedThisPage) void backupLocalObservationDrafts();
      }, delay);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleRecovery, { once: true });
  } else {
    scheduleRecovery();
  }

  global.addEventListener('online', () => {
    if (!recoveryCompletedThisPage) setTimeout(() => { void backupLocalObservationDrafts(); }, 1200);
  });
  global.addEventListener('focus', () => {
    if (!recoveryCompletedThisPage) setTimeout(() => { void backupLocalObservationDrafts(); }, 1200);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !recoveryCompletedThisPage) {
      setTimeout(() => { void backupLocalObservationDrafts(); }, 1200);
    }
  });
})(window);

/* Feedback completion is an intentional lifecycle clear. The shared guard confirms
   the server revision first and only then removes this phone's local memo. */
import('./observation-memo-feedback-clear-common.js?v=20260910-feedback-clear-1')
  .catch(error => console.warn('관찰노트 피드백 초기화 보호 모듈 로드 실패:', error?.message || error));
