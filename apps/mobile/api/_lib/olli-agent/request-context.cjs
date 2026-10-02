'use strict';

const { callSupabaseRpc } = require('./supabase-rpc.cjs');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function contextError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function loadOlliAgentRequestContext(body = {}) {
  const sessionToken = clean(body.sessionToken || body.session_token);
  const academyId = clean(body.academyId || body.academy_id);

  if (!sessionToken || !academyId) {
    throw contextError(
      '올리 Agent를 사용하려면 로그인 세션과 학원 정보가 필요합니다.',
      401,
      'OLLI_AGENT_CONTEXT_REQUIRED'
    );
  }

  const [settings, members] = await Promise.all([
    callSupabaseRpc('olli_team_talk_settings_get', {
      p_session_token: sessionToken,
      p_academy_id: academyId,
    }),
    callSupabaseRpc('olli_team_chat_members', {
      p_session_token: sessionToken,
      p_academy_id: academyId,
    }),
  ]);

  if (!settings?.ok || settings?.ai_enabled !== true) {
    throw contextError(
      '현재 학원 설정에서 올리 AI가 꺼져 있습니다.',
      403,
      'OLLI_AGENT_AI_DISABLED'
    );
  }

  const currentMemberId = clean(members?.current_member_id);
  const currentMember = Array.isArray(members?.members)
    ? members.members.find((item) => item?.is_current_member === true)
    : null;

  if (!members?.ok || !currentMemberId) {
    throw contextError(
      '현재 계정의 Team Chat 멤버 정보를 확인하지 못했습니다.',
      403,
      'OLLI_AGENT_MEMBER_NOT_FOUND'
    );
  }

  const memberRole = clean(currentMember?.role);
  const memberName = clean(currentMember?.display_name);

  return Object.freeze({
    academyId,
    memberId: currentMemberId,
    memberRole,
    memberName,
    sessionToken,
  });
}

function toAgentRunContext(requestContext = {}) {
  return Object.freeze({
    academyId: clean(requestContext.academyId),
    memberId: clean(requestContext.memberId),
    memberRole: clean(requestContext.memberRole),
  });
}

module.exports = {
  loadOlliAgentRequestContext,
  toAgentRunContext,
};
