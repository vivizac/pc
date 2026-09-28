from pathlib import Path
import re

# 1) PC 성향기록부 상단 검색: 한글 조합 중에도 즉시 이름 매칭
p = Path('pc-attendance.js')
s = p.read_text(encoding='utf-8')
if 'function normalizePcAttendanceSearchText' not in s:
    pattern = r"(  function studentMatchesDay\(student, day\) \{.*?\n  \}\n\n)(  function renderContext)"
    helper = r'''\1  function normalizePcAttendanceSearchText(value) {
    const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
    const JUNG = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
    const JONG = ['', 'ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
    const text = String(value || '').trim().normalize('NFC').toLowerCase();
    let out = '';
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      if (code >= 0xAC00 && code <= 0xD7A3) {
        const index = code - 0xAC00;
        const cho = Math.floor(index / 588);
        const jung = Math.floor((index % 588) / 28);
        const jong = index % 28;
        out += (CHO[cho] || '') + (JUNG[jung] || '') + (JONG[jong] || '');
      } else if (code >= 0x1100 && code <= 0x1112) {
        out += CHO[code - 0x1100] || ch;
      } else if (code >= 0x1161 && code <= 0x1175) {
        out += JUNG[code - 0x1161] || ch;
      } else if (code >= 0x11A8 && code <= 0x11C2) {
        out += JONG[code - 0x11A7] || ch;
      } else {
        out += ch;
      }
    }
    return out.replace(/\s+/g, '');
  }

  function studentMatchesPcAttendanceSearch(student, query) {
    const q = String(query || '').trim();
    if (!q) return true;
    const name = String(student?.name || '').trim();
    if (!name) return false;
    if (name.toLowerCase().includes(q.toLowerCase())) return true;
    const normalizedName = normalizePcAttendanceSearchText(name);
    const normalizedQuery = normalizePcAttendanceSearchText(q);
    return !!normalizedQuery && normalizedName.includes(normalizedQuery);
  }

\2'''
    s, count = re.subn(pattern, helper, s, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'pc-attendance helper insertion count={count}')
old1 = "const elementary = app.activeStudents('elementary').filter((student) => studentMatchesDay(student, app.state.attendanceDay) && (!query || String(student.name || '').includes(query)));"
old2 = "const kinder = app.activeStudents('kinder').filter((student) => studentMatchesDay(student, app.state.attendanceDay) && (!query || String(student.name || '').includes(query)));"
if old1 in s:
    s = s.replace(old1, "const elementary = app.activeStudents('elementary').filter((student) => studentMatchesDay(student, app.state.attendanceDay) && studentMatchesPcAttendanceSearch(student, query));", 1)
if old2 in s:
    s = s.replace(old2, "const kinder = app.activeStudents('kinder').filter((student) => studentMatchesDay(student, app.state.attendanceDay) && studentMatchesPcAttendanceSearch(student, query));", 1)
if 'studentMatchesPcAttendanceSearch(student, query)' not in s:
    raise RuntimeError('pc attendance search matcher was not applied')
p.write_text(s, encoding='utf-8')

