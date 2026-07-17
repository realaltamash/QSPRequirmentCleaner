/* =====================================================================
   Requirement Cleaner — parsing engine
   ===================================================================== */

const LABELS = [
  ['companyRaw', /\bcompany\s*name\s*\/\s*account\s*name\b/i],
  ['companyRaw', /\bcompany\s*name\b/i],
  ['companyRaw', /\baccount\s*name\b/i],
  ['code', /\bbranch\s*deal\b/i],
  ['businessUnit', /\bbusiness\s*unit\b/i],
  ['jobTitle', /\bjob\s*title\b(\s*\([^)]*\))?\s*/i],
  ['designation', /\bdesignation\b(\s*\([^)]*\))?\s*/i],
  ['interviewLocation', /\binterview\s*location\b/i],
  ['jobLocation', /\bjob\s*location\b/i],
  ['skills', /\bskills\s*required\b/i],
  ['otherSkills', /\bother\s*skills\b/i],
  ['genderSpec', /\bgender\s*specification\b/i],
  ['genderSpec', /\bgender\b/i],
  ['mode', /\bmode\s*of\s*interview\b/i],
  ['rounds', /\binterview\s*rounds\b/i],
  ['tenth', /\b10\s*th\s*percent\b/i],
  ['twelfth', /\b12\s*th\s*percent\b/i],
  ['qualType', /\bqualification\s*type\b/i],
  ['degreeStream', /\bdegree\s*stream\b/i],
  ['degreePercent', /\bdegree\s*percent\b/i],
  ['degree', /\bdegree\b/i],
  ['mastersStream', /\bmasters\s*stream\b/i],
  ['mastersPercent', /\bmasters\s*percent\b/i],
  ['masters', /\bmasters\b/i],
  ['salary', /\bsalary\s*package\b/i],
  ['salary', /\bsalary\b/i],
  ['bond', /\bbond\b/i],
  ['yop', /\byop\b/i],
  ['stream', /\bstream\b/i],
  ['overallPercent', /(?<![a-z])%(?=\s*:)/i],
  ['date', /\bdate\b/i],
];

function parse(text) {
  const { text: strippedText } = separateLeftover(text);
  let t = strippedText.replace(/\r/g, '').replace(/\*/g, '');
  // Use a sentinel (\u0001) to mark REAL field boundaries: tabs, newlines, or big gaps
  // (2+ spaces) used to separate concatenated fields on one line. A label word that
  // merely appears mid-sentence (single space before it) will NOT be preceded by a
  // sentinel, so it can no longer be mistaken for the start of a new field.
  let flat = t
    .replace(/\t+/g, '\u0001')
    .replace(/\n+/g, '\u0001')
    .replace(/ {2,}/g, '\u0001')
    .replace(/[\u0001\s]*\u0001[\u0001\s]*/g, '\u0001')
    .replace(/^\u0001+|\u0001+$/g, '');

  let matches = [];
  for (const [key, re] of LABELS) {
    const gre = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = gre.exec(flat)) !== null) {
      const precededByBoundary = m.index === 0 || flat[m.index - 1] === '\u0001';
      if (!precededByBoundary) {
        if (m.index === gre.lastIndex) gre.lastIndex++;
        continue;
      }
      let end = m.index + m[0].length;
      let rest = flat.slice(end);
      let colonMatch = rest.match(/^[\u0001\s]*:?-?[\u0001\s]*/);
      let valueStart = end + (colonMatch ? colonMatch[0].length : 0);
      matches.push({ key, start: m.index, labelEnd: end, valueStart });
      if (m.index === gre.lastIndex) gre.lastIndex++;
    }
  }
  matches.sort((a, b) => a.start - b.start);

  let filtered = [];
  for (const m of matches) {
    let dupe = filtered.find(f => f.start === m.start);
    if (dupe) {
      if ((m.labelEnd - m.start) > (dupe.labelEnd - dupe.start)) {
        filtered = filtered.filter(f => f !== dupe);
        filtered.push(m);
      }
      continue;
    }
    filtered.push(m);
  }
  filtered.sort((a, b) => a.start - b.start);

  let cleaned = [];
  for (const m of filtered) {
    const prev = cleaned[cleaned.length - 1];
    if (prev && m.start < prev.valueStart) continue;
    cleaned.push(m);
  }

  const result = {};
  const rejected = []; // text trimmed off by validators - shown as "not included"
  for (let i = 0; i < cleaned.length; i++) {
    const cur = cleaned[i];
    const next = cleaned[i + 1];
    let valueEnd = next ? next.start : flat.length;
    let value = flat.slice(cur.valueStart, valueEnd).replace(/\u0001/g, ' ').trim();
    value = value.replace(/^[-:\s]+/, '').replace(/[-\s]+$/, '').replace(/\s{2,}/g, ' ');
    if (!value) continue;

    const validated = validateField(cur.key, value);
    if (validated.rejected) rejected.push(validated.rejected);
    if (!validated.value) continue;

    if (!result[cur.key]) result[cur.key] = validated.value;
    else result[cur.key] += ' ; ' + validated.value;
  }
  result.__rejected = rejected;
  return result;
}

