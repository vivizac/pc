(function timetableTeacherUiCompact(global) {
  'use strict';
  if (global.__OLLI_TIMETABLE_TEACHER_UI_COMPACT_V1__) return;
  global.__OLLI_TIMETABLE_TEACHER_UI_COMPACT_V1__ = true;

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function cssEscape(value) {
    const raw = clean(value);
    try {
      if (global.CSS && typeof global.CSS.escape === 'function') return global.CSS.escape(raw);
    } catch (_) {}
    return raw.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
  }

  function selectedTeacherLabel(grid) {
    const active = grid && grid.querySelector('[data-tt-class-teacher].active');
    return clean(active && active.textContent) || '미지정';
  }

  function enhanceTeacherPicker(dialog) {
    dialog.querySelectorAll('.olliTtTeacherChoiceGrid').forEach((grid) => {
      if (grid.closest('.olliTtTeacherPickerCompact')) return;

      const picker = document.createElement('div');
      picker.className = 'olliTtTeacherPickerCompact';

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'olliTtTeacherPickerToggle';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.innerHTML = `<span>담임 선택</span><strong>${selectedTeacherLabel(grid)}</strong><span class="olliTtTeacherPickerArrow" aria-hidden="true">⌄</span>`;

      grid.parentNode.insertBefore(picker, grid);
      picker.appendChild(toggle);
      picker.appendChild(grid);
      grid.classList.add('olliTtTeacherChoiceCollapsed');

      toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
        picker.classList.toggle('open', !open);
        grid.classList.toggle('olliTtTeacherChoiceCollapsed', open);
      });
    });
  }

  function teacherLabelFromEnrollment(enrollmentId) {
    const id = clean(enrollmentId);
    if (!id) return '';
    const entry = document.querySelector(`#olliTtRoot .olliTtStudentMore[data-enrollment-id="${cssEscape(id)}"]`);
    if (!entry) return '';

    const lane = entry.closest('.olliTtClassLane');
    const cell = entry.closest('.olliTtCell');
    let label = '';

    if (lane) {
      const head = lane.querySelector('.olliTtClassLaneHead strong');
      label = clean(head && head.textContent);
    } else if (cell) {
      const head = cell.querySelector('.olliTtMergedClassHead strong');
      label = clean(head && head.textContent);
    }

    // 반 이름(A반/B반)은 담임명이 아니므로 제외합니다.
    return /T$/i.test(label) ? label : '';
  }

  function removeLegacyTeacherFieldFromStudentDialog(dialog) {
    if (!dialog.querySelector('.olliTtModeCards')) return;
    dialog.querySelectorAll('.olliTtField').forEach((field) => {
      const title = clean(field.querySelector('.olliTtFieldHead > span') && field.querySelector('.olliTtFieldHead > span').textContent);
      if (title === '담임' && !field.closest('.olliTtModeCard')) field.remove();
    });
  }

  function inlineTeacherIntoRegularLessons(dialog) {
    if (!dialog.querySelector('.olliTtModeCards')) return;

    dialog.querySelectorAll('.olliTtModeCard.move .olliTtEnrollmentRow').forEach((row) => {
      const source = row.querySelector('[data-tt-source]');
      const strong = source && source.querySelector('strong');
      const enrollmentId = clean(source && source.dataset.ttSource);
      if (!strong || !enrollmentId || strong.dataset.olliTeacherInline === '1') return;

      const teacher = teacherLabelFromEnrollment(enrollmentId);
      if (teacher && !clean(strong.textContent).includes(teacher)) {
        strong.textContent = `${clean(strong.textContent)} · ${teacher}`;
      }
      strong.dataset.olliTeacherInline = '1';
    });
  }

  function enhance() {
    const dialog = document.getElementById('olliTtDialog');
    if (!dialog) return;
    enhanceTeacherPicker(dialog);
    removeLegacyTeacherFieldFromStudentDialog(dialog);
    inlineTeacherIntoRegularLessons(dialog);
  }

  if (!document.getElementById('olliTtTeacherUiCompactStyle')) {
    const style = document.createElement('style');
    style.id = 'olliTtTeacherUiCompactStyle';
    style.textContent = `
      .olliTtTeacherPickerCompact{width:100%;margin-top:2px;}
      .olliTtTeacherPickerToggle{width:100%;min-height:42px;border:1px solid rgba(0,0,0,.08);border-radius:12px;background:#f7f7f8;padding:0 12px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:9px;color:#777;font:inherit;cursor:pointer;text-align:left;}
      .olliTtTeacherPickerToggle>span:first-child{font-size:12px;font-weight:700;white-space:nowrap;}
      .olliTtTeacherPickerToggle strong{min-width:0;color:#111;font-size:13px;font-weight:800;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .olliTtTeacherPickerArrow{font-size:16px;line-height:1;color:#999;transition:transform .16s ease;}
      .olliTtTeacherPickerCompact.open .olliTtTeacherPickerArrow{transform:rotate(180deg);}
      .olliTtTeacherPickerCompact .olliTtTeacherChoiceGrid{margin-top:8px;}
      .olliTtTeacherPickerCompact .olliTtTeacherChoiceGrid.olliTtTeacherChoiceCollapsed{display:none!important;}
      .olliTtModeCard.move .olliTtEnrollmentChoice strong{white-space:normal;line-height:1.35;}
    `;
    document.head.appendChild(style);
  }

  let timer = 0;
  function queueEnhance() {
    clearTimeout(timer);
    timer = setTimeout(enhance, 0);
  }

  const observer = new MutationObserver(queueEnhance);
  const start = () => {
    observer.observe(document.body, { childList: true, subtree: true });
    queueEnhance();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})(window);