# 2) PC 상단 검색창: IME 조합 이벤트에도 즉시 반영 + visualViewport 위치 고정
p = Path('pc-shell.js')
s = p.read_text(encoding='utf-8')
if 'function bindPcTopSearchStability' not in s:
    target = """  function handleTopSearch(value) {
    if (Object.prototype.hasOwnProperty.call(state.searchValues, state.section)) state.searchValues[state.section] = String(value || '');
    if (state.section === SECTION.PERSONALITY_RECORDS) return personalityRecordsFeature()?.renderList(value);
    if (state.section === 'academy') return feature('OlliPcStudentManagement')?.handleSearch(value);
  }
"""
    insert = target + """

  function syncPcTopSearchVisualViewport() {
    const input = document.getElementById('olliPcSearch');
    const topbar = document.getElementById('olliPcTopbar');
    if (!topbar) return;
    const viewport = window.visualViewport;
    if (!viewport || document.activeElement !== input) {
      topbar.style.removeProperty('top');
      return;
    }
    const offsetTop = Math.max(0, Math.round(Number(viewport.offsetTop || 0)));
    topbar.style.top = offsetTop + 'px';
  }

  function bindPcTopSearchStability() {
    const input = document.getElementById('olliPcSearch');
    if (!input || input.dataset.pcSearchStableBound === '1') return;
    input.dataset.pcSearchStableBound = '1';
    let compositionTimer = null;
    const flushCompositionSearch = () => {
      clearTimeout(compositionTimer);
      compositionTimer = setTimeout(() => handleTopSearch(input.value), 0);
    };
    input.addEventListener('compositionupdate', flushCompositionSearch);
    input.addEventListener('compositionend', flushCompositionSearch);
    input.addEventListener('focus', () => {
      syncPcTopSearchVisualViewport();
      setTimeout(syncPcTopSearchVisualViewport, 60);
      setTimeout(syncPcTopSearchVisualViewport, 180);
      setTimeout(syncPcTopSearchVisualViewport, 320);
    });
    input.addEventListener('blur', () => {
      setTimeout(syncPcTopSearchVisualViewport, 80);
      setTimeout(syncPcTopSearchVisualViewport, 260);
    });
    if (window.visualViewport && !window.__olliPcTopSearchViewportBound) {
      window.__olliPcTopSearchViewportBound = true;
      window.visualViewport.addEventListener('resize', syncPcTopSearchVisualViewport);
      window.visualViewport.addEventListener('scroll', syncPcTopSearchVisualViewport);
    }
  }

  document.addEventListener('DOMContentLoaded', bindPcTopSearchStability);
  setTimeout(bindPcTopSearchStability, 0);
"""
    if target not in s:
        raise RuntimeError('pc-shell handleTopSearch target not found')
    s = s.replace(target, insert, 1)
p.write_text(s, encoding='utf-8')

# 3) 기존 하단 검색창도 키보드 높이 계산이 흔들리지 않도록 안정화
p = Path('olli-record-search-controls.js')
s = p.read_text(encoding='utf-8')
old = """function getRecordKeyboardOffset() {
  const viewport = window.visualViewport;
  if (!viewport) return 0;
  return Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop) - 6);
}
function setRecordKeyboardOffset() {
  const input = getRecordSearchInput();
  const offset = (isRecordSearchOpen() || document.activeElement === input) ? getRecordKeyboardOffset() : 0;
  document.documentElement.style.setProperty('--record-keyboard-offset', `${offset}px`);
}
"""
new = """let recordKeyboardBaselineHeight = 0;
let recordKeyboardHeldOffset = 0;
function captureRecordKeyboardBaseline() {
  const viewport = window.visualViewport;
  recordKeyboardBaselineHeight = Math.max(
    recordKeyboardBaselineHeight,
    Number(window.innerHeight || 0),
    Number(document.documentElement.clientHeight || 0),
    viewport ? Number(viewport.height || 0) + Number(viewport.offsetTop || 0) : 0
  );
}
function resetRecordKeyboardTracking() {
  recordKeyboardBaselineHeight = 0;
  recordKeyboardHeldOffset = 0;
}
function getRecordKeyboardOffset() {
  const viewport = window.visualViewport;
  if (!viewport) return 0;
  if (!recordKeyboardBaselineHeight) captureRecordKeyboardBaseline();
  return Math.max(0, Math.round(recordKeyboardBaselineHeight - viewport.height - viewport.offsetTop) - 6);
}
function setRecordKeyboardOffset() {
  const input = getRecordSearchInput();
  const focused = document.activeElement === input;
  const active = isRecordSearchOpen() || focused;
  if (!active) {
    resetRecordKeyboardTracking();
    document.documentElement.style.setProperty('--record-keyboard-offset', '0px');
    return;
  }
  const rawOffset = getRecordKeyboardOffset();
  if (focused) recordKeyboardHeldOffset = Math.max(recordKeyboardHeldOffset, rawOffset);
  else recordKeyboardHeldOffset = rawOffset;
  const offset = focused ? Math.max(rawOffset, recordKeyboardHeldOffset) : rawOffset;
  document.documentElement.style.setProperty('--record-keyboard-offset', `${offset}px`);
}
"""
if old in s:
    s = s.replace(old, new, 1)
