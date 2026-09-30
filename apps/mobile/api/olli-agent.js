function safeText(value, maxLength = 200) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const mode = safeText(body.mode, 40);

    if (!['probe', 'privacy_probe', 'profile_probe', 'schedule_probe', 'records_probe', 'availability_probe', 'attendance_probe', 'pickups_probe', 'memo_prepare_probe', 'pickup_prepare_probe'].includes(mode)) {
      return res.status(400).json({
        error: '현재 독립 Agent endpoint는 probe, privacy_probe, profile_probe, schedule_probe, records_probe, availability_probe, attendance_probe, pickups_probe, memo_prepare_probe 또는 pickup_prepare_probe 모드만 지원합니다.',
      });
    }

    const contextModule = await import('./_lib/olli-agent/request-context.cjs');
    const requestContext = await contextModule.loadOlliAgentRequestContext(body);

    if (mode === 'privacy_probe' || mode === 'profile_probe' || mode === 'schedule_probe' || mode === 'records_probe' || mode === 'availability_probe' || mode === 'attendance_probe' || mode === 'pickups_probe' || mode === 'memo_prepare_probe' || mode === 'pickup_prepare_probe') {
      const message = safeText(body.message, 5000);
      if (!message) {
        return res.status(400).json({
          error: mode + '에는 확인할 메시지가 필요합니다.',
          code: 'OLLI_AGENT_MESSAGE_REQUIRED',
        });
      }

      const privacyModule = await import('./_lib/olli-agent/privacy.cjs');
      const prepared = await privacyModule.prepareAgentPrivacyInput(
        message,
        requestContext
      );

      if (mode === 'privacy_probe') {
        return res.status(200).json({
          ok: true,
          mode: 'privacy_probe',
          safeText: prepared.safeText,
          subjectRefs: prepared.subjectRefs,
          needsDisambiguation: prepared.needsDisambiguation,
          ambiguousCount: prepared.ambiguousCount,
          privacy: prepared.privacy,
        });
      }

      const runtimeModule = await import('./_lib/olli-agent/runtime.cjs');
      const agentContext = contextModule.toAgentRunContext(requestContext);
      let probe;
      if (mode === 'profile_probe') {
        probe = await runtimeModule.runStudentProfileProbe({
          agentContext,
          requestContext,
          preparedPrivacy: prepared,
        });
      } else if (mode === 'schedule_probe') {
        probe = await runtimeModule.runStudentScheduleProbe({
          agentContext,
          requestContext,
          preparedPrivacy: prepared,
        });
      } else if (mode === 'records_probe') {
        probe = await runtimeModule.runRecentRecordsProbe({
          agentContext,
          requestContext,
          preparedPrivacy: prepared,
        });
      } else if (mode === 'availability_probe') {
        probe = await runtimeModule.runScheduleAvailabilityProbe({
          agentContext,
          requestContext,
          preparedPrivacy: prepared,
        });
      } else if (mode === 'attendance_probe') {
        probe = await runtimeModule.runAttendanceProbe({
          agentContext,
          requestContext,
          preparedPrivacy: prepared,
        });
      } else if (mode === 'pickups_probe') {
        probe = await runtimeModule.runPickupProbe({
          agentContext,
          requestContext,
          preparedPrivacy: prepared,
        });
      } else if (mode === 'memo_prepare_probe') {
        const requestId = safeText(body.requestId || body.request_id, 160);
        if (!requestId) {
          return res.status(400).json({
            error: 'memo_prepare_probe에는 재시도 중복 방지용 requestId가 필요합니다.',
            code: 'OLLI_AGENT_REQUEST_ID_REQUIRED',
          });
        }
        probe = await runtimeModule.runTimetableMemoPrepareProbe({
          agentContext,
          requestContext,
          preparedPrivacy: prepared,
          requestId,
        });
      } else {
        const requestId = safeText(body.requestId || body.request_id, 160);
        if (!requestId) {
          return res.status(400).json({
            error: 'pickup_prepare_probe에는 재시도 중복 방지용 requestId가 필요합니다.',
            code: 'OLLI_AGENT_REQUEST_ID_REQUIRED',
          });
        }
        probe = await runtimeModule.runPickupPrepareProbe({
          agentContext,
          requestContext,
          preparedPrivacy: prepared,
          requestId,
        });
      }

      return res.status(200).json({
        ok: true,
        mode,
        ready: probe.ready === true,
        model: probe.model,
        nodeVersion: probe.nodeVersion,
        output: probe.output,
        subjectRefs: prepared.subjectRefs,
        privacy: prepared.privacy,
      });
    }

    const runtimeModule = await import('./_lib/olli-agent/runtime.cjs');
    const agentContext = contextModule.toAgentRunContext(requestContext);
    const probe = await runtimeModule.runFoundationProbe(agentContext);

    return res.status(200).json({
      ok: true,
      mode: 'probe',
      ready: probe.ready === true,
      model: probe.model,
      nodeVersion: probe.nodeVersion,
      output: probe.output,
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode || 500);
    console.error('[OLLI Agent] request failed:', safeText(error?.code || error?.name || 'ERROR', 80));

    return res.status(statusCode).json({
      error: error?.message || '올리 Agent 서버 오류가 발생했습니다.',
      code: safeText(error?.code || 'OLLI_AGENT_ERROR', 80),
    });
  }
}
