'use strict';

const { callSupabaseRpc } = require('./supabase-rpc.cjs');
const { createOpaqueSubjectRef } = require('../ai-request-scope.cjs');
const { collectStudentNameVariants } = require('../ai-privacy-gateway.cjs');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function statusRank(value) {
  const status = clean(value).toLowerCase();
  if (status === 'active') return 0;
  if (status === 'paused') return 1;
  if (status === 'inactive') return 2;
  if (status === 'withdrawn') return 3;
  return 4;
}

function normalizeStudentRow(row) {
  if (!row || typeof row !== 'object' || row.is_deleted === true) return null;
  const id = clean(row.id);
  const name = clean(row.name);
  if (!id || !name) return null;

  return {
    row,
    id,
    name,
    division: clean(row.division),
    status: clean(row.status),
    aliases: collectStudentNameVariants(row),
  };
}

function findOccurrences(text, needle) {
  const source = String(text || '');
  const target = String(needle || '');
  const indexes = [];
  if (!target) return indexes;

  let offset = 0;
  while (offset <= source.length - target.length) {
    const index = source.indexOf(target, offset);
    if (index < 0) break;
    indexes.push(index);
    offset = index + Math.max(1, target.length);
  }
  return indexes;
}

function rangeCovered(ranges, start, end) {
  return ranges.some((range) => start >= range.start && end <= range.end);
}

function pickPreferredCandidate(candidates) {
  if (!Array.isArray(candidates) || !candidates.length) {
    return { student: null, ambiguous: false };
  }

  const ordered = candidates.slice().sort((a, b) =>
    statusRank(a.status) - statusRank(b.status)
    || a.name.localeCompare(b.name)
    || a.id.localeCompare(b.id)
  );
  const bestRank = statusRank(ordered[0].status);
  const best = ordered.filter((item) => statusRank(item.status) === bestRank);

  return {
    student: best.length === 1 ? best[0] : null,
    ambiguous: best.length > 1,
  };
}

function matchStudentReferences(text, rows, options = {}) {
  const sourceText = String(text || '');
  const students = (Array.isArray(rows) ? rows : [])
    .map(normalizeStudentRow)
    .filter(Boolean);

  const aliasMap = new Map();
  students.forEach((student) => {
    student.aliases.forEach((alias) => {
      const key = clean(alias);
      if (key.length < 2) return;
      if (!aliasMap.has(key)) aliasMap.set(key, []);
      aliasMap.get(key).push(student);
    });
  });

  const aliasHits = [];
  Array.from(aliasMap.keys())
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .forEach((alias) => {
      findOccurrences(sourceText, alias).forEach((position) => {
        aliasHits.push({
          alias,
          position,
          end: position + alias.length,
          candidates: aliasMap.get(alias) || [],
        });
      });
    });

  aliasHits.sort((a, b) =>
    a.position - b.position
    || (b.end - b.position) - (a.end - a.position)
    || a.alias.localeCompare(b.alias)
  );

  const coveredRanges = [];
  const resolvedByStudentId = new Map();
  const ambiguous = [];

  for (const hit of aliasHits) {
    if (rangeCovered(coveredRanges, hit.position, hit.end)) continue;

    const alreadyResolved = hit.candidates.filter((candidate) =>
      resolvedByStudentId.has(candidate.id)
    );

    let chosen = null;
    let isAmbiguous = false;

    if (alreadyResolved.length === 1) {
      chosen = alreadyResolved[0];
    } else {
      const preferred = pickPreferredCandidate(hit.candidates);
      chosen = preferred.student;
      isAmbiguous = preferred.ambiguous;
    }

    if (isAmbiguous) {
      ambiguous.push({
        position: hit.position,
        end: hit.end,
        aliasLength: hit.alias.length,
        candidateCount: hit.candidates.length,
      });
      coveredRanges.push({ start: hit.position, end: hit.end });
      continue;
    }

    if (!chosen) continue;

    if (!resolvedByStudentId.has(chosen.id)) {
      resolvedByStudentId.set(chosen.id, {
        student: chosen,
        position: hit.position,
        matchedAlias: hit.alias,
      });
    } else {
      const current = resolvedByStudentId.get(chosen.id);
      current.position = Math.min(current.position, hit.position);
    }

    coveredRanges.push({ start: hit.position, end: hit.end });
  }

  const createSubjectRef =
    typeof options.createSubjectRef === 'function'
      ? options.createSubjectRef
      : createOpaqueSubjectRef;

  const resolved = Array.from(resolvedByStudentId.values())
    .sort((a, b) =>
      a.position - b.position
      || a.student.name.localeCompare(b.student.name)
    )
    .map((item, index) => ({
      label: '학생' + String.fromCharCode(65 + index),
      subjectRef: createSubjectRef(),
      position: item.position,
      matchedAlias: item.matchedAlias,
      student: item.student,
    }));

  return {
    sourceText,
    students,
    resolved,
    ambiguous,
  };
}

async function loadAcademyStudents(requestContext) {
  const result = await callSupabaseRpc('olli_student_data_access', {
    p_session_token: requestContext.sessionToken,
    p_academy_id: requestContext.academyId,
    p_action: 'read',
    p_operation: 'list',
    p_identity: {},
    p_payload: {},
    p_limit: 5000,
  });

  if (!result?.ok) {
    const error = new Error(result?.message || '학생 목록을 불러오지 못했습니다.');
    error.statusCode = 403;
    error.code = result?.code || 'OLLI_AGENT_STUDENT_LIST_FAILED';
    throw error;
  }

  return Array.isArray(result.rows) ? result.rows : [];
}

async function resolveStudentReferences(text, requestContext, options = {}) {
  const rows = Array.isArray(options.rows)
    ? options.rows
    : await loadAcademyStudents(requestContext);

  return matchStudentReferences(text, rows, options);
}

function createSubjectAccess(resolution) {
  const byRef = new Map();
  const byLabel = new Map();

  (Array.isArray(resolution?.resolved) ? resolution.resolved : []).forEach((item) => {
    const internal = Object.freeze({
      studentId: item.student.id,
      division: item.student.division,
      status: item.student.status,
    });
    byRef.set(item.subjectRef, internal);
    byLabel.set(item.label, internal);
  });

  return Object.freeze({
    resolve(subjectKey) {
      const key = clean(subjectKey);
      return byRef.get(key) || byLabel.get(key) || null;
    },
  });
}

module.exports = {
  statusRank,
  normalizeStudentRow,
  matchStudentReferences,
  loadAcademyStudents,
  resolveStudentReferences,
  createSubjectAccess,
};