elif 'recordKeyboardBaselineHeight' not in s:
    raise RuntimeError('legacy keyboard offset target not found')

s = s.replace("""  if (screen) screen.classList.add('record-search-open');
  if (pill) pill.classList.add('active');
""", """  captureRecordKeyboardBaseline();
  recordKeyboardHeldOffset = 0;
  if (screen) screen.classList.add('record-search-open');
  if (pill) pill.classList.add('active');
""", 1)

s = s.replace("""  document.documentElement.style.setProperty('--record-keyboard-offset', '0px');
  loadRecords('');
}""", """  resetRecordKeyboardTracking();
  document.documentElement.style.setProperty('--record-keyboard-offset', '0px');
  loadRecords('');
}""", 1)

old_search = """async function searchRecords() {
  syncRecordSearchQueryState();
  const input = getRecordSearchInput();
  const name = input ? input.value.trim() : '';

  if (!isRecordSearchOpen()) {
    await loadRecords('');
    return;
  }
  if (!name) {
    await loadRecords('');
    return;
  }
  await loadRecords(name);
}
"""
new_search = """async function searchRecords() {
  syncRecordSearchQueryState();
  const input = getRecordSearchInput();
  const name = input ? input.value.trim() : '';

  if (typeof window.refreshCurrentStudentRows === 'function') {
    window.refreshCurrentStudentRows();
    return;
  }
  if (!isRecordSearchOpen()) {
    await loadRecords('');
    return;
  }
  await loadRecords(name);
}
"""
if old_search in s:
    s = s.replace(old_search, new_search, 1)

old_restore = """  if (keyboardClosed && !inputFocused) {
    document.documentElement.style.setProperty('--record-keyboard-offset', '0px');
    if (suppressRestore) return;
    closeSearch();
  }
}"""
new_restore = """  if (keyboardClosed && !inputFocused) {
    resetRecordKeyboardTracking();
    document.documentElement.style.setProperty('--record-keyboard-offset', '0px');
    return;
  }
}"""
if old_restore in s:
    s = s.replace(old_restore, new_restore, 1)

focus_old = """  input.addEventListener('focus', function(event) {
    if (!isRecordSearchOpen()) {
"""
focus_new = """  input.addEventListener('focus', function(event) {
    captureRecordKeyboardBaseline();
    recordKeyboardHeldOffset = 0;
    if (!isRecordSearchOpen()) {
"""
if focus_old in s:
    s = s.replace(focus_old, focus_new, 1)

input_old = """  input.addEventListener('input', function() {
    syncRecordSearchQueryState();
    searchRecords();
  });
"""
input_new = """  input.addEventListener('input', function() {
    syncRecordSearchQueryState();
    searchRecords();
  });
  let compositionSearchTimer = null;
  const flushCompositionSearch = function() {
    clearTimeout(compositionSearchTimer);
    compositionSearchTimer = setTimeout(function() {
      syncRecordSearchQueryState();
      searchRecords();
    }, 0);
  };
  input.addEventListener('compositionupdate', flushCompositionSearch);
  input.addEventListener('compositionend', flushCompositionSearch);
"""
if input_old in s and 'compositionSearchTimer' not in s:
    s = s.replace(input_old, input_new, 1)

if 'recordKeyboardBaselineHeight' not in s or 'compositionSearchTimer' not in s:
    raise RuntimeError('legacy record search stabilization was not fully applied')
p.write_text(s, encoding='utf-8')

print('PC attendance search fixes applied.')
