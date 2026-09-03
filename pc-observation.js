(function pcObservationModule(global) {
  'use strict';

  function core() { return global.OlliPcCore; }

  function studentCubeSvg() {
    return '<svg viewBox="0 0 24 24"><path d="M12 3l7 4v10l-7 4-7-4V7l7-4z"></path><path d="M5 7l7 4 7-4M12 11v10"></path></svg>';
  }

  function rosterInfoSvg() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.45"></circle><circle cx="12" cy="12" r="1.45"></circle><circle cx="18" cy="12" r="1.45"></circle></svg>';
  }

  function metaText(student, type) {
    try {
      const bits = type === 'kinder'
        ? (typeof getKinderMetaBits === 'function' ? getKinderMetaBits(student) : [])
        : (typeof getElementaryMetaBits === 'function' ? getElementaryMetaBits(student) : []);
      return Array.isArray(bits) ? bits.join(' / ') : '';
    } catch (_) { return ''; }
  }

  function escapeText(value) {
    return typeof escapeHtml === 'function' ? escapeHtml(value || '') : String(value || '');
  }

  function rosterHtml(students, type, mode) {
    return students.map((student) => {
      const studentId = String(student.id || '');
      const escapedId = studentId.replace(/'/g, "\\'");
      const active = mode === 'observation' && global.currentMemoStudent && String(global.currentMemoStudent.id || '') === studentId;
      return '<div class="olliPcRosterBtn'+(active ? ' active' : '')+'" data-pc-student-id="'+studentId.replace(/"/g, '&quot;')+'" onclick="pcSelectRosterStudent(\''+escapedId+'\',\''+mode+'\')">'
        + '<span class="olliPcRosterIcon">'+studentCubeSvg()+'</span>'
        + '<span><div class="olliPcRosterName">'+escapeText(student.name)+'</div>'
        + '<div class="olliPcRosterMeta">'+escapeText(metaText(student, type))+'</div></span>'
        + '<button type="button" class="olliPcRosterInfoBtn" aria-label="학생정보" title="학생정보" onclick="pcOpenRosterStudentInfo(\''+escapedId+'\', event)">'+rosterInfoSvg()+'</button>'
        + '</div>';
    }).join('');
  }

  function renderContext(elementary, kinder) {
    const feedbackMode = core().state.observationTab === 'feedback';
    const list = feedbackMode ? kinder : elementary;
    const type = feedbackMode ? 'kinder' : 'elementary';
    const title = document.getElementById('olliPcContextTitle');
    const body = document.getElementById('olliPcContextBody');
    if (!title || !body) return;
    title.textContent = (feedbackMode ? '유치부 명단 ' : '초등부 명단 ') + list.length;
    body.innerHTML = rosterHtml(list, type, feedbackMode ? 'feedback' : 'observation');
  }

  function renderTopbar(title) {
    const observationActive = core().state.observationTab !== 'feedback';
    title.innerHTML = '<div class="olliPcTopbarTabs" role="tablist" aria-label="관찰노트 보기">'
      + '<button type="button" class="olliPcTopbarTab '+(observationActive ? 'active' : '')+'" role="tab" aria-selected="'+String(observationActive)+'" onclick="pcSetObservationTab(\'observation\')">관찰노트</button>'
      + '<button type="button" class="olliPcTopbarTab '+(!observationActive ? 'active' : '')+'" role="tab" aria-selected="'+String(!observationActive)+'" onclick="pcSetObservationTab(\'feedback\')">1분 피드백</button>'
      + '</div>';
  }

  async function open() {
    const app = core();
    if (app.state.observationTab === 'feedback') {
      if (typeof openKinderChatFeedbackPage === 'function') openKinderChatFeedbackPage();
      app.renderContext();
      return;
    }
    app.hideMainScreensExcept('studentMemoScreen');
    const students = app.activeStudents('elementary');
    const target = global.currentMemoStudent && global.currentMemoStudent.type === 'elementary' ? global.currentMemoStudent : students[0];
    if (target && typeof openStudentMemoPageById === 'function') openStudentMemoPageById(target.id);
    app.renderContext();
  }

  function openStudentInfo(studentId, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (typeof openKinderChatFeedbackStudentInfoFromManage === 'function') {
      openKinderChatFeedbackStudentInfoFromManage(studentId, null);
      return;
    }
    const student = typeof findStudentById === 'function' ? findStudentById(studentId) : null;
    if (!student) return;
    try { studentInfoModalTarget = student; } catch (_) {}
    if ((student.type || 'kinder') === 'elementary') {
      if (typeof openElementaryInfoModal === 'function') openElementaryInfoModal();
    } else if (typeof openKinderInfoModal === 'function') openKinderInfoModal();
  }

  function openSidebarSort(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const view = core().state.observationTab === 'feedback' ? 'kinder' : 'elementary';
    const popup = document.getElementById('recordSortPopup');
    const bottom = document.querySelector('#olliPcShell .olliPcSidebarBottom');
    if (!popup || !bottom) return;
    if (popup.parentElement !== bottom) bottom.appendChild(popup);
    if (typeof global.refreshRecordSortPopup === 'function') global.refreshRecordSortPopup(view);
    popup.classList.toggle('show');
  }

  function refreshRoster() {
    if (core().state.section === 'observation') core().renderContext();
  }

  function selectStudent(studentId, mode) {
    if (mode === 'observation') {
      const openMemo = typeof global.openStudentMemoPageById === 'function'
        ? global.openStudentMemoPageById
        : (typeof openStudentMemoPageById === 'function' ? openStudentMemoPageById : null);
      if (!openMemo) {
        if (typeof showPushToast === 'function') showPushToast('관찰노트를 여는 기능을 찾지 못했어요.');
        return;
      }
      openMemo(studentId);
      requestAnimationFrame(() => core().renderContext());
      return;
    }
    try {
      if (typeof global.selectKinderChatFeedbackStudentFromManage === 'function') global.selectKinderChatFeedbackStudentFromManage(studentId, null);
      else {
        const student = typeof findStudentById === 'function' ? findStudentById(studentId) : null;
        const input = document.getElementById('kcfInput');
        if (student && input) {
          input.value = (student.name || '') + '\n';
          input.focus();
        }
      }
    } catch (_) {}
    setTimeout(() => core().renderContext(), 0);
  }

  function openArchive() {
    if (core().state.section !== 'observation') return;
    if (core().state.observationTab === 'feedback') {
      if (typeof openKinderChatFeedbackInbox === 'function') openKinderChatFeedbackInbox();
      return;
    }
    document.getElementById('memoRecordsBtn')?.click();
  }

  const api = { studentCubeSvg, metaText, rosterHtml, renderContext, renderTopbar, open, openStudentInfo, openSidebarSort, refreshRoster, selectStudent, openArchive };
  global.OlliPcObservationNote = api;
  // 기존 route key와 외부 호출은 호환 별칭으로 유지합니다.
  global.OlliPcObservation = api;
})(window);
