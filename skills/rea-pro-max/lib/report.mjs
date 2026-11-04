import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RpmError, canonical, pathExists } from './common.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function renderReport(data) {
  const assets = join(root, 'assets/workbench');
  const template = readFileSync(join(assets, 'index.html'), 'utf8');
  for (const marker of ['__RPM_DATA__', '__RPM_STYLE__', '__RPM_SCRIPT__']) if (!template.includes(marker)) throw new RpmError('report_template', `Missing report marker ${marker}.`);
  const json = canonical(data).replace(/</gu, '\\u003c').replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029');
  const style = readFileSync(join(assets, 'style.css'), 'utf8');
  const script = readFileSync(join(assets, 'app.js'), 'utf8').replace(/<\/script/giu, '<\\/script');
  return template.replace('__RPM_STYLE__', () => style).replace('__RPM_SCRIPT__', () => script).replace('__RPM_DATA__', () => json);
}
export function writeReport(data, output) {
  if (pathExists(output)) throw new RpmError('output_exists', 'Choose a new report filename; existing reports are retained.');
  writeFileSync(output, renderReport(data), { flag: 'wx' }); return output;
}
