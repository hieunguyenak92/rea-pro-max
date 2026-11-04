import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readmes = ['README.md', 'docs/i18n/vi.md', 'docs/i18n/ko.md', 'docs/i18n/ja.md', 'docs/i18n/es.md', 'docs/i18n/pt-BR.md', 'docs/i18n/zh-CN.md', 'docs/i18n/th.md', 'docs/i18n/fr.md'];
const ignored = new Set(['node_modules', '.git', 'dist', 'rpm-lab', '.rpm', '__pycache__']);
const errors = [], notes = [];
function require(condition, message) { if (!condition) errors.push(message); }
function json(file) {
  try { return JSON.parse(readFileSync(resolve(root, file), 'utf8')); }
  catch (error) { errors.push(`${file}: ${error.message}`); return null; }
}
function markdownFiles(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...markdownFiles(path));
    else if (entry.isFile() && extname(path) === '.md') result.push(path);
  }
  return result;
}
const withoutCode = text => text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gmu, '');
const links = text => [...withoutCode(text).matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^)\n]+)\)/gu)].map(match => match[1].startsWith('<') ? match[1].slice(1, -1) : match[1].split(/\s+["']/u)[0]);

let expectedSelector;
for (const name of readmes) {
  const file = resolve(root, name);
  if (!existsSync(file)) { errors.push(`Missing required localized README: ${name}`); continue; }
  const text = readFileSync(file, 'utf8');
  const selector = text.split('\n').find(line => { const destinations = links(line).map(target => resolve(dirname(file), target)); return readmes.every(target => destinations.includes(resolve(root,target))); });
  require(Boolean(selector), `${name}: one visible selector must link all nine README languages.`);
  if (selector) {
    const labels = [...selector.matchAll(/\[([^\]]+)\]\(/gu)].map(match => match[1]).join('|');
    if (expectedSelector === undefined) expectedSelector = labels;
    require(labels === expectedSelector, `${name}: visible language labels differ from the English selector.`);
  }
  require(text.length > 1500 && (text.match(/^#{1,3}\s/gmu)?.length ?? 0) >= 5, `${name}: substantive introduction, usage, features and limits are required.`);
  require(text.includes('rea-pro-max.mjs demo --out'), `${name}: include the executable first-use path.`);
  require(text.includes('mcp-server.mjs') && text.includes('docs/MCP.md') || text.includes('../MCP.md'), `${name}: include MCP setup or technical reference.`);
  require(text.includes('36'), `${name}: keep the measured 36-template catalog count consistent.`);
  require(!/\b(?:guaranteed?|buy|purchased)\s+(?:1[,.]?000\s+)?stars\b/iu.test(text), `${name}: unsupported star/adoption claim.`);
}

require(readdirSync(root).filter(name => /^README(?:[._-].*)?\.md$/u.test(name)).length === 1, 'Keep only English README.md at root; translations belong under docs/i18n.');
const files = markdownFiles(root);
let localLinks = 0;
for (const file of files) {
  for (const target of links(readFileSync(file, 'utf8'))) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/iu.test(target)) continue;
    let pathname;
    try { pathname = decodeURIComponent(target.split(/[?#]/u)[0]); }
    catch { errors.push(`${relative(root, file)}: invalid encoded link ${target}`); continue; }
    if (!pathname) continue;
    localLinks++;
    const destination = resolve(dirname(file), pathname); const pathFromRoot = relative(root, destination);
    require(!isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`), `${relative(root, file)}: link leaves the repository: ${target}`);
    require(existsSync(destination), `${relative(root, file)}: missing local link target ${target}`);
  }
}

const prompts = json('skills/rea-pro-max/assets/prompts.json');
if (Array.isArray(prompts)) {
  require(prompts.length === 36, `Prompt catalog has ${prompts.length} records; expected36.`);
  const ids = new Set();
  for (const item of prompts) {
    require(item && typeof item === 'object' && !Array.isArray(item), 'Prompt catalog entries must be records.');
    if (!item || typeof item !== 'object') continue;
    require(typeof item.id === 'string' && !ids.has(item.id), `Duplicate/missing prompt identity ${item.id}.`); ids.add(item.id);
    for (const key of ['target', 'title', 'prompt', 'scope']) require(typeof item[key] === 'string' && item[key].trim().length > 0, `${item.id}: missing ${key}.`);
    require(item.status === 'task-template', `${item.id}: templates cannot claim an independently verified integration.`);
    require(typeof item.prompt === 'string' && item.prompt.startsWith('Use REA Pro Max'), `${item.id}: prompt must be directly usable as a task.`);
  }
} else require(false, 'Prompt catalog must be an array.');
require(existsSync(resolve(root, 'skills/rea-pro-max/references/prompt-library.md')), 'Missing prompt-library reference.');
require(existsSync(resolve(root, 'skills/rea-pro-max/assets/vendor/acorn.mjs')), 'Missing vendored runtime parser.');
require(existsSync(resolve(root, 'skills/rea-pro-max/assets/vendor/ACORN-LICENSE')), 'Missing vendored parser license.');

const statesFile = 'docs/demo/states.json';
if (existsSync(resolve(root, statesFile))) {
  const recorded = json(statesFile); const states = Array.isArray(recorded) ? recorded : recorded?.states;
  require(Array.isArray(states) && states.length >= 4, 'Recorded demo needs inspection, planning, verification and reduction states.');
  if (Array.isArray(states)) {
    const ids = new Set();
    for (const state of states) {
      require(state && typeof state.id === 'string' && !ids.has(state.id), 'Recorded demo states need unique identities.');
      ids.add(state?.id);
      require(state?.data && typeof state.data === 'object' && !Array.isArray(state.data), 'Recorded demo states must carry supplied engine data.');
    }
    const payloads = states.map(item => item?.data).filter(Boolean);
    require(payloads.some(data => Array.isArray(data.inspection?.evidence) && data.inspection?.artifact?.sha256), 'Recorded demo must include actual source evidence and artifact identity.');
    require(payloads.some(data => Array.isArray(data.planner?.ranked) && Array.isArray(data.planner?.surviving_ids)), 'Recorded demo must include actual planner output.');
    const verification = payloads.map(data => data.verification ?? (data.receipt_sha256 ? data : null)).find(Boolean);
    const reduction = payloads.map(data => data.reduction ?? (Array.isArray(data.receipts) && Array.isArray(data.sequence) ? data : null)).find(Boolean);
    require(Boolean(verification) && verification.status === 'fail', 'Recorded owned regression must retain its failing verdict.');
    require(Boolean(verification) && verification.summary?.fail > 0 && /^[a-f0-9]{64}$/u.test(verification.receipt_sha256?.reference ?? ''), 'Recorded mismatch must retain cases and supplied-receipt content identities.');
    require(Boolean(reduction) && reduction.status === 'reduced' && reduction.minimality === 'one-minimal', 'Recorded reduction must retain its qualified result.');
    require(Boolean(reduction) && reduction.sequence?.length === 3, 'Recorded owned counterexample must retain three actions.');
    require(Boolean(reduction) && Array.isArray(reduction.receipts) && reduction.receipts.length === reduction.tests && reduction.tests <= reduction.budget, 'Recorded reduction must retain bounded oracle receipts.');
  }
} else notes.push('Recorded demo data is not present yet; no demo result was inferred.');
if (!existsSync(resolve(root, 'docs/VALIDATION.md'))) notes.push('Release verification record is not present yet; no runtime claim was inferred.');

for (const note of notes) console.log(`NOTE: ${note}`);
if (errors.length) { for (const error of errors) console.error(`ERROR: ${error}`); process.exitCode = 1; }
else console.log(`Documentation checks passed: ${readmes.length} README languages, ${files.length} Markdown files, ${localLinks} local links, 36 task templates. Claim accuracy and native-language polish still require review.`);
