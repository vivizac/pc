const OLLI_CONSULTATION_RULES_KEY = 'olli_consultation_rules_v1';
const OLLI_CONSULTATION_RULE_OPTIONS = [
  { key: 'after_1', label: '1개월 후', type: 'once', month: 1 },
  { key: 'after_3', label: '3개월 후', type: 'once', month: 3 },
  { key: 'every_6', label: '6개월마다', type: 'repeat', interval: 6 },
  { key: 'every_12', label: '12개월마다', type: 'repeat', interval: 12 }
];
const OLLI_DEFAULT_CONSULTATION_RULES = ['after_1','every_12'];
const OLLI_DEFAULT_CONSULTATION_RULES_BY_TYPE = {
  elementary: ['after_1','every_12'],
  kinder: ['after_1','every_6','every_12']
};

function getOlliConsultationRuleOptions(){
  return OLLI_CONSULTATION_RULE_OPTIONS.slice();
}

function normalizeOlliConsultationRules(value, fallbackRules){
  const valid = new Set(OLLI_CONSULTATION_RULE_OPTIONS.map(option => option.key));
  let raw = value;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch(e) { raw = raw.split(','); }
  }
  if (!Array.isArray(raw)) raw = [];
  const converted = raw.map(item => {
    if (typeof item === 'number') {
      if (item === 1) return 'after_1';
      if (item === 3) return 'after_3';
      if (item === 6) return 'every_6';
      if (item === 12) return 'every_12';
    }
    const str = String(item || '').trim();
    if (valid.has(str)) return str;
    if (str === '1') return 'after_1';
    if (str === '3') return 'after_3';
    if (str === '6') return 'every_6';
    if (str === '12') return 'every_12';
    return '';
  }).filter(Boolean);
  const unique = Array.from(new Set(converted)).filter(key => valid.has(key));
  const fallback = Array.isArray(fallbackRules) && fallbackRules.length ? fallbackRules : OLLI_DEFAULT_CONSULTATION_RULES;
  return unique.length ? unique : fallback.slice();
}

function getOlliConsultationDivisionKey(type){
  const raw = String(type || '').trim();
  if (raw === 'kinder' || raw === 'kindergarten' || raw === '유치부') return 'kinder';
  return 'elementary';
}

function getOlliDefaultConsultationRules(type){
  const key = getOlliConsultationDivisionKey(type);
  const fallback = OLLI_DEFAULT_CONSULTATION_RULES_BY_TYPE[key] || OLLI_DEFAULT_CONSULTATION_RULES_BY_TYPE.elementary || OLLI_DEFAULT_CONSULTATION_RULES;
  return fallback.slice();
}

function getOlliDefaultConsultationRulesMap(){
  return {
    elementary: getOlliDefaultConsultationRules('elementary'),
    kinder: getOlliDefaultConsultationRules('kinder')
  };
}

function normalizeOlliConsultationRulesByType(value){
  let raw = value;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch(e) { raw = raw.split(','); }
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return {
      elementary: normalizeOlliConsultationRules(raw.elementary || raw.elementaryRules || raw['초등부'], getOlliDefaultConsultationRules('elementary')),
      kinder: normalizeOlliConsultationRules(raw.kinder || raw.kindergarten || raw.kinderRules || raw['유치부'], getOlliDefaultConsultationRules('kinder'))
    };
  }
  if (raw == null || raw === '') return getOlliDefaultConsultationRulesMap();
  const normalized = normalizeOlliConsultationRules(raw, OLLI_DEFAULT_CONSULTATION_RULES);
  return { elementary: normalized.slice(), kinder: normalized.slice() };
}

function monthsBetweenByCalendar(start, end){
  if (!(start instanceof Date) || isNaN(start.getTime()) || !(end instanceof Date) || isNaN(end.getTime())) return NaN;
  return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
}

function getConsultationMonthIndex(monthKey){
  const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return NaN;
  return Number(match[1]) * 12 + (Number(match[2]) - 1);
}

function getConsultationTaskKey(student, ruleKey, dueMonth){
  const studentPart = student?.id
    ? `id:${student.id}`
    : `name:${String(student?.name || '').trim()}`;
  return `${studentPart}|${String(ruleKey || '')}|${String(dueMonth || '')}`;
}

function consultationMonthKey(date){
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
}
function consultationAddMonths(date, months){
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== day) d.setDate(0);
  return d;
}
function calculateOlliConsultationTasks(student, context = {}){
  const referenceDate = context.now || new Date();

  const enrolled = context.enrolled;
  if (!enrolled) return [];

  const now = referenceDate instanceof Date && !isNaN(referenceDate.getTime()) ? referenceDate : new Date();
  const currentMonth = consultationMonthKey(now);
  const currentIndex = getConsultationMonthIndex(currentMonth);
  const progress = (context.progress || {});
  const trackingStart = progress.tracking_started_month || currentMonth;
  const trackingStartIndex = getConsultationMonthIndex(trackingStart);
  const elapsedMonths = monthsBetweenByCalendar(enrolled, now);
  const activeKeys = new Set(normalizeOlliConsultationRules(context.rules, getOlliDefaultConsultationRules(student?.type || student?.division)));
  const tasks = [];

  const pushTask = (option, dueDate, occurrenceMonths) => {
    const dueMonth = consultationMonthKey(dueDate);
    const dueIndex = getConsultationMonthIndex(dueMonth);
    if (!Number.isFinite(dueIndex) || dueIndex > currentIndex) return;
    // 기능 적용 이전 달의 과거 상담을 한꺼번에 미완료로 만들지 않습니다.
    if (Number.isFinite(trackingStartIndex) && dueIndex < trackingStartIndex) return;
    const taskKey = getConsultationTaskKey(student, option.key, dueMonth);
    const completedItem = (progress.completed || {})[taskKey];
    const completedMonth = String(completedItem?.completed_month || '');
    const isCurrentDue = dueMonth === currentMonth;
    const completedThisMonth = completedMonth === currentMonth;
    // 현재 달 상담은 완료 후에도 검정 버튼 상태를 확인할 수 있게 이번 달 동안 유지합니다.
    if (!isCurrentDue && completedItem && !completedThisMonth) return;
    tasks.push({
      key: taskKey,
      ruleKey: option.key,
      label: option.label,
      dueMonth,
      occurrenceMonths: Number(occurrenceMonths) || 0,
      completed: !!completedItem,
      completedMonth
    });
  };

  OLLI_CONSULTATION_RULE_OPTIONS.forEach(option => {
    if (!activeKeys.has(option.key)) return;
    if (option.type === 'once') {
      pushTask(option, consultationAddMonths(enrolled, option.month), option.month);
      return;
    }
    if (option.type === 'repeat' && elapsedMonths >= option.interval) {
      for (let occurrence = option.interval; occurrence <= elapsedMonths; occurrence += option.interval) {
        pushTask(option, consultationAddMonths(enrolled, occurrence), occurrence);
      }
    }
  });

  return tasks.sort((a, b) => {
    const monthDiff = getConsultationMonthIndex(a.dueMonth) - getConsultationMonthIndex(b.dueMonth);
    if (monthDiff) return monthDiff;
    return a.occurrenceMonths - b.occurrenceMonths;
  });
}

if (typeof module !== 'undefined' && module.exports) module.exports = {
  calculateOlliConsultationTasks, normalizeOlliConsultationRulesByType,
  normalizeOlliConsultationRules, getOlliDefaultConsultationRules, getConsultationTaskKey,
  consultationMonthKey
};