const DATE_PATTERN = /\d{1,2}\s*[-\/.]\s*(?:\d{1,2}|[A-Za-z]{3,9})\s*[-\/.]\s*\d{2,4}/;
const GENDER_TOKEN = /\b(male|female|any)\b/gi;

function validateField(key, value) {
  if (key === 'date') {
    const m = value.match(DATE_PATTERN);
    if (m) {
      const rest = (value.slice(0, m.index) + value.slice(m.index + m[0].length)).trim().replace(/^[;,\s]+|[;,\s]+$/g, '');
      return { value: m[0].trim(), rejected: rest ? `(trimmed from Date) ${rest}` : null };
    }
    return { value, rejected: null }; // no clean date pattern found - keep as-is, better than nothing
  }
  if (key === 'genderSpec') {
    const tokens = value.match(GENDER_TOKEN);
    if (tokens) {
      const unique = [...new Set(tokens.map(t => t.toUpperCase()))];
      const rest = value.replace(GENDER_TOKEN, '').replace(/[\/,]/g, ' ').replace(/\s+/g, ' ').trim();
      return { value: unique.join(' / '), rejected: rest ? `(trimmed from Gender) ${rest}` : null };
    }
    return { value, rejected: null };
  }
  return { value, rejected: null };
}

// ---- Degree / Stream short-form dictionary ----
const DEGREE_ABBR = [
  ['bachelor of engineering', 'BE'],
  ['bachelor of technology', 'BTECH'],
  ['bachelor of computer applications', 'BCA'],
  ['bachelor of computer application', 'BCA'],
  ['bachelor of computer science', 'BCS'],
  ['bachelor of business administration', 'BBA'],
  ['bachelor of commerce', 'BCOM'],
  ['bachelor of science', 'BSC'],
  ['bachelor of arts', 'BA'],
  ['master of engineering', 'ME'],
  ['master of technology', 'MTECH'],
  ['master of computer applications', 'MCA'],
  ['master of business administration', 'MBA'],
  ['master of commerce', 'MCOM'],
  ['master of science', 'MSC'],
  ['master of arts', 'MA'],
];

const STREAM_ABBR = [
  ['artificial intelligence and machine learning engineering', 'AIML'],
  ['artificial intelligence and machine learning', 'AIML'],
  ['computer science and engineering', 'CSE'],
  ['information science and engineering', 'ISE'],
  ['electronics and communication engineering', 'ECE'],
  ['electronics and telecommunications engineering', 'ETE'],
  ['electronics and telecommunication engineering', 'ETE'],
  ['electrical and electronics engineering', 'EEE'],
  ['electrical and electronic engineering', 'EEE'],
  ['mechanical engineering', 'MECH'],
  ['civil engineering', 'CIVIL'],
  ['chemical engineering', 'CHEM'],
  ['aeronautical engineering', 'AERO'],
  ['electrical engineering', 'EE'],
  ['information science', 'ISE'],
  ['information technology', 'IT'],
  ['computer science', 'CSE'],
  ['biotechnology', 'BT'],
  ['artificial intelligence', 'AI'],
];

