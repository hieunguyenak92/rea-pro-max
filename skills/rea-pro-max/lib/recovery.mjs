import { mkdirSync, cpSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathExists, RpmError } from './common.mjs';

const assets = fileURLToPath(new URL('../assets/recovery', import.meta.url));

export function initializeRecovery(directory) {
  const output = resolve(directory);
  if (pathExists(output)) throw new RpmError('output_exists', 'Choose a new recovery project directory.');
  mkdirSync(output);
  try {
    for (const name of ['reference', 'starter', 'recovered', 'scenario.json']) cpSync(join(assets, name), join(output, name), { recursive: true, errorOnExist: true, force: false });
  } catch (error) { rmSync(output, { recursive: true, force: true }); throw error; }
  return { output, task: join(output, 'starter/TASK.md'), contract: join(output, 'starter/contract.json'), scenario: join(output, 'scenario.json'),
    targets: { reference: join(output, 'reference'), candidate: join(output, 'starter'), worked_example: join(output, 'recovered') },
    next: 'Replay reference against starter, repair starter/worker.js against its contract, then replay again. recovered/ is an independently authored worked example, not an automatic reconstruction of arbitrary extensions.' };
}
