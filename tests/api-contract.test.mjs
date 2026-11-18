import assert from 'node:assert/strict';
import test from 'node:test';
import { compareApiContract } from '../skills/rea-pro-max/lib/analysis/api-contract.mjs';

const contract = (paths, openapi = '3.1.2') => ({ openapi, paths });
const capture = (...entries) => ({ log: { entries } });
const request = (method, path) => ({ request: { method, url: `https://example.invalid${path}` } });

test('compares exact and templated operations to saved requests without retaining traffic values', () => {
  const paths = { '/pets/{id}': { get: {}, delete: {} }, '/pets/mine': { get: {} }, '/': { options: {} } };
  const har = capture(
    request('OPTIONS', ''),
    request('GET', '/pets/mine'),
    { request: {
      method: 'GET',
      url: 'https://secret-origin.invalid/pets/private-id?secret-query#secret-fragment',
      headers: [{ name: 'Authorization', value: 'secret-header' }],
      postData: { text: 'secret-request-body' },
    }, response: { content: { text: 'secret-response-body' } } },
    request('GET', '/pets/private-id'),
    request('DELETE', '/pets/mine'),
    request('GET', '/private-unmatched'),
  );
  const result = compareApiContract({ ...contract(paths), servers: [{ url: 'https://secret-server.invalid' }] }, har);
  assert.equal(result.kind, 'api-contract-comparison');
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.coverage.operations, { observed: 3, ambiguous: 0, unobserved: 1 });
  assert.deepEqual(result.coverage.observations, { observed: 4, ambiguous: 0, unmatched: 2, omitted: 0 });
  assert.deepEqual(result.observations.slice(-2), [
    { entry_index: 4, status: 'unmatched', reason: 'no_declared_method' },
    { entry_index: 5, status: 'unmatched', reason: 'no_supported_path' },
  ]);
  assert.deepEqual(result.operations[result.observations[2].operation_index], {
    method: 'GET', path: '/pets/{id}', observed_count: 2, ambiguous_count: 0, status: 'observed',
  });
  assert.doesNotMatch(JSON.stringify(result), /secret-|private-id|private-unmatched|example\.invalid/u);
  assert.deepEqual(result, compareApiContract({ ...contract(Object.fromEntries(Object.entries(paths).reverse())), servers: [{ url: 'unused-server' }] }, har));
});

test('does not lower-case HTTP methods, expand server bases or manufacture concrete matches', () => {
  const result = compareApiContract({ ...contract({ '/Items/': { post: {} } }), servers: [{ url: '/v1' }] }, capture(
    request('POST', '/Items/'),
    request('post', '/Items/'),
    request('POST', '/Items'),
    request('POST', '/items/'),
    request('POST', '/v1/Items/'),
  ));
  assert.deepEqual(result.observations.map(row => row.reason ?? row.status), [
    'observed', 'no_declared_method', 'no_supported_path', 'no_supported_path', 'no_supported_path',
  ]);
});

test('treats overlapping templates as unresolved at the path level', () => {
  const result = compareApiContract(contract({ '/{resource}/me': { get: {} }, '/books/{id}': { post: {}, get: {} } }), capture(
    request('GET', '/books/me'), request('POST', '/books/me'), request('GET', '/books/73'),
  ));
  assert.equal(result.status, 'partial');
  assert.equal(result.observations[0].candidate_path_count, 2);
  assert.equal(result.observations[1].candidate_path_count, 2);
  assert.equal(result.observations[1].candidate_operation_count, 1);
  assert.deepEqual(result.operations.map(({ method, status, observed_count, ambiguous_count }) => [method, status, observed_count, ambiguous_count]), [
    ['GET', 'observed', 1, 1], ['POST', 'ambiguous', 0, 1], ['GET', 'ambiguous', 0, 1],
  ]);
});

test('supports delimited and adjacent placeholders without splitting percent escapes', () => {
  const result = compareApiContract(contract({
    '/files/{name}.{extension}': { get: {} },
    '/split/{a}{b}': { get: {} },
    '/byte/{value}F': { get: {} },
    '/escaped/%2f': { get: {} },
  }), capture(
    request('GET', '/files/archive.tar.gz'),
    request('GET', '/files/.gz'),
    request('GET', '/files/archive.'),
    request('GET', '/split/ab'),
    request('GET', '/split/%2F'),
    request('GET', '/split/%2Fx'),
    request('GET', '/byte/a%2F'),
    request('GET', '/byte/%2FF'),
    request('GET', '/escaped/%2F'),
  ));
  assert.deepEqual(result.observations.map(row => row.status), [
    'observed', 'unmatched', 'unmatched', 'observed', 'unmatched', 'observed', 'unmatched', 'observed', 'observed',
  ]);
});

