import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = join(root, 'skills/rea-pro-max/assets/vendor');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const result = await build({ absWorkingDir: root, entryPoints: ['tools/mcp-sdk-entry.mjs'], outfile: 'skills/rea-pro-max/assets/vendor/mcp-sdk.mjs', bundle: true, format: 'esm', platform: 'node', target: 'node22', minify: true, legalComments: 'inline', metafile: true, write: false, banner: { js: '// Generated from pinned official MCP SDK packages by tools/vendor-mcp.mjs. See MCP-NOTICES.md.\nimport { createRequire as __rpmCreateRequire } from "node:module"; const require = __rpmCreateRequire(import.meta.url);' } });
const output = result.outputFiles.find(item => item.path.endsWith('mcp-sdk.mjs'));
if (!output) throw new Error('MCP bundle was not emitted.');
const checking = process.argv.includes('--check');
if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Use vendor-mcp.mjs [--check].');
const filesToWrite = new Map();
const packages = new Map();
for (const name of Object.keys(result.metafile.inputs).map(name => name.replaceAll('\\', '/')).filter(name => name.startsWith('node_modules/'))) {
  let current = dirname(resolve(root, name)), manifest;
  while (current !== root) {
    if (existsSync(join(current, 'package.json'))) {
      const candidate = JSON.parse(readFileSync(join(current, 'package.json'), 'utf8'));
      if (typeof candidate.name === 'string' && typeof candidate.version === 'string') { manifest = candidate; break; }
    }
    current = dirname(current);
  }
  if (!manifest) throw new Error(`No dependency metadata for ${name}`);
  packages.set(manifest.name, { name: manifest.name, version: manifest.version, license: manifest.license, directory: current });
}
const notices = ['# Bundled MCP runtime notices', '', 'Generated from exact development pins and package-lock.json. The runtime bundle is shipped so released MCP and CLI commands need no npm installation. Source: https://github.com/modelcontextprotocol/typescript-sdk', '', 'The MCP SDK packages contain their complete Apache-2.0/MIT transition notice. Their original LICENSE files are retained verbatim below. Our surrounding code remains MIT. No upstream REA code is included.', ''];
const records = [];
for (const item of [...packages.values()].sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
  const slug = item.name.replace(/^@/u, '').replaceAll('/', '-');
  const names = readdirSync(item.directory).filter(name => /^(?:licen[cs]e|notice|copying)(?:[._-].*)?$/iu.test(name));
  if (!names.length) throw new Error(`No retained license for bundled package ${item.name}`);
  const files = [];
  for (const name of names.sort()) {
    const bytes = readFileSync(join(item.directory, name));
    const destination = join(vendor, 'mcp-licenses', slug, name); filesToWrite.set(destination, bytes);
    files.push({ file: relative(vendor, destination).split('\\').join('/'), sha256: hash(bytes) });
  }
  records.push({ name: item.name, version: item.version, license: item.license, licenses: files });
  notices.push(`## ${item.name} ${item.version}`, '', `Package metadata license: ${item.license}. ` + files.map(file => `[${file.file.split('/').at(-1)}](${file.file})`).join(' · '), '');
}
filesToWrite.set(join(vendor, 'mcp-sdk.mjs'), output.contents);
filesToWrite.set(join(vendor, 'MCP-NOTICES.md'), Buffer.from(notices.join('\n') + '\n'));
const receipt = { schema_version: 1, builder: 'esbuild', builder_version: JSON.parse(readFileSync(join(root,'node_modules/esbuild/package.json'),'utf8')).version, format: 'esm', platform: 'node', target: 'node22', bundle_sha256: hash(output.contents), bytes: output.contents.byteLength, packages: records };
filesToWrite.set(join(vendor, 'MCP-RECEIPT.json'), Buffer.from(JSON.stringify(receipt,null,2)+'\n'));
for (const [path, bytes] of filesToWrite) {
  if (checking) { if (!existsSync(path) || !readFileSync(path).equals(Buffer.from(bytes))) throw new Error(`Vendor output differs: ${relative(root,path)}. Run npm run vendor:mcp.`); }
  else { mkdirSync(dirname(path), {recursive:true}); writeFileSync(path, bytes); }
}
console.log(JSON.stringify(receipt,null,2));