function buildAbbrRegexList(dict) {
  return [...dict].sort((a, b) => b[0].length - a[0].length)
    .map(([phrase, code]) => [new RegExp('\\b' + phrase.replace(/\s+/g, '\\s+') + '\\b', 'gi'), code]);
}
const DEGREE_ABBR_RE = buildAbbrRegexList(DEGREE_ABBR);
const STREAM_ABBR_RE = buildAbbrRegexList(STREAM_ABBR);

function abbreviate(text, reList) {
  if (!text) return text;
  let out = text;
  for (const [re, code] of reList) out = out.replace(re, code);
  return out;
}

// ---- Leftover / not-recognised detection ----
const BOILERPLATE_LINE = [
  /^\*?\s*requirement\s*\*?$/i,
  /^those who are interested/i,
  /^name\s*:?\s*$/i,
  /^contact\s*no\s*:?\s*$/i,
  /^degree\s*:?\s*$/i,
  /^stream\s*:?\s*$/i,
  /^yop\s*:?\s*$/i,
  /^[-=*_\s]{2,}$/,
];

function lineHasBoundedLabel(line) {
  let l = line.replace(/\*/g, '');
  let flatLine = l
    .replace(/\t+/g, '\u0001')
    .replace(/ {2,}/g, '\u0001')
    .replace(/[\u0001\s]*\u0001[\u0001\s]*/g, '\u0001')
    .replace(/^[\u0001\s]+/, '')
    .replace(/\u0001+$/, '');
  for (const [, re] of LABELS) {
    const gre = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = gre.exec(flatLine)) !== null) {
      const boundary = m.index === 0 || flatLine[m.index - 1] === '\u0001';
      if (boundary) return true;
      if (m.index === gre.lastIndex) gre.lastIndex++;
    }
  }
  return false;
}

function separateLeftover(rawText) {
  const lines = rawText.replace(/\r/g, '').split('\n');
  const keptLines = [];
  const leftovers = [];
  for (let line of lines) {
    let trimmed = line.replace(/\*/g, '').trim();
    if (!trimmed) { keptLines.push(line); continue; }
    if (BOILERPLATE_LINE.some(re => re.test(trimmed))) { keptLines.push(line); continue; }
    if (lineHasBoundedLabel(trimmed)) { keptLines.push(line); continue; }
    leftovers.push(line.trim());
  }
  return { text: keptLines.join('\n'), leftovers };
}

function findLeftover(rawText) {
  return separateLeftover(rawText).leftovers;
}

function splitCompanyCode(r) {
  let m = r.companyRaw ? r.companyRaw.match(/^([A-Za-z0-9]+)\s*\(([^)]+)\)$/) : null;
  if (m) return { code: r.code || m[1], company: m[2].trim() };
  return { code: r.code || '', company: r.companyRaw || '' };
}

function deriveDate(code, explicitDate) {
  if (explicitDate) return explicitDate.replace(/^-+|-+$/g, '').trim();
  if (code) {
    const m = code.match(/^R(\d{2})(\d{2})(\d{2})/i);
    if (m) return `${m[1]}-${m[2]}-20${m[3]}`;
  }
  return '';
}

