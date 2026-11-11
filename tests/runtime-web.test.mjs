import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWebScenario } from '../skills/rea-pro-max/lib/runtime/web.mjs';
import { replayWebFeature } from '../skills/rea-pro-max/lib/runtime/web-replay.mjs';

const scenario = {
  schema_version: 1,
  name: 'bounded local search',
  url: 'http://127.0.0.1:4173/',
  actions: [
    { id: 'open', kind: 'wait', milliseconds: 0 },
    { id: 'type', kind: 'input', selector: '#search', value: 'café' },
    { id: 'submit', kind: 'click', selector: '#submit' },
  ],
};

test('web scenarios are finite, credential-free and selector-bounded', () => {
  assert.deepEqual(validateWebScenario(scenario), scenario);
  assert.throws(() => validateWebScenario({ ...scenario, url: 'file:///tmp/app.html' }), { code: 'invalid_web_scenario' });
  assert.throws(() => validateWebScenario({ ...scenario, url: 'https://user:pass@example.org/app' }), { code: 'invalid_web_scenario' });
  assert.throws(() => validateWebScenario({ ...scenario, actions: [{ ...scenario.actions[0], extra: true }] }), { code: 'invalid_web_scenario' });
  assert.throws(() => validateWebScenario({ ...scenario, actions: Array.from({ length: 65 }, (_, index) => ({ id: `a${index}`, kind: 'wait', milliseconds: 0 })) }), { code: 'invalid_web_scenario' });
});

test('web replay rejects malformed URLs before starting a browser', async () => {
  await assert.rejects(() => replayWebFeature({ referenceUrl: 'file:///tmp/reference', candidateUrl: 'http://127.0.0.1:4174/', executablePath: process.execPath, scenario }), { code: 'web_replay_input' });
});