test('keeps invalid, unresolved and unsupported observations in explicit omission totals', () => {
  const result = compareApiContract(contract({
    '/bad/{id}/{id}': { get: {} },
    '/bad?token': { get: {} },
    '/ref': { $ref: 'https://secret-origin.invalid/ref' },
    '/invalid': [],
    '/method': { get: { $ref: 'unavailable' } },
    '/{fallback}': { get: {} },
    'x-custom': '/not-a-path',
  }), capture(
    request('GET', '/ref'),
    request('GET', '/invalid'),
    request('GET', '/method'),
    request('GET', '/archive/../private'),
    request('GET', '/invalid/%zz'),
    { request: { method: 'GET', url: 'file:///private' } },
    { request: { method: 'GLUE SECRET', url: 'https://example.invalid/private' } },
  ));
  assert.equal(result.status, 'partial');
  assert.equal(result.coverage.declared_paths, 6);
  assert.equal(result.coverage.indexed_paths, 4);
  assert.deepEqual(result.coverage.contract_omissions, {
    unsupported_path: 2, invalid_path_item: 1, unavailable_operation: 1, unresolved_path_reference: 1,
  });
  assert.deepEqual(result.coverage.observation_omissions, {
    unresolved_path_reference: 1, invalid_path_item: 1, unavailable_operation: 1, unsupported_request_url: 3, invalid_request_method: 1,
  });
  assert.doesNotMatch(JSON.stringify(result), /secret-origin|token|GLUE|private/u);
});

test('handles 3.2 fixed and additional HTTP methods while flagging invalid duplicates', () => {
  const result = compareApiContract(contract({
    '/tool': { query: {}, additionalOperations: { COPY: {}, copy: {}, QUERY: {}, 'NOT A TOKEN': {} } },
  }, '3.2.0'), capture(request('QUERY', '/tool'), request('COPY', '/tool'), request('copy', '/tool'), request('GET', '/tool')));
  assert.deepEqual(result.operations.map(row => row.method), ['QUERY', 'COPY', 'copy']);
  assert.deepEqual(result.coverage.operations, { observed: 3, ambiguous: 0, unobserved: 0 });
  assert.deepEqual(result.coverage.contract_omissions, { invalid_additional_method: 2 });
  assert.equal(result.observations[3].reason, 'no_declared_method');
});

test('bounds input counts and marks route checks beyond budget as omitted', () => {
  assert.throws(() => compareApiContract({ openapi: '2.0' }, capture()), { code: 'api_contract_input' });
  assert.throws(() => compareApiContract(contract([]), capture()), { code: 'api_contract_input' });
  assert.throws(() => compareApiContract(contract({}), {}), { code: 'api_contract_input' });
  assert.throws(() => compareApiContract(contract({}), { log: { entries: Array(5_001) } }), { code: 'api_contract_bounds' });
  const manyPaths = count => Object.fromEntries(Array.from({ length: count }, (_, index) => [`/{p${index}}`, { get: {} }]));
  assert.throws(() => compareApiContract(contract(manyPaths(1_001)), capture()), { code: 'api_contract_bounds' });
  const manyMethods = Object.fromEntries(Array.from({ length: 2_000 }, (_, index) => [`X${index}`, {}]));
  assert.throws(() => compareApiContract(contract({ '/one': { get: {}, additionalOperations: manyMethods } }, '3.2.0'), capture()), { code: 'api_contract_bounds' });
  const result = compareApiContract(contract({ '/literal': { get: {} }, ...manyPaths(500) }), capture(
    ...Array.from({ length: 501 }, () => request('GET', '/value')), request('GET', '/literal'),
  ));
  assert.equal(result.coverage.route_checks, 250_000);
  assert.equal(result.observations[0].candidate_operation_count, 500);
  assert.equal(result.observations[0].candidate_operation_indices.length, 8);
  assert.equal(result.observations[500].reason, 'route_check_budget');
  assert.equal(result.observations[501].status, 'observed');
});