function titleCaseWords(s) {
  if (!s) return s;
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

function upper(s) { return s ? s.toUpperCase() : s; }

const EXTRA_FIELD_LABELS = {
  businessUnit: 'Business Unit',
  interviewLocation: 'Interview Location',
  mode: 'Mode of Interview',
  rounds: 'Interview Rounds',
  tenth: '10th %',
  twelfth: '12th %',
  qualType: 'Qualification Type',
  degreePercent: 'Degree %',
  masters: 'Masters',
  mastersStream: 'Masters Stream',
  mastersPercent: 'Masters %',
};

function format(r, includeExtra) {
  const { code, company } = splitCompanyCode(r);
  const date = deriveDate(code, r.date);
  const missing = [];

  const lines = [];
  lines.push('REQUIREMENT');

  if (date) lines.push(`Date :- ${date}`); else missing.push('Date');

  if (code || company) {
    let compLine = 'Company Name :';
    compLine += code ? ` ${code}` : `${company ? ' ' + company : ''}`;
    if (code && company) compLine += `   (${company})`;
    lines.push(compLine);
  } else missing.push('Company Name');

  if (r.jobTitle) lines.push(`Job Title : ${titleCaseWords(r.jobTitle)}`); else missing.push('Job Title');
  if (r.designation) lines.push(`Designation : ${r.designation}`); else missing.push('Designation');
  if (r.skills) lines.push(`Skills Required : ${r.skills}`); else missing.push('Skills Required');

  lines.push(`Other Skills : ${r.otherSkills ? r.otherSkills : 'NA'}`);

  if (r.jobLocation) lines.push(`Job location : ${r.jobLocation}`); else missing.push('Job location');
  if (r.salary) lines.push(`Salary package : ${r.salary}`); else missing.push('Salary package');
  if (r.bond) lines.push(`BOND : ${r.bond}`); else missing.push('BOND');
  if (r.genderSpec) lines.push(`Gender: ${r.genderSpec}`); else missing.push('Gender');

  const degreeOut = r.degree ? abbreviate(r.degree, DEGREE_ABBR_RE) : '';
  if (degreeOut) lines.push(`DEGREE: ${degreeOut}`); else missing.push('DEGREE');

  const streamOut = r.degreeStream ? abbreviate(r.degreeStream, STREAM_ABBR_RE)
    : (r.stream ? abbreviate(upper(r.stream), STREAM_ABBR_RE) : '');
  if (streamOut) lines.push(`Degree Stream: ${streamOut}`); else missing.push('Degree Stream');

  if (r.yop) lines.push(`YOP : ${r.yop}`); else missing.push('YOP');

  if (r.overallPercent) lines.push(`%: ${r.overallPercent}`);

  if (includeExtra) {
    if (r.businessUnit) lines.push(`Business Unit : ${r.businessUnit}`);
    if (r.interviewLocation) lines.push(`Interview location : ${r.interviewLocation}`);
    if (r.mode) lines.push(`Mode of Interview : ${r.mode}`);
    if (r.rounds) lines.push(`Interview Rounds : ${r.rounds}`);
    if (r.tenth) lines.push(`10th % : ${r.tenth}`);
    if (r.twelfth) lines.push(`12th % : ${r.twelfth}`);
    if (r.qualType) lines.push(`Qualification Type : ${r.qualType}`);
    if (r.degreePercent) lines.push(`Degree % : ${r.degreePercent}`);
    if (r.masters) lines.push(`MASTERS : ${abbreviate(r.masters, DEGREE_ABBR_RE)}`);
    if (r.mastersStream) lines.push(`Masters Stream : ${abbreviate(r.mastersStream, STREAM_ABBR_RE)}`);
    if (r.mastersPercent) lines.push(`Masters % : ${r.mastersPercent}`);
  }

  lines.push('');
  lines.push('Those who are interested give your name in below format its urgent requirement.');
  lines.push('NAME:');
  lines.push('CONTACT NO:');
  lines.push('DEGREE:');
  lines.push('STREAM:');
  lines.push('YOP:');

  return { text: lines.join('\n'), missing };
}

function extraFieldsPresent(r) {
  return Object.keys(EXTRA_FIELD_LABELS).filter(k => r[k]).map(k => EXTRA_FIELD_LABELS[k]);
}

/* =====================================================================
   UI wiring
   ===================================================================== */

const $ = id => document.getElementById(id);

function setStep(n) {
  for (let i = 1; i <= 3; i++) {
    const el = $('step' + i);
    el.classList.remove('active', 'done');
    if (i < n) el.classList.add('done');
    if (i === n) el.classList.add('active');
  }
}

function runClean() {
  const raw = $('input').value;
  const status = $('statusMark');
  const hint = $('detectHint');
  const includeExtra = $('includeExtra').checked;

  if (!raw.trim()) {
    status.textContent = 'Nothing to clean yet.';
    hint.textContent = '';
    return;
  }

  const parsed = parse(raw);
  const rejectedByValidator = parsed.__rejected || [];
  const found = Object.keys(parsed).filter(k => k !== '__rejected').length;
  const { text: outText, missing } = format(parsed, includeExtra);
  $('output').value = outText;
  status.textContent = `Detected ${found} field${found === 1 ? '' : 's'}. Review before sending.`;

  const hiddenExtras = includeExtra ? [] : extraFieldsPresent(parsed);
  let hintParts = [];
  if (missing.length) hintParts.push(`⚠ Missing: ${missing.join(', ')}`);
  if (hiddenExtras.length) hintParts.push(`Also found (hidden): ${hiddenExtras.join(', ')}`);
  hint.textContent = hintParts.join('  |  ');
  hint.classList.toggle('warn', missing.length > 0);

  const leftovers = [...findLeftover(raw), ...rejectedByValidator];
  const section = $('leftoverSection');
  const list = $('leftoverList');
  section.classList.add('show');
  if (leftovers.length) {
    list.innerHTML = leftovers.map(l =>
      `<div class="leftover-item">${l.replace(/</g, '&lt;')}</div>`
    ).join('');
  } else {
    list.innerHTML = '<div class="leftover-empty">Nothing left over — every line was recognised.</div>';
  }

  setStep(2);
}

function copyOutput() {
  const out = $('output');
  if (!out.value.trim()) return;
  out.select();
  document.execCommand('copy');
  const status = $('statusMark');
  status.textContent = 'Copied to clipboard.';
  setStep(3);
  setTimeout(() => { if (status.textContent === 'Copied to clipboard.') status.textContent = ''; }, 2000);
}

function loadSample() {
  $('input').value = `Company Name / Account Name\tembitel
Branch Deal\tR14072633703J
Business Unit\tjspiders
Job Title (Testing/Development/Generic) :\ttechnical
Designation (Role/Job Title) :\tsoftware engineer
Job Location : bangalore
Interview Location : bangalore
Skills Required :\tcore java
Other Skills :\tspring boot , good communication
Gender Specification :\tfemale , male
Mode Of Interview : offline
Interview Rounds : technical round , hr round , aptitude test
10th Percent\t65%
12th Percent\t65%
YOP : 2026
Qualification Type :\tDegree  Masters
Degree :\tbachelor of engineering ; bachelor of technology
Degree Stream :\tcomputer science , information technology
Degree Percent : 65% - 100%
Masters : master of engineering ; master of technology
Masters Stream\tcomputer science , information technology
Masters Percent : \t65% - 100%`;
  setStep(1);
}

function clearInput() {
  $('input').value = '';
  setStep(1);
}

function clearAll() {
  $('input').value = '';
  $('output').value = '';
  $('statusMark').textContent = '';
  $('detectHint').textContent = '';
  $('leftoverSection').classList.remove('show');
  setStep(1);
}

function toggleTheme() {
  const root = document.documentElement;
  const isDark = root.getAttribute('data-theme') === 'dark';
  root.setAttribute('data-theme', isDark ? 'light' : 'dark');
}

document.addEventListener('DOMContentLoaded', () => {
  $('cleanBtn').addEventListener('click', runClean);
  $('arrowBtn').addEventListener('click', runClean);
  $('copyBtn').addEventListener('click', copyOutput);
  $('loadSampleBtn').addEventListener('click', loadSample);
  $('clearInputBtn').addEventListener('click', clearInput);
  $('clearAllBtn').addEventListener('click', clearAll);
  $('includeExtra').addEventListener('change', () => { if ($('input').value.trim()) runClean(); });
  $('themeToggle').addEventListener('click', toggleTheme);
});
