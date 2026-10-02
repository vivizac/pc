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

    if (!['route_outcome', 'probe', 'privacy_probe', 'profile_probe', 'schedule_probe', 'records_probe', 'availability_probe', 'attendance_probe', 'pickups_probe', 'timetable_read', 'schedule_read', 'attendance_read', 'pickup_read', 'timetable_admin_prepare', 'attendance_status_prepare', 'memo_prepare_probe', 'memo_prepare', 'batch_prepare', 'absence_prepare_probe', 'absence_prepare', 'class_once_prepare_probe', 'class_once_prepare', 'makeup_prepare_probe', 'makeup_update_prepare_probe', 'makeup_update_prepare', 'makeup_cancel_prepare_probe', 'makeup_cancel_prepare', 'makeup_prepare', 'trial_add_prepare_probe', 'trial_add_prepare', 'trial_cancel_prepare_probe', 'trial_cancel_prepare', 'trial_update_prepare_probe', 'trial_update_prepare', 'waitlist_add_prepare_probe', 'waitlist_add_prepare', 'waitlist_update_prepare_probe', 'waitlist_update_prepare', 'waitlist_cancel_prepare_probe', 'waitlist_cancel_prepare', 'move_prepare_probe', 'move_prepare', 'move_cancel_prepare_probe', 'move_cancel_prepare', 'pickup_prepare_probe', 'pickup_update_prepare_probe', 'pickup_cancel_prepare_probe', 'pickup_cancel_prepare', 'pickup_update_prepare', 'pickup_prepare'].includes(mode)) {
      return res.status(400).json({
        error: '지원하지 않는 Olli Agent mode입니다. 현재 production prepare에는 memo_prepare, batch_prepare, absence_prepare, class_once_prepare, makeup/trial/waitlist/move/pickup prepare 계열이 포함됩니다.',
      });
    }

    const contextModule = await import('./_lib/olli-agent/request-context.cjs');
    const requestContext = await contextModule.loadOlliAgentRequestContext(body);

    if (mode === 'route_outcome') {
      const observabilityModule = await import('./_lib/olli-agent/observability.cjs');
      const emitRouteOutcomeLog =
        observabilityModule.emitRouteOutcomeLog ||
        observabilityModule.default?.emitRouteOutcomeLog;
      const accepted = typeof emitRouteOutcomeLog === 'function'
        ? emitRouteOutcomeLog({
            surface:safeText(body.surface, 20),
            outcome:safeText(body.outcome, 40),
            routeKey:safeText(body.routeKey || body.route_key, 80),
            sharedRouteKey:safeText(body.sharedRouteKey || body.shared_route_key, 80),
            classifierAvailable:body.classifierAvailable === true || body.classifier_available === true,
          })
        : false;
      if (!accepted) {
        return res.status(400).json({
          error:'지원하지 않는 route outcome 관찰 값입니다.',
          code:'OLLI_AGENT_ROUTE_OUTCOME_INVALID',
        });
      }
      return res.status(200).json({ ok:true, mode:'route_outcome' });
    }

    if (mode === 'timetable_read' || mode === 'schedule_read' || mode === 'attendance_read' || mode === 'pickup_read') {
      const message=safeText(body.message,5000);
      const sourceMessageId=Number(body.sourceMessageId || body.source_message_id || 0);
      if(!message){
        return res.status(400).json({
          error:mode+'에는 원문 메시지가 필요합니다.',
          code:'OLLI_AGENT_READ_MESSAGE_REQUIRED',
        });
      }
      if(!Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0){
        return res.status(400).json({
          error:mode+'에는 저장된 원문 Team Chat message id가 필요합니다.',
          code:'OLLI_AGENT_READ_SOURCE_MESSAGE_REQUIRED',
        });
      }

      const readIntent=mode==='timetable_read'
        ? (body.readIntent && typeof body.readIntent==='object' ? body.readIntent : null)
        : null;
      if(mode==='timetable_read' && !readIntent){
        return res.status(400).json({
          error:'timetable_read에는 Router가 확정한 readIntent가 필요합니다.',
          code:'OLLI_AGENT_TIMETABLE_READ_INTENT_REQUIRED',
        });
      }

      const runtimeModule=await import('./_lib/olli-agent/runtime.cjs');
      await runtimeModule.validatePickupSourceMessage({
        requestContext,
        sourceMessageId,
        sourceMessageText:message,
      });

      const privacyModule=await import('./_lib/olli-agent/privacy.cjs');
      let prepared;
      let agentSession=null;
      try{
        const sessionModule=await import('./_lib/olli-agent/session.cjs');
        const candidateSession=sessionModule.createOlliAgentSession({
          requestContext,
          surface:'team_talk',
          runKey:'team-chat-message:'+String(sourceMessageId),
        });
        const sessionPrivacy=await privacyModule.prepareAgentReadPrivacyInput(
          message,
          requestContext,
          {session:candidateSession}
        );
        prepared=sessionPrivacy.preparedPrivacy;
        if(sessionPrivacy.sessionEnabled===true) agentSession=candidateSession;
      }catch(sessionError){
        if(!String(sessionError?.code||'').startsWith('OLLI_AGENT_SESSION_')) throw sessionError;
        prepared=await privacyModule.prepareAgentPrivacyInput(message,requestContext);
      }
      const agentContext=contextModule.toAgentRunContext(requestContext);
      let result;

      if(mode==='timetable_read'){
        result=await runtimeModule.runTimetableRead({
          agentContext,
          requestContext,
          preparedPrivacy:prepared,
          sourceMessageId,
          sourceMessageText:message,
          readIntent,
          session:agentSession,
          sourceValidated:true,
        });
      }else if(mode==='schedule_read'){
        result=await runtimeModule.runStudentScheduleRead({
          agentContext,
          requestContext,
          preparedPrivacy:prepared,
          sourceMessageId,
          sourceMessageText:message,
          session:agentSession,
          sourceValidated:true,
        });
      }else if(mode==='attendance_read'){
        result=await runtimeModule.runAttendanceRead({
          agentContext,
          requestContext,
          preparedPrivacy:prepared,
          sourceMessageId,
          sourceMessageText:message,
          session:agentSession,
          sourceValidated:true,
        });
      }else{
        result=await runtimeModule.runPickupRead({
          agentContext,
          requestContext,
          preparedPrivacy:prepared,
          sourceMessageId,
          sourceMessageText:message,
          session:agentSession,
          sourceValidated:true,
        });
      }

      return res.status(200).json({
        ok:true,
        mode,
        ready:result?.ready===true,
        output:safeText(result?.output,12000),
      });
    }

    if (mode === 'timetable_admin_prepare') {
      const message=safeText(body.message,5000);
      const sourceMessageId=Number(body.sourceMessageId || body.source_message_id || 0);
      if(!message){
        return res.status(400).json({
          error:'timetable_admin_prepare에는 원문 메시지가 필요합니다.',
          code:'OLLI_AGENT_TIMETABLE_ADMIN_MESSAGE_REQUIRED',
        });
      }
      if(!Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0){
        return res.status(400).json({
          error:'timetable_admin_prepare에는 저장된 원문 Team Chat message id가 필요합니다.',
          code:'OLLI_AGENT_TIMETABLE_ADMIN_SOURCE_REQUIRED',
        });
      }
      const privacyModule=await import('./_lib/olli-agent/privacy.cjs');
      const prepared=await privacyModule.prepareAgentPrivacyInput(message,requestContext);
      const runtimeModule=await import('./_lib/olli-agent/runtime.cjs');
      const agentContext=contextModule.toAgentRunContext(requestContext);
      const result=await runtimeModule.runTimetableAdminPrepare({
        agentContext,
        requestContext,
        preparedPrivacy:prepared,
        sourceMessageId,
        sourceMessageText:message,
      });
      return res.status(200).json({
        ok:true,
        mode,
        ready:result?.ready===true,
        message:result?.persistedMessage || null,
        recoveredAfterPersist:result?.recoveredAfterPersist===true,
      });
    }

    if (mode === 'attendance_status_prepare') {
      const message=safeText(body.message,5000);
      const sourceMessageId=Number(body.sourceMessageId || body.source_message_id || 0);
      if(!message){
        return res.status(400).json({
          error:'attendance_status_prepare에는 원문 메시지가 필요합니다.',
          code:'OLLI_AGENT_ATTENDANCE_STATUS_MESSAGE_REQUIRED',
        });
      }
      if(!Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0){
        return res.status(400).json({
          error:'attendance_status_prepare에는 저장된 원문 Team Chat message id가 필요합니다.',
          code:'OLLI_AGENT_ATTENDANCE_STATUS_SOURCE_REQUIRED',
        });
      }
      const privacyModule=await import('./_lib/olli-agent/privacy.cjs');
      const prepared=await privacyModule.prepareAgentPrivacyInput(message,requestContext);
      const runtimeModule=await import('./_lib/olli-agent/runtime.cjs');
      const agentContext=contextModule.toAgentRunContext(requestContext);
      const result=await runtimeModule.runAttendanceStatusPrepare({
        agentContext,
        requestContext,
        preparedPrivacy:prepared,
        sourceMessageId,
        sourceMessageText:message,
      });
      return res.status(200).json({
        ok:true,
        mode,
        ready:result?.ready===true,
        message:result?.persistedMessage || null,
        recoveredAfterPersist:result?.recoveredAfterPersist===true,
      });
    }

    if (mode === 'batch_prepare') {
      const message = safeText(body.message, 5000);
      const sourceMessageId = Number(body.sourceMessageId || body.source_message_id || 0);
      const rawCommands = Array.isArray(body.commands) ? body.commands : [];
      if (!message) {
        return res.status(400).json({
          error:'batch_prepare에는 원문 메시지가 필요합니다.',
          code:'OLLI_AGENT_BATCH_MESSAGE_REQUIRED',
        });
      }
      if (!Number.isSafeInteger(sourceMessageId) || sourceMessageId <= 0) {
        return res.status(400).json({
          error:'batch_prepare에는 저장된 원문 Team Chat message id가 필요합니다.',
          code:'OLLI_AGENT_BATCH_SOURCE_MESSAGE_REQUIRED',
        });
      }
      if (rawCommands.length < 2 || rawCommands.length > 3) {
        return res.status(400).json({
          error:'batch_prepare는 한 번에 2개 또는 3개 작업만 지원합니다.',
          code:'OLLI_AGENT_BATCH_COUNT_INVALID',
        });
      }

      const commands = rawCommands.map((item) => ({
        intent:safeText(item?.intent, 80),
        text:safeText(item?.text, 5000),
        reason:safeText(item?.reason, 300),
        reasonMessageId:Number(item?.reasonMessageId || item?.reason_message_id || 0),
        reasonMessageText:safeText(item?.reasonMessageText || item?.reason_message_text, 5000),
        memoNote:safeText(item?.memoNote || item?.memo_note, 5000),
        needsClarification:item?.needsClarification === true,
        contextText:safeText(item?.contextText || item?.context_text, 5000),
        clarificationMessageId:Number(item?.clarificationMessageId || item?.clarification_message_id || 0),
        clarificationMessageText:safeText(item?.clarificationMessageText || item?.clarification_message_text, 5000),
      }));

      const runtimeModule = await import('./_lib/olli-agent/runtime.cjs');
      const agentContext = contextModule.toAgentRunContext(requestContext);
      const result = await runtimeModule.runBatchPrepare({
        agentContext,
        requestContext,
        sourceMessageId,
        sourceMessageText:message,
        commands,
      });
      return res.status(200).json({
        ok:true,
        mode:'batch_prepare',
        ready:result.ready === true,
        messages:Array.isArray(result.messages) ? result.messages : [],
      });
    }

    if (mode === 'privacy_probe' || mode === 'profile_probe' || mode === 'schedule_probe' || mode === 'records_probe' || mode === 'availability_probe' || mode === 'attendance_probe' || mode === 'pickups_probe' || mode === 'memo_prepare_probe' || mode === 'memo_prepare' || mode === 'absence_prepare_probe' || mode === 'absence_prepare' || mode === 'class_once_prepare_probe' || mode === 'class_once_prepare' || mode === 'makeup_prepare_probe' || mode === 'makeup_update_prepare_probe' || mode === 'makeup_update_prepare' || mode === 'makeup_cancel_prepare_probe' || mode === 'makeup_cancel_prepare' || mode === 'makeup_prepare' || mode === 'trial_add_prepare_probe' || mode === 'trial_add_prepare' || mode === 'trial_cancel_prepare_probe' || mode === 'trial_cancel_prepare' || mode === 'trial_update_prepare_probe' || mode === 'trial_update_prepare' || mode === 'waitlist_add_prepare_probe' || mode === 'waitlist_add_prepare' || mode === 'waitlist_update_prepare_probe' || mode === 'waitlist_update_prepare' || mode === 'waitlist_cancel_prepare_probe' || mode === 'waitlist_cancel_prepare' || mode === 'move_prepare_probe' || mode === 'move_prepare' || mode === 'move_cancel_prepare_probe' || mode === 'move_cancel_prepare' || mode === 'pickup_prepare_probe' || mode === 'pickup_update_prepare_probe' || mode === 'pickup_cancel_prepare_probe' || mode === 'pickup_cancel_prepare' || mode === 'pickup_update_prepare' || mode === 'pickup_prepare') {
      const message = safeText(body.message, 5000);
      if (!message) {
        return res.status(400).json({
          error: mode + '에는 확인할 메시지가 필요합니다.',
          code: 'OLLI_AGENT_MESSAGE_REQUIRED',
        });
      }

      let prepared;
      if (mode === 'memo_prepare_probe' || mode === 'memo_prepare') {
        const privacyModule = await import('./_lib/olli-agent/privacy.cjs');
        const memoNote = safeText(body.memoNote || body.memo_note, 5000);
        prepared = await privacyModule.prepareTimetableMemoPrivacyInput(
          message,
          memoNote,
          requestContext
        );
      } else if (mode === 'makeup_cancel_prepare_probe' || mode === 'makeup_cancel_prepare') {
        const privacyModule = await import('./_lib/olli-agent/privacy.cjs');
        const reason = safeText(body.reason, 300);
        prepared = await privacyModule.prepareMakeupCancelPrivacyInput(
          message,
          reason,
          requestContext
        );
      } else if (mode === 'absence_prepare_probe' || mode === 'absence_prepare') {
        const privacyModule = await import('./_lib/olli-agent/privacy.cjs');
        const reason = safeText(body.reason, 300);
        prepared = await privacyModule.prepareAbsencePrivacyInput(
          message,
          reason,
          requestContext
        );
      } else if (mode === 'trial_cancel_prepare_probe' || mode === 'trial_cancel_prepare') {
        const trialPrivacyModule = await import('./_lib/olli-agent/trial-guest-privacy.cjs');
        const reason = safeText(body.reason, 300);
        prepared = trialPrivacyModule.prepareTrialCancelPrivacyInput(message, reason);
      } else if (mode === 'trial_add_prepare_probe' || mode === 'trial_add_prepare' || mode === 'trial_update_prepare_probe' || mode === 'trial_update_prepare') {
        const trialPrivacyModule = await import('./_lib/olli-agent/trial-guest-privacy.cjs');
        prepared = trialPrivacyModule.prepareTrialGuestPrivacyInput(message, requestContext);
      } else if (
        mode === 'waitlist_add_prepare_probe' || mode === 'waitlist_add_prepare' ||
        mode === 'waitlist_update_prepare_probe' || mode === 'waitlist_update_prepare' ||
        mode === 'waitlist_cancel_prepare_probe' || mode === 'waitlist_cancel_prepare'
      ) {
        const privacyModule = await import('./_lib/olli-agent/privacy.cjs');
        prepared = await privacyModule.prepareAgentPrivacyInput(message, requestContext);
        if (!Array.isArray(prepared?.subjectRefs) || prepared.subjectRefs.length === 0) {
          const guestPrivacyModule = await import('./_lib/olli-agent/waitlist-guest-privacy.cjs');
          prepared = guestPrivacyModule.prepareWaitlistGuestPrivacyInput(message);
        }
      } else {
        const privacyModule = await import('./_lib/olli-agent/privacy.cjs');
        prepared = await privacyModule.prepareAgentPrivacyInput(
          message,
          requestContext
        );
      }

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
        const memoNote = safeText(body.memoNote || body.memo_note, 5000);
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
          memoNote,
        });
      } else if (mode === 'memo_prepare') {
        const sourceMessageId = Number(body.sourceMessageId || body.source_message_id || 0);
        const memoNote = safeText(body.memoNote || body.memo_note, 5000);
        if (!Number.isSafeInteger(sourceMessageId) || sourceMessageId <= 0) {
          return res.status(400).json({
            error: 'memo_prepare에는 저장된 원문 Team Chat message id가 필요합니다.',
            code: 'OLLI_AGENT_TIMETABLE_MEMO_SOURCE_MESSAGE_REQUIRED',
          });
        }
        probe = await runtimeModule.runTimetableMemoPrepare({
          agentContext,
          requestContext,
          preparedPrivacy: prepared,
          sourceMessageId,
          sourceMessageText: message,
          memoNote,
        });
        return res.status(200).json({
          ok:true,
          mode:'memo_prepare',
          ready:probe.ready === true,
          message:probe.persistedMessage,
          recoveredAfterPersist:probe.recoveredAfterPersist === true,
        });
      } else if (mode === 'absence_prepare_probe') {
        const requestId=safeText(body.requestId || body.request_id,180);
        const reason=safeText(body.reason,300);
        if(!requestId){
          return res.status(400).json({
            error:'absence_prepare_probe에는 재시도 중복 방지용 requestId가 필요합니다.',
            code:'OLLI_AGENT_REQUEST_ID_REQUIRED',
          });
        }
        if(!reason){
          return res.status(400).json({
            error:'absence_prepare_probe에는 결석 사유가 필요합니다.',
            code:'OLLI_AGENT_ABSENCE_REASON_REQUIRED',
          });
        }
        probe=await runtimeModule.runAbsencePrepareProbe({
          agentContext,
          requestContext,
          preparedPrivacy:prepared,
          requestId,
          reason,
        });
      } else if (mode === 'absence_prepare') {
        const sourceMessageId=Number(body.sourceMessageId || body.source_message_id || 0);
        const reasonMessageId=Number(body.reasonMessageId || body.reason_message_id || 0);
        const reasonMessageText=safeText(body.reasonMessageText || body.reason_message_text,5000);
        const reason=safeText(body.reason,300);
        if(!Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0){
          return res.status(400).json({
            error:'absence_prepare에는 저장된 원문 Team Chat message id가 필요합니다.',
            code:'OLLI_AGENT_ABSENCE_SOURCE_MESSAGE_REQUIRED',
          });
        }
        if(!Number.isSafeInteger(reasonMessageId)||reasonMessageId<=0||!reasonMessageText||!reason){
          return res.status(400).json({
            error:'absence_prepare에는 저장된 결석 사유 메시지와 사유가 필요합니다.',
            code:'OLLI_AGENT_ABSENCE_REASON_MESSAGE_REQUIRED',
          });
        }
        probe=await runtimeModule.runAbsencePrepare({
          agentContext,
          requestContext,
          preparedPrivacy:prepared,
          sourceMessageId,
          sourceMessageText:message,
          reasonMessageId,
          reasonMessageText,
          reason,
        });
        return res.status(200).json({
          ok:true,
          mode:'absence_prepare',
          ready:probe.ready===true,
          message:probe.persistedMessage,
          recoveredAfterPersist:probe.recoveredAfterPersist===true,
        });
      } else if (mode === 'class_once_prepare_probe') {
        const requestId=safeText(body.requestId || body.request_id,160);
        if(!requestId){
          return res.status(400).json({
            error:'class_once_prepare_probe에는 재시도 중복 방지용 requestId가 필요합니다.',
            code:'OLLI_AGENT_REQUEST_ID_REQUIRED',
          });
        }
        probe=await runtimeModule.runClassOncePrepareProbe({
          agentContext,
          requestContext,
          preparedPrivacy:prepared,
          requestId,
        });
      } else if (mode === 'class_once_prepare') {
        const sourceMessageId=Number(body.sourceMessageId || body.source_message_id || 0);
        if(!Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0){
          return res.status(400).json({
            error:'class_once_prepare에는 저장된 원문 Team Chat message id가 필요합니다.',
            code:'OLLI_AGENT_CLASS_ONCE_SOURCE_MESSAGE_REQUIRED',
          });
        }
        probe=await runtimeModule.runClassOncePrepare({
          agentContext,
          requestContext,
          preparedPrivacy:prepared,
          sourceMessageId,
          sourceMessageText:message,
        });
        return res.status(200).json({
          ok:true,
          mode:'class_once_prepare',
          ready:probe.ready===true,
          message:probe.persistedMessage,
          recoveredAfterPersist:probe.recoveredAfterPersist===true,
        });
      } else if (mode === 'makeup_prepare_probe') {
        const requestId = safeText(body.requestId || body.request_id, 160);
        if (!requestId) {
          return res.status(400).json({
            error: 'makeup_prepare_probe에는 재시도 중복 방지용 requestId가 필요합니다.',
            code: 'OLLI_AGENT_REQUEST_ID_REQUIRED',
          });
        }
        probe = await runtimeModule.runMakeupPrepareProbe({
          agentContext,
          requestContext,
          preparedPrivacy: prepared,
          requestId,
        });
      } else if (mode === 'makeup_update_prepare_probe') {
        const requestId = safeText(body.requestId || body.request_id, 160);
        if (!requestId) {
          return res.status(400).json({
            error: 'makeup_update_prepare_probe에는 재시도 중복 방지용 requestId가 필요합니다.',
            code: 'OLLI_AGENT_REQUEST_ID_REQUIRED',
          });
        }
        probe = await runtimeModule.runMakeupUpdatePrepareProbe({
          agentContext,
          requestContext,
          preparedPrivacy: prepared,
          requestId,
        });
      } else if (mode === 'makeup_update_prepare') {
        const sourceMessageId = Number(body.sourceMessageId || body.source_message_id || 0);
        if (!Number.isSafeInteger(sourceMessageId) || sourceMessageId <= 0) {
          return res.status(400).json({
            error: 'makeup_update_prepare에는 저장된 원문 Team Chat message id가 필요합니다.',
            code: 'OLLI_AGENT_MAKEUP_SOURCE_MESSAGE_REQUIRED',
          });
        }
        probe = await runtimeModule.runMakeupUpdatePrepare({
          agentContext,
          requestContext,
          preparedPrivacy: prepared,
          sourceMessageId,
          sourceMessageText: message,
        });
        return res.status(200).json({
          ok:true,
          mode:'makeup_update_prepare',
          ready:probe.ready === true,
          message:probe.persistedMessage,
          recoveredAfterPersist:probe.recoveredAfterPersist === true,
        });
      } else if (mode === 'makeup_cancel_prepare_probe') {
        const requestId = safeText(body.requestId || body.request_id, 180);
        const reason = safeText(body.reason, 300);
        if (!requestId) {
          return res.status(400).json({
            error: 'makeup_cancel_prepare_probe에는 재시도 중복 방지용 requestId가 필요합니다.',
            code: 'OLLI_AGENT_REQUEST_ID_REQUIRED',
          });
        }
        if (!reason) {
          return res.status(400).json({
            error: 'makeup_cancel_prepare_probe에는 보강 취소 사유가 필요합니다.',
            code: 'OLLI_AGENT_MAKEUP_CANCEL_REASON_REQUIRED',
          });
        }
        probe = await runtimeModule.runMakeupCancelPrepareProbe({
          agentContext,
          requestContext,
          preparedPrivacy: prepared,
          requestId,
          reason,
        });
      } else if (mode === 'makeup_cancel_prepare') {
        const sourceMessageId = Number(body.sourceMessageId || body.source_message_id || 0);
        const reasonMessageId = Number(body.reasonMessageId || body.reason_message_id || 0);
        const reasonMessageText = safeText(body.reasonMessageText || body.reason_message_text, 5000);
        const reason = safeText(body.reason, 300);
        if (!Number.isSafeInteger(sourceMessageId) || sourceMessageId <= 0) {
          return res.status(400).json({
            error: 'makeup_cancel_prepare에는 저장된 원문 Team Chat message id가 필요합니다.',
            code: 'OLLI_AGENT_MAKEUP_SOURCE_MESSAGE_REQUIRED',
          });
        }
        if (!Number.isSafeInteger(reasonMessageId) || reasonMessageId <= 0 || !reasonMessageText || !reason) {
          return res.status(400).json({
            error: 'makeup_cancel_prepare에는 저장된 보강 취소 사유 메시지와 사유가 필요합니다.',
            code: 'OLLI_AGENT_MAKEUP_REASON_MESSAGE_REQUIRED',
          });
        }
        probe = await runtimeModule.runMakeupCancelPrepare({
          agentContext,
          requestContext,
          preparedPrivacy: prepared,
          sourceMessageId,
          sourceMessageText: message,
          reasonMessageId,
          reasonMessageText,
          reason,
        });
        return res.status(200).json({
          ok:true,
          mode:'makeup_cancel_prepare',
          ready:probe.ready === true,
          message:probe.persistedMessage,
          recoveredAfterPersist:probe.recoveredAfterPersist === true,
        });
      } else if (mode === 'makeup_prepare') {
        const sourceMessageId = Number(body.sourceMessageId || body.source_message_id || 0);
        if (!Number.isSafeInteger(sourceMessageId) || sourceMessageId <= 0) {
          return res.status(400).json({
            error: 'makeup_prepare에는 저장된 원문 Team Chat message id가 필요합니다.',
            code: 'OLLI_AGENT_MAKEUP_SOURCE_MESSAGE_REQUIRED',
          });
        }
        probe = await runtimeModule.runMakeupPrepare({
          agentContext,
          requestContext,
          preparedPrivacy: prepared,
          sourceMessageId,
          sourceMessageText: message,
        });
        return res.status(200).json({
          ok:true,
          mode:'makeup_prepare',
          ready:probe.ready === true,
          message:probe.persistedMessage,
          recoveredAfterPersist:probe.recoveredAfterPersist === true,
        });
      } else if (mode === 'trial_add_prepare_probe') {
        const requestId=safeText(body.requestId || body.request_id,160);
        if(!requestId){
          return res.status(400).json({
            error:'trial_add_prepare_probe에는 재시도 중복 방지용 requestId가 필요합니다.',
            code:'OLLI_AGENT_REQUEST_ID_REQUIRED',
          });
        }
        probe=await runtimeModule.runTrialAddPrepareProbe({
          agentContext,
          requestContext,
          preparedPrivacy:prepared,
          requestId,
        });
      } else if (mode === 'trial_add_prepare') {
        const sourceMessageId=Number(body.sourceMessageId || body.source_message_id || 0);
        if(!Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0){
          return res.status(400).json({
            error:'trial_add_prepare에는 저장된 원문 Team Chat message id가 필요합니다.',
            code:'OLLI_AGENT_TRIAL_SOURCE_MESSAGE_REQUIRED',
          });
        }
        probe=await runtimeModule.runTrialAddPrepare({
          agentContext,
          requestContext,
          preparedPrivacy:prepared,
          sourceMessageId,
          sourceMessageText:message,
        });
        return res.status(200).json({
          ok:true,
          mode:'trial_add_prepare',
          ready:probe.ready===true,
          message:probe.persistedMessage,
          recoveredAfterPersist:probe.recoveredAfterPersist===true,
        });
      } else if (mode === 'trial_cancel_prepare_probe') {
        const requestId=safeText(body.requestId || body.request_id,200);
        const reason=safeText(body.reason,300);
        if(!requestId){
          return res.status(400).json({
            error:'trial_cancel_prepare_probe에는 재시도 중복 방지용 requestId가 필요합니다.',
            code:'OLLI_AGENT_REQUEST_ID_REQUIRED',
          });
        }
        if(!reason){
          return res.status(400).json({
            error:'trial_cancel_prepare_probe에는 체험 취소 사유가 필요합니다.',
            code:'OLLI_AGENT_TRIAL_CANCEL_REASON_REQUIRED',
          });
        }
        probe=await runtimeModule.runTrialCancelPrepareProbe({
          agentContext,
          requestContext,
          preparedPrivacy:prepared,
          requestId,
          reason,
        });
      } else if (mode === 'trial_cancel_prepare') {
        const sourceMessageId=Number(body.sourceMessageId || body.source_message_id || 0);
        const reasonMessageId=Number(body.reasonMessageId || body.reason_message_id || 0);
        const reasonMessageText=safeText(body.reasonMessageText || body.reason_message_text,5000);
        const reason=safeText(body.reason,300);
        if(!Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0){
          return res.status(400).json({
            error:'trial_cancel_prepare에는 저장된 원문 Team Chat message id가 필요합니다.',
            code:'OLLI_AGENT_TRIAL_SOURCE_MESSAGE_REQUIRED',
          });
        }
        if(!Number.isSafeInteger(reasonMessageId)||reasonMessageId<=0||!reasonMessageText||!reason){
          return res.status(400).json({
            error:'trial_cancel_prepare에는 저장된 체험 취소 사유 메시지와 사유가 필요합니다.',
            code:'OLLI_AGENT_TRIAL_REASON_MESSAGE_REQUIRED',
          });
        }
        probe=await runtimeModule.runTrialCancelPrepare({
          agentContext,
          requestContext,
          preparedPrivacy:prepared,
          sourceMessageId,
          sourceMessageText:message,
          reasonMessageId,
          reasonMessageText,
          reason,
        });
        return res.status(200).json({
          ok:true,
          mode:'trial_cancel_prepare',
          ready:probe.ready===true,
          message:probe.persistedMessage,
          recoveredAfterPersist:probe.recoveredAfterPersist===true,
        });
      } else if (mode === 'trial_update_prepare_probe') {
        const requestId=safeText(body.requestId || body.request_id,160);
        if(!requestId){
          return res.status(400).json({
            error:'trial_update_prepare_probe에는 재시도 중복 방지용 requestId가 필요합니다.',
            code:'OLLI_AGENT_REQUEST_ID_REQUIRED',
          });
        }
        probe=await runtimeModule.runTrialUpdatePrepareProbe({
          agentContext,
          requestContext,
          preparedPrivacy:prepared,
          requestId,
        });
      } else if (mode === 'trial_update_prepare') {
        const sourceMessageId=Number(body.sourceMessageId || body.source_message_id || 0);
        if(!Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0){
          return res.status(400).json({
            error:'trial_update_prepare에는 저장된 원문 Team Chat message id가 필요합니다.',
            code:'OLLI_AGENT_TRIAL_SOURCE_MESSAGE_REQUIRED',
          });
        }
        probe=await runtimeModule.runTrialUpdatePrepare({
          agentContext,
          requestContext,
          preparedPrivacy:prepared,
          sourceMessageId,
          sourceMessageText:message,
        });
        return res.status(200).json({
          ok:true,
          mode:'trial_update_prepare',
          ready:probe.ready===true,
          message:probe.persistedMessage,
          recoveredAfterPersist:probe.recoveredAfterPersist===true,
        });
      } else if (mode === 'waitlist_add_prepare_probe') {
        const requestId=safeText(body.requestId || body.request_id,160);
        if(!requestId){
          return res.status(400).json({
            error:'waitlist_add_prepare_probe에는 재시도 중복 방지용 requestId가 필요합니다.',
            code:'OLLI_AGENT_REQUEST_ID_REQUIRED',
          });
        }
        probe=await runtimeModule.runWaitlistAddPrepareProbe({
          agentContext,
          requestContext,
          preparedPrivacy:prepared,
          requestId,
        });
      } else if (mode === 'waitlist_add_prepare') {
        const sourceMessageId=Number(body.sourceMessageId || body.source_message_id || 0);
        if(!Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0){
          return res.status(400).json({
            error:'waitlist_add_prepare에는 저장된 원문 Team Chat message id가 필요합니다.',
            code:'OLLI_AGENT_WAITLIST_SOURCE_MESSAGE_REQUIRED',
          });
        }
        probe=await runtimeModule.runWaitlistAddPrepare({
          agentContext,
          requestContext,
          preparedPrivacy:prepared,
          sourceMessageId,
          sourceMessageText:message,
        });
        return res.status(200).json({
          ok:true,
          mode:'waitlist_add_prepare',
          ready:probe.ready===true,
          message:probe.persistedMessage,
          recoveredAfterPersist:probe.recoveredAfterPersist===true,
        });
      } else if (mode === 'waitlist_update_prepare_probe') {
        const requestId=safeText(body.requestId || body.request_id,160);
        if(!requestId){
          return res.status(400).json({
            error:'waitlist_update_prepare_probe에는 재시도 중복 방지용 requestId가 필요합니다.',
            code:'OLLI_AGENT_REQUEST_ID_REQUIRED',
          });
        }
        probe=await runtimeModule.runWaitlistUpdatePrepareProbe({
          agentContext,
          requestContext,
          preparedPrivacy:prepared,
          requestId,
        });
      } else if (mode === 'waitlist_update_prepare') {
        const sourceMessageId=Number(body.sourceMessageId || body.source_message_id || 0);
        if(!Number.isSafeInteger(sourceMessageId) || sourceMessageId<=0){
          return res.status(400).json({
            error:'waitlist_update_prepare에는 저장된 원문 Team Chat message id가 필요합니다.',
            code:'OLLI_AGENT_WAITLIST_SOURCE_MESSAGE_REQUIRED',
          });
        }
        probe=await runtimeModule.runWaitlistUpdatePrepare({
          agentContext,
          requestContext,
          preparedPrivacy:prepared,
          sourceMessageId,
          sourceMessageText:message,
        });
        return res.status(200).json({
          ok:true,
          mode:'waitlist_update_prepare',
          ready:probe.ready === true,
          message:probe.persistedMessage,
          recoveredAfterPersist:probe.recoveredAfterPersist === true,
        });
      } else if (mode === 'waitlist_cancel_prepare_probe') {
        const requestId = safeText(body.requestId || body.request_id, 160);
        if (!requestId) {
          return res.status(400).json({
            error: 'waitlist_cancel_prepare_probe에는 재시도 중복 방지용 requestId가 필요합니다.',
            code: 'OLLI_AGENT_REQUEST_ID_REQUIRED',
          });
        }
        probe = await runtimeModule.runWaitlistCancelPrepareProbe({
          agentContext,
          requestContext,
          preparedPrivacy: prepared,
          requestId,
        });
      } else if (mode === 'waitlist_cancel_prepare') {
        const sourceMessageId = Number(body.sourceMessageId || body.source_message_id || 0);
        if (!Number.isSafeInteger(sourceMessageId) || sourceMessageId <= 0) {
          return res.status(400).json({
            error: 'waitlist_cancel_prepare에는 저장된 원문 Team Chat message id가 필요합니다.',
            code: 'OLLI_AGENT_WAITLIST_SOURCE_MESSAGE_REQUIRED',
          });
        }
        probe = await runtimeModule.runWaitlistCancelPrepare({
          agentContext,
          requestContext,
          preparedPrivacy: prepared,
          sourceMessageId,
          sourceMessageText: message,
        });
        return res.status(200).json({
          ok:true,
          mode:'waitlist_cancel_prepare',
          ready:probe.ready === true,
          message:probe.persistedMessage,
          recoveredAfterPersist:probe.recoveredAfterPersist === true,
        });
      } else if (mode === 'move_prepare_probe') {
        const requestId=safeText(body.requestId || body.request_id,160);
        if(!requestId){
          return res.status(400).json({
            error:'move_prepare_probe에는 재시도 중복 방지용 requestId가 필요합니다.',
            code:'OLLI_AGENT_REQUEST_ID_REQUIRED',
          });
        }
        probe=await runtimeModule.runMovePrepareProbe({
          agentContext,
          requestContext,
          preparedPrivacy:prepared,
          requestId,
        });
      } else if (mode === 'move_prepare') {
        const sourceMessageId=Number(body.sourceMessageId || body.source_message_id || 0);
        if(!Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0){
          return res.status(400).json({
            error:'move_prepare에는 저장된 원문 Team Chat message id가 필요합니다.',
            code:'OLLI_AGENT_MOVE_SOURCE_MESSAGE_REQUIRED',
          });
        }
        probe=await runtimeModule.runMovePrepare({
          agentContext,
          requestContext,
          preparedPrivacy:prepared,
          sourceMessageId,
          sourceMessageText:message,
        });
        return res.status(200).json({
          ok:true,
          mode:'move_prepare',
          ready:probe.ready===true,
          message:probe.persistedMessage,
          recoveredAfterPersist:probe.recoveredAfterPersist===true,
        });
      } else if (mode === 'move_cancel_prepare_probe') {
        const requestId=safeText(body.requestId || body.request_id,160);
        if(!requestId){
          return res.status(400).json({
            error:'move_cancel_prepare_probe에는 재시도 중복 방지용 requestId가 필요합니다.',
            code:'OLLI_AGENT_REQUEST_ID_REQUIRED',
          });
        }
        probe=await runtimeModule.runMoveCancelPrepareProbe({
          agentContext,
          requestContext,
          preparedPrivacy:prepared,
          requestId,
        });
      } else if (mode === 'move_cancel_prepare') {
        const sourceMessageId=Number(body.sourceMessageId || body.source_message_id || 0);
        if(!Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0){
          return res.status(400).json({
            error:'move_cancel_prepare에는 저장된 원문 Team Chat message id가 필요합니다.',
            code:'OLLI_AGENT_MOVE_SOURCE_MESSAGE_REQUIRED',
          });
        }
        probe=await runtimeModule.runMoveCancelPrepare({
          agentContext,
          requestContext,
          preparedPrivacy:prepared,
          sourceMessageId,
          sourceMessageText:message,
        });
        return res.status(200).json({
          ok:true,
          mode:'move_cancel_prepare',
          ready:probe.ready===true,
          message:probe.persistedMessage,
          recoveredAfterPersist:probe.recoveredAfterPersist===true,
        });
      } else if (mode === 'pickup_prepare_probe') {
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
      } else if (mode === 'pickup_update_prepare_probe') {
        const requestId = safeText(body.requestId || body.request_id, 160);
        if (!requestId) {
          return res.status(400).json({
            error: 'pickup_update_prepare_probe에는 재시도 중복 방지용 requestId가 필요합니다.',
            code: 'OLLI_AGENT_REQUEST_ID_REQUIRED',
          });
        }
        probe = await runtimeModule.runPickupUpdatePrepareProbe({
          agentContext,
          requestContext,
          preparedPrivacy: prepared,
          requestId,
        });
      } else if (mode === 'pickup_cancel_prepare_probe') {
        const requestId = safeText(body.requestId || body.request_id, 160);
        if (!requestId) {
          return res.status(400).json({
            error: 'pickup_cancel_prepare_probe에는 재시도 중복 방지용 requestId가 필요합니다.',
            code: 'OLLI_AGENT_REQUEST_ID_REQUIRED',
          });
        }
        probe = await runtimeModule.runPickupCancelPrepareProbe({
          agentContext,
          requestContext,
          preparedPrivacy: prepared,
          requestId,
        });
      } else if (mode === 'pickup_cancel_prepare') {
        const sourceMessageId = Number(body.sourceMessageId || body.source_message_id || 0);
        if (!Number.isSafeInteger(sourceMessageId) || sourceMessageId <= 0) {
          return res.status(400).json({
            error: 'pickup_cancel_prepare에는 저장된 원문 Team Chat message id가 필요합니다.',
            code: 'OLLI_AGENT_PICKUP_SOURCE_MESSAGE_REQUIRED',
          });
        }
        probe = await runtimeModule.runPickupCancelPrepare({
          agentContext,
          requestContext,
          preparedPrivacy: prepared,
          sourceMessageId,
          sourceMessageText: message,
        });
        return res.status(200).json({
          ok:true,
          mode:'pickup_cancel_prepare',
          ready:probe.ready === true,
          message:probe.persistedMessage,
          recoveredAfterPersist:probe.recoveredAfterPersist === true,
        });
      } else if (mode === 'pickup_update_prepare') {
        const sourceMessageId = Number(body.sourceMessageId || body.source_message_id || 0);
        if (!Number.isSafeInteger(sourceMessageId) || sourceMessageId <= 0) {
          return res.status(400).json({
            error: 'pickup_update_prepare에는 저장된 원문 Team Chat message id가 필요합니다.',
            code: 'OLLI_AGENT_PICKUP_SOURCE_MESSAGE_REQUIRED',
          });
        }
        probe = await runtimeModule.runPickupUpdatePrepare({
          agentContext,
          requestContext,
          preparedPrivacy: prepared,
          sourceMessageId,
          sourceMessageText: message,
        });
        return res.status(200).json({
          ok:true,
          mode:'pickup_update_prepare',
          ready:probe.ready === true,
          message:probe.persistedMessage,
          recoveredAfterPersist:probe.recoveredAfterPersist === true,
        });
      } else {
        const sourceMessageId = Number(body.sourceMessageId || body.source_message_id || 0);
        if (!Number.isSafeInteger(sourceMessageId) || sourceMessageId <= 0) {
          return res.status(400).json({
            error: 'pickup_prepare에는 저장된 원문 Team Chat message id가 필요합니다.',
            code: 'OLLI_AGENT_PICKUP_SOURCE_MESSAGE_REQUIRED',
          });
        }
        probe = await runtimeModule.runPickupPrepare({
          agentContext,
          requestContext,
          preparedPrivacy: prepared,
          sourceMessageId,
          sourceMessageText: message,
        });
        return res.status(200).json({
          ok:true,
          mode:'pickup_prepare',
          ready:probe.ready === true,
          message:probe.persistedMessage,
          recoveredAfterPersist:probe.recoveredAfterPersist === true,
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
